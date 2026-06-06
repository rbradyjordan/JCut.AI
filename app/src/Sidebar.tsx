// Left sidebar — chats for the CURRENT project. Project selection now lives in
// the launch grid (ProjectGrid), so this panel no longer switches workspaces;
// it shows which project you're in (with its preview thumbnail + a way back to
// the grid) and a clean, color-differentiated chat history below.
// Color language: grouped raised cards, teal gradient on the active item,
// accent-tinted section labels, soft teal left-bar on the active chat.
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { spring, TEAL_GRADIENT } from "./theme";

export interface ChatMeta { id: string; title: string; updated: number; }

export default function Sidebar({
  collapsed, width = 264, onToggle, workspace, onBackToGrid,
  chats, activeChatId, onSelectChat, onNewChat, onDeleteChat,
}: {
  collapsed: boolean;
  width?: number;
  onToggle: () => void;
  workspace: string;
  onBackToGrid: () => void;
  chats: ChatMeta[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onDeleteChat: (id: string) => void;
}) {
  const [thumb, setThumb] = useState<string | null>(null);

  // Load the current project's preview frame (same cache the grid uses).
  useEffect(() => {
    let alive = true;
    Promise.resolve(window.jcut.projectThumbnail?.(workspace))
      .then((r) => { if (alive) setThumb(r?.dataUrl ?? null); })
      .catch(() => { /* gradient fallback */ });
    return () => { alive = false; };
  }, [workspace]);

  return (
    <motion.div
      animate={{ width: collapsed ? 0 : width }}
      transition={spring.soft}
      className="relative z-20 flex h-full flex-col overflow-hidden border-r border-line bg-surface/60 backdrop-blur-xl"
      style={{ borderRightWidth: collapsed ? 0 : 1 }}
    >
      {/* Header: back to grid + collapse toggle. */}
      <div className="flex h-14 items-center gap-1 px-3">
        <motion.button
          whileHover={{ x: -2 }} whileTap={{ scale: 0.94 }}
          onClick={onBackToGrid}
          className="flex items-center gap-1 rounded-pill px-2 py-1 text-sm font-medium text-dim hover:bg-surface2 hover:text-ink"
          title="Back to all projects"
        >
          <span className="text-base leading-none">‹</span> Projects
        </motion.button>
        {/* Collapse is handled by the floating button in the chrome bar. */}
      </div>

      {!collapsed && (
        <div className="no-drag flex min-h-0 flex-1 flex-col px-3 pb-3">
          {/* Current project card — name + preview thumbnail. */}
          <motion.button
            whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
            onClick={onBackToGrid}
            transition={spring.snappy}
            className="group mb-3 flex items-center gap-3 rounded-xl2 bg-surface2 p-2 text-left ring-1 ring-line"
            title="Switch project"
          >
            <div className="h-10 w-14 shrink-0 overflow-hidden rounded-lg ring-1 ring-line">
              {thumb ? (
                <img src={thumb} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full" style={{ background: TEAL_GRADIENT }} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-accent/90">Project</div>
              <div className="truncate text-sm font-semibold">{workspace}</div>
            </div>
            <span className="shrink-0 pr-1 text-dim transition group-hover:text-ink">⇄</span>
          </motion.button>

          {/* New chat */}
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={onNewChat}
            className="mb-3 flex items-center justify-center gap-2 rounded-pill px-3 py-2 text-sm font-medium text-white shadow-card"
            style={{ background: TEAL_GRADIENT }}
          >
            <span>＋</span> New chat
          </motion.button>

          {/* Chat history — its own raised card so it reads as a distinct group. */}
          <div className="flex min-h-0 flex-1 flex-col rounded-xl2 bg-surface2/50 p-2 ring-1 ring-line">
            <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-accent/80">
              Chats
            </div>
            <div className="min-h-0 flex-1 space-y-0.5 overflow-auto">
              {chats.length === 0 && (
                <div className="px-2 py-3 text-center text-xs text-dim">
                  No chats yet.<br />Start one below.
                </div>
              )}
              <AnimatePresence initial={false}>
                {chats.map((c) => {
                  const active = c.id === activeChatId;
                  return (
                    <motion.div
                      key={c.id}
                      layout
                      initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }}
                      whileHover={{ x: 2 }} transition={spring.snappy}
                      className={`group relative flex items-center gap-1 rounded-lg py-1.5 pl-3 pr-1 text-sm ${
                        active ? "bg-surface text-ink ring-1 ring-line" : "text-dim hover:bg-surface hover:text-ink"
                      }`}
                    >
                      {/* Teal active-bar accent. */}
                      {active && (
                        <motion.span
                          layoutId="chat-active-bar"
                          className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-full"
                          style={{ background: TEAL_GRADIENT }}
                        />
                      )}
                      <button onClick={() => onSelectChat(c.id)} className="min-w-0 flex-1 truncate text-left">
                        {c.title}
                      </button>
                      <button
                        onClick={() => onDeleteChat(c.id)}
                        className="opacity-0 transition group-hover:opacity-100 text-dim hover:text-red-400"
                        aria-label="Delete chat"
                      >✕</button>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
