import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/platform/db";
import { assertRlsEnforceable, withTenant } from "@/server/platform/tenancy";
import { activateCapability, invalidateCapabilityCache } from "@/server/platform/capability";
import { clearCommands, clearHooks, executeCommand, type ActorContext } from "@/server/platform/command";
import { clearQueries, executeQuery } from "@/server/platform/query";
import { ForbiddenError, clearScopeResolvers } from "@/server/platform/authorization";
import { clearTransitionGuards } from "@/server/platform/state";
import { clearContributions } from "@/server/platform/contribution";
import { provisionIdentity } from "@/server/platform/identity";
import {
  ENTITY_INVENTORY_ITEM,
  ENTITY_INVENTORY_STOCK,
  INVENTORY_CAPABILITY,
  applyStockCount,
  createItem,
  decideStockRequest,
  foodCostVariance,
  listStockRequests,
  recordStockMovement,
  requestStock,
  registerInventoryCapability,
  stockLedger,
  stockOnHand,
  transferStock,
} from "@/server/capabilities/inventory";
import { LOCATION_CAPABILITY, registerLocationCapability } from "@/server/capabilities/location";

/**
 * CAPABILITY: Inventory — stock count (PRD §19).
 *
 * A count posts the difference between what was counted and what the ledger
 * says now as an Adjustment, so the balance moves through the same one path as
 * every other movement and the ledger keeps who counted and why.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  const message = "capability-inventory.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

describeDb("capability: Inventory stock count", () => {
  const tenantId = randomUUID();
  let outletA: string;
  let outletB: string;
  let manager: ActorContext;
  let reader: ActorContext;
  let chicken: string;
  let rice: string;
  let oil: string;

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

    await withTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: "Stock Count Kitchen", timeZone: "Asia/Kolkata" } });
      await activateCapability(tx, tenantId, LOCATION_CAPABILITY);
      await activateCapability(tx, tenantId, INVENTORY_CAPABILITY);

      const organizationId = (await tx.organization.create({ data: { tenantId, name: "Kitchen" } })).id;
      outletA = (await tx.location.create({ data: { tenantId, organizationId, name: "Defence Colony" } })).id;
      outletB = (await tx.location.create({ data: { tenantId, organizationId, name: "Saket" } })).id;

      const managerRole = await tx.role.create({ data: { tenantId, name: "Manager" }, select: { id: true } });
      const readerRole = await tx.role.create({ data: { tenantId, name: "Viewer" }, select: { id: true } });
      await tx.permission.createMany({
        data: [ENTITY_INVENTORY_ITEM, ENTITY_INVENTORY_STOCK].flatMap((entity) =>
          (["Read", "Create", "Edit"] as const).map((verb) => ({
            tenantId, roleId: managerRole.id, verb, entity, scope: "Tenant" as const,
          })),
        ),
      });
      await tx.permission.create({
        data: { tenantId, roleId: readerRole.id, verb: "Read", entity: ENTITY_INVENTORY_STOCK, scope: "Tenant" },
      });

      const make = async (displayName: string, roleId: string): Promise<ActorContext> => {
        const identity = await provisionIdentity(tx, { organizationId, authUserId: randomUUID(), displayName });
        await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId } });
        return { tenantId, userId: identity.userId, membershipId: identity.membershipId, organizationId, roleId };
      };
      manager = await make("Store Manager", managerRole.id);
      reader = await make("Auditor", readerRole.id);
    });
    invalidateCapabilityCache();

    chicken = (await executeCommand(manager, createItem, { sku: "CHK", name: "Chicken", unitLabel: "kg" })).id;
    rice = (await executeCommand(manager, createItem, { sku: "RICE", name: "Basmati rice", unitLabel: "kg" })).id;
    oil = (await executeCommand(manager, createItem, { sku: "OIL", name: "Refined oil", unitLabel: "l" })).id;
    for (const [itemId, qty] of [[chicken, 40], [rice, 100], [oil, 25]] as const) {
      await executeCommand(manager, recordStockMovement, { itemId, locationId: outletA, kind: "Receipt", qty });
    }
    // The same chicken at another outlet must never move when A is counted.
    await executeCommand(manager, recordStockMovement, { itemId: chicken, locationId: outletB, kind: "Receipt", qty: 12 });
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
      await admin.$executeRaw`DELETE FROM "user" WHERE id NOT IN (SELECT user_id FROM tenant_membership)`;
      await admin.$executeRaw`DELETE FROM party WHERE id NOT IN (SELECT party_id FROM "user")`;
    } finally {
      await admin.$disconnect();
    }
    await prisma.$disconnect();
  });

  const onHand = async (itemId: string, locationId: string) =>
    (await executeQuery(manager, stockOnHand, { itemId, locationId }))[0]?.qty ?? 0;

  it("posts the difference as an adjustment, leaves matching lines alone, and records the note", async () => {
    const result = await executeCommand(manager, applyStockCount, {
      locationId: outletA,
      note: "Sunday close",
      lines: [
        { itemId: chicken, countedQty: 37 }, // 3 short
        { itemId: rice, countedQty: 100 }, // matches
        { itemId: oil, countedQty: 28 }, // 3 over
      ],
    });

    expect(result.adjusted).toBe(2);
    expect(result.unchanged).toBe(1);
    expect(result.variances).toEqual([
      { itemId: chicken, expectedQty: 40, countedQty: 37, differenceQty: -3 },
      { itemId: oil, expectedQty: 25, countedQty: 28, differenceQty: 3 },
    ]);
    expect(await onHand(chicken, outletA)).toBe(37);
    expect(await onHand(rice, outletA)).toBe(100);
    expect(await onHand(oil, outletA)).toBe(28);

    const ledger = await executeQuery(manager, stockLedger, { itemId: chicken });
    const adjustment = ledger.find((m) => m.kind === "Adjustment");
    expect(adjustment).toMatchObject({ qty: -3, locationId: outletA, reference: "Stock count: Sunday close" });
    // No movement for the matching line.
    expect((await executeQuery(manager, stockLedger, { itemId: rice })).filter((m) => m.kind === "Adjustment")).toHaveLength(0);
  });

  it("counts one outlet only", async () => {
    expect(await onHand(chicken, outletB)).toBe(12);
  });

  it("uses the ledger's quantity now, not a stale expected figure", async () => {
    await executeCommand(manager, recordStockMovement, { itemId: rice, locationId: outletA, kind: "Issue", qty: -10 });
    const result = await executeCommand(manager, applyStockCount, {
      locationId: outletA,
      lines: [{ itemId: rice, countedQty: 90 }],
    });
    // 100 - 10 issued = 90 expected, so counting 90 is no variance.
    expect(result.adjusted).toBe(0);
    expect(result.unchanged).toBe(1);
  });

  it("counts an item with no balance yet as expected zero", async () => {
    const salt = (await executeCommand(manager, createItem, { sku: "SALT", name: "Salt", unitLabel: "kg" })).id;
    const result = await executeCommand(manager, applyStockCount, {
      locationId: outletA,
      lines: [{ itemId: salt, countedQty: 5 }],
    });
    expect(result.variances).toEqual([{ itemId: salt, expectedQty: 0, countedQty: 5, differenceQty: 5 }]);
    expect(await onHand(salt, outletA)).toBe(5);
  });

  it("refuses duplicate lines, a negative count, a foreign item and a foreign outlet", async () => {
    await expect(
      executeCommand(manager, applyStockCount, {
        locationId: outletA,
        lines: [{ itemId: oil, countedQty: 1 }, { itemId: oil, countedQty: 2 }],
      }),
    ).rejects.toThrow(/twice/);
    await expect(
      executeCommand(manager, applyStockCount, { locationId: outletA, lines: [{ itemId: oil, countedQty: -1 }] }),
    ).rejects.toThrow();
    await expect(
      executeCommand(manager, applyStockCount, { locationId: outletA, lines: [{ itemId: randomUUID(), countedQty: 1 }] }),
    ).rejects.toThrow(/not in this tenant/);
    await expect(
      executeCommand(manager, applyStockCount, { locationId: randomUUID(), lines: [{ itemId: oil, countedQty: 1 }] }),
    ).rejects.toThrow(/outlet not found/);
  });

  it("is refused for a role that can only read stock", async () => {
    await expect(
      executeCommand(reader, applyStockCount, { locationId: outletA, lines: [{ itemId: oil, countedQty: 1 }] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await onHand(oil, outletA)).toBe(28);
  });

  it("sends stock between outlets: both ledgers move, the total does not", async () => {
    const before = { a: await onHand(chicken, outletA), b: await onHand(chicken, outletB) };
    const result = await executeCommand(manager, transferStock, {
      itemId: chicken, fromLocationId: outletA, toLocationId: outletB, qty: 7, note: "Weekend rush",
    });
    expect(result).toEqual({ fromQty: before.a - 7, toQty: before.b + 7 });
    expect(await onHand(chicken, outletA)).toBe(before.a - 7);
    expect(await onHand(chicken, outletB)).toBe(before.b + 7);
    const ledger = await executeQuery(manager, stockLedger, { itemId: chicken });
    const transfers = ledger.filter((m) => m.kind === "Transfer");
    expect(transfers.map((m) => m.qty).sort((x, y) => x - y)).toEqual([-7, 7]);
    expect(transfers.some((m) => m.reference === "Sent to Saket (Weekend rush)")).toBe(true);
  });

  it("refuses a transfer to the same outlet, beyond what is there, or by a reader", async () => {
    await expect(
      executeCommand(manager, transferStock, { itemId: chicken, fromLocationId: outletA, toLocationId: outletA, qty: 1 }),
    ).rejects.toThrow(/different outlet/);
    await expect(
      executeCommand(manager, transferStock, { itemId: chicken, fromLocationId: outletB, toLocationId: outletA, qty: 10_000 }),
    ).rejects.toThrow(/only/);
    await expect(
      executeCommand(reader, transferStock, { itemId: chicken, fromLocationId: outletA, toLocationId: outletB, qty: 1 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("an outlet asks for stock; approving sends it from another outlet, rejecting needs a reason", async () => {
    const asked = await executeCommand(manager, requestStock, { itemId: rice, toLocationId: outletB, qty: 5, reason: "Weekend rush" });
    const listed = await executeQuery(manager, listStockRequests, { status: "Requested" });
    expect(listed.find((r) => r.id === asked.id)?.toLocation).toBeTruthy();

    await expect(executeCommand(manager, decideStockRequest, { requestId: asked.id, approve: false })).rejects.toThrow(/why/);
    await expect(executeCommand(manager, decideStockRequest, { requestId: asked.id, approve: true })).rejects.toThrow(/outlet to send from/);
    await expect(
      executeCommand(manager, decideStockRequest, { requestId: asked.id, approve: true, fromLocationId: outletB }),
    ).rejects.toThrow(/different outlet/);
    await expect(
      executeCommand(reader, decideStockRequest, { requestId: asked.id, approve: true, fromLocationId: outletA }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const [a, b] = [await onHand(rice, outletA), await onHand(rice, outletB)];
    const decided = await executeCommand(manager, decideStockRequest, { requestId: asked.id, approve: true, fromLocationId: outletA });
    expect(decided.status).toBe("Approved");
    expect(await onHand(rice, outletA)).toBe(a - 5);
    expect(await onHand(rice, outletB)).toBe(b + 5);
    await expect(
      executeCommand(manager, decideStockRequest, { requestId: asked.id, approve: false, note: "too late" }),
    ).rejects.toThrow(/already Approved/);

    const tooMuch = await executeCommand(manager, requestStock, { itemId: rice, toLocationId: outletB, qty: 1_000_000 });
    await expect(
      executeCommand(manager, decideStockRequest, { requestId: tooMuch.id, approve: true, fromLocationId: outletA }),
    ).rejects.toThrow(/only/);
    const rejected = await executeCommand(manager, decideStockRequest, { requestId: tooMuch.id, approve: false, note: "Order from vendor" });
    expect(rejected.status).toBe("Rejected");
  });

  it("food-cost variance separates count corrections from other movements at one outlet", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await executeQuery(manager, foodCostVariance, { locationId: outletA, fromDate: today, toDate: today });
    const ledger = await executeQuery(manager, stockLedger, { itemId: chicken });
    const corrections = ledger.filter((m) => m.kind === "Adjustment" && m.locationId === outletA).reduce((sum, m) => sum + m.qty, 0);
    expect(rows.find((r) => r.itemId === chicken)?.countCorrection).toBe(corrections);
    expect(rows.every((r) => r.unexplainedPaise >= 0)).toBe(true);
  });

});
