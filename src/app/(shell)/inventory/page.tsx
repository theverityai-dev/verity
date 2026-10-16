import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { INVENTORY_CAPABILITY, WASTAGE_REASONS } from "@/server/capabilities/inventory";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { runQuery } from "@/server/actions/platform";
import { isCapabilityActive } from "@/server/platform/capability";
import { RECIPE_CAPABILITY } from "@/server/capabilities/recipe";
import { EmptyState, ErrorState, PageHeader, StatTile, StatTileRow } from "@/components/ui/primitives";
import { day, rupees } from "@/components/ui/business/format";
import { trailingDaysRange } from "@/lib/date-range";
import { InventoryDesk, type CategoryRow, type StockRow, type WastageRow } from "./InventoryDesk";
import type { StockRequestRow, VarianceRowView } from "./RequestsAndVariance";
import type { VarianceRow } from "@/server/capabilities/inventory";

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
async function InventoryPage({ searchParams }: { searchParams: Promise<{ location?: string }> }) {
  const actor = await requireActor();
  const { location: locationParam } = await searchParams;

  const locations = await withTenant(actor.tenantId, (tx) =>
    tx.location.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  );
  if (locations.length === 0) {
    return (
      <>
        <PageHeader title="Inventory" description="Stock on hand, receipts, usage and wastage for each location." />
        <EmptyState title="No locations yet" description="Add a location under Locations, then return here to record its stock." />
      </>
    );
  }
  const current = locations.find((l) => l.id === locationParam) ?? locations[0];

  // Read through the capability's own query first: it carries the stock read
  // permission, so a person without it sees the error, not a page of numbers.
  const onHand = await runQuery<OnHand[]>("verity.inventory.stock_on_hand", { locationId: current.id });
  if (!onHand.ok) {
    return <ErrorState title="Could not load inventory" message={onHand.message} issues={onHand.issues} retryable={onHand.retryable} />;
  }

  const range = trailingDaysRange(WASTAGE_WINDOW_DAYS);
  const since = new Date(`${range.fromDate}T00:00:00.000Z`);
  // Variance is recipe usage against sales: it exists only where the recipe capability is on, so a
  // factory never sees a restaurant's food-cost tab.
  const showVariance = await withTenant(actor.tenantId, (tx) => isCapabilityActive(tx, actor.tenantId, RECIPE_CAPABILITY));
  const [requests, variance] = await Promise.all([
    runQuery<Array<Omit<StockRequestRow, "createdAt"> & { createdAt: string | Date }>>("verity.inventory.list_stock_requests", {}),
    showVariance
      ? runQuery<VarianceRow[]>("verity.inventory.food_cost_variance", { locationId: current.id, fromDate: range.fromDate, toDate: range.toDate })
      : Promise.resolve({ ok: false as const, message: "", issues: [], retryable: false }),
  ]);
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
      // An item with no reorder level is not being kept in stock (made to order), so nothing on hand is
      // a fact, not an alarm.
      status: !item.active ? "Inactive" : qty <= 0 ? (item.reorderLevel > 0 ? "Out of stock" : "None on hand") : low ? "Low stock" : "In stock",
      statusCategory: !item.active ? "Cancelled" : qty <= 0 ? (item.reorderLevel > 0 ? "Blocked" : "Draft") : low ? "Blocked" : "Completed",
      level:
        item.reorderLevel > 0
          ? {
              value: qty,
              total: Math.max(qty, item.reorderLevel * 2),
              marker: item.reorderLevel,
              tone: low ? "blocked" : "completed",
              figures: `${qty.toLocaleString("en-IN")} ${item.unitLabel}`,
            }
          : null,
      kind: "stock",
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
      <StatTileRow cols={4} className="mb-6">
        <StatTile kind="stock" label="Active items" value={activeRows.length} />
        <StatTile
          state={lowCount > 0 ? "blocked" : "completed"}
          icon={lowCount > 0 ? "hold" : "check"}
          label="At or below reorder level"
          value={lowCount}
          hint={lowCount > 0 ? "Reorder these first" : "Nothing to reorder"}
        />
        <StatTile kind="money" label="Stock value" value={rupees(stockValue)} />
        <StatTile kind="stock" hue="brown" icon="rework" label={`Wastage, last ${WASTAGE_WINDOW_DAYS} days`} value={rupees(wastageValue)} />
      </StatTileRow>
      <InventoryDesk
        outlets={locations}
        outletId={current.id}
        stock={stockRows}
        wastage={wastageRows}
        categories={categoryRows}
        wastageReasons={[...WASTAGE_REASONS]}
        requests={requests.ok ? requests.data.map((r) => ({ ...r, createdAt: day(new Date(r.createdAt)) })) : []}
        variance={
          variance.ok
            ? variance.data.map((v): VarianceRowView => ({ ...v, unexplained: v.unexplainedPaise === 0 ? "None" : rupees(v.unexplainedPaise) }))
            : []
        }
        varianceDays={WASTAGE_WINDOW_DAYS}
        showVariance={showVariance}
      />
    </>
  );
}

export default withCapabilityPageAccess(INVENTORY_CAPABILITY, InventoryPage);
