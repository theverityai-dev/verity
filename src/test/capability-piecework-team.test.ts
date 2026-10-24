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
  PIECEWORK_CAPABILITY,
  ROLE_PRESETS,
  assignStages,
  createBundle,
  createLot,
  defineStage,
  defineWorker,
  floorWorkers,
  importWorkers,
  installRolePresets,
  presetNamed,
  presetPermissions,
  recordIssue,
  recordPayment,
  registerPieceworkCapability,
  setLotStatus,
  supervisorChoices,
  teamDirectory,
  updateWorker,
  workerLedger,
} from "@/server/capabilities/piecework";

/**
 * Team management for the factory: the role presets a workspace installs once (and cannot use to grant more than the installer
 * holds), the supervisor a karigar is set under, and the directory the Team screen reads.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;
if (!hasDatabase) {
  const message = "capability-piecework-team.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describeDb("capability: team management (role presets, supervisor link, directory)", () => {
  const tenants: string[] = [];
  const created = { users: [] as string[], parties: [] as string[] };
  let tenantId: string;
  let organizationId: string;
  let owner: ActorContext, supA: ActorContext, supB: ActorContext;
  const stage: Record<string, string> = {};
  const worker: Record<string, string> = {};
  let bundleId: string;
  let supBMembershipId: string;

  /** A person whose role is made from the given grants (a bootstrap role, before any preset exists), or from an installed preset. */
  async function person(name: string, role: { grants: ReturnType<typeof presetPermissions> } | { preset: string }): Promise<ActorContext & { membershipId: string }> {
    const actor = await withTenant(tenantId, async (tx) => {
      let roleId: string;
      if ("preset" in role) {
        roleId = (await tx.role.findFirstOrThrow({ where: { name: role.preset }, select: { id: true } })).id;
      } else {
        roleId = (await tx.role.create({ data: { tenantId, name: `Bootstrap ${name}` }, select: { id: true } })).id;
        await tx.permission.createMany({ data: role.grants.map((g) => ({ tenantId, roleId, verb: g.verb, entity: g.entity, scope: g.scope })) });
      }
      const identity = await provisionIdentity(tx, { organizationId, authUserId: randomUUID(), displayName: name });
      created.users.push(identity.userId);
      created.parties.push(identity.partyId);
      await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId } });
      return { tenantId, userId: identity.userId, membershipId: identity.membershipId, organizationId, roleId } as ActorContext & { membershipId: string };
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
      await tx.tenant.create({ data: { id: tenantId, name: "Team Test Works", timeZone: "Asia/Kolkata" } });
      await activateCapability(tx, tenantId, PIECEWORK_CAPABILITY);
      return (await tx.organization.create({ data: { tenantId, name: "Team Test Works" } })).id;
    });
    // The first owner exists before any preset does (the operator or the seed makes them); they hold what the Owner preset holds.
    owner = await person("Owner Ji", { grants: presetPermissions(presetNamed("Owner")!) });
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

  it("installs the factory's roles once, and again changes nothing", async () => {
    const first = await executeCommand(owner, installRolePresets, {});
    expect(first.created).toEqual(ROLE_PRESETS.map((p) => p.name));
    expect(first.existing).toEqual([]);
    const again = await executeCommand(owner, installRolePresets, {});
    expect(again.created).toEqual([]);
    expect(again.existing).toHaveLength(ROLE_PRESETS.length);

    // A supervisor holds nothing on workers, payments, fabric or costs; the store holds fabric and no money.
    const grants = await withTenant(tenantId, async (tx) => {
      const rows = await tx.permission.findMany({ where: { role: { name: { in: ["Supervisor", "Store"] } } }, select: { entity: true, role: { select: { name: true } } } });
      return rows.map((r) => `${r.role.name}:${r.entity}`);
    });
    expect(grants.some((g) => g.startsWith("Supervisor:") && /worker|payment|roll|lot_cost|lot_rate/.test(g))).toBe(false);
    expect(grants).toContain("Store:verity.piecework.roll");
    expect(grants.some((g) => g.startsWith("Store:") && /payment|worker/.test(g))).toBe(false);
  });

  it("refuses a preset the installer could not grant themselves", async () => {
    const limited = await person("Limited Lal", { grants: [{ verb: "Edit", entity: "verity.piecework.setting", scope: "Tenant" }] });
    await withTenant(tenantId, (tx) => tx.role.deleteMany({ where: { name: "Owner" } }));
    await expect(executeCommand(limited, installRolePresets, { names: ["Owner"] })).rejects.toThrow(/beyond your own permissions/);
    await expect(executeCommand(owner, installRolePresets, { names: ["No such role"] })).rejects.toThrow(/no preset called/);
    // Put the Owner role back for the owner to carry on.
    expect((await executeCommand(owner, installRolePresets, { names: ["Owner"] })).created).toEqual(["Owner"]);
  });

  it("sets a karigar under a supervisor, and the supervisor's give-out list and commands follow", async () => {
    supA = await person("Supervisor A", { preset: "Supervisor" });
    supB = await person("Supervisor B", { preset: "Supervisor" });
    supBMembershipId = supB.membershipId;
    for (const [key, label] of [["pasting", "Pasting"]] as const) stage[key] = (await executeCommand(owner, defineStage, { stageKey: key, label })).id;
    const rates = [{ stageId: stage.pasting!, rateMinor: 200, wageBasis: "good" as const, effectiveFrom: "2026-01-01" }];
    worker.A = (await executeCommand(owner, defineWorker, { name: "Karigar A", rates, supervisorUserId: supA.userId, joinedOn: "2026-02-01", idNote: "Aadhaar 4321", emergencyContact: "Wife 98765 43210" })).id;
    worker.B = (await executeCommand(owner, defineWorker, { name: "Karigar B", rates, supervisorUserId: supB.userId })).id;
    worker.C = (await executeCommand(owner, defineWorker, { name: "Karigar C", rates })).id;
    await executeCommand(owner, assignStages, { userId: supA.userId, stageIds: [stage.pasting!] });
    await executeCommand(owner, assignStages, { userId: supB.userId, stageIds: [stage.pasting!] });
    const lotId = (await executeCommand(owner, createLot, { design: "Oxford", plannedPieces: 300 })).id;
    await executeCommand(owner, setLotStatus, { lotId, to: "active" });
    bundleId = (await executeCommand(owner, createBundle, { lotId, netPieces: 100 })).id;

    const names = async (as: ActorContext) => (await executeQuery(as, floorWorkers, {})).map((w) => w.name);
    expect(await names(supA)).toEqual(["Karigar A", "Karigar C"]);
    expect(await names(supB)).toEqual(["Karigar B", "Karigar C"]);
    expect(await names(owner)).toEqual(["Karigar A", "Karigar B", "Karigar C"]);

    const give = (as: ActorContext, who: string, pieces: number) => executeCommand(as, recordIssue, { bundleId, stageId: stage.pasting!, workerId: worker[who]!, pieces });
    await expect(give(supA, "B", 10)).rejects.toThrow(/looked after by another supervisor/);
    expect((await give(supA, "A", 10)).id).toBeTruthy();
    expect((await give(supA, "C", 10)).id).toBeTruthy();
    // Someone who works at every stage (the owner) is not limited to their own karigars.
    expect((await give(owner, "B", 10)).id).toBeTruthy();
  });

  it("changes the profile and the supervisor, clearing a field with null, and the ledger shows it", async () => {
    await executeCommand(owner, updateWorker, { workerId: worker.B!, supervisorUserId: supA.userId, joinedOn: "2026-03-05", idNote: "PAN ABCDE1234F" });
    let ledger = (await executeQuery(owner, workerLedger, { workerId: worker.B! }))!;
    expect(ledger.worker.supervisorName).toBe("Supervisor A");
    expect(ledger.worker.joinedOn).toBe("2026-03-05");
    expect(ledger.worker.idNote).toBe("PAN ABCDE1234F");
    // Now Supervisor A may give to Karigar B, and Supervisor B no longer sees B.
    expect((await executeQuery(supB, floorWorkers, {})).map((w) => w.name)).toEqual(["Karigar C"]);
    await executeCommand(supA, recordIssue, { bundleId, stageId: stage.pasting!, workerId: worker.B!, pieces: 5 });

    await executeCommand(owner, updateWorker, { workerId: worker.B!, supervisorUserId: null, idNote: null, emergencyContact: null });
    ledger = (await executeQuery(owner, workerLedger, { workerId: worker.B! }))!;
    expect(ledger.worker.supervisorUserId).toBeNull();
    expect(ledger.worker.idNote).toBeNull();
    expect(ledger.worker.joinedOn).toBe("2026-03-05");

    await expect(executeCommand(owner, updateWorker, { workerId: worker.B!, name: "Karigar A" })).rejects.toThrow(/already exists/);
    await expect(executeCommand(owner, updateWorker, { workerId: randomUUID(), idNote: "x" })).rejects.toThrow(/not found/);
    // A supervisor cannot edit a profile: no Edit grant on workers.
    await expect(executeCommand(supA, updateWorker, { workerId: worker.A!, idNote: "x" })).rejects.toThrow(/holds no Edit grant/);
  });

  it("imports a pasted karigar list once, skipping names already here", async () => {
    const first = await executeCommand(owner, importWorkers, { rows: [{ name: "Import One", mobile: "98765 43210" }, { name: "karigar a" }, { name: "Import Two", kind: "outside", address: "Focal Point" }] });
    expect(first).toEqual({ created: 2, skipped: ["karigar a"] });
    const again = await executeCommand(owner, importWorkers, { rows: [{ name: "import one" }, { name: "Import Two" }] });
    expect(again).toEqual({ created: 0, skipped: ["import one", "Import Two"] });
    await expect(executeCommand(owner, importWorkers, { rows: [{ name: "Bad Mobile", mobile: "12" }] })).rejects.toThrow();
    const ledger = (await executeQuery(owner, workerLedger, { workerId: (await withTenant(tenantId, (tx) => tx.pieceworkWorker.findFirstOrThrow({ where: { name: "Import Two" }, select: { id: true } }))).id }))!;
    expect(ledger.worker).toMatchObject({ kind: "outside", address: "Focal Point" });
  });

  it("starts a karigar's account from an opening balance owed, which is wages and can be paid and reversed", async () => {
    const opened = await executeCommand(owner, recordPayment, { workerId: worker.A!, kind: "opening", amountMinor: 500_000, note: "Owed from the old register" });
    expect(opened.balanceMinor).toBe(500_000);
    let ledger = (await executeQuery(owner, workerLedger, { workerId: worker.A! }))!;
    expect(ledger.money).toMatchObject({ wagesMinor: 500_000, balanceMinor: 500_000, paidMinor: 0 });
    const paid = await executeCommand(owner, recordPayment, { workerId: worker.A!, kind: "payment", amountMinor: 200_000, mode: "cash" });
    expect(paid.balanceMinor).toBe(300_000);
    // An opening balance cannot be paid out beyond what is owed, like any wages.
    await expect(executeCommand(owner, recordPayment, { workerId: worker.A!, kind: "payment", amountMinor: 300_001 })).rejects.toThrow(/is owed only/);
    const { reversePayment } = await import("@/server/capabilities/piecework");
    await executeCommand(owner, reversePayment, { paymentId: opened.id, note: "Entered twice" });
    ledger = (await executeQuery(owner, workerLedger, { workerId: worker.A! }))!;
    expect(ledger.money.wagesMinor).toBe(0);
    expect(ledger.money.balanceMinor).toBe(-200_000);
  });
  it("refuses a supervisor who can no longer sign in, and lists only active members as choices", async () => {
    await withTenant(tenantId, (tx) => tx.tenantMembership.update({ where: { id: supBMembershipId }, data: { disabledAt: new Date() } }));
    invalidateCapabilityCache();
    await expect(executeCommand(owner, updateWorker, { workerId: worker.C!, supervisorUserId: supB.userId })).rejects.toThrow(/not an active member/);
    await expect(executeCommand(owner, defineWorker, { name: "Karigar D", supervisorUserId: supB.userId })).rejects.toThrow(/not an active member/);
    const choices = await executeQuery(owner, supervisorChoices, {});
    expect(choices.map((c) => c.name)).toContain("Supervisor A");
    expect(choices.map((c) => c.name)).not.toContain("Supervisor B");
  });

  it("reads the team directory: roles, stages, who looks after whom, what the viewer may do", async () => {
    const dir = await executeQuery(owner, teamDirectory, {});
    expect(dir.organizationId).toBe(organizationId);
    expect(dir.missingPresets).toEqual([]);
    expect(dir.can).toEqual({ addPerson: true, changeRole: true, switchAccess: true, installRoles: true, assignStages: true });

    const a = dir.people.find((p) => p.name === "Supervisor A")!;
    expect(a.roleName).toBe("Supervisor");
    expect(a.allStages).toBe(false);
    expect(a.stageIds).toEqual([stage.pasting!]);
    expect(a.karigars.map((k) => k.name).sort()).toEqual(["Karigar A"]);
    expect(a.piecesHeld).toBe(10);
    expect(dir.people.find((p) => p.name === "Owner Ji")!.allStages).toBe(true);
    // A switched-off person stays in the list, last, so they can be switched back on.
    const b = dir.people.find((p) => p.name === "Supervisor B")!;
    expect(b.disabled).toBe(true);
    expect(dir.people[dir.people.length - 1]!.name).toBe("Supervisor B");
    expect(dir.roles.find((r) => r.name === "Supervisor")).toMatchObject({ allStages: false });
    expect(dir.roles.find((r) => r.name === "Manager")).toMatchObject({ allStages: true });

    // A supervisor cannot read the directory at all (no grant on the setting entity).
    await expect(executeQuery(supA, teamDirectory, {})).rejects.toThrow();
  });
});
