import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const pexecFile = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const ANALYZE_VIDEO_PY = path.join(PROJECT_ROOT, "src", "tools", "analyze_video.py");
const CACHE_DIR = path.join(os.homedir(), ".cache", "jcut-ai", "video-analysis");
const CACHE_VERSION = "v2";

export interface VideoAnalysis {
  composition: {
    shot_type: string;
    confidence: number;
    center_focus_ratio?: number;
    overall_edge_density?: number;
    frame_analyses?: Array<{ time: number; type: string; overall_density?: number; focus_ratio?: number; model_confidence?: number }>;
    opencv_used?: boolean;
    model_used?: boolean;
    model_error?: string;
  };
  motion: {
    camera_settle_seconds: number;
    motion_peaks_seconds: number[];
    motion_curve?: Array<{ time: number; motion: number; flow?: number; delta?: number }>;
    opencv_used?: boolean;
    note?: string;
    motion_method?: string;
  };
}

async function cacheKey(file: string): Promise<string> {
  const stat = await fs.stat(file);
  const raw = `${CACHE_VERSION}:${path.resolve(file)}:${stat.mtimeMs}:${stat.size}`;
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

async function readDiskCache(key: string): Promise<VideoAnalysis | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(CACHE_DIR, `${key}.json`), "utf8")) as VideoAnalysis;
  } catch {
    return null;
  }
}

async function writeDiskCache(key: string, data: VideoAnalysis): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(data));
  } catch {
    // Non-fatal cache failure.
  }
}

async function detectPython(): Promise<string> {
  const candidates = [
    path.join(PROJECT_ROOT, "venv", "bin", "python3"),
    "/opt/homebrew/bin/python3",
    "/usr/local/bin/python3",
    "python3",
  ];
  for (const candidate of candidates) {
    try {
      await pexecFile(candidate, ["--version"], { timeout: 5000 });
      return candidate;
    } catch {
      // Try next candidate.
    }
  }
  throw new Error("Python 3 was not found. Install it or create ./venv for video analysis.");
}

async function runAnalysis(file: string, type: "composition" | "motion"): Promise<any> {
  const python = await detectPython();
  const { stdout } = await pexecFile(python, [ANALYZE_VIDEO_PY, "--file", file, "--type", type], {
    timeout: 120000,
    maxBuffer: 1 << 24,
  });
  const parsed = JSON.parse(stdout);
  if (!parsed?.ok) {
    throw new Error(parsed?.error || `Video ${type} analysis failed.`);
  }
  return parsed;
}

export async function analyzeVideo(file: string): Promise<VideoAnalysis> {
  const key = await cacheKey(file);
  const hit = await readDiskCache(key);
  if (hit) return hit;

  const [composition, motion] = await Promise.all([
    runAnalysis(file, "composition"),
    runAnalysis(file, "motion"),
  ]);

  const result: VideoAnalysis = {
    composition: {
      shot_type: composition.shot_type || "Medium Shot (MS)",
      confidence: Number(composition.confidence) || 0,
      center_focus_ratio: composition.center_focus_ratio,
      overall_edge_density: composition.overall_edge_density,
      frame_analyses: Array.isArray(composition.frame_analyses) ? composition.frame_analyses : [],
      opencv_used: !!composition.opencv_used,
      model_used: !!composition.model_used,
      model_error: composition.model_error,
    },
    motion: {
      camera_settle_seconds: Number(motion.camera_settle_seconds) || 0,
      motion_peaks_seconds: Array.isArray(motion.motion_peaks_seconds) ? motion.motion_peaks_seconds.map(Number) : [],
      motion_curve: Array.isArray(motion.motion_curve) ? motion.motion_curve : [],
      opencv_used: !!motion.opencv_used,
      note: motion.note,
      motion_method: motion.motion_method,
    },
  };

  await writeDiskCache(key, result);
  return result;
}
