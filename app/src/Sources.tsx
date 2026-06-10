// Sources panel — a Premiere-style media bin for the project's footage.
// "Add footage"/"Add folder" symlink media into the workspace (never copied);
// the agent references them by name when editing. You can remove individual
// clips or clear the queue, minimize the whole panel, and switch between a
// FOLDER bin view (grouped by the folder each clip was imported from) and a
// TYPE view (video / audio / images). Removing a clip deletes only the symlink —
// your original media is never touched.
//
// Design language: an 8px spacing grid (gaps of 8/12/16, padding of 12/16),
// a single clear header zone, a grouped action bar, and a calm media list with
// generous touch targets. Everything reads as deliberately laid out — never
// crammed against panel edges.
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { spring, TEAL_GRADIENT } from "./theme";
import { ArrowDown, ChevronDown, ChevronRight, Close, Film, File, Folder, Image, Music, Plus, Warning, Link, Clapper } from "./Icons";
import RelinkModal from "./RelinkModal";
import ContextMenu from "./ContextMenu";

interface Source { name: string; rel: string; type: string; origDir?: string | null; origPath?: string | null; online?: boolean; }
type GroupBy = "folder" | "type";

const TYPE_ICON = {
  video: <Film />,
  audio: <Music />,
  images: <Image />,
};

export default function Sources({
  workspace, onChanged, onCollapse,
}: { workspace: string; onChanged?: () => void; onCollapse?: () => void }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>("folder");
  const [openBins, setOpenBins] = useState<Record<string, boolean>>({});
  const [confirmClear, setConfirmClear] = useState(false);
  const [compact, setCompact] = useState(false);
  const [showRelink, setShowRelink] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; source: Source } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setCompact(entry.contentRect.width < 300);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const refresh = useCallback(async () => {
    // --full: the GUI needs the rich per-clip view (orig folders for the bin).
    const r = await window.jcut.jc("sources-list", ["--workspace", workspace, "--full"]);
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

  const relinkOne = async (s: Source) => {
    const picked = await window.jcut.pickRelink(s.origDir || undefined);
    if (!picked.ok || !picked.path) return;
    await window.jcut.jc("source-relink", ["--workspace", workspace, "--rel", s.rel, "--new-path", picked.path]);
    await refresh(); onChanged?.();
  };

  const clearAll = async () => {
    setBusy(true); setConfirmClear(false);
    await window.jcut.jc("source-clear", ["--workspace", workspace]);
    await refresh(); setBusy(false); onChanged?.();
  };

  const offlineCount = useMemo(() => sources.filter((s) => s.online === false).length, [sources]);

  // Copy footage from a slow drive (SD card / external) to the internal drive so
  // every edit is fast. Sources on /Volumes/ or other external paths are slow.
  const onExternal = useMemo(
    () => sources.some((s) => s.origDir && /^\/Volumes\//.test(s.origDir)),
    [sources],
  );
  const [localizing, setLocalizing] = useState(false);
  const localize = async () => {
    setLocalizing(true);
    await window.jcut.jc("source-localize", ["--workspace", workspace]);
    await refresh(); setLocalizing(false); onChanged?.();
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

  const empty = sources.length === 0;

  return (
    <div ref={panelRef} className="flex flex-col px-4 pt-4 pb-3">
      {/* ── Header ────────────────────────────────────────────────────────
          One clear title zone: collapse-into-rail control on the far left,
          a section title that doubles as the minimize toggle, and a count. */}
      <header className="mb-3 flex items-center gap-2.5">
        {onCollapse && (
          <button
            onClick={onCollapse}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-dim transition-colors hover:bg-surface2 hover:text-ink"
            title="Collapse panel into the rail"
            aria-label="Collapse panel"
          ><ChevronRight size={16} stroke={1.75} /></button>
        )}

        <button
          onClick={() => setCollapsed((c) => !c)}
          className="group flex min-w-0 flex-1 items-center gap-2 text-left"
          title={collapsed ? "Expand sources" : "Minimize sources"}
        >
          <motion.span
            animate={{ rotate: collapsed ? -90 : 0 }}
            transition={spring.snappy}
            className="inline-flex text-dim transition-colors group-hover:text-ink"
          >
            <ChevronDown size={14} stroke={2} />
          </motion.span>
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-dim transition-colors group-hover:text-ink">
            Sources
          </span>
          <span className="rounded-full bg-surface2 px-2 py-px text-[11px] font-medium tabular-nums text-dim">
            {sources.length}
          </span>
        </button>
      </header>

      {/* ── Action bar ────────────────────────────────────────────────────
          Primary "Add footage" is always full-prominence. Secondary actions
          (folder import, clear, copy-to-Mac) read as quieter siblings. The
          row breathes with an 8px gap and consistent 36px-tall targets. */}
      <div className="mb-3 flex w-full items-stretch gap-2">
        <motion.button
          whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.98 }}
          transition={spring.bouncy}
          onClick={addFootage} disabled={busy}
          className="flex h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-[12px] font-semibold text-white shadow-[0_1px_0_rgba(255,255,255,0.12)_inset,0_4px_14px_rgba(0,0,0,0.28)] transition-opacity disabled:opacity-60"
          style={{ background: TEAL_GRADIENT }}
          title="Import individual clips (originals are never moved)"
        >
          <Plus className="h-4 w-4 shrink-0" />
          {!compact && <span className="truncate">{busy ? "Adding…" : "Add footage"}</span>}
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.98 }}
          transition={spring.bouncy}
          onClick={addFolder} disabled={busy}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl depth-chip text-dim transition-colors hover:text-ink disabled:opacity-60"
          title="Import a whole folder of footage"
          aria-label="Import folder"
        >
          <Folder className="h-4 w-4" />
        </motion.button>

        {!collapsed && sources.length > 0 && (
          <motion.button
            whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.98 }}
            transition={spring.bouncy}
            onClick={() => setConfirmClear(true)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl depth-chip text-dim transition-colors hover:bg-red-500/10 hover:text-red-400"
            title="Remove all clips from the queue (originals untouched)"
            aria-label="Clear all sources"
          >
            <Close className="h-3.5 w-3.5" />
          </motion.button>
        )}
      </div>

      {/* Copy-to-Mac advisory — only when footage lives on a slow external drive.
          Gets its own full-width row so the message can actually be read. */}
      <AnimatePresence>
        {!collapsed && onExternal && (
          <motion.button
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            whileTap={{ scale: 0.99 }}
            onClick={localize} disabled={localizing}
            className="mb-3 flex w-full items-center gap-2.5 overflow-hidden rounded-xl px-3 py-2.5 text-left text-[12px] font-medium text-white disabled:opacity-60"
            style={{ background: TEAL_GRADIENT }}
            title="Footage is on an external drive (SD card). Copy it to this Mac so edits are fast."
          >
            <ArrowDown className="h-4 w-4 shrink-0" />
            <span className="truncate">{localizing ? "Copying to Mac…" : "Copy footage to this Mac for faster edits"}</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Clear confirmation */}
      <AnimatePresence>
        {confirmClear && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="mb-3 overflow-hidden rounded-xl bg-red-500/10 px-3.5 py-3 text-[12px] text-ink ring-1 ring-red-500/20"
          >
            <p className="mb-2.5 leading-snug">Remove all {sources.length} clips? Your originals stay exactly where they are.</p>
            <div className="flex items-center gap-2">
              <button onClick={clearAll} className="rounded-lg bg-red-500/90 px-3 py-1.5 font-medium text-white transition-colors hover:bg-red-500">Clear all</button>
              <button onClick={() => setConfirmClear(false)} className="rounded-lg depth-chip px-3 py-1.5 text-dim transition-colors hover:text-ink">Cancel</button>
            </div>
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
            {empty ? (
              <button
                onClick={addFootage}
                className="flex w-full flex-col items-center justify-center gap-3 rounded-xl2 border border-dashed border-line py-10 text-sm text-dim transition-colors hover:border-accent/40 hover:text-ink"
              >
                <Clapper size={32} stroke={1.5} />
                <span className="font-medium">Drop in your footage to get started</span>
              </button>
            ) : (
              <>
                {/* View toggle: a proper segmented control, right-aligned so it
                    doesn't compete with the header for the eye. */}
                <div className="mb-2.5 flex items-center justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-dim">Group by</span>
                  <div className="flex items-center gap-0.5 rounded-lg bg-surface2 p-0.5">
                    {(["folder", "type"] as GroupBy[]).map((g) => (
                      <button
                        key={g}
                        onClick={() => setGroupBy(g)}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${groupBy === g ? "text-white" : "text-dim hover:text-ink"}`}
                        style={groupBy === g ? { background: TEAL_GRADIENT } : undefined}
                      >{g}</button>
                    ))}
                  </div>
                </div>

                {/* Offline banner */}
                <AnimatePresence>
                  {offlineCount > 0 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                      className="mb-2.5 flex items-center gap-2.5 overflow-hidden rounded-xl bg-amber-500/10 px-3 py-2.5 text-[12px] text-amber-400 ring-1 ring-amber-500/15"
                    >
                      <Warning className="h-4 w-4 shrink-0" />
                      <span className="flex-1 leading-snug">{offlineCount} clip{offlineCount > 1 ? "s" : ""} offline</span>
                      <button
                        onClick={() => setShowRelink(true)}
                        className="shrink-0 rounded-lg bg-amber-500/20 px-2.5 py-1 text-[11px] font-semibold text-amber-300 transition-colors hover:bg-amber-500/30"
                      >
                        Relink{offlineCount > 1 ? " all" : ""}
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Bins (scrollable, like a media-pool) */}
                <div className="-mr-1.5 max-h-[36vh] space-y-2 overflow-auto pr-1.5">
                  {bins.map(([key, items]) => (
                    <div key={key} className="overflow-hidden rounded-xl depth-chip">
                      <button
                        onClick={() => toggleBin(key)}
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12px] transition-colors hover:bg-surface"
                      >
                        <motion.span animate={{ rotate: isOpen(key) ? 0 : -90 }} transition={spring.snappy} className="shrink-0 text-dim">
                          <ChevronDown size={13} stroke={2} />
                        </motion.span>
                        <span className="shrink-0 text-dim">
                          {groupBy === "type" ? (TYPE_ICON[key as keyof typeof TYPE_ICON] ?? <File size={15} stroke={1.5} />) : <Folder size={15} stroke={1.5} />}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium capitalize">{key}</span>
                        {items.some((s) => s.online === false) && (
                          <span className="shrink-0 rounded-full bg-amber-500/20 px-1.5 py-px text-[10px] font-medium text-amber-400">
                            {items.filter((s) => s.online === false).length} offline
                          </span>
                        )}
                        <span className="shrink-0 rounded-full bg-surface px-2 py-px text-[10px] font-medium tabular-nums text-dim">{items.length}</span>
                      </button>
                      <AnimatePresence initial={false}>
                        {isOpen(key) && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                            className="space-y-0.5 px-1.5 pb-1.5"
                          >
                            {items.map((s) => {
                              const offline = s.online === false;
                              const icon = offline
                                ? <Warning className="h-4 w-4 text-amber-400" />
                                : (TYPE_ICON[s.type as keyof typeof TYPE_ICON] ?? <File size={15} stroke={1.5} />);
                              return (
                                <div
                                  key={s.rel}
                                  className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors hover:bg-surface ${offline ? "opacity-70" : ""}`}
                                  title={offline ? `Offline — original not found at: ${s.origPath}` : (s.origPath || s.rel)}
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    setContextMenu({ x: e.clientX, y: e.clientY, source: s });
                                  }}
                                >
                                  <span className="shrink-0 text-dim">{icon}</span>
                                  <span className={`min-w-0 flex-1 truncate ${offline ? "italic text-amber-400/80" : ""}`}>{s.name}</span>
                                  {offline && (
                                    <button
                                      onClick={() => relinkOne(s)}
                                      className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-amber-400 opacity-0 transition hover:bg-amber-500/10 group-hover:opacity-100"
                                      title={`Relink to new location (was: ${s.origPath})`}
                                    >
                                      <Link size={12} stroke={1.5} /> Relink
                                    </button>
                                  )}
                                  <button
                                    onClick={() => removeOne(s.rel)}
                                    className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-dim opacity-0 transition hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                                    aria-label={`Remove ${s.name}`}
                                    title="Remove from queue (original untouched)"
                                  ><Close size={13} stroke={2} /></button>
                                </div>
                              );
                            })}
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

      {/* Relink modal */}
      <AnimatePresence>
        {showRelink && (
          <RelinkModal
            workspace={workspace}
            sources={sources}
            onClose={() => setShowRelink(false)}
            onRelinked={() => { refresh(); onChanged?.(); }}
          />
        )}
      </AnimatePresence>

      {/* Right-click context menu */}
      <AnimatePresence>
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            items={[
              ...(contextMenu.source.online === false ? [
                {
                  label: "Relink…",
                  icon: <Link size={14} stroke={1.5} />,
                  onClick: () => relinkOne(contextMenu.source),
                },
                {
                  label: "Relink all offline clips",
                  icon: <Warning size={14} stroke={1.5} />,
                  onClick: () => setShowRelink(true),
                },
                { label: "", separator: true, onClick: () => {} },
              ] : [
                {
                  label: "Show in Finder",
                  icon: <Folder size={14} stroke={1.5} />,
                  onClick: () => window.jcut.reveal(contextMenu.source.origPath || contextMenu.source.rel),
                },
                { label: "", separator: true, onClick: () => {} },
              ]),
              {
                label: "Remove from project",
                icon: <Close size={14} stroke={2} />,
                danger: true,
                onClick: () => removeOne(contextMenu.source.rel),
              },
            ]}
          />
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
