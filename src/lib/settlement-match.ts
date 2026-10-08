/**
 * Delivery-platform payout matching (Task 125 item 4.2): a Zomato or Swiggy
 * settlement file against the orders Verity recorded for that platform.
 * Pure: no database, no clock, nothing is stored or written off. The result is
 * a report for a person to act on.
 *
 * Rules (decided 2026-10-09):
 * - The file is matched by the platform's own order number (`platformOrderRef`),
 *   ignoring case, spaces and a leading "#".
 * - Several rows with the same order number (an order plus an adjustment) are
 *   summed into one payout for that order.
 * - A platform keeps a commission, so the payout is compared with the bill total
 *   less `commissionBp` basis points, not with the total itself. Within
 *   `toleranceMinor` (default one rupee) counts as matched.
 */

export type PayoutRow = { ref: string; amountMinor: number };
export type PlatformBill = { ref: string; billId: string; label: string; totalMinor: number };

export type MatchedOrder = {
  ref: string;
  billId: string;
  label: string;
  totalMinor: number;
  expectedMinor: number;
  receivedMinor: number;
  /** received minus expected; negative means the platform paid less than it should have. */
  differenceMinor: number;
};

export type SettlementReport = {
  matched: MatchedOrder[];
  short: MatchedOrder[];
  over: MatchedOrder[];
  /** In the file, but no order of ours has that number. */
  unmatchedRows: PayoutRow[];
  /** Our orders for this platform that the file does not mention yet. */
  missingOrders: PlatformBill[];
  totals: { expectedMinor: number; receivedMinor: number; shortByMinor: number };
};

export const normalizeRef = (ref: string): string => ref.trim().replace(/^#/, "").replace(/\s+/g, "").toLowerCase();

/** `₹1,234.50`, `1234.5`, `(120.00)` to paise; anything else is NaN so the caller can flag the row. */
export function parseMoneyToMinor(raw: string): number {
  const cleaned = raw.trim().replace(/[₹\s,]/g, "").replace(/^rs\.?/i, "");
  if (cleaned === "") return Number.NaN;
  const negative = /^\(.*\)$/.test(cleaned) || cleaned.startsWith("-");
  const digits = cleaned.replace(/[()-]/g, "");
  if (!/^\d+(\.\d+)?$/.test(digits)) return Number.NaN;
  const minor = Math.round(Number(digits) * 100);
  return negative ? -minor : minor;
}

/**
 * Minimal CSV reader: quoted fields, doubled quotes, commas or newlines inside
 * quotes, CRLF, a leading byte-order mark, and a tab or semicolon delimiter when
 * the header line has more of those than commas.
 */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const header = source.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch: string) => header.split(ch).length - 1;
  const delimiter = count("\t") > count(",") && count("\t") >= count(";") ? "\t" : count(";") > count(",") ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export function matchSettlement(input: {
  rows: PayoutRow[];
  bills: PlatformBill[];
  commissionBp: number;
  toleranceMinor?: number;
}): SettlementReport {
  const tolerance = input.toleranceMinor ?? 100;

  const received = new Map<string, { ref: string; amountMinor: number }>();
  for (const r of input.rows) {
    const key = normalizeRef(r.ref);
    if (key === "") continue;
    const existing = received.get(key);
    if (existing) existing.amountMinor += r.amountMinor;
    else received.set(key, { ref: r.ref.trim(), amountMinor: r.amountMinor });
  }

  const byRef = new Map(input.bills.map((b) => [normalizeRef(b.ref), b]));
  const matched: MatchedOrder[] = [];
  const short: MatchedOrder[] = [];
  const over: MatchedOrder[] = [];
  const unmatchedRows: PayoutRow[] = [];

  for (const [key, row] of received) {
    const bill = byRef.get(key);
    if (!bill) {
      unmatchedRows.push({ ref: row.ref, amountMinor: row.amountMinor });
      continue;
    }
    const expectedMinor = Math.round((bill.totalMinor * (10_000 - input.commissionBp)) / 10_000);
    const differenceMinor = row.amountMinor - expectedMinor;
    const entry: MatchedOrder = {
      ref: bill.ref,
      billId: bill.billId,
      label: bill.label,
      totalMinor: bill.totalMinor,
      expectedMinor,
      receivedMinor: row.amountMinor,
      differenceMinor,
    };
    if (Math.abs(differenceMinor) <= tolerance) matched.push(entry);
    else if (differenceMinor < 0) short.push(entry);
    else over.push(entry);
  }

  const missingOrders = input.bills.filter((b) => !received.has(normalizeRef(b.ref)));
  const all = [...matched, ...short, ...over];
  return {
    matched,
    short,
    over,
    unmatchedRows,
    missingOrders,
    totals: {
      expectedMinor: all.reduce((s, m) => s + m.expectedMinor, 0),
      receivedMinor: all.reduce((s, m) => s + m.receivedMinor, 0),
      shortByMinor: -short.reduce((s, m) => s + m.differenceMinor, 0),
    },
  };
}
