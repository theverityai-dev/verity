/**
 * Pure geometry for the ADR-046 graphics. No React, no DOM, so every shape is unit-tested.
 *
 * Honesty rule (ADR-046 §7): these functions draw what they are given and never invent a point.
 * A series with fewer than two finite values has no line; an empty or zero total has no fill.
 */

/** value / total clamped to 0..1. Zero, negative or non-finite totals are 0, never NaN. */
export function fraction(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(1, Math.max(0, value / total));
}

/** Stroke dash for a progress ring of radius `r` filled to `f` (0..1). */
export function ringDash(f: number, r: number): { circumference: number; dash: number; gap: number } {
  const circumference = 2 * Math.PI * r;
  const dash = circumference * Math.min(1, Math.max(0, f));
  return { circumference, dash, gap: circumference - dash };
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Points for a sparkline inside a `w` x `h` box with `pad` inset. Null when the series cannot
 * honestly be drawn (fewer than two values, or any value not finite). A flat series sits mid-height.
 */
export function sparklinePoints(values: readonly number[], w: number, h: number, pad = 2): Array<[number, number]> | null {
  if (values.length < 2 || values.some((v) => !Number.isFinite(v))) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const step = (w - 2 * pad) / (values.length - 1);
  return values.map((v, i) => {
    const x = pad + i * step;
    const y = span === 0 ? h / 2 : h - pad - ((v - min) / span) * (h - 2 * pad);
    return [round(x), round(y)];
  });
}

/** SVG path through the points. */
export function linePath(points: ReadonlyArray<[number, number]>): string {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");
}

/** Closed area under the line, down to the baseline at `h - pad`. */
export function areaPath(points: ReadonlyArray<[number, number]>, h: number, pad = 2): string {
  if (points.length === 0) return "";
  const base = round(h - pad);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return `${linePath(points)} L${last[0]} ${base} L${first[0]} ${base} Z`;
}

/**
 * Start and size (0..1) of each segment of a stacked bar. Negative or non-finite values count as 0.
 * A zero total returns all-zero segments rather than dividing by zero.
 */
export function stackSegments(values: readonly number[]): Array<{ start: number; size: number }> {
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = clean.reduce((a, b) => a + b, 0);
  let start = 0;
  return clean.map((v) => {
    const size = total > 0 ? v / total : 0;
    const seg = { start, size };
    start += size;
    return seg;
  });
}

/**
 * A half-circle gauge arc from the left end, sweeping clockwise over the top, filled to `f`.
 * Null when `f` is 0 (nothing to draw). The arc never exceeds 180deg, so the large-arc flag is 0.
 */
export function gaugeArc(cx: number, cy: number, r: number, f: number): string | null {
  const t = Math.min(1, Math.max(0, f));
  if (t === 0) return null;
  const angle = Math.PI - t * Math.PI;
  const sx = round(cx - r);
  const ex = round(cx + r * Math.cos(angle));
  const ey = round(cy - r * Math.sin(angle));
  return `M${sx} ${round(cy)} A${r} ${r} 0 0 1 ${ex} ${ey}`;
}

export type StepStatus = "done" | "current" | "upcoming";

/** Status of step `index` when step `current` is in hand. `current >= count` means all done. */
export function stepStatus(index: number, current: number): StepStatus {
  if (index < current) return "done";
  if (index === current) return "current";
  return "upcoming";
}

/** Up to two initials from a name: "Ravi Kumar Shah" -> "RS", "IIT Indore" -> "II". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]![0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]![0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** A stable small hash, so one name always gets the same avatar hue. */
export function stableIndex(text: string, modulo: number): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return modulo > 0 ? h % modulo : 0;
}
