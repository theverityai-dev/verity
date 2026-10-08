import { leaveCalendar } from "@/lib/leave-calendar";
import type { LeaveRow } from "./HrDesk";

const DAY = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Task 125 item 6.2 — the next two weeks, one row per day with someone off, so a
 * manager sees who is away and where too many people are off at once before
 * deciding a request. Days with nobody off are left out; the empty state says so.
 */
export function LeaveCalendar({ leave, today }: { leave: LeaveRow[]; today: string }) {
  const days = leaveCalendar(leave, today, 14).filter((d) => d.approved.length + d.pending.length > 0);
  return (
    <section aria-label="Leave calendar, next 14 days" className="mb-4 rounded-[12px] bg-surface p-4">
      <h3 className="mb-2 text-[17px] font-semibold text-text">Who is off, next 14 days</h3>
      {days.length === 0 ? (
        <p className="m-0 text-[13px] text-text-tertiary">Nobody is on leave in the next two weeks.</p>
      ) : (
        <ul className="m-0 grid list-none gap-1 p-0">
          {days.map((d) => (
            <li key={d.date} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[14px]">
              <span className="tabular w-28 shrink-0 font-medium text-text">{DAY.format(new Date(`${d.date}T00:00:00Z`))}</span>
              <span className="text-text">
                {d.approved.join(", ")}
                {d.pending.length > 0 && (
                  <span className="text-text-secondary">
                    {d.approved.length > 0 ? ", " : ""}
                    {d.pending.map((n) => `${n} (waiting for a decision)`).join(", ")}
                  </span>
                )}
              </span>
              {d.overlap && (
                <span className="rounded-full bg-warning-subtle px-2 py-0.5 text-[12px] font-medium text-warning">
                  {d.approved.length + d.pending.length} people off
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
