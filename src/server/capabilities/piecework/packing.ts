import { z } from "zod";
import { allocateSequence } from "@/server/runtime/document-number";
import { registerCommand, ValidationError, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { producedByLot } from "./ready";
import { asDate, isoOf, todayFor, type Tx } from "./shared";

/**
 * Packing list: the cartons a lot's garments go to a buyer in. Each line is a run of identical cartons (carton numbers from-to) with the
 * size assortment in ONE carton, its net and gross weight and its outside dimensions; totals are derived, never stored. Sizes are the
 * buyer's own labels: this is the one place a size breakdown is written, because the carton is where the buyer counts it (bundles stay
 * size-free). Cartons are numbered from 1 with no gap or overlap. A list never packs more than the lot has made ready, less what its
 * other standing lists already pack. The cartons are never edited: a wrong list is cancelled with a reason and made again.
 */

export const ENTITY_PIECEWORK_PACKING_LIST = "verity.piecework.packing_list";
const SERIES = "piecework.packing_list";
export const packingListNumber = (seq: number) => `PL-${String(seq).padStart(4, "0")}`;

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

const cartonLine = z.object({
  from: z.number().int().min(1).max(100_000),
  to: z.number().int().min(1).max(100_000),
  colour: z.string().trim().max(60).optional(),
  sizes: z.array(z.object({ size: z.string().trim().min(1).max(20), qty: z.number().int().min(1).max(10_000) })).min(1).max(15),
  netGrams: z.number().int().min(1).max(100_000),
  grossGrams: z.number().int().min(1).max(100_000),
  lengthCm: z.number().int().min(1).max(500),
  widthCm: z.number().int().min(1).max(500),
  heightCm: z.number().int().min(1).max(500),
});
export type CartonLine = z.infer<typeof cartonLine>;

export type PackingTotals = { cartons: number; pieces: number; netGrams: number; grossGrams: number; cbmMilli: number; bySize: Array<{ size: string; pieces: number }> };

/** Totals of a list's lines. CBM is kept in thousandths of a cubic metre so it adds up exactly. */
export function packingTotals(lines: CartonLine[]): PackingTotals {
  const bySize = new Map<string, number>();
  let cartons = 0, pieces = 0, netGrams = 0, grossGrams = 0, cbmMilli = 0;
  for (const l of lines) {
    const n = l.to - l.from + 1;
    const perCarton = l.sizes.reduce((s, x) => s + x.qty, 0);
    cartons += n;
    pieces += n * perCarton;
    netGrams += n * l.netGrams;
    grossGrams += n * l.grossGrams;
    cbmMilli += Math.round((n * l.lengthCm * l.widthCm * l.heightCm) / 1000);
    for (const s of l.sizes) bySize.set(s.size, (bySize.get(s.size) ?? 0) + n * s.qty);
  }
  return { cartons, pieces, netGrams, grossGrams, cbmMilli, bySize: [...bySize].map(([size, p]) => ({ size, pieces: p })) };
}

/** The reason a set of lines is not a list, or null. */
export function cartonProblem(lines: CartonLine[]): string | null {
  const sorted = [...lines].sort((a, b) => a.from - b.from);
  let next = 1;
  for (const l of sorted) {
    if (l.to < l.from) return `cartons ${l.from} to ${l.to} run backwards`;
    if (l.from !== next) return l.from < next ? `carton ${l.from} is on two lines` : `cartons ${next} to ${l.from - 1} are missing`;
    if (l.grossGrams < l.netGrams) return `cartons ${l.from} to ${l.to} weigh less gross than net`;
    const sizes = l.sizes.map((s) => s.size.toLowerCase());
    if (new Set(sizes).size !== sizes.length) return `cartons ${l.from} to ${l.to} name a size twice`;
    next = l.to + 1;
  }
  return null;
}

/** Pieces of a lot already on standing (not cancelled) packing lists. */
async function packedPieces(tx: Tx, lotId: string): Promise<number> {
  const lists = await tx.pieceworkPackingList.findMany({ where: { lotId, cancelledAt: null }, select: { cartons: true } });
  return lists.reduce((s, l) => s + packingTotals(l.cartons as CartonLine[]).pieces, 0);
}

type CreateInput = { lotId: string; buyer: string; reference?: string; destination?: string; packedOn?: string; cartons: CartonLine[]; note?: string };

export const createPackingList: CommandDefinition<CreateInput, { id: string; number: string; pieces: number }> = {
  key: "verity.piecework.create_packing_list",
  entity: ENTITY_PIECEWORK_PACKING_LIST,
  verb: "Create",
  input: z.object({
    lotId: uuid,
    buyer: z.string().trim().min(2).max(120),
    reference: z.string().trim().max(80).optional(),
    destination: z.string().trim().max(120).optional(),
    packedOn: isoDate.optional(),
    cartons: z.array(cartonLine).min(1).max(60),
    note: z.string().trim().max(500).optional(),
  }),
  preconditions: async (ctx, input) => {
    if ((input.packedOn ?? "") > (await todayFor(ctx.tx))) throw new ValidationError("E_VALIDATION: a packing list cannot be dated in the future");
    const lot = await ctx.tx.pieceworkLot.findUnique({ where: { id: input.lotId } });
    if (!lot || lot.cancelledAt) throw new ValidationError("E_VALIDATION: lot not found in this tenant");
    const problem = cartonProblem(input.cartons);
    if (problem) throw new ValidationError(`E_VALIDATION: ${problem}`);
    const made = (await producedByLot(ctx.tx, [lot.id])).get(lot.id)?.ready ?? 0;
    const free = made - (await packedPieces(ctx.tx, lot.id));
    const pieces = packingTotals(input.cartons).pieces;
    if (pieces > free) throw new ValidationError(`E_VALIDATION: ${lot.number} has ${free} ready pieces not yet on a packing list; these cartons hold ${pieces}`);
  },
  handler: async (ctx, input) => {
    const { sequenceNumber } = await allocateSequence(ctx.tx, ctx.actor.tenantId, SERIES, "all");
    const lines = [...input.cartons].sort((a, b) => a.from - b.from);
    const row = await ctx.tx.pieceworkPackingList.create({
      data: {
        tenantId: ctx.actor.tenantId, number: packingListNumber(sequenceNumber), sequenceNo: sequenceNumber, lotId: input.lotId, buyer: input.buyer,
        reference: input.reference ?? null, destination: input.destination ?? null, packedOn: asDate(input.packedOn ?? (await todayFor(ctx.tx))),
        cartons: lines, note: input.note ?? null, createdById: ctx.actor.userId,
      },
    });
    return { result: { id: row.id, number: row.number, pieces: packingTotals(lines).pieces }, events: [{ name: "verity.piecework.packing_list_created", entityId: row.id }] };
  },
};

export const cancelPackingList: CommandDefinition<{ packingListId: string; reason: string }, { id: string }> = {
  key: "verity.piecework.cancel_packing_list",
  entity: ENTITY_PIECEWORK_PACKING_LIST,
  verb: "ActionExecute",
  impact: "destructive",
  input: z.object({ packingListId: uuid, reason: z.string().trim().min(3).max(300) }),
  preconditions: async (ctx, input) => {
    const o = await ctx.tx.pieceworkPackingList.findUnique({ where: { id: input.packingListId } });
    if (!o) throw new ValidationError("E_VALIDATION: packing list not found in this tenant");
    if (o.cancelledAt) throw new ValidationError("E_VALIDATION: that packing list is already cancelled");
  },
  handler: async (ctx, input) => {
    await ctx.tx.pieceworkPackingList.update({ where: { id: input.packingListId }, data: { cancelledAt: new Date(), cancelReason: input.reason } });
    return { result: { id: input.packingListId }, events: [{ name: "verity.piecework.packing_list_cancelled", entityId: input.packingListId }] };
  },
};

export type PackingListSummary = {
  id: string; number: string; buyer: string; reference: string | null; destination: string | null; packedOn: string; cancelled: boolean; cancelReason: string | null;
  totals: PackingTotals;
};
export type PackingListDetail = PackingListSummary & {
  lot: { id: string; number: string; name: string; design: string }; lines: Array<CartonLine & { cartons: number; perCarton: number }>; note: string | null; by: string;
};

const summaryOf = (r: { id: string; number: string; buyer: string; reference: string | null; destination: string | null; packedOn: Date; cancelledAt: Date | null; cancelReason: string | null; cartons: unknown }): PackingListSummary => ({
  id: r.id, number: r.number, buyer: r.buyer, reference: r.reference, destination: r.destination, packedOn: isoOf(r.packedOn), cancelled: r.cancelledAt !== null,
  cancelReason: r.cancelReason, totals: packingTotals(r.cartons as CartonLine[]),
});

/** A lot's packing lists, newest first, and the ready pieces still free to pack. */
export const lotPackingLists: QueryDefinition<{ lotId: string }, { lists: PackingListSummary[]; readyToPack: number }> = {
  key: "verity.piecework.lot_packing_lists",
  entity: ENTITY_PIECEWORK_PACKING_LIST,
  input: z.object({ lotId: uuid }),
  handler: async (ctx, input) => {
    const rows = await ctx.tx.pieceworkPackingList.findMany({ where: { lotId: input.lotId }, orderBy: { sequenceNo: "desc" } });
    const made = (await producedByLot(ctx.tx, [input.lotId])).get(input.lotId)?.ready ?? 0;
    const lists = rows.map(summaryOf);
    return { lists, readyToPack: Math.max(0, made - lists.filter((l) => !l.cancelled).reduce((s, l) => s + l.totals.pieces, 0)) };
  },
};

export const packingListDetail: QueryDefinition<{ packingListId: string }, PackingListDetail | null> = {
  key: "verity.piecework.packing_list_detail",
  entity: ENTITY_PIECEWORK_PACKING_LIST,
  input: z.object({ packingListId: uuid }),
  handler: async (ctx, input) => {
    const r = await ctx.tx.pieceworkPackingList.findUnique({ where: { id: input.packingListId }, include: { lot: true } });
    if (!r) return null;
    const who = await ctx.tx.tenantMembership.findFirst({ where: { userId: r.createdById }, select: { user: { select: { party: { select: { displayName: true } } } } } });
    return {
      ...summaryOf(r),
      lot: { id: r.lot.id, number: r.lot.number, name: r.lot.name ?? r.lot.design, design: r.lot.design },
      lines: (r.cartons as CartonLine[]).map((l) => ({ ...l, cartons: l.to - l.from + 1, perCarton: l.sizes.reduce((s, x) => s + x.qty, 0) })),
      note: r.note,
      by: who?.user.party.displayName ?? "Someone",
    };
  },
};

export function registerPacking(): void {
  registerCommand(createPackingList);
  registerCommand(cancelPackingList);
  registerQuery(lotPackingLists);
  registerQuery(packingListDetail);
}
