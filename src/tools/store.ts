// Workspace + sequence persistence, and ffprobe-based media probing.
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Sequence } from "./model.js";
import { FFPROBE } from "./bin.js";

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

// ── CastCut project persistence ──────────────────────────────────────────────
// CastCut projects live in $JCUT_HOME/_castcut/<id>.ccproj.json — entirely
// separate from AI editor workspaces so the two features stay independent.

export interface CastCutCamera {
  id: string;               // stable id
  name: string;             // "Host", "Guest", "Wide", etc.
  type: "solo" | "wide" | "duo";
  video_track: string;      // "V1" | "V2" | ...
  audio_tracks: string[];   // one or more audio tracks assigned to this camera
  color: string;            // hex color for UI
}

export interface CastCutProject {
  id: string;
  name: string;
  workspace: string;        // which jcut workspace to pull sequences from
  sequence_id: string | null;
  cameras: CastCutCamera[];
  settings: {
    wide_ratio: number;
    cooldown: number;
    silence_threshold: number;
    jump_cut_enabled: boolean;
    jump_cut_threshold: number;
    jump_cut_min_silence: number;
  };
  created_at: number;
  updated_at: number;
  last_output_seq_id: string | null;
}

const CASTCUT_DIR = path.join(JCUT_HOME, "_castcut");

function ccprojPath(id: string): string {
  return path.join(CASTCUT_DIR, `${id}.ccproj.json`);
}

export async function saveCastCutProject(proj: CastCutProject): Promise<string> {
  await fs.mkdir(CASTCUT_DIR, { recursive: true });
  const p = ccprojPath(proj.id);
  await fs.writeFile(p, JSON.stringify({ ...proj, updated_at: Date.now() }, null, 2));
  return p;
}

export async function loadCastCutProject(id: string): Promise<CastCutProject> {
  return JSON.parse(await fs.readFile(ccprojPath(id), "utf8")) as CastCutProject;
}

export async function listCastCutProjects(): Promise<CastCutProject[]> {
  try {
    const files = await fs.readdir(CASTCUT_DIR);
    const out: CastCutProject[] = [];
    for (const f of files) {
      if (f.endsWith(".ccproj.json")) {
        try { out.push(JSON.parse(await fs.readFile(path.join(CASTCUT_DIR, f), "utf8"))); }
        catch { /* skip corrupt */ }
      }
    }
    return out.sort((a, b) => b.updated_at - a.updated_at);
  } catch { return []; }
}

export async function deleteCastCutProject(id: string): Promise<void> {
  try { await fs.unlink(ccprojPath(id)); } catch { /* already gone */ }
}

// ── Media probing via ffprobe ────────────────────────────────────────────────
export interface ProbeResult {
  width?: number;      // display width (rotation already applied)
  height?: number;     // display height (rotation already applied)
  fps?: number;
  duration?: number;
  has_audio: boolean;
  codec?: string;
  // Rotation flag from container metadata (0, 90, 180, 270). When 90/270 the raw
  // stream is sideways and width/height above are ALREADY swapped to display orient.
  rotation?: number;
}

function parseFps(rate?: string): number | undefined {
  if (!rate) return undefined;
  const [n, d] = rate.split("/").map(Number);
  if (!d || !n) return undefined; // "0/0", "1/0", "0/1" → no valid fps
  return n / d;
}

// Two-tier probe cache so we never re-probe the same unchanged file:
//   1. In-memory Map — fast hits within one process run.
//   2. PERSISTENT disk cache (~/.cache/jcut-ai/probe/<hash>.json) — survives
//      across chat sessions and app restarts. The key includes mtime+size so the
//      cache self-invalidates if the file is replaced. This is the big speed win:
//      a 50-clip shoot on a slow SD card is probed ONCE, ever — every later chat
//      reads the cached metadata instantly instead of re-scanning.
const _probeCache = new Map<string, ProbeResult>();
const PROBE_CACHE_DIR = path.join(os.homedir(), ".cache", "jcut-ai", "probe");

async function probeCacheKey(file: string): Promise<string | null> {
  try {
    const st = await fs.stat(file); // follows symlinks to the real target
    const raw = `${path.resolve(file)}:${st.mtimeMs}:${st.size}`;
    let h = 5381;
    for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) >>> 0;
    return h.toString(16).padStart(8, "0");
  } catch {
    return null; // file missing/offline — can't key it; skip disk cache
  }
}

export async function probeMedia(file: string): Promise<ProbeResult> {
  const mem = _probeCache.get(file);
  if (mem) return mem;

  // Disk cache: keyed by resolved path + mtime + size, so a replaced file misses.
  const key = await probeCacheKey(file);
  if (key) {
    try {
      const hit = JSON.parse(await fs.readFile(path.join(PROBE_CACHE_DIR, `${key}.json`), "utf8")) as ProbeResult;
      _probeCache.set(file, hit);
      return hit;
    } catch { /* cache miss — probe below */ }
  }

  // Hard timeout + kill: footage often lives on slow media (SD cards, external
  // drives, network/cloud). A probe that blocks must not hang the whole app — it
  // fails fast and the caller treats the source as offline/unreadable.
  const { stdout } = await pexecFile(FFPROBE, [
    "-v", "quiet",
    "-print_format", "json",
    "-show_streams",
    "-show_format",
    file,
  ], { timeout: 15000, killSignal: "SIGKILL", maxBuffer: 1 << 24 });
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
  const absRot = ((Math.round(rotation) % 360) + 360) % 360;
  if (absRot === 90 || absRot === 270) {
    [width, height] = [height, width];
  }
  const result: ProbeResult = {
    width,
    height,
    fps: parseFps(v?.avg_frame_rate || v?.r_frame_rate),
    duration: Number(data.format?.duration) || Number(v?.duration) || undefined,
    has_audio: !!a,
    codec: v?.codec_name,
    rotation: absRot || undefined,
  };
  _probeCache.set(file, result);
  // Persist for future chats/sessions (best-effort; never fail a probe over it).
  if (key) {
    try {
      await fs.mkdir(PROBE_CACHE_DIR, { recursive: true });
      await fs.writeFile(path.join(PROBE_CACHE_DIR, `${key}.json`), JSON.stringify(result));
    } catch { /* non-fatal */ }
  }
  return result;
}
