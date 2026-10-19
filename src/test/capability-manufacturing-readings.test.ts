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
  ENTITY_MANUFACTURING_ROUTE,
  MANUFACTURING_CAPABILITY,
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
import { loadTestReport } from "@/server/capabilities/manufacturing/documents";

/**
 * A measured check carries its own unit and accepted range. The reading is Evidence with a numeric value; the
 * unit cannot differ from the check's, and a value outside the range cannot be recorded as a pass. The test
 * report is read from the same findings and hides readings from a reader who may not see Evidence.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;
if (!hasDatabase) {
  const message = "capability-manufacturing-readings.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const CHECKS = [
  { key: "ir", label: "Insulation resistance", requireEvidence: false, requireRemarks: false, measure: { unit: "MΩ", min: 1000, max: 5000 } },
  { key: "temp", label: "Temperature rise", requireEvidence: false, requireRemarks: false, measure: { unit: "°C", max: 75 } },
  { key: "set", label: "Set-up photographed", requireEvidence: true, requireRemarks: false, measure: { unit: "kV" } },
  { key: "visual", label: "Visual finish", requireEvidence: false, requireRemarks: false },
];

describeDb("capability: Manufacturing measured checks and the test report", () => {
  const tenantId = randomUUID();
  const created = { users: [] as string[], parties: [] as string[] };

  let locationId: string;
  let manager: ActorContext;
  let viewerRoleId: string;
  let partId: string;
  let wireId: string;
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
      await tx.tenant.create({ data: { id: tenantId, name: "Readings Test Works", timeZone: "Asia/Kolkata" } });
      await activateCapability(tx, tenantId, LOCATION_CAPABILITY);
      await activateCapability(tx, tenantId, INVENTORY_CAPABILITY);
      await activateCapability(tx, tenantId, EVIDENCE_CAPABILITY);
      await activateCapability(tx, tenantId, MANUFACTURING_CAPABILITY);

      const organizationId = (await tx.organization.create({ data: { tenantId, name: "Works" } })).id;
      locationId = (await tx.location.create({ data: { tenantId, organizationId, name: "Test bay" } })).id;

      const role = await tx.role.create({ data: { tenantId, name: "Manager" }, select: { id: true } });
      const entities = [
        ENTITY_INVENTORY_ITEM, ENTITY_INVENTORY_STOCK, ENTITY_EVIDENCE, ENTITY_MANUFACTURING_ORDER,
        ENTITY_MANUFACTURING_ROUTE, ENTITY_MANUFACTURING_OPERATION,
      ];
      await tx.permission.createMany({
        data: entities.flatMap((entity) =>
          (["Read", "Create", "Edit", "ActionExecute"] as const).map((verb) => ({ tenantId, roleId: role.id, verb, entity, scope: "Tenant" as const })),
        ),
      });
      // A reader who can see orders and stages but not Evidence: verdicts and units show, readings do not.
      const viewer = await tx.role.create({ data: { tenantId, name: "Viewer" }, select: { id: true } });
      viewerRoleId = viewer.id;
      await tx.permission.createMany({
        data: [ENTITY_MANUFACTURING_ORDER, ENTITY_MANUFACTURING_OPERATION].map((entity) => ({
          tenantId, roleId: viewer.id, verb: "Read" as const, entity, scope: "Tenant" as const,
        })),
      });

      const identity = await provisionIdentity(tx, { organizationId, authUserId: randomUUID(), displayName: "Test Inspector" });
      created.users.push(identity.userId);
      created.parties.push(identity.partyId);
      await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId: role.id } });
      manager = { tenantId, userId: identity.userId, membershipId: identity.membershipId, organizationId, roleId: role.id };
    });
    invalidateCapabilityCache();

    wireId = (await executeCommand(manager, createItem, { sku: "WIRE", name: "Copper wire", unitLabel: "kg" })).id;
    partId = (await executeCommand(manager, createItem, { sku: "XFMR", name: "Transformer", unitLabel: "no" })).id;
    await executeCommand(manager, recordStockMovement, { itemId: wireId, locationId, kind: "Receipt", qty: 500, reference: "r" });
    routeId = (
      await executeCommand(manager, createRoute, {
        code: "READ-ROUTE",
        name: "Wind and test",
        stages: [
          { stageKey: "winding", label: "Winding" },
          { stageKey: "testing", label: "Testing", checkpoints: CHECKS },
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

  async function orderAtTesting() {
    const order = await executeCommand(manager, createManufacturingOrder, {
      locationId, outputItemId: partId, outputQty: 1, lines: [{ componentItemId: wireId, qtyRequired: 5 }],
    });
    await executeCommand(manager, planOperations, { orderId: order.id, routeId });
    await executeCommand(manager, startManufacturingOrder, { orderId: order.id });
    const ops = await executeQuery(manager, orderOperations, { orderId: order.id });
    const winding = ops.find((o) => o.stageKey === "winding")!.id;
    await executeCommand(manager, startOperation, { operationId: winding });
    await executeCommand(manager, completeOperation, { operationId: winding });
    const testing = ops.find((o) => o.stageKey === "testing")!.id;
    await executeCommand(manager, startOperation, { operationId: testing });
    return { orderId: order.id, testing };
  }

  const reading = async (operationId: string, payload: Record<string, unknown>) =>
    (
      await executeCommand(manager, captureEvidence, {
        entityKey: ENTITY_MANUFACTURING_OPERATION, entityId: operationId, kind: "Reading", capturedAt: new Date().toISOString(), payload,
      })
    ).id;
  const photo = async (operationId: string) =>
    (
      await executeCommand(manager, captureEvidence, {
        entityKey: ENTITY_MANUFACTURING_OPERATION, entityId: operationId, kind: "Photo", uri: `https://photos.example/${randomUUID()}.jpg`, capturedAt: new Date().toISOString(),
      })
    ).id;
  const record = (operationId: string, checkpointKey: string, result: "pass" | "fail", extra: { remarks?: string; evidenceId?: string } = {}) =>
    executeCommand(manager, recordCheckpoint, { operationId, checkpointKey, result, ...extra });

  it("needs a numeric reading for a measured check, in the check's own unit", async () => {
    const { testing } = await orderAtTesting();
    await expect(record(testing, "ir", "pass")).rejects.toThrow(/needs a recorded reading/);
    await expect(record(testing, "ir", "pass", { evidenceId: await photo(testing) })).rejects.toThrow(/needs a numeric reading/);
    await expect(record(testing, "ir", "pass", { evidenceId: await reading(testing, { value: 2400, unit: "kΩ" }) })).rejects.toThrow(/measured in MΩ, not kΩ/);
    await expect(record(testing, "ir", "pass", { evidenceId: await reading(testing, { value: 2400, unit: "MΩ" }) })).resolves.toBeTruthy();
  });

  it("will not record a value outside the accepted range as a pass, but records it as a fail", async () => {
    const { testing } = await orderAtTesting();
    const low = await reading(testing, { value: 400, unit: "MΩ", condition: "before casting" });
    await expect(record(testing, "ir", "pass", { evidenceId: low })).rejects.toThrow(/outside the accepted range/);
    await expect(record(testing, "ir", "fail", { evidenceId: low, remarks: "Moisture in winding" })).resolves.toBeTruthy();

    // A one-sided limit: at most 75 °C.
    const hot = await reading(testing, { value: 80, unit: "°C" });
    await expect(record(testing, "temp", "pass", { evidenceId: hot })).rejects.toThrow(/outside the accepted range/);
    await expect(record(testing, "temp", "pass", { evidenceId: await reading(testing, { value: 62, unit: "°C" }) })).resolves.toBeTruthy();
  });

  it("asks for a photo of the set-up inside the reading when the measured check requires evidence", async () => {
    const { testing } = await orderAtTesting();
    await expect(record(testing, "set", "pass", { evidenceId: await reading(testing, { value: 28, unit: "kV" }) })).rejects.toThrow(/needs a photo of the instrument/);
    const withPhoto = await reading(testing, { value: 28, unit: "kV", photoEvidenceId: await photo(testing) });
    await expect(record(testing, "set", "pass", { evidenceId: withPhoto })).resolves.toBeTruthy();
  });

  it("reports the summary, readings against their range, conditions and re-inspections", async () => {
    const { orderId, testing } = await orderAtTesting();
    await record(testing, "ir", "fail", { evidenceId: await reading(testing, { value: 400, unit: "MΩ", condition: "before casting" }), remarks: "Moisture in winding" });
    await record(testing, "ir", "pass", { evidenceId: await reading(testing, { value: 2400, unit: "MΩ", condition: "after drying", instrument: "5 kV megger" }) });
    await record(testing, "visual", "pass");

    const report = await withTenant(tenantId, (tx) => loadTestReport(tx, manager, orderId));
    if (typeof report === "string" || report === null) throw new Error("expected a report");
    const stage = report.stages.find((s) => s.label === "Testing")!;
    const ir = stage.checks.find((c) => c.key === "ir")!;
    expect(ir.verdict).toBe("pass");
    expect(ir.attempts).toBe(2);
    expect(ir.measured).toMatchObject({ value: 2400, unit: "MΩ", min: 1000, max: 5000, inRange: true, condition: "after drying", instrument: "5 kV megger" });
    expect(stage.checks.find((c) => c.key === "temp")!.verdict).toBeNull();
    expect(stage.checks.find((c) => c.key === "visual")!.measured).toBeNull();
    // The stage with no checklist is not in the report.
    expect(report.stages.map((s) => s.label)).toEqual(["Testing"]);
  });

  it("shows verdicts and units but not readings to a reader without Evidence access, and refuses a reader without stage access", async () => {
    const { orderId, testing } = await orderAtTesting();
    await record(testing, "ir", "pass", { evidenceId: await reading(testing, { value: 2400, unit: "MΩ" }) });

    const viewer = { tenantId, roleId: viewerRoleId };
    const report = await withTenant(tenantId, (tx) => loadTestReport(tx, viewer, orderId));
    if (typeof report === "string" || report === null) throw new Error("expected a report");
    const ir = report.stages[0]!.checks.find((c) => c.key === "ir")!;
    expect(ir.verdict).toBe("pass");
    expect(ir.unit).toBe("MΩ");
    expect(ir.measured).toBeNull();

    expect(await withTenant(tenantId, (tx) => loadTestReport(tx, { tenantId, roleId: null }, orderId))).toBe("denied");
  });
});
