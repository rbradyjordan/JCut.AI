// JCut.AI CastCut panel — runs inside Premiere Pro's CEP runtime.
//
// The full multicam edit happens INSIDE Premiere:
//   1. jcutGetSequenceSpec() (ExtendScript) reads the open sequence's tracks,
//      clips, and media paths.
//   2. The panel spawns the local JCut engine (`multicam-plan`) — Silero VAD
//      via ONNX, no Python, no network — to compute the camera-switch runs.
//   3. jcutApplyMulticam() razors every camera track at each switch point and
//      deletes the inactive segments, AutoPod-style. No export, no round-trip.
//
// The old app round-trip (watch renders/, send project) lives under "Advanced".

/* global window, document */
var fs = window.cep_node ? window.cep_node.require("fs") : null;
var pathMod = window.cep_node ? window.cep_node.require("path") : null;
var os = window.cep_node ? window.cep_node.require("os") : null;
var cp = window.cep_node ? window.cep_node.require("child_process") : null;

function evalScript(script) {
  return new Promise(function (resolve) {
    window.__adobe_cep__.evalScript(script, resolve);
  });
}
function jsStr(s) { return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'; }

var $ = function (id) { return document.getElementById(id); };
var logEl = $("log");
var MAX_LOG = 40;
function log(msg, cls) {
  var d = document.createElement("div");
  d.className = "logline" + (cls ? " " + cls : "");
  var dot = document.createElement("span"); dot.className = "dot";
  var txt = document.createElement("span"); txt.textContent = msg;
  d.appendChild(dot); d.appendChild(txt);
  logEl.insertBefore(d, logEl.firstChild);
  while (logEl.children.length > MAX_LOG) logEl.removeChild(logEl.lastChild);
}

// ── Backend runner discovery ─────────────────────────────────────────────────
// The engine ships inside the JCut app (Electron binary run as Node) and in the
// dev repo. First match wins; the choice is cached until it stops existing.
function findRunner() {
  var home = os.homedir();
  var candidates = [
    { bin: "/Applications/JCut AI.app/Contents/MacOS/JCut AI",
      cli: "/Applications/JCut AI.app/Contents/Resources/backend/dist/tools/cli.js",
      env: { ELECTRON_RUN_AS_NODE: "1" }, label: "JCut app" },
    { bin: home + "/Applications/JCut AI.app/Contents/MacOS/JCut AI",
      cli: home + "/Applications/JCut AI.app/Contents/Resources/backend/dist/tools/cli.js",
      env: { ELECTRON_RUN_AS_NODE: "1" }, label: "JCut app (user)" },
    { bin: "/opt/homebrew/bin/node", cli: home + "/Documents/JcutAI-app/dist/tools/cli.js", env: {}, label: "dev repo" },
    { bin: "/usr/local/bin/node",    cli: home + "/Documents/JcutAI-app/dist/tools/cli.js", env: {}, label: "dev repo" },
  ];
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    try { if (fs.existsSync(c.bin) && fs.existsSync(c.cli)) return c; } catch (e) { /* next */ }
  }
  return null;
}

// Run a jc CLI command, JSON in/out. The spec goes through a temp file to
// dodge argv length limits on long sequences.
function runCli(args, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var r = findRunner();
    if (!r) {
      reject(new Error("JCut engine not found. Install the JCut AI app to /Applications (the panel uses its bundled engine)."));
      return;
    }
    var env = {};
    for (var k in window.cep_node.process.env) env[k] = window.cep_node.process.env[k];
    for (var k2 in r.env) env[k2] = r.env[k2];
    var child = cp.spawn(r.bin, [r.cli].concat(args), { env: env });
    var out = "", err = "";
    var timer = setTimeout(function () {
      try { child.kill("SIGKILL"); } catch (e) { /* ok */ }
      reject(new Error("The analysis took too long and was stopped."));
    }, timeoutMs || 600000);
    child.stdout.on("data", function (d) { out += d; });
    child.stderr.on("data", function (d) { err += d; });
    child.on("error", function (e) { clearTimeout(timer); reject(e); });
    child.on("close", function () {
      clearTimeout(timer);
      try { resolve(JSON.parse(out)); }
      catch (e) { reject(new Error("Engine returned unreadable output: " + (err || out).slice(0, 200))); }
    });
  });
}

// ── Read sequence → camera table ─────────────────────────────────────────────
var seqSpec = null;   // last jcutGetSequenceSpec payload
var camRows = [];     // UI state per enabled video track

$("readBtn").addEventListener("click", async function () {
  var raw = await evalScript("jcutGetSequenceSpec()");
  var spec;
  try { spec = JSON.parse(raw); } catch (e) { log("Could not read the sequence: " + raw, "err"); return; }
  if (!spec.ok) { log(spec.error || "Could not read the sequence.", "err"); return; }
  seqSpec = spec;
  $("seqInfo").innerHTML = "<b>" + escapeHtml(spec.name) + "</b> · " + spec.fps + " fps";
  $("seqInfo").classList.remove("hidden");
  buildCamCards(spec);
  $("setup").classList.remove("hidden");
  log("Read “" + spec.name + "” — assign your cameras below.", "ok");
});

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Accent color per camera slot (matches the app's marker palette).
var CAM_COLORS = ["#23c6a2", "#2e6be6", "#8b5cf6", "#f59e0b", "#ec4899", "#eab308", "#ef4444", "#e5e7eb"];

// Build one iOS-style card per video track with clips.
function buildCamCards(spec) {
  var vt = spec.video_tracks.filter(function (t) { return t.clip_count > 0; });
  var at = spec.audio_tracks;
  var list = $("camList");
  list.innerHTML = "";
  camRows = [];
  vt.forEach(function (t, i) {
    // Auto-guess: highest of 3+ tracks = Wide; mic defaults to the same-numbered
    // audio track when it has clips.
    var isLast = i === vt.length - 1;
    var guessType = isLast && vt.length >= 3 ? "wide" : "solo";
    var guessName = guessType === "wide" ? "Wide" : i === 0 ? "Host" : "Speaker " + (i + 1);
    var micGuess = (at[t.index] && at[t.index].clip_count > 0) ? t.index
      : (at[i] && at[i].clip_count > 0) ? i : -1;
    var color = CAM_COLORS[i % CAM_COLORS.length];
    var row = { trackIndex: t.index, enabled: true, name: guessName, type: guessType,
                micTrack: guessType === "wide" ? -1 : micGuess };

    var card = document.createElement("div");
    card.className = "cam";
    card.style.borderLeftColor = color;

    // Top: track badge · name field · enable switch
    var top = document.createElement("div"); top.className = "cam-top";
    var badge = document.createElement("span"); badge.className = "cam-badge"; badge.textContent = "V" + (t.index + 1);
    var name = document.createElement("input"); name.className = "txt"; name.type = "text"; name.value = guessName;
    name.addEventListener("input", function () { row.name = name.value; });
    var sw = document.createElement("label"); sw.className = "switch spacer";
    var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = true;
    cb.addEventListener("change", function () { row.enabled = cb.checked; card.classList.toggle("off", !cb.checked); });
    var trk = document.createElement("span"); trk.className = "track";
    var knob = document.createElement("span"); knob.className = "knob";
    sw.appendChild(cb); sw.appendChild(trk); sw.appendChild(knob);
    top.appendChild(badge); top.appendChild(name); top.appendChild(sw);

    // Segmented type control
    var seg = document.createElement("div"); seg.className = "seg"; seg.style.marginTop = "10px";
    [["solo", "Solo"], ["wide", "Wide"], ["duo", "Duo"], ["trio", "Trio"]].forEach(function (o) {
      var b = document.createElement("button"); b.textContent = o[1];
      if (o[0] === guessType) b.className = "on";
      b.addEventListener("click", function () {
        row.type = o[0];
        Array.prototype.forEach.call(seg.children, function (c) { c.className = ""; });
        b.className = "on";
      });
      seg.appendChild(b);
    });

    // Mic row (styled menu)
    var micWrap = document.createElement("div"); micWrap.className = "cam-mic";
    var micLbl = document.createElement("span"); micLbl.className = "lbl"; micLbl.textContent = "Microphone";
    var sel = document.createElement("select"); sel.className = "menu spacer"; sel.style.marginLeft = "auto";
    var none = document.createElement("option"); none.value = "-1"; none.textContent = "None"; sel.appendChild(none);
    at.forEach(function (aT) {
      if (aT.clip_count === 0) return;
      var op = document.createElement("option"); op.value = String(aT.index); op.textContent = "A" + (aT.index + 1);
      if (aT.index === row.micTrack) op.selected = true;
      sel.appendChild(op);
    });
    sel.addEventListener("change", function () { row.micTrack = Number(sel.value); });
    micWrap.appendChild(micLbl); micWrap.appendChild(sel);

    card.appendChild(top); card.appendChild(seg); card.appendChild(micWrap);
    list.appendChild(card);
    camRows.push(row);
  });
}

// ── Build the engine spec from the UI + sequence ─────────────────────────────
function buildSpec() {
  var cams = camRows.filter(function (r) { return r.enabled; });
  if (cams.length < 2) throw new Error("Enable at least 2 cameras.");
  var withMics = cams.filter(function (r) { return r.type === "solo" && r.micTrack >= 0; });
  if (withMics.length < 1) throw new Error("At least one Solo camera needs a mic assigned.");
  function clipsOf(trackList, idx) {
    var t = trackList[idx];
    if (!t) return [];
    return t.clips.filter(function (c) { return c.path; }).map(function (c) {
      return {
        path: c.path,
        start_seconds: c.start_seconds,
        trim_start_seconds: c.trim_start_seconds,
        trim_end_seconds: c.trim_start_seconds + (c.end_seconds - c.start_seconds),
      };
    });
  }
  return {
    cameras: cams.map(function (r) {
      return {
        name: r.name || ("V" + (r.trackIndex + 1)),
        type: r.type,
        clips: clipsOf(seqSpec.video_tracks, seqSpec.video_tracks.findIndex(function (t) { return t.index === r.trackIndex; })),
        audio_clips: r.micTrack >= 0
          ? clipsOf(seqSpec.audio_tracks, seqSpec.audio_tracks.findIndex(function (t) { return t.index === r.micTrack; }))
          : [],
      };
    }),
    settings: {
      cooldown: Number($("setCooldown").value) || 1.5,
      min_speech: Number($("setMinSpeech").value) || 0.5,
      wide_shot_ratio: (Number($("setWide").value) || 15) / 100,
      max_shot: Number($("setMaxShot").value) || 0,
      silence_threshold: Number($("setThresh").value) || -35,
    },
  };
}

async function computePlan() {
  var spec = buildSpec();
  var specPath = pathMod.join(os.tmpdir(), "jcut-plan-" + Date.now() + ".json");
  fs.writeFileSync(specPath, JSON.stringify(spec));
  try {
    var res = await runCli(["multicam-plan", "--spec-file", specPath]);
    if (!res.ok) throw new Error(res.error || "Plan failed.");
    return { spec: spec, plan: res };
  } finally {
    try { fs.unlinkSync(specPath); } catch (e) { /* ok */ }
  }
}

$("previewBtn").addEventListener("click", async function () {
  this.disabled = true;
  try {
    log("Analyzing who's speaking…");
    var out = await computePlan();
    log("Plan: " + out.plan.cuts + " cuts (" + out.plan.vad_mode + " detection)", "ok");
    var reversed = out.plan.runs.slice().reverse();
    reversed.forEach(function (r) {
      var d = document.createElement("div");
      d.className = "logline plan";
      d.textContent = r.start_seconds.toFixed(2) + "s → " + r.end_seconds.toFixed(2) + "s   " + r.camera;
      logEl.insertBefore(d, logEl.firstChild.nextSibling);
    });
  } catch (e) { log(e.message, "err"); }
  this.disabled = false;
});

$("applyBtn").addEventListener("click", async function () {
  this.disabled = true;
  try {
    if ($("dupSeq").checked) {
      log("Duplicating the sequence…");
      var dup = await evalScript("jcutDuplicateActiveSequence()");
      if (dup.indexOf("OK:") !== 0) throw new Error("Could not duplicate: " + dup + " — uncheck the duplicate option to edit in place.");
      log("Working on: " + dup.slice(3), "ok");
    }
    log("Analyzing who's speaking…");
    var out = await computePlan();
    log("Applying " + out.plan.cuts + " cuts in Premiere…");
    var enabled = camRows.filter(function (r) { return r.enabled; });
    var applyPlan = {
      track_indexes: enabled.map(function (r) { return r.trackIndex; }),
      runs: out.plan.runs.map(function (r) {
        return { camera_index: r.camera_index, start_seconds: r.start_seconds, end_seconds: r.end_seconds };
      }),
    };
    var res = await evalScript("jcutApplyMulticam(" + jsStr(JSON.stringify(applyPlan)) + ")");
    if (res.indexOf("OK:") === 0) {
      var stats = JSON.parse(res.slice(3));
      log("Done — " + stats.cuts + " cuts, " + stats.removed + " segments removed." +
        (stats.failed ? " (" + stats.failed + " segments could not be removed — check locked tracks.)" : ""), "ok");
      log("Review the edit; Cmd+Z steps back through the cuts.");
    } else {
      throw new Error(res);
    }
  } catch (e) { log(e.message, "err"); }
  this.disabled = false;
});

// ── UI wiring: how-to toggle + live slider values ────────────────────────────
$("infoBtn").addEventListener("click", function () { $("howto").classList.toggle("show"); });

[["setCooldown", "valCooldown"], ["setMinSpeech", "valMinSpeech"],
 ["setWide", "valWide"], ["setThresh", "valThresh"]].forEach(function (pair) {
  var input = $(pair[0]), out = $(pair[1]);
  var sync = function () { out.textContent = input.value; };
  input.addEventListener("input", sync);
  sync();
});
// Max shot: 0 = "Off".
(function () {
  var input = $("setMaxShot"), wrap = $("valMaxWrap");
  var sync = function () { wrap.textContent = input.value === "0" ? "Off" : input.value + "s"; };
  input.addEventListener("input", sync);
  sync();
})();

// ── Advanced: JCut app round-trip (v1 behavior, condensed) ───────────────────
var CUSTOM = "__custom__";
var timer = null;
var known = {};
var openProjectPath = "";
var wsSelect = $("wsSelect"), watchBtn = $("watchBtn"), autoImport = $("autoImport"), pushBtn = $("pushBtn");

function jcutHome() { return pathMod.join(os.homedir(), "Documents", "JCutAI"); }
function discoverWorkspaces() {
  var out = [];
  try {
    fs.readdirSync(jcutHome()).forEach(function (name) {
      if (name.charAt(0) === "." || name.charAt(0) === "_") return;
      var full = pathMod.join(jcutHome(), name);
      try {
        if (fs.statSync(full).isDirectory() &&
            (fs.existsSync(pathMod.join(full, "sequences")) || fs.existsSync(pathMod.join(full, "renders"))))
          out.push({ name: name, path: full });
      } catch (e) { /* skip */ }
    });
  } catch (e) { /* no home */ }
  return out;
}
(function initSync() {
  if (!fs) return;
  var saved = window.localStorage.getItem("jcut.workspace") || "";
  var found = discoverWorkspaces();
  found.forEach(function (w) {
    var o = document.createElement("option"); o.value = w.path; o.textContent = w.name;
    wsSelect.appendChild(o);
  });
  if (saved && found.some(function (w) { return w.path === saved; })) wsSelect.value = saved;
  wsSelect.addEventListener("change", function () {
    window.localStorage.setItem("jcut.workspace", wsSelect.value);
  });
})();
function rendersDir() { return pathMod.join(wsSelect.value, "renders"); }
function syncDir() { return pathMod.join(wsSelect.value, "sync"); }
async function refreshOpenProject() { openProjectPath = (await evalScript("jcutProjectPath()")) || ""; }
async function pollOnce(firstPass) {
  var files;
  try { files = fs.readdirSync(rendersDir()); } catch (e) { return; }
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (!/\.prproj$/i.test(f) || f.charAt(0) === ".") continue;
    var full = pathMod.join(rendersDir(), f);
    var st;
    try { st = fs.statSync(full); } catch (e) { continue; }
    var prev = known[full];
    known[full] = st.mtimeMs;
    if (firstPass || prev === st.mtimeMs || full === openProjectPath) continue;
    await new Promise(function (r) { setTimeout(r, 800); });
    if (autoImport.checked) {
      var res = await evalScript("jcutImportPrproj(" + jsStr(full) + ")");
      log(res.indexOf("OK") === 0 ? "Imported " + f + " into your project bin." : "Import failed: " + res,
          res.indexOf("OK") === 0 ? "ok" : "err");
    } else {
      log("New JCut export: " + f + " (auto-import off).");
    }
  }
}
watchBtn.addEventListener("click", async function () {
  if (timer) {
    clearInterval(timer); timer = null;
    watchBtn.textContent = "Start watching";
    log("Stopped watching.");
    return;
  }
  if (!wsSelect.value) { log("Pick a JCut project in the dropdown first.", "err"); return; }
  known = {};
  await refreshOpenProject();
  await pollOnce(true);
  timer = setInterval(function () { refreshOpenProject().then(function () { return pollOnce(false); }); }, 3000);
  watchBtn.textContent = "Stop watching";
  log("Watching " + rendersDir(), "ok");
});
pushBtn.addEventListener("click", async function () {
  if (!wsSelect.value) { log("Pick a JCut project in the dropdown first.", "err"); return; }
  var res = await evalScript("jcutPushProject(" + jsStr(syncDir()) + ")");
  log(res.indexOf("OK:") === 0 ? "Sent to JCut: " + res.slice(3).split("/").pop() : "Send failed: " + res,
      res.indexOf("OK:") === 0 ? "ok" : "err");
});
