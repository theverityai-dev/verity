"use client";

/* eslint-disable no-restricted-syntax -- structural exception: a person-by-day matrix whose cells hold several shifts, which DataTable's one-value-per-column model cannot express */
import Link from "next/link";
import { useState, useTransition } from "react";
import { Button, ErrorState, Panel } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import { addDays, buildRosterGrid, weekDates } from "@/lib/roster-week";

type Cell = { id: string; employeeId: string; date: string; label: string; startTime: string; endTime: string };

const DAY = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", timeZone: "UTC" });
const RANGE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

/**
 * Task 125 item 6.1 — who works when, one row per person and one column per day.
 * "Copy last week" repeats the previous week into the one on screen and skips
 * anything already there, so pressing it twice changes nothing.
 */
export function RosterWeek({
  weekStart,
  employees,
  shifts,
}: {
  weekStart: string;
  employees: Array<{ id: string; name: string }>;
  shifts: Cell[];
}) {
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dates = weekDates(weekStart);
  const grid = buildRosterGrid(employees.map((e) => e.id), shifts, weekStart);
  const nameOf = new Map(employees.map((e) => [e.id, e.name]));

  function copyLastWeek() {
    setFailure(null);
    setMessage(null);
    startTransition(async () => {
      // The command copies a week forward, so this is last week into the one on screen.
      const result = await runCommand<{ created: number }>(
        "verity.attendance.copy_week",
        { fromWeekStart: addDays(weekStart, -7) },
        "/attendance",
      );
      if (!result.ok) return setFailure(result);
      setMessage(
        result.data.created === 0
          ? "Nothing to copy. Last week is empty or already copied."
          : `Copied ${result.data.created} shift${result.data.created === 1 ? "" : "s"}.`,
      );
      if (result.data.created > 0) window.location.reload();
    });
  }

  return (
    <Panel title="Roster" flush>
      <div className="flex flex-wrap items-center justify-between gap-2 p-4">
        <div className="flex items-center gap-2">
          <Link
            href={`/attendance?week=${addDays(weekStart, -7)}`}
            aria-label="Previous week"
            className="inline-flex h-9 items-center rounded-[10px] bg-[var(--color-control)] px-3 text-[14px] font-semibold text-accent-ink no-underline max-sm:h-11"
          >
            ‹
          </Link>
          <span className="tabular text-[15px] font-semibold text-text">
            {RANGE.format(asDate(dates[0]!))} to {RANGE.format(asDate(dates[6]!))}
          </span>
          <Link
            href={`/attendance?week=${addDays(weekStart, 7)}`}
            aria-label="Next week"
            className="inline-flex h-9 items-center rounded-[10px] bg-[var(--color-control)] px-3 text-[14px] font-semibold text-accent-ink no-underline max-sm:h-11"
          >
            ›
          </Link>
        </div>
        <Button size="sm" variant="secondary" onClick={copyLastWeek} disabled={pending}>
          {pending ? "Copying…" : "Copy last week"}
        </Button>
      </div>
      {failure && (
        <div className="px-4 pb-4">
          <ErrorState title="Could not copy last week" message={failure.message} issues={failure.issues} retryable={failure.retryable} />
        </div>
      )}
      {message && <p className="m-0 px-4 pb-3 text-[13px] text-text-secondary" role="status">{message}</p>}
      {employees.length === 0 ? (
        <p className="m-0 p-4 pt-0 text-[13px] text-text-tertiary">Add employees under People operations to plan a roster.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="text-text-secondary">
                <th className="px-4 py-2 font-medium">Employee</th>
                {dates.map((d) => (
                  <th key={d} className="px-2 py-2 font-medium">{DAY.format(asDate(d))}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((row) => (
                <tr key={row.employeeId} className="border-t border-line align-top">
                  <th scope="row" className="px-4 py-2 text-[14px] font-medium text-text">{nameOf.get(row.employeeId)}</th>
                  {row.days.map((cell, i) => (
                    <td key={dates[i]} className="px-2 py-2">
                      {cell.length === 0 ? (
                        <span className="text-text-tertiary" aria-label="No shift">·</span>
                      ) : (
                        cell.map((s) => (
                          <div key={s.id} className="mb-1 rounded-lg bg-[var(--color-control)] px-2 py-1 text-text">
                            <span className="block font-medium">{s.label}</span>
                            <span className="tabular text-text-secondary">{s.startTime}–{s.endTime}</span>
                          </div>
                        ))
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
