// Electron main process. Owns the window and bridges the GUI to the real
// JCut.AI backend: settings, Claude-CLI auth detection, LM Studio connection,
// backend-aware agent runs, and interrupt/kill for steering conversations.
import { app, BrowserWindow, ipcMain, nativeTheme, shell, Menu, dialog } from "electron";
import path from "node:path";
import { spawn, execFile, ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { loadSettings, saveSettings, AppSettings } from "./settings.cjs";

const pexecFile = promisify(execFile);

const isDev = !app.isPackaged;

// Backend root differs between dev and a packaged app:
//  • dev:       <project>/  (two levels up from app/dist-electron)
//  • packaged:  <App>.app/Contents/Resources/backend/  (electron-builder extraResources)
const BACKEND_ROOT = isDev
  ? path.resolve(__dirname, "..", "..")
  : path.join(process.resourcesPath, "backend");

const ICON_PATH = isDev
  ? path.resolve(__dirname, "..", "..", "build", "icon.png")
  : path.join(process.resourcesPath, "backend", "icon.png"); // optional; falls back to bundle icon
const PROJECT_ROOT = BACKEND_ROOT;
const TOOLS_CLI = path.join(BACKEND_ROOT, "dist", "tools", "cli.js");
const AGENT = path.join(BACKEND_ROOT, "dist", "agent.js");
const AGENT_LOCAL = path.join(BACKEND_ROOT, "dist", "agent-local.js");
const JCUT_HOME = process.env.JCUT_HOME || path.join(app.getPath("home"), "Documents", "JCutAI");

// ── Subprocess environment ───────────────────────────────────────────────────
// A double-clicked Mac app launches with a minimal PATH (no nvm/homebrew/npm-
// global), so bare `node`/`ffmpeg`/`claude` lookups fail with ENOENT. We fix
// both halves:
//  1. NODE: run the backend with Electron's OWN binary in Node mode
//     (process.execPath + ELECTRON_RUN_AS_NODE=1) — always present, no install.
//  2. PATH: prepend the usual tool locations so ffmpeg/ffprobe/claude resolve.
const NODE_BIN = process.execPath; // Electron binary; ELECTRON_RUN_AS_NODE makes it a Node.
const EXTRA_PATH = [
  "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin",
  path.join(app.getPath("home"), ".npm-global", "bin"),
  path.join(app.getPath("home"), ".nvm", "current", "bin"),
].join(":");

// Env for running our bundled Node CLIs via the Electron binary.
function nodeEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    PATH: `${EXTRA_PATH}:${process.env.PATH || ""}`,
    JCUT_HOME,
    ...extra,
  };
}

// Env for ffmpeg/ffprobe/claude lookups (richer PATH, but NOT node mode).
function toolEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${EXTRA_PATH}:${process.env.PATH || ""}` };
}

// Resolve an ffmpeg/ffprobe binary: prefer a real path on disk so a minimal
// launch PATH (double-clicked app) still finds it.
function resolveBin(name: string): string {
  const fsSync = require("node:fs");
  for (const dir of EXTRA_PATH.split(":")) {
    const p = path.join(dir, name);
    try { if (fsSync.existsSync(p)) return p; } catch { /* skip */ }
  }
  return name; // fall back to PATH lookup
}
const FFMPEG = resolveBin("ffmpeg");

// Per-window in-flight agent process (so each window can interrupt independently).
const agentProcs = new Map<number, ChildProcess>();

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180, height: 820, minWidth: 940, minHeight: 660,
    titleBarStyle: "hidden",
    // Center the traffic lights vertically within our dedicated 40px top strip.
    trafficLightPosition: { x: 16, y: 13 },
    backgroundColor: "#0D0D0F",
    vibrancy: "under-window",
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (isDev) win.loadURL("http://localhost:5173");
  else win.loadFile(path.join(__dirname, "..", "dist-web", "index.html"));
  win.on("closed", () => {
    const p = agentProcs.get(win.id);
    if (p) { try { if (p.pid) process.kill(-p.pid, "SIGKILL"); } catch { /* gone */ } agentProcs.delete(win.id); }
  });
  return win;
}

// Send an action to the focused window's renderer (UI handles it).
function sendToFocused(channel: string) {
  BrowserWindow.getFocusedWindow()?.webContents.send(channel);
}

// Full native menu bar. App / File / Edit / View / Window / Help — every item wired.
function buildMenu() {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    // ── App menu (macOS) ──────────────────────────────────────────────────
    ...(isMac ? [{
      label: "JCut.AI",
      submenu: [
        { label: "About JCut.AI", click: () => sendToFocused("about") },
        { type: "separator" as const },
        {
          label: "Settings…",
          accelerator: "CmdOrCtrl+,",
          click: () => sendToFocused("open-settings"),
        },
        { type: "separator" as const },
        { role: "services" as const },
        { type: "separator" as const },
        { role: "hide" as const, label: "Hide JCut.AI" },
        { role: "hideOthers" as const },
        { role: "unhide" as const },
        { type: "separator" as const },
        { role: "quit" as const, label: "Quit JCut.AI" },
      ],
    }] : []),

    // ── File ──────────────────────────────────────────────────────────────
    {
      label: "File",
      submenu: [
        { label: "New Chat", accelerator: "CmdOrCtrl+T", click: () => sendToFocused("new-chat") },
        { label: "New Window", accelerator: "CmdOrCtrl+N", click: () => createWindow() },
        { type: "separator" },
        { label: "New Project…", accelerator: "CmdOrCtrl+Shift+N", click: () => sendToFocused("new-project") },
        { label: "Add Footage…", accelerator: "CmdOrCtrl+O", click: () => sendToFocused("add-footage") },
        { label: "Import Timeline…", accelerator: "CmdOrCtrl+I", click: () => sendToFocused("import-timeline") },
        { type: "separator" },
        ...(isMac ? [{ role: "close" as const }] : [{ role: "quit" as const }]),
      ],
    },

    // ── Edit ──────────────────────────────────────────────────────────────
    { label: "Edit", role: "editMenu" },

    // ── View ──────────────────────────────────────────────────────────────
    {
      label: "View",
      submenu: [
        { label: "Toggle Sidebar", accelerator: "CmdOrCtrl+B", click: () => sendToFocused("toggle-sidebar") },
        { label: "Back to Projects", accelerator: "CmdOrCtrl+Shift+P", click: () => sendToFocused("back-to-grid") },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" },
        { role: "toggleDevTools" },
      ],
    },

    // ── Window ────────────────────────────────────────────────────────────
    { label: "Window", role: "windowMenu" },

    // ── Help ──────────────────────────────────────────────────────────────
    {
      label: "Help",
      role: "help",
      submenu: [
        { label: "JCut.AI Documentation", click: () => shell.openExternal(LINKS.docs) },
        { label: "Keyboard Shortcuts", accelerator: "CmdOrCtrl+/", click: () => sendToFocused("show-shortcuts") },
        { type: "separator" },
        { label: "Set Up Claude (Max subscription)", click: () => shell.openExternal(LINKS.claudeSetup) },
        { label: "Set Up a Local Model (LM Studio)", click: () => shell.openExternal(LINKS.lmstudio) },
        { type: "separator" },
        { label: "Visit Website", click: () => shell.openExternal(LINKS.website) },
        { label: "Report an Issue…", click: () => shell.openExternal(LINKS.issues) },
        ...(!isMac ? [{ type: "separator" as const }, { label: "About JCut.AI", click: () => sendToFocused("about") }] : []),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Useful links surfaced in menus / About.
const LINKS = {
  docs: "https://jcut.ai/docs",
  shortcuts: "https://jcut.ai/docs/shortcuts",
  issues: "https://github.com/jcut-ai/jcut/issues",
  claudeSetup: "https://docs.claude.com/en/docs/claude-code/setup",
  lmstudio: "https://lmstudio.ai",
  website: "https://jcut.ai",
};

app.whenReady().then(() => {
  if (process.platform === "darwin" && app.dock) {
    try { app.dock.setIcon(ICON_PATH); } catch { /* ok */ }
  }
  // Populate the native About panel (⌘-About JCut.AI) with real metadata.
  app.setAboutPanelOptions({
    applicationName: "JCut.AI",
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: "© 2026 JCut.AI — An AI video editor.\nUnderstands your footage and cuts it for you.",
    credits: "Built on the Claude Agent SDK and ffmpeg.\nRuns on your Claude Max subscription or a local LM Studio model.",
    iconPath: ICON_PATH,
  });
  buildMenu();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

// ── Settings ─────────────────────────────────────────────────────────────────
ipcMain.handle("settings-get", () => loadSettings());
ipcMain.handle("settings-set", (_e, patch: Partial<AppSettings>) => saveSettings(patch));

// ── jc tools (for the live timeline) ─────────────────────────────────────────
ipcMain.handle("jc", async (_e, command: string, args: string[]) => {
  try {
    const { stdout } = await pexecFile(NODE_BIN, [TOOLS_CLI, command, ...args], {
      maxBuffer: 1 << 26, env: nodeEnv(),
    });
    return { ok: true, stdout };
  } catch (e: any) {
    // The CLI prints {ok:false,error} JSON to stdout then exits 1. Prefer that
    // clean message over the raw "Command failed: node …" shell error.
    let friendly = e.message;
    const out = e.stdout || "";
    try {
      const parsed = JSON.parse(out);
      if (parsed?.error) friendly = parsed.error;
    } catch { /* keep raw */ }
    return { ok: false, stdout: out, error: friendly };
  }
});

// ── Claude auth detection (reuse the `claude` CLI login) ─────────────────────
// We don't store secrets. We just check whether the user is logged into the
// Claude CLI (which the Agent SDK rides). Returns a friendly status.
ipcMain.handle("claude-status", async () => {
  // Resolve a `claude` binary on PATH or the common npm-global location.
  const candidates = [
    "claude",
    path.join(app.getPath("home"), ".npm-global", "bin", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ];
  for (const bin of candidates) {
    try {
      const { stdout } = await pexecFile(bin, ["--version"], { env: process.env, timeout: 5000 });
      // Logged-in state: a successful version call + presence of credentials.
      // We treat a working CLI as "available"; the SDK will use its login.
      return {
        ok: true,
        available: true,
        version: stdout.trim(),
        bin,
        note: "Using your Claude CLI login (Max subscription). No API key needed.",
      };
    } catch { /* try next */ }
  }
  return {
    ok: false,
    available: false,
    note: "Claude CLI not found. Install it and run `claude` to log in with your Max plan.",
  };
});

ipcMain.handle("claude-login-help", () => {
  // Open the docs / kick the user toward `claude` login in their terminal.
  shell.openExternal("https://docs.claude.com/en/docs/claude-code/setup");
  return { ok: true };
});

// ── LM Studio connection test + model listing ────────────────────────────────
// Normalize whatever the user types into an OpenAI-style base ending in /v1.
function normalizeLmUrl(url: string): string {
  let u = (url || "http://localhost:1234/v1").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(u)) u = "http://" + u;
  if (!/\/v1$/.test(u)) u += "/v1";
  return u;
}

ipcMain.handle("lmstudio-test", async (_e, url: string) => {
  const base = normalizeLmUrl(url);
  try {
    const res = await fetch(`${base}/models`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { ok: false, error: `Server responded ${res.status} at ${base}/models` };
    const data: any = await res.json();
    // LM Studio lists chat + embedding models; embeddings can't drive the agent,
    // so surface them but flag which are usable.
    const all = (data.data || []).map((m: any) => m.id);
    const chat = all.filter((id: string) => !/embed/i.test(id));
    return { ok: true, models: chat.length ? chat : all, normalizedUrl: base };
  } catch {
    return {
      ok: false,
      error: "Couldn't reach LM Studio. Open LM Studio → load a model → Developer tab → Start Server.",
    };
  }
});

// ── Agent run (backend-aware) with streaming + interrupt ─────────────────────
ipcMain.handle("agent-run", async (e, prompt: string) => {
  const s = loadSettings();
  const useLocal = s.backend === "local";
  // If an editing mode/preset is active, fetch its instructions and prepend them
  // so the agent edits in that style. (mode-get resolves built-ins + user presets.)
  let modePrefix = "";
  if (s.mode) {
    try {
      const { stdout } = await pexecFile(NODE_BIN, [TOOLS_CLI, "mode-get", "--id", s.mode], {
        env: nodeEnv(), maxBuffer: 1 << 20,
      });
      const m = JSON.parse(stdout);
      if (m.instructions) modePrefix = `[Active mode: ${m.name}] ${m.instructions}\n\n`;
    } catch { /* mode missing — ignore */ }
  }
  const fullPrompt = modePrefix + prompt;
  const entry = useLocal ? AGENT_LOCAL : AGENT;
  const extraEnv: Record<string, string> = { FORCE_COLOR: "0" };
  if (useLocal) {
    extraEnv.LMSTUDIO_URL = s.lmStudioUrl;
    if (s.lmStudioModel) extraEnv.LMSTUDIO_MODEL = s.lmStudioModel;
  }
  return new Promise((resolve) => {
    const winId = BrowserWindow.fromWebContents(e.sender)?.id ?? -1;
    // detached: own process group, so stop can kill the whole tree (incl. ffmpeg
    // grandchildren) — otherwise a render keeps running after the agent is stopped.
    const child = spawn(NODE_BIN, [entry, fullPrompt, "--workspace", s.workspace], {
      env: nodeEnv(extraEnv), cwd: PROJECT_ROOT, detached: true,
    });
    agentProcs.set(winId, child);
    const send = (chan: string, data: string) => e.sender.send(chan, data);
    let settled = false;
    const finish = (code: number | null, errMsg?: string) => {
      if (settled) return;
      settled = true;
      agentProcs.delete(winId);
      if (errMsg) send("agent-chunk", `\n⚠️ ${errMsg}\n`);
      send("agent-done", String(code ?? 0)); // ALWAYS fire so the UI clears "busy"
      resolve({ ok: code === 0 });
    };
    child.stdout?.on("data", (d) => send("agent-chunk", d.toString()));
    child.stderr?.on("data", (d) => send("agent-chunk", d.toString()));
    child.on("close", (code) => finish(code));
    // If spawn itself fails (bad node path, etc.), still clear busy in the UI.
    child.on("error", (err) => finish(1, `Could not start the editor process: ${err.message}`));
  });
});

// Kill the whole process group of a detached child (agent + ffmpeg grandchildren).
function killTree(proc: ChildProcess) {
  try {
    if (proc.pid) process.kill(-proc.pid, "SIGKILL"); // negative pid = process group
  } catch {
    try { proc.kill("SIGKILL"); } catch { /* already gone */ }
  }
}

// Interrupt this window's running agent (the "stop" button — steer/interrupt).
ipcMain.handle("agent-stop", (e) => {
  const winId = BrowserWindow.fromWebContents(e.sender)?.id ?? -1;
  const proc = agentProcs.get(winId);
  if (proc) {
    killTree(proc);
    agentProcs.delete(winId);
    return { ok: true, stopped: true };
  }
  return { ok: true, stopped: false };
});

// Read an image file (rendered frame / final thumbnail) as a data URL for <img>.
ipcMain.handle("read-image", async (_e, filePath: string) => {
  try {
    const fs = await import("node:fs/promises");
    const buf = await fs.readFile(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mime = ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
    return { ok: true, dataUrl: `data:${mime};base64,${buf.toString("base64")}` };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

// List workspaces (directories under JCUT_HOME that contain a sequences/ folder
// or look like a workspace). Used by the workspace picker.
ipcMain.handle("list-workspaces", async () => {
  try {
    const fs = await import("node:fs/promises");
    await fs.mkdir(JCUT_HOME, { recursive: true });
    const entries = await fs.readdir(JCUT_HOME, { withFileTypes: true });
    const names = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    return { ok: true, workspaces: names, home: JCUT_HOME };
  } catch (e: any) {
    return { ok: false, error: e.message, workspaces: [] };
  }
});

// Reveal a file/folder in Finder.
ipcMain.handle("reveal", (_e, p: string) => { shell.showItemInFolder(p); return { ok: true }; });

// ── Chat history (persisted per workspace under <ws>/chats/*.json) ────────────
function chatsDir(workspace: string): string {
  return path.join(JCUT_HOME, workspace, "chats");
}
ipcMain.handle("chats-list", async (_e, workspace: string) => {
  try {
    const fs = await import("node:fs/promises");
    const dir = chatsDir(workspace);
    await fs.mkdir(dir, { recursive: true });
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
    const chats = await Promise.all(files.map(async (f) => {
      const j = JSON.parse(await fs.readFile(path.join(dir, f), "utf8"));
      return { id: f.replace(/\.json$/, ""), title: j.title || "Untitled", updated: j.updated || 0 };
    }));
    chats.sort((a, b) => b.updated - a.updated);
    return { ok: true, chats };
  } catch (e: any) { return { ok: false, error: e.message, chats: [] }; }
});
ipcMain.handle("chat-load", async (_e, workspace: string, id: string) => {
  try {
    const fs = await import("node:fs/promises");
    const j = JSON.parse(await fs.readFile(path.join(chatsDir(workspace), `${id}.json`), "utf8"));
    return { ok: true, chat: j };
  } catch (e: any) { return { ok: false, error: e.message }; }
});
ipcMain.handle("chat-save", async (_e, workspace: string, chat: any) => {
  try {
    const fs = await import("node:fs/promises");
    const dir = chatsDir(workspace);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${chat.id}.json`), JSON.stringify(chat, null, 2));
    return { ok: true };
  } catch (e: any) { return { ok: false, error: e.message }; }
});
ipcMain.handle("chat-delete", async (_e, workspace: string, id: string) => {
  try {
    const fs = await import("node:fs/promises");
    await fs.rm(path.join(chatsDir(workspace), `${id}.json`), { force: true });
    return { ok: true };
  } catch (e: any) { return { ok: false, error: e.message }; }
});

// Open-file dialog for adding source footage (multi-select video/audio/image).
ipcMain.handle("pick-media", async (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const res = await dialog.showOpenDialog(w!, {
    title: "Add footage",
    filters: [
      { name: "Media", extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v", "mp3", "wav", "aac", "m4a", "png", "jpg", "jpeg"] },
    ],
    properties: ["openFile", "multiSelections"],
  });
  if (res.canceled || !res.filePaths.length) return { ok: false };
  return { ok: true, paths: res.filePaths };
});

// Folder picker — import every media file inside a folder (the CLI walks it,
// preserving which folder each clip came from for the bin view).
ipcMain.handle("pick-folder", async (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const res = await dialog.showOpenDialog(w!, {
    title: "Import a footage folder",
    properties: ["openDirectory"],
  });
  if (res.canceled || !res.filePaths.length) return { ok: false };
  return { ok: true, path: res.filePaths[0] };
});

// Open-file dialog for importing a Premiere Pro project.
ipcMain.handle("pick-prproj", async (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const res = await dialog.showOpenDialog(w!, {
    title: "Import Premiere Pro project",
    filters: [{ name: "Premiere Pro Project", extensions: ["prproj"] }],
    properties: ["openFile"],
  });
  if (res.canceled || !res.filePaths.length) return { ok: false };
  return { ok: true, path: res.filePaths[0] };
});

ipcMain.handle("get-system-theme", () => (nativeTheme.shouldUseDarkColors ? "dark" : "light"));
ipcMain.handle("get-jcut-home", () => JCUT_HOME);

// ── Project Manager grid (DaVinci-style launch view) ─────────────────────────
// Each "project" is a workspace. A tile shows a thumbnail grabbed from the FIRST
// source clip's first frame (per Brady's choice) + small counts. Thumbnails are
// extracted once with ffmpeg and cached under <ws>/.thumb.jpg so the grid is
// instant on every subsequent launch.
const VIDEO_RE = /\.(mp4|mov|mkv|webm|avi|m4v)$/i;

async function firstSourceVideo(workspace: string): Promise<string | null> {
  const fs = await import("node:fs/promises");
  const dir = path.join(JCUT_HOME, workspace, "source", "video");
  try {
    const files = (await fs.readdir(dir)).filter((f) => VIDEO_RE.test(f)).sort();
    if (!files.length) return null;
    // Entries are symlinks to the originals; ffmpeg follows them transparently.
    return path.join(dir, files[0]);
  } catch { return null; }
}

// Thumbnail cache + a sidecar marker that flags a MANUALLY chosen thumbnail.
// When the marker is present we never auto-regenerate over the user's pick.
const THUMB_VF = "scale=640:-2:force_original_aspect_ratio=decrease";
function thumbPaths(workspace: string) {
  const dir = path.join(JCUT_HOME, workspace);
  return { cache: path.join(dir, ".thumb.jpg"), manual: path.join(dir, ".thumb.manual") };
}
async function fileExists(p: string): Promise<boolean> {
  const fs = await import("node:fs/promises");
  try { await fs.access(p); return true; } catch { return false; }
}

// Return a cached thumbnail data URL for a project, generating it if missing.
// Also reports `isManual` so the UI can offer "reset to auto" only when relevant.
ipcMain.handle("project-thumbnail", async (_e, workspace: string) => {
  try {
    const fs = await import("node:fs/promises");
    const { cache, manual } = thumbPaths(workspace);
    const isManual = await fileExists(manual);
    const toDataUrl = async () => {
      const buf = await fs.readFile(cache);
      return { ok: true, dataUrl: `data:image/jpeg;base64,${buf.toString("base64")}`, isManual };
    };
    try { return await toDataUrl(); } catch { /* not cached yet — build it */ }

    const src = await firstSourceVideo(workspace);
    if (!src) return { ok: true, dataUrl: null, isManual: false }; // grid → gradient
    // Grab one frame ~1s in (avoids black leader), scaled to a tile-friendly size.
    await pexecFile(FFMPEG, [
      "-y", "-ss", "1", "-i", src, "-frames:v", "1", "-vf", THUMB_VF, "-q:v", "4", cache,
    ], { maxBuffer: 1 << 26, timeout: 20000, env: toolEnv() }).catch(() =>
      // Some clips are shorter than 1s — retry from the very start.
      pexecFile(FFMPEG, [
        "-y", "-i", src, "-frames:v", "1", "-vf", THUMB_VF, "-q:v", "4", cache,
      ], { maxBuffer: 1 << 26, timeout: 20000, env: toolEnv() })
    );
    return await toDataUrl();
  } catch {
    return { ok: true, dataUrl: null, isManual: false };
  }
});

// Let the user pick any image to use as a project's thumbnail. The image is
// re-encoded to a 640px JPG into the same cache the grid reads, and a marker is
// written so it survives — auto-extraction never overwrites a manual pick.
ipcMain.handle("set-project-thumbnail", async (e, workspace: string) => {
  const fs = await import("node:fs/promises");
  const w = BrowserWindow.fromWebContents(e.sender);
  const res = await dialog.showOpenDialog(w!, {
    title: "Choose a thumbnail image",
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff", "heic"] }],
    properties: ["openFile"],
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
  const src = res.filePaths[0];
  const { cache, manual } = thumbPaths(workspace);
  try {
    await fs.mkdir(path.dirname(cache), { recursive: true });
    // Normalize whatever they picked into the tile-sized JPG the grid expects.
    await pexecFile(FFMPEG, [
      "-y", "-i", src, "-frames:v", "1", "-vf", THUMB_VF, "-q:v", "4", cache,
    ], { maxBuffer: 1 << 26, timeout: 20000, env: toolEnv() });
    await fs.writeFile(manual, "");
    const buf = await fs.readFile(cache);
    return { ok: true, dataUrl: `data:image/jpeg;base64,${buf.toString("base64")}`, isManual: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

// Drop a manual thumbnail and regenerate from the first source clip (auto mode).
ipcMain.handle("reset-project-thumbnail", async (_e, workspace: string) => {
  const fs = await import("node:fs/promises");
  const { cache, manual } = thumbPaths(workspace);
  try {
    await fs.rm(manual, { force: true });
    await fs.rm(cache, { force: true });
    const src = await firstSourceVideo(workspace);
    if (!src) return { ok: true, dataUrl: null, isManual: false }; // → gradient
    await pexecFile(FFMPEG, [
      "-y", "-ss", "1", "-i", src, "-frames:v", "1", "-vf", THUMB_VF, "-q:v", "4", cache,
    ], { maxBuffer: 1 << 26, timeout: 20000, env: toolEnv() }).catch(() =>
      pexecFile(FFMPEG, [
        "-y", "-i", src, "-frames:v", "1", "-vf", THUMB_VF, "-q:v", "4", cache,
      ], { maxBuffer: 1 << 26, timeout: 20000, env: toolEnv() })
    );
    const buf = await fs.readFile(cache);
    return { ok: true, dataUrl: `data:image/jpeg;base64,${buf.toString("base64")}`, isManual: false };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

// Lightweight per-project counts for the tile subtitle (sequences + chats).
ipcMain.handle("project-stats", async (_e, workspace: string) => {
  const fs = await import("node:fs/promises");
  const count = async (dir: string, suffix: string) => {
    try { return (await fs.readdir(dir)).filter((f) => f.endsWith(suffix)).length; }
    catch { return 0; }
  };
  const sequences = await count(path.join(JCUT_HOME, workspace, "sequences"), ".jcseq.json");
  const chats = await count(chatsDir(workspace), ".json");
  return { ok: true, sequences, chats };
});
