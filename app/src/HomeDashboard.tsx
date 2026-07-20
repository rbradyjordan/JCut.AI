// HomeDashboard — the launcher's landing view.
//
// Replaces "drop the user straight into a project grid" with an orienting home:
//   1. A clear two-card chooser that explains the app's two tools (AI Editor vs
//      CastCut) so a first-time user knows exactly where to go.
//   2. "Jump back in" — recent projects merged across BOTH tools, newest first,
//      so a returning user is one click from where they left off.
// Chrome (nav rail, settings) is owned by LauncherShell.
import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { spring, TEAL_GRADIENT, BLUE_GRADIENT } from "./theme";
import { Sparkle, Columns, Plus, ChevronRight, Folder, Scissors } from "./Icons";
import type { CastCutProject } from "./CastCutHome";

interface RecentItem {
  kind: "ai" | "castcut";
  key: string;
  title: string;
  subtitle: string;
  updated: number;
  cameras?: { id: string; color: string }[];
  project?: CastCutProject;
  workspace?: string;
}

export default function HomeDashboard({
  workspaces, onOpenAI, onOpenCastCut, onGoAIEditor, onGoCastCut,
}: {
  workspaces: string[];
  onOpenAI: (ws: string) => void;
  onOpenCastCut: (p: CastCutProject) => void;
  onGoAIEditor: () => void;
  onGoCastCut: () => void;
}) {
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const items: RecentItem[] = [];
    // AI projects (workspaces) with recency from list-workspaces meta.
    try {
      const r = await window.jcut.listWorkspaces();
      if (r.ok) {
        const meta = r.meta || {};
        for (const ws of r.workspaces) {
          items.push({
            kind: "ai", key: `ai:${ws}`, title: ws, subtitle: "AI Editor",
            updated: meta[ws] || 0, workspace: ws,
          });
        }
      }
    } catch { /* ignore */ }
    // CastCut projects with their own updated_at.
    try {
      const r = await window.jcut.jc("castcut-projects-list", []);
      if (r.ok) {
        const data = JSON.parse(r.stdout);
        for (const p of (data.projects || []) as CastCutProject[]) {
          items.push({
            kind: "castcut", key: `cc:${p.id}`, title: p.name,
            subtitle: `CastCut · ${p.cameras.length} camera${p.cameras.length === 1 ? "" : "s"}`,
            updated: p.updated_at || 0,
            cameras: p.cameras.map((c) => ({ id: c.id, color: c.color })),
            project: p,
          });
        }
      }
    } catch { /* ignore */ }
    items.sort((a, b) => b.updated - a.updated);
    setRecent(items.slice(0, 8));
    setLoaded(true);
  }, []);

  useEffect(() => { load(); }, [load, workspaces.length]);

  return (
    <div className="h-full overflow-y-auto no-drag">
      <div className="mx-auto max-w-5xl px-8 py-8">

        {/* Greeting */}
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}
          className="mb-7"
        >
          <h1 className="text-[26px] font-semibold tracking-tight text-ink">Welcome to JCut</h1>
          <p className="mt-1 text-sm text-dim">Pick how you want to edit — or jump back into a recent project.</p>
        </motion.div>

        {/* Tool chooser */}
        <div className="grid gap-4 sm:grid-cols-2">
          <ToolCard
            gradient={TEAL_GRADIENT}
            icon={<Sparkle size={22} stroke={1.6} />}
            title="AI Editor"
            tagline="Chat your way to a finished timeline"
            body="Describe the edit in plain language. JCut scans your footage, builds the cut, and refines it as you chat."
            cta="Open AI Editor"
            onClick={onGoAIEditor}
            delay={0.04}
          />
          <ToolCard
            gradient={BLUE_GRADIENT}
            icon={<Columns size={22} stroke={1.6} />}
            title="CastCut"
            tagline="Automatic multi-camera podcast editing"
            body="Point it at your camera tracks. CastCut detects who's speaking and cuts between angles automatically — no AI subscription, runs on your Mac or inside Premiere."
            cta="Open CastCut"
            onClick={onGoCastCut}
            delay={0.09}
          />
        </div>

        {/* Jump back in */}
        <div className="mt-9">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-dim">Jump back in</h2>
          </div>

          {loaded && recent.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-black/10 px-6 py-10 text-center">
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full text-white shadow-card" style={{ background: TEAL_GRADIENT }}>
                <Plus size={20} stroke={1.6} />
              </div>
              <p className="text-sm font-medium text-ink">No projects yet</p>
              <p className="mt-1 text-xs text-dim">Open a tool above to create your first project.</p>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              {recent.map((it, i) => (
                <RecentTile
                  key={it.key} item={it} index={i}
                  onClick={() => it.kind === "ai" ? onOpenAI(it.workspace!) : onOpenCastCut(it.project!)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolCard({
  gradient, icon, title, tagline, body, cta, onClick, delay,
}: {
  gradient: string; icon: React.ReactNode; title: string; tagline: string;
  body: string; cta: string; onClick: () => void; delay: number;
}) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.soft, delay }}
      whileHover={{ y: -3 }} whileTap={{ scale: 0.99 }}
      onClick={onClick}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface/50 p-5 text-left shadow-card transition-colors hover:border-white/15"
    >
      <div className="absolute inset-0 opacity-[0.06] transition-opacity group-hover:opacity-[0.12]" style={{ background: gradient }} />
      <div className="relative">
        <div className="grid h-11 w-11 place-items-center rounded-xl text-white shadow-lg" style={{ background: gradient }}>
          {icon}
        </div>
        <h3 className="mt-3.5 text-lg font-semibold text-ink">{title}</h3>
        <p className="text-[13px] font-medium text-ink/70">{tagline}</p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-dim">{body}</p>
        <span className="mt-4 inline-flex items-center gap-1.5 rounded-pill px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-sm" style={{ background: gradient }}>
          {cta}
          <ChevronRight size={13} stroke={2} className="transition group-hover:translate-x-0.5" />
        </span>
      </div>
    </motion.button>
  );
}

function RecentTile({ item, index, onClick }: { item: RecentItem; index: number; onClick: () => void }) {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (item.kind === "ai" && item.workspace) {
      window.jcut.projectThumbnail(item.workspace).then((r) => {
        if (alive && r.ok) setThumb(r.dataUrl);
      }).catch(() => { /* ignore */ });
    }
    return () => { alive = false; };
  }, [item]);

  const rel = relTime(item.updated);
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring.soft, delay: Math.min(index * 0.03, 0.18) }}
      whileHover={{ y: -3 }} whileTap={{ scale: 0.985 }}
      onClick={onClick}
      className="group flex flex-col overflow-hidden rounded-xl border border-line bg-surface/50 text-left shadow-card transition-colors hover:border-white/12"
    >
      {/* Preview */}
      <div className="relative aspect-video w-full overflow-hidden bg-black/30">
        {item.kind === "ai" ? (
          thumb ? (
            <img src={thumb} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center text-dim/40"><Folder size={26} stroke={1.3} /></div>
          )
        ) : (
          <div className="flex h-full w-full flex-col justify-end">
            <div className="grid flex-1 place-items-center text-dim/40"><Scissors size={24} stroke={1.3} /></div>
            <div className="flex h-1.5 w-full">
              {item.cameras && item.cameras.length > 0
                ? item.cameras.map((c) => <div key={c.id} className="flex-1" style={{ background: c.color }} />)
                : <div className="flex-1 bg-white/5" />}
            </div>
          </div>
        )}
        {/* Type badge */}
        <span className="absolute left-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/90 backdrop-blur-sm">
          {item.kind === "ai" ? "AI" : "CastCut"}
        </span>
      </div>
      {/* Meta */}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-ink">{item.title}</div>
          <div className="truncate text-[10.5px] text-dim">{item.subtitle}{rel ? ` · ${rel}` : ""}</div>
        </div>
        <ChevronRight size={13} stroke={1.5} className="shrink-0 text-dim transition group-hover:translate-x-0.5 group-hover:text-ink" />
      </div>
    </motion.button>
  );
}

function relTime(ms: number): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
