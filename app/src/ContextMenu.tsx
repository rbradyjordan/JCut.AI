// Generic floating context menu — renders at a fixed viewport position.
// Usage: <ContextMenu x={px} y={py} items={[...]} onClose={() => setMenu(null)} />
import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { spring } from "./theme";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

export default function ContextMenu({
  x, y, items, onClose,
}: {
  x: number; y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on click-outside or Escape.
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [onClose]);

  // Clamp so the menu never bleeds off-screen.
  const menuW = 200;
  const menuH = items.length * 34;
  const cx = Math.min(x, window.innerWidth  - menuW - 8);
  const cy = Math.min(y, window.innerHeight - menuH - 8);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.95, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -4 }}
      transition={spring.snappy}
      className="fixed z-[200] min-w-[180px] overflow-hidden rounded-xl depth-card shadow-card ring-1 ring-line"
      style={{ left: cx, top: cy }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="my-1 h-px bg-line" />
        ) : (
          <button
            key={i}
            disabled={item.disabled}
            onClick={() => { item.onClick(); onClose(); }}
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors disabled:opacity-40 ${
              item.danger
                ? "text-red-400 hover:bg-red-500/10"
                : "text-ink hover:bg-surface2"
            }`}
          >
            {item.icon && <span className="shrink-0 text-dim">{item.icon}</span>}
            {item.label}
          </button>
        )
      )}
    </motion.div>
  );
}
