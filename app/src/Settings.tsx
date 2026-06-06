// Settings panel — backend switcher (Claude vs LM Studio), Claude connection
// status (reuses CLI login), and easy-to-understand LM Studio setup with a
// connection test + model picker. Slides in as a springy sheet.
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { spring, TEAL_GRADIENT, Mode } from "./theme";
import type { AppSettings, Backend } from "./jcut";
import iconUrl from "./assets/icon.png";
import WorkspacePicker from "./WorkspacePicker";

export default function Settings({
  settings, onChange, onClose, mode, setMode,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  onClose: () => void;
  mode: Mode;
  setMode: (m: Mode) => void;
}) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.92, y: 24, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.95, y: 12, opacity: 0 }}
        transition={spring.snappy}
        className="no-drag relative max-h-[86vh] w-full max-w-xl overflow-auto rounded-xl2 bg-surface p-6 shadow-card ring-1 ring-line"
      >
        <div className="mb-5 flex items-center gap-3">
          <img src={iconUrl} className="h-8 w-8" alt="" />
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="ml-auto rounded-full px-3 py-1 text-dim hover:text-ink">✕</button>
        </div>

        <Section title="AI Brain">
          <p className="mb-3 text-sm text-dim">Choose what powers your editor.</p>
          <BackendPicker value={settings.backend} onChange={(b) => onChange({ backend: b })} />
        </Section>

        {settings.backend === "claude" ? (
          <ClaudePanel />
        ) : (
          <LMStudioPanel settings={settings} onChange={onChange} />
        )}

        <Section title="Appearance">
          <div className="flex gap-2">
            {(["dark", "light"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-pill px-4 py-2 text-sm capitalize ring-1 ring-line ${
                  mode === m ? "text-white" : "bg-surface2 text-ink"
                }`}
                style={mode === m ? { background: TEAL_GRADIENT } : undefined}
              >
                {m}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Chat">
          <button
            onClick={() => onChange({ showReasoning: !settings.showReasoning })}
            className="flex w-full items-center gap-3 rounded-xl bg-surface2 px-3 py-2.5 text-left ring-1 ring-line"
          >
            <div className="relative h-6 w-11 shrink-0 rounded-full transition"
                 style={{ background: settings.showReasoning ? "var(--accent)" : "var(--surface)" }}>
              <motion.div layout className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow"
                style={{ left: settings.showReasoning ? 22 : 2 }} transition={spring.bouncy} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-ink">Show reasoning</div>
              <div className="text-xs text-dim">See every step the editor takes, not just a summary.</div>
            </div>
          </button>
        </Section>

        <Section title="Editing Presets">
          <PresetManager />
        </Section>

        <Section title="Workspace">
          <WorkspacePicker value={settings.workspace} onChange={(ws) => onChange({ workspace: ws })} />
          <p className="mt-2 text-xs text-dim">Projects live under ~/Documents/JCutAI.</p>
        </Section>
      </motion.div>
    </motion.div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-dim">{title}</h3>
      {children}
    </div>
  );
}

function BackendPicker({ value, onChange }: { value: Backend; onChange: (b: Backend) => void }) {
  const opts: { id: Backend; title: string; sub: string }[] = [
    { id: "claude", title: "Claude", sub: "Your Max subscription" },
    { id: "local", title: "Local (LM Studio)", sub: "Runs on your machine" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3">
      {opts.map((o) => {
        const active = value === o.id;
        return (
          <motion.button
            key={o.id}
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={() => onChange(o.id)}
            transition={spring.bouncy}
            className="rounded-xl2 p-4 text-left ring-1 ring-line"
            style={active ? { background: TEAL_GRADIENT, color: "#fff" } : { background: "var(--surface-2)" }}
          >
            <div className="font-medium">{o.title}</div>
            <div className={`text-xs ${active ? "text-white/80" : "text-dim"}`}>{o.sub}</div>
          </motion.button>
        );
      })}
    </div>
  );
}

function ClaudePanel() {
  const [status, setStatus] = useState<{ available: boolean; version?: string; note: string } | null>(null);
  const [checking, setChecking] = useState(true);
  const check = async () => {
    setChecking(true);
    const s = await window.jcut.claudeStatus();
    setStatus(s); setChecking(false);
  };
  useEffect(() => { check(); }, []);

  return (
    <Section title="Claude Connection">
      <div className="rounded-xl2 bg-surface2 p-4 ring-1 ring-line">
        <div className="flex items-center gap-3">
          <span className={`h-2.5 w-2.5 rounded-full ${status?.available ? "bg-emerald-400" : "bg-amber-400"}`} />
          <span className="font-medium">
            {checking ? "Checking…" : status?.available ? "Connected" : "Not connected"}
          </span>
          {status?.version && <span className="ml-auto text-xs text-dim">{status.version}</span>}
        </div>
        <p className="mt-2 text-sm text-dim">{status?.note}</p>
        <div className="mt-3 flex gap-2">
          <button onClick={check} className="rounded-pill bg-surface px-3 py-1.5 text-sm ring-1 ring-line">
            Re-check
          </button>
          {!status?.available && (
            <button
              onClick={() => window.jcut.claudeLoginHelp()}
              className="rounded-pill px-3 py-1.5 text-sm text-white"
              style={{ background: TEAL_GRADIENT }}
            >
              How to log in
            </button>
          )}
        </div>
      </div>
    </Section>
  );
}

// User preset manager — create named editing styles (optionally extending a mode).
function PresetManager() {
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
    <div className="space-y-2">
      <p className="text-sm text-dim">
        Save your own editing styles. Pick one from the Mode menu to apply it to every edit.
      </p>
      {presets.map((p) => (
        <div key={p.id} className="flex items-center gap-2 rounded-xl bg-surface2 px-3 py-2 ring-1 ring-line">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{p.name}</div>
            {p.description && <div className="truncate text-xs text-dim">{p.description}</div>}
          </div>
          <button onClick={() => del(p.id)} className="text-dim hover:text-red-400">✕</button>
        </div>
      ))}

      {creating ? (
        <div className="space-y-2 rounded-xl2 bg-surface2 p-3 ring-1 ring-line">
          <input
            autoFocus placeholder="Preset name (e.g. My TikTok Style)"
            value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full rounded-lg bg-surface px-3 py-2 text-sm ring-1 ring-line focus:outline-none"
          />
          <select
            value={form.base} onChange={(e) => setForm({ ...form, base: e.target.value })}
            className="w-full rounded-lg bg-surface px-3 py-2 text-sm ring-1 ring-line"
          >
            <option value="">Start from scratch</option>
            {modes.map((m) => <option key={m.id} value={m.id}>Extend: {m.name}</option>)}
          </select>
          <textarea
            placeholder="Editing instructions — how should JCut cut in this style?"
            value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })}
            rows={3}
            className="w-full resize-none rounded-lg bg-surface px-3 py-2 text-sm ring-1 ring-line focus:outline-none"
          />
          <div className="flex gap-2">
            <button onClick={save} className="rounded-pill px-4 py-1.5 text-sm text-white" style={{ background: TEAL_GRADIENT }}>Save</button>
            <button onClick={() => setCreating(false)} className="rounded-pill bg-surface px-4 py-1.5 text-sm ring-1 ring-line">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setCreating(true)} className="rounded-pill bg-surface2 px-3 py-1.5 text-sm text-ink ring-1 ring-line">
          ＋ New preset
        </button>
      )}
    </div>
  );
}

// Flag ONLY genuinely broken models — never penalize small official models.
// "obliterated"/uncensored variants have damaged instruction-tuning; embedding
// models can't chat. Everything else (gemma, qwen, llama, phi, mistral of any
// size) is supported — the agent loop is tuned to work with small models.
function isWeakModel(id: string): boolean {
  const s = id.toLowerCase();
  return /\bembed|embedding|obliterat|uncensor|abliterat/.test(s);
}

function LMStudioPanel({
  settings, onChange,
}: { settings: AppSettings; onChange: (p: Partial<AppSettings>) => void }) {
  const [url, setUrl] = useState(settings.lmStudioUrl);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; models?: string[]; error?: string } | null>(null);

  const test = async () => {
    setTesting(true);
    const r = await window.jcut.lmStudioTest(url);
    setResult(r); setTesting(false);
    // Persist the NORMALIZED url (with /v1) so the agent connects correctly.
    const finalUrl = r.normalizedUrl || url;
    setUrl(finalUrl);
    onChange({ lmStudioUrl: finalUrl });
    if (r.ok && r.models?.length && !settings.lmStudioModel) {
      onChange({ lmStudioModel: r.models[0] });
    }
  };

  return (
    <Section title="LM Studio (Local Model)">
      {/* Plain-language explainer */}
      <div className="mb-3 rounded-xl2 bg-surface2 p-4 text-sm text-dim ring-1 ring-line">
        <p className="mb-2 text-ink">Run JCut on a model on your own computer — private and free.</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Open <b className="text-ink">LM Studio</b> and load a tool-calling model (e.g. Qwen2.5-Coder).</li>
          <li>Go to the <b className="text-ink">Developer</b> tab → <b className="text-ink">Start Server</b>.</li>
          <li>Click <b className="text-ink">Test connection</b> below.</li>
        </ol>
        <button
          onClick={() => window.open("https://lmstudio.ai", "_blank")}
          className="mt-2 text-accent underline"
        >
          Download LM Studio
        </button>
      </div>

      <label className="text-xs text-dim">Server URL</label>
      <div className="mt-1 flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 rounded-xl bg-surface2 px-3 py-2 text-sm text-ink ring-1 ring-line focus:outline-none"
        />
        <button
          onClick={test}
          disabled={testing}
          className="rounded-xl px-4 py-2 text-sm text-white disabled:opacity-60"
          style={{ background: TEAL_GRADIENT }}
        >
          {testing ? "Testing…" : "Test connection"}
        </button>
      </div>

      {result && (
        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}
          className="mt-3 rounded-xl2 p-3 text-sm ring-1 ring-line"
          style={{ background: "var(--surface-2)" }}
        >
          {result.ok ? (
            <>
              <div className="mb-2 flex items-center gap-2 text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-400" /> Connected — {result.models?.length} model(s)
              </div>
              <label className="text-xs text-dim">Model</label>
              <select
                value={settings.lmStudioModel || ""}
                onChange={(e) => onChange({ lmStudioModel: e.target.value })}
                className="mt-1 w-full rounded-xl bg-surface px-3 py-2 text-sm text-ink ring-1 ring-line"
              >
                {result.models?.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              {settings.lmStudioModel && isWeakModel(settings.lmStudioModel) && (
                <p className="mt-2 text-xs text-amber-400">
                  ⚠️ This model may struggle with tool-calling (needed to drive edits).
                  For best results use a coder/instruct model like Qwen or Llama 3.1.
                  Avoid “obliterated”/uncensored variants.
                </p>
              )}
            </>
          ) : (
            <div className="text-amber-400">{result.error}</div>
          )}
        </motion.div>
      )}
    </Section>
  );
}
