import { randomUUID } from "node:crypto";
import { z } from "zod";
import { registerCommand, ValidationError, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { costPerGoodPiece, wageOf } from "./ledger";
import { fabricOfLot } from "./fabric";
import { LEDGER_SELECT, activeStages, asDate, isoOf, loadBundles, toLedger, todayFor, type Tx } from "./shared";

/**
 * What a lot cost. Three parts are derived from records that already exist and are never typed twice: the fabric it took from rolls
 * (at each roll's invoice rate), the wages its entries earned, and the charges recovered from karigars for lost pieces. The fourth
 * part is entered: other costs by the factory's own categories (thread, buttons, packing ...), into an append-only ledger. A cost
 * shared by several lots (one thread invoice for three lots) is split across them by the pieces each one cut, so nobody does the
 * arithmetic by hand. A wrong line is reversed, never edited.
 */

export const ENTITY_PIECEWORK_LOT_COST = "verity.piecework.lot_cost";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

/** Splits a whole number of paise over weights so the parts add up exactly (largest remainder). */
export function splitByWeight(totalMinor: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0) throw new Error("weights must add up to more than zero");
  const exact = weights.map((w) => (totalMinor * w) / sum);
  const parts = exact.map((x) => Math.floor(x));
  let left = totalMinor - parts.reduce((s, x) => s + x, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    parts[i]! += 1;
    left -= 1;
  }
  return parts;
}

async function piecesCut(tx: Tx, lotIds: string[]): Promise<Map<string, number>> {
  const rows = await tx.pieceworkBundle.groupBy({ by: ["lotId"], where: { lotId: { in: lotIds }, cancelledAt: null }, _sum: { netPieces: true } });
  return new Map(rows.map((r) => [r.lotId, r._sum.netPieces ?? 0]));
}

export const addLotCost: CommandDefinition<
  { lotIds: string[]; category: string; amountMinor: number; note?: string; incurredOn?: string },
  { ids: string[]; parts: Array<{ lotId: string; amountMinor: number }> }
> = {
  key: "verity.piecework.add_lot_cost",
  entity: ENTITY_PIECEWORK_LOT_COST,
  verb: "Create",
  input: z.object({
    /** One lot, or several to share the amount by the pieces each cut. */
    lotIds: z.array(uuid).min(1).max(30),
    category: z.string().trim().min(1).max(60),
    amountMinor: z.number().int().min(1).max(1_000_000_000),
    note: z.string().trim().max(300).optional(),
    incurredOn: isoDate.optional(),
  }),
  preconditions: async (ctx, input) => {
    if (new Set(input.lotIds).size !== input.lotIds.length) throw new ValidationError("E_VALIDATION: name each lot once");
    const lots = await ctx.tx.pieceworkLot.findMany({ where: { id: { in: input.lotIds } } });
    if (lots.length !== input.lotIds.length || lots.some((l) => l.cancelledAt)) throw new ValidationError("E_VALIDATION: lot not found in this tenant");
    const closed = lots.find((l) => l.status === "closed");
    if (closed) throw new ValidationError(`E_VALIDATION: ${closed.number} is closed; its cost is final`);
    if ((input.incurredOn ?? "") > (await todayFor(ctx.tx))) throw new ValidationError("E_VALIDATION: a cost cannot be dated in the future");
    if (input.lotIds.length > 1) {
      const cut = await piecesCut(ctx.tx, input.lotIds);
      const uncut = lots.find((l) => (cut.get(l.id) ?? 0) === 0);
      if (uncut) throw new ValidationError(`E_VALIDATION: ${uncut.number} has no pieces cut yet, so a shared cost cannot be split onto it; add it to that lot alone`);
      if (input.amountMinor < input.lotIds.length) throw new ValidationError("E_VALIDATION: the amount is too small to share across that many lots");
    }
  },
  handler: async (ctx, input) => {
    const day = input.incurredOn ?? (await todayFor(ctx.tx));
    const cut = input.lotIds.length > 1 ? await piecesCut(ctx.tx, input.lotIds) : null;
    const amounts = cut ? splitByWeight(input.amountMinor, input.lotIds.map((id) => cut.get(id)!)) : [input.amountMinor];
    const batchId = input.lotIds.length > 1 ? randomUUID() : null;
    const ids: string[] = [];
    for (const [i, lotId] of input.lotIds.entries()) {
      const row = await ctx.tx.pieceworkLotCost.create({
        data: {
          tenantId: ctx.actor.tenantId, lotId, category: input.category, amountMinor: amounts[i]!, note: input.note ?? null,
          incurredOn: asDate(day), batchId, enteredById: ctx.actor.userId,
        },
      });
      ids.push(row.id);
    }
    return {
      result: { ids, parts: input.lotIds.map((lotId, i) => ({ lotId, amountMinor: amounts[i]! })) },
      events: ids.map((id) => ({ name: "verity.piecework.lot_cost_added", entityId: id })),
    };
  },
};

export const reverseLotCost: CommandDefinition<{ costId: string; reason: string }, { id: string }> = {
  key: "verity.piecework.reverse_lot_cost",
  entity: ENTITY_PIECEWORK_LOT_COST,
  verb: "ActionExecute",
  impact: "destructive",
  input: z.object({ costId: uuid, reason: z.string().trim().min(3).max(300) }),
  preconditions: async (ctx, input) => {
    const row = await ctx.tx.pieceworkLotCost.findUnique({ where: { id: input.costId }, include: { lot: true, reversal: true } });
    if (!row) throw new ValidationError("E_VALIDATION: cost not found in this tenant");
    if (row.reversesId) throw new ValidationError("E_VALIDATION: a reversal cannot itself be reversed; add the cost again");
    if (row.reversal) throw new ValidationError("E_VALIDATION: that cost is already reversed");
    if (row.lot.status === "closed") throw new ValidationError(`E_VALIDATION: ${row.lot.number} is closed; its cost is final`);
  },
  handler: async (ctx, input) => {
    const o = await ctx.tx.pieceworkLotCost.findUniqueOrThrow({ where: { id: input.costId } });
    const row = await ctx.tx.pieceworkLotCost.create({
      data: {
        tenantId: ctx.actor.tenantId, lotId: o.lotId, category: o.category, amountMinor: o.amountMinor, note: input.reason,
        incurredOn: asDate(await todayFor(ctx.tx)), batchId: o.batchId, reversesId: o.id, enteredById: ctx.actor.userId,
      },
    });
    return { result: { id: row.id }, events: [{ name: "verity.piecework.lot_cost_reversed", entityId: row.id }] };
  },
};

export type LotCosting = {
  fabricMinor: number | null;
  wagesMinor: number;
  /** Charged to karigars for lost pieces and approved: it comes off the lot's cost. */
  recoveredMinor: number;
  other: Array<{ category: string; amountMinor: number }>;
  otherMinor: number;
  totalMinor: number;
  goodPieces: number;
  perGoodPieceMinor: number | null;
  lines: Array<{ id: string; category: string; amountMinor: number; note: string | null; incurredOn: string; shared: boolean; reversed: boolean; isReversal: boolean }>;
};

/** The cost of one lot, with every part it is built from. */
export async function costingOf(tx: Tx, lotId: string): Promise<LotCosting> {
  const [fabric, entries, approvals, costs, stages] = await Promise.all([
    fabricOfLot(tx, lotId),
    tx.pieceworkEntry.findMany({ where: { lotId }, select: LEDGER_SELECT }),
    tx.pieceworkApproval.findMany({ where: { lotId, kind: "deduction", status: "approved", entryId: { not: null } }, select: { amountMinor: true } }),
    tx.pieceworkLotCost.findMany({ where: { lotId }, orderBy: { createdAt: "asc" } }),
    activeStages(tx),
  ]);
  const wagesMinor = entries.map((e) => toLedger(e)).reduce((s, e) => s + wageOf(e), 0);
  const recoveredMinor = approvals.reduce((s, a) => s + (a.amountMinor ?? 0), 0);
  const sign = (c: { reversesId: string | null }) => (c.reversesId ? -1 : 1);
  const byCategory = new Map<string, number>();
  for (const c of costs) byCategory.set(c.category, (byCategory.get(c.category) ?? 0) + sign(c) * c.amountMinor);
  const other = [...byCategory].filter(([, v]) => v !== 0).map(([category, amountMinor]) => ({ category, amountMinor })).sort((a, b) => b.amountMinor - a.amountMinor);
  const otherMinor = other.reduce((s, o) => s + o.amountMinor, 0);
  const bundles = (await loadBundles(tx, stages, { lotId })).filter((b) => !b.cancelledAt);
  const goodPieces = bundles.reduce((s, b) => s + b.position.ready, 0);
  const totalMinor = (fabric.costMinor ?? 0) + wagesMinor + otherMinor - recoveredMinor;
  const reversed = new Set(costs.filter((c) => c.reversesId).map((c) => c.reversesId!));
  return {
    fabricMinor: fabric.costMinor, wagesMinor, recoveredMinor, other, otherMinor, totalMinor, goodPieces,
    perGoodPieceMinor: costPerGoodPiece(totalMinor, goodPieces),
    lines: costs.map((c) => ({
      id: c.id, category: c.category, amountMinor: sign(c) * c.amountMinor, note: c.note, incurredOn: isoOf(c.incurredOn),
      shared: c.batchId !== null, reversed: reversed.has(c.id), isReversal: c.reversesId !== null,
    })).reverse(),
  };
}

export const lotCosting: QueryDefinition<{ lotId: string }, LotCosting> = {
  key: "verity.piecework.lot_costing",
  entity: ENTITY_PIECEWORK_LOT_COST,
  input: z.object({ lotId: uuid }),
  handler: async (ctx, input) => costingOf(ctx.tx, input.lotId),
};

export function registerCosts(): void {
  registerCommand(addLotCost);
  registerCommand(reverseLotCost);
  registerQuery(lotCosting);
}
