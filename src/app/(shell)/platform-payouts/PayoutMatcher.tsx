"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Field, Input, Panel, Row, RowList, Select, Stat, StatRow } from "@/components/ui/primitives";
import {
  matchSettlement,
  parseCsv,
  parseMoneyToMinor,
  type MatchedOrder,
  type PlatformBill,
} from "@/lib/settlement-match";

const rupees = (minor: number) => (minor / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

/** The column whose header best fits `pattern`, or the first column when none does. */
function guessColumn(header: string[], pattern: RegExp): number {
  const found = header.findIndex((h) => pattern.test(h));
  return found >= 0 ? found : 0;
}

/**
 * Matches the platform's settlement file against its recorded orders in the
 * browser. Reads the file, lets the person say which column is the order number
 * and which is the amount paid, then lists what matched, what was paid short or
 * over, what the file has that we do not, and what we have that the file lacks.
 * Nothing is saved and nothing is written off; the lists are for a person to act on.
 */
export function PayoutMatcher({ platform, bills }: { platform: string; bills: PlatformBill[] }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState("");
  const [orderCol, setOrderCol] = useState(0);
  const [amountCol, setAmountCol] = useState(0);
  const [commission, setCommission] = useState("");

  const header = rows?.[0] ?? [];

  const parsed = useMemo(() => {
    if (!rows || rows.length < 2) return null;
    const payoutRows: Array<{ ref: string; amountMinor: number }> = [];
    let unreadable = 0;
    for (const r of rows.slice(1)) {
      const amountMinor = parseMoneyToMinor(r[amountCol] ?? "");
      const ref = (r[orderCol] ?? "").trim();
      if (ref === "") continue;
      if (Number.isNaN(amountMinor)) unreadable += 1;
      else payoutRows.push({ ref, amountMinor });
    }
    const commissionBp = Math.round(Math.min(100, Math.max(0, Number(commission) || 0)) * 100);
    return { unreadable, report: matchSettlement({ rows: payoutRows, bills, commissionBp }) };
  }, [rows, orderCol, amountCol, commission, bills]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const parsedRows = parseCsv(await file.text());
    setFileName(file.name);
    setRows(parsedRows);
    const head = parsedRows[0] ?? [];
    setOrderCol(guessColumn(head, /order/i));
    setAmountCol(guessColumn(head, /(payout|net|settle|amount|paid)/i));
  }

  return (
    <>
      <Panel title="Settlement file" className="mb-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Settlement file (CSV)" htmlFor="po-file" hint={`${bills.length} ${platform} order${bills.length === 1 ? "" : "s"} settled in these dates.`}>
            <input
              id="po-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void onFile(e.target.files?.[0])}
              className="min-h-11 text-[15px] text-text"
            />
          </Field>
          <Field label="Platform's commission (%)" htmlFor="po-commission" hint="Taken from each bill before it pays out. Leave blank to expect the full bill.">
            <Input id="po-commission" type="number" min={0} max={100} step="0.01" inputMode="decimal" value={commission} onChange={(e) => setCommission(e.target.value)} />
          </Field>
          {rows && rows.length > 0 && (
            <>
              <Field label="Order number column" htmlFor="po-order-col">
                <Select id="po-order-col" value={orderCol} onChange={(e) => setOrderCol(Number(e.target.value))}>
                  {header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </Select>
              </Field>
              <Field label="Amount paid column" htmlFor="po-amount-col">
                <Select id="po-amount-col" value={amountCol} onChange={(e) => setAmountCol(Number(e.target.value))}>
                  {header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </Select>
              </Field>
            </>
          )}
        </div>
        {fileName && rows && rows.length < 2 && (
          <p className="m-0 mt-3 text-[13px] text-danger" role="alert">{fileName} has no data rows. Check that it is a CSV with a header line.</p>
        )}
      </Panel>

      {parsed && (
        <>
          <StatRow cols={4} className="mb-6">
            <Stat label="Matched" value={parsed.report.matched.length} />
            <Stat label="Paid short" value={parsed.report.short.length} hint={parsed.report.totals.shortByMinor > 0 ? `${rupees(parsed.report.totals.shortByMinor)} short in all` : undefined} />
            <Stat label="Not in your orders" value={parsed.report.unmatchedRows.length} />
            <Stat label="Not in the file" value={parsed.report.missingOrders.length} />
          </StatRow>
          {parsed.unreadable > 0 && (
            <p className="mb-4 text-[13px] text-warning" role="status">
              {parsed.unreadable} row{parsed.unreadable === 1 ? "" : "s"} had an amount that could not be read and {parsed.unreadable === 1 ? "was" : "were"} left out. Check the amount column.
            </p>
          )}
          <Section title="Paid short" empty="No order was paid short." items={parsed.report.short} />
          <Section title="Paid more than expected" empty="No order was paid more than expected." items={parsed.report.over} />
          <Panel title="In the file, not in your orders" flush className="mb-6">
            {parsed.report.unmatchedRows.length === 0 ? (
              <p className="m-0 p-4 text-[13px] text-text-tertiary">Every order in the file is one you recorded.</p>
            ) : (
              <RowList>
                {parsed.report.unmatchedRows.map((r) => (
                  <Row key={r.ref} className="justify-between">
                    <span className="text-text">{r.ref}</span>
                    <span className="tabular text-text-secondary">{rupees(r.amountMinor)}</span>
                  </Row>
                ))}
              </RowList>
            )}
          </Panel>
          <Panel title="Your orders the file does not mention" flush className="mb-6">
            {parsed.report.missingOrders.length === 0 ? (
              <p className="m-0 p-4 text-[13px] text-text-tertiary">The file covers every order in these dates.</p>
            ) : (
              <RowList>
                {parsed.report.missingOrders.map((b) => (
                  <Row key={b.billId} className="justify-between">
                    <Link href={`/counter/${b.billId}`} className="text-accent-ink no-underline">{b.label}</Link>
                    <span className="tabular text-text-secondary">{rupees(b.totalMinor)}</span>
                  </Row>
                ))}
              </RowList>
            )}
          </Panel>
        </>
      )}
    </>
  );
}

function Section({ title, empty, items }: { title: string; empty: string; items: MatchedOrder[] }) {
  return (
    <Panel title={title} flush className="mb-6">
      {items.length === 0 ? (
        <p className="m-0 p-4 text-[13px] text-text-tertiary">{empty}</p>
      ) : (
        <RowList>
          {items.map((m) => (
            <Row key={m.billId} className="justify-between">
              <span className="min-w-0">
                <Link href={`/counter/${m.billId}`} className="text-accent-ink no-underline">{m.label}</Link>
                <span className="block text-[13px] text-text-secondary">
                  Expected {rupees(m.expectedMinor)}, received {rupees(m.receivedMinor)}
                </span>
              </span>
              <span className="tabular shrink-0 font-medium text-text">
                {m.differenceMinor > 0 ? "+" : "−"} {rupees(Math.abs(m.differenceMinor))}
              </span>
            </Row>
          ))}
        </RowList>
      )}
    </Panel>
  );
}
