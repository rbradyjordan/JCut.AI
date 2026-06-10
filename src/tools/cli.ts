#!/usr/bin/env node
// JCut.AI tools CLI — the "hands" the agent drives via the Bash tool.
// Every command prints JSON to stdout.
//
//   jc sequence-create   --workspace W --name N --width 1080 --height 1920 --framerate 30
//   jc sequences-list     --workspace W
//   jc sequence-inspect   --workspace W --sequence-id ID
//   jc media-info         --files a.mp4 b.mov
//   jc sequence-clips-add --workspace W --sequence-id ID --operations '[...]'
//   jc sequence-clips-update --workspace W --sequence-id ID --operations '[...]'
//   jc sequence-clips-remove --workspace W --sequence-id ID --ids c1 c2
//   jc sequence-export-premiere --workspace W --sequence-id ID  (the deliverable)
// NOTE: JCut does NOT render video — the finished cut is rendered in Premiere from
// the exported .prproj. JCut builds + verifies the timeline structurally.
import {
  ensureWorkspace, saveSequence, loadSequence, listSequences, probeMedia,
} from "./store.js";
import {
  addClips, updateClips, removeClips,
  addCaptions, removeCaptions, addTransitions, removeTransitions, cascadeTransitions,
} from "./ops.js";
import { analyzeSequence, buildStyleProfile } from "./analyze.js";
import { analyzePrproj, importPrprojClips } from "./prproj.js";
import { exportPrproj } from "./prproj.js";
import { analyzeMusic } from "./beats.js";
import { analyzeVideo } from "./video-analysis.js";
import { extractFrames, saveContent, loadContent, ClipContent } from "./content.js";
import { BUILTIN_MODES, loadPresets, savePreset, deletePreset, resolveInstructions } from "./presets.js";
import { loadCriteria, saveCriteria, summarizeCriteria, Criteria, Toggle } from "./criteria.js";
import {
  parseTranscriptFile, saveTranscript, listTranscripts, loadTranscript, searchCues,
} from "./transcript.js";
import {
  Sequence, SequenceMarker, MarkerColor, sequenceDuration, Orientation, orientationCanvas, orientationOf,
  fillTransform, isVideoTrack,
} from "./model.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { workspaceDir } from "./store.js";

// Tiny flag parser: --key value, repeated --files collects into an array,
// bare flags become true.
function parseArgs(argv: string[]): Record<string, any> {
  const out: Record<string, any> = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out[key] = true;
      } else if (key === "files" || key === "ids") {
        out[key] = out[key] || [];
        // consume until next flag
        while (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) {
          out[key].push(argv[++i]);
        }
      } else {
        const parts = [argv[++i]];
        while (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) {
          parts.push(argv[++i]);
        }
        out[key] = parts.join(" ");
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

// Extract plain text from a binary document (rtf/doc/docx/pdf) using built-in
// command-line tools, so the agent can read briefs/scripts that aren't already
// plain text. Returns the text, or null if no extractor is available for the
// type. macOS ships `textutil` (rtf/doc/docx); `pdftotext` (poppler) handles PDF
// when installed. We deliberately avoid bundling a parser library — these cover
// the common cases and degrade gracefully (caller warns when null).
async function extractDocText(absPath: string): Promise<string | null> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const ext = path.extname(absPath).toLowerCase();
  try {
    if (ext === ".pdf") {
      // `-` writes extracted text to stdout. Large PDFs are capped by maxBuffer.
      const { stdout } = await run("pdftotext", ["-layout", absPath, "-"], { maxBuffer: 32 * 1024 * 1024 });
      return stdout;
    }
    // rtf / doc / docx → textutil (built into macOS). `-stdout` streams the text.
    const { stdout } = await run("textutil", ["-convert", "txt", "-stdout", absPath], { maxBuffer: 32 * 1024 * 1024 });
    return stdout;
  } catch {
    return null; // extractor missing or failed — caller surfaces a warning
  }
}

function emit(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}
function fail(msg: string): never {
  process.stdout.write(JSON.stringify({ ok: false, error: msg }, null, 2) + "\n");
  process.exit(1);
}

function newSeqId(): string {
  return "seq" + Date.now().toString(36);
}

let _cidCounter = 0;
function newClipId(prefix = "c"): string {
  _cidCounter += 1;
  return `${prefix}${Date.now().toString(36)}${_cidCounter}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readWorkspaceMemory(workspace: string): Promise<string> {
  const mp = path.join(workspaceDir(workspace), "MEMORY.md");
  try {
    return await fs.readFile(mp, "utf8");
  } catch {
    return "# JCut.AI Memory\n";
  }
}

async function upsertMemorySection(workspace: string, heading: string, bodyLines: string[]): Promise<string> {
  const mp = path.join(workspaceDir(workspace), "MEMORY.md");
  let memory = await readWorkspaceMemory(workspace);
  const block = `\n## ${heading}\n${bodyLines.join("\n").trimEnd()}\n`;
  const pattern = new RegExp(`\\n## ${escapeRegExp(heading)}\\n[\\s\\S]*?(?=\\n## |\\n*$)`, "g");
  memory = memory.replace(pattern, "");
  await fs.writeFile(mp, memory.trimEnd() + block);
  return mp;
}

async function resolveWorkspaceMediaPath(ws: string, fileRaw: string): Promise<string> {
  if (path.isAbsolute(fileRaw)) return fileRaw;
  let file = path.join(workspaceDir(ws), fileRaw);
  try {
    await fs.access(file);
    return file;
  } catch {
    // Try workspace source folders next.
  }
  const candidates = [
    path.join(workspaceDir(ws), "source", "audio", fileRaw),
    path.join(workspaceDir(ws), "source", "video", fileRaw),
    path.join(workspaceDir(ws), "source", "images", fileRaw),
    path.join(workspaceDir(ws), "source", fileRaw),
  ];
  for (const cand of candidates) {
    try {
      await fs.access(cand);
      return cand;
    } catch {
      // Keep looking.
    }
  }
  return file;
}

// Knowledge base lives at <project>/kb. From dist/tools/cli.js that's ../../kb.
function kbDir(): string {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "kb");
}

// Titles + "read when" hints so kb-list guides the agent to the right doc.
const KB_TITLES: Record<string, { title: string; when: string }> = {
  "fundamentals": { title: "Editing Fundamentals", when: "Always — universal craft principles. Read first." },
  "footage-intuition": { title: "Footage Intuition — Reading How Material Is Organized", when: "Before assembling from a pool of files — classify music vs B-roll, infer the intended spine, decide what NOT to use." },
  "editing-craft": { title: "Editing Craft — Advanced Techniques", when: "Before any creative edit (cool cuts, speed ramps, beat-sync)." },
  "recap-videos": { title: "Recap Videos — Specialist Playbook", when: "Recaps, highlights, best-of, event/season recaps, sizzles, aftermovies." },
  "interviews-dialogue": { title: "Interviews & Dialogue + Breathing Room", when: "Interviews, talking-head, podcast, any transcript-driven cut." },
  "documentary-narrative": { title: "Documentary & Narrative", when: "Docs, mini-docs, brand stories, narrative YouTube." },
  "short-form-social": { title: "Short-Form & Social", when: "TikTok/Reels/Shorts, vertical, retention-focused ads." },
  "trailer-hype": { title: "Trailers & Hype Edits", when: "Trailers, launch/announcement hype, promos." },
  "wedding-event": { title: "Weddings & Events", when: "Weddings, parties, conferences, performances." },
  "music-video": { title: "Music Videos & Performance", when: "Music videos, performance/live cuts, lyric pieces." },
  "pacing-and-rhythm": { title: "Pacing, Rhythm & Breathing Room", when: "Any project — timing, beat-grid cutting, breathing room." },
  "audio": { title: "Audio — Levels, Mixing & Sound", when: "Any project with audio — levels, ducking, J/L cuts, fades." },
  "color-continuity": { title: "Color & Visual Continuity", when: "Matching shots; multi-source or multi-light footage." },
};

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = parseArgs(rest);

  try {
    switch (cmd) {
      case "sequence-create": {
        const ws = a.workspace || fail("--workspace required");
        await ensureWorkspace(ws);
        // Orientation shortcut: --orientation vertical|horizontal|square sets the
        // canvas (1080×1920 / 1920×1080 / 1080×1080). Explicit --width/--height
        // override it. "both" is handled by the caller (create two sequences).
        let width: number, height: number;
        if (a.orientation && a.orientation !== "both") {
          const c = orientationCanvas(a.orientation as Orientation);
          width = Number(a.width) || c.width;
          height = Number(a.height) || c.height;
        } else {
          width = Number(a.width) || fail("--width or --orientation required");
          height = Number(a.height) || fail("--height or --orientation required");
        }
        const seq: Sequence = {
          id: newSeqId(),
          name: a.name || "Untitled",
          description: a.description || "",
          settings: {
            width, height,
            framerate: Number(a.framerate) || fail("--framerate required"),
            sample_rate: Number(a["sample-rate"]) || 48000,
            color_space: a["color-space"] || "bt709",
          },
          clips: [],
        };
        const p = await saveSequence(ws, seq);
        emit({
          ok: true, sequence_id: seq.id, path: p, sequence: seq,
          orientation: orientationOf(seq.settings),
        });
        break;
      }

      case "sequences-list": {
        const ws = a.workspace || fail("--workspace required");
        const seqs = await listSequences(ws);
        emit({
          ok: true,
          sequences: seqs.map((s) => ({
            id: s.id, name: s.name, clips: s.clips.length,
            duration_seconds: Number(sequenceDuration(s).toFixed(3)),
          })),
        });
        break;
      }

      case "sequence-inspect": {
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        // Default is a TOKEN-LEAN brief: one compact line per clip, not the full
        // JSON (transforms, source metadata, etc.). Pass --full only when you
        // genuinely need every field — it can be large on long timelines.
        if (a.full) {
          emit({ ok: true, sequence: seq, duration_seconds: Number(sequenceDuration(seq).toFixed(3)) });
          break;
        }
        const clips = [...seq.clips]
          .sort((x, y) => x.track.localeCompare(y.track) || x.start_time_seconds - y.start_time_seconds)
          .map((c) => {
            const dur = (c.trim_end_seconds - c.trim_start_seconds) / (c.speed || 1);
            const src = c.source_path.split("/").pop();
            const sc = c.transform ? `x${c.transform.scale.x}` : "";
            return `${c.id} ${c.track} @${c.start_time_seconds}s +${dur.toFixed(2)}s ` +
                   `${src}[${c.trim_start_seconds}-${c.trim_end_seconds}] ${sc}`.trim();
          });
        emit({
          ok: true,
          name: seq.name,
          settings: `${seq.settings.width}x${seq.settings.height}@${seq.settings.framerate}`,
          duration_seconds: Number(sequenceDuration(seq).toFixed(3)),
          clip_count: seq.clips.length,
          clips, // array of compact strings
        });
        break;
      }

      case "media-info": {
        const filesRaw: string[] = a.files || fail("--files required");
        const ws = a.workspace || "default";
        
        const files: string[] = [];
        for (const fRaw of filesRaw) {
          if (path.isAbsolute(fRaw)) {
            files.push(fRaw);
            continue;
          }
          let resolved = path.join(workspaceDir(ws), fRaw);
          let exists = false;
          try {
            await fs.access(resolved);
            exists = true;
          } catch {}
          
          if (!exists) {
            const candidates = [
              path.join(workspaceDir(ws), "source", "video", fRaw),
              path.join(workspaceDir(ws), "source", "audio", fRaw),
              path.join(workspaceDir(ws), "source", "images", fRaw),
              path.join(workspaceDir(ws), "source", fRaw),
            ];
            for (const cand of candidates) {
              try {
                await fs.access(cand);
                resolved = cand;
                exists = true;
                break;
              } catch {}
            }
          }
          files.push(resolved);
        }

        // Probe with BOUNDED CONCURRENCY (not fully serial, not an explosion) and
        // dedupe — probing 350 files off an SD card serially could take an hour.
        // Concurrency 4 keeps the SD card from thrashing while staying responsive.
        const unique = [...new Set(files)];
        const CONCURRENCY = 4;
        const byFile = new Map<string, any>();
        let idx = 0;
        async function worker() {
          while (idx < unique.length) {
            const f = unique[idx++];
            try { byFile.set(f, { file: f, ...(await probeMedia(f)) }); }
            catch (e) { byFile.set(f, { file: f, error: (e as Error).message }); }
          }
        }
        await Promise.all(Array.from({ length: CONCURRENCY }, worker));
        emit({ ok: true, media: files.map((f) => byFile.get(f)) });
        break;
      }

      case "sequence-clips-add": {
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const ops = JSON.parse(a.operations || fail("--operations required (JSON array)"));
        const { created, warnings } = await addClips(ws, seq, ops);
        await saveSequence(ws, seq);
        // Lean by default: return just the new clip ids + a one-line summary each,
        // not full clip JSON. The agent can sequence-inspect if it needs detail.
        emit({
          ok: true,
          created_ids: created.map((c) => c.id),
          created: created.map((c) =>
            `${c.id} ${c.track} @${c.start_time_seconds}s ${c.source_path.split("/").pop()}`),
          warnings,
          total_clips: seq.clips.length,
        });
        break;
      }

      case "sequence-clips-update": {
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const ops = JSON.parse(a.operations || fail("--operations required (JSON array)"));
        const res = updateClips(seq, ops, !!a["no-ripple"]);
        const droppedTr = cascadeTransitions(seq); // clips moved → drop orphaned transitions
        await saveSequence(ws, seq);
        emit({ ok: true, ...res, ...(droppedTr.length ? { dropped_transitions: droppedTr } : {}) });
        break;
      }

      case "sequence-clips-remove": {
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const ids: string[] = a.ids || fail("--ids required");
        const res = removeClips(seq, ids, !!a["no-ripple"]);
        const droppedTr = cascadeTransitions(seq); // removed clips → drop orphaned transitions
        await saveSequence(ws, seq);
        emit({ ok: true, ...res, ...(droppedTr.length ? { dropped_transitions: droppedTr } : {}) });
        break;
      }

      case "sequence-captions-add": {
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const ops = JSON.parse(a.operations || fail("--operations required (JSON array)"));
        const res = addCaptions(seq, ops);
        await saveSequence(ws, seq);
        emit({ ok: true, created: res.created.map((c) => c.id), captions: res.created, warnings: res.warnings });
        break;
      }

      case "sequence-captions-remove": {
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const ids: string[] = a.ids || fail("--ids required");
        const res = removeCaptions(seq, ids);
        await saveSequence(ws, seq);
        emit({ ok: true, ...res });
        break;
      }

      case "sequence-captions-list": {
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        emit({ ok: true, captions: seq.captions || [] });
        break;
      }

      case "sequence-transitions-add": {
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const ops = JSON.parse(a.operations || fail("--operations required (JSON array)"));
        const res = addTransitions(seq, ops);
        await saveSequence(ws, seq);
        emit({ ok: true, created: res.created.map((t) => t.id), transitions: res.created, warnings: res.warnings });
        break;
      }

      case "sequence-transitions-remove": {
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const ids: string[] = a.ids || fail("--ids required");
        const res = removeTransitions(seq, ids);
        await saveSequence(ws, seq);
        emit({ ok: true, ...res });
        break;
      }

      case "sequence-transitions-list": {
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        emit({ ok: true, transitions: seq.transitions || [] });
        break;
      }

      case "sequence-markers-add": {
        // Add one or more colored label markers to the sequence timeline.
        // Markers appear in Premiere's timeline and Program Monitor as colored dots
        // with text, useful for annotating content sections, shot groups, subjects.
        //
        //   --workspace W --sequence-id ID
        //   --markers '[{"time_seconds":0,"label":"Opening","color":"green"}, ...]'
        //
        // color: red | orange | yellow | green | cyan | blue | violet | white
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const raw: SequenceMarker[] = (() => {
          try { return JSON.parse(a.markers || "[]"); } catch { fail("--markers must be valid JSON"); }
        })();
        if (!raw.length) fail("--markers must contain at least one marker");
        const valid: SequenceMarker[] = raw.map((m, i) => {
          if (typeof m.time_seconds !== "number") fail(`marker[${i}]: time_seconds required`);
          if (!m.label?.trim()) fail(`marker[${i}]: label required`);
          const id = m.id || `m-${Date.now()}-${i}`;
          const color: MarkerColor = (["red","orange","yellow","green","cyan","blue","violet","white"].includes(m.color || "")) ? m.color! : "green";
          return { id, time_seconds: m.time_seconds, duration_seconds: m.duration_seconds ?? 0, label: m.label.trim(), color };
        });
        seq.markers = [...(seq.markers || []), ...valid];
        await saveSequence(ws, seq);
        emit({ ok: true, added: valid.length, markers: seq.markers });
        break;
      }

      case "sequence-markers-remove": {
        // Remove markers by id.  --workspace W --sequence-id ID --ids '["m-1","m-2"]'
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const ids: string[] = (() => { try { return JSON.parse(a.ids || "[]"); } catch { return []; } })();
        const before = (seq.markers || []).length;
        seq.markers = (seq.markers || []).filter((m) => !ids.includes(m.id));
        await saveSequence(ws, seq);
        emit({ ok: true, removed: before - seq.markers.length, markers: seq.markers });
        break;
      }

      case "sequence-markers-list": {
        // List all markers on a sequence.  --workspace W --sequence-id ID
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        emit({ ok: true, markers: seq.markers || [] });
        break;
      }

      // NOTE: Timeline video rendering was removed by design — the finished video
      // is rendered in Premiere from the exported .prproj, not by JCut. JCut builds
      // and verifies the timeline structurally and hands off via sequence-export-
      // premiere. (Source-clip frame extraction for CONTENT understanding lives on
      // in `media-frames`/`media-frames-batch` — that's not timeline rendering.)

      case "source-add": {
        // Symlink source media into the workspace (never copy — originals stay untouched).
        // --files <abs paths...> AND/OR --folder <dir> (recursively adds every
        // media file found in the folder). Returns workspace-relative paths.
        const ws = a.workspace || fail("--workspace required");
        // Media + documents. Documents (scripts, briefs, shot lists, treatments)
        // give the agent context for a more complete first draft. They live under
        // source/documents/ and are read as text by the agent (see classify below).
        const MEDIA_RE = /\.(mp4|mov|mkv|webm|avi|m4v|mp3|wav|aac|flac|m4a|png|jpg|jpeg|gif|webp|bmp|tiff|md|markdown|txt|rtf|doc|docx|pdf)$/i;
        const DOC_RE = /\.(md|markdown|txt|rtf|doc|docx|pdf)$/i;
        let files: string[] = Array.isArray(a.files) ? [...a.files] : [];
        if (a.folder) {
          // Walk the folder (one level deep + immediate subfolders) for media.
          const root = a.folder as string;
          const walk = async (dir: string, depth: number): Promise<void> => {
            let entries;
            try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
            for (const e of entries) {
              // Skip macOS AppleDouble metadata files (._name) and dotfiles — they
              // are NOT real media; importing them creates phantom "clips" that
              // fail to probe and confuse the agent.
              if (e.name.startsWith("._") || e.name.startsWith(".")) continue;
              const full = path.join(dir, e.name);
              if (e.isDirectory() && depth > 0) await walk(full, depth - 1);
              else if (e.isFile() && MEDIA_RE.test(e.name)) files.push(full);
            }
          };
          await walk(root, 3); // up to 3 levels deep
        }
        if (files.length === 0) fail("--files or --folder (with media inside) required");
        await ensureWorkspace(ws);
        const added: { name: string; rel: string; type: string }[] = [];
        const errors: string[] = [];
        let bytesLinked = 0; // bytes that would have been copied but weren't
        for (const f of files) {
          try {
            const base = path.basename(f);
            // Skip macOS AppleDouble / dotfiles — they aren't real media.
            if (base.startsWith("._") || base.startsWith(".")) continue;
            const stat = await fs.stat(f);
            if (!stat.isFile()) { errors.push(`${f}: not a file`); continue; }
            const type = base.match(/\.(mp4|mov|mkv|webm|avi|m4v)$/i) ? "video"
              : base.match(/\.(mp3|wav|aac|flac|m4a)$/i) ? "audio"
              : base.match(/\.(png|jpg|jpeg|gif|webp|bmp|tiff)$/i) ? "images"
              : DOC_RE.test(base) ? "documents" : "video";
            const destDir = path.join(workspaceDir(ws), "source", type);
            await fs.mkdir(destDir, { recursive: true });
            const dest = path.join(destDir, base);
            try { await fs.unlink(dest); } catch { /* ok if absent */ }
            // SYMLINK ONLY — never copy. We do not fall back to copyFile under any
            // circumstance; a failed symlink is reported as an error, never worked
            // around by duplicating the (potentially multi-GB) media.
            await fs.symlink(path.resolve(f), dest);
            // Verify it really is a symlink, not an accidental copy.
            const ls = await fs.lstat(dest);
            if (!ls.isSymbolicLink()) {
              await fs.rm(dest, { force: true });
              errors.push(`${f}: refused — link did not materialize as a symlink (no copy made)`);
              continue;
            }
            bytesLinked += stat.size;
            // Binary documents (rtf/doc/docx/pdf) aren't plain text, so the agent
            // can't Read them directly. Extract a plain-text sidecar (<name>.txt)
            // next to the symlink at add time using built-in tools, so a clean
            // transcript of the brief/script is always available regardless of the
            // agent's parsing ability. .md/.markdown/.txt are already text — no-op.
            if (/\.(rtf|doc|docx|pdf)$/i.test(base)) {
              try {
                const txt = await extractDocText(path.resolve(f));
                if (txt != null) await fs.writeFile(dest + ".txt", txt, "utf8");
                else errors.push(`${base}: linked, but couldn't extract text (no extractor available) — agent may not be able to read it`);
              } catch (e) {
                errors.push(`${base}: linked, but text extraction failed (${(e as Error).message})`);
              }
            }
            added.push({ name: base, rel: path.join("source", type, base), type });
          } catch (e) {
            errors.push(`${f}: ${(e as Error).message}`);
          }
        }
        emit({
          ok: true, added, errors,
          storage: {
            mode: "symlink-only",
            bytes_linked_not_copied: bytesLinked,
            note: "Originals are referenced in place. No video data was duplicated.",
          },
        });
        break;
      }

      case "media-frames": {
        // Extract representative frames from a clip so the agent can SEE what it
        // is. Returns frame paths to Read. --workspace W --source <path> [--count 2]
        // Count is capped at 3 — each 4K frame the agent Reads is a heavy vision
        // token cost, and reading frames from many clips bloats context and slows
        // every later turn (the "stuck after sampling lots of footage" problem).
        const ws = a.workspace || fail("--workspace required");
        const source = a.source || fail("--source required");
        const count = Math.min(3, Math.max(1, Number(a.count) || 2));
        const { frames, durationSeconds, width, height, orientation } = await extractFrames(ws, source, count);
        emit({
          ok: true, source, duration_seconds: Number(durationSeconds.toFixed(2)),
          dimensions: width && height ? `${width}x${height}` : "unknown",
          orientation, // TRUST THIS, not the frame's appearance
          frames,
        });
        break;
      }

      case "media-frames-batch": {
        // Extract ONE representative frame from MANY clips in a single call — so the
        // agent surveys footage in one tool round-trip instead of N (each round-trip
        // costs a slow 60-90s model turn). --workspace W --sources a,b,c [--count 1].
        // Caps total clips to keep vision-token load (and SD-card reads) bounded.
        const ws = a.workspace || fail("--workspace required");
        const list = String(a.sources || fail("--sources required (comma-separated)"))
          .split(",").map((s: string) => s.trim()).filter(Boolean);
        const MAX_CLIPS = 12; // hard cap — survey a spread, don't read the whole shoot
        const sources = list.slice(0, MAX_CLIPS);
        const per = Math.min(2, Math.max(1, Number(a.count) || 1));
        // Bounded concurrency so the SD card isn't thrashed by N parallel ffmpegs.
        const out: any[] = [];
        const CONC = 3; let i = 0;
        async function w() {
          while (i < sources.length) {
            const src = sources[i++];
            try {
              const { frames, durationSeconds, width, height, orientation } = await extractFrames(ws, src, per);
              out.push({
                source: src, duration_seconds: Number(durationSeconds.toFixed(2)),
                dimensions: width && height ? `${width}x${height}` : "unknown",
                orientation, frames,
              });
            } catch (e) { out.push({ source: src, error: (e as Error).message }); }
          }
        }
        await Promise.all(Array.from({ length: CONC }, w));
        emit({
          ok: true, clips: out,
          ...(list.length > MAX_CLIPS ? { note: `Surveyed ${MAX_CLIPS} of ${list.length} — sample a spread, not all.` } : {}),
        });
        break;
      }

      case "content-set": {
        // The agent records what a clip IS after viewing its frames.
        // --workspace W --source <path> --description "..." [--shot-type] [--subjects a,b]
        const ws = a.workspace || fail("--workspace required");
        await saveContent(ws, {
          source: a.source || fail("--source required"),
          description: a.description || fail("--description required"),
          shot_type: a["shot-type"] || undefined,
          subjects: a.subjects ? String(a.subjects).split(",").map((s: string) => s.trim()) : undefined,
          updated: Date.now(),
        });
        emit({ ok: true, source: a.source });
        break;
      }

      case "content-list": {
        // Read cached clip descriptions ("what each clip is"). Lean output.
        const ws = a.workspace || fail("--workspace required");
        const all = await loadContent(ws);
        const entries = Object.values(all).map((c: ClipContent) =>
          `${c.source.split("/").pop()}: ${c.description}${c.shot_type ? ` [${c.shot_type}]` : ""}`);
        emit({ ok: true, count: entries.length, content: entries });
        break;
      }

      case "sources-list": {
        // List all symlinked source media in the workspace. Each entry also
        // reports the ORIGINAL folder it was imported from (resolved via the
        // symlink target) so the GUI can show a Premiere-style folder bin view.
        const ws = a.workspace || fail("--workspace required");
        const root = path.join(workspaceDir(ws), "source");
        const out: { name: string; rel: string; type: string; origDir: string | null; origPath: string | null; online: boolean }[] = [];
        for (const type of ["video", "audio", "images", "documents"]) {
          const dir = path.join(root, type);
          try {
            const names = await fs.readdir(dir);
            // Sidecar set: an extracted-text "<doc>.txt" that sits beside a binary
            // document symlink of the same stem is an implementation detail — don't
            // list it as its own source. A standalone user .txt has no such sibling
            // and is kept. Built up-front so listing order doesn't matter.
            const sidecars = new Set(
              names.filter((f) => f.endsWith(".txt") &&
                names.some((g) => g !== f && g + ".txt" === f)),
            );
            for (const f of names) {
              // Skip macOS AppleDouble metadata (._name) and dotfiles — they're not
              // real media; listing them makes the agent pick phantom "clips" that
              // fail to probe (the "._ prefix" confusion).
              if (f.startsWith("._") || f.startsWith(".")) continue;
              if (sidecars.has(f)) continue;
              const symlinkPath = path.join(dir, f);
              let origPath: string | null = null;
              try { origPath = await fs.readlink(symlinkPath); } catch { /* not a symlink */ }
              let online = false;
              if (origPath) {
                try { await fs.stat(symlinkPath); online = true; } catch { /* broken link = offline */ }
              }
              out.push({
                name: f,
                rel: path.join("source", type, f),
                type,
                origPath,
                origDir: origPath ? path.dirname(origPath) : null,
                online,
              });
            }
          } catch { /* dir may not exist */ }
        }
        // --full returns the rich per-clip view (orig paths/folders) for the GUI's
        // bin display. DEFAULT is TOKEN-LEAN: names grouped by type + counts, so a
        // 162-clip shoot is ~2KB not ~56KB (huge — it re-enters context each turn
        // and was a major cause of slow/stalling model turns).
        if (a.full) { emit({ ok: true, sources: out }); break; }
        const byType: Record<string, string[]> = {};
        for (const s of out) (byType[s.type] ||= []).push(s.name);
        emit({
          ok: true,
          counts: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, v.length])),
          total: out.length,
          video: byType.video || [],
          audio: byType.audio || [],
          images: byType.images || [],
          // Scripts / briefs / shot lists the user attached. Read them (with the
          // Read tool, by their source/documents/... path) before drafting — they
          // tell you intent the footage alone can't. Binary docs have a sibling
          // "<name>.txt" extraction next to them; read that if the original won't.
          documents: byType.documents || [],
        });
        break;
      }

      case "source-localize": {
        // Copy source footage from slow media (SD card / external drive) onto the
        // internal drive, replacing the symlink with a real local copy. Makes every
        // later probe/frame/render dramatically faster. --workspace W [--rel paths…]
        // (default: all video sources). Skips ones already local. Reports bytes copied.
        const ws = a.workspace || fail("--workspace required");
        const srcRoot = path.join(workspaceDir(ws), "source");
        // Determine the set of symlinks to localize.
        const targets: string[] = [];
        if (a.rel) {
          const rels = Array.isArray(a.rel) ? a.rel : [a.rel];
          targets.push(...rels.map((r) => path.join(workspaceDir(ws), r)));
        } else {
          for (const type of ["video", "audio", "images", "documents"]) {
            const dir = path.join(srcRoot, type);
            try { for (const f of await fs.readdir(dir)) targets.push(path.join(dir, f)); } catch { /* */ }
          }
        }
        const localized: string[] = [];
        const skipped: string[] = [];
        const errors: string[] = [];
        let bytes = 0;
        for (const link of targets) {
          try {
            const st = await fs.lstat(link);
            if (!st.isSymbolicLink()) { skipped.push(path.basename(link) + " (already local)"); continue; }
            const origin = await fs.readlink(link);
            const realOrigin = path.isAbsolute(origin) ? origin : path.resolve(path.dirname(link), origin);
            const size = (await fs.stat(realOrigin)).size;
            const tmp = link + ".localizing";
            await fs.copyFile(realOrigin, tmp); // copy beside the link
            await fs.unlink(link);              // remove the symlink
            await fs.rename(tmp, link);         // put the real file in its place
            bytes += size; localized.push(path.basename(link));
          } catch (e) {
            errors.push(`${path.basename(link)}: ${(e as Error).message}`);
          }
        }
        emit({
          ok: true, localized_count: localized.length, skipped_count: skipped.length,
          gb_copied: Number((bytes / 1e9).toFixed(2)), errors,
          note: "Footage copied to the internal drive — edits will be much faster now.",
        });
        break;
      }

      case "source-remove": {
        // Remove one or more sources from the workspace queue. Only the symlink
        // is deleted — the user's original media is NEVER touched. --rel <paths…>
        // are workspace-relative (e.g. "source/video/clip.mp4"), as returned by
        // sources-list.
        const ws = a.workspace || fail("--workspace required");
        const rels: string[] = Array.isArray(a.rel) ? a.rel : (a.rel ? [a.rel] : []);
        if (!rels.length) fail("--rel <workspace-relative path(s)> required");
        const removed: string[] = [];
        const errors: string[] = [];
        const base = workspaceDir(ws);
        for (const rel of rels) {
          // Guard against path traversal: the resolved target must stay under
          // this workspace's source/ directory.
          const target = path.resolve(base, rel);
          const srcRoot = path.join(base, "source");
          if (!target.startsWith(srcRoot + path.sep)) { errors.push(`${rel}: outside source/`); continue; }
          try {
            const ls = await fs.lstat(target);
            if (!ls.isSymbolicLink()) { errors.push(`${rel}: not a managed symlink — refusing to delete`); continue; }
            await fs.rm(target, { force: true });
            removed.push(rel);
          } catch (e) { errors.push(`${rel}: ${(e as Error).message}`); }
        }
        emit({ ok: true, removed, errors, note: "Symlinks removed. Original media untouched." });
        break;
      }

      case "source-relink": {
        // Relink an offline source to a new file path. Replaces the broken
        // symlink with a new one pointing at the user-selected file.
        // --workspace W --rel <workspace-relative path> --new-path <absolute path>
        const ws = a.workspace || fail("--workspace required");
        const rel: string = a.rel || fail("--rel required");
        const newPath: string = a["new-path"] || fail("--new-path required");
        const base = workspaceDir(ws);
        const target = path.resolve(base, rel);
        const srcRoot = path.join(base, "source");
        if (!target.startsWith(srcRoot + path.sep)) fail("--rel is outside source/");
        // Verify the new path exists.
        try { await fs.stat(newPath); } catch { fail(`New path not found: ${newPath}`); }
        // Replace symlink atomically: remove old, create new.
        const ls = await fs.lstat(target);
        if (!ls.isSymbolicLink()) fail(`${rel}: not a managed symlink`);
        await fs.rm(target, { force: true });
        await fs.symlink(path.resolve(newPath), target);

        // HEAL THE SEQUENCES. Clips added while this source was offline have
        // frozen placeholder metadata (source_width/height/fps = undefined,
        // a fabricated source_duration). Relinking the symlink alone leaves the
        // timeline broken — reframe skips undefined-dim clips and render scaling
        // is wrong. So we re-probe the now-online file and patch every clip that
        // references this source across all sequences in the workspace.
        let healedClips = 0;
        const healedSequences: string[] = [];
        try {
          const probe = await probeMedia(path.resolve(newPath));
          const seqs = await listSequences(ws);
          for (const seq of seqs) {
            let touched = false;
            for (const c of seq.clips) {
              // Match by the workspace-relative source path the clip stored.
              const clipAbs = path.isAbsolute(c.source_path)
                ? c.source_path
                : path.resolve(base, c.source_path);
              if (clipAbs !== target) continue;
              if (c.source_width == null && probe.width != null) { c.source_width = probe.width; touched = true; }
              if (c.source_height == null && probe.height != null) { c.source_height = probe.height; touched = true; }
              if (c.source_fps == null && probe.fps != null) { c.source_fps = probe.fps; touched = true; }
              if (probe.duration != null) { c.source_duration = probe.duration; touched = true; }
              if (touched) healedClips++;
            }
            if (touched) { await saveSequence(ws, seq); healedSequences.push(seq.id); }
          }
        } catch { /* file still unreadable — symlink swapped, metadata heals on next probe */ }

        emit({
          ok: true, rel, newPath,
          healed_clips: healedClips,
          healed_sequences: healedSequences,
          note: healedClips > 0
            ? `Source relinked and ${healedClips} clip(s) across ${healedSequences.length} sequence(s) re-probed.`
            : "Source relinked.",
        });
        break;
      }

      case "source-clear": {
        // Clear the entire source queue (remove every symlink under source/).
        // Originals are untouched.
        const ws = a.workspace || fail("--workspace required");
        const root = path.join(workspaceDir(ws), "source");
        let removed = 0;
        for (const type of ["video", "audio", "images"]) {
          const dir = path.join(root, type);
          try {
            for (const f of await fs.readdir(dir)) {
              const p = path.join(dir, f);
              try {
                const ls = await fs.lstat(p);
                if (ls.isSymbolicLink()) { await fs.rm(p, { force: true }); removed++; }
              } catch { /* skip */ }
            }
          } catch { /* dir may not exist */ }
        }
        emit({ ok: true, removed, note: "Source queue cleared. Original media untouched." });
        break;
      }

      case "memory-read": {
        // Read the workspace's persistent MEMORY.md (critical findings the agent
        // has accumulated). Cheap to call at the start of every session so the
        // agent never re-derives footage facts, style, or decisions.
        const ws = a.workspace || fail("--workspace required");
        const mp = path.join(workspaceDir(ws), "MEMORY.md");
        try {
          emit({ ok: true, memory: await fs.readFile(mp, "utf8"), path: mp });
        } catch {
          emit({ ok: true, memory: "", path: mp, note: "No memory yet — append findings as you learn them." });
        }
        break;
      }

      case "memory-append": {
        // Append one critical finding as a dated bullet. Keep entries terse —
        // facts and decisions, not narration. This file is the agent's long-term
        // memory that survives across sessions and context windows.
        const ws = a.workspace || fail("--workspace required");
        const note = a.note || fail('--note "..." required');
        const section = a.section || "Findings";
        const mp = path.join(workspaceDir(ws), "MEMORY.md");
        await ensureWorkspace(ws);
        let existing = "";
        try { existing = await fs.readFile(mp, "utf8"); } catch { existing = `# JCut.AI Memory\n`; }
        // Append under a section header, creating it if absent.
        const bullet = `- ${note}`;
        if (existing.includes(`## ${section}`)) {
          existing = existing.replace(`## ${section}\n`, `## ${section}\n${bullet}\n`);
        } else {
          existing += `\n## ${section}\n${bullet}\n`;
        }
        await fs.writeFile(mp, existing);
        emit({ ok: true, appended: bullet, section, path: mp });
        break;
      }

      case "criteria-get": {
        // Read the workspace's editing criteria — the user's opt-in/out choices
        // for optional analysis (beat/transcription/content) plus creative
        // constraints. The agent reads this FIRST and respects it: it does NOT
        // run beat analysis on a project the user marked beat_analysis:off, and
        // does NOT skip it when marked on.
        const ws = a.workspace || fail("--workspace required");
        const c = await loadCriteria(ws);
        emit({ ok: true, criteria: c, summary: summarizeCriteria(c) });
        break;
      }

      case "criteria-set": {
        // Set one or more criteria. Flags map 1:1 to fields:
        //   --beat-analysis on|off|auto   --transcription on|off|auto
        //   --content-analysis on|off|auto
        //   --target-platform tiktok   --target-duration 30
        //   --captions-wanted true|false   --music-driven true|false
        //   --notes "..."
        const ws = a.workspace || fail("--workspace required");
        const patch: Partial<Criteria> = {};
        const tog = (v: any): Toggle | undefined =>
          v === "on" || v === "off" || v === "auto" ? v : undefined;
        const bool = (v: any): boolean | undefined =>
          v === "true" ? true : v === "false" ? false : undefined;
        if (a["beat-analysis"] != null) {
          const t = tog(a["beat-analysis"]); if (!t) fail("--beat-analysis must be on|off|auto");
          patch.beat_analysis = t;
        }
        if (a["transcription"] != null) {
          const t = tog(a["transcription"]); if (!t) fail("--transcription must be on|off|auto");
          patch.transcription = t;
        }
        if (a["content-analysis"] != null) {
          const t = tog(a["content-analysis"]); if (!t) fail("--content-analysis must be on|off|auto");
          patch.content_analysis = t;
        }
        if (a["target-platform"] != null) patch.target_platform = String(a["target-platform"]);
        if (a["target-duration"] != null) patch.target_duration_seconds = Number(a["target-duration"]);
        if (a["captions-wanted"] != null) {
          if (a["captions-wanted"] === "auto") patch.captions_wanted = undefined;
          else patch.captions_wanted = bool(a["captions-wanted"]);
        }
        if (a["music-driven"] != null) {
          if (a["music-driven"] === "auto") patch.music_driven = undefined;
          else patch.music_driven = bool(a["music-driven"]);
        }
        if (a["notes"] != null) patch.notes = String(a["notes"]);
        if (Object.keys(patch).length === 0) fail("No criteria flags provided.");
        const c = await saveCriteria(ws, patch);
        emit({ ok: true, criteria: c, summary: summarizeCriteria(c), note: "Criteria updated." });
        break;
      }

      case "transcript-import": {
        // Import a transcript/captions the user exported from Premiere (or any
        // tool) as .srt/.vtt/.txt. JCut does NOT transcribe — this gives the agent
        // word/line timing for speech-driven editing without an STT engine.
        //   --workspace W --file <path.srt> [--name <label>]
        const ws = a.workspace || fail("--workspace required");
        const file = a.file || fail("--file <path.srt|.vtt|.txt> required");
        await ensureWorkspace(ws);
        const t = await parseTranscriptFile(file);
        t.imported_at = Date.now();
        const name = (a.name as string) || path.basename(file);
        const saved = await saveTranscript(ws, name, t);
        emit({
          ok: true,
          name: name.replace(/\.[^.]+$/, ""),
          format: t.format,
          cue_count: t.cues.length,
          duration_seconds: t.cues.length ? Math.round(t.cues[t.cues.length - 1].end_seconds * 100) / 100 : 0,
          speakers: [...new Set(t.cues.map((c) => c.speaker).filter(Boolean))],
          saved_to: saved,
          preview: t.cues.slice(0, 3).map((c) => ({ start: c.start_seconds, end: c.end_seconds, text: c.text, speaker: c.speaker })),
          note: t.format === "txt"
            ? "Imported plain text (no timing). For word-level cut timing, export an .srt from Premiere's Text panel."
            : "Transcript imported. Use transcript-search to find lines and their exact timecodes for cutting.",
        });
        break;
      }

      case "transcript-list": {
        const ws = a.workspace || fail("--workspace required");
        emit({ ok: true, transcripts: await listTranscripts(ws) });
        break;
      }

      case "transcript-get": {
        // Return cues (optionally a time window). Large transcripts: prefer
        // transcript-search over dumping everything.
        const ws = a.workspace || fail("--workspace required");
        const name = a.name || fail("--name required (from transcript-list)");
        const t = await loadTranscript(ws, name);
        let cues = t.cues;
        const from = a.from != null ? Number(a.from) : null;
        const to = a.to != null ? Number(a.to) : null;
        if (from != null) cues = cues.filter((c) => c.end_seconds >= from);
        if (to != null) cues = cues.filter((c) => c.start_seconds <= to);
        emit({ ok: true, name, format: t.format, cue_count: cues.length, cues });
        break;
      }

      case "transcript-search": {
        // Find lines containing a phrase → exact timecodes to cut on. This is the
        // bridge from "what was said" to "where to cut" for speech-driven editing.
        const ws = a.workspace || fail("--workspace required");
        const name = a.name || fail("--name required (from transcript-list)");
        const query = a.query || fail('--query "phrase" required');
        const t = await loadTranscript(ws, name);
        const matches = searchCues(t, query);
        emit({
          ok: true, name, query, match_count: matches.length,
          matches: matches.map((c) => ({ start: c.start_seconds, end: c.end_seconds, text: c.text, speaker: c.speaker })),
        });
        break;
      }

      case "modes-list": {
        // Built-in editing modes + user presets, for the agent and the UI.
        const presets = await loadPresets();
        emit({ ok: true, modes: BUILTIN_MODES.map(({ id, name, description }) => ({ id, name, description })),
               presets: presets.map(({ id, name, description }) => ({ id, name, description })) });
        break;
      }

      case "mode-get": {
        // Resolve a mode/preset id to its instruction block (agent applies it).
        const id = a.id || fail("--id required");
        const r = await resolveInstructions(id);
        if (!r) fail(`No mode or preset "${id}".`);
        emit({ ok: true, ...r });
        break;
      }

      case "preset-save": {
        // Create/update a user preset. --id --name --instructions [--base-mode] [--description]
        const id = a.id || fail("--id required");
        const all = await savePreset({
          id, name: a.name || id,
          description: a.description || "",
          instructions: a.instructions || fail("--instructions required"),
          base_mode: a["base-mode"] || undefined,
        });
        emit({ ok: true, saved: id, total: all.length });
        break;
      }

      case "preset-delete": {
        const id = a.id || fail("--id required");
        await deletePreset(id);
        emit({ ok: true, deleted: id });
        break;
      }

      case "analyze-music": {
        // Build a musical map (BPM, beats, energy sections) from an audio/video
        // file so the agent can pace cuts to the music. --file <path>.
        // ALWAYS returns the FULL beat grid — it's only a few hundred numbers
        // (~2KB), and withholding it made the agent loop, re-calling this tool
        // over and over trying to get "exact beat positions" it never received.
        // The `complete: true` flag tells the agent it has everything it needs.
        const ws = a.workspace || "default";
        const fileRaw = a.file || fail(
          "--file <path> required. " +
          "First run sources-list --workspace " + ws + " to find available audio/video files, " +
          "then pass the exact path here, e.g. --file source/audio/song.mp3"
        );
        const file = await resolveWorkspaceMediaPath(ws, fileRaw);
        const map = await analyzeMusic(file);
        emit({
          ok: true,
          complete: true, // you have the full beat map — do NOT call this again for this file
          bpm: map.bpm,
          confidence: map.confidence,
          duration_seconds: map.duration_seconds,
          analyzed_seconds: map.analyzed_seconds,
          audioflux_used: !!map.audioflux_used,
          // Beats past analyzed_seconds are extrapolated at the detected tempo
          // (tempo is stable in virtually all music). Detected beats up to
          // analyzed_seconds are measured; beyond that they're projected.
          beats_extrapolated: map.beats_extrapolated,
          beat_count: map.beat_count,
          sections: map.sections, // energy sections only cover analyzed_seconds
          downbeats_seconds: map.downbeats_seconds,
          beats_seconds: map.beats_seconds, // full grid across duration_seconds
        });
        break;
      }

      case "analyze-video": {
        // Run local visual analysis on a source clip: shot composition + motion curve.
        // Useful before choosing trims because it surfaces the settle point and action peaks.
        const ws = a.workspace || "default";
        const fileRaw = a.file || fail(
          "--file <path> required. " +
          "First run sources-list --workspace " + ws + " to find available video files, " +
          "then pass the exact path here, e.g. --file source/video/clip.mp4"
        );
        const file = await resolveWorkspaceMediaPath(ws, fileRaw);
        const analysis = await analyzeVideo(file);
        emit({
          ok: true,
          complete: true,
          file: fileRaw,
          shot_type: analysis.composition.shot_type,
          shot_confidence: analysis.composition.confidence,
          center_focus_ratio: analysis.composition.center_focus_ratio,
          overall_edge_density: analysis.composition.overall_edge_density,
          frame_analyses: analysis.composition.frame_analyses || [],
          model_used: !!analysis.composition.model_used,
          model_error: analysis.composition.model_error,
          camera_settle_seconds: analysis.motion.camera_settle_seconds,
          motion_peaks_seconds: analysis.motion.motion_peaks_seconds,
          motion_curve: analysis.motion.motion_curve || [],
          motion_method: analysis.motion.motion_method,
          opencv_used: analysis.composition.opencv_used || analysis.motion.opencv_used || false,
          note: analysis.motion.note,
        });
        break;
      }

      case "sequence-analyze": {
        // Analyze ONE sequence's editorial structure (pacing, shots, B-roll, sections).
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        emit({ ok: true, style: analyzeSequence(seq) });
        break;
      }

      case "style-learn": {
        // Aggregate every sequence in the workspace (or an explicit --sequence-ids
        // list) into a saved style profile: "how these videos usually go."
        const ws = a.workspace || fail("--workspace required");
        let seqs = await listSequences(ws);
        if (a.ids) seqs = seqs.filter((s) => (a.ids as string[]).includes(s.id));
        if (seqs.length === 0) fail("No sequences found to learn from.");
        const styles = seqs.map(analyzeSequence);
        const profile = buildStyleProfile(styles);
        // NAMED styles: pass --name "client A" to learn multiple distinct styles in
        // one thread without clobbering each other. Each gets its own MEMORY block
        // and its own profile file. Default name "default".
        const styleName = (a.name as string) || "default";
        const slug = styleName.toLowerCase().replace(/[^a-z0-9]+/g, "_");
        const out = path.join(workspaceDir(ws), "analysis", `style_${slug}.json`);
        await fs.mkdir(path.dirname(out), { recursive: true });
        await fs.writeFile(out, JSON.stringify({ name: styleName, profile, per_sequence: styles }, null, 2));
        const heading = `Learned Style: ${styleName}`;
        const memory = await upsertMemorySection(ws, heading, [
          `Learned from ${styles.length} sequence(s).`,
          ...profile.notes.map((n) => `- ${n}`),
          `- Targets: ~${profile.typical_cuts_per_minute} cuts/min, ` +
            `~${profile.typical_shot_seconds}s typical shot ` +
            `(${profile.fast_cut_seconds}s fast / ${profile.long_take_seconds}s long), ` +
            `${Math.round(profile.typical_broll_overlay_ratio * 100)}% B-roll overlay.`,
        ]);
        emit({ ok: true, name: styleName, profile, learned_from: styles.map((s) => s.name), saved_to: out, memory });
        break;
      }

      case "sequence-export-premiere": {
        // Write a JCut sequence to a native .prproj that opens in Premiere.
        //   --sequence-id ID [--output /abs/path.prproj]
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));

        let out = a.output;
        if (!out && process.platform === "darwin") {
          try {
            const { execSync } = await import("node:child_process");
            const defaultName = `${(seq.name || seq.id).replace(/[^\w.-]/g, "_")}.prproj`;
            const cmd = `osascript -e 'POSIX path of (choose file name with prompt "Save Premiere Pro project:" default name "${defaultName}")'`;
            const chosen = execSync(cmd, { encoding: "utf8" }).trim();
            if (chosen) out = chosen;
          } catch { /* user cancelled or AppleScript failed — use default below */ }
        }
        if (!out) {
          out = path.join(workspaceDir(ws), "renders", `${(seq.name || seq.id).replace(/[^\w.-]/g, "_")}.prproj`);
        }
        const res = await exportPrproj(seq, out, workspaceDir(ws));
        emit({
          ok: true,
          output: res.output,
          sequences: res.sequences,
          clips: res.clips,
          warnings: res.warnings,
          note: "Exported. Open in Premiere with File > Open Project.",
        });
        break;
      }

      case "sequence-import-prproj": {
        // Import an existing Premiere timeline as an EDITABLE JCut sequence the
        // agent can modify and continue. --file <path.prproj> [--name N].
        // Symlinks referenced media into the workspace (never copies), then
        // builds a sequence from the clip timing.
        const ws = a.workspace || fail("--workspace required");
        const file = a.file || fail("--file <path.prproj> required");
        await ensureWorkspace(ws);
        const { clips, settings: detected } = await importPrprojClips(file);
        if (clips.length === 0) fail("No editable clips found in that project.");
        // Use the REAL sequence resolution + framerate detected from the project
        // (e.g. vertical 4K 2160×3840), not a hardcoded guess.
        const seq: Sequence = {
          id: newSeqId(),
          name: a.name || (file.split("/").pop()?.replace(/\.prproj$/i, "") || "Imported Timeline"),
          description: `Imported from ${file}`,
          settings: {
            width: detected.width, height: detected.height, framerate: detected.framerate,
            sample_rate: 48000, color_space: "bt709",
          },
          clips: [],
        };
        await saveSequence(ws, seq);
        // Symlink each unique existing source into the workspace, then add clips
        // that point at the symlinked path. Sources that no longer exist on disk
        // are kept by absolute path and flagged.
        const unresolved: string[] = [];
        const ops = [] as any[];
        const seen = new Map<string, string>();
        for (const c of clips) {
          let src = c.source;
          if (src && src !== "(unknown source)") {
            if (!seen.has(src)) {
              try {
                await fs.stat(src);
                const base = path.basename(src);
                const sub = c.track.startsWith("A") ? "audio" : "video";
                const destDir = path.join(workspaceDir(ws), "source", sub);
                await fs.mkdir(destDir, { recursive: true });
                const dest = path.join(destDir, base);
                try { await fs.unlink(dest); } catch { /* ok */ }
                await fs.symlink(path.resolve(src), dest);
                seen.set(src, path.join("source", sub, base));
              } catch {
                unresolved.push(src);
                seen.set(src, src); // keep absolute; agent can relink
              }
            }
            src = seen.get(src)!;
          }
          ops.push({ track: c.track, source: src, position_seconds: c.position_seconds,
                     trim_start_seconds: c.trim_start_seconds, trim_end_seconds: c.trim_end_seconds });
        }
        // Add clips one at a time so a single bad file doesn't abort all.
        // allowOffline=true keeps clips whose media is on an unplugged drive
        // (common when importing — the source footage lives on external storage).
        let added = 0;
        for (const op of ops) {
          try { await addClips(ws, seq, [op], true); added++; } catch { /* skip truly invalid */ }
        }
        await saveSequence(ws, seq);
        emit({
          ok: true, sequence_id: seq.id, name: seq.name,
          resolution: `${detected.width}x${detected.height}@${detected.framerate}`,
          imported_clips: added, total_found: clips.length,
          unresolved_sources: [...new Set(unresolved)].slice(0, 20),
          note: "Imported as an editable sequence. Open it and tell JCut to finish or continue it.",
        });
        break;
      }

      case "prproj-analyze": {
        // Import a Premiere Pro project and learn its editorial style.
        const ws = a.workspace || fail("--workspace required");
        const file = a.file || fail("--file <path.prproj> required");
        await ensureWorkspace(ws);
        const name = (a.name as string) || file.split("/").pop()?.replace(/\.prproj$/, "") || "Imported Project";
        const { style, profile, clipCount } = await analyzePrproj(file, name);
        const memory = await upsertMemorySection(ws, `Premiere Project Analysis: ${name}`, [
          `- Analyzed ${clipCount} clip(s) from "${name}".`,
          ...profile.notes.map((n) => `- ${n}`),
        ]);
        emit({
          ok: true,
          summary: `Imported "${name}" — ${clipCount} clips analyzed.`,
          style, profile,
          memory,
        });
        break;
      }

      case "sequence-reframe": {
        // Clone an existing sequence into a different orientation, recomputing the
        // fill transform of every video clip so subjects stay framed. Timing,
        // trims, speed, audio — identical. The source sequence is untouched.
        //   --sequence-id ID --orientation vertical|horizontal|square
        //   [--name NAME] [--subjects '{"clipId":{"x":0.5,"y":0.4}}']
        const ws = a.workspace || fail("--workspace required");
        const src = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const orient = (a.orientation || fail("--orientation required")) as Orientation;
        if (!["vertical", "horizontal", "square"].includes(orient)) {
          fail("--orientation must be vertical, horizontal, or square");
        }
        const canvas = orientationCanvas(orient);
        let subjects: Record<string, { x: number; y: number }> = {};
        if (a.subjects) { try { subjects = JSON.parse(a.subjects); } catch { /* ignore */ } }

        // Remap link ids so the clone's V/A pairs stay linked independently.
        const linkRemap = new Map<string, string>();
        const clone: Sequence = {
          id: newSeqId(),
          name: a.name || `${src.name} (${orient})`,
          description: `Reframed from "${src.name}" → ${orient}`,
          settings: { ...src.settings, width: canvas.width, height: canvas.height },
          clips: src.clips.map((c) => {
            const copy: Sequence["clips"][number] = { ...c, id: newClipId() };
            if (copy.link_id) {
              if (!linkRemap.has(copy.link_id)) linkRemap.set(copy.link_id, newClipId("lnk"));
              copy.link_id = linkRemap.get(copy.link_id)!;
            }
            if (isVideoTrack(c.track) && c.source_width && c.source_height && copy.transform) {
              const subj = subjects[c.id] || { x: 0.5, y: 0.5 };
              const f = fillTransform(c.source_width, c.source_height, canvas.width, canvas.height, subj.x, subj.y);
              copy.transform = { ...copy.transform, scale: { x: f.scale, y: f.scale }, position: f.position };
            }
            return copy;
          }),
        };
        const p = await saveSequence(ws, clone);
        emit({
          ok: true,
          sequence_id: clone.id,
          name: clone.name,
          orientation: orient,
          settings: `${canvas.width}x${canvas.height}`,
          reframed_clips: clone.clips.filter((c) => isVideoTrack(c.track)).length,
          path: p,
          note: "Reframed with fill (cover) + centered crop. Pass --subjects to bias framing per clip.",
        });
        break;
      }

      case "kb-list": {
        // List the professional-editor knowledge base docs (titles + when to read).
        const dir = kbDir();
        const docs: { id: string; title: string; read_when: string }[] = [];
        try {
          for (const f of (await fs.readdir(dir)).sort()) {
            if (!f.endsWith(".md")) continue;
            const id = f.replace(/\.md$/, "");
            docs.push({ id, title: KB_TITLES[id]?.title || id, read_when: KB_TITLES[id]?.when || "" });
          }
        } catch { /* dir missing */ }
        emit({ ok: true, docs });
        break;
      }

      case "kb-read": {
        // Read one knowledge-base doc by id (e.g. recap-videos). Token-efficient:
        // the agent loads only the doc relevant to the current project type.
        const id = (a.id || a.doc || fail(
          "--id <doc-id> required. " +
          "First run kb-list to see available docs, then pass the id here, " +
          "e.g. kb-read --id recap-videos"
        )).replace(/[^a-z0-9-]/gi, "");
        const p = path.join(kbDir(), `${id}.md`);
        try {
          emit({ ok: true, id, content: await fs.readFile(p, "utf8") });
        } catch {
          fail(`No knowledge-base doc "${id}". Run kb-list to see available docs.`);
        }
        break;
      }

      default:
        fail(
          `Unknown command "${cmd}". Commands: sequence-create, sequences-list, ` +
          `sequence-inspect, media-info, sequence-clips-add, sequence-clips-update, ` +
          `sequence-clips-remove, sequence-captions-add, sequence-captions-remove, ` +
          `sequence-captions-list, sequence-transitions-add, sequence-transitions-remove, ` +
          `sequence-transitions-list, sequence-markers-add, sequence-markers-remove, ` +
          `sequence-markers-list, sequence-export-premiere, sequence-import-prproj, ` +
          `prproj-analyze, sequence-reframe, sequence-analyze, style-learn, ` +
          `media-frames, media-frames-batch, content-set, content-list, ` +
          `source-add, sources-list, source-localize, source-remove, source-relink, ` +
          `source-clear, memory-read, memory-append, criteria-get, criteria-set, ` +
          `transcript-import, transcript-list, transcript-get, transcript-search, ` +
          `analyze-music, analyze-video, modes-list, mode-get, preset-save, preset-delete, ` +
          `kb-list, kb-read`,
        );
    }
  } catch (e) {
    fail((e as Error).message);
  }
}

main();
