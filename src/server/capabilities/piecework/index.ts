import { z } from "zod";
import { registerContribution } from "@/server/platform/contribution";
import { registerCommand, ValidationError, type CommandContext, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { allocateSequence } from "@/server/runtime/document-number";
import { activeStages, asDate, isoOf, todayFor, toLedger, type Tx } from "./shared";
import { dashboard, recentEntries, reportCosting, reportLotProduction, reportReadyInventory, reportWorkerPayment } from "./reports";
import {
  bundlesOf,
  computePosition,
  daysInStage,
  daysSinceMovement,
  findViolation,
  rateOn,
  signedPieces,
  workerMoney,
  type LedgerEntry,
  type LotPosition,
  type PaymentRow,
  type StageRef,
} from "./ledger";

export * from "./ledger";
export * from "./reports";

/**
 * CAPABILITY: Piece-rate lots (`verity.capability.piecework`), built for the Stylified demo from the client's
 * Garment Lot and Karigar PRD, and generic by design: any business that hands counted pieces to paid-per-piece
 * workers and takes them back (garment karigars, jewellery karigars, embroidery job-work) has this shape.
 *
 * Business lifecycle, before any command:
 *   Define stages > create lot (number, design, total pieces) > issue pieces to a worker at a stage > receive
 *   them back > the next stage can now issue what was received > the last stage's receives are READY stock.
 *   Alongside: each receive earns the worker pieces x rate; advances and payments are recorded; balance due is
 *   earned minus advanced minus paid.
 *
 * Source of truth: two append-only ledgers (entries, payments) and an append-only rate history. Pending, current
 * stage, days in stage, location, ready stock, bundles, wages and balance are DERIVED (`./ledger.ts`) and never
 * stored. A mistake is a REVERSAL row, never an edit. Money is integer paise.
 *
 * Happy path and named exceptions:
 *   issue within what the stage can take      | refused beyond what has reached the stage
 *   receive within what the worker holds      | refused beyond what the worker was given
 *   receive at the rate in force on its date  | refused when the worker has no rate for that stage
 *   payment within the balance due            | refused beyond it (record the excess as an advance)
 *   reverse an entry nothing depends on       | refused when it would strand a later stage
 *
 * Not built here, on purpose: shortage, rejection and rework recording (an open question to the client), lot split
 * or merge, costing beyond wages, Hindi, a stock-leaves-ready step (dispatch is excluded by the client).
 */

export const PIECEWORK_CAPABILITY = "verity.capability.piecework";
export const ENTITY_PIECEWORK_STAGE = "verity.piecework.stage";
export const ENTITY_PIECEWORK_LOT = "verity.piecework.lot";
export const ENTITY_PIECEWORK_WORKER = "verity.piecework.worker";
export const ENTITY_PIECEWORK_ENTRY = "verity.piecework.entry";
export const ENTITY_PIECEWORK_PAYMENT = "verity.piecework.payment";

const LOT_SERIES = "piecework.lot";
const MAX_LOT_PIECES = 1_000_000;

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
const stageKey = z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/, "use lower-case letters, digits and underscores");

/* ================================= helpers ================================= */

export const lotNumber = (seq: number) => `LOT-${String(seq).padStart(4, "0")}`;

/** Locks the lot row so two entries for one lot serialise instead of both passing the same check. */
async function lockLot(tx: Tx, lotId: string) {
  await tx.$executeRaw`SELECT 1 FROM piecework_lot WHERE id = ${lotId}::uuid FOR UPDATE`;
  return tx.pieceworkLot.findUnique({ where: { id: lotId } });
}

async function workerNames(tx: Tx, ids: string[]): Promise<Map<string, string>> {
  const rows = await tx.pieceworkWorker.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(rows.map((w) => [w.id, w.name]));
}

async function userNames(tx: Tx, ids: string[]): Promise<Map<string, string>> {
  const rows = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, party: { select: { displayName: true } } } });
  return new Map(rows.map((u) => [u.id, u.party.displayName]));
}

/* ================================== stages ================================== */

export const defineStage: CommandDefinition<{ stageKey: string; label: string }, { id: string; sequence: number }> = {
  key: "verity.piecework.define_stage",
  entity: ENTITY_PIECEWORK_STAGE,
  verb: "Create",
  input: z.object({ stageKey, label: z.string().trim().min(1).max(80) }),
  preconditions: async (ctx, input) => {
    if (await ctx.tx.pieceworkStage.findFirst({ where: { stageKey: input.stageKey } })) {
      throw new ValidationError("E_VALIDATION: a stage with that key already exists");
    }
    // A later stage would quietly un-ready every lot that had reached the old last stage.
    if (await ctx.tx.pieceworkEntry.findFirst({ select: { id: true } })) {
      throw new ValidationError("E_VALIDATION: stages cannot change once work has been recorded");
    }
  },
  handler: async (ctx, input) => {
    const last = await ctx.tx.pieceworkStage.aggregate({ _max: { sequence: true } });
    const stage = await ctx.tx.pieceworkStage.create({
      data: { tenantId: ctx.actor.tenantId, stageKey: input.stageKey, label: input.label, sequence: (last._max.sequence ?? 0) + 1 },
    });
    return { result: { id: stage.id, sequence: stage.sequence }, events: [{ name: "verity.piecework.stage_defined", entityId: stage.id }] };
  },
};

/* =================================== lots =================================== */

export const createLot: CommandDefinition<
  { design: string; totalPieces: number; bundleSize?: number; note?: string },
  { id: string; number: string }
> = {
  key: "verity.piecework.create_lot",
  entity: ENTITY_PIECEWORK_LOT,
  verb: "Create",
  input: z.object({
    design: z.string().trim().min(1).max(120),
    totalPieces: z.number().int().min(1).max(MAX_LOT_PIECES),
    bundleSize: z.number().int().min(1).max(10_000).optional(),
    note: z.string().trim().max(500).optional(),
  }),
  preconditions: async (ctx) => {
    if (!(await ctx.tx.pieceworkStage.findFirst({ where: { active: true }, select: { id: true } }))) {
      throw new ValidationError("E_VALIDATION: define the stages before creating a lot");
    }
  },
  handler: async (ctx, input) => {
    // Gapless and never reused: a cancelled lot keeps its number.
    const { sequenceNumber } = await allocateSequence(ctx.tx, ctx.actor.tenantId, LOT_SERIES, "all");
    const lot = await ctx.tx.pieceworkLot.create({
      data: {
        tenantId: ctx.actor.tenantId,
        number: lotNumber(sequenceNumber),
        sequenceNo: sequenceNumber,
        design: input.design,
        totalPieces: input.totalPieces,
        bundleSize: input.bundleSize ?? 20,
        note: input.note ?? null,
        createdById: ctx.actor.userId,
      },
    });
    return { result: { id: lot.id, number: lot.number }, events: [{ name: "verity.piecework.lot_created", entityId: lot.id }] };
  },
};

export const cancelLot: CommandDefinition<{ lotId: string; reason: string }, { id: string }> = {
  key: "verity.piecework.cancel_lot",
  entity: ENTITY_PIECEWORK_LOT,
  verb: "ActionExecute",
  impact: "destructive",
  input: z.object({ lotId: uuid, reason: z.string().trim().min(3).max(300) }),
  preconditions: async (ctx, input) => {
    const lot = await lockLot(ctx.tx, input.lotId);
    if (!lot) throw new ValidationError("E_VALIDATION: lot not found in this tenant");
    if (lot.cancelledAt) throw new ValidationError("E_VALIDATION: that lot is already cancelled");
    const stages = await activeStages(ctx.tx);
    const entries = (await ctx.tx.pieceworkEntry.findMany({ where: { lotId: lot.id } })).map(toLedger);
    const position = computePosition(lot.totalPieces, stages, entries);
    if (position.stages.some((s) => s.issued > 0)) {
      throw new ValidationError("E_VALIDATION: pieces are already out on this lot; reverse its entries first");
    }
  },
  handler: async (ctx, input) => {
    await ctx.tx.pieceworkLot.update({
      where: { id: input.lotId },
      data: { cancelledAt: new Date(), cancelReason: input.reason, version: { increment: 1 } },
    });
    return { result: { id: input.lotId }, events: [{ name: "verity.piecework.lot_cancelled", entityId: input.lotId }] };
  },
};

/* ================================== workers ================================= */

type RateInput = { stageId: string; rateMinor: number; effectiveFrom?: string };

const rateSchema = z.object({
  stageId: uuid,
  rateMinor: z.number().int().min(0).max(10_000_000),
  effectiveFrom: isoDate.optional(),
});

async function insertRate(ctx: CommandContext, workerId: string, rate: RateInput, today: string) {
  const stage = await ctx.tx.pieceworkStage.findUnique({ where: { id: rate.stageId } });
  if (!stage) throw new ValidationError("E_VALIDATION: stage not found in this tenant");
  const effectiveFrom = rate.effectiveFrom ?? today;
  const clash = await ctx.tx.pieceworkWorkerRate.findFirst({ where: { workerId, stageId: rate.stageId, effectiveFrom: asDate(effectiveFrom) } });
  if (clash) throw new ValidationError(`E_VALIDATION: a rate for ${stage.label} already starts on ${effectiveFrom}`);
  await ctx.tx.pieceworkWorkerRate.create({
    data: {
      tenantId: ctx.actor.tenantId,
      workerId,
      stageId: rate.stageId,
      rateMinor: rate.rateMinor,
      effectiveFrom: asDate(effectiveFrom),
      createdById: ctx.actor.userId,
    },
  });
}

export const defineWorker: CommandDefinition<{ name: string; mobile?: string; rates?: RateInput[] }, { id: string }> = {
  key: "verity.piecework.define_worker",
  entity: ENTITY_PIECEWORK_WORKER,
  verb: "Create",
  input: z.object({
    name: z.string().trim().min(1).max(120),
    mobile: z.string().trim().regex(/^[0-9 +()-]{6,20}$/, "enter a phone number").optional(),
    rates: z.array(rateSchema).max(20).optional(),
  }),
  preconditions: async (ctx, input) => {
    if (await ctx.tx.pieceworkWorker.findFirst({ where: { name: input.name } })) {
      throw new ValidationError("E_VALIDATION: a worker with that name already exists");
    }
    const stageIds = (input.rates ?? []).map((r) => r.stageId);
    if (new Set(stageIds).size !== stageIds.length) throw new ValidationError("E_VALIDATION: one rate per stage when adding a worker");
  },
  handler: async (ctx, input) => {
    const worker = await ctx.tx.pieceworkWorker.create({
      data: { tenantId: ctx.actor.tenantId, name: input.name, mobile: input.mobile ?? null },
    });
    const today = await todayFor(ctx.tx);
    for (const rate of input.rates ?? []) await insertRate(ctx, worker.id, rate, today);
    return { result: { id: worker.id }, events: [{ name: "verity.piecework.worker_defined", entityId: worker.id }] };
  },
};

export const setWorkerRate: CommandDefinition<{ workerId: string } & RateInput, { id: string }> = {
  key: "verity.piecework.set_worker_rate",
  entity: ENTITY_PIECEWORK_WORKER,
  verb: "Edit",
  input: rateSchema.extend({ workerId: uuid }),
  preconditions: async (ctx, input) => {
    if (!(await ctx.tx.pieceworkWorker.findUnique({ where: { id: input.workerId } }))) {
      throw new ValidationError("E_VALIDATION: worker not found in this tenant");
    }
  },
  handler: async (ctx, input) => {
    await insertRate(ctx, input.workerId, input, await todayFor(ctx.tx));
    return { result: { id: input.workerId }, events: [] };
  },
};

export const setWorkerActive: CommandDefinition<{ workerId: string; active: boolean }, { id: string }> = {
  key: "verity.piecework.set_worker_active",
  entity: ENTITY_PIECEWORK_WORKER,
  verb: "Edit",
  input: z.object({ workerId: uuid, active: z.boolean() }),
  preconditions: async (ctx, input) => {
    const worker = await ctx.tx.pieceworkWorker.findUnique({ where: { id: input.workerId } });
    if (!worker) throw new ValidationError("E_VALIDATION: worker not found in this tenant");
    if (!input.active) {
      const rows = await ctx.tx.pieceworkEntry.findMany({ where: { workerId: input.workerId }, select: { kind: true, pieces: true, reversesId: true } });
      const out = rows.reduce((sum, r) => sum + (r.kind === "issue" ? signedPieces(r) : -signedPieces(r)), 0);
      if (out > 0) throw new ValidationError(`E_VALIDATION: ${worker.name} still holds ${out} pieces; take them back first`);
    }
  },
  handler: async (ctx, input) => {
    await ctx.tx.pieceworkWorker.update({ where: { id: input.workerId }, data: { active: input.active, version: { increment: 1 } } });
    return { result: { id: input.workerId }, events: [] };
  },
};

/* ================================== entries ================================= */

export const recordEntry: CommandDefinition<
  { lotId: string; stageId: string; workerId: string; kind: "issue" | "receive"; pieces: number; entryDate?: string; note?: string },
  { id: string; bundles: number; wageMinor: number }
> = {
  key: "verity.piecework.record_entry",
  entity: ENTITY_PIECEWORK_ENTRY,
  verb: "Create",
  input: z.object({
    lotId: uuid,
    stageId: uuid,
    workerId: uuid,
    kind: z.enum(["issue", "receive"]),
    pieces: z.number().int().min(1).max(MAX_LOT_PIECES),
    entryDate: isoDate.optional(),
    note: z.string().trim().max(300).optional(),
  }),
  preconditions: async (ctx, input) => {
    const lot = await lockLot(ctx.tx, input.lotId);
    if (!lot) throw new ValidationError("E_VALIDATION: lot not found in this tenant");
    if (lot.cancelledAt) throw new ValidationError("E_VALIDATION: that lot is cancelled");
    const [stage, worker, today] = await Promise.all([
      ctx.tx.pieceworkStage.findUnique({ where: { id: input.stageId } }),
      ctx.tx.pieceworkWorker.findUnique({ where: { id: input.workerId } }),
      todayFor(ctx.tx),
    ]);
    if (!stage || !stage.active) throw new ValidationError("E_VALIDATION: stage not found in this tenant");
    if (!worker) throw new ValidationError("E_VALIDATION: worker not found in this tenant");
    if (!worker.active) throw new ValidationError(`E_VALIDATION: ${worker.name} is no longer active`);
    const date = input.entryDate ?? today;
    if (date > today) throw new ValidationError("E_VALIDATION: an entry cannot be dated in the future");
    // Back-dating is allowed (the munshi may enter yesterday's work today), but never before the lot existed.
    if (date < isoOf(lot.createdAt)) {
      throw new ValidationError("E_VALIDATION: an entry cannot be dated before the lot was created");
    }

    const stages = await activeStages(ctx.tx);
    const entries = (await ctx.tx.pieceworkEntry.findMany({ where: { lotId: lot.id } })).map(toLedger);
    const here = computePosition(lot.totalPieces, stages, entries).stages.find((s) => s.stageId === stage.id)!;

    if (input.kind === "issue") {
      if (input.pieces > here.toIssue) {
        throw new ValidationError(
          `E_VALIDATION: only ${here.toIssue} pieces can be issued at ${stage.label} right now` +
            (stages[0]?.id === stage.id ? "" : ` (${here.available} have reached it, ${here.issued} already issued)`),
        );
      }
    } else {
      const mine = here.byWorker.get(worker.id)?.pending ?? 0;
      if (input.pieces > mine) {
        throw new ValidationError(`E_VALIDATION: ${worker.name} has only ${mine} pieces pending at ${stage.label}`);
      }
      const rates = (await ctx.tx.pieceworkWorkerRate.findMany({ where: { workerId: worker.id, stageId: stage.id } })).map((r) => ({
        effectiveFrom: isoOf(r.effectiveFrom),
        rateMinor: r.rateMinor,
      }));
      if (!rateOn(rates, date)) {
        throw new ValidationError(`E_VALIDATION: set ${worker.name}'s rate for ${stage.label} first (enter 0 if the work is unpaid)`);
      }
    }
  },
  handler: async (ctx, input) => {
    const lot = await ctx.tx.pieceworkLot.findUniqueOrThrow({ where: { id: input.lotId } });
    const date = input.entryDate ?? (await todayFor(ctx.tx));
    let rateMinor: number | null = null;
    if (input.kind === "receive") {
      const rates = (await ctx.tx.pieceworkWorkerRate.findMany({ where: { workerId: input.workerId, stageId: input.stageId } })).map((r) => ({
        effectiveFrom: isoOf(r.effectiveFrom),
        rateMinor: r.rateMinor,
      }));
      rateMinor = rateOn(rates, date)!.rateMinor;
    }
    const row = await ctx.tx.pieceworkEntry.create({
      data: {
        tenantId: ctx.actor.tenantId,
        lotId: input.lotId,
        stageId: input.stageId,
        workerId: input.workerId,
        kind: input.kind,
        pieces: input.pieces,
        rateMinor,
        entryDate: asDate(date),
        note: input.note ?? null,
        enteredById: ctx.actor.userId,
      },
    });
    return {
      result: { id: row.id, bundles: bundlesOf(input.pieces, lot.bundleSize), wageMinor: rateMinor === null ? 0 : rateMinor * input.pieces },
      events: [{ name: input.kind === "issue" ? "verity.piecework.pieces_issued" : "verity.piecework.pieces_received", entityId: row.id }],
    };
  },
};

export const reverseEntry: CommandDefinition<{ entryId: string; note?: string }, { id: string }> = {
  key: "verity.piecework.reverse_entry",
  entity: ENTITY_PIECEWORK_ENTRY,
  verb: "ActionExecute",
  impact: "destructive",
  input: z.object({ entryId: uuid, note: z.string().trim().max(300).optional() }),
  preconditions: async (ctx, input) => {
    const original = await ctx.tx.pieceworkEntry.findUnique({ where: { id: input.entryId } });
    if (!original) throw new ValidationError("E_VALIDATION: entry not found in this tenant");
    if (original.reversesId) throw new ValidationError("E_VALIDATION: a reversal cannot itself be reversed; enter the work again");
    if (await ctx.tx.pieceworkEntry.findFirst({ where: { reversesId: original.id }, select: { id: true } })) {
      throw new ValidationError("E_VALIDATION: that entry is already reversed");
    }
    const lot = await lockLot(ctx.tx, original.lotId);
    if (!lot || lot.cancelledAt) throw new ValidationError("E_VALIDATION: that lot is cancelled");
  },
  handler: async (ctx, input) => {
    const original = await ctx.tx.pieceworkEntry.findUniqueOrThrow({ where: { id: input.entryId } });
    const lot = await ctx.tx.pieceworkLot.findUniqueOrThrow({ where: { id: original.lotId } });
    const row = await ctx.tx.pieceworkEntry.create({
      data: {
        tenantId: ctx.actor.tenantId,
        lotId: original.lotId,
        stageId: original.stageId,
        workerId: original.workerId,
        kind: original.kind,
        pieces: original.pieces,
        rateMinor: original.rateMinor,
        reversesId: original.id,
        entryDate: asDate(await todayFor(ctx.tx)),
        note: input.note ?? null,
        enteredById: ctx.actor.userId,
      },
    });
    // The whole lot must still make sense: reversing a receive that a later stage has issued from is refused.
    const stages = await activeStages(ctx.tx);
    const entries = (await ctx.tx.pieceworkEntry.findMany({ where: { lotId: lot.id } })).map(toLedger);
    const names = await workerNames(ctx.tx, [...new Set(entries.map((e) => e.workerId))]);
    const violation = findViolation(computePosition(lot.totalPieces, stages, entries), (id) => names.get(id) ?? "A worker");
    if (violation) throw new ValidationError(`E_VALIDATION: ${violation.message} Reverse the later entries first.`);
    return { result: { id: row.id }, events: [{ name: "verity.piecework.entry_reversed", entityId: row.id }] };
  },
};

/* ================================== payments ================================ */

const toPayment = (p: { kind: string; amountMinor: number; reversesId: string | null }): PaymentRow => ({
  kind: p.kind as PaymentRow["kind"],
  amountMinor: p.amountMinor,
  reversesId: p.reversesId,
});

async function moneyOf(tx: Tx, workerId: string) {
  const [entries, payments] = await Promise.all([
    tx.pieceworkEntry.findMany({ where: { workerId, kind: "receive" } }),
    tx.pieceworkPayment.findMany({ where: { workerId } }),
  ]);
  return workerMoney(entries.map(toLedger), payments.map(toPayment));
}

export const recordPayment: CommandDefinition<
  { workerId: string; kind: "advance" | "payment"; amountMinor: number; paidOn?: string; note?: string },
  { id: string; balanceMinor: number }
> = {
  key: "verity.piecework.record_payment",
  entity: ENTITY_PIECEWORK_PAYMENT,
  verb: "Create",
  input: z.object({
    workerId: uuid,
    kind: z.enum(["advance", "payment"]),
    amountMinor: z.number().int().min(1).max(1_000_000_000),
    paidOn: isoDate.optional(),
    note: z.string().trim().max(300).optional(),
  }),
  preconditions: async (ctx, input) => {
    const worker = await ctx.tx.pieceworkWorker.findUnique({ where: { id: input.workerId } });
    if (!worker) throw new ValidationError("E_VALIDATION: worker not found in this tenant");
    const today = await todayFor(ctx.tx);
    if ((input.paidOn ?? today) > today) throw new ValidationError("E_VALIDATION: a payment cannot be dated in the future");
    if (input.kind === "payment") {
      const { balanceMinor } = await moneyOf(ctx.tx, worker.id);
      if (input.amountMinor > Math.max(0, balanceMinor)) {
        throw new ValidationError(`E_VALIDATION: ${worker.name} is owed only ${Math.max(0, balanceMinor)} paise; record anything more as an advance`);
      }
    }
  },
  handler: async (ctx, input) => {
    const row = await ctx.tx.pieceworkPayment.create({
      data: {
        tenantId: ctx.actor.tenantId,
        workerId: input.workerId,
        kind: input.kind,
        amountMinor: input.amountMinor,
        paidOn: asDate(input.paidOn ?? (await todayFor(ctx.tx))),
        note: input.note ?? null,
        enteredById: ctx.actor.userId,
      },
    });
    const { balanceMinor } = await moneyOf(ctx.tx, input.workerId);
    return { result: { id: row.id, balanceMinor }, events: [{ name: "verity.piecework.payment_recorded", entityId: row.id }] };
  },
};

export const reversePayment: CommandDefinition<{ paymentId: string; note?: string }, { id: string }> = {
  key: "verity.piecework.reverse_payment",
  entity: ENTITY_PIECEWORK_PAYMENT,
  verb: "ActionExecute",
  impact: "destructive",
  input: z.object({ paymentId: uuid, note: z.string().trim().max(300).optional() }),
  preconditions: async (ctx, input) => {
    const original = await ctx.tx.pieceworkPayment.findUnique({ where: { id: input.paymentId } });
    if (!original) throw new ValidationError("E_VALIDATION: payment not found in this tenant");
    if (original.reversesId) throw new ValidationError("E_VALIDATION: a reversal cannot itself be reversed; record the payment again");
    if (await ctx.tx.pieceworkPayment.findFirst({ where: { reversesId: original.id }, select: { id: true } })) {
      throw new ValidationError("E_VALIDATION: that payment is already reversed");
    }
  },
  handler: async (ctx, input) => {
    const original = await ctx.tx.pieceworkPayment.findUniqueOrThrow({ where: { id: input.paymentId } });
    const row = await ctx.tx.pieceworkPayment.create({
      data: {
        tenantId: ctx.actor.tenantId,
        workerId: original.workerId,
        kind: original.kind,
        amountMinor: original.amountMinor,
        reversesId: original.id,
        paidOn: asDate(await todayFor(ctx.tx)),
        note: input.note ?? null,
        enteredById: ctx.actor.userId,
      },
    });
    return { result: { id: row.id }, events: [{ name: "verity.piecework.payment_reversed", entityId: row.id }] };
  },
};

/* ================================== queries ================================= */

export type StageRow = { id: string; stageKey: string; label: string; sequence: number };

export const listStages: QueryDefinition<Record<string, never>, StageRow[]> = {
  key: "verity.piecework.list_stages",
  entity: ENTITY_PIECEWORK_STAGE,
  input: z.object({}),
  handler: async (ctx) => (await activeStages(ctx.tx)).map((s) => ({ id: s.id, stageKey: s.stageKey, label: s.label, sequence: s.sequence })),
};

export type LotPhase = "not_started" | "in_progress" | "ready" | "cancelled";

export type LotRow = {
  id: string;
  number: string;
  design: string;
  totalPieces: number;
  phase: LotPhase;
  stageLabel: string | null;
  /** Where the pieces are: the workers holding the current stage's pending pieces, or ready stock. */
  location: string;
  daysHere: number | null;
  daysSinceMovement: number | null;
  readyPieces: number;
  readyBundles: number;
  pendingPieces: number;
  createdAt: string;
};

function phaseOf(lot: { cancelledAt: Date | null }, position: LotPosition): LotPhase {
  if (lot.cancelledAt) return "cancelled";
  if (position.ready >= position.totalPieces) return "ready";
  if (position.stages.every((s) => s.issued === 0)) return "not_started";
  return "in_progress";
}

/** The summary shared by the register and the detail, so the two can never disagree. */
function summarise(
  lot: { id: string; number: string; design: string; totalPieces: number; bundleSize: number; cancelledAt: Date | null; createdAt: Date },
  position: LotPosition,
  names: Map<string, string>,
  today: string,
): LotRow {
  const phase = phaseOf(lot, position);
  const current = position.stages.find((s) => s.stageId === position.currentStageId) ?? null;
  const holders = current ? [...current.byWorker].filter(([, w]) => w.pending > 0).map(([id]) => names.get(id) ?? "A worker") : [];
  return {
    id: lot.id,
    number: lot.number,
    design: lot.design,
    totalPieces: lot.totalPieces,
    phase,
    stageLabel: phase === "ready" ? "Ready" : phase === "cancelled" ? null : (current?.label ?? null),
    location:
      phase === "ready" ? "Ready stock"
      : phase === "cancelled" ? "Cancelled"
      : holders.length > 0 ? `With ${holders.join(", ")}`
      : phase === "not_started" ? "Not started"
      : "Waiting to be issued",
    daysHere: current && phase === "in_progress" ? daysInStage(current, today) : null,
    daysSinceMovement: phase === "in_progress" ? daysSinceMovement(position, today) : null,
    readyPieces: position.ready,
    readyBundles: bundlesOf(position.ready, lot.bundleSize),
    pendingPieces: position.stages.reduce((sum, s) => sum + s.pending, 0),
    createdAt: lot.createdAt.toISOString(),
  };
}

export const listLots: QueryDefinition<{ phase?: LotPhase }, LotRow[]> = {
  key: "verity.piecework.list_lots",
  entity: ENTITY_PIECEWORK_LOT,
  input: z.object({ phase: z.enum(["not_started", "in_progress", "ready", "cancelled"]).optional() }),
  handler: async (ctx, input) => {
    const [lots, stages, allEntries, workers, today] = await Promise.all([
      ctx.tx.pieceworkLot.findMany({ orderBy: { sequenceNo: "desc" } }),
      activeStages(ctx.tx),
      ctx.tx.pieceworkEntry.findMany(),
      ctx.tx.pieceworkWorker.findMany({ select: { id: true, name: true } }),
      todayFor(ctx.tx),
    ]);
    const names = new Map(workers.map((w) => [w.id, w.name]));
    const byLot = new Map<string, LedgerEntry[]>();
    for (const e of allEntries) byLot.set(e.lotId, [...(byLot.get(e.lotId) ?? []), toLedger(e)]);
    const rows = lots.map((lot) => summarise(lot, computePosition(lot.totalPieces, stages, byLot.get(lot.id) ?? []), names, today));
    return input.phase ? rows.filter((r) => r.phase === input.phase) : rows;
  },
};

export type LotDetail = LotRow & {
  bundleSize: number;
  note: string | null;
  cancelReason: string | null;
  stages: Array<{
    stageId: string;
    label: string;
    issued: number;
    received: number;
    pending: number;
    toIssue: number;
    days: number | null;
    workers: Array<{ workerId: string; name: string; issued: number; received: number; pending: number }>;
  }>;
  entries: Array<{
    id: string;
    entryDate: string;
    createdAt: string;
    stageLabel: string;
    workerName: string;
    kind: "issue" | "receive";
    pieces: number;
    bundles: number;
    wageMinor: number;
    isReversal: boolean;
    reversed: boolean;
    enteredBy: string;
    note: string | null;
  }>;
};

export const lotDetail: QueryDefinition<{ lotId: string }, LotDetail | null> = {
  key: "verity.piecework.lot_detail",
  entity: ENTITY_PIECEWORK_LOT,
  input: z.object({ lotId: uuid }),
  handler: async (ctx, input) => {
    const lot = await ctx.tx.pieceworkLot.findUnique({ where: { id: input.lotId } });
    if (!lot) return null;
    const [stages, rows, today] = await Promise.all([
      activeStages(ctx.tx),
      ctx.tx.pieceworkEntry.findMany({ where: { lotId: lot.id }, orderBy: { createdAt: "asc" } }),
      todayFor(ctx.tx),
    ]);
    const names = await workerNames(ctx.tx, [...new Set(rows.map((r) => r.workerId))]);
    const users = await userNames(ctx.tx, [...new Set(rows.map((r) => r.enteredById))]);
    const position = computePosition(lot.totalPieces, stages, rows.map(toLedger));
    const stageLabel = new Map(stages.map((s) => [s.id, s.label]));
    const reversedIds = new Set(rows.filter((r) => r.reversesId).map((r) => r.reversesId!));

    return {
      ...summarise(lot, position, names, today),
      bundleSize: lot.bundleSize,
      note: lot.note,
      cancelReason: lot.cancelReason,
      stages: position.stages.map((s) => ({
        stageId: s.stageId,
        label: s.label,
        issued: s.issued,
        received: s.received,
        pending: s.pending,
        toIssue: s.toIssue,
        days: daysInStage(s, today),
        workers: [...s.byWorker].map(([workerId, w]) => ({ workerId, name: names.get(workerId) ?? "A worker", ...w })),
      })),
      entries: rows.map((r) => ({
        id: r.id,
        entryDate: isoOf(r.entryDate),
        createdAt: r.createdAt.toISOString(),
        stageLabel: stageLabel.get(r.stageId) ?? "",
        workerName: names.get(r.workerId) ?? "A worker",
        kind: r.kind as "issue" | "receive",
        pieces: signedPieces(r),
        bundles: bundlesOf(r.pieces, lot.bundleSize) * (r.reversesId ? -1 : 1),
        wageMinor: r.kind === "receive" && r.rateMinor !== null ? signedPieces(r) * r.rateMinor : 0,
        isReversal: r.reversesId !== null,
        reversed: reversedIds.has(r.id),
        enteredBy: users.get(r.enteredById) ?? "Munshi",
        note: r.note,
      })),
    };
  },
};

export type WorkerRow = {
  id: string;
  name: string;
  mobile: string | null;
  active: boolean;
  /** Stages this worker has a rate for, with the rate in force today. */
  workTypes: Array<{ stageId: string; label: string; rateMinor: number }>;
  piecesHeld: number;
  wagesMinor: number;
  advanceMinor: number;
  paidMinor: number;
  balanceMinor: number;
};

export const listWorkers: QueryDefinition<{ includeInactive?: boolean }, WorkerRow[]> = {
  key: "verity.piecework.list_workers",
  entity: ENTITY_PIECEWORK_WORKER,
  input: z.object({ includeInactive: z.boolean().optional() }),
  handler: async (ctx, input) => {
    const [workers, stages, rates, entries, payments, today] = await Promise.all([
      ctx.tx.pieceworkWorker.findMany({ where: input.includeInactive ? {} : { active: true }, orderBy: { name: "asc" } }),
      activeStages(ctx.tx),
      ctx.tx.pieceworkWorkerRate.findMany(),
      ctx.tx.pieceworkEntry.findMany(),
      ctx.tx.pieceworkPayment.findMany(),
      todayFor(ctx.tx),
    ]);
    return workers.map((w) => {
      const mine = entries.filter((e) => e.workerId === w.id);
      const held = mine.reduce((sum, e) => sum + (e.kind === "issue" ? signedPieces(e) : -signedPieces(e)), 0);
      const money = workerMoney(mine.filter((e) => e.kind === "receive").map(toLedger), payments.filter((p) => p.workerId === w.id).map(toPayment));
      const workTypes = stages.flatMap((s) => {
        const r = rateOn(
          rates.filter((x) => x.workerId === w.id && x.stageId === s.id).map((x) => ({ effectiveFrom: isoOf(x.effectiveFrom), rateMinor: x.rateMinor })),
          today,
        );
        return r ? [{ stageId: s.id, label: s.label, rateMinor: r.rateMinor }] : [];
      });
      return { id: w.id, name: w.name, mobile: w.mobile, active: w.active, workTypes, piecesHeld: held, ...money };
    });
  },
};

export type WorkerLedger = {
  worker: { id: string; name: string; mobile: string | null; active: boolean };
  rates: Array<{ stageId: string; stageLabel: string; rateMinor: number; effectiveFrom: string }>;
  money: { wagesMinor: number; advanceMinor: number; paidMinor: number; balanceMinor: number };
  /** One line per entry, newest first: what was given, returned and earned. */
  work: Array<{
    id: string; entryDate: string; lotNumber: string; stageLabel: string; kind: "issue" | "receive";
    pieces: number; rateMinor: number | null; wageMinor: number; isReversal: boolean; reversed: boolean;
  }>;
  payments: Array<{ id: string; paidOn: string; kind: "advance" | "payment"; amountMinor: number; isReversal: boolean; reversed: boolean; note: string | null }>;
  piecesGiven: number;
  piecesReturned: number;
};

export const workerLedger: QueryDefinition<{ workerId: string }, WorkerLedger | null> = {
  key: "verity.piecework.worker_ledger",
  entity: ENTITY_PIECEWORK_WORKER,
  input: z.object({ workerId: uuid }),
  handler: async (ctx, input) => {
    const worker = await ctx.tx.pieceworkWorker.findUnique({ where: { id: input.workerId } });
    if (!worker) return null;
    const [stages, rates, entries, payments, lots] = await Promise.all([
      ctx.tx.pieceworkStage.findMany(),
      ctx.tx.pieceworkWorkerRate.findMany({ where: { workerId: worker.id }, orderBy: [{ effectiveFrom: "desc" }] }),
      ctx.tx.pieceworkEntry.findMany({ where: { workerId: worker.id }, orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }] }),
      ctx.tx.pieceworkPayment.findMany({ where: { workerId: worker.id }, orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }] }),
      ctx.tx.pieceworkLot.findMany({ select: { id: true, number: true } }),
    ]);
    const stageLabel = new Map(stages.map((s) => [s.id, s.label]));
    const lotNo = new Map(lots.map((l) => [l.id, l.number]));
    const reversedEntries = new Set(entries.filter((e) => e.reversesId).map((e) => e.reversesId!));
    const reversedPayments = new Set(payments.filter((p) => p.reversesId).map((p) => p.reversesId!));
    const net = (kind: string) => entries.reduce((s, e) => s + (e.kind === kind ? signedPieces(e) : 0), 0);
    return {
      worker: { id: worker.id, name: worker.name, mobile: worker.mobile, active: worker.active },
      rates: rates.map((r) => ({ stageId: r.stageId, stageLabel: stageLabel.get(r.stageId) ?? "", rateMinor: r.rateMinor, effectiveFrom: isoOf(r.effectiveFrom) })),
      money: workerMoney(entries.filter((e) => e.kind === "receive").map(toLedger), payments.map(toPayment)),
      work: entries.map((e) => ({
        id: e.id,
        entryDate: isoOf(e.entryDate),
        lotNumber: lotNo.get(e.lotId) ?? "",
        stageLabel: stageLabel.get(e.stageId) ?? "",
        kind: e.kind as "issue" | "receive",
        pieces: signedPieces(e),
        rateMinor: e.rateMinor,
        wageMinor: e.kind === "receive" && e.rateMinor !== null ? signedPieces(e) * e.rateMinor : 0,
        isReversal: e.reversesId !== null,
        reversed: reversedEntries.has(e.id),
      })),
      payments: payments.map((p) => ({
        id: p.id,
        paidOn: isoOf(p.paidOn),
        kind: p.kind as "advance" | "payment",
        amountMinor: p.reversesId ? -p.amountMinor : p.amountMinor,
        isReversal: p.reversesId !== null,
        reversed: reversedPayments.has(p.id),
        note: p.note,
      })),
      piecesGiven: net("issue"),
      piecesReturned: net("receive"),
    };
  },
};

/* ============================== registration ============================== */

/** Called by `registry.ts`'s `installCapabilities()`. Navigation is added with the screens it points at. */
export function registerPieceworkCapability(): void {
  registerContribution({
    capabilityId: PIECEWORK_CAPABILITY,
    navigation: [
      { href: "/lots/dashboard", label: "Owner dashboard", group: "Production", order: 20, icon: "overview", requiresEntity: ENTITY_PIECEWORK_LOT, shells: ["platform", "operations"] },
      { href: "/lots", label: "Lots", group: "Production", order: 21, icon: "batch", requiresEntity: ENTITY_PIECEWORK_LOT, shells: ["platform", "operations"] },
      { href: "/lots/entry", label: "Daily entry", group: "Production", order: 22, icon: "plus", requiresEntity: ENTITY_PIECEWORK_ENTRY, shells: ["platform", "operations"] },
      { href: "/karigars", label: "Karigars", group: "Production", order: 23, icon: "user", requiresEntity: ENTITY_PIECEWORK_WORKER, shells: ["platform", "operations"] },
      { href: "/lots/reports", label: "Lot reports", group: "Production", order: 24, icon: "ledger", requiresEntity: ENTITY_PIECEWORK_LOT, shells: ["platform", "operations"] },
    ],
  });
  registerCommand(defineStage);
  registerCommand(createLot);
  registerCommand(cancelLot);
  registerCommand(defineWorker);
  registerCommand(setWorkerRate);
  registerCommand(setWorkerActive);
  registerCommand(recordEntry);
  registerCommand(reverseEntry);
  registerCommand(recordPayment);
  registerCommand(reversePayment);
  registerQuery(listStages);
  registerQuery(listLots);
  registerQuery(lotDetail);
  registerQuery(listWorkers);
  registerQuery(workerLedger);
  registerQuery(recentEntries);
  registerQuery(dashboard);
  registerQuery(reportLotProduction);
  registerQuery(reportWorkerPayment);
  registerQuery(reportCosting);
  registerQuery(reportReadyInventory);
}
