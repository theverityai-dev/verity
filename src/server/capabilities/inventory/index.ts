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
export { ENTITY_INVENTORY_STOCK } from "./kinds";
import { ENTITY_INVENTORY_STOCK } from "./kinds";

export { MOVEMENT_KINDS } from "./kinds";
import { MOVEMENT_KINDS } from "./kinds";
import { applyMovement } from "./ledger";
import { ENTITY_INVENTORY_PURCHASE_ORDER, registerProcurement } from "./procurement";
export * from "./procurement";
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

/* ================================== transfer ================================== */

/**
 * Moves stock from one outlet to another in one transaction (PRD §19,
 * inventory.md). Two Transfer movements, out of the source and into the
 * destination, so each outlet's ledger shows it and the total across outlets is
 * unchanged. The moving-average cost is shared by all outlets, so it does not
 * move. Refused if the source does not hold that much.
 */
export const transferStock: CommandDefinition<
  { itemId: string; fromLocationId: string; toLocationId: string; qty: number; note?: string },
  { fromQty: number; toQty: number }
> = {
  key: "verity.inventory.transfer_stock",
  entity: ENTITY_INVENTORY_STOCK,
  verb: "Create",
  input: z.object({
    itemId: z.string().uuid(),
    fromLocationId: z.string().uuid(),
    toLocationId: z.string().uuid(),
    qty: z.number().int().min(1),
    note: z.string().trim().max(200).optional(),
  }),
  preconditions: async (ctx, input) => {
    if (input.fromLocationId === input.toLocationId) {
      throw new ValidationError("E_VALIDATION: choose a different outlet to send the stock to");
    }
    const item = await ctx.tx.inventoryItem.findUnique({ where: { id: input.itemId } });
    if (!item) throw new ValidationError("E_VALIDATION: item not found in this tenant");
    if (!item.active) throw new ValidationError("E_VALIDATION: item is deactivated");
    const outlets = await ctx.tx.location.findMany({
      where: { id: { in: [input.fromLocationId, input.toLocationId] } },
      select: { id: true },
    });
    if (outlets.length !== 2) throw new ValidationError("E_VALIDATION: outlet not found in this tenant");
    const balance = await ctx.tx.inventoryStockBalance.findUnique({
      where: { tenantId_itemId_locationId: { tenantId: ctx.actor.tenantId, itemId: input.itemId, locationId: input.fromLocationId } },
    });
    if ((balance?.qty ?? 0) < input.qty) {
      throw new ValidationError(`E_VALIDATION: only ${balance?.qty ?? 0} ${item.unitLabel} is at the sending outlet`);
    }
  },
  handler: async (ctx, input) => {
    const [from, to] = await Promise.all([
      ctx.tx.location.findUniqueOrThrow({ where: { id: input.fromLocationId }, select: { name: true } }),
      ctx.tx.location.findUniqueOrThrow({ where: { id: input.toLocationId }, select: { name: true } }),
    ]);
    const suffix = input.note ? ` (${input.note})` : "";
    const out = await applyMovement(ctx.tx, ctx.actor, {
      itemId: input.itemId,
      locationId: input.fromLocationId,
      kind: "Transfer",
      qty: -input.qty,
      reference: `Sent to ${to.name}${suffix}`,
    });
    const into = await applyMovement(ctx.tx, ctx.actor, {
      itemId: input.itemId,
      locationId: input.toLocationId,
      kind: "Transfer",
      qty: input.qty,
      reference: `Received from ${from.name}${suffix}`,
    });
    return {
      result: { fromQty: out.qty, toQty: into.qty },
      events: [
        {
          name: "verity.inventory.stock_transferred",
          entityId: input.itemId,
          payload: { qty: input.qty, fromLocationId: input.fromLocationId, toLocationId: input.toLocationId },
        },
      ],
    };
  },
};

/* ============================== stock requests ============================== */

/** An outlet asks for an item (inventory.md transfers workflow). */
export const requestStock: CommandDefinition<{ itemId: string; toLocationId: string; qty: number; reason?: string }, { id: string }> = {
  key: "verity.inventory.request_stock",
  entity: ENTITY_INVENTORY_STOCK,
  verb: "Create",
  input: z.object({
    itemId: z.string().uuid(),
    toLocationId: z.string().uuid(),
    qty: z.number().int().min(1),
    reason: z.string().trim().max(200).optional(),
  }),
  preconditions: async (ctx, input) => {
    const item = await ctx.tx.inventoryItem.findUnique({ where: { id: input.itemId } });
    if (!item || !item.active) throw new ValidationError("E_VALIDATION: item not found or deactivated");
    if (!(await ctx.tx.location.findUnique({ where: { id: input.toLocationId }, select: { id: true } }))) {
      throw new ValidationError("E_VALIDATION: outlet not found in this tenant");
    }
  },
  handler: async (ctx, input) => {
    const request = await ctx.tx.inventoryStockRequest.create({
      data: {
        tenantId: ctx.actor.tenantId,
        itemId: input.itemId,
        toLocationId: input.toLocationId,
        qty: input.qty,
        reason: input.reason ?? null,
        requestedById: ctx.actor.userId,
      },
    });
    return { result: { id: request.id }, events: [{ name: "verity.inventory.stock_requested", entityId: request.id }] };
  },
};

/**
 * Approves a request by sending the stock from a chosen outlet (two Transfer
 * movements, as `transfer_stock`), or rejects it with a note. Deciding needs
 * `Edit` on stock, so an outlet that can ask cannot also grant itself stock
 * unless its role says so.
 */
export const decideStockRequest: CommandDefinition<
  { requestId: string; approve: boolean; fromLocationId?: string; note?: string },
  { id: string; status: "Approved" | "Rejected" }
> = {
  key: "verity.inventory.decide_stock_request",
  entity: ENTITY_INVENTORY_STOCK,
  verb: "Edit",
  input: z.object({
    requestId: z.string().uuid(),
    approve: z.boolean(),
    fromLocationId: z.string().uuid().optional(),
    note: z.string().trim().max(200).optional(),
  }),
  preconditions: async (ctx, input) => {
    const request = await ctx.tx.inventoryStockRequest.findUnique({ where: { id: input.requestId } });
    if (!request) throw new ValidationError("E_VALIDATION: request not found");
    if (request.status !== "Requested") throw new ValidationError(`E_VALIDATION: this request is already ${request.status}`);
    if (!input.approve) {
      if (!input.note) throw new ValidationError("E_VALIDATION: say why the request is rejected");
      return;
    }
    if (!input.fromLocationId) throw new ValidationError("E_VALIDATION: choose the outlet to send from");
    if (input.fromLocationId === request.toLocationId) throw new ValidationError("E_VALIDATION: choose a different outlet to send from");
    const balance = await ctx.tx.inventoryStockBalance.findUnique({
      where: { tenantId_itemId_locationId: { tenantId: ctx.actor.tenantId, itemId: request.itemId, locationId: input.fromLocationId } },
    });
    if ((balance?.qty ?? 0) < request.qty) {
      throw new ValidationError(`E_VALIDATION: only ${balance?.qty ?? 0} is at the sending outlet`);
    }
  },
  handler: async (ctx, input) => {
    const request = await ctx.tx.inventoryStockRequest.findUniqueOrThrow({ where: { id: input.requestId } });
    if (input.approve) {
      const [from, to] = await Promise.all([
        ctx.tx.location.findUniqueOrThrow({ where: { id: input.fromLocationId! }, select: { name: true } }),
        ctx.tx.location.findUniqueOrThrow({ where: { id: request.toLocationId }, select: { name: true } }),
      ]);
      await applyMovement(ctx.tx, ctx.actor, { itemId: request.itemId, locationId: input.fromLocationId!, kind: "Transfer", qty: -request.qty, reference: `Sent to ${to.name} (request)` });
      await applyMovement(ctx.tx, ctx.actor, { itemId: request.itemId, locationId: request.toLocationId, kind: "Transfer", qty: request.qty, reference: `Received from ${from.name} (request)` });
    }
    const status = input.approve ? "Approved" : "Rejected";
    await ctx.tx.inventoryStockRequest.update({
      where: { id: request.id },
      data: {
        status,
        decidedById: ctx.actor.userId,
        decidedAt: new Date(),
        fromLocationId: input.approve ? input.fromLocationId! : null,
        decisionNote: input.note ?? null,
      },
    });
    return { result: { id: request.id, status }, events: [{ name: "verity.inventory.stock_request_decided", entityId: request.id, payload: { status } }] };
  },
};

export const listStockRequests: QueryDefinition<
  { status?: "Requested" | "Approved" | "Rejected" },
  Array<{ id: string; itemId: string; itemName: string; unit: string; toLocationId: string; toLocation: string; qty: number; reason: string | null; status: string; createdAt: Date; decisionNote: string | null }>
> = {
  key: "verity.inventory.list_stock_requests",
  entity: ENTITY_INVENTORY_STOCK,
  input: z.object({ status: z.enum(["Requested", "Approved", "Rejected"]).optional() }),
  handler: async (ctx, input) => {
    const rows = await ctx.tx.inventoryStockRequest.findMany({
      where: input.status ? { status: input.status } : {},
      include: { item: { select: { name: true, unitLabel: true } }, toLocation: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      itemId: r.itemId,
      itemName: r.item.name,
      unit: r.item.unitLabel,
      toLocationId: r.toLocationId,
      toLocation: r.toLocation.name,
      qty: r.qty,
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt,
      decisionNote: r.decisionNote,
    }));
  },
};

/* ============================ food-cost variance ============================ */

export type VarianceRow = {
  itemId: string;
  itemName: string;
  unit: string;
  usedByRecipes: number;
  wasted: number;
  countCorrection: number;
  /** Value of what disappeared without a sale or a recorded waste (negative corrections), in paise. */
  unexplainedPaise: number;
};

/**
 * Food-cost variance for one outlet (menu-recipes.md §16): what recipes say was
 * used, what was recorded as wasted, and what stock counts had to correct. A
 * negative count correction is stock that left without a sale or a waste
 * record, valued at the item's average cost.
 */
export const foodCostVariance: QueryDefinition<{ locationId: string; fromDate: string; toDate: string }, VarianceRow[]> = {
  key: "verity.inventory.food_cost_variance",
  entity: ENTITY_INVENTORY_STOCK,
  input: z.object({ locationId: z.string().uuid(), fromDate: z.string().date(), toDate: z.string().date() }),
  handler: async (ctx, input) => {
    const movements = await ctx.tx.inventoryStockMovement.findMany({
      where: {
        locationId: input.locationId,
        movedAt: { gte: new Date(`${input.fromDate}T00:00:00.000Z`), lte: new Date(`${input.toDate}T23:59:59.999Z`) },
        OR: [{ kind: "Issue" }, { kind: "Adjustment" }],
      },
      include: { item: { select: { name: true, unitLabel: true, avgUnitCostPaise: true } }, wastageRecord: { select: { id: true } } },
    });
    const byItem = new Map<string, VarianceRow & { cost: number }>();
    for (const m of movements) {
      const row = byItem.get(m.itemId) ?? {
        itemId: m.itemId,
        itemName: m.item.name,
        unit: m.item.unitLabel,
        usedByRecipes: 0,
        wasted: 0,
        countCorrection: 0,
        unexplainedPaise: 0,
        cost: m.item.avgUnitCostPaise ?? 0,
      };
      if (m.wastageRecord) row.wasted += Math.abs(m.qty);
      else if (m.kind === "Issue" && m.reference?.startsWith("dining_order:")) row.usedByRecipes += Math.abs(m.qty);
      else if (m.kind === "Adjustment") row.countCorrection += m.qty;
      byItem.set(m.itemId, row);
    }
    return [...byItem.values()]
      .map(({ cost, ...row }) => ({ ...row, unexplainedPaise: row.countCorrection < 0 ? Math.abs(row.countCorrection) * cost : 0 }))
      .sort((a, b) => b.unexplainedPaise - a.unexplainedPaise || a.itemName.localeCompare(b.itemName));
  },
};

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
      {
        href: "/inventory/purchase-orders",
        label: "Purchase orders",
        group: "Inventory",
        order: 32,
        icon: "stock",
        requiresEntity: ENTITY_INVENTORY_PURCHASE_ORDER,
        shells: ["platform", "operations"],
      },
    ],
  });
  registerCommand(createItemGroup);
  registerCommand(createItem);
  registerCommand(setItemActive);
  registerCommand(recordStockMovement);
  registerCommand(applyStockCount);
  registerCommand(transferStock);
  registerCommand(requestStock);
  registerCommand(decideStockRequest);
  registerQuery(listStockRequests);
  registerQuery(foodCostVariance);
  registerCommand(recordWastage);
  registerProcurement();
  registerQuery(listItems);
  registerQuery(stockOnHand);
  registerQuery(stockLedger);
}
