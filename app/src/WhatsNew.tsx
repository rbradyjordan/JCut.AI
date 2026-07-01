// WhatsNew — shown once per version on first launch after an update.
// Dismissed state is persisted via settings (lastSeenVersion).
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { spring, TEAL_GRADIENT } from "./theme";
import { Check, Columns, Scissors, Film, Sparkle } from "./Icons";

export const CURRENT_VERSION = "0.2.0";

interface Change {
  icon: React.ReactNode;
  tag: string;
  tagColor: string;
  title: string;
  body: string;
}

const CHANGES: Change[] = [
  {
    icon: <Columns size={16} stroke={2} />,
    tag: "New",
    tagColor: "#23C6A2",
    title: "CastCut — multi-camera podcast editor",
    body: "Automatic speaker switching, silence removal, and social clip export — fully local, no AI subscription required. Accessible from the new CastCut tab on the launch screen.",
  },
  {
    icon: <Film size={16} stroke={1.5} />,
    tag: "New",
    tagColor: "#2E6BE6",
    title: "Silero VAD speaker detection",
    body: "The multi-camera editor now uses ML-based voice activity detection instead of RMS thresholding. Distinguishes speech from music, noise, and room tone for cleaner cuts.",
  },
  {
    icon: <Scissors size={16} stroke={1.5} />,
    tag: "New",
    tagColor: "#8B5CF6",
    title: "Jump Cut Editor",
    body: "Automatically removes silences from any sequence with configurable dB threshold, pre/post buffers, and dry-run preview. Available in Skills and CastCut.",
  },
  {
    icon: <Sparkle size={16} stroke={1.5} />,
    tag: "Improved",
    tagColor: "#F59E0B",
    title: "Social Clip Creator & auto-reframe",
    body: "Generates vertical, square, and horizontal versions of any sequence in one command. OpenCV face detection biases the crop to keep speakers in frame.",
  },
];

export default function WhatsNew({ onDismiss }: { onDismiss: () => void }) {
  return createPortal(
    <motion.div
      className="fixed inset-0 z-[300] flex items-center justify-center p-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onDismiss} />

      {/* Card */}
      <motion.div
        initial={{ scale: 0.92, y: 24, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.95, y: 12, opacity: 0 }}
        transition={spring.snappy}
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-surface shadow-card"
      >
        {/* Header */}
        <div className="border-b border-white/[0.06] px-6 pt-6 pb-5">
          <div className="mb-1 flex items-center gap-2">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-lg text-white"
              style={{ background: TEAL_GRADIENT }}
            >
              <Sparkle size={14} stroke={2} />
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-widest text-accent">
              Version {CURRENT_VERSION}
            </span>
          </div>
          <h2 className="text-xl font-bold text-ink">What's new in JCut.AI</h2>
          <p className="mt-1 text-sm text-dim">Here's what changed since the last release.</p>
        </div>

        {/* Changes list */}
        <div className="divide-y divide-white/[0.04] px-6 py-2">
          {CHANGES.map((c, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...spring.soft, delay: 0.05 + i * 0.07 }}
              className="flex items-start gap-3.5 py-3.5"
            >
              <div
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white"
                style={{ background: c.tagColor + "28", color: c.tagColor }}
              >
                {c.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{c.title}</span>
                  <span
                    className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white"
                    style={{ background: c.tagColor }}
                  >
                    {c.tag}
                  </span>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-dim">{c.body}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-white/[0.06] px-6 py-4">
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={onDismiss}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white"
            style={{ background: TEAL_GRADIENT }}
          >
            <Check size={14} stroke={2.5} /> Got it
          </motion.button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
