// Binding Terms & Conditions gate.
//
// Shown full-screen AFTER onboarding completes, before the user can reach the
// app, whenever `termsAccepted` is false. Acceptance is required and explicit:
// the user must scroll through the full document AND tick the consent checkbox
// before "Agree & continue" enables. The accepted state is persisted, so this
// only appears once (or again if the terms version changes).
//
// The actual terms text lives in Onboarding (TERMS_SECTIONS / TERMS_EFFECTIVE)
// so the in-onboarding preview and this binding gate never drift apart.
import { useState, useRef, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { spring, TEAL_GRADIENT } from "./theme";
import { Check, ChevronRight, Shield } from "./Icons";
import { TERMS_SECTIONS, TERMS_EFFECTIVE } from "./Onboarding";
import iconUrl from "./assets/icon.png";

export default function TermsGate({ onAccept }: { onAccept: () => void }) {
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 28;
    if (atEnd) setScrolledToEnd(true);
    const top = el.scrollTop > 4 ? 28 : 0;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight > 4 ? 28 : 0;
    el.style.setProperty("--fade-top", `${top}px`);
    el.style.setProperty("--fade-bottom", `${bottom}px`);
  }, []);

  // If the whole document fits without scrolling, there's nothing to scroll to —
  // treat it as read so the user isn't stuck.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight + 4) setScrolledToEnd(true);
    onScroll();
  }, [onScroll]);

  const canAccept = scrolledToEnd && agreed;

  return (
    <div className="grain relative flex h-full flex-col items-center overflow-hidden">
      <div className="backdrop" />
      <div className="titlebar-grad drag absolute inset-x-0 top-0 z-30 h-9" />

      <div className="relative z-10 flex h-full w-full max-w-2xl flex-col items-center px-6 pb-8 pt-20 text-center sm:px-8">
        {/* Header */}
        <div className="flex w-full shrink-0 flex-col items-center">
          <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl text-white shadow-glow" style={{ background: TEAL_GRADIENT }}>
            <Shield size={24} stroke={1.5} />
          </div>
          <div className="flex items-center gap-2">
            <img src={iconUrl} className="h-5 w-5" alt="" />
            <h1 className="text-2xl font-semibold tracking-tight">Terms &amp; Conditions</h1>
          </div>
          <p className="mt-2 max-w-md text-sm text-dim">
            Before you start editing, please read and accept the terms. This agreement is
            binding — scroll to the end and tick the box to continue.
          </p>
        </div>

        {/* Scrollable, flex-filling document with fade edges */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="onb-scroll my-4 min-h-0 w-full flex-1 rounded-xl2 bg-surface/60 p-5 text-left ring-1 ring-line"
        >
          <div className="space-y-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-dim">{TERMS_EFFECTIVE}</div>
            {TERMS_SECTIONS.map((s) => (
              <div key={s.heading}>
                <div className="text-sm font-semibold text-ink">{s.heading}</div>
                <p className="mt-1 text-[13px] leading-relaxed text-dim">{s.body}</p>
              </div>
            ))}
            <p className="border-t border-line pt-4 text-[12px] italic text-dim">
              End of terms. Tick the box below to accept.
            </p>
          </div>
        </div>

        {/* Footer: consent checkbox + accept button */}
        <div className="flex w-full shrink-0 flex-col items-center gap-3">
          <button
            onClick={() => scrolledToEnd && setAgreed((v) => !v)}
            disabled={!scrolledToEnd}
            className={`flex w-full max-w-md items-start gap-3 rounded-xl px-4 py-3 text-left ring-1 transition ${
              agreed ? "bg-accent/10 ring-accent/40" : "bg-surface/60 ring-line"
            } ${scrolledToEnd ? "" : "cursor-not-allowed opacity-50"}`}
          >
            <span
              className={`mt-px grid h-5 w-5 shrink-0 place-items-center rounded-md ring-1 transition ${
                agreed ? "text-white ring-transparent" : "ring-line"
              }`}
              style={agreed ? { background: TEAL_GRADIENT } : undefined}
            >
              {agreed && <Check size={13} stroke={3} />}
            </span>
            <span className="text-[13px] text-ink">
              I have read and agree to the Terms &amp; Conditions, and I understand JCut.AI is
              beta software provided without warranty.
            </span>
          </button>

          {!scrolledToEnd && (
            <p className="text-xs text-dim">Scroll through the full terms to continue.</p>
          )}

          <motion.button
            whileHover={canAccept ? { scale: 1.03 } : undefined}
            whileTap={canAccept ? { scale: 0.98 } : undefined}
            onClick={canAccept ? onAccept : undefined}
            disabled={!canAccept}
            className={`flex items-center gap-2 rounded-pill px-8 py-3 font-medium text-white transition-opacity ${
              canAccept ? "shadow-glow" : "cursor-not-allowed opacity-40"
            }`}
            style={{ background: TEAL_GRADIENT }}
          >
            Agree &amp; continue
            <ChevronRight size={16} stroke={1.5} />
          </motion.button>
        </div>
      </div>
    </div>
  );
}
