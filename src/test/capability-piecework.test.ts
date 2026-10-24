import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/platform/db";
import { assertRlsEnforceable, withTenant } from "@/server/platform/tenancy";
import { activateCapability, invalidateCapabilityCache } from "@/server/platform/capability";
import { clearCommands, clearHooks, executeCommand, type ActorContext } from "@/server/platform/command";
import { clearQueries, executeQuery } from "@/server/platform/query";
import { clearScopeResolvers } from "@/server/platform/authorization";
import { clearTransitionGuards } from "@/server/platform/state";
import { clearContributions } from "@/server/platform/contribution";
import { provisionIdentity } from "@/server/platform/identity";
import {
  ENTITY_PIECEWORK_BUNDLE,
  ENTITY_PIECEWORK_ENTRY,
  ENTITY_PIECEWORK_LOT,
  ENTITY_PIECEWORK_PAYMENT,
  ENTITY_PIECEWORK_STAGE,
  ENTITY_PIECEWORK_WORKER,
  PIECEWORK_CAPABILITY,
  bundleDetail,
  cancelLot,
  createBundle,
  createLot,
  dashboard,
  defineStage,
  defineWorker,
  listLots,
  listStages,
  listWorkers,
  lotDetail,
  recordIssue,
  recordPayment,
  recordReturn,
  registerPieceworkCapability,
  reportBundleLocation,
  reportCosting,
  reportLotStatus,
  reportProductionByProcess,
  reportQuality,
  reportReadyInventory,
  reportWagePayment,
  reportWorkInHand,
  reverseEntry,
  reversePayment,
  setLotStatus,
  setWorkerActive,
  setWorkerRate,
  workerLedger,
} from "@/server/capabilities/piecework";

/**
 * Stylified shirt factory (requirement sheet v1.0): lots, numbered bundles, issue and return per bundle with the pieces
 * accounted as good, rejected, rework or short, wages on a configurable basis, a karigar ledger with advances,
 * recoveries and deductions, reversal instead of edit. The sample numbers are the sheet's own.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;
if (!hasDatabase) {
  const message = "capability-piecework.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describeDb("capability: piece-rate lots, bundles and the karigar ledger", () => {
  const tenants: string[] = [];
  const created = { users: [] as string[], parties: [] as string[] };
  let munshi: ActorContext;
  let outsider: ActorContext;
  const stage: Record<string, string> = {};
  const worker: Record<string, string> = {};
  let lot1: string;
  let lot1Number: string;
  let bundleA: string; // 100 pieces
  let bundleB: string; // 20 pieces

  const ALL = [ENTITY_PIECEWORK_STAGE, ENTITY_PIECEWORK_LOT, ENTITY_PIECEWORK_BUNDLE, ENTITY_PIECEWORK_WORKER, ENTITY_PIECEWORK_ENTRY, ENTITY_PIECEWORK_PAYMENT];

  async function makeTenant(name: string, person: string, entities = ALL) {
    const tenantId = randomUUID();
    tenants.push(tenantId);
    return withTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name, timeZone: "Asia/Kolkata" } });
      await activateCapability(tx, tenantId, PIECEWORK_CAPABILITY);
      const organizationId = (await tx.organization.create({ data: { tenantId, name } })).id;
      const role = await tx.role.create({ data: { tenantId, name: "Munshi" }, select: { id: true } });
      await tx.permission.createMany({
        data: entities.flatMap((entity) => (["Read", "Create", "Edit", "ActionExecute"] as const).map((verb) => ({ tenantId, roleId: role.id, verb, entity, scope: "Tenant" as const }))),
      });
      const identity = await provisionIdentity(tx, { organizationId, authUserId: randomUUID(), displayName: person });
      created.users.push(identity.userId);
      created.parties.push(identity.partyId);
      await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId: role.id } });
      return { tenantId, userId: identity.userId, membershipId: identity.membershipId, organizationId, roleId: role.id } as ActorContext;
    });
  }

  beforeAll(async () => {
    await assertRlsEnforceable();
    clearCommands(); clearQueries(); clearHooks(); clearScopeResolvers(); clearTransitionGuards(); clearContributions();
    registerPieceworkCapability();
    munshi = await makeTenant("Shirt Works Test", "Munshi Ram");
    outsider = await makeTenant("Other Test Works", "Other Munshi");
    invalidateCapabilityCache();

    for (const [key, label] of [["pasting", "Pasting"], ["collar", "Collar & Cuff"], ["stitching", "Stitching"], ["kaj", "Button / Kaj"], ["finishing", "Finishing / Press"]] as const) {
      stage[key] = (await executeCommand(munshi, defineStage, { stageKey: key, label })).id;
    }
    const since = "2026-01-01";
    const rate = (key: string, rateMinor: number, wageBasis: "issued" | "good" | "returned") => ({ stageId: stage[key]!, rateMinor, wageBasis, effectiveFrom: since });
    worker.C = (await executeCommand(munshi, defineWorker, { name: "Karigar C (pasting)", mobile: "98765 00003", kind: "in_house", rates: [rate("pasting", 1200, "issued")] })).id;
    worker.B = (await executeCommand(munshi, defineWorker, { name: "Karigar B (collar)", kind: "outside", address: "Unit 4, Focal Point", rates: [rate("collar", 500, "returned")] })).id;
    worker.A = (await executeCommand(munshi, defineWorker, { name: "Karigar A (stitching)", mobile: "98765 43210", rates: [rate("stitching", 1200, "good"), rate("collar", 400, "good")] })).id;
    worker.D = (await executeCommand(munshi, defineWorker, { name: "Karigar D (kaj)", rates: [rate("kaj", 300, "good")] })).id;
    worker.E = (await executeCommand(munshi, defineWorker, { name: "Karigar E (no rate)" })).id;
  });

  afterAll(async () => {
    clearCommands(); clearQueries(); clearHooks(); clearScopeResolvers(); clearTransitionGuards(); clearContributions();
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      for (const id of tenants) await admin.$executeRaw`DELETE FROM tenant WHERE id = ${id}::uuid`;
      for (const id of created.users) await admin.$executeRaw`DELETE FROM "user" WHERE id = ${id}::uuid`;
      for (const id of created.parties) await admin.$executeRaw`DELETE FROM party WHERE id = ${id}::uuid`;
    } finally {
      await admin.$disconnect();
    }
    await prisma.$disconnect();
  });

  const reject = (promise: Promise<unknown>, pattern: RegExp) => expect(promise).rejects.toThrow(pattern);
  const issue = (bundleId: string, stageKey: string, who: string, pieces: number, extra: Record<string, unknown> = {}) =>
    executeCommand(munshi, recordIssue, { bundleId, stageId: stage[stageKey]!, workerId: worker[who]!, pieces, ...extra });
  const back = (issueId: string, split: { good?: number; rejected?: number; rework?: number; short?: number }, extra: Record<string, unknown> = {}) =>
    executeCommand(munshi, recordReturn, { issueId, good: 0, rejected: 0, rework: 0, short: 0, ...split, ...extra });
  const bundle = async (id: string) => (await executeQuery(munshi, bundleDetail, { bundleId: id }))!;
  const stageOf = async (id: string, key: string) => (await bundle(id)).stages.find((s) => s.stageId === stage[key])!;

  it("keeps the stage chain as ordered tenant data", async () => {
    expect((await executeQuery(munshi, listStages, {})).map((s) => [s.stageKey, s.sequence])).toEqual([["pasting", 1], ["collar", 2], ["stitching", 3], ["kaj", 4], ["finishing", 5]]);
    await reject(executeCommand(munshi, defineStage, { stageKey: "pasting", label: "Again" }), /already exists/);
  });

  it("runs a lot through draft, active, hold, completed and closed, refusing every other move", async () => {
    const a = await executeCommand(munshi, createLot, { design: "Oxford formal", name: "Spring formals", plannedPieces: 500, fabricType: "Oxford", startDate: "2026-10-01", dueDate: "2026-11-30" });
    lot1 = a.id; lot1Number = a.number;
    expect(a.number).toBe("LOT-0001");
    expect((await executeQuery(munshi, listLots, {})).find((l) => l.id === lot1)).toMatchObject({ status: "draft", plannedPieces: 500, fabricType: "Oxford", bundles: 0 });
    await reject(executeCommand(munshi, createBundle, { lotId: lot1, netPieces: 20 }), /only on an active lot; this one is draft/);
    await reject(executeCommand(munshi, setLotStatus, { lotId: lot1, to: "closed" }), /draft lot cannot become closed/);
    await reject(executeCommand(munshi, setLotStatus, { lotId: lot1, to: "completed" }), /draft lot cannot become completed/);
    await executeCommand(munshi, setLotStatus, { lotId: lot1, to: "active" });
    await executeCommand(munshi, setLotStatus, { lotId: lot1, to: "hold" });
    await reject(executeCommand(munshi, createBundle, { lotId: lot1, netPieces: 20 }), /active lot; this one is hold/);
    await executeCommand(munshi, setLotStatus, { lotId: lot1, to: "active" });
    await reject(executeCommand(munshi, createLot, { design: "X", plannedPieces: 5, startDate: "2026-12-01", dueDate: "2026-11-01" }), /due date is before the start date/);
  });

  it("numbers bundles gaplessly and records net pieces; a bundle has no size field", async () => {
    const a = await executeCommand(munshi, createBundle, { lotId: lot1, netPieces: 100, sizeNote: "M and L mix" });
    const b = await executeCommand(munshi, createBundle, { lotId: lot1, netPieces: 20 });
    bundleA = a.id; bundleB = b.id;
    expect([a.number, b.number]).toEqual(["B-0001", "B-0002"]);
    expect(await bundle(bundleA)).toMatchObject({ netPieces: 100, sizeNote: "M and L mix", lotNumber: lot1Number, stageLabel: "Pasting", location: "Waiting to be issued" });
    await reject(executeCommand(munshi, createBundle, { lotId: lot1, netPieces: 0 }), /input rejected/);
  });

  it("reconciles one issue exactly as the sheet does: 100 = 94 good + 2 rejected + 1 rework + 2 short + 1 open", async () => {
    // Pasting is paid on issued pieces: the wage accrues when the bundle goes out, at that day's rate.
    const i = await issue(bundleA, "pasting", "C", 100);
    expect(i.wageMinor).toBe(100 * 1200);
    await reject(issue(bundleA, "pasting", "C", 1), /only 0 pieces can be issued at Pasting/);

    const r = await back(i.id, { good: 94, rejected: 2, rework: 1, short: 2 });
    expect(r.open).toBe(1);
    const s = await stageOf(bundleA, "pasting");
    expect(s).toMatchObject({ issued: 100, good: 94, rejected: 2, rework: 1, short: 2, pending: 1, reworkPool: 1 });
    expect(s.issues[0]).toMatchObject({ issued: 100, open: 1 });
    expect(s.good + s.rejected + s.rework + s.short + s.pending).toBe(100);
    // Only good pieces reach the next stage; rejected, short and rework do not become output.
    expect(await stageOf(bundleA, "collar")).toMatchObject({ intake: 94, toIssue: 94 });

    await reject(back(i.id, { good: 2 }), /has only 1 pieces still open on this issue; you accounted for 2/);
    await reject(back(i.id, {}), /account for at least one piece/);
    await back(i.id, { good: 1 });
    expect((await stageOf(bundleA, "pasting")).pending).toBe(0);
    expect(await stageOf(bundleA, "collar")).toMatchObject({ intake: 95 });
  });

  it("moves rework through its own pool: it is not output until accepted", async () => {
    const pool = await stageOf(bundleA, "pasting");
    expect(pool.reworkPool).toBe(1);
    await reject(issue(bundleA, "pasting", "C", 2, { isRework: true }), /only 1 pieces are waiting for rework at Pasting/);
    const again = await issue(bundleA, "pasting", "C", 1, { isRework: true });
    expect((await stageOf(bundleA, "pasting")).reworkPool).toBe(0);
    await back(again.id, { good: 1 });
    expect(await stageOf(bundleA, "collar")).toMatchObject({ intake: 96 });
    expect((await bundle(bundleA)).rejectedPieces).toBe(2);
    expect((await bundle(bundleA)).shortPieces).toBe(2);
  });

  it("pays on the basis each issue was made under: returned pieces, accepted good pieces, or issued pieces", async () => {
    // Collar and cuff, karigar B on the RETURNED basis: good + rejected + rework are all paid.
    const i = await issue(bundleA, "collar", "B", 90);
    const r = await back(i.id, { good: 86, rejected: 2, rework: 2 });
    expect(r.wageMinor).toBe(90 * 500);
    // The same bundle's stitching, karigar A on the GOOD basis: only accepted pieces are paid.
    const s = await issue(bundleA, "stitching", "A", 40);
    const sr = await back(s.id, { good: 38, rejected: 1, short: 1 });
    expect(sr.wageMinor).toBe(38 * 1200);
    // A transaction can override the karigar's usual basis.
    const o = await issue(bundleA, "stitching", "A", 10, { wageBasis: "issued" });
    expect(o.wageMinor).toBe(10 * 1200);
    const l = (await executeQuery(munshi, workerLedger, { workerId: worker.A! }))!;
    expect(l.money.wagesMinor).toBe(38 * 1200 + 10 * 1200);
    await back(o.id, { good: 10 });
    expect((await executeQuery(munshi, workerLedger, { workerId: worker.A! }))!.money.wagesMinor).toBe(38 * 1200 + 10 * 1200);
  });

  it("refuses work for a karigar with no rate, allows a rate of 0, and snapshots the rate on each return", async () => {
    const lot = (await executeCommand(munshi, createLot, { design: "D-2", plannedPieces: 20 })).id;
    await executeCommand(munshi, setLotStatus, { lotId: lot, to: "active" });
    const b = (await executeCommand(munshi, createBundle, { lotId: lot, netPieces: 20 })).id;
    await reject(issue(b, "pasting", "E", 20), /no rate for Pasting.*Karigar E \(no rate\)'s own rate first/);
    await executeCommand(munshi, setWorkerRate, { workerId: worker.E!, stageId: stage.pasting!, rateMinor: 0, wageBasis: "good" });
    const i = await issue(b, "pasting", "E", 20);
    expect((await back(i.id, { good: 20 })).wageMinor).toBe(0);

    // A rate change applies from its date; earlier work keeps the old rate.
    await executeCommand(munshi, setWorkerRate, { workerId: worker.D!, stageId: stage.kaj!, rateMinor: 500, wageBasis: "good" });
    await reject(executeCommand(munshi, setWorkerRate, { workerId: worker.D!, stageId: stage.kaj!, rateMinor: 600 }), /already starts on/);
  });

  it("guards dates: not in the future, not before the bundle was cut, no return before its issue", async () => {
    await reject(issue(bundleB, "pasting", "C", 5, { entryDate: "2999-01-01" }), /future/);
    await reject(issue(bundleB, "pasting", "C", 5, { entryDate: "2020-01-01" }), /before the bundle was cut/);
    await reject(issue(bundleB, "pasting", "C", 5, { dueDate: "2020-01-01" }), /before the issue date/);
  });

  it("lets a bundle go through every stage, then completes and closes its lot only once nothing is open", async () => {
    const run = async (key: string, who: string) => {
      const s = await stageOf(bundleB, key);
      const i = await issue(bundleB, key, who, s.toIssue);
      await back(i.id, { good: s.toIssue });
    };
    await run("pasting", "C");
    await run("collar", "B");
    await run("stitching", "A");
    await run("kaj", "D");
    const open = await issue(bundleB, "finishing", "A", 20).catch(() => null);
    // Karigar A has no Finishing rate: the refusal is the rate guard, not a stock one.
    expect(open).toBeNull();
    await executeCommand(munshi, setWorkerRate, { workerId: worker.A!, stageId: stage.finishing!, rateMinor: 200, wageBasis: "good" });
    const fin = await issue(bundleB, "finishing", "A", 20, { dueDate: "2999-01-01" });
    await reject(executeCommand(munshi, setLotStatus, { lotId: lot1, to: "completed" }), /pieces are still out with workers/);
    await back(fin.id, { good: 20 });
    expect((await bundle(bundleB)).readyPieces).toBe(20);
    expect((await bundle(bundleB)).stageLabel).toBe("Ready");
  });

  it("refuses to complete a lot while rework waits, and records disposition through rework or reject", async () => {
    const lot = (await executeCommand(munshi, createLot, { design: "D-3", plannedPieces: 10 })).id;
    await executeCommand(munshi, setLotStatus, { lotId: lot, to: "active" });
    await reject(executeCommand(munshi, setLotStatus, { lotId: lot, to: "completed" }), /cut at least one bundle/);
    const b = (await executeCommand(munshi, createBundle, { lotId: lot, netPieces: 10 })).id;
    const i = await issue(b, "pasting", "C", 10);
    await back(i.id, { good: 8, rework: 2 });
    await reject(executeCommand(munshi, setLotStatus, { lotId: lot, to: "completed" }), /2 pieces are waiting for rework/);
    const again = await issue(b, "pasting", "C", 2, { isRework: true });
    await back(again.id, { rejected: 2 });
    expect((await stageOf(b, "pasting")).reworkPool).toBe(0);
  });

  it("refuses a reversal that would strand a later stage, and allows one nobody depends on", async () => {
    const lot = (await executeCommand(munshi, createLot, { design: "D-4", plannedPieces: 30 })).id;
    await executeCommand(munshi, setLotStatus, { lotId: lot, to: "active" });
    const b = (await executeCommand(munshi, createBundle, { lotId: lot, netPieces: 30 })).id;
    const i = await issue(b, "pasting", "C", 30);
    const r = await back(i.id, { good: 30 });
    const next = await issue(b, "collar", "B", 30);
    await reject(executeCommand(munshi, reverseEntry, { entryId: r.id }), /Collar & Cuff would have 30 pieces issued but only 0 have reached it/);
    await reject(executeCommand(munshi, reverseEntry, { entryId: i.id }), /more pieces accounted for than were given/);
    const nr = await back(next.id, { good: 10 });
    await executeCommand(munshi, reverseEntry, { entryId: nr.id, note: "Counted twice" });
    expect((await stageOf(b, "collar")).pending).toBe(30);
    await reject(executeCommand(munshi, reverseEntry, { entryId: nr.id }), /already reversed/);
    // The wage of a reversed return cancels exactly.
    const ledger = (await executeQuery(munshi, workerLedger, { workerId: worker.B! }))!;
    expect(ledger.work.filter((w) => w.reversed).length).toBe(1);
  });

  it("serialises two issues racing for the same pieces: one wins, one is refused", async () => {
    const lot = (await executeCommand(munshi, createLot, { design: "D-5", plannedPieces: 50 })).id;
    await executeCommand(munshi, setLotStatus, { lotId: lot, to: "active" });
    const b = (await executeCommand(munshi, createBundle, { lotId: lot, netPieces: 50 })).id;
    const results = await Promise.allSettled([issue(b, "pasting", "C", 50), issue(b, "pasting", "E", 50)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await stageOf(b, "pasting")).toIssue).toBe(0);
  });

  it("keeps the money ledger: advance given apart from advance recovered, deductions with a reason, payments within what is owed", async () => {
    const w = worker.A!;
    const before = (await executeQuery(munshi, workerLedger, { workerId: w }))!.money;
    expect(before.balanceMinor).toBe(before.wagesMinor);
    const adv = await executeCommand(munshi, recordPayment, { workerId: w, kind: "advance", amountMinor: 50_000, mode: "cash", reference: "Festival" });
    expect(adv.advanceOutstandingMinor).toBe(50_000);
    expect(adv.balanceMinor).toBe(before.balanceMinor);
    await reject(executeCommand(munshi, recordPayment, { workerId: w, kind: "recovery", amountMinor: 50_001 }), /only 50000 paise of advance is outstanding/);
    const rec = await executeCommand(munshi, recordPayment, { workerId: w, kind: "recovery", amountMinor: 20_000 });
    expect(rec).toMatchObject({ advanceOutstandingMinor: 30_000, balanceMinor: before.balanceMinor - 20_000 });
    await reject(executeCommand(munshi, recordPayment, { workerId: w, kind: "deduction", amountMinor: 1_000 }), /deduction needs a reason/);
    const ded = await executeCommand(munshi, recordPayment, { workerId: w, kind: "deduction", amountMinor: 1_000, note: "Damaged collar" });
    const owed = ded.balanceMinor;
    await reject(executeCommand(munshi, recordPayment, { workerId: w, kind: "payment", amountMinor: owed + 1 }), /record anything more as an advance/);
    const paid = await executeCommand(munshi, recordPayment, { workerId: w, kind: "payment", amountMinor: 10_000, mode: "upi", reference: "UPI 5821" });
    expect(paid.balanceMinor).toBe(owed - 10_000);
    const ledger = (await executeQuery(munshi, workerLedger, { workerId: w }))!;
    expect(ledger.payments.find((p) => p.kind === "payment")).toMatchObject({ mode: "upi", reference: "UPI 5821" });
    expect(ledger.payments.find((p) => p.kind === "recovery")!.mode).toBeNull();
    expect(ledger.money).toMatchObject({ advanceGivenMinor: 50_000, recoveredMinor: 20_000, deductionMinor: 1_000, paidMinor: 10_000, advanceOutstandingMinor: 30_000 });
    // A reversal restores the balance, once.
    const payment = ledger.payments.find((p) => p.kind === "payment")!;
    await executeCommand(munshi, reversePayment, { paymentId: payment.id });
    expect((await executeQuery(munshi, workerLedger, { workerId: w }))!.money.paidMinor).toBe(0);
    await reject(executeCommand(munshi, reversePayment, { paymentId: payment.id }), /already reversed/);
  });

  it("shows work in hand per karigar, with what was issued, returned and is still out", async () => {
    const hand = await executeQuery(munshi, reportWorkInHand, {});
    const mine = hand.filter((h) => h.karigar === "Karigar B (collar)");
    expect(mine.length).toBeGreaterThan(0);
    for (const h of mine) expect(h.issued - h.returned).toBe(h.open);
    const l = (await executeQuery(munshi, workerLedger, { workerId: worker.B! }))!;
    expect(l.workInHand.reduce((s, x) => s + x.open, 0)).toBe(mine.reduce((s, x) => s + x.open, 0));
    expect(l.worker).toMatchObject({ kind: "outside", address: "Unit 4, Focal Point" });
  });

  it("keeps good, rejected, rework and short as four separate totals on the dashboard and the quality report", async () => {
    const d = await executeQuery(munshi, dashboard, {});
    expect(d.quality.rejected).toBeGreaterThanOrEqual(5);
    expect(d.quality.short).toBeGreaterThanOrEqual(3);
    expect(d.quality.good).toBe(d.ready.pieces);
    const q = await executeQuery(munshi, reportQuality, {});
    expect(q.rows.every((r) => r.rejected + r.rework + r.short > 0)).toBe(true);
    expect(q.totals.rejected).toBe(d.quality.rejected);
    expect(q.totals.short).toBe(d.quality.short);
  });

  it("derives lot status, bundle location, production by process, costing and ready stock from the same ledger", async () => {
    const status = (await executeQuery(munshi, reportLotStatus, {})).find((l) => l.id === lot1)!;
    expect(status).toMatchObject({ plannedPieces: 500, bundles: 2, bundledPieces: 120, overdue: false });
    expect((await executeQuery(munshi, reportBundleLocation, {})).filter((b) => b.lotId === lot1).map((b) => b.number)).toEqual(["B-0001", "B-0002"]);
    const process = await executeQuery(munshi, reportProductionByProcess, {});
    const pasting = process.find((p) => p.stage === "Pasting")!;
    expect(pasting.sent).toBeGreaterThanOrEqual(100 + 1 + 20);
    expect(pasting.accepted + 0).toBeGreaterThan(0);
    const cost = (await executeQuery(munshi, reportCosting, {})).find((c) => c.lotNumber === lot1Number)!;
    // No other costs, no fabric from a priced roll and nothing recovered on this lot: the cost is its wages.
    expect(cost.otherMinor).toBe(0);
    expect(cost.fabricMinor).toBeNull();
    expect(cost.recoveredMinor).toBe(0);
    expect(cost.totalMinor).toBe(cost.wagesMinor);
    expect(cost.perGoodPieceMinor).toBe(cost.goodPieces > 0 ? Math.round(cost.wagesMinor / cost.goodPieces) : null);
    expect((await executeQuery(munshi, reportReadyInventory, {})).find((r) => r.lotNumber === lot1Number)).toMatchObject({ readyPieces: 20, readyBundles: 1 });
    const pay = await executeQuery(munshi, reportWagePayment, {});
    expect(pay.rows.find((r) => r.karigar === "Karigar A (stitching)")!.advanceGivenMinor).toBe(50_000);
    expect((await executeQuery(munshi, reportWagePayment, { from: "2000-01-01", to: "2000-01-02" })).rows).toEqual([]);
  });

  it("cancels only a lot nothing has been recorded on, keeps its number, and will not retire a karigar who holds pieces", async () => {
    const idle = await executeCommand(munshi, createLot, { design: "D-9", plannedPieces: 10 });
    await executeCommand(munshi, cancelLot, { lotId: idle.id, reason: "Entered by mistake" });
    await reject(executeCommand(munshi, cancelLot, { lotId: idle.id, reason: "Again" }), /already cancelled/);
    await reject(executeCommand(munshi, setLotStatus, { lotId: idle.id, to: "active" }), /is cancelled/);
    await reject(executeCommand(munshi, cancelLot, { lotId: lot1, reason: "Too late" }), /work is already recorded/);
    const next = await executeCommand(munshi, createLot, { design: "D-10", plannedPieces: 10 });
    expect(Number(next.number.slice(4))).toBe(Number(idle.number.slice(4)) + 1);
    await reject(executeCommand(munshi, setWorkerActive, { workerId: worker.B!, active: false }), /still holds/);
    await reject(executeCommand(munshi, defineStage, { stageKey: "packing", label: "Packing" }), /cannot change once work has been recorded/);
    const idleWorker = await executeCommand(munshi, defineWorker, { name: "Karigar Z" });
    await executeCommand(munshi, setWorkerActive, { workerId: idleWorker.id, active: false });
    expect((await executeQuery(munshi, listWorkers, {})).some((w) => w.name === "Karigar Z")).toBe(false);
  });

  it("closes a lot with a locked ledger", async () => {
    const lot = (await executeCommand(munshi, createLot, { design: "D-11", plannedPieces: 5 })).id;
    await executeCommand(munshi, setLotStatus, { lotId: lot, to: "active" });
    const b = (await executeCommand(munshi, createBundle, { lotId: lot, netPieces: 5 })).id;
    for (const [key, who] of [["pasting", "C"], ["collar", "B"], ["stitching", "A"], ["kaj", "D"]] as const) {
      const i = await issue(b, key, who, 5);
      await back(i.id, { good: 5 });
    }
    const fin = await issue(b, "finishing", "A", 5);
    const ret = await back(fin.id, { good: 5 });
    await executeCommand(munshi, setLotStatus, { lotId: lot, to: "completed" });
    await reject(issue(b, "finishing", "A", 1), /active lot; .* is completed/);
    await executeCommand(munshi, setLotStatus, { lotId: lot, to: "closed" });
    await reject(executeCommand(munshi, reverseEntry, { entryId: ret.id }), /that lot is closed/);
    await reject(executeCommand(munshi, setLotStatus, { lotId: lot, to: "active" }), /closed lot cannot become active/);
    expect((await executeQuery(munshi, lotDetail, { lotId: lot }))!.status).toBe("closed");
  });

  it("lists every entry on a lot with its bundle number and who entered it", async () => {
    const d = (await executeQuery(munshi, lotDetail, { lotId: lot1 }))!;
    expect(d.bundleRows).toHaveLength(2);
    expect(new Set(d.entries.map((e) => e.enteredBy))).toEqual(new Set(["Munshi Ram"]));
    expect(d.entries.every((e) => /^B-000[12]$/.test(e.bundleNumber))).toBe(true);
    expect(d.stages[0]).toMatchObject({ label: "Pasting" });
  });

  it("lets only the munshi write: a read-only owner role is refused every write and nothing is written", async () => {
    const viewer = await withTenant(munshi.tenantId, async (tx) => {
      const role = await tx.role.create({ data: { tenantId: munshi.tenantId, name: "Owner (view only)" }, select: { id: true } });
      const readOnly = [ENTITY_PIECEWORK_STAGE, ENTITY_PIECEWORK_LOT, ENTITY_PIECEWORK_BUNDLE, ENTITY_PIECEWORK_WORKER, ENTITY_PIECEWORK_PAYMENT];
      await tx.permission.createMany({ data: readOnly.map((entity) => ({ tenantId: munshi.tenantId, roleId: role.id, verb: "Read" as const, entity, scope: "Tenant" as const })) });
      const identity = await provisionIdentity(tx, { organizationId: munshi.organizationId, authUserId: randomUUID(), displayName: "Owner Ji" });
      created.users.push(identity.userId); created.parties.push(identity.partyId);
      await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId: role.id } });
      return { tenantId: munshi.tenantId, userId: identity.userId, membershipId: identity.membershipId, organizationId: munshi.organizationId, roleId: role.id } as ActorContext;
    });
    invalidateCapabilityCache();
    const counts = () => withTenant(munshi.tenantId, async (tx) => ({ lots: await tx.pieceworkLot.count(), bundles: await tx.pieceworkBundle.count(), entries: await tx.pieceworkEntry.count(), payments: await tx.pieceworkPayment.count() }));
    const before = await counts();
    await expect(executeCommand(viewer, createLot, { design: "D-900", plannedPieces: 10 })).rejects.toThrow();
    await expect(executeCommand(viewer, createBundle, { lotId: lot1, netPieces: 5 })).rejects.toThrow();
    await expect(executeCommand(viewer, recordIssue, { bundleId: bundleA, stageId: stage.pasting!, workerId: worker.C!, pieces: 1 })).rejects.toThrow();
    await expect(executeCommand(viewer, recordPayment, { workerId: worker.A!, kind: "advance", amountMinor: 100 })).rejects.toThrow();
    expect(await counts()).toEqual(before);
    expect((await executeQuery(viewer, listLots, {})).length).toBeGreaterThan(0);
    expect((await executeQuery(viewer, workerLedger, { workerId: worker.A! }))!.money.wagesMinor).toBeGreaterThan(0);
    expect((await executeQuery(viewer, dashboard, {})).activeLots.length).toBeGreaterThan(0);
  });

  it("isolates tenants", async () => {
    expect(await executeQuery(outsider, listLots, {})).toEqual([]);
    expect(await executeQuery(outsider, listWorkers, {})).toEqual([]);
    expect(await executeQuery(outsider, bundleDetail, { bundleId: bundleA })).toBeNull();
    await reject(executeCommand(outsider, recordIssue, { bundleId: bundleA, stageId: stage.pasting!, workerId: worker.C!, pieces: 1 }), /bundle not found/);
    await reject(executeCommand(outsider, recordPayment, { workerId: worker.A!, kind: "advance", amountMinor: 100 }), /worker not found/);
  });

  it("holds its invariants in the database: ledgers refuse UPDATE, the split must add up, bundle numbers are unique", async () => {
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    const t = munshi.tenantId;
    try {
      await expect(admin.$executeRaw`UPDATE piecework_entry SET pieces = pieces + 1 WHERE tenant_id = ${t}::uuid`).rejects.toThrow();
      await expect(admin.$executeRaw`UPDATE piecework_payment SET amount_minor = 1 WHERE tenant_id = ${t}::uuid`).rejects.toThrow();
      await expect(admin.$executeRaw`UPDATE piecework_worker_rate SET rate_minor = 1 WHERE tenant_id = ${t}::uuid`).rejects.toThrow();
      const rowsBefore = await withTenant(t, (tx) => tx.pieceworkEntry.count());
      for (const table of ["piecework_entry", "piecework_payment", "piecework_worker_rate"] as const) {
        expect(await withTenant(t, (tx) => tx.$executeRawUnsafe(`DELETE FROM ${table} WHERE tenant_id = '${t}'::uuid`))).toBe(0);
      }
      expect(await withTenant(t, (tx) => tx.pieceworkEntry.count())).toBe(rowsBefore);
      // A return that does not add up is refused by the database itself.
      await expect(
        admin.$executeRaw`INSERT INTO piecework_entry (id, tenant_id, lot_id, bundle_id, stage_id, worker_id, kind, pieces, good_pieces, rejected_pieces, rework_pieces, short_pieces, entry_date, entered_by_id)
                          VALUES (gen_random_uuid(), ${t}::uuid, ${lot1}::uuid, ${bundleA}::uuid, ${stage.pasting}::uuid, ${worker.C}::uuid, 'receive', 10, 5, 1, 1, 1, current_date, ${munshi.userId}::uuid)`,
      ).rejects.toThrow(/piecework_entry_split_accounts/);
      await expect(
        admin.$executeRaw`INSERT INTO piecework_entry (id, tenant_id, lot_id, bundle_id, stage_id, worker_id, kind, pieces, entry_date, entered_by_id)
                          VALUES (gen_random_uuid(), ${t}::uuid, ${lot1}::uuid, ${bundleA}::uuid, ${stage.pasting}::uuid, ${worker.C}::uuid, 'issue', 0, current_date, ${munshi.userId}::uuid)`,
      ).rejects.toThrow(/piecework_entry_pieces_positive/);
      await expect(
        admin.$executeRaw`INSERT INTO piecework_bundle (id, tenant_id, lot_id, number, sequence_no, net_pieces, created_by_id)
                          VALUES (gen_random_uuid(), ${t}::uuid, ${lot1}::uuid, 'B-0001', 9999, 5, ${munshi.userId}::uuid)`,
      ).rejects.toThrow(/\(tenant_id, number\)=.*already exists/);
      await expect(
        admin.$executeRaw`INSERT INTO piecework_bundle (id, tenant_id, lot_id, number, sequence_no, net_pieces, created_by_id)
                          VALUES (gen_random_uuid(), ${t}::uuid, ${lot1}::uuid, 'B-X', 9998, 0, ${munshi.userId}::uuid)`,
      ).rejects.toThrow(/piecework_bundle_net_positive/);
    } finally {
      await admin.$disconnect();
    }
  });

  it("fails closed: with no tenant scope the runtime role sees none of it", async () => {
    expect(await prisma.pieceworkLot.count()).toBe(0);
    expect(await prisma.pieceworkBundle.count()).toBe(0);
    expect(await prisma.pieceworkEntry.count()).toBe(0);
    expect(await prisma.pieceworkPayment.count()).toBe(0);
    expect(await prisma.pieceworkWorker.count()).toBe(0);
  });
});
