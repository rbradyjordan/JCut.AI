// Renders an agent/user message beautifully:
//  • Tool-call lines ("· Bash: {json}" or "· Tool: ...") become dimmed, italic,
//    plain-English action lines ("Reading your workspace memory…").
//  • Lightweight markdown: **bold**, *italic*, `code`, # headings, - / 1. lists,
//    and paragraphs. No external deps.
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { spring, TEAL_GRADIENT } from "./theme";

// Plain-English label for a jc command, given its raw arg string (so we can add
// useful detail like "Adding 9 clips" or which playbook is being read).
function jcActionLabel(jc: string, args: string): string | null {
  const ACTIONS: Record<string, string> = {
    "memory-read": "Reading your workspace memory",
    "memory-append": "Saving a note to memory",
    "criteria-get": "Checking your preferences",
    "criteria-set": "Saving your preferences",
    "sources-list": "Looking at your footage",
    "source-add": "Adding footage",
    "source-relink": "Relinking footage",
    "sequences-list": "Looking at your sequences",
    "sequence-inspect": "Reviewing the timeline",
    "sequence-create": "Creating a new sequence",
    "sequence-clips-update": "Adjusting clips",
    "sequence-clips-remove": "Removing clips",
    "sequence-captions-add": "Adding captions",
    "sequence-captions-remove": "Removing captions",
    "sequence-captions-list": "Reviewing captions",
    "sequence-transitions-add": "Adding transitions",
    "sequence-transitions-remove": "Removing transitions",
    "sequence-transitions-list": "Reviewing transitions",
    "sequence-export-premiere": "Exporting to Premiere",
    "sequence-analyze": "Analyzing the cut",
    "sequence-import-prproj": "Importing the timeline",
    "sequence-reframe": "Reframing clips",
    "prproj-analyze": "Reading the Premiere project",
    "style-learn": "Learning your editing style",
    "media-info": "Checking the footage",
    "media-frames": "Sampling the footage",
    "media-frames-batch": "Surveying the footage",
    "content-set": "Noting what's in a clip",
    "content-list": "Reviewing analyzed footage",
    "analyze-music": "Analyzing the music",
    "analyze-video": "Analyzing a clip",
    "transcript-import": "Importing the transcript",
    "transcript-search": "Finding lines in the transcript",
    "transcript-list": "Reviewing transcripts",
    "transcript-get": "Reading the transcript",
    "modes-list": "Loading editing modes",
    "mode-get": "Loading the editing style",
    "kb-read": "Reading the playbook",
    "kb-list": "Reading the playbook",
  };
  let label = ACTIONS[jc];
  if (!label) return null;

  // Enrich a few with concrete detail pulled from the args.
  if (jc === "sequence-clips-add") {
    const n = (args.match(/"clip"|"source"|"type"\s*:\s*"add"/g) || []).length;
    if (n > 0) label = `Adding ${n} clip${n === 1 ? "" : "s"} to the timeline`;
    else label = "Placing clips on the timeline";
  } else if (jc === "kb-read") {
    const id = args.match(/--id\s+([a-z0-9-]+)/)?.[1] || args.match(/"id"\s*:\s*"([a-z0-9-]+)/)?.[1];
    const pretty: Record<string, string> = {
      "recap-videos": "the recap playbook",
      "interviews-dialogue": "the interview playbook",
      "short-form-social": "the short-form playbook",
      "trailer-hype": "the trailer playbook",
      "wedding-event": "the wedding playbook",
      "music-video": "the music-video playbook",
      "documentary-narrative": "the documentary playbook",
    };
    if (id) label = `Reading ${pretty[id] || "the playbook"}`;
  } else if (jc === "analyze-music") {
    const file = args.match(/--file\s+(.+?)(?:\s+--|\s*$)/)?.[1] || args.match(/"file"\s*:\s*"([^"]+)/)?.[1];
    const name = file?.split("/").pop();
    if (name) label = `Analyzing the beat of ${name}`;
  } else if (jc === "analyze-video") {
    const file = args.match(/--file\s+(.+?)(?:\s+--|\s*$)/)?.[1] || args.match(/"file"\s*:\s*"([^"]+)/)?.[1];
    const name = file?.split("/").pop();
    if (name) label = `Reading shot composition and motion in ${name}`;
  }
  return label;
}

// ── Translate a raw tool invocation into plain editor-speak ──────────────────
function humanizeToolLine(line: string): string | null {
  // Local-agent format: "· jc <command> <args...>"
  const local = line.match(/^[·•]\s*jc\s+([a-z][a-z0-9-]*)\s*(.*)$/i);
  if (local) {
    const label = jcActionLabel(local[1], local[2] || "");
    return label ? label + "…" : "Working…";
  }

  // Claude-backend format: "· Bash: {...}" / "· Read: {...}" etc.
  const m = line.match(/^[·•]\s*(\w+):\s*(\{.*\}|.*)$/);
  if (!m) return null;
  const tool = m[1];
  let payload = m[2] || "";

  // Pull jc commands out of a Bash call. Use the LAST one in a chained (&&) call —
  // that's the active step (fixes "stuck on Analyzing the music" mislabels).
  const allCmds = [...payload.matchAll(/cli\.js\s+([a-z-]+)/g)].map((x) => x[1]);
  const lastJc = allCmds.length ? allCmds[allCmds.length - 1]
    : (payload.match(/"command"\s*:\s*"([a-z-]+)/)?.[1] || undefined);
  if (lastJc) {
    const label = jcActionLabel(lastJc, payload);
    if (label) return label + "…";
  }
  if (tool === "Read") {
    // Reading an extracted frame = visually reviewing footage.
    if (/\/frames?\/|\.jpe?g|\.png/i.test(payload)) return "Reviewing footage…";
    return "Looking at a file…";
  }

  // Generic Bash → infer intent from the command verb so it isn't all "Working…".
  if (tool === "Bash") {
    const cmd = (payload.match(/"command"\s*:\s*"([^"]+)/)?.[1] || payload).toLowerCase();
    if (/\b(ls|find|fd)\b/.test(cmd) || /\.app/.test(cmd)) return "Searching your files…";
    if (/\b(grep|rg|ag)\b/.test(cmd)) return "Searching the project…";
    if (/\bffprobe\b/.test(cmd)) return "Inspecting media…";
    if (/\bffmpeg\b/.test(cmd)) return "Processing video…";
    if (/\b(cat|head|tail)\b/.test(cmd)) return "Reading a file…";
    if (/\bmkdir|ln -s|symlink\b/.test(cmd)) return "Organizing files…";
    if (/import-prproj|prproj/.test(cmd)) return "Reading the Premiere project…";
    if (/analyze-music/.test(cmd)) return "Analyzing the music…";
    return "Working…";
  }
  return `${tool}…`;
}

// ── Minimal inline markdown → React nodes ────────────────────────────────────
function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // tokenize **bold**, *italic*, `code`
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0; let i = 0; let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const tok = match[0];
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith("**")) nodes.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) nodes.push(
      <code key={k} className="rounded bg-surface2 px-1.5 py-0.5 text-[12px] text-accent">{tok.slice(1, -1)}</code>);
    else nodes.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = match.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

interface Block {
  type: "p" | "h" | "li" | "tool" | "code";
  text: string;
  ordered?: boolean;
}

function parseBlocks(raw: string): Block[] {
  const lines = raw.replace(/\r/g, "").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { blocks.push({ type: "p", text: para.join(" ") }); para = []; } };

  for (const line of lines) {
    const tool = humanizeToolLine(line);
    if (tool) { flush(); blocks.push({ type: "tool", text: tool }); continue; }
    const trimmed = line.trim();
    if (!trimmed) { flush(); continue; }
    if (/^#{1,6}\s/.test(trimmed)) { flush(); blocks.push({ type: "h", text: trimmed.replace(/^#+\s/, "") }); continue; }
    if (/^[-*]\s/.test(trimmed)) { flush(); blocks.push({ type: "li", text: trimmed.replace(/^[-*]\s/, "") }); continue; }
    if (/^\d+\.\s/.test(trimmed)) { flush(); blocks.push({ type: "li", text: trimmed.replace(/^\d+\.\s/, ""), ordered: true }); continue; }
    para.push(trimmed);
  }
  flush();
  return blocks;
}

// Collapse runs of consecutive tool blocks into ONE "progress" block carrying the
// latest action + the list of all step labels (so they can be expanded inline).
type CBlock = Block & { steps?: number; substeps?: string[] };
function collapseToolRuns(blocks: Block[]): CBlock[] {
  const out: CBlock[] = [];
  for (const b of blocks) {
    const prev = out[out.length - 1];
    if (b.type === "tool" && prev && prev.type === "tool") {
      prev.text = b.text;
      prev.steps = (prev.steps || 1) + 1;
      prev.substeps = [...(prev.substeps || []), b.text];
    } else {
      out.push({ ...b, steps: b.type === "tool" ? 1 : undefined, substeps: b.type === "tool" ? [b.text] : undefined });
    }
  }
  return out;
}

export default function ChatMessage({ role, text, live, showReasoning, onCopy, onRetry, isLocal }: {
  role: "user" | "agent"; text: string; live?: boolean; showReasoning?: boolean;
  onCopy?: () => void; onRetry?: () => void; isLocal?: boolean;
}) {
  const isUser = role === "user";
  const [copied, setCopied] = useState(false);
  const copy = () => { onCopy?.(); setCopied(true); setTimeout(() => setCopied(false), 1200); };
  // With "show reasoning" on, keep every tool line separate (don't collapse runs)
  // so the user sees each step explicitly.
  const parsed = parseBlocks(text);
  const blocks = showReasoning ? parsed.map((b) => ({ ...b })) : collapseToolRuns(parsed);
  const isLive = !!live;
  // The final tool block is "active" only while this message is still streaming.
  const lastToolIdx = blocks.map((b) => b.type).lastIndexOf("tool");
  // While live, if the LAST block is NOT a running tool (it's reasoning text, or
  // we're between tool calls), the agent is THINKING about the next step. Show an
  // explicit, ticking "Thinking…" row so a 30-40s model pause never looks frozen.
  const lastBlock = blocks[blocks.length - 1];
  const showThinking = isLive && (!lastBlock || lastBlock.type !== "tool");
  const showStarting = isLive && blocks.length === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring.snappy}
      className={`group flex flex-col ${isUser ? "items-end" : "items-start"}`}
    >
      <div
        className={`max-w-[80%] space-y-2 rounded-xl2 px-4 py-3 text-[14px] leading-relaxed shadow-card ${
          isUser ? "text-white" : "bg-surface text-ink shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]"
        }`}
        style={isUser ? { background: TEAL_GRADIENT } : undefined}
      >
        {showStarting && <StartingUp isLocal={!!isLocal} active={isLive} />}
        {blocks.map((b, i) => {
          if (b.type === "tool") {
            const active = isLive && i === lastToolIdx;
            return <ToolBlock key={i} b={b} active={active} />;
          }
          if (b.type === "h") return <div key={i} className="pt-1 text-[15px] font-semibold">{renderInline(b.text, `h${i}`)}</div>;
          if (b.type === "li") return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="text-dim">{b.ordered ? "›" : "•"}</span>
              <span>{renderInline(b.text, `li${i}`)}</span>
            </div>
          );
          return <p key={i}>{renderInline(b.text, `p${i}`)}</p>;
        })}
        {showThinking && <ThinkingRow isLocal={!!isLocal} active={isLive} />}
      </div>

      {/* Hover action row under the bubble (ChatGPT-style): copy + retry. */}
      {(onCopy || onRetry) && !isLive && (
        <div className="mt-1 flex gap-1 px-1 opacity-0 transition group-hover:opacity-100">
          {onCopy && (
            <button
              onClick={copy}
              className="rounded-md px-1.5 py-0.5 text-[11px] text-dim hover:bg-surface2 hover:text-ink"
              title="Copy message"
            >{copied ? "✓ Copied" : "⧉ Copy"}</button>
          )}
          {onRetry && (
            <button
              onClick={onRetry}
              className="rounded-md px-1.5 py-0.5 text-[11px] text-dim hover:bg-surface2 hover:text-ink"
              title="Retry — re-send this message"
            >↻ Retry</button>
          )}
        </div>
      )}
    </motion.div>
  );
}

function getEstDuration(text: string): number {
  if (text.includes("Analyzing the beat") || text.includes("Analyzing the music")) return 15;
  if (text.includes("Adding") && text.includes("clip")) return 10;
  if (text.includes("Learning your editing style")) return 12;
  if (text.includes("Exporting to Premiere")) return 6;
  if (text.includes("Checking the footage") || text.includes("Sampling the footage") || text.includes("Surveying the footage")) return 8;
  if (text.includes("Importing the timeline") || text.includes("Reading the Premiere project")) return 8;
  if (text.includes("Adjusting clips") || text.includes("Removing clips")) return 5;
  return 3; // default for quick CLI commands
}

function ProgressBar({ duration, active }: { duration: number; active: boolean }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [active]);

  const pct = active 
    ? Math.min(98, Math.round((elapsed / duration) * 100)) 
    : 100;

  const remaining = Math.max(0, duration - elapsed);
  
  let estimateLabel = "";
  if (active) {
    if (remaining > 0) {
      if (remaining >= 60) {
        estimateLabel = `Est: ${Math.floor(remaining / 60)}m ${remaining % 60}s remaining`;
      } else {
        estimateLabel = `Est: ${remaining}s remaining`;
      }
    } else {
      estimateLabel = "Finishing up…";
    }
  }

  return (
    <div className="space-y-1 w-full mt-1.5">
      <div className="flex justify-between text-[10px] text-dim/70 font-mono">
        <span>{pct}%</span>
        {active && <span>{estimateLabel}</span>}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface">
        <motion.div 
          className="h-full rounded-full" 
          style={{ background: TEAL_GRADIENT }}
          initial={{ width: "2%" }}
          animate={{ width: `${pct}%` }}
          transition={{ ease: "linear", duration: active ? 1 : 0.3 }}
        />
      </div>
    </div>
  );
}

// Visible "Thinking…" row for the gaps between tool calls (the model reasoning).
// The ticking timer makes a 30-40s pause obviously alive, not frozen.
function ThinkingRow({ isLocal, active }: { isLocal: boolean; active: boolean }) {
  const estDuration = isLocal ? 90 : 8;
  return (
    <div className="my-0.5 rounded-lg depth-chip px-2.5 py-1.5 shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]">
      <div className="flex items-center gap-2 text-[12.5px] italic text-dim">
        <motion.span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent)" }}
          animate={active ? { opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] } : { opacity: 1, scale: 1 }}
          transition={active ? { duration: 1, repeat: Infinity } : { duration: 0.2 }} />
        <span className="flex-1">Thinking…</span>
        <ElapsedTimer active={active} />
      </div>
      <ProgressBar duration={estDuration} active={active} />
    </div>
  );
}

// Live elapsed-time chip — proves the agent is alive during long model turns
// (so a multi-minute "thinking" step never looks frozen).
function ElapsedTimer({ active = true }: { active?: boolean }) {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setS((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
  const label = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  return (
    <span className="rounded-full bg-surface px-1.5 text-[10px] not-italic tabular-nums text-dim shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]">
      {label}
    </span>
  );
}

// A collapsed tool-progress row. Click to expand and see every step (reasoning).
function ToolBlock({ b, active }: { b: CBlock; active: boolean }) {
  const [open, setOpen] = useState(false);
  const multi = (b.steps || 1) > 1;
  return (
    <div className="my-0.5 rounded-lg depth-chip px-2.5 py-1.5 shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]">
      <button
        onClick={() => multi && setOpen((o) => !o)}
        className={`flex w-full items-center gap-2 text-left text-[12.5px] italic text-dim ${multi ? "cursor-pointer" : "cursor-default"}`}
      >
        {active ? (
          <motion.span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent)" }}
            animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
            transition={{ duration: 1, repeat: Infinity }} />
        ) : (
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
        )}
        <span className="flex-1">{b.text}</span>
        {active && <ElapsedTimer />}
        {multi && (
          <span className="flex items-center gap-1 rounded-full bg-surface px-1.5 text-[10px] not-italic text-dim shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]">
            {b.steps} steps <span className="text-[9px]">{open ? "▲" : "▾"}</span>
          </span>
        )}
      </button>

      {active && (
        <ProgressBar duration={getEstDuration(b.text)} active={active} />
      )}

      <AnimatePresence>
        {open && b.substeps && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="mt-1.5 space-y-0.5 overflow-hidden border-l border-line pl-3"
          >
            {b.substeps.map((s, k) => (
              <div key={k} className="text-[11.5px] italic text-dim/80">· {s}</div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Static "starting" indicator — a calm filling bar + label, no bouncing dots.
function StartingUp({ isLocal, active }: { isLocal: boolean; active: boolean }) {
  const estDuration = isLocal ? 90 : 8;
  return (
    <div className="rounded-lg depth-chip px-2.5 py-1.5 shadow-[0px_1px_0px_rgba(255,255,255,0.04)_inset,0px_4px_16px_rgba(0,0,0,0.3)]">
      <div className="flex items-center gap-2 text-[12.5px] italic text-dim">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent)" }} />
        <span>Thinking…</span>
      </div>
      <ProgressBar duration={estDuration} active={active} />
    </div>
  );
}
