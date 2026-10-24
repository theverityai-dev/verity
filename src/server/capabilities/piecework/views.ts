import { z } from "zod";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { activeStages, isoOf, loadBundles, lotCovers, todayFor, type Tx } from "./shared";

/**
 * Read-only views over the ledgers for the Stylified flow: the printed challan, the cases a supervisor must answer, and the ready
 * garments. None of them carries a rate, a wage or a balance, so a supervisor may read them; a charge shows its STATUS only.
 */

const ENTRY_ENTITY = "verity.piecework.entry";
const LOT_ENTITY = "verity.piecework.lot";
const uuid = z.string().uuid();

const daysBetween = (from: string, to: string) => Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));

async function userNames(tx: Tx, ids: string[]): Promise<Map<string, string>> {
  const rows = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, party: { select: { displayName: true } } } });
  return new Map(rows.map((u) => [u.id, u.party.displayName]));
}

/* ================================== challan ================================== */

export type ChallanLine = {
  entryId: string; kind: "issue" | "receive"; bundleNumber: string; sizeNote: string | null; lotNumber: string; design: string; stageLabel: string;
  sent: number | null; counted: number; good: number; rejected: number; rework: number; short: number; isRework: boolean; note: string | null; ackMethod: string | null;
};
export type Challan = {
  number: string; date: string; heading: { title: string | null; address: string | null };
  worker: { id: string; name: string; mobile: string | null }; preparedBy: string; lines: ChallanLine[];
  totalSent: number; totalCounted: number; differences: number;
};

export const challanSheet: QueryDefinition<{ number: string }, Challan | null> = {
  key: "verity.piecework.challan_sheet",
  entity: ENTRY_ENTITY,
  input: z.object({ number: z.string().trim().regex(/^CH-\d{4,}$/) }),
  handler: async (ctx, input) => {
    const rows = await ctx.tx.pieceworkEntry.findMany({ where: { challanNumber: input.number, reversesId: null }, orderBy: { createdAt: "asc" } });
    if (rows.length === 0) return null;
    const reversed = new Set((await ctx.tx.pieceworkEntry.findMany({ where: { reversesId: { in: rows.map((r) => r.id) } }, select: { reversesId: true } })).map((r) => r.reversesId!));
    const live = rows.filter((r) => !reversed.has(r.id));
    if (live.length === 0) return null;
    const [bundles, lots, stages, worker, setting, users] = await Promise.all([
      ctx.tx.pieceworkBundle.findMany({ where: { id: { in: live.map((r) => r.bundleId) } }, select: { id: true, number: true, sizeNote: true } }),
      ctx.tx.pieceworkLot.findMany({ where: { id: { in: live.map((r) => r.lotId) } }, select: { id: true, number: true, design: true } }),
      ctx.tx.pieceworkStage.findMany({ select: { id: true, label: true } }),
      ctx.tx.pieceworkWorker.findUniqueOrThrow({ where: { id: live[0]!.workerId }, select: { id: true, name: true, mobile: true } }),
      ctx.tx.pieceworkSetting.findFirst({ select: { challanTitle: true, challanAddress: true } }),
      userNames(ctx.tx, [live[0]!.enteredById]),
    ]);
    const b = new Map(bundles.map((x) => [x.id, x]));
    const l = new Map(lots.map((x) => [x.id, x]));
    const s = new Map(stages.map((x) => [x.id, x.label]));
    const lines = live.map((r): ChallanLine => ({
      entryId: r.id, kind: r.kind as "issue" | "receive", bundleNumber: b.get(r.bundleId)?.number ?? "", sizeNote: b.get(r.bundleId)?.sizeNote ?? null,
      lotNumber: l.get(r.lotId)?.number ?? "", design: l.get(r.lotId)?.design ?? "", stageLabel: s.get(r.stageId) ?? "",
      sent: r.kind === "issue" ? r.sentPieces ?? r.pieces : null, counted: r.pieces,
      good: r.goodPieces ?? 0, rejected: r.rejectedPieces ?? 0, rework: r.reworkPieces ?? 0, short: r.shortPieces ?? 0,
      isRework: r.isRework, note: r.note, ackMethod: r.ackMethod,
    }));
    const issues = lines.filter((x) => x.kind === "issue");
    return {
      number: input.number, date: isoOf(live[0]!.entryDate), heading: { title: setting?.challanTitle ?? null, address: setting?.challanAddress ?? null },
      worker, preparedBy: users.get(live[0]!.enteredById) ?? "", lines,
      totalSent: issues.reduce((t, x) => t + (x.sent ?? 0), 0), totalCounted: lines.reduce((t, x) => t + x.counted, 0),
      differences: issues.filter((x) => x.sent !== null && x.sent !== x.counted).length + lines.filter((x) => x.short > 0).length,
    };
  },
};

/* =================================== cases =================================== */

export type CaseRow = {
  /** The return or issue entry that raised it. */
  entryId: string; kind: "short" | "handover"; challan: string | null; date: string; ageDays: number;
  workerId: string; workerName: string; bundleId: string; bundleNumber: string; lotId: string; lotNumber: string; stageLabel: string;
  pieces: number; sent: number | null; counted: number | null;
  /** What the karigar said when it was recorded (the reason picked and any words), as the supervisor wrote it down. */
  answer: string | null;
  /** The charge asked for this case, by status only: amounts stay with the people who decide them. */
  chargeStatus: "pending" | "approved" | "declined" | null;
  /** A shortage written off by an approver (pieces), so the case no longer holds the lot open. */
  writtenOff: number;
  /** The supervisor who recorded the handover or return: the person in the middle, who checked the count. */
  recordedBy: string;
  /** How it was settled, by whom and with what words. Null while it is open. */
  decision: { by: string; on: string; outcome: "charged" | "declined" | "written off"; note: string | null } | null;
};

/**
 * Differences between what was handed over and what was counted. A short return is the karigar's; a short handover is the sender's
 * until the receiver's count settles it. Newest first. Cases on closed lots are left out.
 */
export const floorCases: QueryDefinition<Record<string, never>, { today: string; open: CaseRow[]; settled: CaseRow[] }> = {
  key: "verity.piecework.floor_cases",
  entity: ENTRY_ENTITY,
  input: z.object({}),
  handler: async (ctx) => {
    const today = await todayFor(ctx.tx);
    const lots = await ctx.tx.pieceworkLot.findMany({ where: { cancelledAt: null, status: { in: ["active", "hold", "completed"] } }, select: { id: true, number: true } });
    const lotIds = lots.map((x) => x.id);
    const rows = await ctx.tx.pieceworkEntry.findMany({
      where: { lotId: { in: lotIds }, reversesId: null, OR: [{ kind: "receive", shortPieces: { gt: 0 } }, { kind: "issue", sentPieces: { not: null } }] },
      orderBy: { createdAt: "desc" },
      take: 400,
    });
    const diff = rows.filter((r) => (r.kind === "receive" ? (r.shortPieces ?? 0) > 0 : r.sentPieces !== r.pieces));
    const reversed = new Set((await ctx.tx.pieceworkEntry.findMany({ where: { reversesId: { in: diff.map((r) => r.id) } }, select: { reversesId: true } })).map((r) => r.reversesId!));
    const live = diff.filter((r) => !reversed.has(r.id));
    const [bundles, workers, stages, approvals] = await Promise.all([
      ctx.tx.pieceworkBundle.findMany({ where: { id: { in: live.map((r) => r.bundleId) } }, select: { id: true, number: true } }),
      ctx.tx.pieceworkWorker.findMany({ where: { id: { in: live.map((r) => r.workerId) } }, select: { id: true, name: true } }),
      activeStages(ctx.tx),
      ctx.tx.pieceworkApproval.findMany({ where: { entryId: { in: live.map((r) => r.id) } } }),
    ]);
    const userIds = [...new Set([...live.map((r) => r.enteredById), ...approvals.flatMap((a) => (a.decidedById ? [a.decidedById] : []))])];
    const who = await userNames(ctx.tx, userIds);
    const bNo = new Map(bundles.map((b) => [b.id, b.number]));
    const wName = new Map(workers.map((w) => [w.id, w.name]));
    const sLabel = new Map(stages.map((s) => [s.id, s.label]));
    const lNo = new Map(lots.map((x) => [x.id, x.number]));
    const cases = live.map((r): CaseRow => {
      const mine = approvals.filter((a) => a.entryId === r.id);
      const charge = mine.filter((a) => a.kind === "deduction").sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime())[0];
      const isShort = r.kind === "receive";
      return {
        entryId: r.id, kind: isShort ? "short" : "handover", challan: r.challanNumber, date: isoOf(r.entryDate), ageDays: daysBetween(isoOf(r.entryDate), today),
        workerId: r.workerId, workerName: wName.get(r.workerId) ?? "A karigar", bundleId: r.bundleId, bundleNumber: bNo.get(r.bundleId) ?? "", lotId: r.lotId, lotNumber: lNo.get(r.lotId) ?? "",
        stageLabel: sLabel.get(r.stageId) ?? "",
        pieces: isShort ? r.shortPieces ?? 0 : Math.abs((r.sentPieces ?? r.pieces) - r.pieces),
        sent: isShort ? null : r.sentPieces, counted: isShort ? null : r.pieces,
        answer: r.note, chargeStatus: (charge?.status as CaseRow["chargeStatus"]) ?? null,
        writtenOff: mine.filter((a) => a.kind === "writeoff" && a.status === "approved").reduce((t, a) => t + (a.pieces ?? 0), 0),
        recordedBy: who.get(r.enteredById) ?? "A supervisor",
        decision: (() => {
          const done = mine.filter((a) => a.status !== "pending" && a.decidedAt).sort((a, b) => b.decidedAt!.getTime() - a.decidedAt!.getTime())[0];
          if (!done) return null;
          const outcome = done.status === "declined" ? "declined" : done.kind === "writeoff" ? "written off" : "charged";
          return { by: who.get(done.decidedById ?? "") ?? "A manager", on: isoOf(done.decidedAt!), outcome, note: done.decisionNote } as const;
        })(),
      };
    });
    const settledOf = (c: CaseRow) => c.kind === "short" && (c.writtenOff >= c.pieces || c.chargeStatus === "approved" || c.chargeStatus === "declined");
    return { today, open: cases.filter((c) => !settledOf(c)), settled: cases.filter(settledOf) };
  },
};

/* ================================== ready stock ================================== */

export type ReadyLot = {
  lotId: string; number: string; name: string; design: string; status: string; cover: string | null; readyPieces: number; plannedPieces: number;
  readySince: string | null; bundles: Array<{ id: string; number: string; sizeNote: string | null; ready: number }>;
};

/** Garments whose last stage is done: per lot, with the lot's picture, and the bundles they sit in. */
export const readyGarments: QueryDefinition<Record<string, never>, ReadyLot[]> = {
  key: "verity.piecework.ready_garments",
  entity: LOT_ENTITY,
  input: z.object({}),
  handler: async (ctx) => {
    const [lots, stages] = await Promise.all([ctx.tx.pieceworkLot.findMany({ where: { cancelledAt: null, status: { in: ["active", "completed", "hold"] } } }), activeStages(ctx.tx)]);
    const bundles = (await loadBundles(ctx.tx, stages, { lotIds: lots.map((l) => l.id) })).filter((b) => !b.cancelledAt && b.position.ready > 0);
    const covers = await lotCovers(ctx.tx, lots.filter((l) => bundles.some((b) => b.lotId === l.id)));
    const out: ReadyLot[] = [];
    for (const l of lots) {
      const mine = bundles.filter((b) => b.lotId === l.id);
      if (mine.length === 0) continue;
      const since = mine.map((b) => b.position.stages.at(-1)?.lastReceiveDate ?? null).filter((x): x is string => x !== null).sort().at(-1) ?? null;
      out.push({
        lotId: l.id, number: l.number, name: l.name ?? l.design, design: l.design, status: l.status, cover: covers.get(l.id) ?? null,
        readyPieces: mine.reduce((s, b) => s + b.position.ready, 0), plannedPieces: l.plannedPieces, readySince: since,
        bundles: mine.map((b) => ({ id: b.id, number: b.number, sizeNote: b.sizeNote, ready: b.position.ready })),
      });
    }
    return out.sort((a, b) => (b.readySince ?? "").localeCompare(a.readySince ?? ""));
  },
};

/* ================================== scan ================================== */

export type ScanResult =
  | { kind: "bundle"; id: string; number: string; lotId: string; lotNumber: string; lotName: string; netPieces: number; sizeNote: string | null; cover: string | null; cancelled: boolean }
  | { kind: "roll"; id: string; number: string }
  | { kind: "lot"; id: string; number: string; name: string }
  | { kind: "challan"; number: string }
  | { kind: "none"; code: string };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * What a scanned or typed code is. A QR printed by Verity carries an address (…/lots/bundles/<id>, …/fabric/<id>); a person types
 * the number on the paper (B-0007, R-0003, LOT-0002, CH-0021). Only the tenant's own records are found (RLS), and a roll is
 * returned as its number and id alone: the roll page decides for itself who may see fabric.
 */
export const lookupCode: QueryDefinition<{ code: string }, ScanResult> = {
  key: "verity.piecework.lookup_code",
  entity: ENTRY_ENTITY,
  input: z.object({ code: z.string().trim().min(1).max(500) }),
  handler: async (ctx, input) => {
    const raw = input.code.trim();
    const byPath = (re: string) => new RegExp(re, "i").exec(raw)?.[1]?.toLowerCase() ?? null;
    const bundleId = byPath(`/lots/bundles/(${UUID})`);
    const rollId = byPath(`/fabric/(${UUID})`);
    const lotId = !bundleId ? byPath(`/lots/(${UUID})`) : null;
    const code = raw.toUpperCase().replace(/\s+/g, "");
    const num = (prefix: string) => {
      const m = new RegExp(`^${prefix}-?0*(\\d{1,9})$`).exec(code);
      return m ? `${prefix}-${m[1]!.padStart(4, "0")}` : null;
    };

    const bundleWhere = bundleId ? { id: bundleId } : num("B") ? { number: num("B")! } : null;
    if (bundleWhere) {
      const b = await ctx.tx.pieceworkBundle.findFirst({ where: bundleWhere, include: { lot: true } });
      if (b) {
        const cover = (await lotCovers(ctx.tx, [b.lot])).get(b.lot.id) ?? null;
        return { kind: "bundle", id: b.id, number: b.number, lotId: b.lotId, lotNumber: b.lot.number, lotName: b.lot.name ?? b.lot.design, netPieces: b.netPieces, sizeNote: b.sizeNote, cover, cancelled: b.cancelledAt !== null };
      }
    }
    const rollWhere = rollId ? { id: rollId } : num("R") ? { number: num("R")! } : null;
    if (rollWhere) {
      const r = await ctx.tx.pieceworkRoll.findFirst({ where: rollWhere, select: { id: true, number: true } });
      if (r) return { kind: "roll", id: r.id, number: r.number };
    }
    const lotWhere = lotId ? { id: lotId } : num("LOT") ? { number: num("LOT")! } : null;
    if (lotWhere) {
      const l = await ctx.tx.pieceworkLot.findFirst({ where: lotWhere, select: { id: true, number: true, name: true, design: true } });
      if (l) return { kind: "lot", id: l.id, number: l.number, name: l.name ?? l.design };
    }
    const challan = num("CH");
    if (challan && (await ctx.tx.pieceworkEntry.findFirst({ where: { challanNumber: challan }, select: { id: true } }))) return { kind: "challan", number: challan };
    return { kind: "none", code: raw.slice(0, 80) };
  },
};

export function registerViews(): void {
  registerQuery(challanSheet);
  registerQuery(floorCases);
  registerQuery(readyGarments);
  registerQuery(lookupCode);
}
