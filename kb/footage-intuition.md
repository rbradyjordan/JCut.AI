# Footage Intuition — Reading How Material Is Organized

Read this before assembling from a pool of source files. A good editor infers
*intent* from how footage is laid out and named — and exercises judgment about
what to use. Don't treat every file as an equal, mandatory ingredient.

## Identify what each file IS (before deciding how to use it)

- **Music / audio beds.** `.wav`/`.mp3`/`.aac`/`.m4a` files — especially ones much
  longer than the video clips, or with names like "track", "song", artist/title,
  "music", "score" — are the SOUNDTRACK, not content to cut to picture. Use them on
  an audio track as the bed; run `analyze-music` and pace to them. Never place a
  full song on a video track or chop it like B-roll.
- **Voiceover / dialogue audio.** Shorter spoken `.wav`/`.mp3` — these drive the
  story; keep them clean and continuous, build picture around them.
- **Graphics / logos / titles.** `.png`/`.svg`/`.mov` with alpha, names like "logo",
  "lower-third", "title" — overlays, not scenes. Place on upper tracks at moments,
  not in the main cut order.
- **LUTs / grain / overlays.** Files named "LUT", "grain", "film", "preset",
  "overlay", "light leak" — these are LOOKS/effects, not story footage. Don't cut
  them into the timeline as shots.
- **A-roll vs B-roll.** Long continuous takes (interviews, performances) = A-roll
  foundation. Short, varied, scenic shots = B-roll to lay over.

## Read the ORGANIZATION for intent

How files are grouped, ordered, and named is a signal the creator left for you:

- **A clustered, in-order group is probably the intended spine.** If a batch of
  clips sits together and reads in sequence (consistent naming/numbering, a coherent
  run), that's likely the selects or the intended order — treat it as the backbone.
- **Scattered or trailing clips after that are probably extras/options.** Loose
  clips that don't fit the cluster's order are alternates, safety takes, or B-roll —
  available if useful, not mandatory. You do NOT have to place all of them.
- **Folder names carry meaning.** `selects/`, `final/`, `best/` → prioritize.
  `raw/`, `dailies/`, `extra/`, `bts/`, `archive/` → lower priority, dip in as needed.
- **Numbered files imply order; gaps imply omissions** the creator already made.

## Judgment: you don't have to use everything

- **Curate, don't dump.** A strong cut uses the BEST material, not ALL material.
  Leaving weak/redundant/duplicate shots out is an editorial decision, not a failure.
- **Coverage ≠ obligation.** Multiple angles/takes of one moment = pick the best one
  (or intercut deliberately), don't include every version.
- **Match quantity to the goal.** A 30s recap doesn't use 300 clips. Estimate how
  many shots the target length + pacing needs, then select that many of the best.
- **When you skip a lot, say so briefly** — "used the 12 strongest of ~40 clips;
  the rest were alternates/dupes" — so the user knows it was intentional.
- **If intent is genuinely ambiguous** (is this the order, or just import order?),
  state your read and proceed; don't stall. The user will redirect if wrong.

## Sample STRATEGICALLY, not exhaustively (speed matters)

Footage often lives on slow media (SD cards, external drives). Extracting and
viewing a frame from every clip is SLOW and usually unnecessary — a real editor
spot-checks, they don't screen all 200 takes before starting.

- **Do NOT `media-frames` + Read every clip.** With 100+ clips that's many minutes
  of slow SD-card reads and it makes the tool feel frozen.
- **Sample a SPREAD of ~8–15 clips** across the shoot (beginning / middle / end, and
  any obviously different scenes) to understand the look and find hero candidates.
  That's enough to form a vision and start cutting.
- Lean on cheap signals first: filenames, timecodes/clustering, durations, and
  `media-info` — they tell you a lot before you ever read a frame.
- Pull more frames later ONLY for the specific clips you're about to place or choose
  between. Sample-on-demand, not sample-everything-upfront.
- If `content-analyze` results are already cached (`content-list`), use those instead
  of re-extracting frames.

## Practical first pass on a new pool

1. `sources-list` → group files by kind (video / audio / images) and by folder.
2. Classify: which audio is MUSIC vs VO? which video is A-roll vs B-roll? any
   graphics/LUTs to set aside?
3. Infer the spine: is there a clustered, ordered group? Treat it as the backbone.
4. Decide a target shot count from the goal, then SELECT — don't commit to using all.
5. **Sample ~8–15 representative clips** (a spread), not all of them. Form the vision.
6. Record your read in MEMORY.md ("track.wav = music bed; clips 001–020 = main
   sequence; loose MVI_* = B-roll options") so you don't re-derive it.
