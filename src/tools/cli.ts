#!/usr/bin/env node
// JCut.AI tools CLI — the "hands" the agent drives via the Bash tool.
// Every command prints JSON to stdout.
//
//   jc sequence-create   --workspace W --name N --width 1080 --height 1920 --framerate 30
//   jc sequences-list     --workspace W
//   jc sequence-inspect   --workspace W --sequence-id ID
//   jc media-info         --files a.mp4 b.mov
//   jc sequence-clips-add --workspace W --sequence-id ID --operations '[...]'
//   jc sequence-clips-update --workspace W --sequence-id ID --operations '[...]'
//   jc sequence-clips-remove --workspace W --sequence-id ID --ids c1 c2
//   jc sequence-export-premiere --workspace W --sequence-id ID  (the deliverable)
// NOTE: JCut does NOT render video — the finished cut is rendered in Premiere from
// the exported .prproj. JCut builds + verifies the timeline structurally.
import {
  ensureWorkspace, saveSequence, loadSequence, listSequences, probeMedia,
  saveCastCutProject, loadCastCutProject, listCastCutProjects, deleteCastCutProject,
  type CastCutProject, type CastCutCamera,
} from "./store.js";
import {
  addClips, updateClips, removeClips,
  addCaptions, removeCaptions, addTransitions, removeTransitions, cascadeTransitions,
} from "./ops.js";
import { analyzeSequence, buildStyleProfile } from "./analyze.js";
import { analyzePrproj, importPrprojClips } from "./prproj.js";
import { exportPrproj } from "./prproj.js";
import { analyzeMusic } from "./beats.js";
import { analyzeVideo } from "./video-analysis.js";
import { extractFrames, saveContent, loadContent, ClipContent } from "./content.js";
import { renderLabelPng } from "./labels.js";
import { BUILTIN_MODES, loadPresets, savePreset, deletePreset, resolveInstructions } from "./presets.js";
import { loadCriteria, saveCriteria, summarizeCriteria, Criteria, Toggle } from "./criteria.js";
import {
  parseTranscriptFile, saveTranscript, listTranscripts, loadTranscript, searchCues,
} from "./transcript.js";
import {
  Sequence, Clip, SequenceMarker, MarkerColor, sequenceDuration, Orientation, orientationCanvas, orientationOf,
  fillTransform, isVideoTrack, clipTimelineEnd, clipTimelineDuration,
} from "./model.js";
import { kenBurnsKeyframes, directionForIndex } from "./kenburns.js";
import { promises as fs } from "node:fs";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { FFMPEG } from "./bin.js";
import { analyzeVadEnvelopeNode } from "./vad.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { workspaceDir } from "./store.js";

const _pexecFile = promisify(execFile);

// Resolve the Python venv and analysis script paths relative to this file.
const _projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const _venvPython = path.join(_projectRoot, "venv", "bin", "python3");
const _analyzeAudioPy = path.join(_projectRoot, "src", "tools", "analyze_audio.py");

// Ask the user WHERE to save an export, every time. Three strategies, in order:
//   1. Electron host (JCUT_IPC_DIR set): emit a marker the host watches in our
//      stdout; the host shows a NATIVE Save dialog and writes the chosen path to a
//      response file we poll. Returns the path, or "__CANCELLED__".
//   2. macOS osascript "choose file name" (when run from a terminal/standalone).
//   3. undefined → caller uses a default folder.
async function requestSavePath(defaultName: string): Promise<string | undefined> {
  const ipcDir = process.env.JCUT_IPC_DIR;
  if (ipcDir) {
    // File-based IPC: this CLI runs INSIDE the agent (Bash tool / execFile), so our
    // stdout is captured by the agent, NOT piped to the Electron host. So we put the
    // request in a FILE the host watches (fs.watch on JCUT_IPC_DIR), and poll for the
    // host's response file. The host shows the native Save dialog.
    const token = `${process.pid}-${Date.now()}`;
    const reqFile = path.join(ipcDir, `save-request-${token}.json`);
    const respFile = path.join(ipcDir, `save-response-${token}.txt`);
    try {
      await fs.writeFile(reqFile, JSON.stringify({ token, defaultName, respFile }));
    } catch {
      return undefined; // can't write the request — fall back to default
    }
    // Poll for the host's response (chosen path, or "__CANCELLED__").
    const deadline = Date.now() + 180000; // 3-min ceiling so we never hang forever
    while (Date.now() < deadline) {
      if (existsSync(respFile)) {
        try {
          const val = readFileSync(respFile, "utf8").trim();
          try { unlinkSync(respFile); } catch { /* best effort */ }
          try { unlinkSync(reqFile); } catch { /* best effort */ }
          if (!val || val === "__CANCELLED__") return "__CANCELLED__";
          return val;
        } catch { /* not fully written yet — keep polling */ }
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    try { unlinkSync(reqFile); } catch { /* */ }
    return undefined; // timed out — fall through to default
  }
  // Standalone / terminal: native macOS dialog via AppleScript.
  if (process.platform === "darwin") {
    try {
      const { execSync } = await import("node:child_process");
      const safe = defaultName.replace(/"/g, '\\"');
      const cmd = `osascript -e 'POSIX path of (choose file name with prompt "Save Premiere Pro project:" default name "${safe}")'`;
      const chosen = execSync(cmd, { encoding: "utf8" }).trim();
      if (chosen) return chosen;
      return "__CANCELLED__";
    } catch { /* user cancelled or no GUI — default below */ }
  }
  return undefined;
}

// Tiny flag parser: --key value, repeated --files collects into an array,
// bare flags become true.
function parseArgs(argv: string[]): Record<string, any> {
  const out: Record<string, any> = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out[key] = true;
      } else if (key === "files" || key === "ids") {
        out[key] = out[key] || [];
        // consume until next flag
        while (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) {
          out[key].push(argv[++i]);
        }
      } else {
        const parts = [argv[++i]];
        while (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) {
          parts.push(argv[++i]);
        }
        out[key] = parts.join(" ");
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

// Extract plain text from a binary document (rtf/doc/docx/pdf) using built-in
// command-line tools, so the agent can read briefs/scripts that aren't already
// plain text. Returns the text, or null if no extractor is available for the
// type. macOS ships `textutil` (rtf/doc/docx); `pdftotext` (poppler) handles PDF
// when installed. We deliberately avoid bundling a parser library — these cover
// the common cases and degrade gracefully (caller warns when null).
async function extractDocText(absPath: string): Promise<string | null> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const ext = path.extname(absPath).toLowerCase();
  try {
    if (ext === ".pdf") {
      // `-` writes extracted text to stdout. Large PDFs are capped by maxBuffer.
      const { stdout } = await run("pdftotext", ["-layout", absPath, "-"], { maxBuffer: 32 * 1024 * 1024 });
      return stdout;
    }
    // rtf / doc / docx → textutil (built into macOS). `-stdout` streams the text.
    const { stdout } = await run("textutil", ["-convert", "txt", "-stdout", absPath], { maxBuffer: 32 * 1024 * 1024 });
    return stdout;
  } catch {
    return null; // extractor missing or failed — caller surfaces a warning
  }
}

function emit(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}
function fail(msg: string): never {
  process.stdout.write(JSON.stringify({ ok: false, error: msg }, null, 2) + "\n");
  process.exit(1);
}

function newSeqId(): string {
  return "seq" + Date.now().toString(36);
}

let _cidCounter = 0;
function newClipId(prefix = "c"): string {
  _cidCounter += 1;
  return `${prefix}${Date.now().toString(36)}${_cidCounter}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readWorkspaceMemory(workspace: string): Promise<string> {
  const mp = path.join(workspaceDir(workspace), "MEMORY.md");
  try {
    return await fs.readFile(mp, "utf8");
  } catch {
    return "# JCut.AI Memory\n";
  }
}

async function upsertMemorySection(workspace: string, heading: string, bodyLines: string[]): Promise<string> {
  const mp = path.join(workspaceDir(workspace), "MEMORY.md");
  let memory = await readWorkspaceMemory(workspace);
  const block = `\n## ${heading}\n${bodyLines.join("\n").trimEnd()}\n`;
  const pattern = new RegExp(`\\n## ${escapeRegExp(heading)}\\n[\\s\\S]*?(?=\\n## |\\n*$)`, "g");
  memory = memory.replace(pattern, "");
  await fs.writeFile(mp, memory.trimEnd() + block);
  return mp;
}

async function resolveWorkspaceMediaPath(ws: string, fileRaw: string): Promise<string> {
  if (path.isAbsolute(fileRaw)) return fileRaw;
  let file = path.join(workspaceDir(ws), fileRaw);
  try {
    await fs.access(file);
    return file;
  } catch {
    // Try workspace source folders next.
  }
  const candidates = [
    path.join(workspaceDir(ws), "source", "audio", fileRaw),
    path.join(workspaceDir(ws), "source", "video", fileRaw),
    path.join(workspaceDir(ws), "source", "images", fileRaw),
    path.join(workspaceDir(ws), "source", fileRaw),
  ];
  for (const cand of candidates) {
    try {
      await fs.access(cand);
      return cand;
    } catch {
      // Keep looking.
    }
  }
  return file;
}

// ── Premiere round-trip: export ledger + conflict-safe versioning ────────────
// The ledger records the fingerprint of every .prproj JCut writes. If a file at
// a target path was MODIFIED since we wrote it (the user saved their Premiere
// work over it), we never overwrite — we version the filename instead. This is
// what makes it safe to keep editing in JCut while the user works in Premiere:
// the user's saved project can never be clobbered by a re-export, and
// prproj-sync-status can tell the agent which exports carry user edits.
interface ExportLedgerEntry {
  path: string;
  sequence_id: string;
  size: number;
  mtime_ms: number;
  exported_at: string;
}
function ledgerPath(ws: string): string {
  return path.join(workspaceDir(ws), "renders", ".jcut-exports.json");
}
async function readExportLedger(ws: string): Promise<ExportLedgerEntry[]> {
  try { return JSON.parse(await fs.readFile(ledgerPath(ws), "utf8")); } catch { return []; }
}
async function writeExportLedger(ws: string, entries: ExportLedgerEntry[]): Promise<void> {
  try {
    await fs.mkdir(path.dirname(ledgerPath(ws)), { recursive: true });
    await fs.writeFile(ledgerPath(ws), JSON.stringify(entries, null, 2));
  } catch { /* non-fatal — versioning still protects, detection just degrades */ }
}
async function fileFingerprint(p: string): Promise<{ size: number; mtime_ms: number } | null> {
  try { const st = await fs.stat(p); return { size: st.size, mtime_ms: st.mtimeMs }; } catch { return null; }
}
function fingerprintMatches(e: ExportLedgerEntry, fp: { size: number; mtime_ms: number }): boolean {
  return e.size === fp.size && Math.abs(e.mtime_ms - fp.mtime_ms) < 1;
}
// "name.prproj" → "name v2.prproj" (an existing " vN" suffix is replaced, so
// versions go v2 → v3, never "v2 v2").
function versionedPath(p: string, n: number): string {
  const ext = path.extname(p);
  const base = p.slice(0, p.length - ext.length).replace(/ v\d+$/, "");
  return `${base} v${n}${ext}`;
}

// ── Multi-track ripple delete ────────────────────────────────────────────────
// Remove a sequence-time range [s, e) from EVERY track: split clips straddling
// the boundaries, drop what's inside, and pull everything after it left. This
// is the multi-track-safe primitive behind the Jump Cut Editor — cutting dead
// air out of one mic's track must compress ALL camera angles equally, or a
// multicam sequence drifts out of sync after the first cut.
function rippleDeleteRange(seq: Sequence, s: number, e: number, ripple = true): void {
  const d = e - s;
  if (d <= 0.0005) return;
  const survivors: Clip[] = [];
  const additions: Clip[] = [];
  for (const c of seq.clips) {
    const speed = c.speed || 1.0;
    const cs = c.start_time_seconds;
    const ce = clipTimelineEnd(c);
    if (ce <= s + 1e-6) { survivors.push(c); continue; }                       // fully before
    if (cs >= e - 1e-6) {                                                      // fully after
      if (ripple) c.start_time_seconds = cs - d;
      survivors.push(c);
      continue;
    }
    const startsBefore = cs < s - 1e-6;
    const endsAfter = ce > e + 1e-6;
    if (startsBefore && endsAfter) {
      // Straddles the range: head keeps [cs, s); tail carries [e, ce) — shifted
      // to butt against the head when rippling, left at e when keeping gaps.
      // The tail is a NEW clip (fresh id, unlinked — duplicate link_ids on one
      // track would corrupt group ops).
      const tail: Clip = {
        ...c,
        id: newClipId("c"),
        link_id: null,
        trim_start_seconds: c.trim_start_seconds + (e - cs) * speed,
        start_time_seconds: ripple ? s : e,
      };
      c.trim_end_seconds = c.trim_start_seconds + (s - cs) * speed;
      survivors.push(c);
      additions.push(tail);
    } else if (startsBefore) {
      c.trim_end_seconds = c.trim_start_seconds + (s - cs) * speed;            // cut the tail off
      survivors.push(c);
    } else if (endsAfter) {
      c.trim_start_seconds = c.trim_start_seconds + (e - cs) * speed;          // cut the head off
      c.start_time_seconds = ripple ? s : e;
      survivors.push(c);
    } // fully inside the range → dropped
  }
  seq.clips = [...survivors, ...additions];
  if (ripple) {
    // Markers and captions ride the timeline with the same shift.
    for (const mk of seq.markers || []) {
      if (mk.time_seconds >= e) mk.time_seconds = Math.round((mk.time_seconds - d) * 1000) / 1000;
      else if (mk.time_seconds > s) mk.time_seconds = s;
    }
    for (const cap of seq.captions || []) {
      const shift = (t: number) => (t >= e ? t - d : t > s ? s : t);
      cap.start_time_seconds = shift(cap.start_time_seconds);
      cap.end_time_seconds = shift(cap.end_time_seconds);
    }
  }
  cascadeTransitions(seq);
}

// ── Deterministic no-Python fallbacks (ffmpeg-only) ──────────────────────────
// The podcast pipeline must work with ZERO optional dependencies: no venv, no
// torch, no network. These pure-TS analyzers decode with the bundled ffmpeg and
// mirror analyze_audio.py's RMS math exactly, so the multicam editor and jump
// cut editor degrade gracefully from Silero VAD to RMS instead of failing.
const TS_ENV_SR = 11025;
const TS_ENV_HOP = 256; // ~43 fps, same as the Python RMS path

function tsDecodePcm(file: string, sr: number): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG, [
      "-v", "quiet", "-i", file, "-ac", "1", "-ar", String(sr), "-f", "s16le", "-",
    ]);
    const chunks: Buffer[] = [];
    let done = false;
    const finish = (fn: () => void) => { if (!done) { done = true; fn(); } };
    const timer = setTimeout(() => {
      try { ff.kill("SIGKILL"); } catch { /* ok */ }
      finish(() => reject(new Error("audio decode timed out")));
    }, 300000);
    ff.stdout.on("data", (dd: Buffer) => chunks.push(dd));
    ff.on("error", (err: Error) => { clearTimeout(timer); finish(() => reject(err)); });
    ff.on("close", (code: number | null) => {
      clearTimeout(timer);
      finish(() => {
        if (code !== 0 && chunks.length === 0) return reject(new Error("ffmpeg decode failed"));
        const buf = Buffer.concat(chunks);
        const n = Math.floor(buf.length / 2);
        const out = new Float32Array(n);
        for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
        resolve(out);
      });
    });
  });
}

// 0–1 activity envelope, identical scale to analyze_audio.py's rms mode:
// activity = (clamp(dB, -60, 0) + 60) / 60.
async function tsActivityEnvelope(file: string): Promise<{ values: number[]; fps: number }> {
  const pcm = await tsDecodePcm(file, TS_ENV_SR);
  const frames = Math.floor(pcm.length / TS_ENV_HOP);
  const values: number[] = new Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    const base = i * TS_ENV_HOP;
    for (let j = 0; j < TS_ENV_HOP; j++) { const v = pcm[base + j]; sum += v * v; }
    const rms = Math.sqrt(sum / TS_ENV_HOP);
    const db = 20 * Math.log10(Math.max(rms, 1e-10));
    values[i] = Math.round(((Math.max(-60, Math.min(0, db)) + 60) / 60) * 1000) / 1000;
  }
  return { values, fps: TS_ENV_SR / TS_ENV_HOP };
}

// Silence regions in SOURCE seconds — a faithful port of analyze_audio.py's
// detect_silence (10ms RMS frames, dB threshold, min length, pre/post buffers).
async function tsDetectSilence(
  file: string, thresholdDb: number, minSilenceSec: number, preBufSec: number, postBufSec: number,
): Promise<{ start_seconds: number; end_seconds: number }[]> {
  const sr = TS_ENV_SR;
  const pcm = await tsDecodePcm(file, sr);
  const hop = Math.max(1, Math.floor(sr * 0.01));
  const frames = Math.floor(pcm.length / hop);
  const fps = sr / hop;
  const minFrames = Math.round(minSilenceSec * fps);
  const preFrames = Math.round(preBufSec * fps);
  const postFrames = Math.round(postBufSec * fps);
  const out: { start_seconds: number; end_seconds: number }[] = [];
  let inSil = false, silStart = 0;
  const flush = (endFrame: number) => {
    const len = endFrame - silStart;
    if (len < minFrames) return;
    const s = silStart + preFrames, e = endFrame - postFrames;
    if (e > s) out.push({ start_seconds: Math.round((s / fps) * 1000) / 1000, end_seconds: Math.round((e / fps) * 1000) / 1000 });
  };
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    const base = i * hop;
    for (let j = 0; j < hop; j++) { const v = pcm[base + j]; sum += v * v; }
    const db = 20 * Math.log10(Math.max(Math.sqrt(sum / hop), 1e-10));
    if (db < thresholdDb) {
      if (!inSil) { inSil = true; silStart = i; }
    } else if (inSil) {
      inSil = false;
      flush(i);
    }
  }
  if (inSil) flush(frames);
  return out;
}

// ── Premiere companion panel: source, status ─────────────────────────────────
// The panel ships with the app (premiere-extension/ beside dist/, both in dev
// and inside the packaged backend resources).
function premierePanelSrc(): string {
  return path.join(_projectRoot, "premiere-extension");
}
async function premierePanelStatus(destOverride?: string): Promise<{
  premiere_installed: boolean;
  premiere_apps: string[];
  panel_installed: boolean;
  panel_version: string | null;
  source_version: string | null;
  panel_up_to_date: boolean;
  debug_mode: Record<string, boolean>;
  debug_mode_ok: boolean;
  install_path: string;
}> {
  const dest = destOverride ||
    path.join(os.homedir(), "Library", "Application Support", "Adobe", "CEP", "extensions", "com.jcutai.panel");
  const readVersion = async (dir: string): Promise<string | null> => {
    try {
      const xml = await fs.readFile(path.join(dir, "CSXS", "manifest.xml"), "utf8");
      return xml.match(/ExtensionBundleVersion="([^"]+)"/)?.[1] ?? null;
    } catch { return null; }
  };
  let premiereApps: string[] = [];
  try {
    premiereApps = (await fs.readdir("/Applications")).filter((f) => /^Adobe Premiere Pro/i.test(f));
  } catch { /* not macOS or no /Applications */ }
  const panelVersion = await readVersion(dest);
  const sourceVersion = await readVersion(premierePanelSrc());
  // PlayerDebugMode lets unsigned (development) panels load. Premiere 2019+ uses
  // CSXS 9–12; current Premiere (2024–2026) uses CEP 12 = CSXS.12. We check 9–14
  // and treat 11/12/13/14 (current-era) passing as "enabled".
  const defaultsBin = existsSync("/usr/bin/defaults") ? "/usr/bin/defaults" : "defaults";
  const debugMode: Record<string, boolean> = {};
  if (process.platform === "darwin") {
    for (const v of [9, 10, 11, 12, 13, 14]) {
      try {
        const { stdout } = await _pexecFile(defaultsBin, ["read", `com.adobe.CSXS.${v}`, "PlayerDebugMode"]);
        debugMode[`csxs-${v}`] = stdout.trim() === "1";
      } catch { debugMode[`csxs-${v}`] = false; }
    }
  }
  return {
    premiere_installed: premiereApps.length > 0,
    premiere_apps: premiereApps,
    panel_installed: panelVersion != null,
    panel_version: panelVersion,
    source_version: sourceVersion,
    panel_up_to_date: panelVersion != null && panelVersion === sourceVersion,
    debug_mode: debugMode,
    debug_mode_ok: debugMode["csxs-11"] === true || debugMode["csxs-12"] === true ||
      debugMode["csxs-13"] === true || debugMode["csxs-14"] === true,
    install_path: dest,
  };
}

// Knowledge base lives at <project>/kb. From dist/tools/cli.js that's ../../kb.
function kbDir(): string {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "kb");
}

// Titles + "read when" hints so kb-list guides the agent to the right doc.
const KB_TITLES: Record<string, { title: string; when: string }> = {
  "fundamentals": { title: "Editing Fundamentals", when: "Always — universal craft principles. Read first." },
  "footage-intuition": { title: "Footage Intuition — Reading How Material Is Organized", when: "Before assembling from a pool of files — classify music vs B-roll, infer the intended spine, decide what NOT to use." },
  "editing-craft": { title: "Editing Craft — Advanced Techniques", when: "Before any creative edit (cool cuts, speed ramps, beat-sync)." },
  "recap-videos": { title: "Recap Videos — Specialist Playbook", when: "Recaps, highlights, best-of, event/season recaps, sizzles, aftermovies." },
  "interviews-dialogue": { title: "Interviews & Dialogue + Breathing Room", when: "Interviews, talking-head, podcast, any transcript-driven cut." },
  "documentary-narrative": { title: "Documentary & Narrative", when: "Docs, mini-docs, brand stories, narrative YouTube." },
  "short-form-social": { title: "Short-Form & Social", when: "TikTok/Reels/Shorts, vertical, retention-focused ads." },
  "trailer-hype": { title: "Trailers & Hype Edits", when: "Trailers, launch/announcement hype, promos." },
  "wedding-event": { title: "Weddings & Events", when: "Weddings, parties, conferences, performances." },
  "music-video": { title: "Music Videos & Performance", when: "Music videos, performance/live cuts, lyric pieces." },
  "pacing-and-rhythm": { title: "Pacing, Rhythm & Breathing Room", when: "Any project — timing, beat-grid cutting, breathing room." },
  "audio": { title: "Audio — Levels, Mixing & Sound", when: "Any project with audio — levels, ducking, J/L cuts, fades." },
  "color-continuity": { title: "Color & Visual Continuity", when: "Matching shots; multi-source or multi-light footage." },
};

// ─────────────────────────────────────────────────────────────────────────────
// Multicam switching engine — shared by sequence-multi-camera-editor (JCut
// timelines) and multicam-plan (the Premiere panel's fully-in-Premiere path).
// Analyzes every camera's mic(s), runs the AutoPod-parity state machine
// (dominance + hysteresis + backdated cuts + duo/trio + angle rotation +
// wide-ratio + max-shot) and returns the camera runs on a {MULTICAM_STATE_FPS}fps
// sequence-time grid.
export const MULTICAM_STATE_FPS = 30;

export interface MulticamCameraSpec {
  video_track: string;
  audio_track?: string;
  audio_tracks?: string[];
  name?: string;
  type?: "solo" | "wide" | "duo" | "trio";
}

interface MulticamParams {
  wideRatio: number;
  cooldownSec: number;
  minSpeechSec: number;
  silThresh: number;
  maxShotSec: number;
}

async function computeMulticamRuns(
  srcSeq: Sequence,
  cameras: MulticamCameraSpec[],
  params: MulticamParams,
  resolveFile: (src: string) => Promise<string>,
) {
  const { wideRatio, cooldownSec, minSpeechSec, silThresh, maxShotSec } = params;
    // Step 1: analyze each distinct audio source file, then sample every
    // camera's speech activity on a uniform sequence-time grid.
    //
    // ONE INDEX SPACE: every camera index below is an index into `cameras`.
    // (The old code indexed a filtered "tracks with audio" array with full
    // camera indices — one source-less camera and every later camera read
    // its neighbor's envelope.)
    // A camera may have SEVERAL mic tracks (lav + boom — AutoPod's multi-mic
    // setup): accept audio_tracks: ["A1","A5"] alongside the single
    // audio_track. Activity is the MAX across the camera's mics per frame.
    const audioTracksOf = (cam: (typeof cameras)[number]): string[] => {
      const many = (cam as any).audio_tracks;
      if (Array.isArray(many) && many.length > 0) return many.map(String);
      return cam.audio_track ? [cam.audio_track] : [];
    };
    const byStart = (x: Clip, y: Clip) => x.start_time_seconds - y.start_time_seconds;
    // Per camera, per mic track: sorted clip list (kept separate — a
    // speaker's mics overlap in time, so a single merged list would break
    // the two-pointer sampling below).
    const camTrackClips: Clip[][][] = cameras.map((cam) =>
      audioTracksOf(cam).map((t) => srcSeq.clips.filter((c) => c.track === t).sort(byStart))
    );
    // Flattened per-camera view for counting, the mix, and the fallback bed.
    const camAudioClips: Clip[][] = camTrackClips.map((lists) => lists.flat().sort(byStart));
    if (camAudioClips.filter((list) => list.length > 0).length < 2) {
      return { ok: false as const, error: "Need at least 2 cameras with audio clips on their assigned tracks." };
    }

    // Resolve every distinct source file referenced by any camera's audio
    // clips (a track can hold several clips, possibly from several files).
    const fileForSource = new Map<string, string>();
    for (const list of camAudioClips) {
      for (const c of list) {
        if (!fileForSource.has(c.source_path)) {
          fileForSource.set(c.source_path, await resolveFile(c.source_path));
        }
      }
    }
    const distinctFiles = [...new Set(fileForSource.values())];
    let envResult: any;
    try {
      const { stdout } = await _pexecFile(_venvPython, [
        _analyzeAudioPy, "--mode", "envelope",
        "--file", distinctFiles[0],
        "--files", ...distinctFiles,
      ], { maxBuffer: 256 * 1024 * 1024 });
      envResult = JSON.parse(stdout);
    } catch {
      // No Python venv — run Silero VAD directly in Node (vendored ONNX
      // model + onnxruntime-node; same model, same probabilities — this is
      // the PACKAGED app's primary path). If even that is unavailable,
      // degrade to the deterministic pure-TS RMS envelope (ffmpeg only).
      try {
        const tracks = [];
        for (const f of distinctFiles) {
          try {
            const env = await analyzeVadEnvelopeNode(f);
            tracks.push({ file: f, ok: true, fps: env.fps, envelope_db: env.values, vad_mode: "silero" });
          } catch {
            const env = await tsActivityEnvelope(f);
            tracks.push({ file: f, ok: true, fps: env.fps, envelope_db: env.values, vad_mode: "rms" });
          }
        }
        envResult = { ok: true, mode: "envelope", tracks };
      } catch (err2) {
        return { ok: false as const, error: `Audio analysis failed: ${(err2 as Error).message}` };
      }
    }

    // envelope_db is ALWAYS 0–1 activity (see analyze_audio.py contract);
    // vad_mode says what produced it and fps can differ per file.
    interface FileEnv { values: number[]; fps: number; mode: "silero" | "rms" }
    const envByFile = new Map<string, FileEnv>();
    for (let i = 0; i < distinctFiles.length; i++) {
      const tr = envResult.tracks?.[i];
      if (tr?.ok && Array.isArray(tr.envelope_db) && tr.envelope_db.length > 0) {
        envByFile.set(distinctFiles[i], {
          values: tr.envelope_db,
          fps: tr.fps || 31.25,
          mode: tr.vad_mode === "silero" ? "silero" : "rms",
        });
      }
    }
    if (envByFile.size === 0) {
      return { ok: false as const, error: "Could not decode audio envelopes — check source files." };
    }
    const vadModes = new Set([...envByFile.values()].map((e) => e.mode));
    const vadMode = vadModes.size > 1 ? "mixed" : [...vadModes][0];

    // Per-mode activity threshold (values are 0–1 in both modes):
    //   silero → 0.5 (50% speech confidence)
    //   rms    → the user's dB threshold mapped onto the proxy scale (dB+60)/60
    const rmsActivityThresh = (Math.min(0, Math.max(-60, silThresh)) + 60) / 60;
    const threshFor = (mode: "silero" | "rms") => (mode === "silero" ? 0.5 : rmsActivityThresh);

    // Uniform state-machine grid over the SEQUENCE timeline. Fixed rate,
    // independent of each file's envelope rate — per-file fps differences
    // (silero ~31.25 vs rms ~43) are absorbed by the sampling below.
    const STATE_FPS = MULTICAM_STATE_FPS;
    const seqDur = sequenceDuration(srcSeq);
    const totalFrames = Math.floor(seqDur * STATE_FPS);
    if (totalFrames <= 0) {
      return { ok: false as const, error: "Sequence is empty — nothing to edit." };
    }

    // Sample each camera's activity at every grid frame, mapping sequence
    // time → source time through the covering clip's position, trim, and
    // speed. Multiple mics take the max. Gaps read as silence.
    const activity: Float32Array[] = [];
    const isOn: Uint8Array[] = [];
    for (let i = 0; i < cameras.length; i++) {
      const act = new Float32Array(totalFrames);
      const on = new Uint8Array(totalFrames);
      const lists = camTrackClips[i];
      const ptrs = lists.map(() => 0);
      for (let f = 0; f < totalFrames; f++) {
        const t = f / STATE_FPS;
        for (let li = 0; li < lists.length; li++) {
          const clips = lists[li];
          while (ptrs[li] < clips.length && clipTimelineEnd(clips[ptrs[li]]) <= t) ptrs[li]++;
          const clip = clips[ptrs[li]];
          if (!clip || clip.start_time_seconds > t) continue;
          const env = envByFile.get(fileForSource.get(clip.source_path)!);
          if (!env) continue;
          const srcT = clip.trim_start_seconds + (t - clip.start_time_seconds) * (clip.speed || 1.0);
          const v = env.values[Math.floor(srcT * env.fps)];
          if (v == null) continue;
          if (v > act[f]) act[f] = v;
          if (v > threshFor(env.mode)) on[f] = 1;
        }
      }
      activity.push(act);
      isOn.push(on);
    }

    // Camera roles. Solo cameras compete on loudness; wide/duo/trio never
    // win by loudness — they're cut to by the rules below.
    const wideIndices = new Set(
      cameras.map((c, i) => (c.type === "wide" ? i : -1)).filter((i) => i >= 0)
    );
    const duoIdx = cameras.findIndex((c) => c.type === "duo");
    const trioIdx = cameras.findIndex((c) => c.type === "trio");
    const speakerIndices = cameras
      .map((_, i) => i)
      .filter((i) => !wideIndices.has(i) && cameras[i].type !== "duo" &&
        cameras[i].type !== "trio" && camAudioClips[i].length > 0);
    if (speakerIndices.length === 0) {
      return { ok: false as const, error: "No solo cameras with audio clips — nothing to switch between." };
    }
    const silenceCam = wideIndices.size > 0 ? [...wideIndices][0] : -1;

    // ANGLE GROUPS (AutoPod parity): solo cameras that share the same mic(s)
    // are different ANGLES of the same speaker. Dominance is decided per
    // speaker; which angle shows rotates on each return to that speaker
    // (and on --max-shot, below) so long conversations stay visually varied.
    interface AngleGroup { cams: number[]; nextAngle: number }
    const groupByKey = new Map<string, AngleGroup>();
    const groupOfCam = new Map<number, AngleGroup>();
    for (const i of speakerIndices) {
      const key = audioTracksOf(cameras[i]).slice().sort().join("+");
      let g = groupByKey.get(key);
      if (!g) { g = { cams: [], nextAngle: 0 }; groupByKey.set(key, g); }
      g.cams.push(i);
      groupOfCam.set(i, g);
    }
    const angleGroups = [...groupByKey.values()];

    const cooldownFrames = Math.max(1, Math.round(cooldownSec * STATE_FPS));
    const minSpeechFrames = Math.max(1, Math.round(minSpeechSec * STATE_FPS));
    // Sustained silence cuts to wide only after a longer patience than a
    // speaker switch — brief pauses should not leave the current speaker.
    const silenceHoldFrames = Math.max(minSpeechFrames, Math.round(1.0 * STATE_FPS));
    // Wide-ratio enforcement uses a CONSTANT slack. The old cooldown/f
    // formula shrank toward zero as the timeline grew, making long
    // recordings ping-pong wide↔speaker on a fixed cadence.
    const WIDE_SLACK = 0.05;
    const wideWarmupFrames = Math.round(10 * STATE_FPS);
    // A forced wide holds for a full shot so ratio catch-up comes as a few
    // deliberate cutaways, not many slivers.
    const wideHoldFrames = Math.max(cooldownFrames, Math.round(2.0 * STATE_FPS));

    let currentCam = speakerIndices[0];
    let cooldownLeft = 0;
    let pendingTarget = -1;   // camera we want to switch to
    let pendingFrames = 0;    // consecutive frames it has been desired
    let pendingStart = 0;     // frame where it first became desired (backdating)
    let wideShotFrames = 0;

    const runs: { camIdx: number; startFrame: number; endFrame: number }[] = [];
    let runStart = 0;

    // Commit a switch at frame f. If backdateTo lands inside the current
    // run, the cut is placed there — at speech ONSET rather than at
    // hysteresis confirmation — so the new speaker's first words are on
    // their own camera instead of the old one.
    const switchTo = (cam: number, f: number, backdateTo = -1) => {
      const cut = backdateTo > runStart && backdateTo < f ? backdateTo : f;
      if (cut > runStart) runs.push({ camIdx: currentCam, startFrame: runStart, endFrame: cut });
      // Reattribute the backdated frames' wide accounting to the new camera.
      const moved = f - cut;
      if (moved > 0) {
        if (wideIndices.has(currentCam) && !wideIndices.has(cam)) wideShotFrames -= moved;
        if (!wideIndices.has(currentCam) && wideIndices.has(cam)) wideShotFrames += moved;
      }
      runStart = cut;
      currentCam = cam;
      cooldownLeft = cooldownFrames;
      pendingTarget = -1;
      pendingFrames = 0;
    };

    const maxShotFrames = maxShotSec > 0 ? Math.max(1, Math.round(maxShotSec * STATE_FPS)) : 0;

    // The opening shot counts as that speaker's first angle use, so their
    // first RETURN already rotates to the next angle.
    const startGroup = groupOfCam.get(currentCam);
    if (startGroup) startGroup.nextAngle = startGroup.cams.indexOf(currentCam) + 1;

    for (let f = 0; f < totalFrames; f++) {
      // Decrement FIRST so a switch at frame f blocks until f+cooldownFrames
      // (the old post-loop decrement made the effective cooldown one frame short).
      if (cooldownLeft > 0) cooldownLeft--;

      // Who's talking? Loudest active SPEAKER (angle group) + count of
      // simultaneously active speakers. Angles of one speaker share mics,
      // so any group member's activity represents the speaker.
      let bestGroup: AngleGroup | null = null;
      let bestVal = 0;
      let activeCount = 0;
      for (const g of angleGroups) {
        const rep = g.cams[0];
        if (isOn[rep][f]) {
          activeCount++;
          if (activity[rep][f] > bestVal) { bestVal = activity[rep][f]; bestGroup = g; }
        }
      }

      // Desired camera this frame:
      //   3+ simultaneous speakers → trio shot (else duo, else loudest)
      //   2 simultaneous          → duo shot (else trio, else loudest)
      //   one speaker             → their group's CURRENT angle (angles only
      //                             rotate on return or max-shot, never mid-shot)
      //   silence                 → wide if present, else hold current
      let desired: number;
      if (activeCount >= 3 && trioIdx >= 0) desired = trioIdx;
      else if (activeCount >= 2 && (duoIdx >= 0 || trioIdx >= 0)) desired = duoIdx >= 0 ? duoIdx : trioIdx;
      else if (bestGroup) {
        desired = groupOfCam.get(currentCam) === bestGroup
          ? currentCam
          : bestGroup.cams[bestGroup.nextAngle % bestGroup.cams.length];
      } else desired = silenceCam >= 0 ? silenceCam : currentCam;

      // Wide-ratio enforcement overrides conversation flow (immediate, no
      // hysteresis) but respects cooldown and a warmup so the opening of
      // the edit isn't dominated by catch-up cuts.
      const actualRatio = f > 0 ? wideShotFrames / f : 0;
      const curGroup = groupOfCam.get(currentCam);
      if (wideIndices.size > 0 && !wideIndices.has(currentCam) && cooldownLeft === 0 &&
          f >= wideWarmupFrames && (wideRatio - actualRatio) > WIDE_SLACK) {
        switchTo([...wideIndices][0], f);
        cooldownLeft = wideHoldFrames;
      } else if (maxShotFrames > 0 && curGroup && desired === currentCam &&
                 cooldownLeft === 0 && (f - runStart) >= maxShotFrames) {
        // Max-shot: the same speaker has held one shot too long. Rotate to
        // their next angle; with a single angle, take a wide cutaway (the
        // speaker hysteresis brings us back naturally).
        if (curGroup.cams.length > 1) {
          const next = curGroup.cams[(curGroup.cams.indexOf(currentCam) + 1) % curGroup.cams.length];
          switchTo(next, f);
          curGroup.nextAngle = curGroup.cams.indexOf(next) + 1;
        } else if (wideIndices.size > 0) {
          switchTo([...wideIndices][0], f);
        }
      } else if (desired !== currentCam && cooldownLeft === 0) {
        // Hysteresis: the desired camera must persist before we commit.
        // Silence→wide uses the longer patience.
        const needed = bestGroup === null ? silenceHoldFrames : minSpeechFrames;
        if (desired === pendingTarget) {
          pendingFrames++;
          if (pendingFrames >= needed) {
            switchTo(desired, f, pendingStart);
            // Returning to this speaker later shows their NEXT angle.
            const g = groupOfCam.get(desired);
            if (g) g.nextAngle = g.cams.indexOf(desired) + 1;
          }
        } else {
          pendingTarget = desired;
          pendingFrames = 1;
          pendingStart = f;
        }
      } else if (desired === currentCam) {
        pendingTarget = -1;
        pendingFrames = 0;
      }

      if (wideIndices.has(currentCam)) wideShotFrames++;
    }
    runs.push({ camIdx: currentCam, startFrame: runStart, endFrame: totalFrames });

  return {
    ok: true as const,
    runs, totalFrames, vadMode, wideIndices, speakerIndices,
    camAudioClips, camTrackClips, fileForSource, seqDur,
  };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = parseArgs(rest);

  try {
    switch (cmd) {
      case "sequence-create": {
        const ws = a.workspace || fail("--workspace required");
        await ensureWorkspace(ws);
        // Orientation shortcut: --orientation vertical|horizontal|square sets the
        // canvas (1080×1920 / 1920×1080 / 1080×1080). Explicit --width/--height
        // override it. "both" is handled by the caller (create two sequences).
        let width: number, height: number;
        if (a.orientation && a.orientation !== "both") {
          const c = orientationCanvas(a.orientation as Orientation);
          width = Number(a.width) || c.width;
          height = Number(a.height) || c.height;
        } else {
          width = Number(a.width) || fail("--width or --orientation required");
          height = Number(a.height) || fail("--height or --orientation required");
        }
        const seq: Sequence = {
          id: newSeqId(),
          name: a.name || "Untitled",
          description: a.description || "",
          settings: {
            width, height,
            framerate: Number(a.framerate) || fail("--framerate required"),
            sample_rate: Number(a["sample-rate"]) || 48000,
            color_space: a["color-space"] || "bt709",
          },
          clips: [],
        };
        const p = await saveSequence(ws, seq);
        emit({
          ok: true, sequence_id: seq.id, path: p, sequence: seq,
          orientation: orientationOf(seq.settings),
        });
        break;
      }

      case "sequences-list": {
        const ws = a.workspace || fail("--workspace required");
        const seqs = await listSequences(ws);
        emit({
          ok: true,
          sequences: seqs.map((s) => ({
            id: s.id, name: s.name, clips: s.clips.length,
            duration_seconds: Number(sequenceDuration(s).toFixed(3)),
          })),
        });
        break;
      }

      case "sequence-inspect": {
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        // Default is a TOKEN-LEAN brief: one compact line per clip, not the full
        // JSON (transforms, source metadata, etc.). Pass --full only when you
        // genuinely need every field — it can be large on long timelines.
        if (a.full) {
          emit({ ok: true, sequence: seq, duration_seconds: Number(sequenceDuration(seq).toFixed(3)) });
          break;
        }
        const allClips = [...seq.clips]
          .sort((x, y) => x.track.localeCompare(y.track) || x.start_time_seconds - y.start_time_seconds)
          .map((c) => {
            const dur = (c.trim_end_seconds - c.trim_start_seconds) / (c.speed || 1);
            const src = c.source_path.split("/").pop();
            const sc = c.transform ? `x${c.transform.scale.x}` : "";
            return `${c.id} ${c.track} @${c.start_time_seconds}s +${dur.toFixed(2)}s ` +
                   `${src}[${c.trim_start_seconds}-${c.trim_end_seconds}] ${sc}`.trim();
          });
        // Per-track summary (count + span) so a model understands the shape WITHOUT
        // reading every clip line — critical for small local models that choke on a
        // 100+ line dump and loop "the output is truncated".
        const trackSummary: Record<string, { clips: number; from: number; to: number }> = {};
        for (const c of seq.clips) {
          const t = trackSummary[c.track] || { clips: 0, from: Infinity, to: 0 };
          t.clips++; t.from = Math.min(t.from, c.start_time_seconds);
          t.to = Math.max(t.to, clipTimelineEnd(c));
          trackSummary[c.track] = t;
        }
        const tracks = Object.entries(trackSummary)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([t, s]) => `${t}: ${s.clips} clips, ${s.from.toFixed(1)}–${s.to.toFixed(1)}s`);

        // HARD CAP the per-clip list. A local model's context is small; dumping 100+
        // clip lines overflows it and it never sees the categories/markers below.
        // --summary (or a large sequence) returns the structure WITHOUT every clip.
        const CLIP_CAP = a.summary ? 0 : 60;
        const clips = allClips.length > CLIP_CAP ? allClips.slice(0, CLIP_CAP) : allClips;
        const clipsTruncated = allClips.length > clips.length;

        emit({
          ok: true,
          name: seq.name,
          settings: `${seq.settings.width}x${seq.settings.height}@${seq.settings.framerate}`,
          duration_seconds: Number(sequenceDuration(seq).toFixed(3)),
          clip_count: seq.clips.length,
          tracks, // compact per-track summary (always small)
          // Persisted categorization — read this back on follow-ups INSTEAD of
          // re-surveying the footage. If present, the structure is already decided.
          ...(seq.categories?.length ? { categories: seq.categories } : {}),
          ...(seq.markers?.length ? { markers: seq.markers.map((m) => `${m.time_seconds}s ${m.color} "${m.label}"`) } : {}),
          ...(clips.length ? { clips } : {}), // omitted entirely in --summary mode
          ...(clipsTruncated ? { clips_truncated: `showing ${clips.length} of ${allClips.length} clips — use the categories/markers/tracks above for structure; pass --summary for structure-only, or --full for everything.` } : {}),
        });
        break;
      }

      case "sequence-categories-set": {
        // Persist the categorization structure on the sequence so follow-up edits
        // ("include more", "rebuild") reuse it instead of re-scanning all the footage.
        //   --workspace W --sequence-id ID
        //   --categories '[{"name":"Venue","color":"green","start_seconds":0,"end_seconds":24,"sources":["video/C207.mp4"]}, ...]'
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const cats = (() => {
          try { return JSON.parse(a.categories || "[]"); } catch { return fail("--categories must be valid JSON"); }
        })();
        if (!Array.isArray(cats) || !cats.length) fail("--categories must be a non-empty JSON array");
        seq.categories = cats.map((c: any) => ({
          name: String(c.name || "").trim() || "Section",
          color: typeof c.color === "string" ? c.color : undefined,
          start_seconds: typeof c.start_seconds === "number" ? c.start_seconds : undefined,
          end_seconds: typeof c.end_seconds === "number" ? c.end_seconds : undefined,
          sources: Array.isArray(c.sources) ? c.sources.filter((s: any) => typeof s === "string") : undefined,
          note: typeof c.note === "string" ? c.note : undefined,
        }));
        await saveSequence(ws, seq);
        emit({ ok: true, categories: seq.categories });
        break;
      }

      case "media-info": {
        const filesRaw: string[] = a.files || fail("--files required");
        const ws = a.workspace || "default";
        
        const files: string[] = [];
        for (const fRaw of filesRaw) {
          if (path.isAbsolute(fRaw)) {
            files.push(fRaw);
            continue;
          }
          let resolved = path.join(workspaceDir(ws), fRaw);
          let exists = false;
          try {
            await fs.access(resolved);
            exists = true;
          } catch {}
          
          if (!exists) {
            const candidates = [
              path.join(workspaceDir(ws), "source", "video", fRaw),
              path.join(workspaceDir(ws), "source", "audio", fRaw),
              path.join(workspaceDir(ws), "source", "images", fRaw),
              path.join(workspaceDir(ws), "source", fRaw),
            ];
            for (const cand of candidates) {
              try {
                await fs.access(cand);
                resolved = cand;
                exists = true;
                break;
              } catch {}
            }
          }
          files.push(resolved);
        }

        // Probe with BOUNDED CONCURRENCY (not fully serial, not an explosion) and
        // dedupe — probing 350 files off an SD card serially could take an hour.
        // Concurrency 4 keeps the SD card from thrashing while staying responsive.
        const unique = [...new Set(files)];
        const CONCURRENCY = 4;
        const byFile = new Map<string, any>();
        let idx = 0;
        async function worker() {
          while (idx < unique.length) {
            const f = unique[idx++];
            try {
              const p = await probeMedia(f);
              // Explicit orientation + a sideways flag so the agent reasons about
              // rotated footage. width/height from probeMedia are already in display
              // orientation (rotation applied), so this reflects how it will appear.
              const orient = p.width && p.height
                ? (p.width > p.height ? "horizontal" : p.height > p.width ? "vertical" : "square")
                : undefined;
              byFile.set(f, {
                file: f,
                ...p,
                orientation: orient,
                ...(p.rotation ? { sideways: true, note: `Source has a ${p.rotation}° rotation flag; display dims ${p.width}x${p.height} already account for it.` } : {}),
              });
            }
            catch (e) { byFile.set(f, { file: f, error: (e as Error).message }); }
          }
        }
        await Promise.all(Array.from({ length: CONCURRENCY }, worker));
        emit({ ok: true, media: files.map((f) => byFile.get(f)) });
        break;
      }

      case "sequence-clips-add": {
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const ops = JSON.parse(a.operations || fail("--operations required (JSON array)"));
        const { created, warnings } = await addClips(ws, seq, ops);
        await saveSequence(ws, seq);
        // Lean by default: return just the new clip ids + a one-line summary each,
        // not full clip JSON. The agent can sequence-inspect if it needs detail.
        emit({
          ok: true,
          created_ids: created.map((c) => c.id),
          created: created.map((c) =>
            `${c.id} ${c.track} @${c.start_time_seconds}s ${c.source_path.split("/").pop()}`),
          warnings,
          total_clips: seq.clips.length,
        });
        break;
      }

      case "sequence-clips-update": {
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const ops = JSON.parse(a.operations || fail("--operations required (JSON array)"));
        const res = updateClips(seq, ops, !!a["no-ripple"]);
        const droppedTr = cascadeTransitions(seq); // clips moved → drop orphaned transitions
        await saveSequence(ws, seq);
        emit({ ok: true, ...res, ...(droppedTr.length ? { dropped_transitions: droppedTr } : {}) });
        break;
      }

      case "sequence-clips-remove": {
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const ids: string[] = a.ids || fail("--ids required");
        const res = removeClips(seq, ids, !!a["no-ripple"]);
        const droppedTr = cascadeTransitions(seq); // removed clips → drop orphaned transitions
        await saveSequence(ws, seq);
        emit({ ok: true, ...res, ...(droppedTr.length ? { dropped_transitions: droppedTr } : {}) });
        break;
      }

      case "sequence-captions-add": {
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const ops = JSON.parse(a.operations || fail("--operations required (JSON array)"));
        const res = addCaptions(seq, ops);
        await saveSequence(ws, seq);
        emit({ ok: true, created: res.created.map((c) => c.id), captions: res.created, warnings: res.warnings });
        break;
      }

      case "sequence-captions-remove": {
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const ids: string[] = a.ids || fail("--ids required");
        const res = removeCaptions(seq, ids);
        await saveSequence(ws, seq);
        emit({ ok: true, ...res });
        break;
      }

      case "sequence-captions-list": {
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        emit({ ok: true, captions: seq.captions || [] });
        break;
      }

      case "sequence-transitions-add": {
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const ops = JSON.parse(a.operations || fail("--operations required (JSON array)"));
        const res = addTransitions(seq, ops);
        await saveSequence(ws, seq);
        emit({ ok: true, created: res.created.map((t) => t.id), transitions: res.created, warnings: res.warnings });
        break;
      }

      case "sequence-transitions-remove": {
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const ids: string[] = a.ids || fail("--ids required");
        const res = removeTransitions(seq, ids);
        await saveSequence(ws, seq);
        emit({ ok: true, ...res });
        break;
      }

      case "sequence-transitions-list": {
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        emit({ ok: true, transitions: seq.transitions || [] });
        break;
      }

      case "sequence-markers-add": {
        // Add one or more colored label markers to the sequence timeline.
        // Markers appear in Premiere's timeline and Program Monitor as colored dots
        // with text, useful for annotating content sections, shot groups, subjects.
        //
        //   --workspace W --sequence-id ID
        //   --markers '[{"time_seconds":0,"label":"Opening","color":"green"}, ...]'
        //
        // color: red | orange | yellow | green | cyan | blue | violet | white
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const raw: SequenceMarker[] = (() => {
          try { return JSON.parse(a.markers || "[]"); } catch { fail("--markers must be valid JSON"); }
        })();
        if (!raw.length) fail("--markers must contain at least one marker");
        const valid: SequenceMarker[] = raw.map((m, i) => {
          if (typeof m.time_seconds !== "number") fail(`marker[${i}]: time_seconds required`);
          if (!m.label?.trim()) fail(`marker[${i}]: label required`);
          const id = m.id || `m-${Date.now()}-${i}`;
          const color: MarkerColor = (["red","orange","yellow","green","cyan","blue","violet","white"].includes(m.color || "")) ? m.color! : "green";
          return { id, time_seconds: m.time_seconds, duration_seconds: m.duration_seconds ?? 0, label: m.label.trim(), color };
        });
        seq.markers = [...(seq.markers || []), ...valid];
        await saveSequence(ws, seq);
        emit({ ok: true, added: valid.length, markers: seq.markers });
        break;
      }

      case "sequence-text-labels-add": {
        // Add VISIBLE on-timeline text labels: renders each section title to a PNG
        // and places it as an image clip on a track above the footage (default V2),
        // so the text shows directly on the timeline (unlike ruler markers, which
        // are just chevrons). Pair with sequence-markers-add for ruler navigation.
        //
        //   --workspace W --sequence-id ID --track V2
        //   --labels '[{"text":"OPENING — Venue","color":"green","start_seconds":0,"end_seconds":9}, ...]'
        //
        // Each label spans [start_seconds, end_seconds) on the chosen track. color
        // matches the marker palette. The image fills the canvas with a colored pill
        // holding the text in the lower-left corner.
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const track = (a.track as string) || "V2";
        const labels: any[] = (() => {
          try { return JSON.parse(a.labels || "[]"); } catch { return fail("--labels must be valid JSON"); }
        })();
        if (!labels.length) fail("--labels must contain at least one label");
        const W = seq.settings.width, H = seq.settings.height;
        const ops: any[] = [];
        for (let i = 0; i < labels.length; i++) {
          const L = labels[i];
          const text = (L.text ?? L.label)?.toString().trim();
          if (!text) fail(`label[${i}]: text required`);
          const start = Number(L.start_seconds ?? L.start ?? L.time_seconds ?? 0);
          const end = Number(L.end_seconds ?? L.end ?? (start + 3));
          if (!(end > start)) fail(`label[${i}]: end_seconds must be > start_seconds`);
          const png = await renderLabelPng(ws, { text, color: L.color, width: W, height: H });
          // Image clip: trim 0..(end-start), positioned at start, on the overlay track.
          ops.push({
            track,
            source: png,
            position_seconds: start,
            trim_start_seconds: 0,
            trim_end_seconds: end - start,
            video_only: true,
            label_color: L.color,
          });
        }
        const { created, warnings } = await addClips(ws, seq, ops, true);
        await saveSequence(ws, seq);
        emit({
          ok: true,
          added: created.length,
          track,
          labels: created.map((c) => `${c.id} ${c.track} @${c.start_time_seconds}s`),
          warnings,
        });
        break;
      }

      case "sequence-kenburns-add": {
        // Apply a Ken Burns move (slow push-in / pull-out) to existing video clips by
        // writing animated Motion keyframes. Alternates direction clip-to-clip and
        // adds a fresh push/pull every --segment seconds so long clips keep drifting.
        //
        //   --workspace W --sequence-id ID
        //   [--track V1]            only clips on this track (default: all video clips)
        //   [--ids '["c1","c2"]']   only these clip ids (overrides --track)
        //   [--segment 15]          seconds per push/pull segment (default 15)
        //   [--min 1.0] [--max 1.2] pulled-out / pushed-in scale multipliers (100→120)
        //   [--direction in|out|alternate]  first move (default alternate across clips)
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const seg = a.segment ? Number(a.segment) : 15;
        const min = a.min ? Number(a.min) : 1.0;
        const max = a.max ? Number(a.max) : 1.2;
        const dirMode = (a.direction as string) || "alternate";
        const onlyIds: string[] | null = (() => {
          if (!a.ids) return null;
          try { return Array.isArray(a.ids) ? a.ids : JSON.parse(a.ids); } catch { return null; }
        })();
        const targets = seq.clips.filter((c) => {
          if (c.clip_type === "audio") return false;
          if (onlyIds) return onlyIds.includes(c.id);
          if (a.track) return c.track === a.track;
          return isVideoTrack(c.track);
        });
        if (!targets.length) fail("No matching video clips to apply Ken Burns to.");
        let applied = 0;
        targets.forEach((c, i) => {
          const startDir: "in" | "out" =
            dirMode === "in" ? "in" : dirMode === "out" ? "out" : directionForIndex(i);
          const kfs = kenBurnsKeyframes(clipTimelineDuration(c), {
            segmentSeconds: seg, minScale: min, maxScale: max, startDirection: startDir,
          });
          if (kfs.length >= 2) { c.transform_keyframes = kfs; applied++; }
        });
        await saveSequence(ws, seq);
        emit({
          ok: true,
          applied,
          segment_seconds: seg,
          range: `${Math.round(min * 100)}→${Math.round(max * 100)}`,
          note: `Ken Burns applied to ${applied} clip(s). Exports as animated Motion scale keyframes in the .prproj.`,
        });
        break;
      }

      case "sequence-markers-remove": {
        // Remove markers by id.  --workspace W --sequence-id ID --ids '["m-1","m-2"]'
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const ids: string[] = (() => { try { return JSON.parse(a.ids || "[]"); } catch { return []; } })();
        const before = (seq.markers || []).length;
        seq.markers = (seq.markers || []).filter((m) => !ids.includes(m.id));
        await saveSequence(ws, seq);
        emit({ ok: true, removed: before - seq.markers.length, markers: seq.markers });
        break;
      }

      case "sequence-markers-list": {
        // List all markers on a sequence.  --workspace W --sequence-id ID
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        emit({ ok: true, markers: seq.markers || [] });
        break;
      }

      // NOTE: Timeline video rendering was removed by design — the finished video
      // is rendered in Premiere from the exported .prproj, not by JCut. JCut builds
      // and verifies the timeline structurally and hands off via sequence-export-
      // premiere. (Source-clip frame extraction for CONTENT understanding lives on
      // in `media-frames`/`media-frames-batch` — that's not timeline rendering.)

      case "source-add": {
        // Symlink source media into the workspace (never copy — originals stay untouched).
        // --files <abs paths...> AND/OR --folder <dir> (recursively adds every
        // media file found in the folder). Returns workspace-relative paths.
        const ws = a.workspace || fail("--workspace required");
        // Media + documents. Documents (scripts, briefs, shot lists, treatments)
        // give the agent context for a more complete first draft. They live under
        // source/documents/ and are read as text by the agent (see classify below).
        const MEDIA_RE = /\.(mp4|mov|mkv|webm|avi|m4v|mp3|wav|aac|flac|m4a|png|jpg|jpeg|gif|webp|bmp|tiff|md|markdown|txt|rtf|doc|docx|pdf)$/i;
        const DOC_RE = /\.(md|markdown|txt|rtf|doc|docx|pdf)$/i;
        let files: string[] = Array.isArray(a.files) ? [...a.files] : [];
        if (a.folder) {
          // Walk the folder (one level deep + immediate subfolders) for media.
          const root = a.folder as string;
          const walk = async (dir: string, depth: number): Promise<void> => {
            let entries;
            try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
            for (const e of entries) {
              // Skip macOS AppleDouble metadata files (._name) and dotfiles — they
              // are NOT real media; importing them creates phantom "clips" that
              // fail to probe and confuse the agent.
              if (e.name.startsWith("._") || e.name.startsWith(".")) continue;
              const full = path.join(dir, e.name);
              if (e.isDirectory() && depth > 0) await walk(full, depth - 1);
              else if (e.isFile() && MEDIA_RE.test(e.name)) files.push(full);
            }
          };
          await walk(root, 3); // up to 3 levels deep
        }
        if (files.length === 0) fail("--files or --folder (with media inside) required");
        await ensureWorkspace(ws);
        const added: { name: string; rel: string; type: string }[] = [];
        const errors: string[] = [];
        let bytesLinked = 0; // bytes that would have been copied but weren't
        for (const f of files) {
          try {
            const base = path.basename(f);
            // Skip macOS AppleDouble / dotfiles — they aren't real media.
            if (base.startsWith("._") || base.startsWith(".")) continue;
            const stat = await fs.stat(f);
            if (!stat.isFile()) { errors.push(`${f}: not a file`); continue; }
            const type = base.match(/\.(mp4|mov|mkv|webm|avi|m4v)$/i) ? "video"
              : base.match(/\.(mp3|wav|aac|flac|m4a)$/i) ? "audio"
              : base.match(/\.(png|jpg|jpeg|gif|webp|bmp|tiff)$/i) ? "images"
              : DOC_RE.test(base) ? "documents" : "video";
            const destDir = path.join(workspaceDir(ws), "source", type);
            await fs.mkdir(destDir, { recursive: true });
            const dest = path.join(destDir, base);
            try { await fs.unlink(dest); } catch { /* ok if absent */ }
            // SYMLINK ONLY — never copy. We do not fall back to copyFile under any
            // circumstance; a failed symlink is reported as an error, never worked
            // around by duplicating the (potentially multi-GB) media.
            await fs.symlink(path.resolve(f), dest);
            // Verify it really is a symlink, not an accidental copy.
            const ls = await fs.lstat(dest);
            if (!ls.isSymbolicLink()) {
              await fs.rm(dest, { force: true });
              errors.push(`${f}: refused — link did not materialize as a symlink (no copy made)`);
              continue;
            }
            bytesLinked += stat.size;
            // Binary documents (rtf/doc/docx/pdf) aren't plain text, so the agent
            // can't Read them directly. Extract a plain-text sidecar (<name>.txt)
            // next to the symlink at add time using built-in tools, so a clean
            // transcript of the brief/script is always available regardless of the
            // agent's parsing ability. .md/.markdown/.txt are already text — no-op.
            if (/\.(rtf|doc|docx|pdf)$/i.test(base)) {
              try {
                const txt = await extractDocText(path.resolve(f));
                if (txt != null) await fs.writeFile(dest + ".txt", txt, "utf8");
                else errors.push(`${base}: linked, but couldn't extract text (no extractor available) — agent may not be able to read it`);
              } catch (e) {
                errors.push(`${base}: linked, but text extraction failed (${(e as Error).message})`);
              }
            }
            added.push({ name: base, rel: path.join("source", type, base), type });
          } catch (e) {
            errors.push(`${f}: ${(e as Error).message}`);
          }
        }
        emit({
          ok: true, added, errors,
          storage: {
            mode: "symlink-only",
            bytes_linked_not_copied: bytesLinked,
            note: "Originals are referenced in place. No video data was duplicated.",
          },
        });
        break;
      }

      case "media-frames": {
        // Extract representative frames from a clip so the agent can SEE what it
        // is. Returns frame paths to Read. --workspace W --source <path> [--count 2]
        // Count is capped at 3 — each 4K frame the agent Reads is a heavy vision
        // token cost, and reading frames from many clips bloats context and slows
        // every later turn (the "stuck after sampling lots of footage" problem).
        const ws = a.workspace || fail("--workspace required");
        const source = a.source || fail("--source required");
        const count = Math.min(3, Math.max(1, Number(a.count) || 2));
        const { frames, durationSeconds, width, height, orientation } = await extractFrames(ws, source, count);
        emit({
          ok: true, source, duration_seconds: Number(durationSeconds.toFixed(2)),
          dimensions: width && height ? `${width}x${height}` : "unknown",
          orientation, // TRUST THIS, not the frame's appearance
          frames,
        });
        break;
      }

      case "media-frames-batch": {
        // Extract ONE representative frame from MANY clips in a single call — so the
        // agent surveys footage in one tool round-trip instead of N (each round-trip
        // costs a slow 60-90s model turn). --workspace W --sources a,b,c [--count 1].
        // Caps total clips to keep vision-token load (and SD-card reads) bounded.
        const ws = a.workspace || fail("--workspace required");
        const list = String(a.sources || fail("--sources required (comma-separated)"))
          .split(",").map((s: string) => s.trim()).filter(Boolean);
        const MAX_CLIPS = 12; // hard cap — survey a spread, don't read the whole shoot
        const sources = list.slice(0, MAX_CLIPS);
        const per = Math.min(2, Math.max(1, Number(a.count) || 1));
        // Bounded concurrency so the SD card isn't thrashed by N parallel ffmpegs.
        const out: any[] = [];
        const CONC = 3; let i = 0;
        async function w() {
          while (i < sources.length) {
            const src = sources[i++];
            try {
              const { frames, durationSeconds, width, height, orientation } = await extractFrames(ws, src, per);
              out.push({
                source: src, duration_seconds: Number(durationSeconds.toFixed(2)),
                dimensions: width && height ? `${width}x${height}` : "unknown",
                orientation, frames,
              });
            } catch (e) { out.push({ source: src, error: (e as Error).message }); }
          }
        }
        await Promise.all(Array.from({ length: CONC }, w));
        emit({
          ok: true, clips: out,
          ...(list.length > MAX_CLIPS ? { note: `Surveyed ${MAX_CLIPS} of ${list.length} — sample a spread, not all.` } : {}),
        });
        break;
      }

      case "content-set": {
        // The agent records what a clip IS after viewing its frames.
        // --workspace W --source <path> --description "..." [--shot-type] [--subjects a,b]
        const ws = a.workspace || fail("--workspace required");
        await saveContent(ws, {
          source: a.source || fail("--source required"),
          description: a.description || fail("--description required"),
          shot_type: a["shot-type"] || undefined,
          subjects: a.subjects ? String(a.subjects).split(",").map((s: string) => s.trim()) : undefined,
          updated: Date.now(),
        });
        emit({ ok: true, source: a.source });
        break;
      }

      case "content-list": {
        // Read cached clip descriptions ("what each clip is"). Lean output.
        const ws = a.workspace || fail("--workspace required");
        const all = await loadContent(ws);
        const entries = Object.values(all).map((c: ClipContent) =>
          `${c.source.split("/").pop()}: ${c.description}${c.shot_type ? ` [${c.shot_type}]` : ""}`);
        emit({ ok: true, count: entries.length, content: entries });
        break;
      }

      case "sources-list": {
        // List all symlinked source media in the workspace. Each entry also
        // reports the ORIGINAL folder it was imported from (resolved via the
        // symlink target) so the GUI can show a Premiere-style folder bin view.
        const ws = a.workspace || fail("--workspace required");
        const root = path.join(workspaceDir(ws), "source");
        const out: { name: string; rel: string; type: string; origDir: string | null; origPath: string | null; online: boolean }[] = [];
        for (const type of ["video", "audio", "images", "documents"]) {
          const dir = path.join(root, type);
          try {
            const names = await fs.readdir(dir);
            // Sidecar set: an extracted-text "<doc>.txt" that sits beside a binary
            // document symlink of the same stem is an implementation detail — don't
            // list it as its own source. A standalone user .txt has no such sibling
            // and is kept. Built up-front so listing order doesn't matter.
            const sidecars = new Set(
              names.filter((f) => f.endsWith(".txt") &&
                names.some((g) => g !== f && g + ".txt" === f)),
            );
            for (const f of names) {
              // Skip macOS AppleDouble metadata (._name) and dotfiles — they're not
              // real media; listing them makes the agent pick phantom "clips" that
              // fail to probe (the "._ prefix" confusion).
              if (f.startsWith("._") || f.startsWith(".")) continue;
              if (sidecars.has(f)) continue;
              const symlinkPath = path.join(dir, f);
              let origPath: string | null = null;
              try { origPath = await fs.readlink(symlinkPath); } catch { /* not a symlink */ }
              let online = false;
              if (origPath) {
                try { await fs.stat(symlinkPath); online = true; } catch { /* broken link = offline */ }
              }
              out.push({
                name: f,
                rel: path.join("source", type, f),
                type,
                origPath,
                origDir: origPath ? path.dirname(origPath) : null,
                online,
              });
            }
          } catch { /* dir may not exist */ }
        }
        // --full returns the rich per-clip view (orig paths/folders) for the GUI's
        // bin display. DEFAULT is TOKEN-LEAN: names grouped by type + counts, so a
        // 162-clip shoot is ~2KB not ~56KB (huge — it re-enters context each turn
        // and was a major cause of slow/stalling model turns).
        if (a.full) { emit({ ok: true, sources: out }); break; }
        const byType: Record<string, string[]> = {};
        for (const s of out) (byType[s.type] ||= []).push(s.name);
        emit({
          ok: true,
          counts: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, v.length])),
          total: out.length,
          video: byType.video || [],
          audio: byType.audio || [],
          images: byType.images || [],
          // Scripts / briefs / shot lists the user attached. Read them (with the
          // Read tool, by their source/documents/... path) before drafting — they
          // tell you intent the footage alone can't. Binary docs have a sibling
          // "<name>.txt" extraction next to them; read that if the original won't.
          documents: byType.documents || [],
        });
        break;
      }

      case "source-localize": {
        // Copy source footage from slow media (SD card / external drive) onto the
        // internal drive, replacing the symlink with a real local copy. Makes every
        // later probe/frame/render dramatically faster. --workspace W [--rel paths…]
        // (default: all video sources). Skips ones already local. Reports bytes copied.
        const ws = a.workspace || fail("--workspace required");
        const srcRoot = path.join(workspaceDir(ws), "source");
        // Determine the set of symlinks to localize.
        const targets: string[] = [];
        if (a.rel) {
          const rels = Array.isArray(a.rel) ? a.rel : [a.rel];
          targets.push(...rels.map((r) => path.join(workspaceDir(ws), r)));
        } else {
          for (const type of ["video", "audio", "images", "documents"]) {
            const dir = path.join(srcRoot, type);
            try { for (const f of await fs.readdir(dir)) targets.push(path.join(dir, f)); } catch { /* */ }
          }
        }
        const localized: string[] = [];
        const skipped: string[] = [];
        const errors: string[] = [];
        let bytes = 0;
        for (const link of targets) {
          try {
            const st = await fs.lstat(link);
            if (!st.isSymbolicLink()) { skipped.push(path.basename(link) + " (already local)"); continue; }
            const origin = await fs.readlink(link);
            const realOrigin = path.isAbsolute(origin) ? origin : path.resolve(path.dirname(link), origin);
            const size = (await fs.stat(realOrigin)).size;
            const tmp = link + ".localizing";
            await fs.copyFile(realOrigin, tmp); // copy beside the link
            await fs.unlink(link);              // remove the symlink
            await fs.rename(tmp, link);         // put the real file in its place
            bytes += size; localized.push(path.basename(link));
          } catch (e) {
            errors.push(`${path.basename(link)}: ${(e as Error).message}`);
          }
        }
        emit({
          ok: true, localized_count: localized.length, skipped_count: skipped.length,
          gb_copied: Number((bytes / 1e9).toFixed(2)), errors,
          note: "Footage copied to the internal drive — edits will be much faster now.",
        });
        break;
      }

      case "source-remove": {
        // Remove one or more sources from the workspace queue. Only the symlink
        // is deleted — the user's original media is NEVER touched. --rel <paths…>
        // are workspace-relative (e.g. "source/video/clip.mp4"), as returned by
        // sources-list.
        const ws = a.workspace || fail("--workspace required");
        const rels: string[] = Array.isArray(a.rel) ? a.rel : (a.rel ? [a.rel] : []);
        if (!rels.length) fail("--rel <workspace-relative path(s)> required");
        const removed: string[] = [];
        const errors: string[] = [];
        const base = workspaceDir(ws);
        for (const rel of rels) {
          // Guard against path traversal: the resolved target must stay under
          // this workspace's source/ directory.
          const target = path.resolve(base, rel);
          const srcRoot = path.join(base, "source");
          if (!target.startsWith(srcRoot + path.sep)) { errors.push(`${rel}: outside source/`); continue; }
          try {
            const ls = await fs.lstat(target);
            if (!ls.isSymbolicLink()) { errors.push(`${rel}: not a managed symlink — refusing to delete`); continue; }
            await fs.rm(target, { force: true });
            removed.push(rel);
          } catch (e) { errors.push(`${rel}: ${(e as Error).message}`); }
        }
        emit({ ok: true, removed, errors, note: "Symlinks removed. Original media untouched." });
        break;
      }

      case "source-relink": {
        // Relink an offline source to a new file path. Replaces the broken
        // symlink with a new one pointing at the user-selected file.
        // --workspace W --rel <workspace-relative path> --new-path <absolute path>
        const ws = a.workspace || fail("--workspace required");
        const rel: string = a.rel || fail("--rel required");
        const newPath: string = a["new-path"] || fail("--new-path required");
        const base = workspaceDir(ws);
        const target = path.resolve(base, rel);
        const srcRoot = path.join(base, "source");
        if (!target.startsWith(srcRoot + path.sep)) fail("--rel is outside source/");
        // Verify the new path exists.
        try { await fs.stat(newPath); } catch { fail(`New path not found: ${newPath}`); }
        // Replace symlink atomically: remove old, create new.
        const ls = await fs.lstat(target);
        if (!ls.isSymbolicLink()) fail(`${rel}: not a managed symlink`);
        await fs.rm(target, { force: true });
        await fs.symlink(path.resolve(newPath), target);

        // HEAL THE SEQUENCES. Clips added while this source was offline have
        // frozen placeholder metadata (source_width/height/fps = undefined,
        // a fabricated source_duration). Relinking the symlink alone leaves the
        // timeline broken — reframe skips undefined-dim clips and render scaling
        // is wrong. So we re-probe the now-online file and patch every clip that
        // references this source across all sequences in the workspace.
        let healedClips = 0;
        const healedSequences: string[] = [];
        try {
          const probe = await probeMedia(path.resolve(newPath));
          const seqs = await listSequences(ws);
          for (const seq of seqs) {
            let touched = false;
            for (const c of seq.clips) {
              // Match by the workspace-relative source path the clip stored.
              const clipAbs = path.isAbsolute(c.source_path)
                ? c.source_path
                : path.resolve(base, c.source_path);
              if (clipAbs !== target) continue;
              if (c.source_width == null && probe.width != null) { c.source_width = probe.width; touched = true; }
              if (c.source_height == null && probe.height != null) { c.source_height = probe.height; touched = true; }
              if (c.source_fps == null && probe.fps != null) { c.source_fps = probe.fps; touched = true; }
              if (probe.duration != null) { c.source_duration = probe.duration; touched = true; }
              if (touched) healedClips++;
            }
            if (touched) { await saveSequence(ws, seq); healedSequences.push(seq.id); }
          }
        } catch { /* file still unreadable — symlink swapped, metadata heals on next probe */ }

        emit({
          ok: true, rel, newPath,
          healed_clips: healedClips,
          healed_sequences: healedSequences,
          note: healedClips > 0
            ? `Source relinked and ${healedClips} clip(s) across ${healedSequences.length} sequence(s) re-probed.`
            : "Source relinked.",
        });
        break;
      }

      case "source-clear": {
        // Clear the entire source queue (remove every symlink under source/).
        // Originals are untouched.
        const ws = a.workspace || fail("--workspace required");
        const root = path.join(workspaceDir(ws), "source");
        let removed = 0;
        for (const type of ["video", "audio", "images"]) {
          const dir = path.join(root, type);
          try {
            for (const f of await fs.readdir(dir)) {
              const p = path.join(dir, f);
              try {
                const ls = await fs.lstat(p);
                if (ls.isSymbolicLink()) { await fs.rm(p, { force: true }); removed++; }
              } catch { /* skip */ }
            }
          } catch { /* dir may not exist */ }
        }
        emit({ ok: true, removed, note: "Source queue cleared. Original media untouched." });
        break;
      }

      case "memory-read": {
        // Read the workspace's persistent MEMORY.md (critical findings the agent
        // has accumulated). Cheap to call at the start of every session so the
        // agent never re-derives footage facts, style, or decisions.
        const ws = a.workspace || fail("--workspace required");
        const mp = path.join(workspaceDir(ws), "MEMORY.md");
        try {
          emit({ ok: true, memory: await fs.readFile(mp, "utf8"), path: mp });
        } catch {
          emit({ ok: true, memory: "", path: mp, note: "No memory yet — append findings as you learn them." });
        }
        break;
      }

      case "memory-append": {
        // Append one critical finding as a dated bullet. Keep entries terse —
        // facts and decisions, not narration. This file is the agent's long-term
        // memory that survives across sessions and context windows.
        const ws = a.workspace || fail("--workspace required");
        const note = a.note || fail('--note "..." required');
        const section = a.section || "Findings";
        const mp = path.join(workspaceDir(ws), "MEMORY.md");
        await ensureWorkspace(ws);
        let existing = "";
        try { existing = await fs.readFile(mp, "utf8"); } catch { existing = `# JCut.AI Memory\n`; }
        // Append under a section header, creating it if absent.
        const bullet = `- ${note}`;
        if (existing.includes(`## ${section}`)) {
          existing = existing.replace(`## ${section}\n`, `## ${section}\n${bullet}\n`);
        } else {
          existing += `\n## ${section}\n${bullet}\n`;
        }
        await fs.writeFile(mp, existing);
        emit({ ok: true, appended: bullet, section, path: mp });
        break;
      }

      case "criteria-get": {
        // Read the workspace's editing criteria — the user's opt-in/out choices
        // for optional analysis (beat/transcription/content) plus creative
        // constraints. The agent reads this FIRST and respects it: it does NOT
        // run beat analysis on a project the user marked beat_analysis:off, and
        // does NOT skip it when marked on.
        const ws = a.workspace || fail("--workspace required");
        const c = await loadCriteria(ws);
        emit({ ok: true, criteria: c, summary: summarizeCriteria(c) });
        break;
      }

      case "criteria-set": {
        // Set one or more criteria. Flags map 1:1 to fields:
        //   --beat-analysis on|off|auto   --transcription on|off|auto
        //   --content-analysis on|off|auto
        //   --target-platform tiktok   --target-duration 30
        //   --captions-wanted true|false   --music-driven true|false
        //   --notes "..."
        const ws = a.workspace || fail("--workspace required");
        const patch: Partial<Criteria> = {};
        const tog = (v: any): Toggle | undefined =>
          v === "on" || v === "off" || v === "auto" ? v : undefined;
        const bool = (v: any): boolean | undefined =>
          v === "true" ? true : v === "false" ? false : undefined;
        if (a["beat-analysis"] != null) {
          const t = tog(a["beat-analysis"]); if (!t) fail("--beat-analysis must be on|off|auto");
          patch.beat_analysis = t;
        }
        if (a["transcription"] != null) {
          const t = tog(a["transcription"]); if (!t) fail("--transcription must be on|off|auto");
          patch.transcription = t;
        }
        if (a["content-analysis"] != null) {
          const t = tog(a["content-analysis"]); if (!t) fail("--content-analysis must be on|off|auto");
          patch.content_analysis = t;
        }
        if (a["target-platform"] != null) patch.target_platform = String(a["target-platform"]);
        if (a["target-duration"] != null) patch.target_duration_seconds = Number(a["target-duration"]);
        if (a["captions-wanted"] != null) {
          if (a["captions-wanted"] === "auto") patch.captions_wanted = undefined;
          else patch.captions_wanted = bool(a["captions-wanted"]);
        }
        if (a["music-driven"] != null) {
          if (a["music-driven"] === "auto") patch.music_driven = undefined;
          else patch.music_driven = bool(a["music-driven"]);
        }
        if (a["notes"] != null) patch.notes = String(a["notes"]);
        if (Object.keys(patch).length === 0) fail("No criteria flags provided.");
        const c = await saveCriteria(ws, patch);
        emit({ ok: true, criteria: c, summary: summarizeCriteria(c), note: "Criteria updated." });
        break;
      }

      case "transcript-import": {
        // Import a transcript/captions the user exported from Premiere (or any
        // tool) as .srt/.vtt/.txt. JCut does NOT transcribe — this gives the agent
        // word/line timing for speech-driven editing without an STT engine.
        //   --workspace W --file <path.srt> [--name <label>]
        const ws = a.workspace || fail("--workspace required");
        const file = a.file || fail("--file <path.srt|.vtt|.txt> required");
        await ensureWorkspace(ws);
        const t = await parseTranscriptFile(file);
        t.imported_at = Date.now();
        const name = (a.name as string) || path.basename(file);
        const saved = await saveTranscript(ws, name, t);
        emit({
          ok: true,
          name: name.replace(/\.[^.]+$/, ""),
          format: t.format,
          cue_count: t.cues.length,
          duration_seconds: t.cues.length ? Math.round(t.cues[t.cues.length - 1].end_seconds * 100) / 100 : 0,
          speakers: [...new Set(t.cues.map((c) => c.speaker).filter(Boolean))],
          saved_to: saved,
          preview: t.cues.slice(0, 3).map((c) => ({ start: c.start_seconds, end: c.end_seconds, text: c.text, speaker: c.speaker })),
          note: t.format === "txt"
            ? "Imported plain text (no timing). For word-level cut timing, export an .srt from Premiere's Text panel."
            : "Transcript imported. Use transcript-search to find lines and their exact timecodes for cutting.",
        });
        break;
      }

      case "transcript-list": {
        const ws = a.workspace || fail("--workspace required");
        emit({ ok: true, transcripts: await listTranscripts(ws) });
        break;
      }

      case "transcript-get": {
        // Return cues (optionally a time window). Large transcripts: prefer
        // transcript-search over dumping everything.
        const ws = a.workspace || fail("--workspace required");
        const name = a.name || fail("--name required (from transcript-list)");
        const t = await loadTranscript(ws, name);
        let cues = t.cues;
        const from = a.from != null ? Number(a.from) : null;
        const to = a.to != null ? Number(a.to) : null;
        if (from != null) cues = cues.filter((c) => c.end_seconds >= from);
        if (to != null) cues = cues.filter((c) => c.start_seconds <= to);
        emit({ ok: true, name, format: t.format, cue_count: cues.length, cues });
        break;
      }

      case "transcript-search": {
        // Find lines containing a phrase → exact timecodes to cut on. This is the
        // bridge from "what was said" to "where to cut" for speech-driven editing.
        const ws = a.workspace || fail("--workspace required");
        const name = a.name || fail("--name required (from transcript-list)");
        const query = a.query || fail('--query "phrase" required');
        const t = await loadTranscript(ws, name);
        const matches = searchCues(t, query);
        emit({
          ok: true, name, query, match_count: matches.length,
          matches: matches.map((c) => ({ start: c.start_seconds, end: c.end_seconds, text: c.text, speaker: c.speaker })),
        });
        break;
      }

      case "modes-list": {
        // Built-in editing modes + user presets, for the agent and the UI.
        const presets = await loadPresets();
        emit({ ok: true, modes: BUILTIN_MODES.map(({ id, name, description }) => ({ id, name, description })),
               presets: presets.map(({ id, name, description }) => ({ id, name, description })) });
        break;
      }

      case "mode-get": {
        // Resolve a mode/preset id to its instruction block (agent applies it).
        const id = a.id || fail("--id required");
        const r = await resolveInstructions(id);
        if (!r) fail(`No mode or preset "${id}".`);
        emit({ ok: true, ...r });
        break;
      }

      case "preset-save": {
        // Create/update a user preset. --id --name --instructions [--base-mode] [--description]
        const id = a.id || fail("--id required");
        const all = await savePreset({
          id, name: a.name || id,
          description: a.description || "",
          instructions: a.instructions || fail("--instructions required"),
          base_mode: a["base-mode"] || undefined,
        });
        emit({ ok: true, saved: id, total: all.length });
        break;
      }

      case "preset-delete": {
        const id = a.id || fail("--id required");
        await deletePreset(id);
        emit({ ok: true, deleted: id });
        break;
      }

      case "analyze-music": {
        // Build a musical map (BPM, beats, energy sections) from an audio/video
        // file so the agent can pace cuts to the music. --file <path>.
        // ALWAYS returns the FULL beat grid — it's only a few hundred numbers
        // (~2KB), and withholding it made the agent loop, re-calling this tool
        // over and over trying to get "exact beat positions" it never received.
        // The `complete: true` flag tells the agent it has everything it needs.
        const ws = a.workspace || "default";
        const fileRaw = a.file || fail(
          "--file <path> required. " +
          "First run sources-list --workspace " + ws + " to find available audio/video files, " +
          "then pass the exact path here, e.g. --file source/audio/song.mp3"
        );
        const file = await resolveWorkspaceMediaPath(ws, fileRaw);
        const map = await analyzeMusic(file);
        emit({
          ok: true,
          complete: true, // you have the full beat map — do NOT call this again for this file
          bpm: map.bpm,
          confidence: map.confidence,
          duration_seconds: map.duration_seconds,
          analyzed_seconds: map.analyzed_seconds,
          audioflux_used: !!map.audioflux_used,
          // Beats past analyzed_seconds are extrapolated at the detected tempo
          // (tempo is stable in virtually all music). Detected beats up to
          // analyzed_seconds are measured; beyond that they're projected.
          beats_extrapolated: map.beats_extrapolated,
          beat_count: map.beat_count,
          sections: map.sections, // energy sections only cover analyzed_seconds
          downbeats_seconds: map.downbeats_seconds,
          beats_seconds: map.beats_seconds, // full grid across duration_seconds
        });
        break;
      }

      case "analyze-video": {
        // Run local visual analysis on a source clip: shot composition + motion curve.
        // Useful before choosing trims because it surfaces the settle point and action peaks.
        const ws = a.workspace || "default";
        const fileRaw = a.file || fail(
          "--file <path> required. " +
          "First run sources-list --workspace " + ws + " to find available video files, " +
          "then pass the exact path here, e.g. --file source/video/clip.mp4"
        );
        const file = await resolveWorkspaceMediaPath(ws, fileRaw);
        const analysis = await analyzeVideo(file);
        emit({
          ok: true,
          complete: true,
          file: fileRaw,
          shot_type: analysis.composition.shot_type,
          shot_confidence: analysis.composition.confidence,
          center_focus_ratio: analysis.composition.center_focus_ratio,
          overall_edge_density: analysis.composition.overall_edge_density,
          frame_analyses: analysis.composition.frame_analyses || [],
          model_used: !!analysis.composition.model_used,
          model_error: analysis.composition.model_error,
          camera_settle_seconds: analysis.motion.camera_settle_seconds,
          motion_peaks_seconds: analysis.motion.motion_peaks_seconds,
          motion_curve: analysis.motion.motion_curve || [],
          motion_method: analysis.motion.motion_method,
          opencv_used: analysis.composition.opencv_used || analysis.motion.opencv_used || false,
          note: analysis.motion.note,
        });
        break;
      }

      case "analyze-faces": {
        // Detect faces in a video clip and return per-frame subject positions
        // (normalized 0..1 x/y coords) for use with sequence-social-clips --subjects.
        // Uses OpenCV Haar Cascade — pure local, no cloud, no GPU required.
        //
        //   --workspace W --file <video>
        //   [--sample-fps 2]   frames per second to sample (default 2, max 10)
        //
        // Returns: summary {mean_x, mean_y, face_detected} + per-frame positions.
        // Pass summary to sequence-social-clips --subjects to keep faces in frame.
        const ws = a.workspace || "default";
        const fileRaw = a.file || fail("--file <video path> required");
        const file = await resolveWorkspaceMediaPath(ws, fileRaw);
        const sampleFps = a["sample-fps"] != null ? Number(a["sample-fps"]) : 2;
        const { analyzeVideoFaces } = await import("./video-analysis.js");
        const res = await analyzeVideoFaces(file, sampleFps);
        emit(res);
        break;
      }

      case "sequence-auto-reframe-faces": {
        // Detect faces in each video clip of a sequence, then reframe to a target
        // orientation with face-aware subject biasing. Combines analyze-faces +
        // sequence-reframe into one command for the Social Clip Creator workflow.
        //
        //   --workspace W --sequence-id ID --orientation vertical|square|horizontal
        //   [--name NAME]
        //   [--sample-fps 2]
        const ws = a.workspace || fail("--workspace required");
        const srcSeq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const orient = (a.orientation || fail("--orientation required")) as Orientation;
        if (!["vertical", "horizontal", "square"].includes(orient)) {
          fail("--orientation must be vertical, horizontal, or square");
        }
        const sampleFps = a["sample-fps"] != null ? Number(a["sample-fps"]) : 2;
        const canvas = orientationCanvas(orient);

        const { analyzeVideoFaces } = await import("./video-analysis.js");

        // Build subject map: clip_id → {x, y} from face detection on each clip.
        const subjects: Record<string, { x: number; y: number }> = {};
        const videoClips = srcSeq.clips.filter((c) => isVideoTrack(c.track));
        for (const clip of videoClips) {
          const absSource = clip.source_path.startsWith("/")
            ? clip.source_path
            : path.join(workspaceDir(ws), clip.source_path);
          try {
            const res = await analyzeVideoFaces(absSource, sampleFps);
            if (res.face_detected && res.summary) {
              subjects[clip.id] = { x: res.summary.mean_x, y: res.summary.mean_y };
            }
          } catch { /* skip unanalyzable clips — will default to center */ }
        }

        // Clone + reframe with detected subjects.
        const linkRemap = new Map<string, string>();
        const clone: Sequence = {
          id: newSeqId(),
          name: a.name || `${srcSeq.name} (${orient})`,
          description: `Face-aware reframe from "${srcSeq.name}" → ${orient}`,
          settings: { ...srcSeq.settings, width: canvas.width, height: canvas.height },
          clips: srcSeq.clips.map((c) => {
            const copy: typeof c = { ...c, id: newClipId() };
            if (copy.link_id) {
              if (!linkRemap.has(copy.link_id)) linkRemap.set(copy.link_id, newClipId("lnk"));
              copy.link_id = linkRemap.get(copy.link_id)!;
            }
            if (isVideoTrack(c.track) && c.source_width && c.source_height && copy.transform) {
              const subj = subjects[c.id] || { x: 0.5, y: 0.4 };
              const f = fillTransform(c.source_width, c.source_height, canvas.width, canvas.height, subj.x, subj.y);
              copy.transform = { ...copy.transform, scale: { x: f.scale, y: f.scale }, position: f.position };
            }
            return copy;
          }),
        };
        const savedPath = await saveSequence(ws, clone);
        emit({
          ok: true,
          sequence_id: clone.id,
          name: clone.name,
          orientation: orient,
          settings: `${canvas.width}×${canvas.height}`,
          face_biased_clips: Object.keys(subjects).length,
          total_video_clips: videoClips.length,
          subjects,
          path: savedPath,
          note: `Reframed with face detection. ${Object.keys(subjects).length}/${videoClips.length} clips had detectable faces.`,
        });
        break;
      }

      case "sequence-analyze": {
        // Analyze ONE sequence's editorial structure (pacing, shots, B-roll, sections).
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        emit({ ok: true, style: analyzeSequence(seq) });
        break;
      }

      case "style-learn": {
        // Aggregate every sequence in the workspace (or an explicit --sequence-ids
        // list) into a saved style profile: "how these videos usually go."
        const ws = a.workspace || fail("--workspace required");
        let seqs = await listSequences(ws);
        if (a.ids) seqs = seqs.filter((s) => (a.ids as string[]).includes(s.id));
        if (seqs.length === 0) fail("No sequences found to learn from.");
        const styles = seqs.map(analyzeSequence);
        const profile = buildStyleProfile(styles);
        // NAMED styles: pass --name "client A" to learn multiple distinct styles in
        // one thread without clobbering each other. Each gets its own MEMORY block
        // and its own profile file. Default name "default".
        const styleName = (a.name as string) || "default";
        const slug = styleName.toLowerCase().replace(/[^a-z0-9]+/g, "_");
        const out = path.join(workspaceDir(ws), "analysis", `style_${slug}.json`);
        await fs.mkdir(path.dirname(out), { recursive: true });
        await fs.writeFile(out, JSON.stringify({ name: styleName, profile, per_sequence: styles }, null, 2));
        const heading = `Learned Style: ${styleName}`;
        const memory = await upsertMemorySection(ws, heading, [
          `Learned from ${styles.length} sequence(s).`,
          ...profile.notes.map((n) => `- ${n}`),
          `- Targets: ~${profile.typical_cuts_per_minute} cuts/min, ` +
            `~${profile.typical_shot_seconds}s typical shot ` +
            `(${profile.fast_cut_seconds}s fast / ${profile.long_take_seconds}s long), ` +
            `${Math.round(profile.typical_broll_overlay_ratio * 100)}% B-roll overlay.`,
        ]);
        emit({ ok: true, name: styleName, profile, learned_from: styles.map((s) => s.name), saved_to: out, memory });
        break;
      }

      case "sequence-export-premiere": {
        // Write a JCut sequence to a native .prproj that opens in Premiere.
        //   --sequence-id ID [--output /abs/path.prproj]
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));

        let out = a.output;
        const defaultName = `${(seq.name || seq.id).replace(/[^\w.-]/g, "_")}.prproj`;
        // No explicit --output: ask the user WHERE to save, every time. When running
        // inside the Electron app (JCUT_IPC_DIR is set), request a NATIVE Save dialog
        // via the host (it watches our stdout for the marker and writes the chosen
        // path to a response file). Fall back to osascript, then a default folder.
        if (!out) {
          const picked = await requestSavePath(defaultName);
          if (picked === "__CANCELLED__") {
            emit({ ok: false, cancelled: true, note: "Export cancelled — no location chosen." });
            break;
          }
          if (picked) out = picked;
        }
        if (!out) {
          out = path.join(workspaceDir(ws), "renders", defaultName);
        }

        // ── Conflict-safe write (Premiere round-trip) ─────────────────────────
        // If the target exists and is NOT exactly what we last wrote there (the
        // user saved Premiere work over it, or it's a file JCut didn't create),
        // never overwrite — write " v2"/" v3"… beside it instead. The user then
        // pulls the update into their OPEN project via File > Import (or the
        // JCut companion panel does it automatically). --force overrides.
        let versionedFrom: string | undefined;
        if (!a.force) {
          const existing = await fileFingerprint(out);
          if (existing) {
            const ledger = await readExportLedger(ws);
            const entry = ledger.find((e) => e.path === out);
            const untouched = entry != null && fingerprintMatches(entry, existing);
            if (!untouched) {
              versionedFrom = out;
              for (let v = 2; ; v++) {
                const cand = versionedPath(out, v);
                if (!(await fileFingerprint(cand))) { out = cand; break; }
              }
            }
          }
        }

        const res = await exportPrproj(seq, out, workspaceDir(ws));

        // Record the written file's fingerprint so the next export (and
        // prproj-sync-status) can tell our bytes from the user's edits.
        const fp = await fileFingerprint(out);
        if (fp) {
          const ledger = (await readExportLedger(ws)).filter((e) => e.path !== out);
          ledger.push({
            path: out, sequence_id: seq.id, size: fp.size, mtime_ms: fp.mtime_ms,
            exported_at: new Date().toISOString(),
          });
          await writeExportLedger(ws, ledger.slice(-100));
        }

        emit({
          ok: true,
          output: res.output,
          sequences: res.sequences,
          clips: res.clips,
          warnings: res.warnings,
          ...(versionedFrom ? { versioned_from: versionedFrom } : {}),
          note: versionedFrom
            ? `The file at ${path.basename(versionedFrom)} was changed since JCut wrote it (likely your Premiere edits) — ` +
              `saved this export as "${path.basename(out)}" instead so nothing is lost. ` +
              `In Premiere, use File > Import on the new file to bring the updated sequence into your open project.`
            : "Exported. Open in Premiere with File > Open Project — or, if a project is already open, File > Import brings the sequence in without closing it.",
        });
        break;
      }

      case "prproj-sync-status": {
        // Report the state of the Premiere round-trip for this workspace:
        //   --workspace W
        //   exports: every .prproj JCut wrote, each untouched | modified_in_premiere | missing
        //   premiere_inbox: project copies pushed into <ws>/sync/ by the Premiere
        //     companion panel ("Send to JCut") or by the user copying a saved project there
        // modified_in_premiere / inbox files carry the USER's latest edits — import
        // them with sequence-import-prproj before continuing to edit that timeline.
        const ws = a.workspace || fail("--workspace required");
        const ledger = await readExportLedger(ws);
        const exportsOut: any[] = [];
        for (const e of ledger) {
          const fp = await fileFingerprint(e.path);
          const status = !fp ? "missing"
            : fingerprintMatches(e, fp) ? "untouched"
            : "modified_in_premiere";
          exportsOut.push({
            path: e.path,
            sequence_id: e.sequence_id,
            exported_at: e.exported_at,
            status,
            ...(status === "modified_in_premiere"
              ? { action: `Run sequence-import-prproj --file "${e.path}" to pull the user's Premiere edits back into the workspace.` }
              : {}),
          });
        }
        const syncDir = path.join(workspaceDir(ws), "sync");
        const inbox: { path: string; modified_at: string; mtime_ms: number }[] = [];
        try {
          for (const f of await fs.readdir(syncDir)) {
            if (!f.toLowerCase().endsWith(".prproj")) continue;
            const st = await fs.stat(path.join(syncDir, f));
            inbox.push({ path: path.join(syncDir, f), modified_at: new Date(st.mtimeMs).toISOString(), mtime_ms: st.mtimeMs });
          }
          inbox.sort((x, y) => y.mtime_ms - x.mtime_ms);
        } catch { /* no sync dir yet — nothing pushed */ }
        const modified = exportsOut.filter((e) => e.status === "modified_in_premiere");
        emit({
          ok: true,
          exports: exportsOut,
          premiere_inbox: inbox.map(({ mtime_ms: _m, ...r }) => r),
          note: inbox.length
            ? `Premiere pushed ${inbox.length} project cop${inbox.length === 1 ? "y" : "ies"} to sync/ — import the newest with sequence-import-prproj to continue from the user's latest edit.`
            : modified.length
              ? `${modified.length} exported project(s) were modified in Premiere. Import them back before re-editing that timeline — and don't worry about overwrites: re-exports automatically write a new " v2" file.`
              : "No changes detected — all exports are exactly as JCut wrote them.",
        });
        break;
      }

      case "premiere-panel-status": {
        // Health of the Premiere companion panel install (read-only, no side
        // effects). Drives the app's Settings/Onboarding UI and lets the agent
        // guide the user. Reports:
        //   premiere_installed  — an Adobe Premiere Pro app exists in /Applications
        //   panel_installed / panel_version / panel_up_to_date
        //   debug_mode         — CEP PlayerDebugMode per CSXS runtime (needed for
        //                        unsigned dev panels; 11/12 cover current Premiere)
        //   [--dest DIR]       — install-location override (testing)
        const st = await premierePanelStatus(a.dest as string | undefined);
        emit({ ok: true, ...st });
        break;
      }

      case "premiere-panel-install": {
        // One-click install (or update) of the Premiere companion panel.
        //   [--dest DIR]   install location override (testing; also skips `defaults`)
        // Copies premiere-extension/ into the user CEP extensions folder and
        // enables PlayerDebugMode so the unsigned development panel loads.
        const src = premierePanelSrc();
        try {
          await fs.access(path.join(src, "CSXS", "manifest.xml"));
        } catch {
          emit({ ok: false, error: `Panel source not found at ${src} — is the premiere-extension folder present?` });
          break;
        }
        const dest = (a.dest as string) ||
          path.join(os.homedir(), "Library", "Application Support", "Adobe", "CEP", "extensions", "com.jcutai.panel");
        try {
          // Clean install: remove any prior copy first so a stale/older/partial
          // install (a common cause of "the panel doesn't load right") can't
          // leave orphaned files behind. Then copy fresh.
          await fs.rm(dest, { recursive: true, force: true });
          await fs.mkdir(dest, { recursive: true });
          await fs.cp(src, dest, {
            recursive: true,
            force: true,
            filter: (p) => !/install\.sh$/.test(p),
          });
        } catch (e) {
          emit({ ok: false, error: `Could not copy the panel to ${dest}: ${(e as Error).message}` });
          break;
        }

        // Verify the copy actually landed by reading back the installed manifest
        // version — never report success on a copy that silently didn't happen.
        let installedVersion: string | null = null;
        try {
          const xml = await fs.readFile(path.join(dest, "CSXS", "manifest.xml"), "utf8");
          installedVersion = xml.match(/ExtensionBundleVersion="([^"]+)"/)?.[1] ?? null;
        } catch { /* verified below */ }
        if (!installedVersion) {
          emit({ ok: false, error: `Copied to ${dest} but the manifest is missing — the install did not complete.` });
          break;
        }

        // Enable unsigned-panel loading across CEP runtimes. CSXS 9–14 covers
        // every Premiere from CC2019 through current + near-future builds. Use an
        // absolute `defaults` path (the packaged app's subprocess PATH may not
        // include /usr/bin), then flush cfprefsd so Premiere sees it without a
        // logout. Best-effort — status reports whether it stuck.
        const debugEnabled: string[] = [];
        if (!a.dest && process.platform === "darwin") {
          const defaultsBin = existsSync("/usr/bin/defaults") ? "/usr/bin/defaults" : "defaults";
          for (const v of [9, 10, 11, 12, 13, 14]) {
            try {
              await _pexecFile(defaultsBin, ["write", `com.adobe.CSXS.${v}`, "PlayerDebugMode", "1"]);
              debugEnabled.push(`CSXS.${v}`);
            } catch { /* best-effort */ }
          }
          try { await _pexecFile(existsSync("/usr/bin/killall") ? "/usr/bin/killall" : "killall", ["cfprefsd"]); }
          catch { /* prefs cache flush is best-effort */ }
        }

        const st = await premierePanelStatus(a.dest as string | undefined);
        const apps = st.premiere_apps;
        emit({
          ok: true,
          installed_to: dest,
          installed_version: installedVersion,
          debug_enabled: debugEnabled,
          ...st,
          next_steps: [
            apps.length > 0
              ? `Fully quit (Cmd+Q) and reopen Premiere. The panel installs to the shared Adobe folder, so it works in EVERY installed version — restart each one you want to use it in: ${apps.join(", ")}.`
              : "Install Adobe Premiere Pro, then fully quit and reopen it.",
            "In Premiere: Window > Extensions > JCut.AI.",
            "In the panel: press Read sequence to start a CastCut edit, or pick a project under Advanced to sync.",
          ],
          note: apps.length > 1
            ? `Panel v${installedVersion} installed to the shared CEP folder — it will appear in all ${apps.length} installed Premiere versions once each is restarted (${apps.join(", ")}).`
            : `Panel v${installedVersion} installed. Fully quit and reopen Premiere, then Window > Extensions > JCut.AI.`,
        });
        break;
      }

      case "sequence-import-prproj": {
        // Import an existing Premiere timeline as an EDITABLE JCut sequence the
        // agent can modify and continue. --file <path.prproj> [--name N].
        // Symlinks referenced media into the workspace (never copies), then
        // builds a sequence from the clip timing.
        const ws = a.workspace || fail("--workspace required");
        const file = a.file || fail("--file <path.prproj> required");
        await ensureWorkspace(ws);
        const { clips, settings: detected } = await importPrprojClips(file);
        if (clips.length === 0) fail("No editable clips found in that project.");
        // Use the REAL sequence resolution + framerate detected from the project
        // (e.g. vertical 4K 2160×3840), not a hardcoded guess.
        const seq: Sequence = {
          id: newSeqId(),
          name: a.name || (file.split("/").pop()?.replace(/\.prproj$/i, "") || "Imported Timeline"),
          description: `Imported from ${file}`,
          settings: {
            width: detected.width, height: detected.height, framerate: detected.framerate,
            sample_rate: 48000, color_space: "bt709",
          },
          clips: [],
        };
        await saveSequence(ws, seq);
        // Symlink each unique existing source into the workspace, then add clips
        // that point at the symlinked path. Sources that no longer exist on disk
        // are kept by absolute path and flagged.
        const unresolved: string[] = [];
        const ops = [] as any[];
        const seen = new Map<string, string>();
        for (const c of clips) {
          let src = c.source;
          if (src && src !== "(unknown source)") {
            if (!seen.has(src)) {
              try {
                await fs.stat(src);
                const base = path.basename(src);
                const sub = c.track.startsWith("A") ? "audio" : "video";
                const destDir = path.join(workspaceDir(ws), "source", sub);
                await fs.mkdir(destDir, { recursive: true });
                const dest = path.join(destDir, base);
                // The source may ALREADY live in this workspace (round-tripping a
                // project JCut itself exported). Unlinking it to plant a symlink
                // would replace the real file with a self-referential link and
                // destroy the media — keep the existing file untouched instead.
                const resolvedSrc = await fs.realpath(path.resolve(src)).catch(() => path.resolve(src));
                const resolvedDest = await fs.realpath(dest).catch(() => dest);
                if (resolvedSrc === resolvedDest || resolvedSrc === dest) {
                  seen.set(src, path.join("source", sub, base));
                } else {
                  try { await fs.unlink(dest); } catch { /* ok */ }
                  await fs.symlink(resolvedSrc, dest);
                  seen.set(src, path.join("source", sub, base));
                }
              } catch {
                unresolved.push(src);
                seen.set(src, src); // keep absolute; agent can relink
              }
            }
            src = seen.get(src)!;
          }
          ops.push({ track: c.track, source: src, position_seconds: c.position_seconds,
                     trim_start_seconds: c.trim_start_seconds, trim_end_seconds: c.trim_end_seconds });
        }
        // Add clips one at a time so a single bad file doesn't abort all.
        // allowOffline=true keeps clips whose media is on an unplugged drive
        // (common when importing — the source footage lives on external storage).
        let added = 0;
        for (const op of ops) {
          try { await addClips(ws, seq, [op], true); added++; } catch { /* skip truly invalid */ }
        }
        await saveSequence(ws, seq);
        emit({
          ok: true, sequence_id: seq.id, name: seq.name,
          resolution: `${detected.width}x${detected.height}@${detected.framerate}`,
          imported_clips: added, total_found: clips.length,
          unresolved_sources: [...new Set(unresolved)].slice(0, 20),
          note: "Imported as an editable sequence. Open it and tell JCut to finish or continue it.",
        });
        break;
      }

      case "prproj-analyze": {
        // Import a Premiere Pro project and learn its editorial style.
        const ws = a.workspace || fail("--workspace required");
        const file = a.file || fail("--file <path.prproj> required");
        await ensureWorkspace(ws);
        const name = (a.name as string) || file.split("/").pop()?.replace(/\.prproj$/, "") || "Imported Project";
        const { style, profile, clipCount } = await analyzePrproj(file, name);
        const memory = await upsertMemorySection(ws, `Premiere Project Analysis: ${name}`, [
          `- Analyzed ${clipCount} clip(s) from "${name}".`,
          ...profile.notes.map((n) => `- ${n}`),
        ]);
        emit({
          ok: true,
          summary: `Imported "${name}" — ${clipCount} clips analyzed.`,
          style, profile,
          memory,
        });
        break;
      }

      case "sequence-reframe": {
        // Clone an existing sequence into a different orientation, recomputing the
        // fill transform of every video clip so subjects stay framed. Timing,
        // trims, speed, audio — identical. The source sequence is untouched.
        //   --sequence-id ID --orientation vertical|horizontal|square
        //   [--name NAME] [--subjects '{"clipId":{"x":0.5,"y":0.4}}']
        const ws = a.workspace || fail("--workspace required");
        const src = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const orient = (a.orientation || fail("--orientation required")) as Orientation;
        if (!["vertical", "horizontal", "square"].includes(orient)) {
          fail("--orientation must be vertical, horizontal, or square");
        }
        const canvas = orientationCanvas(orient);
        let subjects: Record<string, { x: number; y: number }> = {};
        if (a.subjects) { try { subjects = JSON.parse(a.subjects); } catch { /* ignore */ } }

        // Remap link ids so the clone's V/A pairs stay linked independently.
        const linkRemap = new Map<string, string>();
        const clone: Sequence = {
          id: newSeqId(),
          name: a.name || `${src.name} (${orient})`,
          description: `Reframed from "${src.name}" → ${orient}`,
          settings: { ...src.settings, width: canvas.width, height: canvas.height },
          clips: src.clips.map((c) => {
            const copy: Sequence["clips"][number] = { ...c, id: newClipId() };
            if (copy.link_id) {
              if (!linkRemap.has(copy.link_id)) linkRemap.set(copy.link_id, newClipId("lnk"));
              copy.link_id = linkRemap.get(copy.link_id)!;
            }
            if (isVideoTrack(c.track) && c.source_width && c.source_height && copy.transform) {
              const subj = subjects[c.id] || { x: 0.5, y: 0.5 };
              const f = fillTransform(c.source_width, c.source_height, canvas.width, canvas.height, subj.x, subj.y);
              copy.transform = { ...copy.transform, scale: { x: f.scale, y: f.scale }, position: f.position };
            }
            return copy;
          }),
        };
        const p = await saveSequence(ws, clone);
        emit({
          ok: true,
          sequence_id: clone.id,
          name: clone.name,
          orientation: orient,
          settings: `${canvas.width}x${canvas.height}`,
          reframed_clips: clone.clips.filter((c) => isVideoTrack(c.track)).length,
          path: p,
          note: "Reframed with fill (cover) + centered crop. Pass --subjects to bias framing per clip.",
        });
        break;
      }

      // ── AutoPod-parity: Jump Cut Editor ────────────────────────────────────────
      case "analyze-silence": {
        // Detect silent regions in an audio/video file for jump-cut editing.
        // Mirrors AutoPod's Jump Cut Editor algorithm: RMS energy thresholding
        // with configurable dB floor, minimum silence duration, and pre/post buffers
        // that preserve natural speech rhythm at cut edges.
        //
        //   --workspace W --file <audio/video>
        //   [--threshold-db -40]      dB level below which audio is silent (default -40)
        //   [--min-silence 0.3]       minimum silent duration in seconds (default 0.3)
        //   [--pre-buffer 0.1]        seconds to keep before the silence (default 0.1)
        //   [--post-buffer 0.1]       seconds to keep after the silence (default 0.1)
        //
        // Returns: silent_regions [{start_seconds, end_seconds, duration_seconds}]
        // Pass these directly to sequence-jump-cut-editor to auto-cut a sequence.
        const ws = a.workspace || "default";
        const fileRaw = a.file || fail("--file <path> required");
        const file = await resolveWorkspaceMediaPath(ws, fileRaw);
        const threshDb = a["threshold-db"] != null ? Number(a["threshold-db"]) : -40.0;
        const minSil = a["min-silence"] != null ? Number(a["min-silence"]) : 0.3;
        const preBuf = a["pre-buffer"] != null ? Number(a["pre-buffer"]) : 0.1;
        const postBuf = a["post-buffer"] != null ? Number(a["post-buffer"]) : 0.1;

        const { stdout: silOut } = await _pexecFile(_venvPython, [
          _analyzeAudioPy, "--mode", "silence",
          "--file", file,
          "--threshold-db", String(threshDb),
          "--min-silence", String(minSil),
          "--pre-buffer", String(preBuf),
          "--post-buffer", String(postBuf),
        ], { maxBuffer: 10 * 1024 * 1024 });
        const silResult = JSON.parse(silOut);
        emit({ ok: true, ...silResult });
        break;
      }

      case "sequence-jump-cut-editor": {
        // AutoPod Jump Cut Editor equivalent: scan a sequence's audio track for
        // silent regions and ripple-delete them, compressing the timeline.
        //
        //   --workspace W --sequence-id ID
        //   [--audio-track A1]        which track to analyze (default A1)
        //   [--threshold-db -40]      silence floor in dB (default -40)
        //   [--min-silence 0.3]       minimum silence to remove in seconds (default 0.3)
        //   [--pre-buffer 0.15]       seconds of speech to keep before each silence (default 0.15)
        //   [--post-buffer 0.1]       seconds to keep after each silence (default 0.1)
        //   [--keep-gaps]             cut the silence out but leave a gap instead of
        //                             rippling (AutoPod's "delete and leave gap" mode —
        //                             lets the editor review cuts before closing them)
        //   [--dry-run]               report cuts without applying them
        //
        // How it works:
        //   1. Find all audio clips on the target track (sorted by start time).
        //   2. For each clip, run silence detection on its source file within the
        //      [trim_start, trim_end] window.
        //   3. Convert source-space silence regions to sequence-space positions.
        //   4. Split clips at each silence boundary and ripple-delete the silent
        //      sub-clips, pulling the remaining clips left.
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const audioTrack = (a["audio-track"] as string) || "A1";
        const threshDb = a["threshold-db"] != null ? Number(a["threshold-db"]) : -40.0;
        const minSil = a["min-silence"] != null ? Number(a["min-silence"]) : 0.3;
        const preBuf = a["pre-buffer"] != null ? Number(a["pre-buffer"]) : 0.15;
        const postBuf = a["post-buffer"] != null ? Number(a["post-buffer"]) : 0.1;
        const dryRun = !!a["dry-run"];
        const keepGaps = !!a["keep-gaps"];


        // Get audio clips on the target track, sorted by timeline position.
        const audioClips = seq.clips
          .filter((c) => c.track === audioTrack)
          .sort((a2, b) => a2.start_time_seconds - b.start_time_seconds);
        if (audioClips.length === 0) {
          emit({ ok: false, error: `No clips found on track ${audioTrack}. Check --audio-track.` });
          break;
        }

        // For each audio clip, detect silences in its source file within the
        // [trim_start, trim_end] window, then map back to sequence space.
        interface PlannedCut {
          clip_id: string;
          seq_start: number;
          seq_end: number;
          source_start: number;
          source_end: number;
        }
        const plannedCuts: PlannedCut[] = [];

        for (const clip of audioClips) {
          // Resolve like every other command (tries source/audio, source/video…)
          // — a naive workspaceDir join misses workspace-relative paths and made
          // the planner silently find zero silences.
          const absSource = await resolveWorkspaceMediaPath(ws, clip.source_path);
          let silResult: any;
          try {
            const { stdout } = await _pexecFile(_venvPython, [
              _analyzeAudioPy, "--mode", "silence",
              "--file", absSource,
              "--threshold-db", String(threshDb),
              "--min-silence", String(minSil),
              "--pre-buffer", String(preBuf),
              "--post-buffer", String(postBuf),
            ], { maxBuffer: 10 * 1024 * 1024 });
            silResult = JSON.parse(stdout);
          } catch {
            // No Python venv (or it failed) — fall back to the deterministic
            // pure-TS detector so silence removal works with just ffmpeg.
            try {
              const regions = await tsDetectSilence(absSource, threshDb, minSil, preBuf, postBuf);
              silResult = { ok: true, silent_regions: regions };
            } catch {
              continue; // truly unreadable clip
            }
          }
          if (!silResult.ok || !silResult.silent_regions?.length) continue;

          const trimStart = clip.trim_start_seconds;
          const trimEnd = clip.trim_end_seconds;
          const clipSeqStart = clip.start_time_seconds;
          const speed = clip.speed || 1.0;

          for (const region of silResult.silent_regions as { start_seconds: number; end_seconds: number }[]) {
            // Only include silences that fall within this clip's trim window.
            const rStart = Math.max(region.start_seconds, trimStart);
            const rEnd = Math.min(region.end_seconds, trimEnd);
            if (rEnd <= rStart) continue;
            // Map source-space -> sequence-space (accounting for speed).
            const seqStart = clipSeqStart + (rStart - trimStart) / speed;
            const seqEnd = clipSeqStart + (rEnd - trimStart) / speed;
            plannedCuts.push({
              clip_id: clip.id,
              seq_start: Math.round(seqStart * 1000) / 1000,
              seq_end: Math.round(seqEnd * 1000) / 1000,
              source_start: rStart,
              source_end: rEnd,
            });
          }
        }

        const totalRemoved = plannedCuts.reduce((s, c) => s + (c.seq_end - c.seq_start), 0);
        const originalDuration = sequenceDuration(seq);

        if (dryRun || plannedCuts.length === 0) {
          emit({
            ok: true,
            dry_run: true,
            audio_track: audioTrack,
            threshold_db: threshDb,
            silence_count: plannedCuts.length,
            total_removed_seconds: Math.round(totalRemoved * 100) / 100,
            original_duration: Math.round(originalDuration * 100) / 100,
            projected_duration: Math.round((originalDuration - totalRemoved) * 100) / 100,
            planned_cuts: plannedCuts,
            note: plannedCuts.length === 0
              ? "No silences found. Try a lower --threshold-db (e.g. -30) or shorter --min-silence."
              : "Run without --dry-run to apply cuts.",
          });
          break;
        }

        // Apply cuts as MULTI-TRACK ripple deletes. The old approach rebuilt
        // only the analyzed track's clips, which desynced every other track:
        // camera video spanning a removed region kept its full length while the
        // mic track compressed (and removeClips even deleted linked video
        // outright). rippleDeleteRange cuts the region out of EVERY track —
        // exactly what AutoPod's Jump Cut Editor does — so multicam sources and
        // finished multicam edits both stay frame-synced.
        //
        // Merge planned cuts into non-overlapping sequence-space regions, then
        // apply in REVERSE order so earlier region coordinates stay valid.
        const sortedRegions = plannedCuts
          .map((c) => ({ s: c.seq_start, e: c.seq_end }))
          .sort((x, y) => x.s - y.s);
        const merged: { s: number; e: number }[] = [];
        for (const r of sortedRegions) {
          const last = merged[merged.length - 1];
          if (last && r.s <= last.e + 0.001) last.e = Math.max(last.e, r.e);
          else merged.push({ ...r });
        }
        for (let i = merged.length - 1; i >= 0; i--) {
          rippleDeleteRange(seq, merged[i].s, merged[i].e, !keepGaps);
        }
        const totalCutsApplied = merged.length;

        await saveSequence(ws, seq);
        const newDuration = sequenceDuration(seq);
        emit({
          ok: true,
          audio_track: audioTrack,
          threshold_db: threshDb,
          silences_removed: totalCutsApplied,
          original_duration: Math.round(originalDuration * 100) / 100,
          new_duration: Math.round(newDuration * 100) / 100,
          time_saved_seconds: Math.round((originalDuration - newDuration) * 100) / 100,
          total_clips_now: seq.clips.length,
          note: `Removed ${totalCutsApplied} silent region(s). Timeline compressed by ${Math.round(originalDuration - newDuration)}s.`,
        });
        break;
      }

      case "sequence-detect-cameras": {
        // Auto-detect paired V/A track groups in a sequence for use with
        // sequence-multi-camera-editor. Inspects which track pairs have clips,
        // infers shot type from clip count and track position, and returns a
        // camera config array ready to paste into --cameras.
        //
        //   --workspace W --sequence-id ID
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));

        // Find all video tracks that have clips.
        const videoTracksWithClips = [...new Set(
          seq.clips.filter((c) => isVideoTrack(c.track)).map((c) => c.track)
        )].sort((a2, b) => {
          const na = parseInt(a2.slice(1)), nb = parseInt(b.slice(1));
          return na - nb;
        });

        if (videoTracksWithClips.length < 2) {
          emit({
            ok: false,
            error: `Only ${videoTracksWithClips.length} video track(s) with clips found. ` +
              `Multi-camera editing requires at least 2. Make sure each camera's footage ` +
              `is on a separate V track (V1, V2, V3…) with its audio on the matching A track.`,
          });
          break;
        }

        const cameras = videoTracksWithClips.map((vt, i) => {
          const trackNum = parseInt(vt.slice(1));
          const audioTrack = `A${trackNum}`;
          const hasAudio = seq.clips.some((c) => c.track === audioTrack);
          // Heuristic: last video track is likely the wide shot in a standard
          // podcast setup (V1=host, V2=guest, V3=wide). Single-track groups
          // are close-ups; the highest-numbered track gets type "wide".
          const isLast = i === videoTracksWithClips.length - 1;
          const type = isLast && videoTracksWithClips.length >= 3 ? "wide" : "solo";
          return {
            video_track: vt,
            audio_track: audioTrack,
            name: type === "wide" ? "Wide" : i === 0 ? "Host" : `Speaker ${i + 1}`,
            type,
            has_audio_clips: hasAudio,
          };
        });

        emit({
          ok: true,
          cameras_detected: cameras.length,
          cameras,
          cameras_json: JSON.stringify(cameras.map(({ video_track, audio_track, name, type }) =>
            ({ video_track, audio_track, name, type }))),
          note: cameras.some((c) => !c.has_audio_clips)
            ? "⚠ Some tracks have no audio clips — the editor won't be able to detect speech on those tracks."
            : `Detected ${cameras.length} cameras. Pass cameras_json to --cameras in sequence-multi-camera-editor.`,
        });
        break;
      }

      // ── AutoPod-parity: Multi-Camera Editor ─────────────────────────────────
      case "analyze-multi-audio": {
        // Compute per-frame speech-activity envelopes (0–1, Silero VAD with RMS
        // fallback — see analyze_audio.py envelope contract) for multiple audio
        // tracks. Used by sequence-multi-camera-editor to identify the dominant
        // speaker at each moment. Each track reports its own fps and vad_mode.
        //
        //   --files '["a.mp4","b.mp4","c.mp4"]'   or  --files a.mp4 b.mp4
        //   [--workspace W]
        const ws = a.workspace || "default";
        let files: string[] = [];
        if (a.files) {
          files = Array.isArray(a.files) ? a.files : JSON.parse(a.files);
        } else if (a.file) {
          files = [a.file];
        }
        if (files.length === 0) fail("--files required (array of audio/video paths)");

        const resolvedFiles = await Promise.all(
          files.map((f: string) => resolveWorkspaceMediaPath(ws, f).catch(() => f))
        );

        try {
          const { stdout: envOut } = await _pexecFile(_venvPython, [
            _analyzeAudioPy, "--mode", "envelope",
            "--file", resolvedFiles[0],
            "--files", ...resolvedFiles,
          ], { maxBuffer: 256 * 1024 * 1024 });
          emit({ ok: true, ...JSON.parse(envOut) });
        } catch {
          // Node Silero VAD, then pure-TS RMS (see sequence-multi-camera-editor).
          const tracks = [];
          for (const f of resolvedFiles) {
            try {
              const env = await analyzeVadEnvelopeNode(f);
              tracks.push({ file: f, ok: true, fps: env.fps, envelope_db: env.values, vad_mode: "silero" });
            } catch {
              try {
                const env = await tsActivityEnvelope(f);
                tracks.push({ file: f, ok: true, fps: env.fps, envelope_db: env.values, vad_mode: "rms" });
              } catch (e2) {
                tracks.push({ file: f, ok: false, error: (e2 as Error).message });
              }
            }
          }
          emit({ ok: true, mode: "envelope", tracks });
        }
        break;
      }

      case "multicam-plan": {
        // Headless multicam switching plan — the engine behind the Premiere
        // panel's fully-in-Premiere CastCut. Takes a JSON spec describing the
        // OPEN Premiere sequence (absolute media paths + timeline placement,
        // read by the panel via ExtendScript) and returns the camera-switch
        // runs. No workspace, no sequence files, no export — the panel applies
        // the cuts directly in the open Premiere sequence.
        //
        //   --spec '<json>'  or  --spec-file /path/spec.json
        //   spec = {
        //     cameras: [{
        //       name, type: "solo"|"wide"|"duo"|"trio",
        //       clips:       [{ path, start_seconds, trim_start_seconds, trim_end_seconds, speed? }],  // video placement
        //       audio_clips: [{ path, start_seconds, trim_start_seconds, trim_end_seconds, speed? }],  // this camera's mic(s)
        //     }],
        //     settings: { cooldown, min_speech, wide_shot_ratio, silence_threshold, max_shot }
        //   }
        const rawSpec = a["spec-file"]
          ? await fs.readFile(a["spec-file"], "utf8")
          : (a.spec || fail("--spec '<json>' or --spec-file <path> required"));
        let spec: any;
        try { spec = JSON.parse(rawSpec); } catch (e) { fail(`spec is not valid JSON: ${(e as Error).message}`); }
        const camsIn: any[] = Array.isArray(spec.cameras) ? spec.cameras : [];
        if (camsIn.length < 2) fail("spec.cameras needs at least 2 cameras");
        if (camsIn.length > 10) fail("spec.cameras supports up to 10 cameras");
        const st = spec.settings || {};

        // Build a transient in-memory sequence in the engine's shape: camera i's
        // mics on synthetic track A<i+1>, its video placement on V<i+1>.
        const planSeq: Sequence = {
          id: "plan", name: "plan",
          settings: { width: 1920, height: 1080, framerate: 30, sample_rate: 48000, color_space: "bt709" },
          clips: [],
        };
        let cid = 0;
        const pushClip = (track: string, cl: any, type: "audio" | "video") => {
          const trimStart = Number(cl.trim_start_seconds) || 0;
          const trimEnd = Number(cl.trim_end_seconds) || 0;
          if (trimEnd <= trimStart) return;
          planSeq.clips.push({
            id: `p${++cid}`, track, source_path: String(cl.path),
            start_time_seconds: Number(cl.start_seconds) || 0,
            trim_start_seconds: trimStart, trim_end_seconds: trimEnd,
            speed: Number(cl.speed) || 1.0, volume_db: 0, clip_type: type,
          });
        };
        const planCams: MulticamCameraSpec[] = camsIn.map((c, i) => {
          for (const cl of (c.audio_clips || [])) pushClip(`A${i + 1}`, cl, "audio");
          for (const cl of (c.clips || [])) pushClip(`V${i + 1}`, cl, "video");
          return {
            video_track: `V${i + 1}`,
            audio_track: `A${i + 1}`,
            name: c.name || `Camera ${i + 1}`,
            type: (c.type as MulticamCameraSpec["type"]) || "solo",
          };
        });

        const plan = await computeMulticamRuns(planSeq, planCams, {
          wideRatio: st.wide_shot_ratio != null ? Number(st.wide_shot_ratio) : 0.15,
          cooldownSec: st.cooldown != null ? Number(st.cooldown) : 1.5,
          minSpeechSec: st.min_speech != null ? Number(st.min_speech) : 0.5,
          silThresh: st.silence_threshold != null ? Number(st.silence_threshold) : -35.0,
          maxShotSec: st.max_shot != null ? Number(st.max_shot) : 0,
        }, async (p) => p); // paths from Premiere are already absolute
        if (!plan.ok) { emit({ ok: false, error: plan.error }); break; }

        const toSec = (fr: number) => Math.round((fr / MULTICAM_STATE_FPS) * 1000) / 1000;
        const runsOut = plan.runs.map((r) => ({
          camera_index: r.camIdx,
          camera: planCams[r.camIdx]?.name,
          start_seconds: toSec(r.startFrame),
          end_seconds: toSec(r.endFrame),
        }));
        emit({
          ok: true,
          cameras: planCams.length,
          cuts: Math.max(0, runsOut.length - 1),
          duration_seconds: toSec(plan.totalFrames),
          vad_mode: plan.vadMode,
          runs: runsOut,
          note: "Switch plan computed. Apply in Premiere by razoring every camera track at each run boundary and deleting the segments of the inactive cameras.",
        });
        break;
      }

      case "sequence-multi-camera-editor": {
        // AutoPod Multi-Camera Editor equivalent: automatically switches between
        // camera angles based on who is speaking, using per-track RMS energy
        // comparison with a heuristic state machine (speaker dominance + cooldown
        // + wide-shot forcing). Outputs a new flat sequence with camera-switch cuts.
        //
        //   --workspace W --sequence-id ID
        //   [--cameras '[{"video_track":"V1","audio_track":"A1","name":"Speaker A","type":"solo"},
        //                {"video_track":"V2","audio_track":"A2","name":"Speaker B","type":"solo"},
        //                {"video_track":"V3","audio_track":"A3","name":"Wide","type":"wide"}]']
        //     cameras is OPTIONAL — omitted, V/A track pairs are auto-detected
        //     (same heuristic as sequence-detect-cameras).
        //   [--wide-shot-ratio 0.15]     fraction of total time to spend on wide shots (default 0.15)
        //   [--cooldown 1.5]             min seconds before switching speakers again (default 1.5)
        //   [--min-speech 0.5]           ignore speech bursts shorter than this (default 0.5)
        //   [--silence-threshold -35]    dB below which a speaker is not considered active (default -35)
        //   [--max-shot 0]               max seconds on one shot while the same speaker talks:
        //                                rotate to their next angle / wide cutaway (0 = off)
        //   [--output-name "Multicam Edit"]
        //
        // Camera config extras (AutoPod parity):
        //   audio_tracks: ["A1","A5"]  — multiple mics per camera (max activity wins)
        //   two solo cameras with the SAME mic(s) = two ANGLES of one speaker;
        //   the shown angle rotates each time the edit returns to that speaker.
        //
        // Algorithm (mirrors AutoPod's approach):
        //   1. Analyze each DISTINCT audio source file once (Silero VAD, RMS
        //      fallback), then sample every camera's speech activity on a uniform
        //      SEQUENCE-TIME grid — honoring each audio clip's timeline position,
        //      trim in-point, and speed, across ALL clips on the track.
        //   2. State machine advances frame-by-frame in sequence time:
        //      - Active speaker = solo camera with highest activity above threshold
        //      - Two/three simultaneous speakers cut to a "duo"/"trio" camera if present
        //      - Hysteresis confirms a switch, then BACKDATES the cut to speech onset
        //      - Cooldown prevents rapid back-and-forth; sustained silence cuts to wide
        //      - Wide shots forced when the wide ratio lags the target (constant slack)
        //   3. Contiguous runs become V1 clips placed at their sequence-time
        //      positions (never accumulated), so video and audio stay in sync by
        //      construction even across gaps or clip boundaries.
        //   4. Output: new sequence with video cuts on V1, primary audio on A1 at
        //      its original timing, and a colored marker per camera run.
        const ws = a.workspace || fail("--workspace required");
        const srcSeq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        // --cameras is OPTIONAL: when omitted, auto-detect V/A track pairs with
        // the same heuristic as sequence-detect-cameras (highest of 3+ video
        // tracks = wide). This makes the command one-shot for agents — small
        // local models in particular struggle to author the JSON config.
        let camerasAutoDetected = false;
        const cameras: Array<{
          video_track: string;
          audio_track: string;
          name: string;
          type?: "solo" | "wide" | "duo" | "trio";
        }> = (() => {
          if (a.cameras) {
            try { return JSON.parse(a.cameras); }
            catch (e) { fail(`--cameras must be valid JSON: ${(e as Error).message}`); }
          }
          camerasAutoDetected = true;
          const videoTracksWithClips = [...new Set(
            srcSeq.clips.filter((c) => isVideoTrack(c.track)).map((c) => c.track)
          )].sort((t1, t2) => parseInt(t1.slice(1)) - parseInt(t2.slice(1)));
          if (videoTracksWithClips.length < 2) {
            fail(`--cameras omitted and only ${videoTracksWithClips.length} video track(s) have clips — ` +
              `put each camera's footage on its own V track (V1, V2, V3…) with audio on the matching A track.`);
          }
          return videoTracksWithClips.map((vt, i) => {
            const isLast = i === videoTracksWithClips.length - 1;
            const type: "wide" | "solo" = isLast && videoTracksWithClips.length >= 3 ? "wide" : "solo";
            return {
              video_track: vt,
              audio_track: `A${vt.slice(1)}`,
              name: type === "wide" ? "Wide" : i === 0 ? "Host" : `Speaker ${i + 1}`,
              type,
            };
          });
        })();
        if (cameras.length < 2) fail("--cameras must include at least 2 cameras");
        if (cameras.length > 10) fail("--cameras supports up to 10 cameras");

        const wideRatio = a["wide-shot-ratio"] != null ? Number(a["wide-shot-ratio"]) : 0.15;
        const cooldownSec = a.cooldown != null ? Number(a.cooldown) : 1.5;
        const minSpeechSec = a["min-speech"] != null ? Number(a["min-speech"]) : 0.5;
        const silThresh = a["silence-threshold"] != null ? Number(a["silence-threshold"]) : -35.0;
        // Max time on one shot while the SAME speaker keeps talking: rotate to
        // their next angle (or a wide cutaway) — AutoPod's variety control.
        // 0 disables (default).
        const maxShotSec = a["max-shot"] != null ? Number(a["max-shot"]) : 0;
        const outputName = (a["output-name"] as string) || `${srcSeq.name} (Multicam)`;

        const plan = await computeMulticamRuns(
          srcSeq,
          cameras,
          { wideRatio, cooldownSec, minSpeechSec, silThresh, maxShotSec },
          (src) => resolveWorkspaceMediaPath(ws, src),
        );
        if (!plan.ok) { emit({ ok: false, error: plan.error }); break; }
        const { runs, totalFrames, vadMode, wideIndices, speakerIndices,
          camAudioClips, camTrackClips, fileForSource, seqDur } = plan;
        const STATE_FPS = MULTICAM_STATE_FPS;

        // Step 3: convert frame runs to timeline clips and build the output
        // sequence. Every clip is placed at its SEQUENCE-TIME position — never
        // an accumulated cursor — so coverage gaps stay gaps and the video can
        // never drift against the audio bed.
        const outSeq: Sequence = {
          id: newSeqId(),
          name: outputName,
          description: `Multi-camera edit from "${srcSeq.name}"`,
          settings: { ...srcSeq.settings },
          clips: [],
        };

        // Source clips per camera video track (sorted by start time).
        const clipsByTrack = new Map<string, typeof srcSeq.clips>();
        for (const cam of cameras) {
          clipsByTrack.set(
            cam.video_track,
            srcSeq.clips.filter((c) => c.track === cam.video_track).sort((a2, b) => a2.start_time_seconds - b.start_time_seconds)
          );
        }

        const addedClipIds: string[] = [];
        let segmentsSkipped = 0;
        const skipReasons: string[] = [];
        // Markers to annotate which speaker/camera is on screen at each cut.
        const outputMarkers: SequenceMarker[] = [];
        const markerColors: MarkerColor[] = ["green", "blue", "cyan", "orange", "violet", "yellow", "red", "white"];

        for (const run of runs) {
          const cam = cameras[run.camIdx];
          if (!cam) continue;
          const seqStart = run.startFrame / STATE_FPS;
          const seqEnd = Math.min(run.endFrame / STATE_FPS, seqDur);
          if (seqEnd - seqStart < 0.02) continue;

          // A run may span several source clips on the camera's track (or hit a
          // gap). Emit one output clip per overlapping source segment, each at
          // its own sequence position.
          let covered = false;
          for (const srcClip of clipsByTrack.get(cam.video_track) || []) {
            const clipStart = srcClip.start_time_seconds;
            const clipEnd = clipTimelineEnd(srcClip);
            const segStart = Math.max(seqStart, clipStart);
            const segEnd = Math.min(seqEnd, clipEnd);
            if (segEnd - segStart < 0.02) continue;
            const speed = srcClip.speed || 1.0;
            const trimStart = srcClip.trim_start_seconds + (segStart - clipStart) * speed;
            const trimEnd = Math.min(trimStart + (segEnd - segStart) * speed, srcClip.trim_end_seconds);
            const op: any = {
              track: "V1",
              source: srcClip.source_path,
              position_seconds: segStart,
              trim_start_seconds: trimStart,
              trim_end_seconds: trimEnd,
              speed,
              // video_only: the audio bed is laid down separately below. Without
              // this, addClips auto-pairs each camera segment's own audio onto
              // A1 — stacking a second, switching audio track on top of the mix.
              video_only: true,
              ...(srcClip.label_color ? { label_color: srcClip.label_color } : {}),
            };
            try {
              const res = await addClips(ws, outSeq, [op]);
              addedClipIds.push(...res.created.map((c) => c.id));
              covered = true;
            } catch (e) {
              segmentsSkipped++;
              if (skipReasons.length < 5) skipReasons.push((e as Error).message);
            }
          }
          if (!covered) segmentsSkipped++;

          outputMarkers.push({
            id: `mc-${run.startFrame}-${run.camIdx}`,
            time_seconds: Math.round(seqStart * 100) / 100,
            duration_seconds: Math.round((seqEnd - seqStart) * 100) / 100,
            label: cam.name || `Camera ${run.camIdx + 1}`,
            color: markerColors[run.camIdx % markerColors.length],
          });
        }
        outSeq.markers = outputMarkers;

        // Audio bed. AutoPod parity requires EVERY mic in the result — using only
        // camera 1's audio makes the other speakers inaudible unless a room mic
        // caught them. So: render a deterministic ffmpeg amix of all solo-camera
        // mics (time-aligned via each clip's position/trim) and lay THAT on A1.
        // Falls back to copying the first solo camera's audio when mixing fails.
        let audioMixFile: string | undefined;
        try {
          // One mix input per distinct mic recording across ALL solo cameras'
          // audio tracks (multi-mic speakers contribute every mic; angle groups
          // sharing a mic contribute it once).
          const mixClips: Clip[] = [];
          const seenMixSources = new Set<string>();
          for (const i of speakerIndices) {
            for (const list of camTrackClips[i]) {
              const clip = list[0]; // standard podcast setup: one clip per mic
              if (!clip || seenMixSources.has(clip.source_path)) continue;
              seenMixSources.add(clip.source_path);
              mixClips.push(clip);
            }
          }
          if (mixClips.length >= 2) {
            const inputs: string[] = [];
            const filters: string[] = [];
            mixClips.forEach((clip, k) => {
              inputs.push("-i", fileForSource.get(clip.source_path)!);
              const delayMs = Math.max(0, Math.round(clip.start_time_seconds * 1000));
              filters.push(
                `[${k}:a]atrim=${clip.trim_start_seconds}:${clip.trim_end_seconds},` +
                `asetpts=PTS-STARTPTS,adelay=${delayMs}|${delayMs}[m${k}]`,
              );
            });
            const mixDir = path.join(workspaceDir(ws), "renders");
            await fs.mkdir(mixDir, { recursive: true });
            const mixOut = path.join(mixDir, `${outputName.replace(/[^\w.-]+/g, "_")}.mix.wav`);
            const chain = `${filters.join(";")};${mixClips.map((_, k) => `[m${k}]`).join("")}` +
              `amix=inputs=${mixClips.length}:normalize=0[out]`;
            await _pexecFile(FFMPEG, [
              "-y", "-v", "error", ...inputs,
              "-filter_complex", chain, "-map", "[out]",
              "-ar", "48000", "-ac", "2", mixOut,
            ]);
            audioMixFile = mixOut;
          }
        } catch { audioMixFile = undefined; }

        let audioClipsAdded = 0;
        if (audioMixFile) {
          try {
            await addClips(ws, outSeq, [{
              track: "A1", source: audioMixFile, position_seconds: 0,
              trim_start_seconds: 0, trim_end_seconds: seqDur, video_only: false,
            }]);
            audioClipsAdded++;
          } catch { audioMixFile = undefined; /* fall through to single-mic bed */ }
        }
        if (!audioMixFile) {
          // Fallback bed: first solo camera's audio at its ORIGINAL sequence
          // positions (gaps preserved) so it lines up with the video cuts.
          for (const ac of camAudioClips[speakerIndices[0]]) {
            const op: any = {
              track: "A1",
              source: ac.source_path,
              position_seconds: ac.start_time_seconds,
              trim_start_seconds: ac.trim_start_seconds,
              trim_end_seconds: ac.trim_end_seconds,
              speed: ac.speed || 1.0,
              volume_db: ac.volume_db ?? 0,
              video_only: false,
            };
            try {
              await addClips(ws, outSeq, [op]);
              audioClipsAdded++;
            } catch (e) {
              segmentsSkipped++;
              if (skipReasons.length < 5) skipReasons.push((e as Error).message);
            }
          }
        }

        const savedPath = await saveSequence(ws, outSeq);
        const actualWideFrames = runs.filter((r) => wideIndices.has(r.camIdx))
          .reduce((s, r) => s + (r.endFrame - r.startFrame), 0);
        const actualWideRatio = totalFrames > 0
          ? Math.round((actualWideFrames / totalFrames) * 100) / 100
          : 0;
        emit({
          ok: true,
          sequence_id: outSeq.id,
          name: outSeq.name,
          cameras: cameras.length,
          ...(camerasAutoDetected ? {
            cameras_auto_detected: true,
            camera_config: cameras,
          } : {}),
          runs: runs.length,
          cuts: runs.length - 1,
          clips_added: addedClipIds.length,
          audio_clips_added: audioClipsAdded,
          ...(segmentsSkipped > 0 ? {
            segments_skipped: segmentsSkipped,
            skip_reasons: skipReasons,
            warning: `${segmentsSkipped} segment(s) could not be placed — the timeline has gaps where a camera had no footage or a source was unreadable.`,
          } : {}),
          duration_seconds: Math.round(sequenceDuration(outSeq) * 100) / 100,
          target_wide_ratio: wideRatio,
          actual_wide_ratio: actualWideRatio,
          cooldown_seconds: cooldownSec,
          vad_mode: vadMode,
          ...(audioMixFile ? { audio_mix_file: audioMixFile } : {}),
          path: savedPath,
          note: `Multi-camera edit created with ${runs.length - 1} camera cuts. Colored markers show each speaker.` +
            (audioMixFile
              ? ` All mics were mixed into ${path.basename(audioMixFile)} and placed on A1 — in Premiere, drop that file onto A1 (the .prproj carries video only).`
              : "") +
            " Export to Premiere to review.",
        });
        break;
      }

      // ── AutoPod-parity: Social Clip Creator ─────────────────────────────────
      case "sequence-social-clips": {
        // AutoPod Social Clip Creator equivalent: generate optimized clips for
        // social media in all three aspect ratios from a single source sequence.
        // Creates up to 3 new sequences (one per orientation) with auto-reframe,
        // optional watermark, and optional end-page clip appended.
        //
        //   --workspace W --sequence-id ID
        //   [--orientations '["vertical","square","horizontal"]']  default: all three
        //   [--watermark <path.png>]       watermark image to overlay on all clips (placed V3)
        //   [--end-page <path.png>]        image to append as an end card
        //   [--end-page-duration 4]        end card duration in seconds (default 4)
        //   [--subjects '{"clipId":{"x":0.5,"y":0.4}}']  subject bias for reframe
        //   [--name-prefix "Podcast Ep3"]  prefix for sequence names
        //
        // Output: one new sequence per orientation, each exported-ready.
        const ws = a.workspace || fail("--workspace required");
        const srcSeq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));

        const orientRaw: string[] = a.orientations
          ? (Array.isArray(a.orientations) ? a.orientations : JSON.parse(a.orientations))
          : ["vertical", "square", "horizontal"];
        const orientations = orientRaw.filter((o) => ["vertical", "square", "horizontal"].includes(o)) as Orientation[];
        if (orientations.length === 0) fail("--orientations must include at least one of: vertical, square, horizontal");

        const watermarkPath: string | null = a.watermark ? String(a.watermark) : null;
        const endPagePath: string | null = a["end-page"] ? String(a["end-page"]) : null;
        const endPageDur = a["end-page-duration"] != null ? Number(a["end-page-duration"]) : 4;
        const namePrefix = (a["name-prefix"] as string) || srcSeq.name;

        let subjects: Record<string, { x: number; y: number }> = {};
        if (a.subjects) { try { subjects = JSON.parse(a.subjects); } catch { /* ignore */ } }

        const createdSequences: { orientation: string; sequence_id: string; name: string; settings: string }[] = [];

        for (const orient of orientations) {
          const canvas = orientationCanvas(orient);
          const linkRemap = new Map<string, string>();

          // Clone + reframe.
          const clone: Sequence = {
            id: newSeqId(),
            name: `${namePrefix} (${orient})`,
            description: `Social clip from "${srcSeq.name}" — ${orient} ${canvas.width}×${canvas.height}`,
            settings: { ...srcSeq.settings, width: canvas.width, height: canvas.height },
            clips: srcSeq.clips.map((c) => {
              const copy: typeof c = { ...c, id: newClipId() };
              if (copy.link_id) {
                if (!linkRemap.has(copy.link_id)) linkRemap.set(copy.link_id, newClipId("lnk"));
                copy.link_id = linkRemap.get(copy.link_id)!;
              }
              if (isVideoTrack(c.track) && c.source_width && c.source_height && copy.transform) {
                const subj = subjects[c.id] || { x: 0.5, y: 0.5 };
                const f = fillTransform(c.source_width, c.source_height, canvas.width, canvas.height, subj.x, subj.y);
                copy.transform = { ...copy.transform, scale: { x: f.scale, y: f.scale }, position: f.position };
              }
              return copy;
            }),
            captions: srcSeq.captions ? [...srcSeq.captions.map((c) => ({ ...c, id: newClipId() }))] : undefined,
            transitions: srcSeq.transitions ? [...srcSeq.transitions.map((t) => ({ ...t, id: newClipId() }))] : undefined,
            markers: srcSeq.markers ? [...srcSeq.markers] : undefined,
          };

          const seqDuration = sequenceDuration(clone);

          // Add watermark as an image clip on V3 spanning the full sequence.
          if (watermarkPath) {
            const wmAbs = watermarkPath.startsWith("/")
              ? watermarkPath
              : path.join(workspaceDir(ws), watermarkPath);
            try {
              await addClips(ws, clone, [{
                track: "V3",
                source: wmAbs,
                position_seconds: 0,
                trim_start_seconds: 0,
                trim_end_seconds: seqDuration,
                video_only: true,
                scale_x: 0.15, // 15% of canvas width — typical watermark size
                scale_y: 0.15,
                position_x: canvas.width - Math.round(canvas.width * 0.15) - 20,
                position_y: 20,
              }]);
            } catch { /* watermark file not found — skip */ }
          }

          // Add end page image clip on V1 (and V2 if watermark) after the content.
          if (endPagePath) {
            const epAbs = endPagePath.startsWith("/")
              ? endPagePath
              : path.join(workspaceDir(ws), endPagePath);
            try {
              // Reframe the end page to fill the canvas.
              await addClips(ws, clone, [{
                track: "V1",
                source: epAbs,
                position_seconds: seqDuration,
                trim_start_seconds: 0,
                trim_end_seconds: endPageDur,
                video_only: true,
              }]);
              // Also place watermark on the end page if requested.
              if (watermarkPath) {
                const wmAbs = watermarkPath.startsWith("/")
                  ? watermarkPath
                  : path.join(workspaceDir(ws), watermarkPath);
                try {
                  await addClips(ws, clone, [{
                    track: "V3",
                    source: wmAbs,
                    position_seconds: seqDuration,
                    trim_start_seconds: 0,
                    trim_end_seconds: endPageDur,
                    video_only: true,
                    scale_x: 0.15,
                    scale_y: 0.15,
                    position_x: canvas.width - Math.round(canvas.width * 0.15) - 20,
                    position_y: 20,
                  }]);
                } catch { /* skip */ }
              }
            } catch { /* end page file not found — skip */ }
          }

          await saveSequence(ws, clone);
          createdSequences.push({
            orientation: orient,
            sequence_id: clone.id,
            name: clone.name,
            settings: `${canvas.width}×${canvas.height}`,
          });
        }

        emit({
          ok: true,
          source_sequence: srcSeq.name,
          created: createdSequences,
          watermark: watermarkPath ? "applied" : "none",
          end_page: endPagePath ? `${endPageDur}s appended` : "none",
          note: `Created ${createdSequences.length} social clip sequence(s). Export each to Premiere for delivery.`,
        });
        break;
      }

      // ── CastCut project management ──────────────────────────────────────────
      case "castcut-projects-list": {
        const projects = await listCastCutProjects();
        emit({ ok: true, projects });
        break;
      }

      case "castcut-project-create": {
        const name = (a.name as string) || fail("--name required");
        const workspace = (a.workspace as string) || fail("--workspace required");
        const id = `cc${Date.now().toString(36)}`;
        const proj: CastCutProject = {
          id, name, workspace,
          sequence_id: a["sequence-id"] || null,
          cameras: [],
          settings: {
            wide_ratio: 0.15,
            cooldown: 1.5,
            silence_threshold: -35,
            jump_cut_enabled: false,
            jump_cut_threshold: -40,
            jump_cut_min_silence: 0.3,
          },
          created_at: Date.now(),
          updated_at: Date.now(),
          last_output_seq_id: null,
        };
        const savedPath = await saveCastCutProject(proj);
        emit({ ok: true, project: proj, path: savedPath });
        break;
      }

      case "castcut-project-save": {
        const raw = a.project || fail("--project required (JSON)");
        const proj: CastCutProject = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!proj.id) fail("project.id required");
        const savedPath = await saveCastCutProject(proj);
        emit({ ok: true, project: proj, path: savedPath });
        break;
      }

      case "castcut-project-load": {
        const id = a.id || fail("--id required");
        const proj = await loadCastCutProject(id);
        emit({ ok: true, project: proj });
        break;
      }

      case "castcut-project-delete": {
        const id = a.id || fail("--id required");
        await deleteCastCutProject(id);
        emit({ ok: true, deleted: id });
        break;
      }

      case "castcut-workspace-setup": {
        // Create a workspace from scratch for CastCut — no AI editor needed.
        // Optionally symlinks provided footage and creates a blank sequence.
        //
        //   --workspace <name>          workspace name (will be created if absent)
        //   [--files <paths...>]        footage to symlink into source/
        //   [--folder <dir>]            folder of footage to add (recursive)
        //   [--sequence-name <name>]    auto-create a sequence with this name
        //   [--framerate 30]            sequence framerate (default 30)
        //   [--orientation horizontal]  sequence orientation (default horizontal)
        const ws = (a.workspace as string) || fail("--workspace required");
        await ensureWorkspace(ws);

        // Add footage if provided
        const added: string[] = [];
        const MEDIA_RE = /\.(mp4|mov|mkv|webm|avi|m4v|mp3|wav|aac|flac|m4a)$/i;
        let mediaFiles: string[] = Array.isArray(a.files) ? [...(a.files as string[])] : [];
        if (a.folder) {
          const walk = async (dir: string, depth: number): Promise<void> => {
            let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
            for (const e of entries) {
              if (e.name.startsWith("._") || e.name.startsWith(".")) continue;
              const full = path.join(dir, e.name);
              if (e.isDirectory() && depth > 0) await walk(full, depth - 1);
              else if (e.isFile() && MEDIA_RE.test(e.name)) mediaFiles.push(full);
            }
          };
          await walk(a.folder as string, 3);
        }
        for (const f of mediaFiles) {
          try {
            const base = path.basename(f);
            if (base.startsWith("._") || base.startsWith(".")) continue;
            const stat = await fs.stat(f);
            if (!stat.isFile()) continue;
            const type = base.match(/\.(mp4|mov|mkv|webm|avi|m4v)$/i) ? "video" : "audio";
            const destDir = path.join(workspaceDir(ws), "source", type);
            await fs.mkdir(destDir, { recursive: true });
            const dest = path.join(destDir, base);
            try { await fs.unlink(dest); } catch { /* ok */ }
            await fs.symlink(path.resolve(f), dest);
            added.push(path.join("source", type, base));
          } catch { /* skip */ }
        }

        // Auto-create a blank sequence if requested
        let seqId: string | null = null;
        let seqName: string | null = null;
        if (a["sequence-name"]) {
          const orient = (a.orientation as string) || "horizontal";
          const { width, height } = orientationCanvas(orient as Orientation);
          const framerate = Number(a.framerate) || 30;
          const seq: Sequence = {
            id: newSeqId(),
            name: a["sequence-name"] as string,
            description: "",
            settings: { width, height, framerate, sample_rate: 48000, color_space: "bt709" },
            clips: [],
          };
          await saveSequence(ws, seq);
          seqId = seq.id;
          seqName = seq.name;
        }

        emit({
          ok: true,
          workspace: ws,
          workspace_dir: workspaceDir(ws),
          footage_added: added.length,
          footage: added,
          sequence_id: seqId,
          sequence_name: seqName,
          note: `Workspace "${ws}" ready.${added.length ? ` ${added.length} file(s) linked.` : ""}${seqId ? ` Sequence "${seqName}" created.` : ""}`,
        });
        break;
      }

      case "kb-list": {
        // List the professional-editor knowledge base docs (titles + when to read).
        const dir = kbDir();
        const docs: { id: string; title: string; read_when: string }[] = [];
        try {
          for (const f of (await fs.readdir(dir)).sort()) {
            if (!f.endsWith(".md")) continue;
            const id = f.replace(/\.md$/, "");
            docs.push({ id, title: KB_TITLES[id]?.title || id, read_when: KB_TITLES[id]?.when || "" });
          }
        } catch { /* dir missing */ }
        emit({ ok: true, docs });
        break;
      }

      case "kb-read": {
        // Read one knowledge-base doc by id (e.g. recap-videos). Token-efficient:
        // the agent loads only the doc relevant to the current project type.
        const id = (a.id || a.doc || fail(
          "--id <doc-id> required. " +
          "First run kb-list to see available docs, then pass the id here, " +
          "e.g. kb-read --id recap-videos"
        )).replace(/[^a-z0-9-]/gi, "");
        const p = path.join(kbDir(), `${id}.md`);
        try {
          emit({ ok: true, id, content: await fs.readFile(p, "utf8") });
        } catch {
          fail(`No knowledge-base doc "${id}". Run kb-list to see available docs.`);
        }
        break;
      }

      default:
        fail(
          `Unknown command "${cmd}". Commands: sequence-create, sequences-list, ` +
          `sequence-inspect, media-info, sequence-clips-add, sequence-clips-update, ` +
          `sequence-clips-remove, sequence-captions-add, sequence-captions-remove, ` +
          `sequence-captions-list, sequence-transitions-add, sequence-transitions-remove, ` +
          `sequence-transitions-list, sequence-markers-add, sequence-markers-remove, ` +
          `sequence-markers-list, sequence-export-premiere, sequence-import-prproj, ` +
          `prproj-analyze, sequence-reframe, sequence-analyze, style-learn, ` +
          `media-frames, media-frames-batch, content-set, content-list, ` +
          `source-add, sources-list, source-localize, source-remove, source-relink, ` +
          `source-clear, memory-read, memory-append, criteria-get, criteria-set, ` +
          `transcript-import, transcript-list, transcript-get, transcript-search, ` +
          `analyze-music, analyze-video, modes-list, mode-get, preset-save, preset-delete, ` +
          `kb-list, kb-read`,
        );
    }
  } catch (e) {
    fail((e as Error).message);
  }
}

main();
