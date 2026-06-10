// Timeline analysis — "learn how these videos usually go."
//
// Given one or more finished sequences (the user's own past edits, or reference
// cuts they admire), extract the EDITORIAL STRUCTURE: pacing, shot-length
// distribution, B-roll overlay ratio, section rhythm, audio bed usage. Aggregate
// many sequences into a "style profile" the editor can consult when building new
// edits — so the agent learns a creator's habits instead of guessing every time.
import {
  Sequence, Clip, clipTimelineDuration, clipTimelineEnd, sequenceDuration,
  isVideoTrack, isAudioTrack,
} from "./model.js";

export interface SequenceStyle {
  sequence_id: string;
  name: string;
  duration_seconds: number;
  // Pacing
  cut_count: number;                 // number of V1 (A-roll) cuts
  cuts_per_minute: number;
  avg_shot_seconds: number;          // mean V1 shot length
  median_shot_seconds: number;
  shot_seconds_p10: number;          // fast-cut tail
  shot_seconds_p90: number;          // long-take tail
  // Layering
  broll_overlay_ratio: number;       // fraction of timeline covered by V2+ overlay
  max_video_tracks: number;
  has_music_bed: boolean;            // a long continuous A-track distinct from A1 dialogue
  // Structure
  section_count: number;             // distinct sections (gaps on V1 mark boundaries)
  opening_shot_seconds: number;      // length of the first shot (the "hook")
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

// How much of the timeline duration is covered by overlay (V2 and above)?
function brollOverlayRatio(seq: Sequence): number {
  const total = sequenceDuration(seq);
  if (total <= 0) return 0;
  const overlay = seq.clips.filter((c) => isVideoTrack(c.track) && c.track !== "V1");
  // Union of covered intervals (clamped, merged) so stacked overlays don't double-count.
  const intervals = overlay
    .map((c) => [c.start_time_seconds, clipTimelineEnd(c)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  let covered = 0, curStart = -1, curEnd = -1;
  for (const [s, e] of intervals) {
    if (s > curEnd) {
      if (curEnd > curStart) covered += curEnd - curStart;
      curStart = s; curEnd = e;
    } else {
      curEnd = Math.max(curEnd, e);
    }
  }
  if (curEnd > curStart) covered += curEnd - curStart;
  return covered / total;
}

// Sections are runs of V1 clips separated by a gap > 0.5s.
function countSections(v1: Clip[]): number {
  if (v1.length === 0) return 0;
  const sorted = [...v1].sort((a, b) => a.start_time_seconds - b.start_time_seconds);
  let sections = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = clipTimelineEnd(sorted[i - 1]);
    if (sorted[i].start_time_seconds - prevEnd > 0.5) sections++;
  }
  return sections;
}

// A "music bed" = an audio clip on A2+ that runs for most of the timeline.
function hasMusicBed(seq: Sequence): boolean {
  const total = sequenceDuration(seq);
  if (total <= 0) return false;
  return seq.clips.some(
    (c) => isAudioTrack(c.track) && c.track !== "A1" && clipTimelineDuration(c) >= 0.6 * total,
  );
}

export function analyzeSequence(seq: Sequence): SequenceStyle {
  const total = sequenceDuration(seq);
  const v1 = seq.clips.filter((c) => c.track === "V1");
  const shotLens = v1.map(clipTimelineDuration).sort((a, b) => a - b);
  const sum = shotLens.reduce((a, b) => a + b, 0);
  const videoTrackNums = seq.clips
    .filter((c) => isVideoTrack(c.track))
    .map((c) => Number(c.track.slice(1)));
  const firstShot = [...v1].sort((a, b) => a.start_time_seconds - b.start_time_seconds)[0];

  return {
    sequence_id: seq.id,
    name: seq.name,
    duration_seconds: round(total),
    cut_count: v1.length,
    cuts_per_minute: total > 0 ? round((v1.length / total) * 60) : 0,
    avg_shot_seconds: shotLens.length ? round(sum / shotLens.length) : 0,
    median_shot_seconds: round(percentile(shotLens, 50)),
    shot_seconds_p10: round(percentile(shotLens, 10)),
    shot_seconds_p90: round(percentile(shotLens, 90)),
    broll_overlay_ratio: round(brollOverlayRatio(seq)),
    max_video_tracks: videoTrackNums.length ? Math.max(...videoTrackNums) : 0,
    has_music_bed: hasMusicBed(seq),
    section_count: countSections(v1),
    opening_shot_seconds: firstShot ? round(clipTimelineDuration(firstShot)) : 0,
  };
}

// ── Aggregated style profile across many sequences ───────────────────────────
export interface StyleProfile {
  source_sequences: number;
  total_duration_seconds: number;
  // Central tendencies the editor should aim for on new edits:
  typical_cuts_per_minute: number;
  typical_shot_seconds: number;        // median of medians
  fast_cut_seconds: number;            // p10 — how short the punchy cuts get
  long_take_seconds: number;           // p90 — how long the breathing shots get
  typical_broll_overlay_ratio: number;
  music_bed_frequency: number;         // fraction of refs that use a music bed
  typical_opening_shot_seconds: number;
  notes: string[];                     // human-readable learned habits
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return percentile(s, 50);
}

export function buildStyleProfile(styles: SequenceStyle[]): StyleProfile {
  const notes: string[] = [];
  const cpm = median(styles.map((s) => s.cuts_per_minute));
  const shot = median(styles.map((s) => s.median_shot_seconds));
  const fast = median(styles.map((s) => s.shot_seconds_p10));
  const long = median(styles.map((s) => s.shot_seconds_p90));
  const broll = mean(styles.map((s) => s.broll_overlay_ratio));
  const musicFreq = styles.length ? styles.filter((s) => s.has_music_bed).length / styles.length : 0;
  const opening = median(styles.map((s) => s.opening_shot_seconds));

  if (cpm >= 20) notes.push(`Fast-paced: ~${round(cpm)} cuts/min — keep shots short and energetic.`);
  else if (cpm <= 8) notes.push(`Slow, deliberate pacing: ~${round(cpm)} cuts/min — let shots breathe.`);
  else notes.push(`Moderate pacing: ~${round(cpm)} cuts/min.`);

  if (broll >= 0.4) notes.push(`Heavy B-roll: ~${pct(broll)} of the timeline is overlay (V2+). Plan cutaways generously.`);
  else if (broll <= 0.1) notes.push(`Sparse B-roll: ~${pct(broll)} overlay — mostly talking-head/A-roll.`);
  else notes.push(`Balanced B-roll: ~${pct(broll)} of the timeline is overlay.`);

  if (musicFreq >= 0.5) notes.push(`Usually has a music bed (${pct(musicFreq)} of references) — add one on A2.`);
  if (opening > 0 && opening <= 2.5) notes.push(`Punchy openings: first shot ~${round(opening)}s — hook fast.`);

  return {
    source_sequences: styles.length,
    total_duration_seconds: round(styles.reduce((a, s) => a + s.duration_seconds, 0)),
    typical_cuts_per_minute: round(cpm),
    typical_shot_seconds: round(shot),
    fast_cut_seconds: round(fast),
    long_take_seconds: round(long),
    typical_broll_overlay_ratio: round(broll),
    music_bed_frequency: round(musicFreq),
    typical_opening_shot_seconds: round(opening),
    notes,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
