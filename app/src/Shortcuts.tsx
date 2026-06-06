// Keyboard shortcuts overlay — opened from Help ▸ Keyboard Shortcuts (⌘/).
// A springy pop-up modal matching the app's design language.
import { motion } from "framer-motion";
import { spring } from "./theme";

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: "General",
    items: [
      ["⌘ ,", "Open Settings"],
      ["⌘ /", "Keyboard shortcuts"],
      ["⌘ N", "New window"],
      ["⌘ T", "New chat"],
    ],
  },
  {
    title: "Projects & Files",
    items: [
      ["⌘ ⇧ N", "New project"],
      ["⌘ O", "Add footage"],
      ["⌘ I", "Import timeline"],
      ["⌘ ⇧ P", "Back to projects"],
    ],
  },
  {
    title: "View",
    items: [
      ["⌘ B", "Toggle sidebar"],
      ["⌃ ⌘ F", "Toggle fullscreen"],
      ["⌘ + / −", "Zoom in / out"],
    ],
  },
];

export default function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-center justify-center p-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.92, y: 24, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.95, y: 12, opacity: 0 }} transition={spring.snappy}
        className="relative w-full max-w-lg rounded-xl2 bg-surface p-6 shadow-card ring-1 ring-line"
      >
        <div className="mb-4 flex items-center">
          <h2 className="text-lg font-semibold">Keyboard Shortcuts</h2>
          <button onClick={onClose} className="ml-auto text-dim hover:text-ink">✕</button>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-dim">{g.title}</div>
              <div className="space-y-1.5">
                {g.items.map(([keys, label]) => (
                  <div key={label} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-ink">{label}</span>
                    <kbd className="rounded-md bg-surface2 px-2 py-0.5 font-mono text-[12px] text-dim ring-1 ring-line">{keys}</kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
