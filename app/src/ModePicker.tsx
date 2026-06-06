// Mode picker — a compact dropdown in the chrome bar to choose the active editing
// mode (recap, montage, talking-head, ad) or a user preset. The choice is applied
// to every agent run. "Freeform" = no mode.
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { spring, TEAL_GRADIENT } from "./theme";

interface ModeItem { id: string; name: string; description: string; }

export default function ModePicker({
  value, onChange, onManagePresets,
}: { value: string | null; onChange: (id: string | null) => void; onManagePresets: () => void }) {
  const [open, setOpen] = useState(false);
  const [modes, setModes] = useState<ModeItem[]>([]);
  const [presets, setPresets] = useState<ModeItem[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = async () => {
    const r = await window.jcut.jc("modes-list", []);
    if (r.ok) { try { const j = JSON.parse(r.stdout); setModes(j.modes || []); setPresets(j.presets || []); } catch { /* */ } }
  };
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const active = [...modes, ...presets].find((m) => m.id === value);
  const label = active?.name || "Freeform";

  const pick = (id: string | null) => { onChange(id); setOpen(false); };

  return (
    <div ref={ref} className="relative">
      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={() => { setOpen((o) => !o); refresh(); }}
        className="flex items-center gap-1.5 rounded-pill bg-surface2 px-3 py-1 text-[12px] text-ink ring-1 ring-line"
      >
        <span className="text-dim">Mode:</span>
        <span className="font-medium">{label}</span>
        <span className="text-dim">▾</span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }} transition={spring.snappy}
            className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl2 bg-surface p-1.5 shadow-card ring-1 ring-line"
          >
            <Item label="Freeform" desc="No mode — edit as asked" active={!value} onClick={() => pick(null)} />
            <div className="my-1 px-2 text-[10px] font-semibold uppercase tracking-wide text-dim">Modes</div>
            {modes.map((m) => (
              <Item key={m.id} label={m.name} desc={m.description} active={value === m.id} onClick={() => pick(m.id)} />
            ))}
            {presets.length > 0 && (
              <>
                <div className="my-1 px-2 text-[10px] font-semibold uppercase tracking-wide text-dim">My presets</div>
                {presets.map((m) => (
                  <Item key={m.id} label={m.name} desc={m.description} active={value === m.id} onClick={() => pick(m.id)} />
                ))}
              </>
            )}
            <button
              onClick={() => { setOpen(false); onManagePresets(); }}
              className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-[12px] text-accent hover:bg-surface2"
            >＋ Create / manage presets…</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Item({ label, desc, active, onClick }: { label: string; desc: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full flex-col rounded-lg px-2 py-1.5 text-left hover:bg-surface2"
      style={active ? { background: TEAL_GRADIENT } : undefined}
    >
      <span className={`text-[13px] font-medium ${active ? "text-white" : "text-ink"}`}>{label}</span>
      <span className={`text-[11px] ${active ? "text-white/80" : "text-dim"}`}>{desc}</span>
    </button>
  );
}
