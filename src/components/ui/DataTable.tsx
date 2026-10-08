"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState, HealthBadge, StateBadge, Surface } from "./primitives";
import { Icon } from "./icons";

/**
 * The platform data table.
 *
 * Authority: Bible V4 §1.A (high density on desktop, one primary thing at a
 * time on mobile), and the board's table treatment.
 *
 * WHAT THE MOCKUP'S TABLE IS
 * A toolbar of 44px controls with the primary action at the right end, then
 * column labels under a hairline, then rows separated by hairlines and nothing
 * else — no card frame, no vertical rules, no zebra striping. Rows breathe at
 * ~64px because the first column carries two lines: the record's name and its
 * reference beneath in lighter ink.
 *
 * The first column keeps full-strength ink and every other column steps back.
 * That is what makes an operational table scannable: the eye goes DOWN the
 * first column looking for a record, then across.
 *
 * WHAT IS DELIBERATELY ABSENT
 * The mockup's trailing "Actions" column. Its "⋮" implies a menu of per-row
 * actions, and this platform has exactly one thing to do with a row — open it —
 * which the first column already does. Rendering it as a second link to the
 * same destination gave every row two links with overlapping accessible names
 * ("Demo Support Vehicle" and "Open Demo Support Vehicle"), which is ambiguous
 * to a screen reader and to any name-based query. It returns when a capability
 * contributes a row action that is not "open".
 *
 * TWO ARCHITECTURAL NOTES
 * Columns are supplied by the caller from platform metadata, so a field the
 * actor may not read never reaches this component — Layer 3 strips it
 * server-side. There is deliberately no "hidden field" concept: rendering an
 * unauthorised field as an empty placeholder would leak its existence.
 *
 * Columns are declared as data, not as render callbacks. This is a client
 * component and its callers are Server Components, so a function cannot cross
 * that boundary — but the deeper reason is that a serialisable column spec keeps
 * cell rendering uniform. A per-call render function is where one table quietly
 * starts formatting dates differently from every other.
 */

/**
 * Rows rendered before the reader has to ask for more.
 *
 * Not a nicety. On a phone each row becomes a stacked block, so an unpaged audit
 * table of 100 rows rendered a 13,000px page — technically responsive and
 * genuinely unusable. Paging here fixes every long table at once rather than
 * each page working around it.
 */
const PAGE = 25;

/**
 * The page numbers to draw: always the first and last, always the current and
 * its neighbours, and an ellipsis for each gap. `null` is a gap.
 *
 * Rendering every page is fine at three pages and unusable at ninety, which is
 * exactly the range an audit table covers.
 */
export function pageNumbers(current: number, total: number): Array<number | null> {
  const keep = new Set([0, total - 1, current - 1, current, current + 1]);
  const pages = [...keep].filter((n) => n >= 0 && n < total).sort((a, b) => a - b);

  const out: Array<number | null> = [];
  pages.forEach((n, i) => {
    if (i > 0 && n - pages[i - 1]! > 1) out.push(null);
    out.push(n);
  });
  return out;
}

export type ColumnVariant = "text" | "link" | "state" | "health";

export type Column = {
  key: string;
  header: string;
  /** Right-align numerics so magnitudes line up. */
  numeric?: boolean;
  sortable?: boolean;
  variant?: ColumnVariant;
  /** For `link`: an href with {field} placeholders, e.g. "/assets/{id}". */
  href?: string;
  /** For `state`: the row field holding the canonical StateCategory. */
  categoryKey?: string;
  /** Secondary line rendered beneath the value, from another row field. */
  subKey?: string;
};

function fillTemplate(template: string, row: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, field: string) => String(row[field] ?? ""));
}

export function Cell({
  column,
  row,
  lead,
}: {
  column: Column;
  row: Record<string, unknown>;
  lead: boolean;
}) {
  const raw = row[column.key];
  const value = raw === null || raw === undefined || raw === "" ? "—" : String(raw);
  const sub = column.subKey ? row[column.subKey] : undefined;

  const body =
    column.variant === "link" && column.href ? (
      <Link
        href={fillTemplate(column.href, row)}
        className="text-text no-underline hover:text-accent-ink hover:underline"
      >
        {value}
      </Link>
    ) : column.variant === "state" ? (
      <StateBadge category={String(row[column.categoryKey ?? "category"] ?? "Draft")} label={value} />
    ) : column.variant === "health" ? (
      <HealthBadge health={value} />
    ) : (
      // The identity column keeps full-strength ink; everything else steps back
      // so the first column reads as the row's subject rather than as data.
      <span className={lead ? "text-text" : "text-text-secondary"}>{value}</span>
    );

  if (sub) {
    return (
      <span className="flex flex-col gap-0.5">
        {body}
        <span className="text-[12px] text-text-tertiary">{String(sub)}</span>
      </span>
    );
  }
  return body;
}

export function DataTable({
  columns,
  rows,
  caption,
  rowKey = "id",
  emptyTitle = "Nothing here yet",
  emptyDescription,
  emptyAction,
  filterable = true,
  toolbar,
  bulkActions,
  rowActions,
}: {
  columns: Column[];
  rows: Array<Record<string, unknown>>;
  caption: string;
  /** Field holding a stable identity for each row. */
  rowKey?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  filterable?: boolean;
  /** Extra controls in the toolbar, right-aligned beside the filter. */
  toolbar?: React.ReactNode;
  /**
   * Renders in place of the row-count line once 1+ rows are checked (Task
   * 114 P1.5 item 2). Given the selected keys and a callback to clear the
   * selection — the caller owns what "assign" or "add task" actually does,
   * this component only owns which keys are checked.
   */
  bulkActions?: (selectedKeys: string[], clear: () => void) => React.ReactNode;
  /**
   * Task 121 §3.2 — a per-row action (button, link, or small cluster) that
   * doesn't fit `Column`'s declarative variants: a privileged write (Enable/
   * Disable, Clear, Settle, Raise bill) that must stay a real control, not a
   * second navigation link with an overlapping accessible name (see this
   * file's own "WHAT IS DELIBERATELY ABSENT" note above — that note is about
   * a redundant "open" action; this is for a row action that is NOT "open").
   * A function prop, so only a client-component caller can pass one, same
   * constraint as `bulkActions`/`toolbar` above it. Renders as a trailing,
   * unlabelled column on desktop and beneath the record on mobile; omitted
   * entirely when not given, so every existing caller is unaffected.
   */
  rowActions?: (row: Record<string, unknown>) => React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // Selection exists to feed bulk actions. Without any, a checkbox per row is a
  // control that does nothing (iOS shows selection circles only in edit mode).
  const selectable = Boolean(bulkActions);

  const visible = useMemo(() => {
    let out = rows;

    if (query.trim()) {
      const needle = query.toLowerCase();
      out = out.filter((row) =>
        columns.some((c) => String(row[c.key] ?? "").toLowerCase().includes(needle)),
      );
    }

    if (sort) {
      out = [...out].sort((a, b) => {
        const av = a[sort.key];
        const bv = b[sort.key];
        if (av === bv) return 0;
        const result =
          typeof av === "number" && typeof bv === "number"
            ? av - bv
            : String(av ?? "").localeCompare(String(bv ?? ""));
        return sort.dir === "asc" ? result : -result;
      });
    }
    return out;
  }, [rows, columns, query, sort]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE));
  const current = Math.min(page, pageCount - 1);
  const shown = visible.slice(current * PAGE, current * PAGE + PAGE);

  const shownKeys = shown.map((r) => String(r[rowKey]));
  const allShownSelected = shownKeys.length > 0 && shownKeys.every((k) => selected.has(k));

  function toggleRow(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllShown() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allShownSelected) shownKeys.forEach((k) => next.delete(k));
      else shownKeys.forEach((k) => next.add(k));
      return next;
    });
  }

  if (rows.length === 0) {
    // A caller that passes `toolbar` (its creation form) but never sets
    // `emptyAction` would otherwise strand a fresh tenant on a table with no
    // visible way to create the first record — `toolbar` only renders in the
    // populated branch below. Falling back to it here completes what this
    // prop was already documented to do, for every caller, not just the ones
    // that remembered to pass both.
    return (
      <Surface>
        <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction ?? toolbar} />
      </Surface>
    );
  }

  const showFilter = filterable && rows.length > 5;
  const showToolbar = showFilter || Boolean(toolbar);

  return (
    <div>
      {showToolbar && (
        <div className="mb-5 flex flex-wrap items-center gap-3">
          {showFilter && (
            <div className="relative flex min-w-0 flex-1 items-center sm:max-w-[24rem]">
              <Icon
                name="search"
                size={16}
                className="pointer-events-none absolute left-3 text-text-tertiary"
              />
              <label htmlFor={`filter-${rowKey}`} className="sr-only">
                Filter {caption}
              </label>
              {/* The board's toolbar field: bordered, 10px radius, glyph inside
                  on the left. The placeholder says "Filter" rather than "Search"
                  because that is what it does — it narrows the rows already on
                  screen, and calling it search would promise a platform
                  capability that does not exist yet. */}
              <input
                id={`filter-${rowKey}`}
                type="search"
                placeholder="Filter…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                // iOS search field: system fill, 10px corners, glyph inside.
                className="h-9 max-sm:h-11 w-full rounded-[10px] border-0 bg-[var(--color-control)] pl-9 pr-3 text-[15px] text-text placeholder:text-text-tertiary transition-shadow focus:shadow-[0_0_0_3px_var(--color-accent-subtle)] focus:outline-none"
              />
            </div>
          )}
          {toolbar && <div className="ml-auto flex items-center gap-2.5">{toolbar}</div>}
        </div>
      )}

      {visible.length === 0 ? (
        <Surface>
          <EmptyState
            title="No matches"
            description={`Nothing in ${caption.toLowerCase()} matches “${query}”.`}
          />
        </Surface>
      ) : (
        <>
          {/* Desktop: dense grid */}
          <div className="-mx-2 hidden overflow-x-auto px-2 md:block">
            <table className="w-full border-collapse text-[14px]">
              <caption className="sr-only">{caption}</caption>
              <thead>
                <tr className="border-b border-line">
                  {selectable && (
                  <th scope="col" className="w-11 pb-3 pl-0 pr-1">
                    {/* APPLE-P1-06: a bare 15px native checkbox is too small a
                        pointer/touch target on its own — wrapped so the
                        CLICKABLE area is 44px even though the visible box
                        stays a normal checkbox size, matching the shared
                        `Checkbox` primitive's own size and focus ring. */}
                    <span className="grid size-11 cursor-pointer place-items-center">
                      <input
                        type="checkbox"
                        checked={allShownSelected}
                        onChange={toggleAllShown}
                        aria-label={`Select all ${caption.toLowerCase()} on this page`}
                        className="size-[18px] cursor-pointer rounded-[5px] border-line-strong align-middle accent-[var(--color-accent)] focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--color-accent-subtle)]"
                      />
                    </span>
                  </th>
                  )}
                  {columns.map((c) => {
                    const sorted = sort?.key === c.key;
                    const label = (
                      <>
                        {c.header}
                        <span aria-hidden="true" className="ml-1">
                          {sorted ? (sort!.dir === "asc" ? "↑" : "↓") : ""}
                        </span>
                      </>
                    );
                    return (
                      <th
                        key={c.key}
                        scope="col"
                        aria-sort={
                          sorted ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined
                        }
                        className={
                          "whitespace-nowrap px-4 pb-3 text-[13px] font-normal text-text-tertiary " +
                          (c.numeric ? "text-right" : "text-left") +
                          // The first column carries the cell inset when no selection column precedes it.
                          (!selectable && c.key === columns[0]?.key ? " pl-6" : "")
                        }
                      >
                        {c.sortable === false ? (
                          label
                        ) : (
                          <button
                            type="button"
                            className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-normal text-text-tertiary transition-colors hover:text-text"
                            onClick={() =>
                              setSort((s) =>
                                s?.key === c.key
                                  ? { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" }
                                  : { key: c.key, dir: "asc" },
                              )
                            }
                          >
                            {label}
                          </button>
                        )}
                      </th>
                    );
                  })}
                  {rowActions && <th scope="col" className="w-px pb-3" />}
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const key = String(row[rowKey]);
                  return (
                  <tr
                    key={key}
                    data-selected={selected.has(key) || undefined}
                    className="border-b border-line transition-colors last:border-b-0 hover:bg-[var(--color-control)] data-selected:bg-accent-subtle"
                  >
                    {selectable && (
                    <td className="w-11 py-1 pl-0 pr-1 align-middle">
                      <span className="grid size-11 cursor-pointer place-items-center">
                        <input
                          type="checkbox"
                          checked={selected.has(key)}
                          onChange={() => toggleRow(key)}
                          aria-label={`Select ${String(row[columns[0]!.key] ?? key)}`}
                          className="size-[18px] cursor-pointer rounded-[5px] border-line-strong align-middle accent-[var(--color-accent)] focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--color-accent-subtle)]"
                        />
                      </span>
                    </td>
                    )}
                    {columns.map((c, i) => (
                      <td
                        key={c.key}
                        className={
                          "px-4 py-2.5 align-middle " + (c.numeric ? "tabular text-right" : "") + (!selectable && i === 0 ? " pl-6" : "")
                        }
                      >
                        <Cell column={c} row={row} lead={i === 0} />
                      </td>
                    ))}
                    {rowActions && (
                      <td className="whitespace-nowrap px-4 py-2.5 text-right align-middle">
                        {rowActions(row)}
                      </td>
                    )}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: one record per block. The first column becomes the block's
              heading rather than another label/value pair — repeating "Location:
              Demo Depot Site" wastes the one line that matters most. */}
          <ul className="m-0 list-none divide-y divide-line p-0 md:hidden">
            {shown.map((row) => {
              const [lead, ...rest] = columns;
              return (
                <li key={String(row[rowKey])} className="flex flex-col gap-2 py-4">
                  <div className="text-[15px]">
                    <Cell column={lead!} row={row} lead />
                  </div>
                  <div className="flex flex-col gap-1">
                    {rest.map((c) => (
                      <div key={c.key} className="flex items-baseline justify-between gap-4">
                        <span className="shrink-0 text-[12px] text-text-tertiary">{c.header}</span>
                        <span className={"min-w-0 text-right text-[13px] " + (c.numeric ? "tabular" : "")}>
                          <Cell column={c} row={row} lead={false} />
                        </span>
                      </div>
                    ))}
                  </div>
                  {rowActions && <div className="flex justify-end gap-2 pt-1">{rowActions(row)}</div>}
                </li>
              );
            })}
          </ul>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
            {selected.size > 0 && bulkActions ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-accent/30 bg-accent-subtle px-3 py-2">
                <p className="m-0 text-[13px] font-medium text-accent-ink" aria-live="polite">
                  {selected.size} selected
                </p>
                {bulkActions([...selected], () => setSelected(new Set()))}
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="rounded-md px-2 py-1 text-[12px] text-text-tertiary transition-colors hover:text-text"
                >
                  Clear
                </button>
              </div>
            ) : (
              <p className="m-0 text-[13px] text-text-tertiary" aria-live="polite">
                {selected.size > 0
                  ? `${selected.size} selected`
                  : `Showing ${current * PAGE + 1} to ${current * PAGE + shown.length} of ${visible.length} ${visible.length === 1 ? "record" : "records"}`}
              </p>
            )}

            {/* The mockup's numbered pager. It is only drawn when there is more
                than one page — a pager showing a lone "1" is chrome that tells
                the reader nothing. */}
            {pageCount > 1 && (
              <nav aria-label={`${caption} pages`} className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPage(current - 1)}
                  disabled={current === 0}
                  aria-label="Previous page"
                  className="grid size-9 max-sm:size-11 cursor-pointer place-items-center rounded-[12px] bg-surface text-text-secondary transition-colors hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Icon name="collapse" size={16} />
                </button>

                {pageNumbers(current, pageCount).map((n, i) =>
                  n === null ? (
                    <span key={`gap-${i}`} className="px-1 text-[13px] text-text-tertiary">
                      …
                    </span>
                  ) : (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setPage(n)}
                      aria-current={n === current ? "page" : undefined}
                      className={
                        "tabular grid h-9 min-w-9 max-sm:h-11 max-sm:min-w-11 cursor-pointer place-items-center rounded-lg px-2 text-[13px] transition-colors " +
                        (n === current
                          ? "border border-accent text-accent-ink"
                          : " bg-surface text-text-secondary hover:bg-surface-sunken")
                      }
                    >
                      {n + 1}
                    </button>
                  ),
                )}

                <button
                  type="button"
                  onClick={() => setPage(current + 1)}
                  disabled={current >= pageCount - 1}
                  aria-label="Next page"
                  className="grid size-9 max-sm:size-11 cursor-pointer place-items-center rounded-[12px] bg-surface text-text-secondary transition-colors hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Icon name="expand" size={16} />
                </button>
              </nav>
            )}
          </div>
        </>
      )}
    </div>
  );
}
