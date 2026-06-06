// Type surface for the preload bridge (window.jcut).
export {};

export type Backend = "claude" | "local";
export interface AppSettings {
  onboarded: boolean;
  backend: Backend;
  theme: "dark" | "light" | "system";
  workspace: string;
  claudeConnected: boolean;
  claudeAccount: string | null;
  lmStudioUrl: string;
  lmStudioModel: string | null;
  mode: string | null;
  sidebarWidth: number;
  panelWidth: number;
  panelCollapsed: boolean;
  showReasoning: boolean;
}

declare global {
  interface JcutBridge {
    jc(command: string, args?: string[]): Promise<{ ok: boolean; stdout: string; error?: string }>;
    getSettings(): Promise<AppSettings>;
    setSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
    claudeStatus(): Promise<{ ok: boolean; available: boolean; version?: string; bin?: string; note: string }>;
    claudeLoginHelp(): Promise<{ ok: boolean }>;
    lmStudioTest(url: string): Promise<{ ok: boolean; models?: string[]; error?: string; normalizedUrl?: string }>;
    runAgent(prompt: string): Promise<{ ok: boolean }>;
    stopAgent(): Promise<{ ok: boolean; stopped: boolean }>;
    onAgentChunk(cb: (chunk: string) => void): () => void;
    onAgentDone(cb: (code: string) => void): () => void;
    pickMedia(): Promise<{ ok: boolean; paths?: string[] }>;
    pickFolder(): Promise<{ ok: boolean; path?: string }>;
    pickPrproj(): Promise<{ ok: boolean; path?: string }>;
    readImage(filePath: string): Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
    listWorkspaces(): Promise<{ ok: boolean; workspaces: string[]; home?: string; error?: string }>;
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
  }
  interface Window { jcut: JcutBridge; }
}
