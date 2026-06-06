import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { applyTheme, spring, Mode, TEAL_GRADIENT } from "./theme";
import Timeline, { SeqView, parseInspect } from "./Timeline";
import Settings from "./Settings";
import Shortcuts from "./Shortcuts";
import About from "./About";
import Onboarding from "./Onboarding";
import Tools from "./Tools";
import ChatMessage from "./ChatMessage";
import Sidebar, { ChatMeta } from "./Sidebar";
import Skills from "./Skills";
import Sources from "./Sources";
import ModePicker from "./ModePicker";
import ProjectGrid from "./ProjectGrid";
import ResizeHandle from "./ResizeHandle";
import { compact, shouldCompact, estimateTokens } from "./compact";
import type { AppSettings, Backend } from "./jcut";
import iconUrl from "./assets/icon.png";

interface Msg { role: "user" | "agent"; text: string; }

// Flag ONLY genuinely broken local models — instruction-stripped "obliterated"/
// uncensored variants and embedding models (which can't chat at all). Small
// official models (gemma, qwen, llama, phi, mistral) are fine and must NOT warn;
// we make the agent loop work well with them instead. Mirrors Settings' check.
function weakModel(id: string | null): boolean {
  if (!id) return false;
  const s = id.toLowerCase();
  return /\bembed|embedding|obliterat|uncensor|abliterat/.test(s);
}

const SUGGESTIONS = [
  "Build a rough cut from my footage",
  "Add B-roll over the second answer",
  "Learn my editing style",
  "Render a verification frame",
];

export default function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [mode, setModeState] = useState<Mode>("dark");
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  // Loaded timeline shown as an attachment chip in the chat bar (persists while
  // you're working on it, like an attached file in ChatGPT / Claude Code).
  const [attachment, setAttachment] = useState<{ name: string; path: string; resolution?: string } | null>(null);
  // Launch view: DaVinci-style project grid first; "editor" once a project opens.
  const [view, setView] = useState<"grid" | "editor">("grid");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [seq, setSeq] = useState<SeqView | null>(null);
  const [seqId, setSeqId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  // Resizable panel widths (px). Seeded from settings, dragged live, persisted on
  // release. min/max keep both panels usable.
  const [sidebarWidth, setSidebarWidth] = useState(264);
  const [panelWidth, setPanelWidth] = useState(520);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatIdRef = useRef<string | null>(null);

  // Load persisted settings + resolve theme on boot.
  useEffect(() => {
    window.jcut.getSettings().then(async (s) => {
      setSettings(s);
      if (s.sidebarWidth) setSidebarWidth(s.sidebarWidth);
      if (s.panelWidth) setPanelWidth(s.panelWidth);
      if (s.panelCollapsed) setPanelCollapsed(true);
      const sysTheme = await window.jcut.getSystemTheme();
      setModeState(s.theme === "system" ? sysTheme : s.theme);
    });
  }, []);
  useEffect(() => { applyTheme(mode); }, [mode]);

  const patch = useCallback((p: Partial<AppSettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...p } : prev));
    window.jcut.setSettings(p);
  }, []);

  const setMode = (m: Mode) => { setModeState(m); patch({ theme: m }); };

  const workspace = settings?.workspace || "default";

  // Open settings from the native menu (⌘,).
  useEffect(() => window.jcut.onOpenSettings(() => setShowSettings(true)), []);

  // Load workspaces + chats whenever the workspace changes.
  const refreshWorkspaces = useCallback(async () => {
    const r = await window.jcut.listWorkspaces();
    if (r.ok) setWorkspaces(r.workspaces.length ? r.workspaces : [workspace]);
  }, [workspace]);
  const refreshChats = useCallback(async () => {
    const r = await window.jcut.chatsList(workspace);
    if (r.ok) setChats(r.chats);
  }, [workspace]);
  useEffect(() => { if (settings) { refreshWorkspaces(); refreshChats(); } }, [settings, workspace, refreshWorkspaces, refreshChats]);

  // Persist the current conversation (debounced via messages effect).
  const persistChat = useCallback(async (msgs: Msg[]) => {
    if (!msgs.length) return;
    let id = chatIdRef.current;
    if (!id) {
      id = "chat" + Math.random().toString(36).slice(2, 9);
      chatIdRef.current = id; setActiveChatId(id);
    }
    const title = msgs.find((m) => m.role === "user")?.text.slice(0, 48) || "New chat";
    await window.jcut.chatSave(workspace, { id, title, updated: Date.now(), messages: msgs });
    refreshChats();
  }, [workspace, refreshChats]);

  const newChat = () => { setMessages([]); chatIdRef.current = null; setActiveChatId(null); };
  const selectChat = async (id: string) => {
    const r = await window.jcut.chatLoad(workspace, id);
    if (r.ok && r.chat) { setMessages(r.chat.messages || []); chatIdRef.current = id; setActiveChatId(id); }
  };
  const deleteChat = async (id: string) => {
    await window.jcut.chatDelete(workspace, id);
    if (chatIdRef.current === id) newChat();
    refreshChats();
  };
  const switchWorkspace = (ws: string) => { patch({ workspace: ws }); newChat(); setAttachment(null); };
  const createWorkspace = async (name: string) => {
    await window.jcut.jc("memory-append", ["--workspace", name, "--section", "Workspace", "--note", `Created "${name}".`]);
    await refreshWorkspaces(); switchWorkspace(name);
  };

  // Open a project from the launch grid: switch into it (loading its chats via
  // the workspace effect) and reveal the editor. Back button returns to the grid.
  const openProject = (ws: string) => { switchWorkspace(ws); setView("editor"); };
  const createProject = async (name: string) => { await createWorkspace(name); setView("editor"); };
  const backToGrid = () => { refreshWorkspaces(); setView("grid"); };

  // Native menu actions → dispatch to the matching UI handler.
  useEffect(() => window.jcut.onMenuAction((action) => {
    switch (action) {
      case "new-chat": newChat(); break;
      case "new-project": setView("grid"); break;
      case "back-to-grid": backToGrid(); break;
      case "toggle-sidebar": setCollapsed((c) => !c); break;
      case "show-shortcuts": setShowShortcuts(true); break;
      case "about": setShowAbout(true); break;
      case "add-footage":
      case "import-timeline":
        // These live in the editor; make sure we're in it, then the panels handle the rest.
        setView("editor");
        break;
    }
  }), []); // eslint-disable-line

  // ── Panel resizing ──────────────────────────────────────────────────────────
  // Sidebar grows from the body's left edge; the right panel grows from its right
  // edge. We clamp both and leave the center chat column at least ~280px.
  const SIDEBAR_MIN = 200, SIDEBAR_MAX = 420;
  const PANEL_MIN = 340, CENTER_MIN = 280;
  const dragSidebar = (clientX: number) => {
    const rect = bodyRef.current?.getBoundingClientRect();
    if (!rect) return;
    const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, clientX - rect.left));
    setSidebarWidth(w);
  };
  const dragPanel = (clientX: number) => {
    const rect = bodyRef.current?.getBoundingClientRect();
    if (!rect) return;
    const maxPanel = rect.width - (collapsed ? 0 : sidebarWidth) - CENTER_MIN;
    const w = Math.max(PANEL_MIN, Math.min(maxPanel, rect.right - clientX));
    setPanelWidth(w);
  };
  const persistWidths = () => patch({ sidebarWidth, panelWidth });
  const togglePanel = () => setPanelCollapsed((c) => { patch({ panelCollapsed: !c }); return !c; });

  const refreshTimeline = useCallback(async () => {
    const list = await window.jcut.jc("sequences-list", ["--workspace", workspace]);
    if (!list.ok) return;
    try {
      const seqs = JSON.parse(list.stdout).sequences || [];
      if (!seqs.length) { setSeq(null); setSeqId(null); return; }
      const id = seqs[seqs.length - 1].id;
      setSeqId(id);
      const insp = await window.jcut.jc("sequence-inspect", ["--workspace", workspace, "--sequence-id", id]);
      if (insp.ok) setSeq(parseInspect(insp.stdout));
    } catch { /* ignore */ }
  }, [workspace]);

  useEffect(() => { if (settings) refreshTimeline(); }, [settings, refreshTimeline]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [messages]);
  // Persist whenever a turn completes (not busy) and there are messages.
  // Also auto-compact: if the conversation has grown too long, collapse older
  // turns into a recap so we never crowd the context window.
  useEffect(() => {
    if (busy || !messages.length) return;
    persistChat(messages);
    if (shouldCompact(messages)) {
      // Deterministic local recap (no model call) keeps it instant and offline-safe.
      compact(messages, async () => { throw new Error("use-local-recap"); })
        .then((compacted) => { if (compacted.length < messages.length) setMessages(compacted); });
    }
  }, [busy]); // eslint-disable-line

  // Track the active run's listener-cleanup so steering/stop can tear it down.
  const runCleanupRef = useRef<(() => void) | null>(null);

  // Run one agent turn. If already busy, STEER: interrupt the current run, fully
  // tear down its listeners, then start the new one — so follow-ups always work
  // and the stop button still controls the NEW run.
  const send = async (text: string) => {
    if (!text.trim()) return;

    if (busy) {
      // Detach the old run's listeners so its (late) chunks/done don't bleed in.
      runCleanupRef.current?.();
      runCleanupRef.current = null;
      await window.jcut.stopAgent();
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (last?.role === "agent" && !last.text) copy.pop(); // drop empty stub
        return copy;
      });
    }

    setInput("");
    setMessages((m) => [...m, { role: "user", text }, { role: "agent", text: "" }]);
    setBusy(true);
    streamRef.current = "";

    const offChunk = window.jcut.onAgentChunk((chunk) => {
      streamRef.current += chunk.replace(/\x1b\[[0-9;]*m/g, "");
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: "agent", text: streamRef.current };
        return copy;
      });
    });
    const offDone = window.jcut.onAgentDone(async () => {
      offChunk(); offDone();
      runCleanupRef.current = null;
      setBusy(false);
      await refreshTimeline();
    });
    // Record cleanup so a later steer/stop can detach these listeners.
    runCleanupRef.current = () => { offChunk(); offDone(); };

    await window.jcut.runAgent(text);
  };

  // Stop button: kill the running agent process and tear down its listeners.
  const stop = async () => {
    runCleanupRef.current?.();
    runCleanupRef.current = null;
    await window.jcut.stopAgent();
    setBusy(false);
    setMessages((m) => {
      const copy = [...m];
      const last = copy[copy.length - 1];
      if (last?.role === "agent") last.text = (last.text || "") + "\n\n⏹ stopped.";
      return copy;
    });
  };

  if (!settings) return <div className="grain h-full"><div className="backdrop" /></div>;

  // First-run onboarding gate.
  if (!settings.onboarded) {
    return (
      <Onboarding
        onDone={(backend: Backend) => patch({ backend, onboarded: true })}
      />
    );
  }

  // Launch view — the DaVinci-style project grid. Opening a tile loads that
  // project's chats and switches to the editor below.
  if (view === "grid") {
    return (
      <ProjectGrid
        workspaces={workspaces}
        onOpen={openProject}
        onNewProject={createProject}
      />
    );
  }

  return (
    <div className="grain relative flex h-full flex-col">
      <div className="backdrop" />

      {/* Dedicated traffic-light strip (its own bar above all UI, like Linear/Notion).
          Just reserves space for the macOS traffic lights — no label (the chrome
          bar below owns the brand). Divider is a subtle dark line, never white. */}
      <div className="drag relative z-30 h-9 shrink-0 border-b border-black/40 bg-black/20 backdrop-blur-xl" />

      <div ref={bodyRef} className="relative flex min-h-0 flex-1">
      <Sidebar
        collapsed={collapsed}
        width={sidebarWidth}
        onToggle={() => setCollapsed((c) => !c)}
        workspace={workspace}
        onBackToGrid={backToGrid}
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={selectChat}
        onNewChat={newChat}
        onDeleteChat={deleteChat}
      />

      {/* Drag to resize the sidebar (hidden when collapsed). */}
      {!collapsed && (
        <ResizeHandle ariaLabel="Resize sidebar" onMove={dragSidebar} onEnd={persistWidths} />
      )}

      <div className="relative flex min-w-0 flex-1 flex-col">
      {/* App chrome bar */}
      {/* z-30 so the Mode dropdown overlays the right-hand Sources/Tools panel,
          which creates its own stacking context via backdrop-blur + layout. */}
      <div className="relative z-30 flex h-14 items-center justify-between px-5">
        <div className="flex items-center gap-2">
          {/* Single sidebar toggle (collapses when open, reopens when collapsed). */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="grid h-8 w-8 place-items-center rounded-full bg-surface2 text-dim ring-1 ring-line hover:text-ink"
            aria-label={collapsed ? "Open sidebar" : "Collapse sidebar"}
            title={collapsed ? "Open sidebar" : "Collapse sidebar"}
          >☰</button>
          {/* When collapsed, the in-sidebar "‹ Projects" is hidden, so offer
              back-to-grid here too. */}
          {collapsed && (
            <motion.button
              whileHover={{ x: -2, scale: 1.05 }} whileTap={{ scale: 0.92 }}
              onClick={backToGrid}
              className="mr-1 grid h-8 w-8 place-items-center rounded-full bg-surface2 text-dim ring-1 ring-line hover:text-ink"
              aria-label="Back to projects"
              title="Back to projects"
            >‹</motion.button>
          )}
          <img src={iconUrl} alt="JCut.AI" className="h-7 w-7" />
          <span className="font-semibold tracking-tight">JCut<span className="text-dim">.AI</span></span>
          <span className="ml-2 rounded-pill bg-surface2 px-2 py-0.5 text-[11px] text-dim">
            {workspace}
          </span>
          <span className="ml-1 rounded-pill px-2 py-0.5 text-[11px] text-white"
                style={{ background: settings.backend === "claude" ? TEAL_GRADIENT : "var(--accent-blue)" }}>
            {settings.backend === "claude" ? "Claude" : "Local"}
          </span>
          {settings.backend === "local" && weakModel(settings.lmStudioModel) && (
            <button
              onClick={() => setShowSettings(true)}
              className="ml-1 rounded-pill bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-400 ring-1 ring-amber-500/30"
              title="This model may produce broken output or respond in the wrong language. Click to switch."
            >⚠ weak model — switch</button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ModePicker
            value={settings.mode}
            onChange={(id) => patch({ mode: id })}
            onManagePresets={() => setShowSettings(true)}
          />
          <ThemeToggle mode={mode} onToggle={() => setMode(mode === "dark" ? "light" : "dark")} />
          <motion.button
            whileHover={{ scale: 1.08, rotate: 35 }} whileTap={{ scale: 0.9 }}
            onClick={() => setShowSettings(true)}
            className="grid h-8 w-8 place-items-center rounded-full bg-surface2 ring-1 ring-line"
            aria-label="Settings"
          >⚙</motion.button>
        </div>
      </div>

      {/* Body */}
      <div className="relative z-10 flex min-h-0 flex-1 px-5 pb-4">
        <div className="flex min-h-0 flex-1 flex-col pr-2">
          <div ref={scrollRef} className="flex-1 space-y-4 overflow-auto pr-1 pt-2">
            {messages.length === 0 ? <Welcome onPick={send} /> : messages.map((m, i) => (
              <ChatMessage key={i} role={m.role} text={m.text}
                live={busy && i === messages.length - 1 && m.role === "agent"}
                showReasoning={settings.showReasoning} />
            ))}
          </div>
          <Skills workspace={workspace} onChanged={refreshTimeline} onImported={setAttachment} />
          {attachment && (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }} transition={spring.snappy}
              className="mb-2 flex items-center gap-2 self-start rounded-xl bg-surface2 px-3 py-2 ring-1 ring-line"
              title={attachment.path}
            >
              <span className="grid h-7 w-7 place-items-center rounded-md text-white" style={{ background: TEAL_GRADIENT }}>🎬</span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-ink">{attachment.name}</div>
                <div className="text-[11px] text-dim">
                  Timeline{attachment.resolution ? ` · ${attachment.resolution}` : ""} · working on this
                </div>
              </div>
              <button
                onClick={() => setAttachment(null)}
                className="ml-1 text-dim hover:text-ink"
                aria-label="Remove attachment"
              >✕</button>
            </motion.div>
          )}
          <PillInput value={input} onChange={setInput} onSend={() => send(input)} onStop={stop} busy={busy} />
        </div>

        {/* Drag to resize the right panel — only when expanded and visible (≥ md). */}
        {!panelCollapsed && (
          <div className="hidden md:flex">
            <ResizeHandle ariaLabel="Resize panel" onMove={dragPanel} onEnd={persistWidths} />
          </div>
        )}

        {panelCollapsed ? (
          /* Collapsed rail — a thin strip with a vertical "Sources" label that
             expands the panel back. Like an NLE's hidden inspector. */
          <motion.button
            layout transition={spring.soft}
            onClick={togglePanel}
            whileHover={{ backgroundColor: "var(--surface-2)" }}
            className="ml-2 hidden w-9 shrink-0 flex-col items-center gap-3 rounded-xl2 bg-surface/70 py-3 shadow-card ring-1 ring-line backdrop-blur-xl md:flex"
            title="Show Sources & Timeline panel"
            aria-label="Expand panel"
          >
            <span className="text-dim">‹</span>
            <span className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-dim [writing-mode:vertical-rl]">
              Sources · Timeline
            </span>
          </motion.button>
        ) : (
          <motion.div
            layout transition={spring.soft}
            style={{ width: panelWidth }}
            className="relative ml-2 hidden shrink-0 flex-col rounded-xl2 bg-surface/70 pt-3 shadow-card ring-1 ring-line backdrop-blur-xl md:flex"
          >
            <Sources
              workspace={workspace}
              onChanged={refreshTimeline}
              onCollapse={togglePanel}
            />
            <Tools workspace={workspace} seqId={seqId} seqDuration={seq?.duration ?? 0} />
            <div className="min-h-0 flex-1 overflow-auto"><Timeline seq={seq} /></div>
          </motion.div>
        )}
      </div>
      </div>{/* /content column */}
      </div>{/* /sidebar+content row */}

      <AnimatePresence>
        {showSettings && (
          <Settings
            settings={settings}
            onChange={patch}
            onClose={() => setShowSettings(false)}
            mode={mode}
            setMode={setMode}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showShortcuts && <Shortcuts onClose={() => setShowShortcuts(false)} />}
      </AnimatePresence>

      <AnimatePresence>
        {showAbout && <About onClose={() => setShowAbout(false)} />}
      </AnimatePresence>
    </div>
  );
}

function Welcome({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <motion.img
        src={iconUrl} alt="JCut.AI"
        initial={{ scale: 0.6, opacity: 0, rotate: -8 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={spring.bouncy}
        className="mb-5 h-20 w-20 drop-shadow-[0_8px_40px_rgba(46,107,230,0.35)]"
      />
      <motion.h1
        initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ ...spring.soft, delay: 0.05 }}
        className="text-3xl font-semibold tracking-tight"
      >
        Your move, Brady.
      </motion.h1>
      <p className="mt-2 text-dim">Tell me what to edit. I'll cut it.</p>
      <div className="mt-7 flex max-w-lg flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s, i) => (
          <motion.button
            key={s}
            initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
            transition={{ ...spring.soft, delay: 0.1 + i * 0.05 }}
            whileHover={{ scale: 1.05, y: -2 }} whileTap={{ scale: 0.96 }}
            onClick={() => onPick(s)}
            className="no-drag rounded-pill bg-surface2 px-4 py-2 text-sm text-ink ring-1 ring-line"
          >{s}</motion.button>
        ))}
      </div>
    </div>
  );
}

function PillInput({
  value, onChange, onSend, onStop, busy,
}: { value: string; onChange: (v: string) => void; onSend: () => void; onStop: () => void; busy: boolean }) {
  return (
    <motion.div
      layout transition={spring.soft}
      className="no-drag mt-3 flex items-center gap-2 rounded-pill bg-surface2 px-3 py-2 shadow-card ring-1 ring-line"
    >
      <div className="grid h-9 w-9 place-items-center rounded-full text-dim">+</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onSend(); }}
        placeholder={busy ? "Steer it — type to redirect, or press ■ to stop" : "Ask JCut to edit…"}
        className="flex-1 bg-transparent text-[15px] text-ink placeholder:text-dim focus:outline-none"
      />
      {/* While busy: a Stop button AND a Send button. Send interrupts the current
          run and steers with the new message (handled in App.send). */}
      {busy && (
        <motion.button
          whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
          onClick={onStop}
          className="grid h-9 w-9 place-items-center rounded-full bg-red-500/90 text-white"
          aria-label="Stop"
        >■</motion.button>
      )}
      <motion.button
        whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
        onClick={onSend}
        disabled={!value.trim()}
        className="grid h-9 w-9 place-items-center rounded-full text-white disabled:opacity-40"
        style={{ background: TEAL_GRADIENT }}
        aria-label={busy ? "Steer" : "Send"}
        title={busy ? "Steer — interrupt and redirect" : "Send"}
      >↑</motion.button>
    </motion.div>
  );
}

function ThemeToggle({ mode, onToggle }: { mode: Mode; onToggle: () => void }) {
  const dark = mode === "dark";
  return (
    <motion.button
      onClick={onToggle} whileTap={{ scale: 0.9 }}
      className="relative grid h-8 w-14 place-items-center rounded-pill bg-surface2 ring-1 ring-line"
      aria-label="Toggle theme"
    >
      <motion.div
        layout transition={spring.bouncy}
        className="absolute h-6 w-6 rounded-full shadow-card"
        style={{ left: dark ? 4 : "calc(100% - 28px)", background: dark ? "var(--surface)" : TEAL_GRADIENT }}
      />
      <span className="absolute left-2 text-[11px]">🌙</span>
      <span className="absolute right-2 text-[11px]">☀️</span>
    </motion.button>
  );
}
