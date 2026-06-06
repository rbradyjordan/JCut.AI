# Editing Craft — Advanced Techniques

Read this before any creative edit. It makes cuts feel intentional and professional.

## Cool Cuts (the techniques that make edits feel pro)

- **Beat-synced cuts.** Run `analyze-music` on the track. Snap clip cut points to
  `beats_seconds` (or `downbeats_seconds` for bigger moments). Place a new clip's
  `position_seconds` exactly on a beat. Cutting *on* the beat reads as deliberate;
  cutting between beats reads as sloppy.
- **J-cut** (audio leads): the next clip's AUDIO starts before its video. Put the
  incoming A clip a beat earlier than its V clip (unlink the V/A pair, shift A left).
  Great for conversation and momentum. (This technique is the app's namesake.)
- **L-cut** (audio trails): the outgoing clip's audio continues under the next clip's
  video. Extend the outgoing A clip past the V cut.
- **Match cut.** Cut between two clips that share composition/motion/shape so the eye
  flows across the cut. Use `media-info`/frame inspection to find matching framing.
- **Whip / speed-ramp transition.** End the outgoing clip with a fast speed ramp
  (`speed_keyframes` ramping up to e.g. 3–4x), cut on the blur, start the incoming
  clip with a ramp from fast→normal. Reads as a dynamic "whoosh" without a plugin.
- **Flash / hard cut on impact.** On a big downbeat, a hard cut to a new shot hits
  harder than any dissolve. Default to hard cuts; reserve dissolves for time passing.
- **Punch-in.** Two clips from the SAME source, second one scaled up ~10–20% =
  a "punch-in" that adds energy to a talking-head moment. Use `scale_x/scale_y`.

## Speed Ramping

Set `speed_keyframes` on a clip: an array of `{at, speed}` (at = seconds within the
clip). Examples:
- Slow-mo reveal → realtime: `[{at:0,speed:0.3},{at:1.0,speed:1.0}]`
- Realtime → whip out: `[{at:0,speed:1.0},{at:0.8,speed:4.0}]`
- Hit-slow-mo on a key moment: ramp down to 0.4x right at the action beat.
Clear with `speed_keyframes: null`. Combine speed ramps with beat-synced cuts for
the signature modern montage feel.

## Recap Video Mastery

A recap (highlight reel, "best of", event recap, season recap) is MUSIC-DRIVEN and
MONTAGE-FIRST. The song is the skeleton; the footage hangs off it.

**Recap build order:**
1. **Pick/confirm the music.** Run `analyze-music` to get BPM, beats, and energy
   `sections`. The whole edit is paced to this map.
2. **Map structure to sections.** Low-energy `intro` section → establishing/atmospheric
   shots, slower cuts. `build`/`verse` → rising action, cuts getting tighter. `high`/
   `drop` sections → fastest cuts, best moments, beat-synced hits, speed ramps.
3. **Open with a hook (first 1–3s).** Strongest single shot or a fast 3-shot burst
   landing on the first downbeat. Never open on a slow/weak shot.
4. **Cut to the beat.** In high-energy sections aim for a cut every 1–2 beats. In
   calm sections let shots breathe (4–8 beats). Use `downbeats_seconds` for the
   biggest shot changes.
5. **Build to a climax**, then **resolve** (a final held shot or logo on the last
   downbeat). Recaps should feel like they *end*, not just stop.
6. **Variety rule.** No two adjacent shots from the same source/angle. Rotate
   subjects, framings, and motion direction. Repetition kills a recap.
7. **Speed ramps for emphasis.** Drop into slow-mo on the single best moment of each
   section; ramp back to realtime on the next beat.
8. **Layer for texture (optional).** Light overlay shots on V2 at section transitions.

**Recap pacing targets by energy:**
| Section energy | Cut frequency | Technique |
|---|---|---|
| low (intro/breakdown) | every 4–8 beats | establishing, slow push-ins, slow-mo |
| mid (verse/build) | every 2–4 beats | rising tempo, J/L cuts, motion matches |
| high (drop/chorus) | every 1–2 beats | beat-synced hard cuts, speed ramps, best shots |

## Matching SHOT CONTENT to the song (not just pacing)

Pacing is half the job; the other half is choosing *which shot* plays over *which part of
the music*. Use your clip content awareness (`content-list` / `media-frames`) together with
the musical map (`analyze-music` → energy `sections`) to place shots by meaning:

- **Low-energy intro / breakdown** → **wide establishing shots, atmosphere, scene-setting.**
  Show *where we are*. Slow push-ins, landscapes, the crowd before the show. Let it breathe.
- **Build / verse (rising energy)** → **medium shots, movement, anticipation building.** Shots
  with motion and direction; tighten as the section climbs. Start introducing your subjects.
- **Drop / chorus (peak energy)** → **your BEST and most dynamic shots — close-ups, action,
  payoff moments, faces, impact.** This is where the hero shots and the energy land on the beat.
- **Lyrics / vocals** → when the track has vocal hits or a lyric moment, land a meaningful shot
  (a face, the payoff) right on it. Sound-driven shot selection reads as intentional.
- **The hook (first downbeat)** → your single strongest or most surprising shot. Earn attention.
- **The resolve (final downbeat)** → a held, conclusive shot (hero, logo, the "after"). End it.

Concretely: get the energy sections, get the clip descriptions, then assign shot *types* to
section *energies* before placing anything. Don't put a static wide on the drop or waste your
best close-up in the quiet intro. Shot-to-music fit is what separates a real edit from clips
on a beat grid.

## Montage / Sizzle (non-recap)

Same beat-driven approach, but no narrative arc required — prioritize the strongest
shots and relentless variety. Still open on a hook and cut to the beat.

## General principles

- **Hard cut is the default.** Transitions are a deliberate choice, not a habit.
- **Motivate every cut** — a beat, an action, a line of dialogue, a look.
- **Continuity:** don't intercut different outfits/locations as one moment (see
  visual-continuity rules). For recaps, time jumps are expected, so this relaxes.
- **Always verify:** after assembling, render frames at 2–3 cut boundaries and check
  the cuts land on beats and the framing varies.
