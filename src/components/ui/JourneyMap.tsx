import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { IconTile } from "./IconTile";

/**
 * A process drawn as a journey (ADR-046 §8; the route-detail mockup's "Production journey").
 *
 * Numbered stage cards joined by arrows. On wide screens the cards run left to right in rows of
 * three and the rows are joined by an elbow, so the path reads as one line (a "snake"). On phones the
 * same steps become a vertical timeline. Content cells stay iOS cells: no border, no shadow; a card
 * is a cell inside a cell (`surface-sunken`), the selected one takes the tint fill and an inside ring.
 *
 * `status` is optional: a route (a template) has none; an order's journey (Phase 3) has one per stage
 * and the number disc takes that state's colour. Colour is never the only signal: the disc shows a
 * tick when done and the status word is read out.
 */

export type JourneyStatus = "done" | "active" | "blocked" | "held" | "pending";

export type JourneyStep = {
  key: string;
  label: string;
  /** A kind from `domains.ts` (`stage-winding`), for the icon tile. */
  kind: string;
  description?: string;
  chip?: { icon: IconName; label: string };
  status?: JourneyStatus;
  href?: string;
};

const STATUS: Record<JourneyStatus, { tone: string; word: string }> = {
  done: { tone: "completed", word: "done" },
  active: { tone: "active", word: "in progress" },
  blocked: { tone: "blocked", word: "blocked" },
  held: { tone: "pending", word: "on hold" },
  pending: { tone: "draft", word: "not started" },
};

function NumberDisc({ n, status, selected }: { n: number; status?: JourneyStatus; selected: boolean }) {
  const style = status
    ? status === "pending"
      ? { backgroundColor: "var(--color-control-strong)", color: "var(--color-text-secondary)" }
      : { backgroundColor: `var(--color-state-${STATUS[status].tone})`, color: "#fff" }
    : selected
      ? { backgroundColor: "var(--color-accent)", color: "var(--color-accent-on)" }
      : { backgroundColor: "var(--color-accent-subtle)", color: "var(--color-accent-ink)" };
  return (
    <span aria-hidden="true" className="tabular grid size-7 shrink-0 place-items-center rounded-full text-[14px] font-medium" style={style}>
      {status === "done" ? <Icon name="check" size={15} /> : n}
    </span>
  );
}

function Chip({ icon, label }: { icon: IconName; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-control)] px-2.5 py-1 text-[13px] text-text-secondary">
      <Icon name={icon} size={15} />
      {label}
    </span>
  );
}

function Card({ step, n, selected }: { step: JourneyStep; n: number; selected: boolean }) {
  const body: ReactNode = (
    <>
      <div className="flex items-start gap-3">
        <NumberDisc n={n} status={step.status} selected={selected} />
        <IconTile kind={step.kind} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[16px] font-semibold leading-[21px] text-text">{step.label}</p>
          {step.description && <p className="m-0 mt-1 text-[13px] leading-[18px] text-text-secondary">{step.description}</p>}
          {step.status && <span className="sr-only">, {STATUS[step.status].word}</span>}
        </div>
      </div>
      {step.chip && (
        <div className="mt-3 pl-10">
          <Chip {...step.chip} />
        </div>
      )}
    </>
  );
  const cls =
    "block h-full rounded-[12px] p-4 no-underline transition-colors " +
    (selected
      ? "bg-accent-subtle shadow-[inset_0_0_0_2px_var(--color-accent-line)]"
      : "bg-[var(--color-surface-sunken)]" + (step.href ? " hover:bg-[var(--color-control)]" : ""));
  return step.href ? (
    <Link href={step.href} aria-current={selected ? "step" : undefined} className={cls}>
      {body}
    </Link>
  ) : (
    <div aria-current={selected ? "step" : undefined} className={cls}>
      {body}
    </div>
  );
}

function Arrow() {
  return (
    <span aria-hidden="true" className="grid w-8 shrink-0 place-items-center self-center text-text-tertiary">
      <Icon name="chevronRight" size={20} />
    </span>
  );
}

/** The elbow joining the end of one row to the start of the next. */
function Elbow() {
  return (
    <div aria-hidden="true" className="relative mx-[calc(100%/6)] h-8 text-[var(--color-line-strong)]">
      <svg className="absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 32">
        <path d="M100 0 V12 Q100 16 96 16 H4 Q0 16 0 20 V32" fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export function JourneyMap({
  steps,
  selectedKey,
  label,
  perRow = 3,
}: {
  steps: readonly JourneyStep[];
  selectedKey?: string;
  label: string;
  perRow?: number;
}) {
  if (steps.length === 0) return null;
  const rows: JourneyStep[][] = [];
  for (let i = 0; i < steps.length; i += perRow) rows.push(steps.slice(i, i + perRow));

  return (
    <div>
      {/* Wide screens: rows joined by an elbow. */}
      <ol aria-label={label} className="m-0 hidden list-none p-0 lg:block">
        {rows.map((row, r) => (
          <li key={r} className="list-none">
            {r > 0 && <Elbow />}
            <ol className="m-0 flex list-none items-stretch p-0">
              {row.map((step, i) => {
                const n = r * perRow + i + 1;
                return (
                  <li key={step.key} className="flex min-w-0 flex-1 items-stretch">
                    {i > 0 && <Arrow />}
                    <div className="min-w-0 flex-1">
                      <Card step={step} n={n} selected={step.key === selectedKey} />
                    </div>
                  </li>
                );
              })}
              {/* Keep a short last row aligned to the grid above it. */}
              {Array.from({ length: perRow - row.length }).map((_, k) => (
                <li key={`pad-${k}`} aria-hidden="true" className="flex min-w-0 flex-1">
                  <span className="w-8 shrink-0" />
                  <span className="flex-1" />
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>

      {/* Phones and tablets: a vertical timeline. */}
      <ol aria-label={label} className="relative m-0 flex list-none flex-col gap-3 p-0 lg:hidden">
        <span aria-hidden="true" className="absolute bottom-6 left-[29px] top-6 w-px bg-[var(--color-line-strong)]" />
        {steps.map((step, i) => (
          <li key={step.key} className="relative">
            <Card step={step} n={i + 1} selected={step.key === selectedKey} />
          </li>
        ))}
      </ol>
    </div>
  );
}
