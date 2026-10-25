import { z } from "zod";
import { registerCommand, ValidationError, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { allocateSequence } from "@/server/runtime/document-number";
import { asDate, isoOf, todayFor, type Tx } from "./shared";

/**
 * Fabric, from the roll to the lot. A roll is received with a number (R-0001, gapless) and a printed QR label; metres (or kilograms)
 * leave it for a lot when the lot is cut and come back if unused. Quantities are integers in HUNDREDTHS of the unit, so nothing is
 * ever a float. The roll's balance is DERIVED: what was received plus every movement. A mistake is another movement with a reason,
 * never an edit, and a roll that has moved cannot be cancelled.
 *
 *   issue    roll -> lot      refused beyond the balance
 *   return   lot -> roll      refused beyond what that lot still holds from that roll
 *   adjust   +/-              needs a reason; refused if it would take the balance below zero
 */

export const ENTITY_PIECEWORK_ROLL = "verity.piecework.roll";
export const ENTITY_PIECEWORK_ROLL_MOVE = "verity.piecework.roll_move";
export const ROLL_UNITS = ["m", "kg"] as const;
export const ROLL_MOVE_KINDS = ["issue", "return", "adjust"] as const;
const ROLL_SERIES = "piecework.roll";
const MAX_CENTI = 100_000_000;

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

export const rollNumber = (seq: number) => `R-${String(seq).padStart(4, "0")}`;

/** Locks the roll row so two movements of one roll serialise instead of both passing the same balance check. */
async function lockRoll(tx: Tx, rollId: string) {
  await tx.$executeRaw`SELECT 1 FROM piecework_roll WHERE id = ${rollId}::uuid FOR UPDATE`;
  return tx.pieceworkRoll.findUnique({ where: { id: rollId } });
}

async function balanceOf(tx: Tx, rollId: string, receivedCenti: number): Promise<number> {
  const sum = await tx.pieceworkRollMove.aggregate({ _sum: { deltaCenti: true }, where: { rollId } });
  return receivedCenti + (sum._sum.deltaCenti ?? 0);
}

/* ================================== receive ================================== */

export const receiveRolls: CommandDefinition<
  { fabricType: string; unit?: (typeof ROLL_UNITS)[number]; quantitiesCenti: number[]; supplier?: string; invoiceNumber?: string; rateMinor?: number; receivedOn?: string; note?: string; confirmDuplicate?: boolean },
  { rollIds: string[]; numbers: string[] }
> = {
  key: "verity.piecework.receive_rolls",
  entity: ENTITY_PIECEWORK_ROLL,
  verb: "Create",
  input: z.object({
    fabricType: z.string().trim().min(1).max(80),
    unit: z.enum(ROLL_UNITS).optional(),
    /** One entry per physical roll, so ten rolls from one invoice are received in one go and each gets its own number and label. */
    quantitiesCenti: z.array(z.number().int().min(1).max(MAX_CENTI)).min(1).max(100),
    supplier: z.string().trim().max(120).optional(),
    invoiceNumber: z.string().trim().max(60).optional(),
    rateMinor: z.number().int().min(0).max(100_000_000).optional(),
    receivedOn: isoDate.optional(),
    note: z.string().trim().max(300).optional(),
    /** Says the same supplier's invoice number is meant to be received again (a second delivery on one invoice). */
    confirmDuplicate: z.boolean().optional(),
  }),
  preconditions: async (ctx, input) => {
    if (input.invoiceNumber && !input.confirmDuplicate) {
      const again = await ctx.tx.pieceworkRoll.findFirst({
        where: { cancelledAt: null, invoiceNumber: { equals: input.invoiceNumber, mode: "insensitive" }, supplier: input.supplier ? { equals: input.supplier, mode: "insensitive" } : null },
        select: { number: true },
      });
      if (again) throw new ValidationError(`E_VALIDATION: invoice ${input.invoiceNumber}${input.supplier ? ` from ${input.supplier}` : ""} was already received (${again.number}); confirm to receive it again`);
    }
    if ((input.receivedOn ?? "") > (await todayFor(ctx.tx))) throw new ValidationError("E_VALIDATION: fabric cannot be received on a future date");
  },
  handler: async (ctx, input) => {
    const day = input.receivedOn ?? (await todayFor(ctx.tx));
    const rollIds: string[] = [];
    const numbers: string[] = [];
    for (const quantityCenti of input.quantitiesCenti) {
      // Gapless and never reused: a cancelled roll keeps its number.
      const { sequenceNumber } = await allocateSequence(ctx.tx, ctx.actor.tenantId, ROLL_SERIES, "all");
      const roll = await ctx.tx.pieceworkRoll.create({
        data: {
          tenantId: ctx.actor.tenantId, number: rollNumber(sequenceNumber), sequenceNo: sequenceNumber, fabricType: input.fabricType, unit: input.unit ?? "m",
          quantityCenti, supplier: input.supplier ?? null, invoiceNumber: input.invoiceNumber ?? null, rateMinor: input.rateMinor ?? null,
          receivedOn: asDate(day), note: input.note ?? null, createdById: ctx.actor.userId,
        },
      });
      rollIds.push(roll.id);
      numbers.push(roll.number);
    }
    return { result: { rollIds, numbers }, events: rollIds.map((id) => ({ name: "verity.piecework.roll_received", entityId: id })) };
  },
};

export const cancelRoll: CommandDefinition<{ rollId: string; reason: string }, { id: string }> = {
  key: "verity.piecework.cancel_roll",
  entity: ENTITY_PIECEWORK_ROLL,
  verb: "ActionExecute",
  impact: "destructive",
  input: z.object({ rollId: uuid, reason: z.string().trim().min(3).max(300) }),
  preconditions: async (ctx, input) => {
    const roll = await lockRoll(ctx.tx, input.rollId);
    if (!roll) throw new ValidationError("E_VALIDATION: roll not found in this tenant");
    if (roll.cancelledAt) throw new ValidationError("E_VALIDATION: that roll is already cancelled");
    if (await ctx.tx.pieceworkRollMove.findFirst({ where: { rollId: roll.id }, select: { id: true } })) {
      throw new ValidationError("E_VALIDATION: fabric has already moved from this roll; adjust it instead of cancelling");
    }
  },
  handler: async (ctx, input) => {
    await ctx.tx.pieceworkRoll.update({ where: { id: input.rollId }, data: { cancelledAt: new Date(), note: input.reason } });
    return { result: { id: input.rollId }, events: [{ name: "verity.piecework.roll_cancelled", entityId: input.rollId }] };
  },
};

/* ================================== movements ================================== */

type MoveInput = { rollId: string; kind: (typeof ROLL_MOVE_KINDS)[number]; quantityCenti: number; lotId?: string; reason?: string; movedOn?: string };

/** Shared by the Move command and by cutting a lot, so both apply the same checks. Locks the roll. */
export async function applyMove(tx: Tx, tenantId: string, userId: string, input: MoveInput): Promise<{ id: string; balanceCenti: number }> {
  const roll = await lockRoll(tx, input.rollId);
  if (!roll) throw new ValidationError("E_VALIDATION: roll not found in this tenant");
  if (roll.cancelledAt) throw new ValidationError(`E_VALIDATION: ${roll.number} is cancelled`);
  const unit = roll.unit;
  const fmt = (c: number) => `${(c / 100).toFixed(2)} ${unit}`;
  const balance = await balanceOf(tx, roll.id, roll.quantityCenti);
  const day = input.movedOn ?? (await todayFor(tx));
  if (day > (await todayFor(tx))) throw new ValidationError("E_VALIDATION: a movement cannot be dated in the future");
  if (day < isoOf(roll.receivedOn)) throw new ValidationError("E_VALIDATION: a movement cannot be dated before the roll was received");

  let delta: number;
  let lotId: string | null = null;
  if (input.kind === "adjust") {
    if (input.quantityCenti === 0) throw new ValidationError("E_VALIDATION: an adjustment cannot be zero");
    if ((input.reason ?? "").trim().length < 3) throw new ValidationError("E_VALIDATION: an adjustment needs a reason in a few words");
    delta = input.quantityCenti;
    if (balance + delta < 0) throw new ValidationError(`E_VALIDATION: ${roll.number} has only ${fmt(balance)}; that adjustment would take it below zero`);
  } else {
    if (input.quantityCenti <= 0) throw new ValidationError("E_VALIDATION: give a quantity above zero");
    if (!input.lotId) throw new ValidationError("E_VALIDATION: name the lot the fabric goes to or comes back from");
    const lot = await tx.pieceworkLot.findUnique({ where: { id: input.lotId } });
    if (!lot || lot.cancelledAt) throw new ValidationError("E_VALIDATION: lot not found in this tenant");
    lotId = lot.id;
    if (input.kind === "issue") {
      if (lot.status === "closed") throw new ValidationError(`E_VALIDATION: ${lot.number} is closed`);
      if (input.quantityCenti > balance) throw new ValidationError(`E_VALIDATION: ${roll.number} has only ${fmt(balance)} left; you asked for ${fmt(input.quantityCenti)}`);
      delta = -input.quantityCenti;
    } else {
      const held = await tx.pieceworkRollMove.aggregate({ _sum: { deltaCenti: true }, where: { rollId: roll.id, lotId: lot.id, kind: { in: ["issue", "return"] } } });
      const net = -(held._sum.deltaCenti ?? 0);
      if (input.quantityCenti > net) throw new ValidationError(`E_VALIDATION: ${lot.number} holds only ${fmt(Math.max(0, net))} from ${roll.number}; it cannot send back ${fmt(input.quantityCenti)}`);
      delta = input.quantityCenti;
    }
  }
  const row = await tx.pieceworkRollMove.create({
    data: { tenantId, rollId: roll.id, kind: input.kind, deltaCenti: delta, lotId, reason: input.reason?.trim() || null, movedOn: asDate(day), enteredById: userId },
  });
  return { id: row.id, balanceCenti: balance + delta };
}

export const moveFabric: CommandDefinition<MoveInput, { id: string; balanceCenti: number }> = {
  key: "verity.piecework.move_fabric",
  entity: ENTITY_PIECEWORK_ROLL_MOVE,
  verb: "Create",
  input: z.object({
    rollId: uuid,
    kind: z.enum(ROLL_MOVE_KINDS),
    /** Positive for issue and return; signed for an adjustment (negative takes fabric off the roll). */
    quantityCenti: z.number().int().min(-MAX_CENTI).max(MAX_CENTI),
    lotId: uuid.optional(),
    reason: z.string().trim().max(300).optional(),
    movedOn: isoDate.optional(),
  }),
  handler: async (ctx, input) => {
    const moved = await applyMove(ctx.tx, ctx.actor.tenantId, ctx.actor.userId, input);
    return { result: moved, events: [{ name: "verity.piecework.fabric_moved", entityId: moved.id }] };
  },
};

/**
 * A stock-take of the shelf: the rolls that were counted, each with the quantity found. Only a difference is posted, as an adjustment with
 * the reason "Stock-take", so a roll found as the ledger says leaves no row. Rolls not counted are left as they are. One transaction:
 * either every difference is posted or none is.
 */
export const countRolls: CommandDefinition<{ counts: Array<{ rollId: string; countedCenti: number }>; movedOn?: string }, { counted: number; adjusted: number; differences: Array<{ rollId: string; deltaCenti: number }> }> = {
  key: "verity.piecework.count_rolls",
  entity: ENTITY_PIECEWORK_ROLL_MOVE,
  verb: "Create",
  input: z.object({
    counts: z.array(z.object({ rollId: uuid, countedCenti: z.number().int().min(0).max(MAX_CENTI) })).min(1).max(300),
    movedOn: isoDate.optional(),
  }),
  preconditions: async (ctx, input) => {
    if (new Set(input.counts.map((c) => c.rollId)).size !== input.counts.length) throw new ValidationError("E_VALIDATION: count each roll once");
  },
  handler: async (ctx, input) => {
    const differences: Array<{ rollId: string; deltaCenti: number }> = [];
    for (const c of input.counts) {
      const roll = await lockRoll(ctx.tx, c.rollId);
      if (!roll) throw new ValidationError("E_VALIDATION: roll not found in this tenant");
      const delta = c.countedCenti - (await balanceOf(ctx.tx, roll.id, roll.quantityCenti));
      if (delta === 0) continue;
      await applyMove(ctx.tx, ctx.actor.tenantId, ctx.actor.userId, { rollId: c.rollId, kind: "adjust", quantityCenti: delta, reason: "Stock-take", movedOn: input.movedOn });
      differences.push({ rollId: c.rollId, deltaCenti: delta });
    }
    return { result: { counted: input.counts.length, adjusted: differences.length, differences }, events: differences.map((d) => ({ name: "verity.piecework.fabric_moved", entityId: d.rollId })) };
  },
};

/* ================================== queries ================================== */

export type RollRow = {
  id: string; number: string; fabricType: string; unit: string; receivedCenti: number; balanceCenti: number; usedCenti: number;
  supplier: string | null; invoiceNumber: string | null; rateMinor: number | null; receivedOn: string; cancelled: boolean; lotCount: number;
};

async function rollRows(tx: Tx, where: { id?: string } = {}): Promise<RollRow[]> {
  const rolls = await tx.pieceworkRoll.findMany({ where, orderBy: { sequenceNo: "desc" } });
  const moves = await tx.pieceworkRollMove.findMany({ where: { rollId: { in: rolls.map((r) => r.id) } }, select: { rollId: true, kind: true, deltaCenti: true, lotId: true } });
  return rolls.map((r) => {
    const mine = moves.filter((m) => m.rollId === r.id);
    const balance = r.quantityCenti + mine.reduce((s, m) => s + m.deltaCenti, 0);
    const used = -mine.filter((m) => m.kind !== "adjust").reduce((s, m) => s + m.deltaCenti, 0);
    return {
      id: r.id, number: r.number, fabricType: r.fabricType, unit: r.unit, receivedCenti: r.quantityCenti, balanceCenti: balance, usedCenti: used,
      supplier: r.supplier, invoiceNumber: r.invoiceNumber, rateMinor: r.rateMinor, receivedOn: isoOf(r.receivedOn), cancelled: r.cancelledAt !== null,
      lotCount: new Set(mine.filter((m) => m.lotId).map((m) => m.lotId)).size,
    };
  });
}

export type FabricOverview = {
  rolls: RollRow[]; inStock: Array<{ fabricType: string; unit: string; rolls: number; balanceCenti: number }>;
  /** The warning level the factory set (null: none) and the fabrics below it, including ones with nothing left. */
  lowLevelCenti: number | null; low: Array<{ fabricType: string; unit: string; balanceCenti: number }>;
};

export const listRolls: QueryDefinition<Record<string, never>, FabricOverview> = {
  key: "verity.piecework.list_rolls",
  entity: ENTITY_PIECEWORK_ROLL,
  input: z.object({}),
  handler: async (ctx) => {
    const rolls = await rollRows(ctx.tx);
    const stock = new Map<string, { fabricType: string; unit: string; rolls: number; balanceCenti: number }>();
    for (const r of rolls.filter((x) => !x.cancelled && x.balanceCenti > 0)) {
      const key = `${r.fabricType}|${r.unit}`;
      const cur = stock.get(key) ?? { fabricType: r.fabricType, unit: r.unit, rolls: 0, balanceCenti: 0 };
      cur.rolls += 1;
      cur.balanceCenti += r.balanceCenti;
      stock.set(key, cur);
    }
    const level = (await ctx.tx.pieceworkSetting.findFirst({ select: { lowFabricCenti: true } }))?.lowFabricCenti ?? null;
    const totals = new Map<string, { fabricType: string; unit: string; balanceCenti: number }>();
    for (const r of rolls.filter((x) => !x.cancelled)) {
      const key = `${r.fabricType}|${r.unit}`;
      const cur = totals.get(key) ?? { fabricType: r.fabricType, unit: r.unit, balanceCenti: 0 };
      cur.balanceCenti += r.balanceCenti;
      totals.set(key, cur);
    }
    const low = level === null ? [] : [...totals.values()].filter((t) => t.balanceCenti < level).sort((a, b) => a.balanceCenti - b.balanceCenti);
    return { rolls, inStock: [...stock.values()].sort((a, b) => b.balanceCenti - a.balanceCenti), lowLevelCenti: level, low };
  },
};

export type RollDetail = {
  roll: RollRow & { note: string | null };
  moves: Array<{ id: string; kind: string; deltaCenti: number; runningCenti: number; lotId: string | null; lotNumber: string | null; lotName: string | null; reason: string | null; movedOn: string }>;
};

export const rollDetail: QueryDefinition<{ rollId: string }, RollDetail | null> = {
  key: "verity.piecework.roll_detail",
  entity: ENTITY_PIECEWORK_ROLL,
  input: z.object({ rollId: uuid }),
  handler: async (ctx, input) => {
    const [row] = await rollRows(ctx.tx, { id: input.rollId });
    if (!row) return null;
    const raw = await ctx.tx.pieceworkRoll.findUniqueOrThrow({ where: { id: input.rollId }, select: { note: true } });
    const moves = await ctx.tx.pieceworkRollMove.findMany({ where: { rollId: row.id }, orderBy: { createdAt: "asc" } });
    const lots = new Map((await ctx.tx.pieceworkLot.findMany({ where: { id: { in: moves.flatMap((m) => (m.lotId ? [m.lotId] : [])) } }, select: { id: true, number: true, name: true, design: true } })).map((l) => [l.id, l]));
    let running = row.receivedCenti;
    return {
      roll: { ...row, note: raw.note },
      moves: moves.map((m) => {
        running += m.deltaCenti;
        const lot = m.lotId ? lots.get(m.lotId) : undefined;
        return { id: m.id, kind: m.kind, deltaCenti: m.deltaCenti, runningCenti: running, lotId: m.lotId, lotNumber: lot?.number ?? null, lotName: lot ? lot.name ?? lot.design : null, reason: m.reason, movedOn: isoOf(m.movedOn) };
      }).reverse(),
    };
  },
};

export type LotFabric = {
  rows: Array<{ rollId: string; rollNumber: string; fabricType: string; unit: string; netCenti: number; costMinor: number | null }>;
  /** Per unit, since metres and kilograms are never added together. */
  totals: Array<{ unit: string; netCenti: number }>;
  costMinor: number | null;
};

/** What a lot has taken from rolls, net of anything returned, and what that fabric cost where the roll's invoice rate is known. */
export async function fabricOfLot(tx: Tx, lotId: string): Promise<LotFabric> {
  const moves = await tx.pieceworkRollMove.findMany({ where: { lotId, kind: { in: ["issue", "return"] } }, select: { rollId: true, deltaCenti: true } });
  const rolls = new Map((await tx.pieceworkRoll.findMany({ where: { id: { in: [...new Set(moves.map((m) => m.rollId))] } } })).map((r) => [r.id, r]));
  const net = new Map<string, number>();
  for (const m of moves) net.set(m.rollId, (net.get(m.rollId) ?? 0) - m.deltaCenti);
  const rows = [...net.entries()].filter(([, c]) => c !== 0).map(([rollId, netCenti]) => {
    const r = rolls.get(rollId)!;
    return { rollId, rollNumber: r.number, fabricType: r.fabricType, unit: r.unit, netCenti, costMinor: r.rateMinor === null ? null : Math.round((netCenti * r.rateMinor) / 100) };
  }).sort((a, b) => a.rollNumber.localeCompare(b.rollNumber));
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.unit, (totals.get(r.unit) ?? 0) + r.netCenti);
  const priced = rows.filter((r) => r.costMinor !== null);
  return { rows, totals: [...totals].map(([unit, netCenti]) => ({ unit, netCenti })), costMinor: priced.length > 0 ? priced.reduce((s, r) => s + r.costMinor!, 0) : null };
}

export const lotFabric: QueryDefinition<{ lotId: string }, LotFabric> = {
  key: "verity.piecework.lot_fabric",
  entity: ENTITY_PIECEWORK_ROLL,
  input: z.object({ lotId: uuid }),
  handler: async (ctx, input) => fabricOfLot(ctx.tx, input.lotId),
};

export function registerFabric(): void {
  registerCommand(receiveRolls);
  registerCommand(cancelRoll);
  registerCommand(moveFabric);
  registerCommand(countRolls);
  registerQuery(listRolls);
  registerQuery(rollDetail);
  registerQuery(lotFabric);
}
