# Film 01 — Verity for Manufacturing

Master: 1920×1080, 60 fps, 4:27 (266.57 s), H.264 + AAC stereo. Built to the `verity-motion-design`
skill (grid, type, camera, material, audit). Data: fictional (`src/content/fixture.ts`). Claims:
`docs/coverage-matrix.md`. Timing source of truth: `content/timeline.json`, generated from the
measured narration, so the times below move if the voice is replaced.

**Premise.** A capable manufacturer still runs through one person's phone. Follow one engineered
order, J-0142 (two booster pump skids for a water board), from enquiry to dispatch, then step back
to see the operation, and return to the owner with the same six questions answered by records.

**World.** Dark world with one warm key; light product UI; paper for the analogue world. The
recurring physical object is an original isometric drawing of the skid (`src/props/Skid.tsx`): it
draws itself in the cold open, becomes the released drawing (s06), shows the failed flange (s09)
and is photographed for the passport (s10).

## Shot list

One line per shot: *focal point / statement / camera / hand-off.* Times are the scene start.

| # | Time | Act | Focal point | Statement (or none) | Camera | Hand-off |
|---|---|---|---|---|---|---|
| s01 | 0:00.0 | I | The skid drawing itself in warm line | none (caption: Booster pump skid · 2 × 75 kW / Aldervane Fluid Systems) | slow push 1.0→1.12 | drawing dims, dark space for the phone |
| s02 | 0:14.0 | I | Phone lock screen, six questions arriving | Six questions. / One phone. / Before nine. | 30 px lateral drift; 2 px buzz per arrival | the questions lift off the phone |
| s03 | 0:28.0 | I | Six questions converge into one card, which becomes job J-0142 | none | push 1.0→1.16 onto the title | the window, now the product surface |
| s04 | 0:35.3 | II·01 | Quote revisions, then the agreed value | The approved / figure stays / approved. | settle, push, macro 1.55 on the value, pull back | same job, Tasks tab |
| s05 | 0:54.6 | II·02 | Tasks "Waits for", then the promised date | Nobody starts / on a guess. | slow lateral to milestones | the drawing |
| s06 | 1:06.4 | II·03 | Paper GA drawing → R02 released, R01 superseded → sheet lands as R02's file → "Relied on by" → components ×2 | Built to the / revision released. | push to links; page change; push to table | the order's stock |
| s07 | 1:28.9 | II·04 | Hold refused (command's own words) → PO waits for approval → 2 then 1 received → hold succeeds | Shortages, / known early. | push, page change, back | the shop floor |
| s08 | 1:48.2 | II·05 | Floor queue filtered to Pressure test → journey, stage 5 cannot start | Each stage, / in its order. | push; page change | the pressure-test checklist |
| s09 | 1:59.1 | II·05 | Measured pass → leak fail at joint 3 (drawing, left) → sent back, fail on record → retest with phone photo | The failure stays / in the history. | gentle push; phone enters left | the test report |
| s10 | 2:19.7 | II·06 | Summary-first test report → dispatch form → phone scans nameplate → passport | Proof travels / with the product. | push; window blurs away for the phone | the job's money |
| s11 | 2:38.7 | II·07 | Cost tiles counting up from records → margin → billing → project file pages | Margin, from what / actually happened. | push, macro 1.12 on margin, pull back | step back |
| s12 | 3:02.1 | III·07 | Summary, each figure lit as named → Late deliveries opens J-0139 | Exceptions / first. | arrive 0.92→1.0, small push | the assistant |
| s12p | 3:18.0 | III·07 | Pipeline board by stage, tiles; one deal's stage track and timeline; won → "Open a job" sheet → J-0152 as an enquiry | Tomorrow's work, / already in view. | small pushes from the window's left edge; two page changes | the assistant |
| s13 | 3:35.5 | III·08 | Assistant dock: question, answer, "Double-check" warning, confirm-before-acting | Answers you / can check. | push from the window's left edge | roles and history |
| s14 | 3:49.7 | III | Release grants by role; attributed history | Every handoff / has a name. | small push | back to the phone |
| s15 | 3:59.5 | IV | The same phone, each question answered by its record | Back to the work / only you can do. | slow pull-back | brand |
| s16 | 4:15.5 | V | Mark assembles, wordmark, "for Manufacturing", positioning line, next step | From enquiry to dispatch, every handoff on record. | none (centred) | fade to black |

Eyebrows (chapter labels) number the eight lifecycle chapters of the brief: 01 Enquiry to quote,
02 Order to project, 03 Engineering to BOM, 04 Procurement to stores, 05 Production / Quality,
06 Testing to dispatch, 07 Cost / Management / Pipeline, 08 Search to decisions.

## Narration

`content/narration.json` (26 cues, 182 s of speech). Every visual beat inside a scene is anchored to
the spoken word it illustrates through `word()` in `src/film/timeline.ts`, using the recogniser's
word timings (`content/vo-check.json`); a re-recorded line with different words fails the render
instead of silently drifting.

## Decisions and assumptions

- **No live-action footage.** None is in the repository and none was licensed for this. The
  industrial world is an original technical illustration and props drawn in code. Stated as a
  limitation in the README.
- **Statements are Light (300).** The skill sets hero statements at 300; ADR-033 (bold numbers) governs
  product UI, which the film follows inside the window.
- **One surface.** Act II stays inside one application window; pages change within it.
- **The drawing never opens inside Verity**, because the product has no drawing viewer (ADR-048).
- **Accent** is used for state, selection and links only, as in the product.

## Audit (skill section 9)

Recorded in `docs/qa-report.md` with the frames it refers to.
