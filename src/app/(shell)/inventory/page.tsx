import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { INVENTORY_CAPABILITY, WASTAGE_REASONS } from "@/server/capabilities/inventory";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { runQuery } from "@/server/actions/platform";
import { EmptyState, ErrorState, PageHeader, Stat, StatRow } from "@/components/ui/primitives";
import { day, rupees } from "@/components/ui/business/format";
import { trailingDaysRange } from "@/lib/date-range";
import { InventoryDesk, type CategoryRow, type StockRow, type WastageRow } from "./InventoryDesk";

export const dynamic = "force-dynamic";

type OnHand = { itemId: string; itemSku: string; locationId: string; qty: number };

const WASTAGE_WINDOW_DAYS = 30;
/**
 * Wastage is a loss that has already happened, so it is recorded at once and
 * a large one is flagged for the manager to review rather than blocked
 * (DECISIONS.md #4, Rs 2,000).
 */
const WASTAGE_REVIEW_PAISE = 200_000;

/**
 * PRD §17–§20: what each outlet holds, what it is worth, what was wasted.
 * One outlet at a time, because stock is counted, received and wasted at an
 * outlet; the item ledger (`/inventory/[itemId]`) shows every outlet together.
 */
async function InventoryPage({ searchParams }: { searchParams: Promise<{ outlet?: string }> }) {
  const actor = await requireActor();
  const { outlet } = await searchParams;

  const locations = await withTenant(actor.tenantId, (tx) =>
    tx.location.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  );
  if (locations.length === 0) {
    return (
      <>
        <PageHeader title="Inventory" description="Stock on hand, receipts, usage and wastage for each outlet." />
        <EmptyState title="No outlets yet" description="Add an outlet under Locations, then return here to record its stock." />
      </>
    );
  }
  const current = locations.find((l) => l.id === outlet) ?? locations[0];

  // Read through the capability's own query first: it carries the stock read
  // permission, so a person without it sees the error, not a page of numbers.
  const onHand = await runQuery<OnHand[]>("verity.inventory.stock_on_hand", { locationId: current.id });
  if (!onHand.ok) {
    return <ErrorState title="Could not load inventory" message={onHand.message} issues={onHand.issues} retryable={onHand.retryable} />;
  }

  const since = new Date(`${trailingDaysRange(WASTAGE_WINDOW_DAYS).fromDate}T00:00:00.000Z`);
  const [items, groups, wastage] = await Promise.all([
    withTenant(actor.tenantId, (tx) =>
      tx.inventoryItem.findMany({ include: { itemGroup: { select: { name: true } } }, orderBy: { name: "asc" } }),
    ),
    withTenant(actor.tenantId, (tx) =>
      tx.inventoryItemGroup.findMany({ include: { _count: { select: { items: true } } }, orderBy: { name: "asc" } }),
    ),
    withTenant(actor.tenantId, (tx) =>
      tx.inventoryWastageRecord.findMany({
        where: { createdAt: { gte: since }, movement: { locationId: current.id } },
        include: { movement: { select: { qty: true, movedById: true, movedAt: true, item: { select: { name: true, unitLabel: true } } } } },
        orderBy: { createdAt: "desc" },
      }),
    ),
  ]);

  const recorderIds = [...new Set(wastage.map((w) => w.movement.movedById))];
  const recorders = recorderIds.length
    ? await withTenant(actor.tenantId, (tx) =>
        tx.user.findMany({ where: { id: { in: recorderIds } }, select: { id: true, party: { select: { displayName: true } } } }),
      )
    : [];
  const recorderName = new Map(recorders.map((u) => [u.id, u.party.displayName]));

  const qtyByItem = new Map(onHand.data.map((b) => [b.itemId, b.qty]));
  const stockRows: StockRow[] = items.map((item) => {
    const qty = qtyByItem.get(item.id) ?? 0;
    const low = item.active && item.reorderLevel > 0 && qty <= item.reorderLevel;
    return {
      id: item.id,
      name: item.name,
      sku: item.sku,
      category: item.itemGroup?.name ?? "Uncategorized",
      onHand: `${qty.toLocaleString("en-IN")} ${item.unitLabel}`,
      onHandQty: qty,
      unit: item.unitLabel,
      reorderLevel: item.reorderLevel > 0 ? `${item.reorderLevel.toLocaleString("en-IN")} ${item.unitLabel}` : "Not set",
      value: item.avgUnitCostPaise === null ? "No cost yet" : rupees(qty * item.avgUnitCostPaise),
      status: !item.active ? "Inactive" : low ? "Low stock" : "In stock",
      active: item.active,
    };
  });

  const wastageRows: WastageRow[] = wastage.map((w) => ({
    id: w.id,
    date: day(w.createdAt),
    item: w.movement.item.name,
    quantity: `${Math.abs(w.movement.qty).toLocaleString("en-IN")} ${w.movement.item.unitLabel}`,
    reason: w.reason,
    value: rupees(w.valuePaise),
    recordedBy: recorderName.get(w.movement.movedById) ?? "Unknown",
    notes: w.notes ?? "",
    review: w.valuePaise > WASTAGE_REVIEW_PAISE ? "Over ₹2,000: manager to review" : "",
  }));

  const categoryRows: CategoryRow[] = groups.map((g) => ({ id: g.id, name: g.name, items: g._count.items }));

  const activeRows = stockRows.filter((r) => r.active);
  const lowCount = activeRows.filter((r) => r.status === "Low stock").length;
  const stockValue = items.reduce((sum, item) => {
    if (item.avgUnitCostPaise === null) return sum;
    return sum + (qtyByItem.get(item.id) ?? 0) * item.avgUnitCostPaise;
  }, 0);
  const wastageValue = wastage.reduce((sum, w) => sum + w.valuePaise, 0);

  return (
    <>
      <PageHeader
        title="Inventory"
        description={`Stock on hand at ${current.name}. Receive deliveries, record usage and wastage, and correct counts here.`}
      />
      <StatRow cols={4} className="mb-6">
        <Stat label="Active items" value={activeRows.length} />
        <Stat label="At or below reorder level" value={lowCount} />
        <Stat label="Stock value" value={rupees(stockValue)} />
        <Stat label={`Wastage, last ${WASTAGE_WINDOW_DAYS} days`} value={rupees(wastageValue)} />
      </StatRow>
      <InventoryDesk
        outlets={locations}
        outletId={current.id}
        stock={stockRows}
        wastage={wastageRows}
        categories={categoryRows}
        wastageReasons={[...WASTAGE_REASONS]}
      />
    </>
  );
}

export default withCapabilityPageAccess(INVENTORY_CAPABILITY, InventoryPage);
