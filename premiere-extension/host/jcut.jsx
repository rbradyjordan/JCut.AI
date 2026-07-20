// JCut.AI companion — ExtendScript host functions (run inside Premiere Pro).
// Called from the panel via CSInterface.evalScript. Every function returns a
// plain string: "OK[:detail]", "ERR:reason", or a JSON payload.
//
// v2 adds the fully-in-Premiere CastCut path:
//   jcutGetSequenceSpec()        → JSON of the ACTIVE sequence's tracks/clips
//   jcutApplyMulticam(planJson)  → razor every camera track at each switch
//                                  point and delete the inactive segments —
//                                  the AutoPod-style edit, applied in place
//   jcutDuplicateActiveSequence() → safety copy before a destructive edit

// ── Minimal JSON.stringify (ExtendScript has no native JSON) ────────────────
if (typeof JSON === "undefined") { JSON = {}; }
if (!JSON.stringify) {
  JSON.stringify = function (v) {
    function esc(s) {
      return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')
        .replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
    }
    function go(x) {
      if (x === null || x === undefined) return "null";
      var t = typeof x;
      if (t === "number") return isFinite(x) ? String(x) : "null";
      if (t === "boolean") return String(x);
      if (t === "string") return '"' + esc(x) + '"';
      if (x instanceof Array) {
        var parts = [];
        for (var i = 0; i < x.length; i++) parts.push(go(x[i]));
        return "[" + parts.join(",") + "]";
      }
      var kv = [];
      for (var k in x) if (x.hasOwnProperty(k)) kv.push('"' + esc(k) + '":' + go(x[k]));
      return "{" + kv.join(",") + "}";
    }
    return go(v);
  };
}

var JCUT_TICKS_PER_SECOND = 254016000000;

function _activeSeq() {
  if (!app.project || !app.project.activeSequence) return null;
  return app.project.activeSequence;
}

function _seqFps(seq) {
  try {
    var tb = Number(seq.timebase); // ticks per frame
    if (tb > 0) return JCUT_TICKS_PER_SECOND / tb;
  } catch (e) { /* fall through */ }
  return 30;
}

// SMPTE timecode for QE razor. Handles drop-frame (29.97/59.94) correctly.
function _secondsToTimecode(sec, fps) {
  var isDrop = Math.abs(fps - 29.97) < 0.01 || Math.abs(fps - 59.94) < 0.01;
  var frame = Math.round(sec * fps);
  if (!isDrop) {
    var f = Math.round(fps);
    var ff = frame % f;
    var totalSec = Math.floor(frame / f);
    var ss = totalSec % 60, mm = Math.floor(totalSec / 60) % 60, hh = Math.floor(totalSec / 3600);
    return _p2(hh) + ":" + _p2(mm) + ":" + _p2(ss) + ":" + _p2(ff);
  }
  // Drop-frame: drop 2 (or 4 at 59.94) frame NUMBERS each minute except every 10th.
  var nominal = Math.abs(fps - 29.97) < 0.01 ? 30 : 60;
  var dropPerMin = nominal === 30 ? 2 : 4;
  var framesPer10Min = Math.round(fps * 600);
  var framesPerMinNominal = nominal * 60;
  var d = Math.floor(frame / framesPer10Min);
  var m = frame % framesPer10Min;
  var extra;
  if (m > dropPerMin - 1) {
    extra = dropPerMin * 9 * d + dropPerMin * Math.floor((m - dropPerMin) / (framesPerMinNominal - dropPerMin));
  } else {
    extra = dropPerMin * 9 * d;
  }
  frame += extra;
  var ff2 = frame % nominal;
  var s2 = Math.floor(frame / nominal) % 60;
  var m2 = Math.floor(frame / (nominal * 60)) % 60;
  var h2 = Math.floor(frame / (nominal * 3600));
  return _p2(h2) + ";" + _p2(m2) + ";" + _p2(s2) + ";" + _p2(ff2);
}
function _p2(n) { return (n < 10 ? "0" : "") + n; }

// ── Sequence spec: everything the panel needs to build the analysis request ──
function jcutGetSequenceSpec() {
  try {
    var seq = _activeSeq();
    if (!seq) return JSON.stringify({ ok: false, error: "No sequence is open. Open your multicam sequence first." });
    var fps = _seqFps(seq);
    function readTracks(trackColl) {
      var out = [];
      for (var i = 0; i < trackColl.numTracks; i++) {
        var tr = trackColl[i];
        var clips = [];
        for (var j = 0; j < tr.clips.numItems; j++) {
          var c = tr.clips[j];
          var mediaPath = "";
          try { mediaPath = c.projectItem ? c.projectItem.getMediaPath() : ""; } catch (e) { /* generated clip */ }
          clips.push({
            name: c.name,
            path: mediaPath,
            start_seconds: c.start.seconds,
            end_seconds: c.end.seconds,
            trim_start_seconds: c.inPoint.seconds,
          });
        }
        out.push({ index: i, name: tr.name || "", clip_count: tr.clips.numItems, clips: clips });
      }
      return out;
    }
    return JSON.stringify({
      ok: true,
      name: seq.name,
      fps: Math.round(fps * 1000) / 1000,
      video_tracks: readTracks(seq.videoTracks),
      audio_tracks: readTracks(seq.audioTracks),
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}

// ── Duplicate the active sequence (safety copy), and make the copy active ────
function jcutDuplicateActiveSequence() {
  try {
    var seq = _activeSeq();
    if (!seq) return "ERR:No sequence is open.";
    var beforeIds = {};
    for (var i = 0; i < app.project.sequences.numSequences; i++) {
      beforeIds[app.project.sequences[i].sequenceID] = true;
    }
    seq.clone(); // creates "<name> Copy" (localized) in the project
    for (var j = 0; j < app.project.sequences.numSequences; j++) {
      var s = app.project.sequences[j];
      if (!beforeIds[s.sequenceID]) {
        app.project.openSequence(s.sequenceID);
        return "OK:" + s.name;
      }
    }
    return "ERR:Duplicated, but could not locate the copy.";
  } catch (e) {
    return "ERR:" + e.toString();
  }
}

// ── Apply a multicam plan in the OPEN sequence ───────────────────────────────
// planJson: { track_indexes: [premiereVideoTrackIndex per camera_index],
//             runs: [{ camera_index, start_seconds, end_seconds }] }
// Method (AutoPod-style): razor EVERY camera track at every switch boundary,
// then delete each segment on the tracks whose camera is NOT active during
// that run. Audio tracks are left untouched.
function jcutApplyMulticam(planJson) {
  try {
    var seq = _activeSeq();
    if (!seq) return "ERR:No sequence is open.";
    var plan = eval("(" + planJson + ")"); // trusted local payload from the panel
    var runs = plan.runs || [];
    var trackIdx = plan.track_indexes || [];
    if (runs.length < 2) return "ERR:The plan has fewer than 2 runs — nothing to cut.";
    if (runs.length > 4000) return "ERR:Plan too large (" + runs.length + " runs).";

    var fps = _seqFps(seq);
    var halfFrame = 0.5 / fps;

    app.enableQE();
    var qeSeq = qe.project.getActiveSequence();
    if (!qeSeq) return "ERR:QE could not access the active sequence.";

    // 1. Razor every involved track at every interior run boundary.
    var boundaries = [];
    for (var r = 1; r < runs.length; r++) boundaries.push(runs[r].start_seconds);
    var razors = 0;
    for (var b = 0; b < boundaries.length; b++) {
      var tc = _secondsToTimecode(boundaries[b], fps);
      for (var t = 0; t < trackIdx.length; t++) {
        try {
          var qtr = qeSeq.getVideoTrackAt(trackIdx[t]);
          if (qtr) { qtr.razor(tc); razors++; }
        } catch (e) { /* boundary outside this track's clips — fine */ }
      }
    }

    // 2. Delete inactive segments per run (reverse clip order per track so
    //    indices stay valid). trackItem.remove(inRipple=false, alignToVideo=false)
    //    leaves a gap — exactly what a multicam checkerboard needs.
    var removed = 0, failed = 0;
    for (var ri = 0; ri < runs.length; ri++) {
      var run = runs[ri];
      for (var ci = 0; ci < trackIdx.length; ci++) {
        if (ci === run.camera_index) continue;
        var tr = seq.videoTracks[trackIdx[ci]];
        if (!tr) continue;
        for (var k = tr.clips.numItems - 1; k >= 0; k--) {
          var c = tr.clips[k];
          var cs = c.start.seconds, ce = c.end.seconds;
          if (cs >= run.start_seconds - halfFrame && ce <= run.end_seconds + halfFrame) {
            try { c.remove(false, false); removed++; }
            catch (e) { failed++; }
          }
        }
      }
    }
    return "OK:" + JSON.stringify({ razors: razors, removed: removed, failed: failed, cuts: runs.length - 1 });
  } catch (e) {
    return "ERR:" + e.toString();
  }
}

// ── v1 round-trip functions (kept — the "Sync with JCut app" section) ────────

function jcutImportPrproj(p) {
  try {
    if (!app.project) return "ERR:No project is open in Premiere.";
    var f = new File(p);
    if (!f.exists) return "ERR:File not found: " + p;
    var bin = app.project.getInsertionBin ? app.project.getInsertionBin() : app.project.rootItem;
    var ok = app.project.importFiles([f.fsName], true, bin, false);
    return ok ? "OK:" + f.fsName : "ERR:Premiere refused the import (importFiles returned false).";
  } catch (e) {
    return "ERR:" + e.toString();
  }
}

function jcutPushProject(destDir) {
  try {
    if (!app.project) return "ERR:No project is open in Premiere.";
    app.project.save();
    var src = new File(app.project.path);
    if (!src.exists) return "ERR:Could not find the saved project on disk.";
    var folder = new Folder(destDir);
    if (!folder.exists && !folder.create()) return "ERR:Could not create " + destDir;
    var name = app.project.name.replace(/\.prproj$/i, "");
    var stamp = new Date().getTime();
    var dest = new File(destDir + "/" + name + "-" + stamp + ".prproj");
    if (!src.copy(dest.fsName)) return "ERR:Copy failed (" + dest.fsName + ").";
    return "OK:" + dest.fsName;
  } catch (e) {
    return "ERR:" + e.toString();
  }
}

function jcutProjectPath() {
  try {
    if (!app.project || !app.project.path) return "";
    return app.project.path;
  } catch (e) {
    return "";
  }
}
