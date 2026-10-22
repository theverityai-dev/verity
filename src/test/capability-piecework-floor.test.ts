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
  ENTITY_PIECEWORK_DAY_CLOSE,
  ENTITY_PIECEWORK_ENTRY,
  ENTITY_PIECEWORK_LOT,
  ENTITY_PIECEWORK_PAYMENT,
  ENTITY_PIECEWORK_SETTING,
  ENTITY_PIECEWORK_STAGE,
  ENTITY_PIECEWORK_STAGE_ASSIGNMENT,
  ENTITY_PIECEWORK_WORKER,
  PIECEWORK_CAPABILITY,
  approvalsInbox,
  assignStages,
  closeDay,
  createBundle,
  createLot,
  dashboard,
  dayPreview,
  decideApproval,
  defineStage,
  defineWorker,
  floorOverview,
  floorRegister,
  floorWorkers,
  recordIssue,
  recordReturn,
  registerPieceworkCapability,
  reportCosting,
  requestApproval,
  reverseEntry,
  setLimits,
  setLotStatus,
  teamSetup,
  workerLedger,
} from "@/server/capabilities/piecework";

/**
 * The floor (Stylified MVP): a supervisor works only at the stages the owner assigned, asks for deductions and
 * write-offs that someone else decides within the limits the owner set, closes a day that freezes, and never sees a rupee.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;
if (!hasDatabase) {
  const message = "capability-piecework-floor.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describeDb("capability: the floor (stage scope, approvals, limits, day close)", () => {
  const tenants: string[] = [];
  const created = { users: [] as string[], parties: [] as string[] };
  let tenantId: string;
  let organizationId: string;
  let munshi: ActorContext, owner: ActorContext, manager: ActorContext, supA: ActorContext, supB: ActorContext;
  const stage: Record<string, string> = {};
  const worker: Record<string, string> = {};
  let lotId: string;
  let bundleId: string;

  const ALL_BUT_NEW = [ENTITY_PIECEWORK_STAGE, ENTITY_PIECEWORK_LOT, ENTITY_PIECEWORK_BUNDLE, ENTITY_PIECEWORK_WORKER, ENTITY_PIECEWORK_ENTRY, ENTITY_PIECEWORK_PAYMENT];
  const VERBS: PermissionVerb[] = ["Read", "Create", "Edit", "ActionExecute"];
  type Grant = [string, PermissionVerb[]];

  async function person(name: string, roleName: string, grants: Grant[]): Promise<ActorContext> {
    const actor = await withTenant(tenantId, async (tx) => {
      // Two people can share one role (the two supervisors); its grants are written once.
      let role = await tx.role.findFirst({ where: { name: roleName }, select: { id: true } });
      if (!role) {
        role = await tx.role.create({ data: { tenantId, name: roleName }, select: { id: true } });
        await tx.permission.createMany({ data: grants.flatMap(([entity, verbs]) => verbs.map((verb) => ({ tenantId, roleId: role!.id, verb, entity, scope: "Tenant" as const }))) });
      }
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
      await tx.tenant.create({ data: { id: tenantId, name: "Floor Test Works", timeZone: "Asia/Kolkata" } });
      await activateCapability(tx, tenantId, PIECEWORK_CAPABILITY);
      return (await tx.organization.create({ data: { tenantId, name: "Floor Test Works" } })).id;
    });
    const entryRw: PermissionVerb[] = ["Read", "Create", "ActionExecute"];
    munshi = await person("Munshi Ram", "Munshi", [...ALL_BUT_NEW.map((e): Grant => [e, VERBS]), [ENTITY_PIECEWORK_APPROVAL, ["Read", "Create"]], [ENTITY_PIECEWORK_DAY_CLOSE, ["Read", "Create"]]]);
    owner = await person("Owner Ji", "Owner", [...ALL_BUT_NEW.map((e): Grant => [e, VERBS]), ...[ENTITY_PIECEWORK_APPROVAL, ENTITY_PIECEWORK_SETTING, ENTITY_PIECEWORK_STAGE_ASSIGNMENT, ENTITY_PIECEWORK_DAY_CLOSE].map((e): Grant => [e, VERBS])]);
    manager = await person("Manager Singh", "Manager", [...ALL_BUT_NEW.map((e): Grant => [e, VERBS]), [ENTITY_PIECEWORK_APPROVAL, VERBS], [ENTITY_PIECEWORK_SETTING, ["Read"]], [ENTITY_PIECEWORK_DAY_CLOSE, ["Read"]], [ENTITY_PIECEWORK_STAGE_ASSIGNMENT, ["Read"]]]);
    const supervisor: Grant[] = [
      [ENTITY_PIECEWORK_STAGE, ["Read"]], [ENTITY_PIECEWORK_LOT, ["Read"]], [ENTITY_PIECEWORK_BUNDLE, ["Read"]], [ENTITY_PIECEWORK_ENTRY, entryRw],
      [ENTITY_PIECEWORK_APPROVAL, ["Read", "Create"]], [ENTITY_PIECEWORK_DAY_CLOSE, ["Read", "Create"]],
    ];
    supA = await person("Supervisor A", "Supervisor", supervisor);
    supB = await person("Supervisor B", "Supervisor", supervisor);

    for (const [key, label] of [["pasting", "Pasting"], ["stitching", "Stitching"], ["finishing", "Finishing"]] as const) {
      stage[key] = (await executeCommand(munshi, defineStage, { stageKey: key, label })).id;
    }
    const rate = (key: string, rateMinor: number) => ({ stageId: stage[key]!, rateMinor, wageBasis: "good" as const, effectiveFrom: "2026-01-01" });
    worker.P = (await executeCommand(munshi, defineWorker, { name: "Karigar P", rates: [rate("pasting", 200)] })).id;
    worker.S = (await executeCommand(munshi, defineWorker, { name: "Karigar S", rates: [rate("stitching", 1200)] })).id;
    lotId = (await executeCommand(munshi, createLot, { design: "Oxford", plannedPieces: 200 })).id;
    await executeCommand(munshi, setLotStatus, { lotId, to: "active" });
    bundleId = (await executeCommand(munshi, createBundle, { lotId, netPieces: 100 })).id;
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
  const issue = (as: ActorContext, key: string, who: string, pieces: number) => executeCommand(as, recordIssue, { bundleId, stageId: stage[key]!, workerId: worker[who]!, pieces });

  it("refuses a supervisor every stage until the owner assigns one, and only the owner can assign", async () => {
    await reject(issue(supA, "pasting", "P", 10), /not one of your stages/);
    await reject(executeCommand(supA, assignStages, { userId: supA.userId, stageIds: [stage.pasting!] }), /holds no Edit grant/);
    await reject(executeCommand(manager, assignStages, { userId: supA.userId, stageIds: [stage.pasting!] }), /holds no Edit grant/);
    await executeCommand(owner, assignStages, { userId: supA.userId, stageIds: [stage.pasting!] });
    await executeCommand(owner, assignStages, { userId: supB.userId, stageIds: [stage.stitching!] });
    const first = await issue(supA, "pasting", "P", 100);
    expect(first.id).toBeTruthy();
    // A supervisor cannot take back at a stage that is not theirs, whoever holds the pieces.
    await reject(executeCommand(supB, recordReturn, { issueId: first.id, good: 100, rejected: 0, rework: 0, short: 0 }), /not one of your stages/);
    // Replacing the set removes the old stage.
    await executeCommand(owner, assignStages, { userId: supB.userId, stageIds: [stage.stitching!, stage.pasting!] });
    await executeCommand(owner, assignStages, { userId: supB.userId, stageIds: [stage.stitching!] });
    await reject(executeCommand(supB, recordReturn, { issueId: first.id, good: 100, rejected: 0, rework: 0, short: 0 }), /not one of your stages/);
  });

  it("scopes the floor view to the supervisor's stages and carries no money", async () => {
    const mine = await executeQuery(supA, floorOverview, {});
    expect(mine.stages.map((s) => s.label)).toEqual(["Pasting"]);
    expect(mine.allStages).toBe(false);
    expect(mine.counts.out).toBe(100);
    const other = await executeQuery(supB, floorOverview, {});
    expect(other.stages.map((s) => s.label)).toEqual(["Stitching"]);
    expect(other.issues).toHaveLength(0);
    expect((await executeQuery(munshi, floorOverview, {})).allStages).toBe(true);
    const workers = await executeQuery(supA, floorWorkers, {});
    expect(JSON.stringify(workers)).not.toMatch(/rate|wage|balance|Minor/i);
    // The money queries stay behind the money grants.
    await expect(executeQuery(supA, workerLedger, { workerId: worker.P! })).rejects.toThrow();
  });

  it("lets a supervisor reverse only an entry they made, on the day; a manager can reverse any", async () => {
    await reject(issue(supA, "pasting", "P", 1), /only 0 pieces can be issued/);
    const theirs = await executeCommand(munshi, recordReturn, { issueId: (await executeQuery(munshi, floorOverview, {})).issues[0]!.issueId, good: 20, rejected: 0, rework: 0, short: 0 });
    await reject(executeCommand(supA, reverseEntry, { entryId: theirs.id }), /only entries you made yourself/);
    await executeCommand(manager, reverseEntry, { entryId: theirs.id, note: "Counted twice" });
  });

  it("holds a deduction for a decision, within the manager's limit, never by the person who asked", async () => {
    await executeCommand(owner, setLimits, { deductionLimitMinor: 100_000, writeoffLimitPieces: 5 });
    const ask = await executeCommand(supA, requestApproval, { kind: "deduction", workerId: worker.P!, amountMinor: 30_000, reason: "Scorch marks on 6 pieces" });
    await reject(executeCommand(supA, decideApproval, { approvalId: ask.id, decision: "approved" }), /holds no ActionExecute grant/);
    await reject(executeCommand(manager, decideApproval, { approvalId: ask.id, decision: "declined" }), /say why/);
    const money = () => withTenant(tenantId, (tx) => tx.pieceworkPayment.count({ where: { kind: "deduction", workerId: worker.P! } }));
    expect(await money()).toBe(0);
    await executeCommand(manager, decideApproval, { approvalId: ask.id, decision: "approved" });
    expect(await money()).toBe(1);
    await reject(executeCommand(manager, decideApproval, { approvalId: ask.id, decision: "approved" }), /already approved/);

    const big = await executeCommand(supA, requestApproval, { kind: "deduction", workerId: worker.P!, amountMinor: 250_000, reason: "Whole batch spoiled" });
    await reject(executeCommand(manager, decideApproval, { approvalId: big.id, decision: "approved" }), /above the limit/);
    await executeCommand(owner, decideApproval, { approvalId: big.id, decision: "approved" });
    expect(await money()).toBe(2);
    // An owner raising a request cannot decide it themselves.
    const own = await executeCommand(owner, requestApproval, { kind: "deduction", workerId: worker.P!, amountMinor: 100, reason: "Test" });
    await reject(executeCommand(owner, decideApproval, { approvalId: own.id, decision: "approved" }), /someone else must decide/);
    await executeCommand(manager, decideApproval, { approvalId: own.id, decision: "declined", note: "Not needed" });
  });

  it("writes off short pieces only up to what is open, and above the limit only the owner decides", async () => {
    const issueId = (await executeQuery(munshi, floorOverview, {})).issues[0]!.issueId;
    const ret = await executeCommand(supA, recordReturn, { issueId, good: 80, rejected: 0, rework: 0, short: 8 });
    await reject(executeCommand(supA, requestApproval, { kind: "writeoff", entryId: ret.id, pieces: 9, reason: "Lost in transit" }), /only 8 short pieces/);
    const small = await executeCommand(supA, requestApproval, { kind: "writeoff", entryId: ret.id, pieces: 3, reason: "Lost in transit" });
    await reject(executeCommand(supA, requestApproval, { kind: "writeoff", entryId: ret.id, pieces: 6, reason: "More lost" }), /only 5 short pieces/);
    let reg = await executeQuery(supA, floorRegister, {});
    expect(reg.shortages[0]).toMatchObject({ short: 8, requested: 3, open: 5 });
    await executeCommand(manager, decideApproval, { approvalId: small.id, decision: "approved" });
    reg = await executeQuery(supA, floorRegister, {});
    expect(reg.shortages[0]).toMatchObject({ writtenOff: 3, requested: 0, open: 5 });
    const rest = await executeCommand(supA, requestApproval, { kind: "writeoff", entryId: ret.id, pieces: 5, reason: "Rest also lost" });
    await executeCommand(owner, setLimits, { deductionLimitMinor: 100_000, writeoffLimitPieces: 2 });
    await reject(executeCommand(manager, decideApproval, { approvalId: rest.id, decision: "approved" }), /above the limit/);
    await executeCommand(owner, decideApproval, { approvalId: rest.id, decision: "approved" });
    const inbox = await executeQuery(manager, approvalsInbox, {});
    expect(inbox.rows.filter((r) => r.status === "pending")).toHaveLength(0);
    expect(inbox.canDecide).toBe(true);
    expect(inbox.isOwner).toBe(false);
  });

  it("puts a lot on hold or closes it only through an approved request, and refuses a move the lot cannot make", async () => {
    const hold = await executeCommand(supA, requestApproval, { kind: "hold", lotId, reason: "Fabric shade mismatch" });
    await executeCommand(manager, decideApproval, { approvalId: hold.id, decision: "approved" });
    expect((await withTenant(tenantId, (tx) => tx.pieceworkLot.findUniqueOrThrow({ where: { id: lotId } }))).status).toBe("hold");
    await reject(executeCommand(supA, requestApproval, { kind: "hold", lotId, reason: "Again" }), /cannot be put on hold/);
    await reject(executeCommand(supA, requestApproval, { kind: "close", lotId, reason: "Done" }), /cannot be closed/);
    await executeCommand(munshi, setLotStatus, { lotId, to: "active" });
  });

  it("closes a day once, freezes the summary, and shows the owner what was handed over", async () => {
    const before = await executeQuery(supA, dayPreview, {});
    expect(before.closed).toBeNull();
    expect(before.summary.stages).toEqual(["Pasting"]);
    expect(before.summary.given).toBe(100);
    await executeCommand(supA, closeDay, { note: "Aaj ka kaam poora", lang: "hi" });
    await reject(executeCommand(supA, closeDay, { note: "again" }), /already closed today/);
    // Work entered after the close does not change what was handed over.
    const after = await executeQuery(supA, dayPreview, {});
    expect(after.closed).toMatchObject({ note: "Aaj ka kaam poora", lang: "hi" });
    expect(after.summary.given).toBe(100);
    const team = await executeQuery(owner, teamSetup, {});
    expect(team.closes[0]).toMatchObject({ by: "Supervisor A", lang: "hi", note: "Aaj ka kaam poora" });
    const sup = team.members.find((m) => m.name === "Supervisor B")!;
    expect(sup).toMatchObject({ role: "Supervisor", allStages: false, stageIds: [stage.stitching!] });
    expect(team.members.find((m) => m.name === "Munshi Ram")!.allStages).toBe(true);
  });

  it("never lets a wage or a balance reach a supervisor, even by calling the queries directly", async () => {
    const asMunshi = await executeQuery(munshi, dashboard, {});
    expect(asMunshi.dues.workers.length + asMunshi.lotWages.length).toBeGreaterThan(0);
    const asSupervisor = await executeQuery(supA, dashboard, {});
    expect(asSupervisor.dues).toEqual({ totalMinor: 0, advanceOutstandingMinor: 0, workers: [] });
    expect(asSupervisor.lotWages).toEqual([]);
    // The floor figures the dashboard also carries are still there.
    expect(asSupervisor.activeLots.length).toBeGreaterThan(0);
    await reject(executeQuery(supA, reportCosting, {}), /holds no Read grant/);
    expect((await executeQuery(owner, reportCosting, {})).some((r) => r.wagesMinor > 0)).toBe(true);
  });
});
