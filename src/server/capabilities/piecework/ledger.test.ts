import { describe, expect, it } from "vitest";
import {
  canMoveLot,
  computeBundle,
  costPerGoodPiece,
  daysBetween,
  daysInStage,
  daysSinceMovement,
  findViolation,
  rateOn,
  sumStages,
  wageOf,
  workerMoney,
  type LedgerEntry,
  type StageRef,
} from "./ledger";

/**
 * The numbers are the requirement sheet's own samples (Sample Calculations): issued 100 = good 94 + rejected 2 +
 * rework 1 + short 2 + open 1; wage on issued 100 x Rs 12 = Rs 1,200 against accepted 94 x Rs 12 = Rs 1,128; cost per
 * good piece Rs 48,000 / 960 = Rs 50. If these derive correctly, the screens show what the client specified.
 */

const STAGES: StageRef[] = [
  { id: "pasting", sequence: 1, label: "Pasting" },
  { id: "collar", sequence: 2, label: "Collar & Cuff" },
  { id: "stitch", sequence: 3, label: "Stitching" },
];

let n = 0;
const issue = (stageId: string, pieces: number, date: string, workerId = "A", extra: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: `i${++n}`, bundleId: "b1", stageId, workerId, kind: "issue", pieces, good: 0, rejected: 0, rework: 0, short: 0,
  issueId: null, isRework: false, wageBasis: "good", reversesId: null, entryDate: date, rateMinor: null, ...extra,
});
const ret = (of: LedgerEntry, split: { good?: number; rejected?: number; rework?: number; short?: number }, date: string, extra: Partial<LedgerEntry> = {}): LedgerEntry => {
  const { good = 0, rejected = 0, rework = 0, short = 0 } = split;
  return {
    id: `r${++n}`, bundleId: of.bundleId, stageId: of.stageId, workerId: of.workerId, kind: "receive", pieces: good + rejected + rework + short,
    good, rejected, rework, short, issueId: of.id, isRework: false, wageBasis: of.wageBasis, reversesId: null, entryDate: date, rateMinor: 1200, ...extra,
  };
};
const reversal = (e: LedgerEntry, date: string): LedgerEntry => ({ ...e, id: `x${++n}`, reversesId: e.id, entryDate: date });
const names = (id: string) => `Karigar ${id}`;
const pos = (net: number, rows: LedgerEntry[]) => computeBundle("b1", net, STAGES, rows);

describe("reconciliation of one issue", () => {
  it("accounts for every piece: 100 = 94 good + 2 rejected + 1 rework + 2 short + 1 open", () => {
    const i = issue("pasting", 100, "2026-10-01");
    const p = pos(100, [i, ret(i, { good: 94, rejected: 2, rework: 1, short: 2 }, "2026-10-03")]);
    const s = p.stages[0]!;
    expect(s.issues[0]).toMatchObject({ issued: 100, good: 94, rejected: 2, rework: 1, short: 2, open: 1 });
    expect(s.accounted).toBe(99);
    expect(s.pending).toBe(1);
    expect(s.good + s.rejected + s.rework + s.short + s.pending).toBe(100);
  });

  it("lets a second return settle the open piece", () => {
    const i = issue("pasting", 100, "2026-10-01");
    const p = pos(100, [i, ret(i, { good: 94, rejected: 2, rework: 1, short: 2 }, "2026-10-03"), ret(i, { good: 1 }, "2026-10-04")]);
    expect(p.stages[0]!.issues[0]!.open).toBe(0);
    expect(p.stages[0]!.pending).toBe(0);
  });
});

describe("flow between stages", () => {
  const i1 = issue("pasting", 20, "2026-10-01");
  const r1 = ret(i1, { good: 18, rejected: 1, short: 1 }, "2026-10-02");

  it("hands only good pieces to the next stage; rejected and short leave the flow but stay visible", () => {
    const p = pos(20, [i1, r1]);
    expect(p.stages[1]!.intake).toBe(18);
    expect(p.rejected).toBe(1);
    expect(p.short).toBe(1);
    expect(p.ready).toBe(0);
  });

  it("holds rework in the stage's pool until it is issued again, and rework is not output until accepted", () => {
    const i = issue("pasting", 20, "2026-10-01");
    const r = ret(i, { good: 15, rework: 3, short: 2 }, "2026-10-02");
    const p = pos(20, [i, r]);
    expect(p.stages[0]!.reworkPool).toBe(3);
    expect(p.reworkOpen).toBe(3);
    expect(p.stages[1]!.intake).toBe(15);

    const again = issue("pasting", 3, "2026-10-03", "A", { isRework: true });
    const back = ret(again, { good: 3 }, "2026-10-04");
    const done = pos(20, [i, r, again, back]);
    expect(done.stages[0]!.reworkPool).toBe(0);
    expect(done.stages[0]!.good).toBe(18);
    expect(done.stages[1]!.intake).toBe(18);
  });

  it("keeps conserving pieces: net = ready + rejected + short + open + rework pool + pieces waiting between stages", () => {
    const i = issue("pasting", 20, "2026-10-01");
    const r = ret(i, { good: 15, rejected: 2, rework: 3 }, "2026-10-02");
    const p = pos(20, [i, r]);
    const s = p.stages[0]!;
    expect(s.good + s.rejected + s.short + s.reworkPool + s.pending + s.toIssue).toBe(20);
  });

  it("names the current stage as the earliest still holding pieces or rework", () => {
    expect(pos(20, [i1]).currentStageId).toBe("pasting");
    expect(pos(20, [i1, r1]).currentStageId).toBe("collar");
    expect(pos(20, []).currentStageId).toBe("pasting");
  });

  it("sums a lot's stages over its bundles", () => {
    const a = pos(20, [i1, r1]);
    const bi = { ...issue("pasting", 10, "2026-10-01"), bundleId: "b2" };
    const b = computeBundle("b2", 10, STAGES, [bi, { ...ret(bi, { good: 10 }, "2026-10-02"), bundleId: "b2" }]);
    const totals = sumStages([a, b], STAGES);
    expect(totals[0]).toMatchObject({ issued: 30, good: 28, rejected: 1, short: 1 });
  });
});

describe("findViolation", () => {
  it("accepts a consistent bundle", () => {
    const i = issue("pasting", 20, "2026-10-01");
    expect(findViolation(pos(20, [i, ret(i, { good: 20 }, "2026-10-02")]), names)).toBeNull();
  });

  it("refuses issuing more than reached the stage", () => {
    const v = findViolation(pos(20, [issue("pasting", 21, "2026-10-01")]), names);
    expect(v).toMatchObject({ code: "over_issue", stageId: "pasting" });
  });

  it("refuses a return that accounts for more than the issue", () => {
    const i = issue("pasting", 10, "2026-10-01");
    const v = findViolation(pos(10, [i, ret(i, { good: 8, rejected: 3 }, "2026-10-02")]), names);
    expect(v).toMatchObject({ code: "over_account", workerId: "A" });
  });

  it("refuses issuing more rework than was returned for rework", () => {
    const i = issue("pasting", 10, "2026-10-01");
    const r = ret(i, { good: 8, rework: 2 }, "2026-10-02");
    const v = findViolation(pos(10, [i, r, issue("pasting", 3, "2026-10-03", "A", { isRework: true })]), names);
    expect(v).toMatchObject({ code: "over_rework" });
  });

  it("refuses a reversal that would strand the next stage", () => {
    const i = issue("pasting", 20, "2026-10-01");
    const r = ret(i, { good: 20 }, "2026-10-02");
    const next = issue("collar", 20, "2026-10-03");
    expect(findViolation(pos(20, [i, r, next, reversal(r, "2026-10-04")]), names)).toMatchObject({ code: "over_issue", stageId: "collar" });
  });

  it("allows reversing a return nobody has issued from, and an issue nothing was returned against", () => {
    const i = issue("pasting", 20, "2026-10-01");
    const r = ret(i, { good: 20 }, "2026-10-02");
    expect(findViolation(pos(20, [i, r, reversal(r, "2026-10-03")]), names)).toBeNull();
    expect(findViolation(pos(20, [i, reversal(i, "2026-10-03")]), names)).toBeNull();
  });

  it("refuses reversing an issue that has returns against it", () => {
    const i = issue("pasting", 20, "2026-10-01");
    expect(findViolation(pos(20, [i, ret(i, { good: 5 }, "2026-10-02"), reversal(i, "2026-10-03")]), names)).toMatchObject({ code: "over_account" });
  });
});

describe("days", () => {
  const i = issue("pasting", 20, "2026-10-01");
  const p = pos(20, [i, ret(i, { good: 20 }, "2026-10-03")]);
  it("counts calendar days", () => {
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
  });
  it("runs a finished stage from first issue to last return, an open stage to today", () => {
    expect(daysInStage(p.stages[0]!, "2026-12-31")).toBe(2);
    const open = pos(20, [i]);
    expect(daysInStage(open.stages[0]!, "2026-10-08")).toBe(7);
  });
  it("has no days for a stage nothing reached, and measures stuck time from the last movement", () => {
    expect(daysInStage(p.stages[2]!, "2026-10-08")).toBeNull();
    expect(daysSinceMovement(p, "2026-10-13")).toBe(10);
    expect(daysSinceMovement(pos(20, []), "2026-10-13")).toBeNull();
  });
});

describe("wages follow the basis the work was issued under", () => {
  const i = issue("pasting", 100, "2026-10-01", "A", { wageBasis: "issued", rateMinor: 1200 });
  const r = (basis: "issued" | "good" | "returned") => ret({ ...i, wageBasis: basis }, { good: 94, rejected: 2, rework: 1, short: 2 }, "2026-10-03");

  it("pays on issued pieces: 100 x Rs 12 = Rs 1,200", () => {
    expect(wageOf(i)).toBe(120_000);
    expect(wageOf(r("issued"))).toBe(0);
  });
  it("pays on accepted good pieces: 94 x Rs 12 = Rs 1,128", () => {
    expect(wageOf({ ...i, wageBasis: "good" })).toBe(0);
    expect(wageOf(r("good"))).toBe(94 * 1200);
  });
  it("pays on everything brought back when the basis is returned: (94 + 2 + 1) x Rs 12", () => {
    expect(wageOf(r("returned"))).toBe(97 * 1200);
  });
  it("cancels a reversed entry's wage exactly", () => {
    const e = r("good");
    expect(wageOf(e) + wageOf(reversal(e, "2026-10-04"))).toBe(0);
    expect(wageOf(i) + wageOf(reversal(i, "2026-10-04"))).toBe(0);
  });
  it("earns nothing without a snapshotted rate or basis", () => {
    expect(wageOf({ ...r("good"), rateMinor: null })).toBe(0);
    expect(wageOf({ ...r("good"), wageBasis: null })).toBe(0);
  });
});

describe("the karigar ledger", () => {
  const i = issue("pasting", 200, "2026-10-01");
  const earn = ret(i, { good: 200 }, "2026-10-02", { rateMinor: 1000 });

  it("keeps advance given apart from advance recovered: Rs 2,000 earned, Rs 1,000 recovered, Rs 500 paid = Rs 500 due", () => {
    const m = workerMoney([earn], [
      { kind: "advance", amountMinor: 100_000, reversesId: null },
      { kind: "recovery", amountMinor: 100_000, reversesId: null },
      { kind: "payment", amountMinor: 50_000, reversesId: null },
    ]);
    expect(m).toMatchObject({ wagesMinor: 200_000, advanceGivenMinor: 100_000, recoveredMinor: 100_000, paidMinor: 50_000, balanceMinor: 50_000, advanceOutstandingMinor: 0 });
  });
  it("shows an unrecovered advance as outstanding without touching the wage balance", () => {
    const m = workerMoney([earn], [{ kind: "advance", amountMinor: 80_000, reversesId: null }]);
    expect(m.balanceMinor).toBe(200_000);
    expect(m.advanceOutstandingMinor).toBe(80_000);
  });
  it("subtracts approved deductions, and restores the balance when a payment is reversed", () => {
    const m = workerMoney([earn], [
      { kind: "deduction", amountMinor: 10_000, reversesId: null },
      { kind: "payment", amountMinor: 30_000, reversesId: null },
      { kind: "payment", amountMinor: 30_000, reversesId: "p" },
    ]);
    expect(m).toMatchObject({ deductionMinor: 10_000, paidMinor: 0, balanceMinor: 190_000 });
  });
});

describe("cost per good piece and lot status", () => {
  it("is total cost over good finished pieces: Rs 48,000 / 960 = Rs 50, blank when there are none", () => {
    expect(costPerGoodPiece(4_800_000, 960)).toBe(5000);
    expect(costPerGoodPiece(4_800_000, 0)).toBeNull();
  });
  it("moves a lot only along the allowed statuses", () => {
    expect(canMoveLot("draft", "active")).toBe(true);
    expect(canMoveLot("draft", "closed")).toBe(false);
    expect(canMoveLot("active", "hold")).toBe(true);
    expect(canMoveLot("hold", "active")).toBe(true);
    expect(canMoveLot("active", "completed")).toBe(true);
    expect(canMoveLot("completed", "closed")).toBe(true);
    expect(canMoveLot("closed", "active")).toBe(false);
  });
});

describe("rateOn", () => {
  const rates = [{ effectiveFrom: "2026-01-01", rateMinor: 1000 }, { effectiveFrom: "2026-10-01", rateMinor: 1200 }];
  it("picks the newest rate on or before the date, and none before the first", () => {
    expect(rateOn(rates, "2026-10-01")!.rateMinor).toBe(1200);
    expect(rateOn(rates, "2026-09-30")!.rateMinor).toBe(1000);
    expect(rateOn(rates, "2025-12-31")).toBeNull();
  });
});
