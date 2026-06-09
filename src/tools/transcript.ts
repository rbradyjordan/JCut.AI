// Transcript IMPORT — JCut does not transcribe. Instead the user exports a
// transcript or captions from Premiere (Text panel → Export, or Captions →
// Export to .srt) and imports it here, giving the agent timed speech for
// speech-driven editing (radio cuts, filler removal, B-roll placement).
//
// Supported formats:
//   .srt  — SubRip (Premiere's caption/transcript export; the primary target)
//   .vtt  — WebVTT (also common; Premiere and many tools export it)
//   .txt  — plain text (no timing — stored as one untimed cue for search only)
//
// Stored per-workspace under <ws>/analysis/transcripts/<stem>.json.
import { promises as fs } from "node:fs";
import path from "node:path";
import { workspaceDir } from "./store.js";
import { Transcript, TranscriptCue } from "./model.js";

// "HH:MM:SS,mmm" (SRT) or "HH:MM:SS.mmm" (VTT) → seconds. Also accepts "MM:SS.mmm".
export function parseTimestamp(ts: string): number {
  const clean = ts.trim().replace(",", ".");
  const parts = clean.split(":").map((p) => p.trim());
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return Number(h) * 3600 + Number(m) * 60 + Number(s);
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return Number(m) * 60 + Number(s);
  }
  return Number(clean) || 0;
}

// A cue separator line: "00:00:01,000 --> 00:00:04,000" (with optional VTT
// position settings after the end time, which we ignore).
const TIME_LINE = /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})/;

// A speaker prefix Premiere/tools sometimes emit: "Speaker 1: text" or "[John]: text".
function splitSpeaker(text: string): { speaker?: string; text: string } {
  const m = text.match(/^\s*(?:\[([^\]]+)\]|([A-Za-z0-9 .'_-]{1,40}?))\s*:\s+(.*)$/s);
  if (m && (m[1] || m[2])) {
    const speaker = (m[1] || m[2]).trim();
    // Guard: only treat as a speaker label if it's short and not a sentence.
    if (speaker.length <= 40 && !/[.?!]/.test(speaker)) {
      return { speaker, text: m[3].trim() };
    }
  }
  return { text: text.trim() };
}

// Parse SRT or VTT (they share the cue/timeline structure; VTT adds a WEBVTT
// header and uses "." for the decimal separator — both handled).
export function parseSrtVtt(raw: string, format: "srt" | "vtt"): TranscriptCue[] {
  // Normalize newlines, strip a leading WEBVTT header + any NOTE/STYLE blocks.
  const text = raw.replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  const lines = text.split("\n");
  const cues: TranscriptCue[] = [];
  let i = 0;
  let idx = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Skip WEBVTT header, NOTE/STYLE/REGION blocks, and blank lines.
    if (/^WEBVTT/.test(line) || /^(NOTE|STYLE|REGION)\b/.test(line) || line.trim() === "") {
      i++;
      continue;
    }
    // A cue may begin with a numeric index line (SRT) or jump straight to a time
    // line (VTT). Look for the time line at the current or next line.
    let timeMatch = line.match(TIME_LINE);
    if (!timeMatch && i + 1 < lines.length) {
      const next = lines[i + 1].match(TIME_LINE);
      if (next) { i++; timeMatch = next; }
    }
    if (!timeMatch) { i++; continue; }
    const start = parseTimestamp(timeMatch[1]);
    const end = parseTimestamp(timeMatch[2]);
    // Gather text lines until a blank line or the next time line.
    i++;
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !TIME_LINE.test(lines[i])) {
      // A bare numeric line right before a time line is the next cue's index — but
      // we only get here if it's NOT followed by a time line, so keep it as text.
      textLines.push(lines[i]);
      i++;
    }
    const rawJoined = textLines.join(" ");
    // VTT voice tag <v Speaker>text</v> carries the speaker — capture it before
    // stripping tags (Premiere and many tools emit this).
    const voiceMatch = rawJoined.match(/<v\s+([^>]+)>/i);
    const vttSpeaker = voiceMatch ? voiceMatch[1].trim() : undefined;
    const joined = rawJoined
      .replace(/<[^>]+>/g, "")          // strip VTT inline tags (<v>, <b>, <c>, <00:00:01.000>)
      .replace(/\s+/g, " ")
      .trim();
    if (!joined) continue;
    const split = splitSpeaker(joined);
    const speaker = vttSpeaker || split.speaker;
    const cueText = split.text;
    cues.push({ index: idx++, start_seconds: start, end_seconds: end, text: cueText, speaker });
  }
  return cues;
}

export function parseTxt(raw: string): TranscriptCue[] {
  const text = raw.replace(/\r\n?/g, "\n").replace(/^﻿/, "").trim();
  if (!text) return [];
  // No timing available — one untimed cue holding the whole text (searchable).
  return [{ index: 0, start_seconds: 0, end_seconds: 0, text }];
}

export function formatOf(filePath: string): "srt" | "vtt" | "txt" {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".vtt") return "vtt";
  if (ext === ".txt") return "txt";
  return "srt"; // default — Premiere's primary export
}

// Parse a transcript file into the model shape.
export async function parseTranscriptFile(filePath: string): Promise<Transcript> {
  const raw = await fs.readFile(filePath, "utf8");
  const format = formatOf(filePath);
  const cues = format === "txt" ? parseTxt(raw) : parseSrtVtt(raw, format);
  if (cues.length === 0) {
    throw new Error(
      `No cues parsed from ${path.basename(filePath)}. ` +
      `Is it a valid ${format.toUpperCase()} file? (Export from Premiere: Text panel → ⋯ → Export to SRT.)`,
    );
  }
  return {
    source: filePath,
    format,
    cues,
    full_text: cues.map((c) => c.text).join(" "),
    imported_at: 0, // stamped by the caller (Date.now is unavailable in some contexts)
  };
}

// ── Persistence (per-workspace, keyed by file stem) ──────────────────────────
function transcriptDir(ws: string): string {
  return path.join(workspaceDir(ws), "analysis", "transcripts");
}

export async function saveTranscript(ws: string, name: string, t: Transcript): Promise<string> {
  const dir = transcriptDir(ws);
  await fs.mkdir(dir, { recursive: true });
  const stem = name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/gi, "_") || "transcript";
  const out = path.join(dir, `${stem}.json`);
  await fs.writeFile(out, JSON.stringify(t, null, 2));
  return out;
}

export async function listTranscripts(ws: string): Promise<{ name: string; cues: number; format: string }[]> {
  const dir = transcriptDir(ws);
  let files: string[];
  try { files = await fs.readdir(dir); } catch { return []; }
  const out: { name: string; cues: number; format: string }[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const t = JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as Transcript;
      out.push({ name: f.replace(/\.json$/, ""), cues: t.cues.length, format: t.format });
    } catch { /* skip bad file */ }
  }
  return out;
}

export async function loadTranscript(ws: string, name: string): Promise<Transcript> {
  const stem = name.replace(/\.json$/, "").replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/gi, "_");
  const p = path.join(transcriptDir(ws), `${stem}.json`);
  return JSON.parse(await fs.readFile(p, "utf8")) as Transcript;
}

// Search cues for a phrase (case-insensitive). Returns matching cues with timing
// so the agent can cut on the exact words — the whole point of importing speech.
export function searchCues(t: Transcript, query: string): TranscriptCue[] {
  const q = query.toLowerCase();
  return t.cues.filter((c) => c.text.toLowerCase().includes(q));
}
