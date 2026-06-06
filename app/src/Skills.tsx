// "Skills" chips — quick actions shown above the chat bar under a Skills header.
// These are the lightweight, conversational capabilities (learn style, memory,
// import prproj). Heavier timeline actions (render) stay in the timeline panel.
import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { spring, TEAL_GRADIENT } from "./theme";

type Modal = null | "style" | "memory" | "prproj" | "continue";

export default function Skills({ workspace, onChanged, onImported }: {
  workspace: string;
  onChanged?: () => void;
  onImported?: (a: { name: string; path: string; resolution?: string }) => void;
}) {
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [payload, setPayload] = useState<any>(null);

  const run = async (which: Modal, fn: () => Promise<any>) => {
    setBusy(which); setPayload(null); setModal(which);
    try { setPayload(await fn()); } finally { setBusy(null); }
  };

  const learnStyle = () => run("style", async () => {
    const r = await window.jcut.jc("style-learn", ["--workspace", workspace]);
    return r.ok ? JSON.parse(r.stdout) : { error: r.error };
  });
  const showMemory = () => run("memory", async () => {
    const r = await window.jcut.jc("memory-read", ["--workspace", workspace]);
    return r.ok ? JSON.parse(r.stdout) : { error: r.error };
  });
  // Analyze a Premiere project for its style (read-only).
  const importPrproj = () => run("prproj", async () => {
    const picked = await window.jcut.pickPrproj();
    if (!picked.ok || !picked.path) return { error: "No project selected." };
    const r = await window.jcut.jc("prproj-analyze", ["--workspace", workspace, "--file", picked.path]);
    return r.ok ? JSON.parse(r.stdout) : { error: r.error };
  });

  // Import a Premiere timeline as an EDITABLE sequence to modify and continue.
  const continueTimeline = () => run("continue", async () => {
    const picked = await window.jcut.pickPrproj();
    if (!picked.ok || !picked.path) return { error: "No project selected." };
    const r = await window.jcut.jc("sequence-import-prproj", ["--workspace", workspace, "--file", picked.path]);
    const res = r.ok ? JSON.parse(r.stdout) : { error: r.error };
    onChanged?.();
    // Surface the loaded project as a chat-bar attachment chip.
    if (r.ok && res.name) {
      onImported?.({ name: res.name, path: picked.path, resolution: res.resolution });
    }
    return res;
  });

  const chips = [
    { id: "style", icon: "✨", label: "Learn my style", onClick: learnStyle },
    { id: "memory", icon: "🧠", label: "Memory", onClick: showMemory },
    { id: "continue", icon: "↪", label: "Continue a timeline", onClick: continueTimeline },
    { id: "prproj", icon: "🎬", label: "Analyze a project", onClick: importPrproj },
  ];

  return (
    <>
      <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-dim">Skills</div>
      <div className="mb-2 flex flex-wrap gap-2">
        {chips.map((c) => (
          <motion.button
            key={c.id}
            whileHover={{ scale: 1.05, y: -1 }} whileTap={{ scale: 0.96 }} transition={spring.bouncy}
            onClick={c.onClick} disabled={busy !== null}
            className="no-drag flex items-center gap-1.5 rounded-pill bg-surface2 px-3 py-1.5 text-sm text-ink ring-1 ring-line disabled:opacity-50"
          >
            <span className="text-xs">{c.icon}</span>
            <span>{busy === c.id ? "Working…" : c.label}</span>
          </motion.button>
        ))}
      </div>

      <AnimatePresence>
        {modal && (
          <Modal title={titleFor(modal)} onClose={() => setModal(null)} loading={busy === modal}>
            {modal === "style" && <StyleResult data={payload} />}
            {modal === "memory" && <MemoryResult data={payload} />}
            {modal === "prproj" && <PrprojResult data={payload} />}
            {modal === "continue" && <ContinueResult data={payload} />}
          </Modal>
        )}
      </AnimatePresence>
    </>
  );
}

function titleFor(m: Modal) {
  return m === "style" ? "Learned Style" : m === "memory" ? "Workspace Memory"
    : m === "continue" ? "Timeline Imported" : "Imported Premiere Project";
}

function ContinueResult({ data }: { data: any }) {
  if (!data) return null;
  if (data.error) return <p className="text-amber-400">{data.error}</p>;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-emerald-400">
        <span className="h-2 w-2 rounded-full bg-emerald-400" /> Imported as an editable timeline
      </div>
      <p className="text-sm">
        <b>{data.name}</b> — {data.imported_clips} of {data.total_found} clips.
      </p>
      {data.unresolved_sources?.length > 0 && (
        <p className="text-xs text-amber-400">
          {data.unresolved_sources.length} source(s) are offline (on an external drive). Reconnect the
          drive and the footage will relink. The timeline structure is preserved.
        </p>
      )}
      <p className="text-sm text-dim">{data.note || "Open it and tell JCut how to continue."}</p>
    </div>
  );
}

function Modal({ title, onClose, loading, children }: {
  title: string; onClose: () => void; loading: boolean; children: React.ReactNode;
}) {
  // Portal to <body> so the overlay escapes the editor's stacking contexts
  // (the right Sources/Timeline panel uses backdrop-blur + transforms, which
  // would otherwise paint over this dialog and swallow its clicks).
  return createPortal(
    <motion.div className="fixed inset-0 z-[100] flex items-center justify-center p-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.92, y: 24, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.95, y: 12, opacity: 0 }} transition={spring.snappy}
        className="relative max-h-[84vh] w-full max-w-lg overflow-auto rounded-xl2 bg-surface p-6 shadow-card ring-1 ring-line">
        <div className="mb-4 flex items-center">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="ml-auto text-dim hover:text-ink">✕</button>
        </div>
        {loading ? <Spinner /> : children}
      </motion.div>
    </motion.div>,
    document.body,
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

function ErrOrEmpty({ data, empty }: { data: any; empty: string }) {
  if (data?.error) return <p className="text-amber-400">{data.error}</p>;
  return <p className="text-dim">{empty}</p>;
}

function StyleResult({ data }: { data: any }) {
  if (!data) return null;
  const p = data.profile;
  if (!p) return <ErrOrEmpty data={data} empty="No sequences to learn from yet — build a cut first." />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-dim">Learned from {data.learned_from?.join(", ") || "your edits"}.</p>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Pace" value={`${p.typical_cuts_per_minute}/min`} />
        <Stat label="Typical shot" value={`${p.typical_shot_seconds}s`} />
        <Stat label="Fast cut" value={`${p.fast_cut_seconds}s`} />
        <Stat label="B-roll overlay" value={`${Math.round(p.typical_broll_overlay_ratio * 100)}%`} />
      </div>
      <ul className="space-y-1 text-sm">
        {p.notes?.map((n: string, i: number) => <li key={i}>• {n}</li>)}
      </ul>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface2 p-3 ring-1 ring-line">
      <div className="text-xs text-dim">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
function MemoryResult({ data }: { data: any }) {
  if (!data) return null;
  const text: string = data.memory || "";
  if (data.error || !text.trim())
    return <ErrOrEmpty data={data} empty="No memory yet — the editor records findings as it works." />;
  return <pre className="whitespace-pre-wrap rounded-xl bg-surface2 p-4 text-sm leading-relaxed ring-1 ring-line">{text}</pre>;
}
function PrprojResult({ data }: { data: any }) {
  if (!data) return null;
  if (data.error) return <p className="text-amber-400">{data.error}</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-dim">{data.summary || "Analyzed."}</p>
      {data.profile?.notes && (
        <ul className="space-y-1 text-sm">{data.profile.notes.map((n: string, i: number) => <li key={i}>• {n}</li>)}</ul>
      )}
    </div>
  );
}
