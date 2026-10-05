"use client";

import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { Cell, pageNumbers, type Column } from "@/components/ui/DataTable";
import { EmptyState, Surface } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";

/**
 * The Smart Table — TanStack Table's headless core under `DataTable.tsx`'s
 * visual language, plus an `onRowClick` that opens a `ContextPanel` instead
 * of (or alongside) a link column.
 *
 * Authority: `Verity_Component_Specification.md` §3.A. A new component
 * rather than a `DataTable.tsx` rewrite — see that spec's migration note:
 * five existing call sites depend on `DataTable`'s current behavior, and this
 * is the first of them to move, not all of them at once.
 *
 * Sorting and pagination are TanStack's; filtering stays a simple pre-filter
 * (same behavior as `DataTable.tsx`) rather than TanStack's own filter model —
 * one row-matches-substring rule doesn't need a second filtering engine.
 */
const PAGE_SIZE = 25;

export function SmartTable({
  columns,
  rows,
  caption,
  rowKey = "id",
  emptyTitle = "Nothing here yet",
  emptyDescription,
  filterable = true,
  onRowClick,
}: {
  columns: Column[];
  rows: Array<Record<string, unknown>>;
  caption: string;
  rowKey?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  filterable?: boolean;
  /** Opens the Context Panel for this row instead of (or beside) a link column. */
  onRowClick?: (row: Record<string, unknown>) => void;
}) {
  const [query, setQuery] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);

  const filtered = useMemo(() => {
    if (!query.trim()) return rows;
    const needle = query.toLowerCase();
    return rows.filter((row) =>
      columns.some((c) =>
        String(row[c.key] ?? "")
          .toLowerCase()
          .includes(needle),
      ),
    );
  }, [rows, columns, query]);

  const tanstackColumns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () =>
      columns.map((c, i) => ({
        id: c.key,
        accessorKey: c.key,
        header: c.header,
        enableSorting: c.sortable !== false,
        cell: ({ row }) => (
          <Cell column={c} row={row.original} lead={i === 0} />
        ),
      })),
    [columns],
  );

  const table = useReactTable({
    data: filtered,
    columns: tanstackColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: PAGE_SIZE } },
  });

  if (rows.length === 0) {
    return (
      <Surface>
        <EmptyState title={emptyTitle} description={emptyDescription} />
      </Surface>
    );
  }

  const showFilter = filterable && rows.length > 5;
  const pageCount = table.getPageCount();
  const current = table.getState().pagination.pageIndex;
  const shown = table.getRowModel().rows;

  return (
    <div>
      {showFilter && (
        <div className="relative mb-5 flex min-w-0 max-w-[24rem] items-center">
          <Icon
            name="search"
            size={17}
            className="pointer-events-none absolute left-4 text-text-tertiary"
          />
          <label htmlFor={`filter-${rowKey}`} className="sr-only">
            Filter {caption}
          </label>
          <input
            id={`filter-${rowKey}`}
            type="search"
            placeholder="Filter…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              table.setPageIndex(0);
            }}
            className="h-11 w-full rounded-[10px] bg-control pl-12 pr-4 text-[14px] text-text placeholder:text-text-tertiary transition-colors focus:shadow-[0_0_0_3px_var(--color-accent-subtle)] focus:outline-none"
          />
        </div>
      )}

      {filtered.length === 0 ? (
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
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id} className="border-b border-line">
                    {headerGroup.headers.map((header) => {
                      const sorted = header.column.getIsSorted();
                      const label = (
                        <>
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          <span aria-hidden="true" className="ml-1">
                            {sorted === "asc"
                              ? "↑"
                              : sorted === "desc"
                                ? "↓"
                                : ""}
                          </span>
                        </>
                      );
                      const numeric = columns.find(
                        (c) => c.key === header.column.id,
                      )?.numeric;
                      return (
                        <th
                          key={header.id}
                          scope="col"
                          aria-sort={
                            sorted === "asc"
                              ? "ascending"
                              : sorted === "desc"
                                ? "descending"
                                : undefined
                          }
                          className={
                            "whitespace-nowrap px-4 pb-3 text-[13px] font-normal text-text-tertiary " +
                            (numeric ? "text-right" : "text-left")
                          }
                        >
                          {header.column.getCanSort() ? (
                            <button
                              type="button"
                              className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-normal text-text-tertiary transition-colors hover:text-text"
                              onClick={header.column.getToggleSortingHandler()}
                            >
                              {label}
                            </button>
                          ) : (
                            label
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr
                    key={row.id}
                    onClick={
                      onRowClick ? () => onRowClick(row.original) : undefined
                    }
                    className={
                      "border-b border-line transition-colors last:border-b-0 hover:bg-surface-sunken " +
                      (onRowClick ? "cursor-pointer" : "")
                    }
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={
                          "px-4 py-2.5 align-middle " +
                          (columns.find((c) => c.key === cell.column.id)
                            ?.numeric
                            ? "tabular text-right"
                            : "")
                        }
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: one record per block, same treatment as DataTable.tsx. */}
          <ul className="m-0 list-none divide-y divide-line p-0 md:hidden">
            {shown.map((row) => {
              const [lead, ...rest] = columns;
              return (
                <li
                  key={row.id}
                  onClick={
                    onRowClick ? () => onRowClick(row.original) : undefined
                  }
                  className={
                    "flex flex-col gap-2 py-4 " +
                    (onRowClick ? "cursor-pointer" : "")
                  }
                >
                  <div className="text-[15px]">
                    <Cell column={lead!} row={row.original} lead />
                  </div>
                  <div className="flex flex-col gap-1">
                    {rest.map((c) => (
                      <div
                        key={c.key}
                        className="flex items-baseline justify-between gap-4"
                      >
                        <span className="shrink-0 text-[12px] text-text-tertiary">
                          {c.header}
                        </span>
                        <span
                          className={
                            "min-w-0 text-right text-[13px] " +
                            (c.numeric ? "tabular" : "")
                          }
                        >
                          <Cell column={c} row={row.original} lead={false} />
                        </span>
                      </div>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
            <p
              className="m-0 text-[13px] text-text-tertiary"
              aria-live="polite"
            >
              {`Showing ${current * PAGE_SIZE + 1} to ${current * PAGE_SIZE + shown.length} of ${filtered.length} ${filtered.length === 1 ? "record" : "records"}`}
            </p>

            {pageCount > 1 && (
              <nav
                aria-label={`${caption} pages`}
                className="flex items-center gap-1.5"
              >
                <button
                  type="button"
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                  aria-label="Previous page"
                  className="grid size-9 cursor-pointer place-items-center rounded-[12px] bg-surface text-text-secondary transition-colors hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Icon name="collapse" size={16} />
                </button>

                {pageNumbers(current, pageCount).map((n, i) =>
                  n === null ? (
                    <span
                      key={`gap-${i}`}
                      className="px-1 text-[13px] text-text-tertiary"
                    >
                      …
                    </span>
                  ) : (
                    <button
                      key={n}
                      type="button"
                      onClick={() => table.setPageIndex(n)}
                      aria-current={n === current ? "page" : undefined}
                      className={
                        "tabular grid h-9 min-w-9 cursor-pointer place-items-center rounded-lg px-2 text-[13px] transition-colors " +
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
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                  aria-label="Next page"
                  className="grid size-9 cursor-pointer place-items-center rounded-[12px] bg-surface text-text-secondary transition-colors hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40"
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
