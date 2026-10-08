import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { FINANCE_CAPABILITY, type CashMovementRow } from "@/server/capabilities/finance";
import { runQuery } from "@/server/actions/platform";
import { CashMovements } from "./CashMovements";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { PageHeader } from "@/components/ui/primitives";
import { CashReconciliationForm } from "./CashReconciliationForm";

export const dynamic = "force-dynamic";

/** §44-45 — expected cash (opening + cash sales - cash expenses - withdrawn) vs. actual, per outlet per day. */
async function CashReconciliationPage({ searchParams }: { searchParams: Promise<{ outlet?: string; date?: string }> }) {
  const actor = await requireActor();
  const params = await searchParams;
  const locations = await withTenant(actor.tenantId, (tx) => tx.location.findMany({ select: { id: true, name: true } }));
  const location = locations.find((l) => l.id === params.outlet) ?? locations[0];
  const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : new Date().toISOString().slice(0, 10);

  const movementsResult = location
    ? await runQuery<CashMovementRow[]>("verity.finance.list_cash_movements", { locationId: location.id, date })
    : null;
  const movements = movementsResult?.ok
    ? movementsResult.data.map((m) => ({ ...m, at: new Date(m.at).toISOString() }))
    : [];

  return (
    <>
      <PageHeader
        title="Cash reconciliation"
        description="Expected cash is computed from opening float, cash sales, cash expenses, cash in and out, and withdrawals. A variance requires an explanation."
      />
      <CashReconciliationForm locations={locations} />
      <CashMovements locations={locations} locationId={location?.id ?? ""} date={date} movements={movements} />
    </>
  );
}

export default withCapabilityPageAccess(FINANCE_CAPABILITY, CashReconciliationPage);
