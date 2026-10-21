import { scene } from "./timeline";
import { QUESTION_TIMES } from "../scenes/S02Questions";

/**
 * Sound-design events. Each is a sample from `public/audio/sfx` (synthesised by
 * scripts/audio/build_audio.py, so every sound in the film is original) placed at a time inside a
 * scene. Gains are linear; the mix is checked by scripts/qa-audio.mjs after the render.
 */
export type SfxName = "buzz" | "tick" | "press" | "confirm" | "refuse" | "shutter" | "whoosh" | "paper" | "stamp" | "swell" | "low";
export type SfxEvent = { scene: string; at: number; name: SfxName; gain?: number };

export const SFX: SfxEvent[] = [
  ...QUESTION_TIMES.map((at) => ({ scene: "s02", at, name: "buzz" as const, gain: 0.55 })),
  { scene: "s03", at: 0.55, name: "whoosh", gain: 0.35 },
  { scene: "s03", at: 1.9, name: "swell", gain: 0.5 },
];

/** Absolute time of an event, in seconds. */
export const sfxTime = (e: SfxEvent) => scene(e.scene).start + e.at;

/** Scenes register more events through this, keeping each sound next to the visual it serves. */
export function addSfx(events: SfxEvent[]): void {
  SFX.push(...events);
}
