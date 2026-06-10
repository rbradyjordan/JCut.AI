// Per-workspace editing CRITERIA — the user's opt-in/opt-out choices for the
// expensive or optional analysis steps, plus their hard creative constraints.
//
// The whole point: NOT every project wants beat-synced cutting or a transcript.
// A silent B-roll montage doesn't need transcription; a quick selects pull
// doesn't need a music map. Running those anyway wastes minutes and tokens.
// Criteria let the user (or the agent, with the user's confirmation) declare
// what matters up front, and the agent reads this FIRST and respects it.
//
// Stored per-workspace at <ws>/criteria.json so each project keeps its own.
import { promises as fs } from "node:fs";
import path from "node:path";
import { workspaceDir } from "./store.js";

// A tri-state for optional capabilities:
//   "on"   — always do it (user wants it)
//   "off"  — never do it (user opted out; don't even suggest repeatedly)
//   "auto" — agent decides based on content + the deliverable (default)
export type Toggle = "on" | "off" | "auto";

export interface Criteria {
  // ── Optional analysis steps (the expensive ones) ──────────────────────────
  beat_analysis: Toggle;     // analyze-music + beat-synced pacing
  transcription: Toggle;     // (when available) word-level speech timing
  content_analysis: Toggle;  // vision frame-sampling to understand each clip

  // ── Creative constraints the agent must honor ─────────────────────────────
  target_platform?: string;  // "tiktok" | "youtube" | "instagram" | "broadcast" | free text
  target_duration_seconds?: number; // desired finished length, if fixed
  captions_wanted?: boolean; // does the deliverable need on-screen text?
  music_driven?: boolean;    // is the edit paced to music? (implies beat_analysis)
  notes?: string;            // any free-form user direction

  updated: number;
}

export const DEFAULT_CRITERIA: Criteria = {
  beat_analysis: "auto",
  transcription: "auto",
  content_analysis: "auto",
  updated: 0,
};

function criteriaPath(ws: string): string {
  return path.join(workspaceDir(ws), "criteria.json");
}

export async function loadCriteria(ws: string): Promise<Criteria> {
  try {
    const raw = JSON.parse(await fs.readFile(criteriaPath(ws), "utf8"));
    return { ...DEFAULT_CRITERIA, ...raw };
  } catch {
    return { ...DEFAULT_CRITERIA };
  }
}

export async function saveCriteria(ws: string, patch: Partial<Criteria>): Promise<Criteria> {
  const current = await loadCriteria(ws);
  const next: Criteria = { ...current, ...patch, updated: Date.now() };
  await fs.mkdir(path.dirname(criteriaPath(ws)), { recursive: true });
  await fs.writeFile(criteriaPath(ws), JSON.stringify(next, null, 2));
  return next;
}

// Resolve whether an optional step should run, given the criteria and a signal
// the agent passes about whether the content/deliverable calls for it.
// Returns { run, reason } so the agent can explain its choice to the user.
export function shouldRun(
  toggle: Toggle,
  autoSignal: boolean,
  label: string,
): { run: boolean; reason: string } {
  if (toggle === "on") return { run: true, reason: `${label}: user turned it ON` };
  if (toggle === "off") return { run: false, reason: `${label}: user turned it OFF — skipping` };
  return {
    run: autoSignal,
    reason: autoSignal
      ? `${label}: auto — the content/deliverable calls for it`
      : `${label}: auto — not needed for this deliverable, skipping`,
  };
}

// A human-readable summary of the active criteria for the agent's brief.
export function summarizeCriteria(c: Criteria): string {
  const lines: string[] = [];
  const tog = (t: Toggle) => (t === "auto" ? "auto (agent decides)" : t.toUpperCase());
  lines.push(`- Beat analysis: ${tog(c.beat_analysis)}`);
  lines.push(`- Transcription: ${tog(c.transcription)}`);
  lines.push(`- Content (vision) analysis: ${tog(c.content_analysis)}`);
  if (c.music_driven != null) lines.push(`- Music-driven edit: ${c.music_driven ? "yes" : "no"}`);
  if (c.captions_wanted != null) lines.push(`- Captions wanted: ${c.captions_wanted ? "yes" : "no"}`);
  if (c.target_platform) lines.push(`- Platform: ${c.target_platform}`);
  if (c.target_duration_seconds) lines.push(`- Target duration: ${c.target_duration_seconds}s`);
  if (c.notes) lines.push(`- Notes: ${c.notes}`);
  return lines.join("\n");
}
