import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence, MotionConfig } from "framer-motion";
import { applyTheme, applyDisplay, spring, Mode, Accent, DEFAULT_ACCENT, isAccent, TEAL_GRADIENT } from "./theme";
import { Close, Settings as SettingsIcon, Warning, Clapper, ChevronRight, Music, Bolt, Cpu, Film, Brain, Sparkle } from "./Icons";
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
import { compact, shouldCompact } from "./compact";
import type { AppSettings, Backend } from "./jcut";
import iconUrl from "./assets/icon.png";

interface Msg { role: "user" | "agent"; text: string; }

function weakModel(id: string | null): boolean {
  if (!id) return false;
  return /\bembed|embedding|obliterat|uncensor|abliterat/.test(id.toLowerCase());
}

function formatResetTime(resetsAt: any): string {
  if (!resetsAt) return "";
  try {
    let date: Date;
    if (typeof resetsAt === "number") {
      date = new Date(resetsAt < 1e11 ? resetsAt * 1000 : resetsAt);
    } else {
      date = new Date(resetsAt);
    }
    if (isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return "";
  }
}

function formatResetTimeRelative(resetsAt: any): string {
  if (!resetsAt) return "";
  try {
    let date: Date;
    if (typeof resetsAt === "number") {
      date = new Date(resetsAt < 1e11 ? resetsAt * 1000 : resetsAt);
    } else {
      date = new Date(resetsAt);
    }
    if (isNaN(date.getTime())) return "";
    
    const diffMs = date.getTime() - Date.now();
    if (diffMs <= 0) return `resets now`;
    
    const diffMins = Math.ceil(diffMs / 60000);
    if (diffMins < 60) {
      return `resets in ${diffMins}m`;
    }
    const diffHours = Math.round(diffMins / 60);
    return `resets in ${diffHours}h`;
  } catch {
    return "";
  }
}

function claudeUsageTitle(usage: { utilization: number; resetsAt?: any; type?: string }) {
  const pct = Math.round(usage.utilization * 100);
  const resetStr = usage.resetsAt ? formatResetTimeRelative(usage.resetsAt) : "";
  const timeStr = usage.resetsAt ? ` (${formatResetTime(usage.resetsAt)})` : "";
  const typeStr = usage.type ? ` [${usage.type}]` : "";
  return `Claude session usage: ${pct}%${resetStr ? ` · ${resetStr}${timeStr}` : ""}${typeStr}`;
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
  const [accent, setAccentState] = useState<Accent>(DEFAULT_ACCENT);
  const [claudeUsage, setClaudeUsage] = useState<{ utilization: number; resetsAt?: any; type?: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [attachment, setAttachment] = useState<{ name: string; path: string; resolution?: string } | null>(null);
  const [view, setView] = useState<"grid" | "editor">("grid");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [seqId, setSeqId] = useState<string | null>(null);
  const [seqDuration, setSeqDuration] = useState<number>(0);
  const [collapsed, setCollapsed] = useState(false);
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(264);
  const [panelWidth, setPanelWidth] = useState(320);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [backendMenuOpen, setBackendMenuOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatIdRef = useRef<string | null>(null);

  useEffect(() => {
    window.jcut.getSettings().then(async (s) => {
      setSettings(s);
      if (s.sidebarWidth) setSidebarWidth(s.sidebarWidth);
      if (s.panelWidth) setPanelWidth(s.panelWidth);
      if (s.panelCollapsed) setPanelCollapsed(true);
      const sysTheme = await window.jcut.getSystemTheme();
      const resolved: Mode = s.theme === "system" ? sysTheme : (s.theme as Mode);
      setModeState(resolved);
      if (isAccent(s.accent)) setAccentState(s.accent);
    });
  }, []);
  useEffect(() => { applyTheme(mode, accent); }, [mode, accent]);
  // Display & feel — re-apply whenever any of the six controls change so the UI
  // updates live. Reads straight from settings (single source of truth).
  useEffect(() => {
    if (!settings) return;
    applyDisplay({
      density: settings.density, fontScale: settings.fontScale, radius: settings.radius,
      uiFont: settings.uiFont, reduceMotion: settings.reduceMotion, grain: settings.grain,
    });
  }, [settings?.density, settings?.fontScale, settings?.radius, settings?.uiFont, settings?.reduceMotion, settings?.grain]);

  const patch = useCallback((p: Partial<AppSettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...p } : prev));
    window.jcut.setSettings(p);
  }, []);

  const setMode = (m: Mode) => { setModeState(m); patch({ theme: m }); };
  const setAccent = (a: Accent) => { setAccentState(a); patch({ accent: a }); };
  const workspace = settings?.workspace || "default";

  useEffect(() => window.jcut.onOpenSettings(() => setShowSettings(true)), []);

  const refreshWorkspaces = useCallback(async () => {
    const r = await window.jcut.listWorkspaces();
    if (r.ok) setWorkspaces(r.workspaces.length ? r.workspaces : [workspace]);
  }, [workspace]);
  const refreshChats = useCallback(async () => {
    const r = await window.jcut.chatsList(workspace);
    if (r.ok) setChats(r.chats);
  }, [workspace]);
  useEffect(() => { if (settings) { refreshWorkspaces(); refreshChats(); } }, [settings, workspace, refreshWorkspaces, refreshChats]);

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

  const openProject = (ws: string) => { switchWorkspace(ws); setView("editor"); };
  const createProject = async (name: string) => { await createWorkspace(name); setView("editor"); };
  const backToGrid = () => { refreshWorkspaces(); setView("grid"); };

  useEffect(() => window.jcut.onMenuAction((action) => {
    switch (action) {
      case "new-chat": newChat(); break;
      case "new-project": setView("grid"); break;
      case "back-to-grid": backToGrid(); break;
      case "toggle-sidebar": setCollapsed((c) => !c); break;
      case "show-shortcuts": setShowShortcuts(true); break;
      case "about": setShowAbout(true); break;
      case "add-footage":
      case "import-timeline": setView("editor"); break;
    }
  }), []); // eslint-disable-line

  const SIDEBAR_MIN = 200, SIDEBAR_MAX = 400;
  const PANEL_MIN = 280, CENTER_MIN = 320;
  const dragSidebar = (clientX: number) => {
    const rect = bodyRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSidebarWidth(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, clientX - rect.left)));
  };
  const dragPanel = (clientX: number) => {
    const rect = bodyRef.current?.getBoundingClientRect();
    if (!rect) return;
    const maxPanel = rect.width - (collapsed ? 0 : sidebarWidth) - CENTER_MIN;
    setPanelWidth(Math.max(PANEL_MIN, Math.min(maxPanel, rect.right - clientX)));
  };
  const persistWidths = () => patch({ sidebarWidth, panelWidth });
  const togglePanel = () => setPanelCollapsed((c) => { patch({ panelCollapsed: !c }); return !c; });

  const refreshTimeline = useCallback(async () => {
    const list = await window.jcut.jc("sequences-list", ["--workspace", workspace]);
    if (!list.ok) return;
    try {
      const seqs = JSON.parse(list.stdout).sequences || [];
      if (!seqs.length) { setSeqId(null); setSeqDuration(0); return; }
      const id = seqs[seqs.length - 1].id;
      setSeqId(id);
      const insp = await window.jcut.jc("sequence-inspect", ["--workspace", workspace, "--sequence-id", id]);
      if (insp.ok) { try { setSeqDuration(JSON.parse(insp.stdout).duration_seconds || 0); } catch { /* */ } }
    } catch { /* */ }
  }, [workspace]);

  useEffect(() => { if (settings) refreshTimeline(); }, [settings, refreshTimeline]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [messages]);
  useEffect(() => {
    if (busy || !messages.length) return;
    persistChat(messages);
    if (shouldCompact(messages)) {
      compact(messages, async () => { throw new Error("use-local-recap"); })
        .then((compacted) => { if (compacted.length < messages.length) setMessages(compacted); });
    }
  }, [busy]); // eslint-disable-line

  const runCleanupRef = useRef<(() => void) | null>(null);
  const runGenRef = useRef(0);

  const send = async (text: string) => {
    if (!text.trim()) return;
    if (busy) {
      runGenRef.current += 1;
      runCleanupRef.current?.();
      runCleanupRef.current = null;
      window.jcut.stopAgent().catch(() => {});
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (last?.role === "agent" && !last.text) copy.pop();
        return copy;
      });
    }
    const myGen = ++runGenRef.current;
    setInput("");
    const updatedMessages: Msg[] = [...messages, { role: "user", text }, { role: "agent", text: "" }];
    setMessages(updatedMessages);
    setBusy(true);
    streamRef.current = "";
    setClaudeUsage(null);

    // PERSIST IMMEDIATELY: Save the user's message to disk right away, so it is never lost
    // even if the app crashes or is killed during the model run. Also establishes the
    // chatId on the very first turn so the backend has a valid chat session ID.
    await persistChat(updatedMessages);

    // CLIENT-SIDE HEARTBEAT WATCHDOG: the UI must never sit "live" forever on a
    // dead/silent agent. Every chunk bumps a timer; if nothing arrives for the
    // timeout (longer than the agent's own 120s model-call timeout, so the backend
    // gets first chance to report an error), we force-clear busy and tell the user.
    // This is the last-resort guarantee that the spinner/timer always stops.
    // The UI heartbeat is the LAST-RESORT guard against a truly dead backend
    // process. It MUST be longer than the agent's own per-turn timeout (5 min for
    // local), or the UI would kill a slow-but-alive local model before its own
    // timeout fires. 7 min gives the backend the first chance to report an error,
    // and only catches a backend that died without emitting anything at all.
    const HEARTBEAT_MS = 420000;
    let hbTimer: ReturnType<typeof setTimeout> | null = null;
    const forceFinish = (note: string) => {
      if (runGenRef.current !== myGen) return;
      if (hbTimer) clearTimeout(hbTimer);
      offChunk(); offDone();
      runCleanupRef.current = null;
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (last && last.role === "agent") {
          copy[copy.length - 1] = { role: "agent", text: (last.text || "") + `\n\n⚠️ ${note}` };
        }
        persistChat(copy); // Persist immediately on watchdog timeouts/stops
        return copy;
      });
      setBusy(false);
    };
    const bumpHeartbeat = () => {
      if (hbTimer) clearTimeout(hbTimer);
      hbTimer = setTimeout(
        () => forceFinish("The editor went quiet and was stopped. It may have finished, stalled, or the local model timed out — try again or check LM Studio."),
        HEARTBEAT_MS,
      );
    };

    let lastSaveTime = Date.now();
    const SAVE_THROTTLE_MS = 2000;

    const offChunk = window.jcut.onAgentChunk((chunk) => {
      if (runGenRef.current !== myGen) return;
      bumpHeartbeat(); // any output (incl. the keepalive pulse) means the agent is alive
      // Strip ANSI codes and the zero-width keepalive pulse the backend emits while
      // a slow local model thinks (it only exists to reset the heartbeat).
      let text = streamRef.current + chunk.replace(/\x1b\[[0-9;]*m/g, "").replace(/​/g, "");

      // Extract __CLAUDE_USAGE_INFO__ events from standard out
      const regex = /__CLAUDE_USAGE_INFO__:([^\n]*)\n/g;
      let match;
      while ((match = regex.exec(text)) !== null) {
        try {
          const info = JSON.parse(match[1].trim());
          setClaudeUsage(info);
        } catch (e) {
          console.error("Failed to parse Claude usage:", e);
        }
      }
      // Strip out the usage line from the chat output
      text = text.replace(/__CLAUDE_USAGE_INFO__:[^\n]*\n?/g, "");

      streamRef.current = text;
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: "agent", text: streamRef.current };

        // Throttled persistence: Save the latest stream progress to disk periodically
        // (every 2s) so that if the app is killed or restarted mid-run, history isn't lost.
        const now = Date.now();
        if (now - lastSaveTime > SAVE_THROTTLE_MS) {
          lastSaveTime = now;
          persistChat(copy);
        }
        return copy;
      });
    });
    const offDone = window.jcut.onAgentDone(async () => {
      if (hbTimer) clearTimeout(hbTimer);
      if (runGenRef.current !== myGen) { offChunk(); offDone(); return; }
      offChunk(); offDone();
      runCleanupRef.current = null;
      setBusy(false);
      await refreshTimeline();
    });
    runCleanupRef.current = () => { if (hbTimer) clearTimeout(hbTimer); offChunk(); offDone(); };
    bumpHeartbeat(); // start the watchdog now that handlers are wired
    window.jcut.runAgent(text, chatIdRef.current || undefined).catch(() => { forceFinish("Could not start the editor."); });
  };

  const retryFrom = (i: number) => {
    const msg = messages[i];
    if (!msg || msg.role !== "user") return;
    setMessages((m) => m.slice(0, i));
    send(msg.text);
  };

  const stop = async () => {
    runGenRef.current += 1;
    runCleanupRef.current?.();
    runCleanupRef.current = null;
    streamRef.current = "";
    window.jcut.stopAgent().catch(() => {});
    // Append the stop marker AND persist the partial chat immediately, so a later
    // "continue" can detect the interrupted turn and resume near where it left off.
    // We compute the updated messages synchronously and save them — relying on the
    // busy-effect alone could persist the pre-marker version due to React batching.
    setMessages((m) => {
      const copy = m.map((x, i) =>
        i === m.length - 1 && x.role === "agent"
          ? { ...x, text: (x.text || "") + "\n\n⏹ stopped." }
          : x);
      persistChat(copy);
      return copy;
    });
    setBusy(false);
  };

  if (!settings) return <div className="grain h-full"><div className="backdrop" /></div>;

  if (!settings.onboarded) {
    return <Onboarding settings={settings} onChange={patch} onDone={(backend: Backend, hybridMode: boolean, localMode: "single" | "dual") => patch({ backend, hybridMode, localMode, onboarded: true })} />;
  }

  const reduceMotion = !!settings.reduceMotion;

  if (view === "grid") {
    return (
      <MotionConfig reducedMotion={reduceMotion ? "always" : "never"}>
        <ProjectGrid workspaces={workspaces} onOpen={openProject} onNewProject={createProject} onSettings={() => setShowSettings(true)} />
        <AnimatePresence>
          {showSettings && (
            <Settings settings={settings} onChange={patch} onClose={() => setShowSettings(false)}
              mode={mode} setMode={setMode}
              accent={accent} setAccent={setAccent}
              onReplayOnboarding={() => { setShowSettings(false); patch({ onboarded: false }); }} />
          )}
        </AnimatePresence>
      </MotionConfig>
    );
  }

  const accentStyle = { background: settings.backend === "claude" ? TEAL_GRADIENT : "var(--accent-blue)" };

  return (
    <MotionConfig reducedMotion={reduceMotion ? "always" : "never"}>
    <div className="grain relative flex h-full flex-col">
      <div className="backdrop" />

      {/* Traffic-light strip */}
      <div className="drag relative z-30 h-9 shrink-0" />

      <div ref={bodyRef} className="relative flex min-h-0 flex-1 overflow-hidden">

        {/* ── Sidebar ── */}
        <Sidebar
          collapsed={collapsed} width={sidebarWidth}
          onToggle={() => setCollapsed((c) => !c)}
          workspace={workspace} onBackToGrid={backToGrid}
          chats={chats} activeChatId={activeChatId}
          onSelectChat={selectChat} onNewChat={newChat} onDeleteChat={deleteChat}
        />
        {!collapsed && <ResizeHandle ariaLabel="Resize sidebar" onMove={dragSidebar} onEnd={persistWidths} />}

        {/* ── Main column ── */}
        <div className="relative flex min-w-0 flex-1 flex-col">

          {/* Chrome bar — minimal: sidebar toggle · workspace breadcrumb · right actions */}
          <div className="relative z-30 flex h-12 shrink-0 items-center gap-2 shadow-[0px_1px_0px_rgba(255,255,255,0.04)] px-4">
            {/* Left: toggle + breadcrumb */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCollapsed((c) => !c)}
                className="grid h-7 w-7 place-items-center rounded-lg text-dim hover:bg-surface2 hover:text-ink transition-colors"
                title={collapsed ? "Open sidebar" : "Collapse sidebar"}
              >
                <span className="text-base leading-none">☰</span>
              </button>

              {collapsed && (
                <motion.button whileHover={{ x: -1 }} whileTap={{ scale: 0.94 }}
                  onClick={backToGrid}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-dim hover:bg-surface2 hover:text-ink transition-colors"
                >
                  <ChevronRight size={12} stroke={1.5} className="rotate-180" />
                  Projects
                </motion.button>
              )}

              {/* Workspace + backend pill — click the backend to switch local/Claude */}
              <div className="relative flex items-center gap-1.5 rounded-lg depth-chip px-2.5 py-1 ">
                <img src={iconUrl} alt="" className="h-4 w-4 opacity-80" />
                <span className="text-[12px] font-medium text-ink">{workspace}</span>
                <span className="h-3 w-px bg-line" />
                <button
                  onClick={() => setBackendMenuOpen((o) => !o)}
                  disabled={busy}
                  title={busy ? "Finish the current run before switching" : "Switch model (Claude / Local)"}
                  className="flex items-center gap-1 text-[11px] font-medium disabled:opacity-50"
                >
                  {/* Solid color, not a background-clip:text gradient — the gradient
                      trick renders as a solid block during re-renders (the glitch).
                      Claude = Anthropic's signature orange; Local = blue accent. */}
                  <span style={{ color: settings.backend === "claude" ? "#D97757" : "var(--accent-blue)" }}>
                    {settings.backend === "claude" ? "Claude" : "Local"}
                  </span>
                  <ChevronRight size={10} stroke={1.5} className="rotate-90 text-dim" />
                </button>
                <AnimatePresence>
                  {backendMenuOpen && (
                    <>
                      {/* click-away */}
                      <div className="fixed inset-0 z-40" onClick={() => setBackendMenuOpen(false)} />
                      <motion.div
                        initial={{ opacity: 0, y: -4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -4, scale: 0.97 }} transition={spring.soft}
                        className="absolute left-0 top-full z-50 mt-1.5 w-36 overflow-hidden rounded-lg depth-card p-1 shadow-xl"
                      >
                        {(["claude", "local"] as Backend[]).map((b) => (
                          <button
                            key={b}
                            onClick={() => { patch({ backend: b }); setBackendMenuOpen(false); }}
                            className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-surface2 ${settings.backend === b ? "text-ink" : "text-dim"}`}
                          >
                            <span className="flex items-center gap-1.5">
                              <span className="h-1.5 w-1.5 rounded-full" style={{ background: b === "claude" ? "#D97757" : "var(--accent-blue)" }} />
                              {b === "claude" ? "Claude" : "Local (LM Studio)"}
                            </span>
                            {settings.backend === b && <span className="text-accent">✓</span>}
                          </button>
                        ))}
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>

              {settings.backend === "local" && weakModel(settings.lmStudioModel) && (
                <button onClick={() => setShowSettings(true)}
                  className="flex items-center gap-1 rounded-lg bg-amber-500/10 px-2 py-1 text-[11px] text-amber-400  hover:bg-amber-500/20 transition-colors"
                >
                  <Warning size={11} stroke={1.5} />
                  Weak model
                </button>
              )}
            </div>

            {/* Right: mode picker + settings */}
            <div className="ml-auto flex items-center gap-2">
              {settings.backend === "claude" && claudeUsage && (
                <div 
                  className="flex items-center gap-2 rounded-lg depth-chip px-2.5 py-1 text-[11.5px] font-medium transition-all"
                  title={claudeUsageTitle(claudeUsage)}
                >
                  <span className="text-dim text-[10px] tracking-wide">Usage</span>
                  <div className="relative h-1.5 w-14 overflow-hidden rounded-full bg-surface2">
                    <div 
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(100, claudeUsage.utilization * 100)}%`,
                        background: claudeUsage.utilization > 0.85 
                          ? "linear-gradient(90deg, #ef4444, #f97316)" 
                          : "linear-gradient(90deg, #0d9488, #14b8a6)" 
                      }}
                    />
                  </div>
                  <span className="text-dim text-[10px]">{Math.round(claudeUsage.utilization * 100)}%</span>
                </div>
              )}
              <ModePicker value={settings.mode} onChange={(id) => patch({ mode: id })} onManagePresets={() => setShowSettings(true)} />
              <motion.button
                whileHover={{ scale: 1.06, rotate: 30 }} whileTap={{ scale: 0.92 }}
                onClick={() => setShowSettings(true)}
                className="grid h-7 w-7 place-items-center rounded-lg text-dim hover:bg-surface2 hover:text-ink transition-colors"
              >
                <SettingsIcon size={15} stroke={1.5} />
              </motion.button>
            </div>
          </div>

          {/* Body: chat + right panel */}
          <div className="relative z-10 flex min-h-0 flex-1">

            {/* Chat column */}
            <div className="flex min-h-0 flex-1 flex-col">
              {/* Message list */}
              <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto px-6 py-5">
                {messages.length === 0
                  ? <Welcome onPick={send} workspace={workspace} />
                  : <div className="mx-auto max-w-2xl space-y-5">
                      {messages.map((m, i) => (
                        <ChatMessage key={i} role={m.role} text={m.text}
                          live={busy && i === messages.length - 1 && m.role === "agent"}
                          showReasoning={settings.showReasoning}
                          isLocal={settings.backend === "local"}
                          onCopy={() => navigator.clipboard.writeText(m.text)}
                          onRetry={m.role === "user" && !busy ? () => retryFrom(i) : undefined} />
                      ))}
                    </div>
                }
              </div>

              {/* Input dock — no divider, cards float above bg */}
              <div className="shrink-0 px-4 pb-4 pt-2">
                <div className="mx-auto max-w-2xl">
                  <Skills
                    workspace={workspace}
                    settings={settings}
                    onSettingsChange={patch}
                    onChanged={refreshTimeline}
                    onImported={setAttachment}
                  />
                  <AnimatePresence>
                    {attachment && (
                      <motion.div
                        initial={{ opacity: 0, y: 6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }} transition={spring.snappy}
                        className="mb-2 flex items-center gap-2.5 self-start rounded-xl depth-chip px-3 py-2 shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]"
                      >
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-white" style={{ background: TEAL_GRADIENT }}>
                          <Clapper size={13} stroke={1.5} />
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-semibold text-ink">{attachment.name}</div>
                          <div className="text-[10px] text-dim">Timeline{attachment.resolution ? ` · ${attachment.resolution}` : ""}</div>
                        </div>
                        <button onClick={() => setAttachment(null)} className="ml-auto text-dim hover:text-ink">
                          <Close size={12} stroke={1.5} />
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <ChatInput value={input} onChange={setInput} onSend={() => send(input)} onStop={stop} busy={busy} />
                </div>
              </div>
            </div>

            {/* Resize handle for right panel */}
            {!panelCollapsed && (
              <div className="hidden md:flex">
                <ResizeHandle ariaLabel="Resize panel" onMove={dragPanel} onEnd={persistWidths} />
              </div>
            )}

            {/* Right panel: floats as its own card with margin */}
            <AnimatePresence initial={false}>
              {panelCollapsed ? (
                <motion.button
                  key="rail"
                  initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
                  transition={spring.soft}
                  onClick={togglePanel}
                  className="hidden shrink-0 flex-col items-center justify-center gap-2 my-3 mr-3 w-9 rounded-2xl depth-card text-dim hover:bg-surface2 hover:text-ink transition-colors md:flex"
                  title="Show panel"
                >
                  <ChevronRight size={14} stroke={1.5} className="rotate-180" />
                  <span className="text-[10px] font-semibold uppercase tracking-widest [writing-mode:vertical-rl]">Sources</span>
                </motion.button>
              ) : (
                <motion.div
                  key="panel"
                  initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
                  transition={spring.soft}
                  style={{ width: panelWidth }}
                  className="hidden shrink-0 flex-col my-3 mr-3 rounded-2xl depth-card overflow-hidden backdrop-blur-xl md:flex"
                >
                  <Sources workspace={workspace} onChanged={refreshTimeline} onCollapse={togglePanel} />
                  <div className="mt-auto">
                    <Tools workspace={workspace} seqId={seqId} seqDuration={seqDuration} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showSettings && (
          <Settings settings={settings} onChange={patch} onClose={() => setShowSettings(false)}
            mode={mode} setMode={setMode}
            accent={accent} setAccent={setAccent}
            onReplayOnboarding={() => { setShowSettings(false); patch({ onboarded: false }); }} />
        )}
      </AnimatePresence>
      <AnimatePresence>{showShortcuts && <Shortcuts onClose={() => setShowShortcuts(false)} />}</AnimatePresence>
      <AnimatePresence>{showAbout && <About onClose={() => setShowAbout(false)} />}</AnimatePresence>
    </div>
    </MotionConfig>
  );
}

// ─── Welcome screen ───────────────────────────────────────────────────────────

const WELCOME_TIPS = [
  {
    category: "Audio",
    title: "Beat-Snapping Timeline",
    desc: "Always run analyze-music first. JCut generates a beat map so sequence edits automatically snap to the downbeats of your soundtrack.",
    icon: Music,
    accent: "Sync cuts to the pulse",
  },
  {
    category: "Workflow",
    title: "Batch Clip Editing",
    desc: "For rapid edits, write instructions that combine multiple cuts in a single message. Grouping actions is 3x faster than editing one clip at a time.",
    icon: Bolt,
    accent: "Bundle actions into one pass",
  },
  {
    category: "Local AI",
    title: "Continuous Execution",
    desc: "If local model streaming stalls, verify your LM Studio configuration. We recommend setting context size to 8k+ and enabling continuous mode.",
    icon: Cpu,
    accent: "Keep the local engine breathing",
  },
  {
    category: "Layout",
    title: "Smart Scaling",
    desc: "Prevent pillarboxes when using mixed media! Ask JCut to scale-to-fit: it auto-calculates scale ratios based on canvas resolution.",
    icon: Film,
    accent: "Let the frame fill itself",
  },
  {
    category: "Local AI",
    title: "Inject Editing Knowledge",
    desc: "Use playbooks to train JCut on specific styles. Run kb-read to instruct local agents on how to construct a recap or highlight reel.",
    icon: Brain,
    accent: "Teach the editor your taste",
  }
];

function Welcome({ onPick, workspace }: { onPick: (s: string) => void; workspace: string }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const [tipIndex, setTipIndex] = useState(0);
  const activeTip = WELCOME_TIPS[tipIndex];
  const TipIcon = activeTip.icon;
  const shellRef = useRef<HTMLDivElement>(null);
  const [compactLayout, setCompactLayout] = useState(false);
  const [tightLayout, setTightLayout] = useState(false);

  // Auto-play interval for the tips carousel
  useEffect(() => {
    const timer = setInterval(() => {
      setTipIndex((prev) => (prev + 1) % WELCOME_TIPS.length);
    }, 6000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      setCompactLayout(w < 1250);
      setTightLayout(w < 980);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="relative flex h-full justify-center overflow-auto px-6 py-8">
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <motion.div
          animate={{
            scale: [1, 1.12, 1],
            opacity: [0.28, 0.42, 0.28],
          }}
          transition={{
            duration: 10,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="absolute left-[42%] top-[10%] h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(var(--accent-glow-rgb),0.18)_0%,transparent_72%)] blur-3xl"
        />
        <div className="absolute right-[12%] top-[18%] h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(46,107,230,0.12)_0%,transparent_72%)] blur-3xl" />
        <div className="absolute inset-x-0 bottom-[-12rem] h-[24rem] bg-[radial-gradient(circle_at_center,rgba(var(--accent-glow-rgb),0.16)_0%,transparent_68%)] blur-3xl" />
      </div>

      <motion.section
        ref={shellRef}
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring.soft}
        className="relative z-10 my-auto w-full max-w-6xl self-start no-drag"
      >
        <div className={`grid items-stretch gap-6 ${compactLayout ? `mx-auto grid-cols-1 ${tightLayout ? "max-w-[42rem]" : "max-w-[48rem]"}` : "lg:grid-cols-[1.18fr_0.82fr]"}`}>
          <div className={`relative overflow-hidden rounded-[2.2rem] border border-white/[0.05] bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012))] shadow-[0_30px_90px_rgba(0,0,0,0.38)] backdrop-blur-2xl ${compactLayout ? (tightLayout ? "px-6 py-6" : "px-7 py-7") : "px-8 py-8 lg:px-10 lg:py-10"}`}>
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.045),transparent_34%)]" />
            <div className="absolute left-0 top-0 h-full w-1.5 bg-[linear-gradient(180deg,rgba(var(--accent-glow-rgb),0.8),rgba(46,107,230,0.35),transparent_88%)]" />
            <div className="relative flex h-full flex-col justify-between">
            <div>
              <motion.div
                initial={{ y: 8, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ ...spring.soft, delay: 0.04 }}
                className={`mb-6 inline-flex rounded-2xl depth-chip ${tightLayout ? "flex-col items-start gap-2 px-3 py-3" : "items-center gap-3 px-3 py-2"} ${compactLayout ? "max-w-full" : ""}`}
              >
                <div className={`grid place-items-center rounded-2xl bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] shadow-[0_10px_30px_rgba(var(--accent-glow-rgb),0.22)] ${tightLayout ? "h-10 w-10" : "h-11 w-11"}`}>
                  <img src={iconUrl} alt="JCut.AI" className="h-7 w-7" />
                </div>
                <div className={`text-left ${tightLayout ? "w-full" : ""}`}>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-dim">Editing Desk</div>
                  <div className={`${tightLayout ? "mt-1 text-[1.15rem]" : "text-sm"} font-semibold text-ink`}>{workspace}</div>
                </div>
                <div className={`${tightLayout ? "hidden" : "ml-2 hidden h-8 w-px bg-white/6 sm:block"}`} />
                <div className={`${tightLayout ? "text-left" : "hidden text-left sm:block"}`}>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-dim">Status</div>
                  <div className={`${tightLayout ? "mt-1 text-[1.05rem]" : "text-sm"} text-ink`}>Ready for a new cut</div>
                </div>
              </motion.div>

              <motion.h1
                initial={{ y: 8, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ ...spring.soft, delay: 0.08 }}
                className={`max-w-2xl font-semibold tracking-[-0.055em] text-ink ${tightLayout ? "text-[2.7rem] leading-[0.96]" : compactLayout ? "text-[3.1rem] leading-[0.96] sm:text-[3.5rem]" : "text-5xl sm:text-6xl"}`}
              >
                {greeting}, Brady.
              </motion.h1>

              <motion.p
                initial={{ y: 8, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ ...spring.soft, delay: 0.12 }}
                className={`mt-4 max-w-2xl text-dim ${tightLayout ? "text-[14px] leading-6" : compactLayout ? "text-[14px] leading-6" : "text-[15px] leading-7"}`}
              >
                The timeline is open, your sources are loaded, and the editor is standing by.
                Start with a concrete goal and let JCut build momentum from there.
              </motion.p>

              <motion.div
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ ...spring.soft, delay: 0.15 }}
                className={`mt-7 flex flex-wrap gap-2.5 ${compactLayout ? "max-w-xl" : ""}`}
              >
                <span className={`rounded-pill bg-white/5 font-semibold uppercase text-dim ${tightLayout ? "px-2.5 py-1 text-[10px] tracking-[0.16em]" : "px-3 py-1.5 text-[11px] tracking-[0.18em]"}`}>Footage loaded</span>
                <span className={`rounded-pill bg-accent/12 font-semibold uppercase text-accent ${tightLayout ? "px-2.5 py-1 text-[10px] tracking-[0.16em]" : "px-3 py-1.5 text-[11px] tracking-[0.18em]"}`}>Editor ready</span>
                <span className={`rounded-pill bg-white/5 font-semibold uppercase text-dim ${tightLayout ? "px-2.5 py-1 text-[10px] tracking-[0.16em]" : "px-3 py-1.5 text-[11px] tracking-[0.18em]"}`}>Premiere export workflow</span>
              </motion.div>

              {compactLayout && (
                <motion.div
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ ...spring.soft, delay: 0.17 }}
                  className={`mt-6 rounded-[1.45rem] depth-chip ${tightLayout ? "p-4" : "p-4"}`}
                >
                  <div className="mb-3 flex items-start justify-between gap-4">
                    <div>
                      <div className="inline-flex items-center gap-2 rounded-pill bg-accent/12 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-accent">
                        <Sparkle size={10} stroke={2.2} />
                        Editorial Note
                      </div>
                      <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-dim">
                        {activeTip.category}
                      </div>
                    </div>
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(180deg,rgba(var(--accent-glow-rgb),0.24),rgba(255,255,255,0.05))] text-accent shadow-[0_12px_32px_rgba(var(--accent-glow-rgb),0.18)]">
                      <TipIcon size={18} stroke={1.7} />
                    </div>
                  </div>
                  <h3 className={`${tightLayout ? "text-[1.32rem]" : "text-xl"} font-semibold tracking-[-0.03em] text-ink`}>{activeTip.title}</h3>
                  <p className={`mt-2 text-dim ${tightLayout ? "text-[14px] leading-6" : "text-[14px] leading-6"}`}>{activeTip.desc}</p>
                  <div className="mt-4 flex items-center justify-between">
                    <div className="flex gap-1.5">
                      {WELCOME_TIPS.map((_, idx) => (
                        <button
                          key={idx}
                          onClick={() => setTipIndex(idx)}
                          className={`rounded-full transition-all duration-300 ${
                            idx === tipIndex ? "h-1.5 w-7 bg-accent" : "h-1.5 w-1.5 bg-white/10 hover:bg-white/25"
                          }`}
                        />
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setTipIndex((prev) => (prev - 1 + WELCOME_TIPS.length) % WELCOME_TIPS.length)}
                        className="grid h-9 w-9 place-items-center rounded-2xl depth-chip text-dim transition-colors hover:text-ink"
                      >
                        <ChevronRight size={13} stroke={1.7} className="rotate-180" />
                      </button>
                      <button
                        onClick={() => setTipIndex((prev) => (prev + 1) % WELCOME_TIPS.length)}
                        className="grid h-9 w-9 place-items-center rounded-2xl text-white shadow-[0_14px_36px_rgba(var(--accent-glow-rgb),0.22)]"
                        style={{ background: TEAL_GRADIENT }}
                      >
                        <ChevronRight size={13} stroke={1.9} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>

            <motion.div
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ ...spring.soft, delay: 0.18 }}
              className={`grid gap-3 ${compactLayout ? "mt-6 sm:grid-cols-1" : "mt-10 sm:grid-cols-2"}`}
            >
              {(tightLayout ? SUGGESTIONS.slice(0, 3) : SUGGESTIONS).map((s, idx) => (
                <motion.button
                  whileHover={{ scale: 1.015, y: -2 }}
                  whileTap={{ scale: 0.985 }}
                  key={s}
                  onClick={() => onPick(s)}
                  className={`group relative overflow-hidden rounded-[1.45rem] depth-card text-left transition-colors ${tightLayout ? "px-4 py-4" : "px-4 py-4"}`}
                >
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(var(--accent-glow-rgb),0.08),transparent_45%)] opacity-0 transition-opacity group-hover:opacity-100" />
                  <div className={`${tightLayout ? "mb-2.5" : "mb-3"} flex items-center justify-between`}>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-dim">
                      {idx < 2 ? "Launch Prompt" : "Quick Move"}
                    </span>
                    <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/5 text-dim transition-colors group-hover:bg-accent/15 group-hover:text-accent">
                      <ChevronRight size={14} stroke={1.7} />
                    </span>
                  </div>
                  <div className={`relative font-medium text-ink ${tightLayout ? "text-[15px] leading-6" : "text-[15px] leading-6"}`}>{s}</div>
                </motion.button>
              ))}
            </motion.div>
          </div>
          </div>

          {!compactLayout && <motion.div
            initial={{ x: 10, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ ...spring.soft, delay: 0.16 }}
            className="flex"
          >
            <div className="relative flex w-full flex-col overflow-hidden rounded-[2rem] border border-white/[0.05] bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012))] p-5 shadow-[0_26px_80px_rgba(0,0,0,0.36)] backdrop-blur-2xl">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(var(--accent-glow-rgb),0.15),transparent_34%)]" />
              <div className="relative flex items-start justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-pill bg-accent/12 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-accent">
                    <Sparkle size={11} stroke={2.4} />
                    Editorial Note
                  </div>
                  <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.24em] text-dim">
                    {activeTip.category}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {WELCOME_TIPS.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setTipIndex(idx)}
                      className={`rounded-full transition-all duration-300 ${
                        idx === tipIndex ? "h-1.5 w-7 bg-accent" : "h-1.5 w-1.5 bg-white/10 hover:bg-white/25"
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div className="relative mt-6 rounded-[1.4rem] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={tipIndex}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={spring.snappy}
                  >
                    <div className="flex items-start gap-4">
                      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(180deg,rgba(var(--accent-glow-rgb),0.24),rgba(255,255,255,0.05))] text-accent shadow-[0_12px_32px_rgba(var(--accent-glow-rgb),0.18)]">
                        <TipIcon size={20} stroke={1.7} />
                      </div>
                      <div>
                        <div className="text-[13px] font-semibold uppercase tracking-[0.22em] text-accent/80">
                          {activeTip.accent}
                        </div>
                        <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-ink">
                          {activeTip.title}
                        </h3>
                        <p className="mt-3 text-[15px] leading-7 text-dim">
                          {activeTip.desc}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>

              <div className="relative mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl depth-chip px-4 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-dim">Prompt Style</div>
                  <div className="mt-1 text-sm text-ink">Direct, specific asks work best.</div>
                </div>
                <div className="rounded-2xl depth-chip px-4 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-dim">Best Flow</div>
                  <div className="mt-1 text-sm text-ink">Survey, decide, then batch edits.</div>
                </div>
                <div className="rounded-2xl depth-chip px-4 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-dim">Current Workspace</div>
                  <div className="mt-1 truncate text-sm text-ink">{workspace}</div>
                </div>
              </div>

              <div className="relative mt-auto flex items-center justify-between pt-5">
                <div className="text-[11px] uppercase tracking-[0.22em] text-dim">
                  {tipIndex + 1} / {WELCOME_TIPS.length}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setTipIndex((prev) => (prev - 1 + WELCOME_TIPS.length) % WELCOME_TIPS.length)}
                    className="grid h-10 w-10 place-items-center rounded-2xl depth-chip text-dim transition-colors hover:text-ink"
                  >
                    <ChevronRight size={14} stroke={1.7} className="rotate-180" />
                  </button>
                  <button
                    onClick={() => setTipIndex((prev) => (prev + 1) % WELCOME_TIPS.length)}
                    className="grid h-10 w-10 place-items-center rounded-2xl text-white shadow-[0_14px_36px_rgba(var(--accent-glow-rgb),0.22)]"
                    style={{ background: TEAL_GRADIENT }}
                  >
                    <ChevronRight size={14} stroke={1.9} />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>}
        </div>
      </motion.section>
    </div>
  );
}

// ─── Chat input ───────────────────────────────────────────────────────────────

function ChatInput({ value, onChange, onSend, onStop, busy }: {
  value: string; onChange: (v: string) => void;
  onSend: () => void; onStop: () => void; busy: boolean;
}) {
  return (
    <div className="no-drag flex items-end gap-2 rounded-2xl depth-chip px-4 py-3  focus-within:ring-accent/30 transition-shadow">
      <textarea
        rows={1}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px";
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); }
        }}
        placeholder={busy ? "Redirect the edit, or stop…" : "Ask JCut to edit…"}
        className="flex-1 resize-none bg-transparent text-[14px] leading-relaxed text-ink placeholder:text-dim/60 focus:outline-none"
        style={{ minHeight: "24px" }}
      />
      <div className="flex shrink-0 items-center gap-1.5 pb-0.5">
        {busy && (
          <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
            onClick={onStop}
            className="grid h-8 w-8 place-items-center rounded-xl bg-red-500/80 text-white hover:bg-red-500 transition-colors"
          >
            <span className="text-xs">■</span>
          </motion.button>
        )}
        <motion.button
          whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }}
          onClick={onSend} disabled={!value.trim()}
          className="grid h-8 w-8 place-items-center rounded-xl text-white transition-opacity disabled:opacity-30"
          style={{ background: TEAL_GRADIENT }}
        >
          <span className="text-sm font-bold">↑</span>
        </motion.button>
      </div>
    </div>
  );
}
