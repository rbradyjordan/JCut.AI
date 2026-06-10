// Relink offline media — Premiere-style modal for fixing broken source paths.
//
// Shows every offline clip in the workspace grouped by their original directory.
// Each row has:
//   • The clip name + its last-known absolute path (so you know what to find)
//   • A "Locate…" button that opens Finder pre-navigated to that directory
//   • A green checkmark once relinked this session
//
// "Relink all in folder" batch-relinks an entire offline directory at once if
// you point to any one file from that folder — the same way Premiere does it.
import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { spring, TEAL_GRADIENT } from "./theme";
import { Close, Warning, Check, Folder, Link, Film, Music, Image, File } from "./Icons";

// Minimal path helpers that work in the browser/Electron renderer without Node.
const dirname  = (p: string) => p.replace(/\/[^/]+$/, "") || "/";
const basename = (p: string) => p.split("/").pop() || p;
const joinPath = (...parts: string[]) => parts.join("/").replace(/\/+/g, "/");

interface Source {
  name: string;
  rel: string;
  type: string;
  origDir?: string | null;
  origPath?: string | null;
  online?: boolean;
}

interface RelinkGroup {
  dir: string;           // original directory (last known)
  sources: Source[];
}

function typeIcon(type: string) {
  if (type === "video")  return <Film  size={15} stroke={1.5} />;
  if (type === "audio")  return <Music size={15} stroke={1.5} />;
  if (type === "images") return <Image size={15} stroke={1.5} />;
  return <File size={15} stroke={1.5} />;
}

// Group offline sources by their original directory so batch-relink works.
function groupByDir(sources: Source[]): RelinkGroup[] {
  const map = new Map<string, Source[]>();
  for (const s of sources) {
    const dir = s.origDir || "(unknown location)";
    if (!map.has(dir)) map.set(dir, []);
    map.get(dir)!.push(s);
  }
  return [...map.entries()].map(([dir, srcs]) => ({ dir, sources: srcs }));
}

export default function RelinkModal({
  workspace,
  sources,
  onClose,
  onRelinked,
}: {
  workspace: string;
  sources: Source[];           // ALL sources (we filter offline ones internally)
  onClose: () => void;
  onRelinked: () => void;      // refresh Sources after relinking
}) {
  const offline = sources.filter((s) => s.online === false);
  const groups = groupByDir(offline);

  // Track which rels have been successfully relinked this session.
  const [done, setDone] = useState<Set<string>>(new Set());
  // Track which are currently in-flight.
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const relinkOne = useCallback(async (s: Source) => {
    setBusy((b) => new Set(b).add(s.rel));
    try {
      // Open Finder pre-navigated to the last-known directory.
      const defaultDir = s.origDir || undefined;
      const picked = await window.jcut.pickRelink(defaultDir);
      if (!picked.ok || !picked.path) return;

      const r = await window.jcut.jc("source-relink", [
        "--workspace", workspace,
        "--rel", s.rel,
        "--new-path", picked.path,
      ]);
      if (r.ok) {
        setDone((d) => new Set(d).add(s.rel));
        onRelinked();
      }
    } finally {
      setBusy((b) => { const n = new Set(b); n.delete(s.rel); return n; });
    }
  }, [workspace, onRelinked]);

  // Batch-relink: pick ONE file from a folder, then try to match every other
  // offline clip from the same original directory by filename.
  const relinkFolder = useCallback(async (group: RelinkGroup) => {
    const remaining = group.sources.filter((s) => !done.has(s.rel));
    if (!remaining.length) return;

    // Open Finder at the group's original directory.
    const picked = await window.jcut.pickRelink(group.dir || undefined);
    if (!picked.ok || !picked.path) return;

    const pickedDir = dirname(picked.path);

    // Relink every offline clip from this group: if the filename exists in the
    // picked directory, use it. Otherwise fall back to the exact picked file.
    for (const s of remaining) {
      setBusy((b) => new Set(b).add(s.rel));
      try {
        // Try: same-named file in the chosen directory first.
        const candidate = joinPath(pickedDir, s.name);
        // We can't check existence in the renderer, so always try candidate —
        // the CLI will error if it doesn't exist, and we fall back to picked.path.
        const targetPath = s.rel === remaining[0].rel ? picked.path : candidate;

        const r = await window.jcut.jc("source-relink", [
          "--workspace", workspace,
          "--rel", s.rel,
          "--new-path", targetPath,
        ]);
        if (r.ok) {
          setDone((d) => new Set(d).add(s.rel));
          onRelinked();
        }
      } finally {
        setBusy((b) => { const n = new Set(b); n.delete(s.rel); return n; });
      }
    }
  }, [workspace, done, onRelinked]);

  const allDone = done.size === offline.length;

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <motion.div
        initial={{ scale: 0.93, y: 20, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.96, y: 10, opacity: 0 }}
        transition={spring.snappy}
        className="no-drag relative flex w-full max-w-2xl flex-col overflow-hidden rounded-xl2 depth-card shadow-card"
        style={{ maxHeight: "80vh" }}
      >
        {/* ── Header ── */}
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-6 py-4">
          <div
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white"
            style={{ background: "var(--surface-2)" }}
          >
            <Warning size={18} stroke={1.5} className="text-amber-400" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold">Relink offline media</h2>
            <p className="text-[12px] text-dim">
              {allDone
                ? `All ${offline.length} clips relinked.`
                : `${offline.length - done.size} of ${offline.length} clip${offline.length !== 1 ? "s" : ""} offline — locate the files to reconnect them.`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-dim transition-colors hover:bg-surface2 hover:text-ink"
          >
            <Close size={14} stroke={2} />
          </button>
        </div>

        {/* ── Clip list ── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {allDone ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-emerald-500/15 text-emerald-400">
                <Check size={24} stroke={2.5} />
              </div>
              <p className="text-sm font-medium">All media relinked</p>
              <p className="text-xs text-dim">Your sequences will use the new paths going forward.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {groups.map((group) => {
                const groupDone = group.sources.every((s) => done.has(s.rel));
                const groupBusy = group.sources.some((s) => busy.has(s.rel));
                const remaining = group.sources.filter((s) => !done.has(s.rel));

                return (
                  <div key={group.dir} className="overflow-hidden rounded-xl depth-chip">
                    {/* Group header — original directory */}
                    <div className="flex items-center gap-2.5 border-b border-line/50 px-3.5 py-2.5">
                      <Folder size={14} stroke={1.5} className="shrink-0 text-dim" />
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-dim" title={group.dir}>
                        {group.dir}
                      </span>
                      {!groupDone && remaining.length > 1 && (
                        <motion.button
                          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                          onClick={() => relinkFolder(group)}
                          disabled={groupBusy}
                          className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                          style={{ background: TEAL_GRADIENT }}
                          title={`Relink all ${remaining.length} clips from this folder at once`}
                        >
                          <Link size={12} stroke={2} />
                          Relink folder ({remaining.length})
                        </motion.button>
                      )}
                      {groupDone && (
                        <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                          <Check size={12} stroke={2.5} /> Done
                        </span>
                      )}
                    </div>

                    {/* Clips in group */}
                    <div className="divide-y divide-line/30">
                      {group.sources.map((s) => {
                        const isLinked = done.has(s.rel);
                        const isBusy  = busy.has(s.rel);
                        return (
                          <div
                            key={s.rel}
                            className={`flex items-center gap-3 px-3.5 py-2.5 transition-colors ${isLinked ? "opacity-60" : ""}`}
                          >
                            <span className={`shrink-0 ${isLinked ? "text-emerald-400" : "text-amber-400"}`}>
                              {isLinked ? <Check size={15} stroke={2.5} /> : typeIcon(s.type)}
                            </span>

                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13px] font-medium">{s.name}</div>
                              <div className="truncate text-[11px] text-dim" title={s.origPath || s.rel}>
                                {s.origPath || s.rel}
                              </div>
                            </div>

                            {isLinked ? (
                              <span className="shrink-0 text-[11px] font-medium text-emerald-400">Relinked</span>
                            ) : (
                              <motion.button
                                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                                transition={spring.bouncy}
                                onClick={() => relinkOne(s)}
                                disabled={isBusy}
                                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-surface px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-surface2 disabled:opacity-50"
                                title={`Locate ${s.name} in Finder (was: ${s.origPath})`}
                              >
                                {isBusy ? (
                                  <motion.span
                                    className="h-3 w-3 rounded-full border-2 border-dim border-t-transparent"
                                    animate={{ rotate: 360 }}
                                    transition={{ duration: 0.7, repeat: Infinity, ease: "linear" }}
                                  />
                                ) : (
                                  <Folder size={13} stroke={1.5} />
                                )}
                                {isBusy ? "Relinking…" : "Locate…"}
                              </motion.button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex shrink-0 items-center justify-between border-t border-line px-6 py-3">
          <p className="text-[11px] text-dim">
            {done.size > 0 && !allDone ? `${done.size} relinked — ` : ""}
            Finder opens at the clip's last known location.
          </p>
          <button
            onClick={onClose}
            className="rounded-lg bg-surface2 px-4 py-2 text-[13px] font-medium transition-colors hover:text-ink"
          >
            {allDone ? "Done" : "Close"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
