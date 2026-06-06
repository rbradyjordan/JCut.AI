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
  const promptParts: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--workspace") {
      workspace = argv[++i];
    } else {
      promptParts.push(argv[i]);
    }
  }
  return { workspace, prompt: promptParts.join(" ").trim() };
}

async function main() {
  const { workspace, prompt } = parseCliArgs(process.argv.slice(2));
  if (!prompt) {
    console.error('Usage: npm run edit -- "your request" [--workspace name]');
    process.exit(1);
  }

  const systemPrompt = readFileSync(path.join(PROJECT_ROOT, "SYSTEM.md"), "utf8");

  // Tell the model the exact invocation for the tools CLI and the active workspace.
  const contextPreamble =
    `Runtime context:\n` +
    `- The \`jc\` tools CLI is invoked as: node ${CLI} <command> [--flags]\n` +
    `- Active workspace: "${workspace}" (pass --workspace ${workspace} to every jc command)\n` +
    `- Workspaces live under ~/Documents/JCutAI/ unless JCUT_HOME is set.\n` +
    `- ffmpeg and ffprobe are on PATH.\n\n` +
    `User request:\n${prompt}`;

  for await (const message of query({
    prompt: contextPreamble,
    options: {
      systemPrompt,
      // Built-in tools: Bash drives the CLI; Read inspects verification frames;
      // Glob finds footage; Write for notes. No custom MCP tools needed — the
      // intelligence is the loop, the "hands" are the CLI behind Bash.
      allowedTools: ["Bash", "Read", "Glob", "Grep", "Write"],
      permissionMode: "acceptEdits",
      maxTurns: 40,
    },
  })) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") process.stdout.write(block.text);
        if (block.type === "tool_use") {
          const input = JSON.stringify(block.input);
          process.stdout.write(
            `\n\x1b[2m· ${block.name}: ${input.slice(0, 160)}${input.length > 160 ? "…" : ""}\x1b[0m\n`,
          );
        }
      }
    } else if (message.type === "result") {
      if (message.subtype === "success") {
        process.stdout.write(`\n\n\x1b[32m✓ done\x1b[0m\n`);
      } else {
        process.stdout.write(`\n\n\x1b[31m✗ ${message.subtype}\x1b[0m\n`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
