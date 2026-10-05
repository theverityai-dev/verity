import { z } from "zod";
import { registerContribution } from "@/server/platform/contribution";
import { registerCommand, ValidationError, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";

/**
 * CAPABILITY: Inventory — `verity.capability.inventory` (Task 73, MVP scope)
 *
 * Authority: `taskplans/73_erpclaw_capability_inventory.md`. Built ahead of
 * its stated demand trigger under the same explicit product-owner override
 * as Task 72 (accounting), 2026-09-04.
 *
 * REGISTERED 2026-09-04, same as `../accounting` — see that file's module
 * doc for the migration-drift resolution, not repeated here.
 *
 * NOT a fork of plywood's own godown/rack/stock model (`src/server/
 * capabilities/plywood/stock.ts`) — deliberately a separate, generic module
 * per Task 73's own scope ("not a fork... stays client-private until a
 * second client proves the generic shape"). Warehouses reuse the platform
 * `Location` primitive (ADR-004) rather than a parallel concept.
 *
 * SCOPE BUILT: item groups, items, a warehouse-scoped stock balance, and an
 * append-only stock-movement ledger with atomic balance updates (Task 73's
 * own critical requirement: "stock movements... write quantity and value
 * atomically, same transaction, same command" — value/costing is explicitly
 * NOT built here, only quantity). NOT built: units-of-measure conversions,
 * batch/serial tracking, reservations/pick lists, revaluation, item
 * alternatives/price lists. Those remain the taskplan's own open scope.
 */

export const INVENTORY_CAPABILITY = "verity.capability.inventory";
export const ENTITY_INVENTORY_ITEM = "verity.inventory.item";
export const ENTITY_INVENTORY_STOCK = "verity.inventory.stock";

export const MOVEMENT_KINDS = ["Receipt", "Issue", "Adjustment", "Transfer"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

/* ============================== item groups ================================ */

export const createItemGroup: CommandDefinition<{ name: string }, { id: string }> = {
  key: "verity.inventory.create_item_group",
  entity: ENTITY_INVENTORY_ITEM,
  verb: "Create",
  input: z.object({ name: z.string().min(1).max(120) }),
  preconditions: async (ctx, input) => {
    const clash = await ctx.tx.inventoryItemGroup.findFirst({ where: { name: input.name } });
    if (clash) throw new ValidationError("E_VALIDATION: an item group with that name already exists");
  },
  handler: async (ctx, input) => {
    const group = await ctx.tx.inventoryItemGroup.create({
      data: { tenantId: ctx.actor.tenantId, name: input.name },
    });
    return {
      result: { id: group.id },
      events: [{ name: "verity.inventory.item_group_created", entityId: group.id }],
    };
  },
};

/* =================================== items =================================== */

export const createItem: CommandDefinition<
  { sku: string; name: string; itemGroupId?: string; unitLabel?: string; reorderLevel?: number },
  { id: string }
> = {
  key: "verity.inventory.create_item",
  entity: ENTITY_INVENTORY_ITEM,
  verb: "Create",
  input: z.object({
    sku: z.string().min(1).max(60),
    name: z.string().min(1).max(200),
    itemGroupId: z.string().uuid().optional(),
    unitLabel: z.string().min(1).max(30).optional(),
    reorderLevel: z.number().int().min(0).optional(),
  }),
  preconditions: async (ctx, input) => {
    const clash = await ctx.tx.inventoryItem.findFirst({ where: { sku: input.sku } });
    if (clash) throw new ValidationError("E_VALIDATION: an item with that SKU already exists");
    if (input.itemGroupId) {
      const group = await ctx.tx.inventoryItemGroup.findUnique({ where: { id: input.itemGroupId } });
      if (!group) throw new ValidationError("E_VALIDATION: item group not found in this tenant");
    }
  },
  handler: async (ctx, input) => {
    const item = await ctx.tx.inventoryItem.create({
      data: {
        tenantId: ctx.actor.tenantId,
        sku: input.sku,
        name: input.name,
        itemGroupId: input.itemGroupId ?? null,
        unitLabel: input.unitLabel ?? "units",
        reorderLevel: input.reorderLevel ?? 0,
      },
    });
    return {
      result: { id: item.id },
      events: [{ name: "verity.inventory.item_created", entityId: item.id }],
    };
  },
};

export const setItemActive: CommandDefinition<{ itemId: string; active: boolean }, { id: string }> = {
  key: "verity.inventory.set_item_active",
  entity: ENTITY_INVENTORY_ITEM,
  verb: "Edit",
  input: z.object({ itemId: z.string().uuid(), active: z.boolean() }),
  handler: async (ctx, input) => {
    const item = await ctx.tx.inventoryItem.update({
      where: { id: input.itemId },
      data: { active: input.active, version: { increment: 1 } },
    });
    return {
      result: { id: item.id },
      events: [
        {
          name: input.active ? "verity.inventory.item_activated" : "verity.inventory.item_deactivated",
          entityId: item.id,
        },
      ],
    };
  },
};

export const listItems: QueryDefinition<
  { includeInactive?: boolean; itemGroupId?: string },
  Array<{ id: string; sku: string; name: string; unitLabel: string; reorderLevel: number; active: boolean }>
> = {
  key: "verity.inventory.list_items",
  entity: ENTITY_INVENTORY_ITEM,
  input: z.object({ includeInactive: z.boolean().optional(), itemGroupId: z.string().uuid().optional() }),
  handler: async (ctx, input) => {
    const rows = await ctx.tx.inventoryItem.findMany({
      where: {
        ...(input.includeInactive ? {} : { active: true }),
        ...(input.itemGroupId ? { itemGroupId: input.itemGroupId } : {}),
      },
      orderBy: { sku: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      sku: r.sku,
      name: r.name,
      unitLabel: r.unitLabel,
      reorderLevel: r.reorderLevel,
      active: r.active,
    }));
  },
};

/* ================================ stock movement ================================ */

/**
 * The one path that ever changes a balance (Task 73's own critical
 * requirement). Balance and movement write in the same command/transaction
 * — never two separate calls a caller could split across requests. An Issue
 * that would take a balance negative is refused; every other kind is
 * unconditional at this layer (order-linked exclusivity, e.g. "sold stock
 * only leaves through delivery," is a rule for the CALLING capability to
 * enforce, since this module does not know what a sales order is).
 */
export const recordStockMovement: CommandDefinition<
  {
    itemId: string;
    locationId: string;
    kind: MovementKind;
    qty: number;
    reference?: string;
    unitCostPaise?: number;
  },
  { balanceId: string; qty: number }
> = {
  key: "verity.inventory.record_stock_movement",
  entity: ENTITY_INVENTORY_STOCK,
  verb: "Create",
  input: z.object({
    itemId: z.string().uuid(),
    locationId: z.string().uuid(),
    kind: z.enum(MOVEMENT_KINDS),
    // Signed by the caller — a Receipt is normally positive, an Issue
    // normally negative; the schema does not force the sign because a
    // returned-issue or a negative adjustment are both legitimate.
    qty: z.number().int().refine((n) => n !== 0, "quantity must not be zero"),
    reference: z.string().max(200).optional(),
    // Only meaningful on a Receipt (a GRN posting the price paid). Folds into
    // InventoryItem.avgUnitCostPaise as a quantity-weighted moving average —
    // decision 2026-09-10 (Colonel Kebabz phase plan): one ingredient ledger
    // for both quantity and cost, so a recipe's food-cost query has a real
    // number to read.
    unitCostPaise: z.number().int().min(0).optional(),
  }),
  preconditions: async (ctx, input) => {
    const item = await ctx.tx.inventoryItem.findUnique({ where: { id: input.itemId } });
    if (!item) throw new ValidationError("E_VALIDATION: item not found in this tenant");
    if (!item.active) throw new ValidationError("E_VALIDATION: item is deactivated");
    if (input.unitCostPaise !== undefined && input.kind !== "Receipt") {
      throw new ValidationError("E_VALIDATION: unitCostPaise only applies to a Receipt movement");
    }

    const existing = await ctx.tx.inventoryStockBalance.findUnique({
      where: { tenantId_itemId_locationId: { tenantId: ctx.actor.tenantId, itemId: input.itemId, locationId: input.locationId } },
    });
    const projected = (existing?.qty ?? 0) + input.qty;
    if (projected < 0) {
      throw new ValidationError(
        `E_VALIDATION: this movement would take stock negative (${existing?.qty ?? 0} -> ${projected})`,
      );
    }
  },
  handler: async (ctx, input) => {
    const balance = await applyMovement(ctx.tx, ctx.actor, input);
    return {
      result: { balanceId: balance.id, qty: balance.qty },
      events: [
        {
          name: "verity.inventory.stock_moved",
          entityId: input.itemId,
          payload: { kind: input.kind, qty: input.qty, locationId: input.locationId },
        },
      ],
    };
  },
};

type MovementInput = {
  itemId: string;
  locationId: string;
  kind: MovementKind;
  qty: number;
  reference?: string;
  unitCostPaise?: number;
};

/** Writes the movement and moves the balance in the caller's transaction. */
async function applyMovement(
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

/* ================================ stock count ================================ */

export type StockCountVariance = {
  itemId: string;
  expectedQty: number;
  countedQty: number;
  differenceQty: number;
};

/**
 * Applies a physical count for one outlet (PRD §19). The expected quantity is
 * read inside this transaction, never taken from the screen, so a sale or
 * receipt that landed while the count was being entered is respected: the
 * adjustment is "counted minus what the ledger says now". Each difference is an
 * Adjustment movement, so the ledger shows who counted and the reason; lines
 * that match are left alone and post no movement.
 */
export const applyStockCount: CommandDefinition<
  { locationId: string; note?: string; lines: Array<{ itemId: string; countedQty: number }> },
  { variances: StockCountVariance[]; adjusted: number; unchanged: number }
> = {
  key: "verity.inventory.apply_stock_count",
  entity: ENTITY_INVENTORY_STOCK,
  verb: "Create",
  input: z.object({
    locationId: z.string().uuid(),
    note: z.string().max(200).optional(),
    lines: z
      .array(z.object({ itemId: z.string().uuid(), countedQty: z.number().int().min(0) }))
      .min(1)
      .max(500),
  }),
  preconditions: async (ctx, input) => {
    const ids = input.lines.map((l) => l.itemId);
    if (new Set(ids).size !== ids.length) {
      throw new ValidationError("E_VALIDATION: an item appears twice in the count");
    }
    const found = await ctx.tx.inventoryItem.findMany({ where: { id: { in: ids } }, select: { id: true, active: true } });
    if (found.length !== ids.length) throw new ValidationError("E_VALIDATION: an item is not in this tenant");
    if (found.some((i) => !i.active)) throw new ValidationError("E_VALIDATION: a deactivated item cannot be counted");
    const location = await ctx.tx.location.findUnique({ where: { id: input.locationId }, select: { id: true } });
    if (!location) throw new ValidationError("E_VALIDATION: outlet not found in this tenant");
  },
  handler: async (ctx, input) => {
    const balances = await ctx.tx.inventoryStockBalance.findMany({
      where: { locationId: input.locationId, itemId: { in: input.lines.map((l) => l.itemId) } },
      select: { itemId: true, qty: true },
    });
    const expected = new Map(balances.map((b) => [b.itemId, b.qty]));
    const reference = input.note ? `Stock count: ${input.note}` : "Stock count";

    const variances: StockCountVariance[] = [];
    const events: Array<{ name: string; entityId: string; payload: Record<string, unknown> }> = [];
    for (const line of input.lines) {
      const expectedQty = expected.get(line.itemId) ?? 0;
      const differenceQty = line.countedQty - expectedQty;
      if (differenceQty === 0) continue;
      await applyMovement(ctx.tx, ctx.actor, {
        itemId: line.itemId,
        locationId: input.locationId,
        kind: "Adjustment",
        qty: differenceQty,
        reference,
      });
      variances.push({ itemId: line.itemId, expectedQty, countedQty: line.countedQty, differenceQty });
      events.push({
        name: "verity.inventory.stock_moved",
        entityId: line.itemId,
        payload: { kind: "Adjustment", qty: differenceQty, locationId: input.locationId },
      });
    }
    return {
      result: { variances, adjusted: variances.length, unchanged: input.lines.length - variances.length },
      events,
    };
  },
};

/* =================================== wastage =================================== */

export const WASTAGE_REASONS = [
  "Spoilage",
  "Expired",
  "Overproduction",
  "Burnt",
  "Damaged",
  "Preparation waste",
  "Customer return",
  "Quality issue",
  "Storage issue",
  "Other",
] as const;
export type WastageReason = (typeof WASTAGE_REASONS)[number];

/**
 * PRD §20. Posts the stock-side effect (an Adjustment movement, same as any
 * other correction) and the wastage-specific detail (reason, value snapshot,
 * notes, photo) in one transaction. `valuePaise` is computed here, at
 * record time, from the item's current `avgUnitCostPaise` — a snapshot, not
 * a value this command re-derives on every later read (see the model's own
 * doc comment). Approval-if-required is explicitly not built: no threshold
 * has been decided yet.
 */
export const recordWastage: CommandDefinition<
  {
    itemId: string;
    locationId: string;
    qty: number;
    reason: WastageReason;
    notes?: string;
    evidenceId?: string;
  },
  { movementId: string; wastageRecordId: string; valuePaise: number }
> = {
  key: "verity.inventory.record_wastage",
  entity: ENTITY_INVENTORY_STOCK,
  verb: "Create",
  input: z.object({
    itemId: z.string().uuid(),
    locationId: z.string().uuid(),
    qty: z.number().int().positive(),
    reason: z.enum(WASTAGE_REASONS),
    notes: z.string().max(500).optional(),
    evidenceId: z.string().uuid().optional(),
  }),
  preconditions: async (ctx, input) => {
    const item = await ctx.tx.inventoryItem.findUnique({ where: { id: input.itemId } });
    if (!item) throw new ValidationError("E_VALIDATION: item not found in this tenant");
    if (!item.active) throw new ValidationError("E_VALIDATION: item is deactivated");

    const existing = await ctx.tx.inventoryStockBalance.findUnique({
      where: {
        tenantId_itemId_locationId: { tenantId: ctx.actor.tenantId, itemId: input.itemId, locationId: input.locationId },
      },
    });
    if ((existing?.qty ?? 0) - input.qty < 0) {
      throw new ValidationError(
        `E_VALIDATION: wastage of ${input.qty} would take stock negative (on hand: ${existing?.qty ?? 0})`,
      );
    }
  },
  handler: async (ctx, input) => {
    const item = await ctx.tx.inventoryItem.findUniqueOrThrow({ where: { id: input.itemId } });
    const valuePaise = (item.avgUnitCostPaise ?? 0) * input.qty;

    const movement = await ctx.tx.inventoryStockMovement.create({
      data: {
        tenantId: ctx.actor.tenantId,
        itemId: input.itemId,
        locationId: input.locationId,
        kind: "Adjustment",
        qty: -input.qty,
        reference: "wastage",
        movedById: ctx.actor.userId,
      },
    });
    await ctx.tx.inventoryStockBalance.upsert({
      where: {
        tenantId_itemId_locationId: { tenantId: ctx.actor.tenantId, itemId: input.itemId, locationId: input.locationId },
      },
      create: { tenantId: ctx.actor.tenantId, itemId: input.itemId, locationId: input.locationId, qty: -input.qty },
      update: { qty: { decrement: input.qty } },
    });
    const wastageRecord = await ctx.tx.inventoryWastageRecord.create({
      data: {
        tenantId: ctx.actor.tenantId,
        movementId: movement.id,
        reason: input.reason,
        valuePaise,
        notes: input.notes ?? null,
        evidenceId: input.evidenceId ?? null,
      },
    });

    return {
      result: { movementId: movement.id, wastageRecordId: wastageRecord.id, valuePaise },
      events: [
        {
          name: "verity.inventory.wastage_recorded",
          entityId: wastageRecord.id,
          payload: { itemId: input.itemId, qty: input.qty, reason: input.reason, valuePaise },
        },
      ],
    };
  },
};

export const stockOnHand: QueryDefinition<
  { itemId?: string; locationId?: string },
  Array<{ itemId: string; itemSku: string; locationId: string; qty: number }>
> = {
  key: "verity.inventory.stock_on_hand",
  entity: ENTITY_INVENTORY_STOCK,
  input: z.object({ itemId: z.string().uuid().optional(), locationId: z.string().uuid().optional() }),
  handler: async (ctx, input) => {
    const rows = await ctx.tx.inventoryStockBalance.findMany({
      where: {
        ...(input.itemId ? { itemId: input.itemId } : {}),
        ...(input.locationId ? { locationId: input.locationId } : {}),
      },
      include: { item: { select: { sku: true } } },
    });
    return rows.map((r) => ({ itemId: r.itemId, itemSku: r.item.sku, locationId: r.locationId, qty: r.qty }));
  },
};

export const stockLedger: QueryDefinition<
  { itemId: string },
  Array<{ kind: MovementKind; qty: number; locationId: string; reference: string | null; movedAt: Date }>
> = {
  key: "verity.inventory.stock_ledger",
  entity: ENTITY_INVENTORY_STOCK,
  input: z.object({ itemId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const rows = await ctx.tx.inventoryStockMovement.findMany({
      where: { itemId: input.itemId },
      orderBy: { movedAt: "asc" },
    });
    return rows.map((r) => ({
      kind: r.kind as MovementKind,
      qty: r.qty,
      locationId: r.locationId,
      reference: r.reference,
      movedAt: r.movedAt,
    }));
  },
};

/* ============================== registration ============================== */

/** Called by `registry.ts`'s `installCapabilities()`. */
export function registerInventoryCapability(): void {
  registerContribution({
    capabilityId: INVENTORY_CAPABILITY,
    navigation: [
      {
        href: "/inventory",
        label: "Inventory",
        group: "Inventory",
        order: 31,
        icon: "stock",
        requiresEntity: ENTITY_INVENTORY_STOCK,
        shells: ["platform", "operations"],
      },
    ],
  });
  registerCommand(createItemGroup);
  registerCommand(createItem);
  registerCommand(setItemActive);
  registerCommand(recordStockMovement);
  registerCommand(applyStockCount);
  registerCommand(recordWastage);
  registerQuery(listItems);
  registerQuery(stockOnHand);
  registerQuery(stockLedger);
}
