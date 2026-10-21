# Verity for Manufacturing — product film

A 4:09 product film (1920×1080, 60 fps) following one engineered order through Verity, built in
Remotion from the product's own screens, words and rules. It is a separate package: nothing here
is imported by the Verity application, and `video/` is excluded from the app's TypeScript, lint and
Docker builds.

| Document | What it holds |
|---|---|
| `docs/film-01-manufacturing.md` | Storyboard, shot list, timing, decisions |
| `docs/coverage-matrix.md` | Every capability the brief asked about: shown, illustrative, or not built, with the source file |
| `docs/sound-design.md` | Narration, music, ambience, effects and mix |
| `docs/qa-report.md` | What was checked, how, and the results |
| `content/narration.json` | The script (25 cues) |
| `deliverables/captions.srt`, `.vtt` | Caption sidecars |

## Rendering

Requirements: Node 22 or later and npm. Remotion downloads its own headless Chrome and ships its
own ffmpeg; nothing else is needed for video. Run everything from `video/`.

```
npm install
npm run audio                # regenerate music.wav and ambience.wav (deterministic, about 1 min; not committed)
npm run studio               # preview and scrub in the browser
npm run render:master        # out/verity-manufacturing-master-1080p60.mp4 (about 25 min on a 6-core laptop)
node scripts/master-audio.mjs out/verity-manufacturing-master-1080p60.mp4 out/verity-manufacturing-1080p60.mp4
node scripts/validate.mjs out/verity-manufacturing-1080p60.mp4
```

The final file is the loudness-mastered one (-16 LUFS, -1.5 dBTP). Other outputs:

- Review cut with burned-in captions, 960×540 at 30 fps:
  `npx remotion render src/index.ts ManufacturingFilm out/review-540p30-captions.mp4 --scale=0.5 --props="{\"fps\":30,\"captions\":true}"`
- 4K: add `--scale=2` to the master render. Every layout is in 1920×1080 units and scales cleanly;
  it was not rendered here (about four times the time).
- Audit stills: `node scripts/stills.mjs --grid=3` writes frames to `qa/frames/`;
  `python scripts/sheet.py qa/contact.png qa/frames/*.png` tiles them (needs Pillow).

Renders and stills go to `out/` and `qa/frames/`, both git-ignored. The master is too large for git
(GitHub refuses files over 100 MB); share it from wherever renders are kept.

On a machine whose system drive is full, point temp files elsewhere first (`TEMP`/`TMP`), because
Remotion writes frames to the system temp folder.

## Narration

The voice is a scratch track rendered offline with Kokoro v1.0 (Apache-2.0) through `kokoro-onnx`.
The model (about 350 MB) is not in the repository:

```
pip install kokoro-onnx soundfile faster-whisper
# download kokoro-v1.0.onnx and voices-v1.0.bin from the kokoro-onnx "model-files-v1.0" release into a folder
KOKORO_DIR=<that folder> python scripts/audio/build_vo.py     # writes public/audio/vo and content/vo-timing.json
python scripts/audio/check_vo.py                              # transcribes each cue back; fails above 10% word error
python scripts/audio/build_timeline.py                        # timeline, captions, SRT/VTT
```

Replacing it with a professional voice-over is the main open item; `docs/sound-design.md` has the steps.

## Architecture

```
content/          script, scene pacing, measured timings, timeline, captions (JSON, shared by Python and TS)
src/film/         grid and tokens (layout.ts), easing (ease.ts), camera, statements, grade (engine.tsx),
                  clock (timeline.ts: cue() and word()), soundtrack, captions, fonts
src/ui/           Verity UI rebuilt at the product's measurements (kit, icons, shell, job page parts)
src/props/        the isometric skid (iso.ts, Skid.tsx), drawing sheet, phone, QR symbol
src/content/      fixture.ts: the one fictional dataset; derived numbers are computed
src/scenes/       S01..S16, one file each; index.ts maps scene ids to components
src/Film.tsx      sequences the scenes on the narration's clock with 0.7 s cross-fades
scripts/          audio builders, stills, contact sheets, validation, loudness mastering
```

Animation is frame-driven only (no timers): every value is a function of the current frame through
`useTime()`. Visual beats are anchored to spoken words with `word(scene, cue, "word")`.

## Attribution

- Inter 5.2.8, OFL-1.1, from `@fontsource/inter` (copied into `public/fonts`).
- The Verity mark geometry is copied from `src/components/brand/VerityMark.tsx`.
- Kokoro v1.0 voice model, Apache-2.0. faster-whisper (MIT) for the intelligibility check.
- All music, ambience, sound effects, illustrations and props are original to this project.

## Known limitations

- Scratch synthetic narration, not a professional voice-over.
- No live-action industrial footage: the industrial world is an original line illustration.
- Synthesised music: competent and original, but not a composed score.
- Product screens are rebuilt in Remotion from the real components' measurements and the 1440px
  reference screenshots, not captured from a running tenant; some panels are illustrative (see the
  matrix).
- The QR symbols are drawn, not encoded.
- Not rendered: 4K master, vertical and short cuts.
