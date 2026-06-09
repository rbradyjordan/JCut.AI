// "Skills" chips — quick actions shown above the chat bar under a Skills header.
// These are the lightweight, conversational capabilities (learn style, memory,
// import prproj). Heavier timeline actions (render) stay in the timeline panel.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { spring } from "./theme";
import { Sparkle, Brain, ArrowLoop, Clapper, Close, Settings as SettingsIcon } from "./Icons";
import type { AppSettings } from "./jcut";

type Modal = null | "style" | "memory" | "prproj" | "continue";
type SkillPayload = Record<string, any>;
type SkillMenu = Exclude<Modal, "memory" | null> | null;
type MenuPosition = { left: number; top: number; bottom: number };

interface SkillDefinition {
  id: Exclude<Modal, null>;
  label: string;
  title: string;
  icon: React.ReactNode;
  hasMenu?: boolean;
  run: () => Promise<SkillPayload>;
}

export default function Skills({ workspace, settings, onSettingsChange, onChanged, onImported }: {
  workspace: string;
  settings: AppSettings;
  onSettingsChange: (patch: Partial<AppSettings>) => void;
  onChanged?: () => void;
  onImported?: (a: { name: string; path: string; resolution?: string }) => void;
}) {
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [payload, setPayload] = useState<SkillPayload | null>(null);
  const [menu, setMenu] = useState<SkillMenu>(null);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => {
      setMenu(null);
      setMenuPosition(null);
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  const run = async (skill: SkillDefinition) => {
    setBusy(skill.id);
    setPayload(null);
    setModal(skill.id);
    try {
      setPayload(await skill.run());
    } catch (error: any) {
      setPayload({
        error: error?.message || `The "${skill.label}" skill failed unexpectedly.`,
      });
    } finally {
      setBusy(null);
    }
  };

  const runJcJson = async (
    command: string,
    args: string[],
    validate?: (data: SkillPayload) => string | null,
  ): Promise<SkillPayload> => {
    const result = await window.jcut.jc(command, args);
    if (!result.ok) return { ok: false, error: result.error || `${command} failed.` };

    let parsed: SkillPayload;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      return {
        ok: false,
        error: `${command} returned an unreadable response. The app stopped safely instead of guessing.`,
      };
    }

    if (!parsed || typeof parsed !== "object") {
      return { ok: false, error: `${command} returned an invalid payload.` };
    }
    if (parsed.ok === false && typeof parsed.error === "string") return parsed;

    const validationError = validate?.(parsed);
    if (validationError) return { ...parsed, ok: false, error: validationError };
    return parsed;
  };

  const pickPrproj = async (): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> => {
    const picked = await window.jcut.pickPrproj();
    if (!picked.ok || !picked.path) return { ok: false, canceled: true, error: "No project selected." };
    return picked;
  };

  const skills: SkillDefinition[] = [
    {
      id: "style",
      label: "Learn my style",
      title: "Learned Style",
      icon: <Sparkle size={14} stroke={1.5} />,
      hasMenu: true,
      run: () => {
        const args = ["--workspace", workspace];
        const styleName = settings.skillStyleName.trim();
        if (styleName) args.push("--name", styleName);
        return runJcJson("style-learn", args, (data) =>
          data.profile ? null : "Style learning finished without a profile.",
        );
      },
    },
    {
      id: "memory",
      label: "Memory",
      title: "Workspace Memory",
      icon: <Brain size={14} stroke={1.5} />,
      run: () => runJcJson("memory-read", ["--workspace", workspace], (data) =>
        typeof data.memory === "string" ? null : "Memory read finished without any text.",
      ),
    },
    {
      id: "continue",
      label: "Continue a timeline",
      title: "Timeline Imported",
      icon: <ArrowLoop size={14} stroke={1.5} />,
      hasMenu: true,
      run: async () => {
        const picked = await pickPrproj();
        if (!picked.ok || !picked.path) return { error: picked.error, canceled: picked.canceled };
        const args = ["--workspace", workspace, "--file", picked.path];
        const importName = settings.skillImportName.trim();
        if (importName) args.push("--name", importName);
        const data = await runJcJson(
          "sequence-import-prproj",
          args,
          (res) => res.sequence_id && res.name ? null : "Timeline import finished without a sequence id.",
        );
        if (!data.error) {
          onChanged?.();
          onImported?.({ name: data.name, path: picked.path, resolution: data.resolution });
        }
        return data;
      },
    },
    {
      id: "prproj",
      label: "Analyze a project",
      title: "Imported Premiere Project",
      icon: <Clapper size={14} stroke={1.5} />,
      hasMenu: true,
      run: async () => {
        const picked = await pickPrproj();
        if (!picked.ok || !picked.path) return { error: picked.error, canceled: picked.canceled };
        const args = ["--workspace", workspace, "--file", picked.path];
        const analysisName = settings.skillAnalysisName.trim();
        if (analysisName) args.push("--name", analysisName);
        return runJcJson(
          "prproj-analyze",
          args,
          (data) => data.profile ? null : "Project analysis finished without a learned profile.",
        );
      },
    },
  ];

  return (
    <>
      <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-dim">Skills</div>
      <div className="mb-2 flex flex-wrap gap-2">
        {skills.map((skill) => (
          <div key={skill.id} className="relative">
            <motion.div
              whileHover={{ scale: 1.05, y: -1 }} whileTap={{ scale: 0.98 }} transition={spring.bouncy}
              className="no-drag flex items-center overflow-hidden rounded-pill depth-chip text-sm text-ink shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]"
            >
              <button
                onClick={() => run(skill)}
                disabled={busy !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 disabled:opacity-50"
              >
                <span className="shrink-0">{skill.icon}</span>
                <span>{busy === skill.id ? "Working…" : skill.label}</span>
              </button>
              {skill.hasMenu && (
                <button
                  onClick={(e) => {
                    if (menu === skill.id) {
                      setMenu(null);
                      setMenuPosition(null);
                      return;
                    }
                    const rect = e.currentTarget.getBoundingClientRect();
                    setMenu(skill.id);
                    setMenuPosition({ left: rect.left, top: rect.bottom + 8, bottom: rect.top - 8 });
                  }}
                  disabled={busy !== null}
                  className="border-l border-white/5 px-2 py-1.5 text-dim hover:text-ink disabled:opacity-50"
                  title={`${skill.label} options`}
                >
                  <SettingsIcon size={12} stroke={1.5} />
                </button>
              )}
            </motion.div>

            {menu === skill.id && (
              <>
                <div className="fixed inset-0 z-[90]" onClick={() => setMenu(null)} />
                {menuPosition && createPortal(
                  <div
                    className="fixed z-[95] w-72 max-w-[calc(100vw-1.5rem)] overflow-auto rounded-xl2 depth-card p-3 shadow-card"
                    style={popoverStyle(menuPosition)}
                  >
                    {skill.id === "style" && (
                      <SkillTextSetting
                        label="Style profile name"
                        sub='Saved as a named learned style in memory and `analysis/style_*.json`.'
                        value={settings.skillStyleName}
                        placeholder="default"
                        onChange={(value) => onSettingsChange({ skillStyleName: value })}
                        onReset={() => onSettingsChange({ skillStyleName: "default" })}
                      />
                    )}
                    {skill.id === "continue" && (
                      <SkillTextSetting
                        label="Imported timeline name"
                        sub="Optional override. Leave blank to use the Premiere project name."
                        value={settings.skillImportName}
                        placeholder="Use project filename"
                        onChange={(value) => onSettingsChange({ skillImportName: value })}
                        onReset={() => onSettingsChange({ skillImportName: "" })}
                      />
                    )}
                    {skill.id === "prproj" && (
                      <SkillTextSetting
                        label="Analysis label"
                        sub="Optional label for memory and the analyzed project summary."
                        value={settings.skillAnalysisName}
                        placeholder="Use project filename"
                        onChange={(value) => onSettingsChange({ skillAnalysisName: value })}
                        onReset={() => onSettingsChange({ skillAnalysisName: "" })}
                      />
                    )}
                  </div>,
                  document.body,
                )}
              </>
            )}
          </div>
        ))}
      </div>

      <AnimatePresence>
        {modal && (
          <Modal title={skills.find((skill) => skill.id === modal)?.title || titleFor(modal)} onClose={() => setModal(null)} loading={busy === modal}>
            {modal === "style" && <StyleResult data={payload} />}
            {modal === "memory" && <MemoryResult data={payload} />}
            {modal === "prproj" && <PrprojResult data={payload} />}
            {modal === "continue" && <ContinueResult data={payload} />}
          </Modal>
        )}
      </AnimatePresence>
    </>
  );
}

function popoverStyle(pos: MenuPosition): React.CSSProperties {
  const width = Math.min(288, window.innerWidth - 24);
  const left = Math.max(12, Math.min(pos.left, window.innerWidth - 12 - width));
  const estimatedHeight = 220;
  const spaceBelow = window.innerHeight - pos.top - 12;
  const spaceAbove = pos.bottom - 12;
  const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;

  if (openUp) {
    return {
      left,
      bottom: Math.max(12, window.innerHeight - pos.bottom),
      maxHeight: Math.max(120, spaceAbove),
    };
  }

  return {
    left,
    top: Math.max(12, Math.min(pos.top, window.innerHeight - 12 - Math.min(estimatedHeight, spaceBelow))),
    maxHeight: Math.max(120, spaceBelow),
  };
}

function SkillTextSetting({ label, sub, value, placeholder, onChange, onReset }: {
  label: string;
  sub: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium text-ink">{label}</div>
        <div className="mt-0.5 text-xs text-dim">{sub}</div>
      </div>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg bg-surface px-3 py-2 text-sm shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)] focus:outline-none"
      />
      <div className="flex justify-end">
        <button onClick={onReset} className="text-xs text-dim hover:text-ink">Reset</button>
      </div>
    </div>
  );
}

function titleFor(m: Modal) {
  return m === "style" ? "Learned Style" : m === "memory" ? "Workspace Memory"
    : m === "continue" ? "Timeline Imported" : "Imported Premiere Project";
}

function ContinueResult({ data }: { data: any }) {
  if (!data) return null;
  if (data.canceled) return <p className="text-dim">No project selected.</p>;
  if (data.error) return <p className="text-amber-400">{data.error}</p>;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-emerald-400">
        <span className="h-2 w-2 rounded-full bg-emerald-400" /> Imported as an editable timeline
      </div>
      <p className="text-sm">
        <b>{data.name}</b> — {data.imported_clips} of {data.total_found} clips.
      </p>
      {data.unresolved_sources?.length > 0 && (
        <p className="text-xs text-amber-400">
          {data.unresolved_sources.length} source(s) are offline (on an external drive). Reconnect the
          drive and the footage will relink. The timeline structure is preserved.
        </p>
      )}
      <p className="text-sm text-dim">{data.note || "Open it and tell JCut how to continue."}</p>
    </div>
  );
}

function Modal({ title, onClose, loading, children }: {
  title: string; onClose: () => void; loading: boolean; children: React.ReactNode;
}) {
  // Portal to <body> so the overlay escapes the editor's stacking contexts
  // (the right Sources/Timeline panel uses backdrop-blur + transforms, which
  // would otherwise paint over this dialog and swallow its clicks).
  return createPortal(
    <motion.div className="fixed inset-0 z-[100] flex items-center justify-center p-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.92, y: 24, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.95, y: 12, opacity: 0 }} transition={spring.snappy}
        className="relative max-h-[84vh] w-full max-w-lg overflow-auto rounded-xl2 depth-card p-6 shadow-card shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]">
        <div className="mb-4 flex items-center">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="ml-auto text-dim hover:text-ink"><Close size={14} stroke={1.5} /></button>
        </div>
        {loading ? <Spinner /> : children}
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <motion.div className="h-8 w-8 rounded-full border-2 border-dim border-t-transparent"
        animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }} />
    </div>
  );
}

function ErrOrEmpty({ data, empty }: { data: any; empty: string }) {
  if (data?.error) return <p className="text-amber-400">{data.error}</p>;
  return <p className="text-dim">{empty}</p>;
}

function StyleResult({ data }: { data: any }) {
  if (!data) return null;
  const p = data.profile;
  if (!p) return <ErrOrEmpty data={data} empty="No sequences to learn from yet — build a cut first." />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-dim">Learned from {data.learned_from?.join(", ") || "your edits"}.</p>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Pace" value={`${p.typical_cuts_per_minute}/min`} />
        <Stat label="Typical shot" value={`${p.typical_shot_seconds}s`} />
        <Stat label="Fast cut" value={`${p.fast_cut_seconds}s`} />
        <Stat label="B-roll overlay" value={`${Math.round(p.typical_broll_overlay_ratio * 100)}%`} />
      </div>
      <ul className="space-y-1 text-sm">
        {p.notes?.map((n: string, i: number) => <li key={i}>• {n}</li>)}
      </ul>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl depth-chip p-3 shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]">
      <div className="text-xs text-dim">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
function MemoryResult({ data }: { data: any }) {
  if (!data) return null;
  const text: string = data.memory || "";
  if (data.error || !text.trim())
    return <ErrOrEmpty data={data} empty="No memory yet — the editor records findings as it works." />;
  return <pre className="whitespace-pre-wrap rounded-xl depth-chip p-4 text-sm leading-relaxed shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]">{text}</pre>;
}
function PrprojResult({ data }: { data: any }) {
  if (!data) return null;
  if (data.canceled) return <p className="text-dim">No project selected.</p>;
  if (data.error) return <p className="text-amber-400">{data.error}</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-dim">{data.summary || "Analyzed."}</p>
      {data.profile?.notes && (
        <ul className="space-y-1 text-sm">{data.profile.notes.map((n: string, i: number) => <li key={i}>• {n}</li>)}</ul>
      )}
    </div>
  );
}
