import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Icon } from "./icons";

/**
 * Shared graphics for work that moves through stages in counted pieces (the piecework capability, and any later
 * capability that counts units through a line): where the pieces of one bundle are, and where the bundles are.
 *
 * Colour is STATE, never decoration (ADR-046): green is accepted good output, blue is pieces out with a worker,
 * orange is rework waiting, red is rejected, grey is short. Every graphic carries its figures as text, so colour is
 * never the only signal. Server-rendered, no chart library.
 */

export type PieceCounts = {
  /** Good pieces that reached the end of the line. */
  ready: number;
  /** Pieces currently out with a karigar. */
  out: number;
  rework: number;
  rejected: number;
  short: number;
};

const PARTS = [
  { key: "ready", label: "Ready", color: "var(--color-state-completed)" },
  { key: "out", label: "With karigars", color: "var(--color-state-active)" },
  { key: "rework", label: "Rework", color: "var(--color-state-pending)" },
  { key: "rejected", label: "Rejected", color: "var(--color-state-blocked)" },
  { key: "short", label: "Short", color: "var(--color-state-draft)" },
] as const;

const TICKS = 24;

/** Pieces of a bundle (or a lot, or the whole factory) accounted for by where they are. The rest is "Waiting". */
export function PieceBar({
  counts,
  total,
  label,
  size = "md",
  legend = true,
}: {
  counts: PieceCounts;
  /** The whole the bar is measured against (net pieces). Pieces not in any part are waiting between stages. */
  total: number;
  label: string;
  size?: "sm" | "md" | "lg";
  legend?: boolean;
}) {
  const accounted = PARTS.reduce((s, p) => s + counts[p.key], 0);
  const whole = Math.max(total, accounted, 1);
  const waiting = Math.max(0, total - accounted);
  const height = size === "lg" ? "h-4" : size === "md" ? "h-2.5" : "h-1.5";
  const summary = [...PARTS.map((p) => `${counts[p.key]} ${p.label.toLowerCase()}`), `${waiting} waiting`].join(", ");
  // ADR-053: the small bar is a 24-tick scale (one tick is a 24th of the whole), the larger bars are continuous.
  const ticks: string[] = [];
  if (size === "sm") {
    for (const p of PARTS) {
      const n = counts[p.key];
      if (n <= 0) continue;
      const t = Math.max(1, Math.round((n / whole) * TICKS));
      for (let i = 0; i < t && ticks.length < TICKS; i++) ticks.push(p.color);
    }
    while (ticks.length < TICKS) ticks.push("var(--color-control-strong)");
  }
  return (
    <figure className="m-0 min-w-0">
      {size === "sm" ? (
        <div role="img" aria-label={`${label}: ${summary}`} className="grid h-3.5 w-full gap-[2px]" style={{ gridTemplateColumns: `repeat(${TICKS}, minmax(0, 1fr))` }}>
          {ticks.map((c, i) => (
            <i key={i} className="rounded-[2px]" style={{ backgroundColor: c }} />
          ))}
        </div>
      ) : (
        <div role="img" aria-label={`${label}: ${summary}`} className={`flex w-full gap-[2px] overflow-hidden rounded-full bg-[var(--color-control-strong)] ${height}`}>
          {PARTS.map((p) =>
            counts[p.key] > 0 ? <span key={p.key} className="h-full" style={{ width: `${(counts[p.key] / whole) * 100}%`, minWidth: 4, backgroundColor: p.color }} /> : null,
          )}
        </div>
      )}
      {legend && (
        <ul className="m-0 mt-2.5 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[13px] text-text-secondary">
          {PARTS.filter((p) => counts[p.key] > 0).map((p) => (
            <li key={p.key} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: p.color }} />
              {p.label}
              <span className="tabular font-semibold text-text">{counts[p.key]}</span>
            </li>
          ))}
          {waiting > 0 && (
            <li className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2 rounded-full bg-[var(--color-control-strong)]" />
              Waiting
              <span className="tabular font-semibold text-text">{waiting}</span>
            </li>
          )}
        </ul>
      )}
    </figure>
  );
}

/* ------------------------------- floor board ------------------------------- */

export type FloorCard = {
  id: string;
  href: string;
  /** The bundle number. */
  title: string;
  /** Pieces in the bundle. */
  total: number;
  /** "LOT-0001 · Spring formals" */
  subtitle: string;
  /** Who holds it, or why it is waiting. */
  holder: string;
  counts: PieceCounts;
  /** "3 days here". */
  age?: string;
  late?: boolean;
};

export type FloorLane = {
  key: string;
  label: string;
  /** "98 pieces out" under the lane title. */
  tally: string;
  cards: readonly FloorCard[];
  /** The lane where finished work rests: drawn quieter and without a "nothing here" apology. */
  done?: boolean;
};

function Card({ card }: { card: FloorCard }) {
  return (
    <Link
      href={card.href}
      className="glass-inset group block rounded-[16px] p-3.5 no-underline transition-[transform,box-shadow] duration-150 hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[20px] font-light leading-[24px] tracking-[-0.03em] text-text">{card.title}</span>
        <span className="micro tabular">{card.total} pcs</span>
      </div>
      <p className="m-0 mt-0.5 truncate text-[13px] leading-[18px] text-text-secondary">{card.subtitle}</p>
      <div className="mt-2.5">
        <PieceBar counts={card.counts} total={card.total} label={`${card.title} pieces`} size="sm" legend={false} />
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2 text-[13px] leading-[18px]">
        <span className="min-w-0 truncate text-text">{card.holder}</span>
        {card.late ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ color: "var(--color-state-blocked)", backgroundColor: "color-mix(in srgb, var(--color-state-blocked) 14%, transparent)" }}>
            <Icon name="flag" size={12} />
            Late
          </span>
        ) : (
          card.age && <span className="shrink-0 text-text-tertiary">{card.age}</span>
        )}
      </div>
    </Link>
  );
}

/**
 * The factory floor: one lane per stage in order, bundles standing where they are. It reads as a line, left to right,
 * and answers "where is everything?" without a click. On a phone the lanes scroll sideways and snap.
 */
export function FloorBoard({ lanes, label, empty }: { lanes: readonly FloorLane[]; label: string; empty?: ReactNode }) {
  const bundles = lanes.reduce((s, l) => s + l.cards.length, 0);
  if (bundles === 0 && empty) return <>{empty}</>;
  return (
    <div role="group" aria-label={label}>
      {/* One column per lane while they fit (never less than 160px each), then they wrap: no lane is ever clipped or hidden behind a sideways scroll. */}
      <ol
        className="m-0 grid list-none gap-3 p-0"
        style={{ "--n": lanes.length, gridTemplateColumns: "repeat(auto-fit, minmax(max(160px, calc((100% - (var(--n) - 1) * 12px) / var(--n))), 1fr))" } as CSSProperties}
      >
        {lanes.map((lane, i) => (
          <li key={lane.key} className="flex min-w-0 list-none flex-col rounded-[20px] bg-[var(--glass-2)] p-2.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
            <div className="flex items-start gap-2 px-1 pb-2.5 pt-1">
              <span
                aria-hidden="true"
                className="tabular mt-px grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-bold"
                style={lane.done ? { backgroundColor: "var(--color-state-completed)", color: "#fff" } : { backgroundColor: "var(--color-control-strong)", color: "var(--color-text-secondary)" }}
              >
                {lane.done ? <Icon name="check" size={13} /> : i + 1}
              </span>
              <div className="min-w-0">
                <h3 className="m-0 truncate text-[15px] font-medium leading-[20px] tracking-[-0.02em] text-text">{lane.label}</h3>
                <p className="micro m-0">{lane.tally}</p>
              </div>
            </div>
            <ul className="m-0 flex list-none flex-1 flex-col gap-2 p-0">
              {lane.cards.length === 0 ? (
                <li aria-hidden="true" className="grid min-h-16 flex-1 place-items-center rounded-[10px] border border-dashed border-[var(--color-line)] text-[13px] text-text-tertiary">
                  {lane.done ? "Nothing ready yet" : "No bundle here"}
                </li>
              ) : (
                lane.cards.map((c) => (
                  <li key={c.id} className="list-none">
                    <Card card={c} />
                  </li>
                ))
              )}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* -------------------------------- piece ring ------------------------------- */

/**
 * The instrument gauge (ADR-053): a thin ring split into the five piece classes over a tick scale, with a figure in the
 * middle. Colour is state; the legend lives beside it as text, so the ring is never the only carrier of a figure.
 */
export function PieceRing({ counts, total, label, size = 240, children }: { counts: PieceCounts; total: number; label: string; size?: number; children?: ReactNode }) {
  const r = 108;
  const c = 2 * Math.PI * r;
  const whole = Math.max(total, PARTS.reduce((s, p) => s + counts[p.key], 0), 1);
  const present = PARTS.filter((p) => counts[p.key] > 0);
  const lens = present.map((p) => (counts[p.key] / whole) * c);
  const arcs = present.map((p, i) => ({ key: p.key, color: p.color, dash: Math.max(lens[i]! - 1.2, 0.5), offset: -lens.slice(0, i).reduce((s, x) => s + x, 0) }));
  const summary = PARTS.map((p) => `${counts[p.key]} ${p.label.toLowerCase()}`).join(", ");
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 272 272" width={size} height={size} role="img" aria-label={`${label}: ${summary}, of ${whole}`}>
        <circle cx="136" cy="136" r="130" fill="none" stroke="var(--color-line)" strokeWidth="10" strokeDasharray="1.4 11.9" />
        <g transform="rotate(-90 136 136)" fill="none" strokeWidth="9">
          <circle cx="136" cy="136" r={r} stroke="var(--color-track)" />
          {arcs.map((a) => (
            <circle key={a.key} cx="136" cy="136" r={r} stroke={a.color} strokeDasharray={`${a.dash} ${c}`} strokeDashoffset={a.offset} />
          ))}
        </g>
      </svg>
      {children && <div className="absolute inset-0 grid place-items-center text-center">{children}</div>}
    </div>
  );
}

/* -------------------------------- money bar -------------------------------- */

export type MoneyParts = { wagesMinor: number; paidMinor: number; recoveredMinor: number; deductionMinor: number; balanceMinor: number };

/**
 * One worker's wages split into where they went: paid out, taken back against an advance, deducted, and still owed.
 * The parts add up to the wages by construction (balance = wages - recovered - deductions - paid), so the bar is whole.
 */
export function MoneyBar({ parts, format, label }: { parts: MoneyParts; format: (minor: number) => string; label: string }) {
  const items = [
    { key: "paid", label: "Paid", value: parts.paidMinor, color: "var(--color-state-completed)" },
    { key: "recovered", label: "Advance recovered", value: parts.recoveredMinor, color: "var(--color-state-active)" },
    { key: "deduction", label: "Deductions", value: parts.deductionMinor, color: "var(--color-state-blocked)" },
    { key: "due", label: "Still owed", value: Math.max(0, parts.balanceMinor), color: "var(--color-state-pending)" },
  ];
  const whole = Math.max(1, parts.wagesMinor, items.reduce((s, i) => s + i.value, 0));
  const shown = items.filter((i) => i.value > 0);
  return (
    <figure className="m-0 min-w-0">
      <div role="img" aria-label={`${label}: ${shown.map((i) => `${i.label.toLowerCase()} ${format(i.value)}`).join(", ") || "no wages yet"}`} className="flex h-4 w-full overflow-hidden rounded-full bg-[var(--color-control-strong)]">
        {shown.map((i) => (
          <span key={i.key} className="h-full" style={{ width: `${(i.value / whole) * 100}%`, backgroundColor: i.color }} />
        ))}
      </div>
      <ul className="m-0 mt-2.5 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[13px] text-text-secondary">
        {shown.map((i) => (
          <li key={i.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: i.color }} />
            {i.label}
            <span className="tabular font-semibold text-text">{format(i.value)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/* -------------------------------- stage pips ------------------------------- */

/**
 * The line a lot or bundle is travelling, as dots: stages behind it filled green, the one it is in ringed blue, the
 * rest grey. `at` is the stage label it stands in, "Ready" when it has finished, or null before it has started.
 */
export function StagePips({ stages, at }: { stages: readonly string[]; at: string | null }) {
  const index = at === "Ready" ? stages.length : at === null ? -1 : stages.indexOf(at);
  const sentence = index < 0 ? "Not started" : index >= stages.length ? "All stages done" : `At stage ${index + 1} of ${stages.length}, ${stages[index]}`;
  return (
    <span role="img" aria-label={sentence} className="inline-flex items-center gap-1">
      {stages.map((s, i) => {
        const done = i < index;
        const here = i === index;
        return (
          <span
            key={s}
            aria-hidden="true"
            title={s}
            className="size-2.5 rounded-full"
            style={
              done
                ? { backgroundColor: "var(--color-state-completed)" }
                : here
                  ? { backgroundColor: "var(--color-surface)", boxShadow: "inset 0 0 0 2.5px var(--color-state-active)" }
                  : { backgroundColor: "var(--color-control-strong)" }
            }
          />
        );
      })}
    </span>
  );
}

/* --------------------------------- bar list -------------------------------- */

export type BarListItem = { id: string; label: string; href?: string; value: number; display: string; note?: string };

/** Who holds how much, or who is owed how much: a name, a bar scaled to the largest, and the figure. */
export function BarList({ items, label, tone = "active" }: { items: readonly BarListItem[]; label: string; tone?: "active" | "pending" | "completed" }) {
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col gap-3.5 p-0">
      {items.map((i) => {
        const name = i.href ? (
          <Link href={i.href} className="truncate text-[15px] font-medium text-accent-ink no-underline hover:underline">{i.label}</Link>
        ) : (
          <span className="truncate text-[15px] font-medium text-text">{i.label}</span>
        );
        return (
          <li key={i.id} className="list-none">
            <div className="flex items-baseline justify-between gap-3">
              {name}
              <span className="tabular shrink-0 text-[15px] font-semibold text-text">{i.display}</span>
            </div>
            <div aria-hidden="true" className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-control-strong)]">
              <div className="h-full rounded-full" style={{ width: `${(Math.abs(i.value) / max) * 100}%`, backgroundColor: `var(--color-state-${tone})` }} />
            </div>
            {i.note && <p className="m-0 mt-1 text-[13px] leading-[18px] text-text-secondary">{i.note}</p>}
          </li>
        );
      })}
    </ul>
  );
}

/** Maps a bundle row's figures onto the shared counts. `out` is what is with karigars right now. */
export function countsOf(b: { readyPieces: number; pendingPieces: number; reworkPieces: number; rejectedPieces: number; shortPieces: number }): PieceCounts {
  return { ready: b.readyPieces, out: b.pendingPieces, rework: b.reworkPieces, rejected: b.rejectedPieces, short: b.shortPieces };
}
