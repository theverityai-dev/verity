import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./icons";

/**
 * List + live detail pane (ADR-046 §8; the shop-floor mockup).
 *
 * `MasterDetail` lays a list and its pane side by side on wide screens. The pane is URL-driven: the
 * selected record is a search param, so the page stays a server component, the back button works and
 * a link to a selected row can be shared. On phones the same pane becomes an iOS bottom sheet over a
 * dimmed list; closing it is a link that clears the param.
 */

export function MasterDetail({ list, pane }: { list: ReactNode; pane?: ReactNode }) {
  return (
    <div className={pane ? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] lg:items-start" : ""}>
      <div className="min-w-0">{list}</div>
      {pane}
    </div>
  );
}

export function DetailPane({
  title,
  subtitle,
  openHref,
  closeHref,
  summary,
  children,
  footer,
  label,
}: {
  title: string;
  subtitle?: string;
  /** The full record page. */
  openHref?: string;
  /** The list URL without the selection. */
  closeHref: string;
  /** A row of facts under the title (current stage, n of N, quantity). */
  summary?: ReactNode;
  children: ReactNode;
  /** Usually an `ActionBar`. */
  footer?: ReactNode;
  label: string;
}) {
  return (
    <>
      {/* Phone: dim the list behind the sheet; tapping it closes. */}
      <Link href={closeHref} scroll={false} aria-label="Close" className="fixed inset-0 z-40 bg-black/40 lg:hidden" />
      <aside
        aria-label={label}
        className={
          "glass-card z-50 flex flex-col overflow-hidden " +
          // Phone: a bottom sheet. Wide: a sticky column beside the list.
          "fixed inset-x-0 bottom-0 max-h-[88dvh] rounded-b-none rounded-t-[16px] " +
          "lg:sticky lg:inset-auto lg:top-4 lg:max-h-[calc(100dvh-7.5rem)] lg:min-h-[min(560px,calc(100dvh-7.5rem))] lg:rounded-[12px]"
        }
      >
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-[var(--color-control-strong)] lg:hidden" aria-hidden="true" />
        <div className="flex items-start gap-2 px-4 pb-3 pt-3">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 flex items-center gap-2 text-[20px] font-medium leading-[25px] text-text">
              <span className="min-w-0 break-words">{title}</span>
              {openHref && (
                <Link href={openHref} aria-label={`Open ${title}`} className="grid size-8 shrink-0 place-items-center rounded-full text-accent-ink hover:bg-[var(--color-control)]">
                  <Icon name="expand" size={16} />
                </Link>
              )}
            </h2>
            {subtitle && <p className="m-0 mt-0.5 text-[14px] text-text-secondary">{subtitle}</p>}
          </div>
          <Link
            href={closeHref}
            scroll={false}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--color-control)] text-text-secondary hover:bg-[var(--color-control-strong)]"
          >
            <Icon name="close" size={15} />
          </Link>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {summary && <div className="mb-4 rounded-[12px] bg-[var(--color-surface-sunken)] p-3">{summary}</div>}
          {children}
        </div>
        {/* Outside the scroller: the outcomes stay pinned to the pane's bottom edge however long the checklist. */}
        {footer && <div className="shrink-0 px-4">{footer}</div>}
      </aside>
    </>
  );
}

/** A fact in the pane's summary strip: small label over a value. */
export function PaneFact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="m-0 text-[12px] text-text-tertiary">{label}</p>
      <p className="m-0 mt-0.5 text-[15px] font-semibold text-text">{value}</p>
    </div>
  );
}
