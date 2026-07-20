// Type surface for the preload bridge (window.jcut).
export {};

export type Backend = "claude" | "local";
export interface AppSettings {
  onboarded: boolean;
  termsAccepted: boolean;
  backend: Backend;
  localMode: "single" | "dual";
  theme: "dark" | "light" | "midnight" | "forest" | "warm" | "slate" | "system";
  accent: "teal" | "ocean" | "indigo" | "violet" | "magenta" | "rose" | "amber" | "emerald" | "lime" | "crimson" | "cyan" | "slate";
  workspace: string;
  claudeConnected: boolean;
  claudeAccount: string | null;
  lmStudioUrl: string;
  lmStudioCoderModel: string | null;
  lmStudioVisionModel: string | null;
  hybridMode: boolean;
  mode: string | null;
  claudeModel: "opus" | "sonnet" | "haiku";
  skillStyleName: string;
  skillImportName: string;
  skillAnalysisName: string;
  sidebarWidth: number;
  panelWidth: number;
  panelCollapsed: boolean;
  showReasoning: boolean;
  density: "compact" | "comfortable" | "spacious";
  fontScale: "small" | "default" | "large";
  radius: "sharp" | "default" | "round";
  uiFont: "system" | "inter" | "rounded" | "mono";
  reduceMotion: boolean;
  grain: boolean;
  lastSeenVersion: string;
}

declare global {
  interface JcutBridge {
    jc(command: string, args?: string[]): Promise<{ ok: boolean; stdout: string; error?: string }>;
    getSettings(): Promise<AppSettings>;
    setSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
    claudeStatus(): Promise<{ ok: boolean; available: boolean; version?: string; bin?: string; note: string }>;
    claudeLoginHelp(): Promise<{ ok: boolean }>;
    lmStudioTest(url: string): Promise<{ ok: boolean; models?: string[]; error?: string; normalizedUrl?: string }>;
    runAgent(prompt: string, chatId?: string, steering?: boolean, runId?: string): Promise<{ ok: boolean }>;
    stopAgent(runId?: string): Promise<{ ok: boolean; stopped: boolean }>;
    onAgentChunk(cb: (chunk: string) => void): () => void;
    onUsageUpdate(cb: (info: any) => void): () => void;
    onAgentDone(cb: (code: string) => void): () => void;
    pickMedia(): Promise<{ ok: boolean; paths?: string[] }>;
    pickDocument(): Promise<{ ok: boolean; paths?: string[] }>;
    pickFolder(): Promise<{ ok: boolean; path?: string }>;
    pickPrproj(): Promise<{ ok: boolean; path?: string }>;
    pickSavePrproj(defaultName?: string): Promise<{ ok: boolean; path?: string }>;
    pickRelink(defaultDir?: string): Promise<{ ok: boolean; path?: string }>;
    readImage(filePath: string): Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
    listWorkspaces(): Promise<{ ok: boolean; workspaces: string[]; meta?: Record<string, number>; home?: string; error?: string }>;
    reveal(p: string): Promise<{ ok: boolean }>;
    chatsList(ws: string): Promise<{ ok: boolean; chats: { id: string; title: string; updated: number }[] }>;
    chatLoad(ws: string, id: string): Promise<{ ok: boolean; chat?: any; error?: string }>;
    chatSave(ws: string, chat: any): Promise<{ ok: boolean }>;
    chatDelete(ws: string, id: string): Promise<{ ok: boolean }>;
    onOpenSettings(cb: () => void): () => void;
    onMenuAction(cb: (action: string) => void): () => void;
    getSystemTheme(): Promise<"dark" | "light">;
    getJcutHome(): Promise<string>;
    projectThumbnail(ws: string): Promise<{ ok: boolean; dataUrl: string | null; isManual?: boolean }>;
    projectStats(ws: string): Promise<{ ok: boolean; sequences: number; chats: number }>;
    setProjectThumbnail(ws: string): Promise<{ ok: boolean; dataUrl?: string | null; isManual?: boolean; canceled?: boolean; error?: string }>;
    resetProjectThumbnail(ws: string): Promise<{ ok: boolean; dataUrl?: string | null; isManual?: boolean; error?: string }>;
    projectDelete(ws: string): Promise<{ ok: boolean; error?: string }>;
    projectRename(ws: string, name: string): Promise<{ ok: boolean; name?: string; error?: string }>;
    projectDuplicate(ws: string): Promise<{ ok: boolean; name?: string; error?: string }>;
  }
  interface Window { jcut: JcutBridge; }
}
