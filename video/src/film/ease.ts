import { Easing, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * Motion vocabulary (skill section 3). Everything is authored in SECONDS and converted with
 * the composition's fps, so the same film renders at 30 or 60 without re-timing.
 */
export const glide = Easing.bezier(0.22, 1, 0.36, 1);
export const smooth = Easing.bezier(0.45, 0, 0.15, 1);
export const linear = (x: number) => x;

/** Current time in seconds inside the enclosing Sequence. */
export function useTime(): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return frame / fps;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Eased progress 0..1 of an interval that starts at `start` and lasts `dur` seconds. */
export function p(t: number, start: number, dur: number, curve: (x: number) => number = glide): number {
  if (dur <= 0) return t >= start ? 1 : 0;
  return curve(clamp01((t - start) / dur));
}

export const mix = (a: number, b: number, k: number) => a + (b - a) * k;

/** In over [inAt, inAt+inDur], out over [outAt, outAt+outDur]. */
export function inOut(t: number, inAt: number, inDur: number, outAt: number, outDur: number): number {
  return p(t, inAt, inDur, glide) * (1 - p(t, outAt, outDur, smooth));
}

/** Standard durations (skill section 3, at any fps). */
export const D = { textIn: 0.85, textOut: 0.55, push: 1.6, ui: 0.6 } as const;

/** Count a number up over an interval, for figures that are being worked out. */
export function countTo(t: number, start: number, dur: number, value: number): number {
  return Math.round(value * p(t, start, dur, smooth));
}
