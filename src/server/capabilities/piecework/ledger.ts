/**
 * Pure derivations for piece-rate lots. No database, no clock of its own: every function takes the ledger rows
 * (and, where a date matters, "today") as arguments, so the rules that decide what a munshi may enter, and every
 * number an owner reads, can be tested exactly.
 *
 * The model, in one paragraph. A lot has a total number of pieces and moves through an ordered chain of stages.
 * At each stage, pieces are ISSUED to a worker and RECEIVED back. What can be issued at a stage is what the
 * previous stage has received (the lot total, for the first stage). Pending is issued minus received. A lot is
 * ready when its pieces have been received at the last stage. An entry is never edited: a mistake is cancelled by
 * a REVERSAL, a second row of the same kind and pieces that counts negative. Nothing here is stored; all of it
 * is recomputed from the rows, so no cached figure can disagree with the ledger.
 */

export const ENTRY_KINDS = ["issue", "receive"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export type LedgerEntry = {
  id: string;
  stageId: string;
  workerId: string;
  kind: EntryKind;
  pieces: number;
  /** Set on a reversal: the entry it cancels. */
  reversesId: string | null;
  /** The business day, YYYY-MM-DD. May be back-dated. */
  entryDate: string;
  /** Paise per piece, snapshotted on a receive. */
  rateMinor: number | null;
};

export type StageRef = { id: string; sequence: number; label: string };

/** A reversal counts negative; everything else counts as written. */
export const signedPieces = (e: Pick<LedgerEntry, "pieces" | "reversesId">): number => (e.reversesId ? -e.pieces : e.pieces);

export type WorkerStagePosition = { issued: number; received: number; pending: number };

export type StagePosition = {
  stageId: string;
  label: string;
  issued: number;
  received: number;
  pending: number;
  /** What the stage before has handed on (the lot total for the first stage). */
  available: number;
  /** Still waiting to be issued here: available minus issued. */
  toIssue: number;
  byWorker: Map<string, WorkerStagePosition>;
  /** Business date of the first issue and of the last receive at this stage (reversals do not move them). */
  firstIssueDate: string | null;
  lastReceiveDate: string | null;
};

export type LotPosition = {
  totalPieces: number;
  stages: StagePosition[];
  /** Pieces received at the last stage: the lot's ready stock. */
  ready: number;
  /** The earliest stage still holding pending pieces, else the earliest with pieces waiting to be issued. */
  currentStageId: string | null;
  /** Latest business date of any entry, for "days since the lot last moved". */
  lastMovementDate: string | null;
};

const blankWorker = (): WorkerStagePosition => ({ issued: 0, received: 0, pending: 0 });

export function computePosition(totalPieces: number, stagesInOrder: StageRef[], entries: LedgerEntry[]): LotPosition {
  const stages = [...stagesInOrder].sort((a, b) => a.sequence - b.sequence);
  const positions: StagePosition[] = [];
  let upstreamReceived = totalPieces;
  let lastMovementDate: string | null = null;

  for (const stage of stages) {
    const rows = entries.filter((e) => e.stageId === stage.id);
    const byWorker = new Map<string, WorkerStagePosition>();
    let issued = 0;
    let received = 0;
    let firstIssueDate: string | null = null;
    let lastReceiveDate: string | null = null;

    for (const e of rows) {
      const n = signedPieces(e);
      const w = byWorker.get(e.workerId) ?? blankWorker();
      if (e.kind === "issue") {
        issued += n;
        w.issued += n;
        if (!e.reversesId && (firstIssueDate === null || e.entryDate < firstIssueDate)) firstIssueDate = e.entryDate;
      } else {
        received += n;
        w.received += n;
        if (!e.reversesId && (lastReceiveDate === null || e.entryDate > lastReceiveDate)) lastReceiveDate = e.entryDate;
      }
      w.pending = w.issued - w.received;
      byWorker.set(e.workerId, w);
      if (lastMovementDate === null || e.entryDate > lastMovementDate) lastMovementDate = e.entryDate;
    }

    positions.push({
      stageId: stage.id,
      label: stage.label,
      issued,
      received,
      pending: issued - received,
      available: upstreamReceived,
      toIssue: upstreamReceived - issued,
      byWorker,
      firstIssueDate,
      lastReceiveDate,
    });
    upstreamReceived = received;
  }

  const holding = positions.find((p) => p.pending > 0);
  const waiting = positions.find((p) => p.toIssue > 0 && p.available > 0);
  const last = positions.at(-1);
  return {
    totalPieces,
    stages: positions,
    ready: last?.received ?? 0,
    currentStageId: (holding ?? waiting)?.stageId ?? null,
    lastMovementDate,
  };
}

export type Violation = {
  code: "over_issue" | "over_receive" | "negative" | "worker_over_receive";
  stageId: string;
  workerId?: string;
  message: string;
};

/**
 * The first rule the ledger breaks, or null. Applied to the whole lot after any change, so it also catches what a
 * reversal would do downstream: undoing a receive that the next stage has already issued from leaves that stage
 * issuing more than exists, and is refused here with the stage named.
 */
export function findViolation(position: LotPosition, workerName: (id: string) => string): Violation | null {
  for (const s of position.stages) {
    if (s.issued < 0 || s.received < 0) {
      return { code: "negative", stageId: s.stageId, message: `That would leave ${s.label} with fewer pieces than were ever recorded.` };
    }
    if (s.issued > s.available) {
      return {
        code: "over_issue",
        stageId: s.stageId,
        message: `${s.label} would have ${s.issued} pieces issued but only ${s.available} have reached it.`,
      };
    }
    if (s.received > s.issued) {
      return {
        code: "over_receive",
        stageId: s.stageId,
        message: `${s.label} would have ${s.received} pieces received but only ${s.issued} issued.`,
      };
    }
    for (const [workerId, w] of s.byWorker) {
      if (w.received > w.issued || w.issued < 0 || w.received < 0) {
        return {
          code: "worker_over_receive",
          stageId: s.stageId,
          workerId,
          message: `${workerName(workerId)} would have returned more pieces than were given at ${s.label}.`,
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

/**
 * Days a lot has spent at a stage: from the first issue to the last receive once everything is back, or to today
 * while pieces are still out. Null when nothing was ever issued there.
 */
export function daysInStage(stage: StagePosition, today: string): number | null {
  if (stage.firstIssueDate === null) return null;
  const closed = stage.issued > 0 && stage.pending === 0 && stage.lastReceiveDate !== null;
  const end = closed ? stage.lastReceiveDate! : today;
  return Math.max(0, daysBetween(stage.firstIssueDate, end));
}

/** Days since the lot last moved, by business date. Null for a lot that has never moved. */
export function daysSinceMovement(position: LotPosition, today: string): number | null {
  return position.lastMovementDate === null ? null : Math.max(0, daysBetween(position.lastMovementDate, today));
}

/** Bundles are counted from pieces by the system: a fixed pieces-per-bundle, with a part-bundle counted as one. */
export const bundlesOf = (pieces: number, bundleSize: number): number => (pieces <= 0 ? 0 : Math.ceil(pieces / bundleSize));

export type WorkerMoney = { wagesMinor: number; advanceMinor: number; paidMinor: number; balanceMinor: number };

/** Wage for one received entry is pieces x the rate snapshotted on it; a reversal carries the same rate and cancels it. */
export const wageOf = (e: Pick<LedgerEntry, "kind" | "pieces" | "reversesId" | "rateMinor">): number =>
  e.kind === "receive" && e.rateMinor !== null ? signedPieces(e) * e.rateMinor : 0;

export type PaymentRow = { kind: "advance" | "payment"; amountMinor: number; reversesId: string | null };

/** Balance due = wages earned - advances - payments. Negative means the worker holds more advance than earned. */
export function workerMoney(entries: LedgerEntry[], payments: PaymentRow[]): WorkerMoney {
  const wagesMinor = entries.reduce((sum, e) => sum + wageOf(e), 0);
  const sum = (kind: PaymentRow["kind"]) =>
    payments.filter((p) => p.kind === kind).reduce((s, p) => s + (p.reversesId ? -p.amountMinor : p.amountMinor), 0);
  const advanceMinor = sum("advance");
  const paidMinor = sum("payment");
  return { wagesMinor, advanceMinor, paidMinor, balanceMinor: wagesMinor - advanceMinor - paidMinor };
}

/** The rate in force on a date: the newest rate whose effective date is on or before it. */
export function rateOn<R extends { effectiveFrom: string; rateMinor: number }>(rates: R[], date: string): R | null {
  let best: R | null = null;
  for (const r of rates) {
    if (r.effectiveFrom <= date && (best === null || r.effectiveFrom > best.effectiveFrom)) best = r;
  }
  return best;
}
