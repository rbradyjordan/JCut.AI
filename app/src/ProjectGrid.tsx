// Project Manager — the DaVinci Resolve-style launch view.
// On startup JCut shows a grid of project tiles (one per workspace) instead of
// dropping straight into a chat. Each tile carries a preview photo grabbed from
// the project's first source clip; clicking a tile opens that project and loads
// its chats. A "New project" tile sits at the end. The app returns here via the
// back button in the editor chrome.
import { useEffect, useState, type MouseEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { spring, TEAL_GRADIENT, BLUE_GRADIENT } from "./theme";
import iconUrl from "./assets/icon.png";

interface Stats { sequences: number; chats: number; }

export default function ProjectGrid({
  workspaces, onOpen, onNewProject,
}: {
  workspaces: string[];
  onOpen: (ws: string) => void;
  onNewProject: (name: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const submitNew = () => {
    const n = name.trim();
    if (!n) return;
    onNewProject(n);
    setName(""); setAdding(false);
  };

  return (
    <div className="grain relative flex h-full flex-col">
      <div className="backdrop" />

      {/* Traffic-light strip (matches the editor chrome). */}
      <div className="drag relative z-30 h-9 shrink-0 border-b border-black/40 bg-black/20 backdrop-blur-xl" />

      {/* Header */}
      <div className="relative z-10 flex items-center gap-3 px-8 pt-6 pb-2">
        <img src={iconUrl} alt="JCut.AI" className="h-8 w-8" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Projects
          </h1>
          <p className="text-sm text-dim">Pick a project to keep editing, or start a new one.</p>
        </div>
      </div>

      {/* Grid */}
      <div className="relative z-10 min-h-0 flex-1 overflow-auto px-8 pb-8 pt-3">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
          <AnimatePresence>
            {workspaces.map((ws, i) => (
              <ProjectTile key={ws} workspace={ws} index={i} onOpen={() => onOpen(ws)} />
            ))}
          </AnimatePresence>

          {/* New project tile */}
          <motion.div
            layout
            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
            transition={spring.soft}
            className="no-drag flex flex-col"
          >
            {adding ? (
              <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-xl2 border border-dashed border-line bg-surface2/50 p-4">
                <input
                  autoFocus value={name} onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitNew(); if (e.key === "Escape") { setAdding(false); setName(""); } }}
                  placeholder="Project name"
                  className="w-full rounded-pill bg-surface px-4 py-2 text-center text-sm ring-1 ring-line focus:outline-none"
                />
                <div className="flex gap-2">
                  <button onClick={submitNew}
                    className="rounded-pill px-4 py-1.5 text-sm font-medium text-white"
                    style={{ background: TEAL_GRADIENT }}>Create</button>
                  <button onClick={() => { setAdding(false); setName(""); }}
                    className="rounded-pill bg-surface2 px-4 py-1.5 text-sm text-dim ring-1 ring-line">Cancel</button>
                </div>
              </div>
            ) : (
              <motion.button
                whileHover={{ y: -4, scale: 1.01 }} whileTap={{ scale: 0.98 }}
                transition={spring.snappy}
                onClick={() => setAdding(true)}
                className="group flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl2 border border-dashed border-line bg-surface2/40 text-dim hover:text-ink hover:border-accent/50"
              >
                <span className="grid h-12 w-12 place-items-center rounded-full text-2xl text-white shadow-card transition group-hover:scale-110"
                      style={{ background: TEAL_GRADIENT }}>＋</span>
                <span className="text-sm font-medium">New project</span>
              </motion.button>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function ProjectTile({
  workspace, index, onOpen,
}: { workspace: string; index: number; onOpen: () => void }) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [isManual, setIsManual] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let alive = true;
    // Guard the bridge calls: if an older preload is still loaded (e.g. before an
    // Electron restart) these methods can be undefined — fall back gracefully to
    // the gradient tile instead of throwing and blanking the whole grid.
    Promise.resolve(window.jcut.projectThumbnail?.(workspace)).then((r) => {
      if (alive) { setThumb(r?.dataUrl ?? null); setIsManual(!!r?.isManual); setLoading(false); }
    }).catch(() => { if (alive) setLoading(false); });
    Promise.resolve(window.jcut.projectStats?.(workspace)).then((r) => {
      if (alive && r?.ok) setStats({ sequences: r.sequences, chats: r.chats });
    }).catch(() => { /* counts are optional */ });
    return () => { alive = false; };
  }, [workspace]);

  // Pick a custom image as this project's thumbnail. stopPropagation keeps the
  // tile from also firing its open-project click.
  const setThumbnail = async (e: MouseEvent) => {
    e.stopPropagation();
    if (working || !window.jcut.setProjectThumbnail) return;
    setWorking(true);
    try {
      const r = await window.jcut.setProjectThumbnail(workspace);
      if (r.ok && r.dataUrl) { setThumb(r.dataUrl); setIsManual(true); }
    } finally { setWorking(false); }
  };

  // Revert to the auto-extracted first-clip frame.
  const resetThumbnail = async (e: MouseEvent) => {
    e.stopPropagation();
    if (working || !window.jcut.resetProjectThumbnail) return;
    setWorking(true);
    try {
      const r = await window.jcut.resetProjectThumbnail(workspace);
      if (r.ok) { setThumb(r.dataUrl ?? null); setIsManual(false); }
    } finally { setWorking(false); }
  };

  // Stable on-brand gradient fallback (deterministic per name — no Math.random).
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
      className="no-drag group flex flex-col overflow-hidden rounded-xl2 bg-surface/70 text-left shadow-card ring-1 ring-line backdrop-blur-xl"
    >
      {/* Preview photo */}
      <div className="relative aspect-video w-full overflow-hidden">
        {thumb ? (
          <img
            src={thumb} alt=""
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="h-full w-full" style={{ background: grad }}>
            {loading && (
              <div className="grid h-full w-full place-items-center">
                <div className="h-6 w-6 animate-pulse rounded-full bg-white/30" />
              </div>
            )}
          </div>
        )}
        {/* Bottom scrim so the title is always readable over any frame. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/70 to-transparent" />
        {/* Play affordance on hover. */}
        <motion.div
          initial={false}
          className="absolute inset-0 grid place-items-center opacity-0 transition group-hover:opacity-100"
        >
          <span className="grid h-12 w-12 place-items-center rounded-full bg-white/15 text-lg text-white backdrop-blur-md ring-1 ring-white/30">▶</span>
        </motion.div>

        {/* Thumbnail controls (top-right, reveal on hover). Rendered as role=button
            divs — not <button> — to stay valid inside the tile's own <button>. */}
        <div className="absolute right-2 top-2 flex gap-1.5 opacity-0 transition group-hover:opacity-100">
          <div
            role="button" tabIndex={-1} onClick={setThumbnail}
            title="Set a custom thumbnail image"
            className="flex items-center gap-1 rounded-pill bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-md ring-1 ring-white/20 hover:bg-black/75"
          >
            {working ? "…" : "🖼 Set thumbnail"}
          </div>
          {isManual && (
            <div
              role="button" tabIndex={-1} onClick={resetThumbnail}
              title="Revert to the auto-generated frame"
              className="grid h-[26px] w-[26px] place-items-center rounded-full bg-black/55 text-[11px] text-white backdrop-blur-md ring-1 ring-white/20 hover:bg-black/75"
            >↺</div>
          )}
        </div>

        {/* "Custom" badge so a manually-set thumbnail is identifiable at a glance. */}
        {isManual && (
          <span className="absolute left-2 top-2 rounded-pill bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-md ring-1 ring-white/15">
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
