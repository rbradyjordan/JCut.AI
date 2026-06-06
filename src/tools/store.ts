// Workspace + sequence persistence, and ffprobe-based media probing.
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Sequence } from "./model.js";

const pexecFile = promisify(execFile);

// Root for all workspaces (override with JCUT_HOME).
export const JCUT_HOME =
  process.env.JCUT_HOME || path.join(process.env.HOME || ".", "Documents", "JCutAI");

export function workspaceDir(workspace: string): string {
  // Allow either a bare workspace name or an absolute path.
  return path.isAbsolute(workspace) ? workspace : path.join(JCUT_HOME, workspace);
}

function seqPath(workspace: string, id: string): string {
  return path.join(workspaceDir(workspace), "sequences", `${id}.jcseq.json`);
}

export async function ensureWorkspace(workspace: string): Promise<string> {
  const root = workspaceDir(workspace);
  for (const sub of ["source", "sequences", "renders", "analysis"]) {
    await fs.mkdir(path.join(root, sub), { recursive: true });
  }
  return root;
}

export async function saveSequence(workspace: string, seq: Sequence): Promise<string> {
  await ensureWorkspace(workspace);
  const p = seqPath(workspace, seq.id);
  await fs.writeFile(p, JSON.stringify(seq, null, 2));
  return p;
}

export async function loadSequence(workspace: string, id: string): Promise<Sequence> {
  const raw = await fs.readFile(seqPath(workspace, id), "utf8");
  return JSON.parse(raw) as Sequence;
}

export async function listSequences(workspace: string): Promise<Sequence[]> {
  const dir = path.join(workspaceDir(workspace), "sequences");
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: Sequence[] = [];
  for (const f of files) {
    if (f.endsWith(".jcseq.json")) {
      out.push(JSON.parse(await fs.readFile(path.join(dir, f), "utf8")));
    }
  }
  return out;
}

// ── Media probing via ffprobe ────────────────────────────────────────────────
export interface ProbeResult {
  width?: number;
  height?: number;
  fps?: number;
  duration?: number;
  has_audio: boolean;
  codec?: string;
}

function parseFps(rate?: string): number | undefined {
  if (!rate) return undefined;
  const [n, d] = rate.split("/").map(Number);
  if (!d) return n || undefined;
  return n / d;
}

export async function probeMedia(file: string): Promise<ProbeResult> {
  const { stdout } = await pexecFile("ffprobe", [
    "-v", "quiet",
    "-print_format", "json",
    "-show_streams",
    "-show_format",
    file,
  ]);
  const data = JSON.parse(stdout);
  const streams: any[] = data.streams || [];
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  // Honor rotation metadata: a portrait iPhone clip reports landscape raw dims.
  let width = v?.width;
  let height = v?.height;
  const rotation =
    Number(v?.tags?.rotate) ||
    Number(v?.side_data_list?.find((s: any) => s.rotation != null)?.rotation) ||
    0;
  if (Math.abs(rotation) === 90 || Math.abs(rotation) === 270) {
    [width, height] = [height, width];
  }
  return {
    width,
    height,
    fps: parseFps(v?.avg_frame_rate || v?.r_frame_rate),
    duration: Number(data.format?.duration) || Number(v?.duration) || undefined,
    has_audio: !!a,
    codec: v?.codec_name,
  };
}
