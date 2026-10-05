import { MOVEMENT_KINDS } from "./kinds";

/**
 * The one write path for a stock balance (Task 73's critical requirement:
 * balance and movement move in the same transaction). Commands in this
 * capability (movements, counts, goods receipts) all post through here, so
 * there is one ledger and one place that keeps the moving-average cost.
 */

export type MovementInput = {
  itemId: string;
  locationId: string;
  kind: (typeof MOVEMENT_KINDS)[number];
  qty: number;
  reference?: string;
  unitCostPaise?: number;
};

/** Writes the movement and moves the balance in the caller's transaction. */
export async function applyMovement(
  tx: import("@/server/platform/tenancy").TenantScopedClient,
  actor: { tenantId: string; userId: string },
  input: MovementInput,
) {
  // Total on-hand across every location BEFORE this movement — the base
  // the moving average weights against. Read before either write below.
  const priorTotal = input.unitCostPaise === undefined ? 0 : await totalOnHand(tx, input.itemId);

  await tx.inventoryStockMovement.create({
    data: {
      tenantId: actor.tenantId,
      itemId: input.itemId,
      locationId: input.locationId,
      kind: input.kind,
      qty: input.qty,
      reference: input.reference ?? null,
      unitCostPaise: input.unitCostPaise ?? null,
      movedById: actor.userId,
    },
  });

  const balance = await tx.inventoryStockBalance.upsert({
    where: {
      tenantId_itemId_locationId: { tenantId: actor.tenantId, itemId: input.itemId, locationId: input.locationId },
    },
    create: { tenantId: actor.tenantId, itemId: input.itemId, locationId: input.locationId, qty: input.qty },
    update: { qty: { increment: input.qty } },
  });

  if (input.unitCostPaise !== undefined) {
    const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: input.itemId } });
    const newAvg =
      item.avgUnitCostPaise === null || priorTotal <= 0
        ? input.unitCostPaise
        : Math.round(
            (item.avgUnitCostPaise * priorTotal + input.unitCostPaise * input.qty) / (priorTotal + input.qty),
          );
    await tx.inventoryItem.update({
      where: { id: input.itemId },
      data: { avgUnitCostPaise: newAvg },
    });
  }
  return balance;
}

async function totalOnHand(
  tx: import("@/server/platform/tenancy").TenantScopedClient,
  itemId: string,
): Promise<number> {
  const agg = await tx.inventoryStockBalance.aggregate({ where: { itemId }, _sum: { qty: true } });
  return agg._sum.qty ?? 0;
}
