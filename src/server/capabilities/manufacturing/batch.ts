import { z } from "zod";
import { registerCommand, ValidationError, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import type { TenantScopedClient } from "@/server/platform/tenancy";
import { ENTITY_MANUFACTURING_BATCH, ENTITY_MANUFACTURING_RESERVATION } from "./shared";

/**
 * Stock reservation and order consolidation (Task 118, Carxen).
 *
 * A RESERVATION is a hold, not a movement: nothing leaves the location until the
 * order starts. Available stock for an order is what is on hand minus the live
 * holds of OTHER orders, so two orders can never both be promised the same fabric.
 * Holds are released, never deleted (why stock was unavailable has an answer): when
 * the order starts (`consumed`), is cancelled, or the hold is let go.
 *
 * A BATCH groups draft orders at one location so they are produced together (one
 * cutting run). It has no lifecycle of its own: progress is its member orders'.
 * Reserving a batch holds every member's components in one all-or-nothing check.
 */

/* ------------------------------ shared helpers ----------------------------- */

/**
 * Serialises reserve/start for one location. Without it two transactions could
 * each see the same free stock and both take it. Transaction-scoped, so it is
 * released at commit and is safe behind a transaction-mode pooler.
 */
export async function lockLocationStock(tx: TenantScopedClient, tenantId: string, locationId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["mfg-stock", tenantId, locationId])}, 0))`;
}

/** Live holds on an item at a location, excluding the given orders' own. */
export async function heldByOthers(
  tx: TenantScopedClient,
  itemId: string,
  locationId: string,
  exceptOrderIds: string[],
): Promise<number> {
  const held = await tx.manufacturingReservation.aggregate({
    _sum: { qty: true },
    where: { componentItemId: itemId, locationId, releasedAt: null, orderId: { notIn: exceptOrderIds } },
  });
  return held._sum.qty ?? 0;
}

async function onHand(tx: TenantScopedClient, tenantId: string, itemId: string, locationId: string): Promise<number> {
  const balance = await tx.inventoryStockBalance.findUnique({
    where: { tenantId_itemId_locationId: { tenantId, itemId, locationId } },
  });
  return balance?.qty ?? 0;
}

/** Lets go of every live hold an order has. Used on start, cancel and manual release. */
export async function releaseOrderReservations(tx: TenantScopedClient, orderId: string, reason: string): Promise<number> {
  const released = await tx.manufacturingReservation.updateMany({
    where: { orderId, releasedAt: null },
    data: { releasedAt: new Date(), releaseReason: reason },
  });
  return released.count;
}

/**
 * Holds every line of every given draft order, or none. The check is per
 * component across all the orders together (consolidated), against stock on hand
 * minus other orders' holds; a component already held for one of these orders is
 * not counted twice.
 */
async function reserveOrders(tx: TenantScopedClient, tenantId: string, orderIds: string[]): Promise<number> {
  const orders = await tx.manufacturingOrder.findMany({
    where: { id: { in: orderIds } },
    include: { lines: { include: { componentItem: true } } },
  });
  if (orders.length !== orderIds.length) throw new ValidationError("E_VALIDATION: an order was not found in this tenant");
  const locations = new Set(orders.map((o) => o.locationId));
  if (locations.size !== 1) throw new ValidationError("E_VALIDATION: orders at different locations cannot be reserved together");
  const locationId = orders[0].locationId;
  for (const order of orders) {
    if (order.state !== "draft") throw new ValidationError("E_VALIDATION: only a draft order can reserve stock");
  }

  await lockLocationStock(tx, tenantId, locationId);

  const live = await tx.manufacturingReservation.findMany({ where: { orderId: { in: orderIds }, releasedAt: null } });
  const liveKey = new Set(live.map((r) => `${r.orderId}:${r.componentItemId}`));

  const needed = new Map<string, { name: string; qty: number }>();
  for (const order of orders) {
    for (const line of order.lines) {
      const entry = needed.get(line.componentItemId) ?? { name: line.componentItem.name, qty: 0 };
      entry.qty += line.qtyRequired;
      needed.set(line.componentItemId, entry);
    }
  }
  for (const [itemId, need] of needed) {
    const available = (await onHand(tx, tenantId, itemId, locationId)) - (await heldByOthers(tx, itemId, locationId, orderIds));
    if (available < need.qty) {
      throw new ValidationError(`E_VALIDATION: not enough ${need.name} to reserve (need ${need.qty}, ${Math.max(available, 0)} available)`);
    }
  }

  const fresh = orders.flatMap((order) =>
    order.lines
      .filter((line) => !liveKey.has(`${order.id}:${line.componentItemId}`))
      .map((line) => ({ tenantId, orderId: order.id, componentItemId: line.componentItemId, locationId, qty: line.qtyRequired })),
  );
  if (fresh.length) await tx.manufacturingReservation.createMany({ data: fresh });
  return fresh.length;
}

/* -------------------------------- reservation ------------------------------- */

export const reserveOrder: CommandDefinition<{ orderId: string }, { held: number }> = {
  key: "verity.manufacturing.reserve_order",
  entity: ENTITY_MANUFACTURING_RESERVATION,
  verb: "Create",
  input: z.object({ orderId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const held = await reserveOrders(ctx.tx, ctx.actor.tenantId, [input.orderId]);
    return { result: { held }, events: [{ name: "verity.manufacturing.stock_reserved", entityId: input.orderId }] };
  },
};

export const releaseReservation: CommandDefinition<{ orderId: string }, { released: number }> = {
  key: "verity.manufacturing.release_reservation",
  entity: ENTITY_MANUFACTURING_RESERVATION,
  verb: "Edit",
  input: z.object({ orderId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const released = await releaseOrderReservations(ctx.tx, input.orderId, "released");
    return { result: { released }, events: [{ name: "verity.manufacturing.stock_released", entityId: input.orderId }] };
  },
};

/* ---------------------------------- batches --------------------------------- */

export const createBatch: CommandDefinition<{ orderIds: string[]; reference?: string }, { id: string }> = {
  key: "verity.manufacturing.create_batch",
  entity: ENTITY_MANUFACTURING_BATCH,
  verb: "Create",
  input: z.object({
    orderIds: z.array(z.string().uuid()).min(2).max(200),
    reference: z.string().trim().max(120).optional(),
  }),
  preconditions: async (ctx, input) => {
    if (new Set(input.orderIds).size !== input.orderIds.length) throw new ValidationError("E_VALIDATION: an order appears twice");
    const orders = await ctx.tx.manufacturingOrder.findMany({ where: { id: { in: input.orderIds } } });
    if (orders.length !== input.orderIds.length) throw new ValidationError("E_VALIDATION: an order was not found in this tenant");
    if (orders.some((o) => o.state !== "draft")) throw new ValidationError("E_VALIDATION: only draft orders can be batched");
    if (orders.some((o) => o.batchId)) throw new ValidationError("E_VALIDATION: an order is already in a batch");
    if (new Set(orders.map((o) => o.locationId)).size !== 1) {
      throw new ValidationError("E_VALIDATION: a batch must be produced at one location");
    }
  },
  handler: async (ctx, input) => {
    const first = await ctx.tx.manufacturingOrder.findFirstOrThrow({ where: { id: { in: input.orderIds } } });
    const batch = await ctx.tx.manufacturingBatch.create({
      data: {
        tenantId: ctx.actor.tenantId,
        locationId: first.locationId,
        reference: input.reference || null,
        createdById: ctx.actor.userId,
      },
    });
    await ctx.tx.manufacturingOrder.updateMany({ where: { id: { in: input.orderIds } }, data: { batchId: batch.id } });
    return { result: { id: batch.id }, events: [{ name: "verity.manufacturing.batch_created", entityId: batch.id }] };
  },
};

async function batchOrderIds(tx: TenantScopedClient, batchId: string): Promise<string[]> {
  const batch = await tx.manufacturingBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new ValidationError("E_VALIDATION: batch not found in this tenant");
  return (await tx.manufacturingOrder.findMany({ where: { batchId }, select: { id: true } })).map((o) => o.id);
}

/** Holds every member order's components in one all-or-nothing, consolidated check. */
export const reserveBatch: CommandDefinition<{ batchId: string }, { held: number }> = {
  key: "verity.manufacturing.reserve_batch",
  entity: ENTITY_MANUFACTURING_RESERVATION,
  verb: "Create",
  input: z.object({ batchId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const ids = await batchOrderIds(ctx.tx, input.batchId);
    const held = await reserveOrders(ctx.tx, ctx.actor.tenantId, ids);
    return { result: { held }, events: [{ name: "verity.manufacturing.batch_reserved", entityId: input.batchId }] };
  },
};

/** Frees the orders again. Allowed only while every member is still a draft. */
export const dissolveBatch: CommandDefinition<{ batchId: string }, { id: string }> = {
  key: "verity.manufacturing.dissolve_batch",
  entity: ENTITY_MANUFACTURING_BATCH,
  verb: "Delete",
  input: z.object({ batchId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const ids = await batchOrderIds(ctx.tx, input.batchId);
    const started = await ctx.tx.manufacturingOrder.count({ where: { id: { in: ids }, state: { not: "draft" } } });
    if (started > 0) throw new ValidationError("E_VALIDATION: a batch with started orders cannot be dissolved");
    await ctx.tx.manufacturingOrder.updateMany({ where: { id: { in: ids } }, data: { batchId: null } });
    await ctx.tx.manufacturingBatch.delete({ where: { id: input.batchId } });
    return { result: { id: input.batchId }, events: [{ name: "verity.manufacturing.batch_dissolved", entityId: input.batchId }] };
  },
};

/* ---------------------------------- queries --------------------------------- */

export type BatchRow = { id: string; reference: string | null; location: string; orders: number; createdAt: Date };

export const listBatches: QueryDefinition<Record<string, never>, BatchRow[]> = {
  key: "verity.manufacturing.list_batches",
  entity: ENTITY_MANUFACTURING_BATCH,
  input: z.object({}),
  handler: async (ctx) => {
    const batches = await ctx.tx.manufacturingBatch.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
    const locations = await ctx.tx.location.findMany({ where: { id: { in: batches.map((b) => b.locationId) } } });
    const counts = await ctx.tx.manufacturingOrder.groupBy({ by: ["batchId"], where: { batchId: { in: batches.map((b) => b.id) } }, _count: true });
    return batches.map((b) => ({
      id: b.id,
      reference: b.reference,
      location: locations.find((l) => l.id === b.locationId)?.name ?? "—",
      orders: counts.find((c) => c.batchId === b.id)?._count ?? 0,
      createdAt: b.createdAt,
    }));
  },
};

export type BatchDetail = {
  id: string;
  reference: string | null;
  location: string;
  orders: Array<{ id: string; reference: string | null; state: string; outputName: string; outputQty: number; reserved: boolean }>;
  /** What the whole batch consumes, set against stock: the stock-match. */
  requirements: Array<{ itemId: string; name: string; required: number; onHand: number; heldElsewhere: number; shortfall: number }>;
};

export const batchDetail: QueryDefinition<{ batchId: string }, BatchDetail> = {
  key: "verity.manufacturing.batch_detail",
  entity: ENTITY_MANUFACTURING_BATCH,
  input: z.object({ batchId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const batch = await ctx.tx.manufacturingBatch.findUnique({ where: { id: input.batchId } });
    if (!batch) throw new ValidationError("E_VALIDATION: batch not found in this tenant");
    const [location, orders] = await Promise.all([
      ctx.tx.location.findUnique({ where: { id: batch.locationId } }),
      ctx.tx.manufacturingOrder.findMany({
        where: { batchId: batch.id },
        include: { outputItem: true, lines: { include: { componentItem: true } } },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    const ids = orders.map((o) => o.id);
    const holds = await ctx.tx.manufacturingReservation.findMany({ where: { orderId: { in: ids }, releasedAt: null } });

    const required = new Map<string, { name: string; qty: number }>();
    for (const order of orders) {
      for (const line of order.lines) {
        const entry = required.get(line.componentItemId) ?? { name: line.componentItem.name, qty: 0 };
        entry.qty += line.qtyRequired;
        required.set(line.componentItemId, entry);
      }
    }
    const requirements: BatchDetail["requirements"] = [];
    for (const [itemId, need] of required) {
      const have = await onHand(ctx.tx, ctx.actor.tenantId, itemId, batch.locationId);
      const elsewhere = await heldByOthers(ctx.tx, itemId, batch.locationId, ids);
      requirements.push({
        itemId,
        name: need.name,
        required: need.qty,
        onHand: have,
        heldElsewhere: elsewhere,
        shortfall: Math.max(need.qty - Math.max(have - elsewhere, 0), 0),
      });
    }
    return {
      id: batch.id,
      reference: batch.reference,
      location: location?.name ?? "—",
      orders: orders.map((o) => ({
        id: o.id,
        reference: o.reference,
        state: o.state,
        outputName: o.outputItem.name,
        outputQty: o.outputQty,
        reserved: o.lines.length > 0 && o.lines.every((l) => holds.some((h) => h.orderId === o.id && h.componentItemId === l.componentItemId)),
      })),
      requirements,
    };
  },
};

/** Whether one order currently holds its stock. */
export const orderReservations: QueryDefinition<{ orderId: string }, { held: number; lines: number }> = {
  key: "verity.manufacturing.order_reservations",
  entity: ENTITY_MANUFACTURING_RESERVATION,
  input: z.object({ orderId: z.string().uuid() }),
  handler: async (ctx, input) => ({
    held: await ctx.tx.manufacturingReservation.count({ where: { orderId: input.orderId, releasedAt: null } }),
    lines: await ctx.tx.manufacturingOrderLine.count({ where: { manufacturingOrderId: input.orderId } }),
  }),
};

export function registerManufacturingBatch(): void {
  registerCommand(reserveOrder);
  registerCommand(releaseReservation);
  registerCommand(createBatch);
  registerCommand(reserveBatch);
  registerCommand(dissolveBatch);
  registerQuery(listBatches);
  registerQuery(batchDetail);
  registerQuery(orderReservations);
}
