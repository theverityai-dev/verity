import { z } from "zod";
import { registerCommand, ValidationError, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { WAGE_BASES, rateOn, type WageBasis } from "./ledger";
import { activeStages, isoOf, type Tx } from "./shared";

/**
 * Everything the owner sets, in one place, so each setting has one command, one query and one screen (Settings, and the lot's Rate
 * card). Nothing here is a constant in code that a factory would have to ask a developer to change:
 *
 *   - stages: name, default rate per piece, order (the order is fixed once work is recorded, because the ledger depends on it)
 *   - the rate card of a lot: rate per stage, a charge per lost piece, the wage basis, and whether the lot skips the stage
 *   - the charge per lost piece for the whole factory, and the challan heading
 *   - the reasons offered when pieces are rejected, sent for rework or short, in English and Hindi
 *
 * WHICH RATE WINS (shown on the screen too): the lot's rate for the stage; else the worker's own rate for the stage; else the stage's
 * default. A rate is snapshotted onto each entry when it is made, so changing a rate never moves history.
 */

export const ENTITY_PIECEWORK_LOT_RATE = "verity.piecework.lot_rate";
export const ENTITY_PIECEWORK_REASON = "verity.piecework.reason";
const STAGE_ENTITY = "verity.piecework.stage";
const SETTING_ENTITY = "verity.piecework.setting";

const uuid = z.string().uuid();

export const REASON_KINDS = ["defect", "short"] as const;
export type ReasonKind = (typeof REASON_KINDS)[number];

/** Offered until the factory saves its own list. Not stored, so nothing is seeded behind anyone's back. */
export const DEFAULT_REASONS: Record<ReasonKind, Array<{ key: string; labelEn: string; labelHi: string }>> = {
  defect: [
    { key: "stitch", labelEn: "Stitch defect", labelHi: "सिलाई की खराबी" },
    { key: "measure", labelEn: "Measurement", labelHi: "नाप की गलती" },
    { key: "stain", labelEn: "Stain", labelHi: "दाग" },
    { key: "hole", labelEn: "Hole or cut", labelHi: "छेद या कट" },
    { key: "other", labelEn: "Other", labelHi: "अन्य" },
  ],
  short: [
    { key: "lost", labelEn: "Lost", labelHi: "खो गया" },
    { key: "not_returned", labelEn: "Not returned", labelHi: "वापस नहीं आया" },
    { key: "miscount", labelEn: "Miscounted earlier", labelHi: "पहले गलत गिनती" },
    { key: "other", labelEn: "Other", labelHi: "अन्य" },
  ],
};

/* ================================= rate precedence ================================ */

export type EffectiveRate = { rateMinor: number; wageBasis: WageBasis; source: "lot" | "worker" | "stage" };

type LotRateRow = { rateMinor: number | null; wageBasis: string | null; lostPieceChargeMinor: number | null; skipped: boolean };

/**
 * The rate and basis in force for a worker at a stage of a lot on a date, or null when nothing sets one. The lot's rate card wins, then
 * the worker's own rate (effective-dated), then the stage default.
 */
export async function effectiveRate(tx: Tx, workerId: string, stageId: string, lotId: string, date: string): Promise<EffectiveRate | null> {
  const [lotRate, workerRates, stage] = await Promise.all([
    tx.pieceworkLotRate.findUnique({ where: { lotId_stageId: { lotId, stageId } } }),
    tx.pieceworkWorkerRate.findMany({ where: { workerId, stageId } }),
    tx.pieceworkStage.findUnique({ where: { id: stageId }, select: { defaultRateMinor: true } }),
  ]);
  const own = rateOn(workerRates.map((r) => ({ effectiveFrom: isoOf(r.effectiveFrom), rateMinor: r.rateMinor, wageBasis: r.wageBasis as WageBasis })), date);
  if (lotRate && !lotRate.skipped && lotRate.rateMinor !== null) {
    return { rateMinor: lotRate.rateMinor, wageBasis: (lotRate.wageBasis as WageBasis | null) ?? own?.wageBasis ?? "good", source: "lot" };
  }
  if (own) return { rateMinor: own.rateMinor, wageBasis: own.wageBasis, source: "worker" };
  if (stage?.defaultRateMinor != null) return { rateMinor: stage.defaultRateMinor, wageBasis: "good", source: "stage" };
  return null;
}

/** Whether any worker can be given work at this stage of this lot without a rate of their own (the lot or the stage sets one). */
export async function stageIsRated(tx: Tx, lotId: string, stageId: string): Promise<boolean> {
  const [lotRate, stage] = await Promise.all([
    tx.pieceworkLotRate.findUnique({ where: { lotId_stageId: { lotId, stageId } } }),
    tx.pieceworkStage.findUnique({ where: { id: stageId }, select: { defaultRateMinor: true } }),
  ]);
  return Boolean(lotRate && !lotRate.skipped && lotRate.rateMinor !== null) || stage?.defaultRateMinor != null;
}

/** Paise a lost piece costs the worker at this stage of this lot: the lot's own figure, else the factory's, else none. */
export async function lostPieceCharge(tx: Tx, lotId: string, stageId: string): Promise<number | null> {
  const [lotRate, setting] = await Promise.all([
    tx.pieceworkLotRate.findUnique({ where: { lotId_stageId: { lotId, stageId } } }),
    tx.pieceworkSetting.findFirst({ select: { defaultLostPieceChargeMinor: true } }),
  ]);
  const charge = lotRate?.lostPieceChargeMinor ?? setting?.defaultLostPieceChargeMinor ?? null;
  return charge !== null && charge > 0 ? charge : null;
}

/* =================================== stages ==================================== */

export const updateStage: CommandDefinition<{ stageId: string; label?: string; defaultRateMinor?: number | null; active?: boolean }, { id: string }> = {
  key: "verity.piecework.update_stage",
  entity: STAGE_ENTITY,
  verb: "Edit",
  input: z.object({
    stageId: uuid,
    label: z.string().trim().min(1).max(80).optional(),
    defaultRateMinor: z.number().int().min(0).max(10_000_000).nullable().optional(),
    active: z.boolean().optional(),
  }),
  preconditions: async (ctx, input) => {
    const stage = await ctx.tx.pieceworkStage.findUnique({ where: { id: input.stageId } });
    if (!stage) throw new ValidationError("E_VALIDATION: stage not found in this tenant");
    if (input.active === false && stage.active) {
      const used = await ctx.tx.pieceworkEntry.findFirst({ where: { stageId: stage.id }, select: { id: true } });
      if (used) throw new ValidationError(`E_VALIDATION: ${stage.label} has work recorded and cannot be switched off; skip it on a lot's rate card instead`);
    }
  },
  handler: async (ctx, input) => {
    await ctx.tx.pieceworkStage.update({
      where: { id: input.stageId },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.defaultRateMinor !== undefined ? { defaultRateMinor: input.defaultRateMinor } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        version: { increment: 1 },
      },
    });
    return { result: { id: input.stageId }, events: [{ name: "verity.piecework.stage_updated", entityId: input.stageId }] };
  },
};

/** Puts the stages in a new order. Refused once any work is recorded: the stage a piece came from is part of the ledger. */
export const reorderStages: CommandDefinition<{ stageIds: string[] }, { stageIds: string[] }> = {
  key: "verity.piecework.reorder_stages",
  entity: STAGE_ENTITY,
  verb: "Edit",
  input: z.object({ stageIds: z.array(uuid).min(1).max(40) }),
  preconditions: async (ctx, input) => {
    if (await ctx.tx.pieceworkEntry.findFirst({ select: { id: true } })) {
      throw new ValidationError("E_VALIDATION: the order of the stages cannot change once work has been recorded");
    }
    const all = await ctx.tx.pieceworkStage.findMany({ select: { id: true } });
    if (all.length !== input.stageIds.length || new Set(input.stageIds).size !== all.length || !all.every((s) => input.stageIds.includes(s.id))) {
      throw new ValidationError("E_VALIDATION: give every stage exactly once");
    }
  },
  handler: async (ctx, input) => {
    // The sequence is unique per tenant: park every stage out of range first, then number them in the new order.
    const base = 1000;
    for (const [i, id] of input.stageIds.entries()) await ctx.tx.pieceworkStage.update({ where: { id }, data: { sequence: base + i } });
    for (const [i, id] of input.stageIds.entries()) await ctx.tx.pieceworkStage.update({ where: { id }, data: { sequence: i + 1, version: { increment: 1 } } });
    return { result: { stageIds: input.stageIds }, events: [{ name: "verity.piecework.stages_reordered" }] };
  },
};

/* ================================= lot rate card ================================ */

type RateRowInput = { stageId: string; rateMinor?: number | null; lostPieceChargeMinor?: number | null; wageBasis?: WageBasis | null; skipped?: boolean };

export const setLotRates: CommandDefinition<{ lotId: string; rows: RateRowInput[] }, { lotId: string; saved: number }> = {
  key: "verity.piecework.set_lot_rates",
  entity: ENTITY_PIECEWORK_LOT_RATE,
  verb: "Edit",
  input: z.object({
    lotId: uuid,
    rows: z.array(z.object({
      stageId: uuid,
      rateMinor: z.number().int().min(0).max(10_000_000).nullable().optional(),
      lostPieceChargeMinor: z.number().int().min(0).max(100_000_000).nullable().optional(),
      wageBasis: z.enum(WAGE_BASES).nullable().optional(),
      skipped: z.boolean().optional(),
    })).min(1).max(40),
  }),
  preconditions: async (ctx, input) => {
    const lot = await ctx.tx.pieceworkLot.findUnique({ where: { id: input.lotId } });
    if (!lot || lot.cancelledAt) throw new ValidationError("E_VALIDATION: lot not found in this tenant");
    if (lot.status === "closed") throw new ValidationError("E_VALIDATION: a closed lot's rates cannot change");
    const stages = new Map((await ctx.tx.pieceworkStage.findMany()).map((s) => [s.id, s.label]));
    const seen = new Set<string>();
    for (const row of input.rows) {
      if (!stages.has(row.stageId)) throw new ValidationError("E_VALIDATION: stage not found in this tenant");
      if (seen.has(row.stageId)) throw new ValidationError("E_VALIDATION: one row per stage");
      seen.add(row.stageId);
      if (row.skipped) {
        const used = await ctx.tx.pieceworkEntry.findFirst({ where: { lotId: lot.id, stageId: row.stageId }, select: { id: true } });
        if (used) throw new ValidationError(`E_VALIDATION: ${stages.get(row.stageId)} already has work recorded on this lot and cannot be skipped`);
      }
    }
  },
  handler: async (ctx, input) => {
    for (const row of input.rows) {
      const data = {
        rateMinor: row.rateMinor ?? null,
        lostPieceChargeMinor: row.lostPieceChargeMinor ?? null,
        wageBasis: row.wageBasis ?? null,
        skipped: row.skipped ?? false,
        updatedById: ctx.actor.userId,
      };
      await ctx.tx.pieceworkLotRate.upsert({
        where: { lotId_stageId: { lotId: input.lotId, stageId: row.stageId } },
        create: { tenantId: ctx.actor.tenantId, lotId: input.lotId, stageId: row.stageId, ...data },
        update: data,
      });
    }
    return { result: { lotId: input.lotId, saved: input.rows.length }, events: [{ name: "verity.piecework.lot_rates_set", entityId: input.lotId }] };
  },
};

export type RateCardRow = {
  stageId: string; label: string; sequence: number; stageDefaultMinor: number | null;
  rateMinor: number | null; lostPieceChargeMinor: number | null; wageBasis: WageBasis | null; skipped: boolean;
  /** What the lot pays at this stage if no worker has a rate of their own: the lot's rate, else the stage default. */
  effectiveMinor: number | null; source: "lot" | "stage" | null; hasWork: boolean;
};

export async function rateCardOf(tx: Tx, lotId: string): Promise<RateCardRow[]> {
  const [stages, rows, used] = await Promise.all([
    activeStages(tx),
    tx.pieceworkLotRate.findMany({ where: { lotId } }),
    tx.pieceworkEntry.groupBy({ by: ["stageId"], where: { lotId } }),
  ]);
  const defaults = new Map((await tx.pieceworkStage.findMany({ select: { id: true, defaultRateMinor: true } })).map((s) => [s.id, s.defaultRateMinor]));
  const usedIds = new Set(used.map((u) => u.stageId));
  return stages.map((s): RateCardRow => {
    const r: LotRateRow | undefined = rows.find((x) => x.stageId === s.id);
    const stageDefaultMinor = defaults.get(s.id) ?? null;
    const lotRate = r && !r.skipped ? r.rateMinor : null;
    return {
      stageId: s.id, label: s.label, sequence: s.sequence, stageDefaultMinor,
      rateMinor: r?.rateMinor ?? null, lostPieceChargeMinor: r?.lostPieceChargeMinor ?? null, wageBasis: (r?.wageBasis as WageBasis | null) ?? null, skipped: r?.skipped ?? false,
      effectiveMinor: lotRate ?? stageDefaultMinor, source: lotRate !== null ? "lot" : stageDefaultMinor !== null ? "stage" : null, hasWork: usedIds.has(s.id),
    };
  });
}

/* ============================ factory-wide settings ============================ */

export const setProductionSettings: CommandDefinition<
  { lostPieceChargeMinor?: number | null; challanTitle?: string | null; challanAddress?: string | null },
  { saved: true }
> = {
  key: "verity.piecework.set_production_settings",
  entity: SETTING_ENTITY,
  verb: "Edit",
  input: z.object({
    lostPieceChargeMinor: z.number().int().min(0).max(100_000_000).nullable().optional(),
    challanTitle: z.string().trim().max(120).nullable().optional(),
    challanAddress: z.string().trim().max(300).nullable().optional(),
  }),
  handler: async (ctx, input) => {
    const data = {
      ...(input.lostPieceChargeMinor !== undefined ? { defaultLostPieceChargeMinor: input.lostPieceChargeMinor } : {}),
      ...(input.challanTitle !== undefined ? { challanTitle: input.challanTitle || null } : {}),
      ...(input.challanAddress !== undefined ? { challanAddress: input.challanAddress || null } : {}),
      updatedById: ctx.actor.userId,
    };
    await ctx.tx.pieceworkSetting.upsert({ where: { tenantId: ctx.actor.tenantId }, create: { tenantId: ctx.actor.tenantId, ...data }, update: data });
    return { result: { saved: true }, events: [] };
  },
};

/* ================================== reasons ===================================== */

export type ReasonRow = { key: string; labelEn: string; labelHi: string; active: boolean; sortOrder: number };

export async function reasonsOf(tx: Tx): Promise<Record<ReasonKind, ReasonRow[]> & { custom: boolean }> {
  const rows = await tx.pieceworkReason.findMany({ orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] });
  const pick = (kind: ReasonKind): ReasonRow[] => {
    const mine = rows.filter((r) => r.kind === kind);
    return mine.length > 0
      ? mine.map((r) => ({ key: r.reasonKey, labelEn: r.labelEn, labelHi: r.labelHi, active: r.active, sortOrder: r.sortOrder }))
      : DEFAULT_REASONS[kind].map((r, i) => ({ ...r, active: true, sortOrder: i }));
  };
  return { defect: pick("defect"), short: pick("short"), custom: rows.length > 0 };
}

/** Replaces one list of reasons as a whole: the screen edits the list, and what it saves is the list. Entries keep the words they were made with. */
export const saveReasons: CommandDefinition<{ kind: ReasonKind; items: Array<{ labelEn: string; labelHi: string; active?: boolean }> }, { count: number }> = {
  key: "verity.piecework.save_reasons",
  entity: ENTITY_PIECEWORK_REASON,
  verb: "Edit",
  input: z.object({
    kind: z.enum(REASON_KINDS),
    items: z.array(z.object({ labelEn: z.string().trim().min(1).max(60), labelHi: z.string().trim().min(1).max(60), active: z.boolean().optional() })).min(1).max(30),
  }),
  handler: async (ctx, input) => {
    await ctx.tx.pieceworkReason.deleteMany({ where: { kind: input.kind } });
    await ctx.tx.pieceworkReason.createMany({
      data: input.items.map((item, i) => ({
        tenantId: ctx.actor.tenantId, kind: input.kind, reasonKey: `r${i + 1}`, labelEn: item.labelEn, labelHi: item.labelHi, active: item.active ?? true, sortOrder: i,
      })),
    });
    return { result: { count: input.items.length }, events: [] };
  },
};

/* ================================== queries ====================================== */

export type ProductionSettings = {
  stages: Array<{ id: string; label: string; sequence: number; defaultRateMinor: number | null; active: boolean; hasWork: boolean }>;
  lostPieceChargeMinor: number | null; challanTitle: string | null; challanAddress: string | null;
  reasons: Awaited<ReturnType<typeof reasonsOf>>;
  limits: { deductionLimitMinor: number; writeoffLimitPieces: number };
};

export const productionSettings: QueryDefinition<Record<string, never>, ProductionSettings> = {
  key: "verity.piecework.production_settings",
  entity: SETTING_ENTITY,
  input: z.object({}),
  handler: async (ctx) => {
    const [stages, setting, used, reasons] = await Promise.all([
      ctx.tx.pieceworkStage.findMany({ orderBy: { sequence: "asc" } }),
      ctx.tx.pieceworkSetting.findFirst(),
      ctx.tx.pieceworkEntry.groupBy({ by: ["stageId"] }),
      reasonsOf(ctx.tx),
    ]);
    const usedIds = new Set(used.map((u) => u.stageId));
    return {
      stages: stages.map((s) => ({ id: s.id, label: s.label, sequence: s.sequence, defaultRateMinor: s.defaultRateMinor, active: s.active, hasWork: usedIds.has(s.id) })),
      lostPieceChargeMinor: setting?.defaultLostPieceChargeMinor ?? null, challanTitle: setting?.challanTitle ?? null, challanAddress: setting?.challanAddress ?? null,
      reasons,
      limits: { deductionLimitMinor: setting?.managerDeductionLimitMinor ?? 100_000, writeoffLimitPieces: setting?.managerWriteoffLimitPieces ?? 5 },
    };
  },
};

export const lotRateCard: QueryDefinition<{ lotId: string }, RateCardRow[]> = {
  key: "verity.piecework.lot_rate_card",
  entity: ENTITY_PIECEWORK_LOT_RATE,
  input: z.object({ lotId: uuid }),
  handler: async (ctx, input) => rateCardOf(ctx.tx, input.lotId),
};

/** What the take-back and give-out screens need, in the language of the phone: the reason lists. No money. */
export const floorReasons: QueryDefinition<Record<string, never>, Awaited<ReturnType<typeof reasonsOf>>> = {
  key: "verity.piecework.floor_reasons",
  entity: "verity.piecework.entry",
  input: z.object({}),
  handler: async (ctx) => reasonsOf(ctx.tx),
};

export function registerSetup(): void {
  registerCommand(updateStage);
  registerCommand(reorderStages);
  registerCommand(setLotRates);
  registerCommand(setProductionSettings);
  registerCommand(saveReasons);
  registerQuery(productionSettings);
  registerQuery(lotRateCard);
  registerQuery(floorReasons);
}
