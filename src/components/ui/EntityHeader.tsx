import type { ReactNode } from "react";
import Link from "next/link";
import { Icon } from "./icons";
import { StateBadge } from "./primitives";

/**
 * The record header from the route-detail mockup (ADR-046 §8, Task 127 §1.1):
 *
 *   Routes / DRY-TRAFO
 *   Cast resin transformer  [DRY-TRAFO]  (● Active)          [Edit route] [More]
 *   Production route · 6 stages
 *
 * Identity is name + code + state on one line; meta is counts joined by a middot; one primary action,
 * the rest in an overflow the caller passes. `PageHeader` stays for list and dashboard pages.
 */

export type Crumb = { label: string; href?: string };

export function Breadcrumb({ items }: { items: readonly Crumb[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="mb-1">
      <ol className="m-0 flex list-none flex-wrap items-center gap-1 p-0 text-[15px]">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={item.label + i} className="inline-flex items-center gap-1">
              {item.href && !last ? (
                <Link href={item.href} className="inline-flex min-h-8 items-center text-accent-ink no-underline hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className="text-text-secondary">
                  {item.label}
                </span>
              )}
              {!last && <Icon name="chevronRight" size={14} className="text-text-tertiary" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function EntityHeader({
  crumbs = [],
  title,
  code,
  state,
  meta = [],
  description,
  actions,
}: {
  crumbs?: readonly Crumb[];
  title: string;
  /** The record's human reference (REQ-023), shown as a grey chip. */
  code?: string;
  /** `StateCategory` and the tenant's label. Colour comes from the category only (ADR-009). */
  state?: { category: string; label?: string };
  /** Short facts joined by a middot: "Production route", "6 stages". */
  meta?: readonly string[];
  /** One line explaining the business rule of the page (PRN-001). */
  description?: string;
  /** Primary action first, then an overflow menu. */
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6">
      <Breadcrumb items={crumbs} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="m-0 break-words">{title}</h1>
            {code && (
              <span className="tabular rounded-[8px] bg-[var(--color-control)] px-2 py-0.5 text-[13px] font-semibold text-text-secondary">
                {code}
              </span>
            )}
            {state && <StateBadge category={state.category} label={state.label} />}
          </div>
          {meta.length > 0 && (
            <p className="m-0 mt-1.5 text-[15px] text-text-secondary">{meta.join(" · ")}</p>
          )}
          {description && (
            <p className="m-0 mt-1 max-w-[62ch] text-[15px] leading-[20px] text-text-secondary">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
