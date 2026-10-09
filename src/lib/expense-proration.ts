/**
 * How much of an expense belongs inside a date window (Task 126 item 1.3).
 *
 * An expense with no period belongs to its own date: all of it, or none. One with a
 * period (a monthly electricity bill paid on the 3rd for the whole of September)
 * is spread evenly across the days of that period, so a ten-day window sees ten
 * thirtieths of it. The same idea `labour-cost.ts` applies to salaries, applied to
 * bills, so the outlet P&L answers "what did these ten days cost" rather than
 * "what did we pay in these ten days".
 *
 * Dates are calendar days (`YYYY-MM-DD`). Rounding is to the paisa per expense.
 */

export type DatedExpense = {
  amountMinor: number;
  /** YYYY-MM-DD */
  expenseDate: string;
  periodFrom: string | null;
  periodTo: string | null;
};

const DAY = 86_400_000;

function days(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;
}

export function expenseShareInWindow(expense: DatedExpense, from: string, to: string): number {
  if (!expense.periodFrom || !expense.periodTo) {
    return expense.expenseDate >= from && expense.expenseDate <= to ? expense.amountMinor : 0;
  }
  const start = expense.periodFrom > from ? expense.periodFrom : from;
  const end = expense.periodTo < to ? expense.periodTo : to;
  if (end < start) return 0;
  const total = days(expense.periodFrom, expense.periodTo);
  return Math.round((expense.amountMinor * days(start, end)) / total);
}
