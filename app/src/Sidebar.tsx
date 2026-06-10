import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { spring, TEAL_GRADIENT } from "./theme";
import { Close, Plus, ChevronRight } from "./Icons";

export interface ChatMeta { id: string; title: string; updated: number; }

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

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

  useEffect(() => {
    let alive = true;
    Promise.resolve(window.jcut.projectThumbnail?.(workspace))
      .then((r) => { if (alive) setThumb(r?.dataUrl ?? null); })
      .catch(() => {});
    return () => { alive = false; };
  }, [workspace]);

  return (
    <motion.div
      animate={{ width: collapsed ? 0 : width }}
      transition={spring.soft}
      className="relative z-20 flex h-full shrink-0 flex-col overflow-hidden shadow-[1px_0px_0px_rgba(255,255,255,0.04)]"
      style={{ borderRightWidth: collapsed ? 0 : 1 }}
    >
      <div className="flex min-h-0 flex-1 flex-col depth-card backdrop-blur-2xl">

        {/* Header: back + collapse */}
        <div className="flex h-12 shrink-0 items-center gap-1 shadow-[0px_1px_0px_rgba(255,255,255,0.03)] px-3">
          <motion.button
            whileHover={{ x: -1 }} whileTap={{ scale: 0.95 }}
            onClick={onBackToGrid}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] font-medium text-dim hover:bg-surface2 hover:text-ink transition-colors"
          >
            <ChevronRight size={12} stroke={1.5} className="rotate-180" />
            Projects
          </motion.button>
        </div>

        <div className="no-drag flex min-h-0 flex-1 flex-col gap-3 p-3">

          {/* Project card */}
          <motion.button
            whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
            onClick={onBackToGrid}
            transition={spring.snappy}
            className="group flex items-center gap-2.5 rounded-xl depth-chip p-2.5 text-left  hover:ring-line transition"
          >
            <div className="h-9 w-12 shrink-0 overflow-hidden rounded-lg shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]/50">
              {thumb
                ? <img src={thumb} alt="" className="h-full w-full object-cover" />
                : <div className="h-full w-full" style={{ background: TEAL_GRADIENT }} />
              }
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[9px] font-bold uppercase tracking-widest text-dim">Project</div>
              <div className="truncate text-[13px] font-semibold text-ink">{workspace}</div>
            </div>
            <ChevronRight size={12} stroke={1.5} className="shrink-0 text-dim opacity-0 transition group-hover:opacity-100" />
          </motion.button>

          {/* New chat button */}
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={onNewChat}
            className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-semibold text-white shadow-sm transition"
            style={{ background: TEAL_GRADIENT }}
          >
            <Plus size={14} stroke={2} /> New chat
          </motion.button>

          {/* Chat history */}
          <div className="flex min-h-0 flex-1 flex-col">
            {chats.length > 0 && (
              <div className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-widest text-dim/60">
                History
              </div>
            )}
            <div className="min-h-0 flex-1 space-y-px overflow-auto">
              {chats.length === 0 && (
                <div className="flex flex-col items-center gap-1 py-8 text-center text-xs text-dim/50">
                  <span className="text-lg">💬</span>
                  No chats yet
                </div>
              )}
              <AnimatePresence initial={false}>
                {chats.map((c) => {
                  const active = c.id === activeChatId;
                  return (
                    <motion.div
                      key={c.id} layout
                      initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}
                      transition={spring.snappy}
                      className={`group relative flex cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 transition ${
                        active
                          ? "depth-chip text-ink "
                          : "text-dim/80 hover:bg-surface2 hover:text-ink"
                      }`}
                      onClick={() => onSelectChat(c.id)}
                    >
                      {active && (
                        <motion.span
                          layoutId="chat-bar"
                          className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full"
                          style={{ background: TEAL_GRADIENT }}
                        />
                      )}
                      <div className="min-w-0 flex-1 pl-1">
                        <div className="truncate text-[12px] font-medium leading-tight">{c.title}</div>
                        <div className="mt-0.5 text-[10px] text-dim/50">{relativeTime(c.updated)}</div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeleteChat(c.id); }}
                        className="mt-0.5 shrink-0 opacity-0 transition group-hover:opacity-100 text-dim/50 hover:text-red-400"
                      >
                        <Close size={11} stroke={1.5} />
                      </button>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
