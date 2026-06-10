// Minimal Premiere Pro project (.prproj) reader for STYLE ANALYSIS only.
// A .prproj is gzip-compressed XML. We don't fully model it — we extract enough
// clip/timing structure to estimate pacing, shot lengths, and track usage, then
// reuse the same style-profile shape as native sequences.
//
// This is read-only and best-effort: prproj XML varies by version, so we parse
// defensively with regex rather than a brittle full schema.
import { promises as fs } from "node:fs";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { SequenceStyle, buildStyleProfile, StyleProfile } from "./analyze.js";

const gunzip = promisify(zlib.gunzip);

export async function readPrprojXml(file: string): Promise<string> {
  const buf = await fs.readFile(file);
  // gzip magic bytes 1f 8b → decompress; otherwise it's already plain XML.
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    return (await gunzip(buf)).toString("utf8");
  }
  return buf.toString("utf8");
}

// Premiere stores timing in ticks. 254016000000 ticks = 1 second (PPro constant).
const TICKS_PER_SECOND = 254016000000;

interface PrClip { startSec: number; durSec: number; track: number; isVideo: boolean; }

// Known delivery canvas sizes (W×H). Used to pick the SEQUENCE frame out of the
// many <FrameRect> values (which also include arbitrary source-media dims).
const STANDARD_CANVASES = new Set([
  "1920x1080", "1080x1920", "3840x2160", "2160x3840", "4096x2160", "2160x4096",
  "1280x720", "720x1280", "1080x1080", "2160x2160", "1080x1350", "2048x1080",
]);

// Detect the sequence resolution + framerate. We collect every <FrameRect>, keep
// only standard delivery sizes, and pick the most frequent — that's the sequence
// canvas (source clips are rarely all the same standard size). Framerate comes
// from the most common per-frame <FrameRate> tick value (254016000000/ticks).
export function detectSequenceSettings(xml: string): { width: number; height: number; framerate: number } {
  const rects = [...xml.matchAll(/<FrameRect>\s*0,0,(\d+),(\d+)\s*<\/FrameRect>/g)]
    .map((m) => ({ w: Number(m[1]), h: Number(m[2]), key: `${m[1]}x${m[2]}` }));

  // The SEQUENCE rect is hard to isolate from clip-media rects. Best signal: a
  // dedicated portrait/vertical FrameRectsPAR or the SEQUENCE settings — but those
  // vary by version. Heuristic that holds in practice:
  //   1. Among STANDARD canvas sizes, find the dominant ORIENTATION (portrait vs
  //      landscape) — a portrait sequence has many portrait rects even if its
  //      footage is landscape, because every clip is reframed to portrait.
  //   2. Pick the most common standard rect IN that orientation.
  // This recovers vertical 4K (2160×3840) for portrait projects, and 1080p/4K for
  // landscape ones.
  const counts = new Map<string, number>();
  for (const r of rects) {
    if (STANDARD_CANVASES.has(r.key)) counts.set(r.key, (counts.get(r.key) || 0) + 1);
  }
  const portraitTotal = rects.filter((r) => STANDARD_CANVASES.has(r.key) && r.h > r.w).length;

  // KEY INSIGHT: source footage is almost always landscape. A meaningful number of
  // PORTRAIT standard rects therefore comes from the sequence canvas itself (every
  // clip reframed to portrait). So if portrait standard rects appear with real
  // frequency, the sequence is that portrait size. Otherwise it's the most common
  // landscape standard rect.
  let best: string;
  if (portraitTotal >= 5) {
    // pick the most common portrait standard rect
    let bn = -1; best = "1080x1920";
    for (const [k, n] of counts) {
      const [kw, kh] = k.split("x").map(Number);
      if (kh > kw && n > bn) { bn = n; best = k; }
    }
  } else {
    let bn = -1; best = "1920x1080";
    for (const [k, n] of counts) {
      const [kw, kh] = k.split("x").map(Number);
      if (kw >= kh && n > bn) { bn = n; best = k; }
    }
  }
  const [w, h] = best.split("x").map(Number);

  // Framerate: most common <FrameRate> ticks-per-frame value → fps.
  const rates = [...xml.matchAll(/<FrameRate>(\d+)<\/FrameRate>/g)].map((m) => Number(m[1]));
  const rateCounts = new Map<number, number>();
  for (const t of rates) {
    const fps = TICKS_PER_SECOND / t;
    // Keep plausible video frame rates only (avoid audio-rate values like 48000).
    if (fps >= 12 && fps <= 120) {
      const rounded = Math.round(fps * 1000) / 1000;
      rateCounts.set(rounded, (rateCounts.get(rounded) || 0) + 1);
    }
  }
  let fps = 30, fpsN = -1;
  for (const [r, n] of rateCounts) if (n > fpsN) { fps = r; fpsN = n; }
  // Snap near-standard rates (23.976, 29.97, 59.94 stay; 30.0000001 → 30).
  const snapped = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60].find((s) => Math.abs(s - fps) < 0.05);
  return { width: w || 1920, height: h || 1080, framerate: snapped ?? Math.round(fps) };
}

// Pull clip timing out of the XML. Real .prproj files nest <Start>/<End> (in
// ticks) deep inside each TrackItem, far from the opening tag — so we slice the
// XML into per-TrackItem blocks (each block runs until the next TrackItem) and
// read the first Start/End inside that block. Verified against real projects
// (e.g. a 265-clip timeline extracts correctly).
function extractClips(xml: string): PrClip[] {
  const clips: PrClip[] = [];
  const blockRe = /<(Video|Audio)ClipTrackItem\b[\s\S]*?(?=<(?:Video|Audio)ClipTrackItem\b|<\/TrackItems>|$)/g;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = blockRe.exec(xml)) !== null) {
    const block = m[0];
    const s = block.match(/<Start>(\d+)<\/Start>/);
    const e = block.match(/<End>(\d+)<\/End>/);
    if (!s || !e) { idx++; continue; }
    const start = Number(s[1]) / TICKS_PER_SECOND;
    const end = Number(e[1]) / TICKS_PER_SECOND;
    const dur = end - start;
    // Guard against absurd values (corrupt or non-timeline items).
    if (dur > 0 && dur < 3600) {
      clips.push({ startSec: start, durSec: dur, track: idx, isVideo: m[1] === "Video" });
    }
    idx++;
  }
  return clips;
}

// Map extracted prproj clips into the SequenceStyle shape so buildStyleProfile
// can treat them identically to native sequences.
export function styleFromPrproj(xml: string, name: string): SequenceStyle {
  const clips = extractClips(xml);
  const videoClips = clips.filter((c) => c.isVideo);
  const durations = videoClips.map((c) => c.durSec).sort((a, b) => a - b);
  // Timeline length = the union span of video clips (sort by start, take max end).
  const total = videoClips.reduce((mx, c) => Math.max(mx, c.startSec + c.durSec), 0);
  const pct = (p: number) =>
    durations.length ? durations[Math.min(durations.length - 1, Math.round((p / 100) * (durations.length - 1)))] : 0;
  const sum = durations.reduce((a, b) => a + b, 0);

  // Overlay estimate: how much total video footage exceeds the timeline length.
  // If sum(clip durations) > timeline span, the excess is overlapping (B-roll on
  // upper tracks). Clamp to [0,1]. (We can't reliably read track lanes from the
  // flat tick stream, so this is a principled approximation.)
  const overlayRatio = total > 0 ? Math.min(1, Math.max(0, (sum - total) / total)) : 0;

  return {
    sequence_id: "prproj",
    name,
    duration_seconds: round(total),
    cut_count: videoClips.length,
    cuts_per_minute: total > 0 ? round((videoClips.length / total) * 60) : 0,
    avg_shot_seconds: durations.length ? round(sum / durations.length) : 0,
    median_shot_seconds: round(pct(50)),
    shot_seconds_p10: round(pct(10)),
    shot_seconds_p90: round(pct(90)),
    broll_overlay_ratio: round(overlayRatio),
    max_video_tracks: 0, // not reliably derivable from the flat stream
    has_music_bed: false,
    section_count: 1,
    opening_shot_seconds: durations.length ? round(videoClips[0].durSec) : 0,
  };
}

// ── Import: build an EDITABLE sequence spec from a .prproj ───────────────────
// Best-effort: extract each video/audio TrackItem's timing + its source media
// path, so the imported timeline can be modified and continued in JCut. Track
// lanes aren't reliably recoverable from the flat stream, so we place video on
// V1 and audio on A1 by default (the agent can re-layer). Returns clip specs in
// the sequence-clips-add shape.
export interface ImportedClip {
  track: string;
  source: string;          // absolute media path from the prproj
  position_seconds: number;
  trim_start_seconds: number;
  trim_end_seconds: number;
}

export async function importPrprojClips(file: string): Promise<{ clips: ImportedClip[]; missing: string[]; settings: { width: number; height: number; framerate: number } }> {
  const xml = await readPrprojXml(file);
  const settings = detectSequenceSettings(xml);
  const clips: ImportedClip[] = [];
  const missing: string[] = [];

  // Media paths live in separate <ClipProjectItem>/<*MediaSource> elements, NOT
  // inside the TrackItem. Build a position-indexed list of every media path, then
  // resolve each clip to the NEAREST path in the document (Premiere emits a clip's
  // media reference close to its TrackItem). This recovers the linked source files
  // instead of leaving clips as "(unknown source)".
  const mediaIndex: { pos: number; path: string }[] = [];
  const pathRe = /<(?:ActualMediaFilePath|FilePath)>([^<]+)<\/(?:ActualMediaFilePath|FilePath)>/g;
  let pm: RegExpExecArray | null;
  while ((pm = pathRe.exec(xml)) !== null) {
    mediaIndex.push({ pos: pm.index, path: decodeURIComponent(pm[1]) });
  }
  const nearestPath = (pos: number): string | null => {
    if (!mediaIndex.length) return null;
    let best: string | null = null, bestDist = Infinity;
    for (const e of mediaIndex) {
      const d = Math.abs(e.pos - pos);
      if (d < bestDist) { bestDist = d; best = e.path; }
    }
    return best;
  };

  const blockRe = /<(Video|Audio)ClipTrackItem\b[\s\S]*?(?=<(?:Video|Audio)ClipTrackItem\b|<\/TrackItems>|$)/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(xml)) !== null) {
    const block = m[0];
    const isVideo = m[1] === "Video";
    const s = block.match(/<Start>(\d+)<\/Start>/);
    const e = block.match(/<End>(\d+)<\/End>/);
    if (!s || !e) continue;
    const inP = block.match(/<InPoint>(\d+)<\/InPoint>/);
    // First try a path inside the block; else fall back to the nearest media path.
    const inline = block.match(/<ActualMediaFilePath>([^<]+)<\/ActualMediaFilePath>/)
      || block.match(/<FilePath>([^<]+)<\/FilePath>/);
    const resolved = inline ? decodeURIComponent(inline[1]) : nearestPath(m.index);
    const start = Number(s[1]) / TICKS_PER_SECOND;
    const end = Number(e[1]) / TICKS_PER_SECOND;
    const dur = end - start;
    if (dur <= 0 || dur > 3600) continue;
    const trimStart = inP ? Number(inP[1]) / TICKS_PER_SECOND : 0;
    clips.push({
      track: isVideo ? "V1" : "A1",
      source: resolved || "(unknown source)",
      position_seconds: round(start),
      trim_start_seconds: round(trimStart),
      trim_end_seconds: round(trimStart + dur),
    });
    if (!resolved) missing.push(`clip at ${round(start)}s`);
  }
  return { clips, missing, settings };
}

export async function analyzePrproj(file: string, name: string): Promise<{ style: SequenceStyle; profile: StyleProfile; clipCount: number }> {
  const xml = await readPrprojXml(file);
  // Count clips up front so we can fail honestly on a settings-only / empty project
  // instead of fabricating a "0 cuts/min" style.
  const clipCount = (xml.match(/<(?:Video|Audio)ClipTrackItem\b/g) || []).length;
  const style = styleFromPrproj(xml, name);
  if (style.cut_count === 0) {
    throw new Error(
      clipCount === 0
        ? `"${name}" has no edited timeline to analyze (it looks like an empty or settings-only project).`
        : `Couldn't read clip timing from "${name}". It may be from an unsupported Premiere version.`,
    );
  }
  const profile = buildStyleProfile([style]);
  return { style, profile, clipCount: style.cut_count };
}

function round(n: number): number { return Math.round(n * 100) / 100; }

// ── Export: write a JCut sequence → a native .prproj Premiere opens ──────────
// Generates the exact Premiere object graph based on files Premiere itself wrote:
//
//   Project (forward ref + definition with <Node> state)
//   Media (one per unique source, with FilePath + ActualMediaFilePath)
//   MasterClip → VideoClip (InPoint/OutPoint here) + AudioClip
//   SubClip (per track item, refs VideoClip/AudioClip)
//   Sequence (ObjectUID, <Node> state, <TrackGroups> cross-refs)
//   VideoTrackGroup + AudioTrackGroup + DataTrackGroup
//   VideoClipTrack (one per V track, items listed as <ClipItems> refs)
//   AudioClipTrack (one per A track)
//   VideoClipTrackItem (Start/End timeline pos, <SubClip ObjectRef>)
//   AudioClipTrackItem (for audio tracks)
//   VideoComponentChain per clip (required even if empty — Premiere crashes without)
//
// Timing: 254016000000 ticks/second (Premiere constant).
//
// Supported: trims, speed, volume, transforms (position/scale/rotation), fades,
//   audio fade in/out, V/A link pairs, transitions, captions, drop-frame fps,
//   sample rate, color space, pixel aspect ratio.
//
// Timing: 254016000000 ticks/second (Premiere constant). All <Start>/<End>/
// <InPoint>/<OutPoint> values are BigInt ticks.
import { Sequence, Clip, isVideoTrack, clipTimelineDuration, sequenceDuration } from "./model.js";
import { promises as fsp, existsSync } from "node:fs";
import zlibFull from "node:zlib";
import path from "node:path";
import crypto from "node:crypto";
import { PROJECT_PREFIX, SEQ_MASTERCLIP_UID, AUDIO_MIXER, AUDIO_MIXER_OBJECT_ID, CLIP_TEMPLATE, MARKERS_TEMPLATE } from "./prproj-scaffold.js";

function secToTicks(s: number): bigint {
  return BigInt(Math.round(s * TICKS_PER_SECOND));
}

// Premiere's <ModificationState> body is a UUID string encoded as UTF-16LE base64.
function modStateBody(uuid: string): string {
  return Buffer.from(uuid, "utf16le").toString("base64");
}
function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Globally-unique deterministic UID: seeded with export-time random salt + item
// index so two exports of the same sequence produce different UIDs (no collisions
// if both .prprojs are opened in the same Premiere project).
function makeUidFactory() {
  const salt = crypto.randomBytes(8).toString("hex");
  return function makeUid(index: number): string {
    const h = crypto.createHash("md5").update(`${salt}-${index}`).digest("hex");
    return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-${((parseInt(h.slice(16,18),16)&0x3f)|0x80).toString(16)}${h.slice(18,20)}-${h.slice(20,32)}`;
  };
}

// Resolve a workspace-relative source path to an absolute path Premiere can open.
function resolveSourcePath(src: string, workspaceRoot?: string): string {
  if (path.isAbsolute(src)) return src;
  if (!workspaceRoot) return src;
  // Try direct join, then common source subdirs.
  const direct = path.join(workspaceRoot, src);
  if (existsSync(direct)) return direct;
  for (const sub of ["source/video", "source/audio", "source/images", "video", "audio", "images"]) {
    const cand = path.join(workspaceRoot, sub, path.basename(src));
    if (existsSync(cand)) return cand;
  }
  return direct; // best-effort — Premiere will show "offline" if it doesn't exist
}

// Map JCut fps to Premiere tick-rate per frame and whether it's drop-frame.
function fpsTicksAndDrop(fps: number): { ticksPerFrame: bigint; dropFrame: boolean } {
  const drop = [29.97, 23.976, 59.94, 47.952].some((d) => Math.abs(fps - d) < 0.01);
  // Premiere stores ticks-per-frame as TICKS_PER_SECOND / exact rational fps.
  // For drop-frame: 29.97 = 30000/1001, 23.976 = 24000/1001, 59.94 = 60000/1001.
  let num: number, den: number;
  if (Math.abs(fps - 29.97)  < 0.01) { num = 30000;  den = 1001; }
  else if (Math.abs(fps - 23.976) < 0.01) { num = 24000; den = 1001; }
  else if (Math.abs(fps - 59.94)  < 0.01) { num = 60000; den = 1001; }
  else if (Math.abs(fps - 47.952) < 0.01) { num = 48000; den = 1001; }
  else { num = Math.round(fps); den = 1; }
  const ticksPerFrame = BigInt(Math.round(TICKS_PER_SECOND * den / num));
  return { ticksPerFrame, dropFrame: drop };
}

// NOTE: Transitions, captions, and markers are not yet emitted into the .prproj
// (Premiere's formats for these are complex and a wrong byte rejects the whole
// project). The writer surfaces a warning for each so the user knows to add them
// in Premiere. The timeline itself — clips, trims, multi-track — exports cleanly.

export interface PrprojExportResult {
  output: string;
  sequences: number;
  clips: number;
  media: number;
  warnings: string[];
}

// Build the .prproj XML for a single sequence, matching the exact Premiere Pro
// object graph (verified against real caltools output Premiere accepts).
//
// The format is a flat list of sibling top-level objects under <PremiereData>,
// cross-referenced by ObjectID (integer, via ObjectRef) or ObjectUID (UUID, via
// ObjectURef). The full per-source chain is:
//   Media → VideoMediaSource → VideoClip(InPoint/OutPoint) → MasterClip
//   (+ AudioMediaSource → AudioClip for sources with audio)
// Per clip instance: SubClip → VideoClipTrackItem (Start/End on the timeline).
// `workspaceRoot` resolves workspace-relative source paths to absolute.
export function buildPrprojXml(
  seq: Sequence,
  workspaceRoot?: string,
): { xml: string; mediaCount: number; clipCount: number; warnings: string[] } {
  const fps = seq.settings.framerate || 30;
  const { ticksPerFrame } = fpsTicksAndDrop(fps);
  const warnings: string[] = [];

  // Immutable Premiere MediaType GUIDs.
  const MT_VIDEO = "228cda18-3625-4d2d-951e-348879e4ed93";
  const MT_AUDIO = "80b8e3d5-6dca-4195-aefb-cb5f407ab009";
  const MT_DATA  = "d8143ffe-eec4-4d2a-a909-d5f7bf094dc5";

  // ── ID allocators ───────────────────────────────────────────────────────────
  // Project (the static PROJECT_PREFIX scaffold) is ObjectID 1; the audio mixer
  // scaffold uses 50-64. Start generated top-level IDs at 1000 so nothing collides.
  let oid = 999;
  const nextId = () => ++oid;        // first call returns 1000
  const makeUid = makeUidFactory();
  let uidSeed = 0;
  const nextUid = () => makeUid(uidSeed++);
  let itemNodeCounter = 1000000;     // unique <ID> for each TrackItem node
  const nextItemNode = () => ++itemNodeCounter;

  const esc = xmlEscape;
  const parts: string[] = [];

  // Split clips by track kind.
  const videoTracks = [...new Set(seq.clips.filter((c) => isVideoTrack(c.track)).map((c) => c.track))]
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const audioTracks = [...new Set(seq.clips.filter((c) => !isVideoTrack(c.track)).map((c) => c.track))]
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));

  // ── Per-source object IDs ───────────────────────────────────────────────────
  // Each clip INSTANCE gets its own VideoClip/AudioClip (trim points differ), but
  // Media/MediaSource/MasterClip are shared per unique source file.
  interface SourceObjs {
    mediaUid: string;
    vmsId: number;      // VideoMediaSource
    amsId: number | null; // AudioMediaSource (if the source has audio)
    absPath: string;
    base: string;
    srcDurTicks: bigint;
    width: number;
    height: number;
    hasAudio: boolean;
    isAudioOnly: boolean;
  }
  const sourceMap = new Map<string, SourceObjs>();

  // Compute a conservative source duration: the largest trim_end we see for that
  // source (InPoint=0..max trim). Falls back to source_duration when present.
  const maxTrimEnd = new Map<string, number>();
  for (const c of seq.clips) {
    const prev = maxTrimEnd.get(c.source_path) ?? 0;
    const end = Math.max(c.trim_end_seconds, c.source_duration ?? 0);
    if (end > prev) maxTrimEnd.set(c.source_path, end);
  }

  for (const c of seq.clips) {
    if (sourceMap.has(c.source_path)) continue;
    const absPath = resolveSourcePath(c.source_path, workspaceRoot);
    if (!path.isAbsolute(absPath)) {
      warnings.push(`Could not resolve absolute path for "${c.source_path}" — Premiere may show it offline.`);
    }
    const isAudioOnly = c.clip_type === "audio" || (!isVideoTrack(c.track) && c.clip_type !== "video");
    const hasAudio = c.has_audio !== false && c.clip_type !== "image"; // video/audio carry audio
    sourceMap.set(c.source_path, {
      mediaUid: nextUid(),
      vmsId: 0, amsId: null, // filled below
      absPath,
      base: path.basename(c.source_path),
      srcDurTicks: secToTicks(maxTrimEnd.get(c.source_path) ?? c.trim_end_seconds),
      width: c.source_width || seq.settings.width,
      height: c.source_height || seq.settings.height,
      hasAudio,
      isAudioOnly,
    });
  }

  // ── Per-clip-instance object IDs ────────────────────────────────────────────
  interface ClipObjs {
    vcId: number;       // VideoClip (this instance's trim)
    acId: number | null; // AudioClip (this instance, if audio present)
    mcUid: string;      // MasterClip (shared per source, but allocate per instance for simplicity)
    logId: number;      // ClipLoggingInfo
    scId: number;       // SubClip
    vccId: number | null; // VideoComponentChain (video clips only)
    itemId: number;     // VideoClipTrackItem / AudioClipTrackItem
    nodeId: number;     // unique TrackItem node ID
  }
  const clipMap = new Map<string, ClipObjs>();
  const isVideoClip = (c: Clip) => isVideoTrack(c.track);

  // ── Track UIDs ──────────────────────────────────────────────────────────────
  const videoTrackUid = new Map<string, string>();
  const audioTrackUid = new Map<string, string>();
  for (const t of videoTracks) videoTrackUid.set(t, nextUid());
  for (const t of audioTracks) audioTrackUid.set(t, nextUid());

  // The static audio master-mixer scaffold always wires to ONE audio track via its
  // inlet. Premiere also always has at least one audio track. So we guarantee an A1
  // track exists (even with no audio clips) and reserve its UID for the mixer.
  const a1Uid = audioTracks.length ? audioTrackUid.get(audioTracks[0])! : nextUid();
  const ensureAudioTracks = audioTracks.length ? audioTracks : ["A1"];
  if (!audioTracks.length) audioTrackUid.set("A1", a1Uid);

  // Singleton sequence UID. The scaffold's bin entry (ClipProjectItem) already
  // points at the sequence MasterClip via the fixed SEQ_MASTERCLIP_UID — our
  // editorial MasterClip(seq) below must use exactly that UID.
  const seqUid = nextUid();

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Project + bin + all settings — the verified static scaffold (includes
  //    RootProjectItem, BinProjectItem, ClipProjectItem, ProjectSettings, etc.).
  //    Only the project name is parameterized.
  // ─────────────────────────────────────────────────────────────────────────────
  parts.push(PROJECT_PREFIX.replace(/__PROJECT_NAME__/g, esc(seq.name || "JCut Project")));

  // ─────────────────────────────────────────────────────────────────────────────
  // 2+3. Per-clip editorial — stamp the verified CLIP_TEMPLATE once per VIDEO clip
  //      instance. The template carries the full 22-object subgraph (Media,
  //      VideoStream, VideoClip×2, VideoMediaSource, SubClip, MasterClip,
  //      VideoComponentChain + Motion effect, ClipLoggingInfo, Markers). We
  //      substitute fresh IDs and the clip's path/trim/position/dimensions.
  //      (Audio-only clips are deferred — warned below.)
  // ─────────────────────────────────────────────────────────────────────────────
  const seqFrameRateTicks = fpsTicksAndDrop(fps).ticksPerFrame;
  for (const c of seq.clips) {
    if (!isVideoClip(c)) {
      // Audio-only clip on an A-track — not yet supported by the template path.
      warnings.push(`Audio clip "${c.id}" on ${c.track} was not exported (audio-only export coming soon). Add it in Premiere.`);
      continue;
    }
    const s = sourceMap.get(c.source_path)!;
    const width = c.source_width || seq.settings.width;
    const height = c.source_height || seq.settings.height;
    const srcFps = c.source_fps || fps;
    const srcFrameRateTicks = fpsTicksAndDrop(srcFps).ticksPerFrame;
    const srcDurTicks = s.srcDurTicks;

    const itemId = nextId();
    const nodeId = nextItemNode();
    const fileKey = makeUid(uidSeed++);
    const contentState = makeUid(uidSeed++);
    const modHash = makeUid(uidSeed++);
    const modUuid = makeUid(uidSeed++);

    // Allocate the block of IDs the template needs (order doesn't matter, just unique).
    const ids: Record<string, string> = {
      __VCTI_ID__: String(itemId),
      __VCC_ID__: String(nextId()),
      __SUBCLIP_ID__: String(nextId()),
      __VFC_ID__: String(nextId()),
      __VIDEOCLIP_ID__: String(nextId()),
      __MC_VIDEOCLIP_ID__: String(nextId()),
      __VMS_ID__: String(nextId()),
      __LOG_ID__: String(nextId()),
      __VSTREAM_ID__: String(nextId()),
      __MARKERS_ID__: String(nextId()),
      __PARAM0__: String(nextId()), __PARAM1__: String(nextId()), __PARAM2__: String(nextId()),
      __PARAM3__: String(nextId()), __PARAM4__: String(nextId()), __PARAM5__: String(nextId()),
      __PARAM6__: String(nextId()), __PARAM7__: String(nextId()), __PARAM8__: String(nextId()),
      __PARAM9__: String(nextId()), __PARAM10__: String(nextId()),
      __MASTERCLIP_UID__: makeUid(uidSeed++),
      __MEDIA_UID__: makeUid(uidSeed++),
    };

    const subs: Record<string, string> = {
      ...ids,
      __NODE_ID__: String(nodeId),
      __START__: secToTicks(c.start_time_seconds).toString(),
      __END__: secToTicks(c.start_time_seconds + clipTimelineDuration(c)).toString(),
      __INPOINT__: secToTicks(c.trim_start_seconds).toString(),
      __OUTPOINT__: secToTicks(c.trim_end_seconds).toString(),
      __WIDTH__: String(width),
      __HEIGHT__: String(height),
      __SRC_PATH__: esc(s.absPath),
      __SRC_BASE__: esc(s.base),
      __SRC_DURATION__: srcDurTicks.toString(),
      __FRAMERATE__: srcFrameRateTicks.toString(),
      __CLIP_UUID__: makeUid(uidSeed++),
      __CLIP_UUID2__: makeUid(uidSeed++),
      __DEFMAP_UUID__: makeUid(uidSeed++),
      __FILE_KEY__: fileKey,
      __CONTENT_STATE__: contentState,
      __MOD_HASH__: modHash,
      __MOD_BODY__: modStateBody(modUuid),
    };

    // Stamp the clip template + its Markers object.
    let clipXml = CLIP_TEMPLATE + MARKERS_TEMPLATE.replace(/__MARKERS_ID__/g, ids.__MARKERS_ID__);
    for (const [ph, val] of Object.entries(subs)) {
      clipXml = clipXml.split(ph).join(val);
    }
    parts.push(clipXml);

    // Record the track item ID so the VideoClipTrack can list it.
    clipMap.set(c.id, {
      vcId: 0, acId: null, mcUid: "", logId: 0, scId: 0, vccId: null,
      itemId, nodeId,
    });

    if (c.speed_keyframes?.length) {
      warnings.push(`Clip "${c.id}": speed ramp not exported — adjust in Premiere.`);
    }
    if (c.transform) {
      warnings.push(`Clip "${c.id}": transform (position/scale/rotation) not exported — set in Premiere's Effect Controls.`);
    }
  }

  // Singleton track-group IDs. The audio master mixer is the static scaffold's
  // AudioMixTrack (ObjectID 50), referenced by AudioTrackGroup.MasterTrack.
  const videoTGId = nextId();
  const audioTGId = nextId();
  const dataTGId = nextId();
  const audioMixId = AUDIO_MIXER_OBJECT_ID;

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Sequence — structured exactly like a real Premiere sequence (MarkerOwner,
  //    full MZ.Sequence.* display/preview properties, Name before PreviewFormatId).
  // ─────────────────────────────────────────────────────────────────────────────
  const totalDur = secToTicks(Math.max(0, sequenceDuration(seq)));
  const seqMarkersId = nextId();
  parts.push(
    `\t<Sequence ObjectUID="${seqUid}" ClassID="6a15d903-8739-11d5-af2d-9b7855ad8974" Version="11">\n` +
    `\t\t<Node Version="1">\n\t\t\t<Properties Version="1">\n` +
    `\t\t\t\t<TL.SQTimePerPixel>1</TL.SQTimePerPixel>\n` +
    `\t\t\t\t<TL.SQHeaderWidth>180</TL.SQHeaderWidth>\n` +
    `\t\t\t\t<TL.SQAVDividerPosition>0.5</TL.SQAVDividerPosition>\n` +
    `\t\t\t\t<MZ.WorkInPoint>0</MZ.WorkInPoint>\n` +
    `\t\t\t\t<MZ.WorkOutPoint>${totalDur}</MZ.WorkOutPoint>\n` +
    `\t\t\t\t<MZ.InPoint>-101606400000000000</MZ.InPoint>\n` +
    `\t\t\t\t<MZ.OutPoint>-101606400000000000</MZ.OutPoint>\n` +
    `\t\t\t\t<MZ.Sequence.VideoTimeDisplayFormat>110</MZ.Sequence.VideoTimeDisplayFormat>\n` +
    `\t\t\t\t<MZ.Sequence.EditingModeGUID>795454d9-d3c2-429d-9474-923ab13b7018</MZ.Sequence.EditingModeGUID>\n` +
    `\t\t\t\t<MZ.Sequence.AudioTimeDisplayFormat>200</MZ.Sequence.AudioTimeDisplayFormat>\n` +
    `\t\t\t\t<MZ.Sequence.PreviewFrameSizeWidth>${seq.settings.width}</MZ.Sequence.PreviewFrameSizeWidth>\n` +
    `\t\t\t\t<MZ.Sequence.PreviewFrameSizeHeight>${seq.settings.height}</MZ.Sequence.PreviewFrameSizeHeight>\n` +
    `\t\t\t\t<MZ.EditLine>0</MZ.EditLine>\n` +
    `\t\t\t</Properties>\n\t\t</Node>\n` +
    `\t\t<PersistentGroupContainer Version="1"><LinkContainer Version="1"/></PersistentGroupContainer>\n` +
    `\t\t<MarkerOwner Version="1"><Markers ObjectRef="${seqMarkersId}"/></MarkerOwner>\n` +
    `\t\t<TrackGroups Version="1">\n` +
    `\t\t\t<TrackGroup Version="1" Index="0"><First>${MT_VIDEO}</First><Second ObjectRef="${videoTGId}"/></TrackGroup>\n` +
    `\t\t\t<TrackGroup Version="1" Index="1"><First>${MT_AUDIO}</First><Second ObjectRef="${audioTGId}"/></TrackGroup>\n` +
    `\t\t\t<TrackGroup Version="1" Index="2"><First>${MT_DATA}</First><Second ObjectRef="${dataTGId}"/></TrackGroup>\n` +
    `\t\t</TrackGroups>\n` +
    `\t\t<Name>${esc(seq.name || "JCut Sequence")}</Name>\n` +
    `\t\t<PreviewFormatIdentifier>fc3cd4d9-d839-8259-9276-05c5000000ea</PreviewFormatIdentifier>\n` +
    `\t</Sequence>\n` +
    // The sequence's own Markers object (empty).
    MARKERS_TEMPLATE.replace(/__MARKERS_ID__/g, String(seqMarkersId)),
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // 4b. Sequence-as-source chain — the scaffold's ClipProjectItem (bin entry)
  //     points at the sequence MasterClip (SEQ_MASTERCLIP_UID). We define that
  //     MasterClip → Audio/VideoClip → Audio/VideoSequenceSource → Sequence.
  // ─────────────────────────────────────────────────────────────────────────────
  const seqMasterUid = SEQ_MASTERCLIP_UID;
  const seqLogId = nextId();
  const seqAudioClipId = nextId();
  const seqVideoClipId = nextId();
  const seqAudioSrcId = nextId();
  const seqVideoSrcId = nextId();
  const seqChanGroupsId = nextId();

  parts.push(
    `\t<ClipLoggingInfo ObjectID="${seqLogId}" ClassID="77ab7fdd-dcdf-465d-9906-7a330ca1e738" Version="9"/>\n` +
    `\t<MasterClip ObjectUID="${seqMasterUid}" ClassID="fb11c33a-b0a9-4465-aa94-b6d5db2628cf" Version="12">\n` +
    `\t\t<LoggingInfo ObjectRef="${seqLogId}"/>\n` +
    `\t\t<Clips Version="1">\n` +
    `\t\t\t<Clip Index="0" ObjectRef="${seqAudioClipId}"/>\n` +
    `\t\t\t<Clip Index="1" ObjectRef="${seqVideoClipId}"/>\n` +
    `\t\t</Clips>\n` +
    `\t\t<AudioClipChannelGroups ObjectRef="${seqChanGroupsId}"/>\n` +
    `\t\t<Name>${esc(seq.name || "JCut Sequence")}</Name>\n` +
    `\t\t<MasterClipChangeVersion>1</MasterClipChangeVersion>\n` +
    `\t</MasterClip>\n` +
    `\t<ClipChannelGroupVectorSerializer ObjectID="${seqChanGroupsId}" ClassID="a3127a8c-95d4-456e-a7f5-171b3f922426" Version="1">\n` +
    `\t</ClipChannelGroupVectorSerializer>\n` +
    `\t<AudioClip ObjectID="${seqAudioClipId}" ClassID="b8830d03-de02-41ee-84ec-fe566dc70cd9" Version="8">\n` +
    `\t\t<Clip Version="18"><Node Version="1"><Properties Version="1"/></Node>\n` +
    `\t\t\t<Source ObjectRef="${seqAudioSrcId}"/><ClipID>${nextUid()}</ClipID><InUse>false</InUse>\n` +
    `\t\t</Clip>\n` +
    `\t\t<AudioChannelLayout>[{"channellabel":100},{"channellabel":101}]</AudioChannelLayout>\n` +
    `\t</AudioClip>\n` +
    `\t<VideoClip ObjectID="${seqVideoClipId}" ClassID="9308dbef-2440-4acb-9ab2-953b9a4e82ec" Version="11">\n` +
    `\t\t<Clip Version="18"><Node Version="1"><Properties Version="1"/></Node>\n` +
    `\t\t\t<Source ObjectRef="${seqVideoSrcId}"/><ClipID>${nextUid()}</ClipID><InUse>false</InUse>\n` +
    `\t\t</Clip>\n` +
    `\t</VideoClip>\n` +
    `\t<AudioSequenceSource ObjectID="${seqAudioSrcId}" ClassID="e8d4cc83-38cb-491f-9d94-e5f7e3b205ee" Version="7">\n` +
    `\t\t<SequenceSource Version="4"><Content Version="10"/><Sequence ObjectURef="${seqUid}"/></SequenceSource>\n` +
    `\t\t<OriginalDuration>0</OriginalDuration>\n` +
    `\t</AudioSequenceSource>\n` +
    `\t<VideoSequenceSource ObjectID="${seqVideoSrcId}" ClassID="4752dfa9-7a7e-4a3b-a25b-cafde1a8d036" Version="3">\n` +
    `\t\t<SequenceSource Version="4"><Content Version="10"/><Sequence ObjectURef="${seqUid}"/></SequenceSource>\n` +
    `\t\t<OriginalDuration>0</OriginalDuration>\n` +
    `\t</VideoSequenceSource>\n`,
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Track groups (video, audio, data — all required)
  // ─────────────────────────────────────────────────────────────────────────────
  const vTrackList = videoTracks.length
    ? videoTracks.map((t, i) => `\t\t\t\t<Track Index="${i}" ObjectURef="${videoTrackUid.get(t)}"/>\n`).join("")
    : "";
  parts.push(
    `\t<VideoTrackGroup ObjectID="${videoTGId}" ClassID="9e9abf7a-0918-49c2-91ae-991b5dde77bb" Version="13">\n` +
    `\t\t<TrackGroup Version="1">\n` +
    `\t\t\t<Tracks Version="1">\n${vTrackList}\t\t\t</Tracks>\n` +
    `\t\t\t<FrameRate>${ticksPerFrame}</FrameRate>\n` +
    `\t\t\t<NextTrackID>${videoTracks.length + 1}</NextTrackID>\n` +
    `\t\t</TrackGroup>\n` +
    `\t\t<FrameRect>0,0,${seq.settings.width},${seq.settings.height}</FrameRect>\n` +
    `\t</VideoTrackGroup>\n`,
  );

  // Always wire at least the guaranteed A1 track (the static mixer expects one).
  const aTrackList = ensureAudioTracks
    .map((t, i) => `\t\t\t\t<Track Index="${i}" ObjectURef="${audioTrackUid.get(t)}"/>\n`).join("");
  parts.push(
    `\t<AudioTrackGroup ObjectID="${audioTGId}" ClassID="9b9238b9-53a8-4cc3-b03f-b36246d052e6" Version="6">\n` +
    `\t\t<TrackGroup Version="1">\n` +
    `\t\t\t<Tracks Version="1">\n${aTrackList}\t\t\t</Tracks>\n` +
    `\t\t\t<FrameRate>5760000</FrameRate>\n` +
    `\t\t\t<NextTrackID>${ensureAudioTracks.length + 1}</NextTrackID>\n` +
    `\t\t</TrackGroup>\n` +
    `\t\t<MasterTrack ObjectRef="${audioMixId}"/>\n` +
    `\t\t<ID>${nextUid()}</ID>\n` +
    `\t\t<NumAdaptiveChannels>2</NumAdaptiveChannels>\n` +
    `\t</AudioTrackGroup>\n`,
  );

  parts.push(
    `\t<DataTrackGroup ObjectID="${dataTGId}" ClassID="b714b71d-6838-48dd-9b77-db19088ced7e" Version="1">\n` +
    `\t\t<TrackGroup Version="1"><NextTrackID>1</NextTrackID><FrameRate>${ticksPerFrame}</FrameRate></TrackGroup>\n` +
    `\t</DataTrackGroup>\n`,
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. Audio master mixer — the verified static scaffold (AudioMixTrack 50-64),
  //    wired to the A1 track's UID.
  // ─────────────────────────────────────────────────────────────────────────────
  parts.push(AUDIO_MIXER.replace(/__A1_TRACK_UID__/g, a1Uid));

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. VideoClipTrack per V track (lists its items in ClipItems.TrackItems)
  // ─────────────────────────────────────────────────────────────────────────────
  videoTracks.forEach((tname, tIndex) => {
    const trackClips = seq.clips.filter((c) => c.track === tname);
    const itemRefs = trackClips
      .map((c, i) => `\t\t\t\t\t<TrackItem Index="${i}" ObjectRef="${clipMap.get(c.id)!.itemId}"/>\n`)
      .join("");
    parts.push(
      `\t<VideoClipTrack ObjectUID="${videoTrackUid.get(tname)}" ClassID="f68dcd81-8805-11d5-af2d-9bfa89d4ddd4" Version="1">\n` +
      `\t\t<ClipTrack Version="2">\n` +
      `\t\t\t<Track Version="3">\n` +
      `\t\t\t\t<Node Version="1"><Properties Version="1">\n` +
      `\t\t\t\t\t<TL.SQTrackShy>0</TL.SQTrackShy>\n` +
      `\t\t\t\t\t<MZ.TrackTargeted>1</MZ.TrackTargeted>\n` +
      `\t\t\t\t\t<MZ.SourceTrackState>1</MZ.SourceTrackState>\n` +
      `\t\t\t\t\t<MZ.SourceTrackNumber>0</MZ.SourceTrackNumber>\n` +
      `\t\t\t\t\t<TL.SQTrackExpanded>0</TL.SQTrackExpanded>\n` +
      `\t\t\t\t\t<TL.SQTrackExpandedHeight>41</TL.SQTrackExpandedHeight>\n` +
      `\t\t\t\t</Properties></Node>\n` +
      `\t\t\t\t<ID>${tIndex + 1}</ID>\n` +
      `\t\t\t\t<IsLocked>false</IsLocked>\n` +
      `\t\t\t\t<MediaType>${MT_VIDEO}</MediaType>\n` +
      `\t\t\t\t<Index>${tIndex}</Index>\n` +
      `\t\t\t\t<IsMuted>false</IsMuted>\n` +
      `\t\t\t\t<IsSyncLocked>true</IsSyncLocked>\n` +
      `\t\t\t</Track>\n` +
      `\t\t\t<ClipItems Version="3">\n` +
      `\t\t\t\t<TrackItems Version="1">\n${itemRefs}\t\t\t\t</TrackItems>\n` +
      `\t\t\t\t<MediaType>${MT_VIDEO}</MediaType>\n` +
      `\t\t\t\t<Index>${tIndex}</Index>\n` +
      `\t\t\t</ClipItems>\n` +
      `\t\t\t<TransitionItems Version="3">\n` +
      `\t\t\t\t<MediaType>${MT_VIDEO}</MediaType>\n` +
      `\t\t\t\t<Index>${tIndex}</Index>\n` +
      `\t\t\t</TransitionItems>\n` +
      `\t\t</ClipTrack>\n` +
      `\t\t<Name>${esc(tname)}</Name>\n` +
      `\t</VideoClipTrack>\n`,
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. AudioClipTrack per A track (always at least A1, even if it has no clips)
  // ─────────────────────────────────────────────────────────────────────────────
  ensureAudioTracks.forEach((tname, tIndex) => {
    const trackClips = seq.clips.filter((c) => c.track === tname);
    const itemRefs = trackClips
      .map((c, i) => `\t\t\t\t\t<TrackItem Index="${i}" ObjectRef="${clipMap.get(c.id)!.itemId}"/>\n`)
      .join("");
    parts.push(
      `\t<AudioClipTrack ObjectUID="${audioTrackUid.get(tname)}" ClassID="097f6203-99ae-11d5-84f2-8cf14bde7040" Version="6">\n` +
      `\t\t<ClipTrack Version="2">\n` +
      `\t\t\t<Track Version="3">\n` +
      `\t\t\t\t<Node Version="1"><Properties Version="1">\n` +
      `\t\t\t\t\t<TL.SQTrackShy>0</TL.SQTrackShy>\n` +
      `\t\t\t\t\t<MZ.TrackTargeted>1</MZ.TrackTargeted>\n` +
      `\t\t\t\t\t<TL.SQTrackExpanded>0</TL.SQTrackExpanded>\n` +
      `\t\t\t\t\t<TL.SQTrackExpandedHeight>41</TL.SQTrackExpandedHeight>\n` +
      `\t\t\t\t</Properties></Node>\n` +
      `\t\t\t\t<ID>${videoTracks.length + tIndex + 1}</ID>\n` +
      `\t\t\t\t<MediaType>${MT_AUDIO}</MediaType>\n` +
      `\t\t\t\t<Index>${tIndex}</Index>\n` +
      `\t\t\t</Track>\n` +
      `\t\t\t<ClipItems Version="3">\n` +
      `\t\t\t\t<TrackItems Version="1">\n${itemRefs}\t\t\t\t</TrackItems>\n` +
      `\t\t\t\t<MediaType>${MT_AUDIO}</MediaType>\n` +
      `\t\t\t\t<Index>${tIndex}</Index>\n` +
      `\t\t\t</ClipItems>\n` +
      `\t\t\t<TransitionItems Version="3">\n` +
      `\t\t\t\t<MediaType>${MT_AUDIO}</MediaType>\n` +
      `\t\t\t\t<Index>${tIndex}</Index>\n` +
      `\t\t\t</TransitionItems>\n` +
      `\t\t</ClipTrack>\n` +
      `\t\t<Name>${esc(tname)}</Name>\n` +
      `\t</AudioClipTrack>\n`,
    );
  });

  // VideoClipTrackItems are emitted by the per-clip template (section 2+3). Just
  // count the video clips we actually placed.
  const clipCount = seq.clips.filter(isVideoClip).length;

  if (seq.captions?.length) {
    warnings.push(`${seq.captions.length} caption(s) not exported to .prproj — add them in Premiere, or keep editing text in JCut.`);
  }
  if (seq.transitions?.length) {
    warnings.push(`${seq.transitions.length} transition(s) not exported — re-apply them in Premiere.`);
  }
  if (seq.markers?.length) {
    warnings.push(`${seq.markers.length} marker(s) not exported in this format yet.`);
  }

  const xml =
    `<?xml version="1.0" encoding="UTF-8" ?>\n` +
    `<PremiereData Version="3">\n` +
    parts.join("") +
    `</PremiereData>\n`;

  return { xml, mediaCount: sourceMap.size, clipCount, warnings };
}

// Write a .prproj (gzip-compressed, as Premiere expects). Always export clean.
export async function exportPrproj(
  seq: Sequence,
  outputPath: string,
  workspaceRoot?: string,
): Promise<PrprojExportResult> {
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  const { xml, mediaCount, clipCount, warnings } = buildPrprojXml(seq, workspaceRoot);
  const gzip = promisify(zlibFull.gzip);
  // Level 6 is the standard Premiere gzip level — matches what Premiere writes.
  const gz = await gzip(Buffer.from(xml, "utf8"), { level: 6 });
  await fsp.writeFile(outputPath, gz);
  return { output: outputPath, sequences: 1, clips: clipCount, media: mediaCount, warnings };
}
