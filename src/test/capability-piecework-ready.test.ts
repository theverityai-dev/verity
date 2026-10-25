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
  createBundle,
  createLot,
  defineStage,
  defineWorker,
  presetPermissions,
  readyStock,
  recordIssue,
  recordReadyMove,
  recordReturn,
  registerPieceworkCapability,
  reverseReadyMove,
  setLotStatus,
} from "@/server/capabilities/piecework";

/**
 * Ready garment inventory: what production makes ready is derived; opening stock, stock out and count corrections are an append-only
 * ledger. Nothing can leave that is not in stock, and a mistake is a reversal.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;
if (!hasDatabase) {
  const message = "capability-piecework-ready.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describeDb("capability: ready garment inventory", () => {
  const tenants: string[] = [];
  const created = { users: [] as string[], parties: [] as string[] };
  let tenantId: string;
  let owner: ActorContext;
  let lotId: string;
  let lotNumber: string;

  beforeAll(async () => {
    await assertRlsEnforceable();
    clearCommands(); clearQueries(); clearHooks(); clearScopeResolvers(); clearTransitionGuards(); clearContributions();
    registerPieceworkCapability();
    tenantId = randomUUID();
    tenants.push(tenantId);
    const organizationId = await withTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: "Ready Stock Works", timeZone: "Asia/Kolkata" } });
      await activateCapability(tx, tenantId, PIECEWORK_CAPABILITY);
      return (await tx.organization.create({ data: { tenantId, name: "Ready Stock Works" } })).id;
    });
    owner = await withTenant(tenantId, async (tx) => {
      const roleId = (await tx.role.create({ data: { tenantId, name: "Owner" }, select: { id: true } })).id;
      await tx.permission.createMany({ data: presetPermissions(ROLE_PRESETS.find((p) => p.name === "Owner")!).map((g) => ({ tenantId, roleId, verb: g.verb, entity: g.entity, scope: g.scope })) });
      const identity = await provisionIdentity(tx, { organizationId, authUserId: randomUUID(), displayName: "Owner Ji" });
      created.users.push(identity.userId); created.parties.push(identity.partyId);
      await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId } });
      return { tenantId, userId: identity.userId, membershipId: identity.membershipId, organizationId, roleId } as ActorContext;
    });
    invalidateCapabilityCache();

    // One stage, so the good pieces of one return are the lot's ready stock: 90 good of 100.
    const stageId = (await executeCommand(owner, defineStage, { stageKey: "finishing", label: "Finishing" })).id;
    const workerId = (await executeCommand(owner, defineWorker, { name: "Karigar R", rates: [{ stageId, rateMinor: 400, wageBasis: "good" as const, effectiveFrom: "2026-01-01" }] })).id;
    const lot = await executeCommand(owner, createLot, { design: "Oxford formal", plannedPieces: 100 });
    lotId = lot.id;
    await executeCommand(owner, setLotStatus, { lotId, to: "active" });
    const bundleId = (await executeCommand(owner, createBundle, { lotId, netPieces: 100 })).id;
    const issue = await executeCommand(owner, recordIssue, { bundleId, stageId, workerId, pieces: 100 });
    await executeCommand(owner, recordReturn, { issueId: issue.id, good: 90, rejected: 5, rework: 3, short: 2 });
    lotNumber = (await withTenant(tenantId, (tx) => tx.pieceworkLot.findUniqueOrThrow({ where: { id: lotId }, select: { number: true } }))).number;
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

  const line = async (key: (l: { number: string | null; name: string }) => boolean) => (await executeQuery(owner, readyStock, {})).lines.find(key)!;

  it("derives what production made ready, and nothing leaves that is not in stock", async () => {
    expect(await line((l) => l.number === lotNumber)).toMatchObject({ made: 90, out: 0, adjusted: 0, balance: 90 });
    const out = await executeCommand(owner, recordReadyMove, { kind: "out", lotId, pieces: 40, reason: "Dispatched", party: "Mehta Garments", reference: "INV-12" });
    expect(out.balance).toBe(50);
    await expect(executeCommand(owner, recordReadyMove, { kind: "out", lotId, pieces: 51 })).rejects.toThrow(/only 50 pieces are in stock/);
    expect(await line((l) => l.number === lotNumber)).toMatchObject({ made: 90, out: 40, balance: 50 });
  });

  it("starts stock that existed before Verity from a named opening line, which can go out too", async () => {
    await expect(executeCommand(owner, recordReadyMove, { kind: "opening", lotId, label: "x", pieces: 5 })).rejects.toThrow(/belongs to no lot/);
    await expect(executeCommand(owner, recordReadyMove, { kind: "out", label: "Never entered", pieces: 1 })).rejects.toThrow(/no opening stock called/);
    const opened = await executeCommand(owner, recordReadyMove, { kind: "opening", label: "Oxford formal, white, M to XL", pieces: 200, note: "Counted on the shelf at launch" });
    expect(opened.balance).toBe(200);
    // The same label in another letter case is the same line.
    expect((await executeCommand(owner, recordReadyMove, { kind: "out", label: "oxford formal, white, m to xl", pieces: 150, reason: "Sold" })).balance).toBe(50);
    await expect(executeCommand(owner, recordReadyMove, { kind: "out", label: "Oxford formal, white, M to XL", pieces: 51 })).rejects.toThrow(/only 50 pieces/);
    expect(await line((l) => l.name === "Oxford formal, white, M to XL")).toMatchObject({ opening: 200, out: 150, balance: 50 });
  });

  it("corrects a count only with a reason, and shows both sides of the correction", async () => {
    await expect(executeCommand(owner, recordReadyMove, { kind: "adjust_in", lotId, pieces: 3 })).rejects.toThrow(/needs a reason/);
    await executeCommand(owner, recordReadyMove, { kind: "adjust_in", lotId, pieces: 3, reason: "Found three on the shelf at the count" });
    expect(await line((l) => l.number === lotNumber)).toMatchObject({ adjusted: 3, balance: 53 });
    await executeCommand(owner, recordReadyMove, { kind: "adjust_out", lotId, pieces: 2, reason: "Two torn in the godown" });
    expect(await line((l) => l.number === lotNumber)).toMatchObject({ adjusted: 1, balance: 51 });
  });

  it("reverses a movement with a reason, and refuses a reversal that would leave stock negative", async () => {
    const { moves } = await executeQuery(owner, readyStock, {});
    const dispatched = moves.find((m) => m.kind === "out" && m.party === "Mehta Garments")!;
    await executeCommand(owner, reverseReadyMove, { moveId: dispatched.id, reason: "Returned unopened" });
    expect(await line((l) => l.number === lotNumber)).toMatchObject({ out: 0, balance: 91 });
    await expect(executeCommand(owner, reverseReadyMove, { moveId: dispatched.id, reason: "again" })).rejects.toThrow(/already reversed/);
    // The opening 200 cannot be taken back while 150 of it has gone out.
    const opening = (await executeQuery(owner, readyStock, {})).moves.find((m) => m.kind === "opening")!;
    await expect(executeCommand(owner, reverseReadyMove, { moveId: opening.id, reason: "entered twice" })).rejects.toThrow(/cannot be reversed/);
    // The ledger keeps every row: the original, the reversal, and who made them.
    const again = (await executeQuery(owner, readyStock, {})).moves;
    expect(again.filter((m) => m.kind === "out" && m.party === "Mehta Garments")).toHaveLength(2);
    expect(again.find((m) => m.id === dispatched.id)).toMatchObject({ reversed: true, by: "Owner Ji" });
  });

  it("refuses a movement dated in the future", async () => {
    await expect(executeCommand(owner, recordReadyMove, { kind: "out", lotId, pieces: 1, movedOn: "2099-01-01" })).rejects.toThrow(/future/);
  });
});
