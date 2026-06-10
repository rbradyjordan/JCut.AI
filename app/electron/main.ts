// Electron main process. Owns the window and bridges the GUI to the real
// JCut.AI backend: settings, Claude-CLI auth detection, LM Studio connection,
// backend-aware agent runs, and interrupt/kill for steering conversations.
import { app, BrowserWindow, ipcMain, nativeTheme, shell, Menu, dialog } from "electron";
import path from "node:path";
import os from "node:os";
import fsSync from "node:fs";
import { spawn, execFile, ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { loadSettings, saveSettings, AppSettings } from "./settings.cjs";

const pexecFile = promisify(execFile);

// Safety net: a stray error in a background callback (e.g. a child-process event
// firing after its window closed) must NEVER crash the whole app to a blank
// window. Log and keep running instead of dying with a red Electron dialog.
process.on("uncaughtException", (err) => {
  console.error("[main] uncaughtException (kept alive):", err?.message || err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[main] unhandledRejection (kept alive):", reason);
});

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

// Bundled, native arm64 ffmpeg/ffprobe shipped in backend/bin (portable — works
// on any Mac with no Rosetta, no install). The backend's bin.ts honors these.
const FFMPEG_BIN = path.join(BACKEND_ROOT, "bin", "ffmpeg");
const FFPROBE_BIN = path.join(BACKEND_ROOT, "bin", "ffprobe");

// Env for running our bundled Node CLIs via the Electron binary.
function nodeEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const fsSync = require("node:fs");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    PATH: `${EXTRA_PATH}:${process.env.PATH || ""}`,
    JCUT_HOME,
    ...extra,
  };
  // Point the backend at the bundled binaries when present.
  if (fsSync.existsSync(FFMPEG_BIN)) env.JCUT_FFMPEG = FFMPEG_BIN;
  if (fsSync.existsSync(FFPROBE_BIN)) env.JCUT_FFPROBE = FFPROBE_BIN;
  return env;
}

// Env for ffmpeg/ffprobe/claude lookups (richer PATH, but NOT node mode).
function toolEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${EXTRA_PATH}:${process.env.PATH || ""}` };
}

// Resolve an ffmpeg/ffprobe binary: prefer a real path on disk so a minimal
// launch PATH (double-clicked app) still finds it.
function resolveBin(name: string): string {
  const fsSync = require("node:fs");
  // Prefer the bundled binary (portable), then common dirs, then PATH.
  const bundled = path.join(BACKEND_ROOT, "bin", name);
  try { if (fsSync.existsSync(bundled)) return bundled; } catch { /* skip */ }
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
  try {
    const wc = BrowserWindow.getFocusedWindow()?.webContents;
    if (wc && !wc.isDestroyed()) wc.send(channel);
  } catch { /* window gone — ignore */ }
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
// Per-command timeouts: long ops (render, import, probe-heavy) get a generous
// cap; everything else fails fast. A wedged tool call must NEVER hang the UI.
const JC_TIMEOUTS: Record<string, number> = {
  "sequence-render-final": 900000, // 15 min — long timelines
  "sequence-import-prproj": 600000, // 10 min — probes many sources
  "prproj-analyze": 300000,         // 5 min — large Premiere projects
  "media-info": 300000,            // 5 min — serial probes
  "source-add": 300000,
  "analyze-music": 120000,
  "analyze-video": 120000,
  "sequence-render-frame": 90000,
};
ipcMain.handle("jc", async (_e, command: string, args: string[]) => {
  try {
    const { stdout } = await pexecFile(NODE_BIN, [TOOLS_CLI, command, ...args], {
      maxBuffer: 1 << 26, env: nodeEnv(),
      timeout: JC_TIMEOUTS[command] ?? 60000, // default 60s — fail fast
      killSignal: "SIGKILL",
    });
    return { ok: true, stdout };
  } catch (e: any) {
    // ETIMEDOUT → a clear, actionable message instead of a silent hang.
    if (e.killed || e.signal === "SIGKILL" || /timed? ?out/i.test(e.message || "")) {
      return { ok: false, stdout: e.stdout || "",
        error: `"${command}" took too long and was stopped — the media may be on a slow or disconnected drive (SD card / external). Copy footage to your internal drive for reliable speed.` };
    }
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
ipcMain.handle("agent-run", async (e, prompt: string, chatId?: string, steering?: boolean, runId?: string) => {
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
  // A per-run scratch dir the agent (and its `jc` CLI grandchild) use to ask the
  // host for things that need the GUI — e.g. a native Save dialog on export. The
  // CLI writes a request marker to stdout and polls a response file here.
  const ipcDir = path.join(os.tmpdir(), "jcut-ipc");
  try { fsSync.mkdirSync(ipcDir, { recursive: true }); } catch { /* exists */ }
  const extraEnv: Record<string, string> = { FORCE_COLOR: "0", JCUT_IPC_DIR: ipcDir };
  if (useLocal || s.hybridMode) {
    extraEnv.LMSTUDIO_URL = s.lmStudioUrl;
    if (s.lmStudioCoderModel) extraEnv.LMSTUDIO_CODER_MODEL = s.lmStudioCoderModel;
    const visionModel =
      s.localMode === "single"
        ? (s.lmStudioCoderModel || s.lmStudioVisionModel || "")
        : (s.lmStudioVisionModel || s.lmStudioCoderModel || "");
    if (visionModel) extraEnv.LMSTUDIO_VISION_MODEL = visionModel;
  }
  if (s.hybridMode && !useLocal) {
    extraEnv.HYBRID_MODE = "true";
  }
  // Claude model selection (Opus/Sonnet) — only meaningful for the Claude backend.
  const agentArgs = [entry, fullPrompt, "--workspace", s.workspace];
  if (!useLocal && s.claudeModel) agentArgs.push("--model", s.claudeModel);
  if (chatId) agentArgs.push("--chat-id", chatId);
  if (steering) agentArgs.push("--steering");
  return new Promise((resolve) => {
    const winId = BrowserWindow.fromWebContents(e.sender)?.id ?? -1;
    // STEERING: if a run is already in flight for this window, kill it before
    // starting the new one. CRITICAL: mark the old child as superseded so its
    // close→finish does NOT fire "agent-done" — otherwise the renderer clears
    // busy/handlers and the NEW run's output (and follow-up messages) go nowhere.
    const existing = agentProcs.get(winId);
    if (existing) {
      (existing as any).__superseded = true;
      killTree(existing);
      agentProcs.delete(winId);
    }

    // detached: own process group, so stop can kill the whole tree (incl. ffmpeg
    // grandchildren) — otherwise a render keeps running after the agent is stopped.
    const child = spawn(NODE_BIN, agentArgs, {
      env: nodeEnv(extraEnv), cwd: PROJECT_ROOT, detached: true,
    });
    (child as any).__runId = runId || "";
    agentProcs.set(winId, child);
    // Guard every send: if the window/webContents was destroyed (closed, crashed,
    // navigated), e.sender.send throws "Object has been destroyed" and takes down
    // the whole main process. Check first and swallow any residual error.
    const send = (chan: string, data: string) => {
      try {
        if (e.sender && !e.sender.isDestroyed()) e.sender.send(chan, data);
      } catch { /* renderer gone — ignore */ }
    };
    let settled = false;
    const finish = (code: number | null, errMsg?: string) => {
      if (settled) return;
      settled = true;
      try { (child as any).__ipcCleanup?.(); } catch { /* */ }
      // Only clear the map slot if it's STILL this child — a newer (steering) run
      // may have already replaced it; don't delete the new run's entry.
      if (agentProcs.get(winId) === child) agentProcs.delete(winId);
      // If a newer run superseded this one (steering/follow-up), still resolve, but
      // tag the agent-done with this child's run id. The renderer's per-run
      // generation guard ignores any done that isn't from the CURRENT run, so a
      // superseded child's done is dropped there — we don't suppress it here,
      // because suppression left the UI stuck "busy" when timing raced.
      if (errMsg && !(child as any).__superseded) send("agent-chunk", `\n⚠️ ${errMsg}\n`);
      const tag = (child as any).__runId ? `:${(child as any).__runId}` : "";
      send("agent-done", `${code ?? 0}${tag}`); // ALWAYS fire so the UI can clear "busy"
      resolve({ ok: code === 0 && !(child as any).__superseded });
    };
    child.stdout?.on("data", (d) => {
      let out = d.toString();
      const usageMatch = out.match(/__CLAUDE_USAGE_INFO__:({.*})/);
      if (usageMatch) {
        send("usage-update", usageMatch[1]);
        out = out.replace(usageMatch[0], "");
      }
      if (out) send("agent-chunk", out);
    });
    // Watch the per-run IPC dir for native-dialog requests written by the `jc` CLI
    // (it runs inside the agent, so it can't reach us via stdout). When a
    // save-request appears, show the macOS Save panel and write the chosen path to
    // the response file the CLI is polling.
    const handledSaveReqs = new Set<string>();
    const handleSaveRequest = (file: string) => {
      if (!file.startsWith("save-request-") || !file.endsWith(".json")) return;
      if (handledSaveReqs.has(file)) return;
      handledSaveReqs.add(file);
      const reqPath = path.join(ipcDir, file);
      let req: any;
      try { req = JSON.parse(fsSync.readFileSync(reqPath, "utf8")); } catch { return; }
      const w = BrowserWindow.fromWebContents(e.sender) || BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      dialog.showSaveDialog(w!, {
        title: "Save Premiere Pro project",
        defaultPath: req.defaultName || "Sequence.prproj",
        filters: [{ name: "Premiere Pro Project", extensions: ["prproj"] }],
      }).then((res) => {
        let chosen = "__CANCELLED__";
        if (!res.canceled && res.filePath) {
          chosen = res.filePath.endsWith(".prproj") ? res.filePath : res.filePath + ".prproj";
        }
        try { fsSync.writeFileSync(req.respFile, chosen); } catch { /* CLI times out → default */ }
      }).catch(() => {
        try { fsSync.writeFileSync(req.respFile, "__CANCELLED__"); } catch { /* */ }
      });
    };
    let ipcWatcher: fsSync.FSWatcher | null = null;
    try {
      ipcWatcher = fsSync.watch(ipcDir, (_evt, fname) => { if (fname) handleSaveRequest(String(fname)); });
    } catch { /* watch unsupported — export falls back to default path */ }
    // Also sweep once shortly after start in case the file landed before the watcher.
    const ipcSweep = setInterval(() => {
      try { for (const f of fsSync.readdirSync(ipcDir)) handleSaveRequest(f); } catch { /* */ }
    }, 1000);
    (child as any).__ipcCleanup = () => { try { ipcWatcher?.close(); } catch {} clearInterval(ipcSweep); };
    child.stderr?.on("data", (d) => send("agent-chunk", d.toString()));
    child.on("close", (code) => finish(code));
    // If spawn itself fails (bad node path, etc.), still clear busy in the UI.
    child.on("error", (err) => finish(1, `Could not start the editor process: ${err.message}`));
  });
});

// Kill a detached child AND its entire descendant tree. Process-group kill alone
// is not enough: the Agent SDK spawns grandchildren (the `claude` inference
// process, Bash tool calls, ffmpeg) that can land in different process groups and
// survive — leaving a zombie that holds the "thinking…" state forever. We walk the
// descendant tree with `pgrep -P` and SIGKILL each, then the group, then the proc.
function killTree(proc: ChildProcess) {
  const pid = proc.pid;
  if (!pid) return;
  try {
    // Recursively collect descendants via pgrep, then kill leaves-first.
    const { execSync } = require("node:child_process");
    const collect = (root: number, acc: number[]) => {
      let kids: number[] = [];
      try {
        kids = execSync(`pgrep -P ${root}`, { encoding: "utf8" })
          .split("\n").map((s: string) => parseInt(s.trim(), 10)).filter(Boolean);
      } catch { /* no children */ }
      for (const k of kids) { collect(k, acc); acc.push(k); }
    };
    const tree: number[] = [];
    collect(pid, tree);
    for (const p of tree) { try { process.kill(p, "SIGKILL"); } catch { /* gone */ } }
  } catch { /* pgrep unavailable — fall through */ }
  // Process group, then the process itself.
  try { process.kill(-pid, "SIGKILL"); } catch { /* */ }
  try { proc.kill("SIGKILL"); } catch { /* already gone */ }
}

// Interrupt this window's running agent (the "stop" button — steer/interrupt).
ipcMain.handle("agent-stop", (e, runId?: string) => {
  const winId = BrowserWindow.fromWebContents(e.sender)?.id ?? -1;
  const proc = agentProcs.get(winId);
  // Tag the stop-done with the runId of the run being stopped, so the renderer can
  // tell whether this "-1" belongs to the run it's still showing or to an older,
  // steered-away run (whose done must NOT clear the current run's busy state).
  const tag = runId ? `:${runId}` : (proc && (proc as any).__runId ? `:${(proc as any).__runId}` : "");
  if (proc) {
    (proc as any).__superseded = true; // its own close→finish won't double-send
    killTree(proc);
    agentProcs.delete(winId);
    try {
      if (e.sender && !e.sender.isDestroyed()) e.sender.send("agent-done", `-1${tag}`);
    } catch { /* renderer gone — ignore */ }
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

// Open-file dialog for adding reference documents — scripts, briefs, shot lists,
// treatments. The agent reads these for intent so its first draft is more
// complete. Binary types (pdf/doc/docx/rtf) get a plain-text sidecar extracted on
// import; markdown/text are read as-is.
ipcMain.handle("pick-document", async (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const res = await dialog.showOpenDialog(w!, {
    title: "Add a document (script, brief, shot list)",
    filters: [
      { name: "Documents", extensions: ["md", "markdown", "txt", "rtf", "doc", "docx", "pdf"] },
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

// Save-location picker for exporting a Premiere .prproj. Returns the chosen
// absolute path (with a .prproj extension enforced) or { ok:false } if cancelled.
ipcMain.handle("pick-save-prproj", async (e, defaultName?: string) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const res = await dialog.showSaveDialog(w!, {
    title: "Save Premiere Pro project",
    defaultPath: (defaultName || "Sequence").replace(/[^\w.-]/g, "_") + ".prproj",
    filters: [{ name: "Premiere Pro Project", extensions: ["prproj"] }],
  });
  if (res.canceled || !res.filePath) return { ok: false };
  const p = res.filePath.endsWith(".prproj") ? res.filePath : res.filePath + ".prproj";
  return { ok: true, path: p };
});

// Relink picker — opens a Finder file dialog pre-navigated to the directory
// where the original file was last seen. Returns the chosen path or ok:false.
// `defaultDir` should be the last-known directory of the offline file so Finder
// opens in the right place (e.g. the SD card or external drive folder).
ipcMain.handle("pick-relink", async (e, defaultDir?: string) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const res = await dialog.showOpenDialog(w!, {
    title: "Locate file",
    message: "Find the new location of this clip",
    defaultPath: defaultDir || undefined,
    filters: [
      { name: "Media", extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v", "mp3", "wav", "aac", "m4a", "flac", "png", "jpg", "jpeg"] },
      { name: "All Files", extensions: ["*"] },
    ],
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

ipcMain.handle("project-delete", async (_e, workspace: string) => {
  try {
    const fs = await import("node:fs/promises");
    const dir = path.join(JCUT_HOME, workspace);
    await fs.rm(dir, { recursive: true, force: true });
    return { ok: true };
  } catch (e: any) { return { ok: false, error: e.message }; }
});

ipcMain.handle("project-rename", async (_e, workspace: string, newName: string) => {
  try {
    const fs = await import("node:fs/promises");
    const safe = newName.trim().replace(/[^\w\s\-]/g, "").replace(/\s+/g, " ").trim();
    if (!safe) return { ok: false, error: "Invalid name" };
    const src = path.join(JCUT_HOME, workspace);
    const dst = path.join(JCUT_HOME, safe);
    await fs.rename(src, dst);
    return { ok: true, name: safe };
  } catch (e: any) { return { ok: false, error: e.message }; }
});

ipcMain.handle("project-duplicate", async (_e, workspace: string) => {
  try {
    const fs = await import("node:fs/promises");
    const src = path.join(JCUT_HOME, workspace);
    // Find a non-colliding name: "Name copy", "Name copy 2", etc.
    let candidate = `${workspace} copy`;
    let n = 2;
    while (true) {
      try { await fs.access(path.join(JCUT_HOME, candidate)); candidate = `${workspace} copy ${n++}`; }
      catch { break; }
    }
    const dst = path.join(JCUT_HOME, candidate);
    // Recursive copy via shell cp -a (preserves symlinks, which source/ uses).
    await new Promise<void>((resolve, reject) => {
      const cp = spawn("cp", ["-a", src, dst]);
      cp.on("close", (code) => code === 0 ? resolve() : reject(new Error(`cp failed: ${code}`)));
    });
    return { ok: true, name: candidate };
  } catch (e: any) { return { ok: false, error: e.message }; }
});
