// Settings — full-screen modal with a sidebar nav and categorised panels.
// Sections: AI Brain · Appearance · Chat · Skills · Presets · Workspace · About
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { spring, TEAL_GRADIENT, Mode, Accent, ACCENTS, ACCENT_ORDER,
  Density, FontScale, Radius, UiFont,
  DENSITY_META, FONT_SCALE_META, RADIUS_META, UI_FONT_META } from "./theme";
import type { AppSettings, Backend } from "./jcut";
import iconUrl from "./assets/icon.png";
import { Close, Warning, Plus, Brain, MessageSquare, Sliders, Settings as SettingsIcon, Folder, Film, Refresh, Info, ChevronRight, Sparkle } from "./Icons";
import { THEME_META } from "./theme";
import WorkspacePicker from "./WorkspacePicker";

type Section = "ai" | "appearance" | "chat" | "skills" | "presets" | "workspace" | "about";
type CriteriaToggle = "on" | "off" | "auto";

interface WorkspaceCriteria {
  beat_analysis: CriteriaToggle;
  transcription: CriteriaToggle;
  content_analysis: CriteriaToggle;
  target_platform?: string;
  target_duration_seconds?: number;
  captions_wanted?: boolean;
  music_driven?: boolean;
  notes?: string;
  updated: number;
}

const NAV: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: "ai",         label: "AI Brain",    icon: <Brain size={16} stroke={1.5} /> },
  { id: "appearance", label: "Appearance",  icon: <Sliders size={16} stroke={1.5} /> },
  { id: "chat",       label: "Chat",        icon: <MessageSquare size={16} stroke={1.5} /> },
  { id: "skills",     label: "Skills",      icon: <Sparkle size={16} stroke={1.5} /> },
  { id: "presets",    label: "Presets",     icon: <Film size={16} stroke={1.5} /> },
  { id: "workspace",  label: "Workspace",   icon: <Folder size={16} stroke={1.5} /> },
  { id: "about",      label: "About",       icon: <Info size={16} stroke={1.5} /> },
];

export default function Settings({
  settings, onChange, onClose, mode, setMode, accent, setAccent, onReplayOnboarding,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  onClose: () => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  accent: Accent;
  setAccent: (a: Accent) => void;
  onReplayOnboarding?: () => void;
}) {
  const [section, setSection] = useState<Section>("ai");

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <motion.div
        initial={{ scale: 0.93, y: 20, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.96, y: 10, opacity: 0 }}
        transition={spring.snappy}
        className="no-drag relative flex h-[580px] w-full max-w-3xl overflow-hidden rounded-xl2 depth-card shadow-card shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]"
      >
        {/* Sidebar */}
        <div className="flex w-48 shrink-0 flex-col shadow-[1px_0px_0px_rgba(255,255,255,0.04)] depth-chip py-4">
          <div className="mb-4 flex items-center gap-2.5 px-4">
            <img src={iconUrl} className="h-6 w-6" alt="" />
            <span className="text-sm font-semibold">Settings</span>
          </div>

          <nav className="flex-1 space-y-0.5 px-2">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => setSection(n.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition ${
                  section === n.id
                    ? "bg-surface text-ink shadow-sm shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]"
                    : "text-dim hover:bg-surface hover:text-ink"
                }`}
              >
                <span className="shrink-0">{n.icon}</span>
                {n.label}
              </button>
            ))}
          </nav>

          {/* Replay onboarding at bottom of sidebar */}
          {onReplayOnboarding && (
            <div className="px-2 pt-2 shadow-[0px_-1px_0px_rgba(255,255,255,0.04)] mt-2">
              <button
                onClick={onReplayOnboarding}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-dim hover:bg-surface hover:text-ink"
              >
                <Refresh size={16} stroke={1.5} />
                Setup guide
              </button>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* Close */}
          <button
            onClick={onClose}
            className="absolute right-4 top-4 grid h-7 w-7 place-items-center rounded-full bg-surface2 text-dim shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)] hover:text-ink"
          ><Close size={14} stroke={1.5} /></button>

          <div className="min-h-0 flex-1 overflow-auto px-7 py-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={section}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={spring.soft}
              >
                {section === "ai" && (
                  <AISection settings={settings} onChange={onChange} />
                )}
                {section === "appearance" && (
                  <AppearanceSection mode={mode} setMode={setMode} accent={accent} setAccent={setAccent} settings={settings} onChange={onChange} />
                )}
                {section === "chat" && (
                  <ChatSection settings={settings} onChange={onChange} />
                )}
                {section === "skills" && (
                  <SkillsSection settings={settings} onChange={onChange} />
                )}
                {section === "presets" && (
                  <PresetsSection />
                )}
                {section === "workspace" && (
                  <WorkspaceSection settings={settings} onChange={onChange} />
                )}
                {section === "about" && (
                  <AboutSection onReplayOnboarding={onReplayOnboarding} />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Section heading ────────────────────────────────────────────────────────

function Heading({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {sub && <p className="mt-0.5 text-sm text-dim">{sub}</p>}
    </div>
  );
}

function Row({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 rounded-xl depth-chip px-4 py-3 shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        {sub && <div className="text-xs text-dim">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

// ─── AI Brain ───────────────────────────────────────────────────────────────

function AISection({ settings, onChange }: { settings: AppSettings; onChange: (p: Partial<AppSettings>) => void }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  return (
    <>
      <Heading title="AI Brain" sub="Choose what powers your editor." />

      <div className="mb-4 space-y-4">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-dim">Execution Mode</div>
          <div className="grid grid-cols-2 gap-3">
            {([
              { id: "claude" as const, title: "Claude", sub: "Your Max subscription" },
              { id: "single" as const, title: "Single Local", sub: "One LM Studio model" },
            ]).map((o) => {
              const active =
                !settings.hybridMode &&
                ((o.id === "claude" && settings.backend === "claude") ||
                 (o.id === "single" && settings.backend === "local" && settings.localMode === "single"));
              return (
                <motion.button
                  key={o.id}
                  whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                  onClick={() => onChange({
                    backend: o.id === "claude" ? "claude" : "local",
                    hybridMode: false,
                    ...(o.id === "single" ? { localMode: "single" as const } : {}),
                  })}
                  transition={spring.bouncy}
                  className="rounded-xl2 p-4 text-left shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]"
                  style={active ? { background: TEAL_GRADIENT, color: "#fff" } : { background: "var(--surface-2)" }}
                >
                  <div className="font-medium">{o.title}</div>
                  <div className={`text-xs ${active ? "text-white/80" : "text-dim"}`}>{o.sub}</div>
                </motion.button>
              );
            })}
          </div>
        </div>

        <div>
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-dim transition-colors hover:text-ink"
          >
            {showAdvanced ? "Hide advanced modes" : "Show advanced modes"}
            <ChevronRight size={14} stroke={1.5} className={`transition-transform duration-300 ${showAdvanced ? "-rotate-90" : "rotate-90"}`} />
          </button>
          <AnimatePresence>
            {showAdvanced && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={spring.snappy}
                className="overflow-hidden pt-3"
              >
                <div className="grid grid-cols-2 gap-3">
                  <motion.button
                    whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                    onClick={() => onChange({ backend: "claude", hybridMode: true, localMode: "dual" })}
                    transition={spring.bouncy}
                    className="rounded-xl2 p-4 text-left shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]"
                    style={settings.hybridMode ? { background: TEAL_GRADIENT, color: "#fff" } : { background: "var(--surface-2)" }}
                  >
                    <div className="font-medium">Hybrid Mode</div>
                    <div className={`mt-1 text-xs ${settings.hybridMode ? "text-white/80" : "text-dim"}`}>
                      Claude directs the cut while local models do the heavy lifting.
                    </div>
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                    onClick={() => onChange({ backend: "local", hybridMode: false, localMode: "dual" })}
                    transition={spring.bouncy}
                    className="rounded-xl2 p-4 text-left shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]"
                    style={settings.backend === "local" && settings.localMode === "dual" && !settings.hybridMode ? { background: TEAL_GRADIENT, color: "#fff" } : { background: "var(--surface-2)" }}
                  >
                    <div className="font-medium">Dual Local</div>
                    <div className={`mt-1 text-xs ${settings.backend === "local" && settings.localMode === "dual" && !settings.hybridMode ? "text-white/80" : "text-dim"}`}>
                      Separate coder and vision models in LM Studio.
                    </div>
                  </motion.button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {settings.backend === "claude" ? (
        <ClaudePanel model={settings.claudeModel} onModel={(m) => onChange({ claudeModel: m })} />
      ) : (
        <LMStudioPanel settings={settings} onChange={onChange} />
      )}
    </>
  );
}

function ClaudePanel({ model, onModel }: { model: "opus" | "sonnet"; onModel: (m: "opus" | "sonnet") => void }) {
  const [status, setStatus] = useState<{ available: boolean; version?: string; note: string } | null>(null);
  const [checking, setChecking] = useState(true);
  const [usage, setUsage] = useState<{ utilization: number; resetsAt?: string } | null>(null);

  const check = async () => {
    setChecking(true);
    const s = await window.jcut.claudeStatus();
    setStatus(s); setChecking(false);
  };

  useEffect(() => {
    check();
    return window.jcut.onUsageUpdate((info) => setUsage(info));
  }, []);

  return (
    <div className="space-y-4 pt-2">
      <div className="rounded-xl2 depth-chip p-4 shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]">
        <div className="flex items-center gap-3">
          <span className={`h-2.5 w-2.5 rounded-full ${status?.available ? "bg-emerald-400" : "bg-amber-400"}`} />
          <span className="text-sm font-medium">
            {checking ? "Checking…" : status?.available ? "Connected" : "Not connected"}
          </span>
          {status?.version && <span className="ml-auto text-xs text-dim">{status.version}</span>}
        </div>
        {status?.note && <p className="mt-2 text-sm text-dim">{status.note}</p>}
        <div className="mt-3 flex gap-2">
          <button onClick={check} className="rounded-pill bg-surface px-3 py-1.5 text-sm shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]">Re-check</button>
          {!status?.available && (
            <button onClick={() => window.jcut.claudeLoginHelp()}
              className="rounded-pill px-3 py-1.5 text-sm text-white" style={{ background: TEAL_GRADIENT }}>
              How to log in
            </button>
          )}
        </div>
      </div>

      {usage !== null && (
        <div>
          <div className="mb-1.5 flex justify-between text-xs font-semibold text-dim">
            <span>Session Limit Usage</span>
            <span className={usage.utilization > 0.8 ? "text-amber-400" : "text-emerald-400"}>
              {Math.round(usage.utilization * 100)}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface shadow-inner">
            <motion.div
              className={`h-full rounded-full ${usage.utilization > 0.8 ? "bg-amber-400" : "bg-emerald-400"}`}
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, Math.max(0, usage.utilization * 100))}%` }}
              transition={spring.soft}
            />
          </div>
        </div>
      )}

      <div>
        <div className="mb-1.5 text-xs text-dim">Model</div>
        <div className="grid grid-cols-2 gap-2">
          {([
            { id: "opus" as const, name: "Opus", sub: "Most capable" },
            { id: "sonnet" as const, name: "Sonnet", sub: "Faster" },
          ]).map((m) => {
            const active = model === m.id;
            return (
              <button key={m.id} onClick={() => onModel(m.id)}
                className="rounded-xl2 p-3 text-left shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]"
                style={active ? { background: TEAL_GRADIENT, color: "#fff" } : { background: "var(--surface-2)" }}>
                <div className="text-sm font-medium">{m.name}</div>
                <div className={`text-xs ${active ? "text-white/80" : "text-dim"}`}>{m.sub}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function LMStudioPanel({ settings, onChange }: { settings: AppSettings; onChange: (p: Partial<AppSettings>) => void }) {
  const [url, setUrl] = useState(settings.lmStudioUrl);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; models?: string[]; error?: string; normalizedUrl?: string } | null>(null);

  const test = async () => {
    setTesting(true);
    const r = await window.jcut.lmStudioTest(url);
    setResult(r); setTesting(false);
    const finalUrl = r.normalizedUrl || url;
    setUrl(finalUrl);
    onChange({ lmStudioUrl: finalUrl });
    if (r.ok && r.models?.length) {
      if (!settings.lmStudioCoderModel) onChange({ lmStudioCoderModel: r.models[0] });
      if (!settings.lmStudioVisionModel) onChange({ lmStudioVisionModel: r.models[0] });
    }
  };
  const singleLocal = settings.localMode === "single";

  return (
    <div className="space-y-4 pt-2">
      <div className="rounded-xl2 depth-chip p-4 text-sm text-dim shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]">
        <p className="mb-2 text-ink">Run JCut on a model on your own computer — private and free.</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Open <b className="text-ink">LM Studio</b> and load a tool-calling model (e.g. Qwen2.5-Coder).</li>
          <li>Go to <b className="text-ink">Developer</b> → <b className="text-ink">Start Server</b>.</li>
          <li>Click <b className="text-ink">Test connection</b> below.</li>
        </ol>
      </div>
      <div>
        <label className="text-xs text-dim">Server URL</label>
        <div className="mt-1 flex gap-2">
          <input value={url} onChange={(e) => setUrl(e.target.value)}
            className="flex-1 rounded-xl depth-chip px-3 py-2 text-sm shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)] focus:outline-none" />
          <button onClick={test} disabled={testing}
            className="rounded-xl px-4 py-2 text-sm text-white disabled:opacity-60"
            style={{ background: TEAL_GRADIENT }}>
            {testing ? "Testing…" : "Test connection"}
          </button>
        </div>
      </div>
      {result && (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}
          className="rounded-xl2 depth-chip p-3 text-sm shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]">
          {result.ok ? (
            <>
              <div className="mb-3 flex items-center gap-2 text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-400" /> Connected — {result.models?.length} model(s)
              </div>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-dim">Coder / Tool-calling Model</label>
                  <select value={settings.lmStudioCoderModel || ""} onChange={(e) => onChange({ lmStudioCoderModel: e.target.value })}
                    className="w-full rounded-xl depth-card px-3 py-2 text-sm shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]">
                    <option value="">-- Select a model --</option>
                    {result.models?.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                {singleLocal ? (
                  <div className="rounded-xl depth-card px-3 py-2 text-sm text-dim shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]">
                    Single Local reuses the selected coder model for both reasoning and visual tasks.
                  </div>
                ) : (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-dim">Vision Model</label>
                    <select value={settings.lmStudioVisionModel || ""} onChange={(e) => onChange({ lmStudioVisionModel: e.target.value })}
                      className="w-full rounded-xl depth-card px-3 py-2 text-sm shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]">
                      <option value="">-- Select a model --</option>
                      {result.models?.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                )}
              </div>
              {settings.lmStudioCoderModel && isWeakModel(settings.lmStudioCoderModel) && (
                <p className="mt-3 text-xs text-amber-400">
                  <Warning size={14} stroke={1.5} className="inline mr-1" />
                  The selected Coder model may struggle with tool-calling. Use Qwen or Llama 3.1 instruct instead.
                </p>
              )}
            </>
          ) : (
            <div className="text-amber-400">{result.error}</div>
          )}
        </motion.div>
      )}
    </div>
  );
}

// ─── Appearance ─────────────────────────────────────────────────────────────

function AppearanceSection({ mode, setMode, accent, setAccent, settings, onChange }: {
  mode: Mode; setMode: (m: Mode) => void;
  accent: Accent; setAccent: (a: Accent) => void;
  settings: AppSettings; onChange: (p: Partial<AppSettings>) => void;
}) {
  return (
    <>
      <Heading title="Appearance" sub="Mix any accent color with any background mood — they're independent." />
      <div className="space-y-6">
        {/* ── Accent color ──────────────────────────────────────────────
            The hero control: a live swatch row that repaints the whole app. */}
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-dim">Accent color</div>
            <div className="text-[11px] font-medium text-dim">{ACCENTS[accent]?.label}</div>
          </div>
          <p className="mb-3 text-[12px] text-dim">Drives buttons, toggles, highlights, glows, and a soft background tint.</p>
          <div className="grid grid-cols-6 gap-2.5 sm:grid-cols-12">
            {ACCENT_ORDER.map((id) => {
              const a = ACCENTS[id];
              const active = accent === id;
              return (
                <button
                  key={id}
                  onClick={() => setAccent(id)}
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

        {/* ── Background mood ───────────────────────────────────────────── */}
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-dim">Background mood</div>
          <p className="mb-3 text-[12px] text-dim">Sets the surface palette behind everything.</p>
          <div className="grid grid-cols-3 gap-2">
            {(Object.entries(THEME_META) as [Mode, typeof THEME_META[Mode]][]).map(([id, meta]) => {
              const active = mode === id;
              return (
                <button
                  key={id}
                  onClick={() => setMode(id)}
                  className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                    active ? "ring-2 ring-accent bg-surface2" : "depth-chip hover:bg-surface2/70"
                  }`}
                >
                  <span
                    className="h-4 w-4 shrink-0 rounded-full ring-1 ring-white/10"
                    style={{ background: meta.swatch }}
                  />
                  <span className={`text-[12px] font-medium ${active ? "text-ink" : "text-dim"}`}>{meta.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Live preview strip — shows accent + mood interacting in real UI. */}
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-dim">Preview</div>
          <div className="flex items-center gap-3 rounded-xl2 depth-card p-4">
            <button className="rounded-xl px-4 py-2 text-[13px] font-semibold text-white" style={{ background: TEAL_GRADIENT }}>
              Primary
            </button>
            <span className="rounded-pill px-3 py-1 text-[12px] font-medium" style={{ background: "var(--surface-2)", color: "var(--accent)" }}>
              Accent text
            </span>
            <div className="relative h-6 w-11 shrink-0 rounded-full" style={{ background: "var(--accent)" }}>
              <span className="absolute right-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow" />
            </div>
            <span className="ml-auto h-8 w-8 rounded-full" style={{ background: "var(--accent)", boxShadow: "var(--glow)" }} />
          </div>
        </div>

        {/* ── Display & feel ────────────────────────────────────────────
            Density, text size, roundness, font, motion, grain. Each drives a
            CSS variable, so changes apply across the whole app instantly. */}
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-dim">Display &amp; feel</div>
          <p className="mb-3 text-[12px] text-dim">Tune spacing, size, and texture to taste — applies everywhere.</p>
          <div className="space-y-2">
            <SegRow<Density>
              label="UI density" sub="Spacing throughout the app"
              value={settings.density}
              options={(Object.keys(DENSITY_META) as Density[]).map((id) => ({ id, label: DENSITY_META[id].label }))}
              onChange={(v) => onChange({ density: v })}
            />
            <SegRow<FontScale>
              label="Text size" sub="Scales all text in the app"
              value={settings.fontScale}
              options={(Object.keys(FONT_SCALE_META) as FontScale[]).map((id) => ({ id, label: FONT_SCALE_META[id].label }))}
              onChange={(v) => onChange({ fontScale: v })}
            />
            <SegRow<Radius>
              label="Corners" sub="How rounded everything looks"
              value={settings.radius}
              options={(Object.keys(RADIUS_META) as Radius[]).map((id) => ({ id, label: RADIUS_META[id].label }))}
              onChange={(v) => onChange({ radius: v })}
            />
            <SegRow<UiFont>
              label="Interface font" sub="The typeface used app-wide"
              value={settings.uiFont}
              options={(Object.keys(UI_FONT_META) as UiFont[]).map((id) => ({ id, label: UI_FONT_META[id].label }))}
              onChange={(v) => onChange({ uiFont: v })}
            />
            <Toggle
              label="Reduce motion"
              sub="Turn off springy animations and transitions."
              value={settings.reduceMotion}
              onChange={(v) => onChange({ reduceMotion: v })}
            />
            <Toggle
              label="Film grain"
              sub="A subtle textured overlay for a tactile feel."
              value={settings.grain}
              onChange={(v) => onChange({ grain: v })}
            />
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Chat ────────────────────────────────────────────────────────────────────

function ChatSection({ settings, onChange }: { settings: AppSettings; onChange: (p: Partial<AppSettings>) => void }) {
  return (
    <>
      <Heading title="Chat" sub="Controls how the editor conversation is displayed." />
      <div className="space-y-3">
        <Toggle
          label="Show reasoning"
          sub="See every step the editor takes, not just a summary."
          value={settings.showReasoning}
          onChange={(v) => onChange({ showReasoning: v })}
        />
      </div>
    </>
  );
}

const DEFAULT_CRITERIA: WorkspaceCriteria = {
  beat_analysis: "auto",
  transcription: "auto",
  content_analysis: "auto",
  updated: 0,
};

function SkillsSection({ settings, onChange }: { settings: AppSettings; onChange: (p: Partial<AppSettings>) => void }) {
  const [criteria, setCriteria] = useState<WorkspaceCriteria>(DEFAULT_CRITERIA);
  const [loading, setLoading] = useState(true);
  const [saveNote, setSaveNote] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const r = await window.jcut.jc("criteria-get", ["--workspace", settings.workspace]);
      if (!cancelled) {
        if (r.ok) {
          try {
            const parsed = JSON.parse(r.stdout);
            setCriteria({ ...DEFAULT_CRITERIA, ...(parsed.criteria || {}) });
          } catch {
            setCriteria(DEFAULT_CRITERIA);
          }
        } else {
          setCriteria(DEFAULT_CRITERIA);
        }
        setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [settings.workspace]);

  const saveCriteria = async (patch: Partial<WorkspaceCriteria>) => {
    const next = { ...criteria, ...patch };
    setCriteria(next);
    const args: string[] = ["--workspace", settings.workspace];
    if (patch.beat_analysis) args.push("--beat-analysis", patch.beat_analysis);
    if (patch.transcription) args.push("--transcription", patch.transcription);
    if (patch.content_analysis) args.push("--content-analysis", patch.content_analysis);
    if ("target_platform" in patch) {
      if ((patch.target_platform || "").trim()) args.push("--target-platform", patch.target_platform!.trim());
      else args.push("--target-platform", "");
    }
    if ("target_duration_seconds" in patch) {
      if (patch.target_duration_seconds && patch.target_duration_seconds > 0) {
        args.push("--target-duration", String(patch.target_duration_seconds));
      } else {
        args.push("--target-duration", "0");
      }
    }
    if ("captions_wanted" in patch) args.push("--captions-wanted", patch.captions_wanted == null ? "auto" : String(patch.captions_wanted));
    if ("music_driven" in patch) args.push("--music-driven", patch.music_driven == null ? "auto" : String(patch.music_driven));
    if ("notes" in patch) args.push("--notes", patch.notes || "");
    const r = await window.jcut.jc("criteria-set", args);
    if (r.ok) {
      setSaveNote("Saved to this workspace.");
      setTimeout(() => setSaveNote(""), 1600);
    } else {
      setSaveNote(r.error || "Could not save criteria.");
    }
  };

  return (
    <>
      <Heading title="Skills" sub="Give the quick actions their own defaults and per-workspace rules." />
      <div className="space-y-4">
        <div className="space-y-3 rounded-xl2 depth-chip p-4 shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]">
          <div className="text-xs font-semibold uppercase tracking-wide text-dim">Quick Skill Defaults</div>
          <TextField
            label="Learn my style"
            sub="Default profile name used when you learn a style from your own sequences."
            value={settings.skillStyleName}
            placeholder="default"
            onChange={(value) => onChange({ skillStyleName: value })}
          />
          <TextField
            label="Continue a timeline"
            sub="Optional imported sequence name. Leave blank to keep the Premiere project name."
            value={settings.skillImportName}
            placeholder="Use project filename"
            onChange={(value) => onChange({ skillImportName: value })}
          />
          <TextField
            label="Analyze a project"
            sub="Optional label for Premiere project analyses and saved memory sections."
            value={settings.skillAnalysisName}
            placeholder="Use project filename"
            onChange={(value) => onChange({ skillAnalysisName: value })}
          />
        </div>

        <div className="space-y-3 rounded-xl2 depth-chip p-4 shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-dim">Workspace Skill Criteria</div>
              <div className="mt-1 text-sm text-dim">These rules apply to the current workspace: <span className="text-ink">{settings.workspace}</span>.</div>
            </div>
            {saveNote && <div className="text-xs text-dim">{saveNote}</div>}
          </div>

          {loading ? (
            <div className="text-sm text-dim">Loading workspace criteria…</div>
          ) : (
            <div className="space-y-3">
              <SegRow
                label="Beat analysis"
                sub="Used by music-driven editing and timing-sensitive skills."
                value={criteria.beat_analysis}
                options={[
                  { id: "auto", label: "Auto" },
                  { id: "on", label: "On" },
                  { id: "off", label: "Off" },
                ]}
                onChange={(value) => saveCriteria({ beat_analysis: value })}
              />
              <SegRow
                label="Transcription"
                sub="Controls whether speech-heavy projects should expect transcript-driven work."
                value={criteria.transcription}
                options={[
                  { id: "auto", label: "Auto" },
                  { id: "on", label: "On" },
                  { id: "off", label: "Off" },
                ]}
                onChange={(value) => saveCriteria({ transcription: value })}
              />
              <SegRow
                label="Content analysis"
                sub="Controls whether clip understanding should rely on local visual analysis."
                value={criteria.content_analysis}
                options={[
                  { id: "auto", label: "Auto" },
                  { id: "on", label: "On" },
                  { id: "off", label: "Off" },
                ]}
                onChange={(value) => saveCriteria({ content_analysis: value })}
              />
              <TriBoolRow
                label="Captions wanted"
                sub="Useful when a skill should assume on-screen text is part of the deliverable."
                value={criteria.captions_wanted}
                onChange={(value) => saveCriteria({ captions_wanted: value })}
              />
              <TriBoolRow
                label="Music-driven"
                sub="Tells the editor whether pacing should follow music by default."
                value={criteria.music_driven}
                onChange={(value) => saveCriteria({ music_driven: value })}
              />
              <TextField
                label="Target platform"
                sub="Examples: TikTok, YouTube, Instagram, broadcast."
                value={criteria.target_platform || ""}
                placeholder="Optional"
                onChange={(value) => saveCriteria({ target_platform: value })}
              />
              <NumberField
                label="Target duration (seconds)"
                sub="Used when a skill should aim at a fixed finished length."
                value={criteria.target_duration_seconds}
                onChange={(value) => saveCriteria({ target_duration_seconds: value })}
              />
              <TextAreaField
                label="Notes"
                sub="Freeform direction that skills and the editor should keep in mind."
                value={criteria.notes || ""}
                placeholder="Optional workspace notes"
                onChange={(value) => saveCriteria({ notes: value })}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// A labelled segmented control: title/sub on the left, pill options on the right.
function SegRow<T extends string>({ label, sub, value, options, onChange }: {
  label: string; sub?: string; value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl depth-chip px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {sub && <div className="text-xs text-dim">{sub}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-surface p-0.5">
        {options.map((o) => {
          const active = value === o.id;
          return (
            <button
              key={o.id}
              onClick={() => onChange(o.id)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${active ? "text-white" : "text-dim hover:text-ink"}`}
              style={active ? { background: TEAL_GRADIENT } : undefined}
            >{o.label}</button>
          );
        })}
      </div>
    </div>
  );
}

function TriBoolRow({ label, sub, value, onChange }: {
  label: string;
  sub?: string;
  value?: boolean;
  onChange: (value: boolean | undefined) => void;
}) {
  const selected = value == null ? "auto" : value ? "yes" : "no";
  return (
    <SegRow
      label={label}
      sub={sub}
      value={selected}
      options={[
        { id: "auto", label: "Auto" },
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ]}
      onChange={(next) => onChange(next === "auto" ? undefined : next === "yes")}
    />
  );
}

function TextField({ label, sub, value, placeholder, onChange }: {
  label: string;
  sub?: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-sm font-medium">{label}</div>
      {sub && <div className="mb-2 text-xs text-dim">{sub}</div>}
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg bg-surface px-3 py-2 text-sm shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)] focus:outline-none"
      />
    </label>
  );
}

function NumberField({ label, sub, value, onChange }: {
  label: string;
  sub?: string;
  value?: number;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-sm font-medium">{label}</div>
      {sub && <div className="mb-2 text-xs text-dim">{sub}</div>}
      <input
        type="number"
        min={0}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
        className="w-full rounded-lg bg-surface px-3 py-2 text-sm shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)] focus:outline-none"
      />
    </label>
  );
}

function TextAreaField({ label, sub, value, placeholder, onChange }: {
  label: string;
  sub?: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-sm font-medium">{label}</div>
      {sub && <div className="mb-2 text-xs text-dim">{sub}</div>}
      <textarea
        rows={3}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full resize-none rounded-lg bg-surface px-3 py-2 text-sm shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)] focus:outline-none"
      />
    </label>
  );
}

function Toggle({ label, sub, value, onChange }: {
  label: string; sub?: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <button onClick={() => onChange(!value)}
      className="flex w-full items-center gap-3 rounded-xl depth-chip px-4 py-3 text-left shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]">
      <div className="relative h-6 w-11 shrink-0 rounded-full transition"
           style={{ background: value ? "var(--accent)" : "var(--surface)" }}>
        <motion.div layout className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow"
          style={{ left: value ? 22 : 2 }} transition={spring.bouncy} />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {sub && <div className="text-xs text-dim">{sub}</div>}
      </div>
    </button>
  );
}

// ─── Presets ─────────────────────────────────────────────────────────────────

function PresetsSection() {
  const [presets, setPresets] = useState<{ id: string; name: string; description: string }[]>([]);
  const [modes, setModes] = useState<{ id: string; name: string }[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", base: "", instructions: "" });

  const refresh = async () => {
    const r = await window.jcut.jc("modes-list", []);
    if (r.ok) { try { const j = JSON.parse(r.stdout); setPresets(j.presets || []); setModes(j.modes || []); } catch { /* */ } }
  };
  useEffect(() => { refresh(); }, []);

  const save = async () => {
    if (!form.name.trim() || !form.instructions.trim()) return;
    const id = form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const args = ["--id", id, "--name", form.name, "--instructions", form.instructions];
    if (form.base) args.push("--base-mode", form.base);
    await window.jcut.jc("preset-save", args);
    setForm({ name: "", base: "", instructions: "" }); setCreating(false);
    refresh();
  };
  const del = async (id: string) => { await window.jcut.jc("preset-delete", ["--id", id]); refresh(); };

  return (
    <>
      <Heading title="Editing Presets" sub="Save your own editing styles and apply them from the Mode menu." />
      <div className="space-y-2">
        {presets.map((p) => (
          <div key={p.id} className="flex items-center gap-2 rounded-xl depth-chip px-3 py-2.5 shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{p.name}</div>
              {p.description && <div className="truncate text-xs text-dim">{p.description}</div>}
            </div>
            <button onClick={() => del(p.id)} className="shrink-0 text-dim hover:text-red-400">
              <Close size={12} stroke={1.5} />
            </button>
          </div>
        ))}

        {creating ? (
          <div className="space-y-2 rounded-xl2 depth-chip p-3 shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]">
            <input autoFocus placeholder="Preset name (e.g. My TikTok Style)"
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-lg bg-surface px-3 py-2 text-sm shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)] focus:outline-none" />
            <select value={form.base} onChange={(e) => setForm({ ...form, base: e.target.value })}
              className="w-full rounded-lg bg-surface px-3 py-2 text-sm shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]">
              <option value="">Start from scratch</option>
              {modes.map((m) => <option key={m.id} value={m.id}>Extend: {m.name}</option>)}
            </select>
            <textarea placeholder="Editing instructions — how should JCut cut in this style?"
              value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })}
              rows={3} className="w-full resize-none rounded-lg bg-surface px-3 py-2 text-sm shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)] focus:outline-none" />
            <div className="flex gap-2">
              <button onClick={save} className="rounded-pill px-4 py-1.5 text-sm text-white" style={{ background: TEAL_GRADIENT }}>Save</button>
              <button onClick={() => setCreating(false)} className="rounded-pill bg-surface px-4 py-1.5 text-sm shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]">Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-pill depth-chip px-3 py-1.5 text-sm text-ink shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]">
            <Plus size={14} stroke={1.5} /> New preset
          </button>
        )}
      </div>
    </>
  );
}

// ─── Workspace ───────────────────────────────────────────────────────────────

function WorkspaceSection({ settings, onChange }: { settings: AppSettings; onChange: (p: Partial<AppSettings>) => void }) {
  return (
    <>
      <Heading title="Workspace" sub="Where your projects and media links are stored." />
      <WorkspacePicker value={settings.workspace} onChange={(ws) => onChange({ workspace: ws })} />
      <p className="mt-2 text-xs text-dim">Projects live under ~/Documents/JCutAI.</p>
    </>
  );
}

// ─── About ───────────────────────────────────────────────────────────────────

function AboutSection({ onReplayOnboarding }: { onReplayOnboarding?: () => void }) {
  return (
    <>
      <Heading title="About JCut.AI" />
      <div className="flex flex-col items-center gap-4 py-4">
        <img src={iconUrl} className="h-16 w-16" alt="JCut.AI" />
        <div className="text-center">
          <div className="flex items-center justify-center gap-2">
            <span className="text-lg font-semibold">JCut.AI</span>
            <span className="rounded-pill bg-accent/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-accent ring-1 ring-accent/25">Beta</span>
          </div>
          <div className="text-sm text-dim">Version 0.1.0 · Beta</div>
        </div>
        <p className="max-w-sm text-center text-sm text-dim">
          An AI video editor that understands your footage and cuts it for you.
          Built on Claude and FFmpeg.
        </p>
        <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-left text-[12px] text-amber-300 ring-1 ring-amber-500/20">
          <Warning size={14} stroke={1.5} className="mt-px shrink-0" />
          This is beta software under active development. Expect bugs and changes between
          updates, and keep independent backups of your footage.
        </p>
        {onReplayOnboarding && (
          <button
            onClick={onReplayOnboarding}
            className="flex items-center gap-2 rounded-pill bg-surface2 px-5 py-2 text-sm shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)] hover:text-ink"
          >
            <Refresh size={14} stroke={1.5} /> Replay setup guide
          </button>
        )}
      </div>
    </>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isWeakModel(id: string): boolean {
  return /\bembed|embedding|obliterat|uncensor|abliterat/.test(id.toLowerCase());
}
