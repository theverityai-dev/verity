import Link from "next/link";
import { notFound } from "next/navigation";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { INVENTORY_CAPABILITY } from "@/server/capabilities/inventory";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { runQuery } from "@/server/actions/platform";
import { DataTable } from "@/components/ui/DataTable";
import { ErrorState, PageHeader, Stat, StatRow } from "@/components/ui/primitives";
import { day, rupees } from "@/components/ui/business/format";
import { ItemActiveToggle } from "./ItemActiveToggle";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

const KIND_LABEL: Record<string, string> = {
  Receipt: "Received",
  Issue: "Used",
  Adjustment: "Count correction",
  Transfer: "Transfer",
};

/**
 * What a movement was, in the outlet's words. References written by other
 * capabilities are system keys (a settled order, a wastage record), so they
 * are translated here instead of being shown raw.
 */
function describe(kind: string, reference: string | null, wastageReason: string | null): string {
  if (wastageReason) return `Wasted: ${wastageReason}`;
  if (reference?.startsWith("dining_order:")) return "Sold (recipe usage)";
  return KIND_LABEL[kind] ?? kind;
}

/**
 * PRD §18 — every movement of one item, with a running balance per outlet,
 * newest first so today's activity is at the top.
 */
async function InventoryItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ itemId: string }>;
  searchParams: Promise<{ outlet?: string }>;
}) {
  const actor = await requireActor();
  const { itemId } = await params;
  const { outlet } = await searchParams;
  if (!UUID.test(itemId)) notFound();

  // The capability's ledger query carries the stock read permission.
  const permitted = await runQuery<unknown[]>("verity.inventory.stock_ledger", { itemId });
  if (!permitted.ok) {
    return <ErrorState title="Could not load the item" message={permitted.message} issues={permitted.issues} retryable={permitted.retryable} />;
  }

  const [item, locations, movements] = await Promise.all([
    withTenant(actor.tenantId, (tx) =>
      tx.inventoryItem.findUnique({ where: { id: itemId }, include: { itemGroup: { select: { name: true } } } }),
    ),
    withTenant(actor.tenantId, (tx) => tx.location.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })),
    withTenant(actor.tenantId, (tx) =>
      tx.inventoryStockMovement.findMany({
        where: { itemId },
        include: { wastageRecord: { select: { reason: true, valuePaise: true, notes: true } } },
        orderBy: { movedAt: "asc" },
      }),
    ),
  ]);
  if (!item) notFound();

  const userIds = [...new Set(movements.map((m) => m.movedById))];
  const users = userIds.length
    ? await withTenant(actor.tenantId, (tx) =>
        tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, party: { select: { displayName: true } } } }),
      )
    : [];
  const userName = new Map(users.map((u) => [u.id, u.party.displayName]));
  const locationName = new Map(locations.map((l) => [l.id, l.name]));
  const outletFilter = outlet && UUID.test(outlet) ? outlet : null;
  const unit = item.unitLabel;
  const qty = (n: number) => `${n.toLocaleString("en-IN")} ${unit}`;
  const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-IN")}`;

  // Balances accumulate oldest first; the table then shows newest first.
  const running = new Map<string, number>();
  const rows = movements.map((m) => {
    const balance = (running.get(m.locationId) ?? 0) + m.qty;
    running.set(m.locationId, balance);
    const typedNote = m.reference && !m.reference.startsWith("dining_order:") && m.reference !== "wastage" ? m.reference : "";
    return {
      id: m.id,
      locationId: m.locationId,
      date: day(m.movedAt),
      outlet: locationName.get(m.locationId) ?? "Unknown outlet",
      what: describe(m.kind, m.reference, m.wastageRecord?.reason ?? null),
      note: m.wastageRecord?.notes ?? typedNote,
      change: signed(m.qty),
      cost: m.unitCostPaise === null ? "" : `${rupees(m.unitCostPaise)} per ${unit}`,
      balance: qty(balance),
      by: userName.get(m.movedById) ?? "Unknown",
    };
  });
  const visible = (outletFilter ? rows.filter((r) => r.locationId === outletFilter) : rows).reverse();

  const totalOnHand = [...running.values()].reduce((a, b) => a + b, 0);
  const wastedValue = movements.reduce((sum, m) => sum + (m.wastageRecord?.valuePaise ?? 0), 0);

  return (
    <>
      <PageHeader
        title={item.name}
        description={`${item.itemGroup?.name ?? "Uncategorized"} · code ${item.sku} · counted in ${unit}${item.active ? "" : " · inactive"}`}
        actions={
          <div className="flex items-center gap-3">
            <Link href="/inventory" className="text-[13px] text-text-secondary underline-offset-4 hover:underline">
              Back to inventory
            </Link>
            <ItemActiveToggle itemId={item.id} active={item.active} />
          </div>
        }
      />
      <StatRow cols={4} className="mb-6">
        <Stat label="On hand, all outlets" value={qty(totalOnHand)} />
        <Stat label="Average cost" value={item.avgUnitCostPaise === null ? "No cost yet" : `${rupees(item.avgUnitCostPaise)} per ${unit}`} />
        <Stat label="Reorder level" value={item.reorderLevel > 0 ? qty(item.reorderLevel) : "Not set"} />
        <Stat label="Wasted to date" value={rupees(wastedValue)} />
      </StatRow>
      <DataTable
        caption={outletFilter ? `Movements at ${locationName.get(outletFilter) ?? "this outlet"}, newest first` : "Movements, newest first"}
        emptyTitle="No movements yet"
        emptyDescription="Receive the first delivery from the inventory list to start this ledger."
        columns={[
          { key: "date", header: "Date" },
          { key: "what", header: "Movement", subKey: "note" },
          { key: "outlet", header: "Outlet", sortable: true },
          { key: "change", header: "Change", numeric: true },
          { key: "balance", header: "Balance at outlet", numeric: true },
          { key: "cost", header: "Cost" },
          { key: "by", header: "Recorded by", sortable: true },
        ]}
        rows={visible}
      />
    </>
  );
}

export default withCapabilityPageAccess(INVENTORY_CAPABILITY, InventoryItemPage);
