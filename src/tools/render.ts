// Render a Sequence to video by compiling an ffmpeg filter_complex graph:
//   per clip: trim source -> set speed -> scale -> position on a canvas
//   video:    stack V1 < V2 < V3 via overlay
//   audio:    mix A-tracks via amix with per-clip volume + fades
// This mirrors Wideframe's sequence-render-final (overlay + amix, libx264).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  Sequence, Clip, sequenceDuration, clipTimelineDuration,
  isVideoTrack, isAudioTrack,
} from "./model.js";
import { workspaceDir } from "./store.js";

const pexecFile = promisify(execFile);

function abs(workspace: string, source: string): string {
  return path.isAbsolute(source) ? source : path.join(workspaceDir(workspace), source);
}

// Video tracks sorted bottom->top so higher tracks overlay lower ones.
function videoTracksAscending(seq: Sequence): string[] {
  const set = new Set(seq.clips.filter((c) => isVideoTrack(c.track)).map((c) => c.track));
  return [...set].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

interface RenderOpts {
  output?: string;
  // when set, render a single still frame at this timecode instead of full video
  frameAtSeconds?: number;
}

export async function renderSequence(
  workspace: string,
  seq: Sequence,
  opts: RenderOpts = {},
): Promise<{ output: string; cmd: string }> {
  const { width, height, framerate } = seq.settings;
  const seqDur = sequenceDuration(seq);
  if (seqDur <= 0) {
    throw new Error("Sequence is empty — nothing to render.");
  }
  // The base canvas must span the whole timeline even in frame mode, otherwise
  // seeking to the requested timecode lands past the canvas and writes nothing.
  const totalDuration = seqDur;

  const inputs: string[] = [];
  const filters: string[] = [];
  const videoLabels: { label: string; start: number; dur: number; posX: number; posY: number }[] = [];
  const audioLabels: string[] = [];

  // Base canvas (black) spanning the whole timeline.
  filters.push(
    `color=c=black:s=${width}x${height}:r=${framerate}:d=${Math.max(totalDuration, 0.1)}[base]`,
  );

  let inputIndex = 0;
  const videoTracks = videoTracksAscending(seq);

  // Process video/image clips track by track (ascending) for correct stacking.
  const orderedVideoClips: Clip[] = [];
  for (const t of videoTracks) {
    orderedVideoClips.push(
      ...seq.clips.filter((c) => c.track === t).sort((a, b) => a.start_time_seconds - b.start_time_seconds),
    );
  }

  for (const c of orderedVideoClips) {
    const srcDur = clipTimelineDuration(c);
    const file = abs(workspace, c.source_path);
    if (c.clip_type === "image") {
      inputs.push("-loop", "1", "-t", String(srcDur), "-i", file);
    } else {
      inputs.push(
        "-ss", String(c.trim_start_seconds),
        "-to", String(c.trim_end_seconds),
        "-i", file,
      );
    }
    const idx = inputIndex++;
    const vlabel = `v${idx}`;
    const scaleX = c.transform?.scale.x ?? 1;
    const scaleY = c.transform?.scale.y ?? 1;
    const targetW = c.source_width ? Math.round(c.source_width * scaleX) : width;
    const targetH = c.source_height ? Math.round(c.source_height * scaleY) : height;
    const speed = c.speed || 1.0;

    let chain = `[${idx}:v]`;
    if (c.speed_keyframes && c.speed_keyframes.length >= 2) {
      // Speed RAMP. ffmpeg's setpts can't take a comma-bearing piecewise if()
      // expression inside a filterchain, so we render the ramp as the duration-
      // matched constant rate (the effective average speed across the ramp). This
      // always renders correctly; the timeline footprint matches the ramp. (A true
      // curved ease is applied at Premiere export via per-segment PlaybackSpeed.)
      chain += `setpts=PTS/${effectiveRampSpeed(c.speed_keyframes)},`;
    } else {
      chain += `setpts=PTS/${speed},`;
    }
    chain += `scale=${targetW}:${targetH},`;
    chain += `fps=${framerate},format=rgba`;
    filters.push(`${chain}[${vlabel}]`);
    videoLabels.push({
      label: vlabel,
      start: c.start_time_seconds,
      dur: srcDur,
      posX: Math.round(c.transform?.position.x ?? 0),
      posY: Math.round(c.transform?.position.y ?? 0),
    });
  }

  // Stack video clips onto the base with overlay at their start times.
  // NOTE: no eof_action=pass — when an overlay input ends before the timeline
  // does, eof_action=pass mis-times against output-side seeking and stretches
  // the last overlay frame to full canvas. The default behavior + the `enable`
  // window confine each overlay to its [start, end) correctly.
  let last = "base";
  videoLabels.forEach((v, i) => {
    const out = i === videoLabels.length - 1 ? "vout" : `ov${i}`;
    const posX = v.posX, posY = v.posY; // transform.position pixel offset
    filters.push(
      `[${last}][${v.label}]overlay=${posX}:${posY}:enable='between(t,${v.start},${(v.start + v.dur).toFixed(3)})'[${out}]`,
    );
    last = out;
  });
  if (videoLabels.length === 0) last = "base";
  const finalVideoLabel = videoLabels.length ? "vout" : "base";

  // Audio clips: delay to start time, apply volume + fades, then amix.
  // Skipped entirely in single-frame mode — a still has no audio, and building
  // these filters would leave their outputs unconnected (ffmpeg errors).
  const audioClips = opts.frameAtSeconds != null
    ? []
    : seq.clips.filter((c) => isAudioTrack(c.track));
  for (const c of audioClips) {
    const file = abs(workspace, c.source_path);
    inputs.push(
      "-ss", String(c.trim_start_seconds),
      "-to", String(c.trim_end_seconds),
      "-i", file,
    );
    const idx = inputIndex++;
    const alabel = `a${idx}`;
    const delayMs = Math.round(c.start_time_seconds * 1000);
    const dur = clipTimelineDuration(c);
    let chain = `[${idx}:a]`;
    if ((c.speed || 1) !== 1) chain += `atempo=${c.speed},`;
    chain += `volume=${dbToLinear(c.volume_db)},`;
    if (c.fade?.fade_in_seconds) chain += `afade=t=in:st=0:d=${c.fade.fade_in_seconds},`;
    if (c.fade?.fade_out_seconds)
      chain += `afade=t=out:st=${(dur - c.fade.fade_out_seconds).toFixed(3)}:d=${c.fade.fade_out_seconds},`;
    chain += `adelay=${delayMs}|${delayMs}`;
    filters.push(`${chain}[${alabel}]`);
    audioLabels.push(alabel);
  }

  // ── Single-frame mode (verification loop) ──────────────────────────────────
  if (opts.frameAtSeconds != null) {
    const out = opts.output || path.join(workspaceDir(workspace), "renders", `frame_${opts.frameAtSeconds}.png`);
    await fs.mkdir(path.dirname(out), { recursive: true });
    const args = [
      ...inputs,
      "-filter_complex", filters.join(";"),
      "-map", `[${finalVideoLabel}]`,
      "-ss", String(opts.frameAtSeconds),
      "-frames:v", "1",
      "-y", out,
    ];
    await pexecFile("ffmpeg", args, { maxBuffer: 1 << 26 });
    await assertWritten(out);
    return { output: out, cmd: `ffmpeg ${args.join(" ")}` };
  }

  // ── Full render ────────────────────────────────────────────────────────────
  let audioMap: string[] = [];
  if (audioLabels.length === 1) {
    audioMap = ["-map", `[${audioLabels[0]}]`];
  } else if (audioLabels.length > 1) {
    filters.push(`${audioLabels.map((l) => `[${l}]`).join("")}amix=inputs=${audioLabels.length}:normalize=0[aout]`);
    audioMap = ["-map", "[aout]"];
  }

  const out = opts.output || path.join(workspaceDir(workspace), "renders", `${seq.name || seq.id}.mp4`);
  await fs.mkdir(path.dirname(out), { recursive: true });
  const args = [
    ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", `[${finalVideoLabel}]`,
    ...audioMap,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(framerate),
    ...(audioMap.length ? ["-c:a", "aac", "-b:a", "192k"] : []),
    "-t", String(totalDuration),
    "-y", out,
  ];
  await pexecFile("ffmpeg", args, { maxBuffer: 1 << 26 });
  await assertWritten(out);
  return { output: out, cmd: `ffmpeg ${args.join(" ")}` };
}

// Fail loudly if ffmpeg exited 0 but produced nothing (a silent-success bug).
async function assertWritten(file: string): Promise<void> {
  try {
    const st = await fs.stat(file);
    if (st.size > 0) return;
  } catch {
    /* falls through */
  }
  throw new Error(`Render reported success but no output was written to ${file}`);
}

function dbToLinear(db: number): number {
  return Math.pow(10, (db || 0) / 20);
}

// Effective constant speed that yields the same total duration as the ramp:
// total source span / total output time, where output time = ∫ 1/s(τ) dτ.
function effectiveRampSpeed(keys: { at: number; speed: number }[]): number {
  const k = [...keys].sort((a, b) => a.at - b.at);
  let srcSpan = 0, outTime = 0;
  for (let i = 1; i < k.length; i++) {
    const dt = k[i].at - k[i - 1].at;
    const s0 = Math.max(0.01, k[i - 1].speed), s1 = Math.max(0.01, k[i].speed);
    srcSpan += dt;
    outTime += Math.abs(s1 - s0) < 1e-6 ? dt / s0 : (dt * Math.log(s1 / s0)) / (s1 - s0);
  }
  return outTime > 0 ? srcSpan / outTime : 1.0;
}
