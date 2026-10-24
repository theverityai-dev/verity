import { z } from "zod";
import type { QueryDefinition } from "@/server/platform/query";
import { hasTenantPermission } from "@/server/platform/authorization";
import { costPerGoodPiece, daysInStage, wageOf, workerMoney, type PaymentRow } from "./ledger";
import { LEDGER_SELECT, activeStages, isoOf, loadBundles, todayFor, toLedger, type Tx } from "./shared";
import { bundleRow, placementsOf, summariseLot, type BundleRow, type LotRow, type Placement } from "./index";

/**
 * The owner's dashboard and the reports (requirement sheet RP-03 to RP-07, RP-09, and costing and ready stock as far as
 * they can go before the later stages). Every figure is derived from the ledgers by `./ledger.ts`; nothing is stored.
 * Where the sheet leaves a definition open the figure is labelled, not guessed: costing here is WAGES ONLY, and a lot
 * is "overdue" when its due date has passed and it is not completed.
 */

const ENTITY_LOT = "verity.piecework.lot";
const ENTITY_WORKER = "verity.piecework.worker";
const ENTITY_BUNDLE = "verity.piecework.bundle";
const ENTITY_PAYMENT = "verity.piecework.payment";
const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

async function loadAll(tx: Tx) {
  const [stages, lots, workers, payments, allEntries, today] = await Promise.all([
    activeStages(tx),
    tx.pieceworkLot.findMany({ orderBy: { sequenceNo: "asc" } }),
    tx.pieceworkWorker.findMany({ orderBy: { name: "asc" } }),
    tx.pieceworkPayment.findMany({ select: { workerId: true, kind: true, amountMinor: true, reversesId: true, paidOn: true } }),
    tx.pieceworkEntry.findMany({ select: LEDGER_SELECT }),
    todayFor(tx),
  ]);
  const ledger = allEntries.map((e) => toLedger(e));
  const bundles = await loadBundles(tx, stages, { entries: ledger });
  const names = new Map(workers.map((w) => [w.id, w.name]));
  const lotNo = new Map(lots.map((l) => [l.id, l.number]));
  return { stages, lots, bundles, workers, payments, ledger, names, lotNo, today };
}

const toPayment = (p: { kind: string; amountMinor: number; reversesId: string | null }): PaymentRow => ({ kind: p.kind as PaymentRow["kind"], amountMinor: p.amountMinor, reversesId: p.reversesId });

/* ============================== today's entries ============================= */

export type RecentEntry = {
  id: string; time: string; lotNumber: string; bundleNumber: string; karigar: string; stage: string;
  kind: "issue" | "receive"; pieces: number; good: number; rejected: number; rework: number; short: number; isReversal: boolean;
};

/** What the munshi has entered for one business day (default today), newest first. */
export const recentEntries: QueryDefinition<{ date?: string }, RecentEntry[]> = {
  key: "verity.piecework.recent_entries",
  entity: ENTITY_LOT,
  input: z.object({ date: dateInput.optional() }),
  handler: async (ctx, input) => {
    const date = input.date ?? (await todayFor(ctx.tx));
    const rows = await ctx.tx.pieceworkEntry.findMany({
      where: { entryDate: new Date(`${date}T00:00:00.000Z`) },
      orderBy: { createdAt: "desc" },
      include: { lot: { select: { number: true } }, bundle: { select: { number: true } }, worker: { select: { name: true } }, stage: { select: { label: true } } },
    });
    return rows.map((r): RecentEntry => {
      const s = r.reversesId ? -1 : 1;
      return {
        id: r.id, time: r.createdAt.toISOString(), lotNumber: r.lot.number, bundleNumber: r.bundle.number, karigar: r.worker.name, stage: r.stage.label,
        kind: r.kind as "issue" | "receive", pieces: s * r.pieces, good: s * (r.goodPieces ?? 0), rejected: s * (r.rejectedPieces ?? 0), rework: s * (r.reworkPieces ?? 0), short: s * (r.shortPieces ?? 0),
        isReversal: r.reversesId !== null,
      };
    });
  },
};

/* ================================= dashboard ================================ */

export type Dashboard = {
  today: string;
  activeLots: Array<{ id: string; number: string; name: string | null; design: string; status: string; stageLabel: string | null; location: string; plannedPieces: number; bundledPieces: number; overdue: boolean }>;
  /** Bundles whose current stage is each stage, and the pieces pending there. */
  byStage: Array<{ stageId: string; label: string; bundles: number; pending: number }>;
  withWorkers: Array<{ workerId: string; name: string; pieces: number }>;
  ready: { pieces: number; bundles: number; lots: number };
  /** The four quantity classes, kept apart as the sheet requires. */
  quality: { good: number; rejected: number; short: number; reworkOpen: number };
  lotWages: Array<{ lotId: string; number: string; wagesMinor: number }>;
  dues: { totalMinor: number; advanceOutstandingMinor: number; workers: Array<{ workerId: string; name: string; balanceMinor: number }> };
  stuck: Array<{ lotId: string; number: string; days: number | null }>;
  overdue: { lots: number; issues: number };
  /** Every live bundle of an open lot, for the floor board. */
  floor: Array<BundleRow & { lotName: string }>;
  /** Where each of those bundles' pieces stand, one row per bundle per stage. */
  placements: Placement[];
  /** Issues past their expected return date, the longest overdue first. */
  lateIssues: Array<{ bundleId: string; bundleNumber: string; lotNumber: string; workerId: string; workerName: string; stageLabel: string; open: number; dueDate: string; daysLate: number }>;
};

const daysBetween = (from: string, to: string) => Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));

export const dashboard: QueryDefinition<Record<string, never>, Dashboard> = {
  key: "verity.piecework.dashboard",
  entity: ENTITY_LOT,
  input: z.object({}),
  handler: async (ctx) => {
    const d = await loadAll(ctx.tx);
    const live = d.lots.filter((l) => !l.cancelledAt);
    const open = live.filter((l) => ["draft", "active", "hold"].includes(l.status));
    const bundlesOf = (lotId: string) => d.bundles.filter((b) => b.lotId === lotId && !b.cancelledAt);

    const activeLots = open.map((l) => {
      const row = summariseLot(l, d.bundles.filter((b) => b.lotId === l.id), d.stages, d.names, d.today);
      return { id: l.id, number: l.number, name: l.name, design: l.design, status: row.status, stageLabel: row.stageLabel, location: row.location, plannedPieces: l.plannedPieces, bundledPieces: row.bundledPieces, overdue: row.overdue };
    });

    const openBundles = open.flatMap((l) => bundlesOf(l.id));
    const byStage = d.stages.map((s) => ({
      stageId: s.id, label: s.label,
      bundles: openBundles.filter((b) => b.position.currentStageId === s.id).length,
      pending: openBundles.reduce((sum, b) => sum + (b.position.stages.find((p) => p.stageId === s.id)?.pending ?? 0), 0),
    }));

    const held = new Map<string, number>();
    for (const b of openBundles) for (const s of b.position.stages) for (const [id, w] of s.byWorker) held.set(id, (held.get(id) ?? 0) + w.pending);
    const withWorkers = [...held].filter(([, pieces]) => pieces > 0).map(([workerId, pieces]) => ({ workerId, name: d.names.get(workerId) ?? "A worker", pieces })).sort((a, b) => b.pieces - a.pieces);

    const liveBundles = live.flatMap((l) => bundlesOf(l.id));
    const ready = {
      pieces: liveBundles.reduce((s, b) => s + b.position.ready, 0),
      bundles: liveBundles.filter((b) => b.position.ready > 0).length,
      lots: live.filter((l) => bundlesOf(l.id).some((b) => b.position.ready > 0)).length,
    };
    const quality = {
      good: ready.pieces,
      rejected: liveBundles.reduce((s, b) => s + b.position.rejected, 0),
      short: liveBundles.reduce((s, b) => s + b.position.short, 0),
      reworkOpen: liveBundles.reduce((s, b) => s + b.position.reworkOpen, 0),
    };

    // One pass over the ledger, not one per lot: with a year of history the per-lot scan was quadratic and took the page past
    // its transaction limit.
    const lotOfBundle = new Map(d.bundles.map((b) => [b.id, b.lotId]));
    const wageByLot = new Map<string, number>();
    for (const e of d.ledger) {
      const lotId = e.bundleId ? lotOfBundle.get(e.bundleId) : undefined;
      if (lotId) wageByLot.set(lotId, (wageByLot.get(lotId) ?? 0) + wageOf(e));
    }
    const lotWages = live.map((l) => ({ lotId: l.id, number: l.number, wagesMinor: wageByLot.get(l.id) ?? 0 })).filter((l) => l.wagesMinor !== 0);

    const people = d.workers.map((w) => ({
      workerId: w.id, name: w.name,
      money: workerMoney(d.ledger.filter((e) => e.workerId === w.id), d.payments.filter((p) => p.workerId === w.id).map(toPayment)),
    }));
    const dueWorkers = people.filter((p) => p.money.balanceMinor !== 0).map((p) => ({ workerId: p.workerId, name: p.name, balanceMinor: p.money.balanceMinor })).sort((a, b) => b.balanceMinor - a.balanceMinor);
    // A reader without the payment grant (a supervisor) gets the floor figures and no money at all: not hidden by the page,
    // absent from the answer, so a direct call to this query cannot recover a wage or a balance.
    const mayReadMoney = await hasTenantPermission(ctx.tx, ctx.actor.roleId, "Read", ENTITY_PAYMENT);

    const stuck = open
      .map((l) => ({ lotId: l.id, number: l.number, days: summariseLot(l, d.bundles.filter((b) => b.lotId === l.id), d.stages, d.names, d.today).daysSinceMovement }))
      .sort((a, b) => (b.days ?? -1) - (a.days ?? -1));

    const overdueIssues = openBundles.reduce((sum, b) => sum + b.position.stages.reduce((s, p) => s + p.issues.filter((i) => i.open > 0 && i.dueDate !== null && i.dueDate < d.today).length, 0), 0);

    const lotName = new Map(d.lots.map((l) => [l.id, l.name ?? l.design]));
    const floor = openBundles.map((b) => ({ ...bundleRow(b, d.lotNo.get(b.lotId) ?? "", d.stages, d.names, d.today), lotName: lotName.get(b.lotId) ?? "" }));
    const placements = openBundles.flatMap((b) => placementsOf(b, d.lotNo.get(b.lotId) ?? "", lotName.get(b.lotId) ?? "", d.names, d.today));
    const lateIssues = openBundles
      .flatMap((b) =>
        b.position.stages.flatMap((s) =>
          s.issues
            .filter((i) => i.open > 0 && i.dueDate !== null && i.dueDate < d.today)
            .map((i) => ({
              bundleId: b.id, bundleNumber: b.number, lotNumber: d.lotNo.get(b.lotId) ?? "", workerId: i.workerId, workerName: d.names.get(i.workerId) ?? "A worker",
              stageLabel: s.label, open: i.open, dueDate: i.dueDate!, daysLate: daysBetween(i.dueDate!, d.today),
            })),
        ),
      )
      .sort((a, b) => b.daysLate - a.daysLate);

    return {
      today: d.today, activeLots, byStage, withWorkers, ready, quality,
      lotWages: mayReadMoney ? lotWages : [],
      dues: mayReadMoney
        ? { totalMinor: dueWorkers.reduce((s, w) => s + w.balanceMinor, 0), advanceOutstandingMinor: people.reduce((s, p) => s + p.money.advanceOutstandingMinor, 0), workers: dueWorkers }
        : { totalMinor: 0, advanceOutstandingMinor: 0, workers: [] },
      stuck, overdue: { lots: activeLots.filter((l) => l.overdue).length, issues: overdueIssues }, floor, placements, lateIssues,
    };
  },
};

/* ================================== reports ================================= */

/** RP-03 Lot status: planned against actual, stage, due date, ageing. */
export const reportLotStatus: QueryDefinition<Record<string, never>, Array<LotRow & { ageDays: number }>> = {
  key: "verity.piecework.report_lot_status",
  entity: ENTITY_LOT,
  input: z.object({}),
  handler: async (ctx) => {
    const d = await loadAll(ctx.tx);
    return d.lots.filter((l) => !l.cancelledAt).map((l) => {
      const row = summariseLot(l, d.bundles.filter((b) => b.lotId === l.id), d.stages, d.names, d.today);
      return { ...row, ageDays: Math.max(0, Math.round((Date.parse(`${d.today}T00:00:00Z`) - Date.parse(`${isoOf(l.createdAt)}T00:00:00Z`)) / 86_400_000)) };
    });
  },
};

/** RP-04 Bundle location: current stage, who holds it, last movement and ageing. */
export const reportBundleLocation: QueryDefinition<Record<string, never>, BundleRow[]> = {
  key: "verity.piecework.report_bundle_location",
  entity: ENTITY_BUNDLE,
  input: z.object({}),
  handler: async (ctx) => {
    const d = await loadAll(ctx.tx);
    return d.bundles.filter((b) => !b.cancelledAt).map((b) => bundleRow(b, d.lotNo.get(b.lotId) ?? "", d.stages, d.names, d.today));
  },
};

export type WorkInHandRow = { workerId: string; karigar: string; lotNumber: string; bundleNumber: string; stage: string; issued: number; returned: number; open: number; dueDate: string | null; overdue: boolean; isRework: boolean };

/** RP-05 Karigar work in hand: issued, returned (accounted for) and still out, by worker, lot, bundle and stage. */
export const reportWorkInHand: QueryDefinition<Record<string, never>, WorkInHandRow[]> = {
  key: "verity.piecework.report_work_in_hand",
  entity: ENTITY_WORKER,
  input: z.object({}),
  handler: async (ctx) => {
    const d = await loadAll(ctx.tx);
    return d.bundles.filter((b) => !b.cancelledAt).flatMap((b) =>
      b.position.stages.flatMap((s) =>
        s.issues.filter((i) => i.open > 0).map((i) => ({
          workerId: i.workerId, karigar: d.names.get(i.workerId) ?? "A worker", lotNumber: d.lotNo.get(b.lotId) ?? "", bundleNumber: b.number, stage: s.label,
          issued: i.issued, returned: i.issued - i.open, open: i.open, dueDate: i.dueDate, overdue: i.dueDate !== null && i.dueDate < d.today, isRework: i.isRework,
        })),
      ),
    );
  },
};

export type WagePaymentRow = {
  workerId: string; karigar: string; mobile: string | null; workTypes: string; wagesMinor: number; advanceGivenMinor: number; recoveredMinor: number; deductionMinor: number; paidMinor: number; balanceMinor: number; advanceOutstandingMinor: number;
};

/** RP-06 Karigar wage ledger: gross wages, advances, recoveries, deductions, payments and balance, for a period. */
export const reportWagePayment: QueryDefinition<{ from?: string; to?: string }, { rows: WagePaymentRow[]; period: { from: string | null; to: string | null } }> = {
  key: "verity.piecework.report_wage_payment",
  entity: ENTITY_WORKER,
  input: z.object({ from: dateInput.optional(), to: dateInput.optional() }),
  handler: async (ctx, input) => {
    const d = await loadAll(ctx.tx);
    const within = (date: string) => (!input.from || date >= input.from) && (!input.to || date <= input.to);
    const rows = d.workers.map((w): WagePaymentRow => {
      const mine = d.ledger.filter((e) => e.workerId === w.id && within(e.entryDate));
      const pays = d.payments.filter((p) => p.workerId === w.id && within(isoOf(p.paidOn))).map(toPayment);
      const stageIds = new Set(mine.filter((e) => e.kind === "receive").map((e) => e.stageId));
      return { workerId: w.id, karigar: w.name, mobile: w.mobile, workTypes: d.stages.filter((s) => stageIds.has(s.id)).map((s) => s.label).join(", "), ...workerMoney(mine, pays) };
    });
    const touched = (r: WagePaymentRow) => r.wagesMinor !== 0 || r.advanceGivenMinor !== 0 || r.recoveredMinor !== 0 || r.deductionMinor !== 0 || r.paidMinor !== 0;
    return { rows: rows.filter(touched), period: { from: input.from ?? null, to: input.to ?? null } };
  },
};

export type QualityRow = { workerId: string; date: string; lotNumber: string; bundleNumber: string; karigar: string; stage: string; rejected: number; rework: number; short: number; note: string | null };

/** RP-07 Short, reject and rework: separate totals, by line, with the rework still waiting. */
export const reportQuality: QueryDefinition<{ from?: string; to?: string }, { rows: QualityRow[]; totals: { rejected: number; rework: number; short: number; reworkOpen: number } }> = {
  key: "verity.piecework.report_quality",
  entity: ENTITY_LOT,
  input: z.object({ from: dateInput.optional(), to: dateInput.optional() }),
  handler: async (ctx, input) => {
    const d = await loadAll(ctx.tx);
    const within = (date: string) => (!input.from || date >= input.from) && (!input.to || date <= input.to);
    const bundleById = new Map(d.bundles.map((b) => [b.id, b]));
    const stageLabel = new Map(d.stages.map((s) => [s.id, s.label]));
    const raw = await ctx.tx.pieceworkEntry.findMany({ where: { kind: "receive" }, orderBy: { entryDate: "desc" } });
    const rows = raw
      .filter((r) => r.reversesId === null && ((r.rejectedPieces ?? 0) + (r.reworkPieces ?? 0) + (r.shortPieces ?? 0)) > 0 && within(isoOf(r.entryDate)))
      .map((r): QualityRow => ({
        workerId: r.workerId, date: isoOf(r.entryDate), lotNumber: d.lotNo.get(r.lotId) ?? "", bundleNumber: bundleById.get(r.bundleId)?.number ?? "", karigar: d.names.get(r.workerId) ?? "A worker",
        stage: stageLabel.get(r.stageId) ?? "", rejected: r.rejectedPieces ?? 0, rework: r.reworkPieces ?? 0, short: r.shortPieces ?? 0, note: r.note,
      }));
    const live = d.bundles.filter((b) => !b.cancelledAt);
    return {
      rows,
      totals: {
        rejected: live.reduce((s, b) => s + b.position.rejected, 0),
        rework: live.reduce((s, b) => s + b.position.stages.reduce((x, p) => x + p.rework, 0), 0),
        short: live.reduce((s, b) => s + b.position.short, 0),
        reworkOpen: live.reduce((s, b) => s + b.position.reworkOpen, 0),
      },
    };
  },
};

export type ProcessRow = { stage: string; sent: number; received: number; accepted: number; pending: number; avgCycleDays: number | null };

/** RP-09 Production by process: sent, received (accounted for), accepted (good), pending, and the average days a closed issue took. */
export const reportProductionByProcess: QueryDefinition<Record<string, never>, ProcessRow[]> = {
  key: "verity.piecework.report_production_by_process",
  entity: ENTITY_LOT,
  input: z.object({}),
  handler: async (ctx) => {
    const d = await loadAll(ctx.tx);
    const live = d.bundles.filter((b) => !b.cancelledAt);
    return d.stages.map((s) => {
      // A lot whose rate card skips this stage has no such stage in its route, so its bundles simply do not appear in this row.
      const ps = live.flatMap((b) => b.position.stages.filter((p) => p.stageId === s.id));
      const closed = ps.filter((p) => p.pending === 0 && p.issuedNormal + p.issuedRework > 0).map((p) => daysInStage(p, d.today)).filter((x): x is number => x !== null);
      return {
        stage: s.label,
        sent: ps.reduce((x, p) => x + p.issuedNormal + p.issuedRework, 0), received: ps.reduce((x, p) => x + p.accounted, 0),
        accepted: ps.reduce((x, p) => x + p.good, 0), pending: ps.reduce((x, p) => x + p.pending, 0),
        avgCycleDays: closed.length === 0 ? null : Math.round((closed.reduce((a, b) => a + b, 0) / closed.length) * 10) / 10,
      };
    });
  },
};

export type CostingRow = {
  lotNumber: string; design: string; plannedPieces: number; goodPieces: number; rejectedPieces: number; reworkPieces: number; shortPieces: number;
  wagesMinor: number;
  /** Fabric at each roll's invoice rate (null when no roll carried a rate), other costs by category, less charges recovered. */
  fabricMinor: number | null; otherMinor: number; recoveredMinor: number; totalMinor: number; perGoodPieceMinor: number | null;
};

/** Lot cost so far: fabric + wages + other costs - charges recovered. Cost per good piece = cost / good finished pieces, losses beside it. */
export const reportCosting: QueryDefinition<Record<string, never>, CostingRow[]> = {
  key: "verity.piecework.report_costing",
  // Wages only, so it is a money report: the same grant as the wage ledger.
  entity: ENTITY_PAYMENT,
  input: z.object({}),
  handler: async (ctx) => {
    const d = await loadAll(ctx.tx);
    // The other parts of cost, read once for every lot rather than once per lot.
    const [costs, recovered, moves] = await Promise.all([
      ctx.tx.pieceworkLotCost.findMany({ select: { lotId: true, amountMinor: true, reversesId: true } }),
      ctx.tx.pieceworkApproval.findMany({ where: { kind: "deduction", status: "approved", entryId: { not: null } }, select: { lotId: true, amountMinor: true } }),
      ctx.tx.pieceworkRollMove.findMany({ where: { kind: { in: ["issue", "return"] } }, select: { lotId: true, deltaCenti: true, roll: { select: { rateMinor: true } } } }),
    ]);
    const sumBy = <T,>(rows: T[], key: (r: T) => string | null, value: (r: T) => number) => {
      const m = new Map<string, number>();
      for (const r of rows) { const k = key(r); if (k) m.set(k, (m.get(k) ?? 0) + value(r)); }
      return m;
    };
    const other = sumBy(costs, (c) => c.lotId, (c) => (c.reversesId ? -1 : 1) * c.amountMinor);
    const back = sumBy(recovered, (a) => a.lotId, (a) => a.amountMinor ?? 0);
    const priced = moves.filter((m) => m.roll.rateMinor !== null);
    const fabric = sumBy(priced, (m) => m.lotId, (m) => Math.round((-m.deltaCenti * m.roll.rateMinor!) / 100));
    return d.lots.filter((l) => !l.cancelledAt).map((l): CostingRow => {
      const mine = d.bundles.filter((b) => b.lotId === l.id && !b.cancelledAt);
      const ids = new Set(mine.map((b) => b.id));
      const wagesMinor = d.ledger.filter((e) => ids.has(e.bundleId)).reduce((s, e) => s + wageOf(e), 0);
      const good = mine.reduce((s, b) => s + b.position.ready, 0);
      const total = (fabric.get(l.id) ?? 0) + wagesMinor + (other.get(l.id) ?? 0) - (back.get(l.id) ?? 0);
      return {
        lotNumber: l.number, design: l.design, plannedPieces: l.plannedPieces, goodPieces: good,
        rejectedPieces: mine.reduce((s, b) => s + b.position.rejected, 0), reworkPieces: mine.reduce((s, b) => s + b.position.reworkOpen, 0), shortPieces: mine.reduce((s, b) => s + b.position.short, 0),
        wagesMinor, fabricMinor: fabric.get(l.id) ?? null, otherMinor: other.get(l.id) ?? 0, recoveredMinor: back.get(l.id) ?? 0,
        totalMinor: total, perGoodPieceMinor: costPerGoodPiece(total, good),
      };
    });
  },
};

export type ReadyRow = { lotNumber: string; design: string; readyPieces: number; readyBundles: number; readySince: string | null };

/** Ready stock by lot. Packing and dispatch arrive with their own stage; until then this is "reached ready". */
export const reportReadyInventory: QueryDefinition<Record<string, never>, ReadyRow[]> = {
  key: "verity.piecework.report_ready_inventory",
  entity: ENTITY_LOT,
  input: z.object({}),
  handler: async (ctx) => {
    const d = await loadAll(ctx.tx);
    return d.lots.filter((l) => !l.cancelledAt).flatMap((l): ReadyRow[] => {
      const mine = d.bundles.filter((b) => b.lotId === l.id && !b.cancelledAt && b.position.ready > 0);
      if (mine.length === 0) return [];
      const since = mine.map((b) => b.position.stages.at(-1)?.lastReceiveDate ?? null).filter((x): x is string => x !== null).sort().at(-1) ?? null;
      return [{ lotNumber: l.number, design: l.design, readyPieces: mine.reduce((s, b) => s + b.position.ready, 0), readyBundles: mine.length, readySince: since }];
    });
  },
};
