import { ValidationError } from "@/server/platform/command";
import type { TenantScopedClient } from "@/server/platform/tenancy";

export const ENTITY_MANUFACTURING_ORDER = "verity.manufacturing.order";
export const ENTITY_MANUFACTURING_BOM = "verity.manufacturing.bom";
export const ENTITY_MANUFACTURING_ROUTE = "verity.manufacturing.route";
export const ENTITY_MANUFACTURING_OPERATION = "verity.manufacturing.operation";
export const ENTITY_MANUFACTURING_PASSPORT = "verity.manufacturing.passport";
export const ENTITY_MANUFACTURING_DISPATCH = "verity.manufacturing.dispatch";
export const ENTITY_MANUFACTURING_BATCH = "verity.manufacturing.batch";
export const ENTITY_MANUFACTURING_RESERVATION = "verity.manufacturing.reservation";

/** States in which an operation still has work to do (or is waiting on someone). */
export const OPEN_OPERATION_STATES = ["pending", "in_progress", "on_hold"];

/** Postgres INTEGER ceiling, with headroom. A scaled line above this would fail at write, not at validation. */
export const MAX_QTY = 2_000_000_000;

/**
 * The output and every component must be distinct, active inventory items of
 * this tenant. Shared by hand-built orders, BOMs and orders made from a BOM, so
 * the rule is written once.
 */
export async function assertItems(
  tx: TenantScopedClient,
  outputItemId: string,
  componentIds: string[],
): Promise<void> {
  if (new Set(componentIds).size !== componentIds.length) {
    throw new ValidationError("E_VALIDATION: a component appears more than once");
  }
  if (componentIds.includes(outputItemId)) {
    throw new ValidationError("E_VALIDATION: cannot consume the same item it produces");
  }

  const ids = [outputItemId, ...componentIds];
  const items = await tx.inventoryItem.findMany({ where: { id: { in: ids } } });
  const byId = new Map(items.map((i) => [i.id, i]));
  if (byId.size !== new Set(ids).size) {
    throw new ValidationError("E_VALIDATION: output or a component is not an inventory item in this tenant");
  }
  for (const id of ids) {
    if (!byId.get(id)!.active) throw new ValidationError(`E_VALIDATION: ${byId.get(id)!.name} is deactivated`);
  }
}

export async function assertOrderShape(
  tx: TenantScopedClient,
  input: { locationId: string; outputItemId: string; componentIds: string[] },
): Promise<void> {
  const location = await tx.location.findUnique({ where: { id: input.locationId } });
  if (!location) throw new ValidationError("E_VALIDATION: location not found in this tenant");
  await assertItems(tx, input.outputItemId, input.componentIds);
}

/** Writes an order and its snapshotted lines. Returns the new order id. */
export async function insertOrder(
  tx: TenantScopedClient,
  tenantId: string,
  input: {
    locationId: string;
    outputItemId: string;
    outputQty: number;
    reference?: string;
    bomId?: string;
    lines: Array<{ componentItemId: string; qtyRequired: number }>;
  },
): Promise<string> {
  const order = await tx.manufacturingOrder.create({
    data: {
      tenantId,
      locationId: input.locationId,
      outputItemId: input.outputItemId,
      outputQty: input.outputQty,
      reference: input.reference?.trim() || null,
      bomId: input.bomId ?? null,
    },
  });
  await tx.manufacturingOrderLine.createMany({
    data: input.lines.map((line) => ({
      tenantId,
      manufacturingOrderId: order.id,
      componentItemId: line.componentItemId,
      qtyRequired: line.qtyRequired,
    })),
  });
  return order.id;
}
