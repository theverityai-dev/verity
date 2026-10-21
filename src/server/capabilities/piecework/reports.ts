import { z } from "zod";
import type { QueryDefinition } from "@/server/platform/query";
import {
  bundlesOf,
  computePosition,
  daysInStage,
  daysSinceMovement,
  signedPieces,
  workerMoney,
  wageOf,
  type LedgerEntry,
  type LotPosition,
  type PaymentRow,
} from "./ledger";
import { activeStages, isoOf, todayFor, toLedger, type Tx } from "./shared";

/**
 * The owner's dashboard and the four reports (PRD S6, S7). Every figure is derived from the ledgers by
 * `./ledger.ts`; nothing is stored. Where the PRD leaves a definition open the figure is labelled, not guessed:
 * costing here is WAGES ONLY (cloth and other costs are "to confirm" with the client), and "stuck" is days since
 * the lot last moved with no alert threshold.
 */

const ENTITY_LOT = "verity.piecework.lot";
const ENTITY_WORKER = "verity.piecework.worker";

type LoadedLot = {
  id: string; number: string; design: string; totalPieces: number; bundleSize: number; cancelledAt: Date | null; createdAt: Date;
  entries: LedgerEntry[]; position: LotPosition;
};

async function loadAll(tx: Tx) {
  const [stages, lots, entries, workers, payments, today] = await Promise.all([
    activeStages(tx),
    tx.pieceworkLot.findMany({ orderBy: { sequenceNo: "asc" } }),
    tx.pieceworkEntry.findMany(),
    tx.pieceworkWorker.findMany({ orderBy: { name: "asc" } }),
    tx.pieceworkPayment.findMany(),
    todayFor(tx),
  ]);
  const byLot = new Map<string, LedgerEntry[]>();
  for (const e of entries) byLot.set(e.lotId, [...(byLot.get(e.lotId) ?? []), toLedger(e)]);
  const loaded: LoadedLot[] = lots.map((l) => {
    const rows = byLot.get(l.id) ?? [];
    return { ...l, entries: rows, position: computePosition(l.totalPieces, stages, rows) };
  });
  const names = new Map(workers.map((w) => [w.id, w.name]));
  return { stages, lots: loaded, entries: entries.map(toLedger), workers, payments, names, today };
}

const isOpen = (l: LoadedLot) => !l.cancelledAt && l.position.ready < l.position.totalPieces;

const toPayment = (p: { kind: string; amountMinor: number; reversesId: string | null }): PaymentRow => ({
  kind: p.kind as PaymentRow["kind"],
  amountMinor: p.amountMinor,
  reversesId: p.reversesId,
});

/* ============================== today's entries ============================= */

export type RecentEntry = {
  id: string; time: string; lotNumber: string; karigar: string; stage: string;
  kind: "issue" | "receive"; pieces: number; bundles: number; isReversal: boolean;
};

/** What the munshi has entered for one business day (default today), newest first. */
export const recentEntries: QueryDefinition<{ date?: string }, RecentEntry[]> = {
  key: "verity.piecework.recent_entries",
  entity: ENTITY_LOT,
  input: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  handler: async (ctx, input) => {
    const date = input.date ?? (await todayFor(ctx.tx));
    const rows = await ctx.tx.pieceworkEntry.findMany({
      where: { entryDate: new Date(`${date}T00:00:00.000Z`) },
      orderBy: { createdAt: "desc" },
      include: { lot: { select: { number: true, bundleSize: true } }, worker: { select: { name: true } }, stage: { select: { label: true } } },
    });
    return rows.map((r): RecentEntry => ({
      id: r.id,
      time: r.createdAt.toISOString(),
      lotNumber: r.lot.number,
      karigar: r.worker.name,
      stage: r.stage.label,
      kind: r.kind as "issue" | "receive",
      pieces: signedPieces(r),
      bundles: bundlesOf(r.pieces, r.lot.bundleSize) * (r.reversesId ? -1 : 1),
      isReversal: r.reversesId !== null,
    }));
  },
};

/* ================================= dashboard ================================ */

export type Dashboard = {
  today: string;
  /** Lots not yet fully in ready stock, with where they are. */
  activeLots: Array<{ id: string; number: string; design: string; totalPieces: number; stageLabel: string | null; location: string }>;
  pendingByStage: Array<{ stageId: string; label: string; pending: number }>;
  withWorkers: Array<{ workerId: string; name: string; pieces: number }>;
  ready: { pieces: number; bundles: number; lots: number };
  /** Wages earned per lot. Cloth and other costs are not known yet; this is not a full lot cost. */
  lotWages: Array<{ lotId: string; number: string; wagesMinor: number }>;
  dues: { totalMinor: number; workers: Array<{ workerId: string; name: string; balanceMinor: number }> };
  /** Days since each open lot last moved, longest first. No alert threshold is applied. */
  stuck: Array<{ lotId: string; number: string; days: number | null }>;
};

export const dashboard: QueryDefinition<Record<string, never>, Dashboard> = {
  key: "verity.piecework.dashboard",
  entity: ENTITY_LOT,
  input: z.object({}),
  handler: async (ctx) => {
    const d = await loadAll(ctx.tx);
    const open = d.lots.filter(isOpen);

    const activeLots = open.map((l) => {
      const current = l.position.stages.find((s) => s.stageId === l.position.currentStageId) ?? null;
      const holders = current ? [...current.byWorker].filter(([, w]) => w.pending > 0).map(([id]) => d.names.get(id) ?? "A worker") : [];
      return {
        id: l.id, number: l.number, design: l.design, totalPieces: l.totalPieces,
        stageLabel: current?.label ?? null,
        location: holders.length > 0 ? `With ${holders.join(", ")}` : l.position.stages.every((s) => s.issued === 0) ? "Not started" : "Waiting to be issued",
      };
    });

    const pendingByStage = d.stages.map((s) => ({
      stageId: s.id,
      label: s.label,
      pending: open.reduce((sum, l) => sum + (l.position.stages.find((p) => p.stageId === s.id)?.pending ?? 0), 0),
    }));

    const held = new Map<string, number>();
    for (const l of open) for (const s of l.position.stages) for (const [id, w] of s.byWorker) held.set(id, (held.get(id) ?? 0) + w.pending);
    const withWorkers = [...held]
      .filter(([, pieces]) => pieces > 0)
      .map(([workerId, pieces]) => ({ workerId, name: d.names.get(workerId) ?? "A worker", pieces }))
      .sort((a, b) => b.pieces - a.pieces);

    const live = d.lots.filter((l) => !l.cancelledAt);
    const ready = {
      pieces: live.reduce((sum, l) => sum + l.position.ready, 0),
      bundles: live.reduce((sum, l) => sum + bundlesOf(l.position.ready, l.bundleSize), 0),
      lots: live.filter((l) => l.position.ready > 0).length,
    };

    const lotWages = live
      .map((l) => ({ lotId: l.id, number: l.number, wagesMinor: l.entries.reduce((sum, e) => sum + wageOf(e), 0) }))
      .filter((l) => l.wagesMinor !== 0);

    const dueWorkers = d.workers
      .map((w) => ({
        workerId: w.id,
        name: w.name,
        balanceMinor: workerMoney(
          d.entries.filter((e) => e.workerId === w.id && e.kind === "receive"),
          d.payments.filter((p) => p.workerId === w.id).map(toPayment),
        ).balanceMinor,
      }))
      .filter((w) => w.balanceMinor !== 0)
      .sort((a, b) => b.balanceMinor - a.balanceMinor);

    const stuck = open
      .map((l) => ({ lotId: l.id, number: l.number, days: daysSinceMovement(l.position, d.today) }))
      .sort((a, b) => (b.days ?? -1) - (a.days ?? -1));

    return {
      today: d.today,
      activeLots,
      pendingByStage,
      withWorkers,
      ready,
      lotWages,
      dues: { totalMinor: dueWorkers.reduce((sum, w) => sum + w.balanceMinor, 0), workers: dueWorkers },
      stuck,
    };
  },
};

/* ================================== reports ================================= */

export type ProductionRow = {
  lotNumber: string; design: string; totalPieces: number; stage: string;
  issued: number; received: number; pending: number; stageStart: string | null; daysInStage: number | null; location: string;
};

export const reportLotProduction: QueryDefinition<Record<string, never>, ProductionRow[]> = {
  key: "verity.piecework.report_lot_production",
  entity: ENTITY_LOT,
  input: z.object({}),
  handler: async (ctx) => {
    const d = await loadAll(ctx.tx);
    return d.lots
      .filter((l) => !l.cancelledAt)
      .flatMap((l) =>
        l.position.stages.map((s) => {
          const holders = [...s.byWorker].filter(([, w]) => w.pending > 0).map(([id]) => d.names.get(id) ?? "A worker");
          return {
            lotNumber: l.number, design: l.design, totalPieces: l.totalPieces, stage: s.label,
            issued: s.issued, received: s.received, pending: s.pending,
            stageStart: s.firstIssueDate, daysInStage: daysInStage(s, d.today),
            location: holders.length > 0 ? `With ${holders.join(", ")}` : s.issued === 0 ? "Not reached" : "All received",
          };
        }),
      );
  },
};

export type WorkerPaymentRow = {
  karigar: string; mobile: string | null; workTypes: string; given: number; returned: number;
  wagesMinor: number; advanceMinor: number; paidMinor: number; balanceMinor: number;
};

const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

export const reportWorkerPayment: QueryDefinition<
  { from?: string; to?: string },
  { rows: WorkerPaymentRow[]; period: { from: string | null; to: string | null } }
> = {
  key: "verity.piecework.report_worker_payment",
  entity: ENTITY_WORKER,
  input: z.object({ from: dateInput.optional(), to: dateInput.optional() }),
  handler: async (ctx, input) => {
    const d = await loadAll(ctx.tx);
    const within = (date: string) => (!input.from || date >= input.from) && (!input.to || date <= input.to);
    const rows = d.workers.map((w): WorkerPaymentRow => {
      const mine = d.entries.filter((e) => e.workerId === w.id && within(e.entryDate));
      const pays = d.payments.filter((p) => p.workerId === w.id && within(isoOf(p.paidOn))).map(toPayment);
      const money = workerMoney(mine.filter((e) => e.kind === "receive"), pays);
      const stageIds = new Set(mine.filter((e) => e.kind === "receive").map((e) => e.stageId));
      return {
        karigar: w.name,
        mobile: w.mobile,
        workTypes: d.stages.filter((s) => stageIds.has(s.id)).map((s) => s.label).join(", "),
        given: mine.reduce((s, e) => s + (e.kind === "issue" ? signedPieces(e) : 0), 0),
        returned: mine.reduce((s, e) => s + (e.kind === "receive" ? signedPieces(e) : 0), 0),
        ...money,
      };
    });
    return {
      rows: rows.filter((r) => r.given !== 0 || r.returned !== 0 || r.wagesMinor !== 0 || r.advanceMinor !== 0 || r.paidMinor !== 0),
      period: { from: input.from ?? null, to: input.to ?? null },
    };
  },
};

export type CostingRow = {
  lotNumber: string; design: string; totalPieces: number; wagesMinor: number;
  /** Not known until the client says what costing includes. Null, never zero. */
  clothMinor: null; otherMinor: null; totalMinor: number; wagePerReadyPieceMinor: number | null;
};

export const reportCosting: QueryDefinition<Record<string, never>, CostingRow[]> = {
  key: "verity.piecework.report_costing",
  entity: ENTITY_LOT,
  input: z.object({}),
  handler: async (ctx) => {
    const d = await loadAll(ctx.tx);
    return d.lots
      .filter((l) => !l.cancelledAt)
      .map((l): CostingRow => {
        const wagesMinor = l.entries.reduce((sum, e) => sum + wageOf(e), 0);
        return {
          lotNumber: l.number, design: l.design, totalPieces: l.totalPieces, wagesMinor,
          clothMinor: null, otherMinor: null, totalMinor: wagesMinor,
          wagePerReadyPieceMinor: l.position.ready > 0 ? Math.round(wagesMinor / l.position.ready) : null,
        };
      });
  },
};

export type ReadyRow = { lotNumber: string; design: string; readyPieces: number; readyBundles: number; readySince: string | null };

export const reportReadyInventory: QueryDefinition<Record<string, never>, ReadyRow[]> = {
  key: "verity.piecework.report_ready_inventory",
  entity: ENTITY_LOT,
  input: z.object({}),
  handler: async (ctx) => {
    const d = await loadAll(ctx.tx);
    return d.lots
      .filter((l) => !l.cancelledAt && l.position.ready > 0)
      .map((l): ReadyRow => ({
        lotNumber: l.number, design: l.design, readyPieces: l.position.ready,
        readyBundles: bundlesOf(l.position.ready, l.bundleSize),
        readySince: l.position.stages.at(-1)?.lastReceiveDate ?? null,
      }));
  },
};
