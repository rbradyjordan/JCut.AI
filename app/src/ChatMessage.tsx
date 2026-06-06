// Renders an agent/user message beautifully:
//  • Tool-call lines ("· Bash: {json}" or "· Tool: ...") become dimmed, italic,
//    plain-English action lines ("Reading your workspace memory…").
//  • Lightweight markdown: **bold**, *italic*, `code`, # headings, - / 1. lists,
//    and paragraphs. No external deps.
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { spring, TEAL_GRADIENT } from "./theme";

// ── Translate a raw tool invocation into plain editor-speak ──────────────────
function humanizeToolLine(line: string): string | null {
  // Matches the agent loop's debug echo: "· Bash: {...}" / "· Read: {...}" etc.
  const m = line.match(/^[·•]\s*(\w+):\s*(\{.*\}|.*)$/);
  if (!m) return null;
  const tool = m[1];
  let payload = m[2] || "";

  // Pull the underlying jc command out of a Bash call if present.
  const cmdMatch = payload.match(/cli\.js\s+([a-z-]+)/) || payload.match(/"command"\s*:\s*"([a-z-]+)/);
  const jc = cmdMatch?.[1];

  const ACTIONS: Record<string, string> = {
    "memory-read": "Reading your workspace memory",
    "memory-append": "Saving a note to memory",
    "sequences-list": "Looking at your sequences",
    "sequence-inspect": "Reviewing the timeline",
    "sequence-create": "Creating a new sequence",
    "sequence-clips-add": "Placing clips on the timeline",
    "sequence-clips-update": "Adjusting clips",
    "sequence-clips-remove": "Removing clips",
    "sequence-render-frame": "Rendering a frame to check the result",
    "sequence-render-final": "Rendering the final video",
    "sequence-analyze": "Analyzing the cut",
    "style-learn": "Learning your editing style",
    "media-info": "Checking the footage",
  };
  if (jc && ACTIONS[jc]) return ACTIONS[jc] + "…";
  if (tool === "Read") return "Looking at a file…";

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

export default function ChatMessage({ role, text, live, showReasoning }: {
  role: "user" | "agent"; text: string; live?: boolean; showReasoning?: boolean;
}) {
  const isUser = role === "user";
  // With "show reasoning" on, keep every tool line separate (don't collapse runs)
  // so the user sees each step explicitly.
  const parsed = parseBlocks(text);
  const blocks = showReasoning ? parsed.map((b) => ({ ...b })) : collapseToolRuns(parsed);
  // The final tool block is "active" only while this message is still streaming.
  const lastToolIdx = blocks.map((b) => b.type).lastIndexOf("tool");

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring.snappy}
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[80%] space-y-2 rounded-xl2 px-4 py-3 text-[14px] leading-relaxed shadow-card ${
          isUser ? "text-white" : "bg-surface text-ink ring-1 ring-line"
        }`}
        style={isUser ? { background: TEAL_GRADIENT } : undefined}
      >
        {blocks.length === 0 && <StartingUp />}
        {blocks.map((b, i) => {
          if (b.type === "tool") {
            const active = !!live && i === lastToolIdx;
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
      </div>
    </motion.div>
  );
}

// A collapsed tool-progress row. Click to expand and see every step (reasoning).
function ToolBlock({ b, active }: { b: CBlock; active: boolean }) {
  const [open, setOpen] = useState(false);
  const multi = (b.steps || 1) > 1;
  return (
    <div className="my-0.5 rounded-lg bg-surface2/60 px-2.5 py-1.5 ring-1 ring-line">
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
        {multi && (
          <span className="flex items-center gap-1 rounded-full bg-surface px-1.5 text-[10px] not-italic text-dim ring-1 ring-line">
            {b.steps} steps <span className="text-[9px]">{open ? "▲" : "▾"}</span>
          </span>
        )}
      </button>

      {active && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface">
          <motion.div className="h-full rounded-full" style={{ background: TEAL_GRADIENT }}
            initial={false} animate={{ width: `${Math.min(92, 12 + (b.steps || 1) * 8)}%` }}
            transition={spring.soft} />
        </div>
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
function StartingUp() {
  return (
    <div className="rounded-lg bg-surface2/60 px-2.5 py-1.5 ring-1 ring-line">
      <div className="flex items-center gap-2 text-[12.5px] italic text-dim">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent)" }} />
        <span>Thinking…</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface">
        <motion.div className="h-full rounded-full" style={{ background: TEAL_GRADIENT }}
          initial={{ width: "8%" }} animate={{ width: "16%" }} transition={spring.soft} />
      </div>
    </div>
  );
}
