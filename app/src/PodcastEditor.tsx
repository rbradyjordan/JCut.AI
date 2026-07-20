// PodcastEditor — CastCut's full editing wizard.
// Opened from CastCutHome with an existing CastCutProject.
// Steps: Sequence → Tracks → Assign → Tune → Run
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { spring, TEAL_GRADIENT } from "./theme";
import { Check, Columns, ChevronRight, ChevronLeft, Refresh, Warning, Music, Film, Plus, Close } from "./Icons";
import type { CastCutProject, CastCutCamera } from "./CastCutHome";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface SequenceMeta {
  id: string;
  name: string;
  duration_seconds?: number;
  settings?: { width: number; height: number; framerate: number };
}

interface TrackInfo {
  track: string;       // "V1", "V2", "A1", "A2", ...
  kind: "video" | "audio";
  clip_count: number;
  source_sample?: string; // first clip source filename
}

type Step = "sequence" | "tracks" | "assign" | "tune" | "run";
const STEPS: Step[] = ["sequence", "tracks", "assign", "tune", "run"];

const CAMERA_COLORS = [
  "#23C6A2", "#2E6BE6", "#F59E0B", "#EF4444",
  "#8B5CF6", "#EC4899", "#10B981", "#F97316",
];

// ─── Main component ─────────────────────────────────────────────────────────────

export default function PodcastEditor({
  project: initialProject,
  returnLabel = "CastCut",
  onClose,
  onSave,
}: {
  project: CastCutProject;
  returnLabel?: string;
  onClose: () => void;
  onSave: (project: CastCutProject) => void;
}) {
  const [project, setProject] = useState<CastCutProject>(initialProject);
  const [step, setStep] = useState<Step>(() =>
    initialProject.sequence_id && initialProject.cameras.length >= 2 ? "tune" : "sequence"
  );

  // Step 1: sequence
  const [sequences, setSequences] = useState<SequenceMeta[]>([]);
  const [loadingSeqs, setLoadingSeqs] = useState(false);

  // Step 2: tracks
  const [tracks, setTracks] = useState<TrackInfo[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(false);

  // Step 4/5: run
  const [running, setRunning] = useState(false);
  const [runLog, setRunLog] = useState<string[]>([]);
  const [runResult, setRunResult] = useState<any>(null);

  const stepIdx = STEPS.indexOf(step);

  const patch = useCallback((p: Partial<CastCutProject>) => {
    setProject((prev) => ({ ...prev, ...p }));
  }, []);

  const patchSettings = useCallback((s: Partial<CastCutProject["settings"]>) => {
    setProject((prev) => ({ ...prev, settings: { ...prev.settings, ...s } }));
  }, []);

  const save = useCallback(async (proj: CastCutProject) => {
    await window.jcut.jc("castcut-project-save", ["--project", JSON.stringify(proj)]);
    onSave(proj);
  }, [onSave]);

  // Load sequences when we reach the sequence step or on mount if needed
  useEffect(() => {
    if (step === "sequence" && sequences.length === 0) loadSequences();
  }, [step]);

  // Load tracks when sequence is chosen
  useEffect(() => {
    if (step === "tracks" && project.sequence_id) loadTracks(project.sequence_id);
  }, [step, project.sequence_id]);

  const loadSequences = async () => {
    setLoadingSeqs(true);
    try {
      const res = await window.jcut.jc("sequences-list", ["--workspace", project.workspace]);
      if (res.ok) {
        const data = JSON.parse(res.stdout);
        setSequences((data.sequences || []).map((s: any) => ({
          id: s.id, name: s.name,
          duration_seconds: s.duration_seconds,
          settings: s.settings,
        })));
      }
    } catch { /* ignore */ }
    setLoadingSeqs(false);
  };

  const loadTracks = async (seqId: string) => {
    setLoadingTracks(true);
    try {
      const res = await window.jcut.jc("sequence-inspect", ["--workspace", project.workspace, "--sequence-id", seqId]);
      if (res.ok) {
        const data = JSON.parse(res.stdout);
        const clips: any[] = data.clips || [];
        const trackMap = new Map<string, TrackInfo>();
        for (const clip of clips) {
          const t = clip.track as string;
          if (!trackMap.has(t)) {
            trackMap.set(t, {
              track: t,
              kind: t.startsWith("V") ? "video" : "audio",
              clip_count: 0,
              source_sample: undefined,
            });
          }
          const info = trackMap.get(t)!;
          info.clip_count++;
          if (!info.source_sample) {
            info.source_sample = (clip.source_path as string).split("/").pop();
          }
        }
        // Sort: V1, V2… then A1, A2…
        const sorted = [...trackMap.values()].sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === "video" ? -1 : 1;
          return parseInt(a.track.slice(1)) - parseInt(b.track.slice(1));
        });
        setTracks(sorted);
      }
    } catch { /* ignore */ }
    setLoadingTracks(false);
  };

  const runEdit = async () => {
    setRunning(true);
    setRunLog([]);
    setRunResult(null);
    const log = (msg: string) => setRunLog((prev) => [...prev, msg]);

    try {
      const { sequence_id, cameras, settings } = project;
      if (!sequence_id || cameras.length < 2) {
        log("✗ Setup incomplete — need a sequence and at least 2 cameras");
        return;
      }

      // Build --cameras JSON: every assigned mic goes to the engine (it takes
      // the max activity across a camera's mics — AutoPod's multi-mic behavior).
      log("Analyzing speaker audio…");
      const camJson = JSON.stringify(cameras.map((cam) => ({
        video_track: cam.video_track,
        audio_track: cam.audio_tracks[0] || "A1",
        audio_tracks: cam.audio_tracks.length ? cam.audio_tracks : ["A1"],
        name: cam.name,
        type: cam.type,
      })));

      log("Building camera-switched edit…");
      const args = [
        "--workspace", project.workspace,
        "--sequence-id", sequence_id,
        "--cameras", camJson,
        "--wide-shot-ratio", String(settings.wide_ratio),
        "--cooldown", String(settings.cooldown),
        "--silence-threshold", String(settings.silence_threshold),
        "--output-name", `${project.name} — Edit`,
      ];
      const mcRes = await window.jcut.jc("sequence-multi-camera-editor", args);
      if (!mcRes.ok) throw new Error("Editor failed to run");
      const mcData = JSON.parse(mcRes.stdout);
      if (!mcData.ok) throw new Error(mcData.error || "Edit failed");

      log(`✓ ${mcData.cuts} camera cuts`);
      log(`✓ ${Math.round((mcData.actual_wide_ratio ?? 0) * 100)}% wide shots`);

      // Silence removal runs on the OUTPUT edit, never the source sequence:
      // the source stays pristine (re-running the wizard is repeatable), and
      // the jump cut ripples the flat V1/A1 edit — all tracks stay in sync.
      if (settings.jump_cut_enabled) {
        log("Removing silences…");
        const jcRes = await window.jcut.jc("sequence-jump-cut-editor", [
          "--workspace", project.workspace,
          "--sequence-id", mcData.sequence_id,
          "--audio-track", "A1",
          "--threshold-db", String(settings.jump_cut_threshold),
          "--min-silence", String(settings.jump_cut_min_silence),
        ]);
        if (jcRes.ok) {
          try {
            const jcData = JSON.parse(jcRes.stdout);
            if (jcData.ok && jcData.silences_removed > 0)
              log(`✓ Removed ${jcData.silences_removed} silence(s), saved ${jcData.time_saved_seconds}s`);
            else log("No silences found to remove");
          } catch { log("Silence pass skipped (could not read result)"); }
        }
      }

      log(`✓ Duration: ${mcData.duration_seconds}s`);
      log("Done — export sequence to Premiere to finish");

      const updated = { ...project, last_output_seq_id: mcData.sequence_id };
      setProject(updated);
      await save(updated);
      setRunResult(mcData);
    } catch (e: any) {
      log(`✗ ${e?.message || "Unknown error"}`);
    } finally {
      setRunning(false);
    }
  };

  const goNext = () => {
    const i = STEPS.indexOf(step);
    if (i < STEPS.length - 1) {
      if (step === "tracks" || step === "assign" || step === "tune") {
        save(project); // auto-save on each step advance
      }
      setStep(STEPS[i + 1]);
    }
  };
  const goPrev = () => {
    const i = STEPS.indexOf(step);
    if (i > 0) setStep(STEPS[i - 1]);
  };

  const canGoNext = () => {
    if (step === "sequence") return !!project.sequence_id;
    if (step === "tracks") return project.cameras.length >= 2;
    if (step === "assign") return project.cameras.every((c) => c.name.trim() && c.audio_tracks.length > 0);
    if (step === "tune") return true;
    return false;
  };

  const STEP_LABELS: Record<Step, string> = {
    sequence: "Sequence",
    tracks: "Cameras",
    assign: "Assign",
    tune: "Settings",
    run: "Edit",
  };

  return (
    <div className="grain relative flex h-full flex-col bg-base">
      <div className="backdrop" />

      {/* Traffic-light strip */}
      <div className="drag relative z-30 h-9 shrink-0 border-b border-black/40 bg-black/20 backdrop-blur-xl" />

      {/* Header */}
      <div className="relative z-10 flex shrink-0 items-center gap-3 border-b border-white/5 px-5 py-3">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] text-dim hover:bg-surface2 hover:text-ink transition-colors"
        >
          <ChevronLeft size={13} stroke={1.5} /> {returnLabel}
        </button>

        <div className="h-4 w-px bg-white/10" />

        <div className="flex items-center gap-2">
          <div
            className="flex h-6 w-6 items-center justify-center rounded-md shadow-sm"
            style={{ background: "linear-gradient(135deg, #23C6A2, #2E6BE6)" }}
          >
            <Columns size={13} stroke={2} className="text-white" />
          </div>
          <span className="text-[13px] font-bold text-ink">CastCut</span>
          <div className="h-4 w-px bg-white/10" />
          <span className="max-w-[180px] truncate text-[12px] text-dim">{project.name}</span>
        </div>

        {/* Step breadcrumb */}
        <div className="ml-auto flex items-center gap-0.5">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-0.5">
              {i > 0 && <ChevronRight size={10} className="text-dim/30" />}
              <button
                onClick={() => {
                  if (i < stepIdx || (i === stepIdx + 1 && canGoNext())) setStep(s);
                }}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                  step === s
                    ? "bg-accent/15 text-accent"
                    : i < stepIdx
                    ? "cursor-pointer text-dim hover:text-ink"
                    : "cursor-default text-dim/30"
                }`}
              >
                {STEP_LABELS[s]}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Step body */}
      <div className="relative z-10 min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            className="flex h-full flex-col"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={spring.snappy}
          >
            {step === "sequence" && (
              <SequenceStep
                project={project}
                sequences={sequences}
                loading={loadingSeqs}
                onRefresh={loadSequences}
                onSelect={(id) => patch({ sequence_id: id })}
              />
            )}
            {step === "tracks" && (
              <TracksStep
                project={project}
                tracks={tracks}
                loading={loadingTracks}
                onChange={(cameras) => patch({ cameras })}
              />
            )}
            {step === "assign" && (
              <AssignStep
                project={project}
                tracks={tracks}
                onChange={(cameras) => patch({ cameras })}
              />
            )}
            {step === "tune" && (
              <TuneStep
                project={project}
                onPatchSettings={patchSettings}
              />
            )}
            {step === "run" && (
              <RunStep
                project={project}
                running={running}
                runLog={runLog}
                result={runResult}
                onRun={runEdit}
                onClose={onClose}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer nav */}
      {step !== "run" && (
        <div className="relative z-10 flex shrink-0 items-center justify-between border-t border-white/5 px-6 py-4">
          <button
            onClick={goPrev}
            disabled={stepIdx === 0}
            className="flex items-center gap-1.5 text-sm text-dim hover:text-ink disabled:opacity-0 transition-colors"
          >
            <ChevronLeft size={14} stroke={1.5} /> Back
          </button>
          <button
            onClick={goNext}
            disabled={!canGoNext()}
            className="flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
            style={{ background: TEAL_GRADIENT }}
          >
            {step === "tune" ? "Start editing" : "Continue"}
            <ChevronRight size={14} stroke={2} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Step 1: Choose sequence ───────────────────────────────────────────────────

function SequenceStep({
  project, sequences, loading, onRefresh, onSelect,
}: {
  project: CastCutProject;
  sequences: SequenceMeta[];
  loading: boolean;
  onRefresh: () => void;
  onSelect: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("Podcast Edit");
  const [newFramerate, setNewFramerate] = useState("30");
  const [newOrientation, setNewOrientation] = useState<"horizontal" | "vertical" | "square">("horizontal");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const res = await window.jcut.jc("castcut-workspace-setup", [
        "--workspace", project.workspace,
        "--sequence-name", newName.trim(),
        "--framerate", newFramerate,
        "--orientation", newOrientation,
      ]);
      if (!res.ok) throw new Error("Setup failed");
      const data = JSON.parse(res.stdout);
      if (!data.ok) throw new Error(data.error || "Could not create sequence");
      if (data.sequence_id) {
        onSelect(data.sequence_id);
        setCreating(false);
        onRefresh(); // reload list
      } else {
        throw new Error("No sequence ID returned");
      }
    } catch (e: any) {
      setCreateError(e?.message || "Failed to create sequence");
    } finally {
      setCreateBusy(false);
    }
  };

  const DIM_MAP: Record<string, string> = {
    horizontal: "1920×1080",
    vertical: "1080×1920",
    square: "1080×1080",
  };

  return (
    <div className="flex flex-1 flex-col items-center overflow-auto px-6 py-8">
      <div className="w-full max-w-xl">
        <div className="mb-6 text-center">
          <div className="mb-1 text-xl font-bold text-ink">Choose a sequence</div>
          <div className="text-sm text-dim">
            Pick the sequence from <strong className="text-ink">{project.workspace}</strong> that contains your podcast footage,
            or create a blank one to start from scratch.
          </div>
        </div>

        {/* Create new sequence inline */}
        <AnimatePresence>
          {creating ? (
            <motion.div
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}
              className="mb-4 overflow-hidden rounded-xl border border-accent/30 bg-accent/5 p-4"
            >
              <div className="mb-3 text-sm font-semibold text-ink">New sequence</div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-dim">Name</label>
                  <input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setCreating(false); }}
                    className="w-full rounded-lg bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent/50"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-dim">Frame rate</label>
                  <select
                    value={newFramerate}
                    onChange={(e) => setNewFramerate(e.target.value)}
                    className="w-full rounded-lg bg-surface px-2.5 py-2 text-sm text-ink focus:outline-none"
                  >
                    {["24", "25", "30", "60"].map((r) => <option key={r} value={r}>{r} fps</option>)}
                  </select>
                </div>
              </div>
              <div className="mt-3 space-y-1.5">
                <label className="text-[10px] font-medium uppercase tracking-wide text-dim">Format</label>
                <div className="flex gap-2">
                  {(["horizontal", "vertical", "square"] as const).map((o) => (
                    <button
                      key={o}
                      onClick={() => setNewOrientation(o)}
                      className={`flex-1 rounded-lg py-2 text-[11px] font-medium transition-all ${
                        newOrientation === o
                          ? "bg-accent/15 text-accent ring-1 ring-accent/30"
                          : "bg-surface text-dim hover:text-ink"
                      }`}
                    >
                      <div>{o === "horizontal" ? "16:9" : o === "vertical" ? "9:16" : "1:1"}</div>
                      <div className="text-[9px] opacity-60">{DIM_MAP[o]}</div>
                    </button>
                  ))}
                </div>
              </div>
              {createError && <p className="mt-2 text-xs text-red-400">{createError}</p>}
              <div className="mt-3 flex justify-end gap-2">
                <button onClick={() => setCreating(false)} className="rounded-lg bg-surface2 px-3 py-1.5 text-xs text-dim hover:text-ink">
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={createBusy || !newName.trim()}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                  style={{ background: TEAL_GRADIENT }}
                >
                  {createBusy ? "Creating…" : "Create & select"}
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.button
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              onClick={() => setCreating(true)}
              className="mb-4 flex w-full items-center gap-3 rounded-xl border border-dashed border-white/10 px-4 py-3 text-left text-sm text-dim transition-colors hover:border-accent/30 hover:text-ink"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10">
                <Plus size={14} stroke={2} className="text-accent" />
              </div>
              <div>
                <div className="font-medium text-ink">Create new sequence</div>
                <div className="text-xs text-dim">Start from scratch in this workspace</div>
              </div>
            </motion.button>
          )}
        </AnimatePresence>

        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs text-dim">
            {loading ? "Loading…" : `${sequences.length} sequence${sequences.length !== 1 ? "s" : ""} in workspace`}
          </span>
          <button onClick={onRefresh} className="flex items-center gap-1 text-xs text-dim hover:text-ink">
            <Refresh size={11} stroke={1.5} /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <motion.div className="h-7 w-7 rounded-full border-2 border-dim border-t-accent"
              animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }} />
          </div>
        ) : sequences.length === 0 && !creating ? (
          <div className="rounded-xl border border-white/5 bg-surface/20 px-4 py-5 text-center">
            <div className="text-sm text-dim">No sequences yet — create one above or add footage via the AI Editor.</div>
          </div>
        ) : (
          <div className="space-y-2">
            {sequences.map((seq) => (
              <motion.button
                key={seq.id}
                whileHover={{ x: 3 }} whileTap={{ scale: 0.99 }}
                onClick={() => onSelect(seq.id)}
                className={`flex w-full items-center gap-4 rounded-xl border px-4 py-3 text-left transition-all ${
                  project.sequence_id === seq.id
                    ? "border-accent/40 bg-accent/10"
                    : "border-white/[0.06] bg-surface/40 hover:border-white/10 hover:bg-surface/60"
                }`}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: project.sequence_id === seq.id ? "linear-gradient(135deg,#23C6A2,#2E6BE6)" : "rgba(255,255,255,0.05)" }}>
                  <Film size={14} stroke={1.5} className={project.sequence_id === seq.id ? "text-white" : "text-dim"} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{seq.name}</div>
                  <div className="text-xs text-dim">
                    {seq.settings ? `${seq.settings.width}×${seq.settings.height} · ${seq.settings.framerate}fps` : ""}
                    {seq.duration_seconds ? ` · ${Math.round(seq.duration_seconds)}s` : ""}
                  </div>
                </div>
                {project.sequence_id === seq.id && <Check size={14} stroke={2.5} className="shrink-0 text-accent" />}
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Step 2: Auto-detect + configure cameras ────────────────────────────────────

function TracksStep({
  project, tracks, loading, onChange,
}: {
  project: CastCutProject;
  tracks: TrackInfo[];
  loading: boolean;
  onChange: (cameras: CastCutCamera[]) => void;
}) {
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState(false);

  const videoTracks = tracks.filter((t) => t.kind === "video");
  const audioTracks = tracks.filter((t) => t.kind === "audio");

  const autoDetect = async () => {
    if (!project.sequence_id) return;
    setDetecting(true);
    try {
      const res = await window.jcut.jc("sequence-detect-cameras", [
        "--workspace", project.workspace,
        "--sequence-id", project.sequence_id,
      ]);
      if (res.ok) {
        const data = JSON.parse(res.stdout);
        if (data.ok && data.cameras?.length >= 2) {
          const cameras: CastCutCamera[] = data.cameras.map((c: any, i: number) => ({
            id: `cam-${i}`,
            name: c.name || `Camera ${i + 1}`,
            type: c.type || "solo",
            video_track: c.video_track,
            audio_tracks: [c.audio_track || `A${c.video_track.slice(1)}`],
            color: CAMERA_COLORS[i % CAMERA_COLORS.length],
          }));
          onChange(cameras);
          setDetected(true);
        }
      }
    } catch { /* ignore */ }
    setDetecting(false);
  };

  const addCamera = () => {
    const nextVideoTrack = videoTracks.find(
      (t) => !project.cameras.some((c) => c.video_track === t.track)
    );
    if (!nextVideoTrack) return;
    const i = project.cameras.length;
    const tNum = nextVideoTrack.track.slice(1);
    const newCam: CastCutCamera = {
      id: `cam-${Date.now()}`,
      name: `Camera ${i + 1}`,
      type: "solo",
      video_track: nextVideoTrack.track,
      audio_tracks: [`A${tNum}`],
      color: CAMERA_COLORS[i % CAMERA_COLORS.length],
    };
    onChange([...project.cameras, newCam]);
  };

  const removeCamera = (id: string) => onChange(project.cameras.filter((c) => c.id !== id));

  const updateCamera = (id: string, patch: Partial<CastCutCamera>) => {
    onChange(project.cameras.map((c) => c.id === id ? { ...c, ...patch } : c));
  };

  return (
    <div className="flex flex-1 flex-col items-center overflow-auto px-6 py-8">
      <div className="w-full max-w-xl">
        <div className="mb-6 text-center">
          <div className="mb-1 text-xl font-bold text-ink">Set up cameras</div>
          <div className="text-sm text-dim">
            Each camera needs a video track and at least one audio track for speaker detection.
            Auto-detect reads your sequence structure.
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <motion.div className="h-7 w-7 rounded-full border-2 border-dim border-t-accent"
              animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }} />
          </div>
        ) : (
          <>
            {/* Auto-detect button */}
            {!detected && project.cameras.length === 0 && (
              <motion.button
                whileHover={{ scale: 1.02, y: -2 }} whileTap={{ scale: 0.97 }}
                onClick={autoDetect}
                disabled={detecting}
                className="mb-5 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 py-3 text-sm font-medium text-ink hover:border-accent/40 transition-colors disabled:opacity-60"
              >
                {detecting ? (
                  <><motion.div className="h-4 w-4 rounded-full border-2 border-dim border-t-accent"
                    animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }} />
                    Detecting…</>
                ) : (
                  <><Refresh size={14} stroke={1.5} /> Auto-detect from sequence</>
                )}
              </motion.button>
            )}

            {/* Detected indicator */}
            {detected && (
              <div className="mb-4 flex items-center gap-2 text-xs text-emerald-400">
                <Check size={12} stroke={2.5} /> {project.cameras.length} cameras detected
                <button onClick={() => { setDetected(false); onChange([]); }}
                  className="ml-auto text-dim hover:text-ink">Clear</button>
              </div>
            )}

            {/* Camera rows */}
            <div className="space-y-3">
              {project.cameras.map((cam, i) => (
                <CameraRow
                  key={cam.id}
                  camera={cam}
                  index={i}
                  videoTracks={videoTracks}
                  audioTracks={audioTracks}
                  usedVideoTracks={project.cameras.filter((c) => c.id !== cam.id).map((c) => c.video_track)}
                  onUpdate={(patch) => updateCamera(cam.id, patch)}
                  onRemove={() => removeCamera(cam.id)}
                />
              ))}
            </div>

            {/* Add camera */}
            {videoTracks.some((t) => !project.cameras.some((c) => c.video_track === t.track)) && (
              <button
                onClick={addCamera}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 py-2.5 text-sm text-dim hover:border-accent/30 hover:text-ink transition-colors"
              >
                <Plus size={13} stroke={1.5} /> Add camera
              </button>
            )}

            {project.cameras.length >= 2 && (
              <p className="mt-4 text-center text-xs text-dim">
                {project.cameras.length} cameras configured — continue to assign audio tracks
              </p>
            )}
            {project.cameras.length < 2 && videoTracks.length < 2 && (
              <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-400">
                <strong>Only {videoTracks.length} video track{videoTracks.length !== 1 ? "s" : ""} found.</strong> CastCut needs at least 2 cameras on separate video tracks (V1, V2, …). Go back to the AI Editor and set up your sequence.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CameraRow({
  camera, index, videoTracks, audioTracks, usedVideoTracks, onUpdate, onRemove,
}: {
  camera: CastCutCamera;
  index: number;
  videoTracks: TrackInfo[];
  audioTracks: TrackInfo[];
  usedVideoTracks: string[];
  onUpdate: (p: Partial<CastCutCamera>) => void;
  onRemove: () => void;
}) {
  const toggleAudio = (track: string) => {
    const has = camera.audio_tracks.includes(track);
    onUpdate({
      audio_tracks: has
        ? camera.audio_tracks.filter((t) => t !== track)
        : [...camera.audio_tracks, track],
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, ...spring.soft }}
      className="rounded-xl border border-white/[0.07] bg-surface/40 p-4"
    >
      <div className="mb-3 flex items-center gap-3">
        {/* Color swatch */}
        <div className="h-3 w-3 shrink-0 rounded-full ring-2 ring-white/10" style={{ background: camera.color }} />

        {/* Name */}
        <input
          value={camera.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          className="min-w-0 flex-1 rounded-lg bg-surface px-3 py-1.5 text-sm font-medium text-ink focus:outline-none focus:ring-1 focus:ring-accent/50"
          placeholder={`Camera ${index + 1}`}
        />

        {/* Type */}
        <div className="flex gap-1">
          {(["solo", "duo", "wide"] as const).map((t) => (
            <button
              key={t}
              onClick={() => onUpdate({ type: t })}
              className={`rounded-md px-2 py-1 text-[10px] font-medium transition-all ${
                camera.type === t
                  ? "bg-accent/15 text-accent ring-1 ring-accent/30"
                  : "bg-surface text-dim hover:text-ink"
              }`}
            >
              {t === "solo" ? "CU" : t === "duo" ? "2-shot" : "Wide"}
            </button>
          ))}
        </div>

        <button onClick={onRemove} className="shrink-0 text-dim hover:text-red-400">
          <Close size={13} stroke={1.5} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Video track */}
        <div>
          <div className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-dim">
            <Film size={10} stroke={1.5} /> Video track
          </div>
          <select
            value={camera.video_track}
            onChange={(e) => onUpdate({ video_track: e.target.value })}
            className="w-full rounded-lg border border-white/8 bg-surface px-2.5 py-1.5 text-xs text-ink focus:outline-none"
          >
            {videoTracks.map((t) => (
              <option key={t.track} value={t.track} disabled={usedVideoTracks.includes(t.track)}>
                {t.track} {t.source_sample ? `· ${t.source_sample}` : ""} {usedVideoTracks.includes(t.track) ? "(used)" : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Audio tracks — checkboxes, supports multi-mic */}
        <div>
          <div className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-dim">
            <Music size={10} stroke={1.5} /> Audio track(s)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {audioTracks.map((t) => {
              const checked = camera.audio_tracks.includes(t.track);
              return (
                <button
                  key={t.track}
                  onClick={() => toggleAudio(t.track)}
                  className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-all ${
                    checked
                      ? "bg-accent/15 text-accent ring-1 ring-accent/30"
                      : "bg-surface text-dim hover:text-ink"
                  }`}
                >
                  {t.track}
                  {t.clip_count > 0 && <span className="text-dim/60">·{t.clip_count}</span>}
                </button>
              );
            })}
            {audioTracks.length === 0 && (
              <span className="text-[10px] text-dim italic">No audio tracks found</span>
            )}
          </div>
          {camera.audio_tracks.length === 0 && (
            <p className="mt-1 text-[10px] text-amber-400">Select at least one audio track</p>
          )}
          {camera.audio_tracks.length > 1 && (
            <p className="mt-1 text-[10px] text-dim">
              {camera.audio_tracks.length} mics → mixed for speaker detection
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Step 3: Assign (review & confirm) ─────────────────────────────────────────

function AssignStep({
  project, tracks, onChange,
}: {
  project: CastCutProject;
  tracks: TrackInfo[];
  onChange: (cameras: CastCutCamera[]) => void;
}) {
  const hasWide = project.cameras.some((c) => c.type === "wide");
  const allAudioAssigned = project.cameras.every((c) => c.audio_tracks.length > 0);

  return (
    <div className="flex flex-1 flex-col items-center overflow-auto px-6 py-8">
      <div className="w-full max-w-xl">
        <div className="mb-6 text-center">
          <div className="mb-1 text-xl font-bold text-ink">Review assignment</div>
          <div className="text-sm text-dim">
            Confirm each camera's video track and audio mics. CastCut uses the audio to detect who's speaking.
          </div>
        </div>

        {!allAudioAssigned && (
          <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-400">
            <Warning size={13} stroke={1.5} className="mr-1 inline" />
            Some cameras have no audio track assigned — CastCut won't be able to detect their speaker.
          </div>
        )}

        {!hasWide && project.cameras.length >= 3 && (
          <div className="mb-4 rounded-xl border border-blue-500/15 bg-blue-500/8 px-4 py-3 text-xs text-blue-300">
            💡 Mark your group/room shot as <strong>Wide</strong> — CastCut will use it during silence and transitions.
          </div>
        )}

        <div className="space-y-2">
          {project.cameras.map((cam, i) => (
            <motion.div
              key={cam.id}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, ...spring.soft }}
              className="flex items-center gap-4 rounded-xl border border-white/[0.06] bg-surface/40 px-4 py-3"
            >
              <div className="h-3 w-3 shrink-0 rounded-full" style={{ background: cam.color }} />
              <div className="flex-1">
                <div className="text-sm font-semibold text-ink">{cam.name}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-dim">
                  <span className="flex items-center gap-1"><Film size={10} stroke={1.5} />{cam.video_track}</span>
                  <span className="text-dim/40">/</span>
                  <span className="flex items-center gap-1">
                    <Music size={10} stroke={1.5} />
                    {cam.audio_tracks.length > 0 ? cam.audio_tracks.join(", ") : <span className="text-amber-400">none</span>}
                  </span>
                </div>
              </div>
              <TypeBadge type={cam.type} />
            </motion.div>
          ))}
        </div>

        <div className="mt-6 rounded-xl border border-white/5 bg-surface/20 p-4 text-xs text-dim space-y-1.5">
          <div className="font-semibold text-ink mb-2">How CastCut uses this:</div>
          <div>• <strong className="text-ink">Solo / Two-shot</strong> cameras switch based on speaker dominance (loudest audio track)</div>
          <div>• <strong className="text-ink">Wide</strong> cameras appear during silence and transitions</div>
          <div>• <strong className="text-ink">Multiple audio tracks</strong> per camera are mixed before comparison — useful when one camera captures multiple lav mics</div>
        </div>
      </div>
    </div>
  );
}

// ─── Step 4: Tune ──────────────────────────────────────────────────────────────

function TuneStep({
  project, onPatchSettings,
}: {
  project: CastCutProject;
  onPatchSettings: (s: Partial<CastCutProject["settings"]>) => void;
}) {
  const s = project.settings;
  const hasWide = project.cameras.some((c) => c.type === "wide");

  return (
    <div className="flex flex-1 flex-col items-center overflow-auto px-6 py-8">
      <div className="w-full max-w-xl space-y-5">
        <div className="text-center">
          <div className="mb-1 text-xl font-bold text-ink">Editing settings</div>
          <div className="text-sm text-dim">Defaults work well for most podcasts.</div>
        </div>

        <Section title="Camera switching">
          <SliderField label="Cooldown between cuts" sub="Prevents rapid back-and-forth when speakers overlap briefly"
            value={s.cooldown} min={0.5} max={5} step={0.5} format={(v) => `${v}s`}
            onChange={(v) => onPatchSettings({ cooldown: v })} />
          <SliderField label="Silence threshold" sub="Audio below this level means nobody is speaking"
            value={s.silence_threshold} min={-60} max={-20} step={1} format={(v) => `${v} dB`}
            onChange={(v) => onPatchSettings({ silence_threshold: v })} />
          {hasWide && (
            <SliderField label="Wide shot amount" sub="Target fraction of the edit on the wide/group camera"
              value={s.wide_ratio} min={0} max={0.5} step={0.05} format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => onPatchSettings({ wide_ratio: v })} />
          )}
        </Section>

        <Section title="Silence removal">
          <label className="flex cursor-pointer items-center gap-3">
            <div onClick={() => onPatchSettings({ jump_cut_enabled: !s.jump_cut_enabled })}
              className={`relative h-5 w-9 rounded-full transition-colors ${s.jump_cut_enabled ? "bg-accent" : "bg-white/10"}`}>
              <motion.div className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow"
                animate={{ left: s.jump_cut_enabled ? "calc(100% - 18px)" : "2px" }} transition={spring.snappy} />
            </div>
            <div>
              <div className="text-sm font-medium text-ink">Remove silences before editing</div>
              <div className="text-xs text-dim">Strips pauses first — tightens pacing automatically</div>
            </div>
          </label>
          <AnimatePresence>
            {s.jump_cut_enabled && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }} className="overflow-hidden space-y-4">
                <SliderField label="Silence floor" sub="Pauses below this get removed"
                  value={s.jump_cut_threshold} min={-60} max={-20} step={1} format={(v) => `${v} dB`}
                  onChange={(v) => onPatchSettings({ jump_cut_threshold: v })} />
                <SliderField label="Minimum pause length" sub="Shorter gaps are kept — preserves natural breath"
                  value={s.jump_cut_min_silence} min={0.1} max={2.0} step={0.1} format={(v) => `${v}s`}
                  onChange={(v) => onPatchSettings({ jump_cut_min_silence: v })} />
              </motion.div>
            )}
          </AnimatePresence>
        </Section>
      </div>
    </div>
  );
}

// ─── Step 5: Run ────────────────────────────────────────────────────────────────

function RunStep({
  project, running, runLog, result, onRun, onClose,
}: {
  project: CastCutProject;
  running: boolean;
  runLog: string[];
  result: any;
  onRun: () => void;
  onClose: () => void;
}) {
  const { cameras, settings } = project;
  const hasWide = cameras.some((c) => c.type === "wide");

  if (result) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-8">
        <div className="w-full max-w-md space-y-5">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
              style={{ background: TEAL_GRADIENT }}>
              <Check size={22} stroke={2.5} className="text-white" />
            </div>
            <div className="text-xl font-bold text-ink">Edit complete</div>
            <div className="mt-1 text-sm text-dim">{result.name}</div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Camera cuts", value: String(result.cuts ?? 0) },
              { label: "Duration", value: `${result.duration_seconds ?? 0}s` },
              { label: "Wide shots", value: `${Math.round((result.actual_wide_ratio ?? 0) * 100)}%` },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-white/5 bg-surface/40 px-3 py-3 text-center">
                <div className="text-xs text-dim">{s.label}</div>
                <div className="text-lg font-bold text-ink">{s.value}</div>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-white/5 bg-surface/20 p-3 font-mono text-xs space-y-1">
            {runLog.map((line, i) => (
              <div key={i} className={line.startsWith("✓") ? "text-emerald-400" : line.startsWith("✗") ? "text-amber-400" : "text-dim"}>
                {line}
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-dim">
            Colored markers show each speaker. Export the sequence from the AI Editor to Premiere.
          </p>
          <button onClick={onClose} className="w-full rounded-xl py-2.5 text-sm font-semibold text-white" style={{ background: TEAL_GRADIENT }}>
            Done
          </button>
        </div>
      </div>
    );
  }

  if (running) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-8">
        <div className="w-full max-w-md space-y-5">
          <div className="text-center">
            <motion.div className="mx-auto mb-4 h-10 w-10 rounded-full border-2 border-dim border-t-accent"
              animate={{ rotate: 360 }} transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }} />
            <div className="text-lg font-semibold text-ink">Editing…</div>
          </div>
          <div className="rounded-xl border border-white/5 bg-surface/20 p-4 font-mono text-xs space-y-1.5">
            {runLog.map((line, i) => (
              <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-dim">{line}</motion.div>
            ))}
            <motion.span className="inline-block h-3 w-1.5 bg-accent"
              animate={{ opacity: [1, 0, 1] }} transition={{ repeat: Infinity, duration: 0.8 }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-8">
      <div className="w-full max-w-md space-y-5">
        <div className="text-center">
          <div className="mb-2 text-xl font-bold text-ink">Ready to edit</div>
          <div className="text-sm text-dim">CastCut will analyze all {cameras.length} camera audio tracks and build a switched edit.</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {cameras.map((cam) => (
            <div key={cam.id} className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-surface/40 px-3 py-2.5">
              <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: cam.color }} />
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-ink">{cam.name}</div>
                <div className="text-[10px] text-dim">{cam.video_track} · {cam.audio_tracks.join(", ")}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          {[
            { label: "Cooldown", value: `${settings.cooldown}s` },
            ...(hasWide ? [{ label: "Wide shots", value: `${Math.round(settings.wide_ratio * 100)}%` }] : []),
            ...(settings.jump_cut_enabled ? [{ label: "Silence cut", value: `${settings.jump_cut_threshold} dB` }] : []),
          ].map((s) => (
            <div key={s.label} className="flex-1 rounded-xl border border-white/5 bg-surface/30 px-3 py-2 text-center">
              <div className="text-[10px] text-dim">{s.label}</div>
              <div className="text-xs font-semibold text-ink">{s.value}</div>
            </div>
          ))}
        </div>
        <button onClick={onRun} className="w-full rounded-xl py-3 text-sm font-semibold text-white" style={{ background: TEAL_GRADIENT }}>
          {settings.jump_cut_enabled ? "Remove silences + build edit" : "Build camera-switched edit"}
        </button>
      </div>
    </div>
  );
}

// ─── Shared helpers ──────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4 rounded-2xl border border-white/5 bg-surface/30 p-5">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-dim">{title}</div>
      {children}
    </div>
  );
}

function SliderField({ label, sub, value, min, max, step, format, onChange }: {
  label: string; sub: string;
  value: number; min: number; max: number; step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-sm font-medium text-ink">{label}</div>
          <div className="text-xs text-dim">{sub}</div>
        </div>
        <div className="ml-4 shrink-0 text-sm font-semibold text-accent">{format(value)}</div>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full" style={{ accentColor: "var(--accent-base)" }} />
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    solo: { label: "Close-up", cls: "bg-blue-900/40 text-blue-300" },
    duo:  { label: "Two-shot", cls: "bg-violet-900/40 text-violet-300" },
    wide: { label: "Wide",     cls: "bg-emerald-900/40 text-emerald-300" },
  };
  const m = map[type] || { label: type, cls: "bg-white/5 text-dim" };
  return <span className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${m.cls}`}>{m.label}</span>;
}
