/**
 * Pure derivations for piece-rate production by BUNDLE. No database, no clock of its own: every function takes the
 * ledger rows (and, where a date matters, "today") as arguments, so the rules that decide what may be entered, and every
 * number a screen shows, can be tested exactly.
 *
 * The model, in one paragraph. A lot is cut into bundles; a bundle has net pieces. A bundle moves through an ordered
 * chain of stages. At a stage, pieces are ISSUED to a worker. A RETURN settles one issue and accounts for pieces as
 * good, rejected, rework or short. Good pieces become available at the next stage; rejected and short leave the flow
 * (kept visible, never hidden); rework pieces wait in that stage's rework pool until they are issued again as rework.
 * Whatever a return does not account for stays OPEN on the issue. An entry is never edited: a mistake is cancelled by a
 * REVERSAL, a second row that counts negative. Nothing here is stored; everything is recomputed from the rows.
 */

export const ENTRY_KINDS = ["issue", "receive"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

/** What a wage rate is paid on. `returned` = good + rejected + rework (everything physically brought back). */
export const WAGE_BASES = ["issued", "good", "returned"] as const;
export type WageBasis = (typeof WAGE_BASES)[number];

export type LedgerEntry = {
  id: string;
  bundleId: string;
  stageId: string;
  workerId: string;
  kind: EntryKind;
  /** Issue: pieces given. Receive: pieces accounted for (= good + rejected + rework + short). */
  pieces: number;
  good: number;
  rejected: number;
  rework: number;
  short: number;
  /** Set on a receive: the issue it settles. */
  issueId: string | null;
  isRework: boolean;
  wageBasis: WageBasis | null;
  /** Set on a reversal: the entry it cancels. */
  reversesId: string | null;
  /** The business day, YYYY-MM-DD. May be back-dated. */
  entryDate: string;
  /** Paise per piece, snapshotted when the wage rate was applied. */
  rateMinor: number | null;
  dueDate?: string | null;
};

export type StageRef = { id: string; sequence: number; label: string };

/** A reversal counts negative; everything else counts as written. */
export const sign = (e: Pick<LedgerEntry, "reversesId">): 1 | -1 => (e.reversesId ? -1 : 1);

export type WorkerStagePosition = { issued: number; accounted: number; pending: number };

export type OpenIssue = {
  issueId: string;
  workerId: string;
  issued: number;
  good: number;
  rejected: number;
  rework: number;
  short: number;
  /** Issued minus accounted: what is still out with the worker. */
  open: number;
  isRework: boolean;
  entryDate: string;
  dueDate: string | null;
};

export type StagePosition = {
  stageId: string;
  label: string;
  /** What the previous stage handed on as good (the bundle's net pieces for the first stage). */
  intake: number;
  issuedNormal: number;
  issuedRework: number;
  good: number;
  rejected: number;
  rework: number;
  short: number;
  accounted: number;
  /** Issued (both kinds) minus accounted. */
  pending: number;
  /** Intake not yet issued here. */
  toIssue: number;
  /** Rework returned to this stage and not yet issued again. */
  reworkPool: number;
  byWorker: Map<string, WorkerStagePosition>;
  /** Every non-reversed issue with its own reconciliation. */
  issues: OpenIssue[];
  firstIssueDate: string | null;
  lastReceiveDate: string | null;
};

export type BundlePosition = {
  bundleId: string;
  netPieces: number;
  stages: StagePosition[];
  /** Good pieces at the last stage: this bundle's ready output. */
  ready: number;
  rejected: number;
  short: number;
  /** Pieces sitting in a rework pool somewhere, waiting to be redone. */
  reworkOpen: number;
  /** The earliest stage still holding pending or rework pieces, else the earliest with pieces waiting to be issued. */
  currentStageId: string | null;
  lastMovementDate: string | null;
};

const blank = (): WorkerStagePosition => ({ issued: 0, accounted: 0, pending: 0 });

export function computeBundle(bundleId: string, netPieces: number, stagesInOrder: StageRef[], entries: LedgerEntry[]): BundlePosition {
  const stages = [...stagesInOrder].sort((a, b) => a.sequence - b.sequence);
  const mine = entries.filter((e) => e.bundleId === bundleId);
  const positions: StagePosition[] = [];
  let intake = netPieces;
  let lastMovementDate: string | null = null;

  for (const stage of stages) {
    const rows = mine.filter((e) => e.stageId === stage.id);
    const byWorker = new Map<string, WorkerStagePosition>();
    const issueById = new Map<string, OpenIssue>();
    let issuedNormal = 0, issuedRework = 0, good = 0, rejected = 0, rework = 0, short = 0;
    let firstIssueDate: string | null = null;
    let lastReceiveDate: string | null = null;

    // Issues first, so a receive can find the issue it settles regardless of row order.
    for (const e of rows.filter((r) => r.kind === "issue")) {
      const n = sign(e) * e.pieces;
      if (e.isRework) issuedRework += n; else issuedNormal += n;
      const w = byWorker.get(e.workerId) ?? blank();
      w.issued += n;
      byWorker.set(e.workerId, w);
      if (!e.reversesId) {
        issueById.set(e.id, { issueId: e.id, workerId: e.workerId, issued: e.pieces, good: 0, rejected: 0, rework: 0, short: 0, open: e.pieces, isRework: e.isRework, entryDate: e.entryDate, dueDate: e.dueDate ?? null });
        if (firstIssueDate === null || e.entryDate < firstIssueDate) firstIssueDate = e.entryDate;
      } else if (e.issueId === null) {
        // A reversal of an issue: shrink the original issue by the pieces cancelled.
        const target = issueById.get(e.reversesId);
        if (target) { target.issued -= e.pieces; target.open -= e.pieces; }
      }
    }
    for (const e of rows.filter((r) => r.kind === "receive")) {
      const s = sign(e);
      good += s * e.good; rejected += s * e.rejected; rework += s * e.rework; short += s * e.short;
      const w = byWorker.get(e.workerId) ?? blank();
      w.accounted += s * e.pieces;
      byWorker.set(e.workerId, w);
      const issue = e.issueId ? issueById.get(e.issueId) : undefined;
      if (issue) {
        issue.good += s * e.good; issue.rejected += s * e.rejected; issue.rework += s * e.rework; issue.short += s * e.short;
        issue.open -= s * e.pieces;
      }
      if (!e.reversesId && (lastReceiveDate === null || e.entryDate > lastReceiveDate)) lastReceiveDate = e.entryDate;
    }
    for (const e of rows) if (lastMovementDate === null || e.entryDate > lastMovementDate) lastMovementDate = e.entryDate;
    for (const w of byWorker.values()) w.pending = w.issued - w.accounted;

    const accounted = good + rejected + rework + short;
    const issuedAll = issuedNormal + issuedRework;
    positions.push({
      stageId: stage.id, label: stage.label, intake,
      issuedNormal, issuedRework, good, rejected, rework, short, accounted,
      pending: issuedAll - accounted,
      toIssue: intake - issuedNormal,
      reworkPool: rework - issuedRework,
      byWorker, issues: [...issueById.values()], firstIssueDate, lastReceiveDate,
    });
    intake = good;
  }

  const holding = positions.find((p) => p.pending > 0 || p.reworkPool > 0);
  const waiting = positions.find((p) => p.toIssue > 0 && p.intake > 0);
  const last = positions.at(-1);
  return {
    bundleId, netPieces, stages: positions,
    ready: last?.good ?? 0,
    rejected: positions.reduce((s, p) => s + p.rejected, 0),
    short: positions.reduce((s, p) => s + p.short, 0),
    reworkOpen: positions.reduce((s, p) => s + p.reworkPool, 0),
    currentStageId: (holding ?? waiting)?.stageId ?? null,
    lastMovementDate,
  };
}

export type Violation = {
  code: "over_issue" | "over_rework" | "over_account" | "negative";
  stageId: string;
  workerId?: string;
  message: string;
};

/**
 * The first rule the bundle's ledger breaks, or null. Applied to the whole bundle after any change, so it also catches
 * what a reversal would do downstream: undoing a good return that the next stage has already issued from leaves that stage
 * issuing more than reached it, and is refused here with the stage named.
 */
export function findViolation(position: BundlePosition, workerName: (id: string) => string): Violation | null {
  for (const s of position.stages) {
    if (s.issuedNormal < 0 || s.issuedRework < 0 || s.good < 0 || s.rejected < 0 || s.rework < 0 || s.short < 0) {
      return { code: "negative", stageId: s.stageId, message: `That would leave ${s.label} with fewer pieces than were ever recorded.` };
    }
    if (s.issuedNormal > s.intake) {
      return { code: "over_issue", stageId: s.stageId, message: `${s.label} would have ${s.issuedNormal} pieces issued but only ${s.intake} have reached it.` };
    }
    if (s.issuedRework > s.rework) {
      return { code: "over_rework", stageId: s.stageId, message: `${s.label} would send back ${s.issuedRework} rework pieces but only ${s.rework} were returned for rework.` };
    }
    for (const i of s.issues) {
      if (i.open < 0 || i.good < 0 || i.rejected < 0 || i.rework < 0 || i.short < 0) {
        return {
          code: "over_account", stageId: s.stageId, workerId: i.workerId,
          message: `${workerName(i.workerId)} would have more pieces accounted for than were given at ${s.label}.`,
        };
      }
    }
  }
  return null;
}

/** Whole calendar days from one YYYY-MM-DD date to another (can be negative). */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

/** Days at a stage: first issue to last return once everything is back, or to today while pieces are still out. */
export function daysInStage(stage: Pick<StagePosition, "firstIssueDate" | "lastReceiveDate" | "pending" | "issuedNormal" | "issuedRework">, today: string): number | null {
  if (stage.firstIssueDate === null) return null;
  const closed = stage.issuedNormal + stage.issuedRework > 0 && stage.pending === 0 && stage.lastReceiveDate !== null;
  return Math.max(0, daysBetween(stage.firstIssueDate, closed ? stage.lastReceiveDate! : today));
}

export function daysSinceMovement(position: Pick<BundlePosition, "lastMovementDate">, today: string): number | null {
  return position.lastMovementDate === null ? null : Math.max(0, daysBetween(position.lastMovementDate, today));
}

/** Sum of the stage figures over several bundles, in stage order. */
export function sumStages(positions: BundlePosition[], stagesInOrder: StageRef[]) {
  return [...stagesInOrder].sort((a, b) => a.sequence - b.sequence).map((s) => {
    const rows = positions.map((p) => p.stages.find((x) => x.stageId === s.id)).filter((x): x is StagePosition => !!x);
    const add = (f: (x: StagePosition) => number) => rows.reduce((sum, x) => sum + f(x), 0);
    return {
      stageId: s.id, label: s.label,
      intake: add((x) => x.intake), issued: add((x) => x.issuedNormal + x.issuedRework), good: add((x) => x.good),
      rejected: add((x) => x.rejected), rework: add((x) => x.rework), short: add((x) => x.short),
      pending: add((x) => x.pending), toIssue: add((x) => x.toIssue), reworkPool: add((x) => x.reworkPool),
    };
  });
}

/** Wage for one entry: the rate snapshotted on it, on the basis it was issued under. A reversal cancels it exactly. */
export function wageOf(e: Pick<LedgerEntry, "kind" | "pieces" | "good" | "rejected" | "rework" | "reversesId" | "rateMinor" | "wageBasis">): number {
  if (e.rateMinor === null || e.wageBasis === null) return 0;
  const s = sign(e);
  if (e.kind === "issue") return e.wageBasis === "issued" ? s * e.pieces * e.rateMinor : 0;
  if (e.wageBasis === "good") return s * e.good * e.rateMinor;
  if (e.wageBasis === "returned") return s * (e.good + e.rejected + e.rework) * e.rateMinor;
  return 0;
}

/** `opening` is wages already owed to the karigar when the factory starts using Verity; it counts with wages earned. */
export const PAYMENT_KINDS = ["advance", "recovery", "deduction", "payment", "opening"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];
export type PaymentRow = { kind: PaymentKind; amountMinor: number; reversesId: string | null };

export type WorkerMoney = {
  wagesMinor: number;
  advanceGivenMinor: number;
  recoveredMinor: number;
  deductionMinor: number;
  paidMinor: number;
  /** Wages - advances recovered - deductions - payments. What is still owed to the worker. */
  balanceMinor: number;
  /** Advances given - advances recovered. Money out that has not been taken back out of wages yet. */
  advanceOutstandingMinor: number;
};

export function workerMoney(entries: Parameters<typeof wageOf>[0][], payments: PaymentRow[]): WorkerMoney {
  const total = (kind: PaymentKind) => payments.filter((p) => p.kind === kind).reduce((s, p) => s + (p.reversesId ? -p.amountMinor : p.amountMinor), 0);
  const wagesMinor = entries.reduce((sum, e) => sum + wageOf(e), 0) + total("opening");
  const advanceGivenMinor = total("advance");
  const recoveredMinor = total("recovery");
  const deductionMinor = total("deduction");
  const paidMinor = total("payment");
  return {
    wagesMinor, advanceGivenMinor, recoveredMinor, deductionMinor, paidMinor,
    balanceMinor: wagesMinor - recoveredMinor - deductionMinor - paidMinor,
    advanceOutstandingMinor: advanceGivenMinor - recoveredMinor,
  };
}

/** The rate in force on a date: the newest rate whose effective date is on or before it. */
export function rateOn<R extends { effectiveFrom: string; rateMinor: number }>(rates: R[], date: string): R | null {
  let best: R | null = null;
  for (const r of rates) if (r.effectiveFrom <= date && (best === null || r.effectiveFrom > best.effectiveFrom)) best = r;
  return best;
}

/**
 * Cost per good finished piece: total allocated cost over good finished pieces. Null (shown blank), never zero, when
 * there are no good pieces; the originals, rejects, rework and short stay visible beside it.
 */
export const costPerGoodPiece = (totalMinor: number, goodPieces: number): number | null => (goodPieces > 0 ? Math.round(totalMinor / goodPieces) : null);

/** The LOT statuses and the moves between them. Closed requires reconciliation (checked by the command). */
export const LOT_STATUSES = ["draft", "active", "hold", "completed", "closed"] as const;
export type LotStatus = (typeof LOT_STATUSES)[number];
const MOVES: Record<LotStatus, LotStatus[]> = {
  draft: ["active"],
  active: ["hold", "completed"],
  hold: ["active"],
  completed: ["closed", "active"],
  closed: [],
};
export const canMoveLot = (from: LotStatus, to: LotStatus) => MOVES[from].includes(to);

export const WORKER_KINDS = ["in_house", "outside"] as const;
export type WorkerKind = (typeof WORKER_KINDS)[number];
