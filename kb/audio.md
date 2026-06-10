# Audio — Levels, Mixing & Sound

> Audio is half the edit (often more). A great picture cut with bad audio fails;
> a rough picture cut with great audio often passes. Builds on `kb/fundamentals.md`.

## Hierarchy & levels

Mix in priority order — the most important element sits on top:

1. **Dialogue / VO** — the priority. Aim peaks around **-12 to -6 dBFS**, consistent
   loudness throughout (the viewer shouldn't reach for the volume).
2. **Music** — supports, never competes. Under speech, duck it to roughly **-18 to
   -24 dB below the VO**. In music-only sections it can come up to full.
3. **SFX / natural sound** — punctuate and add realism; sit between dialogue and music.

Use `volume_db` per clip (0 = unchanged; -6 ≈ half; -60 ≈ silence). For delivery,
target around **-14 LUFS** integrated for web/social (a common loudness standard).

## Ducking

Lower the music whenever speech is present, raise it back in the gaps. This keeps
words intelligible and music energetic. Even a few dB of ducking dramatically
improves clarity. Automate it around each spoken section.

## The continuous bed

Keep a continuous music or ambience bed under a sequence of cuts — it hides picture
edits and creates flow. Silence between cuts exposes every edit. When you must go
quiet for drama, make the silence *deliberate*, not an accident of missing audio.

## J-cuts & L-cuts (again, because they matter)

Audio leads picture: start the next shot's audio early (J-cut) or carry the current
audio over the next picture (L-cut). On dialogue, audio and picture should rarely cut
on the same frame. This is the single biggest "why does theirs feel pro" difference.

## Fades & transitions

- **Fade in/out** the music at the start/end so it never starts/stops abruptly
  (`fade.fade_in_seconds` / `fade.fade_out_seconds`).
- **Audio crossfades** (a few frames) on music/ambience cuts to avoid clicks/pops.
- Don't hard-cut a loud audio tail to silence unless it's a deliberate punctuation.

## Sound design punch

On big visual hits (recap drops, trailer titles), a stinger — impact, whoosh, riser,
crowd swell — pulled from the footage or a SFX, ducked appropriately, makes the moment
land. Use sparingly; the music still leads.

## Self-review

- [ ] Is dialogue/VO consistently intelligible and on top?
- [ ] Is music ducked under speech and brought back in gaps?
- [ ] Continuous bed under cut sequences (no exposed silent edits)?
- [ ] Music fades in/out cleanly; no clicks on audio cuts?
- [ ] Any audio peaking/distorting? Pull it down.
