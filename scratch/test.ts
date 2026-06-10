import { promises as fs } from "node:fs";

const ALL_COMMANDS = new Set([
  "sequence-create","sequences-list","sequence-inspect","media-info",
  "sequence-clips-add","sequence-clips-update","sequence-clips-remove",
  "sequence-captions-add","sequence-captions-remove","sequence-captions-list",
  "sequence-transitions-add","sequence-transitions-remove","sequence-transitions-list",
  "sequence-export-premiere","sequence-import-prproj","sequence-analyze","sequence-reframe",
  "style-learn","media-frames","media-frames-batch","content-set","content-list",
  "sources-list","source-add","source-localize","source-remove","source-relink",
  "criteria-get","criteria-set","memory-read","memory-append",
  "analyze-music","modes-list","mode-get","kb-list","kb-read",
  "transcript-import","transcript-list","transcript-get","transcript-search",
  "prproj-analyze",
]);

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
    const line = rawLine.replace(/^[\s·•\-*>]+/, "").replace(/^jc\s+/i, "").trim();
    if (!line) continue;
    const firstWord = line.split(/\s+/)[0];
    if (!ALL_COMMANDS.has(firstWord)) continue;
    
    const rest = line.slice(firstWord.length).trim();
    const args = rest ? tokenizeArgLine(rest) : [];
    found.push({ command: firstWord, args });
  }
  return found;
}

const testContent1 = `The user wants me to resume the previous editing work on sequence "Music-Driven Recap v2" (id seqmq7298bf). They say there are 20 clips already placed and it runs to 40s. I need to: 1. First inspect t
· jc sequence-inspect --sequence-id seqmq7298bf

idea! I'll stop reanalyzing the music and move forward with the editing workflow. Let me check what we have in the workspace and continue from where we left off. <tool_call> <function=sources-list> </`;

const testContent2 = `<tool_call> <function=sequence-inspect> {"sequence-id": "seq123"} </tool_call>`;
const testContent3 = `<tool_call> <function=sequence-inspect> --sequence-id seq123 </tool_call>`;

console.log("Result 1:", extractProseCommands(testContent1));
console.log("Result 2:", extractProseCommands(testContent2));
console.log("Result 3:", extractProseCommands(testContent3));
