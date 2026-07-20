// Silero VAD in pure Node — no Python, no torch, no network.
//
// Runs the vendored silero_vad.onnx (MIT, ~2MB) through onnxruntime-node, so
// the PACKAGED app gets the same speech-probability quality as the dev-machine
// Python path. Streaming protocol per the reference implementation: 512-sample
// windows at 16kHz (~31.25 fps), carrying the recurrent state between windows.
//
// Supports both model generations, detected from the session's input names:
//   v5: input [1,512], state [2,1,128], sr → output, stateN
//   v4: input [1,512], h [2,1,64], c [2,1,64], sr → output, hn, cn
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FFMPEG } from "./bin.js";

const SR = 16000;
const HOP = 512;
export const VAD_FPS = SR / HOP; // 31.25

const _projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MODEL_PATH = path.join(_projectRoot, "third_party", "silero-vad", "silero_vad.onnx");

let _session: any | null = null;
let _sessionFailed = false;

async function getSession(): Promise<any | null> {
  if (_session) return _session;
  if (_sessionFailed) return null;
  try {
    await fs.access(MODEL_PATH);
    const ort = await import("onnxruntime-node");
    _session = await ort.InferenceSession.create(MODEL_PATH, {
      interOpNumThreads: 1,
      intraOpNumThreads: 1,
      logSeverityLevel: 3,
    });
    return _session;
  } catch {
    _sessionFailed = true;
    return null;
  }
}

function decode16k(file: string): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG, [
      "-v", "quiet", "-i", file, "-ac", "1", "-ar", String(SR), "-f", "s16le", "-",
    ]);
    const chunks: Buffer[] = [];
    let done = false;
    const finish = (fn: () => void) => { if (!done) { done = true; fn(); } };
    const timer = setTimeout(() => {
      try { ff.kill("SIGKILL"); } catch { /* ok */ }
      finish(() => reject(new Error("audio decode timed out")));
    }, 300000);
    ff.stdout.on("data", (d: Buffer) => chunks.push(d));
    ff.on("error", (e: Error) => { clearTimeout(timer); finish(() => reject(e)); });
    ff.on("close", (code: number | null) => {
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

export async function nodeVadAvailable(): Promise<boolean> {
  return (await getSession()) !== null;
}

// Per-frame speech probabilities (0–1) at ~31.25 fps for a whole file.
// Throws if the model/runtime is unavailable — callers fall back to RMS.
export async function analyzeVadEnvelopeNode(file: string): Promise<{ values: number[]; fps: number }> {
  const session = await getSession();
  if (!session) throw new Error("Silero ONNX model or onnxruntime-node unavailable");
  const ort = await import("onnxruntime-node");

  const pcm = await decode16k(file);
  const frames = Math.floor(pcm.length / HOP);
  const values: number[] = new Array(Math.max(0, frames));

  const inputNames: string[] = session.inputNames;
  const isV5 = inputNames.includes("state");
  const srTensor = new ort.Tensor("int64", BigInt64Array.from([BigInt(SR)]), [1]);

  // Recurrent state, zeroed at stream start (reset_states equivalent).
  let state = isV5 ? new ort.Tensor("float32", new Float32Array(2 * 1 * 128), [2, 1, 128]) : null;
  let h = !isV5 ? new ort.Tensor("float32", new Float32Array(2 * 1 * 64), [2, 1, 64]) : null;
  let c = !isV5 ? new ort.Tensor("float32", new Float32Array(2 * 1 * 64), [2, 1, 64]) : null;

  // v5 prepends a 64-sample CONTEXT (tail of the previous chunk) to every
  // 512-sample window — the model input is [1, 576]. Feeding bare 512 windows
  // silently yields near-zero probabilities (reference: utils_vad.py).
  const CTX = 64;
  const ctxBuf = new Float32Array(CTX); // zeros at stream start
  const winBuf = new Float32Array(CTX + HOP);

  for (let i = 0; i < frames; i++) {
    const chunk = pcm.subarray(i * HOP, (i + 1) * HOP);
    let input;
    if (isV5) {
      winBuf.set(ctxBuf, 0);
      winBuf.set(chunk, CTX);
      input = new ort.Tensor("float32", Float32Array.from(winBuf), [1, CTX + HOP]);
      ctxBuf.set(chunk.subarray(HOP - CTX)); // carry the tail as next context
    } else {
      input = new ort.Tensor("float32", Float32Array.from(chunk), [1, HOP]);
    }
    const feeds: Record<string, any> = { input, sr: srTensor };
    if (isV5) feeds.state = state;
    else { feeds.h = h; feeds.c = c; }
    const res = await session.run(feeds);
    const prob = Number((res.output ?? res[session.outputNames[0]]).data[0]);
    values[i] = Math.round(prob * 10000) / 10000;
    if (isV5) state = res.stateN ?? res[session.outputNames[1]];
    else {
      h = res.hn ?? res[session.outputNames[1]];
      c = res.cn ?? res[session.outputNames[2]];
    }
  }
  return { values, fps: VAD_FPS };
}
