import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { INVENTORY_CAPABILITY, ENTITY_INVENTORY_PURCHASE_ORDER, ENTITY_INVENTORY_VENDOR } from "@/server/capabilities/inventory";
import type { PurchaseOrderRow } from "@/server/capabilities/inventory";
import { requireActor } from "@/server/platform/auth";
import { hasPermission } from "@/server/platform/authorization";
import { withTenant } from "@/server/platform/tenancy";
import { runQuery } from "@/server/actions/platform";
import { ErrorState, PageHeader, Stat, StatRow } from "@/components/ui/primitives";
import { paiseToRupeesText } from "./format";
import { PurchaseOrdersDesk, type OrderListRow, type VendorRow } from "./PurchaseOrdersDesk";

export const dynamic = "force-dynamic";

type VendorQueryRow = Omit<VendorRow, "terms">;

/**
 * Buying for the outlets: vendors, purchase orders, and what has arrived
 * (PRD §21–§25). Receiving posts to the same stock ledger as `/inventory`.
 */
async function PurchaseOrdersPage() {
  const actor = await requireActor();

  const orders = await runQuery<PurchaseOrderRow[]>("verity.inventory.list_purchase_orders", {});
  if (!orders.ok) {
    return <ErrorState title="Could not load purchase orders" message={orders.message} issues={orders.issues} retryable={orders.retryable} />;
  }
  const vendors = await runQuery<VendorQueryRow[]>("verity.inventory.list_vendors", {});

  const [outlets, items, canCreate, canAddVendor] = await Promise.all([
    withTenant(actor.tenantId, (tx) => tx.location.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })),
    withTenant(actor.tenantId, (tx) =>
      tx.inventoryItem.findMany({ where: { active: true }, select: { id: true, name: true, unitLabel: true, avgUnitCostPaise: true }, orderBy: { name: "asc" } }),
    ),
    withTenant(actor.tenantId, (tx) => hasPermission(tx, actor.roleId, "Create", ENTITY_INVENTORY_PURCHASE_ORDER)),
    withTenant(actor.tenantId, (tx) => hasPermission(tx, actor.roleId, "Create", ENTITY_INVENTORY_VENDOR)),
  ]);

  const orderRows: OrderListRow[] = orders.data.map((o) => ({
    id: o.id,
    number: o.number,
    status: o.status,
    vendor: o.vendorName,
    outlet: o.locationName,
    total: paiseToRupeesText(o.totalPaise),
    progress: o.status === "Draft" || o.status === "Cancelled" ? "" : `${o.receivedQty.toLocaleString("en-IN")} of ${o.orderedQty.toLocaleString("en-IN")} received`,
    expected: o.expectedDate ?? "",
  }));
  const vendorRows: VendorRow[] = vendors.ok
    ? vendors.data.map((v) => ({ ...v, terms: v.paymentTermsDays === 0 ? "On delivery" : `${v.paymentTermsDays} days` }))
    : [];

  const waiting = orders.data.filter((o) => o.status === "PendingApproval").length;
  const open = orders.data.filter((o) => o.status === "Approved" || o.status === "PartiallyReceived");
  const openValue = open.reduce((sum, o) => sum + o.totalPaise, 0);

  return (
    <>
      <PageHeader title="Purchase orders" description="Order from vendors for each outlet and record what arrives. Accepted goods go straight into stock." />
      <StatRow cols={3} className="mb-6">
        <Stat label="Waiting for approval" value={waiting} />
        <Stat label="On order, not yet received" value={open.length} />
        <Stat label="Value on order" value={paiseToRupeesText(openValue)} />
      </StatRow>
      <PurchaseOrdersDesk
        orders={orderRows}
        vendors={vendorRows}
        outlets={outlets}
        items={items.map((i) => ({ id: i.id, name: i.name, unit: i.unitLabel, lastPricePaise: i.avgUnitCostPaise }))}
        canCreate={canCreate}
        canAddVendor={canAddVendor}
      />
    </>
  );
}

export default withCapabilityPageAccess(INVENTORY_CAPABILITY, PurchaseOrdersPage);
