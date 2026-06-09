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
import { promises as fs, existsSync } from "node:fs";
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
  if (path.isAbsolute(src)) return src;
  const ws = workspaceDir(workspace);
  // Match addClips' source resolution: a clip may be stored as a bare filename
  // (what sources-list reports), "video/clip.mp4", or "source/video/clip.mp4".
  // Search the source dirs so the export resolves the same paths clip-add accepted.
  const direct = path.join(ws, src);
  if (existsSync(direct)) return direct;
  const base = path.basename(src);
  for (const sub of ["video", "audio", "images"]) {
    const cand = path.join(ws, "source", sub, base);
    if (existsSync(cand)) return cand;
  }
  const underSource = path.join(ws, "source", src);
  if (existsSync(underSource)) return underSource;
  return direct; // fall back so the error names a real path
}

// Resolve a (possibly symlinked) source to its REAL path. caltools imports media
// then looks it up by path internally — if we hand it the workspace symlink, that
// lookup returns None and EVERY clip-add fails (empty Premiere timeline). Passing
// the real target path fixes the export.
// If realpath fails (broken symlink, unmounted drive) we throw rather than falling
// back to the symlink path — handing caltools an unresolvable path would silently
// drop the clip into clipErrors anyway, and throwing surfaces the failure loudly.
async function realSource(workspace: string, src: string): Promise<string> {
  const p = abs(workspace, src);
  return await fs.realpath(p);
}

// Run a caltools subcommand, returning parsed JSON (or throwing with stderr).
// Hard timeout so a wedged caltools process can never hang the export forever.
async function ct(bin: string, args: string[]): Promise<any> {
  const { stdout } = await pexecFile(bin, args, {
    maxBuffer: 1 << 26, env: process.env,
    timeout: 120000, killSignal: "SIGKILL",
  });
  try { return JSON.parse(stdout); } catch { return { raw: stdout }; }
}

export interface ExportResult {
  output: string;
  engine: "caltools" | "builtin";
  valid?: boolean;
  warnings?: string[];
  sequences: number;
  clips: number;
  captions_in_timeline?: number;
  transitions_in_timeline?: number;
}

export async function exportPremiere(
  workspace: string,
  seq: Sequence,
  outputPath: string,
  allowBuiltin = false,
): Promise<ExportResult> {
  const bin = await findCaltools();
  if (!bin) {
    // No Wideframe/caltools. The built-in from-scratch writer emits a minimal
    // object graph that is NOT validated against real Premiere — it can open as
    // an empty/corrupt timeline, silently losing the user's edit. So we refuse
    // by default and require an explicit opt-in (--allow-unverified).
    if (!allowBuiltin) {
      throw new Error(
        "Premiere export requires the validated engine (Wideframe/caltools), which was not found. " +
        "The built-in writer is unverified and may produce an empty timeline. " +
        "Install Wideframe for a guaranteed export, or re-run with --allow-unverified to use the " +
        "built-in writer at your own risk (verify the project opens correctly in Premiere).",
      );
    }
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

  // 4. Build ALL clip ops first, then add them in ONE batched call.
  //    Previously this looped one `prproj edit` per clip — and each edit re-reads
  //    and re-writes the entire .prproj, making export O(n²) on file size. A
  //    367-clip export took minutes and could time out mid-way. caltools accepts
  //    an array of operations, so we send them all at once: one parse, one write.
  let clipCount = 0;
  const clipErrors: string[] = [];
  const ops: any[] = [];
  for (const c of seq.clips) {
    const tUid = trackUid[c.track];
    if (!tUid) continue; // track not present (shouldn't happen)
    const dur = clipTimelineDuration(c);
    let resolvedSource: string;
    try {
      resolvedSource = await realSource(workspace, c.source_path);
    } catch (e) {
      clipErrors.push(`${path.basename(c.source_path)}: cannot resolve path — ${(e as Error).message.slice(0, 100)}`);
      continue;
    }
    const op: any = {
      op: "add_clip_with_media",
      sequence_uid: sequenceUid,
      track_uid: tUid,
      source: resolvedSource,
      start_seconds: round(c.start_time_seconds),
      end_seconds: round(c.start_time_seconds + dur),
      in_point_seconds: round(c.trim_start_seconds),
      out_point_seconds: round(c.trim_end_seconds),
    };
    if (c.speed && c.speed !== 1) op.speed = c.speed;
    if (typeof c.volume_db === "number" && c.volume_db !== 0) op.volume_db = c.volume_db;
    if (c.transform) {
      op.scale = Math.round((c.transform.scale.x || 1) * 100);
      if (c.transform.rotation) op.rotation = c.transform.rotation;
    }
    ops.push(op);
  }

  if (ops.length > 0) {
    try {
      // One batched edit — fast even for hundreds of clips.
      await ct(bin, ["prproj", "edit", "--file", outputPath, "--output", outputPath,
        "--operations", JSON.stringify(ops)]);
      clipCount = ops.length;
    } catch (batchErr) {
      // Batch failed (one bad clip can reject the whole array). Fall back to
      // per-clip adds so good clips still land and we learn exactly which failed.
      for (const op of ops) {
        try {
          await ct(bin, ["prproj", "edit", "--file", outputPath, "--output", outputPath,
            "--operations", JSON.stringify([op])]);
          clipCount++;
        } catch (e) {
          const name = path.basename(String(op.source));
          clipErrors.push(`${name}: ${(e as Error).message.slice(0, 120)}`);
        }
      }
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

  // Hard fail on zero clips (empty timeline is never a success).
  // Also hard fail when more than half the clips were dropped — a majority-empty
  // timeline returned as "success" is just as misleading as a fully empty one.
  if (seq.clips.length > 0 && clipCount === 0) {
    throw new Error(
      `Premiere export produced an EMPTY timeline — all ${seq.clips.length} clips failed to add. ` +
      `First errors: ${clipErrors.slice(0, 3).join(" | ")}`,
    );
  }
  // Throw if more than half the clips failed — use total clip count as the
  // denominator so a 5-fail/5-succeed (50/50) case correctly fails.
  if (clipErrors.length > 0 && clipErrors.length >= seq.clips.length / 2) {
    throw new Error(
      `Premiere export dropped ${clipErrors.length} of ${seq.clips.length} clips (≥50% failed). ` +
      `First errors: ${clipErrors.slice(0, 3).join(" | ")}`,
    );
  }

  const mergedWarnings = [...(warnings || []), ...clipErrors];

  // Captions and transitions live in the JCut timeline. caltools' edit API has no
  // add_caption/add_transition op, so we don't silently claim they exported — we
  // surface them so the user knows to verify/finish them in Premiere rather than
  // assuming they made it into the .prproj.
  const capCount = seq.captions?.length || 0;
  const trCount = seq.transitions?.length || 0;
  if (capCount > 0) {
    mergedWarnings.push(
      `${capCount} caption(s) are in the JCut timeline but were NOT written into the .prproj ` +
      `(the export engine has no caption-injection op). Add them in Premiere, or keep editing ` +
      `text in JCut.`,
    );
  }
  if (trCount > 0) {
    mergedWarnings.push(
      `${trCount} transition(s) are in the JCut timeline but were NOT written into the .prproj ` +
      `(the export engine has no transition op). Re-apply them in Premiere.`,
    );
  }

  return {
    output: outputPath, engine: "caltools", valid, warnings: mergedWarnings,
    sequences: 1, clips: clipCount,
    captions_in_timeline: capCount, transitions_in_timeline: trCount,
  };
}

function fpsToRational(fps: number): { num: number; den: number } {
  // Handle common drop/non-drop rates exactly.
  if (Math.abs(fps - 29.97) < 0.01) return { num: 30000, den: 1001 };
  if (Math.abs(fps - 23.976) < 0.01) return { num: 24000, den: 1001 };
  if (Math.abs(fps - 59.94) < 0.01) return { num: 60000, den: 1001 };
  return { num: Math.round(fps), den: 1 };
}
function round(n: number): number { return Math.round(n * 1000) / 1000; }
