/** Calendar-day helpers shared by pages that default to a trailing window. */

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `{ fromDate, toDate }` as ISO days, ending today and covering the last `days` days. */
export function trailingDaysRange(days: number): { fromDate: string; toDate: string } {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { fromDate: isoDay(from), toDate: isoDay(to) };
}
