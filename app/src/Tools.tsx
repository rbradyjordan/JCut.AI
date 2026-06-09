// Feature tools rail. JCut does NOT render video — the deliverable is a Premiere
// .prproj. The primary action exports the current sequence and prompts the user
// (Finder save dialog) for where to put the .prproj.
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { spring, TEAL_GRADIENT } from "./theme";
import { Play, Close } from "./Icons";

type Modal = null | "export";

export default function Tools({
  workspace, seqId, seqDuration,
}: { workspace: string; seqId: string | null; seqDuration: number }) {
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [payload, setPayload] = useState<any>(null);
  const [compact, setCompact] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setCompact(entry.contentRect.width < 260);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const run = async (which: Modal, fn: () => Promise<any>) => {
    setBusy(which); setPayload(null); setModal(which);
    try { setPayload(await fn()); } finally { setBusy(null); }
  };

  // Export to Premiere — ask the user WHERE to save the .prproj via a Finder
  // dialog, then export to that exact path.
  const exportPremiere = () => run("export", async () => {
    if (!seqId) return { error: "No sequence yet — build a timeline first." };
    const picked = await window.jcut.pickSavePrproj(workspace);
    if (!picked.ok || !picked.path) return { cancelled: true };
    const r = await window.jcut.jc("sequence-export-premiere",
      ["--workspace", workspace, "--sequence-id", seqId, "--output", picked.path]);
    if (!r.ok) return { error: r.error };
    try { return JSON.parse(r.stdout); } catch { return { output: picked.path }; }
  });

  const btns = [
    { id: "export", label: "Export to Premiere", icon: <Play size={12} stroke={1.5} />, onClick: exportPremiere, primary: true },
  ];

  return (
    <>
      <div ref={rowRef} className="flex w-full gap-2 border-t border-line px-4 pb-4 pt-3">
        {btns.map((b) => (
          <motion.button
            key={b.id}
            whileHover={{ scale: 1.015, y: -1 }} whileTap={{ scale: 0.98 }}
            transition={spring.bouncy}
            onClick={b.onClick}
            disabled={busy !== null}
            className="no-drag flex h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-[12px] font-semibold shadow-[0_1px_0_rgba(255,255,255,0.10)_inset,0_4px_14px_rgba(0,0,0,0.28)] transition-opacity disabled:opacity-50"
            style={b.primary ? { background: TEAL_GRADIENT, color: "#fff" } : { background: "var(--surface-2)" }}
            title={b.label}
          >
            <span className="shrink-0">{b.icon}</span>
            {!compact && <span className="truncate">{busy === b.id ? "Working…" : b.label}</span>}
          </motion.button>
        ))}
      </div>

      <AnimatePresence>
        {modal && (
          <ResultModal title="Export to Premiere" onClose={() => setModal(null)} loading={busy === modal}>
            <ExportResult data={payload} onClose={() => setModal(null)} />
          </ResultModal>
        )}
      </AnimatePresence>
    </>
  );
}

function ResultModal({
  title, onClose, loading, children,
}: { title: string; onClose: () => void; loading: boolean; children: React.ReactNode }) {
  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.92, y: 24, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.95, y: 12, opacity: 0 }} transition={spring.snappy}
        className="relative max-h-[84vh] w-full max-w-lg overflow-auto rounded-xl2 depth-card p-6 shadow-card shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]"
      >
        <div className="mb-4 flex items-center">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="ml-auto text-dim hover:text-ink"><Close size={14} stroke={1.5} /></button>
        </div>
        {loading ? <Spinner /> : children}
      </motion.div>
    </motion.div>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <motion.div className="h-8 w-8 rounded-full border-2 border-dim border-t-transparent"
        animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }} />
    </div>
  );
}

function ExportResult({ data, onClose }: { data: any; onClose: () => void }) {
  if (!data) return null;
  if (data.cancelled) { onClose(); return null; } // user dismissed the save dialog
  if (data.error) return <p className="text-amber-400">{data.error}</p>;
  const warnings: string[] = Array.isArray(data.warnings) ? data.warnings : [];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-emerald-400">
        <span className="h-2 w-2 rounded-full bg-emerald-400" /> Exported
        {typeof data.clips === "number" && <span className="text-dim text-sm">· {data.clips} clips</span>}
      </div>
      <p className="break-all text-sm text-dim">{data.output}</p>
      {warnings.length > 0 && (
        <div className="rounded-lg bg-amber-500/10 p-3 text-[12px] text-amber-300">
          {warnings.slice(0, 3).map((w, i) => <p key={i} className="mb-1 last:mb-0">{w}</p>)}
        </div>
      )}
      <button onClick={() => window.jcut.reveal(data.output)}
        className="rounded-pill px-4 py-2 text-sm text-white" style={{ background: TEAL_GRADIENT }}>
        Show in Finder
      </button>
    </div>
  );
}
