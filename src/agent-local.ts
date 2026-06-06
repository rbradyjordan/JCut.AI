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
// Env: LMSTUDIO_URL (default http://localhost:1234/v1), LMSTUDIO_MODEL.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexecFile = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const CLI = path.join(PROJECT_ROOT, "dist", "tools", "cli.js");

const BASE_URL = process.env.LMSTUDIO_URL || "http://localhost:1234/v1";

// The single tool we expose: run a `jc` subcommand. We keep ONE generic tool
// (rather than 14) so small local models aren't overwhelmed by a huge tool list —
// they just emit a command + flags, exactly like a person typing in a terminal.
const TOOLS = [
  {
    type: "function",
    function: {
      name: "jc",
      description:
        "Run the JCut.AI video-editing CLI. Returns JSON. Commands: sequence-create, " +
        "sequences-list, sequence-inspect, media-info, sequence-clips-add, " +
        "sequence-clips-update, sequence-clips-remove, sequence-render-final, " +
        "sequence-render-frame, sequence-analyze, style-learn, memory-read, memory-append. " +
        "Always pass --workspace. Run 'sequence-inspect' for a lean clip list.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "the jc subcommand, e.g. sequence-create" },
          args: {
            type: "array",
            items: { type: "string" },
            description: 'flags as alternating tokens, e.g. ["--workspace","demo","--name","Cut"]',
          },
        },
        required: ["command", "args"],
      },
    },
  },
];

async function runJc(command: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await pexecFile("node", [CLI, command, ...args], {
      maxBuffer: 1 << 26,
      env: process.env,
    });
    return stdout.slice(0, 8000); // hard cap so a runaway dump can't blow the context
  } catch (e: any) {
    return (e.stdout || "") + (e.stderr || e.message || "tool error");
  }
}

function parseCliArgs(argv: string[]) {
  let workspace = "default";
  let model = process.env.LMSTUDIO_MODEL || "local-model";
  const promptParts: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--workspace") workspace = argv[++i];
    else if (argv[i] === "--model") model = argv[++i];
    else promptParts.push(argv[i]);
  }
  return { workspace, model, prompt: promptParts.join(" ").trim() };
}

const SERVER_HINT =
  `Could not reach LM Studio at ${BASE_URL}.\n` +
  `Fix: open LM Studio → load a tool-calling model → Developer tab → Start Server (port 1234).\n` +
  `Or set LMSTUDIO_URL if it's on a different host/port.`;

async function chat(model: string, messages: any[]): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, tools: TOOLS, temperature: 0.3, stream: false }),
    });
  } catch {
    // Connection refused / DNS / network — server almost certainly not running.
    throw new Error(SERVER_HINT);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LM Studio responded ${res.status}. ${body.slice(0, 300)}\n${SERVER_HINT}`);
  }
  return res.json();
}

async function main() {
  const { workspace, model, prompt } = parseCliArgs(process.argv.slice(2));
  if (!prompt) {
    console.error('Usage: npm run edit:local -- "your request" [--workspace name] [--model id]');
    process.exit(1);
  }

  const system = readFileSync(path.join(PROJECT_ROOT, "SYSTEM.md"), "utf8");
  // Local models need firmer guardrails than Claude: pin the language and force
  // tool use. (Some models — e.g. Gemma variants — drift into Japanese or emit
  // freeform text instead of calling tools without this.)
  const localGuardrails =
    `\n\n## CRITICAL for this runtime (read carefully)\n` +
    `- ALWAYS respond in English, regardless of the model's defaults.\n` +
    `- You CANNOT edit anything by writing prose. To do ANY action you MUST call the \`jc\` tool.\n` +
    `- If the user asks to edit, your FIRST move is a \`jc\` tool call (e.g. memory-read, sources-list).\n` +
    `- Never invent file names, code, or results. Only report what \`jc\` actually returned.\n` +
    `- Keep responses short. One step at a time: call a tool, read its JSON, then decide the next.\n` +
    `\n### Example of correct behavior\n` +
    `User: "what footage do I have?"\n` +
    `You: call jc with command="sources-list", args=["--workspace","<ws>"]. ` +
    `Then read the JSON and tell the user the file names in plain English. Do NOT write code or guess.`;
  const messages: any[] = [
    { role: "system", content: system + localGuardrails },
    {
      role: "user",
      content:
        `Runtime: the jc CLI is already wired — call the \`jc\` tool with a command + args. ` +
        `Active workspace: "${workspace}" (pass --workspace ${workspace} to every call). ` +
        `Read memory first.\n\nRequest: ${prompt}`,
    },
  ];

  const MAX_STEPS = 24;
  let toolCallsEver = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    const resp = await chat(model, messages);
    const msg = resp.choices?.[0]?.message;
    if (!msg) throw new Error("No response from local model.");
    messages.push(msg);

    if (msg.content) process.stdout.write(`\n${msg.content}\n`);

    const calls = msg.tool_calls || [];
    if (calls.length === 0) {
      // On the very FIRST step with no tool call and no substantive content, the
      // model likely can't tool-call. Warn the user instead of showing junk.
      if (step === 0 && toolCallsEver === 0) {
        const junk = !msg.content || msg.content.trim().length < 2 || /^[#`]/.test(msg.content.trim());
        if (junk) {
          process.stdout.write(
            `\n⚠️ The local model "${model}" didn't use the editing tools and returned an ` +
            `unusable response. This usually means the model is weak at tool-calling.\n\n` +
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
      try {
        const parsed = JSON.parse(call.function.arguments || "{}");
        cmd = parsed.command;
        args = Array.isArray(parsed.args) ? parsed.args.map(String) : [];
      } catch {
        messages.push({ role: "tool", tool_call_id: call.id, content: "bad tool arguments JSON" });
        continue;
      }
      process.stdout.write(`\x1b[2m· jc ${cmd} ${args.join(" ")}\x1b[0m\n`);
      const out = await runJc(cmd, args);
      messages.push({ role: "tool", tool_call_id: call.id, content: out });
    }
  }
  process.stdout.write(`\n\x1b[33m⚠ stopped after ${MAX_STEPS} steps\x1b[0m\n`);
}

main().catch((e) => {
  console.error(`\x1b[31m${e.message}\x1b[0m`);
  process.exit(1);
});
