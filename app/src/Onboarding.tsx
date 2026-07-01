// First-run onboarding -- expanded multi-step welcome flow.
// Steps: Welcome → Pick AI brain → Connect → Import footage → Done
import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  spring, TEAL_GRADIENT, BLUE_GRADIENT,
  type Accent, ACCENTS, ACCENT_ORDER,
  THEME_META,
  type Density, DENSITY_META,
  type FontScale, FONT_SCALE_META,
  type Radius, RADIUS_META,
  type UiFont, UI_FONT_META,
} from "./theme";
import { ChevronLeft } from "./Icons";
import type { Backend, AppSettings } from "./jcut";
import { LMStudioPanel } from "./Settings";
import iconUrl from "./assets/icon.png";
import { Brain, Folder, Film, Clapper, Sparkle, ChevronRight, Warning,
  Shield, Offline, Cloud, Cpu, Check, Coins, Bolt, Sliders } from "./Icons";

type Step = "welcome" | "ethics" | "terms" | "appearance" | "brain" | "connect" | "workflow" | "done";
type ThemeChoice = AppSettings["theme"];
const ONBOARDING_THEME_META: Record<ThemeChoice, { label: string; swatch: string }> = {
  system: { label: "System", swatch: "linear-gradient(135deg, #EDEEF2 0%, #0D0D0F 100%)" },
  ...THEME_META,
};

const STEPS: Step[] = ["welcome", "ethics", "terms", "appearance", "brain", "connect", "workflow", "done"];

export default function Onboarding({ settings, onChange, onDone }: { settings: AppSettings; onChange: (p: Partial<AppSettings>) => void; onDone: (backend: Backend, hybridMode: boolean, localMode: "single" | "dual") => void }) {
  const [step, setStep] = useState<Step>("welcome");
  // Default to the local option -- private, free, and aligned with our philosophy
  // of running on your own machine rather than in a data center.
  const [modeSelection, setModeSelection] = useState<"local-single" | "local-dual" | "claude" | "hybrid">("local-single");
  const stepIndex = STEPS.indexOf(step);
  const next = () => setStep(STEPS[stepIndex + 1]);
  const prev = () => setStep(STEPS[stepIndex - 1]);

  let slideKey: string;
  let slideEl: React.ReactNode;
  const canGoBack = stepIndex > 0;
  if (step === "welcome") {
    slideKey = "welcome";
    slideEl = <StepWelcome settings={settings} onChange={onChange} onNext={next} />;
  } else if (step === "ethics") {
    slideKey = "ethics";
    slideEl = <StepEthics onNext={next} />;
  } else if (step === "terms") {
    slideKey = "terms";
    slideEl = <StepTerms settings={settings} onChange={onChange} onNext={next} />;
  } else if (step === "appearance") {
    slideKey = "appearance";
    slideEl = <StepAppearance settings={settings} onChange={onChange} onNext={next} />;
  } else if (step === "brain") {
    slideKey = "brain";
    slideEl = <StepBrain modeSelection={modeSelection} setModeSelection={setModeSelection} onNext={next} />;
  } else if (step === "connect" && modeSelection === "claude") {
    slideKey = "connect-claude";
    slideEl = <StepConnectClaude onNext={next} />;
  } else if (step === "connect" && (modeSelection === "local-dual" || modeSelection === "local-single")) {
    slideKey = "connect-local";
    slideEl = <StepConnectLocal settings={settings} onChange={onChange} mode={modeSelection} onNext={next} />;
  } else if (step === "connect" && modeSelection === "hybrid") {
    slideKey = "connect-hybrid";
    slideEl = <StepConnectHybrid settings={settings} onChange={onChange} onNext={next} />;
  } else if (step === "workflow") {
    slideKey = "workflow";
    slideEl = <StepWorkflow onNext={next} />;
  } else {
    slideKey = "done";
    slideEl = <StepDone onDone={() => onDone(
      modeSelection === "claude" || modeSelection === "hybrid" ? "claude" : "local",
      modeSelection === "hybrid",
      modeSelection === "local-dual" ? "dual" : "single",
    )} />;
  }

  return (
    <div className="grain relative flex h-full flex-col items-center overflow-hidden">
      <div className="backdrop" />

      {/* Traffic-light drag strip -- with the branded gradient titlebar bar. */}
      <div className="titlebar-grad drag absolute inset-x-0 top-0 z-30 h-9" />

      {/* Progress dots */}
      <div className="absolute top-14 flex items-center gap-2">
        {STEPS.map((s, i) => (
          <motion.div
            key={s}
            animate={{ width: step === s ? 20 : 6, opacity: step === s ? 1 : i < stepIndex ? 0.5 : 0.25 }}
            transition={spring.snappy}
            className="h-1.5 rounded-full bg-white"
          />
        ))}
      </div>

      {/* Back button */}
      {canGoBack && (
        <button onClick={prev} className="absolute left-4 top-16 z-20 p-2 rounded-full bg-surface/60 text-ink hover:bg-surface/80">
          <ChevronLeft size={20} stroke={1.5} />
        </button>
      )}

      {/* Slide content: a fixed region between the top dots and the bottom edge.
          It does NOT scroll as a whole -- each slide pins its header/footer and
          scrolls only its middle (see the Slide primitive). pt clears the dots. */}
      <div
        key={slideKey}
        className={`relative z-10 flex h-full w-full ${step === "brain" ? "max-w-5xl" : "max-w-2xl"} flex-col items-center px-6 pb-8 pt-24 text-center transition-all duration-300 sm:px-8`}
      >
        {slideEl}
      </div>
    </div>
  );
}

// ─── Shared wrappers ──────────────────────────────────────────────────────────

function PrimaryBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <motion.button
      whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className="mt-6 flex items-center gap-2 rounded-pill px-8 py-3 font-medium text-white shadow-glow"
      style={{ background: TEAL_GRADIENT }}
    >
      {children}
      <ChevronRight size={16} stroke={1.5} />
    </motion.button>
  );
}

// Internal scroll region with fading top/bottom edges. The fade only appears on
// the side that actually has more content, so when everything fits there's no
// fade at all. Keeps tall slide content inside a bounded box instead of forcing
// the whole slide (and the primary button) to scroll off-screen.
const FADE = 28; // px of fade at each edge when content overflows that side
function FadeScroll({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const top = el.scrollTop > 4 ? FADE : 0;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight > 4 ? FADE : 0;
    el.style.setProperty("--fade-top", `${top}px`);
    el.style.setProperty("--fade-bottom", `${bottom}px`);
  }, []);
  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update, children]);
  return (
    <div ref={ref} onScroll={update} className={`onb-scroll min-h-0 w-full ${className}`}>
      {children}
    </div>
  );
}

// Standard slide skeleton: a fixed-height column that never overflows the
// viewport. The header and footer are pinned; only `children` scrolls (inside a
// FadeScroll) when the content is taller than the available space.
function Slide({ header, footer, children, bodyClassName = "" }: {
  header?: React.ReactNode; footer?: React.ReactNode;
  children: React.ReactNode; bodyClassName?: string;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center">
      {header && <div className="w-full shrink-0">{header}</div>}
      <FadeScroll className={`flex-1 py-2 ${bodyClassName}`}>
        <div className="flex w-full flex-col items-center">{children}</div>
      </FadeScroll>
      {footer && <div className="flex w-full shrink-0 flex-col items-center pt-2">{footer}</div>}
    </div>
  );
}

// ─── Step 1: Welcome ──────────────────────────────────────────────────────────

function StepWelcome({ settings, onChange, onNext }: {
  settings: AppSettings;
  onChange: (p: Partial<AppSettings>) => void;
  onNext: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center overflow-y-auto py-4 text-center">
      <motion.img
        src={iconUrl} alt="JCut.AI"
        initial={{ scale: 0.4, rotate: -12, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={spring.bouncy}
        className="h-24 w-24 drop-shadow-[0_12px_60px_rgba(46,107,230,0.45)]"
      />
      <motion.h1
        initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ ...spring.soft, delay: 0.08 }}
        className="mt-6 text-4xl font-semibold tracking-tight"
      >
        <span className="inline-flex items-center gap-3">
          <span>JCut<span className="text-dim">.AI</span></span>
          <span className="rounded-pill bg-surface2 px-3 py-0.5 text-[11px] font-bold uppercase tracking-widest text-accent ring-1 ring-accent/30 align-middle">Beta</span>
        </span>
        <motion.h2
          initial={{ y: 8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ ...spring.soft, delay: 0.10 }}
          className="mt-2 text-xl font-medium text-dim"
        >
          Your Junior Editing tool
        </motion.h2>
      </motion.h1>
      <motion.p
        initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ ...spring.soft, delay: 0.14 }}
        className="mt-3 max-w-md text-dim"
      >
        Describe the edit you have in mind. JCut handles the repetitive work -- scanning
        footage, building a rough timeline, placing clips -- so you can focus on the
        creative decisions that actually matter.
        <span className="text-ink"> Runs completely free on your own computer.</span>
      </motion.p>
      <motion.p
        initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ ...spring.soft, delay: 0.16 }}
        className="mt-3 max-w-md text-dim"
      >
        Edit faster, so you have more time to live your life.
      </motion.p>

      <motion.p
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        transition={{ ...spring.soft, delay: 0.18 }}
        className="mt-4 inline-flex items-center gap-2 rounded-pill bg-amber-500/10 px-3 py-1.5 text-[12px] text-amber-300 ring-1 ring-amber-500/20"
      >
        <Warning size={13} stroke={1.5} className="shrink-0" />
        JCut.AI is beta software -- expect rough edges and keep backups of your footage.
      </motion.p>

      {/* How it works, at a glance -- the visual anchor of the welcome slide. */}
      <motion.div
        initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ ...spring.soft, delay: 0.22 }}
        className="mt-8 grid w-full grid-cols-3 gap-4"
      >
        {[
          { icon: <Folder size={20} stroke={1.5} />, title: "1 · Add your footage", sub: "Drop in clips -- originals are never moved or copied" },
          { icon: <Brain size={20} stroke={1.5} />, title: "2 · Describe your vision", sub: "'60s recap, energy builds in the second half'" },
          { icon: <Film size={20} stroke={1.5} />, title: "3 · Refine and export", sub: "Tweak by chatting, then take it into Premiere" },
        ].map((f) => (
          <div key={f.title} className="rounded-xl bg-surface/60 p-4 text-left ring-1 ring-line">
            <div className="mb-2 text-accent">{f.icon}</div>
            <div className="text-sm font-medium">{f.title}</div>
            <div className="mt-0.5 text-xs text-dim">{f.sub}</div>
          </div>
        ))}
      </motion.div>

      <PrimaryBtn onClick={onNext}>Get started</PrimaryBtn>
    </div>
  );
}

// ─── Step 2: Appearance ────────────────────────────────────────────────────────

function StepAppearance({ settings, onChange, onNext }: { settings: AppSettings; onChange: (p: Partial<AppSettings>) => void; onNext: () => void; }) {
  const [showAdvancedAppearance, setShowAdvancedAppearance] = useState(false);
  const quickModes: ThemeChoice[] = ["dark", "light"];
  const advancedModes: ThemeChoice[] = ["system", "midnight", "forest", "warm", "slate"];
  return (
    <Slide
      header={
        <div className="flex flex-col items-center">
          <h2 className="text-3xl font-semibold tracking-tight">Customize your appearance</h2>
          <p className="mt-2 max-w-md text-dim">Pick a look -- you can fine-tune everything later in Settings.</p>

          {/* Live preview -- framed in the theme's own --bg and using real
              surface/ink/accent tokens, so changing the mood OR the accent
              below updates it in real time. Pinned so it's always visible. */}
          <div className="mx-auto mt-5 w-full max-w-md overflow-hidden rounded-xl2 p-3 ring-1 ring-line" style={{ background: "var(--bg)" }}>
        <div className="rounded-xl depth-card p-4 text-left">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg text-white" style={{ background: TEAL_GRADIENT }}>
              <Sparkle size={16} stroke={1.5} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="h-2.5 w-24 rounded-pill bg-ink/80" />
              <div className="mt-1.5 h-2 w-16 rounded-pill bg-dim/40" />
            </div>
            <span className="rounded-pill px-3 py-1 text-[11px] font-semibold text-white" style={{ background: TEAL_GRADIENT }}>Edit</span>
          </div>
          <div className="mt-3 space-y-1.5">
            <div className="h-2 w-full rounded-pill bg-dim/25" />
            <div className="h-2 w-5/6 rounded-pill bg-dim/25" />
            <div className="h-2 w-2/3 rounded-pill bg-dim/25" />
          </div>
          <div className="mt-3 flex items-center gap-1.5">
            <span className="h-5 flex-1 rounded-md" style={{ background: TEAL_GRADIENT, opacity: 0.85 }} />
            <span className="h-5 w-10 rounded-md bg-surface2" />
            <span className="h-5 w-6 rounded-md" style={{ background: "var(--accent)", opacity: 0.5 }} />
          </div>
          </div>
          </div>
        </div>
      }
      footer={<PrimaryBtn onClick={onNext}>Next</PrimaryBtn>}
    >
      {/* Accent color -- drives the preview's buttons/highlights live. */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {ACCENT_ORDER.map((id) => {
          const a = ACCENTS[id];
          const active = settings.accent === id;
          return (
            <button
              key={id}
              onClick={() => onChange({ accent: id })}
              title={a.label}
              aria-label={a.label}
              className="grid h-7 w-7 place-items-center rounded-full transition"
              style={{
                background: `linear-gradient(135deg, ${a.base} 0%, ${a.deep} 100%)`,
                boxShadow: active
                  ? `0 0 0 2px var(--bg), 0 0 0 4px ${a.base}`
                  : "0 1px 2px rgba(0,0,0,0.3)",
              }}
            >
              {active && <Check size={13} stroke={3} className="text-white" />}
            </button>
          );
        })}
      </div>

      {/* Quick mode selection */}
      <div className="mt-5 grid grid-cols-2 gap-2">
        {quickModes.map((id) => {
          const active = settings.theme === id;
          const meta = ONBOARDING_THEME_META[id];
          return (
            <button key={id} onClick={() => onChange({ theme: id })} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-left transition ${active ? "ring-2 ring-accent bg-surface2" : "depth-chip hover:bg-surface2/70"}`}>
              <span className="h-4 w-4 shrink-0 rounded-full ring-1 ring-white/10" style={{ background: meta.swatch }} />
              <span className={`text-[13px] font-medium ${active ? "text-ink" : "text-dim"}`}>{meta.label}</span>
            </button>
          );
        })}
      </div>
      <button onClick={() => setShowAdvancedAppearance(v => !v)} className="flex items-center gap-1.5 text-xs font-medium text-dim transition-colors hover:text-ink mt-4">
        {showAdvancedAppearance ? "Hide advanced appearance" : "Show advanced appearance"}
        <ChevronRight size={14} stroke={1.5} className={`transition-transform duration-300 ${showAdvancedAppearance ? "-rotate-90" : "rotate-90"}`} />
      </button>
      <AnimatePresence initial={false}>
        {showAdvancedAppearance && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring.snappy} className="overflow-hidden">
            <div className="space-y-3 pb-1 pt-4">
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-dim">More background moods</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {advancedModes.map((id) => {
                    const active = settings.theme === id;
                    const meta = ONBOARDING_THEME_META[id];
                    return (
                      <button key={id} onClick={() => onChange({ theme: id })} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition ${active ? "ring-2 ring-accent bg-surface2" : "depth-chip hover:bg-surface2/70"}`}>
                        <span className="h-4 w-4 shrink-0 rounded-full ring-1 ring-white/10" style={{ background: meta.swatch }} />
                        <span className={`text-[12px] font-medium ${active ? "text-ink" : "text-dim"}`}>{meta.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <CompactSegRow<Density>
                label="UI density"
                value={settings.density}
                options={(Object.keys(DENSITY_META) as Density[]).map((id) => ({ id, label: DENSITY_META[id].label }))}
                onChange={(v) => onChange({ density: v })}
              />
              <CompactSegRow<FontScale>
                label="Text size"
                value={settings.fontScale}
                options={(Object.keys(FONT_SCALE_META) as FontScale[]).map((id) => ({ id, label: FONT_SCALE_META[id].label }))}
                onChange={(v) => onChange({ fontScale: v })}
              />
              <CompactSegRow<Radius>
                label="Corners"
                value={settings.radius}
                options={(Object.keys(RADIUS_META) as Radius[]).map((id) => ({ id, label: RADIUS_META[id].label }))}
                onChange={(v) => onChange({ radius: v })}
              />
              <CompactSegRow<UiFont>
                label="Interface font"
                value={settings.uiFont}
                options={(Object.keys(UI_FONT_META) as UiFont[]).map((id) => ({ id, label: UI_FONT_META[id].label }))}
                onChange={(v) => onChange({ uiFont: v })}
              />
              <CompactToggle label="Reduce motion" value={settings.reduceMotion} onChange={(v) => onChange({ reduceMotion: v })} />
              <CompactToggle label="Film grain" value={settings.grain} onChange={(v) => onChange({ grain: v })} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Slide>
  );
}

// ─── Step: Our stance on AI ──────────────────────────────────────────────────

function StepEthics({ onNext }: { onNext: () => void }) {
  const principles = [
    {
      icon: <Brain size={20} stroke={1.5} />,
      title: "Empower, don't replace",
      body: `JCut is built to make a human editor faster -- not to remove them. The AI handles the tedious first pass; you keep the taste, the final call, and the credit.`,
    },
    {
      icon: <Shield size={20} stroke={1.5} />,
      title: "Your footage stays yours",
      body: "Your media never leaves your machine unless you explicitly choose a cloud option. We don't train on your work, and we don't claim any rights to what you create.",
    },
    {
      icon: <Cpu size={20} stroke={1.5} />,
      title: "Lighter on the planet",
      body: "Big cloud models run in power-hungry data centers. JCut runs great entirely on your own computer -- no data centers, less energy, full privacy.",
    },
    {
      icon: <Check size={20} stroke={1.5} />,
      title: "Your choice, always",
      body: "Local or cloud, simple or advanced -- you decide, and you can change your mind anytime. We show the trade-offs honestly so the choice is genuinely yours.",
    },
  ];
  return (
    <Slide
      header={
        <div className="flex flex-col items-center">
          <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl text-white shadow-glow" style={{ background: TEAL_GRADIENT }}>
            <Sparkle size={28} stroke={1.5} />
          </div>
          <h2 className="text-3xl font-semibold tracking-tight">Where we stand on AI</h2>
          <p className="mt-2 max-w-lg text-dim">
            A few beliefs that shape every decision in JCut. We think you should know them up front.
          </p>
        </div>
      }
      footer={<PrimaryBtn onClick={onNext}>I'm on board</PrimaryBtn>}
    >
      <div className="grid w-full grid-cols-1 gap-3 text-left sm:grid-cols-2">
        {principles.map((p, i) => (
          <motion.div
            key={p.title}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring.soft, delay: i * 0.06 }}
            className="rounded-xl bg-surface/60 p-4 ring-1 ring-line"
          >
            <div className="mb-2 grid h-9 w-9 place-items-center rounded-xl text-accent" style={{ background: "var(--surface-2)" }}>
              {p.icon}
            </div>
            <div className="text-sm font-semibold">{p.title}</div>
            <div className="mt-1 text-[13px] leading-relaxed text-dim">{p.body}</div>
          </motion.div>
        ))}
      </div>
    </Slide>
  );
}

export const TERMS_EFFECTIVE = "Effective June 9, 2026";

export const TERMS_SECTIONS: { heading: string; body: string }[] = [
  { heading: `1. Acceptance of terms`, body: `By installing, accessing, or using JCut.AI ("the App," "we," "us," or "our"), you ("you" or "User") agree to be bound by these Terms & Conditions (the "Terms") and our Privacy Policy. If you do not agree, do not install or use the App. If you are using the App on behalf of an organization, you represent that you have authority to bind that organization to these Terms.` },
  { heading: `2. Beta software notice`, body: `The App is BETA software and is provided for early evaluation. It may contain bugs, incomplete features, and behavior that changes between releases. Features may be added, removed, or altered without notice, and stability is not guaranteed. Do not rely on the App as your sole tool for time-sensitive or irreplaceable work, and always keep independent backups of your footage and projects.` },
  { heading: `3. Eligibility`, body: `You must be at least 13 years old (or the age of digital consent in your jurisdiction) to use the App. By using the App you represent and warrant that you meet this requirement and that all information you provide is accurate.` },
  { heading: `4. License grant`, body: `Subject to these Terms, we grant you a personal, non-exclusive, non-transferable, revocable license to install and use the App on devices you own or control, for your own creative and professional editing purposes. This license does not transfer any ownership of the App or its intellectual property to you.` },
  { heading: `5. Local-first operation`, body: `The App is designed to run on your own machine. Your footage, project files, transcripts, and edits remain on your computer. The App links to (rather than copies or moves) your original media wherever possible. Nothing is transmitted off your device unless you explicitly enable a cloud feature.` },
  { heading: `6. Cloud AI features`, body: `If you enable Claude (cloud) or Hybrid mode, your text instructions and limited footage metadata (such as durations, filenames, transcripts, and sampled frames) may be transmitted to Anthropic, PBC to perform requested edits, under Anthropic's applicable terms and privacy policy. Raw, full-resolution video files are not uploaded. You are solely responsible for any usage, subscription, or token costs incurred under your own Anthropic or Claude account.` },
  { heading: `7. Local model features`, body: `If you use a local model via LM Studio or a similar runtime, all inference happens on your hardware. Performance, quality, and resource usage depend on your chosen model and machine. We make no guarantee regarding the suitability, accuracy, or speed of any third-party model you select.` },
  { heading: `8. Your content & ownership`, body: `You retain all rights, title, and interest in and to your footage, audio, projects, and any output you create with the App. We claim no ownership over your media or your edits. You are solely responsible for ensuring you hold the necessary rights, licenses, and permissions for any footage, music, images, or other assets you import or use.` },
  { heading: `9. Acceptable use`, body: `You agree not to use the App to create, process, or distribute content that is unlawful, infringing, defamatory, or that violates the rights of others; to reverse engineer, decompile, or attempt to extract source code except as permitted by law; to circumvent usage limits or security measures; or to use the App in any manner that could disable, overburden, or impair it.` },
  { heading: `10. AI output disclaimer`, body: `Edits, cuts, captions, reframes, music selections, and other output are generated automatically and may be inaccurate, incomplete, or unsuitable for your purpose. The App is an assistive tool and not a substitute for your professional judgment. You are responsible for reviewing all output before publishing, delivering, or relying on it.` },
  { heading: `11. Third-party software & services`, body: `The App may interoperate with third-party software and services, including but not limited to LM Studio, Adobe Premiere Pro, ffmpeg, and Anthropic's Claude. Your use of those tools is governed by their own licenses, terms, and privacy policies, for which we are not responsible. We do not endorse and are not liable for any third-party product or service.` },
  { heading: `12. Backups & data loss`, body: `You are responsible for maintaining independent backups of your footage and projects. While the App is designed to avoid modifying your originals, software can fail. To the maximum extent permitted by law, we are not responsible for any loss, corruption, or deletion of your media, projects, or settings.` },
  { heading: `13. Intellectual property`, body: `The App, including its software, design, trademarks, and branding, is owned by us and protected by intellectual-property laws. Except for the limited license granted above, no rights are granted to you. You may not use our name, logo, or marks without prior written permission.` },
  { heading: `14. No warranty`, body: `THE APP IS PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. We do not warrant that the App will be uninterrupted, secure, error-free, or that defects will be corrected.` },
  { heading: `15. Limitation of liability`, body: `TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT WILL WE BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF DATA, FOOTAGE, PROFITS, OR REVENUE, ARISING OUT OF OR RELATED TO YOUR USE OF THE APP, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. Our total aggregate liability for any claim shall not exceed the greater of the amount you paid for the App in the twelve months preceding the claim, or USD $50.` },
  { heading: `16. Indemnification`, body: `You agree to indemnify, defend, and hold harmless the developers from and against any claims, liabilities, damages, losses, and expenses (including reasonable legal fees) arising out of or connected with your content, your use of the App, or your violation of these Terms or the rights of any third party.` },
  { heading: `17. Changes to the App & Terms`, body: `We may modify, suspend, or discontinue any part of the App at any time, with or without notice. We may also revise these Terms from time to time; the "Effective" date above indicates the latest revision. Your continued use of the App after changes take effect constitutes acceptance of the revised Terms.` },
  { heading: `18. Termination`, body: `These Terms remain in effect for as long as you use the App. You may stop using the App at any time. We may suspend or terminate your access if you breach these Terms. Provisions that by their nature should survive termination (including ownership, disclaimers, and limitations of liability) will survive.` },
  { heading: `19. Governing law`, body: `These Terms are governed by the laws of the State of Georgia, United States, without regard to its conflict-of-laws principles. Any dispute arising under these Terms shall be subject to the exclusive jurisdiction of the state and federal courts located in Georgia, unless otherwise required by applicable law.` },
  { heading: `20. Severability & entire agreement`, body: `If any provision of these Terms is found unenforceable, the remaining provisions will remain in full force and effect. These Terms, together with the Privacy Policy, constitute the entire agreement between you and us regarding the App and supersede any prior agreements.` },
  { heading: `21. Contact`, body: `Questions about these Terms can be directed to the developers through the support channel listed in Settings → About. We will make reasonable efforts to respond to legitimate inquiries.` },
];

function StepTerms({ settings, onChange, onNext }: { settings: AppSettings; onChange: (p: Partial<AppSettings>) => void; onNext: () => void; }) {
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const accept = () => {
    onChange({ termsAccepted: true });
    onNext();
  };
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 24) setScrolledToEnd(true);
  };
  return (
    <div className="flex h-full w-full flex-col items-center text-center">
      <div className="w-full shrink-0">
        <h2 className="text-3xl font-semibold tracking-tight">Terms &amp; Conditions</h2>
        <p className="mt-2 max-w-md text-dim mx-auto">Please read these before continuing. Scroll to the bottom to accept.</p>
      </div>

      {/* Scrollable terms document -- flexes to fill the space between the header
          and the pinned button, so the slide itself never scrolls. */}
      <div
        onScroll={onScroll}
        className="onb-scroll my-4 min-h-0 w-full max-w-2xl flex-1 rounded-xl2 bg-surface/60 p-5 text-left ring-1 ring-line"
        style={{ "--fade-top": "0px", "--fade-bottom": "24px" } as React.CSSProperties}
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
            You've reached the end of the terms. Tap "I Agree" to continue.
          </p>
        </div>
      </div>

      <div className="w-full shrink-0">
        {!scrolledToEnd && (
          <p className="text-xs text-dim">Scroll through the terms to enable the button.</p>
        )}
        <motion.button
          whileHover={scrolledToEnd ? { scale: 1.04 } : undefined}
          whileTap={scrolledToEnd ? { scale: 0.97 } : undefined}
          onClick={scrolledToEnd ? accept : undefined}
          disabled={!scrolledToEnd}
          className={`mt-3 mx-auto flex items-center gap-2 rounded-pill px-8 py-3 font-medium text-white transition-opacity ${scrolledToEnd ? "shadow-glow" : "cursor-not-allowed opacity-40"}`}
          style={{ background: TEAL_GRADIENT }}
        >
          I Agree
          <ChevronRight size={16} stroke={1.5} />
        </motion.button>
      </div>
    </div>
  );
}


// ─── Step 3: Brain Selection ──────────────────────────────────────────────────

function StepBrain({ modeSelection, setModeSelection, onNext }: {
  modeSelection: "local-single" | "local-dual" | "claude" | "hybrid";
  setModeSelection: (b: "local-single" | "local-dual" | "claude" | "hybrid") => void;
  onNext: () => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <Slide
      header={
        <div className="flex flex-col items-center">
          <h2 className="text-3xl font-semibold tracking-tight">Choose where the AI runs</h2>
          <p className="mt-2 max-w-lg text-dim">
            JCut needs an AI model to scan your footage and handle the time-consuming work --
            so you can spend your time on the creative decisions that actually require a human.
            We believe AI should <span className="text-ink"> empower editors, not replace them</span> -- and that great
            tools shouldn't cost the planet. That's why you can run the model
            <span className="text-ink"> entirely on your own Mac: no data centers, and nothing leaves your machine.</span>
          </p>
        </div>
      }
      footer={
        <PrimaryBtn onClick={onNext}>
          Continue with {modeSelection === "hybrid" ? "Hybrid Mode" : modeSelection === "claude" ? "Claude" : modeSelection === "local-dual" ? "Dual-Local" : "Single-Local"}
        </PrimaryBtn>
      }
    >
      <div className="-m-2 grid w-full grid-cols-1 gap-4 p-2 lg:grid-cols-2">
        <BrainCard
          active={modeSelection === "claude"}
          onClick={() => setModeSelection("claude")}
          gradient={TEAL_GRADIENT}
          icon={<Cloud size={22} stroke={1.5} />}
          title="Claude"
          subtitle="Anthropic subscription"
          tagline="Top-tier results if you already pay for Claude."
          bullets={[
            { icon: <Sparkle size={15} stroke={1.5} />, text: "The most capable model, best out of the box" },
            { icon: <Check size={15} stroke={1.5} />, text: "Uses your existing Claude login -- no API key" },
            { icon: <Coins size={15} stroke={1.5} />, text: "Needs a paid Claude plan (counts toward usage)" },
            { icon: <Cloud size={15} stroke={1.5} />, text: "Requires an internet connection" },
          ]}
        />
        <BrainCard
          active={modeSelection === "local-single"}
          onClick={() => setModeSelection("local-single")}
          gradient={BLUE_GRADIENT}
          icon={<Cpu size={22} stroke={1.5} />}
          title="Single-Local"
          subtitle="via LM Studio"
          badge="Recommended"
          tagline="One local model, simpler setup."
          bullets={[
            { icon: <Coins size={15} stroke={1.5} />, text: "Costs $0 to run, no usage limits" },
            { icon: <Shield size={15} stroke={1.5} />, text: "100% private -- nothing is sent anywhere" },
            { icon: <Check size={15} stroke={1.5} />, text: "Highly resource efficient on weaker Macs" },
            { icon: <Bolt size={15} stroke={1.5} />, text: "Slower edits as vision & logic share a queue" },
          ]}
        />
      </div>

      <div className="mt-4 w-full">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1.5 mx-auto text-xs font-medium text-dim hover:text-ink transition-colors"
        >
          {showAdvanced ? "Hide advanced local setups" : "Show advanced local setups"}
          <ChevronRight size={14} stroke={1.5} className={`transition-transform duration-300 ${showAdvanced ? "-rotate-90" : "rotate-90"}`} />
        </button>
        <AnimatePresence>
          {showAdvanced && (
            <motion.div
              initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              transition={spring.snappy}
              className="overflow-hidden"
            >
              <div className="-m-2 grid w-full grid-cols-1 gap-4 p-2 pt-6 lg:grid-cols-2">
                <BrainCard
                  active={modeSelection === "hybrid"}
                  onClick={() => setModeSelection("hybrid")}
                  gradient="linear-gradient(135deg, #10b981, #3b82f6)"
                  icon={<Sparkle size={22} stroke={1.5} />}
                  title="Hybrid Mode"
                  subtitle="Cloud + Local"
                  tagline="The best of both worlds."
                  bullets={[
                    { icon: <Brain size={15} stroke={1.5} />, text: "Claude acts as Creative Director" },
                    { icon: <Cpu size={15} stroke={1.5} />, text: "Local models handle the repetitive scanning work" },
                    { icon: <Coins size={15} stroke={1.5} />, text: "Saves massive amounts of Claude tokens" },
                    { icon: <Bolt size={15} stroke={1.5} />, text: "The fastest, highest quality edits" },
                  ]}
                />
                <BrainCard
                  active={modeSelection === "local-dual"}
                  onClick={() => setModeSelection("local-dual")}
                  gradient={BLUE_GRADIENT}
                  icon={<Cpu size={22} stroke={1.5} />}
                  title="Dual-Local"
                  subtitle="via LM Studio"
                  badge="Free forever"
                  tagline="Separate Logic & Vision models."
                  bullets={[
                    { icon: <Coins size={15} stroke={1.5} />, text: "Costs $0 to run, no usage limits" },
                    { icon: <Shield size={15} stroke={1.5} />, text: "100% private -- nothing is sent anywhere" },
                    { icon: <Bolt size={15} stroke={1.5} />, text: "Extremely fast, logic stays unpolluted" },
                    { icon: <Offline size={15} stroke={1.5} />, text: "Requires decent Mac hardware (16GB+ RAM)" },
                  ]}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <p className="mt-6 text-xs text-dim">
        Not sure? <span className="text-ink">Start on Single-Local</span> for the simplest private setup -- you can switch
        anytime in Settings. Nothing here is permanent.
      </p>
    </Slide>
  );
}

function BrainCard({ active, onClick, gradient, icon, title, subtitle, badge, tagline, bullets }: {
  active: boolean; onClick: () => void; gradient: string; icon: React.ReactNode;
  title: string; subtitle: string; badge?: string; tagline: string;
  bullets: { icon: React.ReactNode; text: string }[];
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.015, y: -1 }} whileTap={{ scale: 0.985 }}
      transition={spring.bouncy}
      onClick={onClick}
      className="relative overflow-hidden rounded-xl2 p-5 text-left ring-1 ring-line"
      style={{ background: "var(--surface)" }}
    >
      {active && (
        <motion.div layoutId="brain-active" className="absolute inset-0"
          style={{ background: gradient }} transition={spring.snappy} />
      )}
      <div className="relative z-10">
        <div className="flex items-start justify-between gap-2">
          <div className={`grid h-10 w-10 place-items-center rounded-xl ${active ? "bg-white/15 text-white" : "bg-surface2 text-accent"}`}>
            {icon}
          </div>
          {badge && (
            <span className={`rounded-pill px-2.5 py-1 text-[11px] font-semibold ${
              active ? "bg-white/20 text-white" : "bg-accent/15 text-accent"
            }`}>{badge}</span>
          )}
        </div>
        <div className={`mt-3 text-lg font-semibold ${active ? "text-white" : "text-ink"}`}>{title}</div>
        <div className={`text-sm ${active ? "text-white/70" : "text-dim"}`}>{subtitle}</div>
        <p className={`mt-2 text-[13px] ${active ? "text-white/85" : "text-dim"}`}>{tagline}</p>
        <ul className={`mt-4 space-y-2 text-[13px] ${active ? "text-white/90" : "text-dim"}`}>
          {bullets.map((b) => (
            <li key={b.text} className="flex items-start gap-2">
              <span className={`mt-px shrink-0 ${active ? "text-white/70" : "text-dim"}`}>{b.icon}</span>
              <span>{b.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </motion.button>
  );
}

function CompactSegRow<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl depth-chip px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm font-medium text-ink">{label}</div>
      <div className="flex shrink-0 flex-wrap items-center gap-1 rounded-lg bg-surface p-0.5">
        {options.map((o) => {
          const active = value === o.id;
          return (
            <button
              key={o.id}
              onClick={() => onChange(o.id)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                active ? "bg-accent text-white" : "text-dim hover:text-ink"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CompactToggle({ label, value, onChange }: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="flex w-full items-center justify-between rounded-xl depth-chip px-4 py-3 text-left"
    >
      <span className="text-sm font-medium text-ink">{label}</span>
      <span
        className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
        style={{ background: value ? "var(--accent)" : "var(--surface)" }}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${value ? "right-0.5" : "left-0.5"}`} />
      </span>
    </button>
  );
}

// ─── Step 3a: Connect -- Claude ───────────────────────────────────────────────

function StepConnectClaude({ onNext }: { onNext: () => void }) {
  return (
    <Slide
      header={
        <div className="flex flex-col items-center">
          <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl text-white" style={{ background: TEAL_GRADIENT }}>
            <Brain size={28} stroke={1.5} />
          </div>
          <h2 className="text-3xl font-semibold tracking-tight">Connect Claude</h2>
          <p className="mt-2 max-w-sm text-dim">
            JCut uses the Claude CLI to talk to Claude. It rides your existing Anthropic Max session -- no API key needed.
          </p>
        </div>
      }
      footer={<PrimaryBtn onClick={onNext}>I'm logged in</PrimaryBtn>}
    >
      <div className="w-full space-y-3 text-left">
        {[
          { n: 1, title: "Install the Claude CLI", body: "Open Terminal and run:", code: "npm install -g @anthropic-ai/claude-code" },
          { n: 2, title: "Log in",                 body: "Still in Terminal, run:", code: "claude" },
          { n: 3, title: "That's it",              body: "JCut detects your session automatically. Verify anytime in Settings → AI Brain.", code: null },
        ].map((s) => (
          <div key={s.n} className="flex gap-4 rounded-xl bg-surface/60 p-4 ring-1 ring-line">
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-semibold text-white" style={{ background: TEAL_GRADIENT }}>{s.n}</div>
            <div className="min-w-0">
              <div className="text-sm font-medium">{s.title}</div>
              <div className="mt-0.5 text-xs text-dim">{s.body}</div>
              {s.code && <div className="mt-2 rounded-lg bg-black/40 px-3 py-2 font-mono text-xs text-white/80 ring-1 ring-white/10">{s.code}</div>}
            </div>
          </div>
        ))}
      </div>
    </Slide>
  );
}

// ─── Step 3b: Connect -- LM Studio ────────────────────────────────────────────

function StepConnectLocal({ settings, onChange, mode, onNext }: { settings: AppSettings; onChange: (p: Partial<AppSettings>) => void; mode: "local-single" | "local-dual"; onNext: () => void }) {
  return (
    <Slide
      header={
        <div className="flex flex-col items-center">
          <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl text-white" style={{ background: BLUE_GRADIENT }}>
            <Cpu size={28} stroke={1.5} />
          </div>
          <h2 className="text-3xl font-semibold tracking-tight">Run the AI on your Mac</h2>
          <p className="mt-2 max-w-md text-dim">
            LM Studio is a free app that runs the AI model locally. You'll download it once,
            load a model, and leave it running in the background. About 15 minutes, mostly downloading.
          </p>
        </div>
      }
      footer={<PrimaryBtn onClick={onNext}>Got it -- continue</PrimaryBtn>}
    >
      <div className="w-full space-y-3 text-left">
        {[
          { n: 1, title: "Download LM Studio (free)", body: "Grab it from lmstudio.ai -- it's a normal Mac app, no account needed." },
          { n: 2, title: mode === "local-dual" ? "Load your models" : "Load a model", body: mode === "local-dual" ? "In LM Studio, download a Coder model (like Qwen2.5-Coder) for logic, and a Vision model (like Qwen2-VL) to let JCut 'see' footage. Load them both." : "In LM Studio, download a Coder model (like Qwen2.5-Coder) and load it." },
          { n: 3, title: "Start the local server", body: "Open the Developer tab and click Start Server. This lets JCut talk to the models. Just leave LM Studio open in the background." },
          { n: 4, title: "Connect & test in JCut", body: `Back in JCut, open Settings → AI Brain → Test connection. You can map your model${mode === "local-dual" ? "s" : ""} there. ${mode === "local-single" ? "Just pick the same model for both." : ""}` },
        ].map((s) => (
          <div key={s.n} className="flex gap-4 rounded-xl bg-surface/60 p-4 ring-1 ring-line">
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-semibold text-white" style={{ background: BLUE_GRADIENT }}>{s.n}</div>
            <div className="min-w-0">
              <div className="text-sm font-medium">{s.title}</div>
              <div className="mt-0.5 text-xs text-dim">{s.body}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 w-full text-left">
        <LMStudioPanel settings={settings} onChange={onChange} />
      </div>

      <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-surface/60 px-4 py-3 text-left text-xs text-dim ring-1 ring-line">
        <Sparkle size={15} stroke={1.5} className="mt-px shrink-0 text-accent" />
        <span>
          New to this? You don't have to finish now -- you can skip ahead and set up LM Studio
          later from Settings. JCut will wait. Want the strongest results without the setup?
          You can switch to Claude anytime.
        </span>
      </div>
    </Slide>
  );
}

// ─── Step 3c: Connect -- Hybrid ───────────────────────────────────────────────

function StepConnectHybrid({ settings, onChange, onNext }: { settings: AppSettings; onChange: (p: Partial<AppSettings>) => void; onNext: () => void }) {
  return (
    <Slide
      header={
        <div className="flex flex-col items-center">
          <div className="mb-4 flex gap-3">
            <div className="grid h-14 w-14 place-items-center rounded-2xl text-white shadow-glow" style={{ background: TEAL_GRADIENT }}><Brain size={28} stroke={1.5} /></div>
            <div className="grid h-14 w-14 place-items-center rounded-2xl text-white shadow-glow" style={{ background: BLUE_GRADIENT }}><Cpu size={28} stroke={1.5} /></div>
          </div>
          <h2 className="text-3xl font-semibold tracking-tight">Connect Hybrid Mode</h2>
          <p className="mt-2 max-w-md text-dim">
            Hybrid Mode uses Claude for creative reasoning and your Mac for the repetitive work. You stay in control; both work together behind the scenes. You'll need both set up.
          </p>
        </div>
      }
      footer={<PrimaryBtn onClick={onNext}>Got it -- continue</PrimaryBtn>}
    >
      <div className="w-full space-y-3 text-left">
        {[
          { n: 1, title: "Install the Claude CLI", body: "Open Terminal and run: npm install -g @anthropic-ai/claude-code, then run claude to log in." },
          { n: 2, title: "Download LM Studio (free)", body: "Grab it from lmstudio.ai -- it's a normal Mac app, no account needed." },
          { n: 3, title: "Load your models", body: "In LM Studio, download a Coder model (like Qwen2.5-Coder) and a Vision model (like Qwen2-VL). Open the Developer tab and start the server." },
          { n: 4, title: "Test in JCut", body: "You're all set! Check Settings → AI Brain to map your local models." },
        ].map((s) => (
          <div key={s.n} className="flex gap-4 rounded-xl bg-surface/60 p-4 ring-1 ring-line">
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-semibold text-white" style={{ background: "linear-gradient(135deg, #10b981, #3b82f6)" }}>{s.n}</div>
            <div className="min-w-0">
              <div className="text-sm font-medium">{s.title}</div>
              <div className="mt-0.5 text-xs text-dim">{s.body}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 w-full text-left">
        <LMStudioPanel settings={settings} onChange={onChange} />
      </div>

      <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-surface/60 px-4 py-3 text-left text-xs text-dim ring-1 ring-line">
        <Sparkle size={15} stroke={1.5} className="mt-px shrink-0 text-accent" />
        <span>
          New to this? You can skip ahead and set this up later from Settings. JCut will wait.
        </span>
      </div>
    </Slide>
  );
}

// ─── Step 5: Workflow overview (remains same) ─────────────────────────────────

function StepWorkflow({ onNext }: { onNext: () => void }) {
  const [tab, setTab] = useState<"ai" | "castcut">("ai");

  const aiSteps = [
    {
      icon: <Folder size={18} stroke={1.5} />,
      title: "Add your footage",
      body: "Drop clips into the Sources panel. JCut only links to them — your originals are never moved or copied.",
    },
    {
      icon: <Brain size={18} stroke={1.5} />,
      title: "Describe your vision",
      body: "Type what you're going for. JCut scans your clips and assembles a starting timeline based on your direction.",
    },
    {
      icon: <Film size={18} stroke={1.5} />,
      title: "Refine the cut",
      body: "Chat to move things, adjust pacing, or swap shots. The timeline updates in real time.",
    },
    {
      icon: <Sparkle size={18} stroke={1.5} />,
      title: "Export to Premiere",
      body: "Export a .prproj and open it in Premiere Pro. Grade, mix, and finish the cut your way.",
    },
  ];

  const castcutSteps = [
    {
      icon: <Folder size={18} stroke={1.5} />,
      title: "Create a project",
      body: "Name it and pick (or create) a workspace. If you're starting fresh, add your footage files right here.",
      color: "#23C6A2",
    },
    {
      icon: <Film size={18} stroke={1.5} />,
      title: "Choose a sequence",
      body: "Pick the sequence that has your cameras on separate video tracks (V1, V2, V3…), or create a blank one.",
      color: "#2E6BE6",
    },
    {
      icon: <Brain size={18} stroke={1.5} />,
      title: "Assign cameras & mics",
      body: "Name each camera, mark one as Wide, and assign audio tracks. Multiple mics per speaker are supported.",
      color: "#8B5CF6",
    },
    {
      icon: <Sparkle size={18} stroke={1.5} />,
      title: "Run the edit",
      body: "CastCut analyzes each speaker's audio and builds a camera-switched cut automatically. No AI, no cloud.",
      color: "#F59E0B",
    },
  ];

  return (
    <Slide
      header={
        <div className="flex flex-col items-center gap-3">
          <h2 className="text-3xl font-semibold tracking-tight">Two ways to edit</h2>
          <div className="flex rounded-lg bg-black/25 p-0.5 ring-1 ring-white/[0.07]">
            {(["ai", "castcut"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-md px-4 py-1.5 text-[12px] font-semibold transition-colors ${
                  tab === t ? "bg-surface text-ink shadow-sm" : "text-dim hover:text-ink"
                }`}
              >
                {t === "ai" ? "AI Editor" : "CastCut"}
              </button>
            ))}
          </div>
        </div>
      }
      footer={<PrimaryBtn onClick={onNext}>Let's go</PrimaryBtn>}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, x: tab === "castcut" ? 12 : -12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: tab === "castcut" ? -12 : 12 }}
          transition={{ duration: 0.18 }}
          className="w-full space-y-2.5 text-left"
        >
          {(tab === "ai" ? aiSteps : castcutSteps).map((s, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring.soft, delay: i * 0.06 }}
              className="flex gap-3.5 rounded-xl bg-surface/60 p-3.5 ring-1 ring-line"
            >
              <div
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white"
                style={{ background: tab === "castcut" ? (s as any).color : TEAL_GRADIENT }}
              >
                {s.icon}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold">{s.title}</div>
                <div className="mt-0.5 text-xs text-dim">{s.body}</div>
              </div>
            </motion.div>
          ))}
          {tab === "castcut" && (
            <p className="pt-1 text-center text-[11px] text-dim">
              Perfect for podcast recordings. No AI subscription required.
            </p>
          )}
        </motion.div>
      </AnimatePresence>
    </Slide>
  );
}

// ─── Step 5: Done ─────────────────────────────────────────────────────────────

function StepDone({ onDone }: { onDone: () => void }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center overflow-y-auto py-4 text-center">
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={spring.bouncy}
        className="grid h-20 w-20 place-items-center rounded-2xl text-white shadow-glow"
        style={{ background: TEAL_GRADIENT }}
      >
        <Clapper size={40} stroke={1.5} />
      </motion.div>

      <motion.h2
        initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ ...spring.soft, delay: 0.1 }}
        className="mt-6 text-3xl font-semibold tracking-tight"
      >
        You're all set
      </motion.h2>
      <motion.p
        initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ ...spring.soft, delay: 0.16 }}
        className="mt-2 max-w-sm text-dim"
      >
        Use the <strong className="text-ink">AI Editor</strong> to chat your way to a timeline,
        or open <strong className="text-ink">CastCut</strong> for automatic multi-camera podcast editing — no AI required.
      </motion.p>

      <motion.div
        initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ ...spring.soft, delay: 0.22 }}
        className="mt-8 flex flex-col items-center gap-3"
      >
        <motion.button
          whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.97 }}
          onClick={onDone}
          className="rounded-pill px-10 py-3 text-base font-semibold text-white shadow-glow"
          style={{ background: TEAL_GRADIENT }}
        >
          Start editing
        </motion.button>
        <p className="text-xs text-dim">You can replay this guide anytime from Settings.</p>
      </motion.div>
    </div>
  );
}
