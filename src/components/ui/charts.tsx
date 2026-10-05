import type { ReactNode } from "react";

/**
 * The chart primitives the mockup's dashboard is built from.
 *
 * Drawn as inline SVG rather than pulled from a charting library. These are two
 * fixed shapes with fixed behaviour, and a library would ship a layout engine,
 * a scale system and a tooltip layer to render a ring and eleven rectangles.
 *
 * EVERY VALUE IS REAL
 * Each of these takes counts the caller has actually queried. There is no
 * sample data, no smoothing and no projected series — the platform has no
 * analytics layer, so a trend line here would be a drawing rather than a
 * measurement. When a segment is zero it is drawn as zero.
 *
 * ACCESSIBILITY
 * A chart is an image to a screen reader, so each carries a text description of
 * the same numbers. The visible legend is not decoration either: colour alone
 * never distinguishes a segment, every one is labelled and carries its count.
 */

export type Segment = { label: string; value: number; color: string };

/**
 * The mockup's ring: a total in the middle, segments around the outside.
 *
 * Segments are drawn on one circle with `stroke-dasharray`, which keeps the
 * geometry to a single element per segment and makes the gaps exact. The ring
 * starts at twelve o'clock because a ring that starts at three reads as
 * rotated.
 */
export function Donut({
  segments,
  centreValue,
  centreLabel,
  size = 168,
  thickness = 11,
}: {
  segments: Segment[];
  centreValue: number | string;
  centreLabel: string;
  size?: number;
  thickness?: number;
}) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  // Built with a fold rather than a running variable: reassigning during render
  // is a lint error for a good reason — a value that changes while the tree is
  // being produced is a value two renders can disagree about.
  //
  // A zero segment contributes no arc at all. A hairline of colour for a count
  // of zero is the chart telling a small lie.
  const arcs = segments.reduce<Array<Segment & { length: number; offset: number }>>(
    (acc, s) => {
      const previous = acc[acc.length - 1];
      const offset = previous ? previous.offset + previous.length : 0;
      const length = total === 0 ? 0 : (s.value / total) * circumference;
      return [...acc, { ...s, length, offset }];
    },
    [],
  );

  const description =
    total === 0
      ? `${centreLabel}: nothing recorded yet.`
      : `${centreLabel}: ${centreValue}. ` +
        segments.map((s) => `${s.label} ${s.value}`).join(", ") + ".";

  return (
    <div className="flex items-center justify-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} role="img" aria-label={description}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={thickness}
            className="stroke-[var(--color-track)]"
          />
          {arcs.map((a) =>
            a.length === 0 ? null : (
              <circle
                key={a.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                strokeWidth={thickness}
                strokeLinecap="round"
                stroke={a.color}
                strokeDasharray={`${Math.max(a.length - 3, 0)} ${circumference}`}
                strokeDashoffset={-a.offset}
                // Start at twelve o'clock rather than three.
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            ),
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="tabular text-[30px] font-bold leading-none tracking-[-0.02em] text-text">
            {centreValue}
          </span>
          <span className="mt-1.5 text-[13px] text-text-tertiary">{centreLabel}</span>
        </div>
      </div>
    </div>
  );
}

/** The legend beside a `Donut` — a dot, a label, and the count it stands for. */
export function Legend({ segments }: { segments: Segment[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {segments.map((s) => (
        <li key={s.label} className="flex items-center gap-2.5 text-[13.5px]">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ background: s.color }}
          />
          <span className="text-text-secondary">{s.label}</span>
          <span className="tabular ml-auto text-text">{s.value}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The mockup's small bar field behind a row of figures.
 *
 * Bars are scaled against the largest value, not against a fixed ceiling, so a
 * quiet week does not render as an empty box. A single bar at full height when
 * every value is equal is correct: it means they are equal.
 */
export function BarStrip({
  values,
  label,
  height = 56,
}: {
  values: number[];
  label: string;
  height?: number;
}) {
  const peak = Math.max(1, ...values);
  return (
    <div
      role="img"
      aria-label={`${label}: ${values.join(", ")}`}
      className="flex items-end gap-[3px]"
      style={{ height }}
    >
      {values.map((v, i) => (
        <span
          key={i}
          className="w-full min-w-[3px] rounded-[2px] bg-[var(--accent-400)] opacity-70"
          style={{ height: `${Math.max((v / peak) * 100, 6)}%` }}
        />
      ))}
    </div>
  );
}

/**
 * A figure in the mockup's staircase row: value, label, and a rule beneath that
 * only the leading figure carries in the accent.
 */
export function StairFigure({
  value,
  label,
  accent = false,
}: {
  value: number | string;
  label: string;
  accent?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <span
        className={
          "tabular text-[22px] font-normal leading-none tracking-[-0.02em] " +
          (accent ? "text-accent-ink" : "text-text")
        }
      >
        {value}
      </span>
      <span className="mt-1.5 truncate text-[12.5px] text-text-tertiary">{label}</span>
    </div>
  );
}

/**
 * The mockup's feature card — the one thing on the screen asking to be acted
 * on, given a priority pill, a name, a supporting line and a single action.
 */
export function FeatureCard({
  pill,
  title,
  meta,
  action,
  tone = "accent",
}: {
  pill: string;
  title: string;
  meta: string;
  action?: ReactNode;
  tone?: "accent" | "warning" | "quiet";
}) {
  const dot =
    tone === "warning"
      ? "bg-[var(--color-warning)]"
      : tone === "quiet"
        ? "bg-[var(--color-text-tertiary)]"
        : "bg-accent";

  return (
    <div className="glass-card flex h-full flex-col justify-end rounded-[12px] p-5">
      <span className="mb-auto inline-flex w-fit items-center gap-2 rounded-pill bg-surface-sunken px-3 py-1.5 text-[12.5px] text-text-secondary">
        <span aria-hidden="true" className={"size-[7px] shrink-0 rounded-full " + dot} />
        {pill}
      </span>
      <div className="mt-8 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="m-0 truncate text-[19px] leading-tight text-text">{title}</p>
          <p className="m-0 mt-1.5 truncate text-[13px] text-text-tertiary">{meta}</p>
        </div>
        {action}
      </div>
    </div>
  );
}
