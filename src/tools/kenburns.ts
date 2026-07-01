// Ken Burns motion — slow push-in / pull-out over a clip's duration, with a fresh
// move every N seconds so long clips keep drifting instead of sitting still. Pure
// keyframe math; the .prproj exporter turns transform_keyframes into animated
// Motion Scale keyframes Premiere plays back.
//
// Model: scale is a MULTIPLIER on the clip's fit (1.0 = fit, 1.2 = +20% push-in).
// A "push in" ramps 1.0 → 1.2 across a segment; a "pull out" ramps 1.2 → 1.0.
// We alternate direction segment-to-segment so a long clip breathes in and out.
import { TransformKeyframe } from "./model.js";

export interface KenBurnsOptions {
  segmentSeconds?: number; // a new push/pull every this many seconds (default 15)
  minScale?: number;       // pulled-out end (default 1.0 = fit)
  maxScale?: number;       // pushed-in end (default 1.2 = +20%, i.e. "100→120")
  startDirection?: "in" | "out"; // first segment pushes in or pulls out (default "in")
}

// Build keyframes for ONE clip of the given on-timeline duration (seconds).
// Always returns at least 2 keyframes (one full push or pull) for any clip ≥ ~0.3s.
// For a 40s clip at 15s segments: kf at 0,15,30,40 alternating in/out/in.
export function kenBurnsKeyframes(durationSeconds: number, opts: KenBurnsOptions = {}): TransformKeyframe[] {
  const seg = Math.max(1, opts.segmentSeconds ?? 15);
  const lo = opts.minScale ?? 1.0;
  const hi = opts.maxScale ?? 1.2;
  const dur = Math.max(0, durationSeconds);
  if (dur < 0.3) return []; // too short to animate meaningfully

  // Segment boundaries: 0, seg, 2*seg, …, dur (clamp the last to the clip end).
  const bounds: number[] = [0];
  for (let t = seg; t < dur - 1e-6; t += seg) bounds.push(t);
  bounds.push(dur);

  // Alternate endpoints so each segment ramps between lo and hi. Starting "in" means
  // the very first keyframe is the pulled-out value (lo) ramping to pushed-in (hi).
  const startIn = (opts.startDirection ?? "in") === "in";
  const kfs: TransformKeyframe[] = bounds.map((at, i) => {
    // Even index = segment start state, odd = the opposite. With startIn: even→lo, odd→hi.
    const isLo = startIn ? (i % 2 === 0) : (i % 2 === 1);
    return { at: Number(at.toFixed(3)), scale: isLo ? lo : hi };
  });
  return kfs;
}

// Decide a per-clip direction so consecutive clips don't all push the same way —
// gives a recap a natural in/out/in/out rhythm. `index` is the clip's position.
export function directionForIndex(index: number): "in" | "out" {
  return index % 2 === 0 ? "in" : "out";
}
