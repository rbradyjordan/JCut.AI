#!/usr/bin/env node
// JCut.AI tools CLI — the "hands" the agent drives via the Bash tool.
// Every command prints JSON to stdout. Mirrors Wideframe's caltools shape.
//
//   jc sequence-create   --workspace W --name N --width 1080 --height 1920 --framerate 30
//   jc sequences-list     --workspace W
//   jc sequence-inspect   --workspace W --sequence-id ID
//   jc media-info         --files a.mp4 b.mov
//   jc sequence-clips-add --workspace W --sequence-id ID --operations '[...]'
//   jc sequence-clips-update --workspace W --sequence-id ID --operations '[...]'
//   jc sequence-clips-remove --workspace W --sequence-id ID --ids c1 c2
//   jc sequence-render-final  --workspace W --sequence-id ID [--output out.mp4]
//   jc sequence-render-frame  --workspace W --sequence-id ID --at 3.5 [--output f.png]
import {
  ensureWorkspace, saveSequence, loadSequence, listSequences, probeMedia,
} from "./store.js";
import { addClips, updateClips, removeClips } from "./ops.js";
import { renderSequence } from "./render.js";
import { analyzeSequence, buildStyleProfile } from "./analyze.js";
import { analyzePrproj, importPrprojClips } from "./prproj.js";
import { exportPremiere } from "./prproj-export.js";
import { analyzeMusic } from "./beats.js";
import { BUILTIN_MODES, loadPresets, savePreset, deletePreset, resolveInstructions } from "./presets.js";
import {
  Sequence, sequenceDuration, Orientation, orientationCanvas, orientationOf,
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
        out[key] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
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

// Knowledge base lives at <project>/kb. From dist/tools/cli.js that's ../../kb.
function kbDir(): string {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "kb");
}

// Titles + "read when" hints so kb-list guides the agent to the right doc.
const KB_TITLES: Record<string, { title: string; when: string }> = {
  "fundamentals": { title: "Editing Fundamentals", when: "Always — universal craft principles. Read first." },
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
        const files: string[] = a.files || fail("--files required");
        const results = [];
        for (const f of files) {
          try {
            results.push({ file: f, ...(await probeMedia(f)) });
          } catch (e) {
            results.push({ file: f, error: (e as Error).message });
          }
        }
        emit({ ok: true, media: results });
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
        await saveSequence(ws, seq);
        emit({ ok: true, ...res });
        break;
      }

      case "sequence-clips-remove": {
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const ids: string[] = a.ids || fail("--ids required");
        const res = removeClips(seq, ids, !!a["no-ripple"]);
        await saveSequence(ws, seq);
        emit({ ok: true, ...res });
        break;
      }

      case "sequence-render-final": {
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const { output } = await renderSequence(ws, seq, { output: a.output });
        emit({ ok: true, output });
        break;
      }

      case "sequence-render-frame": {
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const at = Number(a.at);
        if (Number.isNaN(at)) fail("--at <seconds> required");
        const { output } = await renderSequence(ws, seq, { output: a.output, frameAtSeconds: at });
        emit({ ok: true, output });
        break;
      }

      case "source-add": {
        // Symlink source media into the workspace (never copy — Wideframe rule).
        // --files <abs paths...> AND/OR --folder <dir> (recursively adds every
        // media file found in the folder). Returns workspace-relative paths.
        const ws = a.workspace || fail("--workspace required");
        const MEDIA_RE = /\.(mp4|mov|mkv|webm|avi|m4v|mp3|wav|aac|flac|m4a|png|jpg|jpeg|gif|webp|bmp|tiff)$/i;
        let files: string[] = Array.isArray(a.files) ? [...a.files] : [];
        if (a.folder) {
          // Walk the folder (one level deep + immediate subfolders) for media.
          const root = a.folder as string;
          const walk = async (dir: string, depth: number): Promise<void> => {
            let entries;
            try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
            for (const e of entries) {
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
            const stat = await fs.stat(f);
            if (!stat.isFile()) { errors.push(`${f}: not a file`); continue; }
            const base = path.basename(f);
            const type = base.match(/\.(mp4|mov|mkv|webm|avi|m4v)$/i) ? "video"
              : base.match(/\.(mp3|wav|aac|flac|m4a)$/i) ? "audio"
              : base.match(/\.(png|jpg|jpeg|gif|webp|bmp|tiff)$/i) ? "images" : "video";
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

      case "sources-list": {
        // List all symlinked source media in the workspace. Each entry also
        // reports the ORIGINAL folder it was imported from (resolved via the
        // symlink target) so the GUI can show a Premiere-style folder bin view.
        const ws = a.workspace || fail("--workspace required");
        const root = path.join(workspaceDir(ws), "source");
        const out: { name: string; rel: string; type: string; origDir: string | null; origPath: string | null }[] = [];
        for (const type of ["video", "audio", "images"]) {
          const dir = path.join(root, type);
          try {
            for (const f of await fs.readdir(dir)) {
              let origPath: string | null = null;
              try { origPath = await fs.readlink(path.join(dir, f)); } catch { /* not a symlink */ }
              out.push({
                name: f,
                rel: path.join("source", type, f),
                type,
                origPath,
                origDir: origPath ? path.dirname(origPath) : null,
              });
            }
          } catch { /* dir may not exist */ }
        }
        emit({ ok: true, sources: out });
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
        const file = a.file || fail("--file <path> required");
        const map = await analyzeMusic(file);
        // Trim beat list in the echo to keep output lean; full grid still returned.
        emit({
          ok: true,
          bpm: map.bpm,
          confidence: map.confidence,
          duration_seconds: map.duration_seconds,
          beat_count: map.beat_count,
          downbeats_seconds: map.downbeats_seconds,
          sections: map.sections,
          beats_seconds: map.beats_seconds,
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
        const mp = path.join(workspaceDir(ws), "MEMORY.md");
        let mem = "";
        try { mem = await fs.readFile(mp, "utf8"); } catch { mem = `# JCut.AI Memory\n`; }
        const heading = `## Learned Style: ${styleName}`;
        const styleBlock =
          `\n${heading} (from ${styles.length} sequence(s))\n` +
          profile.notes.map((n) => `- ${n}`).join("\n") +
          `\n- Targets: ~${profile.typical_cuts_per_minute} cuts/min, ` +
          `~${profile.typical_shot_seconds}s typical shot ` +
          `(${profile.fast_cut_seconds}s fast / ${profile.long_take_seconds}s long), ` +
          `${Math.round(profile.typical_broll_overlay_ratio * 100)}% B-roll overlay.\n`;
        // Replace ONLY the same-named block (so other named styles persist), and
        // migrate any legacy unnamed block.
        const sameNamed = new RegExp(`\\n## Learned Style: ${styleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?(?=\\n## |\\n*$)`);
        mem = mem.replace(sameNamed, "").replace(/\n## Learned Style \(from[\s\S]*?(?=\n## |\n*$)/, "");
        await fs.writeFile(mp, mem.trimEnd() + "\n" + styleBlock);
        emit({ ok: true, name: styleName, profile, learned_from: styles.map((s) => s.name), saved_to: out, memory: mp });
        break;
      }

      case "sequence-export-premiere": {
        // Write a JCut sequence to a native .prproj that opens in Premiere.
        // Uses Wideframe's caltools as the prproj engine when available (real,
        // version-matched, validated output); falls back to the built-in clean
        // writer otherwise. Never hand-patches existing XML.
        //   --sequence-id ID [--output /abs/path.prproj]
        const ws = a.workspace || fail("--workspace required");
        const seq = await loadSequence(ws, a["sequence-id"] || fail("--sequence-id required"));
        const out = a.output ||
          path.join(workspaceDir(ws), "renders", `${(seq.name || seq.id).replace(/[^\w.-]/g, "_")}.prproj`);
        const res = await exportPremiere(ws, seq, out);
        emit({
          ok: true,
          output: res.output,
          engine: res.engine,
          valid: res.valid,
          warnings: res.warnings,
          sequences: res.sequences,
          clips: res.clips,
          note: res.engine === "caltools"
            ? "Exported via the Premiere engine (validated). Open in Premiere with File > Open."
            : "Exported with the built-in writer (Wideframe not detected). Open in Premiere with File > Open.",
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
        const name = file.split("/").pop()?.replace(/\.prproj$/, "") || "Imported Project";
        const { style, profile, clipCount } = await analyzePrproj(file, name);
        // Persist learned style to MEMORY.md (same as style-learn).
        const mp = path.join(workspaceDir(ws), "MEMORY.md");
        let mem = "";
        try { mem = await fs.readFile(mp, "utf8"); } catch { mem = `# JCut.AI Memory\n`; }
        const block =
          `\n## Learned Style (from Premiere project "${name}")\n` +
          profile.notes.map((n) => `- ${n}`).join("\n") + "\n";
        mem = mem.replace(/\n## Learned Style[\s\S]*?(?=\n## |\n*$)/, "");
        await fs.writeFile(mp, mem.trimEnd() + "\n" + block);
        emit({
          ok: true,
          summary: `Imported "${name}" — ${clipCount} clips analyzed.`,
          style, profile,
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
        const id = (a.id || a.doc || fail("--id <doc-id> required")).replace(/[^a-z0-9-]/gi, "");
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
          `sequence-clips-remove, sequence-render-final, sequence-render-frame, ` +
          `sequence-analyze, style-learn, memory-read, memory-append, ` +
          `analyze-music, modes-list, mode-get, preset-save, preset-delete, ` +
          `source-add, sources-list, kb-list, kb-read`,
        );
    }
  } catch (e) {
    fail((e as Error).message);
  }
}

main();
