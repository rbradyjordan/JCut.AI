// DEV-ONLY browser mock of the Electron `window.jcut` bridge.
//
// Lets the renderer run in a plain browser (vite dev) for visual/layout work
// without Electron. Installed ONLY when window.jcut is missing AND import.meta
// .env.DEV is true, so it can never affect the packaged app. Returns enough
// canned data to render the launcher, Home dashboard, and grids.
export function installDevMockIfNeeded() {
  if (typeof window === "undefined") return;
  if ((window as any).jcut) return;
  if (!import.meta.env.DEV) return;

  const settings = {
    onboarded: true, termsAccepted: true, backend: "claude", hybridMode: false,
    localMode: "single", theme: "dark", accent: "teal", workspace: "Demo Project",
    lastSeenVersion: "9.9.9", sidebarWidth: 264, panelWidth: 320,
  };
  const workspaces = ["Podcast Ep. 12", "Brand Launch Reel", "Wedding Highlights", "Demo Project"];
  const castcutProjects = [
    { id: "cc1", name: "Founders Podcast — Ep 12", workspace: "Podcast Ep. 12",
      sequence_id: "seq1", cameras: [
        { id: "a", name: "Host", type: "solo", video_track: "V1", audio_tracks: ["A1"], color: "#23C6A2" },
        { id: "b", name: "Guest", type: "solo", video_track: "V2", audio_tracks: ["A2"], color: "#2E6BE6" },
        { id: "c", name: "Wide", type: "wide", video_track: "V3", audio_tracks: [], color: "#8B5CF6" },
      ], settings: {}, created_at: Date.now() - 86400000, updated_at: Date.now() - 3600000, last_output_seq_id: null },
    { id: "cc2", name: "Interview Series", workspace: "Demo Project",
      sequence_id: null, cameras: [], settings: {}, created_at: Date.now() - 200000000, updated_at: Date.now() - 172800000, last_output_seq_id: null },
  ];

  const now = Date.now();
  const meta: Record<string, number> = {
    "Podcast Ep. 12": now - 1800000, "Brand Launch Reel": now - 7200000,
    "Wedding Highlights": now - 259200000, "Demo Project": now - 500000000,
  };

  (window as any).jcut = {
    getSettings: async () => settings,
    setSettings: async () => ({ ok: true }),
    listWorkspaces: async () => ({ ok: true, workspaces, meta, home: "/Users/demo/Documents/JCutAI" }),
    projectThumbnail: async () => ({ ok: true, dataUrl: null, isManual: false }),
    projectStats: async () => ({ ok: true, sequences: 2, chats: 3 }),
    getSystemTheme: async () => "dark",
    getJcutHome: async () => "/Users/demo/Documents/JCutAI",
    claudeStatus: async () => ({ ok: true, loggedIn: true }),
    claudeUsage: async () => ({ ok: true }),
    onMenuAction: () => () => {},
    onClaudeUsage: () => () => {},
    onOpenSettings: () => () => {},
    onUsageUpdate: () => () => {},
    onAgentChunk: () => () => {},
    onAgentDone: () => () => {},
    reveal: async () => ({ ok: true }),
    jc: async (cmd: string) => {
      if (cmd === "castcut-projects-list") return { ok: true, stdout: JSON.stringify({ ok: true, projects: castcutProjects }) };
      if (cmd === "premiere-panel-status") return { ok: true, stdout: JSON.stringify({ ok: true, premiere_installed: true, panel_installed: true, panel_up_to_date: true }) };
      return { ok: true, stdout: "{}" };
    },
    chatsList: async () => ({ ok: true, chats: [] }),
  };
}
