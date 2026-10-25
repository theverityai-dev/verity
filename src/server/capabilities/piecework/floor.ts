import { z } from "zod";
import { registerCommand, ValidationError, type ActorContext, type CommandContext, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { ForbiddenError, hasTenantPermission } from "@/server/platform/authorization";
import { canMoveLot, daysBetween, type LotStatus } from "./ledger";
import { activeStages, asDate, isoOf, loadBundles, lotCovers, todayFor, type LoadedBundle, type Tx } from "./shared";

/**
 * The floor: what a supervisor, a manager and the owner need on top of the piece-rate ledgers (Stylified MVP, proposal
 * document 2). Four things live here and nowhere else:
 *
 *   1. Stage scope. A user who holds ActionExecute on the stage entity works at every stage (owner, manager, munshi).
 *      Anyone else may issue and receive only at the stages the owner assigned to them. The check is made by the
 *      capability's own commands (`assertStageAccess`), so it holds for every caller, not only the supervisor screens.
 *   2. Approvals. One person asks (a wage deduction, a shortage write-off, a lot hold or close) and another decides.
 *      Approving applies the ordinary change. A manager may approve alone only within the limits the owner set; above
 *      them only someone who may edit the limits (the owner) can approve. Nobody decides their own request.
 *   3. The day close: a supervisor's day, frozen at submission with a handover note.
 *   4. The floor queries: derived views of the ledgers for the supervisor screens. They carry no wage, rate or balance,
 *      so a user without the money grants cannot see a rupee through them.
 *
 * Nothing here stores a count that the ledgers can derive.
 */

export const ENTITY_PIECEWORK_STAGE_ASSIGNMENT = "verity.piecework.stage_assignment";
export const ENTITY_PIECEWORK_APPROVAL = "verity.piecework.approval";
export const ENTITY_PIECEWORK_SETTING = "verity.piecework.setting";
export const ENTITY_PIECEWORK_DAY_CLOSE = "verity.piecework.day_close";
// Defined in `index.ts` as well; repeated here because `index.ts` imports this file.
const STAGE_ENTITY = "verity.piecework.stage";
const ENTRY_ENTITY = "verity.piecework.entry";

export const APPROVAL_KINDS = ["deduction", "writeoff", "hold", "close"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];
export const LANGS = ["en", "hi"] as const;
export type Lang = (typeof LANGS)[number];

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

export const DEFAULT_LIMITS = { deductionLimitMinor: 100_000, writeoffLimitPieces: 5 } as const;

/* ============================== stage scope =============================== */

export type StageScope = { all: true } | { all: false; stageIds: ReadonlySet<string> };

export async function stageScopeOf(tx: Tx, actor: ActorContext): Promise<StageScope> {
  if (await hasTenantPermission(tx, actor.roleId, "ActionExecute", STAGE_ENTITY)) return { all: true };
  const rows = await tx.pieceworkStageAssignment.findMany({ where: { userId: actor.userId }, select: { stageId: true } });
  return { all: false, stageIds: new Set(rows.map((r) => r.stageId)) };
}

export const inScope = (scope: StageScope, stageId: string) => scope.all || scope.stageIds.has(stageId);

/** Refuses a supervisor who gives work to a karigar the owner set under another supervisor. Anyone who works at every stage is exempt. */
export async function assertWorkerAccess(ctx: CommandContext, workerId: string): Promise<void> {
  if ((await stageScopeOf(ctx.tx, ctx.actor)).all) return;
  const worker = await ctx.tx.pieceworkWorker.findUnique({ where: { id: workerId }, select: { name: true, supervisorUserId: true } });
  if (worker?.supervisorUserId && worker.supervisorUserId !== ctx.actor.userId) {
    throw new ForbiddenError(`E_FORBIDDEN: ${worker.name} is looked after by another supervisor; ask the owner to change it if you are to give them work`);
  }
}

/** Refuses a supervisor at a stage the owner has not given them. */
export async function assertStageAccess(ctx: CommandContext, stageId: string): Promise<void> {
  const scope = await stageScopeOf(ctx.tx, ctx.actor);
  if (inScope(scope, stageId)) return;
  const stage = await ctx.tx.pieceworkStage.findUnique({ where: { id: stageId }, select: { label: true } });
  throw new ForbiddenError(`E_FORBIDDEN: ${stage?.label ?? "that stage"} is not one of your stages; ask the owner to assign it to you`);
}

/**
 * Reversal rule: someone who may decide approvals (manager, owner) may reverse any entry; everyone else only an entry
 * they made themselves, on the same day.
 */
export async function assertMayReverse(ctx: CommandContext, entry: { enteredById: string; createdAt: Date }): Promise<void> {
  if (await hasTenantPermission(ctx.tx, ctx.actor.roleId, "ActionExecute", ENTITY_PIECEWORK_APPROVAL)) return;
  if (entry.enteredById !== ctx.actor.userId) throw new ForbiddenError("E_FORBIDDEN: you can reverse only entries you made yourself; ask the manager");
  const tenant = await ctx.tx.tenant.findFirst({ select: { timeZone: true } });
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tenant?.timeZone ?? "UTC" }).format(d);
  if (day(entry.createdAt) !== day(new Date())) throw new ForbiddenError("E_FORBIDDEN: you can reverse your own entry only on the day you made it; ask the manager");
}

/* ============================== limits ============================== */

export type Limits = { deductionLimitMinor: number; writeoffLimitPieces: number };

async function limitsOf(tx: Tx): Promise<Limits> {
  const row = await tx.pieceworkSetting.findFirst();
  return row
    ? { deductionLimitMinor: row.managerDeductionLimitMinor, writeoffLimitPieces: row.managerWriteoffLimitPieces }
    : { ...DEFAULT_LIMITS };
}

export const setLimits: CommandDefinition<Limits, Limits> = {
  key: "verity.piecework.set_limits",
  entity: ENTITY_PIECEWORK_SETTING,
  verb: "Edit",
  input: z.object({ deductionLimitMinor: z.number().int().min(0).max(100_000_000), writeoffLimitPieces: z.number().int().min(0).max(100_000) }),
  handler: async (ctx, input) => {
    await ctx.tx.pieceworkSetting.upsert({
      where: { tenantId: ctx.actor.tenantId },
      create: { tenantId: ctx.actor.tenantId, managerDeductionLimitMinor: input.deductionLimitMinor, managerWriteoffLimitPieces: input.writeoffLimitPieces, updatedById: ctx.actor.userId },
      update: { managerDeductionLimitMinor: input.deductionLimitMinor, managerWriteoffLimitPieces: input.writeoffLimitPieces, updatedById: ctx.actor.userId },
    });
    return { result: input, events: [] };
  },
};

/* ============================ stage assignment ============================ */

export const assignStages: CommandDefinition<{ userId: string; stageIds: string[] }, { userId: string; stageIds: string[] }> = {
  key: "verity.piecework.assign_stages",
  entity: ENTITY_PIECEWORK_STAGE_ASSIGNMENT,
  verb: "Edit",
  input: z.object({ userId: uuid, stageIds: z.array(uuid).max(50) }),
  preconditions: async (ctx, input) => {
    if (!(await ctx.tx.tenantMembership.findFirst({ where: { userId: input.userId, disabledAt: null }, select: { id: true } }))) {
      throw new ValidationError("E_VALIDATION: that person is not an active member of this workspace");
    }
    const found = await ctx.tx.pieceworkStage.count({ where: { id: { in: input.stageIds }, active: true } });
    if (found !== new Set(input.stageIds).size) throw new ValidationError("E_VALIDATION: one of those stages does not exist");
  },
  handler: async (ctx, input) => {
    const wanted = [...new Set(input.stageIds)];
    await ctx.tx.pieceworkStageAssignment.deleteMany({ where: { userId: input.userId, stageId: { notIn: wanted } } });
    const have = new Set((await ctx.tx.pieceworkStageAssignment.findMany({ where: { userId: input.userId }, select: { stageId: true } })).map((r) => r.stageId));
    const add = wanted.filter((id) => !have.has(id));
    if (add.length) await ctx.tx.pieceworkStageAssignment.createMany({ data: add.map((stageId) => ({ tenantId: ctx.actor.tenantId, userId: input.userId, stageId, createdById: ctx.actor.userId })) });
    return { result: { userId: input.userId, stageIds: wanted }, events: [{ name: "verity.piecework.stages_assigned", entityId: input.userId }] };
  },
};

/* ================================ approvals ================================ */

type RequestInput = { kind: ApprovalKind; reason: string; lotId?: string; workerId?: string; entryId?: string; pieces?: number; amountMinor?: number };

/** Short pieces on a return entry that are not yet covered by an approved or pending write-off. */
async function shortLeft(tx: Tx, entryId: string): Promise<{ left: number; entry: { id: string; bundleId: string; lotId: string; workerId: string; stageId: string; short: number } } | null> {
  const entry = await tx.pieceworkEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.kind !== "receive" || entry.reversesId) return null;
  if (await tx.pieceworkEntry.findFirst({ where: { reversesId: entry.id }, select: { id: true } })) return null;
  const taken = await tx.pieceworkApproval.aggregate({ _sum: { pieces: true }, where: { entryId, kind: "writeoff", status: { in: ["pending", "approved"] } } });
  const short = entry.shortPieces ?? 0;
  return { left: short - (taken._sum.pieces ?? 0), entry: { id: entry.id, bundleId: entry.bundleId, lotId: entry.lotId, workerId: entry.workerId, stageId: entry.stageId, short } };
}

export const requestApproval: CommandDefinition<RequestInput, { id: string }> = {
  key: "verity.piecework.request_approval",
  entity: ENTITY_PIECEWORK_APPROVAL,
  verb: "Create",
  input: z.object({
    kind: z.enum(APPROVAL_KINDS),
    reason: z.string().trim().min(3, "give a reason of a few words").max(300),
    lotId: uuid.optional(),
    workerId: uuid.optional(),
    entryId: uuid.optional(),
    pieces: z.number().int().min(1).max(1_000_000).optional(),
    amountMinor: z.number().int().min(1).max(1_000_000_000).optional(),
  }),
  preconditions: async (ctx, input) => {
    if (input.kind === "deduction") {
      if (!input.workerId || !input.amountMinor) throw new ValidationError("E_VALIDATION: a deduction names the karigar and the amount");
      if (!(await ctx.tx.pieceworkWorker.findUnique({ where: { id: input.workerId } }))) throw new ValidationError("E_VALIDATION: karigar not found in this tenant");
    }
    if (input.kind === "writeoff") {
      if (!input.entryId || !input.pieces) throw new ValidationError("E_VALIDATION: a write-off names the return entry and how many pieces");
      const s = await shortLeft(ctx.tx, input.entryId);
      if (!s) throw new ValidationError("E_VALIDATION: that return entry was not found or was reversed");
      await assertStageAccess(ctx, s.entry.stageId);
      if (input.pieces > s.left) throw new ValidationError(`E_VALIDATION: only ${Math.max(0, s.left)} short pieces on that entry are still open to write off`);
    }
    if (input.kind === "hold" || input.kind === "close") {
      if (!input.lotId) throw new ValidationError("E_VALIDATION: name the lot");
      const lot = await ctx.tx.pieceworkLot.findUnique({ where: { id: input.lotId } });
      if (!lot || lot.cancelledAt) throw new ValidationError("E_VALIDATION: lot not found in this tenant");
      const to: LotStatus = input.kind === "hold" ? "hold" : "closed";
      if (!canMoveLot(lot.status as LotStatus, to)) throw new ValidationError(`E_VALIDATION: a ${lot.status} lot cannot be ${input.kind === "hold" ? "put on hold" : "closed"}`);
    }
    const open = await ctx.tx.pieceworkApproval.findFirst({
      where: { status: "pending", kind: input.kind, ...(input.entryId ? { entryId: input.entryId } : {}), ...(input.lotId && !input.entryId ? { lotId: input.lotId } : {}), ...(input.kind === "deduction" ? { workerId: input.workerId, amountMinor: input.amountMinor } : {}) },
      select: { id: true },
    });
    if (open) throw new ValidationError("E_VALIDATION: that request is already waiting for a decision");
  },
  handler: async (ctx, input) => {
    const entry = input.entryId ? await ctx.tx.pieceworkEntry.findUnique({ where: { id: input.entryId } }) : null;
    const row = await ctx.tx.pieceworkApproval.create({
      data: {
        tenantId: ctx.actor.tenantId, kind: input.kind, reason: input.reason, requestedById: ctx.actor.userId,
        lotId: entry?.lotId ?? input.lotId ?? null, bundleId: entry?.bundleId ?? null, workerId: entry?.workerId ?? input.workerId ?? null,
        entryId: entry?.id ?? null, pieces: input.pieces ?? null, amountMinor: input.amountMinor ?? null,
      },
    });
    return { result: { id: row.id }, events: [{ name: "verity.piecework.approval_requested", entityId: row.id, payload: { kind: input.kind } }] };
  },
};

/** Whether the actor may decide this one alone, and if not, why. Owners (who may edit the limits) are never limited. */
export function withinLimit(limits: Limits, a: { kind: string; amountMinor: number | null; pieces: number | null }, lotShort: number): string | null {
  if (a.kind === "deduction" && (a.amountMinor ?? 0) > limits.deductionLimitMinor) return "deduction";
  if (a.kind === "writeoff" && (a.pieces ?? 0) > limits.writeoffLimitPieces) return "writeoff";
  if (a.kind === "close" && lotShort > limits.writeoffLimitPieces) return "close";
  return null;
}

async function lotShortPieces(tx: Tx, lotId: string): Promise<number> {
  const bundles = await loadBundles(tx, await activeStages(tx), { lotId });
  return bundles.filter((b) => !b.cancelledAt).reduce((s, b) => s + b.position.short, 0);
}

export const decideApproval: CommandDefinition<{ approvalId: string; decision: "approved" | "declined"; note?: string }, { id: string; status: string }> = {
  key: "verity.piecework.decide_approval",
  entity: ENTITY_PIECEWORK_APPROVAL,
  verb: "ActionExecute",
  impact: "destructive",
  input: z.object({ approvalId: uuid, decision: z.enum(["approved", "declined"]), note: z.string().trim().max(300).optional() }),
  preconditions: async (ctx, input) => {
    const a = await ctx.tx.pieceworkApproval.findUnique({ where: { id: input.approvalId } });
    if (!a) throw new ValidationError("E_VALIDATION: request not found in this tenant");
    if (a.status !== "pending") throw new ValidationError(`E_VALIDATION: that request was already ${a.status}`);
    if (a.requestedById === ctx.actor.userId) throw new ValidationError("E_VALIDATION: someone else must decide your request");
    if (input.decision === "declined" && (input.note ?? "").length < 3) throw new ValidationError("E_VALIDATION: say why you are declining, in a few words");
    if (input.decision === "approved") {
      const owner = await hasTenantPermission(ctx.tx, ctx.actor.roleId, "Edit", ENTITY_PIECEWORK_SETTING);
      if (!owner) {
        const over = withinLimit(await limitsOf(ctx.tx), a, a.kind === "close" && a.lotId ? await lotShortPieces(ctx.tx, a.lotId) : 0);
        if (over) throw new ForbiddenError("E_FORBIDDEN: this is above the limit the owner set for managers; only the owner can approve it");
      }
      if (a.kind === "hold" || a.kind === "close") {
        const lot = await ctx.tx.pieceworkLot.findUnique({ where: { id: a.lotId! } });
        const to: LotStatus = a.kind === "hold" ? "hold" : "closed";
        if (!lot || !canMoveLot(lot.status as LotStatus, to)) throw new ValidationError(`E_VALIDATION: the lot is now ${lot?.status ?? "gone"} and cannot be ${a.kind === "hold" ? "put on hold" : "closed"}; decline this request`);
      }
    }
  },
  handler: async (ctx, input) => {
    const a = await ctx.tx.pieceworkApproval.findUniqueOrThrow({ where: { id: input.approvalId } });
    if (input.decision === "approved") {
      if (a.kind === "deduction") {
        await ctx.tx.pieceworkPayment.create({
          data: { tenantId: ctx.actor.tenantId, workerId: a.workerId!, kind: "deduction", amountMinor: a.amountMinor!, paidOn: asDate(await todayFor(ctx.tx)), note: a.reason, enteredById: ctx.actor.userId },
        });
      }
      if (a.kind === "hold" || a.kind === "close") {
        await ctx.tx.pieceworkLot.update({ where: { id: a.lotId! }, data: { status: a.kind === "hold" ? "hold" : "closed", version: { increment: 1 } } });
      }
    }
    await ctx.tx.pieceworkApproval.update({ where: { id: a.id }, data: { status: input.decision, decidedById: ctx.actor.userId, decidedAt: new Date(), decisionNote: input.note ?? null } });
    return { result: { id: a.id, status: input.decision }, events: [{ name: "verity.piecework.approval_decided", entityId: a.id, payload: { kind: a.kind, decision: input.decision } }] };
  },
};

/* ============================ the floor, derived ============================ */

export type FloorIssue = {
  issueId: string; bundleId: string; bundleNumber: string; lotId: string; lotNumber: string; lotName: string; cover: string | null;
  stageId: string; stageLabel: string; workerId: string; workerName: string; open: number; issued: number; isRework: boolean;
  entryDate: string; dueDate: string | null; late: boolean; dueToday: boolean; daysOut: number;
};
export type FloorWaiting = {
  bundleId: string; bundleNumber: string; lotId: string; lotNumber: string; lotName: string; cover: string | null;
  stageId: string; stageLabel: string; toIssue: number; reworkPool: number;
};
export type FloorAlert = { kind: "late" | "shortage" | "approvals" | "day_open"; count: number };

type FloorState = {
  scope: StageScope; today: string; stages: Array<{ id: string; label: string; sequence: number }>; mine: Array<{ id: string; label: string }>;
  lots: Map<string, { number: string; name: string; cover: string | null; status: string }>; workers: Map<string, string>;
  issues: FloorIssue[]; waiting: FloorWaiting[]; bundles: LoadedBundle[];
};

async function floorState(tx: Tx, actor: ActorContext): Promise<FloorState> {
  const [scope, stages, today, lotRows, workerRows] = await Promise.all([
    stageScopeOf(tx, actor), activeStages(tx), todayFor(tx),
    tx.pieceworkLot.findMany({ where: { cancelledAt: null }, select: { id: true, number: true, name: true, design: true, status: true, customFields: true } }),
    tx.pieceworkWorker.findMany({ select: { id: true, name: true } }),
  ]);
  const covers = await lotCovers(tx, lotRows.filter((l) => l.status === "active"));
  const lots = new Map(lotRows.map((l) => [l.id, { number: l.number, name: l.name ?? l.design, cover: covers.get(l.id) ?? null, status: l.status }]));
  const workers = new Map(workerRows.map((w) => [w.id, w.name]));
  // Only the lots in work: the floor never shows a closed lot, so its bundles are not derived at all.
  const activeLotIds = lotRows.filter((l) => l.status === "active").map((l) => l.id);
  const bundles = (await loadBundles(tx, stages, { lotIds: activeLotIds })).filter((b) => !b.cancelledAt);
  const issues: FloorIssue[] = [];
  const waiting: FloorWaiting[] = [];
  for (const b of bundles) {
    const lot = lots.get(b.lotId)!;
    for (const s of b.position.stages) {
      if (!inScope(scope, s.stageId)) continue;
      for (const i of s.issues) {
        if (i.open <= 0) continue;
        issues.push({
          issueId: i.issueId, bundleId: b.id, bundleNumber: b.number, lotId: b.lotId, lotNumber: lot.number, lotName: lot.name, cover: lot.cover,
          stageId: s.stageId, stageLabel: s.label, workerId: i.workerId, workerName: workers.get(i.workerId) ?? "A karigar", open: i.open, issued: i.issued, isRework: i.isRework,
          entryDate: i.entryDate, dueDate: i.dueDate, late: i.dueDate !== null && i.dueDate < today, dueToday: i.dueDate === today, daysOut: daysBetween(i.entryDate, today),
        });
      }
      if (s.toIssue > 0 || s.reworkPool > 0) {
        waiting.push({ bundleId: b.id, bundleNumber: b.number, lotId: b.lotId, lotNumber: lot.number, lotName: lot.name, cover: lot.cover, stageId: s.stageId, stageLabel: s.label, toIssue: s.toIssue, reworkPool: s.reworkPool });
      }
    }
  }
  issues.sort((a, b) => Number(b.late) - Number(a.late) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  const mine = stages.filter((s) => inScope(scope, s.id)).map((s) => ({ id: s.id, label: s.label }));
  return { scope, today, stages, mine, lots, workers, issues, waiting, bundles };
}

/** Shortage and rework registers need the return entries themselves (reason note, who, when). */
async function registers(tx: Tx, st: FloorState) {
  // Only returns that left something to act on (short or rework) in lots still in work: a year of closed lots is never read.
  const activeLotIds = [...st.lots].filter(([, l]) => l.status === "active").map(([id]) => id);
  const rows = await tx.pieceworkEntry.findMany({
    where: { kind: "receive", lotId: { in: activeLotIds }, OR: [{ shortPieces: { gt: 0 } }, { reworkPieces: { gt: 0 } }] },
    orderBy: { createdAt: "desc" },
  });
  const reversed = new Set((await tx.pieceworkEntry.findMany({ where: { reversesId: { in: rows.map((r) => r.id) } }, select: { reversesId: true } })).map((r) => r.reversesId!));
  const live = rows.filter((r) => !r.reversesId && !reversed.has(r.id));
  const approvals = await tx.pieceworkApproval.findMany({ where: { kind: "writeoff", entryId: { not: null } } });
  const bundleNo = new Map(st.bundles.map((b) => [b.id, b.number]));
  const stageLabel = new Map(st.stages.map((s) => [s.id, s.label]));

  const shortages = live
    .filter((r) => (r.shortPieces ?? 0) > 0 && inScope(st.scope, r.stageId) && st.lots.has(r.lotId))
    .map((r) => {
      const mineApprovals = approvals.filter((a) => a.entryId === r.id);
      const writtenOff = mineApprovals.filter((a) => a.status === "approved").reduce((s, a) => s + (a.pieces ?? 0), 0);
      const requested = mineApprovals.filter((a) => a.status === "pending").reduce((s, a) => s + (a.pieces ?? 0), 0);
      const short = r.shortPieces ?? 0;
      return {
        entryId: r.id, bundleId: r.bundleId, bundleNumber: bundleNo.get(r.bundleId) ?? "", lotNumber: st.lots.get(r.lotId)?.number ?? "", cover: st.lots.get(r.lotId)?.cover ?? null, stageLabel: stageLabel.get(r.stageId) ?? "",
        workerName: st.workers.get(r.workerId) ?? "A karigar", short, writtenOff, requested, open: Math.max(0, short - writtenOff - requested), date: isoOf(r.entryDate),
        ageDays: daysBetween(isoOf(r.entryDate), st.today), note: r.note,
      };
    })
    .filter((x) => x.open > 0 || x.requested > 0);

  const rework = st.waiting.filter((w) => w.reworkPool > 0).map((w) => {
    const src = live.find((r) => r.bundleId === w.bundleId && r.stageId === w.stageId && (r.reworkPieces ?? 0) > 0);
    return { ...w, entryId: src?.id ?? null, reason: src?.note ?? null, ageDays: src ? daysBetween(isoOf(src.entryDate), st.today) : 0, workerName: src ? st.workers.get(src.workerId) ?? "A karigar" : "" };
  });
  return { shortages, rework };
}

export type FloorOverview = {
  today: string; stages: Array<{ id: string; label: string }>; allStages: boolean;
  counts: { done: number; out: number; waiting: number; rework: number; rejected: number; short: number; total: number };
  issues: FloorIssue[]; waiting: FloorWaiting[]; alerts: FloorAlert[]; dayClosed: boolean; pendingApprovals: number;
};

export const floorOverview: QueryDefinition<Record<string, never>, FloorOverview> = {
  key: "verity.piecework.floor_overview",
  entity: ENTRY_ENTITY,
  input: z.object({}),
  handler: async (ctx) => {
    const st = await floorState(ctx.tx, ctx.actor);
    const reg = await registers(ctx.tx, st);
    let done = 0, out = 0, waiting = 0, rework = 0, rejected = 0, short = 0, total = 0;
    for (const b of st.bundles) {
      for (const s of b.position.stages) {
        if (!inScope(st.scope, s.stageId)) continue;
        total += s.intake; done += s.good; out += s.pending; waiting += s.toIssue; rework += s.reworkPool; rejected += s.rejected; short += s.short;
      }
    }
    const closed = await ctx.tx.pieceworkDayClose.findFirst({ where: { userId: ctx.actor.userId, closeDate: asDate(st.today) }, select: { id: true } });
    const decider = await hasTenantPermission(ctx.tx, ctx.actor.roleId, "ActionExecute", ENTITY_PIECEWORK_APPROVAL);
    const pendingApprovals = decider ? await ctx.tx.pieceworkApproval.count({ where: { status: "pending" } }) : 0;
    const late = st.issues.filter((i) => i.late).length;
    const openShort = reg.shortages.filter((s) => s.open > 0).length;
    const alerts: FloorAlert[] = [];
    if (late) alerts.push({ kind: "late", count: late });
    if (openShort) alerts.push({ kind: "shortage", count: openShort });
    if (pendingApprovals) alerts.push({ kind: "approvals", count: pendingApprovals });
    return {
      today: st.today, stages: st.mine, allStages: st.scope.all, counts: { done, out, waiting, rework, rejected, short, total },
      issues: st.issues, waiting: st.waiting, alerts, dayClosed: closed !== null, pendingApprovals,
    };
  },
};

export type FloorWorker = { id: string; name: string; kind: string; stageIds: string[]; piecesHeld: number };

/** Karigars with the stages they are set up for, never the rates. */
export const floorWorkers: QueryDefinition<Record<string, never>, FloorWorker[]> = {
  key: "verity.piecework.floor_workers",
  entity: ENTRY_ENTITY,
  input: z.object({}),
  handler: async (ctx) => {
    const [workers, rates, st, defaulted] = await Promise.all([
      ctx.tx.pieceworkWorker.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      ctx.tx.pieceworkWorkerRate.findMany({ select: { workerId: true, stageId: true } }),
      floorState(ctx.tx, ctx.actor),
      // A stage with a default rate can be given to any karigar; the others only to those with a rate of their own.
      ctx.tx.pieceworkStage.findMany({ where: { active: true, defaultRateMinor: { not: null } }, select: { id: true } }),
    ]);
    const held = new Map<string, number>();
    for (const i of st.issues) held.set(i.workerId, (held.get(i.workerId) ?? 0) + i.open);
    // A person who works at every stage (owner, manager, munshi) sees every karigar. A supervisor sees the karigars set as theirs
    // and those with no supervisor yet; a karigar given to another supervisor is that supervisor's to give out to.
    const mine = (w: { supervisorUserId: string | null }) => st.scope.all || w.supervisorUserId === null || w.supervisorUserId === ctx.actor.userId;
    return workers.filter(mine).map((w) => ({
      id: w.id, name: w.name, kind: w.kind,
      stageIds: [...new Set([...rates.filter((r) => r.workerId === w.id).map((r) => r.stageId), ...defaulted.map((s) => s.id)])],
      piecesHeld: held.get(w.id) ?? 0,
    }));
  },
};

export type CustodyBundle = Pick<FloorIssue, "issueId" | "bundleId" | "bundleNumber" | "lotNumber" | "stageLabel" | "open" | "dueDate" | "late" | "daysOut" | "isRework">;
export type CustodyKarigar = { workerId: string; name: string; held: number; late: number; oldestDays: number; bundles: CustodyBundle[] };
export type CustodyGroup = { supervisorUserId: string | null; supervisorName: string; held: number; late: number; karigars: CustodyKarigar[] };

/**
 * Who holds what right now: the open pieces grouped by the supervisor each karigar is set under, then by karigar, with the bundles, how long
 * they have been out and what is late. No rate, wage or balance. A person who works at every stage sees every group; a supervisor sees the
 * pieces at their own stages.
 */
export const custodyBoard: QueryDefinition<Record<string, never>, { today: string; groups: CustodyGroup[] }> = {
  key: "verity.piecework.custody_board",
  entity: ENTRY_ENTITY,
  input: z.object({}),
  handler: async (ctx) => {
    const [st, workers, members] = await Promise.all([
      floorState(ctx.tx, ctx.actor),
      ctx.tx.pieceworkWorker.findMany({ select: { id: true, supervisorUserId: true } }),
      ctx.tx.tenantMembership.findMany({ select: { userId: true, user: { select: { party: { select: { displayName: true } } } } } }),
    ]);
    const supervisorOf = new Map(workers.map((w) => [w.id, w.supervisorUserId]));
    const names = new Map(members.map((m) => [m.userId, m.user.party.displayName]));
    const groups = new Map<string, CustodyGroup>();
    for (const i of st.issues) {
      const sup = supervisorOf.get(i.workerId) ?? null;
      const key = sup ?? "";
      const group = groups.get(key) ?? { supervisorUserId: sup, supervisorName: sup ? names.get(sup) ?? "Someone who has left" : "No supervisor yet", held: 0, late: 0, karigars: [] };
      groups.set(key, group);
      let k = group.karigars.find((x) => x.workerId === i.workerId);
      if (!k) { k = { workerId: i.workerId, name: i.workerName, held: 0, late: 0, oldestDays: 0, bundles: [] }; group.karigars.push(k); }
      k.held += i.open; k.late += i.late ? 1 : 0; k.oldestDays = Math.max(k.oldestDays, i.daysOut);
      k.bundles.push({ issueId: i.issueId, bundleId: i.bundleId, bundleNumber: i.bundleNumber, lotNumber: i.lotNumber, stageLabel: i.stageLabel, open: i.open, dueDate: i.dueDate, late: i.late, daysOut: i.daysOut, isRework: i.isRework });
      group.held += i.open; group.late += i.late ? 1 : 0;
    }
    const out = [...groups.values()];
    for (const g of out) { g.karigars.sort((a, b) => b.late - a.late || b.held - a.held || a.name.localeCompare(b.name)); for (const k of g.karigars) k.bundles.sort((a, b) => Number(b.late) - Number(a.late) || b.daysOut - a.daysOut); }
    // The unassigned group last; the others by what is late, then what is held.
    out.sort((a, b) => Number(a.supervisorUserId === null) - Number(b.supervisorUserId === null) || b.late - a.late || b.held - a.held || a.supervisorName.localeCompare(b.supervisorName));
    return { today: st.today, groups: out };
  },
};
export type FloorRegister = Awaited<ReturnType<typeof registers>>;
export const floorRegister: QueryDefinition<Record<string, never>, FloorRegister & { today: string }> = {
  key: "verity.piecework.floor_register",
  entity: ENTRY_ENTITY,
  input: z.object({}),
  handler: async (ctx) => {
    const st = await floorState(ctx.tx, ctx.actor);
    return { ...(await registers(ctx.tx, st)), today: st.today };
  },
};

export type FloorKarigar = {
  id: string; name: string; kind: string; mobile: string | null; held: number; today: string;
  holding: FloorIssue[]; returnsToday: Array<{ bundleNumber: string; stageLabel: string; good: number; rejected: number; rework: number; short: number }>;
  last30: { received: number; rejected: number; rework: number; rejectRatePct: number; reworkRatePct: number };
};

/** One karigar as a supervisor sees them: pieces held, due dates, today's returns, quality rates. No rate, wage or balance. */
export const floorKarigar: QueryDefinition<{ workerId: string }, FloorKarigar | null> = {
  key: "verity.piecework.floor_karigar",
  entity: ENTRY_ENTITY,
  input: z.object({ workerId: uuid }),
  handler: async (ctx, input) => {
    const w = await ctx.tx.pieceworkWorker.findUnique({ where: { id: input.workerId } });
    if (!w) return null;
    const st = await floorState(ctx.tx, ctx.actor);
    const since = new Date(asDate(st.today).getTime() - 30 * 86_400_000);
    const rows = await ctx.tx.pieceworkEntry.findMany({ where: { workerId: w.id, kind: "receive", entryDate: { gte: since } } });
    const net = (r: { reversesId: string | null }) => (r.reversesId ? -1 : 1);
    const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + net(r) * f(r), 0);
    const good = sum((r) => r.goodPieces ?? 0), rejected = sum((r) => r.rejectedPieces ?? 0), rework = sum((r) => r.reworkPieces ?? 0);
    const received = good + rejected + rework;
    const stageLabel = new Map(st.stages.map((s) => [s.id, s.label]));
    const bundleNo = new Map(st.bundles.map((b) => [b.id, b.number]));
    const holding = st.issues.filter((i) => i.workerId === w.id);
    return {
      id: w.id, name: w.name, kind: w.kind, mobile: w.mobile, held: holding.reduce((s, i) => s + i.open, 0), today: st.today, holding,
      returnsToday: rows.filter((r) => isoOf(r.entryDate) === st.today && !r.reversesId && inScope(st.scope, r.stageId)).map((r) => ({
        bundleNumber: bundleNo.get(r.bundleId) ?? "", stageLabel: stageLabel.get(r.stageId) ?? "", good: r.goodPieces ?? 0, rejected: r.rejectedPieces ?? 0, rework: r.reworkPieces ?? 0, short: r.shortPieces ?? 0,
      })),
      last30: { received, rejected, rework, rejectRatePct: received > 0 ? Math.round((rejected / received) * 100) : 0, reworkRatePct: received > 0 ? Math.round((rework / received) * 100) : 0 },
    };
  },
};

export type ApprovalRow = {
  id: string; kind: ApprovalKind; status: "pending" | "approved" | "declined"; reason: string; requestedBy: string; requestedAt: string;
  decidedBy: string | null; decidedAt: string | null; decisionNote: string | null;
  lotNumber: string | null; bundleNumber: string | null; workerName: string | null; entryId: string | null; pieces: number | null; amountMinor: number | null;
  /** Set when the actor may not approve it alone: the owner must. */
  aboveLimit: boolean; mine: boolean;
};

export const approvalsInbox: QueryDefinition<Record<string, never>, { rows: ApprovalRow[]; limits: Limits; canDecide: boolean; isOwner: boolean }> = {
  key: "verity.piecework.approvals_inbox",
  entity: ENTITY_PIECEWORK_APPROVAL,
  input: z.object({}),
  handler: async (ctx) => {
    const [rows, limits, canDecide, isOwner] = await Promise.all([
      ctx.tx.pieceworkApproval.findMany({ orderBy: { requestedAt: "desc" }, take: 80, include: { lot: { select: { number: true } }, bundle: { select: { number: true } }, worker: { select: { name: true } } } }),
      limitsOf(ctx.tx),
      hasTenantPermission(ctx.tx, ctx.actor.roleId, "ActionExecute", ENTITY_PIECEWORK_APPROVAL),
      hasTenantPermission(ctx.tx, ctx.actor.roleId, "Edit", ENTITY_PIECEWORK_SETTING),
    ]);
    const people = await ctx.tx.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.requestedById, r.decidedById].filter((x): x is string => !!x)))] } } , select: { id: true, party: { select: { displayName: true } } } });
    const nameOf = new Map(people.map((u) => [u.id, u.party.displayName]));
    const closeLots = [...new Set(rows.filter((r) => r.kind === "close" && r.status === "pending" && r.lotId).map((r) => r.lotId!))];
    const shortOf = new Map<string, number>();
    for (const id of closeLots) shortOf.set(id, await lotShortPieces(ctx.tx, id));
    return {
      limits, canDecide, isOwner,
      rows: rows.map((r) => ({
        id: r.id, kind: r.kind as ApprovalKind, status: r.status as ApprovalRow["status"], reason: r.reason, requestedBy: nameOf.get(r.requestedById) ?? "Someone", requestedAt: r.requestedAt.toISOString(),
        decidedBy: r.decidedById ? nameOf.get(r.decidedById) ?? "Someone" : null, decidedAt: r.decidedAt?.toISOString() ?? null, decisionNote: r.decisionNote,
        lotNumber: r.lot?.number ?? null, bundleNumber: r.bundle?.number ?? null, workerName: r.worker?.name ?? null, entryId: r.entryId, pieces: r.pieces, amountMinor: r.amountMinor,
        aboveLimit: !isOwner && withinLimit(limits, r, r.lotId ? shortOf.get(r.lotId) ?? 0 : 0) !== null, mine: r.requestedById === ctx.actor.userId,
      })),
    };
  },
};

export type TeamSetup = {
  limits: Limits; canEdit: boolean;
  stages: Array<{ id: string; label: string }>;
  members: Array<{ userId: string; name: string; role: string; allStages: boolean; stageIds: string[] }>;
  closes: Array<{ id: string; date: string; by: string; note: string | null; lang: string; summary: DaySummary }>;
};

export const teamSetup: QueryDefinition<Record<string, never>, TeamSetup> = {
  key: "verity.piecework.team_setup",
  entity: ENTITY_PIECEWORK_SETTING,
  input: z.object({}),
  handler: async (ctx) => {
    const [stages, memberships, assigns, closes, limits, canEdit] = await Promise.all([
      activeStages(ctx.tx),
      ctx.tx.tenantMembership.findMany({ where: { disabledAt: null }, include: { role: { select: { id: true, name: true } }, user: { select: { id: true, party: { select: { displayName: true } } } } } }),
      ctx.tx.pieceworkStageAssignment.findMany(),
      ctx.tx.pieceworkDayClose.findMany({ orderBy: [{ closeDate: "desc" }, { createdAt: "desc" }], take: 14 }),
      limitsOf(ctx.tx),
      hasTenantPermission(ctx.tx, ctx.actor.roleId, "Edit", ENTITY_PIECEWORK_SETTING),
    ]);
    const names = new Map(memberships.map((m) => [m.userId, m.user.party.displayName]));
    const members = [];
    for (const m of memberships) {
      members.push({
        userId: m.userId, name: m.user.party.displayName, role: m.role?.name ?? "No role",
        allStages: await hasTenantPermission(ctx.tx, m.roleId, "ActionExecute", STAGE_ENTITY), stageIds: assigns.filter((a) => a.userId === m.userId).map((a) => a.stageId),
      });
    }
    return {
      limits, canEdit, stages: stages.map((s) => ({ id: s.id, label: s.label })), members: members.sort((a, b) => a.name.localeCompare(b.name)),
      closes: closes.map((c) => ({ id: c.id, date: isoOf(c.closeDate), by: names.get(c.userId) ?? "Someone", note: c.note, lang: c.lang, summary: c.summary as DaySummary })),
    };
  },
};

/* ================================= day close ================================= */

export type DaySummary = {
  date: string; stages: string[]; given: number; takenBack: number; good: number; rejected: number; rework: number; short: number;
  late: Array<{ bundleNumber: string; workerName: string; stageLabel: string; open: number; dueDate: string | null }>; openShortages: number;
};

async function summaryFor(tx: Tx, actor: ActorContext, date: string): Promise<DaySummary> {
  const st = await floorState(tx, actor);
  const reg = await registers(tx, st);
  const rows = await tx.pieceworkEntry.findMany({ where: { entryDate: asDate(date) } });
  const mine = rows.filter((r) => inScope(st.scope, r.stageId));
  const sum = (f: (r: (typeof rows)[number]) => number) => mine.reduce((s, r) => s + (r.reversesId ? -1 : 1) * f(r), 0);
  return {
    date, stages: st.mine.map((s) => s.label),
    given: sum((r) => (r.kind === "issue" ? r.pieces : 0)), takenBack: sum((r) => (r.kind === "receive" ? r.pieces : 0)),
    good: sum((r) => r.goodPieces ?? 0), rejected: sum((r) => r.rejectedPieces ?? 0), rework: sum((r) => r.reworkPieces ?? 0), short: sum((r) => r.shortPieces ?? 0),
    late: st.issues.filter((i) => i.late).map((i) => ({ bundleNumber: i.bundleNumber, workerName: i.workerName, stageLabel: i.stageLabel, open: i.open, dueDate: i.dueDate })),
    openShortages: reg.shortages.filter((s) => s.open > 0).length,
  };
}

export const dayPreview: QueryDefinition<Record<string, never>, { summary: DaySummary; closed: { note: string | null; lang: string } | null }> = {
  key: "verity.piecework.day_preview",
  entity: ENTITY_PIECEWORK_DAY_CLOSE,
  input: z.object({}),
  handler: async (ctx) => {
    const today = await todayFor(ctx.tx);
    const done = await ctx.tx.pieceworkDayClose.findFirst({ where: { userId: ctx.actor.userId, closeDate: asDate(today) } });
    return { summary: done ? (done.summary as DaySummary) : await summaryFor(ctx.tx, ctx.actor, today), closed: done ? { note: done.note, lang: done.lang } : null };
  },
};

export const closeDay: CommandDefinition<{ note?: string; lang?: Lang }, { id: string }> = {
  key: "verity.piecework.close_day",
  entity: ENTITY_PIECEWORK_DAY_CLOSE,
  verb: "Create",
  input: z.object({ note: z.string().trim().max(600).optional(), lang: z.enum(LANGS).optional() }),
  preconditions: async (ctx) => {
    const today = await todayFor(ctx.tx);
    if (await ctx.tx.pieceworkDayClose.findFirst({ where: { userId: ctx.actor.userId, closeDate: asDate(today) }, select: { id: true } })) {
      throw new ValidationError("E_VALIDATION: you have already closed today; the summary is frozen");
    }
  },
  handler: async (ctx, input) => {
    const today = await todayFor(ctx.tx);
    const summary = await summaryFor(ctx.tx, ctx.actor, today);
    const row = await ctx.tx.pieceworkDayClose.create({
      data: { tenantId: ctx.actor.tenantId, userId: ctx.actor.userId, closeDate: asDate(today), summary: summary as never, note: input.note ?? null, lang: input.lang ?? "en" },
    });
    return { result: { id: row.id }, events: [{ name: "verity.piecework.day_closed", entityId: row.id }] };
  },
};

/* ============================== registration ============================== */

export function registerFloor(): void {
  registerCommand(setLimits);
  registerCommand(assignStages);
  registerCommand(requestApproval);
  registerCommand(decideApproval);
  registerCommand(closeDay);
  registerQuery(floorOverview);
  registerQuery(floorWorkers);
  registerQuery(floorRegister);
  registerQuery(floorKarigar);
  registerQuery(custodyBoard);
  registerQuery(approvalsInbox);
  registerQuery(teamSetup);
  registerQuery(dayPreview);
}
