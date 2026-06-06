// Auto-compact — keeps long conversations from blowing the context window.
//
// The agent backends run one process per turn, so the SDK itself doesn't carry
// unbounded history. But the GUI conversation does, and we may feed prior turns
// back as context. When the visible history grows past a threshold, we collapse
// the OLDER turns into a single compact recap message and keep the most recent
// turns verbatim. The recap is produced by the active backend (cheap call).
import type { AppSettings } from "./jcut";

export interface Msg { role: "user" | "agent"; text: string; }

// Rough token estimate (4 chars/token) — good enough to decide when to compact.
export function estimateTokens(msgs: Msg[]): number {
  return Math.round(msgs.reduce((n, m) => n + m.text.length, 0) / 4);
}

const COMPACT_AT_TOKENS = 6000; // trigger threshold
const KEEP_RECENT = 6;          // always keep this many latest messages verbatim

export function shouldCompact(msgs: Msg[]): boolean {
  return msgs.length > KEEP_RECENT + 2 && estimateTokens(msgs) > COMPACT_AT_TOKENS;
}

// Produce a compacted message list. The summarizer is injected so we can use the
// same backend (Claude or local) the user picked. If summarization fails, we
// fall back to a deterministic local recap so the app never blocks on it.
export async function compact(
  msgs: Msg[],
  summarize: (prompt: string) => Promise<string>,
): Promise<Msg[]> {
  if (!shouldCompact(msgs)) return msgs;
  const older = msgs.slice(0, msgs.length - KEEP_RECENT);
  const recent = msgs.slice(msgs.length - KEEP_RECENT);

  const transcript = older
    .map((m) => `${m.role === "user" ? "User" : "Editor"}: ${m.text}`)
    .join("\n");

  let recap: string;
  try {
    recap = (await summarize(
      `Summarize this video-editing conversation so far in 4-6 terse bullets. ` +
      `Capture: what the user is making, key editing decisions/preferences, the ` +
      `current sequence state, and anything still pending. Be specific, no fluff.\n\n${transcript}`,
    )).trim();
  } catch {
    recap = localRecap(older);
  }

  const recapMsg: Msg = {
    role: "agent",
    text: `*Earlier in this conversation (auto-compacted):*\n\n${recap}`,
  };
  return [recapMsg, ...recent];
}

// Deterministic fallback recap — no model call. Pulls the user's asks.
function localRecap(older: Msg[]): string {
  const asks = older.filter((m) => m.role === "user").map((m) => `- ${m.text.slice(0, 100)}`);
  return asks.slice(-6).join("\n") || "- (earlier setup)";
}
