# JCut.AI CastCut panel for Premiere Pro

**CastCut runs entirely inside Premiere** — like AutoPod. The panel reads your
open sequence, detects who's speaking on each mic (Silero VAD, all on-device),
and applies the camera cuts directly in the sequence by razoring every switch
point and deleting the inactive camera segments. No export, no round-trip.

## Using CastCut in Premiere

1. Open the sequence with your cameras: each camera's video on its own track
   (V1, V2, V3…), each speaker's mic on an audio track.
2. **Window → Extensions → JCut.AI**, press **Read sequence**.
3. Name each camera, set its type (Solo / Wide / Duo / Trio) and its mic.
   Two Solo cameras sharing a mic = two angles of one speaker (auto-rotated).
4. **Preview cuts** shows the plan; **Create multicam edit** applies it.
   By default it works on a duplicate of your sequence; Cmd+Z steps back.

The analysis engine ships inside the JCut AI app (`/Applications/JCut AI.app`)
— the panel finds and uses it automatically. The "Advanced" section keeps the
older app round-trip (watch `renders/`, send the project back to JCut).

## Install (macOS)

Three equivalent ways — pick whichever is closest:

1. **In the JCut app** — Settings → Premiere Pro → **Install panel** (also
   offered during onboarding). Shows live status: Premiere detected, panel
   version, loading enabled.
2. **CLI** — `jc premiere-panel-install` (check anytime with
   `jc premiere-panel-status`).
3. **Script** — `./install.sh` from this folder.

Then restart Premiere Pro and open **Window > Extensions > JCut.AI**.

First-run in the panel is zero-config: your JCut projects are auto-discovered
from `~/Documents/JCutAI` — pick one from the dropdown and press **Start
watching**. The selection and watching state persist across Premiere restarts.

All install paths enable CEP `PlayerDebugMode` so this unsigned development
panel loads. For distribution, package with ZXPSignCmd instead.

## Requirements

- Premiere Pro 13 (CC 2019) or newer with CEP support.
  (Newer Premiere versions that drop CEP in favor of UXP will need a UXP port —
  the host functions in `host/jcut.jsx` are the only Premiere-API surface.)

## Notes / limitations

- Import uses Premiere's project-import path (`app.project.importFiles` on a
  `.prproj`), which brings in the file's sequences and media references.
  Depending on Premiere version this may briefly show an import progress bar.
- The panel never touches the project file you have open; it only imports
  *other* files and copies your saved project out.
- Watching polls every 3 seconds (robust on iCloud/network volumes where
  filesystem events are unreliable).
