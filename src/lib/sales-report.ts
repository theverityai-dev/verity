/**
 * Pure grouping for the restaurant sales reports (Task 126 item 1.1). No database,
 * no clock beyond the arguments, so the day, month and hour boundaries are
 * testable. The query in `dinein/reports.ts` fetches bills; this decides which
 * row each one lands in.
 *
 * Basis, stated once: a row counts SETTLED bills only (an open bill is not
 * revenue), and a refund is shown against the bill it reverses, whichever day
 * the refund was made. Net = gross − refunded.
 */

export const SALES_VIEWS = ["day", "month", "hour", "channel", "staff"] as const;
export type SalesView = (typeof SALES_VIEWS)[number];

export type ReportBill = {
  settledAt: Date;
  channel: string;
  takenByUserId: string;
  covers: number;
  totalMinor: number;
  discountMinor: number;
  taxMinor: number;
  refundedMinor: number;
  lines: Array<{ name: string; qty: number; unitPriceMinor: number }>;
};

export type SalesRow = {
  key: string;
  label: string;
  bills: number;
  covers: number;
  grossMinor: number;
  discountMinor: number;
  taxMinor: number;
  refundedMinor: number;
  netMinor: number;
  avgBillMinor: number;
};

export type ItemRow = { key: string; label: string; qty: number; revenueMinor: number };

type Zone = { timeZone: string; startMinute: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function parts(date: Date, timeZone: string): { y: string; m: string; d: string; hour: number } {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  const found = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return { y: found.year!, m: found.month!, d: found.day!, hour: Number(found.hour) };
}

/** The service day a moment belongs to, as YYYY-MM-DD in the outlet's clock. */
export function serviceDayKey(date: Date, zone: Zone): string {
  const shifted = new Date(date.getTime() - zone.startMinute * 60_000);
  const p = parts(shifted, zone.timeZone);
  return `${p.y}-${p.m}-${p.d}`;
}

export function monthKey(date: Date, zone: Zone): string {
  return serviceDayKey(date, zone).slice(0, 7);
}

/** The clock hour (0 to 23) in the outlet's own zone. */
export function localHour(date: Date, timeZone: string): number {
  return parts(date, timeZone).hour;
}

function emptyRow(key: string, label: string): SalesRow {
  return {
    key,
    label,
    bills: 0,
    covers: 0,
    grossMinor: 0,
    discountMinor: 0,
    taxMinor: 0,
    refundedMinor: 0,
    netMinor: 0,
    avgBillMinor: 0,
  };
}

function add(row: SalesRow, bill: ReportBill): void {
  row.bills += 1;
  row.covers += bill.covers;
  row.grossMinor += bill.totalMinor;
  row.discountMinor += bill.discountMinor;
  row.taxMinor += bill.taxMinor;
  row.refundedMinor += bill.refundedMinor;
}

function finish(row: SalesRow): SalesRow {
  row.netMinor = row.grossMinor - row.refundedMinor;
  row.avgBillMinor = row.bills > 0 ? Math.round(row.grossMinor / row.bills) : 0;
  return row;
}

export function totalsOf(rows: SalesRow[]): SalesRow {
  const total = emptyRow("total", "Total");
  for (const row of rows) {
    total.bills += row.bills;
    total.covers += row.covers;
    total.grossMinor += row.grossMinor;
    total.discountMinor += row.discountMinor;
    total.taxMinor += row.taxMinor;
    total.refundedMinor += row.refundedMinor;
  }
  return finish(total);
}

export function hourLabel(hour: number): string {
  const h = String(hour).padStart(2, "0");
  const next = String((hour + 1) % 24).padStart(2, "0");
  return `${h}:00 to ${next}:00`;
}

/**
 * Group bills into rows for one view. `labels` names channels and staff (keys are
 * the raw channel or user id); a key with no label shows as itself.
 */
export function groupBills(
  bills: ReportBill[],
  view: SalesView,
  zone: Zone,
  labels: Map<string, string> = new Map(),
): SalesRow[] {
  const rows = new Map<string, SalesRow>();
  const keyOf = (bill: ReportBill): { key: string; label: string } => {
    switch (view) {
      case "day": {
        const key = serviceDayKey(bill.settledAt, zone);
        return { key, label: key };
      }
      case "month": {
        const key = monthKey(bill.settledAt, zone);
        return { key, label: key };
      }
      case "hour": {
        const hour = localHour(bill.settledAt, zone.timeZone);
        return { key: String(hour).padStart(2, "0"), label: hourLabel(hour) };
      }
      case "channel":
        return { key: bill.channel, label: labels.get(bill.channel) ?? bill.channel };
      case "staff":
        return { key: bill.takenByUserId, label: labels.get(bill.takenByUserId) ?? "Unknown" };
    }
  };

  for (const bill of bills) {
    const { key, label } = keyOf(bill);
    const row = rows.get(key) ?? emptyRow(key, label);
    add(row, bill);
    rows.set(key, row);
  }

  const out = [...rows.values()].map(finish);
  if (view === "day" || view === "month") return out.sort((a, b) => a.key.localeCompare(b.key));
  if (view === "hour") {
    const startHour = Math.floor(zone.startMinute / 60);
    const order = (key: string) => (Number(key) - startHour + 24) % 24;
    return out.sort((a, b) => order(a.key) - order(b.key));
  }
  return out.sort((a, b) => b.grossMinor - a.grossMinor);
}

/** Items sold, by what the guest was charged for the line (price before bill-level discount and tax). */
export function groupItems(bills: ReportBill[]): ItemRow[] {
  const items = new Map<string, ItemRow>();
  for (const bill of bills) {
    for (const line of bill.lines) {
      const row = items.get(line.name) ?? { key: line.name, label: line.name, qty: 0, revenueMinor: 0 };
      row.qty += line.qty;
      row.revenueMinor += line.qty * line.unitPriceMinor;
      items.set(line.name, row);
    }
  }
  return [...items.values()].sort((a, b) => b.revenueMinor - a.revenueMinor);
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/**
 * What a normal day looks like at this hour: the median daily sales and covers of
 * the same weekday, in the hour either side of now, over the earlier weeks
 * (URY `get_baseline`). Needs `bills` already limited to those weeks.
 */
export function baseline(
  bills: Array<{ settledAt: Date; totalMinor: number; covers: number }>,
  now: Date,
  zone: Zone,
): { sampleDays: number; medianSalesMinor: number; medianCovers: number } {
  const weekday = (d: Date) =>
    new Date(`${serviceDayKey(d, zone)}T00:00:00Z`).getUTCDay();
  const nowWeekday = weekday(now);
  const nowHour = localHour(now, zone.timeZone);
  const today = serviceDayKey(now, zone);

  const byDay = new Map<string, { sales: number; covers: number }>();
  for (const bill of bills) {
    const day = serviceDayKey(bill.settledAt, zone);
    if (day === today || weekday(bill.settledAt) !== nowWeekday) continue;
    const hour = localHour(bill.settledAt, zone.timeZone);
    if (hour < nowHour - 1 || hour > nowHour + 1) continue;
    const row = byDay.get(day) ?? { sales: 0, covers: 0 };
    row.sales += bill.totalMinor;
    row.covers += bill.covers;
    byDay.set(day, row);
  }
  const days = [...byDay.values()];
  return {
    sampleDays: days.length,
    medianSalesMinor: median(days.map((d) => d.sales)),
    medianCovers: median(days.map((d) => d.covers)),
  };
}
