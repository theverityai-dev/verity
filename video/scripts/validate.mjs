// Automated checks for the film. Prints PASS/FAIL per check and exits non-zero on any failure.
//
//   node scripts/validate.mjs                      -> project checks only
//   node scripts/validate.mjs out/master.mp4       -> plus the rendered file: format and loudness
//
// What it cannot check (a person must): whether a frame looks right. That is the still audit
// (scripts/stills.mjs) and the playback review recorded in docs/qa-report.md.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(path.join(root, p), "utf8"));
const bin = (n) => path.join(root, "node_modules", "@remotion", "compositor-win32-x64-msvc", `${n}.exe`);
let failed = 0;
const check = (ok, name, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
};

// Timeline.
const tl = read("content/timeline.json");
const narration = read("content/narration.json");
check(tl.scenes.length === 16, "16 scenes", `${tl.scenes.length}`);
check(tl.scenes.every((s, i) => s.end > s.start && (i === 0 || Math.abs(s.start - tl.scenes[i - 1].end) < 1e-6)), "scenes are contiguous and positive");
check(tl.scenes.every((s) => s.cues.every((c) => c.start >= s.start && c.end <= s.end)), "every cue sits inside its scene");
const cueIds = tl.scenes.flatMap((s) => s.cues.map((c) => c.id));
check(narration.lines.every((l) => cueIds.includes(l.id)), "every narration line is placed", `${cueIds.length}/${narration.lines.length}`);
check(tl.total > 180 && tl.total < 420, "runtime within 3-7 minutes", `${tl.total.toFixed(2)} s`);

// Assets.
for (const w of [300, 400, 500, 600, 700]) {
  check(existsSync(path.join(root, "public/fonts", `inter-latin-${w}-normal.woff2`)), `Inter ${w} present`);
}
check(narration.lines.every((l) => existsSync(path.join(root, "public/audio/vo", `${l.id}.wav`))), "a voice file for every cue");
check(existsSync(path.join(root, "public/audio/music.wav")), "music bed present (npm run audio)");
check(existsSync(path.join(root, "public/audio/ambience.wav")), "ambience present (npm run audio)");
const sfxSrc = readFileSync(path.join(root, "src/film/sfx.ts"), "utf8");
const sfxNames = sfxSrc.match(/export type SfxName = ([^;]+);/)[1].match(/"([a-z]+)"/g).map((s) => s.slice(1, -1));
const missing = sfxNames.filter((n) => !existsSync(path.join(root, "public/audio/sfx", `${n}.wav`)));
check(missing.length === 0, "every sound effect present", missing.join(", "));

// Narration heard back by the recogniser.
const voCheck = read("content/vo-check.json");
const worst = Math.max(...Object.values(voCheck).map((v) => v.wer));
check(worst <= 0.1, "narration intelligible (word error rate)", `worst ${worst}`);

// Captions.
const caps = read("content/captions.json");
check(caps.length > 0 && caps.every((c) => c.text.length <= 42 && c.end > c.start), "captions: at most 42 characters a line, positive durations", `${caps.length} lines`);
check(existsSync(path.join(root, "deliverables/captions.srt")) && existsSync(path.join(root, "deliverables/captions.vtt")), "SRT and VTT sidecars present");

// A rendered file, if given.
const file = process.argv[2];
if (file) {
  const probe = JSON.parse(execFileSync(bin("ffprobe"), ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file]).toString());
  const v = probe.streams.find((s) => s.codec_type === "video");
  const a = probe.streams.find((s) => s.codec_type === "audio");
  const [num, den] = v.r_frame_rate.split("/").map(Number);
  const fps = num / den;
  const dur = Number(probe.format.duration);
  check(v.width * 9 === v.height * 16, "16:9 frame", `${v.width}x${v.height}`);
  check(v.codec_name === "h264" && v.pix_fmt === "yuv420p", "H.264, yuv420p", `${v.codec_name} ${v.pix_fmt}`);
  check(Math.abs(fps - 60) < 0.01 || Math.abs(fps - 30) < 0.01, "frame rate 60 or 30", `${fps}`);
  check(Math.abs(dur - tl.total) < 0.2, "duration matches the timeline", `${dur.toFixed(2)} s vs ${tl.total.toFixed(2)} s`);
  check(!!a && a.channels === 2, "stereo audio stream", a ? `${a.codec_name} ${a.sample_rate} Hz ${a.channels} ch` : "none");

  // ffmpeg prints the loudnorm measurement on stderr.
  const run = spawnSync(bin("ffmpeg"), ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], { encoding: "utf8" });
  const err = run.stderr ?? "";
  const json = err.slice(err.lastIndexOf("{"), err.lastIndexOf("}") + 1);
  if (json) {
    const m = JSON.parse(json);
    const lufs = Number(m.input_i);
    const tp = Number(m.input_tp);
    check(lufs > -19 && lufs < -13, "integrated loudness near -16 LUFS (web delivery)", `${lufs} LUFS, range ${m.input_lra} LU`);
    check(tp <= -1.0, "true peak at or below -1 dBTP (no clipping)", `${tp} dBTP`);
  } else {
    check(false, "loudness measured", "ffmpeg printed no loudnorm summary");
  }
}

console.log(`\n${failed === 0 ? "ALL PASS" : `${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
