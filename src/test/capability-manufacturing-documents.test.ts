import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/platform/db";
import { assertRlsEnforceable, withTenant } from "@/server/platform/tenancy";
import { activateCapability, invalidateCapabilityCache } from "@/server/platform/capability";
import { clearCommands, clearHooks, executeCommand, type ActorContext } from "@/server/platform/command";
import { clearQueries } from "@/server/platform/query";
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
import { ENTITY_EVIDENCE, EVIDENCE_CAPABILITY, registerEvidenceCapability } from "@/server/capabilities/evidence";
import {
  ENTITY_MANUFACTURING_DISPATCH,
  ENTITY_MANUFACTURING_OPERATION,
  ENTITY_MANUFACTURING_ORDER,
  MANUFACTURING_CAPABILITY,
  completeManufacturingOrder,
  createManufacturingOrder,
  registerManufacturingCapability,
  startManufacturingOrder,
} from "@/server/capabilities/manufacturing";
import { completeOperation, planOperations, recordCheckpoint, startOperation } from "@/server/capabilities/manufacturing/stages";
import { confirmDelivery, dispatchOrder } from "@/server/capabilities/manufacturing/logistics";
import { loadDispatchPack, loadTraveler, readingText } from "@/server/capabilities/manufacturing/documents";

/**
 * The data behind the printed job card and traveler and the dispatch pack (demo items 2 and 4), proven against
 * the real database: what each grant may see, that a finding's latest verdict wins, that an undispatched order has
 * no pack, and that another tenant's order is simply not there.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;
if (!hasDatabase) {
  const message = "capability-manufacturing-documents.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describe("readingText", () => {
  it("shows the reading and instrument as text, and nothing for anything else", () => {
    expect(readingText({ reading: "2,400 MΩ", instrument: "5 kV megger" })).toBe("2,400 MΩ (5 kV megger)");
    expect(readingText({ instrument: "gaussmeter" })).toBe("(gaussmeter)");
    expect(readingText({})).toBeNull();
    expect(readingText(null)).toBeNull();
    expect(readingText("2,400")).toBeNull();
    expect(readingText({ reading: 5 })).toBeNull();
  });
});

describeDb("manufacturing documents: traveler and dispatch pack data", () => {
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const created = { users: [] as string[], parties: [] as string[] };

  let manager: ActorContext;
  let orderId: string;
  let undispatchedId: string;
  const roles = {} as Record<"orderOnly" | "noEvidence" | "noDispatch" | "nothing", string>;
  let otherRoleId: string;

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

    let locationId = "";
    await withTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: "Documents Test Works", timeZone: "Asia/Kolkata", customFields: { demo: true } } });
      for (const cap of [LOCATION_CAPABILITY, INVENTORY_CAPABILITY, EVIDENCE_CAPABILITY, MANUFACTURING_CAPABILITY]) {
        await activateCapability(tx, tenantId, cap);
      }
      const organizationId = (await tx.organization.create({ data: { tenantId, name: "Factory" } })).id;
      locationId = (await tx.location.create({ data: { tenantId, organizationId, name: "Floor" } })).id;

      const grant = async (name: string, entities: string[], verbs: readonly string[]) => {
        const role = await tx.role.create({ data: { tenantId, name }, select: { id: true } });
        await tx.permission.createMany({
          data: entities.flatMap((entity) => verbs.map((verb) => ({ tenantId, roleId: role.id, verb: verb as "Read", entity, scope: "Tenant" as const }))),
        });
        return role.id;
      };
      const everything = [ENTITY_INVENTORY_ITEM, ENTITY_INVENTORY_STOCK, ENTITY_EVIDENCE, ENTITY_MANUFACTURING_ORDER, ENTITY_MANUFACTURING_OPERATION, ENTITY_MANUFACTURING_DISPATCH];
      const managerRole = await grant("Manager", everything, ["Read", "Create", "Edit", "Delete", "ActionExecute"]);
      roles.orderOnly = await grant("Order only", [ENTITY_MANUFACTURING_ORDER], ["Read"]);
      roles.noEvidence = await grant("No evidence", [ENTITY_MANUFACTURING_ORDER, ENTITY_MANUFACTURING_OPERATION, ENTITY_MANUFACTURING_DISPATCH], ["Read"]);
      roles.noDispatch = await grant("No dispatch", [ENTITY_MANUFACTURING_ORDER, ENTITY_MANUFACTURING_OPERATION, ENTITY_EVIDENCE], ["Read"]);
      roles.nothing = (await tx.role.create({ data: { tenantId, name: "Nothing" }, select: { id: true } })).id;

      const identity = await provisionIdentity(tx, { organizationId, authUserId: randomUUID(), displayName: "Floor Manager" });
      created.users.push(identity.userId);
      created.parties.push(identity.partyId);
      await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId: managerRole } });
      manager = { tenantId, userId: identity.userId, membershipId: identity.membershipId, organizationId, roleId: managerRole };
    });
    await withTenant(otherTenantId, async (tx) => {
      await tx.tenant.create({ data: { id: otherTenantId, name: "Someone Else Works", timeZone: "Asia/Kolkata" } });
      const role = await tx.role.create({ data: { tenantId: otherTenantId, name: "Reader" }, select: { id: true } });
      await tx.permission.create({ data: { tenantId: otherTenantId, roleId: role.id, verb: "Read", entity: ENTITY_MANUFACTURING_ORDER, scope: "Tenant" } });
      otherRoleId = role.id;
    });
    invalidateCapabilityCache();

    const cover = (await executeCommand(manager, createItem, { sku: "UNIT", name: "Test transformer", unitLabel: "pc" })).id;
    const wire = (await executeCommand(manager, createItem, { sku: "WIRE", name: "Winding wire", unitLabel: "kg" })).id;
    await executeCommand(manager, recordStockMovement, { itemId: wire, locationId, kind: "Receipt", qty: 100, reference: "opening" });

    const draft = async (reference: string) =>
      (await executeCommand(manager, createManufacturingOrder, { locationId, outputItemId: cover, outputQty: 1, reference, lines: [{ componentItemId: wire, qtyRequired: 10 }] })).id;

    // An order that is planned but never dispatched.
    undispatchedId = await draft("PACK-NOT-SENT");
    await executeCommand(manager, planOperations, { orderId: undispatchedId, stages: [{ stageKey: "winding", label: "Winding" }] });

    // The full journey: two stages, one check needing evidence, one failing then passing again, then dispatch.
    orderId = await draft("PACK-SENT");
    await executeCommand(manager, planOperations, {
      orderId,
      stages: [
        { stageKey: "winding", label: "Winding" },
        {
          stageKey: "testing",
          label: "Testing",
          checkpoints: [
            { key: "ir", label: "Insulation resistance", requireEvidence: true, requireRemarks: false },
            { key: "temp", label: "Temperature rise", requireEvidence: false, requireRemarks: true },
          ],
        },
      ],
    });
    await executeCommand(manager, startManufacturingOrder, { orderId });
    const ops = await withTenant(tenantId, (tx) => tx.manufacturingOperation.findMany({ where: { orderId }, orderBy: { sequence: "asc" } }));
    await executeCommand(manager, startOperation, { operationId: ops[0]!.id });
    await executeCommand(manager, completeOperation, { operationId: ops[0]!.id });
    await executeCommand(manager, startOperation, { operationId: ops[1]!.id });
    const reading = await withTenant(tenantId, (tx) =>
      tx.evidence.create({
        data: {
          tenantId, entityKey: ENTITY_MANUFACTURING_OPERATION, entityId: ops[1]!.id, kind: "Reading",
          capturedAt: new Date(), capturedById: manager.userId, payload: { instrument: "5 kV megger", reading: "2,400 MΩ" },
        },
      }),
    );
    await executeCommand(manager, recordCheckpoint, { operationId: ops[1]!.id, checkpointKey: "ir", result: "pass", evidenceId: reading.id });
    await executeCommand(manager, recordCheckpoint, { operationId: ops[1]!.id, checkpointKey: "temp", result: "fail", remarks: "Over the limit on the first run" });
    await executeCommand(manager, recordCheckpoint, { operationId: ops[1]!.id, checkpointKey: "temp", result: "pass", remarks: "Within the limit after re-run" });
    await executeCommand(manager, completeOperation, { operationId: ops[1]!.id });
    await executeCommand(manager, completeManufacturingOrder, { orderId });
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
      await admin.$executeRaw`DELETE FROM tenant WHERE id IN (${tenantId}::uuid, ${otherTenantId}::uuid)`;
      for (const id of created.users) await admin.$executeRaw`DELETE FROM "user" WHERE id = ${id}::uuid`;
      for (const id of created.parties) await admin.$executeRaw`DELETE FROM party WHERE id = ${id}::uuid`;
    } finally {
      await admin.$disconnect();
    }
    await prisma.$disconnect();
  });

  const asTenant = <T>(fn: (tx: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<T>) => withTenant(tenantId, fn);

  it("the traveler lists the materials and every stage with the latest verdict of each check", async () => {
    const record = await asTenant((tx) => loadTraveler(tx, manager, orderId));
    if (record === "denied" || record === null) throw new Error("expected a traveler record");
    expect(record.tenant).toMatchObject({ name: "Documents Test Works", demo: true });
    expect(record.order).toMatchObject({ reference: "PACK-SENT", product: "Test transformer", quantity: 1, state: "completed" });
    expect(record.materials).toEqual([expect.objectContaining({ item: "Winding wire", qty: 10, unit: "kg" })]);
    expect(record.stages?.map((s) => s.label)).toEqual(["Winding", "Testing"]);
    // The temperature check failed first and passed on re-inspection: the sheet shows the verdict that stands.
    expect(record.stages?.[1]?.checks).toEqual([
      { key: "ir", label: "Insulation resistance", needsEvidence: true, verdict: "pass" },
      { key: "temp", label: "Temperature rise", needsEvidence: false, verdict: "pass" },
    ]);
  });

  it("a reader with only the order grant gets the sheet without stages; with no grant it is denied", async () => {
    const limited = await asTenant((tx) => loadTraveler(tx, { tenantId, roleId: roles.orderOnly }, orderId));
    expect(limited).toMatchObject({ order: { reference: "PACK-SENT" }, stages: null });
    expect(await asTenant((tx) => loadTraveler(tx, { tenantId, roleId: roles.nothing }, orderId))).toBe("denied");
  });

  it("an unknown order is null, and another tenant's order is not there for that tenant", async () => {
    expect(await asTenant((tx) => loadTraveler(tx, manager, randomUUID()))).toBeNull();
    // The other tenant's reader holds the order grant, so the only reason for null is that RLS hides this order.
    const fromOther = await withTenant(otherTenantId, (tx) => loadTraveler(tx, { tenantId: otherTenantId, roleId: otherRoleId }, orderId));
    expect(fromOther).toBeNull();
  });

  it("an order that has not been dispatched has no pack", async () => {
    expect(await asTenant((tx) => loadDispatchPack(tx, manager, undispatchedId))).toBe("undispatched");
  });

  it("after dispatch and delivery, the pack carries the transport, the delivery and the checks that stand", async () => {
    const photo = await asTenant((tx) =>
      tx.evidence.create({
        data: { tenantId, entityKey: ENTITY_MANUFACTURING_ORDER, entityId: orderId, kind: "Photo", uri: "demo://packing", capturedAt: new Date(), capturedById: manager.userId },
      }),
    );
    await executeCommand(manager, dispatchOrder, { orderId, transporter: "Test Transport", vehicleNo: "MP 09 XX 0001", packagingEvidenceId: photo.id });
    await executeCommand(manager, confirmDelivery, { orderId });

    const pack = await asTenant((tx) => loadDispatchPack(tx, manager, orderId));
    if (typeof pack === "string" || pack === null) throw new Error("expected a dispatch pack");
    expect(pack.sent).toMatchObject({ transporter: "Test Transport", vehicleNo: "MP 09 XX 0001", photoOnRecord: true });
    expect(pack.deliveredAt).toBeInstanceOf(Date);
    expect(pack.passport).toBeNull(); // none published: the pack never invents one
    expect(pack.checks?.map((c) => [c.label, c.verdict, c.reading])).toEqual([
      ["Insulation resistance", "pass", "2,400 MΩ (5 kV megger)"],
      ["Temperature rise", "pass", null],
    ]);
    expect(pack.checks?.[1]?.remarks).toBe("Within the limit after re-run"); // the failing first run is history, not the verdict
  });

  it("a reader who cannot see Evidence still gets the verdicts but no reading; one without dispatch is denied", async () => {
    const noEvidence = await asTenant((tx) => loadDispatchPack(tx, { tenantId, roleId: roles.noEvidence }, orderId));
    if (typeof noEvidence === "string" || noEvidence === null) throw new Error("expected a dispatch pack");
    expect(noEvidence.checks?.map((c) => [c.verdict, c.reading])).toEqual([["pass", null], ["pass", null]]);
    expect(await asTenant((tx) => loadDispatchPack(tx, { tenantId, roleId: roles.noDispatch }, orderId))).toBe("denied");
  });
});
