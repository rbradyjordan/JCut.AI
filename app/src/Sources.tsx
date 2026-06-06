// Sources panel — a Premiere-style media bin for the project's footage.
// "Add footage"/"Add folder" symlink media into the workspace (never copied);
// the agent references them by name when editing. You can remove individual
// clips or clear the queue, minimize the whole panel, and switch between a
// FOLDER bin view (grouped by the folder each clip was imported from) and a
// TYPE view (video / audio / images). Removing a clip deletes only the symlink —
// your original media is never touched.
import { useEffect, useMemo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { spring, TEAL_GRADIENT } from "./theme";

interface Source { name: string; rel: string; type: string; origDir?: string | null; origPath?: string | null; }
type GroupBy = "folder" | "type";

const ICON: Record<string, string> = { video: "🎞", audio: "🎵", images: "🖼" };

export default function Sources({
  workspace, onChanged, onCollapse,
}: { workspace: string; onChanged?: () => void; onCollapse?: () => void }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>("folder");
  const [openBins, setOpenBins] = useState<Record<string, boolean>>({});
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = useCallback(async () => {
    const r = await window.jcut.jc("sources-list", ["--workspace", workspace]);
    if (r.ok) { try { setSources(JSON.parse(r.stdout).sources || []); } catch { /* */ } }
  }, [workspace]);
  useEffect(() => { refresh(); }, [refresh]);

  const addFootage = async () => {
    const picked = await window.jcut.pickMedia();
    if (!picked.ok || !picked.paths?.length) return;
    setBusy(true);
    await window.jcut.jc("source-add", ["--workspace", workspace, "--files", ...picked.paths]);
    await refresh(); setBusy(false); onChanged?.();
  };

  const addFolder = async () => {
    const picked = await window.jcut.pickFolder?.();
    if (!picked?.ok || !picked.path) return;
    setBusy(true);
    await window.jcut.jc("source-add", ["--workspace", workspace, "--folder", picked.path]);
    await refresh(); setBusy(false); onChanged?.();
  };

  const removeOne = async (rel: string) => {
    setSources((s) => s.filter((x) => x.rel !== rel)); // optimistic
    await window.jcut.jc("source-remove", ["--workspace", workspace, "--rel", rel]);
    await refresh(); onChanged?.();
  };

  const clearAll = async () => {
    setBusy(true); setConfirmClear(false);
    await window.jcut.jc("source-clear", ["--workspace", workspace]);
    await refresh(); setBusy(false); onChanged?.();
  };

  // Group sources into bins (by original folder, or by media type).
  const bins = useMemo(() => {
    const map = new Map<string, Source[]>();
    for (const s of sources) {
      const key = groupBy === "type"
        ? s.type
        : (s.origDir ? folderLabel(s.origDir) : "Loose files");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [sources, groupBy]);

  const isOpen = (k: string) => openBins[k] !== false; // open by default
  const toggleBin = (k: string) => setOpenBins((o) => ({ ...o, [k]: !isOpen(k) }));

  return (
    <div className="px-5 pb-2">
      {/* Header */}
      <div className="mb-2 flex items-center gap-2">
        {onCollapse && (
          <button
            onClick={onCollapse}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-dim hover:bg-surface2 hover:text-ink"
            title="Collapse panel into the rail"
            aria-label="Collapse panel"
          >›</button>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-dim hover:text-ink"
          title={collapsed ? "Expand sources" : "Minimize sources"}
        >
          <motion.span animate={{ rotate: collapsed ? -90 : 0 }} transition={spring.snappy} className="inline-block">▾</motion.span>
          Sources
        </button>
        <span className="rounded-pill bg-surface2 px-1.5 text-[11px] text-dim">{sources.length}</span>

        <div className="ml-auto flex items-center gap-1.5">
          {!collapsed && sources.length > 0 && (
            <button
              onClick={() => setConfirmClear(true)}
              className="rounded-pill px-2 py-1 text-[11px] text-dim hover:bg-surface2 hover:text-red-400"
              title="Remove all clips from the queue (originals untouched)"
            >Clear</button>
          )}
          <motion.button
            whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.96 }}
            onClick={addFolder} disabled={busy}
            className="flex items-center gap-1 rounded-pill bg-surface2 px-2.5 py-1.5 text-[12px] text-ink ring-1 ring-line disabled:opacity-60"
            title="Import a whole folder of footage"
          >📁 Folder</motion.button>
          <motion.button
            whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.96 }}
            onClick={addFootage} disabled={busy}
            className="flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-sm text-white disabled:opacity-60"
            style={{ background: TEAL_GRADIENT }}
          >
            <span>＋</span> {busy ? "Adding…" : "Add footage"}
          </motion.button>
        </div>
      </div>

      {/* Clear confirmation */}
      <AnimatePresence>
        {confirmClear && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="mb-2 flex items-center gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-[12px] text-ink ring-1 ring-red-500/20"
          >
            <span>Remove all {sources.length} clips? Your originals stay where they are.</span>
            <button onClick={clearAll} className="ml-auto rounded-pill bg-red-500/90 px-3 py-1 text-white">Clear all</button>
            <button onClick={() => setConfirmClear(false)} className="rounded-pill bg-surface2 px-3 py-1 text-dim ring-1 ring-line">Cancel</button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="body"
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            transition={spring.soft}
          >
            {sources.length === 0 ? (
              <button
                onClick={addFootage}
                className="flex w-full flex-col items-center justify-center gap-1 rounded-xl2 border border-dashed border-line bg-surface2/40 py-6 text-sm text-dim hover:text-ink"
              >
                <span className="text-2xl">🎬</span>
                Drop in your footage to get started
              </button>
            ) : (
              <>
                {/* View toggle: Folder bins (Premiere-style) vs media Type. */}
                <div className="mb-2 flex items-center gap-1 text-[11px]">
                  <span className="text-dim">View:</span>
                  {(["folder", "type"] as GroupBy[]).map((g) => (
                    <button
                      key={g}
                      onClick={() => setGroupBy(g)}
                      className={`rounded-pill px-2 py-0.5 capitalize ${groupBy === g ? "text-white" : "text-dim hover:bg-surface2"}`}
                      style={groupBy === g ? { background: TEAL_GRADIENT } : undefined}
                    >{g}</button>
                  ))}
                </div>

                {/* Bins (scrollable, like a media-pool) */}
                <div className="max-h-[34vh] space-y-1.5 overflow-auto pr-1">
                  {bins.map(([key, items]) => (
                    <div key={key} className="overflow-hidden rounded-xl bg-surface2/40 ring-1 ring-line">
                      <button
                        onClick={() => toggleBin(key)}
                        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[12px] hover:bg-surface2"
                      >
                        <motion.span animate={{ rotate: isOpen(key) ? 0 : -90 }} transition={spring.snappy} className="text-dim">▾</motion.span>
                        <span className="text-dim">{groupBy === "type" ? (ICON[key] || "📄") : "📂"}</span>
                        <span className="truncate font-medium capitalize">{key}</span>
                        <span className="ml-auto rounded-pill bg-surface px-1.5 text-[10px] text-dim">{items.length}</span>
                      </button>
                      <AnimatePresence initial={false}>
                        {isOpen(key) && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                            className="px-1.5 pb-1.5"
                          >
                            {items.map((s) => (
                              <div
                                key={s.rel}
                                className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-surface"
                                title={s.origPath || s.rel}
                              >
                                <span className="shrink-0">{ICON[s.type] || "📄"}</span>
                                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                                <button
                                  onClick={() => removeOne(s.rel)}
                                  className="shrink-0 opacity-0 transition group-hover:opacity-100 text-dim hover:text-red-400"
                                  aria-label={`Remove ${s.name}`}
                                  title="Remove from queue (original untouched)"
                                >✕</button>
                              </div>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Show the last 1–2 path segments so bins read like "Project/B-roll", not a
// giant absolute path.
function folderLabel(dir: string): string {
  const parts = dir.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || dir;
}
