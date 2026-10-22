import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { ACCOUNTING_CAPABILITY } from "@/server/capabilities/accounting";
import { runQuery } from "@/server/actions/platform";
import type { BalanceSheet, ProfitAndLoss, StatementLine } from "@/lib/financial-statements";
import { Button, ErrorState, Field, Input, PageHeader, Panel, Row, RowList } from "@/components/ui/primitives";
import { rupees } from "@/components/ui/business/format";

export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: string | undefined) => (v && ISO.test(v) ? v : undefined);

function Lines({ lines, empty }: { lines: StatementLine[]; empty: string }) {
  if (lines.length === 0) return <p className="m-0 px-5 py-3.5 text-[15px] text-text-secondary">{empty}</p>;
  return (
    <RowList>
      {lines.map((l) => (
        <Row key={l.accountId}>
          <span className="min-w-0 truncate text-[15px]">
            <span className="tabular text-text-tertiary">{l.code}</span> {l.name}
          </span>
          <span className="tabular text-[15px]">{rupees(l.amountMinor)}</span>
        </Row>
      ))}
    </RowList>
  );
}

function Total({ label, minor, strong }: { label: string; minor: number; strong?: boolean }) {
  return (
    <div className={"flex items-center justify-between gap-4 border-t border-line px-5 py-3.5 " + (strong ? "font-semibold" : "")}>
      <span className="text-[15px]">{label}</span>
      <span className={"tabular text-[15px] " + (strong && minor < 0 ? "text-danger" : "")}>{rupees(minor)}</span>
    </div>
  );
}

/**
 * Profit and loss and balance sheet, read from the ledger.
 *
 * The notice at the top is not decoration: only journal entries, sales invoices and customer
 * receipts are posted (ADR-044, Task 130). Credit notes, purchase bills and job invoices are not,
 * so the figures are partial. Saying so here is what stops a reader treating a partial ledger as
 * the whole business.
 */
async function StatementsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; asOf?: string }> }) {
  const sp = await searchParams;
  const from = clean(sp.from);
  const to = clean(sp.to);
  const asOf = clean(sp.asOf);

  const [pl, bs] = await Promise.all([
    runQuery<ProfitAndLoss>("verity.accounting.profit_and_loss", { from, to }),
    runQuery<BalanceSheet>("verity.accounting.balance_sheet", { asOf }),
  ]);
  if (!pl.ok) return <ErrorState title="Could not load the profit and loss" message={pl.message} issues={pl.issues} retryable={pl.retryable} />;
  if (!bs.ok) return <ErrorState title="Could not load the balance sheet" message={bs.message} issues={bs.issues} retryable={bs.retryable} />;

  const p = pl.data;
  const b = bs.data;

  return (
    <>
      <PageHeader
        back={{ href: "/accounting", label: "Accounting" }}
        title="Statements"
        description="Profit and loss, and the balance sheet, from the journal entries posted to the ledger."
      />

      <p role="note" className="mb-6 mt-0 rounded-[12px] bg-warning-subtle px-4 py-3 text-[15px] leading-[22px]">
        These figures cover journal entries, sales invoices, job invoices and the payments received on both, once an account is chosen for
        each in Posting setup. Credit notes, purchase bills and supplier payments are not posted yet, so they are not here.
      </p>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <Field label="Profit and loss from" htmlFor="from">
          <Input id="from" name="from" type="date" defaultValue={from ?? ""} />
        </Field>
        <Field label="to" htmlFor="to">
          <Input id="to" name="to" type="date" defaultValue={to ?? ""} />
        </Field>
        <Field label="Balance sheet as at" htmlFor="asOf">
          <Input id="asOf" name="asOf" type="date" defaultValue={asOf ?? ""} />
        </Field>
        <Button type="submit">Show</Button>
      </form>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Profit and loss" flush>
          <h3 className="m-0 px-5 pb-1 pt-3 text-[13px] font-normal uppercase tracking-[0.02em] text-text-secondary">Income</h3>
          <Lines lines={p.income} empty="No income posted in this period." />
          <Total label="Total income" minor={p.totalIncomeMinor} />
          <h3 className="m-0 px-5 pb-1 pt-3 text-[13px] font-normal uppercase tracking-[0.02em] text-text-secondary">Expenses</h3>
          <Lines lines={p.expenses} empty="No expenses posted in this period." />
          <Total label="Total expenses" minor={p.totalExpensesMinor} />
          <Total label={p.netMinor < 0 ? "Net loss" : "Net profit"} minor={p.netMinor} strong />
        </Panel>

        <Panel title="Balance sheet" flush>
          <h3 className="m-0 px-5 pb-1 pt-3 text-[13px] font-normal uppercase tracking-[0.02em] text-text-secondary">Assets</h3>
          <Lines lines={b.assets} empty="No assets posted." />
          <Total label="Total assets" minor={b.totalAssetsMinor} strong />
          <h3 className="m-0 px-5 pb-1 pt-3 text-[13px] font-normal uppercase tracking-[0.02em] text-text-secondary">Liabilities</h3>
          <Lines lines={b.liabilities} empty="No liabilities posted." />
          <Total label="Total liabilities" minor={b.totalLiabilitiesMinor} />
          <h3 className="m-0 px-5 pb-1 pt-3 text-[13px] font-normal uppercase tracking-[0.02em] text-text-secondary">Equity</h3>
          <Lines lines={b.equity} empty="No equity posted." />
          <Row>
            <span className="text-[15px]">Current earnings (not yet closed)</span>
            <span className="tabular text-[15px]">{rupees(b.currentEarningsMinor)}</span>
          </Row>
          <Total label="Total equity" minor={b.totalEquityMinor} />
          <Total label="Liabilities and equity" minor={b.totalLiabilitiesMinor + b.totalEquityMinor} strong />
          {!b.balanced && (
            <p role="alert" className="m-0 border-t border-line bg-danger-subtle px-5 py-3.5 text-[15px] text-danger">
              Out of balance by {rupees(Math.abs(b.differenceMinor))}. Assets do not equal liabilities and equity, so an entry in the ledger is wrong.
            </p>
          )}
        </Panel>
      </div>
    </>
  );
}

export default withCapabilityPageAccess(ACCOUNTING_CAPABILITY, StatementsPage);
