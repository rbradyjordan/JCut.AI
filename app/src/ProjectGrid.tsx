// Project Manager — the DaVinci Resolve-style launch view.
// On startup JCut shows a grid of project tiles (one per workspace) instead of
// dropping straight into a chat. Each tile carries a preview photo grabbed from
// the project's first source clip; clicking a tile opens that project and loads
// its chats. A "New project" tile sits at the end. The app returns here via the
// back button in the editor chrome.
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { spring, TEAL_GRADIENT, BLUE_GRADIENT } from "./theme";
import { Play, Thumbnail, Plus, Refresh, Music, Bolt, Cpu, Film, Brain, ChevronRight, Info, Sliders, Sparkle } from "./Icons";
import iconUrl from "./assets/icon.png";

interface Stats { sequences: number; chats: number; }

interface CtxMenu {
  workspace: string;
  x: number;
  y: number;
}

const HUB_TIPS = [
  {
    category: "Audio",
    title: "Beat-Snapping Timeline",
    desc: "Always run analyze-music first. JCut generates a beat map so sequence edits automatically snap to the downbeats of your soundtrack.",
    cmd: "analyze-music --file track.mp3",
    color: "var(--accent)",
    icon: Music,
  },
  {
    category: "Workflow",
    title: "Batch Clip Editing",
    desc: "For rapid edits, write instructions that combine multiple cuts in a single message. Grouping actions is 3x faster than editing one clip at a time.",
    cmd: "jc sequence-edit",
    color: "#2E6BE6",
    icon: Bolt,
  },
  {
    category: "Local AI",
    title: "Continuous Execution",
    desc: "If local model streaming stalls, verify your LM Studio configuration. We recommend setting context size to 8k+ and enabling continuous mode.",
    color: "#8B5CF6",
    icon: Cpu,
  },
  {
    category: "Layout",
    title: "Smart Scaling",
    desc: "Prevent pillarboxes when using mixed media! Ask JCut to scale-to-fit: it auto-calculates scale ratios based on canvas resolution.",
    color: "#D946EF",
    icon: Film,
  },
  {
    category: "Local AI",
    title: "Inject Editing Knowledge",
    desc: "Use playbooks to train JCut on specific styles. Run kb-read to instruct local agents on how to construct a recap or highlight reel.",
    cmd: "kb-read --id recap-videos",
    color: "#FB7185",
    icon: Brain,
  }
];

export default function ProjectGrid({
  workspaces, onOpen, onNewProject, onRefresh,
}: {
  workspaces: string[];
  onOpen: (ws: string) => void;
  onNewProject: (name: string) => void;
  onRefresh?: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [ctx, setCtx] = useState<CtxMenu | null>(null);
  const [localWorkspaces, setLocalWorkspaces] = useState(workspaces);
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => { setLocalWorkspaces(workspaces); }, [workspaces]);

  const refresh = async () => {
    const r = await window.jcut.listWorkspaces();
    if (r.ok) setLocalWorkspaces(r.workspaces);
    onRefresh?.();
  };

  const submitNew = () => {
    const n = name.trim();
    if (!n) return;
    onNewProject(n);
    setName(""); setAdding(false);
  };

  const openCtx = (workspace: string, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtx({ workspace, x: e.clientX, y: e.clientY });
  };

  const closeCtx = () => setCtx(null);

  const handleDelete = async (ws: string) => {
    closeCtx();
    const ok = window.confirm(`Delete "${ws}"? This cannot be undone.`);
    if (!ok) return;
    await window.jcut.projectDelete(ws);
    await refresh();
  };

  const handleDuplicate = async (ws: string) => {
    closeCtx();
    const r = await window.jcut.projectDuplicate(ws);
    if (r.ok) await refresh();
  };

  const handleRename = async (ws: string) => {
    closeCtx();
    const newName = window.prompt("Rename project:", ws);
    if (!newName || newName.trim() === ws) return;
    const r = await window.jcut.projectRename(ws, newName.trim());
    if (r.ok) await refresh();
  };

  const handleResetThumb = async (ws: string) => {
    closeCtx();
    await window.jcut.resetProjectThumbnail(ws);
    await refresh();
  };

  const handleSetThumb = async (ws: string) => {
    closeCtx();
    await window.jcut.setProjectThumbnail(ws);
    await refresh();
  };

  const handleReveal = async (ws: string) => {
    closeCtx();
    const home = await window.jcut.getJcutHome();
    await window.jcut.reveal(`${home}/${ws}`);
  };

  return (
    <div className="flex h-full flex-col" onClick={closeCtx}>
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-8 pt-6 pb-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">AI Editor</h1>
          <p className="mt-0.5 text-[12.5px] text-dim">Chat your way to a finished timeline. Open a project or start a new one.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refresh()}
            title="Refresh"
            className="grid h-8 w-8 place-items-center rounded-lg text-dim transition-colors hover:bg-white/[0.05] hover:text-ink"
          >
            <Refresh size={15} stroke={1.5} />
          </button>
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12.5px] font-semibold text-white shadow-sm"
            style={{ background: TEAL_GRADIENT }}
          >
            <Plus size={14} stroke={2} /> New project
          </motion.button>
        </div>
      </div>

      {/* Grid */}
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        {localWorkspaces.length === 0 && !adding ? (
          <div className="mt-6 rounded-2xl border border-dashed border-line bg-black/10 px-6 py-16 text-center">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl text-white shadow-card" style={{ background: TEAL_GRADIENT }}>
              <Sparkle size={24} stroke={1.5} />
            </div>
            <p className="text-base font-semibold text-ink">Create your first AI project</p>
            <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-dim">A project holds your footage, chats, and timelines. Add footage, then describe the edit you want.</p>
            <motion.button
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              onClick={() => setAdding(true)}
              className="mx-auto mt-5 flex items-center gap-1.5 rounded-pill px-5 py-2.5 text-sm font-semibold text-white shadow-card"
              style={{ background: TEAL_GRADIENT }}
            >
              <Plus size={16} stroke={2} /> New project
            </motion.button>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
            <AnimatePresence>
              {localWorkspaces.map((ws, i) => (
                <ProjectTile
                  key={ws} workspace={ws} index={i}
                  onOpen={() => onOpen(ws)}
                  onContextMenu={(e) => openCtx(ws, e)}
                />
              ))}
            </AnimatePresence>

            {/* New project tile */}
            <motion.div layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
              transition={spring.soft} className="no-drag flex flex-col">
              {adding ? (
                <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-xl2 border border-dashed border-line depth-chip p-4">
                  <input
                    autoFocus value={name} onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submitNew(); if (e.key === "Escape") { setAdding(false); setName(""); } }}
                    placeholder="Project name"
                    className="w-full rounded-pill bg-surface px-4 py-2 text-center text-sm shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)] focus:outline-none"
                  />
                  <div className="flex gap-2">
                    <button onClick={submitNew} className="rounded-pill px-4 py-1.5 text-sm font-medium text-white" style={{ background: TEAL_GRADIENT }}>Create</button>
                    <button onClick={() => { setAdding(false); setName(""); }} className="rounded-pill bg-surface2 px-4 py-1.5 text-sm text-dim shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]">Cancel</button>
                  </div>
                </div>
              ) : (
                <motion.button whileHover={{ y: -4, scale: 1.01 }} whileTap={{ scale: 0.98 }} transition={spring.snappy}
                  onClick={() => setAdding(true)}
                  className="group flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl2 border border-dashed border-line depth-chip text-dim hover:text-ink hover:border-accent/50"
                >
                  <span className="grid h-12 w-12 place-items-center rounded-full text-white shadow-card transition group-hover:scale-110"
                    style={{ background: TEAL_GRADIENT }}><Plus size={20} stroke={1.5} /></span>
                  <span className="text-sm font-medium">New project</span>
                </motion.button>
              )}
            </motion.div>
          </div>
        )}
      </div>


      {/* Context menu */}
      <AnimatePresence>
        {ctx && (
          <ContextMenu
            x={ctx.x} y={ctx.y}
            onClose={closeCtx}
            onOpen={() => { onOpen(ctx.workspace); closeCtx(); }}
            onRename={() => handleRename(ctx.workspace)}
            onDuplicate={() => handleDuplicate(ctx.workspace)}
            onSetThumb={() => handleSetThumb(ctx.workspace)}
            onResetThumb={() => handleResetThumb(ctx.workspace)}
            onReveal={() => handleReveal(ctx.workspace)}
            onDelete={() => handleDelete(ctx.workspace)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}


// ─── Context menu ────────────────────────────────────────────────────────────

function ContextMenu({
  x, y, onClose, onOpen, onRename, onDuplicate, onSetThumb, onResetThumb, onReveal, onDelete,
}: {
  x: number; y: number; onClose: () => void;
  onOpen: () => void; onRename: () => void; onDuplicate: () => void;
  onSetThumb: () => void; onResetThumb: () => void;
  onReveal: () => void; onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Nudge the menu inward if it would clip the viewport edge.
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth - width - 8),
      y: Math.min(y, window.innerHeight - height - 8),
    });
  }, [x, y]);

  // Close on outside click (the parent div handles this via onClick={closeCtx}).
  const items: { label: string; danger?: boolean; sep?: boolean; action: () => void }[] = [
    { label: "Open", action: onOpen },
    { label: "Rename…", action: onRename },
    { label: "Duplicate", action: onDuplicate },
    { label: "Set thumbnail…", action: onSetThumb },
    { label: "Reset thumbnail", action: onResetThumb },
    { label: "Show in Finder", action: onReveal },
    { label: "Delete…", danger: true, sep: true, action: onDelete },
  ];

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.94, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, y: -4 }}
      transition={spring.snappy}
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 200 }}
      className="w-52 overflow-hidden rounded-xl bg-surface/95 py-1 shadow-card backdrop-blur-xl"
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => (
        <div key={i}>
          {item.sep && <div className="my-1 border-t border-line" />}
          <button
            onClick={() => { item.action(); onClose(); }}
            className={`flex w-full items-center px-3.5 py-2 text-left text-sm transition hover:bg-surface2 ${
              item.danger ? "text-red-400" : "text-ink"
            }`}
          >
            {item.label}
          </button>
        </div>
      ))}
    </motion.div>
  );
}

// ─── Project tile ─────────────────────────────────────────────────────────────

function ProjectTile({
  workspace, index, onOpen, onContextMenu,
}: {
  workspace: string; index: number;
  onOpen: () => void;
  onContextMenu: (e: MouseEvent) => void;
}) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [isManual, setIsManual] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.resolve(window.jcut.projectThumbnail?.(workspace)).then((r) => {
      if (alive) { setThumb(r?.dataUrl ?? null); setIsManual(!!r?.isManual); setLoading(false); }
    }).catch(() => { if (alive) setLoading(false); });
    Promise.resolve(window.jcut.projectStats?.(workspace)).then((r) => {
      if (alive && r?.ok) setStats({ sequences: r.sequences, chats: r.chats });
    }).catch(() => { /* counts are optional */ });
    return () => { alive = false; };
  }, [workspace]);

  const setThumbnail = async (e: MouseEvent) => {
    e.stopPropagation();
    if (working || !window.jcut.setProjectThumbnail) return;
    setWorking(true);
    try {
      const r = await window.jcut.setProjectThumbnail(workspace);
      if (r.ok && r.dataUrl) { setThumb(r.dataUrl); setIsManual(true); }
    } finally { setWorking(false); }
  };

  const resetThumbnail = async (e: MouseEvent) => {
    e.stopPropagation();
    if (working || !window.jcut.resetProjectThumbnail) return;
    setWorking(true);
    try {
      const r = await window.jcut.resetProjectThumbnail(workspace);
      if (r.ok) { setThumb(r.dataUrl ?? null); setIsManual(false); }
    } finally { setWorking(false); }
  };

  const grad = (workspace.charCodeAt(0) + workspace.length) % 2 ? TEAL_GRADIENT : BLUE_GRADIENT;

  const subtitle = stats
    ? [
        stats.sequences ? `${stats.sequences} seq${stats.sequences === 1 ? "" : "s"}` : null,
        stats.chats ? `${stats.chats} chat${stats.chats === 1 ? "" : "s"}` : null,
      ].filter(Boolean).join(" · ") || "Empty project"
    : "";

  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={{ ...spring.soft, delay: Math.min(index * 0.04, 0.3) }}
      whileHover={{ y: -4, scale: 1.015 }}
      whileTap={{ scale: 0.985 }}
      onClick={onOpen}
      onContextMenu={onContextMenu}
      className="no-drag group flex flex-col overflow-hidden rounded-xl2 depth-card text-left shadow-card backdrop-blur-xl"
    >
      {/* Preview photo */}
      <div className="relative aspect-video w-full overflow-hidden">
        {thumb ? (
          <img src={thumb} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
        ) : (
          <div className="h-full w-full" style={{ background: grad }}>
            {loading && (
              <div className="grid h-full w-full place-items-center">
                <div className="h-6 w-6 animate-pulse rounded-full bg-white/30" />
              </div>
            )}
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/70 to-transparent" />
        <motion.div initial={false} className="absolute inset-0 grid place-items-center opacity-0 transition group-hover:opacity-100">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-white/15 text-white backdrop-blur-md ">
            <Play size={20} stroke={1.5} />
          </span>
        </motion.div>

        {/* Thumbnail controls on hover */}
        <div className="absolute right-2 top-2 flex gap-1.5 opacity-0 transition group-hover:opacity-100">
          <div role="button" tabIndex={-1} onClick={setThumbnail} title="Set a custom thumbnail image"
            className="flex items-center gap-1 rounded-pill bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-md  hover:bg-black/75">
            {working ? "…" : <><Thumbnail className="h-3 w-3 inline mr-1" />Set thumbnail</>}
          </div>
          {isManual && (
            <div role="button" tabIndex={-1} onClick={resetThumbnail} title="Revert to auto-generated frame"
              className="grid h-[26px] w-[26px] place-items-center rounded-full bg-black/55 text-white backdrop-blur-md  hover:bg-black/75">
              <Refresh size={12} stroke={1.5} />
            </div>
          )}
        </div>

        {isManual && (
          <span className="absolute left-2 top-2 rounded-pill bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-md ">
            Custom
          </span>
        )}
      </div>

      {/* Caption */}
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{workspace}</div>
          <div className="truncate text-[11px] text-dim">{subtitle}</div>
        </div>
        <span className="shrink-0 text-dim transition group-hover:translate-x-0.5 group-hover:text-ink">→</span>
      </div>
    </motion.button>
  );
}
