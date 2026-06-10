// JCut.AI agent loop. Runs on your Claude Max subscription via the Agent SDK
// (it reuses your `claude` CLI login — no ANTHROPIC_API_KEY needed).
//
// Usage:
//   npm run build           # compile the tools CLI to dist/
//   npm run edit -- "your editing request here"     [--workspace my_project]
//
// The agent drives the compiled tools CLI through the built-in Bash tool, plus
// Read (to look at rendered verification frames) and Glob (to find footage).
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// The compiled tools entrypoint. `jc` in SYSTEM.md maps to this.
const CLI = path.join(PROJECT_ROOT, "dist", "tools", "cli.js");

function parseCliArgs(argv: string[]) {
  let workspace = "default";
  let model = "";
  let chatId = "";
  let steering = false;
  const promptParts: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--workspace") {
      workspace = argv[++i];
    } else if (argv[i] === "--model") {
      model = argv[++i];
    } else if (argv[i] === "--chat-id") {
      chatId = argv[++i];
    } else if (argv[i] === "--steering") {
      steering = true;
    } else {
      promptParts.push(argv[i]);
    }
  }
  return { workspace, model, chatId, steering, prompt: promptParts.join(" ").trim() };
}

// Friendly model aliases → Agent SDK model ids.
function resolveModel(m: string): string | undefined {
  const k = (m || "").toLowerCase();
  if (k === "opus") return "claude-opus-4-8";
  if (k === "sonnet") return "claude-sonnet-4-6";
  if (k === "haiku") return "claude-haiku-4-5-20251001";
  return m || undefined; // pass through an explicit id, or undefined = SDK default
}

async function main() {
  const { workspace, model, steering, prompt } = parseCliArgs(process.argv.slice(2));
  if (!prompt) {
    console.error('Usage: npm run edit -- "your request" [--workspace name] [--model opus|sonnet]');
    process.exit(1);
  }
  const resolvedModel = resolveModel(model);

  const systemPrompt = readFileSync(path.join(PROJECT_ROOT, "SYSTEM.md"), "utf8");

  // If the user is asking to continue/resume, the agent must NOT rebuild from
  // scratch — a previous run may have been cancelled partway. Tell it to inspect
  // current state first and pick up from there.
  const wantsContinue = /\b(continue|keep going|resume|pick up|finish|carry on|where you left)\b/i.test(prompt);
  const resumeHint = wantsContinue
    ? `\nIMPORTANT — this is a CONTINUE request. A previous edit may have been ` +
      `interrupted partway. Do NOT start over. FIRST run sequences-list and ` +
      `sequence-inspect to see what's already been built, then continue the ` +
      `remaining work from where it left off.\n`
    : ``;

  // STEERING: the user sent this WHILE a previous run was in progress (they stopped
  // it to redirect). The prior run already built partial state — the new instruction
  // ADJUSTS that work, it does not replace it. So: inspect what exists, keep the good
  // parts, and apply the redirect. Don't restart from scratch or re-analyze footage
  // you've already analyzed.
  const steeringHint = steering
    ? `\nIMPORTANT — MID-TASK REDIRECT. You were already working on this project when ` +
      `the user interrupted to steer you with the request below. A partial edit likely ` +
      `already exists. FIRST run sequences-list and sequence-inspect to see the current ` +
      `state. Then apply the user's new instruction as an ADJUSTMENT to that existing ` +
      `work — keep what's already built unless the request says otherwise, and do NOT ` +
      `re-run expensive analysis (footage/beat/vision) you've already done this session.\n`
    : ``;

  const isHybrid = process.env.HYBRID_MODE === "true";
  const hybridHint = isHybrid
    ? `\nHYBRID MODE ACTIVE: You are the "Creative Director". Your job is to design the edit, not manually build it.\n` +
      `For large tasks, write a detailed \`creative_plan.md\` to the workspace, then delegate the execution by running:\n` +
      `  npm run edit:local -- "Execute the instructions in creative_plan.md" --workspace "${workspace}"\n` +
      `This hands off the token-intensive tool-calling to a local Coder model.\n`
    : ``;

  // Tell the model the exact invocation for the tools CLI and the active workspace.
  const contextPreamble =
    `Runtime context:\n` +
    `- The \`jc\` tools CLI is invoked as: node ${CLI} <command> [--flags]\n` +
    `- Active workspace: "${workspace}" (pass --workspace ${workspace} to every jc command)\n` +
    `- Workspaces live under ~/Documents/JCutAI/ unless JCUT_HOME is set.\n` +
    `- ffmpeg and ffprobe are on PATH.\n` +
    resumeHint +
    steeringHint +
    hybridHint +
    `\nUser request:\n${prompt}`;

  // TWO INDEPENDENT GUARDS so the agent can NEVER hang indefinitely:
  //
  //  1. INACTIVITY WATCHDOG — fires if no REAL progress arrives for STALL_MS.
  //     Critically, periodic `task_progress` keepalive pings from a stalled
  //     subagent do NOT reset it (that was the bug that let "Reviewing the
  //     timeline…" sit frozen for 6+ minutes). Only genuine output — assistant
  //     text, tool calls, tool results, task start/complete — counts as progress.
  //
  //  2. ABSOLUTE CEILING — a hard wall-clock cap on the entire run. Even if the
  //     model keeps emitting tiny bits of output forever (a slow loop), the run
  //     is force-stopped after HARD_CAP_MS so the UI always returns to the user.
  const abort = new AbortController();
  // The inactivity timer only catches a genuinely DEAD stream (lost API
  // connection). A working agent — especially a vision-heavy one reading 4K frames
  // and reasoning about an edit — can legitimately be quiet for minutes between
  // stream events. So this is generous; the HARD_CAP is the real backstop that
  // guarantees the run always ends. Better to wait a few extra minutes than to
  // kill an agent that's actually working (which happened at 90s and 120s).
  const STALL_MS = 300000;       // 5 min of total silence = treat the stream as dead
  const TOOL_GRACE_MS = 480000;  // 8 min — a dispatched tool/subagent may run long
  const HARD_CAP_MS = 2400000;   // 40 min absolute max for any single run
  let stopped = false;
  const stop = (reason: string) => {
    if (stopped) return;
    stopped = true;
    process.stdout.write(`\n\n\x1b[31m⚠ ${reason} — stopping. Try again, or switch model in Settings.\x1b[0m\n`);
    abort.abort();
  };
  // The watchdog only protects against a truly DEAD stream (API connection lost,
  // no events at all). A long-running TOOL (ffprobe on 37 SD-card 4K clips, an
  // ffmpeg render, a big analyze-music) is NOT a stall — the stream is quiet
  // because work is happening. So when the agent dispatches a tool, we extend the
  // timeout generously; only prolonged TOTAL silence with no tool in flight trips it.
  let watchdog: NodeJS.Timeout;
  const bump = (ms: number = STALL_MS) => {
    if (stopped) return;
    clearTimeout(watchdog);
    watchdog = setTimeout(() => stop(`No activity from the editor for ${Math.round(ms / 1000)}s`), ms);
  };
  // Absolute ceiling — never reset, fires once.
  const hardCap = setTimeout(
    () => stop(`This run hit the ${HARD_CAP_MS / 60000}-minute time limit`),
    HARD_CAP_MS,
  );
  bump();

  try {
    for await (const message of query({
      prompt: contextPreamble,
      options: {
        systemPrompt,
        ...(resolvedModel ? { model: resolvedModel } : {}),
        allowedTools: ["Bash", "Read", "Glob", "Grep", "Write", "Task", "TaskOutput", "TaskStop"],
        forwardSubagentText: true,
        agentProgressSummaries: true,
        permissionMode: "acceptEdits",
        maxTurns: 40,
        abortController: abort,
      },
    })) {
      if (message.type === "assistant") {
        bump(); // real model output — genuine progress
        const isSubagent = message.parent_tool_use_id !== null;
        for (const block of message.message.content) {
          if (block.type === "text") {
            if (isSubagent) {
              process.stdout.write(`\n\x1b[2m[Subagent: ${message.subagent_type || "task"}] ${block.text}\x1b[0m\n`);
            } else {
              process.stdout.write(block.text);
            }
          }
          if (block.type === "tool_use") {
            // A tool was just dispatched — it may run LONG (ffprobe across 37 4K
            // clips, a render, analyze-music). The stream stays quiet while it
            // works; that is NOT a stall. Give it the generous tool grace window.
            bump(TOOL_GRACE_MS);
            const input = JSON.stringify(block.input);
            const prefix = isSubagent ? `[Subagent] ` : ``;
            process.stdout.write(
              `\n\x1b[2m· ${prefix}${block.name}: ${input.slice(0, 160)}${input.length > 160 ? "…" : ""}\x1b[0m\n`,
            );
          }
        }
      } else if (message.type === "user") {
        // A tool result came back. For vision/image reads (large model processing
        // time) and long CLI tools, the model may take several minutes AFTER the
        // result arrives to reason and respond. Give it the full tool grace window
        // so we don't kill an agent that is actively thinking about the footage.
        bump(TOOL_GRACE_MS);
      } else if (message.type === "system") {
        if (message.subtype === "task_started") {
          bump(TOOL_GRACE_MS); // a subagent can run long — give it the tool grace window
          process.stdout.write(`\n\x1b[2m[Task Started] ${message.description} (${message.subagent_type || "general"})\x1b[0m\n`);
        } else if (message.subtype === "task_progress") {
          // A progress update WITH a real summary is genuine work — bump the normal
          // window. A bare keepalive (no summary) is NOT enough to reset, so a truly
          // stalled subagent still trips the watchdog eventually.
          if (message.summary) {
            bump();
            process.stdout.write(`\n\x1b[2m[Task Progress] ${message.description}: ${message.summary}\x1b[0m\n`);
          }
        } else if (message.subtype === "task_notification") {
          bump(); // a subagent completed/failed — genuine progress
          const symbol = message.status === "completed" ? "✓" : message.status === "failed" ? "✗" : "⏹";
          process.stdout.write(`\n\x1b[2m[Task Completed] ${symbol} ${message.summary || message.status}\x1b[0m\n`);
        }
      } else if (message.type === "rate_limit_event") {
        const info = message.rate_limit_info;
        // Emit whenever we have ANY rate-limit info — utilization may be absent on
        // some events but status/resetsAt still let the UI show a meaningful bar.
        if (info) {
          process.stdout.write(`__CLAUDE_USAGE_INFO__:${JSON.stringify({
            utilization: typeof info.utilization === "number" ? info.utilization : 0,
            resetsAt: info.resetsAt,
            type: info.rateLimitType,
            status: info.status,
          })}\n`);
        }
      } else if (message.type === "result") {
        if (message.subtype === "success") {
          process.stdout.write(`\n\n\x1b[32m✓ done\x1b[0m\n`);
        } else {
          process.stdout.write(`\n\n\x1b[31m✗ ${message.subtype}\x1b[0m\n`);
        }
      }
    }
  } finally {
    clearTimeout(watchdog!);
    clearTimeout(hardCap);
  }
}

main().catch((e) => {
  // AbortError from the watchdog is expected — exit cleanly so the UI clears.
  if (e?.name === "AbortError") process.exit(0);
  const msg = e?.message || String(e);
  if (msg.includes("session limit") || msg.includes("rate limit") || msg.includes("limit")) {
    process.stderr.write(
      `\n\n⚠️ Claude Code subscription limit hit.\n` +
      `Details: ${msg.replace(/Error:\s*Claude\s*Code\s*returned\s*an\s*error\s*result:\s*/i, "")}\n\n` +
      `To continue editing immediately, switch to Local model (LM Studio) in Settings (⚙️).\n`
    );
  } else {
    console.error(e);
  }
  process.exit(1);
});
