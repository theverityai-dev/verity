import { z } from "zod";
import {
  registerCommand,
  ValidationError,
  type CommandDefinition,
} from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { registerContribution } from "@/server/platform/contribution";
import { assertMutable, transition } from "@/server/platform/state";
import { diffFields, recordActivity } from "@/server/platform/audit";
import {
  assertOrderShape,
  ENTITY_MANUFACTURING_BATCH,
  ENTITY_MANUFACTURING_BOM,
  ENTITY_MANUFACTURING_OPERATION,
  ENTITY_MANUFACTURING_ORDER,
  ENTITY_MANUFACTURING_ROUTE,
  insertOrder,
  OPEN_OPERATION_STATES,
} from "./shared";
import { cancelOpenOperations, registerManufacturingStages } from "./stages";
import { registerManufacturingPassport } from "./passport";
import { registerManufacturingBom } from "./bom";
import { registerManufacturingLogistics } from "./logistics";
import { heldByOthers, lockLocationStock, registerManufacturingBatch, releaseOrderReservations } from "./batch";

/**
 * CAPABILITY: Manufacturing — `verity.capability.manufacturing` (Task 118
 * minimal slice)
 *
 * Authority: `taskplans/118_manufacturing_capability_odoo_gap_and_ux_
 * completeness.md` §3, product-owner override 2026-09-24 (same posture as
 * Task 84 Phase 4's override for `recipe`/`plywood`/`trading` — the
 * platform's "Not in scope now" list still names manufacturing-shaped work,
 * but the practice already moved past that).
 *
 * SCOPE BUILT: one entity, `ManufacturingOrder` — a production run that
 * consumes snapshotted component lines and produces a stated output
 * quantity, moving Draft -> InProgress -> Completed | Cancelled. Composes
 * `Location` and `InventoryItem`/the existing stock ledger
 * (`inventory.recordStockMovement`'s underlying tables) rather than
 * inventing parallel stock-tracking. Consumption and production are posted
 * as plain direct writes to `InventoryStockMovement`/`InventoryStockBalance`
 * inside this capability's own commands — same pattern as
 * `recipe.postConsumptionForOrder` (a plain internal function under one
 * command's `authorize()`, not a nested registered-command call) — but,
 * unlike recipe's deliberately *theoretical* consumption, a manufacturing
 * order's consumption is real and DOES enforce the negative-stock guard
 * `inventory.recordStockMovement` also enforces (checked here directly,
 * since that guard lives inside a registered command this capability does
 * not call).
 *
 * NOT chosen: referencing `recipe.Recipe` as this order's BOM. `Recipe` is
 * keyed 1:1 to `MenuItem` (Colonel Kebabz's dinein-specific entity) — a
 * manufacturing order forcing a fake `menuItemId` to borrow it would be the
 * wrong fit, not a reuse. `ManufacturingOrderLine` snapshots components
 * directly instead.
 *
 * SOURCE OF TRUTH: stock on hand is read from `InventoryStockBalance`
 * (itself derived from `InventoryStockMovement`) exactly like every other
 * capability that touches inventory — this capability keeps no cached qty
 * of its own anywhere.
 *
 * NOT YET BUILT, named so a later audit doesn't silently assume otherwise:
 * lot/serial, work-center capacity/cost, BOM cost roll-up, QC evidence
 * wiring, putaway rules, backorders/partial completion, `recipe`
 * generalization into a shared multi-level BOM engine, and any UI beyond
 * this file's server-side commands/queries.
 */

export const MANUFACTURING_CAPABILITY = "verity.capability.manufacturing";
export {
  ENTITY_MANUFACTURING_ORDER,
  ENTITY_MANUFACTURING_BOM,
  ENTITY_MANUFACTURING_ROUTE,
  ENTITY_MANUFACTURING_OPERATION,
  ENTITY_MANUFACTURING_PASSPORT,
  ENTITY_MANUFACTURING_DISPATCH,
  ENTITY_MANUFACTURING_BATCH,
  ENTITY_MANUFACTURING_RESERVATION,
} from "./shared";

const lineInput = z.object({
  componentItemId: z.string().uuid(),
  qtyRequired: z.number().int().positive(),
});

/* ============================= create ============================= */

export const createManufacturingOrder: CommandDefinition<
  {
    locationId: string;
    outputItemId: string;
    outputQty: number;
    reference?: string;
    lines: Array<z.infer<typeof lineInput>>;
  },
  { id: string }
> = {
  key: "verity.manufacturing.create_order",
  entity: ENTITY_MANUFACTURING_ORDER,
  verb: "Create",
  input: z.object({
    locationId: z.string().uuid(),
    outputItemId: z.string().uuid(),
    outputQty: z.number().int().positive(),
    reference: z.string().max(200).optional(),
    lines: z.array(lineInput).min(1),
  }),
  preconditions: (ctx, input) =>
    assertOrderShape(ctx.tx, {
      locationId: input.locationId,
      outputItemId: input.outputItemId,
      componentIds: input.lines.map((l) => l.componentItemId),
    }),
  handler: async (ctx, input) => {
    const id = await insertOrder(ctx.tx, ctx.actor.tenantId, input);
    return {
      result: { id },
      events: [{ name: "verity.manufacturing.order_created", entityId: id }],
    };
  },
};

/* ============================== start ============================== */

/**
 * Draft -> InProgress: consumes every line's `qtyRequired` from the order's
 * location, real (not theoretical) consumption. Every line is checked for
 * sufficient stock BEFORE any movement is written, so a shortfall on line 3
 * never leaves lines 1-2 partially consumed — one transaction, checked whole.
 */
export const startManufacturingOrder: CommandDefinition<{ orderId: string }, { id: string }> = {
  key: "verity.manufacturing.start_order",
  entity: ENTITY_MANUFACTURING_ORDER,
  verb: "ActionExecute",
  input: z.object({ orderId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const order = await ctx.tx.manufacturingOrder.findUniqueOrThrow({
      where: { id: input.orderId },
      include: { lines: { include: { componentItem: true } } },
    });
    await assertMutable(ctx.tx, ENTITY_MANUFACTURING_ORDER, order.state);

    const moved = await transition(ctx, {
      entityKey: ENTITY_MANUFACTURING_ORDER,
      entityId: order.id,
      fromKey: order.state,
      toKey: "in_progress",
    });

    // Check every line first — real negative-stock guard, enforced here
    // directly (this capability does not call `inventory.recordStockMovement`
    // as a registered command, so its guard doesn't run for these writes).
    // Stock another order has reserved is not this order's to consume; its own
    // reservation, if any, is exactly what it is about to take.
    await lockLocationStock(ctx.tx, ctx.actor.tenantId, order.locationId);
    for (const line of order.lines) {
      const balance = await ctx.tx.inventoryStockBalance.findUnique({
        where: {
          tenantId_itemId_locationId: {
            tenantId: ctx.actor.tenantId,
            itemId: line.componentItemId,
            locationId: order.locationId,
          },
        },
      });
      const onHand = balance?.qty ?? 0;
      const available = onHand - (await heldByOthers(ctx.tx, line.componentItemId, order.locationId, [order.id]));
      if (available < line.qtyRequired) {
        throw new ValidationError(
          `E_VALIDATION: not enough ${line.componentItem.name} at this location to start ` +
            `(need ${line.qtyRequired}, have ${Math.max(available, 0)}${available < onHand ? `, ${onHand} on hand but the rest is reserved` : ""})`,
        );
      }
    }
    await releaseOrderReservations(ctx.tx, order.id, "consumed");

    for (const line of order.lines) {
      await ctx.tx.inventoryStockMovement.create({
        data: {
          tenantId: ctx.actor.tenantId,
          itemId: line.componentItemId,
          locationId: order.locationId,
          kind: "Issue",
          qty: -line.qtyRequired,
          reference: order.reference ?? `MO ${order.id.slice(0, 8)}`,
          movedById: ctx.actor.userId,
        },
      });
      await ctx.tx.inventoryStockBalance.upsert({
        where: {
          tenantId_itemId_locationId: {
            tenantId: ctx.actor.tenantId,
            itemId: line.componentItemId,
            locationId: order.locationId,
          },
        },
        create: {
          tenantId: ctx.actor.tenantId,
          itemId: line.componentItemId,
          locationId: order.locationId,
          qty: -line.qtyRequired,
        },
        update: { qty: { decrement: line.qtyRequired } },
      });
    }

    await ctx.tx.manufacturingOrder.update({
      where: { id: order.id },
      data: { state: "in_progress", version: { increment: 1 } },
    });

    return {
      result: { id: order.id },
      events: [
        moved.event,
        { name: "verity.manufacturing.order_started", entityId: order.id },
      ],
    };
  },
};

/* ============================= complete ============================= */

/** InProgress -> Completed: posts the output quantity as a Receipt. */
export const completeManufacturingOrder: CommandDefinition<{ orderId: string }, { id: string }> = {
  key: "verity.manufacturing.complete_order",
  entity: ENTITY_MANUFACTURING_ORDER,
  verb: "ActionExecute",
  input: z.object({ orderId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const order = await ctx.tx.manufacturingOrder.findUniqueOrThrow({ where: { id: input.orderId } });
    await assertMutable(ctx.tx, ENTITY_MANUFACTURING_ORDER, order.state);

    // An order planned into stages is not finished until every stage is. An order
    // with no operations (the original, hand-built shape) is unaffected.
    const openOperations = await ctx.tx.manufacturingOperation.count({
      where: { orderId: order.id, state: { in: OPEN_OPERATION_STATES } },
    });
    if (openOperations > 0) {
      throw new ValidationError(`E_VALIDATION: ${openOperations} stage(s) are still open; finish or send them back first`);
    }

    const moved = await transition(ctx, {
      entityKey: ENTITY_MANUFACTURING_ORDER,
      entityId: order.id,
      fromKey: order.state,
      toKey: "completed",
    });

    await ctx.tx.inventoryStockMovement.create({
      data: {
        tenantId: ctx.actor.tenantId,
        itemId: order.outputItemId,
        locationId: order.locationId,
        kind: "Receipt",
        qty: order.outputQty,
        reference: order.reference ?? `MO ${order.id.slice(0, 8)}`,
        movedById: ctx.actor.userId,
      },
    });
    await ctx.tx.inventoryStockBalance.upsert({
      where: {
        tenantId_itemId_locationId: {
          tenantId: ctx.actor.tenantId,
          itemId: order.outputItemId,
          locationId: order.locationId,
        },
      },
      create: {
        tenantId: ctx.actor.tenantId,
        itemId: order.outputItemId,
        locationId: order.locationId,
        qty: order.outputQty,
      },
      update: { qty: { increment: order.outputQty } },
    });

    await ctx.tx.manufacturingOrder.update({
      where: { id: order.id },
      data: { state: "completed", version: { increment: 1 } },
    });

    return {
      result: { id: order.id },
      events: [
        moved.event,
        { name: "verity.manufacturing.order_completed", entityId: order.id },
      ],
    };
  },
};

/* ============================== cancel ============================== */

/**
 * Draft|InProgress -> Cancelled. Cancelling an InProgress order reverses the
 * consumption already posted — a new offsetting Receipt for each line, never
 * an edit to the original Issue rows (ADR-009: correct by new fact).
 */
export const cancelManufacturingOrder: CommandDefinition<
  { orderId: string; reason: string },
  { id: string }
> = {
  key: "verity.manufacturing.cancel_order",
  entity: ENTITY_MANUFACTURING_ORDER,
  verb: "ActionExecute",
  input: z.object({ orderId: z.string().uuid(), reason: z.string().min(3).max(400) }),
  handler: async (ctx, input) => {
    const order = await ctx.tx.manufacturingOrder.findUniqueOrThrow({
      where: { id: input.orderId },
      include: { lines: true },
    });
    await assertMutable(ctx.tx, ENTITY_MANUFACTURING_ORDER, order.state);

    const wasInProgress = order.state === "in_progress";

    const moved = await transition(ctx, {
      entityKey: ENTITY_MANUFACTURING_ORDER,
      entityId: order.id,
      fromKey: order.state,
      toKey: "cancelled",
    });

    // A cancelled order has no work left to do: its open stages are cancelled too.
    const cancelledOperations = await cancelOpenOperations(ctx, order.id, "verity.manufacturing.cancel_order", {
      others: `Order cancelled: ${input.reason}`,
    });

    await releaseOrderReservations(ctx.tx, order.id, "order cancelled");

    if (wasInProgress) {
      for (const line of order.lines) {
        await ctx.tx.inventoryStockMovement.create({
          data: {
            tenantId: ctx.actor.tenantId,
            itemId: line.componentItemId,
            locationId: order.locationId,
            kind: "Adjustment",
            qty: line.qtyRequired,
            reference: `Reversal of ${order.reference ?? `MO ${order.id.slice(0, 8)}`} (cancelled)`,
            movedById: ctx.actor.userId,
          },
        });
        await ctx.tx.inventoryStockBalance.upsert({
          where: {
            tenantId_itemId_locationId: {
              tenantId: ctx.actor.tenantId,
              itemId: line.componentItemId,
              locationId: order.locationId,
            },
          },
          create: {
            tenantId: ctx.actor.tenantId,
            itemId: line.componentItemId,
            locationId: order.locationId,
            qty: line.qtyRequired,
          },
          update: { qty: { increment: line.qtyRequired } },
        });
      }
    }

    await ctx.tx.manufacturingOrder.update({
      where: { id: order.id },
      data: { state: "cancelled", version: { increment: 1 } },
    });

    // Same posture as approveCredit's reason recording (trading/orders.ts) —
    // a cancellation is exactly the decision someone asks about later.
    await recordActivity(ctx, {
      entityKey: ENTITY_MANUFACTURING_ORDER,
      entityId: order.id,
      commandKey: "verity.manufacturing.cancel_order",
      changes: diffFields({ cancellationReason: "" }, { cancellationReason: input.reason }),
    });

    return {
      result: { id: order.id },
      events: [
        moved.event,
        ...cancelledOperations,
        { name: "verity.manufacturing.order_cancelled", entityId: order.id },
      ],
    };
  },
};

/* =============================== queries =============================== */

export const listManufacturingOrders: QueryDefinition<
  { locationId?: string; state?: string },
  Array<{
    id: string;
    reference: string | null;
    state: string;
    outputItemName: string;
    outputQty: number;
    locationName: string;
    createdAt: Date;
  }>
> = {
  key: "verity.manufacturing.list_orders",
  entity: ENTITY_MANUFACTURING_ORDER,
  input: z.object({
    locationId: z.string().uuid().optional(),
    state: z.string().optional(),
  }),
  handler: async (ctx, input) => {
    const orders = await ctx.tx.manufacturingOrder.findMany({
      where: {
        locationId: input.locationId,
        state: input.state,
      },
      include: { outputItem: true, location: true },
      orderBy: { createdAt: "desc" },
    });
    return orders.map((o) => ({
      id: o.id,
      reference: o.reference,
      state: o.state,
      outputItemName: o.outputItem.name,
      outputQty: o.outputQty,
      locationName: o.location.name,
      createdAt: o.createdAt,
    }));
  },
};

export const manufacturingOrderDetail: QueryDefinition<
  { orderId: string },
  {
    id: string;
    reference: string | null;
    state: string;
    outputItemId: string;
    outputItemName: string;
    outputQty: number;
    locationId: string;
    locationName: string;
    /** The BOM this order was made from, when it was. */
    bomId: string | null;
    bomCode: string | null;
    lines: Array<{ componentItemId: string; componentItemName: string; qtyRequired: number }>;
  }
> = {
  key: "verity.manufacturing.order_detail",
  entity: ENTITY_MANUFACTURING_ORDER,
  input: z.object({ orderId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const order = await ctx.tx.manufacturingOrder.findUniqueOrThrow({
      where: { id: input.orderId },
      include: { outputItem: true, location: true, bom: true, lines: { include: { componentItem: true } } },
    });
    return {
      bomId: order.bomId,
      bomCode: order.bom?.code ?? null,
      id: order.id,
      reference: order.reference,
      state: order.state,
      outputItemId: order.outputItemId,
      outputItemName: order.outputItem.name,
      outputQty: order.outputQty,
      locationId: order.locationId,
      locationName: order.location.name,
      lines: order.lines.map((l) => ({
        componentItemId: l.componentItemId,
        componentItemName: l.componentItem.name,
        qtyRequired: l.qtyRequired,
      })),
    };
  },
};

export function registerManufacturingCapability(): void {
  registerContribution({
    capabilityId: MANUFACTURING_CAPABILITY,
    navigation: [
      {
        href: "/manufacturing",
        label: "Manufacturing",
        group: "Capabilities",
        order: 25,
        icon: "manufacturing",
        requiresEntity: ENTITY_MANUFACTURING_ORDER,
        shells: ["platform", "operations"],
      },
      {
        href: "/manufacturing/boms",
        label: "Bills of materials",
        group: "Capabilities",
        order: 26,
        icon: "manufacturing",
        requiresEntity: ENTITY_MANUFACTURING_BOM,
        shells: ["platform", "operations"],
      },
      {
        href: "/manufacturing/floor",
        label: "Production floor",
        group: "Capabilities",
        order: 27,
        icon: "manufacturing",
        requiresEntity: ENTITY_MANUFACTURING_OPERATION,
        shells: ["platform", "operations"],
      },
      {
        href: "/manufacturing/batches",
        label: "Production batches",
        group: "Capabilities",
        order: 29,
        icon: "manufacturing",
        requiresEntity: ENTITY_MANUFACTURING_BATCH,
        shells: ["platform", "operations"],
      },
      {
        href: "/manufacturing/routes",
        label: "Production routes",
        group: "Capabilities",
        order: 28,
        icon: "manufacturing",
        requiresEntity: ENTITY_MANUFACTURING_ROUTE,
        shells: ["platform", "operations"],
      },
    ],
  });
  registerManufacturingBom();
  registerManufacturingStages();
  registerManufacturingPassport();
  registerManufacturingLogistics();
  registerManufacturingBatch();
  registerCommand(createManufacturingOrder);
  registerCommand(startManufacturingOrder);
  registerCommand(completeManufacturingOrder);
  registerCommand(cancelManufacturingOrder);
  registerQuery(listManufacturingOrders);
  registerQuery(manufacturingOrderDetail);
}
