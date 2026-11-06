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
  cancelPackingList,
  createBundle,
  createLot,
  createPackingList,
  defineStage,
  defineWorker,
  lotInspections,
  lotPackingLists,
  packingListDetail,
  presetPermissions,
  recordInspection,
  recordIssue,
  recordReturn,
  registerPieceworkCapability,
  reverseInspection,
  setLotStatus,
} from "@/server/capabilities/piecework";

/** Getting a lot out of the door: an AQL inspection of its garments and the packing list of its cartons. */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;
if (!hasDatabase) {
  const message = "capability-piecework-shipment.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describeDb("capability: inspection and packing list", () => {
  const tenants: string[] = [];
  const created = { users: [] as string[], parties: [] as string[] };
  let owner: ActorContext;
  let supervisor: ActorContext;
  let lotId: string;
  let draftLotId: string;

  const actorWith = async (tenantId: string, organizationId: string, role: string, name: string) =>
    withTenant(tenantId, async (tx) => {
      const roleId = (await tx.role.create({ data: { tenantId, name: role }, select: { id: true } })).id;
      await tx.permission.createMany({ data: presetPermissions(ROLE_PRESETS.find((p) => p.name === role)!).map((g) => ({ tenantId, roleId, verb: g.verb, entity: g.entity, scope: g.scope })) });
      const identity = await provisionIdentity(tx, { organizationId, authUserId: randomUUID(), displayName: name });
      created.users.push(identity.userId); created.parties.push(identity.partyId);
      await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId } });
      return { tenantId, userId: identity.userId, membershipId: identity.membershipId, organizationId, roleId } as ActorContext;
    });

  beforeAll(async () => {
    await assertRlsEnforceable();
    clearCommands(); clearQueries(); clearHooks(); clearScopeResolvers(); clearTransitionGuards(); clearContributions();
    registerPieceworkCapability();
    const tenantId = randomUUID();
    tenants.push(tenantId);
    const organizationId = await withTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: "Shipment Works", timeZone: "Asia/Kolkata" } });
      await activateCapability(tx, tenantId, PIECEWORK_CAPABILITY);
      return (await tx.organization.create({ data: { tenantId, name: "Shipment Works" } })).id;
    });
    owner = await actorWith(tenantId, organizationId, "Owner", "Owner Ji");
    supervisor = await actorWith(tenantId, organizationId, "Supervisor", "Checker Ji");
    invalidateCapabilityCache();

    // One stage: 600 cut, 590 good back, so 590 pieces are ready to pack.
    const stageId = (await executeCommand(owner, defineStage, { stageKey: "checking", label: "Checking" })).id;
    const workerId = (await executeCommand(owner, defineWorker, { name: "Karigar S", rates: [{ stageId, rateMinor: 200, wageBasis: "good" as const, effectiveFrom: "2026-01-01" }] })).id;
    lotId = (await executeCommand(owner, createLot, { design: "Kids hoodie", plannedPieces: 600 })).id;
    await executeCommand(owner, setLotStatus, { lotId, to: "active" });
    const bundleId = (await executeCommand(owner, createBundle, { lotId, netPieces: 600 })).id;
    const issue = await executeCommand(owner, recordIssue, { bundleId, stageId, workerId, pieces: 600 });
    await executeCommand(owner, recordReturn, { issueId: issue.id, good: 590, rejected: 10, rework: 0, short: 0 });
    draftLotId = (await executeCommand(owner, createLot, { design: "Not started", plannedPieces: 50 })).id;
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

  const base = { kind: "final" as const, inspector: "Buyer QC", offeredPieces: 590, level: "II" as const, aqlMajor: "2.5" as const, aqlMinor: "4.0" as const };

  it("stores the AQL plan it judged by, and fails on a critical defect", async () => {
    // 590 pieces, level II: letter J, 80 pieces, accept 5 major and 7 minor.
    const pass = await executeCommand(supervisor, recordInspection, { ...base, lotId, criticalFound: 0, majorFound: 5, minorFound: 7 });
    expect(pass).toMatchObject({ result: "pass", sampleSize: 80 });
    const fail = await executeCommand(supervisor, recordInspection, { ...base, lotId, criticalFound: 1, majorFound: 0, minorFound: 0 });
    expect(fail.result).toBe("fail");
    const read = await executeQuery(owner, lotInspections, { lotId });
    expect(read.inspections[0]).toMatchObject({ codeLetter: "J", sampleSize: 80, acceptMajor: 5, acceptMinor: 7, result: "fail", by: "Checker Ji" });
    expect(read.finalResult).toBe("fail");

    // A mistake is reversed by the office, and the standing record is the pass again.
    await expect(executeCommand(supervisor, reverseInspection, { inspectionId: fail.id, reason: "Entered against the wrong lot" })).rejects.toThrow();
    await executeCommand(owner, reverseInspection, { inspectionId: fail.id, reason: "Entered against the wrong lot" });
    expect((await executeQuery(owner, lotInspections, { lotId })).finalResult).toBe("pass");
    await expect(executeCommand(owner, reverseInspection, { inspectionId: fail.id, reason: "again" })).rejects.toThrow(/already reversed/);
  });

  it("refuses an inspection of a lot that has not started", async () => {
    await expect(executeCommand(owner, recordInspection, { ...base, lotId: draftLotId, criticalFound: 0, majorFound: 0, minorFound: 0 })).rejects.toThrow(/has not started/);
  });

  const carton = (from: number, to: number, sizes: Array<[string, number]>) => ({
    from, to, colour: "Navy", sizes: sizes.map(([size, qty]) => ({ size, qty })), netGrams: 7200, grossGrams: 8100, lengthCm: 60, widthCm: 40, heightCm: 40,
  });

  it("totals the cartons and never packs more than is ready", async () => {
    // 1-20: 24 per carton (480); 21-22: 20 per carton (40). 520 of 590.
    const pl = await executeCommand(owner, createPackingList, {
      lotId, buyer: "Nordic Kids AB", reference: "PO 4471 / AE/EXP/0040", destination: "Gothenburg",
      cartons: [carton(1, 20, [["2-3Y", 6], ["4-5Y", 8], ["6-7Y", 6], ["8-9Y", 4]]), carton(21, 22, [["2-3Y", 5], ["4-5Y", 5], ["6-7Y", 5], ["8-9Y", 5]])],
    });
    expect(pl).toMatchObject({ number: "PL-0001", pieces: 520 });
    const detail = (await executeQuery(owner, packingListDetail, { packingListId: pl.id }))!;
    expect(detail.totals).toMatchObject({ cartons: 22, pieces: 520, netGrams: 22 * 7200, grossGrams: 22 * 8100, cbmMilli: 22 * 96 });
    expect(detail.totals.bySize).toEqual([{ size: "2-3Y", pieces: 130 }, { size: "4-5Y", pieces: 170 }, { size: "6-7Y", pieces: 130 }, { size: "8-9Y", pieces: 90 }]);

    expect((await executeQuery(owner, lotPackingLists, { lotId })).readyToPack).toBe(70);
    await expect(executeCommand(owner, createPackingList, { lotId, buyer: "Nordic Kids AB", cartons: [carton(1, 3, [["4-5Y", 24]])] })).rejects.toThrow(/70 ready pieces not yet on a packing list/);

    // Cancelling frees its pieces again.
    await executeCommand(owner, cancelPackingList, { packingListId: pl.id, reason: "Carton ratio changed by the buyer" });
    expect((await executeQuery(owner, lotPackingLists, { lotId })).readyToPack).toBe(590);
  });

  it("refuses cartons with gaps, overlaps or a lighter gross than net", async () => {
    const make = (cartons: ReturnType<typeof carton>[]) => executeCommand(owner, createPackingList, { lotId, buyer: "Nordic Kids AB", cartons });
    await expect(make([carton(2, 3, [["M", 1]])])).rejects.toThrow(/cartons 1 to 1 are missing/);
    await expect(make([carton(1, 3, [["M", 1]]), carton(3, 4, [["M", 1]])])).rejects.toThrow(/carton 3 is on two lines/);
    await expect(make([{ ...carton(1, 1, [["M", 1]]), grossGrams: 100 }])).rejects.toThrow(/less gross than net/);
    await expect(make([carton(1, 1, [["M", 1], ["m", 2]])])).rejects.toThrow(/size twice/);
  });

  it("keeps packing lists off the supervisor, who sees no shipment", async () => {
    await expect(executeQuery(supervisor, lotPackingLists, { lotId })).rejects.toThrow();
  });
});
