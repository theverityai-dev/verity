// Loudness-master a rendered film: two-pass EBU R128 loudnorm to -16 LUFS integrated, -1.5 dBTP,
// audio re-encoded to AAC 320k, video stream copied untouched.
//
//   node scripts/master-audio.mjs out/in.mp4 out/out.mp4
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ffmpeg = path.join(root, "node_modules", "@remotion", "compositor-win32-x64-msvc", "ffmpeg.exe");
const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: node scripts/master-audio.mjs <in.mp4> <out.mp4>");
  process.exit(2);
}
const TARGET = "I=-16:TP=-1.5:LRA=11";

const first = spawnSync(ffmpeg, ["-hide_banner", "-nostats", "-i", input, "-vn", "-af", `loudnorm=${TARGET}:print_format=json`, "-f", "null", "-"], { encoding: "utf8" });
const err = first.stderr ?? "";
const m = JSON.parse(err.slice(err.lastIndexOf("{"), err.lastIndexOf("}") + 1));
console.log(`measured ${m.input_i} LUFS, ${m.input_tp} dBTP, LRA ${m.input_lra}`);
const second = spawnSync(
  ffmpeg,
  [
    "-hide_banner", "-y", "-i", input,
    "-af", `loudnorm=${TARGET}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`,
    "-c:v", "copy", "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart", output,
  ],
  { encoding: "utf8" },
);
if (second.status !== 0) {
  console.error(second.stderr);
  process.exit(1);
}
console.log(`wrote ${output}`);
