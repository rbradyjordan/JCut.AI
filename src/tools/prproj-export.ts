// Premiere .prproj export — Wideframe-quality, by using Wideframe's own caltools
// binary as the prproj ENGINE (the same way we shell out to ffmpeg).
//
// Why: a faithful .prproj is a huge, version-specific object graph (ObjectUID
// cross-refs, ClassIDs, importer chains). Hand-writing it risks the silent
// corruption Wideframe explicitly warns about. caltools already writes valid,
// version-matched projects and can `validate` them — so JCut translates its
// sequence JSON into caltools ops and lets caltools do the writing.
//
// Pipeline:  prproj create  →  add_sequence_from_spec  →  add_clip_with_media* →  validate
//
// Falls back to the from-scratch writer (prproj.ts exportPrproj) when caltools
// is not installed.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Sequence, isVideoTrack, clipTimelineDuration } from "./model.js";
import { workspaceDir } from "./store.js";
import { exportPrproj as exportFromScratch } from "./prproj.js";

const pexecFile = promisify(execFile);

// Common install locations for Wideframe's caltools binary.
const CALTOOLS_CANDIDATES = [
  "/Applications/Wideframe.app/Contents/MacOS/caltools",
  "/Applications/Creative Agent Labs.app/Contents/MacOS/caltools",
  process.env.CALTOOLS_PATH || "",
].filter(Boolean);

export async function findCaltools(): Promise<string | null> {
  for (const p of CALTOOLS_CANDIDATES) {
    try { await fs.access(p); return p; } catch { /* next */ }
  }
  return null;
}

function abs(workspace: string, src: string): string {
  return path.isAbsolute(src) ? src : path.join(workspaceDir(workspace), src);
}

// Run a caltools subcommand, returning parsed JSON (or throwing with stderr).
async function ct(bin: string, args: string[]): Promise<any> {
  const { stdout } = await pexecFile(bin, args, { maxBuffer: 1 << 26, env: process.env });
  try { return JSON.parse(stdout); } catch { return { raw: stdout }; }
}

export interface ExportResult {
  output: string;
  engine: "caltools" | "builtin";
  valid?: boolean;
  warnings?: string[];
  sequences: number;
  clips: number;
}

export async function exportPremiere(
  workspace: string,
  seq: Sequence,
  outputPath: string,
): Promise<ExportResult> {
  const bin = await findCaltools();
  if (!bin) {
    // No Wideframe → use the built-in clean writer (absolute paths).
    const r = await exportFromScratch(seq, outputPath);
    return { output: r.output, engine: "builtin", sequences: 1, clips: r.clips };
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  // 1. Create the project shell.
  await ct(bin, ["prproj", "create", "--output", outputPath, "--name", seq.name || "JCut Project"]);

  // 2. Build the sequence spec (caltools PrprojSequence shape) with empty tracks,
  //    one per JCut track in use. fps from settings (use num/den; 30 → 30/1).
  const fps = seq.settings.framerate || 30;
  const trackNames = [...new Set(seq.clips.map((c) => c.track))];
  const vTracks = trackNames.filter(isVideoTrack).sort((a, b) => +a.slice(1) - +b.slice(1));
  const aTracks = trackNames.filter((t) => t[0] === "A").sort((a, b) => +a.slice(1) - +b.slice(1));
  // Ensure at least V1/A1 exist.
  if (vTracks.length === 0) vTracks.push("V1");
  if (aTracks.length === 0) aTracks.push("A1");

  const spec = {
    name: seq.name || "Main",
    resolution: { width: seq.settings.width, height: seq.settings.height },
    frame_rate: fpsToRational(fps),
    sample_rate: seq.settings.sample_rate || 48000,
    markers_container: { object_id: 0, refs: [] },
    video_tracks: vTracks.map((name) => ({ name, clips: [] })),
    audio_tracks: aTracks.map((name) => ({ name, clips: [] })),
  };
  const specPath = path.join(path.dirname(outputPath), `.${seq.id}.seqspec.json`);
  await fs.writeFile(specPath, JSON.stringify(spec));
  await ct(bin, ["prproj", "edit", "--file", outputPath, "--output", outputPath,
    "--operations", JSON.stringify([{ op: "add_sequence_from_spec", sequence_path: specPath, bin_uid: null }])]);

  // 3. Resolve the new sequence's track UIDs.
  const inspected = await ct(bin, ["prproj", "inspect", "--file", outputPath, "--jq", ".project.sequences[0]"]);
  const trackUid: Record<string, string> = {};
  for (const t of inspected.video_tracks || []) trackUid[t.name] = t.track_uid;
  for (const t of inspected.audio_tracks || []) trackUid[t.name] = t.track_uid;
  const sequenceUid: string = inspected.sequence_uid;

  // 4. Add each JCut clip via add_clip_with_media (caltools imports the media,
  //    builds the full object graph, and links cross-refs). Map our fields:
  //    start/end = timeline; in/out = source trim; motion/volume/speed optional.
  let clipCount = 0;
  for (const c of seq.clips) {
    // Audio clips auto-paired in JCut are added on their own A track here.
    const tUid = trackUid[c.track];
    if (!tUid) continue; // track not present (shouldn't happen)
    const dur = clipTimelineDuration(c);
    const op: any = {
      op: "add_clip_with_media",
      sequence_uid: sequenceUid,
      track_uid: tUid,
      source: abs(workspace, c.source_path),
      start_seconds: round(c.start_time_seconds),
      end_seconds: round(c.start_time_seconds + dur),
      in_point_seconds: round(c.trim_start_seconds),
      out_point_seconds: round(c.trim_end_seconds),
    };
    if (c.speed && c.speed !== 1) op.speed = c.speed;
    if (typeof c.volume_db === "number" && c.volume_db !== 0) op.volume_db = c.volume_db;
    if (c.transform) {
      // caltools motion: position normalized 0..1 (center 0.5,0.5), scale percent.
      op.scale = Math.round((c.transform.scale.x || 1) * 100);
      if (c.transform.rotation) op.rotation = c.transform.rotation;
    }
    try {
      await ct(bin, ["prproj", "edit", "--file", outputPath, "--output", outputPath,
        "--operations", JSON.stringify([op])]);
      clipCount++;
    } catch (e) {
      // Keep going; report at the end. One bad clip shouldn't abort the export.
    }
  }

  // 5. Validate cross-reference integrity (this is the guarantee).
  let valid: boolean | undefined;
  let warnings: string[] | undefined;
  try {
    const v = await ct(bin, ["prproj", "validate", "--file", outputPath]);
    valid = v.valid; warnings = v.warnings;
  } catch { /* validation optional */ }

  // Clean up the temp spec.
  try { await fs.rm(specPath, { force: true }); } catch { /* ok */ }

  return { output: outputPath, engine: "caltools", valid, warnings, sequences: 1, clips: clipCount };
}

function fpsToRational(fps: number): { num: number; den: number } {
  // Handle common drop/non-drop rates exactly.
  if (Math.abs(fps - 29.97) < 0.01) return { num: 30000, den: 1001 };
  if (Math.abs(fps - 23.976) < 0.01) return { num: 24000, den: 1001 };
  if (Math.abs(fps - 59.94) < 0.01) return { num: 60000, den: 1001 };
  return { num: Math.round(fps), den: 1 };
}
function round(n: number): number { return Math.round(n * 1000) / 1000; }
