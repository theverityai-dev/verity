// Render audit stills: bundle once, then render frames at scene-relative times.
//
//   node scripts/stills.mjs s01@3.5 s02@9          -> qa/frames/s01-3.5.png ...
//   node scripts/stills.mjs --mid                  -> the midpoint of every scene
//   node scripts/stills.mjs --grid=4               -> 4 evenly spaced frames per scene
//   add --scale=0.5 for half-size frames, --sheet to tile the result into qa/contact-<name>.png
//
// Skill section 9: "Render stills at the midpoint of every shot ... check each shot."
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const timeline = JSON.parse(readFileSync(path.join(root, "content", "timeline.json"), "utf8"));
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const a = args.find((x) => x.startsWith(`--${name}`));
  if (!a) return dflt;
  const [, v] = a.split("=");
  return v === undefined ? true : v;
};
const scale = Number(flag("scale", 1));
const sheet = flag("sheet", false);
const fps = 60;

const specs = [];
if (flag("mid", false)) {
  for (const s of timeline.scenes) specs.push({ id: s.id, at: Math.round(((s.end - s.start) / 2) * 100) / 100 });
}
const grid = Number(flag("grid", 0));
if (grid) {
  for (const s of timeline.scenes) {
    const len = s.end - s.start;
    for (let i = 0; i < grid; i++) specs.push({ id: s.id, at: Math.round(((len * (i + 0.5)) / grid) * 100) / 100 });
  }
}
for (const a of args.filter((x) => !x.startsWith("--"))) {
  const [id, at] = a.split("@");
  specs.push({ id, at: Number(at) });
}
if (specs.length === 0) {
  console.error("usage: node scripts/stills.mjs s01@3.5 ... | --mid | --grid=N [--scale=0.5] [--sheet]");
  process.exit(2);
}

const outDir = path.join(root, "qa", "frames");
mkdirSync(outDir, { recursive: true });
const serveUrl = await bundle({ entryPoint: path.join(root, "src", "index.ts") });
const composition = await selectComposition({ serveUrl, id: "ManufacturingFilm", inputProps: { fps, captions: false } });

const written = [];
for (const s of specs) {
  const sc = timeline.scenes.find((x) => x.id === s.id);
  if (!sc) throw new Error(`unknown scene ${s.id}`);
  const frame = Math.min(composition.durationInFrames - 1, Math.round((sc.start + s.at) * fps));
  const file = path.join(outDir, `${s.id}-${s.at}.png`);
  await renderStill({ composition, serveUrl, output: file, frame, scale, inputProps: { fps, captions: false } });
  written.push(file);
  console.log(`${s.id} @ ${s.at}s (frame ${frame}) -> ${path.relative(root, file)}`);
}

if (sheet) {
  const ffmpeg = path.join(root, "node_modules", "@remotion", "compositor-win32-x64-msvc", "ffmpeg.exe");
  const tmp = path.join(root, "qa", "frames", "_sheet");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  written.forEach((f, i) => execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", f, "-vf", "scale=480:-1", path.join(tmp, `${String(i).padStart(3, "0")}.png`)]));
  const cols = grid || 4;
  const rows = Math.ceil(written.length / cols);
  const name = typeof sheet === "string" ? sheet : grid ? `grid${grid}` : "mid";
  const out = path.join(root, "qa", `contact-${name}.png`);
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-framerate", "1", "-i", path.join(tmp, "%03d.png"), "-vf", `tile=${cols}x${rows}:padding=6:color=0x202020`, "-frames:v", "1", out]);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`contact sheet -> ${path.relative(root, out)}`);
}
