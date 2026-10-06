"use client";

import { useEffect, useState } from "react";

/**
 * The one quantity control for every list of lines (order pad, purchase order,
 * stock count, bill split): minus, a number you can type into, plus.
 *
 * At the minimum, minus becomes remove when `onRemove` is given, so a line can
 * always be taken back to nothing without hunting for a separate delete
 * button. The typed number commits on Enter or when focus leaves; an
 * out-of-range value is clamped, and an empty one restores the last good value
 * rather than becoming zero by accident.
 */
export function QuantityStepper({
  value,
  onChange,
  onRemove,
  min = 1,
  max = 999,
  disabled = false,
  label,
}: {
  value: number;
  onChange: (next: number) => void;
  onRemove?: () => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  /** What is being counted, for screen readers: "Butter Naan". */
  label: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  function commit() {
    const parsed = Number.parseInt(draft, 10);
    if (Number.isNaN(parsed)) {
      setDraft(String(value));
      return;
    }
    if (parsed < min && onRemove) {
      onRemove();
      return;
    }
    const next = Math.min(max, Math.max(min, parsed));
    setDraft(String(next));
    if (next !== value) onChange(next);
  }

  const removes = value <= min && Boolean(onRemove);
  const button =
    "grid size-11 place-items-center transition-opacity active:opacity-60 disabled:cursor-default disabled:opacity-40 cursor-pointer";

  return (
    <span className="inline-flex shrink-0 items-center rounded-[10px] bg-[var(--color-control)]" role="group" aria-label={`Quantity of ${label}`}>
      <button
        type="button"
        className={`${button} ${removes ? "text-danger" : "text-accent-ink"}`}
        disabled={disabled || (value <= min && !onRemove)}
        aria-label={removes ? `Remove ${label}` : `One fewer ${label}`}
        onClick={() => (removes ? onRemove?.() : onChange(value - 1))}
      >
        {removes ? (
          <svg aria-hidden="true" viewBox="0 0 20 20" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6h12M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6" />
          </svg>
        ) : (
          <svg aria-hidden="true" viewBox="0 0 20 20" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 10h10" />
          </svg>
        )}
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={`Quantity of ${label}`}
        className="tabular w-10 bg-transparent text-center text-[16px] font-semibold text-text outline-none focus-visible:rounded-[6px] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") setDraft(String(value));
        }}
      />
      <button
        type="button"
        className={`${button} text-accent-ink`}
        disabled={disabled || value >= max}
        aria-label={`One more ${label}`}
        onClick={() => onChange(value + 1)}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M5 10h10M10 5v10" />
        </svg>
      </button>
    </span>
  );
}
