// Persistent app settings, stored as JSON in the user-data dir. CommonJS so it
// loads cleanly in the Electron main process.
import { app } from "electron";
import path from "node:path";
import fs from "node:fs";

export type Backend = "claude" | "local";

export interface AppSettings {
  onboarded: boolean;
  termsAccepted: boolean;
  backend: Backend;
  localMode: "single" | "dual";
  theme: "dark" | "light" | "system";
  // Brand accent color — paints buttons, toggles, active states, glows, and a
  // subtle background tint. Independent of `theme` (the surface mood).
  accent: "teal" | "ocean" | "indigo" | "violet" | "magenta" | "rose" | "amber" | "emerald" | "lime" | "crimson" | "cyan" | "slate";
  workspace: string;
  // Claude
  claudeConnected: boolean;
  claudeAccount: string | null;
  // LM Studio
  lmStudioUrl: string;
  lmStudioCoderModel: string | null;
  lmStudioVisionModel: string | null;
  hybridMode: boolean;
  // Active editing mode/preset id (e.g. "recap", or a user preset id). null = freeform.
  mode: string | null;
  // Claude model: "opus" (most capable) | "sonnet" (balanced) | "haiku" (fastest). Default opus.
  claudeModel: "opus" | "sonnet" | "haiku";
  // Skill defaults used by the quick-action chips.
  skillStyleName: string;
  skillImportName: string;
  skillAnalysisName: string;
  // Resizable panel widths in px (persisted across launches).
  sidebarWidth: number;
  panelWidth: number;
  // Whether the right-hand Sources/Tools/Timeline panel is collapsed to a rail.
  panelCollapsed: boolean;
  // Show the agent's explicit reasoning / raw tool activity instead of the clean
  // collapsed progress view.
  showReasoning: boolean;
  // ── Display & feel (drives CSS vars via applyDisplay in the renderer) ──
  density: "compact" | "comfortable" | "spacious";
  fontScale: "small" | "default" | "large";
  radius: "sharp" | "default" | "round";
  uiFont: "system" | "inter" | "rounded" | "mono";
  reduceMotion: boolean;
  grain: boolean;
  lastSeenVersion: string;
}

const DEFAULTS: AppSettings = {
  onboarded: false,
  termsAccepted: false,
  backend: "local",
  localMode: "single",
  theme: "system",
  accent: "teal",
  workspace: "default",
  claudeConnected: false,
  claudeAccount: null,
  lmStudioUrl: "http://localhost:1234/v1",
  lmStudioCoderModel: null,
  lmStudioVisionModel: null,
  hybridMode: false,
  mode: null,
  claudeModel: "opus",
  skillStyleName: "default",
  skillImportName: "",
  skillAnalysisName: "",
  sidebarWidth: 264,
  panelWidth: 520,
  panelCollapsed: false,
  showReasoning: false,
  density: "compact",
  fontScale: "default",
  radius: "default",
  uiFont: "system",
  reduceMotion: false,
  grain: true,
  lastSeenVersion: "",
};

function file(): string {
  return path.join(app.getPath("userData"), "jcut-settings.json");
}

export function loadSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(file(), "utf8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...loadSettings(), ...patch };
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(next, null, 2));
  return next;
}
