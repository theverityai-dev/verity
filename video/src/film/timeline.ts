import timeline from "../../content/timeline.json";
import check from "../../content/vo-check.json";

/**
 * The film's clock, built from the measured narration by `scripts/audio/build_timeline.py`.
 * Scenes ask for their cues by id; every visual beat is anchored to a cue, so a new voice-over
 * re-times the whole film without touching a scene.
 */
export type Cue = { id: string; start: number; end: number; text: string };
export type SceneTime = {
  id: string;
  act: string;
  chapter: string | null;
  title: string;
  start: number;
  end: number;
  cues: Cue[];
};

export const TIMELINE = timeline as { overlap: number; total: number; scenes: SceneTime[] };

export function scene(id: string): SceneTime {
  const s = TIMELINE.scenes.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scene ${id}`);
  return s;
}

/** A scene's length in seconds, without the transition overlap. */
export const sceneLength = (id: string) => scene(id).end - scene(id).start;

/** A cue's start and end, relative to the start of its scene. */
export function cue(sceneId: string, cueId: string): { start: number; end: number; len: number } {
  const s = scene(sceneId);
  const c = s.cues.find((x) => x.id === cueId);
  if (!c) throw new Error(`cue ${cueId} is not in scene ${sceneId}`);
  return { start: c.start - s.start, end: c.end - s.start, len: c.end - c.start };
}

export const allCues = (): Cue[] => TIMELINE.scenes.flatMap((s) => s.cues);

type Heard = Record<string, { words: Array<{ w: string; s: number; e: number }> }>;

/**
 * Scene-relative time at which a word is SPOKEN in a cue (from the recogniser's word timings), so a
 * visual beat lands on the word it illustrates. `nth` picks a repeated word. A word that is not
 * in the cue throws, so a re-recorded voice that changes the wording fails the render loudly
 * instead of silently mistiming a beat.
 */
export function word(sceneId: string, cueId: string, w: string, nth = 0): number {
  const c = cue(sceneId, cueId);
  const words = (check as Heard)[cueId]?.words ?? [];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const hits = words.filter((x) => norm(x.w) === norm(w));
  const hit = hits[nth];
  if (!hit) throw new Error(`word "${w}" (#${nth}) not found in ${cueId}`);
  return c.start + hit.s;
}
