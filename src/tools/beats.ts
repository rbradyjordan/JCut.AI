// Musical-map analysis — beats, BPM, and energy sections from an audio/video
// file's waveform. Lets the agent pace edits to the music (beat-matched cuts,
// section-aware structure).
//
// Pipeline (all local, ffmpeg + pure JS — no external libs):
//   1. ffmpeg → mono 22.05kHz raw PCM (s16le)
//   2. frame the signal, compute per-frame RMS energy envelope
//   3. onset detection = positive energy flux (spectral-flux-lite on RMS)
//   4. tempo via autocorrelation of the onset envelope (search 60–180 BPM)
//   5. beat grid = phase-aligned clicks at the estimated period
//   6. energy sections = segment the envelope into low/mid/high-energy spans
import { spawn, execFile } from "node:child_process";
import { FFMPEG, FFPROBE } from "./bin.js";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const pexecFile = promisify(execFile);

const SR = 11025;          // analysis sample rate (plenty for beat detection; half the work)
const HOP = 256;           // samples per envelope frame (~23ms at 11.025k)
const FPS = SR / HOP;      // envelope frames per second (~43)

export interface MusicalMap {
  duration_seconds: number;         // TRUE full duration of the source (not the analysis window)
  analyzed_seconds: number;         // how much was actually decoded for tempo/sections
  beats_extrapolated: boolean;      // true if the grid was extended past the analyzed window
  audioflux_used?: boolean;         // true when the AudioFlux bridge produced the map
  bpm: number;
  beat_count: number;
  beats_seconds: number[];          // beat onset timestamps (cover the FULL duration)
  downbeats_seconds: number[];      // every 4th beat (bar starts, assumed 4/4)
  sections: { start: number; end: number; energy: "low" | "mid" | "high"; label: string }[];
  confidence: number;               // 0–1, how strong the periodicity is
  key?: string;                     // detected musical key
}

// Cap the analysis window. Tempo + structure are stable across a track, so we
// don't need to decode 5+ minutes — analyzing a bounded window keeps the call
// fast and prevents the "stuck analyzing the music" hang on long files.
// 60s is enough for a solid beat map and keeps peak RAM under ~12MB PCM.
const MAX_ANALYZE_SECONDS = 60;

// Decode to mono PCM via ffmpeg, returning Float32 samples in [-1,1]. Bounded by
// MAX_ANALYZE_SECONDS and a hard process timeout so it can never hang forever.
function decodePcm(file: string): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG, [
      "-v", "quiet",
      "-t", String(MAX_ANALYZE_SECONDS), // decode at most this many seconds
      "-i", file,
      "-ac", "1", "-ar", String(SR), "-f", "s16le", "-",
    ]);
    const chunks: Buffer[] = [];
    let done = false;
    const finish = (fn: () => void) => { if (!done) { done = true; fn(); } };
    // Safety timeout: kill ffmpeg if it runs too long (corrupt/huge input).
    const timer = setTimeout(() => {
      try { ff.kill("SIGKILL"); } catch { /* ok */ }
      finish(() => reject(new Error("Audio analysis timed out — file too large or unreadable.")));
    }, 60000);
    ff.stdout.on("data", (d) => chunks.push(d));
    ff.on("error", (e) => { clearTimeout(timer); finish(() => reject(e)); });
    ff.on("close", (code) => {
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

// Probe the TRUE full duration of the source (the analysis window is capped at
// MAX_ANALYZE_SECONDS, but tempo is stable so we extrapolate the beat grid across
// the whole song — the agent needs beats for the full timeline, not just 60s).
function probeTrueDuration(file: string): Promise<number> {
  return new Promise((resolve) => {
    const ff = spawn(FFPROBE, [
      "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", file,
    ]);
    let out = "";
    const timer = setTimeout(() => { try { ff.kill("SIGKILL"); } catch { /* */ } resolve(0); }, 15000);
    ff.stdout.on("data", (d) => (out += d));
    ff.on("close", () => { clearTimeout(timer); resolve(Number(out.trim()) || 0); });
    ff.on("error", () => { clearTimeout(timer); resolve(0); });
  });
}

// Per-frame RMS energy envelope.
function envelope(pcm: Float32Array): Float32Array {
  const frames = Math.floor(pcm.length / HOP);
  const env = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    const base = i * HOP;
    for (let j = 0; j < HOP; j++) { const s = pcm[base + j]; sum += s * s; }
    env[i] = Math.sqrt(sum / HOP);
  }
  return env;
}

// Onset strength = half-wave-rectified energy flux (rise in energy).
function onsetEnvelope(env: Float32Array): Float32Array {
  const o = new Float32Array(env.length);
  for (let i = 1; i < env.length; i++) {
    const d = env[i] - env[i - 1];
    o[i] = d > 0 ? d : 0;
  }
  return o;
}

// Estimate tempo via autocorrelation of the onset envelope over 60–180 BPM.
function estimateTempo(onset: Float32Array): { bpm: number; periodFrames: number; confidence: number } {
  const minBpm = 60, maxBpm = 180;
  const minLag = Math.round((60 / maxBpm) * FPS);
  const maxLag = Math.round((60 / minBpm) * FPS);
  let bestLag = minLag, bestScore = -1;
  // mean-remove for a cleaner autocorrelation
  let mean = 0; for (const v of onset) mean += v; mean /= onset.length || 1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0;
    for (let i = lag; i < onset.length; i++) score += (onset[i] - mean) * (onset[i - lag] - mean);
    score /= (onset.length - lag);
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  // confidence: peak score normalized against the zero-lag energy
  let zero = 0; for (const v of onset) zero += (v - mean) * (v - mean);
  zero /= onset.length || 1;
  const confidence = zero > 0 ? Math.max(0, Math.min(1, bestScore / zero)) : 0;

  // Octave correction: autocorrelation often locks onto half-tempo (a strong
  // peak also appears at 2× the true period). If the detected tempo is slow and
  // the half-period lag carries comparable onset energy, prefer the faster tempo.
  let lag = bestLag;
  let bpm = (60 * FPS) / lag;
  if (bpm < 100) {
    const halfLag = Math.round(bestLag / 2);
    if (halfLag >= minLag) {
      // Compare onset energy landing on each grid; if the half-period grid is
      // nearly as strong, the music is actually at double tempo.
      // PER-GRID-POINT MEAN energy (NOT raw sum). The half-period grid samples
      // ~2× as many frames, so a raw-sum comparison is always biased toward the
      // half grid and would double every slow song. Averaging per hit point makes
      // the comparison fair: the faster tempo only wins if its beat positions
      // genuinely carry comparable onset strength.
      const energyOnGrid = (period: number) => {
        let best = 0;
        for (let off = 0; off < period; off++) {
          let sum = 0, count = 0;
          for (let i = off; i < onset.length; i += period) { sum += onset[i]; count++; }
          const mean = count > 0 ? sum / count : 0;
          if (mean > best) best = mean;
        }
        return best;
      };
      const full = energyOnGrid(bestLag);
      const half = energyOnGrid(halfLag);
      // Require the half-period (double-tempo) grid to carry clearly stronger
      // per-beat energy before switching — a true ballad's off-beats are weak,
      // so its half-grid average drops well below the on-beat average.
      if (half >= full * 1.05) { lag = halfLag; bpm = (60 * FPS) / lag; }
    }
  }
  return { bpm: Math.round(bpm * 10) / 10, periodFrames: lag, confidence: Math.round(confidence * 100) / 100 };
}

// Phase-align the beat grid: pick the offset (0..period) that lands on the most onset energy.
function beatGrid(onset: Float32Array, periodFrames: number): number[] {
  let bestOffset = 0, bestSum = -1;
  for (let off = 0; off < periodFrames; off++) {
    let sum = 0;
    for (let i = off; i < onset.length; i += periodFrames) sum += onset[i];
    if (sum > bestSum) { bestSum = sum; bestOffset = off; }
  }
  const beats: number[] = [];
  for (let i = bestOffset; i < onset.length; i += periodFrames) beats.push(Math.round((i / FPS) * 1000) / 1000);
  return beats;
}

// Segment the smoothed energy envelope into low/mid/high sections.
function energySections(env: Float32Array): MusicalMap["sections"] {
  // Smooth over ~1s
  const win = Math.round(FPS);
  const smooth = new Float32Array(env.length);
  let acc = 0;
  for (let i = 0; i < env.length; i++) {
    acc += env[i];
    if (i >= win) acc -= env[i - win];
    smooth[i] = acc / Math.min(i + 1, win);
  }
  const sorted = [...smooth].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.33)] || 0;
  const hi = sorted[Math.floor(sorted.length * 0.66)] || 0;
  const level = (v: number): "low" | "mid" | "high" => (v < lo ? "low" : v > hi ? "high" : "mid");

  const sections: MusicalMap["sections"] = [];
  let curStart = 0, curLevel = level(smooth[0] || 0);
  const minLen = Math.round(FPS * 4); // ignore <4s flickers
  for (let i = 1; i < smooth.length; i++) {
    const l = level(smooth[i]);
    if (l !== curLevel && i - curStart >= minLen) {
      sections.push(makeSection(curStart, i, curLevel));
      curStart = i; curLevel = l;
    }
  }
  sections.push(makeSection(curStart, smooth.length, curLevel));
  return sections;
}

function makeSection(s: number, e: number, energy: "low" | "mid" | "high"): MusicalMap["sections"][number] {
  const label = energy === "high" ? "drop / chorus" : energy === "low" ? "intro / breakdown" : "verse / build";
  return { start: Math.round((s / FPS) * 100) / 100, end: Math.round((e / FPS) * 100) / 100, energy, label };
}

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

// Disk cache so results survive across CLI invocations. Stored in
// ~/.cache/jcut-ai/beats/<hex-hash>.json keyed by absolute path + mtime.
// A cache hit returns in <5ms instead of 60-90s.
const CACHE_DIR = path.join(os.homedir(), ".cache", "jcut-ai", "beats");
const CACHE_VERSION = "v2";

async function cacheKey(file: string): Promise<string> {
  const stat = await fs.stat(file);
  const raw = `${CACHE_VERSION}:${path.resolve(file)}:${stat.mtimeMs}:${stat.size}`;
  // Simple djb2-style hash — no crypto needed, just a stable key.
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

async function readDiskCache(key: string): Promise<MusicalMap | null> {
  try {
    const p = path.join(CACHE_DIR, `${key}.json`);
    return JSON.parse(await fs.readFile(p, "utf8")) as MusicalMap;
  } catch { return null; }
}

async function writeDiskCache(key: string, map: MusicalMap): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(map));
  } catch { /* non-fatal */ }
}

export async function analyzeMusic(file: string): Promise<MusicalMap> {
  const key = await cacheKey(file);
  const hit = await readDiskCache(key);
  if (hit) return hit;

  // Try running Python AudioFlux analyzer first
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
    const VENV_PYTHON = path.join(PROJECT_ROOT, "venv", "bin", "python3");
    const ANALYZE_AUDIO_PY = path.join(PROJECT_ROOT, "src", "tools", "analyze_audio.py");

    const { stdout } = await pexecFile(VENV_PYTHON, [ANALYZE_AUDIO_PY, "--file", file]);
    const parsed = JSON.parse(stdout);
    if (parsed.ok) {
      const result: MusicalMap = {
        duration_seconds: parsed.duration_seconds,
        analyzed_seconds: parsed.analyzed_seconds,
        beats_extrapolated: parsed.beats_extrapolated,
        audioflux_used: !!parsed.audioflux_used,
        bpm: parsed.bpm,
        beat_count: parsed.beat_count,
        beats_seconds: parsed.beats_seconds,
        downbeats_seconds: parsed.downbeats_seconds,
        sections: parsed.sections,
        confidence: parsed.confidence,
        key: parsed.key,
      };
      await writeDiskCache(key, result);
      return result;
    }
  } catch (err) {
    // Graceful fallback to native JS below
  }

  // Decode the bounded analysis window AND probe the true full duration in
  // parallel — tempo/sections come from the window, the beat grid is extended
  // to cover the whole song.
  const [pcm, trueDuration] = await Promise.all([decodePcm(file), probeTrueDuration(file)]);
  if (pcm.length < SR) throw new Error("Audio too short, silent, or unreadable (is the source file available?).");
  const env = envelope(pcm);
  const onset = onsetEnvelope(env);
  const { bpm, periodFrames, confidence } = estimateTempo(onset);
  const beats = beatGrid(onset, periodFrames);

  const analyzedSeconds = Math.round((pcm.length / SR) * 100) / 100;
  // Full duration = the probed value, or the analyzed window if probe failed.
  const fullDuration = trueDuration > analyzedSeconds ? Math.round(trueDuration * 100) / 100 : analyzedSeconds;

  // Extrapolate the beat grid across the full song. Tempo is near-constant in
  // virtually all music, so continuing the grid at the same period gives the
  // agent usable beats past the analyzed window instead of a hard stop at 60s.
  const periodSeconds = bpm > 0 ? 60 / bpm : 0;
  let extrapolated = false;
  if (periodSeconds > 0 && beats.length >= 2 && fullDuration > analyzedSeconds) {
    let next = beats[beats.length - 1] + periodSeconds;
    while (next <= fullDuration) {
      beats.push(Math.round(next * 1000) / 1000);
      next += periodSeconds;
    }
    extrapolated = true;
  }

  const downbeats = beats.filter((_, i) => i % 4 === 0);
  const sections = energySections(env);
  const result: MusicalMap = {
    duration_seconds: fullDuration,
    analyzed_seconds: analyzedSeconds,
    beats_extrapolated: extrapolated,
    audioflux_used: false,
    bpm,
    beat_count: beats.length,
    beats_seconds: beats,
    downbeats_seconds: downbeats,
    sections,
    confidence,
  };
  await writeDiskCache(key, result);
  return result;
}
