/**
 * Leave calendar: who is off on each day, with a warning when too many people
 * are off at once. Pure, no database and no clock; `today` is passed in.
 *
 * Only Approved and Pending leave counts. A pending request is shown separately
 * because the person may still be asked to work, but it still counts towards
 * the overlap warning so a manager sees the clash before approving.
 *
 * Authority: Task 125 item 6.2 (leave calendar with overlap warning).
 */

import { addDays } from "./roster-week";

export type LeaveSpan = {
  employee: string;
  /** `YYYY-MM-DD`, inclusive. */
  fromDate: string;
  /** `YYYY-MM-DD`, inclusive. */
  toDate: string;
  status: "Pending" | "Approved" | "Rejected" | "Revoked";
};

export type LeaveDay = {
  date: string;
  approved: string[];
  pending: string[];
  /** True when at least `overlapAt` different people are off (approved or pending). */
  overlap: boolean;
};

export function leaveCalendar(leaves: LeaveSpan[], startDate: string, days = 14, overlapAt = 2): LeaveDay[] {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(startDate, i);
    const approved = new Set<string>();
    const pending = new Set<string>();
    for (const l of leaves) {
      if (l.status !== "Approved" && l.status !== "Pending") continue;
      if (l.fromDate.slice(0, 10) > date || l.toDate.slice(0, 10) < date) continue;
      (l.status === "Approved" ? approved : pending).add(l.employee);
    }
    // A person with an approved span and a pending one on the same day is off once.
    for (const name of approved) pending.delete(name);
    return {
      date,
      approved: [...approved].sort(),
      pending: [...pending].sort(),
      overlap: approved.size + pending.size >= overlapAt,
    };
  });
}
