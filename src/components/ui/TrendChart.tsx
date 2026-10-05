"use client";

import { useId, useRef, useState } from "react";

/**
 * ADR-025 pattern 4 — chart card with a live hover tooltip.
 * Authority: `verity-spec/09_experience/design-system.md`
 * `REQ-EXPERIENCE-DESIGNSYSTEM-007`. Shape checked directly against
 * `design/newdarktheme.jpeg` / `design/newlighttheme.jpeg` (the product-
 * owner reference this pattern was drawn from): gradient area fill under
 * the line, y-axis grid with rounded tick values, a sparse x-axis label
 * row, and the tooltip's exact "<date> · <series> <value> · ..." format.
 *
 * Separate "use client" file, not added to `charts.tsx` — that file has no
 * client boundary today (`Donut`/`BarStrip`/`StairFigure`/`FeatureCard` are
 * all static), and pointer tracking needs hook state. Same reasoning as
 * `SplitButton.tsx`/`ProfileMenu.tsx`.
 *
 * Same house rule as every other chart in this repo (see `charts.tsx`'s own
 * header): every point is a real queried value. This component draws
 * whatever series it's given — it has no sample-data mode and generates
 * nothing itself.
 *
 * Scale math: x is evenly spaced by index (a categorical axis — dates,
 * weeks, whatever `labels` names), never data-driven, so gaps in reporting
 * don't compress or stretch the line. y is linear from a fixed zero (never
 * a data-driven floor — that would visually exaggerate real differences) to
 * a "nice" rounded ceiling above the highest value across every series, the
 * same rounding scroll/BI tools use so tick labels read as 0/50/100/150/200
 * rather than an arbitrary peak value.
 *
 * Pointer tracking: continuous during the gesture, not just on click, per
 * apple-design §1/§2 — the guide line and tooltip follow the pointer across
 * the whole plot on every `pointermove`, snapped to the nearest index rather
 * than raw pixel position (there's one real value per index, nothing
 * in-between to show).
 */

export type ChartSeries = { name: string; color: string; values: number[] };

/** Rounds a rough tick step up to 1/2/5 × a power of ten — the standard
 *  "nice number" axis algorithm, so labels read 0/50/100 not 0/47/94. */
function niceStep(roughStep: number): number {
  if (roughStep <= 0) return 1;
  const exponent = Math.floor(Math.log10(roughStep));
  const fraction = roughStep / 10 ** exponent;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * 10 ** exponent;
}

export function TrendChart({
  labels,
  series,
  height = 220,
  formatValue = (v: number) => String(v),
  maxAxisLabels = 6,
}: {
  /** One label per x position — dates, week-of, etc. Same length as every series' `values`. */
  labels: string[];
  series: ChartSeries[];
  height?: number;
  formatValue?: (value: number) => string;
  /** Cap on how many x-axis tick labels render — a dense range (30+ days) shows a sparse subset, always including the first and last. */
  maxAxisLabels?: number;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gradientId = useId();

  const width = 480; // viewBox units; SVG scales to the container's actual width via CSS.
  const padLeft = 34;
  const padRight = 4;
  const padTop = 12;
  const padBottom = 22;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const count = labels.length;
  const allValues = series.flatMap((s) => s.values);
  const rawPeak = Math.max(1, ...allValues);
  const tickStep = niceStep(rawPeak / 4);
  const axisMax = Math.max(tickStep, Math.ceil(rawPeak / tickStep) * tickStep);
  const yTicks = Array.from({ length: axisMax / tickStep + 1 }, (_, i) => i * tickStep);

  const xAt = (i: number) => padLeft + (count <= 1 ? plotWidth / 2 : (i / (count - 1)) * plotWidth);
  const yAt = (v: number) => padTop + plotHeight - (v / axisMax) * plotHeight;

  const paths = series.map((s) => ({
    ...s,
    line: s.values.map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(2)},${yAt(v).toFixed(2)}`).join(" "),
    area:
      s.values.map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(2)},${yAt(v).toFixed(2)}`).join(" ") +
      ` L${xAt(count - 1).toFixed(2)},${(padTop + plotHeight).toFixed(2)}` +
      ` L${xAt(0).toFixed(2)},${(padTop + plotHeight).toFixed(2)} Z`,
  }));

  const axisLabelIndices = (() => {
    if (count <= maxAxisLabels) return labels.map((_, i) => i);
    const step = (count - 1) / (maxAxisLabels - 1);
    return Array.from({ length: maxAxisLabels }, (_, i) => Math.round(i * step));
  })();

  const description =
    count === 0
      ? "No data for this range."
      : series
          .map((s) => `${s.name}: ${s.values.map((v, i) => `${labels[i]} ${formatValue(v)}`).join(", ")}`)
          .join(". ");

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || count === 0) return;
    const rect = svg.getBoundingClientRect();
    const relativeX = ((e.clientX - rect.left) / rect.width) * width;
    const fraction = (relativeX - padLeft) / plotWidth;
    const nearest = count <= 1 ? 0 : Math.round(fraction * (count - 1));
    setHoverIndex(Math.min(count - 1, Math.max(0, nearest)));
  }

  const tooltipLeftPct = hoverIndex === null ? 0 : (xAt(hoverIndex) / width) * 100;

  return (
    <div className="relative" style={{ height }}>
      <svg
        ref={svgRef}
        role="img"
        aria-label={description}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="size-full"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <defs>
          {paths.map((p) => (
            <linearGradient key={p.name} id={`${gradientId}-${p.name}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: p.color, stopOpacity: 0.22 }} />
              <stop offset="100%" style={{ stopColor: p.color, stopOpacity: 0 }} />
            </linearGradient>
          ))}
        </defs>

        {/* Y-axis grid — horizontal rules at each nice tick, no vertical border (the plot reads against the page, not a boxed frame). */}
        {yTicks.map((t) => (
          <line
            key={t}
            x1={padLeft}
            x2={width - padRight}
            y1={yAt(t)}
            y2={yAt(t)}
            className="stroke-[var(--color-line)]"
            strokeWidth={0.6}
          />
        ))}
        {yTicks.map((t) => (
          <text
            key={t}
            x={padLeft - 8}
            y={yAt(t)}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-[var(--color-text-tertiary)]"
            fontSize={10}
          >
            {formatValue(t)}
          </text>
        ))}

        {/* X-axis labels — sparse subset, per `maxAxisLabels`. */}
        {axisLabelIndices.map((i) => (
          <text
            key={i}
            x={xAt(i)}
            y={height - 6}
            textAnchor="middle"
            className="fill-[var(--color-text-tertiary)]"
            fontSize={10}
          >
            {labels[i]}
          </text>
        ))}

        {hoverIndex !== null && (
          <line
            x1={xAt(hoverIndex)}
            x2={xAt(hoverIndex)}
            y1={padTop}
            y2={padTop + plotHeight}
            className="stroke-[var(--color-line-strong)]"
            strokeWidth={1}
            strokeDasharray="2 2"
          />
        )}

        {paths.map((p) => (
          <path key={p.name} d={p.area} fill={`url(#${gradientId}-${p.name})`} stroke="none" />
        ))}
        {paths.map((p) => (
          <path
            key={p.name}
            d={p.line}
            fill="none"
            stroke={p.color}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {hoverIndex !== null &&
          paths.map((p) => (
            <circle
              key={p.name}
              cx={xAt(hoverIndex)}
              cy={yAt(p.values[hoverIndex] ?? 0)}
              r={3}
              fill={p.color}
              stroke="var(--color-surface)"
              strokeWidth={1.5}
            />
          ))}
      </svg>

      {/* The dense-content rule (ADR-024) applies here too: the tooltip sits
          over a chart, not chrome, so it stays solid, not glass. */}
      {hoverIndex !== null && (
        <div
          className="verity-solid pointer-events-none absolute top-1 -translate-x-1/2 whitespace-nowrap rounded-[10px] px-3 py-1.5 text-[12.5px] text-text shadow-sm"
          style={{ left: `${tooltipLeftPct}%` }}
        >
          <span className="text-text-tertiary">{labels[hoverIndex]}</span>
          {series.map((s) => (
            <span key={s.name}>
              {" · "}
              {s.name} <span className="tabular font-medium">{formatValue(s.values[hoverIndex] ?? 0)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
