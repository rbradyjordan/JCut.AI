// Beautiful custom About screen — opens from JCut.AI → About JCut.AI.
// Design: full-bleed dark modal, large icon with ambient glow, animated
// gradient orbs, brand typography, tech stack chips, action links.
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { spring, TEAL_GRADIENT, BLUE_GRADIENT, BRAND } from "./theme";
import iconUrl from "./assets/icon.png";
import { Close } from "./Icons";

const VERSION = "0.1.0";

export default function About({ onClose }: { onClose: () => void }) {
  return createPortal(
    <motion.div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Card */}
      <motion.div
        initial={{ scale: 0.88, y: 32, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.94, y: 16, opacity: 0 }}
        transition={spring.bouncy}
        className="no-drag relative w-full max-w-md overflow-hidden rounded-[2rem] bg-[#0D0D0F] shadow-[0_40px_120px_rgba(0,0,0,0.8)] ring-1 ring-white/10"
      >
        {/* ── Ambient orbs ─────────────────────────────────────────── */}
        <motion.div
          animate={{ scale: [1, 1.15, 1], opacity: [0.55, 0.7, 0.55] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          className="pointer-events-none absolute -top-24 -left-16 h-72 w-72 rounded-full"
          style={{ background: `radial-gradient(circle, ${BRAND.blueGlow}55 0%, transparent 70%)` }}
        />
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.4, 0.6, 0.4] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: 1.5 }}
          className="pointer-events-none absolute -bottom-20 -right-16 h-64 w-64 rounded-full"
          style={{ background: `radial-gradient(circle, ${BRAND.teal}44 0%, transparent 70%)` }}
        />

        {/* ── Close ──────────────────────────────────────────────────── */}
        <button
          onClick={onClose}
          className="absolute right-5 top-5 z-10 grid h-8 w-8 place-items-center rounded-full bg-white/8 text-white/50 hover:bg-white/15 hover:text-white transition"
          aria-label="Close"
        ><Close size={14} stroke={1.5} /></button>

        {/* ── Content ────────────────────────────────────────────────── */}
        <div className="relative z-10 flex flex-col items-center px-10 pb-10 pt-12 text-center">

          {/* Icon with layered glow rings */}
          <div className="relative mb-7 flex items-center justify-center">
            <motion.div
              animate={{ scale: [1, 1.12, 1], opacity: [0.3, 0.5, 0.3] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="absolute h-40 w-40 rounded-full"
              style={{ background: `radial-gradient(circle, ${BRAND.blueGlow}55 0%, transparent 70%)` }}
            />
            <motion.div
              animate={{ scale: [1, 1.08, 1], opacity: [0.5, 0.75, 0.5] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
              className="absolute h-28 w-28 rounded-full"
              style={{ background: `radial-gradient(circle, ${BRAND.teal}44 0%, transparent 70%)` }}
            />
            <motion.img
              src={iconUrl}
              alt="JCut.AI"
              initial={{ scale: 0.5, rotate: -12, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ ...spring.bouncy, delay: 0.05 }}
              className="relative h-24 w-24 drop-shadow-[0_12px_48px_rgba(35,198,162,0.45)]"
            />
          </div>

          {/* Name */}
          <motion.div
            initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
            transition={{ ...spring.soft, delay: 0.1 }}
          >
            <h1 className="text-[2.4rem] font-bold tracking-tight leading-none">
              JCut
              <span
                className="bg-clip-text text-transparent"
                style={{ backgroundImage: TEAL_GRADIENT }}
              >.AI</span>
            </h1>
          </motion.div>

          {/* Version badge */}
          <motion.div
            initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
            transition={{ ...spring.soft, delay: 0.15 }}
            className="mt-2 flex items-center gap-2"
          >
            <span className="rounded-pill bg-white/8 px-3 py-1 text-[12px] font-medium text-white/60 ring-1 ring-white/10">
              v{VERSION}
            </span>
          </motion.div>

          {/* Tagline */}
          <motion.p
            initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
            transition={{ ...spring.soft, delay: 0.2 }}
            className="mt-4 max-w-xs text-[15px] leading-snug text-white/60"
          >
            An AI video editor that understands your footage and cuts it for you.
          </motion.p>

          {/* Divider */}
          <motion.div
            initial={{ scaleX: 0, opacity: 0 }} animate={{ scaleX: 1, opacity: 1 }}
            transition={{ ...spring.soft, delay: 0.25 }}
            className="my-7 h-px w-full origin-left bg-white/8"
          />

          {/* Tech stack */}
          <motion.div
            initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
            transition={{ ...spring.soft, delay: 0.28 }}
            className="w-full"
          >
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-white/30">
              Powered by
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {[
                { label: "Claude Agent SDK", color: TEAL_GRADIENT },
                { label: "ffmpeg", color: BLUE_GRADIENT },
                { label: "Electron", color: "linear-gradient(135deg,#9feaf9,#47b5e0)" },
                { label: "React", color: "linear-gradient(135deg,#61dafb,#21a1c4)" },
                { label: "Framer Motion", color: "linear-gradient(135deg,#e879f9,#a855f7)" },
              ].map(({ label, color }, i) => (
                <motion.span
                  key={label}
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ ...spring.bouncy, delay: 0.3 + i * 0.05 }}
                  className="rounded-pill px-3 py-1.5 text-[12px] font-semibold text-white shadow-[0_2px_12px_rgba(0,0,0,0.4)]"
                  style={{ background: color }}
                >{label}</motion.span>
              ))}
            </div>
          </motion.div>

          {/* Divider */}
          <motion.div
            initial={{ scaleX: 0, opacity: 0 }} animate={{ scaleX: 1, opacity: 1 }}
            transition={{ ...spring.soft, delay: 0.45 }}
            className="my-7 h-px w-full origin-right bg-white/8"
          />

          <motion.div
            initial={{ y: 6, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
            transition={{ ...spring.soft, delay: 0.46 }}
            className="w-full rounded-2xl bg-white/[0.04] px-4 py-3 text-left ring-1 ring-white/8"
          >
            <p className="text-[11px] font-semibold uppercase tracking-widest text-white/35">
              Open-source acknowledgements
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-white/55">
              JCut.AI includes third-party open-source components, including the
              MIT-licensed Shot Type Classification model used for visual shot
              composition analysis. Repository notices and bundled license files
              should travel with distributions.
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-white/40">
              Important: that upstream model is MIT-licensed, but its README also
              flags possible dataset-related commercial-use restrictions.
            </p>
          </motion.div>

          {/* Links */}
          <motion.div
            initial={{ y: 6, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
            transition={{ ...spring.soft, delay: 0.48 }}
            className="flex gap-3"
          >
            {[
              { label: "Website", href: "https://jcut.ai" },
              { label: "Docs", href: "https://jcut.ai/docs" },
              { label: "Report issue", href: "https://github.com/jcut-ai/jcut/issues" },
            ].map(({ label, href }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="rounded-pill bg-white/8 px-4 py-2 text-[13px] font-medium text-white/70 ring-1 ring-white/10 hover:bg-white/15 hover:text-white transition"
              >{label}</a>
            ))}
          </motion.div>

          {/* Made by */}
          <motion.p
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ delay: 0.55 }}
            className="mt-7 text-[11px] text-white/25"
          >
            Made with ☕ by Brady Jordan · © 2026 JCut.AI
          </motion.p>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
