import { z } from "zod";
import { registerContribution } from "@/server/platform/contribution";
import { registerCommand, ValidationError, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { allocateSequence } from "@/server/runtime/document-number";
import {
  LOT_STATUSES,
  PAYMENT_KINDS,
  WAGE_BASES,
  WORKER_KINDS,
  canMoveLot,
  computeBundle,
  daysInStage,
  daysSinceMovement,
  findViolation,
  rateOn,
  sumStages,
  workerMoney,
  type BundlePosition,
  type LotStatus,
  type PaymentRow,
  type WageBasis,
} from "./ledger";
import { LEDGER_SELECT, activeStages, asDate, isoOf, isoOrNull, loadBundles, lotCovers, todayFor, toLedger, type LoadedBundle, type Tx } from "./shared";
import { dashboard, recentEntries, reportBundleLocation, reportCosting, reportLotStatus, reportProductionByProcess, reportQuality, reportReadyInventory, reportWagePayment, reportWorkInHand } from "./reports";

import { ENTITY_PIECEWORK_APPROVAL, ENTITY_PIECEWORK_SETTING, assertMayReverse, assertStageAccess, assertWorkerAccess, registerFloor } from "./floor";
import { effectiveRate, lostPieceCharge, registerSetup } from "./setup";
import { applyMove, registerFabric, ENTITY_PIECEWORK_ROLL } from "./fabric";
import { registerViews } from "./views";
import { registerCosts } from "./costs";
import { registerRebundle } from "./rebundle";
import { registerHistory } from "./history";
import { assertActiveMember, registerTeam } from "./team";

export * from "./ledger";
export * from "./reports";
export * from "./floor";
export * from "./setup";
export * from "./fabric";
export * from "./views";
export * from "./costs";
export * from "./rebundle";
export * from "./history";
export * from "./team";
export * from "./role-presets";

/**
 * CAPABILITY: Piece-rate lots (`verity.capability.piecework`), built for the Stylified shirt factory from its requirement
 * sheet (clients/stylified) and generic by design: any business that cuts a lot into counted bundles, hands them to
 * paid-per-piece workers and takes them back has this shape.
 *
 * Business lifecycle, before any command:
 *   Define stages > create a lot (draft) > activate it > cut bundles (each gets a numbered slip) > issue a bundle to a
 *   worker at a stage > the worker returns it, and the return accounts for pieces as good, rejected, rework or short >
 *   good pieces reach the next stage, rework waits in a pool to be issued again, rejected and short leave the flow but
 *   stay visible > the last stage's good pieces are READY > complete and close the lot once nothing is open.
 *   Alongside: wages follow the basis each issue was made under (issued, good or returned pieces) at the rate in force
 *   that day; advances, recoveries, deductions and payments settle them.
 *
 * Source of truth: two append-only ledgers (entries, payments) and an append-only rate history. Pending, open, stage,
 * location, ready, wages and balances are DERIVED (`./ledger.ts`) and never stored. A mistake is a REVERSAL row.
 * Money is integer paise.
 *
 * Happy path and named exceptions:
 *   issue within what the stage can take      | refused beyond what has reached the stage
 *   return within what the issue left open    | refused beyond it; the unaccounted rest stays OPEN
 *   short, rejected and rework kept apart     | never silently classified; each has its own total
 *   rework issued again from the pool         | refused beyond what was returned for rework
 *   wage at the rate in force on its date     | refused when the worker has no rate for that stage
 *   payment within the balance due            | refused beyond it (record the excess as an advance)
 *   recovery within the advance outstanding   | refused beyond it
 *   reverse an entry nothing depends on       | refused when it would strand a later stage
 *
 * Not built here yet (named, not hidden): fabric stock, lot costing by category, packing and dispatch, bundle and lot
 * split or join, Hindi, PDF and Excel export. They are the next stages in clients/stylified/requirement-sheet-review.md.
 */

export const PIECEWORK_CAPABILITY = "verity.capability.piecework";
export const ENTITY_PIECEWORK_STAGE = "verity.piecework.stage";
export const ENTITY_PIECEWORK_LOT = "verity.piecework.lot";
export const ENTITY_PIECEWORK_BUNDLE = "verity.piecework.bundle";
export const ENTITY_PIECEWORK_WORKER = "verity.piecework.worker";
export const ENTITY_PIECEWORK_ENTRY = "verity.piecework.entry";
export const ENTITY_PIECEWORK_PAYMENT = "verity.piecework.payment";

const LOT_SERIES = "piecework.lot";
const BUNDLE_SERIES = "piecework.bundle";
const MAX_PIECES = 1_000_000;

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
const stageKey = z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/, "use lower-case letters, digits and underscores");
const wageBasis = z.enum(WAGE_BASES);

export const lotNumber = (seq: number) => `LOT-${String(seq).padStart(4, "0")}`;
export const bundleNumber = (seq: number) => `B-${String(seq).padStart(4, "0")}`;

/* ================================= helpers ================================= */

/** Locks the bundle row so two entries for one bundle serialise instead of both passing the same check. */
async function lockBundle(tx: Tx, bundleId: string) {
  await tx.$executeRaw`SELECT 1 FROM piecework_bundle WHERE id = ${bundleId}::uuid FOR UPDATE`;
  return tx.pieceworkBundle.findUnique({ where: { id: bundleId }, include: { lot: true } });
}

async function workerNames(tx: Tx, ids: string[]): Promise<Map<string, string>> {
  const rows = await tx.pieceworkWorker.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(rows.map((w) => [w.id, w.name]));
}

async function userNames(tx: Tx, ids: string[]): Promise<Map<string, string>> {
  const rows = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, party: { select: { displayName: true } } } });
  return new Map(rows.map((u) => [u.id, u.party.displayName]));
}

export const ACK_METHODS = ["signature", "pin", "attested", "app"] as const;
const CHALLAN_SERIES = "piecework.challan";
export const challanNumber = (seq: number) => `CH-${String(seq).padStart(4, "0")}`;

/**
 * The number on the paper handed over with a movement. A new number is taken (gapless) unless the caller joins one already issued today
 * to the same karigar, so a stack of bundles given together is one challan.
 */
async function challanFor(tx: Tx, tenantId: string, workerId: string, join: string | undefined): Promise<string> {
  if (join) {
    const mine = await tx.pieceworkEntry.findFirst({ where: { challanNumber: join, workerId }, select: { id: true } });
    if (!mine) throw new ValidationError("E_VALIDATION: that challan was not made out to this karigar");
    return join;
  }
  const { sequenceNumber } = await allocateSequence(tx, tenantId, CHALLAN_SERIES, "all");
  return challanNumber(sequenceNumber);
}

async function bundleOf(tx: Tx, bundleId: string): Promise<LoadedBundle> {
  const stages = await activeStages(tx);
  return (await loadBundles(tx, stages, { bundleId }))[0]!;
}

/** After a change, the whole bundle must still make sense. A refusal names the stage and says what to reverse first. */
async function assertConsistent(tx: Tx, bundleId: string) {
  const loaded = await bundleOf(tx, bundleId);
  const names = await workerNames(tx, [...new Set(loaded.entries.map((e) => e.workerId))]);
  const violation = findViolation(loaded.position, (id) => names.get(id) ?? "A worker");
  if (violation) throw new ValidationError(`E_VALIDATION: ${violation.message} Reverse the later entries first.`);
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
    // A later stage would quietly un-ready every bundle that had reached the old last stage.
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
  { design: string; name?: string; plannedPieces: number; fabricType?: string; startDate?: string; dueDate?: string; note?: string },
  { id: string; number: string }
> = {
  key: "verity.piecework.create_lot",
  entity: ENTITY_PIECEWORK_LOT,
  verb: "Create",
  input: z.object({
    design: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(120).optional(),
    plannedPieces: z.number().int().min(1).max(MAX_PIECES),
    fabricType: z.string().trim().min(1).max(80).optional(),
    startDate: isoDate.optional(),
    dueDate: isoDate.optional(),
    note: z.string().trim().max(500).optional(),
  }),
  preconditions: async (ctx, input) => {
    if (input.startDate && input.dueDate && input.dueDate < input.startDate) throw new ValidationError("E_VALIDATION: the due date is before the start date");
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
        name: input.name ?? null,
        plannedPieces: input.plannedPieces,
        fabricType: input.fabricType ?? null,
        startDate: input.startDate ? asDate(input.startDate) : null,
        dueDate: input.dueDate ? asDate(input.dueDate) : null,
        note: input.note ?? null,
        createdById: ctx.actor.userId,
      },
    });
    return { result: { id: lot.id, number: lot.number }, events: [{ name: "verity.piecework.lot_created", entityId: lot.id }] };
  },
};

/** Draft > active > hold > active > completed > closed. Completing and closing need every bundle fully reconciled. */
export const setLotStatus: CommandDefinition<{ lotId: string; to: LotStatus; note?: string }, { id: string; status: LotStatus }> = {
  key: "verity.piecework.set_lot_status",
  entity: ENTITY_PIECEWORK_LOT,
  verb: "ActionExecute",
  input: z.object({ lotId: uuid, to: z.enum(LOT_STATUSES), note: z.string().trim().max(300).optional() }),
  preconditions: async (ctx, input) => {
    const lot = await ctx.tx.pieceworkLot.findUnique({ where: { id: input.lotId } });
    if (!lot) throw new ValidationError("E_VALIDATION: lot not found in this tenant");
    if (lot.cancelledAt) throw new ValidationError("E_VALIDATION: that lot is cancelled");
    const from = lot.status as LotStatus;
    if (!canMoveLot(from, input.to)) throw new ValidationError(`E_VALIDATION: a ${from} lot cannot become ${input.to}`);
    if (input.to === "active" && !(await ctx.tx.pieceworkStage.findFirst({ where: { active: true }, select: { id: true } }))) {
      throw new ValidationError("E_VALIDATION: define the stages before starting a lot");
    }
    if (input.to === "completed" || input.to === "closed") {
      const bundles = await loadBundles(ctx.tx, await activeStages(ctx.tx), { lotId: lot.id });
      const live = bundles.filter((b) => !b.cancelledAt);
      if (live.length === 0) throw new ValidationError("E_VALIDATION: cut at least one bundle before completing the lot");
      const open = live.reduce((sum, b) => sum + b.position.stages.reduce((s, p) => s + p.pending, 0), 0);
      const rework = live.reduce((sum, b) => sum + b.position.reworkOpen, 0);
      if (open > 0) throw new ValidationError(`E_VALIDATION: ${open} pieces are still out with workers; take them back first`);
      if (rework > 0) throw new ValidationError(`E_VALIDATION: ${rework} pieces are waiting for rework; redo or write them off first`);
    }
  },
  handler: async (ctx, input) => {
    await ctx.tx.pieceworkLot.update({ where: { id: input.lotId }, data: { status: input.to, version: { increment: 1 } } });
    return { result: { id: input.lotId, status: input.to }, events: [{ name: "verity.piecework.lot_status_changed", entityId: input.lotId }] };
  },
};

export const cancelLot: CommandDefinition<{ lotId: string; reason: string }, { id: string }> = {
  key: "verity.piecework.cancel_lot",
  entity: ENTITY_PIECEWORK_LOT,
  verb: "ActionExecute",
  impact: "destructive",
  input: z.object({ lotId: uuid, reason: z.string().trim().min(3).max(300) }),
  preconditions: async (ctx, input) => {
    const lot = await ctx.tx.pieceworkLot.findUnique({ where: { id: input.lotId } });
    if (!lot) throw new ValidationError("E_VALIDATION: lot not found in this tenant");
    if (lot.cancelledAt) throw new ValidationError("E_VALIDATION: that lot is already cancelled");
    if (await ctx.tx.pieceworkEntry.findFirst({ where: { lotId: lot.id }, select: { id: true } })) {
      throw new ValidationError("E_VALIDATION: work is already recorded on this lot; reverse its entries first");
    }
  },
  handler: async (ctx, input) => {
    await ctx.tx.pieceworkLot.update({ where: { id: input.lotId }, data: { cancelledAt: new Date(), cancelReason: input.reason, version: { increment: 1 } } });
    return { result: { id: input.lotId }, events: [{ name: "verity.piecework.lot_cancelled", entityId: input.lotId }] };
  },
};

/* ================================== bundles ================================= */

export const createBundle: CommandDefinition<{ lotId: string; netPieces: number; sizeNote?: string }, { id: string; number: string }> = {
  key: "verity.piecework.create_bundle",
  entity: ENTITY_PIECEWORK_BUNDLE,
  verb: "Create",
  input: z.object({ lotId: uuid, netPieces: z.number().int().min(1).max(MAX_PIECES), sizeNote: z.string().trim().max(200).optional() }),
  preconditions: async (ctx, input) => {
    const lot = await ctx.tx.pieceworkLot.findUnique({ where: { id: input.lotId } });
    if (!lot) throw new ValidationError("E_VALIDATION: lot not found in this tenant");
    if (lot.cancelledAt) throw new ValidationError("E_VALIDATION: that lot is cancelled");
    if (lot.status !== "active") throw new ValidationError(`E_VALIDATION: bundles can be cut only on an active lot; this one is ${lot.status}`);
  },
  handler: async (ctx, input) => {
    // Gapless and never reused, like the lot number: this is the number printed on the slip.
    const { sequenceNumber } = await allocateSequence(ctx.tx, ctx.actor.tenantId, BUNDLE_SERIES, "all");
    const bundle = await ctx.tx.pieceworkBundle.create({
      data: {
        tenantId: ctx.actor.tenantId,
        lotId: input.lotId,
        number: bundleNumber(sequenceNumber),
        sequenceNo: sequenceNumber,
        netPieces: input.netPieces,
        sizeNote: input.sizeNote ?? null,
        createdById: ctx.actor.userId,
      },
    });
    return { result: { id: bundle.id, number: bundle.number }, events: [{ name: "verity.piecework.bundle_created", entityId: bundle.id }] };
  },
};

/**
 * Cutting a lot, in one step: the fabric it took from the rolls and the bundles it was cut into, each with a numbered slip and a QR.
 * A draft lot is started by its first cut (stages must exist). `groups` says "12 bundles of 25 pieces, size M" without twelve calls.
 */
export const cutLot: CommandDefinition<
  { lotId: string; groups: Array<{ copies: number; netPieces: number; sizeNote?: string }>; fabric?: Array<{ rollId: string; quantityCenti: number }> },
  { bundleIds: string[]; numbers: string[]; pieces: number }
> = {
  key: "verity.piecework.cut_lot",
  entity: ENTITY_PIECEWORK_BUNDLE,
  verb: "Create",
  input: z.object({
    lotId: uuid,
    groups: z.array(z.object({
      copies: z.number().int().min(1).max(200),
      netPieces: z.number().int().min(1).max(MAX_PIECES),
      sizeNote: z.string().trim().max(200).optional(),
    })).min(1).max(30),
    fabric: z.array(z.object({ rollId: uuid, quantityCenti: z.number().int().min(1).max(100_000_000) })).max(60).optional(),
  }),
  preconditions: async (ctx, input) => {
    const lot = await ctx.tx.pieceworkLot.findUnique({ where: { id: input.lotId } });
    if (!lot) throw new ValidationError("E_VALIDATION: lot not found in this tenant");
    if (lot.cancelledAt) throw new ValidationError("E_VALIDATION: that lot is cancelled");
    if (lot.status !== "active" && lot.status !== "draft") throw new ValidationError(`E_VALIDATION: bundles can be cut only on a draft or active lot; this one is ${lot.status}`);
    if (lot.status === "draft" && !(await ctx.tx.pieceworkStage.findFirst({ where: { active: true }, select: { id: true } }))) {
      throw new ValidationError("E_VALIDATION: set up the stages before cutting the first lot");
    }
    const total = input.groups.reduce((s, g) => s + g.copies * g.netPieces, 0);
    if (total > MAX_PIECES) throw new ValidationError("E_VALIDATION: that is more pieces than one cut can hold");
    const rolls = (input.fabric ?? []).map((f) => f.rollId);
    if (new Set(rolls).size !== rolls.length) throw new ValidationError("E_VALIDATION: one line per roll");
  },
  handler: async (ctx, input) => {
    const lot = await ctx.tx.pieceworkLot.findUniqueOrThrow({ where: { id: input.lotId } });
    for (const f of input.fabric ?? []) await applyMove(ctx.tx, ctx.actor.tenantId, ctx.actor.userId, { rollId: f.rollId, kind: "issue", quantityCenti: f.quantityCenti, lotId: lot.id });
    if (lot.status === "draft") await ctx.tx.pieceworkLot.update({ where: { id: lot.id }, data: { status: "active", version: { increment: 1 } } });
    const bundleIds: string[] = [];
    const numbers: string[] = [];
    let pieces = 0;
    for (const g of input.groups) {
      for (let i = 0; i < g.copies; i++) {
        // Gapless and never reused: this is the number printed on the slip.
        const { sequenceNumber } = await allocateSequence(ctx.tx, ctx.actor.tenantId, BUNDLE_SERIES, "all");
        const bundle = await ctx.tx.pieceworkBundle.create({
          data: { tenantId: ctx.actor.tenantId, lotId: lot.id, number: bundleNumber(sequenceNumber), sequenceNo: sequenceNumber, netPieces: g.netPieces, sizeNote: g.sizeNote ?? null, createdById: ctx.actor.userId },
        });
        bundleIds.push(bundle.id);
        numbers.push(bundle.number);
        pieces += g.netPieces;
      }
    }
    return { result: { bundleIds, numbers, pieces }, events: bundleIds.map((id) => ({ name: "verity.piecework.bundle_created", entityId: id })) };
  },
};

/* ================================== workers ================================= */

type RateInput = { stageId: string; rateMinor: number; wageBasis?: WageBasis; effectiveFrom?: string };

const rateSchema = z.object({
  stageId: uuid,
  rateMinor: z.number().int().min(0).max(10_000_000),
  wageBasis: wageBasis.optional(),
  effectiveFrom: isoDate.optional(),
});

async function insertRate(tx: Tx, tenantId: string, userId: string, workerId: string, rate: RateInput, today: string) {
  const stage = await tx.pieceworkStage.findUnique({ where: { id: rate.stageId } });
  if (!stage) throw new ValidationError("E_VALIDATION: stage not found in this tenant");
  const effectiveFrom = rate.effectiveFrom ?? today;
  if (await tx.pieceworkWorkerRate.findFirst({ where: { workerId, stageId: rate.stageId, effectiveFrom: asDate(effectiveFrom) } })) {
    throw new ValidationError(`E_VALIDATION: a rate for ${stage.label} already starts on ${effectiveFrom}`);
  }
  await tx.pieceworkWorkerRate.create({
    data: { tenantId, workerId, stageId: rate.stageId, rateMinor: rate.rateMinor, wageBasis: rate.wageBasis ?? "good", effectiveFrom: asDate(effectiveFrom), createdById: userId },
  });
}

export const defineWorker: CommandDefinition<
  {
    name: string; mobile?: string; kind?: (typeof WORKER_KINDS)[number]; address?: string; rates?: RateInput[];
    joinedOn?: string; idNote?: string; emergencyContact?: string; supervisorUserId?: string;
  },
  { id: string }
> = {
  key: "verity.piecework.define_worker",
  entity: ENTITY_PIECEWORK_WORKER,
  verb: "Create",
  input: z.object({
    name: z.string().trim().min(1).max(120),
    mobile: z.string().trim().regex(/^[0-9 +()-]{6,20}$/, "enter a phone number").optional(),
    kind: z.enum(WORKER_KINDS).optional(),
    address: z.string().trim().max(300).optional(),
    rates: z.array(rateSchema).max(30).optional(),
    joinedOn: isoDate.optional(),
    idNote: z.string().trim().max(300).optional(),
    emergencyContact: z.string().trim().max(300).optional(),
    supervisorUserId: uuid.optional(),
  }),
  preconditions: async (ctx, input) => {
    if (await ctx.tx.pieceworkWorker.findFirst({ where: { name: input.name } })) throw new ValidationError("E_VALIDATION: a worker with that name already exists");
    const ids = (input.rates ?? []).map((r) => r.stageId);
    if (new Set(ids).size !== ids.length) throw new ValidationError("E_VALIDATION: one rate per stage when adding a worker");
    if (input.supervisorUserId) await assertActiveMember(ctx.tx, input.supervisorUserId);
  },
  handler: async (ctx, input) => {
    const worker = await ctx.tx.pieceworkWorker.create({
      data: {
        tenantId: ctx.actor.tenantId, name: input.name, mobile: input.mobile ?? null, kind: input.kind ?? "in_house", address: input.address ?? null,
        joinedOn: input.joinedOn ? asDate(input.joinedOn) : null, idNote: input.idNote ?? null, emergencyContact: input.emergencyContact ?? null, supervisorUserId: input.supervisorUserId ?? null,
      },
    });
    const today = await todayFor(ctx.tx);
    for (const rate of input.rates ?? []) await insertRate(ctx.tx, ctx.actor.tenantId, ctx.actor.userId, worker.id, rate, today);
    return { result: { id: worker.id }, events: [{ name: "verity.piecework.worker_defined", entityId: worker.id }] };
  },
};

export const setWorkerRate: CommandDefinition<{ workerId: string } & RateInput, { id: string }> = {
  key: "verity.piecework.set_worker_rate",
  entity: ENTITY_PIECEWORK_WORKER,
  verb: "Edit",
  input: rateSchema.extend({ workerId: uuid }),
  preconditions: async (ctx, input) => {
    if (!(await ctx.tx.pieceworkWorker.findUnique({ where: { id: input.workerId } }))) throw new ValidationError("E_VALIDATION: worker not found in this tenant");
  },
  handler: async (ctx, input) => {
    await insertRate(ctx.tx, ctx.actor.tenantId, ctx.actor.userId, input.workerId, input, await todayFor(ctx.tx));
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
      const rows = (await ctx.tx.pieceworkEntry.findMany({ where: { workerId: input.workerId } })).map((e) => toLedger(e));
      const out = rows.reduce((sum, e) => sum + (e.reversesId ? -1 : 1) * (e.kind === "issue" ? e.pieces : -e.pieces), 0);
      if (out > 0) throw new ValidationError(`E_VALIDATION: ${worker.name} still holds ${out} pieces; take them back first`);
    }
  },
  handler: async (ctx, input) => {
    await ctx.tx.pieceworkWorker.update({ where: { id: input.workerId }, data: { active: input.active, version: { increment: 1 } } });
    return { result: { id: input.workerId }, events: [] };
  },
};

/* ================================== entries ================================= */

/** Shared checks for any new entry: the bundle's lot is active, the date is sane, the worker is usable. */
async function checkWork(tx: Tx, bundleId: string, workerId: string, date: string | undefined) {
  const bundle = await lockBundle(tx, bundleId);
  if (!bundle) throw new ValidationError("E_VALIDATION: bundle not found in this tenant");
  if (bundle.cancelledAt || bundle.lot.cancelledAt) throw new ValidationError("E_VALIDATION: that bundle is cancelled");
  if (bundle.lot.status !== "active") throw new ValidationError(`E_VALIDATION: work can be recorded only on an active lot; ${bundle.lot.number} is ${bundle.lot.status}`);
  const worker = await tx.pieceworkWorker.findUnique({ where: { id: workerId } });
  if (!worker) throw new ValidationError("E_VALIDATION: worker not found in this tenant");
  if (!worker.active) throw new ValidationError(`E_VALIDATION: ${worker.name} is no longer active`);
  const today = await todayFor(tx);
  const day = date ?? today;
  if (day > today) throw new ValidationError("E_VALIDATION: an entry cannot be dated in the future");
  // Back-dating is allowed (the entry may be written up a day late), but never before the bundle existed.
  if (day < isoOf(bundle.createdAt)) throw new ValidationError("E_VALIDATION: an entry cannot be dated before the bundle was cut");
  return { bundle, worker, day };
}

export const recordIssue: CommandDefinition<
  { bundleId: string; stageId: string; workerId: string; pieces: number; sentPieces?: number; ackMethod?: (typeof ACK_METHODS)[number]; challanNumber?: string; isRework?: boolean; wageBasis?: WageBasis; entryDate?: string; dueDate?: string; note?: string },
  { id: string; wageMinor: number; challanNumber: string }
> = {
  key: "verity.piecework.record_issue",
  entity: ENTITY_PIECEWORK_ENTRY,
  verb: "Create",
  input: z.object({
    bundleId: uuid,
    stageId: uuid,
    workerId: uuid,
    /** What the RECEIVER counted. Their count is the truth; whatever the sender says they handed over goes in `sentPieces`. */
    pieces: z.number().int().min(1).max(MAX_PIECES),
    sentPieces: z.number().int().min(1).max(MAX_PIECES).optional(),
    ackMethod: z.enum(ACK_METHODS).optional(),
    challanNumber: z.string().trim().regex(/^CH-\d{4,}$/).optional(),
    isRework: z.boolean().optional(),
    wageBasis: wageBasis.optional(),
    entryDate: isoDate.optional(),
    dueDate: isoDate.optional(),
    note: z.string().trim().max(300).optional(),
  }),
  preconditions: async (ctx, input) => {
    const { bundle, worker, day } = await checkWork(ctx.tx, input.bundleId, input.workerId, input.entryDate);
    const stage = await ctx.tx.pieceworkStage.findUnique({ where: { id: input.stageId } });
    if (!stage || !stage.active) throw new ValidationError("E_VALIDATION: stage not found in this tenant");
    await assertStageAccess(ctx, stage.id);
    await assertWorkerAccess(ctx, input.workerId);
    if (input.dueDate && input.dueDate < day) throw new ValidationError("E_VALIDATION: the expected return date is before the issue date");
    const skipped = await ctx.tx.pieceworkLotRate.findFirst({ where: { lotId: bundle.lotId, stageId: stage.id, skipped: true }, select: { id: true } });
    if (skipped) throw new ValidationError(`E_VALIDATION: ${bundle.lot.number} does not use ${stage.label}`);
    const rate = await effectiveRate(ctx.tx, worker.id, stage.id, bundle.lotId, day);
    if (!rate) throw new ValidationError(`E_VALIDATION: no rate for ${stage.label} on ${bundle.lot.number}: set the lot's rate, the stage's default rate or ${worker.name}'s own rate first (enter 0 if the work is unpaid)`);
    if (input.sentPieces !== undefined && input.sentPieces < input.pieces) throw new ValidationError("E_VALIDATION: the receiver cannot have counted more than the sender handed over; correct the sent quantity");
    if (input.challanNumber) await challanFor(ctx.tx, ctx.actor.tenantId, worker.id, input.challanNumber);

    const loaded = await bundleOf(ctx.tx, input.bundleId);
    const here = loaded.position.stages.find((s) => s.stageId === stage.id)!;
    if (input.isRework) {
      if (input.pieces > here.reworkPool) throw new ValidationError(`E_VALIDATION: only ${here.reworkPool} pieces are waiting for rework at ${stage.label}`);
    } else if (input.pieces > here.toIssue) {
      throw new ValidationError(`E_VALIDATION: only ${here.toIssue} pieces can be issued at ${stage.label} right now (${here.intake} have reached it, ${here.issuedNormal} already issued)`);
    }
  },
  handler: async (ctx, input) => {
    const day = input.entryDate ?? (await todayFor(ctx.tx));
    const bundle = await ctx.tx.pieceworkBundle.findUniqueOrThrow({ where: { id: input.bundleId } });
    const rate = (await effectiveRate(ctx.tx, input.workerId, input.stageId, bundle.lotId, day))!;
    const basis = input.wageBasis ?? rate.wageBasis;
    // Wage on issued pieces accrues now, at today's rate; the other bases accrue on the return, at that day's rate.
    const rateMinor = basis === "issued" ? rate.rateMinor : null;
    const challan = await challanFor(ctx.tx, ctx.actor.tenantId, input.workerId, input.challanNumber);
    const row = await ctx.tx.pieceworkEntry.create({
      data: {
        tenantId: ctx.actor.tenantId, lotId: bundle.lotId, bundleId: bundle.id, stageId: input.stageId, workerId: input.workerId,
        kind: "issue", pieces: input.pieces, sentPieces: input.sentPieces ?? input.pieces, ackMethod: input.ackMethod ?? null, challanNumber: challan,
        isRework: input.isRework ?? false, wageBasis: basis, rateMinor,
        dueDate: input.dueDate ? asDate(input.dueDate) : null, entryDate: asDate(day), note: input.note ?? null, enteredById: ctx.actor.userId,
      },
    });
    return { result: { id: row.id, wageMinor: rateMinor === null ? 0 : rateMinor * input.pieces, challanNumber: challan }, events: [{ name: "verity.piecework.pieces_issued", entityId: row.id }] };
  },
};

export const recordReturn: CommandDefinition<
  { issueId: string; good: number; rejected: number; rework: number; short: number; challanNumber?: string; entryDate?: string; note?: string },
  { id: string; open: number; wageMinor: number; challanNumber: string; chargeRequestedMinor: number }
> = {
  key: "verity.piecework.record_return",
  entity: ENTITY_PIECEWORK_ENTRY,
  verb: "Create",
  input: z.object({
    issueId: uuid,
    good: z.number().int().min(0).max(MAX_PIECES),
    rejected: z.number().int().min(0).max(MAX_PIECES),
    rework: z.number().int().min(0).max(MAX_PIECES),
    short: z.number().int().min(0).max(MAX_PIECES),
    challanNumber: z.string().trim().regex(/^CH-\d{4,}$/).optional(),
    entryDate: isoDate.optional(),
    note: z.string().trim().max(300).optional(),
  }),
  preconditions: async (ctx, input) => {
    const issue = await ctx.tx.pieceworkEntry.findUnique({ where: { id: input.issueId } });
    if (!issue || issue.kind !== "issue" || issue.reversesId) throw new ValidationError("E_VALIDATION: issue not found in this tenant");
    if (await ctx.tx.pieceworkEntry.findFirst({ where: { reversesId: issue.id }, select: { id: true } })) throw new ValidationError("E_VALIDATION: that issue was reversed");
    await assertStageAccess(ctx, issue.stageId);
    const { worker, day } = await checkWork(ctx.tx, issue.bundleId, issue.workerId, input.entryDate);
    const total = input.good + input.rejected + input.rework + input.short;
    if (total < 1) throw new ValidationError("E_VALIDATION: account for at least one piece");
    if (day < isoOf(issue.entryDate)) throw new ValidationError("E_VALIDATION: a return cannot be dated before its issue");

    const loaded = await bundleOf(ctx.tx, issue.bundleId);
    const line = loaded.position.stages.flatMap((s) => s.issues).find((i) => i.issueId === issue.id)!;
    if (total > line.open) throw new ValidationError(`E_VALIDATION: ${worker.name} has only ${line.open} pieces still open on this issue; you accounted for ${total}`);
    if (issue.wageBasis !== "issued") {
      const stage = await ctx.tx.pieceworkStage.findUniqueOrThrow({ where: { id: issue.stageId } });
      if (!(await effectiveRate(ctx.tx, worker.id, issue.stageId, issue.lotId, day))) throw new ValidationError(`E_VALIDATION: no rate for ${stage.label}: set the lot's rate, the stage's default rate or ${worker.name}'s own rate first (enter 0 if the work is unpaid)`);
    }
    if (input.challanNumber) await challanFor(ctx.tx, ctx.actor.tenantId, issue.workerId, input.challanNumber);
  },
  handler: async (ctx, input) => {
    const issue = await ctx.tx.pieceworkEntry.findUniqueOrThrow({ where: { id: input.issueId } });
    const day = input.entryDate ?? (await todayFor(ctx.tx));
    const basis = issue.wageBasis as WageBasis;
    const rateMinor = basis === "issued" ? null : (await effectiveRate(ctx.tx, issue.workerId, issue.stageId, issue.lotId, day))!.rateMinor;
    const total = input.good + input.rejected + input.rework + input.short;
    const challan = await challanFor(ctx.tx, ctx.actor.tenantId, issue.workerId, input.challanNumber);
    const row = await ctx.tx.pieceworkEntry.create({
      data: {
        tenantId: ctx.actor.tenantId, lotId: issue.lotId, bundleId: issue.bundleId, stageId: issue.stageId, workerId: issue.workerId,
        kind: "receive", pieces: total, goodPieces: input.good, rejectedPieces: input.rejected, reworkPieces: input.rework, shortPieces: input.short,
        issueId: issue.id, isRework: issue.isRework, wageBasis: basis, rateMinor, challanNumber: challan, entryDate: asDate(day), note: input.note ?? null, enteredById: ctx.actor.userId,
      },
    });
    const after = await bundleOf(ctx.tx, issue.bundleId);
    const open = after.position.stages.flatMap((s) => s.issues).find((i) => i.issueId === issue.id)?.open ?? 0;
    const counted = basis === "good" ? input.good : basis === "returned" ? input.good + input.rejected + input.rework : 0;

    // A short piece costs the karigar who held it. Never silent: it is a request a manager or the owner decides (within their limits).
    let chargeRequestedMinor = 0;
    const perPiece = input.short > 0 ? await lostPieceCharge(ctx.tx, issue.lotId, issue.stageId) : null;
    if (perPiece !== null) {
      chargeRequestedMinor = perPiece * input.short;
      const [stage, bundleRow] = await Promise.all([
        ctx.tx.pieceworkStage.findUniqueOrThrow({ where: { id: issue.stageId } }),
        ctx.tx.pieceworkBundle.findUniqueOrThrow({ where: { id: issue.bundleId } }),
      ]);
      await ctx.tx.pieceworkApproval.create({
        data: {
          tenantId: ctx.actor.tenantId, kind: "deduction", requestedById: ctx.actor.userId, lotId: issue.lotId, bundleId: issue.bundleId, workerId: issue.workerId,
          entryId: row.id, amountMinor: chargeRequestedMinor,
          reason: `${input.short} piece${input.short === 1 ? "" : "s"} short at ${stage.label} on ${bundleRow.number} (${challan})`,
        },
      });
    }
    return { result: { id: row.id, open, wageMinor: rateMinor === null ? 0 : rateMinor * counted, challanNumber: challan, chargeRequestedMinor }, events: [{ name: "verity.piecework.pieces_returned", entityId: row.id }] };
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
    if (await ctx.tx.pieceworkEntry.findFirst({ where: { reversesId: original.id }, select: { id: true } })) throw new ValidationError("E_VALIDATION: that entry is already reversed");
    await assertMayReverse(ctx, original);
    const bundle = await lockBundle(ctx.tx, original.bundleId);
    if (!bundle || bundle.lot.cancelledAt) throw new ValidationError("E_VALIDATION: that lot is cancelled");
    if (bundle.lot.status === "closed") throw new ValidationError("E_VALIDATION: that lot is closed; reopen it through an approved adjustment first");
    if (original.kind === "receive" && await ctx.tx.pieceworkApproval.findFirst({ where: { entryId: original.id, kind: "deduction", status: "approved" }, select: { id: true } })) {
      throw new ValidationError("E_VALIDATION: a charge for the short pieces on this return was already applied to the karigar's account; reverse that deduction first");
    }
  },
  handler: async (ctx, input) => {
    const o = await ctx.tx.pieceworkEntry.findUniqueOrThrow({ where: { id: input.entryId } });
    if (o.kind === "receive") {
      // The return it charged is being undone, so the request to charge for it is withdrawn.
      await ctx.tx.pieceworkApproval.updateMany({
        where: { entryId: o.id, kind: "deduction", status: "pending" },
        data: { status: "declined", decidedById: ctx.actor.userId, decidedAt: new Date(), decisionNote: "The return was reversed" },
      });
    }
    const row = await ctx.tx.pieceworkEntry.create({
      data: {
        tenantId: ctx.actor.tenantId, lotId: o.lotId, bundleId: o.bundleId, stageId: o.stageId, workerId: o.workerId, kind: o.kind, pieces: o.pieces,
        goodPieces: o.goodPieces, rejectedPieces: o.rejectedPieces, reworkPieces: o.reworkPieces, shortPieces: o.shortPieces,
        issueId: o.issueId, isRework: o.isRework, wageBasis: o.wageBasis, dueDate: o.dueDate, rateMinor: o.rateMinor,
        reversesId: o.id, entryDate: asDate(await todayFor(ctx.tx)), note: input.note ?? null, enteredById: ctx.actor.userId,
      },
    });
    await assertConsistent(ctx.tx, o.bundleId);
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
  const [entries, payments] = await Promise.all([tx.pieceworkEntry.findMany({ where: { workerId } }), tx.pieceworkPayment.findMany({ where: { workerId } })]);
  return workerMoney(entries.map((e) => toLedger(e)), payments.map(toPayment));
}

export const PAYMENT_MODES = ["cash", "bank", "upi", "cheque", "other"] as const;

export const recordPayment: CommandDefinition<
  { workerId: string; kind: (typeof PAYMENT_KINDS)[number]; amountMinor: number; mode?: (typeof PAYMENT_MODES)[number]; reference?: string; paidOn?: string; note?: string },
  { id: string; balanceMinor: number; advanceOutstandingMinor: number }
> = {
  key: "verity.piecework.record_payment",
  entity: ENTITY_PIECEWORK_PAYMENT,
  verb: "Create",
  input: z.object({
    workerId: uuid,
    kind: z.enum(PAYMENT_KINDS),
    amountMinor: z.number().int().min(1).max(1_000_000_000),
    mode: z.enum(PAYMENT_MODES).optional(),
    reference: z.string().trim().max(120).optional(),
    paidOn: isoDate.optional(),
    note: z.string().trim().max(300).optional(),
  }),
  preconditions: async (ctx, input) => {
    const worker = await ctx.tx.pieceworkWorker.findUnique({ where: { id: input.workerId } });
    if (!worker) throw new ValidationError("E_VALIDATION: worker not found in this tenant");
    const today = await todayFor(ctx.tx);
    if ((input.paidOn ?? today) > today) throw new ValidationError("E_VALIDATION: an entry cannot be dated in the future");
    const money = await moneyOf(ctx.tx, worker.id);
    if (input.kind === "payment" && input.amountMinor > Math.max(0, money.balanceMinor)) {
      throw new ValidationError(`E_VALIDATION: ${worker.name} is owed only ${Math.max(0, money.balanceMinor)} paise; record anything more as an advance`);
    }
    if (input.kind === "recovery" && input.amountMinor > Math.max(0, money.advanceOutstandingMinor)) {
      throw new ValidationError(`E_VALIDATION: only ${Math.max(0, money.advanceOutstandingMinor)} paise of advance is outstanding for ${worker.name}`);
    }
    if (input.kind === "deduction" && (input.note ?? "").length < 3) throw new ValidationError("E_VALIDATION: a deduction needs a reason in the note");
  },
  handler: async (ctx, input) => {
    const row = await ctx.tx.pieceworkPayment.create({
      data: {
        tenantId: ctx.actor.tenantId, workerId: input.workerId, kind: input.kind, amountMinor: input.amountMinor,
        // Mode and reference describe money that moved; a recovery or a deduction is a book entry.
        mode: input.kind === "advance" || input.kind === "payment" ? (input.mode ?? null) : null,
        reference: input.reference ?? null, paidOn: asDate(input.paidOn ?? (await todayFor(ctx.tx))), note: input.note ?? null, enteredById: ctx.actor.userId,
      },
    });
    const money = await moneyOf(ctx.tx, input.workerId);
    return { result: { id: row.id, balanceMinor: money.balanceMinor, advanceOutstandingMinor: money.advanceOutstandingMinor }, events: [{ name: "verity.piecework.payment_recorded", entityId: row.id }] };
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
    if (original.reversesId) throw new ValidationError("E_VALIDATION: a reversal cannot itself be reversed; record it again");
    if (await ctx.tx.pieceworkPayment.findFirst({ where: { reversesId: original.id }, select: { id: true } })) throw new ValidationError("E_VALIDATION: that entry is already reversed");
  },
  handler: async (ctx, input) => {
    const o = await ctx.tx.pieceworkPayment.findUniqueOrThrow({ where: { id: input.paymentId } });
    const row = await ctx.tx.pieceworkPayment.create({
      data: {
        tenantId: ctx.actor.tenantId, workerId: o.workerId, kind: o.kind, amountMinor: o.amountMinor, mode: o.mode, reference: o.reference,
        reversesId: o.id, paidOn: asDate(await todayFor(ctx.tx)), note: input.note ?? null, enteredById: ctx.actor.userId,
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

export type Where = { stageLabel: string | null; location: string };

/** Where a set of bundles is: the earliest stage still holding pieces, and who holds them there. */
export function whereAre(bundles: LoadedBundle[], stages: Array<{ id: string; sequence: number; label: string }>, names: Map<string, string>): Where {
  const order = [...stages].sort((a, b) => a.sequence - b.sequence);
  const live = bundles.filter((b) => !b.cancelledAt);
  for (const s of order) {
    const holders = new Set<string>();
    let holding = false;
    for (const b of live) {
      const p = b.position.stages.find((x) => x.stageId === s.id);
      if (!p) continue;
      if (p.pending > 0) { holding = true; for (const [w, v] of p.byWorker) if (v.pending > 0) holders.add(names.get(w) ?? "A worker"); }
      if (p.reworkPool > 0) holding = true;
    }
    if (holding) return { stageLabel: s.label, location: holders.size > 0 ? `With ${[...holders].join(", ")}` : "Waiting for rework" };
  }
  for (const s of order) {
    if (live.some((b) => (b.position.stages.find((x) => x.stageId === s.id)?.toIssue ?? 0) > 0 && (b.position.stages.find((x) => x.stageId === s.id)?.intake ?? 0) > 0)) {
      return { stageLabel: s.label, location: "Waiting to be issued" };
    }
  }
  return live.length === 0 ? { stageLabel: null, location: "No bundles yet" } : { stageLabel: "Ready", location: "Ready stock" };
}

export type LotRow = {
  id: string; number: string; name: string | null; design: string; status: LotStatus | "cancelled"; fabricType: string | null;
  plannedPieces: number; bundles: number; bundledPieces: number; readyPieces: number; rejectedPieces: number; shortPieces: number; reworkPieces: number; pendingPieces: number;
  stageLabel: string | null; location: string; dueDate: string | null; overdue: boolean; daysSinceMovement: number | null; createdAt: string;
  /** A link to the lot's picture, filled by the queries that show one (list and detail); null otherwise. */
  cover: string | null;
};

export function summariseLot(
  lot: { id: string; number: string; name: string | null; design: string; status: string; fabricType: string | null; plannedPieces: number; dueDate: Date | null; cancelledAt: Date | null; createdAt: Date },
  bundles: LoadedBundle[], stages: Array<{ id: string; sequence: number; label: string }>, names: Map<string, string>, today: string,
): LotRow {
  const live = bundles.filter((b) => !b.cancelledAt);
  const sum = (f: (p: BundlePosition) => number) => live.reduce((s, b) => s + f(b.position), 0);
  const last = live.map((b) => b.position.lastMovementDate).filter((d): d is string => d !== null).sort().at(-1) ?? null;
  const where = whereAre(live, stages, names);
  const due = isoOrNull(lot.dueDate);
  const status = (lot.cancelledAt ? "cancelled" : lot.status) as LotRow["status"];
  return {
    id: lot.id, number: lot.number, name: lot.name, design: lot.design, status, fabricType: lot.fabricType, plannedPieces: lot.plannedPieces,
    bundles: live.length, bundledPieces: live.reduce((s, b) => s + b.netPieces, 0),
    readyPieces: sum((p) => p.ready), rejectedPieces: sum((p) => p.rejected), shortPieces: sum((p) => p.short), reworkPieces: sum((p) => p.reworkOpen),
    pendingPieces: sum((p) => p.stages.reduce((s, x) => s + x.pending, 0)),
    stageLabel: where.stageLabel, location: where.location, dueDate: due,
    overdue: due !== null && due < today && !["completed", "closed", "cancelled"].includes(status),
    daysSinceMovement: last === null ? null : daysSinceMovement({ lastMovementDate: last }, today), createdAt: lot.createdAt.toISOString(), cover: null,
  };
}

export const listLots: QueryDefinition<{ status?: LotRow["status"] }, LotRow[]> = {
  key: "verity.piecework.list_lots",
  entity: ENTITY_PIECEWORK_LOT,
  input: z.object({ status: z.enum([...LOT_STATUSES, "cancelled"]).optional() }),
  handler: async (ctx, input) => {
    const [lots, stages, today, workers] = await Promise.all([
      ctx.tx.pieceworkLot.findMany({ orderBy: { sequenceNo: "desc" } }), activeStages(ctx.tx), todayFor(ctx.tx),
      ctx.tx.pieceworkWorker.findMany({ select: { id: true, name: true } }),
    ]);
    const bundles = await loadBundles(ctx.tx, stages);
    const names = new Map(workers.map((w) => [w.id, w.name]));
    const rows = lots.map((l) => summariseLot(l, bundles.filter((b) => b.lotId === l.id), stages, names, today));
    const shown = input.status ? rows.filter((r) => r.status === input.status) : rows;
    // Pictures only for the lots in work: a year of closed lots is not signed on every visit to the list.
    const covers = await lotCovers(ctx.tx, lots.filter((l) => shown.some((r) => r.id === l.id && ["active", "hold", "draft"].includes(r.status))));
    return shown.map((r) => ({ ...r, cover: covers.get(r.id) ?? null }));
  },
};

export type BundleRow = {
  id: string; number: string; lotId: string; lotNumber: string; netPieces: number; sizeNote: string | null; stageLabel: string | null; location: string;
  readyPieces: number; rejectedPieces: number; shortPieces: number; reworkPieces: number; pendingPieces: number; daysHere: number | null; lastMovement: string | null;
  /** The business day the bundle was cut, for the slip. */
  cutOn: string;
  /** An issue of this bundle is past its expected return date and still has pieces out. */
  overdue: boolean;
  /** Cancelled, or split or joined into new bundles: its number stays, its pieces are elsewhere. */
  cancelled: boolean;
};

/**
 * One bundle standing in one stage of the factory floor. A bundle is usually spread over several stages at once (most
 * pieces finished, a few still out), so it appears once per stage that holds some of its pieces, plus once in Ready.
 */
export type Placement = {
  /** Stage id, or "ready". */
  laneKey: string;
  bundleId: string; number: string; lotNumber: string; lotName: string; netPieces: number;
  /** Pieces of this bundle in this lane: out with karigars + waiting to be issued + rework waiting; or the good pieces in Ready. */
  here: number;
  out: number; waiting: number; rework: number;
  /** Who holds the pieces out here; empty when none are out. */
  holders: string[];
  daysHere: number | null; late: boolean;
};

export function placementsOf(
  b: LoadedBundle, lotNumber: string, lotName: string, names: Map<string, string>, today: string,
): Placement[] {
  if (b.cancelledAt) return [];
  const base = { bundleId: b.id, number: b.number, lotNumber, lotName, netPieces: b.netPieces };
  const rows: Placement[] = [];
  for (const s of b.position.stages) {
    const here = s.pending + s.toIssue + s.reworkPool;
    if (here === 0) continue;
    const holders = [...s.byWorker].filter(([, v]) => v.pending > 0).map(([w]) => names.get(w) ?? "A worker");
    rows.push({
      ...base, laneKey: s.stageId, here, out: s.pending, waiting: s.toIssue, rework: s.reworkPool, holders, daysHere: daysInStage(s, today),
      late: s.issues.some((i) => i.open > 0 && i.dueDate !== null && i.dueDate < today),
    });
  }
  if (b.position.ready > 0) rows.push({ ...base, laneKey: "ready", here: b.position.ready, out: 0, waiting: 0, rework: 0, holders: [], daysHere: null, late: false });
  return rows;
}

export type LotDetail = LotRow & {
  note: string | null; cancelReason: string | null; startDate: string | null;
  stages: ReturnType<typeof sumStages>;
  bundleRows: BundleRow[];
  /** Where every bundle's pieces stand, one row per bundle per stage, for the floor board. */
  placements: Placement[];
  entries: Array<{
    id: string; entryDate: string; createdAt: string; bundleNumber: string; stageLabel: string; workerName: string; kind: "issue" | "receive"; pieces: number;
    good: number; rejected: number; rework: number; short: number; wageMinor: number; isReversal: boolean; reversed: boolean; isRework: boolean; enteredBy: string; note: string | null;
    challan: string | null; sent: number | null; ackMethod: string | null;
  }>;
};

export function bundleRow(b: LoadedBundle, lotNumber: string, stages: Array<{ id: string; sequence: number; label: string }>, names: Map<string, string>, today: string): BundleRow {
  const where = whereAre([b], stages, names);
  const current = b.position.stages.find((s) => s.stageId === b.position.currentStageId);
  return {
    id: b.id, number: b.number, lotId: b.lotId, lotNumber, netPieces: b.netPieces, sizeNote: b.sizeNote, stageLabel: where.stageLabel, location: where.location,
    readyPieces: b.position.ready, rejectedPieces: b.position.rejected, shortPieces: b.position.short, reworkPieces: b.position.reworkOpen,
    pendingPieces: b.position.stages.reduce((s, x) => s + x.pending, 0), daysHere: current ? daysInStage(current, today) : null, lastMovement: b.position.lastMovementDate,
    cutOn: isoOf(b.createdAt),
    overdue: b.position.stages.some((s) => s.issues.some((i) => i.open > 0 && i.dueDate !== null && i.dueDate < today)),
    cancelled: b.cancelledAt !== null,
  };
}

export const lotDetail: QueryDefinition<{ lotId: string }, LotDetail | null> = {
  key: "verity.piecework.lot_detail",
  entity: ENTITY_PIECEWORK_LOT,
  input: z.object({ lotId: uuid }),
  handler: async (ctx, input) => {
    const lot = await ctx.tx.pieceworkLot.findUnique({ where: { id: input.lotId } });
    if (!lot) return null;
    const [stages, today, rows, bundleList] = await Promise.all([
      activeStages(ctx.tx), todayFor(ctx.tx),
      ctx.tx.pieceworkEntry.findMany({ where: { lotId: lot.id }, orderBy: { createdAt: "asc" } }),
      ctx.tx.pieceworkBundle.findMany({ where: { lotId: lot.id } }),
    ]);
    const bundles = await loadBundles(ctx.tx, stages, { lotId: lot.id });
    const names = await workerNames(ctx.tx, [...new Set(rows.map((r) => r.workerId))]);
    const users = await userNames(ctx.tx, [...new Set(rows.map((r) => r.enteredById))]);
    const bundleNo = new Map(bundleList.map((b) => [b.id, b.number]));
    const stageLabel = new Map(stages.map((s) => [s.id, s.label]));
    const reversedIds = new Set(rows.filter((r) => r.reversesId).map((r) => r.reversesId!));
    const live = bundles.filter((b) => !b.cancelledAt);
    // The lot's own route: a stage its rate card skips is not one of its lanes.
    const skipped = new Set((await ctx.tx.pieceworkLotRate.findMany({ where: { lotId: lot.id, skipped: true }, select: { stageId: true } })).map((r) => r.stageId));
    const route = stages.filter((s) => !skipped.has(s.id));

    const cover = (await lotCovers(ctx.tx, [lot])).get(lot.id) ?? null;
    return {
      ...summariseLot(lot, bundles, stages, names, today),
      cover,
      note: lot.note, cancelReason: lot.cancelReason, startDate: isoOrNull(lot.startDate),
      stages: sumStages(live.map((b) => b.position), route),
      bundleRows: bundles.map((b) => bundleRow(b, lot.number, stages, names, today)),
      placements: bundles.flatMap((b) => placementsOf(b, lot.number, lot.name ?? lot.design, names, today)),
      entries: rows.map((r) => {
        const e = toLedger(r);
        const s = e.reversesId ? -1 : 1;
        return {
          id: r.id, entryDate: isoOf(r.entryDate), createdAt: r.createdAt.toISOString(), bundleNumber: bundleNo.get(r.bundleId) ?? "", stageLabel: stageLabel.get(r.stageId) ?? "",
          workerName: names.get(r.workerId) ?? "A worker", kind: e.kind, pieces: s * e.pieces, good: s * e.good, rejected: s * e.rejected, rework: s * e.rework, short: s * e.short,
          wageMinor: 0, isReversal: r.reversesId !== null, reversed: reversedIds.has(r.id), isRework: r.isRework, enteredBy: users.get(r.enteredById) ?? "Munshi", note: r.note,
          challan: r.challanNumber, sent: r.sentPieces, ackMethod: r.ackMethod,
        };
      }),
    };
  },
};

export type BundleDetail = BundleRow & {
  lotName: string | null; lotDesign: string; lotStatus: string;
  /** The tenant's business day, so a screen can say which issues are late without reading the server clock. */
  today: string;
  stages: Array<{
    stageId: string; label: string; intake: number; issued: number; good: number; rejected: number; rework: number; short: number; pending: number; toIssue: number; reworkPool: number; days: number | null;
    issues: Array<{ issueId: string; workerId: string; workerName: string; issued: number; good: number; rejected: number; rework: number; short: number; open: number; isRework: boolean; entryDate: string; dueDate: string | null }>;
  }>;
};

export const bundleDetail: QueryDefinition<{ bundleId: string }, BundleDetail | null> = {
  key: "verity.piecework.bundle_detail",
  entity: ENTITY_PIECEWORK_BUNDLE,
  input: z.object({ bundleId: uuid }),
  handler: async (ctx, input) => {
    const bundle = await ctx.tx.pieceworkBundle.findUnique({ where: { id: input.bundleId }, include: { lot: true } });
    if (!bundle) return null;
    const [stages, today] = await Promise.all([activeStages(ctx.tx), todayFor(ctx.tx)]);
    const [loaded] = await loadBundles(ctx.tx, stages, { bundleId: bundle.id });
    const names = await workerNames(ctx.tx, [...new Set(loaded!.entries.map((e) => e.workerId))]);
    return {
      ...bundleRow(loaded!, bundle.lot.number, stages, names, today),
      lotName: bundle.lot.name, lotDesign: bundle.lot.design, lotStatus: bundle.lot.status, today,
      stages: loaded!.position.stages.map((s) => ({
        stageId: s.stageId, label: s.label, intake: s.intake, issued: s.issuedNormal + s.issuedRework, good: s.good, rejected: s.rejected, rework: s.rework, short: s.short,
        pending: s.pending, toIssue: s.toIssue, reworkPool: s.reworkPool, days: daysInStage(s, today),
        issues: s.issues.map((i) => ({ ...i, workerName: names.get(i.workerId) ?? "A worker" })),
      })),
    };
  },
};

/** The karigar's profile fields beyond name and contact; shared by the list and the ledger. */
export type WorkerProfile = { joinedOn: string | null; idNote: string | null; emergencyContact: string | null; supervisorUserId: string | null; supervisorName: string | null };

async function supervisorNames(tx: Tx): Promise<Map<string, string>> {
  const rows = await tx.tenantMembership.findMany({ select: { userId: true, user: { select: { party: { select: { displayName: true } } } } } });
  return new Map(rows.map((m) => [m.userId, m.user.party.displayName]));
}

const profileOf = (w: { joinedOn: Date | null; idNote: string | null; emergencyContact: string | null; supervisorUserId: string | null }, names: Map<string, string>): WorkerProfile => ({
  joinedOn: isoOrNull(w.joinedOn), idNote: w.idNote, emergencyContact: w.emergencyContact,
  supervisorUserId: w.supervisorUserId, supervisorName: w.supervisorUserId ? names.get(w.supervisorUserId) ?? "Someone who has left" : null,
});

export type WorkerRow = WorkerProfile & {
  id: string; name: string; mobile: string | null; kind: string; address: string | null; active: boolean;
  workTypes: Array<{ stageId: string; label: string; rateMinor: number; wageBasis: WageBasis }>;
  piecesHeld: number; wagesMinor: number; advanceGivenMinor: number; recoveredMinor: number; deductionMinor: number; paidMinor: number; balanceMinor: number; advanceOutstandingMinor: number;
};

export const listWorkers: QueryDefinition<{ includeInactive?: boolean }, WorkerRow[]> = {
  key: "verity.piecework.list_workers",
  entity: ENTITY_PIECEWORK_WORKER,
  input: z.object({ includeInactive: z.boolean().optional() }),
  handler: async (ctx, input) => {
    const [workers, stages, rates, entries, payments, today, names] = await Promise.all([
      ctx.tx.pieceworkWorker.findMany({ where: input.includeInactive ? {} : { active: true }, orderBy: { name: "asc" } }),
      activeStages(ctx.tx), ctx.tx.pieceworkWorkerRate.findMany(), ctx.tx.pieceworkEntry.findMany({ select: LEDGER_SELECT }), ctx.tx.pieceworkPayment.findMany({ select: { workerId: true, kind: true, amountMinor: true, reversesId: true } }), todayFor(ctx.tx), supervisorNames(ctx.tx),
    ]);
    return workers.map((w) => {
      const mine = entries.filter((e) => e.workerId === w.id).map((e) => toLedger(e));
      const held = mine.reduce((sum, e) => sum + (e.reversesId ? -1 : 1) * (e.kind === "issue" ? e.pieces : -e.pieces), 0);
      const money = workerMoney(mine, payments.filter((p) => p.workerId === w.id).map(toPayment));
      const workTypes = stages.flatMap((s) => {
        const r = rateOn(rates.filter((x) => x.workerId === w.id && x.stageId === s.id).map((x) => ({ effectiveFrom: isoOf(x.effectiveFrom), rateMinor: x.rateMinor, wageBasis: x.wageBasis as WageBasis })), today);
        return r ? [{ stageId: s.id, label: s.label, rateMinor: r.rateMinor, wageBasis: r.wageBasis }] : [];
      });
      return { id: w.id, name: w.name, mobile: w.mobile, kind: w.kind, address: w.address, active: w.active, ...profileOf(w, names), workTypes, piecesHeld: held, ...money };
    });
  },
};

export type WorkerLedger = {
  worker: { id: string; name: string; mobile: string | null; kind: string; address: string | null; active: boolean } & WorkerProfile;
  rates: Array<{ stageId: string; stageLabel: string; rateMinor: number; wageBasis: WageBasis; effectiveFrom: string }>;
  money: ReturnType<typeof workerMoney>;
  /** Open issues: what this worker still holds, by bundle and stage. */
  workInHand: Array<{ issueId: string; bundleId: string; bundleNumber: string; lotNumber: string; stageLabel: string; issued: number; open: number; isRework: boolean; entryDate: string; dueDate: string | null; overdue: boolean }>;
  work: Array<{ id: string; entryDate: string; lotNumber: string; bundleNumber: string; stageLabel: string; kind: "issue" | "receive"; pieces: number; good: number; rejected: number; rework: number; short: number; wageMinor: number; isReversal: boolean; reversed: boolean }>;
  payments: Array<{ id: string; paidOn: string; kind: PaymentRow["kind"]; amountMinor: number; mode: string | null; reference: string | null; isReversal: boolean; reversed: boolean; note: string | null }>;
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
    const [allStages, stages, rates, entries, payments, lots, bundleList, today] = await Promise.all([
      ctx.tx.pieceworkStage.findMany(), activeStages(ctx.tx),
      ctx.tx.pieceworkWorkerRate.findMany({ where: { workerId: worker.id }, orderBy: [{ effectiveFrom: "desc" }] }),
      ctx.tx.pieceworkEntry.findMany({ where: { workerId: worker.id }, orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }] }),
      ctx.tx.pieceworkPayment.findMany({ where: { workerId: worker.id }, orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }] }),
      ctx.tx.pieceworkLot.findMany({ select: { id: true, number: true } }), ctx.tx.pieceworkBundle.findMany({ select: { id: true, number: true, lotId: true } }), todayFor(ctx.tx),
    ]);
    const stageLabel = new Map(allStages.map((s) => [s.id, s.label]));
    const lotNo = new Map(lots.map((l) => [l.id, l.number]));
    const bundleNo = new Map(bundleList.map((b) => [b.id, b.number]));
    const reversedEntries = new Set(entries.filter((e) => e.reversesId).map((e) => e.reversesId!));
    const reversedPayments = new Set(payments.filter((p) => p.reversesId).map((p) => p.reversesId!));
    const ledger = entries.map((e) => toLedger(e));
    const net = (kind: "issue" | "receive") => ledger.reduce((s, e) => s + (e.kind === kind ? (e.reversesId ? -1 : 1) * e.pieces : 0), 0);

    // Open issues, derived per bundle so rework and reversals are respected. Only this worker's bundles are derived.
    const bundles = await loadBundles(ctx.tx, stages, { bundleIds: [...new Set(entries.map((e) => e.bundleId))] });
    const inHand = bundles.flatMap((b) =>
      b.position.stages.flatMap((s) => s.issues.filter((i) => i.workerId === worker.id && i.open > 0).map((i) => ({
        issueId: i.issueId, bundleId: b.id, bundleNumber: b.number, lotNumber: lotNo.get(b.lotId) ?? "", stageLabel: s.label, issued: i.issued, open: i.open, isRework: i.isRework,
        entryDate: i.entryDate, dueDate: i.dueDate, overdue: i.dueDate !== null && i.dueDate < today,
      }))),
    );

    return {
      worker: { id: worker.id, name: worker.name, mobile: worker.mobile, kind: worker.kind, address: worker.address, active: worker.active, ...profileOf(worker, await supervisorNames(ctx.tx)) },
      rates: rates.map((r) => ({ stageId: r.stageId, stageLabel: stageLabel.get(r.stageId) ?? "", rateMinor: r.rateMinor, wageBasis: r.wageBasis as WageBasis, effectiveFrom: isoOf(r.effectiveFrom) })),
      money: workerMoney(ledger, payments.map(toPayment)),
      workInHand: inHand,
      work: entries.map((e, i) => {
        const l = ledger[i]!;
        const s = l.reversesId ? -1 : 1;
        return {
          id: e.id, entryDate: isoOf(e.entryDate), lotNumber: lotNo.get(e.lotId) ?? "", bundleNumber: bundleNo.get(e.bundleId) ?? "", stageLabel: stageLabel.get(e.stageId) ?? "",
          kind: l.kind, pieces: s * l.pieces, good: s * l.good, rejected: s * l.rejected, rework: s * l.rework, short: s * l.short,
          wageMinor: workerMoney([l], []).wagesMinor, isReversal: e.reversesId !== null, reversed: reversedEntries.has(e.id),
        };
      }),
      payments: payments.map((p) => ({
        id: p.id, paidOn: isoOf(p.paidOn), kind: p.kind as PaymentRow["kind"], amountMinor: p.reversesId ? -p.amountMinor : p.amountMinor, mode: p.mode, reference: p.reference,
        isReversal: p.reversesId !== null, reversed: reversedPayments.has(p.id), note: p.note,
      })),
      piecesGiven: net("issue"),
      piecesReturned: net("receive"),
    };
  },
};

/* ============================== registration ============================== */

/** Called by `registry.ts`'s `installCapabilities()`. */
export function registerPieceworkCapability(): void {
  const shells: Array<"platform" | "operations"> = ["platform", "operations"];
  registerContribution({
    capabilityId: PIECEWORK_CAPABILITY,
    navigation: [
      { href: "/shopfloor/scan", label: "Scan", group: "Production", order: 17.5, icon: "search", requiresEntity: ENTITY_PIECEWORK_ENTRY, shells },
      { href: "/shopfloor", label: "My floor", group: "Production", order: 18, icon: "batch", requiresEntity: ENTITY_PIECEWORK_ENTRY, shells },
      { href: "/shopfloor/approvals", label: "Approvals", group: "Production", order: 19, icon: "ledger", requiresEntity: ENTITY_PIECEWORK_APPROVAL, shells },
      { href: "/shopfloor/team", label: "Team", group: "Production", order: 25, icon: "user", requiresEntity: ENTITY_PIECEWORK_SETTING, shells },
      { href: "/shopfloor/cases", label: "Cases", group: "Production", order: 19.5, icon: "ledger", requiresEntity: ENTITY_PIECEWORK_ENTRY, shells },
      { href: "/fabric", label: "Fabric", group: "Production", order: 19.8, icon: "batch", requiresEntity: ENTITY_PIECEWORK_ROLL, shells },
      { href: "/lots/ready", label: "Ready garments", group: "Production", order: 23.5, icon: "overview", requiresEntity: ENTITY_PIECEWORK_LOT, shells },
      { href: "/lots/audit", label: "Change history", group: "Production", order: 27, icon: "clock", requiresEntity: ENTITY_PIECEWORK_SETTING, shells },
      { href: "/lots/settings", label: "Production settings", group: "Production", order: 26, icon: "user", requiresEntity: ENTITY_PIECEWORK_SETTING, shells },
      { href: "/lots/dashboard", label: "Factory dashboard", group: "Production", order: 20, icon: "overview", requiresEntity: ENTITY_PIECEWORK_LOT, shells },
      { href: "/lots", label: "Lots", group: "Production", order: 21, icon: "batch", requiresEntity: ENTITY_PIECEWORK_LOT, shells },
      { href: "/lots/entry", label: "Daily entry", group: "Production", order: 22, icon: "plus", requiresEntity: ENTITY_PIECEWORK_WORKER, shells },
      { href: "/karigars", label: "Karigars", group: "Production", order: 23, icon: "user", requiresEntity: ENTITY_PIECEWORK_WORKER, shells },
      { href: "/lots/reports", label: "Lot reports", group: "Production", order: 24, icon: "ledger", requiresEntity: ENTITY_PIECEWORK_LOT, shells },
    ],
  });
  registerCommand(defineStage);
  registerCommand(createLot);
  registerCommand(setLotStatus);
  registerCommand(cancelLot);
  registerCommand(createBundle);
  registerCommand(defineWorker);
  registerCommand(setWorkerRate);
  registerCommand(setWorkerActive);
  registerCommand(recordIssue);
  registerCommand(recordReturn);
  registerCommand(reverseEntry);
  registerCommand(recordPayment);
  registerCommand(reversePayment);
  registerFloor();
  registerSetup();
  registerFabric();
  registerViews();
  registerCosts();
  registerRebundle();
  registerHistory();
  registerTeam();
  registerCommand(cutLot);
  registerQuery(listStages);
  registerQuery(listLots);
  registerQuery(lotDetail);
  registerQuery(bundleDetail);
  registerQuery(listWorkers);
  registerQuery(workerLedger);
  registerQuery(recentEntries);
  registerQuery(dashboard);
  registerQuery(reportLotStatus);
  registerQuery(reportBundleLocation);
  registerQuery(reportWorkInHand);
  registerQuery(reportWagePayment);
  registerQuery(reportQuality);
  registerQuery(reportProductionByProcess);
  registerQuery(reportCosting);
  registerQuery(reportReadyInventory);
}
