// Preload bridge — the only surface the renderer can touch the backend through.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jcut", {
  // tools
  jc: (command, args) => ipcRenderer.invoke("jc", command, args || []),

  // settings
  getSettings: () => ipcRenderer.invoke("settings-get"),
  setSettings: (patch) => ipcRenderer.invoke("settings-set", patch),

  // claude auth
  claudeStatus: () => ipcRenderer.invoke("claude-status"),
  claudeLoginHelp: () => ipcRenderer.invoke("claude-login-help"),

  // lm studio
  lmStudioTest: (url) => ipcRenderer.invoke("lmstudio-test", url),

  // agent run + steer/interrupt
  runAgent: (prompt) => ipcRenderer.invoke("agent-run", prompt),
  stopAgent: () => ipcRenderer.invoke("agent-stop"),
  onAgentChunk: (cb) => {
    const h = (_e, chunk) => cb(chunk);
    ipcRenderer.on("agent-chunk", h);
    return () => ipcRenderer.removeListener("agent-chunk", h);
  },
  onAgentDone: (cb) => {
    const h = (_e, code) => cb(code);
    ipcRenderer.on("agent-done", h);
    return () => ipcRenderer.removeListener("agent-done", h);
  },

  pickMedia: () => ipcRenderer.invoke("pick-media"),
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  pickPrproj: () => ipcRenderer.invoke("pick-prproj"),
  readImage: (filePath) => ipcRenderer.invoke("read-image", filePath),
  listWorkspaces: () => ipcRenderer.invoke("list-workspaces"),
  reveal: (p) => ipcRenderer.invoke("reveal", p),

  // chat history
  chatsList: (ws) => ipcRenderer.invoke("chats-list", ws),
  chatLoad: (ws, id) => ipcRenderer.invoke("chat-load", ws, id),
  chatSave: (ws, chat) => ipcRenderer.invoke("chat-save", ws, chat),
  chatDelete: (ws, id) => ipcRenderer.invoke("chat-delete", ws, id),

  // native menu → open settings
  onOpenSettings: (cb) => {
    const h = () => cb();
    ipcRenderer.on("open-settings", h);
    return () => ipcRenderer.removeListener("open-settings", h);
  },

  // native menu → app actions (new-chat, new-project, add-footage,
  // import-timeline, toggle-sidebar, back-to-grid, show-shortcuts). One
  // subscription covers them all; the UI dispatches on the action name.
  onMenuAction: (cb) => {
    const actions = ["new-chat", "new-project", "add-footage", "import-timeline",
                     "toggle-sidebar", "back-to-grid", "show-shortcuts", "about"];
    const handlers = actions.map((name) => {
      const h = () => cb(name);
      ipcRenderer.on(name, h);
      return () => ipcRenderer.removeListener(name, h);
    });
    return () => handlers.forEach((off) => off());
  },

  getSystemTheme: () => ipcRenderer.invoke("get-system-theme"),
  getJcutHome: () => ipcRenderer.invoke("get-jcut-home"),

  // project manager grid (launch view)
  projectThumbnail: (ws) => ipcRenderer.invoke("project-thumbnail", ws),
  projectStats: (ws) => ipcRenderer.invoke("project-stats", ws),
  setProjectThumbnail: (ws) => ipcRenderer.invoke("set-project-thumbnail", ws),
  resetProjectThumbnail: (ws) => ipcRenderer.invoke("reset-project-thumbnail", ws),
});
