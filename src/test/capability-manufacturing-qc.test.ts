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
import {
  ENTITY_EVIDENCE,
  EVIDENCE_CAPABILITY,
  captureEvidence,
  registerEvidenceCapability,
} from "@/server/capabilities/evidence";
import {
  ENTITY_MANUFACTURING_OPERATION,
  ENTITY_MANUFACTURING_ORDER,
  ENTITY_MANUFACTURING_ROUTE,
  MANUFACTURING_CAPABILITY,
  createManufacturingOrder,
  registerManufacturingCapability,
  startManufacturingOrder,
} from "@/server/capabilities/manufacturing";
import {
  completeOperation,
  createRoute,
  operationChecklist,
  operationQueue,
  orderOperations,
  planOperations,
  recordCheckpoint,
  sendBack,
  startOperation,
} from "@/server/capabilities/manufacturing/stages";

/**
 * Task 118, Carxen's digital QC: a stage checklist snapshotted onto each order,
 * findings that are append-only, evidence that must belong to the operation it is
 * attached to, and a stage that cannot be approved (completed) until every
 * checkpoint currently passes.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;
if (!hasDatabase) {
  const message = "capability-manufacturing-qc.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const CHECKS = [
  { key: "seams", label: "Seams are straight", requireEvidence: true, requireRemarks: false },
  { key: "fit", label: "Fits the seat", requireEvidence: false, requireRemarks: false },
  { key: "label", label: "Label attached", requireEvidence: false, requireRemarks: true },
];

describeDb("capability: Manufacturing QC (Carxen checklist + evidence)", () => {
  const tenantId = randomUUID();
  const created = { users: [] as string[], parties: [] as string[] };

  let locationId: string;
  let manager: ActorContext;
  let fabricId: string;
  let coverId: string;
  let routeId: string;

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
      await tx.tenant.create({ data: { id: tenantId, name: "QC Test Factory", timeZone: "Asia/Kolkata" } });
      await activateCapability(tx, tenantId, LOCATION_CAPABILITY);
      await activateCapability(tx, tenantId, INVENTORY_CAPABILITY);
      await activateCapability(tx, tenantId, EVIDENCE_CAPABILITY);
      await activateCapability(tx, tenantId, MANUFACTURING_CAPABILITY);

      const organizationId = (await tx.organization.create({ data: { tenantId, name: "Factory" } })).id;
      locationId = (await tx.location.create({ data: { tenantId, organizationId, name: "Floor" } })).id;

      const role = await tx.role.create({ data: { tenantId, name: "Manager" }, select: { id: true } });
      const entities = [
        ENTITY_INVENTORY_ITEM, ENTITY_INVENTORY_STOCK, ENTITY_EVIDENCE, ENTITY_MANUFACTURING_ORDER,
        ENTITY_MANUFACTURING_ROUTE, ENTITY_MANUFACTURING_OPERATION,
      ];
      await tx.permission.createMany({
        data: entities.flatMap((entity) =>
          (["Read", "Create", "Edit", "ActionExecute"] as const).map((verb) => ({
            tenantId, roleId: role.id, verb, entity, scope: "Tenant" as const,
          })),
        ),
      });

      const identity = await provisionIdentity(tx, { organizationId, authUserId: randomUUID(), displayName: "QC Inspector" });
      created.users.push(identity.userId);
      created.parties.push(identity.partyId);
      await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId: role.id } });
      manager = { tenantId, userId: identity.userId, membershipId: identity.membershipId, organizationId, roleId: role.id };
    });
    invalidateCapabilityCache();

    fabricId = (await executeCommand(manager, createItem, { sku: "FAB", name: "Fabric", unitLabel: "cm" })).id;
    coverId = (await executeCommand(manager, createItem, { sku: "COVER", name: "Seat cover", unitLabel: "set" })).id;
    await executeCommand(manager, recordStockMovement, { itemId: fabricId, locationId, kind: "Receipt", qty: 5000, reference: "r" });

    routeId = (
      await executeCommand(manager, createRoute, {
        code: "QC-ROUTE",
        name: "Cut, QC, pack",
        stages: [
          { stageKey: "cutting", label: "Cutting" },
          { stageKey: "qc", label: "QC", checkpoints: CHECKS },
          { stageKey: "packing", label: "Packing" },
        ],
      })
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

  /** A running order planned on the QC route, with cutting done and QC in progress. Returns the QC operation id. */
  async function orderAtQc() {
    const order = await executeCommand(manager, createManufacturingOrder, {
      locationId, outputItemId: coverId, outputQty: 1, lines: [{ componentItemId: fabricId, qtyRequired: 5 }],
    });
    await executeCommand(manager, planOperations, { orderId: order.id, routeId });
    await executeCommand(manager, startManufacturingOrder, { orderId: order.id });
    const ops = await executeQuery(manager, orderOperations, { orderId: order.id });
    const cutting = ops.find((o) => o.stageKey === "cutting")!.id;
    await executeCommand(manager, startOperation, { operationId: cutting });
    await executeCommand(manager, completeOperation, { operationId: cutting });
    const qc = ops.find((o) => o.stageKey === "qc")!.id;
    await executeCommand(manager, startOperation, { operationId: qc });
    return { orderId: order.id, qc };
  }
  const photoFor = async (operationId: string) =>
    (
      await executeCommand(manager, captureEvidence, {
        entityKey: ENTITY_MANUFACTURING_OPERATION,
        entityId: operationId,
        kind: "Photo",
        uri: `https://photos.example/${randomUUID()}.jpg`,
        capturedAt: new Date().toISOString(),
      })
    ).id;
  const record = (operationId: string, checkpointKey: string, result: "pass" | "fail", extra: { remarks?: string; evidenceId?: string } = {}) =>
    executeCommand(manager, recordCheckpoint, { operationId, checkpointKey, result, ...extra });

  it("copies the stage's checklist onto the order, so editing the route later changes nothing on it", async () => {
    const { qc } = await orderAtQc();
    expect((await executeQuery(manager, operationChecklist, { operationId: qc })).map((c) => c.key)).toEqual(["seams", "fit", "label"]);

    await withTenant(tenantId, (tx) =>
      tx.manufacturingRouteStage.updateMany({ where: { routeId, stageKey: "qc" }, data: { checkpoints: [] } }),
    );
    expect((await executeQuery(manager, operationChecklist, { operationId: qc })).map((c) => c.key)).toEqual(["seams", "fit", "label"]);
    await withTenant(tenantId, (tx) =>
      tx.manufacturingRouteStage.updateMany({ where: { routeId, stageKey: "qc" }, data: { checkpoints: CHECKS } }),
    );
  });

  it("enforces what each checkpoint requires: evidence, remarks, and evidence that is about this operation", async () => {
    const { qc } = await orderAtQc();
    const other = await orderAtQc();

    await expect(record(qc, "nope", "pass")).rejects.toThrow(/not part of this stage/);
    await expect(record(qc, "seams", "pass")).rejects.toThrow(/needs a photo/);
    await expect(record(qc, "fit", "fail")).rejects.toThrow(/needs remarks when it fails/);
    await expect(record(qc, "label", "pass")).rejects.toThrow(/needs remarks/);
    await expect(record(qc, "fit", "fail", { remarks: "ab" })).rejects.toThrow(/needs remarks/);

    // A photo of a different operation cannot be used to make this one pass.
    const foreign = await photoFor(other.qc);
    await expect(record(qc, "seams", "pass", { evidenceId: foreign })).rejects.toThrow(/not captured for this operation/);

    const own = await photoFor(qc);
    await expect(record(qc, "seams", "pass", { evidenceId: own })).resolves.toBeTruthy();
  });

  it("records findings only while the stage is in progress", async () => {
    const order = await executeCommand(manager, createManufacturingOrder, {
      locationId, outputItemId: coverId, outputQty: 1, lines: [{ componentItemId: fabricId, qtyRequired: 1 }],
    });
    await executeCommand(manager, planOperations, { orderId: order.id, routeId });
    const qc = (await executeQuery(manager, orderOperations, { orderId: order.id })).find((o) => o.stageKey === "qc")!.id;
    await expect(record(qc, "fit", "pass")).rejects.toThrow(/in progress/);
  });

  it("will not approve a stage until every checkpoint currently passes, and treats re-inspection as a new fact", async () => {
    const { qc } = await orderAtQc();

    await expect(executeCommand(manager, completeOperation, { operationId: qc })).rejects.toThrow(/3 checkpoint\(s\) not yet recorded/);

    await record(qc, "seams", "pass", { evidenceId: await photoFor(qc) });
    await record(qc, "label", "pass", { remarks: "Label sewn at the right corner" });
    await record(qc, "fit", "fail", { remarks: "Bolster panel is 2 cm short" });

    await expect(executeCommand(manager, completeOperation, { operationId: qc })).rejects.toThrow(/Fits the seat failed inspection/);

    // Fixed and re-inspected: a NEW finding, the failed one stays as history.
    await record(qc, "fit", "pass", { remarks: "Re-cut and re-fitted" });
    const list = await executeQuery(manager, operationChecklist, { operationId: qc });
    const fit = list.find((c) => c.key === "fit")!;
    expect(fit.latest).toMatchObject({ result: "pass", remarks: "Re-cut and re-fitted" });
    expect(fit.attempts).toBe(2);

    await expect(executeCommand(manager, completeOperation, { operationId: qc })).resolves.toBeTruthy();
    const rows = await withTenant(tenantId, (tx) => tx.manufacturingCheckpointResult.findMany({ where: { operationId: qc, checkpointKey: "fit" }, orderBy: { recordedAt: "asc" } }));
    expect(rows.map((r) => r.result)).toEqual(["fail", "pass"]);
  });

  it("never lets the application edit or erase a finding", async () => {
    const { qc } = await orderAtQc();
    await record(qc, "fit", "fail", { remarks: "Wrinkles across the back" });
    const row = await withTenant(tenantId, (tx) => tx.manufacturingCheckpointResult.findFirstOrThrow({ where: { operationId: qc } }));

    await expect(
      withTenant(tenantId, (tx) => tx.manufacturingCheckpointResult.update({ where: { id: row.id }, data: { result: "pass" } })),
    ).rejects.toThrow();
    await expect(
      withTenant(tenantId, (tx) => tx.manufacturingCheckpointResult.delete({ where: { id: row.id } })),
    ).rejects.toThrow();
    expect((await withTenant(tenantId, (tx) => tx.manufacturingCheckpointResult.findUniqueOrThrow({ where: { id: row.id } }))).result).toBe("fail");
  });

  it("answers a failed inspection with a send-back, and the redone QC starts with a clean checklist", async () => {
    const { orderId, qc } = await orderAtQc();
    await record(qc, "fit", "fail", { remarks: "Bolster panel is 2 cm short" });

    await executeCommand(manager, sendBack, { operationId: qc, toStageKey: "cutting", reason: "Bolster panel short, recut" });
    const ops = await executeQuery(manager, orderOperations, { orderId });
    const redoneQc = ops.filter((o) => o.stageKey === "qc").at(-1)!;

    expect(redoneQc.id).not.toBe(qc);
    expect(redoneQc.checklist).toEqual({ total: 3, passed: 0, failed: 0 });
    // The original QC keeps the finding that caused the rework.
    expect(ops.find((o) => o.id === qc)!.checklist).toEqual({ total: 3, passed: 0, failed: 1 });
  });

  it("shows checklist progress on the floor's work list", async () => {
    const { orderId, qc } = await orderAtQc();
    await record(qc, "label", "pass", { remarks: "Label present and legible" });
    const row = (await executeQuery(manager, operationQueue, { stageKey: "qc" })).find((r) => r.orderId === orderId)!;
    expect(row.checklist).toEqual({ total: 3, passed: 1, failed: 0 });
  });

  it("keeps findings behind tenant isolation", async () => {
    const seen = await withTenant(randomUUID(), (tx) => tx.manufacturingCheckpointResult.count());
    expect(seen).toBe(0);
  });
});
