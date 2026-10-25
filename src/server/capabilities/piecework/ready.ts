import { z } from "zod";
import { registerCommand, ValidationError, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { activeStages, asDate, isoOf, loadBundles, lotCovers, todayFor, type Tx } from "./shared";

/**
 * Ready garment inventory (the end of the release, FR-019). What production makes ready is DERIVED from the bundles (the good pieces the last
 * stage took back) and never stored. Everything else is an append-only ledger:
 *   opening     stock that existed before Verity, named by a label (no lot)
 *   out         stock that left: sold, dispatched, sample, damaged
 *   adjust_in / adjust_out   a count correction, with the reason
 * A line's balance is what was made plus what came in, less what went out. Nothing can leave that is not in stock, and a mistake is a reversal.
 */

export const ENTITY_PIECEWORK_READY_MOVE = "verity.piecework.ready_move";
const LOT_ENTITY = "verity.piecework.lot";

export const READY_KINDS = ["opening", "out", "adjust_in", "adjust_out"] as const;
export type ReadyKind = (typeof READY_KINDS)[number];
/** Offered as suggestions on screen; the reason is the factory's own words. */
export const READY_OUT_REASONS = ["Sold", "Dispatched", "Sample", "Damaged", "Other"] as const;

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

const signOf = (kind: string) => (kind === "opening" || kind === "adjust_in" ? 1 : -1);
const labelKey = (label: string) => label.trim().toLowerCase();

type MoveRow = { kind: string; pieces: number; reversesId: string | null; lotId: string | null; label: string | null };
/** What a ledger row adds to stock (a reversal takes it back out). */
const net = (m: MoveRow) => signOf(m.kind) * m.pieces * (m.reversesId ? -1 : 1);

/** Good pieces production has made ready, per lot (all lots, closed ones too: their stock is still stock). */
async function producedByLot(tx: Tx, lotIds: string[]): Promise<Map<string, { ready: number; since: string | null }>> {
  if (lotIds.length === 0) return new Map();
  const stages = await activeStages(tx);
  const bundles = (await loadBundles(tx, stages, { lotIds })).filter((b) => !b.cancelledAt);
  const out = new Map<string, { ready: number; since: string | null }>();
  for (const b of bundles) {
    const cur = out.get(b.lotId) ?? { ready: 0, since: null };
    cur.ready += b.position.ready;
    const d = b.position.stages.at(-1)?.lastReceiveDate ?? null;
    if (d && b.position.ready > 0 && (cur.since === null || d > cur.since)) cur.since = d;
    out.set(b.lotId, cur);
  }
  return out;
}

/** The balance of one line: a lot's (made plus adjustments less what went out) or an opening label's. */
async function balanceOf(tx: Tx, line: { lotId?: string; label?: string }): Promise<number> {
  const rows = await tx.pieceworkReadyMove.findMany({ where: line.lotId ? { lotId: line.lotId } : { lotId: null } });
  const mine = rows.filter((r) => (line.lotId ? true : labelKey(r.label ?? "") === labelKey(line.label ?? "")));
  const moved = mine.reduce((s, r) => s + net(r), 0);
  return (line.lotId ? (await producedByLot(tx, [line.lotId])).get(line.lotId)?.ready ?? 0 : 0) + moved;
}

export const recordReadyMove: CommandDefinition<
  { kind: ReadyKind; lotId?: string; label?: string; pieces: number; reason?: string; party?: string; reference?: string; movedOn?: string; note?: string },
  { id: string; balance: number }
> = {
  key: "verity.piecework.record_ready_move",
  entity: ENTITY_PIECEWORK_READY_MOVE,
  verb: "Create",
  input: z.object({
    kind: z.enum(READY_KINDS),
    /** A lot's stock, or an opening line named by `label`. */
    lotId: uuid.optional(),
    label: z.string().trim().min(1).max(120).optional(),
    pieces: z.number().int().min(1).max(1_000_000),
    reason: z.string().trim().max(80).optional(),
    party: z.string().trim().max(120).optional(),
    reference: z.string().trim().max(60).optional(),
    movedOn: isoDate.optional(),
    note: z.string().trim().max(300).optional(),
  }),
  preconditions: async (ctx, input) => {
    if ((input.movedOn ?? "") > (await todayFor(ctx.tx))) throw new ValidationError("E_VALIDATION: a stock movement cannot be dated in the future");
    if (input.kind === "opening") {
      if (input.lotId || !input.label) throw new ValidationError("E_VALIDATION: opening stock is named (a design and what it is); it belongs to no lot");
      return;
    }
    if (Boolean(input.lotId) === Boolean(input.label)) throw new ValidationError("E_VALIDATION: say which stock: a lot, or an opening line, not both");
    if (input.lotId) {
      const lot = await ctx.tx.pieceworkLot.findUnique({ where: { id: input.lotId } });
      if (!lot || lot.cancelledAt) throw new ValidationError("E_VALIDATION: lot not found in this tenant");
    } else {
      const known = (await ctx.tx.pieceworkReadyMove.findMany({ where: { lotId: null }, select: { label: true } })).some((r) => labelKey(r.label ?? "") === labelKey(input.label!));
      if (!known) throw new ValidationError(`E_VALIDATION: there is no opening stock called ${input.label}; enter it as opening stock first`);
    }
    if ((input.kind === "adjust_in" || input.kind === "adjust_out") && (input.reason ?? "").length < 3) {
      throw new ValidationError("E_VALIDATION: a count correction needs a reason of a few words");
    }
    if (input.kind === "out" || input.kind === "adjust_out") {
      const have = await balanceOf(ctx.tx, { lotId: input.lotId, label: input.label });
      if (input.pieces > have) throw new ValidationError(`E_VALIDATION: only ${have} pieces are in stock; ${input.pieces} cannot go out`);
    }
  },
  handler: async (ctx, input) => {
    const row = await ctx.tx.pieceworkReadyMove.create({
      data: {
        tenantId: ctx.actor.tenantId, lotId: input.lotId ?? null, label: input.lotId ? null : input.label ?? null, kind: input.kind, pieces: input.pieces,
        reason: input.reason ?? null, party: input.party ?? null, reference: input.reference ?? null, note: input.note ?? null,
        movedOn: asDate(input.movedOn ?? (await todayFor(ctx.tx))), enteredById: ctx.actor.userId,
      },
    });
    const balance = await balanceOf(ctx.tx, { lotId: input.lotId, label: input.label });
    return { result: { id: row.id, balance }, events: [{ name: "verity.piecework.ready_moved", entityId: row.id }] };
  },
};

export const reverseReadyMove: CommandDefinition<{ moveId: string; reason: string }, { id: string }> = {
  key: "verity.piecework.reverse_ready_move",
  entity: ENTITY_PIECEWORK_READY_MOVE,
  verb: "ActionExecute",
  impact: "destructive",
  input: z.object({ moveId: uuid, reason: z.string().trim().min(3).max(300) }),
  preconditions: async (ctx, input) => {
    const o = await ctx.tx.pieceworkReadyMove.findUnique({ where: { id: input.moveId }, include: { reversal: true } });
    if (!o) throw new ValidationError("E_VALIDATION: stock movement not found in this tenant");
    if (o.reversesId) throw new ValidationError("E_VALIDATION: a reversal cannot itself be reversed; record it again");
    if (o.reversal) throw new ValidationError("E_VALIDATION: that movement is already reversed");
    // Taking back something that came in (opening or a count correction) must not leave a negative balance.
    if (signOf(o.kind) > 0) {
      const have = await balanceOf(ctx.tx, { lotId: o.lotId ?? undefined, label: o.label ?? undefined });
      if (have < o.pieces) throw new ValidationError(`E_VALIDATION: only ${have} of those ${o.pieces} pieces are still in stock, so this cannot be reversed`);
    }
  },
  handler: async (ctx, input) => {
    const o = await ctx.tx.pieceworkReadyMove.findUniqueOrThrow({ where: { id: input.moveId } });
    const row = await ctx.tx.pieceworkReadyMove.create({
      data: {
        tenantId: ctx.actor.tenantId, lotId: o.lotId, label: o.label, kind: o.kind, pieces: o.pieces, reason: o.reason, party: o.party, reference: o.reference,
        note: input.reason, movedOn: asDate(await todayFor(ctx.tx)), reversesId: o.id, enteredById: ctx.actor.userId,
      },
    });
    return { result: { id: row.id }, events: [{ name: "verity.piecework.ready_move_reversed", entityId: row.id }] };
  },
};

export type StockLine = {
  key: string; lotId: string | null; number: string | null; name: string; cover: string | null;
  /** Made ready by production (a lot's line only). */
  made: number; opening: number; adjusted: number; out: number; balance: number; lastMovedOn: string | null; readySince: string | null;
};
export type StockMove = {
  id: string; movedOn: string; kind: string; pieces: number; signed: number; lotNumber: string | null; label: string | null;
  reason: string | null; party: string | null; reference: string | null; note: string | null; isReversal: boolean; reversed: boolean; by: string;
};

/** Every stock line with its balance, and the latest movements. Lots with nothing made and nothing moved are left out. */
export const readyStock: QueryDefinition<Record<string, never>, { today: string; lines: StockLine[]; moves: StockMove[]; totalBalance: number }> = {
  key: "verity.piecework.ready_stock",
  entity: LOT_ENTITY,
  input: z.object({}),
  handler: async (ctx) => {
    const [lots, moves, members] = await Promise.all([
      ctx.tx.pieceworkLot.findMany({ where: { cancelledAt: null } }),
      ctx.tx.pieceworkReadyMove.findMany({ orderBy: [{ movedOn: "desc" }, { createdAt: "desc" }] }),
      ctx.tx.tenantMembership.findMany({ select: { userId: true, user: { select: { party: { select: { displayName: true } } } } } }),
    ]);
    const made = await producedByLot(ctx.tx, lots.map((l) => l.id));
    const covers = await lotCovers(ctx.tx, lots.filter((l) => (made.get(l.id)?.ready ?? 0) > 0 || moves.some((m) => m.lotId === l.id)));
    const names = new Map(members.map((m) => [m.userId, m.user.party.displayName]));
    const lotNo = new Map(lots.map((l) => [l.id, l.number]));
    const reversedIds = new Set(moves.filter((m) => m.reversesId).map((m) => m.reversesId!));

    const lines: StockLine[] = [];
    for (const l of lots) {
      const mine = moves.filter((m) => m.lotId === l.id);
      const p = made.get(l.id);
      if ((p?.ready ?? 0) === 0 && mine.length === 0) continue;
      const out = mine.filter((m) => m.kind === "out").reduce((s, m) => s + net(m) * -1, 0);
      const adjusted = mine.filter((m) => m.kind !== "out").reduce((s, m) => s + net(m), 0);
      const last = mine.map((m) => isoOf(m.movedOn)).sort().at(-1) ?? null;
      lines.push({ key: l.id, lotId: l.id, number: l.number, name: l.name ?? l.design, cover: covers.get(l.id) ?? null, made: p?.ready ?? 0, opening: 0, adjusted, out, balance: (p?.ready ?? 0) + adjusted - out, lastMovedOn: last, readySince: p?.since ?? null });
    }
    const labels = new Map<string, string>();
    // A line is named as it was first entered (the opening row), whatever letter case a later movement used.
    for (const m of [...moves].reverse()) if (!m.lotId && m.label && !labels.has(labelKey(m.label))) labels.set(labelKey(m.label), m.label);
    for (const [key, label] of labels) {
      const mine = moves.filter((m) => !m.lotId && labelKey(m.label ?? "") === key);
      const opening = mine.filter((m) => m.kind === "opening").reduce((s, m) => s + net(m), 0);
      const out = mine.filter((m) => m.kind === "out").reduce((s, m) => s + net(m) * -1, 0);
      const adjusted = mine.filter((m) => m.kind.startsWith("adjust")).reduce((s, m) => s + net(m), 0);
      lines.push({ key: `label:${key}`, lotId: null, number: null, name: label, cover: null, made: 0, opening, adjusted, out, balance: opening + adjusted - out, lastMovedOn: mine.map((m) => isoOf(m.movedOn)).sort().at(-1) ?? null, readySince: null });
    }
    lines.sort((a, b) => Number(b.balance > 0) - Number(a.balance > 0) || (b.readySince ?? b.lastMovedOn ?? "").localeCompare(a.readySince ?? a.lastMovedOn ?? ""));

    return {
      today: await todayFor(ctx.tx),
      lines,
      totalBalance: lines.reduce((s, l) => s + l.balance, 0),
      moves: moves.slice(0, 200).map((m) => ({
        id: m.id, movedOn: isoOf(m.movedOn), kind: m.kind, pieces: m.pieces, signed: net(m), lotNumber: m.lotId ? lotNo.get(m.lotId) ?? null : null, label: m.label,
        reason: m.reason, party: m.party, reference: m.reference, note: m.note, isReversal: m.reversesId !== null, reversed: reversedIds.has(m.id), by: names.get(m.enteredById) ?? "Someone",
      })),
    };
  },
};

export function registerReady(): void {
  registerCommand(recordReadyMove);
  registerCommand(reverseReadyMove);
  registerQuery(readyStock);
}
