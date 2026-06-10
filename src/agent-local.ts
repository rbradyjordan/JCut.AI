// JCut.AI local-model agent loop — drives the SAME `jc` tools CLI as the Claude
// backend, but talks to a local model served by LM Studio (OpenAI-compatible API).
//
// This proves the design lesson: the "hands" (the CLI) are model-agnostic. Only
// the "brain" swaps. No Agent SDK here — just fetch + the OpenAI tool-calling
// protocol that LM Studio implements.
//
// Setup:
//   1. In LM Studio: load a tool-calling-capable model (e.g. Qwen2.5-Coder,
//      Llama-3.1-8B-Instruct), then Developer tab → Start Server (port 1234).
//   2. npm run build
//   3. npm run edit:local -- "your request" [--workspace name] [--model <id>]
//
// Env: LMSTUDIO_URL, LMSTUDIO_CODER_MODEL, LMSTUDIO_VISION_MODEL.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import { JCUT_HOME } from "./tools/store.js";

const pexecFile = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const CLI = path.join(PROJECT_ROOT, "dist", "tools", "cli.js");

const BASE_URL = process.env.LMSTUDIO_URL || "http://localhost:1234/v1";

// One generic tool — small models aren't overwhelmed by a big schema.
// CRITICAL DESIGN RULES (learned from real failures):
//  1. The workspace flag is injected automatically by runJc — model does NOT supply it.
//  2. Each tool call = ONE command. Never combine two commands in one call.
//  3. Descriptions include required flags and the correct call order so the model
//     never has to guess or ask the user for information it can get itself.
const TOOLS = [
  {
    type: "function",
    function: {
      name: "jc",
      description:
        `Run ONE JCut.AI CLI command per call. Returns JSON. DO NOT combine multiple commands in one call.

WORKFLOW ORDER (follow this sequence for any editing task):
1. memory-read  →  read workspace notes first
2. sources-list  →  see all footage + audio files (get exact paths before any other command)
3. sequences-list  →  see existing timelines
4. sequence-inspect --sequence-id ID  →  see clips and current state
5. analyze-music --file <EXACT PATH from sources-list>  →  beat map (requires --file)
6. sequence-clips-add --sequence-id ID --operations '[...]'  →  edit timeline
7. sequence-export-premiere --sequence-id ID  →  write .prproj for Premiere

KEY RULES:
- analyze-music REQUIRES --file with the exact path. ALWAYS run sources-list first to get the path.
- kb-read REQUIRES --id, e.g. kb-read --id recap-videos. Run kb-list to see available docs.
- The workspace is supplied automatically — do NOT include --workspace in args.
- Call ONE command per tool call. Never put two command names in one call.`,
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The jc subcommand. ONE word only, e.g. 'sources-list' or 'analyze-music'.",
          },
          args: {
            type: "array",
            items: { type: "string" },
            description:
              "Flags as SEPARATE tokens. Each flag name and value is its own string. " +
              'CORRECT: ["--file", "/path/to/song.mp3"] or ["--sequence-id", "seq123"] ' +
              'WRONG: ["--file /path/to/song.mp3"] or ["--workspace MyProject --file song.mp3"]. ' +
              "Do NOT include --workspace here — it is added automatically.",
          },
        },
        required: ["command", "args"],
      },
    },
  },
];

// Small local models reliably mangle tool args in two ways:
//   1. They mash a flag and its value into ONE token: "--workspace ATL Shooters"
//      instead of two tokens "--workspace","ATL Shooters". Our CLI then reads a
//      key literally named "workspace ATL Shooters" and the real flag is lost.
//   2. They put extra command words / flags inside `command` itself, e.g.
//      command="kb-read --id recap-videos".
// We normalize both here so the model's "intent" reaches the CLI correctly, with
// quoted multi-word values preserved (e.g. a workspace named "ATL Shooters").
// Parse commands a model wrote as PROSE (instead of real tool_calls) so the loop
// can still run them. Matches lines like "· jc sources-list", "jc kb-read --id x",
// or a bare "sources-list --workspace W". Only recognizes real jc command names so
// we don't run arbitrary prose. Returns [] if none found (a genuine text reply).
function extractProseCommands(content: string): { command: string; args: string[] }[] {
  const found: { command: string; args: string[] }[] = [];

  // 1. Try parsing XML-like <tool_call> tags
  // Matches: <tool_call> <function=name> args </tool_call> or similar (even unclosed ones like </)
  const xmlRegex = /<tool_call>\s*<function=(\w[\w-]*?)>\s*([\s\S]*?)(?:<\/tool_call>|<\/|$)/gi;
  let match;
  while ((match = xmlRegex.exec(content)) !== null) {
    const cmd = match[1];
    const rawArgs = match[2].trim();
    if (ALL_COMMANDS.has(cmd)) {
      let args: string[] = [];
      if (rawArgs.startsWith("{") || rawArgs.startsWith("[")) {
        try {
          const parsed = JSON.parse(rawArgs);
          args = Array.isArray(parsed) ? parsed.map(String) : flagsFromObject(parsed);
        } catch {
          // If JSON parse fails, fallback to space tokenization
          args = tokenizeArgLine(rawArgs);
        }
      } else {
        args = tokenizeArgLine(rawArgs);
      }
      found.push({ command: cmd, args });
    }
  }

  if (found.length > 0) return found;

  // 2. Line-by-line fallback (for "· jc command")
  for (const rawLine of content.split("\n")) {
    // Strip a leading bullet/marker and an optional "jc " prefix.
    const line = rawLine.replace(/^[\s·•\-*>]+/, "").replace(/^jc\s+/i, "").trim();
    if (!line) continue;
    const firstWord = line.split(/\s+/)[0];
    if (!ALL_COMMANDS.has(firstWord)) continue; // not a real command → it's prose
    // Tokenize the rest, respecting simple quotes and JSON-ish args.
    const rest = line.slice(firstWord.length).trim();
    const args = rest ? tokenizeArgLine(rest) : [];
    found.push({ command: firstWord, args });
  }
  return found;
}

// Split an argument line into tokens, keeping quoted strings and bracketed JSON
// (the --operations '[...]') intact.
function tokenizeArgLine(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    const ch = s[i];
    if (ch === '"' || ch === "'") {
      const end = s.indexOf(ch, i + 1);
      if (end === -1) { out.push(s.slice(i + 1)); break; }
      out.push(s.slice(i + 1, end)); i = end + 1;
    } else if (ch === "[" || ch === "{") {
      // Grab a balanced JSON chunk (best-effort) for --operations.
      const open = ch, close = ch === "[" ? "]" : "}";
      let depth = 0, j = i;
      for (; j < s.length; j++) {
        if (s[j] === open) depth++;
        else if (s[j] === close) { depth--; if (depth === 0) { j++; break; } }
      }
      out.push(s.slice(i, j)); i = j;
    } else {
      let j = i;
      while (j < s.length && !/\s/.test(s[j])) j++;
      out.push(s.slice(i, j)); i = j;
    }
  }
  return out;
}

// Turn a flat arg OBJECT into a flag token array. Models sometimes emit
// {"sequence-id":"x","operations":"[...]"} instead of args:["--sequence-id","x",...].
// Skip the reserved keys (command/args) and the workspace (auto-injected).
function flagsFromObject(obj: any): string[] {
  const out: string[] = [];
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    if (k === "command" || k === "args" || k === "workspace") continue;
    if (v == null) continue;
    const flag = k.startsWith("--") ? k : `--${k}`;
    out.push(flag, typeof v === "string" ? v : JSON.stringify(v));
  }
  return out;
}

function splitToken(tok: string): string[] {
  const t = tok.trim();
  // A "--flag value..." token → ["--flag", "value..."] (value may have spaces).
  const m = t.match(/^(--[A-Za-z0-9][\w-]*)[=\s]+(.+)$/s);
  if (m) return [m[1], m[2].trim()];
  return [t];
}

// All known jc commands — used to drop stray command words that leak into args.
const ALL_COMMANDS = new Set([
  "sequence-create","sequences-list","sequence-inspect","media-info",
  "sequence-clips-add","sequence-clips-update","sequence-clips-remove",
  "sequence-captions-add","sequence-captions-remove","sequence-captions-list",
  "sequence-transitions-add","sequence-transitions-remove","sequence-transitions-list",
  "sequence-export-premiere","sequence-import-prproj","sequence-analyze","sequence-reframe",
  "style-learn","media-frames","media-frames-batch","content-set","content-list",
  "sources-list","source-add","source-localize","source-remove","source-relink",
  "criteria-get","criteria-set","memory-read","memory-append",
  "analyze-music","analyze-video","modes-list","mode-get","kb-list","kb-read",
  "transcript-import","transcript-list","transcript-get","transcript-search",
  "prproj-analyze", "content-analyze"
]);

// Commands that need --workspace. The model is no longer asked to supply it;
// runJc injects it automatically so the model can't forget or mash it.
const NEEDS_WORKSPACE = new Set([
  "sequence-create","sequences-list","sequence-inspect","sequence-clips-add",
  "sequence-clips-update","sequence-clips-remove","sequence-captions-add",
  "sequence-captions-remove","sequence-captions-list","sequence-transitions-add",
  "sequence-transitions-remove","sequence-transitions-list","sequence-export-premiere",
  "sequence-import-prproj","sequence-analyze","sequence-reframe","style-learn",
  "media-frames","media-frames-batch","content-set","content-list",
  "sources-list","source-add","source-localize","source-remove","source-relink",
  "criteria-get","criteria-set","memory-read","memory-append",
  "analyze-music","analyze-video","transcript-import","transcript-list","transcript-get","transcript-search",
  "prproj-analyze", "content-analyze"
]);

function normalizeArgs(command: string, rawArgs: string[]): { command: string; args: string[] } {
  // Defensive: a local model can emit a tool call with no/empty/non-string
  // command. Never let that crash the whole agent loop (the "it just stops" bug).
  const safeCommand = typeof command === "string" ? command : "";
  const cmdParts = safeCommand.trim().split(/\s+/).filter(Boolean);
  const cmd = cmdParts[0] || "";
  const leadIn = cmdParts.slice(1);
  const out: string[] = [];
  for (const tok of [...leadIn, ...(rawArgs || [])]) {
    if (typeof tok !== "string") { out.push(String(tok)); continue; }
    for (const piece of splitToken(tok)) {
      if (piece === cmd) continue;                          // stray echo of the command
      if (ALL_COMMANDS.has(piece) && piece !== cmd) continue; // stray OTHER command name in args
      if (piece !== "") out.push(piece);
    }
  }
  return { command: cmd, args: out };
}

async function runJc(commandRaw: string, argsRaw: string[], workspace: string): Promise<string> {
  const { command, args } = normalizeArgs(commandRaw, argsRaw);

  // Auto-inject --workspace so the model never has to supply or format it.
  // Strip any workspace the model may have tried to include (it'll be wrong or mashed).
  const cleanArgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--workspace") { i++; continue; } // drop model-supplied workspace
    cleanArgs.push(args[i]);
  }
  if (NEEDS_WORKSPACE.has(command)) {
    cleanArgs.unshift("--workspace", workspace);
  }
  try {
    // Hard timeout so a wedged tool (e.g. ffmpeg on cloud-evicted media, a stuck
    // export) can NEVER hang the agent. 5 min covers the slowest real
    // operation (analyze-music / Premiere export) with margin; beyond that it's
    // a hang, and we return a usable error the model can act on.
    const { stdout } = await pexecFile("node", [CLI, command, ...cleanArgs], {
      maxBuffer: 1 << 26,
      env: process.env,
      timeout: 300000,
      killSignal: "SIGKILL",
    });
    return stdout.slice(0, 8000);
  } catch (e: any) {
    if (e?.killed || e?.signal === "SIGKILL") {
      return JSON.stringify({
        ok: false,
        error: `The "${command}" command took too long and was stopped (likely a slow/unreadable source file). Try a different file or check the media is available locally.`,
      });
    }
    return (e.stdout || "") + (e.stderr || e.message || "tool error");
  }
}

function parseCliArgs(argv: string[]) {
  let workspace = "default";
  let coderModel = process.env.LMSTUDIO_CODER_MODEL || "local-model";
  let visionModel = process.env.LMSTUDIO_VISION_MODEL || "local-vision-model";
  let chatId = "";
  let steering = false;
  const promptParts: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--workspace") workspace = argv[++i];
    else if (argv[i] === "--model") coderModel = argv[++i];
    else if (argv[i] === "--chat-id") chatId = argv[++i];
    else if (argv[i] === "--steering") steering = true;
    else promptParts.push(argv[i]);
  }
  return { workspace, coderModel, visionModel, chatId, steering, prompt: promptParts.join(" ").trim() };
}

const SERVER_HINT =
  `Could not reach LM Studio at ${BASE_URL}.\n` +
  `Fix: open LM Studio → load a tool-calling model → Developer tab → Start Server (port 1234).\n` +
  `Or set LMSTUDIO_URL if it's on a different host/port.`;

// A single model call must never hang forever. If LM Studio accepts the request
// but stalls mid-generation (a wedged model, an OOM, a stuck GPU), the fetch would
// otherwise wait indefinitely. We bound every call with a hard timeout.
// A slow local model (a 9B MLX model on a busy Mac) can legitimately take a few
// minutes to process a large context — the recap context grows to 9k+ tokens
// (sources + beat map + 18-clip sequence), and MLX re-processes it each turn.
// 120s was too tight and aborted mid-think. 5 min covers a slow turn with margin;
// the RUN_DEADLINE is the real ceiling that guarantees the whole run still ends.
const CHAT_TIMEOUT_MS = 300000; // 5 min per model turn

async function chat(model: string, messages: any[]): Promise<any> {
  let res: Response;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), CHAT_TIMEOUT_MS);
  try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, tools: TOOLS, temperature: 0.4, stream: false }),
      signal: ctl.signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error(
        `The local model "${model}" stopped responding (no reply for ${CHAT_TIMEOUT_MS / 1000}s). ` +
        `It may be too large for your machine or wedged — try a smaller/faster model in LM Studio, ` +
        `or restart the LM Studio server.`,
      );
    }
    // Connection refused / DNS / network — server almost certainly not running.
    throw new Error(SERVER_HINT);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Context-overflow (n_keep >= n_ctx): the model was loaded with too small a
    // context window for the conversation. This is a LOAD setting, not our prompt
    // — give the user the exact fix instead of a generic error.
    if (res.status === 400 && /n_keep|n_ctx|context length|context window/i.test(body)) {
      throw new Error(
        `The local model "${model}" is loaded with too small a context window for this ` +
        `conversation.\n\nFix in LM Studio: eject the model, then re-load it and raise ` +
        `"Context Length" (n_ctx) to at least 8192 (16384 is comfortable) before Start Server. ` +
        `Then try again.\n\nDetails: ${body.slice(0, 200)}`,
      );
    }
    throw new Error(`LM Studio responded ${res.status}. ${body.slice(0, 300)}\n${SERVER_HINT}`);
  }
  return res.json();
}

// Keep the conversation within a small local context window. We always keep the
// system prompt (index 0) and the FIRST user message (the request), then keep as
// many of the MOST RECENT messages as fit a rough char budget — older tool
// results (the bulkiest part) are dropped first. This prevents the "n_keep > n_ctx"
// overflow on long multi-step sessions even with small models.
const CHAR_BUDGET = 10000; // ~2.5k tokens of history, leaving room for the reply

// Truncate large lists in tool responses while keeping JSON structure valid
// to prevent local models from overflowing context windows (which silently
// breaks them or causes greeting-loops).
function cleanAndTruncateToolOutput(cmd: string, output: string): string {
  if (!output) return output;
  try {
    const data = JSON.parse(output);
    let modified = false;

    if (cmd === "sources-list" && data.ok) {
      const maxList = 15;
      if (Array.isArray(data.video) && data.video.length > maxList) {
        const total = data.video.length;
        data.video = [...data.video.slice(0, maxList), `... (${total - maxList} more video files truncated for context budget)`];
        modified = true;
      }
      if (Array.isArray(data.audio) && data.audio.length > maxList) {
        const total = data.audio.length;
        data.audio = [...data.audio.slice(0, maxList), `... (${total - maxList} more audio files truncated for context budget)`];
        modified = true;
      }
      if (Array.isArray(data.images) && data.images.length > maxList) {
        const total = data.images.length;
        data.images = [...data.images.slice(0, maxList), `... (${total - maxList} more image files truncated for context budget)`];
        modified = true;
      }
    }

    if (cmd === "content-list" && data.ok) {
      const maxList = 15;
      if (Array.isArray(data.content) && data.content.length > maxList) {
        const total = data.content.length;
        data.content = [...data.content.slice(0, maxList), `... (${total - maxList} more descriptions truncated for context budget)`];
        modified = true;
      }
    }

    if (cmd === "sequences-list" && data.ok) {
      const maxList = 10;
      if (Array.isArray(data.sequences) && data.sequences.length > maxList) {
        const total = data.sequences.length;
        data.sequences = [...data.sequences.slice(0, maxList), `... (${total - maxList} more sequences truncated for context budget)`];
        modified = true;
      }
    }

    if (cmd === "sequence-inspect" && data.ok) {
      if (data.tracks) {
        const maxClips = 10;
        for (const trackName of Object.keys(data.tracks)) {
          const track = data.tracks[trackName];
          if (Array.isArray(track.clips) && track.clips.length > maxClips) {
            const total = track.clips.length;
            track.clips = [...track.clips.slice(0, maxClips), { note: `... (${total - maxClips} more clips in this track truncated for context budget)` }];
            modified = true;
          }
        }
      }
    }

    if (modified) {
      return JSON.stringify(data, null, 2);
    }
  } catch {
    // ignore parse error, treat as raw text
  }

  // Generic string fallback slice
  const maxChars = 3000;
  if (output.length > maxChars) {
    return output.slice(0, maxChars) + "\n\n... [OUTPUT TRUNCATED TO FIT CONTEXT BUDGET] ...";
  }
  return output;
}

function trimContext(messages: any[]): void {
  const size = (m: any) => (typeof m?.content === "string" ? m.content.length : 200);
  const total = () => messages.reduce((n, m) => n + size(m), 0);
  if (total() <= CHAR_BUDGET) return;
  // Protect index 0 (system) and index 1 (first user request). Drop the OLDEST
  // assistant+its-tool-results group from index 2 forward, preserving validity
  // (a tool message must follow its assistant tool_call). Never touch the last 4.
  while (total() > CHAR_BUDGET && messages.length > 6) {
    const start = 2;
    if (start >= messages.length - 4) break;
    // Remove the message at `start`; if it's an assistant with tool_calls, also
    // remove the contiguous tool messages that answer it.
    let removeCount = 1;
    const m = messages[start];
    if (m?.role === "assistant" && Array.isArray(m.tool_calls)) {
      let j = start + 1;
      while (j < messages.length && messages[j]?.role === "tool") { removeCount++; j++; }
    } else if (m?.role === "tool") {
      // A leading orphan tool message (shouldn't happen) — just drop it.
      removeCount = 1;
    }
    if (start + removeCount > messages.length - 4) break; // would eat protected tail
    messages.splice(start, removeCount);
  }
}

async function main() {
  const { workspace, coderModel, visionModel, chatId, steering, prompt } = parseCliArgs(process.argv.slice(2));
  if (!prompt) {
    console.error('Usage: npm run edit:local -- "your request" [--workspace name] [--model id]');
    process.exit(1);
  }

  // IMPORTANT: local models often run with a SMALL context window (4k–8k). The
  // full SYSTEM.md is ~6k tokens and overflows them ("n_keep > n_ctx" 400 error).
  // So local mode uses a COMPACT, self-contained prompt (a few hundred tokens) —
  // the essentials only. The full playbook lives in the kb/ docs the model can
  // pull on demand via `kb-read` when it actually needs the detail.
  // Proactively load workspace state so the model already knows what exists.
  // Proactively load workspace state so the model starts with real context —
  // sources, sequences, memory — instead of having to discover
  // everything from scratch via tool calls. Failures are silent/ignored so a fresh
  // or missing workspace doesn't block the session from starting.
  let sourcesContext = "";
  let sequencesContext = "";
  let memoryContext = "";
  try {
    const srcRaw = await pexecFile("node", [CLI, "sources-list", "--workspace", workspace], {
      maxBuffer: 1 << 24, env: process.env, timeout: 8000,
    }).then(r => r.stdout).catch(() => "");
    const src = srcRaw ? JSON.parse(srcRaw) : null;
    if (src?.ok) {
      const allSources = [
        ...(src.video || []).map((s: any) => s.name || s.rel || s),
        ...(src.audio || []).map((s: any) => s.name || s.rel || s),
      ].filter((n: string) => typeof n === "string" && !n.startsWith("._") && !n.startsWith("."));
      if (allSources.length > 0) {
        sourcesContext = `\nFOOTAGE IN WORKSPACE:\n${allSources.slice(0, 30).join("\n")}${allSources.length > 30 ? `\n... and ${allSources.length - 30} more` : ""}`;
      }
      const docs = (src.documents || []).map((s: any) => s.name || s.rel || s)
        .filter((n: string) => typeof n === "string" && !n.startsWith("._") && !n.startsWith("."));
      if (docs.length > 0) {
        // Reference docs (script/brief/shot list). Flag them so the model reads
        // them for intent before drafting — they drive selection and ordering.
        sourcesContext += `\nREFERENCE DOCUMENTS (read these first for intent — paths: source/documents/<name>):\n${docs.slice(0, 10).join("\n")}`;
      }
    }
  } catch { /* workspace may not exist yet */ }
  let latestSeq: { id: string; name: string; clips: number; duration: number } | null = null;
  try {
    const seqRaw = await pexecFile("node", [CLI, "sequences-list", "--workspace", workspace], {
      maxBuffer: 1 << 24, env: process.env, timeout: 8000,
    }).then(r => r.stdout).catch(() => "");
    const seqs = seqRaw ? JSON.parse(seqRaw) : null;
    if (seqs?.ok && seqs.sequences?.length > 0) {
      // Find the most-recently-MODIFIED sequence file — that's the work-in-progress
      // (a stopped run leaves its partial timeline saved on disk). The agent can
      // resume into it instead of starting over.
      const seqDir = path.join(JCUT_HOME, workspace, "sequences");
      let newestMtime = 0;
      for (const s of seqs.sequences) {
        try {
          const st = await fs.stat(path.join(seqDir, `${s.id}.jcseq.json`));
          if (st.mtimeMs > newestMtime) {
            newestMtime = st.mtimeMs;
            latestSeq = { id: s.id, name: s.name, clips: s.clips, duration: s.duration_seconds };
          }
        } catch { /* ignore */ }
      }
      sequencesContext = `\nSEQUENCES (newest first = most recently edited):\n${
        seqs.sequences
          .slice()
          .sort((a: any, b: any) => (a.id === latestSeq?.id ? -1 : b.id === latestSeq?.id ? 1 : 0))
          .map((s: any) => `  ${s.id}: "${s.name}" (${s.clips} clips, ${s.duration_seconds}s)${s.id === latestSeq?.id ? "  ← most recent" : ""}`)
          .join("\n")
      }`;
    }
  } catch { /* ok */ }
  try {
    const memRaw = await pexecFile("node", [CLI, "memory-read", "--workspace", workspace], {
      maxBuffer: 1 << 24, env: process.env, timeout: 5000,
    }).then(r => r.stdout).catch(() => "");
    const mem = memRaw ? JSON.parse(memRaw) : null;
    if (mem?.ok && mem.memory?.trim()) {
      memoryContext = `\nWORKSPACE MEMORY:\n${mem.memory.trim().slice(0, 800)}`;
    }
  } catch { /* ok */ }

  const compactSystem =
    `You are JCut, a friendly assistant video editor. Workspace: "${workspace}".\n` +
    `${sourcesContext}${sequencesContext}${memoryContext}\n` +
    `\n` +
    `RULES:\n` +
    `1. Greetings/small talk → reply warmly in plain English. No tool needed.\n` +
    `2. Editing/Exporting tasks → use the jc tool. It is the ONLY way to touch footage, edit, or export the timeline.\n` +
    `   ACTUALLY CALL the tool — never write the command as text like "jc sources-list" in your\n` +
    `   reply. Writing it as text does NOTHING. Emit a real tool call.\n` +
    `3. The workspace is automatic — DO NOT include --workspace in your args. Ever.\n` +
    `4. ONE command per tool call. Never combine two commands.\n` +
    `5. Never invent file names or paths. Use only what sources-list actually returns.\n` +
    `6. After every tool call, read the JSON output and continue the task or report results.\n` +
    `7. NEVER repeat "Hey! I'm JCut" mid-task. Stay in task mode until done.\n` +
    `8. BATCH your clip-adds. --operations takes an ARRAY — add MANY clips in ONE\n` +
    `   sequence-clips-add call (10–20 at once), NOT one clip per call. Each tool call\n` +
    `   is slow, so adding clips one at a time wastes minutes. Plan the section, then add\n` +
    `   all its clips in a single call.\n` +
    `9. IMMEDIATELY EXECUTE & DO NOT ASK FOR PERMISSION: If the user requests a task (such as\n` +
    `   "export the project", "export it", "make a rough cut", "add clips"), do NOT ask\n` +
    `   for confirmation, do NOT ask "Would you like me to...?", and do NOT ask for permission.\n` +
    `   Immediately execute the corresponding tool. If the user asks to "export the project" or\n` +
    `   "export it" and there is a sequence marked as "← most recent" in the sequences list,\n` +
    `   immediately run "sequence-export-premiere" with that sequence ID. Do NOT ask which sequence.\n` +
    `\n` +
    `WORKFLOW for any edit:\n` +
    `  1. sources-list → get exact file paths\n` +
    `  2. analyze-music --file <EXACT PATH> → beat map (only if music-driven)\n` +
    `  3. analyze-video --file <EXACT PATH> → (OPTIONAL) get shot type, camera settle time, and motion peaks before choosing trims.\n` +
    `  4. content-analyze --file <EXACT PATH> → (OPTIONAL) use vision AI to "look" at a video and describe it to the registry. Useful to log content before editing.\n` +
    `  5. sequences-list → see existing timelines. If none exist (or the user wants a NEW one),\n` +
    `     create it: sequence-create --name "My Cut" --orientation vertical|horizontal|square\n` +
    `     --framerate 30 (use --width/--height for exact size, e.g. 2160x3840 for vertical 4K).\n` +
    `     It returns sequence_id — use that id in the next steps.\n` +
    `  6. sequence-clips-add --sequence-id ID --operations '[...]' → build the cut.\n` +
    `     --operations is a JSON ARRAY; each video op looks like:\n` +
    `     {"track":"V1","source":"video/clip.mp4","position_seconds":0,"trim_start_seconds":0,"trim_end_seconds":2.5,"scale_x":SCALE,"scale_y":SCALE}\n` +
    `     "source" = the EXACT path from sources-list. Do NOT use {"type","clip","time"}.\n` +
    `     CUT FOR QUALITY (not just the start of every clip):\n` +
    `       • Pick the BEST MOMENT inside each clip — the action, the look, the motion. Most\n` +
    `         clips have dead air at the start (camera settling, walk-in). Set trim_start_seconds\n` +
    `         PAST that (e.g. 1.0–3.0s in), not always 0. If analyze-video returned\n` +
    `         camera_settle_seconds, use that as your starting point and prefer motion_peaks_seconds\n` +
    `         for cut-on-action entries.\n` +
    `       • Snap cut points to the BEAT GRID from analyze-music. Each clip's position_seconds\n` +
    `         should land ON a beat from beats_seconds, and high-energy sections cut faster\n` +
    `         (every 1–2 beats), low-energy slower (every 4–8 beats).\n` +
    `       • Open on your STRONGEST shot at the first downbeat. Vary shot types — don't put two\n` +
    `         similar shots back to back. End on a held closing shot.\n` +
    `  7. *** ADD THE MUSIC *** — if music-driven, you MUST place the song on an AUDIO track.\n` +
    `     Add ONE op: {"track":"A1","source":"audio/<the song>.mp3","position_seconds":0,\n` +
    `     "trim_start_seconds":0,"trim_end_seconds":<edit length>}. WITHOUT this the export\n` +
    `     has no sound. Do this once, near the end, covering the whole timeline.\n` +
    `  8. sequence-export-premiere --sequence-id ID → deliver .prproj to Premiere\n` +
    `\n` +
    `SCALE TO FIT THE CANVAS (critical — wrong scale = tiny/cropped footage):\n` +
    `  Compute scale so the source FILLS the sequence frame. FILL = max(canvas_w/src_w, canvas_h/src_h).\n` +
    `  Example: landscape 3840x2160 source in a 1080x1920 VERTICAL canvas →\n` +
    `  scale = max(1080/3840, 1920/2160) = max(0.281, 0.889) = 0.889. Use scale_x=scale_y=0.889.\n` +
    `  Landscape 3840x2160 in a 1920x1080 HORIZONTAL canvas → scale = 0.5. NEVER leave scale at 1.0\n` +
    `  unless the source already matches the canvas size. BETTER: if the footage is landscape and\n` +
    `  the user didn't demand vertical, CREATE A HORIZONTAL sequence so the footage fills naturally.\n` +
    `\n` +
    `For detailed playbooks: kb-read --id recap-videos (or interviews-dialogue, short-form-social, etc.)`;
  let chatHistory: any[] = [];
  if (chatId) {
    const chatFile = path.join(JCUT_HOME, workspace, "chats", `${chatId}.json`);
    try {
      const raw = await fs.readFile(chatFile, "utf8");
      const chatData = JSON.parse(raw);
      const rawHistory = chatData.messages || [];
      // Trim history from the end to fit a 5000 character budget. Local models
      // get heavily confused by long, repetitive editing conversation history,
      // so keeping it lean (last 1-2 turns) preserves their reasoning power.
      let totalLength = 0;
      const budget = 5000;
      const kept: any[] = [];
      for (let i = rawHistory.length - 1; i >= 0; i--) {
        const len = rawHistory[i].text?.length || 0;
        if (totalLength + len > budget) break;
        kept.unshift(rawHistory[i]);
        totalLength += len;
      }
      chatHistory = kept;
    } catch { /* ignore missing/corrupt */ }
  }

  // RESUME DETECTION: if the previous agent turn was cancelled mid-task (the UI
  // appends "⏹ stopped." to a partial message), and the user is now asking to
  // continue, tell the model EXACTLY where it left off so it picks up near there
  // instead of starting the whole edit over. The injected SEQUENCES context above
  // already shows current clip counts, so "continue" + "you had built N clips"
  // gives the model a concrete resume point.
  let resumeNote = "";
  const lastAgentMsg = [...chatHistory].reverse().find((m) => m.role === "agent");
  const wasCancelled = lastAgentMsg && /⏹\s*stopped|went quiet|time limit/i.test(lastAgentMsg.text || "");
  const wantsContinue = /\b(continue|keep going|resume|pick up|finish|carry on|where you left)\b/i.test(prompt);
  // Resume if the last turn was cancelled, OR the user explicitly asks to continue
  // with a WIP sequence, OR this is a mid-task steering redirect (the --steering
  // flag set when the user typed while a run was in progress).
  const hasInProgress = !!latestSeq && latestSeq.clips > 0;
  if (wasCancelled || steering || (wantsContinue && hasInProgress)) {
    const lastLines = ((lastAgentMsg?.text) || "").split("\n").filter((l: string) => l.trim()).slice(-6).join(" ").slice(0, 300);
    // Point the model at the EXACT in-progress sequence (its saved state is the
    // source of truth) and tell it to inspect it and continue from the end.
    const seqHint = latestSeq
      ? `The work-in-progress timeline is sequence "${latestSeq.name}" (id ${latestSeq.id}), ` +
        `which ALREADY has ${latestSeq.clips} clips placed and runs to ${latestSeq.duration}s. ` +
        `Run sequence-inspect --sequence-id ${latestSeq.id} to see exactly what's there, then ` +
        `ADD the remaining clips AFTER ${latestSeq.duration}s (do not re-add the existing ones, ` +
        `do not create a new sequence). `
      : `Check the SEQUENCES list above for the timeline already in progress. `;
    resumeNote =
      `\n\n[RESUME] A previous edit was interrupted but its progress IS SAVED on disk. ` +
      `Do NOT start over and do NOT create a new sequence. ${seqHint}` +
      (lastLines ? `What you were last doing: "${lastLines}". ` : "") +
      `Continue from where it left off and finish the remaining work.`;
  }

  const messages: any[] = [];
  messages.push({ role: "system", content: compactSystem });
  if (chatHistory && chatHistory.length > 0) {
    for (const m of chatHistory) {
      messages.push({
        role: m.role === "agent" ? "assistant" : m.role,
        content: m.text,
      });
    }
  }
  messages.push({
    role: "user",
    content: prompt + resumeNote, // resumeNote is "" unless a resume was detected
  });

  // A local model adds clips roughly one per step, so a full recap (25–40 clips,
  // plus survey/inspect/export steps) needs plenty of room. These are generous;
  // the user can always stop, and a finished edit returns long before the caps.
  const MAX_STEPS = 80;
  const RUN_DEADLINE = Date.now() + 1800000; // 30-min absolute ceiling for the whole run
  let toolCallsEver = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    // Absolute wall-clock guard: even if each individual call succeeds, a long
    // chain of slow steps must still terminate. Never hang the user.
    if (Date.now() > RUN_DEADLINE) {
      process.stdout.write(
        `\n\x1b[33m⚠ Reached the 30-minute time limit for one request — stopping here. ` +
        `The work so far is saved. Ask me to continue and I'll pick up where I left off.\x1b[0m\n`,
      );
      return;
    }
    trimContext(messages);
    // Emit a quiet keepalive while the (slow) local model thinks, so the UI's
    // heartbeat knows the agent is alive and doesn't force-stop a working run.
    // A zero-width marker the UI strips — it just resets the heartbeat timer.
    const pulse = setInterval(() => process.stdout.write("​"), 20000);
    let resp;
    try {
      resp = await chat(coderModel, messages);
    } finally {
      clearInterval(pulse);
    }
    const msg = resp.choices?.[0]?.message;
    if (!msg) throw new Error("No response from local model.");
    messages.push(msg);

    // Surface visible progress to the UI. Models like Qwen put their narration in
    // `reasoning_content` and leave `content` as whitespace during tool-calling —
    // so the chat looked empty even while the model was actively working. Show the
    // real content if present; otherwise show a short slice of the reasoning so the
    // user always sees WHAT the model is doing this step.
    const visibleText = (msg.content || "").trim();
    if (visibleText) {
      process.stdout.write(`\n${visibleText}\n`);
    } else if (msg.reasoning_content) {
      const r = String(msg.reasoning_content).trim().replace(/\s+/g, " ").slice(0, 200);
      if (r) process.stdout.write(`\n\x1b[2m${r}\x1b[0m\n`);
    }

    let calls = msg.tool_calls || [];

    // RECOVERY: some local models (Qwen included) sometimes WRITE the tool calls
    // as plain text — e.g. "· jc sources-list" or "jc kb-read --id recap-videos" —
    // instead of emitting real tool_calls. The loop would otherwise treat that as a
    // final answer and stop mid-task. Detect those prose commands and run them.
    if (calls.length === 0 && msg.content) {
      const proseCalls = extractProseCommands(msg.content);
      if (proseCalls.length > 0) {
        calls = proseCalls.map((pc, i) => ({
          id: `prose_${step}_${i}`,
          type: "function",
          function: { name: "jc", arguments: JSON.stringify({ command: pc.command, args: pc.args }) },
        }));
        // Nudge the model to actually CALL the tool next time (cheaper than looping).
        messages.push({
          role: "user",
          content: "(Note: call the jc tool directly — don't write the command as text. I ran what you wrote; here are the results.)",
        });
      }
    }

    if (calls.length === 0) {
      // A no-tool reply is PERFECTLY FINE for greetings/small talk/questions —
      // that's conversational mode working as intended. Only warn if the reply is
      // genuinely empty/garbage AND the request actually looked like an edit task
      // (so we don't nag when the user just said "hi" and got a friendly reply).
      if (step === 0 && toolCallsEver === 0) {
        const content = (msg.content || "").trim();
        const empty = content.length < 2;
        const looksLikeRawMarkup = /^[#`]{2,}/.test(content); // code-fence / heading dump, not prose
        const looksLikeTask = /\b(footage|clip|sequence|timeline|recap|montage|edit|cut|caption|render|export|add|trim|music|beat|source)\b/i.test(prompt);
        if ((empty || looksLikeRawMarkup) && looksLikeTask) {
          process.stdout.write(
            `\n⚠️ The local model "${coderModel}" didn't use the editing tools and returned an ` +
            `unusable response for what looked like an editing task. This usually means the ` +
            `model is weak at tool-calling.\n\n` +
            `Try a stronger tool-calling model in LM Studio (e.g. Qwen 2.5/3 Coder, ` +
            `Llama 3.1 8B Instruct), then pick it in Settings. Avoid "obliterated"/uncensored ` +
            `variants — they often break tool use.\n`,
          );
        }
      }
      process.stdout.write(`\n\x1b[32m✓ done (local model)\x1b[0m\n`);
      return;
    }
    toolCallsEver += calls.length;

    for (const call of calls) {
      let cmd = "", args: string[] = [];
      const toolName = call.function?.name || "";
      try {
        const parsed = JSON.parse(call.function.arguments || "{}");
        cmd = typeof parsed.command === "string" ? parsed.command : "";
        args = Array.isArray(parsed.args) ? parsed.args.map(String) : [];
        // COMMON LOCAL-MODEL PATTERN: instead of calling the `jc` tool with
        // {command:"sequence-clips-add", ...}, the model names the TOOL itself
        // after the command (tool name = "sequence-clips-add") and puts the real
        // flags directly in arguments. Recover by using the tool name as the
        // command and treating the arg object as flags.
        if (!cmd && toolName && toolName !== "jc" && ALL_COMMANDS.has(toolName)) {
          cmd = toolName;
          if (!args.length) args = flagsFromObject(parsed);
        }
        // Some models put flags as object keys even when using `jc` correctly but
        // omit the args array (e.g. {command:"x", "sequence-id":"y"}). Salvage those.
        if (cmd && !args.length) {
          const salvaged = flagsFromObject(parsed);
          if (salvaged.length) args = salvaged;
        }
      } catch {
        messages.push({
          role: "tool", tool_call_id: call.id,
          content: JSON.stringify({ ok: false, error: 'Bad tool-call JSON. Call the jc tool with {"command":"<name>","args":[...]}.' }),
        });
        continue;
      }
      // A missing/empty command would otherwise run nothing and could crash the
      // loop. Return a clear, recoverable error instead so the model retries.
      if (!cmd.trim()) {
        messages.push({
          role: "tool", tool_call_id: call.id,
          content: JSON.stringify({ ok: false, error: 'Missing "command". Call jc with a command name, e.g. {"command":"sources-list","args":[]}.' }),
        });
        continue;
      }
      if (cmd === "content-analyze") {
        process.stdout.write(`\x1b[2m· [Vision Offload] Analyzing ${args.join(" ")}\x1b[0m\n`);
        const framesRes = await runJc("media-frames", args, workspace);
        try {
          const parsedFrames = JSON.parse(framesRes);
          if (parsedFrames.ok && parsedFrames.frames && parsedFrames.frames.length > 0) {
            const framePath = parsedFrames.frames[0];
            const buf = await fs.readFile(framePath);
            const b64 = buf.toString("base64");
            
            const visionRes = await fetch(`${BASE_URL}/chat/completions`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model: visionModel,
                messages: [{
                  role: "user",
                  content: [
                    { type: "text", text: "Describe this frame in detail. Focus on shot type, lighting, subjects, and action." },
                    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } }
                  ]
                }],
                temperature: 0.2
              })
            });
            const vdata = await visionRes.json();
            const description = vdata.choices?.[0]?.message?.content || "No description generated.";
            
            let filePath = "";
            for (let i = 0; i < args.length; i++) { if (args[i] === "--file") { filePath = args[i + 1]; break; } }
            await runJc("content-set", ["--file", filePath, "--description", description], workspace);
            
            const cleanedOut = JSON.stringify({ ok: true, description, note: "Vision analysis complete and saved to registry." });
            messages.push({ role: "tool", tool_call_id: call.id, content: cleanedOut });
            continue;
          }
        } catch (e) { }
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ ok: false, error: "Vision analysis failed." }) });
        continue;
      }

      process.stdout.write(`\x1b[2m· jc ${cmd} ${args.join(" ")}\x1b[0m\n`);
      const out = await runJc(cmd, args, workspace);
      let cleanedOut = cleanAndTruncateToolOutput(cmd, out);
      
      // Inject explicit correction instruction if the tool returned a user-correctable error.
      // This steers local models to correct their flags and immediately retry instead of exiting.
      try {
        const parsed = JSON.parse(out);
        if (parsed && parsed.ok === false) {
          cleanedOut += `\n\n[INSTRUCTION: The tool returned an error. You MUST call the tool again with corrected arguments to continue the task. Do not stop or ask the user for input.]`;
        }
      } catch {
        // Output wasn't JSON (parse failed)
      }

      messages.push({ role: "tool", tool_call_id: call.id, content: cleanedOut });
    }
  }
  process.stdout.write(`\n\x1b[33m⚠ stopped after ${MAX_STEPS} steps\x1b[0m\n`);
}

main().catch((e) => {
  // Surface the error to the CHAT (stdout), not just stderr, so the UI shows a
  // real message and clears the "Thinking…" state instead of hanging silently.
  process.stdout.write(
    `\n\x1b[31m⚠ Something went wrong: ${e?.message || e}. ` +
    `The work so far is saved — try again or rephrase.\x1b[0m\n`,
  );
  process.exit(1);
});
