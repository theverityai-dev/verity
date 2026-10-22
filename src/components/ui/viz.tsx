import { SERIES_ORDER, type KindHue, type StateTone } from "./business/domains";
import { Icon } from "./icons";
import {
  areaPath,
  fraction,
  gaugeArc,
  linePath,
  ringDash,
  sparklinePoints,
  stackSegments,
  stepStatus,
} from "./viz-geometry";

/**
 * ADR-046 §7 graphics: server-rendered SVG, no chart library, real data only.
 *
 * Colour: progress and gauges take a STATE colour (they report a condition: done, pending,
 * blocked); series take KIND hues in the one fixed `SERIES_ORDER`. Every graphic carries a text
 * equivalent (`role="img"` + `aria-label`, or visible figures beside it).
 */

const stateVar = (tone: StateTone) => `var(--color-state-${tone})`;
const hueInk = (hue: KindHue) => `var(--color-hue-${hue}-ink)`;

/* ---------------------------------- ring ---------------------------------- */

/** A checklist or completion ring: "3 of 5". */
export function ProgressRing({
  value,
  total,
  label,
  size = 44,
  tone = "completed",
  showValue = true,
  centre,
}: {
  value: number;
  total: number;
  label: string;
  size?: number;
  tone?: StateTone;
  showValue?: boolean;
  /** Text in the middle instead of "value/total", e.g. "42m" for minutes against a limit. */
  centre?: string;
}) {
  const stroke = Math.max(3, Math.round(size / 10));
  const r = (size - stroke) / 2;
  const { dash, gap } = ringDash(fraction(value, total), r);
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${value} of ${total}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-control-strong)" strokeWidth={stroke} />
        {dash > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={stateVar(tone)}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${gap}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      {showValue && (
        <span aria-hidden="true" className="tabular absolute text-[11px] font-semibold text-text">
          {centre ?? `${value}/${total}`}
        </span>
      )}
    </span>
  );
}

/* ---------------------------------- bar ----------------------------------- */

/** A thin horizontal progress bar with its figures beside it. */
export function ProgressBar({
  value,
  total,
  label,
  tone = "active",
  showFigures = true,
  marker,
  figures,
}: {
  value: number;
  total: number;
  label: string;
  tone?: StateTone;
  showFigures?: boolean;
  /** A threshold on the same scale as `total` (a reorder level): drawn as a tick across the bar. */
  marker?: number;
  /** Replaces the default "value/total" text ("12 kg", "3 of 5 received"). */
  figures?: string;
}) {
  const pct = Math.round(fraction(value, total) * 100);
  const markerPct = marker === undefined ? null : Math.round(fraction(marker, total) * 100);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={value}
        className="relative h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-[var(--color-control-strong)]"
      >
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: stateVar(tone) }} />
        {markerPct !== null && (
          <span aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-text" style={{ left: `${markerPct}%` }} />
        )}
      </div>
      {showFigures && (
        <span className="tabular shrink-0 text-[13px] text-text-secondary">{figures ?? `${value}/${total}`}</span>
      )}
    </div>
  );
}

/* --------------------------------- stepper -------------------------------- */

/**
 * A compact horizontal stepper: order status, filing period, a short journey. `current` is the
 * index in hand; `current >= steps.length` means all done. The current step uses the tint ("you
 * are here"); done steps are green with a tick; upcoming steps are a system fill.
 */
export function StepProgress({ steps, current, label }: { steps: readonly string[]; current: number; label: string }) {
  return (
    <ol aria-label={label} className="m-0 flex list-none items-start gap-0 overflow-x-auto p-0">
      {steps.map((step, i) => {
        const status = stepStatus(i, current);
        return (
          <li key={step + i} className="flex min-w-[72px] flex-1 flex-col items-center text-center" aria-current={status === "current" ? "step" : undefined}>
            <div className="flex w-full items-center">
              <span className={i === 0 ? "h-0.5 flex-1" : "h-0.5 flex-1 bg-[var(--color-control-strong)]"} style={i > 0 && status !== "upcoming" ? { backgroundColor: stateVar("completed") } : undefined} />
              <span
                className="grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold"
                style={
                  status === "done"
                    ? { backgroundColor: stateVar("completed"), color: "#fff" }
                    : status === "current"
                      ? { backgroundColor: "var(--color-accent)", color: "var(--color-accent-on)" }
                      : { backgroundColor: "var(--color-control-strong)", color: "var(--color-text-secondary)" }
                }
              >
                {status === "done" ? <Icon name="check" size={14} /> : i + 1}
              </span>
              <span className={i === steps.length - 1 ? "h-0.5 flex-1" : "h-0.5 flex-1 bg-[var(--color-control-strong)]"} style={i < steps.length - 1 && status === "done" ? { backgroundColor: stateVar("completed") } : undefined} />
            </div>
            <span className={"mt-1.5 px-1 text-[12px] leading-[16px] " + (status === "current" ? "font-semibold text-text" : "text-text-secondary")}>
              {step}
              <span className="sr-only">{status === "done" ? " (done)" : status === "current" ? " (current)" : ""}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* -------------------------------- sparkline ------------------------------- */

/** A small trend line. Renders nothing when the series cannot honestly be drawn. */
export function Sparkline({
  values,
  label,
  hue = "indigo",
  width = 96,
  height = 28,
  area = true,
}: {
  values: readonly number[];
  label: string;
  hue?: KindHue;
  width?: number;
  height?: number;
  area?: boolean;
}) {
  const pts = sparklinePoints(values, width, height);
  if (!pts) return null;
  const last = pts[pts.length - 1]!;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}: ${values.join(", ")}`}>
      {area && <path d={areaPath(pts, height)} fill={hueInk(hue)} fillOpacity={0.16} />}
      <path d={linePath(pts)} fill="none" stroke={hueInk(hue)} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2.25} fill={hueInk(hue)} />
    </svg>
  );
}

/* ------------------------------- stacked bar ------------------------------ */

export type StackedSegment = { label: string; value: number };

/**
 * Parts of a whole on one bar, with a legend that carries every figure (the text equivalent).
 * Hues follow `SERIES_ORDER`. More than eight parts is a table, not a bar: the ninth onward are
 * summed into "Other".
 */
export function StackedBar({
  segments,
  label,
  format = (n: number) => String(n),
}: {
  segments: readonly StackedSegment[];
  label: string;
  format?: (n: number) => string;
}) {
  const shown: StackedSegment[] =
    segments.length > 8
      ? [...segments.slice(0, 7), { label: "Other", value: segments.slice(7).reduce((a, s) => a + s.value, 0) }]
      : [...segments];
  const geo = stackSegments(shown.map((s) => s.value));
  return (
    <figure className="m-0">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--color-control-strong)]" aria-hidden="true">
        {geo.map((g, i) =>
          g.size > 0 ? (
            <span key={shown[i]!.label} style={{ width: `${g.size * 100}%`, backgroundColor: hueInk(SERIES_ORDER[i]!) }} />
          ) : null,
        )}
      </div>
      <figcaption className="sr-only">{label}</figcaption>
      <ul className="m-0 mt-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[13px] text-text-secondary">
        {shown.map((s, i) => (
          <li key={s.label} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: hueInk(SERIES_ORDER[i]!) }} />
            {s.label}
            <span className="tabular font-semibold text-text">{format(s.value)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/* ---------------------------------- gauge --------------------------------- */

/** A half-circle meter: credit used, food cost %, cash variance. The figure sits inside. */
export function Gauge({
  value,
  max,
  label,
  valueLabel,
  tone = "active",
  size = 120,
}: {
  value: number;
  max: number;
  label: string;
  /** What to print in the middle; defaults to a percentage. */
  valueLabel?: string;
  tone?: StateTone;
  size?: number;
}) {
  const stroke = Math.max(6, Math.round(size / 12));
  const r = size / 2 - stroke / 2;
  const cy = size / 2;
  const h = size / 2 + stroke / 2;
  const f = fraction(value, max);
  const track = gaugeArc(size / 2, cy, r, 1)!;
  const arc = gaugeArc(size / 2, cy, r, f);
  const text = valueLabel ?? `${Math.round(f * 100)}%`;
  return (
    <span className="inline-flex flex-col items-center">
      <svg width={size} height={h} viewBox={`0 0 ${size} ${h}`} role="img" aria-label={`${label}: ${text}`}>
        <path d={track} fill="none" stroke="var(--color-control-strong)" strokeWidth={stroke} strokeLinecap="round" />
        {arc && <path d={arc} fill="none" stroke={stateVar(tone)} strokeWidth={stroke} strokeLinecap="round" />}
      </svg>
      <span aria-hidden="true" className="tabular -mt-6 text-[17px] font-medium text-text">
        {text}
      </span>
    </span>
  );
}

/* ------------------------------ range meter ------------------------------- */

/**
 * A measured reading against its accepted range: a track, the accepted band, and a marker for the value. Drawn
 * only when the check really has a range (a reading with no limits has nothing to be compared with, and a bare
 * marker would imply a verdict nobody defined). Inside the band the marker is the "completed" state colour,
 * outside it the "blocked" one; the figures are written beside it so colour is never the only signal.
 */
export function RangeMeter({ value, min, max, unit }: { value: number; min: number | null; max: number | null; unit: string }) {
  if (min === null && max === null) return null;
  const inRange = (min === null || value >= min) && (max === null || value <= max);
  const bound = (min ?? max) as number;
  const pad = min !== null && max !== null ? (max - min || Math.abs(bound) || 1) * 0.5 : Math.max(Math.abs(value - bound) * 1.2, Math.abs(bound) * 0.25, 1);
  const lo = min !== null ? min - pad : bound - pad;
  const hi = max !== null ? max + pad : bound + pad;
  const at = (n: number) => `${Math.min(98, Math.max(2, ((n - lo) / (hi - lo)) * 100)).toFixed(1)}%`;
  const bandLeft = min !== null ? at(min) : "0%";
  const bandRight = max !== null ? at(max) : "100%";
  const fmt = (n: number) => n.toLocaleString("en-IN");
  const accepted = min !== null && max !== null ? `${fmt(min)} to ${fmt(max)}` : min !== null ? `at least ${fmt(min)}` : `at most ${fmt(max as number)}`;
  return (
    <div role="img" aria-label={`${fmt(value)} ${unit}, accepted ${accepted} ${unit}, ${inRange ? "within range" : "outside range"}`} className="w-full min-w-32 max-w-lg">
      <div className="relative h-5">
        <span aria-hidden="true" className="absolute inset-x-0 top-2 h-1 rounded-full bg-[var(--color-control-strong)]" />
        <span
          aria-hidden="true"
          className="absolute top-1.5 h-2 rounded-full"
          style={{ left: bandLeft, right: `calc(100% - ${bandRight})`, backgroundColor: "var(--color-state-completed)", opacity: 0.28 }}
        />
        <span
          aria-hidden="true"
          className="absolute top-0.5 size-4 -translate-x-1/2 rounded-full border-2 border-[var(--color-surface)]"
          style={{ left: at(value), backgroundColor: inRange ? "var(--color-state-completed)" : "var(--color-state-blocked)" }}
        />
      </div>
      <p className="m-0 mt-0.5 text-[12px] text-text-tertiary">Accepted: {accepted} {unit}</p>
    </div>
  );
}
