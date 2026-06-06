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
// Generated CLEAN from scratch (we never hand-patch an existing project's XML —
// that's how cross-reference invariants get corrupted). We emit a minimal but
// internally-consistent object graph: Project → ProjectItems (Media + Clip) per
// unique source, and a Sequence with video/audio tracks holding TrackItems.
// Timing is in ticks (254016000000/sec). Object cross-refs use stable ObjectIDs.
//
// Scope note: this targets the common case (cuts, multi-track, trims, basic
// transforms) — the editorial handoff, not a 1:1 of every Premiere feature.
import { Sequence, Clip, isVideoTrack, clipTimelineDuration } from "./model.js";
import { promises as fsp } from "node:fs";
import zlibFull from "node:zlib";

function secToTicks(s: number): bigint {
  return BigInt(Math.round(s * TICKS_PER_SECOND));
}
function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// A deterministic UID generator (stable within one export).
function makeUid(n: number): string {
  const h = (n * 2654435761 >>> 0).toString(16).padStart(8, "0");
  return `${h}-0000-4000-8000-${h}00000000`.slice(0, 36);
}

export interface PrprojExportResult { output: string; sequences: number; clips: number; media: number; }

// Build the .prproj XML for a single sequence. fps from sequence settings.
// `resolveAbs` maps a clip's (possibly workspace-relative) source_path to an
// ABSOLUTE filesystem path — Premiere needs absolute media paths to relink.
export function buildPrprojXml(
  seq: Sequence,
  resolveAbs: (src: string) => string = (s) => s,
): { xml: string; mediaCount: number; clipCount: number } {
  const fps = seq.settings.framerate || 30;
  const tickRate = TICKS_PER_SECOND; // ticks per second

  // Collect unique sources → assign Media + ClipProjectItem objects.
  const sources = [...new Set(seq.clips.map((c) => c.source_path))];
  let oid = 100;
  const next = () => ++oid;

  const mediaIds = new Map<string, { media: number; clip: number; uid: string }>();
  const mediaXml: string[] = [];
  sources.forEach((src, i) => {
    const media = next(), clip = next();
    const uid = makeUid(1000 + i);
    mediaIds.set(src, { media, clip, uid });
    const absPath = resolveAbs(src);
    mediaXml.push(
      `\t<Media ObjectID="${media}" ClassID="7a5c103e-f3ac-4391-b6b4-7cc3d2f9a7ff" Version="27">\n` +
      `\t\t<ActualMediaFilePath>${xmlEscape(absPath)}</ActualMediaFilePath>\n` +
      `\t\t<FilePath>${xmlEscape(absPath)}</FilePath>\n` +
      `\t</Media>\n` +
      `\t<ClipProjectItem ObjectID="${clip}" ObjectUID="${uid}" ClassID="cb4e0ed7-aca1-4171-8525-e3658dec06dd" Version="1">\n` +
      `\t\t<Name>${xmlEscape(src.split("/").pop() || src)}</Name>\n` +
      `\t\t<MediaRef ObjectRef="${media}"/>\n` +
      `\t</ClipProjectItem>\n`,
    );
  });

  // Group clips by track.
  const trackNames = [...new Set(seq.clips.map((c) => c.track))]
    .sort((x, y) => (x[0] === y[0] ? Number(x.slice(1)) - Number(y.slice(1)) : x[0] === "V" ? -1 : 1));

  const trackXml: string[] = [];
  let clipCount = 0;
  for (const tname of trackNames) {
    const isV = isVideoTrack(tname);
    const trackId = next();
    const items: string[] = [];
    for (const c of seq.clips.filter((x) => x.track === tname)) {
      const m = mediaIds.get(c.source_path)!;
      const startT = secToTicks(c.start_time_seconds);
      const endT = secToTicks(c.start_time_seconds + clipTimelineDuration(c));
      const inT = secToTicks(c.trim_start_seconds);
      const outT = secToTicks(c.trim_end_seconds);
      const itemId = next();
      const tag = isV ? "VideoClipTrackItem" : "AudioClipTrackItem";
      const cls = isV ? "368b0406-29e3-4923-9fcd-094fbf9a1089" : "064ec682-9ba6-11d5-af2d-9ca32c7d6164";
      // PlaybackSpeed folds in constant speed (and ramps fall back to their average).
      const speed = c.speed_keyframes?.length
        ? c.speed_keyframes.reduce((a, k) => a + k.speed, 0) / c.speed_keyframes.length
        : (c.speed || 1);
      items.push(
        `\t\t\t<${tag} ObjectID="${itemId}" ClassID="${cls}" Version="6">\n` +
        `\t\t\t\t<Start>${startT}</Start>\n` +
        `\t\t\t\t<End>${endT}</End>\n` +
        `\t\t\t\t<InPoint>${inT}</InPoint>\n` +
        `\t\t\t\t<OutPoint>${outT}</OutPoint>\n` +
        `\t\t\t\t<PlaybackSpeed>${speed}</PlaybackSpeed>\n` +
        `\t\t\t\t<SubClip ObjectRef="${m.clip}"/>\n` +
        `\t\t\t</${tag}>\n`,
      );
      clipCount++;
    }
    trackXml.push(
      `\t\t<Track ObjectID="${trackId}" Version="3">\n` +
      `\t\t\t<Name>${tname}</Name>\n` +
      `\t\t\t<TrackItems>\n${items.join("")}\t\t\t</TrackItems>\n` +
      `\t\t</Track>\n`,
    );
  }

  const seqObj = next();
  const sequenceXml =
    `\t<Sequence ObjectID="${seqObj}" ClassID="6a15d903-8739-11d5-af2d-9b7855ad8974" Version="11">\n` +
    `\t\t<Name>${xmlEscape(seq.name || "JCut Sequence")}</Name>\n` +
    `\t\t<FrameRate>${Math.round(tickRate / fps)}</FrameRate>\n` +
    `\t\t<VideoFrameWidth>${seq.settings.width}</VideoFrameWidth>\n` +
    `\t\t<VideoFrameHeight>${seq.settings.height}</VideoFrameHeight>\n` +
    `\t\t<Tracks>\n${trackXml.join("")}\t\t</Tracks>\n` +
    `\t</Sequence>\n`;

  const projId = next();
  const xml =
    `<?xml version="1.0" encoding="UTF-8" ?>\n` +
    `<PremiereData Version="3">\n` +
    `\t<Project ObjectID="${projId}" ClassID="62ad66dd-0dcd-42da-a660-6d8fbde94876" Version="41">\n` +
    `\t\t<Name>${xmlEscape(seq.name || "JCut Project")}</Name>\n` +
    `\t\t<Sequences>\n\t\t\t<Sequence ObjectRef="${seqObj}"/>\n\t\t</Sequences>\n` +
    `\t</Project>\n` +
    mediaXml.join("") +
    sequenceXml +
    `</PremiereData>\n`;

  return { xml, mediaCount: sources.length, clipCount };
}

// Write a .prproj (gzip-compressed, as Premiere expects). Always export clean.
export async function exportPrproj(seq: Sequence, outputPath: string): Promise<PrprojExportResult> {
  const { xml, mediaCount, clipCount } = buildPrprojXml(seq);
  const gzip = promisify(zlibFull.gzip);
  const gz = await gzip(Buffer.from(xml, "utf8"));
  await fsp.writeFile(outputPath, gz);
  return { output: outputPath, sequences: 1, clips: clipCount, media: mediaCount };
}
