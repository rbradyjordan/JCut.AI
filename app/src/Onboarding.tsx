// First-run onboarding — welcome + pick your AI brain. Springy, on-brand,
// intentionally short. Deeper setup (LM Studio server, Claude re-check) lives
// in Settings; here we just get the user to a working choice fast.
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { spring, TEAL_GRADIENT, BLUE_GRADIENT } from "./theme";
import type { Backend } from "./jcut";
import iconUrl from "./assets/icon.png";

export default function Onboarding({ onDone }: { onDone: (backend: Backend) => void }) {
  const [step, setStep] = useState(0);
  const [backend, setBackend] = useState<Backend>("claude");

  return (
    <div className="grain relative flex h-full items-center justify-center">
      <div className="backdrop" />
      <AnimatePresence mode="wait">
        {step === 0 && (
          <motion.div
            key="welcome"
            initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, y: -16 }} transition={spring.soft}
            className="relative z-10 flex flex-col items-center text-center"
          >
            <motion.img
              src={iconUrl} alt="JCut.AI"
              initial={{ scale: 0.4, rotate: -12, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={spring.bouncy}
              className="h-28 w-28 drop-shadow-[0_12px_60px_rgba(46,107,230,0.4)]"
            />
            <motion.h1
              initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
              transition={{ ...spring.soft, delay: 0.08 }}
              className="mt-6 text-4xl font-semibold tracking-tight"
            >
              JCut<span className="text-dim">.AI</span>
            </motion.h1>
            <motion.p
              initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
              transition={{ ...spring.soft, delay: 0.14 }}
              className="mt-2 max-w-sm text-dim"
            >
              An AI video editor that understands your footage and cuts it for you.
            </motion.p>
            <motion.button
              initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
              transition={{ ...spring.soft, delay: 0.2 }}
              whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.96 }}
              onClick={() => setStep(1)}
              className="mt-8 rounded-pill px-8 py-3 font-medium text-white shadow-glow"
              style={{ background: TEAL_GRADIENT }}
            >
              Get started
            </motion.button>
          </motion.div>
        )}

        {step === 1 && (
          <motion.div
            key="brain"
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }} transition={spring.soft}
            className="relative z-10 w-full max-w-2xl px-8 text-center"
          >
            <h2 className="text-2xl font-semibold tracking-tight">Pick your AI brain</h2>
            <p className="mt-2 text-dim">You can change this anytime in Settings.</p>

            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <BrainCard
                active={backend === "claude"}
                onClick={() => setBackend("claude")}
                gradient={TEAL_GRADIENT}
                title="Claude"
                subtitle="Your Max subscription"
                bullets={["Most capable", "No API key needed", "Rides your existing login"]}
              />
              <BrainCard
                active={backend === "local"}
                onClick={() => setBackend("local")}
                gradient={BLUE_GRADIENT}
                title="Local (LM Studio)"
                subtitle="Runs on your machine"
                bullets={["Private & offline", "Free to run", "Bring your own model"]}
              />
            </div>

            <motion.button
              whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
              onClick={() => onDone(backend)}
              className="mt-8 rounded-pill px-8 py-3 font-medium text-white shadow-glow"
              style={{ background: TEAL_GRADIENT }}
            >
              Start editing
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BrainCard({
  active, onClick, gradient, title, subtitle, bullets,
}: {
  active: boolean; onClick: () => void; gradient: string;
  title: string; subtitle: string; bullets: string[];
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.03, y: -3 }} whileTap={{ scale: 0.98 }}
      transition={spring.bouncy}
      onClick={onClick}
      className="relative overflow-hidden rounded-xl2 p-5 text-left ring-1 ring-line"
      style={{ background: "var(--surface)" }}
    >
      {active && (
        <motion.div
          layoutId="brain-active"
          className="absolute inset-0 opacity-100"
          style={{ background: gradient }}
          transition={spring.snappy}
        />
      )}
      <div className="relative z-10">
        <div className={`text-lg font-semibold ${active ? "text-white" : "text-ink"}`}>{title}</div>
        <div className={`text-sm ${active ? "text-white/80" : "text-dim"}`}>{subtitle}</div>
        <ul className={`mt-3 space-y-1 text-sm ${active ? "text-white/90" : "text-dim"}`}>
          {bullets.map((b) => <li key={b}>• {b}</li>)}
        </ul>
      </div>
    </motion.button>
  );
}
