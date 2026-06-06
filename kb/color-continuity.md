# Color & Visual Continuity

> Keeping the picture consistent so cuts feel like one piece. Builds on
> `kb/fundamentals.md`.

## Match across the cut

Within a continuous scene, adjacent shots must match in **exposure, white balance,
and color temperature.** A brightness or warmth jump at a cut reads as a mistake —
the #1 thing that makes cuts look amateur.

- Most noticeable at the **start** of a piece — the first cut sets the viewer's
  expectation. Check the opening boundaries first.
- If two shots don't match: nudge `color_correction` (exposure, temperature, tint,
  contrast, saturation) to bring them together, or hide the mismatch behind a cutaway
  / B-roll / graphic that signals a scene change.

## When mismatch is a scene boundary

Different outfit, hair, location, or lighting = a **different recording session**.
Don't intercut those as one continuous moment. Either group same-look shots together,
or separate looks with B-roll/graphics/transitions that signal a time/context shift.
(For recaps/montages, time jumps are expected, so this relaxes — but color should
still not jarringly clash at a cut.)

## A light grade for cohesion

Even without per-shot correction, a gentle consistent look across the whole piece
(slight contrast + saturation, a subtle temperature lean) ties disparate footage
together. Keep it tasteful — over-grading dates a video fast.

## Verify with frames

Render frames at the first 2–3 cut boundaries (`sequence-render-frame`) and compare
side by side. If a clip clearly jumps in brightness/temperature, fix it before
declaring done. Re-render after any rotation-related edit (portrait sources carry
rotation metadata the renderer applies automatically — don't fight it with manual
rotation).

## Self-review

- [ ] Do adjacent shots match in exposure and temperature within a scene?
- [ ] Is the opening boundary clean (sets the visual expectation)?
- [ ] Are different-look sessions separated, not intercut as continuous?
- [ ] Consistent overall look across the piece (not over-graded)?
