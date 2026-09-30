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
  stockOnHand,
} from "@/server/capabilities/inventory";
import { LOCATION_CAPABILITY, registerLocationCapability } from "@/server/capabilities/location";
import {
  ENTITY_MANUFACTURING_BOM,
  ENTITY_MANUFACTURING_ORDER,
  MANUFACTURING_CAPABILITY,
  completeManufacturingOrder,
  manufacturingOrderDetail,
  registerManufacturingCapability,
  startManufacturingOrder,
} from "@/server/capabilities/manufacturing";
import { bomDetail, createBom, createOrderFromBom, listBoms, setBomActive } from "@/server/capabilities/manufacturing/bom";

/**
 * Task 118, design partner Carxen: a reusable per-unit BOM for a made-to-order
 * seat cover, orders scaled from it, and the snapshot rule (a BOM changing never
 * rewrites an order already made). Vehicle attributes are custom fields.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;
if (!hasDatabase) {
  const message = "capability-manufacturing-bom.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describeDb("capability: Manufacturing BOM (Carxen seat covers)", () => {
  const tenantId = randomUUID();
  const created = { users: [] as string[], parties: [] as string[] };

  let locationId: string;
  let manager: ActorContext;
  let fabricId: string;
  let foamId: string;
  let threadId: string;
  let coverId: string;
  let bomId: string;

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
    registerManufacturingCapability();

    await withTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: "Seat Cover Test Shop", timeZone: "Asia/Kolkata" } });
      await activateCapability(tx, tenantId, LOCATION_CAPABILITY);
      await activateCapability(tx, tenantId, INVENTORY_CAPABILITY);
      await activateCapability(tx, tenantId, MANUFACTURING_CAPABILITY);

      const organizationId = (await tx.organization.create({ data: { tenantId, name: "Factory" } })).id;
      locationId = (await tx.location.create({ data: { tenantId, organizationId, name: "Stitching floor" } })).id;

      // The tenant, not the platform, declares what varies between its vehicles.
      await tx.customFieldSchema.createMany({
        data: [
          { tenantId, entityKey: ENTITY_MANUFACTURING_BOM, fieldName: "vehicle_make", fieldType: "String", required: true },
          { tenantId, entityKey: ENTITY_MANUFACTURING_BOM, fieldName: "model_year", fieldType: "Number", required: false },
          {
            tenantId, entityKey: ENTITY_MANUFACTURING_BOM, fieldName: "seat_row", fieldType: "Select",
            required: false, selectOptions: ["front", "middle", "rear"],
          },
        ],
      });

      const role = await tx.role.create({ data: { tenantId, name: "Manager" }, select: { id: true } });
      const entities = [ENTITY_INVENTORY_ITEM, ENTITY_INVENTORY_STOCK, ENTITY_MANUFACTURING_ORDER, ENTITY_MANUFACTURING_BOM];
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

    fabricId = (await executeCommand(manager, createItem, { sku: "FAB-LEATHERETTE", name: "Leatherette (cm)", unitLabel: "cm" })).id;
    foamId = (await executeCommand(manager, createItem, { sku: "FOAM-10", name: "Foam 10mm (cm)", unitLabel: "cm" })).id;
    threadId = (await executeCommand(manager, createItem, { sku: "THREAD", name: "Thread spool", unitLabel: "pcs" })).id;
    coverId = (await executeCommand(manager, createItem, { sku: "COVER-INNOVA-F", name: "Innova front seat cover", unitLabel: "set" })).id;

    for (const [itemId, qty] of [[fabricId, 5000], [foamId, 3000], [threadId, 50]] as const) {
      await executeCommand(manager, recordStockMovement, { itemId, locationId, kind: "Receipt", qty, reference: "test-receipt" });
    }
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

  const lines = () => [
    { componentItemId: fabricId, qtyPerUnit: 120 },
    { componentItemId: foamId, qtyPerUnit: 60 },
    { componentItemId: threadId, qtyPerUnit: 1 },
  ];

  it("creates a BOM whose vehicle attributes are validated custom fields", async () => {
    bomId = (
      await executeCommand(manager, createBom, {
        code: "INNOVA-2020-F",
        name: "Innova 2020 front seat cover",
        outputItemId: coverId,
        lines: lines(),
        customFields: { vehicle_make: "Toyota", model_year: 2020, seat_row: "front" },
      })
    ).id;

    const detail = await executeQuery(manager, bomDetail, { bomId });
    expect(detail.customFields).toMatchObject({ vehicle_make: "Toyota", model_year: 2020, seat_row: "front" });
    expect(detail.lines).toHaveLength(3);
    expect((await executeQuery(manager, listBoms, {})).map((b) => b.code)).toContain("INNOVA-2020-F");
  });

  it("rejects custom fields the tenant did not declare or that break their type", async () => {
    const base = { code: "BAD-CF", name: "x", outputItemId: coverId, lines: lines() };
    await expect(executeCommand(manager, createBom, { ...base, customFields: { vehicle_make: "Toyota", colour: "red" } })).rejects.toThrow();
    await expect(executeCommand(manager, createBom, { ...base, customFields: { vehicle_make: "Toyota", seat_row: "roof" } })).rejects.toThrow();
    await expect(executeCommand(manager, createBom, { ...base, customFields: { model_year: 2020 } })).rejects.toThrow();
  });

  it("rejects a duplicate code, a duplicate component, and a component equal to the output", async () => {
    const cf = { vehicle_make: "Toyota" };
    await expect(
      executeCommand(manager, createBom, { code: "INNOVA-2020-F", name: "dup", outputItemId: coverId, lines: lines(), customFields: cf }),
    ).rejects.toThrow(/already exists/);
    await expect(
      executeCommand(manager, createBom, {
        code: "DUP-COMP", name: "x", outputItemId: coverId, customFields: cf,
        lines: [{ componentItemId: fabricId, qtyPerUnit: 1 }, { componentItemId: fabricId, qtyPerUnit: 2 }],
      }),
    ).rejects.toThrow(/more than once/);
    await expect(
      executeCommand(manager, createBom, {
        code: "SELF", name: "x", outputItemId: coverId, customFields: cf,
        lines: [{ componentItemId: coverId, qtyPerUnit: 1 }],
      }),
    ).rejects.toThrow(/same item it produces/);
  });

  it("makes an order from the BOM with every line scaled by the quantity, and remembers the BOM", async () => {
    const order = await executeCommand(manager, createOrderFromBom, { bomId, locationId, outputQty: 3, reference: "CARXEN-001" });
    const detail = await executeQuery(manager, manufacturingOrderDetail, { orderId: order.id });

    expect(detail.bomCode).toBe("INNOVA-2020-F");
    expect(detail.outputQty).toBe(3);
    const qty = Object.fromEntries(detail.lines.map((l) => [l.componentItemName, l.qtyRequired]));
    expect(qty).toEqual({ "Leatherette (cm)": 360, "Foam 10mm (cm)": 180, "Thread spool": 3 });
  });

  it("runs the scaled order for real: consumes the scaled stock and receives the output", async () => {
    const fabricBefore = (await executeQuery(manager, stockOnHand, { itemId: fabricId, locationId }))[0]?.qty ?? 0;
    const coverBefore = (await executeQuery(manager, stockOnHand, { itemId: coverId, locationId }))[0]?.qty ?? 0;

    const order = await executeCommand(manager, createOrderFromBom, { bomId, locationId, outputQty: 2 });
    await executeCommand(manager, startManufacturingOrder, { orderId: order.id });
    expect((await executeQuery(manager, stockOnHand, { itemId: fabricId, locationId }))[0]?.qty ?? 0).toBe(fabricBefore - 240);

    await executeCommand(manager, completeManufacturingOrder, { orderId: order.id });
    expect((await executeQuery(manager, stockOnHand, { itemId: coverId, locationId }))[0]?.qty ?? 0).toBe(coverBefore + 2);
  });

  it("refuses a quantity that would overflow a scaled line", async () => {
    await expect(executeCommand(manager, createOrderFromBom, { bomId, locationId, outputQty: 1_900_000_000 })).rejects.toThrow(/too large/);
  });

  it("archives rather than deletes: old orders are untouched, new ones are refused until restored", async () => {
    const before = await executeCommand(manager, createOrderFromBom, { bomId, locationId, outputQty: 1 });

    await executeCommand(manager, setBomActive, { bomId, active: false });
    await expect(executeCommand(manager, createOrderFromBom, { bomId, locationId, outputQty: 1 })).rejects.toThrow(/archived/);
    expect((await executeQuery(manager, listBoms, {})).map((b) => b.code)).not.toContain("INNOVA-2020-F");
    expect((await executeQuery(manager, listBoms, { includeInactive: true })).map((b) => b.code)).toContain("INNOVA-2020-F");

    const stillThere = await executeQuery(manager, manufacturingOrderDetail, { orderId: before.id });
    expect(stillThere.bomCode).toBe("INNOVA-2020-F");
    expect(stillThere.lines).toHaveLength(3);

    await executeCommand(manager, setBomActive, { bomId, active: true });
    await expect(executeCommand(manager, createOrderFromBom, { bomId, locationId, outputQty: 1 })).resolves.toBeTruthy();
  });

  it("keeps BOMs behind tenant isolation", async () => {
    const other = randomUUID();
    const seen = await withTenant(other, (tx) => tx.manufacturingBom.count());
    expect(seen).toBe(0);
  });
});
