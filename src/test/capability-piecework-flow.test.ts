import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient, type PermissionVerb } from "@prisma/client";
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
  ENTITY_PIECEWORK_APPROVAL,
  ENTITY_PIECEWORK_BUNDLE,
  ENTITY_PIECEWORK_ENTRY,
  ENTITY_PIECEWORK_LOT,
  ENTITY_PIECEWORK_LOT_COST,
  ENTITY_PIECEWORK_LOT_RATE,
  ENTITY_PIECEWORK_PAYMENT,
  ENTITY_PIECEWORK_REASON,
  ENTITY_PIECEWORK_ROLL,
  ENTITY_PIECEWORK_ROLL_MOVE,
  ENTITY_PIECEWORK_SETTING,
  ENTITY_PIECEWORK_STAGE,
  ENTITY_PIECEWORK_STAGE_ASSIGNMENT,
  ENTITY_PIECEWORK_WORKER,
  PIECEWORK_CAPABILITY,
  assignStages,
  addLotCost,
  cancelRoll,
  challanSheet,
  createBundle,
  createLot,
  cutLot,
  decideApproval,
  defineStage,
  defineWorker,
  effectiveRate,
  floorCases,
  floorReasons,
  lotFabric,
  lotRateCard,
  countRolls,
  listRolls,
  moveFabric,
  challansOnDay,
  searchPiecework,
  dashboard,
  reportBundleLocation,
  reportCosting,
  reportLotStatus,
  reportProductionByProcess,
  reportQuality,
  reportReadyInventory,
  reportWagePayment,
  reportWorkInHand,
  pieceworkHistory,
  productionSettings,
  readyGarments,
  receiveRolls,
  rollDetail,
  recordIssue,
  recordReturn,
  registerPieceworkCapability,
  reorderStages,
  reverseEntry,
  saveReasons,
  lookupCode,
  lotCosting,
  mergeBundles,
  reverseLotCost,
  splitBundle,
  splitByWeight,
  setLotRates,
  setLotStatus,
  setProductionSettings,
  updateStage,
} from "@/server/capabilities/piecework";

/**
 * The Stylified flow (task 129 follow-up): rolls to lots to bundles, the rate that wins, a route a lot may shorten, the receiver's count
 * on every handover with a challan number, a charge that is asked and never taken silently, and settings that are data.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;
if (!hasDatabase) {
  const message = "capability-piecework-flow.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describeDb("capability: the Stylified flow (rate card, route, challan, charge, fabric, settings)", () => {
  const tenants: string[] = [];
  const created = { users: [] as string[], parties: [] as string[] };
  let tenantId: string;
  let organizationId: string;
  let owner: ActorContext, manager: ActorContext, supervisor: ActorContext;
  const stage: Record<string, string> = {};
  const worker: Record<string, string> = {};
  const today = new Date().toISOString().slice(0, 10);

  const VERBS: PermissionVerb[] = ["Read", "Create", "Edit", "ActionExecute"];
  type Grant = [string, PermissionVerb[]];
  const ALL = [
    ENTITY_PIECEWORK_STAGE, ENTITY_PIECEWORK_LOT, ENTITY_PIECEWORK_BUNDLE, ENTITY_PIECEWORK_WORKER, ENTITY_PIECEWORK_ENTRY, ENTITY_PIECEWORK_PAYMENT,
    ENTITY_PIECEWORK_LOT_RATE, ENTITY_PIECEWORK_REASON, ENTITY_PIECEWORK_ROLL, ENTITY_PIECEWORK_ROLL_MOVE, ENTITY_PIECEWORK_SETTING, ENTITY_PIECEWORK_APPROVAL, ENTITY_PIECEWORK_STAGE_ASSIGNMENT, ENTITY_PIECEWORK_LOT_COST,
  ];

  async function person(name: string, roleName: string, grants: Grant[]): Promise<ActorContext> {
    const actor = await withTenant(tenantId, async (tx) => {
      const role = await tx.role.create({ data: { tenantId, name: roleName }, select: { id: true } });
      await tx.permission.createMany({ data: grants.flatMap(([entity, verbs]) => verbs.map((verb) => ({ tenantId, roleId: role.id, verb, entity, scope: "Tenant" as const }))) });
      const identity = await provisionIdentity(tx, { organizationId, authUserId: randomUUID(), displayName: name });
      created.users.push(identity.userId);
      created.parties.push(identity.partyId);
      await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId: role.id } });
      return { tenantId, userId: identity.userId, membershipId: identity.membershipId, organizationId, roleId: role.id } as ActorContext;
    });
    invalidateCapabilityCache();
    return actor;
  }

  beforeAll(async () => {
    await assertRlsEnforceable();
    clearCommands(); clearQueries(); clearHooks(); clearScopeResolvers(); clearTransitionGuards(); clearContributions();
    registerPieceworkCapability();
    tenantId = randomUUID();
    tenants.push(tenantId);
    organizationId = await withTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: "Flow Test Works", timeZone: "Asia/Kolkata" } });
      await activateCapability(tx, tenantId, PIECEWORK_CAPABILITY);
      return (await tx.organization.create({ data: { tenantId, name: "Flow Test Works" } })).id;
    });
    owner = await person("Owner Ji", "Owner", ALL.map((e): Grant => [e, VERBS]));
    manager = await person("Manager Singh", "Manager", ALL.map((e): Grant => [e, e === ENTITY_PIECEWORK_SETTING ? ["Read"] : VERBS]));
    supervisor = await person("Supervisor A", "Supervisor", [
      [ENTITY_PIECEWORK_STAGE, ["Read"]], [ENTITY_PIECEWORK_LOT, ["Read"]], [ENTITY_PIECEWORK_BUNDLE, ["Read"]],
      [ENTITY_PIECEWORK_ENTRY, ["Read", "Create", "ActionExecute"]], [ENTITY_PIECEWORK_APPROVAL, ["Read", "Create"]],
    ]);
    for (const [key, label] of [["pasting", "Pasting"], ["stitching", "Stitching"], ["finishing", "Finishing"]] as const) {
      stage[key] = (await executeCommand(owner, defineStage, { stageKey: key, label })).id;
    }
    // A supervisor works only at the stages the owner assigns.
    await executeCommand(owner, assignStages, { userId: supervisor.userId, stageIds: [stage.pasting!] });
    worker.W = (await executeCommand(owner, defineWorker, { name: "Karigar W" })).id;
    worker.X = (await executeCommand(owner, defineWorker, { name: "Karigar X" })).id;
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
  async function lotWith(pieces: number, design = "Oxford"): Promise<{ lotId: string; bundleId: string }> {
    const lotId = (await executeCommand(owner, createLot, { design, plannedPieces: pieces })).id;
    await executeCommand(owner, setLotStatus, { lotId, to: "active" });
    const bundleId = (await executeCommand(owner, createBundle, { lotId, netPieces: pieces })).id;
    return { lotId, bundleId };
  }

  it("pays at the lot's rate, else the karigar's own, else the stage's default, and refuses when none is set", async () => {
    const { lotId, bundleId } = await lotWith(100);
    await reject(executeCommand(owner, recordIssue, { bundleId, stageId: stage.pasting!, workerId: worker.W!, pieces: 10 }), /no rate for Pasting/);

    await executeCommand(owner, updateStage, { stageId: stage.pasting!, defaultRateMinor: 200 });
    const rateAt = (workerId: string) => withTenant(tenantId, (tx) => effectiveRate(tx, workerId, stage.pasting!, lotId, today));
    expect(await rateAt(worker.W!)).toMatchObject({ rateMinor: 200, source: "stage" });

    await executeCommand(owner, defineWorker, { name: "Karigar Own", rates: [{ stageId: stage.pasting!, rateMinor: 300, effectiveFrom: "2026-01-01" }] });
    const own = (await withTenant(tenantId, (tx) => tx.pieceworkWorker.findFirstOrThrow({ where: { name: "Karigar Own" } }))).id;
    expect(await rateAt(own)).toMatchObject({ rateMinor: 300, source: "worker" });

    await executeCommand(owner, setLotRates, { lotId, rows: [{ stageId: stage.pasting!, rateMinor: 250 }] });
    expect(await rateAt(own)).toMatchObject({ rateMinor: 250, source: "lot" });
    expect(await rateAt(worker.W!)).toMatchObject({ rateMinor: 250, source: "lot" });

    // The rate in force is snapshotted on the entry, so a later change never moves history.
    const issued = await executeCommand(owner, recordIssue, { bundleId, stageId: stage.pasting!, workerId: worker.W!, pieces: 100 });
    const back = await executeCommand(owner, recordReturn, { issueId: issued.id, good: 100, rejected: 0, rework: 0, short: 0 });
    await executeCommand(owner, setLotRates, { lotId, rows: [{ stageId: stage.pasting!, rateMinor: 999 }] });
    const row = await withTenant(tenantId, (tx) => tx.pieceworkEntry.findUniqueOrThrow({ where: { id: back.id } }));
    expect(row.rateMinor).toBe(250);
  });

  it("counts the shelf: only a difference is posted, a match leaves no row, and rolls not counted are untouched", async () => {
    const received = await executeCommand(owner, receiveRolls, { fabricType: "Count test cloth", quantitiesCenti: [10_000, 20_000, 5_000] });
    const [a, b, c] = received.rollIds;
    const result = await executeCommand(owner, countRolls, { counts: [{ rollId: a!, countedCenti: 10_000 }, { rollId: b!, countedCenti: 19_550 }] });
    expect(result).toMatchObject({ counted: 2, adjusted: 1, differences: [{ rollId: b, deltaCenti: -450 }] });
    const rolls = (await executeQuery(owner, listRolls, {})).rolls;
    expect(rolls.find((r) => r.id === a)!.balanceCenti).toBe(10_000);
    expect(rolls.find((r) => r.id === b)!.balanceCenti).toBe(19_550);
    expect(rolls.find((r) => r.id === c)!.balanceCenti).toBe(5_000);
    expect((await executeQuery(owner, rollDetail, { rollId: b! }))!.moves.some((m) => m.kind === "adjust" && m.reason === "Stock-take")).toBe(true);
    await reject(executeCommand(owner, countRolls, { counts: [{ rollId: a!, countedCenti: 1 }, { rollId: a!, countedCenti: 2 }] }), /count each roll once/);
  });

  it("lets a lot skip a stage: its pieces go on to the next one, and the skipped stage refuses work", async () => {
    await executeCommand(owner, updateStage, { stageId: stage.stitching!, defaultRateMinor: 1000 });
    await executeCommand(owner, updateStage, { stageId: stage.finishing!, defaultRateMinor: 300 });
    const { lotId, bundleId } = await lotWith(50, "Plain");
    // Only an optional stage can be skipped: stitching is required until it is marked optional.
    await reject(executeCommand(owner, setLotRates, { lotId, rows: [{ stageId: stage.stitching!, skipped: true }] }), /required stage and cannot be skipped/);
    await executeCommand(owner, updateStage, { stageId: stage.stitching!, optional: true });
    await executeCommand(owner, setLotRates, { lotId, rows: [{ stageId: stage.stitching!, skipped: true }] });
    const p = await executeCommand(owner, recordIssue, { bundleId, stageId: stage.pasting!, workerId: worker.W!, pieces: 50 });
    await executeCommand(owner, recordReturn, { issueId: p.id, good: 50, rejected: 0, rework: 0, short: 0 });
    await reject(executeCommand(owner, recordIssue, { bundleId, stageId: stage.stitching!, workerId: worker.W!, pieces: 50 }), /does not use Stitching/);
    const f = await executeCommand(owner, recordIssue, { bundleId, stageId: stage.finishing!, workerId: worker.X!, pieces: 50 });
    await executeCommand(owner, recordReturn, { issueId: f.id, good: 50, rejected: 0, rework: 0, short: 0 });

    const ready = await executeQuery(owner, readyGarments, {});
    expect(ready.find((r) => r.lotId === lotId)?.readyPieces).toBe(50);

    // A stage that already has work on the lot cannot then be skipped, and the card says which have work.
    await executeCommand(owner, updateStage, { stageId: stage.pasting!, optional: true });
    await reject(executeCommand(owner, setLotRates, { lotId, rows: [{ stageId: stage.pasting!, skipped: true }] }), /already has work recorded/);
    await executeCommand(owner, updateStage, { stageId: stage.pasting!, optional: false });
    const card = await executeQuery(owner, lotRateCard, { lotId });
    expect(card.find((r) => r.stageId === stage.stitching)).toMatchObject({ skipped: true });
    expect(card.find((r) => r.stageId === stage.pasting)).toMatchObject({ hasWork: true, effectiveMinor: 200 });

    // Every report still reads with a lot on a shorter route, and the skipped stage's row leaves that lot out.
    await executeQuery(owner, dashboard, {});
    await Promise.all([
      executeQuery(owner, reportBundleLocation, {}), executeQuery(owner, reportCosting, {}), executeQuery(owner, reportLotStatus, {}), executeQuery(owner, reportQuality, {}),
      executeQuery(owner, reportReadyInventory, {}), executeQuery(owner, reportWagePayment, {}), executeQuery(owner, reportWorkInHand, {}),
    ]);
    const byProcess = await executeQuery(owner, reportProductionByProcess, {});
    const stitching = byProcess.find((r) => r.stage === "Stitching")!;
    const pasting = byProcess.find((r) => r.stage === "Pasting")!;
    expect(pasting.sent).toBeGreaterThanOrEqual(50);
    expect(stitching.sent).toBeLessThan(pasting.sent);
  });

  it("takes the receiver's count as the truth, numbers every challan, and shows the difference as a case", async () => {
    const { bundleId } = await lotWith(100, "Check");
    const a = await executeCommand(supervisor, recordIssue, { bundleId, stageId: stage.pasting!, workerId: worker.W!, pieces: 40, sentPieces: 45, ackMethod: "pin" });
    expect(a.challanNumber).toMatch(/^CH-\d{4}$/);
    const row = await withTenant(tenantId, (tx) => tx.pieceworkEntry.findUniqueOrThrow({ where: { id: a.id } }));
    expect(row).toMatchObject({ pieces: 40, sentPieces: 45, ackMethod: "pin", challanNumber: a.challanNumber });

    // Only the 40 counted left the sender: the other five are still available to issue.
    await reject(executeCommand(owner, recordIssue, { bundleId, stageId: stage.pasting!, workerId: worker.W!, pieces: 61 }), /only 60 pieces can be issued/);

    // Joining a challan keeps one paper for a stack; another karigar cannot join it; a new challan takes the next number.
    const b = await executeCommand(supervisor, recordIssue, { bundleId, stageId: stage.pasting!, workerId: worker.W!, pieces: 10, challanNumber: a.challanNumber });
    expect(b.challanNumber).toBe(a.challanNumber);
    await reject(executeCommand(supervisor, recordIssue, { bundleId, stageId: stage.pasting!, workerId: worker.X!, pieces: 5, challanNumber: a.challanNumber }), /not made out to this karigar/);
    const c = await executeCommand(supervisor, recordIssue, { bundleId, stageId: stage.pasting!, workerId: worker.X!, pieces: 5 });
    expect(Number(c.challanNumber.slice(3))).toBe(Number(a.challanNumber.slice(3)) + 1);

    const sheet = await executeQuery(supervisor, challanSheet, { number: a.challanNumber });
    expect(sheet).toMatchObject({ number: a.challanNumber, totalSent: 55, totalCounted: 50, differences: 1 });
    expect(sheet?.lines).toHaveLength(2);

    const cases = await executeQuery(supervisor, floorCases, {});
    expect(cases.open.find((x) => x.entryId === a.id)).toMatchObject({ kind: "handover", pieces: 5, sent: 45, counted: 40, workerName: "Karigar W" });
  });

  it("asks for a charge when pieces are short, never silently, and withdraws it when the return is reversed", async () => {
    const { lotId, bundleId } = await lotWith(60, "Charge");
    await executeCommand(owner, setLotRates, { lotId, rows: [{ stageId: stage.pasting!, lostPieceChargeMinor: 5000 }] });

    const i1 = await executeCommand(supervisor, recordIssue, { bundleId, stageId: stage.pasting!, workerId: worker.W!, pieces: 30 });
    const r1 = await executeCommand(supervisor, recordReturn, { issueId: i1.id, good: 28, rejected: 0, rework: 0, short: 2, note: "Lost: fell off the table" });
    expect(r1.chargeRequestedMinor).toBe(10_000);
    const pending = await withTenant(tenantId, (tx) => tx.pieceworkApproval.findFirstOrThrow({ where: { entryId: r1.id } }));
    expect(pending).toMatchObject({ kind: "deduction", status: "pending", amountMinor: 10_000, workerId: worker.W });
    // No payment moved: a charge is only a request until someone else decides it.
    expect(await withTenant(tenantId, (tx) => tx.pieceworkPayment.count({ where: { workerId: worker.W, kind: "deduction" } }))).toBe(0);
    const cases = await executeQuery(supervisor, floorCases, {});
    expect(cases.open.find((x) => x.entryId === r1.id)).toMatchObject({ kind: "short", pieces: 2, chargeStatus: "pending", answer: "Lost: fell off the table" });
    expect(JSON.stringify(cases)).not.toMatch(/amountMinor|10000/);

    await executeCommand(supervisor, reverseEntry, { entryId: r1.id, note: "counted wrong" });
    expect((await withTenant(tenantId, (tx) => tx.pieceworkApproval.findUniqueOrThrow({ where: { id: pending.id } }))).status).toBe("declined");

    // Once a manager approves the charge, the deduction lands on the karigar and the return can no longer be reversed.
    const r2 = await executeCommand(supervisor, recordReturn, { issueId: i1.id, good: 29, rejected: 0, rework: 0, short: 1 });
    const ask = await withTenant(tenantId, (tx) => tx.pieceworkApproval.findFirstOrThrow({ where: { entryId: r2.id } }));
    await executeCommand(manager, decideApproval, { approvalId: ask.id, decision: "approved" });
    expect(await withTenant(tenantId, (tx) => tx.pieceworkPayment.count({ where: { workerId: worker.W, kind: "deduction", amountMinor: 5000 } }))).toBe(1);
    await reject(executeCommand(supervisor, reverseEntry, { entryId: r2.id }), /already applied/);
  });

  it("receives rolls, moves fabric within what is there, and cuts a lot with its fabric in one step", async () => {
    const got = await executeCommand(owner, receiveRolls, { fabricType: "Poplin", unit: "m", quantitiesCenti: [10_000, 8_050], supplier: "Mehta Textiles", invoiceNumber: "MT/117", rateMinor: 12_000 });
    expect(got.numbers).toHaveLength(2);
    expect(got.numbers[0]).toMatch(/^R-\d{4}$/);
    const [rollA, rollB] = got.rollIds as [string, string];

    const lotId = (await executeCommand(owner, createLot, { design: "Poplin check", plannedPieces: 100 })).id;
    await reject(executeCommand(owner, moveFabric, { rollId: rollA, kind: "issue", quantityCenti: 10_001, lotId }), /has only 100.00 m left/);
    await executeCommand(owner, moveFabric, { rollId: rollA, kind: "issue", quantityCenti: 4_000, lotId });
    await reject(executeCommand(owner, moveFabric, { rollId: rollA, kind: "return", quantityCenti: 4_001, lotId }), /holds only 40.00 m/);
    await executeCommand(owner, moveFabric, { rollId: rollA, kind: "return", quantityCenti: 500, lotId });
    await reject(executeCommand(owner, moveFabric, { rollId: rollA, kind: "adjust", quantityCenti: -100 }), /needs a reason/);
    await reject(executeCommand(owner, moveFabric, { rollId: rollA, kind: "adjust", quantityCenti: -100_000, reason: "damp damage" }), /below zero/);
    await executeCommand(owner, moveFabric, { rollId: rollA, kind: "adjust", quantityCenti: -250, reason: "damp damage at the edge" });
    await reject(executeCommand(owner, cancelRoll, { rollId: rollA, reason: "entered twice" }), /already moved/);

    // 100.00 - 40.00 + 5.00 - 2.50 = 62.50 on the roll; the lot holds 35.00.
    const stock = await executeQuery(owner, listRolls, {});
    expect(stock.rolls.find((r) => r.id === rollA)).toMatchObject({ balanceCenti: 6_250, usedCenti: 3_500, lotCount: 1 });

    // Cutting takes fabric from the second roll, cuts 3 + 1 bundles, and starts the draft lot.
    const cut = await executeCommand(owner, cutLot, {
      lotId, fabric: [{ rollId: rollB, quantityCenti: 2_000 }],
      groups: [{ copies: 3, netPieces: 25, sizeNote: "M" }, { copies: 1, netPieces: 20, sizeNote: "L" }],
    });
    expect(cut.numbers).toHaveLength(4);
    expect(cut.pieces).toBe(95);
    expect((await withTenant(tenantId, (tx) => tx.pieceworkLot.findUniqueOrThrow({ where: { id: lotId } }))).status).toBe("active");

    const used = await executeQuery(owner, lotFabric, { lotId });
    expect(used.totals).toEqual([{ unit: "m", netCenti: 5_500 }]);
    expect(used.costMinor).toBe(Math.round((5_500 * 12_000) / 100));

    // A roll nothing has left can be cancelled, and keeps its number.
    const spare = await executeCommand(owner, receiveRolls, { fabricType: "Poplin", quantitiesCenti: [500] });
    await executeCommand(owner, cancelRoll, { rollId: spare.rollIds[0]!, reason: "entered twice" });
    await reject(executeCommand(owner, moveFabric, { rollId: spare.rollIds[0]!, kind: "issue", quantityCenti: 100, lotId }), /is cancelled/);
  });

  it("keeps settings as data: reasons in two languages, the factory charge, and an order that locks once work exists", async () => {
    await executeCommand(owner, saveReasons, { kind: "short", items: [{ labelEn: "Lost", labelHi: "खो गया" }, { labelEn: "Stolen", labelHi: "चोरी" }] });
    await executeCommand(owner, setProductionSettings, { lostPieceChargeMinor: 7500, challanTitle: "Stylified Garments", challanAddress: "Focal Point, Ludhiana" });

    const settings = await executeQuery(owner, productionSettings, {});
    expect(settings.reasons.custom).toBe(true);
    expect(settings.reasons.short.map((r) => r.labelEn)).toEqual(["Lost", "Stolen"]);
    expect(settings.reasons.defect.length).toBeGreaterThan(0);
    expect(settings).toMatchObject({ lostPieceChargeMinor: 7500, challanTitle: "Stylified Garments" });

    // The floor reads the reasons but not the settings (they hold money and limits).
    expect((await executeQuery(supervisor, floorReasons, {})).short[1]).toMatchObject({ labelHi: "चोरी" });
    await reject(executeQuery(supervisor, productionSettings, {}), /holds no Read grant/);

    // The factory charge applies when a lot sets none.
    const { bundleId } = await lotWith(10, "Default charge");
    const i = await executeCommand(owner, recordIssue, { bundleId, stageId: stage.pasting!, workerId: worker.W!, pieces: 10 });
    const r = await executeCommand(owner, recordReturn, { issueId: i.id, good: 9, rejected: 0, rework: 0, short: 1 });
    expect(r.chargeRequestedMinor).toBe(7500);

    await reject(executeCommand(owner, reorderStages, { stageIds: [stage.finishing!, stage.stitching!, stage.pasting!] }), /cannot change once work has been recorded/);
    await reject(executeCommand(owner, updateStage, { stageId: stage.pasting!, active: false }), /has work recorded/);
    await reject(executeCommand(supervisor, updateStage, { stageId: stage.pasting!, label: "Gluing" }), /holds no Edit grant/);
  });

  it("splits a shared cost across lots by pieces cut, exactly, and costs a lot from fabric, wages, other costs and recoveries", async () => {
    expect(splitByWeight(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(splitByWeight(10_001, [300, 100])).toEqual([7501, 2500]);

    const a = await lotWith(300, "Cost A");
    const b = await lotWith(100, "Cost B");
    const shared = await executeCommand(owner, addLotCost, { lotIds: [a.lotId, b.lotId], category: "Thread", amountMinor: 10_001, note: "One thread invoice" });
    expect(shared.parts).toEqual([{ lotId: a.lotId, amountMinor: 7501 }, { lotId: b.lotId, amountMinor: 2500 }]);
    const own = await executeCommand(owner, addLotCost, { lotIds: [a.lotId], category: "Packing", amountMinor: 2000 });

    const issued = await executeCommand(owner, recordIssue, { bundleId: a.bundleId, stageId: stage.pasting!, workerId: worker.W!, pieces: 300 });
    await executeCommand(owner, recordReturn, { issueId: issued.id, good: 300, rejected: 0, rework: 0, short: 0 });

    let cost = await executeQuery(owner, lotCosting, { lotId: a.lotId });
    expect(cost.other).toEqual([{ category: "Thread", amountMinor: 7501 }, { category: "Packing", amountMinor: 2000 }]);
    expect(cost.wagesMinor).toBe(300 * 200);
    expect(cost.totalMinor).toBe(7501 + 2000 + 60_000);

    // A wrong line is reversed, never edited, and reversing twice is refused.
    await executeCommand(owner, reverseLotCost, { costId: own.ids[0]!, reason: "entered on the wrong lot" });
    await reject(executeCommand(owner, reverseLotCost, { costId: own.ids[0]!, reason: "again" }), /already reversed/);
    cost = await executeQuery(owner, lotCosting, { lotId: a.lotId });
    expect(cost.otherMinor).toBe(7501);

    // A lot with nothing cut cannot take a share; the floor never sees costs.
    const empty = (await executeCommand(owner, createLot, { design: "Nothing cut", plannedPieces: 10 })).id;
    await reject(executeCommand(owner, addLotCost, { lotIds: [a.lotId, empty], category: "Thread", amountMinor: 500 }), /no pieces cut yet/);
    await reject(executeQuery(supervisor, lotCosting, { lotId: a.lotId }), /holds no Read grant/);
  });

  it("re-bundles at the cutting table only, before any work, and keeps the old numbers", async () => {
    const lotId = (await executeCommand(owner, createLot, { design: "Rebundle", plannedPieces: 120 })).id;
    const cut = await executeCommand(owner, cutLot, { lotId, groups: [{ copies: 2, netPieces: 60 }] });
    const [first, second] = cut.bundleIds as [string, string];

    await reject(executeCommand(owner, splitBundle, { bundleId: first, parts: [{ netPieces: 30 }, { netPieces: 20 }] }), /add up to 50/);
    const split = await executeCommand(owner, splitBundle, { bundleId: first, parts: [{ netPieces: 30, sizeNote: "M" }, { netPieces: 30, sizeNote: "L" }] });
    expect(split.numbers).toHaveLength(2);
    const parent = await withTenant(tenantId, (tx) => tx.pieceworkBundle.findUniqueOrThrow({ where: { id: first } }));
    expect(parent.cancelledAt).not.toBeNull();
    const child = await withTenant(tenantId, (tx) => tx.pieceworkBundle.findUniqueOrThrow({ where: { id: split.bundleIds[0]! } }));
    expect(child).toMatchObject({ parentBundleId: first, netPieces: 30, sizeNote: "M" });

    const merged = await executeCommand(owner, mergeBundles, { bundleIds: [split.bundleIds[1]!, second] });
    expect((await withTenant(tenantId, (tx) => tx.pieceworkBundle.findUniqueOrThrow({ where: { id: merged.bundleId } }))).netPieces).toBe(90);

    // Once a bundle is given out it moves in parts, so it is never re-bundled.
    await executeCommand(owner, recordIssue, { bundleId: merged.bundleId, stageId: stage.pasting!, workerId: worker.W!, pieces: 10 });
    await reject(executeCommand(owner, splitBundle, { bundleId: merged.bundleId, parts: [{ netPieces: 45 }, { netPieces: 45 }] }), /has work recorded/);
    await reject(executeCommand(owner, mergeBundles, { bundleIds: [merged.bundleId, split.bundleIds[0]!] }), /has work recorded/);
  });

  it("finds what a scanned or typed code is, inside the tenant only", async () => {
    const { lotId, bundleId } = await lotWith(10, "Scan me");
    const bundle = await withTenant(tenantId, (tx) => tx.pieceworkBundle.findUniqueOrThrow({ where: { id: bundleId } }));
    const lot = await withTenant(tenantId, (tx) => tx.pieceworkLot.findUniqueOrThrow({ where: { id: lotId } }));
    expect(await executeQuery(supervisor, lookupCode, { code: `https://app.example/lots/bundles/${bundleId}` })).toMatchObject({ kind: "bundle", id: bundleId });
    expect(await executeQuery(supervisor, lookupCode, { code: bundle.number.toLowerCase().replace("-", " ") })).toMatchObject({ kind: "bundle", id: bundleId });
    expect(await executeQuery(supervisor, lookupCode, { code: lot.number })).toMatchObject({ kind: "lot", id: lotId });
    const roll = await executeCommand(owner, receiveRolls, { fabricType: "Scan cloth", quantitiesCenti: [100] });
    expect(await executeQuery(supervisor, lookupCode, { code: roll.numbers[0]! })).toEqual({ kind: "roll", id: roll.rollIds[0], number: roll.numbers[0] });
    expect(await executeQuery(supervisor, lookupCode, { code: "B-999999" })).toMatchObject({ kind: "none" });
    expect(await executeQuery(supervisor, lookupCode, { code: `/lots/bundles/${randomUUID()}` })).toMatchObject({ kind: "none" });
  });

  it("refuses the same supplier's invoice twice unless confirmed, and warns when a fabric runs low", async () => {
    await executeCommand(owner, receiveRolls, { fabricType: "Dup cloth", quantitiesCenti: [5_000], supplier: "Mehta Textiles", invoiceNumber: "MT/900" });
    await reject(executeCommand(owner, receiveRolls, { fabricType: "Dup cloth", quantitiesCenti: [5_000], supplier: "mehta textiles", invoiceNumber: "mt/900" }), /already received \(R-\d+\)/);
    // Another supplier's invoice with the same number is not a duplicate; a confirmed second delivery goes through.
    await executeCommand(owner, receiveRolls, { fabricType: "Dup cloth", quantitiesCenti: [1_000], supplier: "Gupta Fabrics", invoiceNumber: "MT/900" });
    await executeCommand(owner, receiveRolls, { fabricType: "Dup cloth", quantitiesCenti: [1_000], supplier: "Mehta Textiles", invoiceNumber: "MT/900", confirmDuplicate: true });

    // No level, no warning. With a level of 100 m, a fabric under it is flagged, and one with nothing left is too.
    expect((await executeQuery(owner, listRolls, {})).low).toEqual([]);
    await executeCommand(owner, setProductionSettings, { lowFabricCenti: 10_000 });
    const lowOnes = (await executeQuery(owner, listRolls, {})).low;
    // 50 + 10 + 10 = 70 m across the three deliveries, under the 100 m level.
    expect(lowOnes.find((l) => l.fabricType === "Dup cloth")).toMatchObject({ balanceCenti: 7_000 });
    const small = await executeCommand(owner, receiveRolls, { fabricType: "Tiny cloth", quantitiesCenti: [2_000] });
    const sheet = (await executeCommand(owner, createLot, { design: "Uses tiny", plannedPieces: 5 })).id;
    await executeCommand(owner, moveFabric, { rollId: small.rollIds[0]!, kind: "issue", quantityCenti: 2_000, lotId: sheet });
    const after = await executeQuery(owner, listRolls, {});
    expect(after.lowLevelCenti).toBe(10_000);
    expect(after.low.find((l) => l.fabricType === "Tiny cloth")).toMatchObject({ balanceCenti: 0 });
    await executeCommand(owner, setProductionSettings, { lowFabricCenti: null });
    expect((await executeQuery(owner, listRolls, {})).low).toEqual([]);
  });

  it("will not count a cost twice: fabric, wages and every stage are already counted from the records", async () => {
    const { lotId } = await lotWith(10, "Double count");
    await reject(executeCommand(owner, addLotCost, { lotIds: [lotId], category: "fabric", amountMinor: 1000 }), /count it twice/);
    await reject(executeCommand(owner, addLotCost, { lotIds: [lotId], category: " Stitching ", amountMinor: 1000 }), /already counted from the wages/);
    await executeCommand(owner, addLotCost, { lotIds: [lotId], category: "Stitching thread", amountMinor: 1000 });
  });

  it("records who settled a case and when, and keeps a change history only the owner and manager can read", async () => {
    const { bundleId } = await lotWith(20, "History");
    const issue = await executeCommand(supervisor, recordIssue, { bundleId, stageId: stage.pasting!, workerId: worker.X!, pieces: 20 });
    const back = await executeCommand(supervisor, recordReturn, { issueId: issue.id, good: 18, rejected: 0, rework: 0, short: 2, note: "Lost on the floor" });
    const asked = await withTenant(tenantId, (tx) => tx.pieceworkApproval.findFirstOrThrow({ where: { entryId: back.id, kind: "deduction" } }));
    await executeCommand(manager, decideApproval, { approvalId: asked.id, decision: "declined", note: "Karigar showed the pieces were counted wrong" });

    const cases = await executeQuery(supervisor, floorCases, {});
    const settled = cases.settled.find((c) => c.entryId === back.id);
    expect(settled).toMatchObject({ recordedBy: "Supervisor A", chargeStatus: "declined" });
    expect(settled?.decision).toMatchObject({ by: "Manager Singh", outcome: "declined", note: "Karigar showed the pieces were counted wrong" });

    const history = await executeQuery(owner, pieceworkHistory, {});
    const line = history.rows.find((r) => r.what === "Took pieces back" && r.subject?.includes("Karigar X") && r.subject.includes("20 pieces"));
    expect(line).toMatchObject({ by: "Supervisor A", group: "work" });
    expect(history.rows.some((r) => r.what === "Decided a request" && r.by === "Manager Singh")).toBe(true);
    expect((await executeQuery(owner, pieceworkHistory, { group: "money" })).rows.every((r) => r.group === "money")).toBe(true);
    // Reading who did what is not for the floor.
    await reject(executeQuery(supervisor, pieceworkHistory, {}), /holds no Read grant/);
  });

  it("finds a bundle, lot, roll, karigar or challan by the number on the paper, a name, a phone or an invoice", async () => {
    const { lotId, bundleId } = await lotWith(12, "Searchable Oxford");
    const bundle = await withTenant(tenantId, (tx) => tx.pieceworkBundle.findUniqueOrThrow({ where: { id: bundleId } }));
    const n = Number(bundle.number.slice(2));
    const kar = (await executeCommand(owner, defineWorker, { name: "Ramesh Searchwala", mobile: "98140 55512" })).id;
    const roll = await executeCommand(owner, receiveRolls, { fabricType: "Searchable twill", quantitiesCenti: [500], supplier: "Zed Mills", invoiceNumber: "ZM/77" });
    const issued = await executeCommand(supervisor, recordIssue, { bundleId, stageId: stage.pasting!, workerId: worker.W!, pieces: 12 });

    const find = (as: ActorContext, term: string) => executeQuery(as, searchPiecework, { term });
    // The bundle is found however its number is typed, and comes first.
    for (const term of [bundle.number, `b${n}`, `B-${n}`, `b ${String(n).padStart(4, "0")}`]) {
      expect((await find(supervisor, term))[0]).toMatchObject({ kind: "bundle", id: bundleId });
    }
    expect((await find(owner, "searchable oxford")).find((h) => h.kind === "lot")).toMatchObject({ id: lotId, href: `/lots/${lotId}` });
    expect((await find(owner, "ramesh")).find((h) => h.kind === "karigar")).toMatchObject({ id: kar, href: `/karigars/${kar}` });
    expect((await find(owner, "98140 55512")).some((h) => h.kind === "karigar" && h.id === kar)).toBe(true);
    expect((await find(owner, "zm/77")).find((h) => h.kind === "roll")).toMatchObject({ id: roll.rollIds[0] });
    expect((await find(owner, roll.numbers[0]!.toLowerCase().replace("-", ""))).some((h) => h.kind === "roll")).toBe(true);
    expect((await find(owner, issued.challanNumber.toLowerCase())).find((h) => h.kind === "challan")).toMatchObject({ id: issued.challanNumber });

    // A supervisor finds bundles and karigars but not fabric, and a karigar opens the page a supervisor can see.
    expect((await find(supervisor, "zm/77")).some((h) => h.kind === "roll")).toBe(false);
    expect((await find(supervisor, "ramesh")).find((h) => h.kind === "karigar")).toMatchObject({ href: `/shopfloor/karigar/${kar}` });
    expect(await find(owner, "no such thing anywhere")).toEqual([]);

    // The day's challans are one list, with the supervisor's own joined onto one paper.
    const again = await executeCommand(supervisor, recordIssue, { bundleId, stageId: stage.pasting!, workerId: worker.W!, pieces: 1, challanNumber: issued.challanNumber }).catch(() => null);
    void again;
    // The tenant's own date (Asia/Kolkata), not UTC: between midnight and 05:30 IST the two differ.
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const day = await executeQuery(supervisor, challansOnDay, { date: today });
    expect(day.challans.find((c) => c.number === issued.challanNumber)).toMatchObject({ workerName: "Karigar W", by: "Supervisor A" });
    expect((await executeQuery(supervisor, challansOnDay, { date: "2001-01-01" })).challans).toEqual([]);
  });
});
