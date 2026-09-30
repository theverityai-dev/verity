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
  ENTITY_INVENTORY_ITEM,
  ENTITY_INVENTORY_STOCK,
  INVENTORY_CAPABILITY,
  createItem,
  recordStockMovement,
  registerInventoryCapability,
} from "@/server/capabilities/inventory";
import { LOCATION_CAPABILITY, registerLocationCapability } from "@/server/capabilities/location";
import { ENTITY_EVIDENCE, EVIDENCE_CAPABILITY, captureEvidence, registerEvidenceCapability } from "@/server/capabilities/evidence";
import {
  ENTITY_MANUFACTURING_OPERATION,
  ENTITY_MANUFACTURING_ORDER,
  ENTITY_MANUFACTURING_PASSPORT,
  ENTITY_MANUFACTURING_ROUTE,
  MANUFACTURING_CAPABILITY,
  completeManufacturingOrder,
  createManufacturingOrder,
  registerManufacturingCapability,
  startManufacturingOrder,
} from "@/server/capabilities/manufacturing";
import {
  completeOperation,
  createRoute,
  orderOperations,
  planOperations,
  recordCheckpoint,
  startOperation,
} from "@/server/capabilities/manufacturing/stages";
import { issuePassport, orderPassport, revokePassport, hashPassportToken } from "@/server/capabilities/manufacturing/passport";
import { loadPassport } from "@/server/capabilities/manufacturing/passport-public";

/**
 * ADR-030, proven end to end: a passport is published on purpose, for a
 * completed and fully-inspected order only; the public side reads one frozen,
 * minimal snapshot through a single definer function and nothing else.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;
if (!hasDatabase) {
  const message = "capability-manufacturing-passport.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const CHECKS = [
  { key: "seams", label: "Seams are straight", requireEvidence: true, requireRemarks: false },
  { key: "label", label: "Label attached", requireEvidence: false, requireRemarks: true },
];
const SECRET_REMARK = "INTERNAL-ONLY remark about the operator";
const PHOTO = "https://internal.example/private-photo.jpg";

describeDb("capability: Manufacturing passport (ADR-030)", () => {
  const tenantId = randomUUID();
  const created = { users: [] as string[], parties: [] as string[] };

  let locationId: string;
  let manager: ActorContext;
  let fabricId: string;
  let coverId: string;
  let inspectedRouteId: string;
  let plainRouteId: string;

  beforeAll(async () => {
    await assertRlsEnforceable();
    clearCommands();
    clearQueries();
    clearHooks();
    clearScopeResolvers();
    clearTransitionGuards();
    clearContributions();
    registerLocationCapability();
    registerInventoryCapability();
    registerEvidenceCapability();
    registerManufacturingCapability();

    await withTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: "Carxen Test Lifestyles", timeZone: "Asia/Kolkata" } });
      for (const cap of [LOCATION_CAPABILITY, INVENTORY_CAPABILITY, EVIDENCE_CAPABILITY, MANUFACTURING_CAPABILITY]) {
        await activateCapability(tx, tenantId, cap);
      }
      const organizationId = (await tx.organization.create({ data: { tenantId, name: "Factory" } })).id;
      locationId = (await tx.location.create({ data: { tenantId, organizationId, name: "Floor" } })).id;

      const role = await tx.role.create({ data: { tenantId, name: "Manager" }, select: { id: true } });
      const entities = [
        ENTITY_INVENTORY_ITEM, ENTITY_INVENTORY_STOCK, ENTITY_EVIDENCE, ENTITY_MANUFACTURING_ORDER,
        ENTITY_MANUFACTURING_ROUTE, ENTITY_MANUFACTURING_OPERATION, ENTITY_MANUFACTURING_PASSPORT,
      ];
      await tx.permission.createMany({
        data: entities.flatMap((entity) =>
          (["Read", "Create", "Edit", "ActionExecute"] as const).map((verb) => ({
            tenantId, roleId: role.id, verb, entity, scope: "Tenant" as const,
          })),
        ),
      });

      const identity = await provisionIdentity(tx, { organizationId, authUserId: randomUUID(), displayName: "Floor Manager" });
      created.users.push(identity.userId);
      created.parties.push(identity.partyId);
      await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId: role.id } });
      manager = { tenantId, userId: identity.userId, membershipId: identity.membershipId, organizationId, roleId: role.id };
    });
    invalidateCapabilityCache();

    fabricId = (await executeCommand(manager, createItem, { sku: "FAB", name: "Fabric", unitLabel: "cm" })).id;
    coverId = (await executeCommand(manager, createItem, { sku: "COVER", name: "Innova front seat cover", unitLabel: "set" })).id;
    await executeCommand(manager, recordStockMovement, { itemId: fabricId, locationId, kind: "Receipt", qty: 5000, reference: "r" });

    inspectedRouteId = (
      await executeCommand(manager, createRoute, {
        code: "INSPECTED", name: "Cut, QC",
        stages: [{ stageKey: "cutting", label: "Cutting" }, { stageKey: "qc", label: "Quality check", checkpoints: CHECKS }],
      })
    ).id;
    plainRouteId = (
      await executeCommand(manager, createRoute, { code: "PLAIN", name: "Cut only", stages: [{ stageKey: "cutting", label: "Cutting" }] })
    ).id;
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
      await admin.$executeRaw`DELETE FROM tenant WHERE id = ${tenantId}::uuid`;
      for (const id of created.users) await admin.$executeRaw`DELETE FROM "user" WHERE id = ${id}::uuid`;
      for (const id of created.parties) await admin.$executeRaw`DELETE FROM party WHERE id = ${id}::uuid`;
    } finally {
      await admin.$disconnect();
    }
    await prisma.$disconnect();
  });

  /** A finished order. `inspected` runs the QC route with every checkpoint passing; otherwise a route with no checklist. */
  async function finishedOrder(inspected: boolean) {
    const order = await executeCommand(manager, createManufacturingOrder, {
      locationId, outputItemId: coverId, outputQty: 1, lines: [{ componentItemId: fabricId, qtyRequired: 5 }],
    });
    await executeCommand(manager, planOperations, { orderId: order.id, routeId: inspected ? inspectedRouteId : plainRouteId });
    await executeCommand(manager, startManufacturingOrder, { orderId: order.id });
    const ops = await executeQuery(manager, orderOperations, { orderId: order.id });

    for (const op of ops) {
      await executeCommand(manager, startOperation, { operationId: op.id });
      if (op.stageKey === "qc") {
        const photo = (
          await executeCommand(manager, captureEvidence, {
            entityKey: ENTITY_MANUFACTURING_OPERATION, entityId: op.id, kind: "Photo", uri: PHOTO, capturedAt: new Date().toISOString(),
          })
        ).id;
        await executeCommand(manager, recordCheckpoint, { operationId: op.id, checkpointKey: "seams", result: "pass", evidenceId: photo });
        await executeCommand(manager, recordCheckpoint, { operationId: op.id, checkpointKey: "label", result: "pass", remarks: SECRET_REMARK });
      }
      await executeCommand(manager, completeOperation, { operationId: op.id });
    }
    await executeCommand(manager, completeManufacturingOrder, { orderId: order.id });
    return order.id;
  }

  it("publishes only a completed order that was actually inspected", async () => {
    const draft = await executeCommand(manager, createManufacturingOrder, {
      locationId, outputItemId: coverId, outputQty: 1, lines: [{ componentItemId: fabricId, qtyRequired: 1 }],
    });
    await expect(executeCommand(manager, issuePassport, { orderId: draft.id })).rejects.toThrow(/only a completed order/);

    const uninspected = await finishedOrder(false);
    await expect(executeCommand(manager, issuePassport, { orderId: uninspected })).rejects.toThrow(/nothing to verify/);
  });

  it("keeps only a hash, and publishes a minimal snapshot with nothing private in it", async () => {
    const orderId = await finishedOrder(true);
    const issued = await executeCommand(manager, issuePassport, { orderId, reference: "CARXEN-0042" });

    expect(issued.token).toMatch(/^vpp_[A-Za-z0-9_-]{43}$/);
    const row = await withTenant(tenantId, (tx) => tx.manufacturingPassport.findUniqueOrThrow({ where: { id: issued.id } }));
    expect(row.tokenHash).toBe(hashPassportToken(issued.token));
    expect(JSON.stringify(row)).not.toContain(issued.token.slice(4));

    const shown = JSON.stringify(row.snapshot);
    expect(row.snapshot).toMatchObject({
      tenant: "Carxen Test Lifestyles",
      product: "Innova front seat cover",
      reference: "CARXEN-0042",
      stages: [{ label: "Quality check", checks: [{ label: "Seams are straight" }, { label: "Label attached" }] }],
    });
    // Nothing the ADR says must stay private is reachable from the public projection.
    for (const secret of [SECRET_REMARK, PHOTO, manager.userId, manager.tenantId, orderId, "Floor Manager", "Fabric"]) {
      expect(shown, secret).not.toContain(secret);
    }

    // The security stream records THAT it was published, never the token.
    const events = await withTenant(tenantId, (tx) => tx.securityAuditEvent.findMany({ where: { eventType: "ConfigurationChanged" } }));
    expect(events.some((e) => JSON.stringify(e.payload).includes("passport_issued"))).toBe(true);
    expect(events.every((e) => !JSON.stringify(e.payload).includes(issued.token))).toBe(true);
  });

  it("serves the snapshot publicly, and answers a wrong, malformed and revoked link identically", async () => {
    const orderId = await finishedOrder(true);
    const { id, token } = await executeCommand(manager, issuePassport, { orderId });

    const live = await loadPassport(token);
    expect(live?.product).toBe("Innova front seat cover");

    const wrong = `vpp_${"A".repeat(43)}`;
    expect(await loadPassport(wrong)).toBeNull();
    expect(await loadPassport("nonsense")).toBeNull();
    expect(await loadPassport("")).toBeNull();
    expect(await loadPassport(token.slice(0, -1))).toBeNull();

    await executeCommand(manager, revokePassport, { passportId: id });
    expect(await loadPassport(token)).toBeNull(); // revoked looks exactly like never existed
    await expect(executeCommand(manager, revokePassport, { passportId: id })).resolves.toBeTruthy(); // idempotent
  });

  it("allows one active passport per order, and a recall is a revocation plus a new issue", async () => {
    const orderId = await finishedOrder(true);
    const first = await executeCommand(manager, issuePassport, { orderId });
    await expect(executeCommand(manager, issuePassport, { orderId })).rejects.toThrow(/already has an active passport/);

    expect((await executeQuery(manager, orderPassport, { orderId })).active?.id).toBe(first.id);

    await executeCommand(manager, revokePassport, { passportId: first.id });
    const second = await executeCommand(manager, issuePassport, { orderId });
    expect(second.token).not.toBe(first.token);
    expect(await loadPassport(first.token)).toBeNull();
    expect(await loadPassport(second.token)).not.toBeNull();
    expect(await executeQuery(manager, orderPassport, { orderId })).toMatchObject({ active: { id: second.id }, revoked: 1 });
  });

  it("freezes what was published: later changes to live data do not alter a printed code", async () => {
    const orderId = await finishedOrder(true);
    const { token } = await executeCommand(manager, issuePassport, { orderId });

    await withTenant(tenantId, async (tx) => {
      await tx.inventoryItem.update({ where: { id: coverId }, data: { name: "Renamed product" } });
      await tx.manufacturingOperation.updateMany({ where: { orderId, stageKey: "qc" }, data: { label: "Renamed stage" } });
    });

    const still = await loadPassport(token);
    expect(still?.product).toBe("Innova front seat cover");
    expect(still?.stages[0]?.label).toBe("Quality check");
    await withTenant(tenantId, (tx) => tx.inventoryItem.update({ where: { id: coverId }, data: { name: "Innova front seat cover" } }));
  });

  // Runs only against a live server (set VERIFY_BASE_URL): this is what a stranger scanning the code sees.
  it.runIf(Boolean(process.env.VERIFY_BASE_URL))("serves the real page to an anonymous visitor, and a revoked link looks like any wrong one", async () => {
    const base = process.env.VERIFY_BASE_URL!;
    const orderId = await finishedOrder(true);
    const { id, token } = await executeCommand(manager, issuePassport, { orderId, reference: "CARXEN-LIVE" });

    const ok = await fetch(`${base}/verify/${token}`, { redirect: "manual" });
    const html = await ok.text();
    expect(ok.status).toBe(200); // not a redirect to sign-in: no session is needed
    expect(html).toContain("Innova front seat cover");
    expect(html).toContain("Carxen Test Lifestyles");
    expect(html).toContain("Passed inspection");
    expect(html).toContain("Seams are straight");
    expect(html).toMatch(/noindex/i);
    expect(ok.headers.get("cache-control") ?? "").toMatch(/no-store|no-cache|private/);
    for (const secret of [SECRET_REMARK, PHOTO, manager.userId, orderId, "Floor Manager"]) expect(html, secret).not.toContain(secret);

    await executeCommand(manager, revokePassport, { passportId: id });
    const revoked = await fetch(`${base}/verify/${token}`, { redirect: "manual" });
    const wrong = await fetch(`${base}/verify/vpp_${"B".repeat(43)}`, { redirect: "manual" });
    expect(revoked.status).toBe(404);
    expect(wrong.status).toBe(404);
  });

  it("gives the public path no way to read the table: only the one function answers", async () => {
    // The unauthenticated route has no tenant context. Under row-level security the
    // table is invisible to it; the snapshot is reachable solely through the function.
    const direct = await prisma.$queryRaw<Array<{ c: number }>>`SELECT count(*)::int AS c FROM manufacturing_passport`;
    expect(direct[0]!.c).toBe(0);

    const other = await withTenant(randomUUID(), (tx) => tx.manufacturingPassport.count());
    expect(other).toBe(0);
  });
});
