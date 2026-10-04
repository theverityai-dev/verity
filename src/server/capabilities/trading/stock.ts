import { z } from "zod";
import { reachableGodownIds } from "./scope";
import { assertPeriodOpen } from "./period";
import {
  ValidationError,
  type CommandDefinition,
} from "@/server/platform/command";
import { type QueryDefinition } from "@/server/platform/query";
import { diffFields, recordActivity } from "@/server/platform/audit";
import type { TenantScopedClient } from "@/server/platform/tenancy";
import { ENTITY_STOCK_BALANCE, ENTITY_STOCK_LEDGER } from "./keys";

/**
 * PLYWOOD STAGE 2 — the stock ledger.
 *
 * Requirement source: plywood.md §1.1 — stock by godown, inward and outward,
 * transfers, adjustments, damaged and returned stock, low-stock alerts, and
 * stock valuation.
 *
 * P1 resolved to weighted average cost (implementation/plywood-decisions.md).
 * Two tables say the same thing at two speeds: `stock_ledger_entry` is the
 * append-only truth, enforced by a database trigger, and `stock_balance` is a
 * maintained summary. The invariant between them — quantity equals the sum of
 * the movements — is asserted by a test that replays the ledger, so the summary
 * cannot silently diverge from what it summarises.
 */

/**
 * Movement kinds. The direction is carried by the sign of the quantity, and a
 * check constraint on the table keeps the two consistent — a kind that says
 * "inward" cannot be stored against a negative delta.
 */
const INWARD_KINDS = [
  "purchase_inward",
  "transfer_in",
  "adjust_in",
  "returned_stock",
] as const;
const OUTWARD_KINDS = [
  "sales_outward",
  "transfer_out",
  "adjust_out",
  "damaged_out",
] as const;

export type MovementKind =
  (typeof INWARD_KINDS)[number] | (typeof OUTWARD_KINDS)[number];

/**
 * Weighted average cost — P1.
 *
 * An inward movement blends its cost into the running average; an outward
 * movement leaves the average alone and consumes at it. A pure function so the
 * arithmetic is testable without a database and the rounding rule is stated
 * once rather than at each call site.
 */
export function blendAverageCost(input: {
  onHandUnits: number;
  avgUnitCostPaise: number;
  inwardUnits: number;
  inwardUnitCostPaise: number;
}): number {
  const total = input.onHandUnits + input.inwardUnits;
  if (total <= 0) return input.inwardUnitCostPaise;
  const value =
    input.onHandUnits * input.avgUnitCostPaise +
    input.inwardUnits * input.inwardUnitCostPaise;
  return Math.round(value / total);
}

/**
 * Writes one movement and brings the balance with it, inside the caller's
 * transaction.
 *
 * The balance row is locked before it is read, so two movements against the
 * same board in the same godown serialise rather than interleaving and losing
 * one of the updates. Without the lock the weighted average is a read that a
 * concurrent write invalidates before it is used, which is the classic way an
 * average drifts away from the ledger it summarises.
 *
 * Returns the unit cost actually applied — the caller's cost on the way in, the
 * standing average on the way out — because that is what the ledger row stores,
 * and what a past sale's margin is computed from later.
 */
export async function applyMovement(
  tx: TenantScopedClient,
  actor: { tenantId: string; userId: string },
  movement: {
    productId: string;
    locationId: string;
    rackId?: string | null;
    kind: MovementKind;
    /** Always positive. The sign is decided by the kind. */
    qtyUnits: number;
    /** Required for an inward movement; ignored on the way out. */
    unitCostPaise?: number;
    reason?: string | null;
    /**
     * The business document that caused this movement (audit P0-04).
     *
     * Optional on the type, required in practice by everything that has a
     * document to point at. It stays optional because a physical stock count
     * genuinely has no source document — it IS the source — and forcing a
     * synthetic one would put a fiction in the ledger to satisfy a type.
     */
    source?: { type: string; id: string; number?: string | null } | null;
  },
): Promise<{ ledgerId: string; unitCostPaise: number; onHandUnits: number }> {
  // Slice 7 (P0-08). Every stock movement is a dated fact and a closed period
  // must not gain one — a backdated receipt after a close changes an inventory
  // valuation that has already been reported.
  await assertPeriodOpen(tx, new Date());

  const inward = (INWARD_KINDS as readonly string[]).includes(movement.kind);
  const delta = inward ? movement.qtyUnits : -movement.qtyUnits;

  // Lock first, read second. `FOR UPDATE` on a row that does not exist locks
  // nothing, so the very first movement for a board in a godown can still race —
  // the unique index resolves that case, and the caller sees a conflict rather
  // than a silently lost update.
  const existing = await tx.$queryRaw<
    { id: string; qty_units: number; avg_unit_cost_paise: number }[]
  >`SELECT id, qty_units, avg_unit_cost_paise
      FROM stock_balance
     WHERE product_id = ${movement.productId}::uuid
       AND location_id = ${movement.locationId}::uuid
     FOR UPDATE`;

  const onHand = existing[0]?.qty_units ?? 0;
  const currentAvg = existing[0]?.avg_unit_cost_paise ?? 0;

  if (inward && movement.unitCostPaise === undefined) {
    throw new ValidationError(
      "E_VALIDATION: an inward movement needs a unit cost",
    );
  }
  if (!inward && onHand < movement.qtyUnits) {
    // Refused here as well as by the CHECK constraint, so the operator is told
    // what is actually wrong rather than shown a constraint violation.
    throw new ValidationError(
      `E_VALIDATION: only ${onHand} in this godown, cannot move ${movement.qtyUnits}`,
    );
  }

  const appliedCost = inward ? movement.unitCostPaise! : currentAvg;
  const newQty = onHand + delta;
  const newAvg = inward
    ? blendAverageCost({
        onHandUnits: onHand,
        avgUnitCostPaise: currentAvg,
        inwardUnits: movement.qtyUnits,
        inwardUnitCostPaise: appliedCost,
      })
    : // Consuming does not change the average. An emptied godown keeps its last
      // average rather than resetting to zero, so the next sale before the next
      // purchase is still costed at something true.
      currentAvg;

  const entry = await tx.stockLedgerEntry.create({
    data: {
      tenantId: actor.tenantId,
      productId: movement.productId,
      locationId: movement.locationId,
      rackId: movement.rackId ?? null,
      kind: movement.kind,
      qtyDeltaUnits: delta,
      unitCostPaise: appliedCost,
      reason: movement.reason ?? null,
      sourceType: movement.source?.type ?? null,
      sourceId: movement.source?.id ?? null,
      sourceNumber: movement.source?.number ?? null,
      byUserId: actor.userId,
    },
  });

  if (existing[0]) {
    await tx.stockBalance.update({
      where: { id: existing[0].id },
      data: {
        qtyUnits: newQty,
        avgUnitCostPaise: newAvg,
        version: { increment: 1 },
      },
    });
  } else {
    await tx.stockBalance.create({
      data: {
        tenantId: actor.tenantId,
        productId: movement.productId,
        locationId: movement.locationId,
        qtyUnits: newQty,
        avgUnitCostPaise: newAvg,
      },
    });
  }

  return {
    ledgerId: entry.id,
    unitCostPaise: appliedCost,
    onHandUnits: newQty,
  };
}

/** Shared input shape for the movement commands. */
const movementInput = {
  productId: z.string().uuid(),
  locationId: z.string().uuid(),
  rackId: z.string().uuid().optional(),
  qtyUnits: z.number().int().positive(),
};

export async function assertTradeable(
  tx: TenantScopedClient,
  productId: string,
  locationId: string,
): Promise<void> {
  const product = await tx.tradingProduct.findUnique({
    where: { id: productId },
  });
  if (!product)
    throw new ValidationError("E_VALIDATION: board not found in this tenant");
  if (!product.active) {
    throw new ValidationError(
      "E_VALIDATION: that board has been withdrawn from the catalogue",
    );
  }
  if (product.type === "SERVICE") {
    // A service (sawing, estimating, a rental) has no physical stock. Every
    // direct movement command (receive/issue/transfer/adjust/damage/return)
    // funnels through this one precondition, so this is the single place
    // that refuses all six for a service product.
    throw new ValidationError(
      "E_VALIDATION: this is a service — it has no stock to move",
    );
  }
  if (product.type === "TEMPLATE") {
    // Same single choke point, for the same reason. A laminate design is the
    // parent its shade x texture variants were generated from; the sheets in
    // the godown are the variants, and stock recorded against the design would
    // be stock nobody can ever sell.
    throw new ValidationError(
      "E_VALIDATION: this is a design, not a product — move one of its shade " +
        "and texture variants instead",
    );
  }
  const godown = await tx.location.findUnique({ where: { id: locationId } });
  if (!godown)
    throw new ValidationError("E_VALIDATION: godown not found in this tenant");
}

/**
 * Which of these products are services — batched once per command rather
 * than once per order line, so an order fulfillment loop over N lines does
 * not turn into N extra queries just to answer "does this one hold stock?".
 */
export async function serviceProductIds(
  tx: TenantScopedClient,
  productIds: string[],
): Promise<Set<string>> {
  if (productIds.length === 0) return new Set();
  const rows = await tx.tradingProduct.findMany({
    where: { id: { in: productIds }, type: "SERVICE" },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

/* -------------------------------- commands -------------------------------- */

export const receiveStock: CommandDefinition<
  {
    productId: string;
    locationId: string;
    rackId?: string;
    qtyUnits: number;
    unitCostPaise: number;
    reason?: string;
  },
  { ledgerId: string; onHandUnits: number }
> = {
  key: "verity.trading.receive_stock",
  entity: ENTITY_STOCK_LEDGER,
  verb: "Create",
  input: z.object({
    ...movementInput,
    unitCostPaise: z.number().int().min(0),
    reason: z.string().max(400).optional(),
  }),
  preconditions: async (ctx, input) =>
    assertTradeable(ctx.tx, input.productId, input.locationId),
  handler: async (ctx, input) => {
    const moved = await applyMovement(ctx.tx, ctx.actor, {
      ...input,
      kind: "purchase_inward",
      reason: input.reason ?? null,
    });
    return {
      result: { ledgerId: moved.ledgerId, onHandUnits: moved.onHandUnits },
      events: [
        { name: "verity.trading.stock_received", entityId: moved.ledgerId },
      ],
    };
  },
};

export const issueStock: CommandDefinition<
  {
    productId: string;
    locationId: string;
    rackId?: string;
    qtyUnits: number;
    reason?: string;
  },
  { ledgerId: string; unitCostPaise: number; onHandUnits: number }
> = {
  key: "verity.trading.issue_stock",
  entity: ENTITY_STOCK_LEDGER,
  verb: "Create",
  input: z.object({ ...movementInput, reason: z.string().max(400).optional() }),
  preconditions: async (ctx, input) =>
    assertTradeable(ctx.tx, input.productId, input.locationId),
  handler: async (ctx, input) => {
    const moved = await applyMovement(ctx.tx, ctx.actor, {
      ...input,
      kind: "sales_outward",
      reason: input.reason ?? null,
    });
    return {
      result: moved,
      events: [
        { name: "verity.trading.stock_issued", entityId: moved.ledgerId },
      ],
    };
  },
};

export const transferStock: CommandDefinition<
  {
    productId: string;
    fromLocationId: string;
    toLocationId: string;
    toRackId?: string;
    qtyUnits: number;
  },
  { outLedgerId: string; inLedgerId: string }
> = {
  key: "verity.trading.transfer_stock",
  entity: ENTITY_STOCK_LEDGER,
  verb: "Create",
  input: z.object({
    productId: z.string().uuid(),
    fromLocationId: z.string().uuid(),
    toLocationId: z.string().uuid(),
    toRackId: z.string().uuid().optional(),
    qtyUnits: z.number().int().positive(),
  }),
  preconditions: async (ctx, input) => {
    if (input.fromLocationId === input.toLocationId) {
      throw new ValidationError(
        "E_VALIDATION: a transfer needs two different godowns",
      );
    }
    await assertTradeable(ctx.tx, input.productId, input.fromLocationId);
    await assertTradeable(ctx.tx, input.productId, input.toLocationId);
  },
  handler: async (ctx, input) => {
    // Two rows, one transaction. The cost travels with the stock: the receiving
    // godown blends in what the sending godown was carrying it at, not a price
    // invented for the transfer — so moving stock between godowns can neither
    // create nor destroy value.
    const out = await applyMovement(ctx.tx, ctx.actor, {
      productId: input.productId,
      locationId: input.fromLocationId,
      kind: "transfer_out",
      qtyUnits: input.qtyUnits,
    });
    const incoming = await applyMovement(ctx.tx, ctx.actor, {
      productId: input.productId,
      locationId: input.toLocationId,
      rackId: input.toRackId ?? null,
      kind: "transfer_in",
      qtyUnits: input.qtyUnits,
      unitCostPaise: out.unitCostPaise,
    });
    return {
      result: { outLedgerId: out.ledgerId, inLedgerId: incoming.ledgerId },
      events: [
        {
          name: "verity.trading.stock_transferred",
          entityId: incoming.ledgerId,
        },
      ],
    };
  },
};

export const adjustStock: CommandDefinition<
  {
    productId: string;
    locationId: string;
    rackId?: string;
    qtyUnits: number;
    direction: "in" | "out";
    reason: string;
  },
  { ledgerId: string; onHandUnits: number }
> = {
  key: "verity.trading.adjust_stock",
  entity: ENTITY_STOCK_LEDGER,
  // An adjustment is not an ordinary movement: it is someone asserting that the
  // system is wrong. ActionExecute rather than Create, so it can be granted to
  // the owner alone without also withholding ordinary receipts and issues.
  verb: "ActionExecute",
  input: z.object({
    ...movementInput,
    direction: z.enum(["in", "out"]),
    reason: z.string().min(3).max(400),
  }),
  preconditions: async (ctx, input) =>
    assertTradeable(ctx.tx, input.productId, input.locationId),
  handler: async (ctx, input) => {
    const balance = await ctx.tx.stockBalance.findFirst({
      where: { productId: input.productId, locationId: input.locationId },
    });
    const moved = await applyMovement(ctx.tx, ctx.actor, {
      productId: input.productId,
      locationId: input.locationId,
      rackId: input.rackId ?? null,
      kind: input.direction === "in" ? "adjust_in" : "adjust_out",
      qtyUnits: input.qtyUnits,
      // Found stock comes in at what the godown already carries the board at.
      // Any other figure would be a purchase price nobody paid.
      unitCostPaise: balance?.avgUnitCostPaise ?? 0,
      reason: input.reason,
    });

    await recordActivity(ctx, {
      entityKey: ENTITY_STOCK_BALANCE,
      entityId: balance?.id ?? moved.ledgerId,
      commandKey: "verity.trading.adjust_stock",
      changes: diffFields(
        { qtyUnits: balance?.qtyUnits ?? 0 },
        { qtyUnits: moved.onHandUnits },
      ),
    });

    return {
      result: { ledgerId: moved.ledgerId, onHandUnits: moved.onHandUnits },
      events: [
        { name: "verity.trading.stock_adjusted", entityId: moved.ledgerId },
      ],
    };
  },
};

export const recordDamagedStock: CommandDefinition<
  {
    productId: string;
    locationId: string;
    rackId?: string;
    qtyUnits: number;
    reason: string;
  },
  { ledgerId: string; onHandUnits: number }
> = {
  impact: "destructive",
  key: "verity.trading.record_damaged_stock",
  entity: ENTITY_STOCK_LEDGER,
  verb: "ActionExecute",
  input: z.object({ ...movementInput, reason: z.string().min(3).max(400) }),
  preconditions: async (ctx, input) =>
    assertTradeable(ctx.tx, input.productId, input.locationId),
  handler: async (ctx, input) => {
    const moved = await applyMovement(ctx.tx, ctx.actor, {
      ...input,
      kind: "damaged_out",
      reason: input.reason,
    });
    return {
      result: { ledgerId: moved.ledgerId, onHandUnits: moved.onHandUnits },
      events: [
        { name: "verity.trading.stock_damaged", entityId: moved.ledgerId },
      ],
    };
  },
};

/**
 * Material comes back from a customer.
 *
 * Authority: taskplans/archive/45_plywood_workflow_program.md §4.5; specification §66.
 *
 * TIED TO THE ISSUE IT CAME BACK FROM (slice 5)
 * `goodsIssueId` is optional in the type and expected in practice. Given, the
 * return is capped at what that issue actually sent, valued at the cost that
 * left on it, and linked so a reader can follow the board out of the gate and
 * back in again. Without it a "return" is an unexplained inward movement that
 * happens to be labelled one — and returns are exactly where an inventory
 * fraud hides, because nobody questions stock arriving.
 *
 * MONEY DOES NOT MOVE HERE
 * A return puts boards back on the rack. It does not refund anybody. If money
 * has to come back it is a credit note — a separate, numbered, reportable
 * document — and pretending one implies the other is how stock and money stop
 * agreeing.
 */
export const recordReturnedStock: CommandDefinition<
  {
    productId: string;
    locationId: string;
    rackId?: string;
    qtyUnits: number;
    reason: string;
    goodsIssueId?: string;
  },
  { ledgerId: string; onHandUnits: number }
> = {
  key: "verity.trading.record_returned_stock",
  entity: ENTITY_STOCK_LEDGER,
  verb: "ActionExecute",
  input: z.object({
    ...movementInput,
    reason: z.string().min(3).max(400),
    goodsIssueId: z.string().uuid().optional(),
  }),
  preconditions: async (ctx, input) =>
    assertTradeable(ctx.tx, input.productId, input.locationId),
  handler: async (ctx, input) => {
    let unitCostPaise: number | undefined;
    let source:
      { type: string; id: string; number?: string | null } | undefined;

    if (input.goodsIssueId) {
      const issue = await ctx.tx.tradingGoodsIssue.findUniqueOrThrow({
        where: { id: input.goodsIssueId },
        include: { lines: true },
      });
      const line = issue.lines.find(
        (candidate) => candidate.productId === input.productId,
      );
      if (!line) {
        throw new ValidationError(
          "E_VALIDATION: that board was not issued on this goods issue",
        );
      }

      // A customer cannot return more than they were given. Without the cap,
      // a return is a way to create stock out of nothing.
      const alreadyReturned = await ctx.tx.stockLedgerEntry.aggregate({
        where: {
          kind: "returned_stock",
          sourceType: "goods_issue",
          sourceId: issue.id,
          productId: input.productId,
        },
        _sum: { qtyDeltaUnits: true },
      });
      const returnable =
        line.qtyIssued - (alreadyReturned._sum.qtyDeltaUnits ?? 0);
      if (input.qtyUnits > returnable) {
        throw new ValidationError(
          `E_VALIDATION: ${line.productNameSnapshot} had ${line.qtyIssued} issued on ${issue.issueNumber} ` +
            `and ${returnable} can still come back, not ${input.qtyUnits}`,
        );
      }

      // Valued at what left on that issue, not at today's average. The board
      // that comes back is the board that went out.
      unitCostPaise = line.unitCostPaise;
      source = { type: "goods_issue", id: issue.id, number: issue.issueNumber };
    } else {
      const balance = await ctx.tx.stockBalance.findFirst({
        where: { productId: input.productId, locationId: input.locationId },
      });
      // Returned goods re-enter at what the godown carries them at, not at what
      // they were sold for. A return is not a purchase.
      unitCostPaise = balance?.avgUnitCostPaise ?? 0;
    }

    const moved = await applyMovement(ctx.tx, ctx.actor, {
      productId: input.productId,
      locationId: input.locationId,
      rackId: input.rackId ?? null,
      qtyUnits: input.qtyUnits,
      kind: "returned_stock",
      unitCostPaise,
      reason: input.reason,
      source,
    });
    return {
      result: { ledgerId: moved.ledgerId, onHandUnits: moved.onHandUnits },
      events: [
        {
          name: "verity.trading.stock_returned",
          entityId: moved.ledgerId,
          payload: source ? { goodsIssueNumber: source.number } : {},
        },
      ],
    };
  },
};

/* --------------------------------- reads ---------------------------------- */

export const stockOnHand: QueryDefinition<
  { locationId?: string; productId?: string },
  Array<{
    productId: string;
    productName: string;
    brandName: string;
    unitLabel: string;
    locationId: string;
    locationName: string;
    qtyUnits: number;
    avgUnitCostPaise: number;
    valuePaise: number;
  }>
> = {
  scopeHandling: "handler",
  key: "verity.trading.stock_on_hand",
  entity: ENTITY_STOCK_BALANCE,
  input: z.object({
    locationId: z.string().uuid().optional(),
    productId: z.string().uuid().optional(),
  }),
  handler: async (ctx, input) => {
    // Layer 2 (P0-01). Without this a godown-scoped role reads every godown's
    // stock, and the number it reads is the business's whole inventory.
    const reachable = await reachableGodownIds(
      ctx.tx,
      ctx.actor,
      ENTITY_STOCK_BALANCE,
    );
    const balances = await ctx.tx.stockBalance.findMany({
      where: {
        // An explicit locationId is intersected with the reachable set rather
        // than replacing it, so asking for another branch's godown by id
        // returns nothing instead of returning its stock.
        locationId: input.locationId
          ? { in: reachable.filter((id) => id === input.locationId) }
          : { in: reachable },
        ...(input.productId ? { productId: input.productId } : {}),
      },
      include: {
        product: { include: { brand: { select: { name: true } } } },
        location: { select: { name: true } },
      },
    });

    return balances
      .map((balance) => ({
        productId: balance.productId,
        productName: balance.product.name,
        brandName: balance.product.brand.name,
        unitLabel: balance.product.unitLabel,
        locationId: balance.locationId,
        locationName: balance.location.name,
        qtyUnits: balance.qtyUnits,
        avgUnitCostPaise: balance.avgUnitCostPaise,
        // Value at weighted average cost (P1), not at what it might sell for.
        // Naming the method matters: an owner reading this figure is entitled to
        // know which of three possible numbers it is.
        valuePaise: balance.qtyUnits * balance.avgUnitCostPaise,
      }))
      .sort(
        (a, b) =>
          a.locationName.localeCompare(b.locationName) ||
          a.brandName.localeCompare(b.brandName) ||
          a.productName.localeCompare(b.productName),
      );
  },
};

export const lowStock: QueryDefinition<
  Record<string, never>,
  Array<{
    productId: string;
    productName: string;
    brandName: string;
    unitLabel: string;
    onHandUnits: number;
    reservedUnits: number;
    availableUnits: number;
    reorderLevelUnits: number;
  }>
> = {
  scopeHandling: "handler",
  key: "verity.trading.low_stock",
  entity: ENTITY_STOCK_BALANCE,
  input: z.object({}),
  handler: async (ctx) => {
    // Across every godown, not per godown: the buying decision is made for the
    // business, and a board short in Okhla but plentiful in Noida is a transfer,
    // not a purchase order.
    const reachable = await reachableGodownIds(
      ctx.tx,
      ctx.actor,
      ENTITY_STOCK_BALANCE,
    );
    const products = await ctx.tx.tradingProduct.findMany({
      // A service has no reorder level worth sweeping — it never holds stock.
      where: { active: true, reorderLevelUnits: { gt: 0 }, type: "PHYSICAL" },
      include: {
        brand: { select: { name: true } },
        // Only the godowns this actor can see. A branch manager's reorder
        // decision is about the stock they can actually sell.
        balances: { where: { locationId: { in: reachable } } },
      },
    });

    // Reserved stock is spoken for. Comparing on-hand against the reorder
    // level — which is what this did — reports plenty while every sheet is
    // already promised to a customer, and the buyer finds out at goods issue.
    //
    // Authority: taskplans/archive/45_plywood_workflow_program.md §4.2:
    //   available = on_hand - reserved
    //   low_stock = available < reorder_level
    const held = await ctx.tx.tradingStockReservation.groupBy({
      by: ["productId"],
      where: { releasedAt: null, locationId: { in: reachable } },
      _sum: { qtyUnits: true },
    });
    const reservedByProduct = new Map(
      held.map((row) => [row.productId, row._sum.qtyUnits ?? 0]),
    );

    return products
      .map((product) => {
        const onHandUnits = product.balances.reduce(
          (sum, balance) => sum + balance.qtyUnits,
          0,
        );
        const reservedUnits = reservedByProduct.get(product.id) ?? 0;
        return {
          productId: product.id,
          productName: product.name,
          brandName: product.brand.name,
          unitLabel: product.unitLabel,
          onHandUnits,
          reservedUnits,
          availableUnits: onHandUnits - reservedUnits,
          reorderLevelUnits: product.reorderLevelUnits,
        };
      })
      .filter((row) => row.availableUnits < row.reorderLevelUnits)
      .sort((a, b) => a.availableUnits - b.availableUnits);
  },
};

export const productMovements: QueryDefinition<
  { productId: string; limit?: number },
  Array<{
    id: string;
    kind: string;
    qtyDeltaUnits: number;
    unitCostPaise: number;
    locationName: string;
    rackLabel: string | null;
    reason: string | null;
    occurredAt: Date;
  }>
> = {
  scopeHandling: "handler",
  key: "verity.trading.product_movements",
  entity: ENTITY_STOCK_LEDGER,
  input: z.object({
    productId: z.string().uuid(),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  handler: async (ctx, input) => {
    // Layer 2, and it was missing.
    //
    // THE DEFECT THIS CLOSES. `stockOnHand` above filters by
    // `reachableGodownIds` and says why: without it a godown-scoped role reads
    // every godown's stock. This handler read the same facts from the other
    // table and applied no such filter, so a warehouse operator limited to
    // Noida could read the movement history of every godown in the business —
    // quantities, costs and the orders behind them — just by asking for a
    // product. Layer 1 passed, which is what made it look authorized.
    const reachable = await reachableGodownIds(
      ctx.tx,
      ctx.actor,
      ENTITY_STOCK_LEDGER,
    );
    const entries = await ctx.tx.stockLedgerEntry.findMany({
      where: { productId: input.productId, locationId: { in: reachable } },
      orderBy: { occurredAt: "desc" },
      take: input.limit ?? 100,
      include: {
        location: { select: { name: true } },
        rack: { select: { rackLabel: true } },
      },
    });

    return entries.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      qtyDeltaUnits: entry.qtyDeltaUnits,
      unitCostPaise: entry.unitCostPaise,
      locationName: entry.location.name,
      rackLabel: entry.rack?.rackLabel ?? null,
      reason: entry.reason,
      occurredAt: entry.occurredAt,
    }));
  },
};
