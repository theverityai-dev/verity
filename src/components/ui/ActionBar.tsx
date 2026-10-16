import type { ReactNode } from "react";

/**
 * The stage's outcomes, always in view (ADR-046 §8; the shop-floor mockup's footer:
 * "Mark stage complete · Hold stage · Send back").
 *
 * Layout only. The caller passes real command buttons in consequence order: proceed (filled
 * `primary`), defer (gray `secondary`), reverse (red-tinted `danger`). Sticky to the bottom of its
 * scrolling container so a long checklist never pushes the decision off screen.
 */
export function ActionBar({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 border-t border-line bg-[var(--color-surface)] px-4 pb-4 pt-3">
      {note && <div className="mb-2 text-[13px] text-text-tertiary">{note}</div>}
      <div className="flex flex-wrap items-center gap-2 [&>*:first-child]:flex-1 sm:[&>*:first-child]:flex-none">{children}</div>
    </div>
  );
}
