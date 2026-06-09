// First-run onboarding — expanded multi-step welcome flow.
// Steps: Welcome → Pick AI brain → Connect → Import footage → Done
import { useState } from "react";
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
import type { Backend, AppSettings } from "./jcut";
import { LMStudioPanel } from "./Settings";
import iconUrl from "./assets/icon.png";
import { Brain, Folder, Film, Clapper, Sparkle, ChevronRight,
  Shield, Offline, Cloud, Cpu, Check, Coins, Bolt, Sliders } from "./Icons";

type Step = "welcome" | "brain" | "connect" | "workflow" | "done";
type ThemeChoice = AppSettings["theme"];
const ONBOARDING_THEME_META: Record<ThemeChoice, { label: string; swatch: string }> = {
  system: { label: "System", swatch: "linear-gradient(135deg, #EDEEF2 0%, #0D0D0F 100%)" },
  ...THEME_META,
};

const STEPS: Step[] = ["welcome", "brain", "connect", "workflow", "done"];

export default function Onboarding({ settings, onChange, onDone }: { settings: AppSettings; onChange: (p: Partial<AppSettings>) => void; onDone: (backend: Backend, hybridMode: boolean, localMode: "single" | "dual") => void }) {
  const [step, setStep] = useState<Step>("welcome");
  // Default to the recommended hybrid option
  const [modeSelection, setModeSelection] = useState<"local-single" | "local-dual" | "claude" | "hybrid">("hybrid");

  const stepIndex = STEPS.indexOf(step);
  const next = () => setStep(STEPS[stepIndex + 1]);

  let slideKey: string;
  let slideEl: React.ReactNode;
  if (step === "welcome") {
    slideKey = "welcome";
    slideEl = <StepWelcome settings={settings} onChange={onChange} onNext={next} />;
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
    <div className="grain relative flex h-full flex-col items-center justify-start overflow-x-hidden overflow-y-auto pt-16">
      <div className="backdrop" />

      {/* Traffic-light drag strip */}
      <div className="drag absolute inset-x-0 top-0 h-9" />

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

      <div
        key={slideKey}
        className={`relative z-10 flex w-full ${step === "brain" ? "max-w-5xl" : "max-w-2xl"} max-h-[calc(100vh-6rem)] flex-col items-center overflow-y-auto px-6 pb-8 text-center transition-all duration-300 sm:px-8`}
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
      className="mt-8 flex items-center gap-2 rounded-pill px-8 py-3 font-medium text-white shadow-glow"
      style={{ background: TEAL_GRADIENT }}
    >
      {children}
      <ChevronRight size={16} stroke={1.5} />
    </motion.button>
  );
}

// ─── Step 1: Welcome ──────────────────────────────────────────────────────────

function StepWelcome({ settings, onChange, onNext }: {
  settings: AppSettings;
  onChange: (p: Partial<AppSettings>) => void;
  onNext: () => void;
}) {
  const [showAdvancedAppearance, setShowAdvancedAppearance] = useState(false);
  const quickModes: ThemeChoice[] = ["dark", "light"];
  const advancedModes: ThemeChoice[] = ["system", "midnight", "forest", "warm", "slate"];

  return (
    <div className="flex w-full flex-col items-center text-center">
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
        JCut<span className="text-dim">.AI</span>
      </motion.h1>
      <motion.p
        initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ ...spring.soft, delay: 0.14 }}
        className="mt-3 max-w-md text-dim"
      >
        You talk to an AI editor in plain English. It looks through your footage,
        builds a timeline, and exports a Premiere project — and you can run it
        <span className="text-ink"> completely free on your own computer.</span>
      </motion.p>

      {/* How it works, in one glance */}
      <motion.div
        initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ ...spring.soft, delay: 0.2 }}
        className="mt-8 grid w-full grid-cols-1 gap-4 sm:grid-cols-3"
      >
        {[
          { icon: <Folder size={20} stroke={1.5} />, title: "1 · Add footage", sub: "Drop in your clips — originals never move" },
          { icon: <Brain size={20} stroke={1.5} />, title: "2 · Describe it", sub: "“Make a 60s recap of the best moments”" },
          { icon: <Film size={20} stroke={1.5} />, title: "3 · Get a timeline", sub: "Refine by chatting, then export to Premiere" },
        ].map((f) => (
          <div key={f.title} className="rounded-xl bg-surface/60 p-4 ring-1 ring-line text-left">
            <div className="mb-2 text-accent">{f.icon}</div>
            <div className="text-sm font-medium">{f.title}</div>
            <div className="mt-0.5 text-xs text-dim">{f.sub}</div>
          </div>
        ))}
      </motion.div>

      <motion.div
        initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ ...spring.soft, delay: 0.24 }}
        className="mt-8 w-full max-w-3xl rounded-[1.6rem] depth-card p-5 text-left"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface2 text-accent">
            <Sliders size={18} stroke={1.5} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-ink">Customize your appearance</div>
            <div className="mt-1 text-[13px] leading-relaxed text-dim">
              Pick your default look now. You can change any of this later in Settings.
            </div>
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-dim">Light or dark</div>
          <div className="grid grid-cols-2 gap-2">
            {quickModes.map((id) => {
              const active = settings.theme === id;
              const meta = ONBOARDING_THEME_META[id];
              return (
                <button
                  key={id}
                  onClick={() => onChange({ theme: id })}
                  className={`flex items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
                    active ? "ring-2 ring-accent bg-surface2" : "depth-chip hover:bg-surface2/70"
                  }`}
                >
                  <span className="h-4 w-4 shrink-0 rounded-full ring-1 ring-white/10" style={{ background: meta.swatch }} />
                  <span className={`text-[13px] font-medium ${active ? "text-ink" : "text-dim"}`}>{meta.label}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {quickModes.map((id) => {
              const active = settings.theme === id;
              const meta = ONBOARDING_THEME_META[id];
              const surface = id === "light"
                ? {
                    bg: "#F6F7F9",
                    surface: "#FFFFFF",
                    surface2: "#E4E7EE",
                    text: "#14161C",
                    dim: "#555B6A",
                  }
                : {
                    bg: "#0D0D0F",
                    surface: "#17181D",
                    surface2: "#1F2128",
                    text: "#F4F5F7",
                    dim: "#9BA0AA",
                  };
              return (
                <button
                  key={`${id}-preview`}
                  onClick={() => onChange({ theme: id })}
                  className={`overflow-hidden rounded-2xl border text-left transition ${
                    active ? "border-accent shadow-glow" : "border-line hover:border-accent/40"
                  }`}
                  style={{ background: surface.bg }}
                >
                  <div className="p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: surface.dim }}>
                        Preview
                      </span>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: surface.surface2, color: active ? "var(--accent)" : surface.dim }}>
                        {meta.label}
                      </span>
                    </div>
                    <div className="space-y-2 rounded-xl p-3" style={{ background: surface.surface, color: surface.text }}>
                      <div className="h-2.5 w-20 rounded-full" style={{ background: "currentColor", opacity: 0.14 }} />
                      <div className="h-2 w-full rounded-full" style={{ background: "currentColor", opacity: 0.10 }} />
                      <div className="h-2 w-5/6 rounded-full" style={{ background: "currentColor", opacity: 0.10 }} />
                      <div className="mt-3 flex items-center gap-2">
                        <span className="h-7 w-7 rounded-full" style={{ background: "var(--accent)" }} />
                        <div className="min-w-0 flex-1">
                          <div className="h-2.5 w-14 rounded-full" style={{ background: "currentColor", opacity: 0.14 }} />
                          <div className="mt-1 h-2 w-24 rounded-full" style={{ background: "currentColor", opacity: 0.10 }} />
                        </div>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-1 flex items-baseline justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-dim">Accent color</div>
            <div className="text-[11px] font-medium text-dim">{ACCENTS[settings.accent as Accent]?.label}</div>
          </div>
          <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
            {ACCENT_ORDER.map((id) => {
              const a = ACCENTS[id];
              const active = settings.accent === id;
              return (
                <button
                  key={id}
                  onClick={() => onChange({ accent: id })}
                  title={a.label}
                  aria-label={a.label}
                  aria-pressed={active}
                  className="group relative grid aspect-square place-items-center rounded-xl transition"
                  style={{
                    background: `linear-gradient(135deg, ${a.base} 0%, ${a.deep} 100%)`,
                    boxShadow: active
                      ? `0 0 0 2px var(--surface), 0 0 0 4px ${a.base}, 0 6px 18px rgba(${a.glow}, 0.45)`
                      : "0 1px 0 rgba(255,255,255,0.12) inset, 0 2px 6px rgba(0,0,0,0.25)",
                  }}
                >
                  <motion.span
                    initial={false}
                    animate={{ scale: active ? 1 : 0, opacity: active ? 1 : 0 }}
                    transition={spring.bouncy}
                    className="text-white"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  </motion.span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5">
          <button
            onClick={() => setShowAdvancedAppearance((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-dim transition-colors hover:text-ink"
          >
            {showAdvancedAppearance ? "Hide advanced appearance" : "Show advanced appearance"}
            <ChevronRight size={14} stroke={1.5} className={`transition-transform duration-300 ${showAdvancedAppearance ? "-rotate-90" : "rotate-90"}`} />
          </button>
          <AnimatePresence initial={false}>
            {showAdvancedAppearance && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={spring.snappy}
                className="overflow-hidden"
              >
                <div className="space-y-3 pb-1 pt-4">
                  <div>
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-dim">More background moods</div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {advancedModes.map((id) => {
                        const active = settings.theme === id;
                        const meta = ONBOARDING_THEME_META[id];
                        return (
                          <button
                            key={id}
                            onClick={() => onChange({ theme: id })}
                            className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                              active ? "ring-2 ring-accent bg-surface2" : "depth-chip hover:bg-surface2/70"
                            }`}
                          >
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
                  <CompactToggle
                    label="Reduce motion"
                    value={settings.reduceMotion}
                    onChange={(v) => onChange({ reduceMotion: v })}
                  />
                  <CompactToggle
                    label="Film grain"
                    value={settings.grain}
                    onChange={(v) => onChange({ grain: v })}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
        <PrimaryBtn onClick={onNext}>Get started</PrimaryBtn>
      </motion.div>
    </div>
  );
}

// ─── Step 2: Pick AI brain ────────────────────────────────────────────────────

function StepBrain({ modeSelection, setModeSelection, onNext }: {
  modeSelection: "local-single" | "local-dual" | "claude" | "hybrid"; setModeSelection: (b: "local-single" | "local-dual" | "claude" | "hybrid") => void; onNext: () => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="flex w-full flex-col items-center text-center">
      <h2 className="text-3xl font-semibold tracking-tight">Choose where the AI runs</h2>
      <p className="mt-2 max-w-lg text-dim">
        JCut needs an AI model to read your footage and make edits. You can run that model
        <span className="text-ink"> for free on your own Mac</span>, or use Anthropic's Claude in the cloud.
        Either way, your footage never leaves your computer.
      </p>

      <div className="mt-8 -m-2 grid w-full grid-cols-1 gap-4 p-2 lg:grid-cols-2">
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
            { icon: <Check size={15} stroke={1.5} />, text: "Uses your existing Claude login — no API key" },
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
            { icon: <Shield size={15} stroke={1.5} />, text: "100% private — nothing is sent anywhere" },
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
                    { icon: <Cpu size={15} stroke={1.5} />, text: "Local models execute the heavy lifting" },
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
                    { icon: <Shield size={15} stroke={1.5} />, text: "100% private — nothing is sent anywhere" },
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
        Not sure? <span className="text-ink">Start on Single-Local</span> for the simplest private setup — you can switch anytime
        anytime in Settings. Nothing here is permanent.
      </p>

      <PrimaryBtn onClick={onNext}>
        Continue with {modeSelection === "hybrid" ? "Hybrid Mode" : modeSelection === "claude" ? "Claude" : modeSelection === "local-dual" ? "Dual-Local" : "Single-Local"}
      </PrimaryBtn>
    </div>
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

// ─── Step 3a: Connect — Claude ───────────────────────────────────────────────

function StepConnectClaude({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex w-full flex-col items-center text-center">
      <div className="mb-6 grid h-16 w-16 place-items-center rounded-2xl text-white" style={{ background: TEAL_GRADIENT }}>
        <Brain size={32} stroke={1.5} />
      </div>
      <h2 className="text-3xl font-semibold tracking-tight">Connect Claude</h2>
      <p className="mt-2 max-w-sm text-dim">
        JCut uses the Claude CLI to talk to Claude. It rides your existing Anthropic Max session — no API key needed.
      </p>
      <div className="mt-8 w-full space-y-3 text-left">
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
      <PrimaryBtn onClick={onNext}>I'm logged in</PrimaryBtn>
    </div>
  );
}

// ─── Step 3b: Connect — LM Studio ────────────────────────────────────────────

function StepConnectLocal({ settings, onChange, mode, onNext }: { settings: AppSettings; onChange: (p: Partial<AppSettings>) => void; mode: "local-single" | "local-dual"; onNext: () => void }) {
  return (
    <div className="flex w-full flex-col items-center text-center">
      <div className="mb-6 grid h-16 w-16 place-items-center rounded-2xl text-white" style={{ background: BLUE_GRADIENT }}>
        <Cpu size={32} stroke={1.5} />
      </div>
      <h2 className="text-3xl font-semibold tracking-tight">Run the AI on your Mac</h2>
      <p className="mt-2 max-w-md text-dim">
        LM Studio is a free app that runs the AI model locally. You'll download it once,
        load a model, and leave it running in the background. About 15 minutes, mostly downloading.
      </p>
      <div className="mt-8 w-full space-y-3 text-left">
        {[
          { n: 1, title: "Download LM Studio (free)", body: "Grab it from lmstudio.ai — it's a normal Mac app, no account needed." },
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
          New to this? You don't have to finish now — you can skip ahead and set up LM Studio
          later from Settings. JCut will wait. Want the strongest results without the setup?
          You can switch to Claude anytime.
        </span>
      </div>

      <PrimaryBtn onClick={onNext}>Got it — continue</PrimaryBtn>
    </div>
  );
}

// ─── Step 3c: Connect — Hybrid ───────────────────────────────────────────────

function StepConnectHybrid({ settings, onChange, onNext }: { settings: AppSettings; onChange: (p: Partial<AppSettings>) => void; onNext: () => void }) {
  return (
    <div className="flex w-full flex-col items-center text-center">
      <div className="mb-6 flex gap-3">
         <div className="grid h-16 w-16 place-items-center rounded-2xl text-white shadow-glow" style={{ background: TEAL_GRADIENT }}><Brain size={32} stroke={1.5} /></div>
         <div className="grid h-16 w-16 place-items-center rounded-2xl text-white shadow-glow" style={{ background: BLUE_GRADIENT }}><Cpu size={32} stroke={1.5} /></div>
      </div>
      <h2 className="text-3xl font-semibold tracking-tight">Connect Hybrid Mode</h2>
      <p className="mt-2 max-w-md text-dim">
        Hybrid Mode uses Claude for creative direction and your Mac for the heavy lifting. You'll need both set up.
      </p>
      <div className="mt-8 w-full space-y-3 text-left">
        {[
          { n: 1, title: "Install the Claude CLI", body: "Open Terminal and run: npm install -g @anthropic-ai/claude-code, then run claude to log in." },
          { n: 2, title: "Download LM Studio (free)", body: "Grab it from lmstudio.ai — it's a normal Mac app, no account needed." },
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

      <PrimaryBtn onClick={onNext}>Got it — continue</PrimaryBtn>
    </div>
  );
}

// ─── Step 4: Workflow overview ────────────────────────────────────────────────

function StepWorkflow({ onNext }: { onNext: () => void }) {
  const steps = [
    {
      icon: <Folder size={20} stroke={1.5} />,
      title: "Add your footage",
      body: "Drop clips into the Sources panel on the right. JCut only links to them — your original files are never moved, copied, or changed.",
    },
    {
      icon: <Brain size={20} stroke={1.5} />,
      title: "Tell the AI what you want",
      body: "Type a request like “Make a 90-second recap with the best action shots.” The AI watches your clips, reads any transcripts, and decides which moments to use.",
    },
    {
      icon: <Film size={20} stroke={1.5} />,
      title: "It builds a real timeline",
      body: "You get an actual multi-track sequence — cuts, B-roll, captions, music. Keep chatting to refine pacing or swap shots; it edits the timeline as you go.",
    },
    {
      icon: <Sparkle size={20} stroke={1.5} />,
      title: "Export to Premiere Pro",
      body: "When it looks right, export a Premiere .prproj you can open and finish in Premiere Pro — or hand off to an editor. JCut does the heavy lifting; you keep full control.",
    },
  ];

  return (
    <div className="flex w-full flex-col items-center text-center">
      <h2 className="text-3xl font-semibold tracking-tight">How JCut works</h2>
      <p className="mt-2 text-dim">From a pile of clips to an editable timeline — by chatting.</p>

      <div className="mt-8 w-full space-y-3 text-left">
        {steps.map((s, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...spring.soft, delay: i * 0.07 }}
            className="flex gap-4 rounded-xl bg-surface/60 p-4 ring-1 ring-line"
          >
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white" style={{ background: TEAL_GRADIENT }}>
              {s.icon}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold">{s.title}</div>
              <div className="mt-0.5 text-sm text-dim">{s.body}</div>
            </div>
          </motion.div>
        ))}
      </div>

      <PrimaryBtn onClick={onNext}>Let's go</PrimaryBtn>
    </div>
  );
}

// ─── Step 5: Done ─────────────────────────────────────────────────────────────

function StepDone({ onDone }: { onDone: () => void }) {
  return (
    <div className="flex w-full flex-col items-center text-center">
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
        Create your first project, drop in some footage, and tell the AI what you want.
        It builds the timeline — you refine and export to Premiere.
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
