// CastCutHome — content-only (LauncherShell owns chrome).
// Split layout: project grid left, info sidebar right.
import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { spring, TEAL_GRADIENT } from "./theme";
import { Columns, Plus, ChevronRight, Close, Music, Film, Scissors, Warning, Folder, Check } from "./Icons";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface CastCutCamera {
  id: string;
  name: string;
  type: "solo" | "wide" | "duo";
  video_track: string;
  audio_tracks: string[];
  color: string;
}

export interface CastCutProject {
  id: string;
  name: string;
  workspace: string;
  sequence_id: string | null;
  cameras: CastCutCamera[];
  settings: {
    wide_ratio: number;
    cooldown: number;
    silence_threshold: number;
    jump_cut_enabled: boolean;
    jump_cut_threshold: number;
    jump_cut_min_silence: number;
  };
  created_at: number;
  updated_at: number;
  last_output_seq_id: string | null;
}

// ─── Sidebar tips ───────────────────────────────────────────────────────────────

const CASTCUT_TIPS = [
  {
    tag: "Setup",
    color: "#23C6A2",
    icon: Film,
    title: "One camera per video track",
    body: "Put each camera angle on its own video track (V1, V2, V3…) with audio on the matching A track. CastCut reads audio levels per-track to detect who's speaking.",
  },
  {
    tag: "Multi-mic",
    color: "#2E6BE6",
    icon: Music,
    title: "Multiple mics per speaker",
    body: "If one person has two lav mics (chest + backup), assign both A tracks to that camera. CastCut mixes them before comparing — no dead zones.",
  },
  {
    tag: "Editing",
    color: "#8B5CF6",
    icon: Columns,
    title: "Wide shot as a safety net",
    body: "Mark your room/group shot as Wide. CastCut cuts to it during silence and transitions — keeps the edit breathing even during rapid speaker switches.",
  },
  {
    tag: "Jump cuts",
    color: "#F59E0B",
    icon: Scissors,
    title: "Remove silences first",
    body: "Enable silence removal in Settings before the camera edit. It strips pauses from the source sequence first, so the camera edit has less dead air to navigate.",
  },
];

// ─── Main component ─────────────────────────────────────────────────────────────

export default function CastCutHome({
  workspaces,
  onOpenProject,
  onBackToProjects,
  onSettings,
}: {
  workspaces: string[];
  onOpenProject: (project: CastCutProject) => void;
  onBackToProjects?: () => void;
  onSettings?: () => void;
}) {
  const [projects, setProjects] = useState<CastCutProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);
  const [ctxMenu, setCtxMenu] = useState<{ project: CastCutProject; x: number; y: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.jcut.jc("castcut-projects-list", []);
      if (res.ok) {
        const data = JSON.parse(res.stdout);
        setProjects(data.projects || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (
    name: string,
    workspace: string,
    isNewWorkspace: boolean,
    footage: string[],
    sequenceName: string,
  ) => {
    // 1. If new workspace, create it with footage + sequence
    let finalSeqId: string | null = null;
    if (isNewWorkspace) {
      const setupArgs = ["--workspace", workspace, "--sequence-name", sequenceName, "--framerate", "30"];
      if (footage.length > 0) setupArgs.push("--files", ...footage);
      const setupRes = await window.jcut.jc("castcut-workspace-setup", setupArgs);
      if (setupRes.ok) {
        const setupData = JSON.parse(setupRes.stdout);
        finalSeqId = setupData.sequence_id || null;
      }
    }

    // 2. Create the CastCut project
    const projArgs = ["--name", name, "--workspace", workspace];
    if (finalSeqId) projArgs.push("--sequence-id", finalSeqId);
    const res = await window.jcut.jc("castcut-project-create", projArgs);
    if (res.ok) {
      const data = JSON.parse(res.stdout);
      if (data.ok && data.project) {
        // If sequence was created, patch it in (CLI returns project without it)
        const proj = finalSeqId ? { ...data.project, sequence_id: finalSeqId } : data.project;
        setProjects((prev) => [proj, ...prev]);
        setCreating(false);
        onOpenProject(proj);
      }
    }
  };

  const handleDelete = async (proj: CastCutProject) => {
    setCtxMenu(null);
    if (!window.confirm(`Delete "${proj.name}"? This cannot be undone.`)) return;
    await window.jcut.jc("castcut-project-delete", ["--id", proj.id]);
    setProjects((prev) => prev.filter((p) => p.id !== proj.id));
  };

  return (
    <div className="flex h-full" onClick={() => setCtxMenu(null)}>

      {/* ── Left: project list ───────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex shrink-0 items-center justify-between px-6 py-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-dim">
            {loading ? "" : projects.length > 0 ? `${projects.length} project${projects.length !== 1 ? "s" : ""}` : "No projects yet"}
          </span>
          <motion.button
            whileHover={{ scale: 1.04, y: -1 }} whileTap={{ scale: 0.96 }}
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white"
            style={{ background: TEAL_GRADIENT }}
          >
            <Plus size={13} stroke={2} /> New project
          </motion.button>
        </div>

        {/* Scrollable content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">

          {/* Empty hero */}
          {!loading && projects.length === 0 && (
            <CastCutHero onNew={() => setCreating(true)} />
          )}

          {/* Project grid */}
          {projects.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
              <AnimatePresence>
                {projects.map((proj, i) => (
                  <CastCutProjectTile
                    key={proj.id} project={proj} index={i}
                    onOpen={() => onOpenProject(proj)}
                    onContextMenu={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      setCtxMenu({ project: proj, x: e.clientX, y: e.clientY });
                    }}
                  />
                ))}
              </AnimatePresence>

              {!creating && (
                <motion.button
                  layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  whileHover={{ y: -3, scale: 1.01 }} whileTap={{ scale: 0.98 }}
                  onClick={() => setCreating(true)}
                  className="group flex aspect-video flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 text-dim hover:border-accent/40 hover:text-ink transition-colors"
                >
                  <span className="grid h-9 w-9 place-items-center rounded-full text-white shadow-lg transition group-hover:scale-110"
                    style={{ background: TEAL_GRADIENT }}>
                    <Plus size={16} stroke={1.5} />
                  </span>
                  <span className="text-xs font-medium">New CastCut project</span>
                </motion.button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Right sidebar ────────────────────────────────────────────────────── */}
      <div className="hidden md:flex w-64 lg:w-72 shrink-0 flex-col gap-4 border-l border-white/[0.05] bg-black/15 px-4 py-4 overflow-y-auto">

        {/* How it works */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md"
              style={{ background: "linear-gradient(135deg,#23C6A2,#2E6BE6)" }}>
              <Columns size={12} stroke={2} className="text-white" />
            </div>
            <span className="text-[11px] font-semibold text-ink">How CastCut works</span>
          </div>
          <div className="space-y-2">
            {[
              { n: "1", label: "Create a project", sub: "Name it, pick or create a workspace" },
              { n: "2", label: "Assign cameras", sub: "Map V/A tracks to speakers" },
              { n: "3", label: "Tune settings", sub: "Cooldown, wide shots, silence" },
              { n: "4", label: "Run the edit", sub: "CastCut builds the cut in seconds" },
            ].map((s) => (
              <div key={s.n} className="flex items-start gap-2.5">
                <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[9px] font-bold text-accent">
                  {s.n}
                </div>
                <div>
                  <div className="text-[11px] font-medium text-ink">{s.label}</div>
                  <div className="text-[10px] text-dim">{s.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-white/[0.05]" />

        {/* Tips carousel */}
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-dim">Tips</div>
          <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-surface/30 p-3.5">
            <AnimatePresence mode="wait">
              <motion.div
                key={tipIndex}
                initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }} transition={spring.snappy}
              >
                {(() => {
                  const tip = CASTCUT_TIPS[tipIndex];
                  const Icon = tip.icon;
                  return (
                    <>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white"
                          style={{ background: tip.color }}>
                          {tip.tag}
                        </span>
                        <Icon size={13} stroke={1.5} className="text-dim/60" />
                      </div>
                      <div className="mb-1 text-[12px] font-semibold text-ink">{tip.title}</div>
                      <div className="text-[11px] leading-relaxed text-dim">{tip.body}</div>
                    </>
                  );
                })()}
              </motion.div>
            </AnimatePresence>

            <div className="mt-3 flex items-center justify-between border-t border-white/[0.05] pt-2.5">
              <div className="flex gap-1">
                {CASTCUT_TIPS.map((_, i) => (
                  <button key={i} onClick={() => setTipIndex(i)}
                    className={`h-1 rounded-full transition-all ${i === tipIndex ? "w-4 bg-accent" : "w-1.5 bg-white/15"}`} />
                ))}
              </div>
              <div className="flex gap-1">
                <button onClick={() => setTipIndex((p) => (p - 1 + CASTCUT_TIPS.length) % CASTCUT_TIPS.length)}
                  className="grid h-5 w-5 place-items-center rounded bg-surface2 text-dim hover:text-ink">
                  <ChevronRight size={10} stroke={1.5} className="rotate-180" />
                </button>
                <button onClick={() => setTipIndex((p) => (p + 1) % CASTCUT_TIPS.length)}
                  className="grid h-5 w-5 place-items-center rounded bg-surface2 text-dim hover:text-ink">
                  <ChevronRight size={10} stroke={1.5} />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-white/[0.05]" />

        {/* No-AI badge */}
        <div className="rounded-xl border border-white/[0.06] bg-surface/20 p-3">
          <div className="mb-1.5 flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">Fully local</span>
          </div>
          <p className="text-[11px] leading-relaxed text-dim">
            No API calls, no subscription, no cloud. CastCut runs entirely on your machine using audio analysis and geometry — same results every time.
          </p>
        </div>
      </div>

      {/* New project modal — portal so it floats above everything */}
      {creating && createPortal(
        <AnimatePresence>
          <NewProjectModal
            workspaces={workspaces}
            onCreate={handleCreate}
            onCancel={() => setCreating(false)}
          />
        </AnimatePresence>,
        document.body,
      )}

      {/* Context menu */}
      <AnimatePresence>
        {ctxMenu && (
          <CtxMenu
            x={ctxMenu.x} y={ctxMenu.y}
            onOpen={() => { onOpenProject(ctxMenu.project); setCtxMenu(null); }}
            onDelete={() => handleDelete(ctxMenu.project)}
            onClose={() => setCtxMenu(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Empty state hero ──────────────────────────────────────────────────────────

function CastCutHero({ onNew }: { onNew: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex min-h-[360px] flex-col items-center justify-center text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl shadow-xl"
        style={{ background: "linear-gradient(135deg,#23C6A2,#2E6BE6)" }}>
        <Columns size={30} stroke={1.8} className="text-white" />
      </div>
      <h2 className="mb-2 text-xl font-bold text-ink">No projects yet</h2>
      <p className="mb-6 max-w-xs text-sm text-dim">
        Create a CastCut project to get started. You can create a new workspace from scratch or use an existing one.
      </p>
      <motion.button whileHover={{ scale: 1.04, y: -2 }} whileTap={{ scale: 0.97 }}
        onClick={onNew}
        className="flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white shadow-lg"
        style={{ background: "linear-gradient(135deg,#23C6A2,#2E6BE6)" }}>
        <Plus size={15} stroke={2} /> Create first project
      </motion.button>
    </motion.div>
  );
}

// ─── New project modal ─────────────────────────────────────────────────────────

function NewProjectModal({
  workspaces, onCreate, onCancel,
}: {
  workspaces: string[];
  onCreate: (name: string, workspace: string, isNew: boolean, footage: string[], seqName: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [wsMode, setWsMode] = useState<"existing" | "new">(workspaces.length === 0 ? "new" : "existing");
  const [existingWs, setExistingWs] = useState(workspaces[0] ?? "");
  const [newWsName, setNewWsName] = useState("");
  const [footage, setFootage] = useState<string[]>([]);
  const [addingFootage, setAddingFootage] = useState(false);
  const [seqName, setSeqName] = useState("Podcast Edit");

  const pickFootage = async () => {
    setAddingFootage(true);
    try {
      const res = await window.jcut.pickMedia();
      if (res.ok && res.paths?.length) {
        setFootage((prev) => [...new Set([...prev, ...res.paths!])]);
      }
    } finally { setAddingFootage(false); }
  };

  const removeFootage = (f: string) => setFootage((prev) => prev.filter((x) => x !== f));

  const canSubmit = !!(name.trim() && (wsMode === "existing" ? existingWs : newWsName.trim()));

  const submit = () => {
    if (!canSubmit) return;
    const ws = wsMode === "existing" ? existingWs : newWsName.trim();
    onCreate(name.trim(), ws, wsMode === "new", footage, seqName.trim() || "Podcast Edit");
  };

  return (
    <motion.div
      className="fixed inset-0 z-[150] flex items-center justify-center p-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />

      {/* Modal */}
      <motion.div
        initial={{ scale: 0.93, y: 16, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.95, y: 8, opacity: 0 }}
        transition={spring.snappy}
        className="relative flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-surface shadow-card"
        style={{ maxHeight: "calc(100vh - 6rem)" }}
      >
        {/* Header — fixed */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div>
            <div className="text-[15px] font-bold text-ink">New CastCut project</div>
            <div className="text-xs text-dim">Name it and choose or create a workspace</div>
          </div>
          <button onClick={onCancel} className="text-dim hover:text-ink transition-colors">
            <Close size={15} stroke={1.5} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Project name */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-dim">Project name</label>
            <input
              autoFocus value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) submit(); if (e.key === "Escape") onCancel(); }}
              placeholder="e.g. Podcast Ep 42"
              className="w-full rounded-lg bg-surface2 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
          </div>

          {/* Workspace */}
          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-dim">Workspace</label>
            <div className="flex rounded-lg bg-black/20 p-0.5">
              {(["existing", "new"] as const)
                .filter((m) => m === "new" || workspaces.length > 0)
                .map((m) => (
                  <button
                    key={m} onClick={() => setWsMode(m)}
                    className={`flex-1 rounded-md py-1.5 text-[11px] font-medium transition-colors ${
                      wsMode === m ? "bg-surface text-ink shadow-sm" : "text-dim hover:text-ink"
                    }`}
                  >
                    {m === "existing" ? "Use existing" : "Create new"}
                  </button>
                ))}
            </div>
            {wsMode === "existing" ? (
              <select value={existingWs} onChange={(e) => setExistingWs(e.target.value)}
                className="w-full rounded-lg bg-surface2 px-3 py-2 text-sm text-ink focus:outline-none">
                {workspaces.map((ws) => <option key={ws} value={ws}>{ws}</option>)}
              </select>
            ) : (
              <input value={newWsName} onChange={(e) => setNewWsName(e.target.value)}
                placeholder="e.g. My Podcast"
                className="w-full rounded-lg bg-surface2 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent/50" />
            )}
          </div>

          {/* Footage — new workspace only */}
          {wsMode === "new" && (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-dim">
                    Footage {footage.length > 0 && <span className="text-accent">({footage.length} files)</span>}
                  </label>
                  <button onClick={pickFootage} disabled={addingFootage}
                    className="flex items-center gap-1 text-[11px] text-accent hover:opacity-75 disabled:opacity-40">
                    <Folder size={11} stroke={1.5} />
                    {addingFootage ? "Picking…" : "Add files"}
                  </button>
                </div>

                {footage.length === 0 ? (
                  <button onClick={pickFootage} disabled={addingFootage}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 py-4 text-xs text-dim hover:border-accent/30 hover:text-ink transition-colors disabled:opacity-40">
                    <Folder size={14} stroke={1.5} />
                    Click to add footage
                  </button>
                ) : (
                  <div className="max-h-40 overflow-y-auto rounded-xl border border-white/[0.06] bg-black/10">
                    {footage.map((f, i) => (
                      <div key={f}
                        className={`flex items-center gap-2 px-3 py-2 ${i > 0 ? "border-t border-white/[0.04]" : ""}`}>
                        <Film size={11} stroke={1.5} className="shrink-0 text-dim" />
                        <span className="min-w-0 flex-1 truncate text-[11px] text-ink">{f.split("/").pop()}</span>
                        <button onClick={() => removeFootage(f)}
                          className="shrink-0 text-dim/50 hover:text-red-400 transition-colors">
                          <Close size={11} stroke={1.5} />
                        </button>
                      </div>
                    ))}
                    <button onClick={pickFootage} disabled={addingFootage}
                      className="flex w-full items-center justify-center gap-1 border-t border-white/[0.04] py-2 text-[10px] text-dim hover:text-ink disabled:opacity-40">
                      <Plus size={10} stroke={1.5} /> Add more
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-dim">Sequence name</label>
                <input value={seqName} onChange={(e) => setSeqName(e.target.value)}
                  placeholder="Podcast Edit"
                  className="w-full rounded-lg bg-surface2 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent/50" />
              </div>
            </>
          )}
        </div>

        {/* Footer — fixed */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-white/[0.06] px-5 py-3">
          <button onClick={onCancel}
            className="rounded-lg bg-surface2 px-4 py-2 text-sm text-dim hover:text-ink transition-colors">
            Cancel
          </button>
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={submit} disabled={!canSubmit}
            className="flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
            style={{ background: TEAL_GRADIENT }}
          >
            <Check size={13} stroke={2.5} />
            {wsMode === "new" ? "Create workspace & open" : "Create project"}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Project tile ──────────────────────────────────────────────────────────────

function CastCutProjectTile({
  project, index, onOpen, onContextMenu,
}: {
  project: CastCutProject; index: number;
  onOpen: () => void; onContextMenu: (e: React.MouseEvent) => void;
}) {
  const cameraCount = project.cameras.length;
  const isReady = cameraCount >= 2 && !!project.sequence_id;
  const updated = new Date(project.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={{ ...spring.soft, delay: Math.min(index * 0.04, 0.2) }}
      whileHover={{ y: -3, scale: 1.015 }}
      whileTap={{ scale: 0.985 }}
      onClick={onOpen} onContextMenu={onContextMenu}
      className="group flex flex-col overflow-hidden rounded-xl border border-white/[0.06] bg-surface/50 text-left shadow-card transition-colors hover:border-white/10"
    >
      {/* Camera color bar */}
      <div className="flex h-1 w-full overflow-hidden">
        {cameraCount > 0
          ? project.cameras.map((c) => <div key={c.id} className="flex-1" style={{ background: c.color }} />)
          : <div className="flex-1 bg-white/5" />}
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-ink">{project.name}</div>
            <div className="truncate text-[11px] text-dim">{project.workspace}</div>
          </div>
          <ChevronRight size={13} stroke={1.5} className="mt-0.5 shrink-0 text-dim transition group-hover:translate-x-0.5 group-hover:text-ink" />
        </div>

        {cameraCount > 0 ? (
          <div className="flex flex-wrap gap-1">
            {project.cameras.map((c) => (
              <span key={c.id} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
                style={{ background: c.color + "28", color: c.color }}>
                <span className="h-1 w-1 rounded-full" style={{ background: c.color }} />
                {c.name}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-[11px] italic text-dim">Open to configure cameras</span>
        )}

        <div className="flex items-center justify-between">
          <span className="text-[10px] text-dim">{updated}</span>
          {isReady
            ? <span className="rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">Ready</span>
            : !project.sequence_id
            ? <span className="rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] text-amber-400">No sequence</span>
            : <span className="rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] text-amber-400">Setup needed</span>
          }
        </div>
      </div>
    </motion.button>
  );
}

// ─── Context menu ──────────────────────────────────────────────────────────────

function CtxMenu({ x, y, onOpen, onDelete, onClose }: {
  x: number; y: number; onOpen: () => void; onDelete: () => void; onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, y: -4 }}
      transition={spring.snappy}
      style={{ position: "fixed", left: Math.min(x, window.innerWidth - 180), top: Math.min(y, window.innerHeight - 100), zIndex: 200 }}
      className="w-44 overflow-hidden rounded-xl bg-surface/95 py-1 shadow-card backdrop-blur-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <button onClick={onOpen} className="flex w-full px-3.5 py-2 text-sm text-ink hover:bg-surface2">Open</button>
      <div className="my-1 border-t border-white/5" />
      <button onClick={onDelete} className="flex w-full px-3.5 py-2 text-sm text-red-400 hover:bg-surface2">Delete…</button>
    </motion.div>
  );
}
