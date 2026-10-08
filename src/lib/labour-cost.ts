/**
 * Labour cost for one outlet over a window, as an estimate from monthly salary
 * and the shifts people actually have. Pure: no database, no clock, no I/O.
 *
 * Rule (Task 125 item 4.4, DECISIONS.md #3): each active employee's monthly
 * salary is prorated to the window (window days / 30), then split across
 * outlets by that person's share of shift hours in the window. An employee with
 * no shifts in the window cannot be placed at any outlet, so they are counted
 * in `unplaced` and contribute nothing here rather than being guessed at.
 */

export type LabourEmployee = {
  /** Null when no salary is set; that employee is skipped. */
  monthlySalaryMinor: number | null;
  active: boolean;
  shifts: Array<{ locationId: string; startTime: string; endTime: string }>;
};

export type OutletLabour = {
  labourMinor: number;
  /** People whose salary is (partly) attributed to this outlet. */
  placed: number;
  /** Salaried active people with no shifts in the window, so not attributed anywhere. */
  unplaced: number;
};

const MINUTES = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Hours in a shift; a shift that ends before it starts crosses midnight. */
export function shiftHours(startTime: string, endTime: string): number {
  const start = MINUTES(startTime);
  let end = MINUTES(endTime);
  if (end <= start) end += 24 * 60;
  return (end - start) / 60;
}

export function outletLabour(employees: LabourEmployee[], locationId: string, windowDays: number): OutletLabour {
  let total = 0;
  let placed = 0;
  let unplaced = 0;
  for (const e of employees) {
    if (!e.active || e.monthlySalaryMinor === null) continue;
    const hours = e.shifts.reduce((sum, s) => sum + shiftHours(s.startTime, s.endTime), 0);
    if (hours === 0) {
      unplaced += 1;
      continue;
    }
    const here = e.shifts
      .filter((s) => s.locationId === locationId)
      .reduce((sum, s) => sum + shiftHours(s.startTime, s.endTime), 0);
    if (here === 0) continue;
    placed += 1;
    total += e.monthlySalaryMinor * (windowDays / 30) * (here / hours);
  }
  return { labourMinor: Math.round(total), placed, unplaced };
}
