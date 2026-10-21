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
  ENTITY_PIECEWORK_ENTRY,
  ENTITY_PIECEWORK_LOT,
  ENTITY_PIECEWORK_PAYMENT,
  ENTITY_PIECEWORK_STAGE,
  ENTITY_PIECEWORK_WORKER,
  PIECEWORK_CAPABILITY,
  cancelLot,
  createLot,
  dashboard,
  defineStage,
  recentEntries,
  reportCosting,
  reportLotProduction,
  reportReadyInventory,
  reportWorkerPayment,
  defineWorker,
  listLots,
  listStages,
  listWorkers,
  lotDetail,
  recordEntry,
  recordPayment,
  registerPieceworkCapability,
  reverseEntry,
  reversePayment,
  setWorkerActive,
  setWorkerRate,
  workerLedger,
} from "@/server/capabilities/piecework";

/**
 * Stylified demo: piece-rate lots and the karigar ledger, against the client PRD's own sample. Pieces are issued
 * and received per stage; everything shown is derived from two append-only ledgers; a mistake is a reversal.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;
if (!hasDatabase) {
  const message = "capability-piecework.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describeDb("capability: piece-rate lots and the karigar ledger", () => {
  const tenants: string[] = [];
  const created = { users: [] as string[], parties: [] as string[] };

  let munshi: ActorContext;
  let outsider: ActorContext;
  const stage: Record<string, string> = {};
  const worker: Record<string, string> = {};
  let lot1: string;
  let lot1Number: string;

  async function makeTenant(name: string, person: string) {
    const tenantId = randomUUID();
    tenants.push(tenantId);
    return withTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name, timeZone: "Asia/Kolkata" } });
      await activateCapability(tx, tenantId, PIECEWORK_CAPABILITY);
      const organizationId = (await tx.organization.create({ data: { tenantId, name } })).id;
      const role = await tx.role.create({ data: { tenantId, name: "Munshi" }, select: { id: true } });
      const entities = [ENTITY_PIECEWORK_STAGE, ENTITY_PIECEWORK_LOT, ENTITY_PIECEWORK_WORKER, ENTITY_PIECEWORK_ENTRY, ENTITY_PIECEWORK_PAYMENT];
      await tx.permission.createMany({
        data: entities.flatMap((entity) =>
          (["Read", "Create", "Edit", "ActionExecute"] as const).map((verb) => ({ tenantId, roleId: role.id, verb, entity, scope: "Tenant" as const })),
        ),
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
    clearCommands();
    clearQueries();
    clearHooks();
    clearScopeResolvers();
    clearTransitionGuards();
    clearContributions();
    registerPieceworkCapability();

    munshi = await makeTenant("Stylified Test Works", "Munshi Ram");
    outsider = await makeTenant("Other Test Works", "Other Munshi");
    invalidateCapabilityCache();

    for (const [key, label] of [
      ["cutting", "Cutting"], ["stitching", "Stitching"], ["kaj", "Button / Kaj"], ["finishing", "Finishing"], ["press", "Press"],
    ] as const) {
      stage[key] = (await executeCommand(munshi, defineStage, { stageKey: key, label })).id;
    }
    const since = "2026-01-01";
    const rate = (stageKey: string, rateMinor: number) => ({ stageId: stage[stageKey]!, rateMinor, effectiveFrom: since });
    worker.cutter = (await executeCommand(munshi, defineWorker, { name: "Cutter Raju", mobile: "98765 00001", rates: [rate("cutting", 200)] })).id;
    worker.cutter2 = (await executeCommand(munshi, defineWorker, { name: "Cutter Sonu", rates: [rate("cutting", 200)] })).id;
    worker.A = (await executeCommand(munshi, defineWorker, { name: "Karigar A", mobile: "98765 43210", rates: [rate("stitching", 1200)] })).id;
    worker.B = (await executeCommand(munshi, defineWorker, { name: "Karigar B", rates: [rate("kaj", 400)] })).id;
    worker.C = (await executeCommand(munshi, defineWorker, { name: "Karigar C", rates: [rate("finishing", 300)] })).id;
    worker.D = (await executeCommand(munshi, defineWorker, { name: "Karigar D", rates: [rate("press", 250)] })).id;
    worker.E = (await executeCommand(munshi, defineWorker, { name: "Karigar E (no rate)" })).id;
  });

  afterAll(async () => {
    clearCommands();
    clearQueries();
    clearHooks();
    clearScopeResolvers();
    clearTransitionGuards();
    clearContributions();
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
  const entry = (lotId: string, stageKey: string, workerKey: string, kind: "issue" | "receive", pieces: number, extra: Record<string, unknown> = {}) =>
    executeCommand(munshi, recordEntry, { lotId, stageId: stage[stageKey]!, workerId: worker[workerKey]!, kind, pieces, ...extra });
  const detail = async (lotId: string) => (await executeQuery(munshi, lotDetail, { lotId }))!;

  it("keeps the stage chain as ordered tenant data", async () => {
    const stages = await executeQuery(munshi, listStages, {});
    expect(stages.map((s) => [s.stageKey, s.sequence])).toEqual([["cutting", 1], ["stitching", 2], ["kaj", 3], ["finishing", 4], ["press", 5]]);
    await reject(executeCommand(munshi, defineStage, { stageKey: "cutting", label: "Again" }), /already exists/);
  });

  it("numbers lots gaplessly, and a lot needs the stages first", async () => {
    const empty = await makeTenant("No Stage Works", "Munshi None");
    invalidateCapabilityCache();
    await reject(executeCommand(empty, createLot, { design: "D-1", totalPieces: 10 }), /define the stages/);

    const a = await executeCommand(munshi, createLot, { design: "D-101", totalPieces: 500, note: "Sample lot" });
    lot1 = a.id;
    lot1Number = a.number;
    expect(a.number).toBe("LOT-0001");
    expect((await executeCommand(munshi, createLot, { design: "D-205", totalPieces: 300 })).number).toBe("LOT-0002");
  });

  it("follows the PRD's lot through every stage, with pending derived at each", async () => {
    // Cutting: all 500 out and back. Bundles come from the pieces, never counted by the munshi.
    const issued = await entry(lot1, "cutting", "cutter", "issue", 500);
    expect(issued.bundles).toBe(25);
    await entry(lot1, "cutting", "cutter", "receive", 500);
    await entry(lot1, "stitching", "A", "issue", 500);
    await entry(lot1, "stitching", "A", "receive", 320);
    await entry(lot1, "kaj", "B", "issue", 320);
    await entry(lot1, "kaj", "B", "receive", 200);
    await entry(lot1, "finishing", "C", "issue", 200);
    await entry(lot1, "finishing", "C", "receive", 150);
    await entry(lot1, "press", "D", "issue", 150);
    await entry(lot1, "press", "D", "receive", 100);

    const d = await detail(lot1);
    expect(d.stages.map((s) => [s.label, s.issued, s.received, s.pending])).toEqual([
      ["Cutting", 500, 500, 0],
      ["Stitching", 500, 320, 180],
      ["Button / Kaj", 320, 200, 120],
      ["Finishing", 200, 150, 50],
      ["Press", 150, 100, 50],
    ]);
    expect(d).toMatchObject({
      number: lot1Number,
      phase: "in_progress",
      stageLabel: "Stitching",
      location: "With Karigar A",
      readyPieces: 100,
      readyBundles: 5,
      pendingPieces: 180 + 120 + 50 + 50,
    });
    expect(d.daysHere).toBe(0);
  });

  it("shows the lot in the register with its stage, location and ready stock", async () => {
    const rows = await executeQuery(munshi, listLots, {});
    const row = rows.find((r) => r.id === lot1)!;
    expect(row).toMatchObject({ number: "LOT-0001", design: "D-101", totalPieces: 500, stageLabel: "Stitching", location: "With Karigar A", readyBundles: 5 });
    expect(rows.find((r) => r.number === "LOT-0002")).toMatchObject({ phase: "not_started", location: "Not started" });
    expect(await executeQuery(munshi, listLots, { phase: "not_started" })).toHaveLength(1);
  });

  it("refuses issuing more than has reached a stage, naming the figures", async () => {
    await reject(entry(lot1, "kaj", "B", "issue", 1), /only 0 pieces can be issued at Button \/ Kaj/);
    await reject(entry(lot1, "stitching", "A", "issue", 1), /only 0 pieces can be issued at Stitching/);
  });

  it("refuses a receive beyond what the worker was given, even when the stage total would allow it", async () => {
    const lot = (await executeCommand(munshi, createLot, { design: "D-310", totalPieces: 100 })).id;
    await entry(lot, "cutting", "cutter", "issue", 50);
    await entry(lot, "cutting", "cutter2", "issue", 50);
    await reject(entry(lot, "cutting", "cutter", "receive", 60), /Cutter Raju has only 50 pieces pending at Cutting/);
    await entry(lot, "cutting", "cutter", "receive", 50);
  });

  it("refuses a receive for a worker with no rate for that stage, rather than recording an unpaid zero", async () => {
    const lot = (await executeCommand(munshi, createLot, { design: "D-400", totalPieces: 20 })).id;
    await entry(lot, "cutting", "E", "issue", 20);
    await reject(entry(lot, "cutting", "E", "receive", 20), /set Karigar E \(no rate\)'s rate for Cutting first/);
    // A rate of 0 is allowed: unpaid in-house work is a decision, not a gap.
    await executeCommand(munshi, setWorkerRate, { workerId: worker.E!, stageId: stage.cutting!, rateMinor: 0 });
    const done = await entry(lot, "cutting", "E", "receive", 20);
    expect(done.wageMinor).toBe(0);
  });

  it("guards dates: not in the future, not before the lot existed", async () => {
    const lot = (await executeCommand(munshi, createLot, { design: "D-500", totalPieces: 10 })).id;
    await reject(entry(lot, "cutting", "cutter", "issue", 5, { entryDate: "2999-01-01" }), /future/);
    await reject(entry(lot, "cutting", "cutter", "issue", 5, { entryDate: "2020-01-01" }), /before the lot was created/);
  });

  it("snapshots the rate on each receive, so a later rate change never rewrites old work", async () => {
    const before = (await executeQuery(munshi, workerLedger, { workerId: worker.A! }))!;
    expect(before.money.wagesMinor).toBe(320 * 1200);

    await executeCommand(munshi, setWorkerRate, { workerId: worker.A!, stageId: stage.stitching!, rateMinor: 1500 });
    const lot = (await executeCommand(munshi, createLot, { design: "D-600", totalPieces: 40 })).id;
    await entry(lot, "cutting", "cutter", "issue", 40);
    await entry(lot, "cutting", "cutter", "receive", 40);
    await entry(lot, "stitching", "A", "issue", 40);
    const second = await entry(lot, "stitching", "A", "receive", 40);
    expect(second.wageMinor).toBe(40 * 1500);

    const after = (await executeQuery(munshi, workerLedger, { workerId: worker.A! }))!;
    expect(after.money.wagesMinor).toBe(320 * 1200 + 40 * 1500);
    await reject(executeCommand(munshi, setWorkerRate, { workerId: worker.A!, stageId: stage.stitching!, rateMinor: 1600 }), /already starts on/);
  });

  it("keeps the money ledger: advance, payment within what is owed, balance due derived", async () => {
    // Karigar D earned 100 pieces x Rs 2.50 at Press.
    const w = worker.D!;
    expect((await executeQuery(munshi, workerLedger, { workerId: w }))!.money).toMatchObject({ wagesMinor: 25_000, balanceMinor: 25_000 });
    await executeCommand(munshi, recordPayment, { workerId: w, kind: "advance", amountMinor: 5_000 });
    const paid = await executeCommand(munshi, recordPayment, { workerId: w, kind: "payment", amountMinor: 10_000 });
    expect(paid.balanceMinor).toBe(10_000);
    await reject(executeCommand(munshi, recordPayment, { workerId: w, kind: "payment", amountMinor: 10_001 }), /owed only 10000 paise; record anything more as an advance/);
    // The excess goes in as an advance, and the balance shows the worker now holds more than earned.
    await executeCommand(munshi, recordPayment, { workerId: w, kind: "advance", amountMinor: 15_000 });
    const ledger = (await executeQuery(munshi, workerLedger, { workerId: w }))!;
    expect(ledger.money).toEqual({ wagesMinor: 25_000, advanceMinor: 20_000, paidMinor: 10_000, balanceMinor: -5_000 });
    expect(ledger.payments.map((p) => [p.kind, p.amountMinor])).toEqual(expect.arrayContaining([["advance", 5_000], ["payment", 10_000], ["advance", 15_000]]));
  });

  it("reverses a payment instead of editing it, once, and restores the balance", async () => {
    const w = worker.D!;
    const ledger = (await executeQuery(munshi, workerLedger, { workerId: w }))!;
    const payment = ledger.payments.find((p) => p.kind === "payment")!;
    await executeCommand(munshi, reversePayment, { paymentId: payment.id });
    expect((await executeQuery(munshi, workerLedger, { workerId: w }))!.money).toMatchObject({ paidMinor: 0, balanceMinor: 5_000 });
    await reject(executeCommand(munshi, reversePayment, { paymentId: payment.id }), /already reversed/);
    const reversal = (await executeQuery(munshi, workerLedger, { workerId: w }))!.payments.find((p) => p.isReversal)!;
    await reject(executeCommand(munshi, reversePayment, { paymentId: reversal.id }), /cannot itself be reversed/);
  });

  it("refuses a reversal that would strand a later stage, and allows one nobody depends on", async () => {
    const d = await detail(lot1);
    const cutReceive = d.entries.find((e) => e.stageLabel === "Cutting" && e.kind === "receive")!;
    await reject(executeCommand(munshi, reverseEntry, { entryId: cutReceive.id }), /Stitching would have 500 pieces issued but only 0 have reached it/);

    const pressReceive = d.entries.find((e) => e.stageLabel === "Press" && e.kind === "receive")!;
    await executeCommand(munshi, reverseEntry, { entryId: pressReceive.id, note: "Counted twice" });
    const after = await detail(lot1);
    expect(after.readyPieces).toBe(0);
    expect(after.stages.find((s) => s.label === "Press")).toMatchObject({ issued: 150, received: 0, pending: 150 });
    // The original and its reversal both stay in the ledger.
    expect(after.entries.filter((e) => e.stageLabel === "Press" && e.kind === "receive").map((e) => [e.pieces, e.isReversal, e.reversed])).toEqual([[100, false, true], [-100, true, false]]);
    // Karigar D's wage for those pieces cancels exactly.
    expect((await executeQuery(munshi, workerLedger, { workerId: worker.D! }))!.money.wagesMinor).toBe(0);
    await reject(executeCommand(munshi, reverseEntry, { entryId: pressReceive.id }), /already reversed/);
  });

  it("records who entered each line, by name", async () => {
    const d = await detail(lot1);
    expect(new Set(d.entries.map((e) => e.enteredBy))).toEqual(new Set(["Munshi Ram"]));
  });

  it("cancels only a lot nothing has left, and never reuses its number", async () => {
    const idle = await executeCommand(munshi, createLot, { design: "D-700", totalPieces: 10 });
    await executeCommand(munshi, cancelLot, { lotId: idle.id, reason: "Entered by mistake" });
    await reject(executeCommand(munshi, cancelLot, { lotId: idle.id, reason: "Again" }), /already cancelled/);
    await reject(entry(idle.id, "cutting", "cutter", "issue", 5), /cancelled/);
    await reject(executeCommand(munshi, cancelLot, { lotId: lot1, reason: "Too late" }), /pieces are already out/);
    const next = await executeCommand(munshi, createLot, { design: "D-701", totalPieces: 10 });
    expect(Number(next.number.slice(4))).toBe(Number(idle.number.slice(4)) + 1);
    expect((await executeQuery(munshi, listLots, { phase: "cancelled" })).map((l) => l.number)).toContain(idle.number);
  });

  it("will not retire a worker who still holds pieces, and will not add stages after work began", async () => {
    await reject(executeCommand(munshi, setWorkerActive, { workerId: worker.A!, active: false }), /still holds/);
    await reject(executeCommand(munshi, defineStage, { stageKey: "packing", label: "Packing" }), /cannot change once work has been recorded/);
    const idle = await executeCommand(munshi, defineWorker, { name: "Karigar Z" });
    await executeCommand(munshi, setWorkerActive, { workerId: idle.id, active: false });
    expect((await executeQuery(munshi, listWorkers, {})).some((w) => w.name === "Karigar Z")).toBe(false);
    expect((await executeQuery(munshi, listWorkers, { includeInactive: true })).some((w) => w.name === "Karigar Z")).toBe(true);
  });

  it("lists workers with what they hold, earn and are owed", async () => {
    const rows = await executeQuery(munshi, listWorkers, {});
    const a = rows.find((w) => w.name === "Karigar A")!;
    expect(a.piecesHeld).toBe(180);
    expect(a.workTypes).toEqual([{ stageId: stage.stitching, label: "Stitching", rateMinor: 1500 }]);
    expect(a.balanceMinor).toBe(a.wagesMinor);
  });

  it("serialises two entries racing for the same pieces: one wins, one is refused", async () => {
    const lot = (await executeCommand(munshi, createLot, { design: "D-800", totalPieces: 100 })).id;
    const results = await Promise.allSettled([entry(lot, "cutting", "cutter", "issue", 100), entry(lot, "cutting", "cutter2", "issue", 100)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await detail(lot)).stages[0]).toMatchObject({ issued: 100, toIssue: 0 });
  });

  it("lets only the munshi write: an owner role that can read everything is refused every write, and nothing is written", async () => {
    const viewer = await withTenant(munshi.tenantId, async (tx) => {
      const role = await tx.role.create({ data: { tenantId: munshi.tenantId, name: "Owner (view only)" }, select: { id: true } });
      const readOnly = [ENTITY_PIECEWORK_STAGE, ENTITY_PIECEWORK_LOT, ENTITY_PIECEWORK_WORKER, ENTITY_PIECEWORK_PAYMENT];
      await tx.permission.createMany({ data: readOnly.map((entity) => ({ tenantId: munshi.tenantId, roleId: role.id, verb: "Read" as const, entity, scope: "Tenant" as const })) });
      const identity = await provisionIdentity(tx, { organizationId: munshi.organizationId, authUserId: randomUUID(), displayName: "Owner Ji" });
      created.users.push(identity.userId);
      created.parties.push(identity.partyId);
      await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId: role.id } });
      return { tenantId: munshi.tenantId, userId: identity.userId, membershipId: identity.membershipId, organizationId: munshi.organizationId, roleId: role.id } as ActorContext;
    });
    invalidateCapabilityCache();

    const before = await withTenant(munshi.tenantId, async (tx) => ({ lots: await tx.pieceworkLot.count(), entries: await tx.pieceworkEntry.count(), payments: await tx.pieceworkPayment.count(), workers: await tx.pieceworkWorker.count() }));
    await expect(executeCommand(viewer, createLot, { design: "D-900", totalPieces: 10 })).rejects.toThrow();
    await expect(executeCommand(viewer, recordEntry, { lotId: lot1, stageId: stage.cutting!, workerId: worker.cutter!, kind: "issue", pieces: 1 })).rejects.toThrow();
    await expect(executeCommand(viewer, recordPayment, { workerId: worker.A!, kind: "advance", amountMinor: 100 })).rejects.toThrow();
    await expect(executeCommand(viewer, defineWorker, { name: "Karigar Q" })).rejects.toThrow();
    await expect(executeCommand(viewer, cancelLot, { lotId: lot1, reason: "no" })).rejects.toThrow();
    const after = await withTenant(munshi.tenantId, async (tx) => ({ lots: await tx.pieceworkLot.count(), entries: await tx.pieceworkEntry.count(), payments: await tx.pieceworkPayment.count(), workers: await tx.pieceworkWorker.count() }));
    expect(after).toEqual(before);

    // Reading is fully allowed: the lot, the karigar's money and the dashboard.
    expect((await executeQuery(viewer, listLots, {})).length).toBeGreaterThan(0);
    expect((await executeQuery(viewer, workerLedger, { workerId: worker.A! }))!.money.wagesMinor).toBeGreaterThan(0);
    expect((await executeQuery(viewer, dashboard, {})).activeLots.length).toBeGreaterThan(0);
  });

  it("derives the owner dashboard and the four reports from the same ledger the screens read", async () => {
    const d = await executeQuery(munshi, dashboard, {});
    // LOT-0001 is still the PRD lot (stitching 180, kaj 120, finishing 50, press 0 after the reversal => 150 pending there).
    const open = d.activeLots.find((l) => l.number === lot1Number)!;
    expect(open).toMatchObject({ stageLabel: "Stitching", location: "With Karigar A" });
    expect(d.pendingByStage.map((s) => [s.label, s.pending])).toEqual(expect.arrayContaining([["Stitching", 180], ["Button / Kaj", 120], ["Finishing", 50]]));
    expect(d.ready.pieces).toBe(0);

    const production = await executeQuery(munshi, reportLotProduction, {});
    const row = production.find((r) => r.lotNumber === lot1Number && r.stage === "Stitching")!;
    expect(row).toMatchObject({ totalPieces: 500, issued: 500, received: 320, pending: 180 });

    const costing = await executeQuery(munshi, reportCosting, {});
    const lot1Cost = costing.find((r) => r.lotNumber === lot1Number)!;
    expect(lot1Cost.clothMinor).toBeNull();
    expect(lot1Cost.otherMinor).toBeNull();
    expect(lot1Cost.totalMinor).toBe(lot1Cost.wagesMinor);

    const pay = await executeQuery(munshi, reportWorkerPayment, {});
    // Karigar A: 500 given and 320 returned on the PRD lot, plus the 40-piece lot used for the rate-change test.
    expect(pay.rows.find((r) => r.karigar === "Karigar A")).toMatchObject({ given: 540, returned: 360 });
    // A period that contains nothing reports nothing.
    expect((await executeQuery(munshi, reportWorkerPayment, { from: "2000-01-01", to: "2000-01-02" })).rows).toEqual([]);

    const ready = await executeQuery(munshi, reportReadyInventory, {});
    expect(ready.find((r) => r.lotNumber === lot1Number)).toBeUndefined();
    const today = await executeQuery(munshi, recentEntries, {});
    expect(today.length).toBeGreaterThan(0);
    expect(today.every((e) => e.pieces !== 0)).toBe(true);
  });

  it("isolates tenants", async () => {
    expect(await executeQuery(outsider, listLots, {})).toEqual([]);
    expect(await executeQuery(outsider, listWorkers, {})).toEqual([]);
    expect(await executeQuery(outsider, lotDetail, { lotId: lot1 })).toBeNull();
    await reject(
      executeCommand(outsider, recordEntry, { lotId: lot1, stageId: stage.cutting!, workerId: worker.cutter!, kind: "issue", pieces: 1 }),
      /lot not found/,
    );
    await reject(executeCommand(outsider, recordPayment, { workerId: worker.A!, kind: "advance", amountMinor: 100 }), /worker not found/);
  });

  it("holds its invariants in the database: ledgers refuse UPDATE and DELETE, and bad numbers are refused", async () => {
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    const tenantA = munshi.tenantId;
    try {
      // Nobody edits a ledger row, not even the table owner.
      await expect(admin.$executeRaw`UPDATE piecework_entry SET pieces = pieces + 1 WHERE tenant_id = ${tenantA}::uuid`).rejects.toThrow();
      await expect(admin.$executeRaw`UPDATE piecework_payment SET amount_minor = 1 WHERE tenant_id = ${tenantA}::uuid`).rejects.toThrow();
      await expect(admin.$executeRaw`UPDATE piecework_worker_rate SET rate_minor = 1 WHERE tenant_id = ${tenantA}::uuid`).rejects.toThrow();
      // The application role cannot delete one either: there is no DELETE policy, so no row is ever visible to a
      // delete (the table owner may delete, so that a whole tenant can be removed).
      const rowsBefore = await withTenant(tenantA, (tx) => tx.pieceworkEntry.count());
      expect(rowsBefore).toBeGreaterThan(0);
      for (const table of ["piecework_entry", "piecework_payment", "piecework_worker_rate"] as const) {
        const deleted = await withTenant(tenantA, (tx) => tx.$executeRawUnsafe(`DELETE FROM ${table} WHERE tenant_id = '${tenantA}'::uuid`));
        expect(deleted).toBe(0);
      }
      expect(await withTenant(tenantA, (tx) => tx.pieceworkEntry.count())).toBe(rowsBefore);
      await expect(
        admin.$executeRaw`INSERT INTO piecework_entry (id, tenant_id, lot_id, stage_id, worker_id, kind, pieces, entry_date, entered_by_id)
                          VALUES (gen_random_uuid(), ${tenantA}::uuid, ${lot1}::uuid, ${stage.cutting}::uuid, ${worker.A}::uuid, 'issue', 0, current_date, ${munshi.userId}::uuid)`,
      ).rejects.toThrow(/piecework_entry_pieces_positive/);
      await expect(
        admin.$executeRaw`INSERT INTO piecework_lot (id, tenant_id, number, sequence_no, design, total_pieces, created_by_id, updated_at)
                          VALUES (gen_random_uuid(), ${tenantA}::uuid, 'LOT-9999', 9999, 'x', 0, ${munshi.userId}::uuid, now())`,
      ).rejects.toThrow(/piecework_lot_total_positive/);
    } finally {
      await admin.$disconnect();
    }
  });

  it("fails closed: with no tenant scope the runtime role sees none of it", async () => {
    expect(await prisma.pieceworkLot.count()).toBe(0);
    expect(await prisma.pieceworkEntry.count()).toBe(0);
    expect(await prisma.pieceworkPayment.count()).toBe(0);
    expect(await prisma.pieceworkWorker.count()).toBe(0);
  });
});
