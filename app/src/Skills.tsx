// "Skills" chips — quick actions shown above the chat bar under a Skills header.
// These are the lightweight, conversational capabilities (learn style, memory,
// import prproj). Heavier timeline actions (render) stay in the timeline panel.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { spring } from "./theme";
import { Sparkle, Brain, ArrowLoop, Clapper, Close, Settings as SettingsIcon, Scissors, Columns, Mobile } from "./Icons";
import type { AppSettings } from "./jcut";

type Modal = null | "style" | "memory" | "prproj" | "continue" | "jumpcut" | "multicam" | "socialclips";
type SkillPayload = Record<string, any>;
type SkillMenu = Exclude<Modal, "memory" | "jumpcut" | "multicam" | "socialclips" | null> | null;
// Note: "multicam" is handled by PodcastEditor full-screen — the modal case is intentionally unused.
type MenuPosition = { left: number; top: number; bottom: number };

interface SkillDefinition {
  id: Exclude<Modal, null>;
  label: string;
  title: string;
  icon: React.ReactNode;
  hasMenu?: boolean;
  run: () => Promise<SkillPayload>;
}

export default function Skills({ workspace, seqId, settings, onSettingsChange, onChanged, onImported, onOpenPodcastEditor }: {
  workspace: string;
  seqId: string | null;
  settings: AppSettings;
  onSettingsChange: (patch: Partial<AppSettings>) => void;
  onChanged?: () => void;
  onImported?: (a: { name: string; path: string; resolution?: string }) => void;
  onOpenPodcastEditor?: () => void;
}) {
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [payload, setPayload] = useState<SkillPayload | null>(null);
  const [menu, setMenu] = useState<SkillMenu>(null);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  // Jump Cut Editor state
  const [jcThreshold, setJcThreshold] = useState("-40");
  const [jcMinSilence, setJcMinSilence] = useState("0.3");
  const [jcPreBuffer, setJcPreBuffer] = useState("0.15");
  const [jcPostBuffer, setJcPostBuffer] = useState("0.1");
  const [jcAudioTrack, setJcAudioTrack] = useState("A1");
  const [jcDryRun, setJcDryRun] = useState(true);


  // Social Clips state
  const [scOrientations, setScOrientations] = useState<string[]>(["vertical", "square"]);
  const [scNamePrefix, setScNamePrefix] = useState("");
  const [scEndPageDur, setScEndPageDur] = useState("4");

  useEffect(() => {
    if (!menu) return;
    const close = () => { setMenu(null); setMenuPosition(null); };
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
      setPayload({ error: error?.message || `The "${skill.label}" skill failed unexpectedly.` });
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
    try { parsed = JSON.parse(result.stdout); }
    catch { return { ok: false, error: `${command} returned an unreadable response.` }; }
    if (!parsed || typeof parsed !== "object") return { ok: false, error: `${command} returned an invalid payload.` };
    if (parsed.ok === false && typeof parsed.error === "string") return parsed;
    const validationError = validate?.(parsed);
    if (validationError) return { ...parsed, ok: false, error: validationError };
    return parsed;
  };

  const requireSeq = (): string | null => {
    if (!seqId) return null;
    return seqId;
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
          "sequence-import-prproj", args,
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
        return runJcJson("prproj-analyze", args,
          (data) => data.profile ? null : "Project analysis finished without a learned profile.",
        );
      },
    },
    // ── AutoPod-parity skills ──────────────────────────────────────────────────
    {
      id: "jumpcut",
      label: "Jump Cut Editor",
      title: "Jump Cut Editor",
      icon: <Scissors size={14} stroke={1.5} />,
      run: async () => {
        const sid = requireSeq();
        if (!sid) return { error: "No sequence loaded. Ask the agent to create or open a sequence first." };
        const baseArgs = [
          "--workspace", workspace,
          "--sequence-id", sid,
          "--audio-track", jcAudioTrack,
          "--threshold-db", jcThreshold,
          "--min-silence", jcMinSilence,
          "--pre-buffer", jcPreBuffer,
          "--post-buffer", jcPostBuffer,
        ];
        if (jcDryRun) baseArgs.push("--dry-run");
        const data = await runJcJson("sequence-jump-cut-editor", baseArgs);
        if (!data.error) onChanged?.();
        return data;
      },
    },
    {
      id: "multicam",
      label: "CastCut",
      title: "CastCut — Podcast Editor",
      icon: <Columns size={14} stroke={1.5} />,
      run: async () => {
        // CastCut opens as a full-screen wizard rather than an inline modal.
        onOpenPodcastEditor?.();
        return {};
      },
    },
    {
      id: "socialclips",
      label: "Social Clip Creator",
      title: "Social Clip Creator",
      icon: <Mobile size={14} stroke={1.5} />,
      run: async () => {
        const sid = requireSeq();
        if (!sid) return { error: "No sequence loaded. Ask the agent to create or open a sequence first." };
        if (scOrientations.length === 0) return { error: "Select at least one output format." };
        const args = [
          "--workspace", workspace,
          "--sequence-id", sid,
          "--orientations", JSON.stringify(scOrientations),
          "--end-page-duration", scEndPageDur,
        ];
        if (scNamePrefix.trim()) args.push("--name-prefix", scNamePrefix.trim());
        const data = await runJcJson("sequence-social-clips", args);
        if (!data.error) onChanged?.();
        return data;
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
                onClick={() => {
                  if (skill.id === "multicam") {
                    // CastCut opens as its own full-screen experience.
                    onOpenPodcastEditor?.();
                  } else if (skill.id === "jumpcut" || skill.id === "socialclips") {
                    setModal(skill.id);
                    setPayload(null);
                  } else {
                    run(skill);
                  }
                }}
                disabled={busy !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 disabled:opacity-50"
              >
                <span className="shrink-0">{skill.icon}</span>
                <span>{busy === skill.id ? "Working…" : skill.label}</span>
              </button>
              {skill.hasMenu && (
                <button
                  onClick={(e) => {
                    if (menu === skill.id) { setMenu(null); setMenuPosition(null); return; }
                    const rect = e.currentTarget.getBoundingClientRect();
                    if (skill.id === "memory") return;
                    if (skill.id === "jumpcut" || skill.id === "multicam" || skill.id === "socialclips") return;
                    setMenu(skill.id as SkillMenu);
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
          <Modal
            title={skills.find((s) => s.id === modal)?.title || ""}
            onClose={() => { setModal(null); setPayload(null); }}
            loading={busy === modal}
          >
            {modal === "style" && <StyleResult data={payload} />}
            {modal === "memory" && <MemoryResult data={payload} />}
            {modal === "prproj" && <PrprojResult data={payload} />}
            {modal === "continue" && <ContinueResult data={payload} />}
            {modal === "jumpcut" && (
              <JumpCutPanel
                payload={payload}
                seqId={seqId}
                threshold={jcThreshold} setThreshold={setJcThreshold}
                minSilence={jcMinSilence} setMinSilence={setJcMinSilence}
                preBuffer={jcPreBuffer} setPreBuffer={setJcPreBuffer}
                postBuffer={jcPostBuffer} setPostBuffer={setJcPostBuffer}
                audioTrack={jcAudioTrack} setAudioTrack={setJcAudioTrack}
                dryRun={jcDryRun} setDryRun={setJcDryRun}
                onRun={() => run(skills.find((s) => s.id === "jumpcut")!)}
                busy={busy === "jumpcut"}
              />
            )}
            {modal === "socialclips" && (
              <SocialClipsPanel
                payload={payload}
                seqId={seqId}
                orientations={scOrientations} setOrientations={setScOrientations}
                namePrefix={scNamePrefix} setNamePrefix={setScNamePrefix}
                endPageDur={scEndPageDur} setEndPageDur={setScEndPageDur}
                onRun={() => run(skills.find((s) => s.id === "socialclips")!)}
                busy={busy === "socialclips"}
              />
            )}
          </Modal>
        )}
      </AnimatePresence>
    </>
  );
}

// ── AutoPod-parity panels ──────────────────────────────────────────────────────

function JumpCutPanel({
  payload, seqId,
  threshold, setThreshold,
  minSilence, setMinSilence,
  preBuffer, setPreBuffer,
  postBuffer, setPostBuffer,
  audioTrack, setAudioTrack,
  dryRun, setDryRun,
  onRun, busy,
}: {
  payload: any; seqId: string | null;
  threshold: string; setThreshold: (v: string) => void;
  minSilence: string; setMinSilence: (v: string) => void;
  preBuffer: string; setPreBuffer: (v: string) => void;
  postBuffer: string; setPostBuffer: (v: string) => void;
  audioTrack: string; setAudioTrack: (v: string) => void;
  dryRun: boolean; setDryRun: (v: boolean) => void;
  onRun: () => void; busy: boolean;
}) {
  if (payload?.error) return <p className="text-amber-400">{payload.error}</p>;

  if (payload && !payload.error) {
    // Show results
    return (
      <div className="space-y-4">
        {payload.dry_run ? (
          <>
            <div className="flex items-center gap-2 text-amber-400">
              <span className="h-2 w-2 rounded-full bg-amber-400" /> Preview — no changes made
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Silences found" value={String(payload.silence_count ?? 0)} />
              <Stat label="Time to remove" value={`${payload.total_removed_seconds ?? 0}s`} />
              <Stat label="Original length" value={`${payload.original_duration ?? 0}s`} />
              <Stat label="New length" value={`${payload.projected_duration ?? 0}s`} />
            </div>
            {payload.silence_count > 0 && (
              <p className="text-xs text-dim">
                Disable "Preview only" and run again to apply these cuts.
              </p>
            )}
            {payload.silence_count === 0 && (
              <p className="text-xs text-amber-400">{payload.note}</p>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> Cuts applied
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Silences removed" value={String(payload.silences_removed ?? 0)} />
              <Stat label="Time saved" value={`${payload.time_saved_seconds ?? 0}s`} />
              <Stat label="Was" value={`${payload.original_duration ?? 0}s`} />
              <Stat label="Now" value={`${payload.new_duration ?? 0}s`} />
            </div>
            <p className="text-xs text-dim">{payload.note}</p>
          </>
        )}
      </div>
    );
  }

  // Config form
  return (
    <div className="space-y-4">
      {!seqId && (
        <p className="rounded-lg bg-amber-900/30 px-3 py-2 text-xs text-amber-400">
          No sequence loaded — ask the agent to create or open a sequence first.
        </p>
      )}
      <p className="text-xs text-dim">
        Automatically removes silent pauses from your sequence. Like AutoPod's Jump Cut Editor,
        but fully local — no plugin required.
      </p>
      <div className="space-y-3">
        <Field label="Audio track" sub="Which track to scan for silences">
          <input
            value={audioTrack}
            onChange={(e) => setAudioTrack(e.target.value)}
            className={inputCls}
            placeholder="A1"
          />
        </Field>
        <Field label="Silence threshold (dB)" sub="Audio below this level is treated as silence. -40 works for most podcast mics.">
          <div className="flex items-center gap-3">
            <input
              type="range" min="-60" max="-20" step="1"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="flex-1"
            />
            <span className="w-12 text-right text-sm font-mono">{threshold} dB</span>
          </div>
        </Field>
        <Field label="Minimum silence (s)" sub="Gaps shorter than this are kept — prevents removing brief pauses">
          <div className="flex items-center gap-3">
            <input
              type="range" min="0.1" max="2.0" step="0.1"
              value={minSilence}
              onChange={(e) => setMinSilence(e.target.value)}
              className="flex-1"
            />
            <span className="w-12 text-right text-sm font-mono">{minSilence}s</span>
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pre-buffer (s)" sub="Speech kept before cut">
            <input type="number" min="0" max="1" step="0.05" value={preBuffer}
              onChange={(e) => setPreBuffer(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Post-buffer (s)" sub="Speech kept after cut">
            <input type="number" min="0" max="1" step="0.05" value={postBuffer}
              onChange={(e) => setPostBuffer(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)}
            className="h-4 w-4 rounded"
          />
          <div>
            <div className="text-sm">Preview only (recommended first)</div>
            <div className="text-xs text-dim">Shows what would be removed without changing the sequence</div>
          </div>
        </label>
      </div>
      <button
        onClick={onRun}
        disabled={busy || !seqId}
        className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        {busy ? "Analyzing…" : dryRun ? "Preview cuts" : "Remove silences"}
      </button>
    </div>
  );
}

function MultiCamPanel({
  payload, seqId, workspace,
  cameras, setCameras,
  wideRatio, setWideRatio,
  cooldown, setCooldown,
  outputName, setOutputName,
  onRun, busy,
}: {
  payload: any; seqId: string | null; workspace: string;
  cameras: string; setCameras: (v: string) => void;
  wideRatio: string; setWideRatio: (v: string) => void;
  cooldown: string; setCooldown: (v: string) => void;
  outputName: string; setOutputName: (v: string) => void;
  onRun: () => void; busy: boolean;
}) {
  const [detecting, setDetecting] = useState(false);
  const [detectNote, setDetectNote] = useState<string | null>(null);

  const autoDetect = async () => {
    if (!seqId) return;
    setDetecting(true);
    setDetectNote(null);
    try {
      const res = await window.jcut.jc("sequence-detect-cameras", ["--workspace", workspace, "--sequence-id", seqId]);
      if (!res.ok) { setDetectNote("Detection failed — check the sequence has clips on multiple V tracks."); return; }
      const data = JSON.parse(res.stdout);
      if (!data.ok) { setDetectNote(data.error || "No cameras detected."); return; }
      setCameras(data.cameras_json);
      setDetectNote(data.note);
    } catch (e: any) {
      setDetectNote(e?.message || "Detection failed.");
    } finally {
      setDetecting(false);
    }
  };

  if (payload?.error) return <p className="text-amber-400">{payload.error}</p>;

  if (payload && !payload.error) {
    const actualWide = payload.actual_wide_ratio != null
      ? `${Math.round(payload.actual_wide_ratio * 100)}%`
      : null;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-emerald-400">
          <span className="h-2 w-2 rounded-full bg-emerald-400" /> Multi-camera edit created
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Camera cuts" value={String(payload.cuts ?? 0)} />
          <Stat label="Cameras" value={String(payload.cameras ?? 0)} />
          <Stat label="Duration" value={`${payload.duration_seconds ?? 0}s`} />
          {actualWide && <Stat label="Wide shot" value={actualWide} />}
        </div>
        <p className="text-sm font-medium">{payload.name}</p>
        <p className="text-xs text-dim">{payload.note}</p>
        <p className="text-xs text-dim">Colored markers added to the sequence — open in Premiere to see speaker annotations.</p>
      </div>
    );
  }

  let parsedCams: any[] = [];
  let jsonValid = true;
  try { parsedCams = JSON.parse(cameras); } catch { jsonValid = false; }

  return (
    <div className="space-y-4">
      {!seqId && (
        <p className="rounded-lg bg-amber-900/30 px-3 py-2 text-xs text-amber-400">
          No sequence loaded — ask the agent to create or open a sequence first.
        </p>
      )}
      <p className="text-xs text-dim">
        Automatically switches between camera angles based on who is speaking — like AutoPod's
        Multi-Camera Editor, fully local. Requires each camera on its own V/A track pair.
      </p>
      <div className="space-y-3">
        <Field
          label="Camera configuration"
          sub='One entry per camera. Use "type": "wide" for group/wide shots.'
        >
          <div className="flex gap-2 mb-2">
            <button
              onClick={autoDetect}
              disabled={detecting || !seqId || busy}
              className="flex-1 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-dim hover:border-white/20 hover:text-ink disabled:opacity-40"
            >
              {detecting ? "Detecting…" : "Auto-detect from sequence"}
            </button>
          </div>
          {detectNote && (
            <p className={`mb-2 text-xs ${detectNote.startsWith("⚠") || detectNote.includes("failed") ? "text-amber-400" : "text-emerald-400"}`}>
              {detectNote}
            </p>
          )}
          {/* Human-readable camera list when JSON is valid */}
          {jsonValid && Array.isArray(parsedCams) && parsedCams.length > 0 && (
            <div className="mb-2 space-y-1">
              {parsedCams.map((cam: any, i: number) => (
                <div key={i} className="flex items-center gap-2 rounded-lg depth-chip px-3 py-1.5 text-xs">
                  <span className="font-medium text-ink">{cam.name || `Camera ${i + 1}`}</span>
                  <span className="text-dim">{cam.video_track}/{cam.audio_track}</span>
                  {cam.type === "wide" && <span className="ml-auto rounded px-1.5 py-0.5 bg-blue-900/40 text-blue-300">wide</span>}
                </div>
              ))}
            </div>
          )}
          <textarea
            value={cameras}
            onChange={(e) => setCameras(e.target.value)}
            rows={4}
            className={`${inputCls} resize-y font-mono text-[10px] ${!jsonValid ? "border border-red-500/50" : ""}`}
          />
          {!jsonValid && <p className="text-xs text-red-400">Invalid JSON — check brackets and quotes</p>}
        </Field>
        <Field label="Wide shot ratio" sub="Target fraction of the edit on wide/group shots">
          <div className="flex items-center gap-3">
            <input type="range" min="0" max="0.5" step="0.05"
              value={wideRatio} onChange={(e) => setWideRatio(e.target.value)} className="flex-1" />
            <span className="w-12 text-right text-sm font-mono">{Math.round(Number(wideRatio) * 100)}%</span>
          </div>
        </Field>
        <Field label="Speaker cooldown" sub="Min time before switching speakers — prevents cuts on coughs/crosstalk">
          <div className="flex items-center gap-3">
            <input type="range" min="0.5" max="5" step="0.5"
              value={cooldown} onChange={(e) => setCooldown(e.target.value)} className="flex-1" />
            <span className="w-12 text-right text-sm font-mono">{cooldown}s</span>
          </div>
        </Field>
        <Field label="Output sequence name" sub="Leave blank to auto-name">
          <input value={outputName} onChange={(e) => setOutputName(e.target.value)}
            className={inputCls} placeholder="e.g. Episode 12 Multicam Edit" />
        </Field>
      </div>
      <button
        onClick={onRun}
        disabled={busy || !seqId || !jsonValid || parsedCams.length < 2}
        className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        {busy ? "Editing…" : `Generate edit${parsedCams.length >= 2 ? ` (${parsedCams.length} cameras)` : ""}`}
      </button>
    </div>
  );
}

function SocialClipsPanel({
  payload, seqId,
  orientations, setOrientations,
  namePrefix, setNamePrefix,
  endPageDur, setEndPageDur,
  onRun, busy,
}: {
  payload: any; seqId: string | null;
  orientations: string[]; setOrientations: (v: string[]) => void;
  namePrefix: string; setNamePrefix: (v: string) => void;
  endPageDur: string; setEndPageDur: (v: string) => void;
  onRun: () => void; busy: boolean;
}) {
  const toggleOrientation = (o: string) => {
    setOrientations(orientations.includes(o)
      ? orientations.filter((x) => x !== o)
      : [...orientations, o]);
  };

  if (payload?.error) return <p className="text-amber-400">{payload.error}</p>;

  if (payload && !payload.error) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-emerald-400">
          <span className="h-2 w-2 rounded-full bg-emerald-400" /> Social clips created
        </div>
        <div className="space-y-2">
          {(payload.created || []).map((seq: any) => (
            <div key={seq.sequence_id} className="flex items-center justify-between rounded-lg depth-chip px-3 py-2">
              <div>
                <div className="text-sm font-medium">{seq.name}</div>
                <div className="text-xs text-dim">{seq.settings}</div>
              </div>
              <OrientationBadge orientation={seq.orientation} />
            </div>
          ))}
        </div>
        <div className="flex gap-4 text-xs text-dim">
          <span>Watermark: {payload.watermark}</span>
          <span>End page: {payload.end_page}</span>
        </div>
        <p className="text-xs text-dim">{payload.note}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!seqId && (
        <p className="rounded-lg bg-amber-900/30 px-3 py-2 text-xs text-amber-400">
          No sequence loaded — ask the agent to create or open a sequence first.
        </p>
      )}
      <p className="text-xs text-dim">
        Generate social media clips in multiple aspect ratios from your sequence — like AutoPod's
        Social Clip Creator, fully local. Watermarks and end pages can be added by the agent after
        you specify source image paths.
      </p>
      <div className="space-y-3">
        <Field label="Output formats" sub="Select the aspect ratios to generate">
          <div className="flex gap-2">
            {[
              { id: "vertical", label: "9:16", sub: "TikTok / Reels" },
              { id: "square", label: "1:1", sub: "Instagram" },
              { id: "horizontal", label: "16:9", sub: "YouTube" },
            ].map((o) => (
              <button
                key={o.id}
                onClick={() => toggleOrientation(o.id)}
                className={`flex-1 rounded-lg border px-2 py-2 text-center transition-colors ${
                  orientations.includes(o.id)
                    ? "border-accent bg-accent/10 text-ink"
                    : "border-white/10 text-dim hover:border-white/20"
                }`}
              >
                <div className="text-sm font-semibold">{o.label}</div>
                <div className="text-[10px] text-dim">{o.sub}</div>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Name prefix" sub="Prepended to each sequence name (e.g. 'Episode 12')">
          <input value={namePrefix} onChange={(e) => setNamePrefix(e.target.value)}
            className={inputCls} placeholder="Use sequence name" />
        </Field>
        <Field label="Watermark & end page" sub="Add these via the chat: 'add watermark source/images/logo.png' or ask the agent to run sequence-social-clips with --watermark and --end-page">
          <p className="text-xs text-dim italic">
            Watermark and end page paths are set via the chat or by running the command directly.
          </p>
        </Field>
      </div>
      <button
        onClick={onRun}
        disabled={busy || !seqId || orientations.length === 0}
        className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        {busy ? "Creating clips…" : `Create ${orientations.length} clip${orientations.length !== 1 ? "s" : ""}`}
      </button>
    </div>
  );
}

function OrientationBadge({ orientation }: { orientation: string }) {
  const labels: Record<string, string> = { vertical: "9:16", square: "1:1", horizontal: "16:9" };
  return (
    <span className="rounded px-2 py-0.5 text-xs font-mono depth-chip">
      {labels[orientation] ?? orientation}
    </span>
  );
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

const inputCls = "w-full rounded-lg bg-surface px-3 py-2 text-sm shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)] focus:outline-none";

function Field({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div>
        <div className="text-sm font-medium text-ink">{label}</div>
        {sub && <div className="mt-0.5 text-xs text-dim">{sub}</div>}
      </div>
      {children}
    </div>
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
    return { left, bottom: Math.max(12, window.innerHeight - pos.bottom), maxHeight: Math.max(120, spaceAbove) };
  }
  return { left, top: Math.max(12, Math.min(pos.top, window.innerHeight - 12 - Math.min(estimatedHeight, spaceBelow))), maxHeight: Math.max(120, spaceBelow) };
}

function SkillTextSetting({ label, sub, value, placeholder, onChange, onReset }: {
  label: string; sub: string; value: string; placeholder: string;
  onChange: (value: string) => void; onReset: () => void;
}) {
  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium text-ink">{label}</div>
        <div className="mt-0.5 text-xs text-dim">{sub}</div>
      </div>
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        className={inputCls} />
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
      <p className="text-sm"><b>{data.name}</b> — {data.imported_clips} of {data.total_found} clips.</p>
      {data.unresolved_sources?.length > 0 && (
        <p className="text-xs text-amber-400">
          {data.unresolved_sources.length} source(s) are offline. Reconnect the drive and the footage will relink.
        </p>
      )}
      <p className="text-sm text-dim">{data.note || "Open it and tell JCut how to continue."}</p>
    </div>
  );
}

function Modal({ title, onClose, loading, children }: {
  title: string; onClose: () => void; loading: boolean; children: React.ReactNode;
}) {
  return createPortal(
    <motion.div className="fixed inset-0 z-[100] flex items-center justify-center p-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.92, y: 24, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.95, y: 12, opacity: 0 }} transition={spring.snappy}
        className="relative max-h-[84vh] w-full max-w-lg overflow-auto rounded-xl2 depth-card p-6 shadow-card">
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
      <ul className="space-y-1 text-sm">{p.notes?.map((n: string, i: number) => <li key={i}>• {n}</li>)}</ul>
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
