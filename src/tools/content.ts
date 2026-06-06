// Clip content awareness — extract representative frames from a video so the
// agent can SEE what each clip is (wide shot, close-up, who/what's in it), and
// cache a short description per clip. This is the "semantic understanding" layer:
// the agent reasons about content, not just filenames and timing.
//
// We don't run our own vision model — we extract frames to disk and let the agent
// (Claude, which has vision) Read them and write a description back via
// `content-set`. Descriptions are cached in <ws>/analysis/content.json.
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { workspaceDir } from "./store.js";

function contentFile(ws: string): string {
  return path.join(workspaceDir(ws), "analysis", "content.json");
}

export interface ClipContent {
  source: string;          // workspace-relative or absolute source path
  description: string;     // what the clip IS (agent-written)
  shot_type?: string;      // wide / medium / close-up / etc.
  subjects?: string[];     // people/objects in frame
  updated: number;
}

export async function loadContent(ws: string): Promise<Record<string, ClipContent>> {
  try { return JSON.parse(await fs.readFile(contentFile(ws), "utf8")); }
  catch { return {}; }
}

export async function saveContent(ws: string, entry: ClipContent): Promise<void> {
  const all = await loadContent(ws);
  all[entry.source] = entry;
  await fs.mkdir(path.dirname(contentFile(ws)), { recursive: true });
  await fs.writeFile(contentFile(ws), JSON.stringify(all, null, 2));
}

// Extract N evenly-spaced frames from a video to <ws>/analysis/frames/<stem>/.
// Returns the frame file paths so the agent can Read and describe them.
export async function extractFrames(
  ws: string, source: string, count = 3,
): Promise<{ frames: string[]; durationSeconds: number }> {
  const abs = path.isAbsolute(source) ? source : path.join(workspaceDir(ws), source);
  const stem = path.basename(source).replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/gi, "_");
  const outDir = path.join(workspaceDir(ws), "analysis", "frames", stem);
  await fs.mkdir(outDir, { recursive: true });

  // Probe duration so we can sample across the whole clip.
  const dur = await probeDuration(abs);
  const frames: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = dur > 0 ? (dur * (i + 0.5)) / count : i; // evenly spaced midpoints
    const out = path.join(outDir, `f${i}.jpg`);
    await runFfmpeg([
      "-y", "-ss", String(t.toFixed(2)), "-i", abs,
      "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", out,
    ]);
    if (await exists(out)) frames.push(out);
  }
  return { frames, durationSeconds: dur };
}

function probeDuration(file: string): Promise<number> {
  return new Promise((resolve) => {
    const ff = spawn("ffprobe", [
      "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", file,
    ]);
    let out = "";
    ff.stdout.on("data", (d) => (out += d));
    ff.on("close", () => resolve(Number(out.trim()) || 0));
    ff.on("error", () => resolve(0));
  });
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve) => {
    const ff = spawn("ffmpeg", args);
    ff.on("close", () => resolve());
    ff.on("error", () => resolve());
  });
}

async function exists(p: string): Promise<boolean> {
  try { await fs.stat(p); return true; } catch { return false; }
}
