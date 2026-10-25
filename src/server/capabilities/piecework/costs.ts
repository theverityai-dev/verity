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
    // Fabric comes from the rolls and every stage's wages from the entries, so a cost typed under those names would be counted twice.
    const counted = new Set(["fabric", "wages", "wage", ...(await ctx.tx.pieceworkStage.findMany({ select: { label: true } })).map((s) => s.label.trim().toLowerCase())]);
    if (counted.has(input.category.trim().toLowerCase())) {
      throw new ValidationError(`E_VALIDATION: ${input.category} is already counted from the ${input.category.trim().toLowerCase() === "fabric" ? "fabric taken from rolls" : "wages recorded for it"}; adding it here would count it twice. Use another category for anything else`);
    }
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

/**
 * Joining or linking lots. A lot can carry a part of another lot's cost: two lots cut and finished as one, or one lot's cut partly used
 * by another. A share is a part (in basis points, 10000 = all) of the SOURCE lot's own cost; the source's records are never edited, the
 * cost is only read as moved, so a share is reversed, never changed. Pieces stay where they were made: when a lot is joined into another
 * (its pieces are bundled there) share all of it, so the whole cost sits with the pieces.
 *
 * One level only: a lot that gives cost cannot receive it, and one that receives cannot give. That keeps every figure a single
 * subtraction and addition with no loop to unwind, and it matches how joins happen on a floor.
 *
 * Sharing is a cost decision, so it takes the same grants as adding a cost (ENTITY_PIECEWORK_LOT_COST).
 */

/** A part of a lot's own cost, in paise. */
export const shareAmount = (ownMinor: number, basisPoints: number): number => Math.round((ownMinor * basisPoints) / 10_000);

type ShareRow = { id: string; sourceLotId: string; targetLotId: string; basisPoints: number; reversesId: string | null };

/** Shares still in force: a reversal row and the row it reverses both drop out. */
export function sharesInForce<T extends ShareRow>(rows: T[]): T[] {
  const reversed = new Set(rows.filter((r) => r.reversesId).map((r) => r.reversesId!));
  return rows.filter((r) => !r.reversesId && !reversed.has(r.id));
}

export const shareLotCost: CommandDefinition<
  { sourceLotId: string; targetLotId: string; basisPoints: number; reason: string },
  { id: string; amountMinor: number }
> = {
  key: "verity.piecework.share_lot_cost",
  entity: ENTITY_PIECEWORK_LOT_COST,
  verb: "Create",
  input: z.object({
    sourceLotId: uuid, targetLotId: uuid,
    /** The part of the source lot's own cost the target carries: 1 to 10000, where 10000 is all of it. */
    basisPoints: z.number().int().min(1).max(10_000),
    reason: z.string().trim().min(3).max(300),
  }),
  preconditions: async (ctx, input) => {
    if (input.sourceLotId === input.targetLotId) throw new ValidationError("E_VALIDATION: a lot cannot share its cost with itself");
    const lots = await ctx.tx.pieceworkLot.findMany({ where: { id: { in: [input.sourceLotId, input.targetLotId] } } });
    if (lots.length !== 2 || lots.some((l) => l.cancelledAt)) throw new ValidationError("E_VALIDATION: lot not found in this tenant");
    const closed = lots.find((l) => l.status === "closed");
    if (closed) throw new ValidationError(`E_VALIDATION: ${closed.number} is closed; its cost is final`);
    const rows = sharesInForce(await ctx.tx.pieceworkLotShare.findMany({ where: { OR: [{ sourceLotId: { in: [input.sourceLotId, input.targetLotId] } }, { targetLotId: { in: [input.sourceLotId, input.targetLotId] } }] } }));
    const num = (id: string) => lots.find((l) => l.id === id)!.number;
    if (rows.some((r) => r.targetLotId === input.sourceLotId)) throw new ValidationError(`E_VALIDATION: ${num(input.sourceLotId)} already carries cost from another lot, so it cannot give cost on; reverse that share first`);
    if (rows.some((r) => r.sourceLotId === input.targetLotId)) throw new ValidationError(`E_VALIDATION: ${num(input.targetLotId)} already gives cost to another lot, so it cannot receive cost; reverse that share first`);
    const given = rows.filter((r) => r.sourceLotId === input.sourceLotId).reduce((s, r) => s + r.basisPoints, 0);
    if (given + input.basisPoints > 10_000) {
      throw new ValidationError(`E_VALIDATION: ${num(input.sourceLotId)} has already given ${(given / 100).toFixed(2).replace(/\.00$/, "")}% of its cost to other lots; only ${((10_000 - given) / 100).toFixed(2).replace(/\.00$/, "")}% is left to give`);
    }
  },
  handler: async (ctx, input) => {
    const row = await ctx.tx.pieceworkLotShare.create({
      data: { tenantId: ctx.actor.tenantId, sourceLotId: input.sourceLotId, targetLotId: input.targetLotId, basisPoints: input.basisPoints, reason: input.reason, enteredById: ctx.actor.userId },
    });
    const amountMinor = shareAmount((await partsOf(ctx.tx, input.sourceLotId)).ownMinor, input.basisPoints);
    return { result: { id: row.id, amountMinor }, events: [{ name: "verity.piecework.lot_cost_shared", entityId: row.id }] };
  },
};

export const reverseLotShare: CommandDefinition<{ shareId: string; reason: string }, { id: string }> = {
  key: "verity.piecework.reverse_lot_share",
  entity: ENTITY_PIECEWORK_LOT_COST,
  verb: "ActionExecute",
  impact: "destructive",
  input: z.object({ shareId: uuid, reason: z.string().trim().min(3).max(300) }),
  preconditions: async (ctx, input) => {
    const row = await ctx.tx.pieceworkLotShare.findUnique({ where: { id: input.shareId }, include: { source: true, target: true, reversal: true } });
    if (!row) throw new ValidationError("E_VALIDATION: share not found in this tenant");
    if (row.reversesId) throw new ValidationError("E_VALIDATION: a reversal cannot itself be reversed; share the cost again");
    if (row.reversal) throw new ValidationError("E_VALIDATION: that share is already reversed");
    const closed = [row.source, row.target].find((l) => l.status === "closed");
    if (closed) throw new ValidationError(`E_VALIDATION: ${closed.number} is closed; its cost is final`);
  },
  handler: async (ctx, input) => {
    const o = await ctx.tx.pieceworkLotShare.findUniqueOrThrow({ where: { id: input.shareId } });
    const row = await ctx.tx.pieceworkLotShare.create({
      data: { tenantId: ctx.actor.tenantId, sourceLotId: o.sourceLotId, targetLotId: o.targetLotId, basisPoints: o.basisPoints, reason: input.reason, reversesId: o.id, enteredById: ctx.actor.userId },
    });
    return { result: { id: row.id }, events: [{ name: "verity.piecework.lot_share_reversed", entityId: row.id }] };
  },
};

export type LotShareLine = {
  id: string; direction: "out" | "in"; otherLotId: string; otherNumber: string; otherName: string; basisPoints: number;
  /** What moved, in paise: out of this lot, or into it. */
  amountMinor: number; reason: string; on: string; reversed: boolean; isReversal: boolean;
};

export type LotCosting = {
  fabricMinor: number | null;
  wagesMinor: number;
  /** Charged to karigars for lost pieces and approved: it comes off the lot's cost. */
  recoveredMinor: number;
  other: Array<{ category: string; amountMinor: number }>;
  otherMinor: number;
  /** Fabric + wages + other - recovered: what this lot's own records add up to, before any share. */
  ownMinor: number;
  /** Given to other lots and taken in from them (shares in force only). The total is own - out + in. */
  sharedOutMinor: number;
  sharedInMinor: number;
  totalMinor: number;
  goodPieces: number;
  perGoodPieceMinor: number | null;
  lines: Array<{ id: string; category: string; amountMinor: number; note: string | null; incurredOn: string; shared: boolean; reversed: boolean; isReversal: boolean }>;
  shares: LotShareLine[];
};

/** The parts a lot's own cost is built from; the one place they are read, so a share can price its source the same way. */
async function partsOf(tx: Tx, lotId: string) {
  const [fabric, entries, approvals, costs] = await Promise.all([
    fabricOfLot(tx, lotId),
    tx.pieceworkEntry.findMany({ where: { lotId }, select: LEDGER_SELECT }),
    tx.pieceworkApproval.findMany({ where: { lotId, kind: "deduction", status: "approved", entryId: { not: null } }, select: { amountMinor: true } }),
    tx.pieceworkLotCost.findMany({ where: { lotId }, orderBy: { createdAt: "asc" } }),
  ]);
  const wagesMinor = entries.map((e) => toLedger(e)).reduce((s, e) => s + wageOf(e), 0);
  const recoveredMinor = approvals.reduce((s, a) => s + (a.amountMinor ?? 0), 0);
  const sign = (c: { reversesId: string | null }) => (c.reversesId ? -1 : 1);
  const byCategory = new Map<string, number>();
  for (const c of costs) byCategory.set(c.category, (byCategory.get(c.category) ?? 0) + sign(c) * c.amountMinor);
  const other = [...byCategory].filter(([, v]) => v !== 0).map(([category, amountMinor]) => ({ category, amountMinor })).sort((a, b) => b.amountMinor - a.amountMinor);
  const otherMinor = other.reduce((s, o) => s + o.amountMinor, 0);
  return { fabric, wagesMinor, recoveredMinor, costs, sign, other, otherMinor, ownMinor: (fabric.costMinor ?? 0) + wagesMinor + otherMinor - recoveredMinor };
}

/** The cost of one lot, with every part it is built from and every share moving cost in or out. */
export async function costingOf(tx: Tx, lotId: string): Promise<LotCosting> {
  const [parts, stages, shareRows] = await Promise.all([
    partsOf(tx, lotId),
    activeStages(tx),
    tx.pieceworkLotShare.findMany({ where: { OR: [{ sourceLotId: lotId }, { targetLotId: lotId }] }, orderBy: { createdAt: "asc" }, include: { source: { select: { number: true, name: true, design: true } }, target: { select: { number: true, name: true, design: true } } } }),
  ]);
  const { fabric, wagesMinor, recoveredMinor, costs, sign, other, otherMinor, ownMinor } = parts;
  const bundles = (await loadBundles(tx, stages, { lotId })).filter((b) => !b.cancelledAt);
  const goodPieces = bundles.reduce((s, b) => s + b.position.ready, 0);
  const reversed = new Set(costs.filter((c) => c.reversesId).map((c) => c.reversesId!));

  // What a share moved is priced on its source's own cost today; for a share coming in, that is the other lot's records.
  const sourceOwn = new Map<string, number>([[lotId, ownMinor]]);
  for (const s of shareRows) if (!sourceOwn.has(s.sourceLotId)) sourceOwn.set(s.sourceLotId, (await partsOf(tx, s.sourceLotId)).ownMinor);
  const inForce = sharesInForce(shareRows);
  const moved = (s: ShareRow) => shareAmount(sourceOwn.get(s.sourceLotId)!, s.basisPoints);
  const shareReversed = new Set(shareRows.filter((s) => s.reversesId).map((s) => s.reversesId!));
  const shares = shareRows.map((s): LotShareLine => {
    const out = s.sourceLotId === lotId;
    const other = out ? s.target : s.source;
    return {
      id: s.id, direction: out ? "out" : "in", otherLotId: out ? s.targetLotId : s.sourceLotId, otherNumber: other.number, otherName: other.name ?? other.design,
      basisPoints: s.basisPoints, amountMinor: moved(s), reason: s.reason, on: isoOf(s.createdAt),
      reversed: shareReversed.has(s.id), isReversal: s.reversesId !== null,
    };
  });
  const sharedOutMinor = inForce.filter((s) => s.sourceLotId === lotId).reduce((t, s) => t + moved(s), 0);
  const sharedInMinor = inForce.filter((s) => s.targetLotId === lotId).reduce((t, s) => t + moved(s), 0);
  const totalMinor = ownMinor - sharedOutMinor + sharedInMinor;
  return {
    fabricMinor: fabric.costMinor, wagesMinor, recoveredMinor, other, otherMinor, ownMinor, sharedOutMinor, sharedInMinor, totalMinor, goodPieces,
    perGoodPieceMinor: costPerGoodPiece(totalMinor, goodPieces),
    lines: costs.map((c) => ({
      id: c.id, category: c.category, amountMinor: sign(c) * c.amountMinor, note: c.note, incurredOn: isoOf(c.incurredOn),
      shared: c.batchId !== null, reversed: reversed.has(c.id), isReversal: c.reversesId !== null,
    })).reverse(),
    shares: shares.reverse(),
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
  registerCommand(shareLotCost);
  registerCommand(reverseLotShare);
  registerQuery(lotCosting);
}
