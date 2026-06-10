# Recap Videos — The Specialist Playbook

> The deep reference for recaps, highlight reels, "best of", event recaps, season
> recaps, sizzles, and aftermovies. Recaps are JCut's flagship skill. Read this in
> full before building one. Builds on `kb/fundamentals.md` and `kb/editing-craft.md`.

## What a recap actually is

A recap is **music-driven, montage-first emotional compression**. You are taking
hours of footage and distilling it into a short, propulsive piece that makes the
viewer *feel* the event/season/journey in 30–120 seconds. The song is the skeleton;
the footage hangs off the beat grid. Story matters, but **energy and emotion matter
more** than strict chronology.

Award-winning recaps share four traits: a **killer hook**, **relentless variety**,
**beat-locked pacing that escalates**, and a **resolved ending** that earns a breath.

## Step 0 — Establish the foundation

1. **Confirm the song.** No song = no recap. If the user hasn't given one, ask or
   suggest one matched to the desired energy. The song's length usually sets the
   recap's length (or you cut the song to a clean musical phrase).
2. **`analyze-music` the track.** You now have `bpm`, `beats_seconds`,
   `downbeats_seconds`, and energy `sections` (low/mid/high). This map governs
   everything. Write the BPM + section boundaries to MEMORY.md.
3. **Inventory the footage.** `sources-list` + `media-info`. If you have content
   analysis, tag clips by: subject, energy/motion, emotional peak, and quality.
   Build a mental (or MEMORY.md) shortlist of "hero shots" — the 5–10 best moments.

## Step 1 — Map structure to the song

Lay the song's energy sections onto a recap arc:

| Song section | Recap role | Footage | Cut rhythm |
|---|---|---|---|
| **Intro (low)** | The hook + setup | 1 hero hook shot, then establishing/atmosphere | open hard on downbeat 1; then slow (every 4–8 beats) |
| **Build (mid)** | Rising action | escalating moments, motion, faces | tighten (every 2–4 beats); J/L cuts for flow |
| **Drop/Chorus (high)** | The payoff | your BEST shots, biggest moments | fastest (every 1–2 beats); beat-synced hard cuts; speed ramps |
| **Breakdown (low again)** | Breather | one emotional/held shot, slow-mo | let it breathe (every 4–8 beats) |
| **Final chorus/outro** | Climax + resolve | last hero shot → logo/held final frame | climax fast, then ONE held shot on the last downbeat |

If the song has no clear drop, manufacture the arc: front-load energy, dip in the
middle, peak at ~70–85% through, resolve at the end.

## Step 2 — The hook (first 1–3 seconds)

This decides whether anyone watches. Options, best first:
- **Single hero shot** held to the first downbeat, then cut loose.
- **3-shot burst** (3 fast cuts) landing the 3rd cut on downbeat 1.
- **Cold motion** — a whip/speed-ramp into the title or first beat.
Never open on a slow, weak, or establishing-for-its-own-sake shot. Earn the wide.

## Step 3 — Cut to the beat

- Place each clip's `position_seconds` exactly on a value from `beats_seconds`
  (or `downbeats_seconds` for the biggest shot changes).
- **Cut frequency follows section energy** (table above). The *escalation* is the
  craft — the viewer should feel the build without being able to name why.
- **On big downbeats, hard-cut to your strongest shot.** Save hero shots for drops.
- Snap, don't drift: a cut 3 frames off the beat reads as sloppy. On the beat.

## Step 4 — Variety (the rule that makes or breaks recaps)

Repetition is the #1 recap killer. Enforce:
- **No two adjacent clips from the same source or angle.**
- **Rotate framing** — wide → close → medium → detail, not three closes in a row.
- **Rotate motion direction** — a left-moving shot then a right-moving shot.
- **Rotate subject** — don't show the same person/place back to back.
- If the pool is thin, pull *different ranges/framings* from the same sources rather
  than reusing a clip (a reused clip reads as low-effort unless it's a deliberate
  callback/motif).

## Step 5 — Texture & emphasis

- **Speed ramps on the single best moment of each section.** Drop to ~0.3–0.5x slow-mo
  right on the action beat, ramp back to realtime on the next beat (`speed_keyframes`).
- **Punch-ins** for a repeated subject (same source, +10–20% scale) add energy
  without a new shot.
- **Whip/flash transitions** sparingly on section boundaries (a few per recap max).
- **Light V2 overlays** (textures, light leaks) at section transitions if available.
- **Captions/titles** land on downbeats; keep them short (event name, date, a name).

## Step 6 — Audio

- The music is the bed and runs continuously on its own A-track.
- **Pull natural-sound "stingers"** from clips for punch — a crowd roar, a laugh, a
  whoosh — ducked under the music on big hits. Use sparingly; the song leads.
- Duck the music slightly under any spoken soundbite, then bring it back.
- End cleanly on a musical resolution — never let the song fade awkwardly mid-phrase.

## Step 7 — The ending

Recaps must *end*, not stop. On the final downbeat: one held hero shot, a logo/title
card, or a slow-mo button. Give the viewer a beat to land. A hard stop on silence
after the last beat is powerful.

## Recap variants

- **Event recap (wedding, party, conference):** chronological-ish energy arc; include
  faces and reactions; one or two emotional held moments; resolve on the key subject.
- **Sports/season recap:** escalate to the biggest play/win; stat cards on downbeats;
  end on the championship/final moment.
- **Travel/aftermovie:** establish location early, then motion and detail; lean on
  speed ramps and sweeping shots; resolve on a sunset/wide.
- **Product/year-in-review:** structure by chapters; titles per section on downbeats;
  end on a forward-looking/CTA beat.

## Recap self-review (before "done")

- [ ] Does it hook in the first 2 seconds?
- [ ] Is EVERY cut on a beat (`beats_seconds`)?
- [ ] Does cut frequency visibly escalate into the drop?
- [ ] Zero adjacent repeats; framing/subject/motion varied throughout?
- [ ] Hero shots saved for downbeats/drops?
- [ ] At least one speed-ramped emphasis moment per high section?
- [ ] Does it end resolved on the final downbeat, not trail off?
- [ ] Rendered 3+ boundary frames and confirmed beats + variety?
