import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { FINANCE_CAPABILITY } from "@/server/capabilities/finance";
import { trailingDaysRange } from "@/lib/date-range";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { runQuery } from "@/server/actions/platform";
import { PageHeader, Stat, StatRow, ErrorState, Panel, RowList, Row } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

type PnL = {
  revenueMinor: number; cogsMinor: number; grossProfitMinor: number;
  expensesByCategory: Array<{ category: string; amountMinor: number }>;
  totalExpensesMinor: number; operatingContributionMinor: number; note: string;
};

function formatRupees(minor: number): string {
  return (minor / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
}

/** §49 — an ESTIMATE, not accounting-grade. cogsIsApproximate + note render as a visible caveat, never silently. */
async function OutletPnLPage() {
  const actor = await requireActor();
  const locations = await withTenant(actor.tenantId, (tx) => tx.location.findMany({ select: { id: true, name: true } }));
  const location = locations[0];
  if (!location) return <PageHeader title="Outlet P&L" description="No outlets in scope." />;

  const { fromDate, toDate } = trailingDaysRange(30);
  const result = await runQuery<PnL>("verity.finance.get_outlet_pnl", { locationId: location.id, fromDate, toDate });
  if (!result.ok) return <ErrorState title="Could not load P&L" message={result.message} issues={result.issues} retryable={result.retryable} />;
  const pnl = result.data;

  return (
    <>
      <PageHeader title={`Outlet P&L — ${location.name}`} description={`Last 30 days (${fromDate} → ${toDate}).`} />
      <div className="mb-6 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning-subtle)] px-4 py-3 text-[13px] text-text">
        {pnl.note}
      </div>
      <StatRow cols={4} className="mb-6">
        <Stat label="Revenue" value={formatRupees(pnl.revenueMinor)} />
        <Stat label="COGS (approximate)" value={formatRupees(pnl.cogsMinor)} />
        <Stat label="Gross profit" value={formatRupees(pnl.grossProfitMinor)} />
        <Stat label="Operating contribution" value={formatRupees(pnl.operatingContributionMinor)} />
      </StatRow>
      <Panel title="Expenses by category" flush>
        {pnl.expensesByCategory.length === 0 ? (
          <p className="m-0 p-4 text-[13px] text-text-tertiary">No approved expenses in range.</p>
        ) : (
          <RowList>
            {pnl.expensesByCategory.map((e) => (
              <Row key={e.category} className="justify-between">
                <span className="text-text">{e.category}</span>
                <span className="tabular text-text-secondary">{formatRupees(e.amountMinor)}</span>
              </Row>
            ))}
          </RowList>
        )}
      </Panel>
    </>
  );
}

export default withCapabilityPageAccess(FINANCE_CAPABILITY, OutletPnLPage);
