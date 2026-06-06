// Persistent app settings, stored as JSON in the user-data dir. CommonJS so it
// loads cleanly in the Electron main process.
import { app } from "electron";
import path from "node:path";
import fs from "node:fs";

export type Backend = "claude" | "local";

export interface AppSettings {
  onboarded: boolean;
  backend: Backend;
  theme: "dark" | "light" | "system";
  workspace: string;
  // Claude
  claudeConnected: boolean;
  claudeAccount: string | null;
  // LM Studio
  lmStudioUrl: string;
  lmStudioModel: string | null;
  // Active editing mode/preset id (e.g. "recap", or a user preset id). null = freeform.
  mode: string | null;
  // Resizable panel widths in px (persisted across launches).
  sidebarWidth: number;
  panelWidth: number;
  // Whether the right-hand Sources/Tools/Timeline panel is collapsed to a rail.
  panelCollapsed: boolean;
  // Show the agent's explicit reasoning / raw tool activity instead of the clean
  // collapsed progress view.
  showReasoning: boolean;
}

const DEFAULTS: AppSettings = {
  onboarded: false,
  backend: "claude",
  theme: "system",
  workspace: "default",
  claudeConnected: false,
  claudeAccount: null,
  lmStudioUrl: "http://localhost:1234/v1",
  lmStudioModel: null,
  mode: null,
  sidebarWidth: 264,
  panelWidth: 520,
  panelCollapsed: false,
  showReasoning: false,
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
