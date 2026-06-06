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
import { spawn } from "node:child_process";

const SR = 22050;          // analysis sample rate
const HOP = 512;           // samples per envelope frame (~23ms at 22.05k)
const FPS = SR / HOP;      // envelope frames per second (~43)

export interface MusicalMap {
  duration_seconds: number;
  bpm: number;
  beat_count: number;
  beats_seconds: number[];          // beat onset timestamps
  downbeats_seconds: number[];      // every 4th beat (bar starts, assumed 4/4)
  sections: { start: number; end: number; energy: "low" | "mid" | "high"; label: string }[];
  confidence: number;               // 0–1, how strong the periodicity is
}

// Decode to mono PCM via ffmpeg, returning Float32 samples in [-1,1].
function decodePcm(file: string): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-v", "quiet", "-i", file,
      "-ac", "1", "-ar", String(SR), "-f", "s16le", "-",
    ]);
    const chunks: Buffer[] = [];
    ff.stdout.on("data", (d) => chunks.push(d));
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code !== 0 && chunks.length === 0) return reject(new Error("ffmpeg decode failed"));
      const buf = Buffer.concat(chunks);
      const n = Math.floor(buf.length / 2);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
      resolve(out);
    });
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
      const energyOnGrid = (period: number) => {
        let best = 0;
        for (let off = 0; off < period; off++) {
          let sum = 0;
          for (let i = off; i < onset.length; i += period) sum += onset[i];
          if (sum > best) best = sum;
        }
        return best;
      };
      const full = energyOnGrid(bestLag);
      const half = energyOnGrid(halfLag);
      if (half >= full * 0.9) { lag = halfLag; bpm = (60 * FPS) / lag; }
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

export async function analyzeMusic(file: string): Promise<MusicalMap> {
  const pcm = await decodePcm(file);
  if (pcm.length < SR) throw new Error("Audio too short or silent to analyze.");
  const env = envelope(pcm);
  const onset = onsetEnvelope(env);
  const { bpm, periodFrames, confidence } = estimateTempo(onset);
  const beats = beatGrid(onset, periodFrames);
  const downbeats = beats.filter((_, i) => i % 4 === 0);
  const sections = energySections(env);
  return {
    duration_seconds: Math.round((pcm.length / SR) * 100) / 100,
    bpm,
    beat_count: beats.length,
    beats_seconds: beats,
    downbeats_seconds: downbeats,
    sections,
    confidence,
  };
}
