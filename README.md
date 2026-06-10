<p align="center">
  <img src="docs/logo.png" alt="JCut.AI" width="120" height="120" />
</p>

<h1 align="center">JCut.AI</h1>
<h2 align="center">Your Junior Editing tool — clear the repetitive work, focus on what matters.</h2>

<p align="center">An editing assistant that handles the time-consuming groundwork — scanning footage, roughing in a timeline, syncing to music — so you can spend your energy on the creative decisions that actually require you.</p>

> **Beta software.** JCut.AI is under active development. Expect rough edges and changes
> between releases, and always keep independent backups of your footage.

Describe what you're going for. JCut scans your clips, assembles a starting point, and
exports an editable Premiere Pro project. From there, it's your cut — refine pacing, adjust
grades, mix audio, and finish it exactly the way you'd finish any project in Premiere.

JCut is modeled on the "assistant + tools" architecture: a language model interprets your
direction and coordinates the mechanical work (scanning media, placing clips, building the
timeline JSON, exporting the `.prproj`) while you make the calls that shape the edit. The
model handles logistics — creative judgment stays with you.

## Our philosophy

**AI should empower editors, not replace them.** JCut is built to save you the hours you
spend on repetitive, low-creativity tasks — scrubbing through footage to find a moment,
placing every clip by hand on a blank timeline, manually syncing to a beat grid. That time
is yours back. The taste, the story, the final call: those stay with you, always.

We also care about **environmental impact.** Large cloud models run in power-hungry data
centers. That's why JCut runs great **entirely on your own machine** — no data centers, and
**nothing leaves your computer.** Prefer the cloud? You can choose that too. The trade-offs
are laid out honestly — the choice is always yours.

## Where the AI runs

JCut never forces you into the cloud. Pick the setup that fits you:

- **Single-Local** *(default, recommended)* — one local model via LM Studio. Private, free,
  works offline, and gentle on weaker Macs.
- **Dual-Local** — separate Logic and Vision models via LM Studio for faster, cleaner runs
  on capable hardware (16GB+ RAM).
- **Hybrid** — Claude coordinates the reasoning; your Mac handles the repetitive scanning
  work. Fast, high-quality, and saves most of your Claude usage.
- **Claude** — runs on your Claude subscription via the Claude Agent SDK. No API key. The
  most capable results out of the box, but it uses the cloud and your paid plan.

Every mode drives the *same* `jc` tools CLI. Switch anytime in Settings — nothing is permanent.

## What JCut handles for you

- **Footage scanning** — reads metadata, (optional) transcriptions, and visual analysis so
  you don't have to scrub through everything manually before you start.
- **Timeline assembly** — places clips, links audio/video, handles ripple edits, reframes,
  captions, and speed ramps based on your direction.
- **Beat-synced cutting** — `analyze-music` extracts BPM, a beat grid, and energy sections
  so your cuts can land on the downbeats of your soundtrack without manual sync work.
- **Visual clip analysis** — `analyze-video` extracts shot composition, camera settle time,
  and motion peaks to help find cleaner trim points and cut-on-action moments.
- **Intelligent first cuts** — built-in modes for common formats: Recap, Montage,
  Talking-Head, Ad, Trailer, Wedding. Add your own presets to match your workflow.
- **Style memory** — analyze your past cuts (or an existing Premiere project) to learn your
  pacing, shot length, and B-roll tendencies. The more you use it, the more it sounds
  like you.
- **Continue existing timelines** — import a Premiere `.prproj` as an editable sequence
  and keep working (offline media is preserved; relinks when the drive reconnects).
- **Export to Premiere Pro** — every sequence exports as a fully editable `.prproj`. Open
  it in Premiere, refine, grade, mix, and deliver. It's your project from start to finish.

## Storage: symlink-only

Source footage is **never copied** into a project — it's symlinked in place. Video is
multi-GB; copying would fill your disk. The `source-add` tool verifies every link is a
symlink and refuses to fall back to copying.

## Project layout

```
JcutAI/                     # the app + backend
├── src/
│   ├── tools/              # the `jc` CLI — the "hands"
│   │   ├── model.ts        # timeline data model (Sequence/Clip)
│   │   ├── ops.ts          # add/update/remove clips (+ ripple, auto-link)
│   │   ├── render.ts       # ffmpeg filter_complex render pipeline
│   │   ├── beats.ts        # musical-map analysis (BPM/beats/sections)
│   │   ├── analyze.ts      # style learning
│   │   ├── prproj.ts       # Premiere import + analysis
│   │   ├── presets.ts      # editing modes + user presets
│   │   └── cli.ts          # command dispatch
│   ├── agent.ts            # Claude Agent SDK loop (Max subscription)
│   └── agent-local.ts      # LM Studio OpenAI-compatible loop
├── kb/                     # editorial knowledge base (read by the agent)
├── SYSTEM.md               # the agent's operating instructions
└── app/                    # Electron + React GUI
    ├── electron/           # main process + preload bridge
    └── src/                # React UI (chat, timeline, sidebar, settings…)
```

## Develop

```bash
# backend (the jc tools CLI)
npm install
npm run build              # compiles src/ → dist/

# GUI (Electron + React + Vite + Tailwind + Framer Motion)
cd app
npm install
npm run dev                # Vite + Electron with hot reload
```

Workspaces live under `~/Documents/JCutAI/`. Set `JCUT_HOME` to override.

## Use the CLI directly

```bash
JCUT_HOME=~/Documents/JCutAI node dist/tools/cli.js sequence-create \
  --workspace demo --name "First Cut" --orientation horizontal --framerate 30
node dist/tools/cli.js analyze-music --file song.wav
node dist/tools/cli.js analyze-video --workspace "couples shoot" --file source/video/clip.mp4
node dist/tools/cli.js sequence-import-prproj --workspace demo --file project.prproj
```

Run any command with no args to see the full list.

## Package a Mac app

```bash
cd app
npm run dist               # builds JCut.AI.app + a DMG into app/release/
```

## Requirements

### System compatibility

| Requirement | Minimum |
|---|---|
| **Mac** | Apple Silicon (M1 or later) — Intel Macs are not supported |
| **macOS** | 13 Ventura or later |
| **RAM** | 16 GB unified memory for Single-Local and Dual-Local modes |
| **Storage** | ~10 GB free for a single AI model download (varies by model) |
| **Node.js** | 20+ |

> **Why Apple Silicon only?** Local AI models use the Metal GPU backend for fast on-device
> inference. The performance and unified-memory architecture of M-series chips is what makes
> running a capable model locally practical. Intel Macs lack the memory bandwidth to run
> these models at a usable speed.

### Additional dependencies

- `ffmpeg` / `ffprobe` on PATH — `brew install ffmpeg`
- **For Claude mode:** the `claude` CLI, logged into an Anthropic Max plan
- **For Local / Hybrid modes:** LM Studio with a tool-calling model loaded and the server running

## Legal and acknowledgements

JCut.AI includes third-party open-source components. The current acknowledgement
index lives in [THIRD_PARTY_NOTICES.md](/Users/bradyjordan/Documents/JcutAI-app/THIRD_PARTY_NOTICES.md).

Current bundled visual-analysis acknowledgements include:

- `sssabet/Shot_Type_Classification` — MIT license, with the bundled license kept at
  [third_party/Shot_Type_Classification/LICENSE](/Users/bradyjordan/Documents/JcutAI-app/third_party/Shot_Type_Classification/LICENSE)
- A local packaging notice for that model at
  [third_party/Shot_Type_Classification/NOTICE.md](/Users/bradyjordan/Documents/JcutAI-app/third_party/Shot_Type_Classification/NOTICE.md)

Important: the upstream `Shot_Type_Classification` project is MIT-licensed, but
its README also states that the underlying dataset terms may restrict commercial
use. Treat that model as review-required before shipping a commercial build.

---

Built for editors who want to spend more time on the decisions that actually require them.
