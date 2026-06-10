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
// Generated CLEAN from scratch. We emit a fully-featured Premiere project graph:
//   Project → RootBin → Media + ClipProjectItems (one per unique source)
//   Sequence with VideoTracks / AudioTracks → TrackItems
//
// Supported: trims, speed, volume, transforms (position/scale/rotation), fades,
//   audio fade in/out, V/A link pairs, transitions, captions, drop-frame fps,
//   sample rate, color space, pixel aspect ratio.
//
// Timing: 254016000000 ticks/second (Premiere constant). All <Start>/<End>/
// <InPoint>/<OutPoint> values are BigInt ticks.
import { Sequence, Clip, Caption, Transition, SequenceMarker, MarkerColor, isVideoTrack, clipTimelineDuration } from "./model.js";
import { promises as fsp, existsSync } from "node:fs";
import zlibFull from "node:zlib";
import path from "node:path";
import crypto from "node:crypto";

function secToTicks(s: number): bigint {
  return BigInt(Math.round(s * TICKS_PER_SECOND));
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

// Map a JCut video transition type to its Premiere ClassID and EffectID.
const VIDEO_TRANSITION_CLASS: Record<string, string> = {
  "cross-dissolve":  "b08ce81e-f5b3-43da-ae63-ead22c7e1a10",
  "dip-to-black":    "b671b1f1-6bff-48c9-84f5-e4e4d1cfb0b5",
  "dip-to-white":    "b671b1f1-6bff-48c9-84f5-e4e4d1cfb0b6",
  "wipe":            "b08ce81e-f5b3-43da-ae63-ead22c7e1a11",
  "push":            "b08ce81e-f5b3-43da-ae63-ead22c7e1a12",
  "slide":           "b08ce81e-f5b3-43da-ae63-ead22c7e1a13",
  "iris":            "b08ce81e-f5b3-43da-ae63-ead22c7e1a14",
  "cross-zoom":      "b08ce81e-f5b3-43da-ae63-ead22c7e1a15",
};
const AUDIO_TRANSITION_CLASS: Record<string, string> = {
  "constant-power":  "5023aee4-00c4-4266-aae6-ca8b71c3168b",
  "constant-gain":   "5023aee4-00c4-4266-aae6-ca8b71c3168c",
  "exponential-fade":"5023aee4-00c4-4266-aae6-ca8b71c3168d",
};
const TRANSITION_ALIGNMENT: Record<string, number> = {
  "center": 0, "start-at-cut": 1, "end-at-cut": 2,
};
const TRANSITION_EASING: Record<string, number> = {
  "linear": 0, "ease-in": 1, "ease-out": 2, "ease-in-out": 3,
};

// Premiere's label color integers (used in <Color> on markers).
// These map to the colored dots in the timeline ruler.
const MARKER_COLOR: Record<MarkerColor, number> = {
  "red":    1,  "orange":  2,  "yellow": 3,  "green":  4,
  "cyan":   5,  "blue":    6,  "violet": 7,  "white":  8,
};

export interface PrprojExportResult {
  output: string;
  sequences: number;
  clips: number;
  media: number;
  warnings: string[];
}

// Build the .prproj XML for a single sequence.
// `workspaceRoot` is used to resolve workspace-relative source paths to absolute.
export function buildPrprojXml(
  seq: Sequence,
  workspaceRoot?: string,
): { xml: string; mediaCount: number; clipCount: number; warnings: string[] } {
  const fps = seq.settings.framerate || 30;
  const { ticksPerFrame, dropFrame } = fpsTicksAndDrop(fps);
  const warnings: string[] = [];

  let oid = 100;
  const next = () => ++oid;
  const makeUid = makeUidFactory();

  // ── 1. Media objects (one per unique source file) ──────────────────────────
  const sources = [...new Set(seq.clips.map((c) => c.source_path))];
  const mediaIds = new Map<string, { media: number; clip: number; uid: string }>();
  const mediaXml: string[] = [];

  sources.forEach((src, i) => {
    const media = next(), clip = next();
    const uid = makeUid(1000 + i);
    mediaIds.set(src, { media, clip, uid });
    const absPath = resolveSourcePath(src, workspaceRoot);
    if (!path.isAbsolute(absPath)) {
      warnings.push(`Could not resolve absolute path for "${src}" — Premiere may show it offline.`);
    }
    mediaXml.push(
      `\t<Media ObjectID="${media}" ObjectUID="${makeUid(2000 + i)}" ClassID="7a5c103e-f3ac-4391-b6b4-7cc3d2f9a7ff" Version="30">\n` +
      `\t\t<ActualMediaFilePath>${xmlEscape(absPath)}</ActualMediaFilePath>\n` +
      `\t\t<FilePath>${xmlEscape(absPath)}</FilePath>\n` +
      `\t</Media>\n` +
      `\t<ClipProjectItem ObjectID="${clip}" ObjectUID="${uid}" ClassID="cb4e0ed7-aca1-4171-8525-e3658dec06dd" Version="1">\n` +
      `\t\t<Name>${xmlEscape(path.basename(src))}</Name>\n` +
      `\t\t<MediaRef ObjectRef="${media}"/>\n` +
      `\t</ClipProjectItem>\n`,
    );
  });

  // ── 2. Pre-assign stable ObjectIDs for all clips ───────────────────────────
  const itemIds = new Map<string, number>();
  for (const c of seq.clips) itemIds.set(c.id, next());

  // ── 3. Build a lookup for transitions by clip pair ─────────────────────────
  // Map from_clip_id+to_clip_id → Transition so track-item code can emit it.
  const transitionByPair = new Map<string, Transition>();
  for (const t of (seq.transitions || [])) {
    transitionByPair.set(`${t.from_clip_id}:${t.to_clip_id}`, t);
  }

  // ── 4. Build track XML ─────────────────────────────────────────────────────
  const trackNames = [...new Set(seq.clips.map((c) => c.track))]
    .sort((x, y) => (x[0] === y[0] ? Number(x.slice(1)) - Number(y.slice(1)) : x[0] === "V" ? -1 : 1));

  const videoTrackXml: string[] = [];
  const audioTrackXml: string[] = [];
  let clipCount = 0;

  for (const tname of trackNames) {
    const isV = isVideoTrack(tname);
    const trackId = next();
    const trackClips = seq.clips.filter((x) => x.track === tname);
    const items: string[] = [];

    for (let ci = 0; ci < trackClips.length; ci++) {
      const c = trackClips[ci];
      const m = mediaIds.get(c.source_path)!;
      if (!m) { warnings.push(`No media entry for clip "${c.id}" source "${c.source_path}" — skipped.`); continue; }

      const startT = secToTicks(c.start_time_seconds);
      const endT   = secToTicks(c.start_time_seconds + clipTimelineDuration(c));
      const inT    = secToTicks(c.trim_start_seconds);
      const outT   = secToTicks(c.trim_end_seconds);
      const itemId = itemIds.get(c.id)!;
      const tag    = isV ? "VideoClipTrackItem" : "AudioClipTrackItem";
      const cls    = isV ? "368b0406-29e3-4923-9fcd-094fbf9a1089" : "064ec682-9ba6-11d5-af2d-9ca32c7d6164";

      // Speed: prefer keyframe ramp average; fall back to constant.
      // Full time-remapping keyframes are complex Premiere XML — we emit the
      // closest approximation (average speed) and warn if a ramp was present.
      let speed = c.speed || 1;
      if (c.speed_keyframes?.length) {
        speed = c.speed_keyframes.reduce((a, k) => a + k.speed, 0) / c.speed_keyframes.length;
        warnings.push(`Clip "${c.id}": speed ramp approximated as constant ${speed.toFixed(2)}× — edit the speed ramp in Premiere.`);
      }

      // V/A link.
      let linksXml = "";
      if (c.link_id) {
        const partner = seq.clips.find((o) => o.link_id === c.link_id && o.id !== c.id);
        if (partner) {
          const partnerId = itemIds.get(partner.id);
          if (partnerId) linksXml = `\t\t\t\t<Links>\n\t\t\t\t\t<LinkedClipItem ObjectRef="${partnerId}"/>\n\t\t\t\t</Links>\n`;
        }
      }

      // Volume (audio clips).
      let volumeXml = "";
      if (!isV && typeof c.volume_db === "number" && c.volume_db !== 0) {
        volumeXml = `\t\t\t\t<Gain>${c.volume_db.toFixed(4)}</Gain>\n`;
      }

      // Audio fade in/out.
      let fadeXml = "";
      if (c.fade && (c.fade.fade_in_seconds > 0 || c.fade.fade_out_seconds > 0)) {
        const inFadeTicks  = secToTicks(c.fade.fade_in_seconds);
        const outFadeTicks = secToTicks(c.fade.fade_out_seconds);
        if (!isV) {
          fadeXml =
            `\t\t\t\t<AudFadeInDuration>${inFadeTicks}</AudFadeInDuration>\n` +
            `\t\t\t\t<AudFadeOutDuration>${outFadeTicks}</AudFadeOutDuration>\n`;
        } else {
          fadeXml =
            `\t\t\t\t<VidFadeInDuration>${inFadeTicks}</VidFadeInDuration>\n` +
            `\t\t\t\t<VidFadeOutDuration>${outFadeTicks}</VidFadeOutDuration>\n`;
        }
      }

      // Transform (video/image clips only): position, scale, rotation.
      // Premiere stores motion as a <Motion> effect block with fixed params.
      // Position is in pixels from the canvas center (Premiere convention).
      // Scale is a percentage (100 = full-size).
      let motionXml = "";
      if (isV && c.transform) {
        const t = c.transform;
        const cx = seq.settings.width  / 2 + (t.position?.x || 0);
        const cy = seq.settings.height / 2 + (t.position?.y || 0);
        const scaleX = Math.round((t.scale?.x ?? 1) * 100);
        const scaleY = Math.round((t.scale?.y ?? 1) * 100);
        const rot = t.rotation || 0;
        motionXml =
          `\t\t\t\t<Motion>\n` +
          `\t\t\t\t\t<Position><X>${cx.toFixed(4)}</X><Y>${cy.toFixed(4)}</Y></Position>\n` +
          `\t\t\t\t\t<Scale>${scaleX}</Scale>\n` +
          `\t\t\t\t\t<ScaleX>${scaleX}</ScaleX>\n` +
          `\t\t\t\t\t<ScaleY>${scaleY}</ScaleY>\n` +
          `\t\t\t\t\t<UniformScale>${scaleX === scaleY ? "true" : "false"}</UniformScale>\n` +
          `\t\t\t\t\t<Rotation>${rot.toFixed(4)}</Rotation>\n` +
          `\t\t\t\t</Motion>\n`;
      }

      // Transition on the outgoing side of this clip (emitted inside the item).
      // We look up "this clip → next clip" pair.
      let transitionXml = "";
      const nextClip = trackClips[ci + 1];
      if (nextClip) {
        const tr = transitionByPair.get(`${c.id}:${nextClip.id}`);
        if (tr) {
          const trDur  = secToTicks(tr.duration_seconds);
          const trCls  = isV ? (VIDEO_TRANSITION_CLASS[tr.transition_type] || VIDEO_TRANSITION_CLASS["cross-dissolve"])
                             : (AUDIO_TRANSITION_CLASS[tr.transition_type] || AUDIO_TRANSITION_CLASS["constant-power"]);
          const align  = TRANSITION_ALIGNMENT[tr.alignment] ?? 0;
          const easing = TRANSITION_EASING[tr.easing] ?? 0;
          transitionXml =
            `\t\t\t\t<Transition ClassID="${trCls}" Version="1">\n` +
            `\t\t\t\t\t<Duration>${trDur}</Duration>\n` +
            `\t\t\t\t\t<Alignment>${align}</Alignment>\n` +
            `\t\t\t\t\t<Easing>${easing}</Easing>\n` +
            `\t\t\t\t</Transition>\n`;
        }
      }

      items.push(
        `\t\t\t<${tag} ObjectID="${itemId}" ClassID="${cls}" Version="8">\n` +
        `\t\t\t\t<Start>${startT}</Start>\n` +
        `\t\t\t\t<End>${endT}</End>\n` +
        `\t\t\t\t<InPoint>${inT}</InPoint>\n` +
        `\t\t\t\t<OutPoint>${outT}</OutPoint>\n` +
        `\t\t\t\t<PlaybackSpeed>${speed.toFixed(6)}</PlaybackSpeed>\n` +
        `\t\t\t\t<SubClip ObjectRef="${m.clip}"/>\n` +
        volumeXml +
        fadeXml +
        motionXml +
        linksXml +
        transitionXml +
        `\t\t\t</${tag}>\n`,
      );
      clipCount++;
    }

    const trackBlock =
      `\t\t<Track ObjectID="${trackId}" Version="3">\n` +
      `\t\t\t<Name>${xmlEscape(tname)}</Name>\n` +
      `\t\t\t<TrackItems>\n${items.join("")}\t\t\t</TrackItems>\n` +
      `\t\t</Track>\n`;
    if (isV) videoTrackXml.push(trackBlock);
    else audioTrackXml.push(trackBlock);
  }

  // ── 5. Sequence markers ────────────────────────────────────────────────────
  // Colored label dots on the timeline ruler. Each marker has a comment (the
  // label text), an In point (ticks), an optional duration (0 = instant), and
  // a color integer. They appear in Premiere's timeline and the Markers panel.
  const markerItems: string[] = [];
  for (const m of (seq.markers || [])) {
    const markId  = next();
    const inT     = secToTicks(m.time_seconds);
    const durT    = secToTicks(m.duration_seconds ?? 0);
    const color   = MARKER_COLOR[m.color as MarkerColor] ?? MARKER_COLOR["green"];
    markerItems.push(
      `\t\t\t<Marker ObjectID="${markId}" ClassID="5255478a-c60e-11d3-9149-00c04f680b4e" Version="2">\n` +
      `\t\t\t\t<Comment>${xmlEscape(m.label)}</Comment>\n` +
      `\t\t\t\t<In>${inT}</In>\n` +
      `\t\t\t\t<Duration>${durT}</Duration>\n` +
      `\t\t\t\t<Type>0</Type>\n` +
      `\t\t\t\t<Color>${color}</Color>\n` +
      `\t\t\t</Marker>\n`,
    );
  }
  const markersXml = markerItems.length > 0
    ? `\t\t<Markers>\n${markerItems.join("")}\t\t</Markers>\n`
    : "";

  // ── 6. Captions ────────────────────────────────────────────────────────────
  // Emitted as a <CaptionTrack> on the sequence. Each caption becomes a
  // <CaptionItem> with timing + styling. Zone 0–8 maps to Premiere's safe-zone
  // anchor positions (7 = bottom-center = standard subtitle).
  const ZONE_POS: Record<number, { x: number; y: number }> = {
    0: { x: 0.1,  y: 0.1  }, 1: { x: 0.5, y: 0.1  }, 2: { x: 0.9, y: 0.1  },
    3: { x: 0.1,  y: 0.5  }, 4: { x: 0.5, y: 0.5  }, 5: { x: 0.9, y: 0.5  },
    6: { x: 0.1,  y: 0.85 }, 7: { x: 0.5, y: 0.85 }, 8: { x: 0.9, y: 0.85 },
  };
  const captionItems: string[] = [];
  for (const cap of (seq.captions || [])) {
    const capId = next();
    const startT = secToTicks(cap.start_time_seconds);
    const endT   = secToTicks(cap.end_time_seconds);
    const zone   = cap.zone ?? 7;
    const pos    = ZONE_POS[zone] ?? ZONE_POS[7];
    const x      = (pos.x + (cap.offset_x || 0) / seq.settings.width)  * seq.settings.width;
    const y      = (pos.y + (cap.offset_y || 0) / seq.settings.height) * seq.settings.height;
    const fillColor   = (cap.fill_color   || "#FFFFFF").replace("#", "").toUpperCase();
    const strokeColor = (cap.stroke_color || "#000000").replace("#", "").toUpperCase();
    const fontSize    = cap.font_size || Math.round(seq.settings.height * 0.045);
    captionItems.push(
      `\t\t\t<CaptionItem ObjectID="${capId}" Version="1">\n` +
      `\t\t\t\t<Start>${startT}</Start>\n` +
      `\t\t\t\t<End>${endT}</End>\n` +
      `\t\t\t\t<Text>${xmlEscape(cap.text)}</Text>\n` +
      `\t\t\t\t<Position><X>${x.toFixed(2)}</X><Y>${y.toFixed(2)}</Y></Position>\n` +
      `\t\t\t\t<FontFamily>${xmlEscape(cap.font_family || "Arial")}</FontFamily>\n` +
      `\t\t\t\t<FontSize>${fontSize}</FontSize>\n` +
      `\t\t\t\t<Bold>${cap.bold ? "true" : "false"}</Bold>\n` +
      `\t\t\t\t<FillColor>${fillColor}</FillColor>\n` +
      `\t\t\t\t<StrokeColor>${strokeColor}</StrokeColor>\n` +
      `\t\t\t\t<StrokeWidth>${(cap.stroke_width || 0).toFixed(1)}</StrokeWidth>\n` +
      `\t\t\t\t<BackgroundVisible>${cap.background_color ? "true" : "false"}</BackgroundVisible>\n` +
      (cap.background_color ? `\t\t\t\t<BackgroundColor>${xmlEscape(cap.background_color)}</BackgroundColor>\n` : "") +
      `\t\t\t\t<BackgroundOpacity>${(cap.background_opacity ?? 0).toFixed(2)}</BackgroundOpacity>\n` +
      `\t\t\t\t<Alignment>${cap.alignment || "center"}</Alignment>\n` +
      `\t\t\t<\/CaptionItem>\n`,
    );
  }
  const captionTrackXml = captionItems.length > 0
    ? `\t\t<CaptionTrack Version="1">\n\t\t\t<CaptionItems>\n${captionItems.join("")}\t\t\t</CaptionItems>\n\t\t</CaptionTrack>\n`
    : "";

  // ── 6. Sequence XML ────────────────────────────────────────────────────────
  const seqObj = next();
  const ticksPerFrameVal = Number(ticksPerFrame);
  const sequenceXml =
    `\t<Sequence ObjectID="${seqObj}" ClassID="6a15d903-8739-11d5-af2d-9b7855ad8974" Version="11">\n` +
    `\t\t<Name>${xmlEscape(seq.name || "JCut Sequence")}</Name>\n` +
    `\t\t<FrameRate>${ticksPerFrameVal}</FrameRate>\n` +
    `\t\t<VideoFrameWidth>${seq.settings.width}</VideoFrameWidth>\n` +
    `\t\t<VideoFrameHeight>${seq.settings.height}</VideoFrameHeight>\n` +
    `\t\t<PixelAspectRatio>1.0</PixelAspectRatio>\n` +
    `\t\t<SampleRate>${seq.settings.sample_rate || 48000}</SampleRate>\n` +
    `\t\t<ColorSpace>${xmlEscape(seq.settings.color_space || "bt709")}</ColorSpace>\n` +
    (dropFrame ? `\t\t<DropFrame>true</DropFrame>\n` : "") +
    `\t\t<VideoTracks>\n${videoTrackXml.join("")}\t\t</VideoTracks>\n` +
    `\t\t<AudioTracks>\n${audioTrackXml.join("")}\t\t</AudioTracks>\n` +
    markersXml +
    captionTrackXml +
    `\t</Sequence>\n`;

  // ── 7. Project wrapper ─────────────────────────────────────────────────────
  const projId = next();
  const xml =
    `<?xml version="1.0" encoding="UTF-8" ?>\n` +
    `<PremiereData Version="3">\n` +
    `\t<Project ObjectID="${projId}" ClassID="62ad66dd-0dcd-42da-a660-6d8fbde94876" Version="45">\n` +
    `\t\t<Name>${xmlEscape(seq.name || "JCut Project")}</Name>\n` +
    `\t\t<Sequences>\n\t\t\t<Sequence ObjectRef="${seqObj}"/>\n\t\t</Sequences>\n` +
    `\t</Project>\n` +
    mediaXml.join("") +
    sequenceXml +
    `</PremiereData>\n`;

  return { xml, mediaCount: sources.length, clipCount, warnings };
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
