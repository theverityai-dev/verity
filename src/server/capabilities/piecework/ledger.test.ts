import { describe, expect, it } from "vitest";
import {
  bundlesOf,
  computePosition,
  daysBetween,
  daysInStage,
  daysSinceMovement,
  findViolation,
  rateOn,
  workerMoney,
  type LedgerEntry,
  type StageRef,
} from "./ledger";

/**
 * The numbers below are the client PRD's own sample (Garment_Visual_Blueprint pages 2 and 6): a 500-piece lot moving
 * through five working stages, and Karigar A at Rs 12 a piece. If these derive correctly, the screens built on them
 * show what the client was promised.
 */

const STAGES: StageRef[] = [
  { id: "cut", sequence: 1, label: "Cutting" },
  { id: "stitch", sequence: 2, label: "Stitching" },
  { id: "kaj", sequence: 3, label: "Button / Kaj" },
  { id: "finish", sequence: 4, label: "Finishing" },
  { id: "press", sequence: 5, label: "Press" },
];

let n = 0;
const entry = (
  stageId: string,
  kind: "issue" | "receive",
  pieces: number,
  entryDate: string,
  workerId = "A",
  extra: Partial<LedgerEntry> = {},
): LedgerEntry => ({ id: `e${++n}`, stageId, workerId, kind, pieces, reversesId: null, entryDate, rateMinor: kind === "receive" ? 1200 : null, ...extra });

const reversal = (original: LedgerEntry, entryDate: string): LedgerEntry => ({ ...original, id: `r${++n}`, reversesId: original.id, entryDate });

/** The PRD's page-2 lot: cutting 500/500, stitching 500/320, kaj 320/200, finishing 200/150, press 150/100. */
function prdLot(): LedgerEntry[] {
  return [
    entry("cut", "issue", 500, "2026-10-14", "cutter"),
    entry("cut", "receive", 500, "2026-10-16", "cutter"),
    entry("stitch", "issue", 500, "2026-10-16", "A"),
    entry("stitch", "receive", 320, "2026-10-22", "A"),
    entry("kaj", "issue", 320, "2026-10-22", "B"),
    entry("kaj", "receive", 200, "2026-10-26", "B"),
    entry("finish", "issue", 200, "2026-10-26", "C"),
    entry("finish", "receive", 150, "2026-10-29", "C"),
    entry("press", "issue", 150, "2026-10-29", "D"),
    entry("press", "receive", 100, "2026-10-31", "D"),
  ];
}

const names = (id: string) => `Karigar ${id}`;

describe("computePosition", () => {
  const p = computePosition(500, STAGES, prdLot());
  const stage = (id: string) => p.stages.find((s) => s.stageId === id)!;

  it("derives issued, received and pending at every stage exactly as the blueprint shows", () => {
    expect(p.stages.map((s) => [s.issued, s.received, s.pending])).toEqual([
      [500, 500, 0],
      [500, 320, 180],
      [320, 200, 120],
      [200, 150, 50],
      [150, 100, 50],
    ]);
  });

  it("feeds each stage from the one before, and the first from the lot total", () => {
    expect(p.stages.map((s) => s.available)).toEqual([500, 500, 320, 200, 150]);
    expect(p.stages.map((s) => s.toIssue)).toEqual([0, 0, 0, 0, 0]);
  });

  it("holds ready stock as what has been received at the last stage", () => {
    expect(p.ready).toBe(100);
  });

  it("names the current stage as the earliest still holding pieces", () => {
    expect(p.currentStageId).toBe("stitch");
  });

  it("splits a stage's pieces by worker", () => {
    expect(stage("stitch").byWorker.get("A")).toEqual({ issued: 500, received: 320, pending: 180 });
  });

  it("falls back to the first stage with pieces waiting when nothing is out, and to none when all is ready", () => {
    expect(computePosition(500, STAGES, []).currentStageId).toBe("cut");
    const done = computePosition(40, STAGES, STAGES.flatMap((s) => [entry(s.id, "issue", 40, "2026-10-01"), entry(s.id, "receive", 40, "2026-10-02")]));
    expect(done.ready).toBe(40);
    expect(done.currentStageId).toBeNull();
  });
});

describe("days", () => {
  const p = computePosition(500, STAGES, prdLot());
  const stage = (id: string) => p.stages.find((s) => s.stageId === id)!;

  it("counts calendar days between business dates", () => {
    expect(daysBetween("2026-10-14", "2026-10-16")).toBe(2);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
  });

  it("runs a finished stage from first issue to last receive", () => {
    expect(daysInStage(stage("cut"), "2026-12-31")).toBe(2);
  });

  it("runs an open stage up to today", () => {
    expect(daysInStage(stage("stitch"), "2026-10-28")).toBe(12);
  });

  it("has no days for a stage nothing ever reached", () => {
    const empty = computePosition(10, STAGES, []);
    expect(daysInStage(empty.stages[0]!, "2026-10-28")).toBeNull();
  });

  it("measures the stuck time from the last movement", () => {
    expect(daysSinceMovement(p, "2026-11-04")).toBe(4);
    expect(daysSinceMovement(computePosition(10, STAGES, []), "2026-11-04")).toBeNull();
  });
});

describe("reversal, not edit", () => {
  it("cancels an entry exactly and leaves the original in the ledger", () => {
    const rows = prdLot();
    const wrong = entry("stitch", "receive", 30, "2026-10-23");
    const after = computePosition(500, STAGES, [...rows, wrong, reversal(wrong, "2026-10-23")]);
    expect(after.stages[1]).toMatchObject({ issued: 500, received: 320, pending: 180 });
  });

  it("does not move first-issue or last-receive dates", () => {
    const rows = prdLot();
    const wrong = entry("stitch", "receive", 30, "2026-12-01");
    const after = computePosition(500, STAGES, [...rows, wrong, reversal(wrong, "2026-12-02")]);
    expect(after.stages[1]!.lastReceiveDate).toBe("2026-12-01");
    // The reversal is dated later and still never becomes "the last receive"; movement dates do see it.
    expect(after.lastMovementDate).toBe("2026-12-02");
  });
});

describe("findViolation", () => {
  it("accepts a consistent lot", () => {
    expect(findViolation(computePosition(500, STAGES, prdLot()), names)).toBeNull();
  });

  it("refuses issuing more than the previous stage has handed on", () => {
    const rows = [...prdLot(), entry("kaj", "issue", 1, "2026-11-01", "B")];
    const v = findViolation(computePosition(500, STAGES, rows), names);
    expect(v).toMatchObject({ code: "over_issue", stageId: "kaj" });
    expect(v!.message).toContain("Button / Kaj");
  });

  it("refuses a receive beyond what was issued", () => {
    const rows = [...prdLot(), entry("stitch", "receive", 181, "2026-11-01", "A")];
    expect(findViolation(computePosition(500, STAGES, rows), names)).toMatchObject({ code: "over_receive", stageId: "stitch" });
  });

  it("refuses one worker returning more than that worker was given, even if the stage total allows it", () => {
    const rows = [
      entry("cut", "issue", 100, "2026-10-01", "A"),
      entry("cut", "issue", 100, "2026-10-01", "B"),
      entry("cut", "receive", 150, "2026-10-02", "A"),
    ];
    expect(findViolation(computePosition(200, STAGES, rows), names)).toMatchObject({ code: "worker_over_receive", workerId: "A" });
  });

  it("refuses a reversal that would strand the next stage", () => {
    const rows = prdLot();
    const cutReceive = rows.find((r) => r.stageId === "cut" && r.kind === "receive")!;
    const v = findViolation(computePosition(500, STAGES, [...rows, reversal(cutReceive, "2026-11-01")]), names);
    expect(v).toMatchObject({ code: "over_issue", stageId: "stitch" });
  });

  it("allows reversing a receive nobody has issued from", () => {
    const rows = prdLot();
    const pressReceive = rows.find((r) => r.stageId === "press" && r.kind === "receive")!;
    expect(findViolation(computePosition(500, STAGES, [...rows, reversal(pressReceive, "2026-11-01")]), names)).toBeNull();
  });
});

describe("bundles", () => {
  it("counts from pieces at the lot's bundle size, a part bundle counting as one", () => {
    expect(bundlesOf(100, 20)).toBe(5);
    expect(bundlesOf(40, 20)).toBe(2);
    expect(bundlesOf(45, 20)).toBe(3);
    expect(bundlesOf(0, 20)).toBe(0);
  });
});

describe("worker money", () => {
  it("reproduces the PRD's Karigar A card: Rs 3,000 earned, Rs 500 advance, Rs 1,000 paid, Rs 1,500 due", () => {
    const entries = [entry("stitch", "receive", 150, "2026-10-12"), entry("stitch", "receive", 100, "2026-10-14")];
    const money = workerMoney(entries, [
      { kind: "advance", amountMinor: 50_000, reversesId: null },
      { kind: "payment", amountMinor: 100_000, reversesId: null },
    ]);
    expect(money).toEqual({ wagesMinor: 300_000, advanceMinor: 50_000, paidMinor: 100_000, balanceMinor: 150_000 });
  });

  it("earns nothing on an issue and cancels a reversed receive's wage exactly", () => {
    const received = entry("stitch", "receive", 100, "2026-10-12");
    const entries = [entry("stitch", "issue", 100, "2026-10-11"), received, reversal(received, "2026-10-13")];
    expect(workerMoney(entries, []).wagesMinor).toBe(0);
  });

  it("pays at the rate snapshotted on each entry, so a later rate change never rewrites old work", () => {
    const entries = [entry("stitch", "receive", 100, "2026-10-12", "A", { rateMinor: 1200 }), entry("stitch", "receive", 100, "2026-11-12", "A", { rateMinor: 1500 })];
    expect(workerMoney(entries, []).wagesMinor).toBe(100 * 1200 + 100 * 1500);
  });

  it("lets a reversed payment restore the balance", () => {
    const money = workerMoney([entry("stitch", "receive", 10, "2026-10-12")], [
      { kind: "payment", amountMinor: 12_000, reversesId: null },
      { kind: "payment", amountMinor: 12_000, reversesId: "p1" },
    ]);
    expect(money.balanceMinor).toBe(12_000);
  });

  it("shows an unrecovered advance as a negative balance", () => {
    expect(workerMoney([], [{ kind: "advance", amountMinor: 50_000, reversesId: null }]).balanceMinor).toBe(-50_000);
  });
});

describe("rateOn", () => {
  const rates = [
    { effectiveFrom: "2026-01-01", rateMinor: 1000 },
    { effectiveFrom: "2026-10-01", rateMinor: 1200 },
    { effectiveFrom: "2026-12-01", rateMinor: 1500 },
  ];
  it("picks the newest rate on or before the date", () => {
    expect(rateOn(rates, "2026-10-01")!.rateMinor).toBe(1200);
    expect(rateOn(rates, "2026-11-30")!.rateMinor).toBe(1200);
    expect(rateOn(rates, "2027-01-01")!.rateMinor).toBe(1500);
  });
  it("has none before the first rate", () => {
    expect(rateOn(rates, "2025-12-31")).toBeNull();
  });
});
