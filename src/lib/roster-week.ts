/**
 * Roster week arithmetic: pure date and grid helpers, no database and no clock.
 *
 * Dates are `YYYY-MM-DD` strings in the tenant's calendar and are handled as UTC
 * midnights, so a week never shifts with the viewer's time zone or a daylight
 * saving change. A week starts on Monday.
 *
 * Authority: `clients/colonel-kebabz/prd.md` §39-40 (Shift Management); Task 125
 * item 6.1 (roster week grid, copy last week).
 */

export type RosterShift = {
  id?: string;
  locationId: string;
  employeeId: string;
  /** `YYYY-MM-DD`. */
  date: string;
  label: string;
  /** `HH:MM`. */
  startTime: string;
  endTime: string;
};

const DAY_MS = 86_400_000;

function toUtc(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

/** The Monday of the week containing `date`. */
export function weekStartOf(date: string): string {
  const day = new Date(toUtc(date)).getUTCDay(); // 0 Sunday .. 6 Saturday
  return addDays(date, -((day + 6) % 7));
}

/** The seven dates of the week starting at `weekStart`. */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** One row per employee, one cell per day of the week, each cell ordered by start time. */
export function buildRosterGrid<S extends Pick<RosterShift, "employeeId" | "date" | "startTime">>(
  employeeIds: string[],
  shifts: S[],
  weekStart: string,
): Array<{ employeeId: string; days: S[][] }> {
  const dates = weekDates(weekStart);
  return employeeIds.map((employeeId) => ({
    employeeId,
    days: dates.map((date) =>
      shifts
        .filter((s) => s.employeeId === employeeId && s.date === date)
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    ),
  }));
}

function sameShift(a: RosterShift, b: RosterShift): boolean {
  return a.employeeId === b.employeeId && a.date === b.date && a.startTime === b.startTime && a.endTime === b.endTime;
}

/**
 * The shifts to create so that the week after `fromWeekStart` repeats it.
 * A shift that already exists in the target week (same person, day and times)
 * is skipped, so copying twice never doubles the roster.
 */
export function planCopyWeek(
  all: RosterShift[],
  fromWeekStart: string,
  toWeekStart: string = addDays(fromWeekStart, 7),
): RosterShift[] {
  const from = new Set(weekDates(fromWeekStart));
  const to = new Set(weekDates(toWeekStart));
  const offset = Math.round((toUtc(toWeekStart) - toUtc(fromWeekStart)) / DAY_MS);
  const existing = all.filter((s) => to.has(s.date));
  const planned: RosterShift[] = [];
  for (const source of all.filter((s) => from.has(s.date))) {
    const copy: RosterShift = {
      locationId: source.locationId,
      employeeId: source.employeeId,
      date: addDays(source.date, offset),
      label: source.label,
      startTime: source.startTime,
      endTime: source.endTime,
    };
    if (![...existing, ...planned].some((s) => sameShift(s, copy))) planned.push(copy);
  }
  return planned;
}
