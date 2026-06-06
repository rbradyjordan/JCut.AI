// Feature tools rail — gives every backend capability a button:
//   • Render final video        (sequence-render-final)
//   • Verification frame preview (sequence-render-frame)
//   • Learn my style            (style-learn)
//   • Memory                    (memory-read)
// Sits above the timeline. Opens springy modals for results.
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { spring, TEAL_GRADIENT } from "./theme";

type Modal = null | "frame" | "render";

export default function Tools({
  workspace, seqId, seqDuration,
}: { workspace: string; seqId: string | null; seqDuration: number }) {
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [payload, setPayload] = useState<any>(null);

  const run = async (which: Modal, fn: () => Promise<any>) => {
    setBusy(which); setPayload(null); setModal(which);
    try { setPayload(await fn()); } finally { setBusy(null); }
  };

  const renderFrame = () => run("frame", async () => {
    if (!seqId) return { error: "No sequence yet." };
    const at = Math.max(0, Math.min(seqDuration / 2, seqDuration - 0.1)).toFixed(2);
    const r = await window.jcut.jc("sequence-render-frame",
      ["--workspace", workspace, "--sequence-id", seqId, "--at", at]);
    if (!r.ok) return { error: r.error };
    const out = JSON.parse(r.stdout).output;
    const img = await window.jcut.readImage(out);
    return { at, output: out, dataUrl: img.dataUrl };
  });

  const renderFinal = () => run("render", async () => {
    if (!seqId) return { error: "No sequence yet." };
    const r = await window.jcut.jc("sequence-render-final",
      ["--workspace", workspace, "--sequence-id", seqId]);
    return r.ok ? JSON.parse(r.stdout) : { error: r.error };
  });

  const btns = [
    { id: "render", label: "Render", icon: "▶", onClick: renderFinal, primary: true },
    { id: "frame", label: "Preview frame", icon: "🖼", onClick: renderFrame, primary: false },
  ];

  return (
    <>
      <div className="flex flex-wrap gap-2 px-5 pt-1">
        {btns.map((b) => (
          <motion.button
            key={b.id}
            whileHover={{ scale: 1.05, y: -1 }} whileTap={{ scale: 0.96 }}
            transition={spring.bouncy}
            onClick={b.onClick}
            disabled={busy !== null}
            className="no-drag flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-sm ring-1 ring-line disabled:opacity-50"
            style={b.primary ? { background: TEAL_GRADIENT, color: "#fff" } : { background: "var(--surface-2)" }}
          >
            <span className="text-xs">{b.icon}</span>
            <span>{busy === b.id ? "Working…" : b.label}</span>
          </motion.button>
        ))}
      </div>

      <AnimatePresence>
        {modal && (
          <ResultModal title={titleFor(modal)} onClose={() => setModal(null)} loading={busy === modal}>
            {modal === "frame" && <FrameResult data={payload} />}
            {modal === "render" && <RenderResult data={payload} />}
          </ResultModal>
        )}
      </AnimatePresence>
    </>
  );
}

function titleFor(m: Modal): string {
  return m === "frame" ? "Verification Frame" : "Final Render";
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
        className="relative max-h-[84vh] w-full max-w-lg overflow-auto rounded-xl2 bg-surface p-6 shadow-card ring-1 ring-line"
      >
        <div className="mb-4 flex items-center">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="ml-auto text-dim hover:text-ink">✕</button>
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

function FrameResult({ data }: { data: any }) {
  if (!data) return null;
  if (data.error) return <p className="text-amber-400">{data.error}</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-dim">Composited frame at {data.at}s.</p>
      {data.dataUrl && (
        <motion.img src={data.dataUrl} initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }} transition={spring.soft}
          className="w-full rounded-xl ring-1 ring-line" />
      )}
      <button onClick={() => window.jcut.reveal(data.output)}
        className="text-sm text-accent underline">Show in Finder</button>
    </div>
  );
}

function RenderResult({ data }: { data: any }) {
  if (!data) return null;
  if (data.error) return <p className="text-amber-400">{data.error}</p>;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-emerald-400">
        <span className="h-2 w-2 rounded-full bg-emerald-400" /> Rendered
      </div>
      <p className="break-all text-sm text-dim">{data.output}</p>
      <button onClick={() => window.jcut.reveal(data.output)}
        className="rounded-pill px-4 py-2 text-sm text-white" style={{ background: TEAL_GRADIENT }}>
        Show in Finder
      </button>
    </div>
  );
}
