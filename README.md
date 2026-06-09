<p align="center">
  <img src="docs/logo.png" alt="JCut.AI" width="120" height="120" />
</p>

<h1 align="center">JCut.AI</h1>

<p align="center">An AI video editor that understands your footage and cuts it for you.</p>

You talk to it in plain language; it plans the edit, places clips on a timeline, and
renders the result.

JCut.AI is modeled on the "agent + tools" architecture: a language model does the
*reasoning* (what to cut, how to pace it) while a deterministic CLI does the *work*
(probe media, build the timeline JSON, render with ffmpeg). The model never touches
pixels — it orchestrates tools.

## Two brains, one set of hands

- **Claude** — runs on your Claude Max subscription via the Claude Agent SDK. No API key.
- **Local (LM Studio)** — runs a model on your own machine (private, free). Point it at any
  tool-calling model (Qwen, Llama 3.1, etc.).

Both drive the *same* `jc` tools CLI. Switch between them in Settings.

## What it can do

- **Understand footage** — ffprobe metadata; (optional) vision + transcription.
- **Build & edit timelines** — add/trim/arrange clips, V/A auto-linking, ripple edits,
  transforms (fill/fit/reframe), captions, speed ramps.
- **Cool cuts** — beat-synced cutting, J/L cuts, punch-ins, match cuts, speed-ramp whips.
- **Music maps** — `analyze-music` extracts BPM, a beat grid, and energy sections so the
  agent can pace edits to the song.
- **Visual clip analysis** — `analyze-video` extracts shot composition, camera settle time,
  and motion peaks so the local agent can choose better trims and cut-on-action moments.
- **Recap videos** — a specialty: music-driven, section-paced montages with a hook,
  escalating energy, speed-ramped highlights, and a resolved ending.
- **Modes & presets** — built-in modes (Recap, Montage, Talking-Head, Ad, Trailer,
  Wedding) plus your own saved presets.
- **Learn your style** — analyze your past cuts (or a Premiere project) for pacing, shot
  length, and B-roll habits. Run it repeatedly with `--name` to learn several styles.
- **Continue existing timelines** — import a Premiere `.prproj` as an editable sequence
  and keep editing (offline media is preserved; relinks when the drive reconnects).
- **Render** — composite + encode to mp4 via ffmpeg; single-frame previews for verification.

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

- macOS, Node 20+
- ffmpeg / ffprobe on PATH (`brew install ffmpeg`)
- For Claude: the `claude` CLI logged into your Max plan
- For Local: LM Studio with a tool-calling model and the server running

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

Built as a learning project: how AI agents can interpret and edit footage.
