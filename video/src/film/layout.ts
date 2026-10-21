/**
 * The film's grid, type scale and materials, in 1920x1080 units.
 *
 * Authority: the verity-motion-design skill (sections 1, 2, 5) for the world, and ADR-033
 * (`src/app/globals.css`) for anything that is product UI. Every scene composes against these
 * numbers; nothing is placed "where there is room".
 */

export const W = 1920;
export const H = 1080;

/** Safe margins: 120 left/right, 96 top/bottom. */
export const SAFE = { x: 120, y: 96, right: W - 120, bottom: H - 96 } as const;

/** Twelve columns of 120 with 20 gutters inside the safe area. */
export const COL = 120;
export const GUTTER = 20;
export const col = (n: number) => SAFE.x + n * (COL + GUTTER);

/** The text column: every statement in the film starts at x 120. */
export const TEXT = { x: SAFE.x, w: 620 } as const;
/** The product zone, x 840 to 1800. */
export const UI = { x: 840, w: 960, right: 1800 } as const;
/** Shared baseline: statement bottom = panel bottom = text baseline. */
export const BASELINE = 984;

/** Four type levels (skill section 2). Sizes at 1080p. */
export const TYPE = {
  statement: 76,
  support: 30,
  label: 17,
  statementLine: 1.06,
  statementTracking: "-0.035em",
} as const;

export const FONT = `Inter, -apple-system, "SF Pro Display", "Segoe UI", sans-serif`;
export const FEATURES = `"cv02", "cv03", "cv04", "ss03"`;

/** The dark world (skill section 5). One warm key, no coloured light. */
export const DK = {
  base: "#080b11",
  baseAlt: "#0e131c",
  key: "rgba(255, 236, 214, 0.075)",
  ink: "#F3F0EA",
  inkSoft: "rgba(243, 240, 234, 0.66)",
  inkFaint: "rgba(243, 240, 234, 0.38)",
  line: "rgba(236, 229, 216, 0.82)",
  lineSoft: "rgba(236, 229, 216, 0.34)",
  hair: "rgba(243, 240, 234, 0.12)",
} as const;

/** Paper: the analogue world. */
export const PAPER = { sheet: "#F4F1EA", ink: "#1D1F24", soft: "#6B6A66", rule: "rgba(29, 31, 36, 0.16)" } as const;

/**
 * Verity product colours, light theme, copied from `src/app/globals.css` (ADR-033 iOS system colours).
 * The tint is systemBlue #0A84FF; its AA fill on white is computed by `accent.ts` as #0B65B3.
 */
export const V = {
  canvas: "#F2F2F7",
  surface: "#FFFFFF",
  control: "rgba(118, 118, 128, 0.12)",
  controlStrong: "rgba(118, 118, 128, 0.20)",
  chrome: "rgba(249, 249, 249, 0.94)",
  text: "#000000",
  text2: "rgba(60, 60, 67, 0.80)",
  text3: "#636366",
  line: "rgba(60, 60, 67, 0.18)",
  separator: "rgba(60, 60, 67, 0.29)",
  track: "rgba(120, 120, 128, 0.16)",
  tint: "#0A84FF",
  accent: "#0B65B3",
  accentSubtle: "rgba(10, 132, 255, 0.12)",
  accentLine: "rgba(10, 132, 255, 0.45)",
  success: "#1F7A36",
  successSubtle: "rgba(52, 199, 89, 0.14)",
  warning: "#C93400",
  danger: "#D70015",
  dangerSubtle: "rgba(255, 59, 48, 0.12)",
  info: "#0040DD",
} as const;

/** `--color-state-*-fill/ink` from globals.css: ADR-009 categories only. */
export const STATE = {
  draft: { fill: "#ECECEC", ink: "#69696D", dot: "#6C6C70" },
  pending: { fill: "#F4EADE", ink: "#995700", dot: "#A86000" },
  active: { fill: "#DEE6FB", ink: "#0040DD", dot: "#0040DD" },
  blocked: { fill: "#FADEE1", ink: "#CD0014", dot: "#D70015" },
  completed: { fill: "#E2EEE5", ink: "#1E7634", dot: "#1F7A36" },
  cancelled: { fill: "#ECECEC", ink: "#69696D", dot: "#6C6C70" },
} as const;
export type StateKey = keyof typeof STATE;

/** `--color-hue-*` pairs used by kind discs (ADR-046). */
export const HUE = {
  indigo: { fill: "#E4E2F8", ink: "#3E30CF" },
  purple: { fill: "#F1E3F6", ink: "#9C37BE" },
  teal: { fill: "#DEECE7", ink: "#117456" },
  cyan: { fill: "#DDEBED", ink: "#0E7181" },
  olive: { fill: "#E8EBDF", ink: "#5D6E17" },
  brown: { fill: "#EFE8E2", ink: "#8A5B33" },
  slate: { fill: "#E8EAED", ink: "#58687E" },
  blue: { fill: "#DEE6FB", ink: "#0040DD" },
  green: { fill: "#E2EEE5", ink: "#1E7634" },
  amber: { fill: "#F4EADE", ink: "#995700" },
  red: { fill: "#FADEE1", ink: "#CD0014" },
} as const;
export type Hue = keyof typeof HUE;
