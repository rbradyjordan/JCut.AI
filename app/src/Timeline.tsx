// Live timeline view — springy clip cards laid out on tracks, styled in the
// icon's design language (teal/blue gradient cards on black, rounded, shadowed).
import { motion, AnimatePresence } from "framer-motion";
import { spring, TEAL_GRADIENT, BLUE_GRADIENT } from "./theme";

export interface ClipView {
  id: string;
  track: string;
  start: number;
  dur: number;
  label: string;
}

export interface SeqView {
  name: string;
  settings: string;
  duration: number;
  clips: ClipView[];
}

// Parse the lean `sequence-inspect` output ("cID V1 @0s +4.00s file[0-4] x1").
export function parseInspect(stdout: string): SeqView | null {
  try {
    const j = JSON.parse(stdout);
    if (!j.ok || !Array.isArray(j.clips)) return null;
    const clips: ClipView[] = j.clips.map((line: string) => {
      const m = line.match(/^(\S+)\s+(\S+)\s+@([\d.]+)s\s+\+([\d.]+)s\s+(.+)$/);
      if (!m) return null;
      return { id: m[1], track: m[2], start: +m[3], dur: +m[4], label: m[5] };
    }).filter(Boolean);
    return { name: j.name, settings: j.settings, duration: j.duration_seconds, clips };
  } catch {
    return null;
  }
}

function trackOrder(t: string): number {
  const n = +t.slice(1);
  // Video tracks on top (V3..V1), then audio (A1..A3)
  return t[0] === "V" ? 100 - n : 200 + n;
}

export default function Timeline({ seq }: { seq: SeqView | null }) {
  if (!seq || seq.clips.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-dim text-sm">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring.soft}
        >
          No timeline yet — ask the editor to build one.
        </motion.div>
      </div>
    );
  }

  const tracks = [...new Set(seq.clips.map((c) => c.track))].sort(
    (a, b) => trackOrder(a) - trackOrder(b),
  );
  const total = Math.max(seq.duration, 0.001);

  return (
    <div className="flex h-full flex-col gap-3 p-5">
      <motion.div
        layout
        className="flex items-baseline gap-3"
        transition={spring.soft}
      >
        <span className="text-ink font-semibold">{seq.name}</span>
        <span className="text-dim text-xs">{seq.settings}</span>
        <span className="text-dim text-xs ml-auto">{seq.duration.toFixed(1)}s</span>
      </motion.div>

      {/* Performance: spring-animate clips only for small timelines. Big imported
          timelines (hundreds of clips) render as lightweight static divs — Framer
          layout animation on that many nodes freezes/blanks the renderer. */}
      {seq.clips.length > 80 && (
        <div className="text-[11px] text-dim">{seq.clips.length} clips — showing full timeline</div>
      )}
      <div className="flex flex-1 flex-col gap-2 overflow-auto">
        {tracks.map((track) => {
          const trackClips = seq.clips.filter((c) => c.track === track);
          const animate = seq.clips.length <= 80; // animation budget
          return (
          <div key={track} className="flex items-center gap-3">
            <div className="w-9 shrink-0 text-center text-xs font-medium text-dim">{track}</div>
            <div className="relative h-12 flex-1 rounded-xl bg-surface2/60 ring-1 ring-line">
              {!animate && trackClips.map((c) => {
                const left = (c.start / total) * 100;
                const width = Math.max((c.dur / total) * 100, 0.4);
                const isVideo = track[0] === "V";
                const isOverlay = track !== "V1" && isVideo;
                return (
                  <div
                    key={c.id}
                    className="absolute top-1 bottom-1 overflow-hidden rounded-md"
                    style={{
                      left: `${left}%`, width: `${width}%`,
                      background: isVideo ? (isOverlay ? TEAL_GRADIENT : BLUE_GRADIENT) : "var(--surface-2)",
                      border: isVideo ? "none" : "1px solid var(--border)",
                    }}
                    title={c.label}
                  />
                );
              })}
              {animate && (
              <AnimatePresence>
                {trackClips
                  .map((c) => {
                    const left = (c.start / total) * 100;
                    const width = Math.max((c.dur / total) * 100, 4);
                    const isVideo = track[0] === "V";
                    const isOverlay = track === "V1" ? false : isVideo;
                    return (
                      <motion.div
                        key={c.id}
                        layout
                        initial={{ opacity: 0, scale: 0.8, y: 6 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={spring.bouncy}
                        whileHover={{ scale: 1.04, y: -2 }}
                        className="absolute top-1 bottom-1 cursor-default overflow-hidden rounded-lg px-2 py-1 shadow-card"
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                          background: isVideo
                            ? isOverlay ? TEAL_GRADIENT : BLUE_GRADIENT
                            : "var(--surface-2)",
                          border: isVideo ? "none" : "1px solid var(--border)",
                        }}
                        title={c.label}
                      >
                        <div className="truncate text-[11px] font-medium text-white/95">
                          {c.label.split(" ")[0]}
                        </div>
                      </motion.div>
                    );
                  })}
              </AnimatePresence>
              )}
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}
