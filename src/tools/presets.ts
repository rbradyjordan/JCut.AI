// Editing modes & user presets. A "mode" is a built-in editorial profile (recap,
// talking-head, montage, ad); a "preset" is a user-saved named config that layers
// on top. Both resolve to a block of editing instructions the agent applies.
//
// Stored per user (not per workspace) so presets travel across projects:
//   ~/.../JCutAI/_presets.json
import { promises as fs } from "node:fs";
import path from "node:path";
import { JCUT_HOME } from "./store.js";

export interface EditMode {
  id: string;
  name: string;
  description: string;
  instructions: string; // injected into the agent's working brief
}

// Built-in modes — the editor's "skill packs."
export const BUILTIN_MODES: EditMode[] = [
  {
    id: "recap",
    name: "Recap / Highlights",
    description: "Music-driven montage of best moments with an arc.",
    instructions:
      "MUSIC-DRIVEN recap. Run analyze-music first; pace every cut to the beat map. " +
      "Open on a hook landing on the first downbeat. Escalate cut frequency with section " +
      "energy (low: every 4-8 beats, high: every 1-2 beats). Use speed ramps on the single " +
      "best moment per section. Maximize shot variety (no adjacent repeats). Build to a " +
      "climax and resolve on a held final shot. Hard cuts by default. " +
      "FIRST run `kb-read --id recap-videos` and follow that playbook.",
  },
  {
    id: "talking-head",
    name: "Talking Head",
    description: "Interview / VO with B-roll overlay.",
    instructions:
      "A-roll on V1 carries the story; its audio runs continuously on A1. Lay B-roll on V2 " +
      "over the relevant lines (use the transcript to align visuals to speech). Tight speech " +
      "cuts (15-25ms padding). Punch-ins for emphasis. Captions for key lines. Mind breathing " +
      "room on emotional beats. FIRST run `kb-read --id interviews-dialogue`.",
  },
  {
    id: "montage",
    name: "Montage / Sizzle",
    description: "Fast, beat-driven, no narrative required.",
    instructions:
      "Beat-driven sizzle. analyze-music, cut to the beat, relentless shot variety, open on a " +
      "hook. No narrative arc required — prioritize the strongest shots and energy. Speed ramps " +
      "and beat-synced hard cuts encouraged. FIRST run `kb-read --id recap-videos` (montage section) " +
      "and `kb-read --id pacing-and-rhythm`.",
  },
  {
    id: "ad",
    name: "Ad / Promo",
    description: "Hook → value → CTA, platform-aware.",
    instructions:
      "Structure: hook (first 2s) → problem/value → CTA. Punchy pacing. Captions for retention. " +
      "Match the target platform's aesthetic. End on a clear call to action. " +
      "FIRST run `kb-read --id short-form-social`.",
  },
  {
    id: "trailer",
    name: "Trailer / Hype",
    description: "Cold open → build → drop → title button.",
    instructions:
      "Build an arc: cold open (tone) → build (rising tension, tightening cuts) → montage drop " +
      "(fastest, best shots, beat-synced) → silence/cut-to-black → title button on the final beat. " +
      "Edit to sound design + music. FIRST run `kb-read --id trailer-hype` and `analyze-music`.",
  },
  {
    id: "wedding",
    name: "Wedding / Event",
    description: "Emotion-first highlight + key moments.",
    instructions:
      "Emotion over energy. Include all must-have moments; keep key audio (vows/speeches) clean " +
      "and prioritized; leave breathing room on emotional beats; match color across changing light. " +
      "FIRST run `kb-read --id wedding-event`.",
  },
];

function presetsFile(): string {
  return path.join(JCUT_HOME, "_presets.json");
}

export interface UserPreset extends EditMode { base_mode?: string; }

export async function loadPresets(): Promise<UserPreset[]> {
  try {
    return JSON.parse(await fs.readFile(presetsFile(), "utf8"));
  } catch {
    return [];
  }
}

export async function savePreset(p: UserPreset): Promise<UserPreset[]> {
  const all = await loadPresets();
  const idx = all.findIndex((x) => x.id === p.id);
  if (idx >= 0) all[idx] = p; else all.push(p);
  await fs.mkdir(path.dirname(presetsFile()), { recursive: true });
  await fs.writeFile(presetsFile(), JSON.stringify(all, null, 2));
  return all;
}

export async function deletePreset(id: string): Promise<UserPreset[]> {
  const all = (await loadPresets()).filter((x) => x.id !== id);
  await fs.writeFile(presetsFile(), JSON.stringify(all, null, 2));
  return all;
}

// Resolve a mode/preset id to its instruction block (presets can extend a mode).
export async function resolveInstructions(id: string): Promise<{ name: string; instructions: string } | null> {
  const builtin = BUILTIN_MODES.find((m) => m.id === id);
  if (builtin) return { name: builtin.name, instructions: builtin.instructions };
  const preset = (await loadPresets()).find((p) => p.id === id);
  if (!preset) return null;
  const baseText = preset.base_mode
    ? BUILTIN_MODES.find((m) => m.id === preset.base_mode)?.instructions ?? ""
    : "";
  return { name: preset.name, instructions: `${baseText}\n${preset.instructions}`.trim() };
}
