# QA report: Verity for Manufacturing film

Final master: `out/verity-manufacturing-1080p60.mp4` (not in git, 65 MB before mastering; see README). Checked 2026-10-21.

## What was run, and the result

| Check | How | Result |
|---|---|---|
| Render completed cleanly | Remotion render log is empty apart from the wrapper's `exit 0`; output file written | PASS |
| Format | `scripts/validate.mjs` on the mastered file | 1920×1080 (16:9), H.264 yuv420p, 60 fps, AAC stereo 48 kHz |
| Duration | validator, file vs `content/timeline.json` | 266.70 s vs 266.57 s |
| Loudness | EBU R128 via `scripts/master-audio.mjs`, re-measured by the validator | -16.04 LUFS integrated, loudness range 4.1 LU (target -16) |
| Peaks | same | -1.46 dBTP true peak, no clipping (limit -1.0) |
| Narration intelligibility | `scripts/audio/check_vo.py`: each cue transcribed by faster-whisper and compared to the script | worst word error rate 0.024 (limit 0.10); the only difference is "won" heard as "one" |
| Timeline | validator | 17 scenes contiguous, 26/26 narration cues placed, every cue inside its scene |
| Assets | validator | fonts, 26 voice files, music, ambience and every sound effect present |
| Captions | validator | 93 lines, none over 42 characters; SRT and VTT sidecars present |
| Type check | `npx tsc --noEmit` | clean |
| Frames from the final encode | one frame at the midpoint of every scene, tiled and viewed (`qa/encode-final.png`, git-ignored) | all 17 scenes present and uncropped |
| App build isolation | app `tsc --listFilesOnly` lists no `video/` file; app ESLint ignores `video/` | PASS |

## Defects found by the audit and fixed before this render

- s03: the question card was blurred and its text overlapped the title; fixed by hiding the card text before the merge.
- s11: the headline sat under the application window, and the cost values were cropped at the frame edge; fixed by delaying the headline until the window pulls back and capping the content width.
- s12p (new CRM scene): the Won column and fourth tile were cropped; fixed by narrowing the board.
- A render failed once (ffmpeg crash) because an earlier stopped render left its ffmpeg and Chrome processes running. Not a code defect; see the README.

## Not checked, and why

- **No person has watched or listened to the film.** All checks are automated or on still frames. Pacing, how the scratch voice sounds, the music and the transitions are unreviewed. A playback sign-off is the open item in `taskplans/handoffs/FINISHER.md` P2-12.
- Frames were checked at one point per scene, not every moment; mid-scene animation and cross-fades are not individually inspected. s11's midpoint frame shows its chapter label without the headline by design (the headline arrives after the pull-back).
- The 4K render and short or vertical cuts were not made.
- Product screens are rebuilt from the product's measurements and reference screenshots, not captured from a running tenant. The CRM pipeline is built on the local database only (Task 128), not yet on production.
