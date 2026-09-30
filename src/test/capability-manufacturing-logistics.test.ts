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
  ENTITY_MANUFACTURING_BATCH,
  ENTITY_MANUFACTURING_DISPATCH,
  ENTITY_MANUFACTURING_ORDER,
  ENTITY_MANUFACTURING_RESERVATION,
  MANUFACTURING_CAPABILITY,
  cancelManufacturingOrder,
  completeManufacturingOrder,
  createManufacturingOrder,
  registerManufacturingCapability,
  startManufacturingOrder,
} from "@/server/capabilities/manufacturing";
import { confirmDelivery, dispatchOrder, orderDispatch } from "@/server/capabilities/manufacturing/logistics";
import {
  batchDetail,
  createBatch,
  dissolveBatch,
  orderReservations,
  releaseReservation,
  reserveBatch,
  reserveOrder,
} from "@/server/capabilities/manufacturing/batch";

/**
 * Task 118, dispatch and consolidation, proven against the real database:
 * a finished order leaves only with a packaging photo of THAT order, the delivery
 * trail is append-only; reserved stock is not anyone else's to consume, and a
 * batch reserves all its orders or none.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;
if (!hasDatabase) {
  const message = "capability-manufacturing-logistics.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describeDb("capability: Manufacturing dispatch, reservation and batches (Task 118)", () => {
  const tenantId = randomUUID();
  const created = { users: [] as string[], parties: [] as string[] };

  let locationId: string;
  let otherLocationId: string;
  let manager: ActorContext;
  let coverId: string;
  let sku = 0;

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
      await tx.tenant.create({ data: { id: tenantId, name: "Logistics Test Lifestyles", timeZone: "Asia/Kolkata" } });
      for (const cap of [LOCATION_CAPABILITY, INVENTORY_CAPABILITY, EVIDENCE_CAPABILITY, MANUFACTURING_CAPABILITY]) {
        await activateCapability(tx, tenantId, cap);
      }
      const organizationId = (await tx.organization.create({ data: { tenantId, name: "Factory" } })).id;
      locationId = (await tx.location.create({ data: { tenantId, organizationId, name: "Floor" } })).id;
      otherLocationId = (await tx.location.create({ data: { tenantId, organizationId, name: "Annexe" } })).id;

      const role = await tx.role.create({ data: { tenantId, name: "Manager" }, select: { id: true } });
      const entities = [
        ENTITY_INVENTORY_ITEM, ENTITY_INVENTORY_STOCK, ENTITY_EVIDENCE, ENTITY_MANUFACTURING_ORDER,
        ENTITY_MANUFACTURING_DISPATCH, ENTITY_MANUFACTURING_BATCH, ENTITY_MANUFACTURING_RESERVATION,
      ];
      await tx.permission.createMany({
        data: entities.flatMap((entity) =>
          (["Read", "Create", "Edit", "Delete", "ActionExecute"] as const).map((verb) => ({
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

    coverId = (await executeCommand(manager, createItem, { sku: "COVER", name: "Seat cover", unitLabel: "set" })).id;
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

  /** A component with its own stock, so one test's holds never touch another's. */
  async function component(qty: number, at = locationId): Promise<string> {
    sku += 1;
    const id = (await executeCommand(manager, createItem, { sku: `FAB-${sku}`, name: `Fabric ${sku}`, unitLabel: "cm" })).id;
    if (qty > 0) await executeCommand(manager, recordStockMovement, { itemId: id, locationId: at, kind: "Receipt", qty, reference: "r" });
    return id;
  }
  const draft = async (fabricId: string, qty: number, at = locationId) =>
    (
      await executeCommand(manager, createManufacturingOrder, {
        locationId: at, outputItemId: coverId, outputQty: 1, lines: [{ componentItemId: fabricId, qtyRequired: qty }],
      })
    ).id;
  const photoOf = async (orderId: string) =>
    (
      await executeCommand(manager, captureEvidence, {
        entityKey: ENTITY_MANUFACTURING_ORDER, entityId: orderId, kind: "Photo", uri: "https://x.example/p.jpg", capturedAt: new Date().toISOString(),
      })
    ).id;
  async function finished(): Promise<string> {
    const orderId = await draft(await component(10), 5);
    await executeCommand(manager, startManufacturingOrder, { orderId });
    await executeCommand(manager, completeManufacturingOrder, { orderId });
    return orderId;
  }

  /* --------------------------------- dispatch -------------------------------- */

  it("dispatches only a completed order, and only with a packaging photo of that order", async () => {
    const notDone = await draft(await component(10), 5);
    await expect(
      executeCommand(manager, dispatchOrder, { orderId: notDone, transporter: "VRL", packagingEvidenceId: await photoOf(notDone) }),
    ).rejects.toThrow(/only a completed order/);

    const orderId = await finished();
    const other = await finished();
    const base = { orderId, transporter: "VRL Logistics" };
    await expect(executeCommand(manager, dispatchOrder, { ...base, packagingEvidenceId: randomUUID() })).rejects.toThrow(/packaging photo/);
    // A photograph of a DIFFERENT order does not count as proof of this one.
    await expect(executeCommand(manager, dispatchOrder, { ...base, packagingEvidenceId: await photoOf(other) })).rejects.toThrow(/packaging photo/);
    // Neither does a non-photograph about this order.
    const reading = (
      await executeCommand(manager, captureEvidence, {
        entityKey: ENTITY_MANUFACTURING_ORDER, entityId: orderId, kind: "Reading", uri: "https://x.example/r", capturedAt: new Date().toISOString(),
      })
    ).id;
    await expect(executeCommand(manager, dispatchOrder, { ...base, packagingEvidenceId: reading })).rejects.toThrow(/packaging photo/);
  });

  it("walks dispatched -> delivered, refusing repeats and out-of-order steps", async () => {
    const orderId = await finished();
    await expect(executeCommand(manager, confirmDelivery, { orderId })).rejects.toThrow(/not been dispatched/);

    await executeCommand(manager, dispatchOrder, {
      orderId, transporter: "VRL Logistics", vehicleNo: "MH12 AB 1234", trackingRef: "TRK-9", packagingEvidenceId: await photoOf(orderId),
    });
    expect((await executeQuery(manager, orderDispatch, { orderId })).status).toBe("dispatched");
    await expect(
      executeCommand(manager, dispatchOrder, { orderId, transporter: "Again", packagingEvidenceId: await photoOf(orderId) }),
    ).rejects.toThrow(/already been dispatched/);

    await executeCommand(manager, confirmDelivery, { orderId, note: "Signed by dealer" });
    await expect(executeCommand(manager, confirmDelivery, { orderId })).rejects.toThrow(/already marked delivered/);

    const view = await executeQuery(manager, orderDispatch, { orderId });
    expect(view.status).toBe("delivered");
    expect(view.events.map((e) => e.status)).toEqual(["delivered", "dispatched"]);
    expect(view.events[1]).toMatchObject({ transporter: "VRL Logistics", vehicleNo: "MH12 AB 1234", trackingRef: "TRK-9" });
  });

  it("keeps the delivery trail append-only", async () => {
    const orderId = await finished();
    const { id } = await executeCommand(manager, dispatchOrder, { orderId, transporter: "VRL", packagingEvidenceId: await photoOf(orderId) });
    await expect(
      withTenant(tenantId, (tx) => tx.manufacturingDispatch.update({ where: { id }, data: { transporter: "Someone else" } })),
    ).rejects.toThrow();
    await expect(withTenant(tenantId, (tx) => tx.manufacturingDispatch.delete({ where: { id } }))).rejects.toThrow();
  });

  /* ------------------------------- reservation ------------------------------- */

  it("holds stock so a second order cannot be promised it, and lets go on release", async () => {
    const fabric = await component(100);
    const first = await draft(fabric, 70);
    const second = await draft(fabric, 70);

    await executeCommand(manager, reserveOrder, { orderId: first });
    // Reserving twice holds nothing more.
    expect((await executeCommand(manager, reserveOrder, { orderId: first })).held).toBe(0);
    expect(await executeQuery(manager, orderReservations, { orderId: first })).toEqual({ held: 1, lines: 1 });

    await expect(executeCommand(manager, reserveOrder, { orderId: second })).rejects.toThrow(/not enough Fabric.*30 available/);
    // Nor can it be started out from under the hold, though 100 is physically there.
    await expect(executeCommand(manager, startManufacturingOrder, { orderId: second })).rejects.toThrow(/reserved/);

    await executeCommand(manager, releaseReservation, { orderId: first });
    await executeCommand(manager, reserveOrder, { orderId: second });
    expect((await executeQuery(manager, orderReservations, { orderId: second })).held).toBe(1);
  });

  it("consumes the holder's own reservation on start, and frees it on cancel", async () => {
    const fabric = await component(100);
    const first = await draft(fabric, 100);
    await executeCommand(manager, reserveOrder, { orderId: first });
    // The holder can start: its own hold is what it is taking.
    await executeCommand(manager, startManufacturingOrder, { orderId: first });
    const released = await withTenant(tenantId, (tx) => tx.manufacturingReservation.findMany({ where: { orderId: first } }));
    expect(released).toHaveLength(1);
    expect(released[0]).toMatchObject({ releaseReason: "consumed" });
    expect(released[0].releasedAt).not.toBeNull();

    const fabric2 = await component(50);
    const second = await draft(fabric2, 50);
    await executeCommand(manager, reserveOrder, { orderId: second });
    await executeCommand(manager, cancelManufacturingOrder, { orderId: second, reason: "customer withdrew" });
    expect((await executeQuery(manager, orderReservations, { orderId: second })).held).toBe(0);
    const third = await draft(fabric2, 50);
    await executeCommand(manager, reserveOrder, { orderId: third });
  });

  it("refuses to reserve for an order that has already started", async () => {
    const orderId = await draft(await component(10), 5);
    await executeCommand(manager, startManufacturingOrder, { orderId });
    await expect(executeCommand(manager, reserveOrder, { orderId })).rejects.toThrow(/only a draft order/);
  });

  /* ---------------------------------- batches --------------------------------- */

  it("consolidates draft orders at one location, once each", async () => {
    const fabric = await component(1000);
    const a = await draft(fabric, 10);
    const b = await draft(fabric, 10);
    const elsewhere = await draft(fabric, 10, otherLocationId);

    await expect(executeCommand(manager, createBatch, { orderIds: [a, elsewhere] })).rejects.toThrow(/one location/);
    await expect(executeCommand(manager, createBatch, { orderIds: [a, a] })).rejects.toThrow(/appears twice/);
    await expect(executeCommand(manager, createBatch, { orderIds: [a] })).rejects.toThrow();

    const batch = await executeCommand(manager, createBatch, { orderIds: [a, b], reference: "Cutting run 1" });
    await expect(executeCommand(manager, createBatch, { orderIds: [a, await draft(fabric, 1)] })).rejects.toThrow(/already in a batch/);

    const started = await draft(fabric, 1);
    await executeCommand(manager, startManufacturingOrder, { orderId: started });
    await expect(executeCommand(manager, createBatch, { orderIds: [started, await draft(fabric, 1)] })).rejects.toThrow(/only draft/);

    const detail = await executeQuery(manager, batchDetail, { batchId: batch.id });
    expect(detail.orders).toHaveLength(2);
    // The stock-match is consolidated across the members, not per order.
    expect(detail.requirements).toEqual([expect.objectContaining({ itemId: fabric, required: 20, shortfall: 0 })]);
  });

  it("reserves a whole batch or none of it", async () => {
    const fabric = await component(25);
    const a = await draft(fabric, 10);
    const b = await draft(fabric, 10);
    const c = await draft(fabric, 10);
    const batch = await executeCommand(manager, createBatch, { orderIds: [a, b, c] });

    // 30 needed, 25 there: each order alone would fit, the batch does not.
    const short = await executeQuery(manager, batchDetail, { batchId: batch.id });
    expect(short.requirements[0]).toMatchObject({ required: 30, onHand: 25, shortfall: 5 });
    await expect(executeCommand(manager, reserveBatch, { batchId: batch.id })).rejects.toThrow(/not enough Fabric/);
    for (const id of [a, b, c]) expect((await executeQuery(manager, orderReservations, { orderId: id })).held).toBe(0);

    await executeCommand(manager, recordStockMovement, { itemId: fabric, locationId, kind: "Receipt", qty: 5, reference: "top-up" });
    expect((await executeCommand(manager, reserveBatch, { batchId: batch.id })).held).toBe(3);
    const ready = await executeQuery(manager, batchDetail, { batchId: batch.id });
    expect(ready.orders.every((o) => o.reserved)).toBe(true);
  });

  it("dissolves a batch of drafts but not one with a started order", async () => {
    const fabric = await component(100);
    const a = await draft(fabric, 10);
    const b = await draft(fabric, 10);
    const kept = await executeCommand(manager, createBatch, { orderIds: [a, b] });
    await executeCommand(manager, startManufacturingOrder, { orderId: a });
    await expect(executeCommand(manager, dissolveBatch, { batchId: kept.id })).rejects.toThrow(/started orders/);

    const c = await draft(fabric, 10);
    const d = await draft(fabric, 10);
    const free = await executeCommand(manager, createBatch, { orderIds: [c, d] });
    await executeCommand(manager, dissolveBatch, { batchId: free.id });
    const freed = await withTenant(tenantId, (tx) => tx.manufacturingOrder.findMany({ where: { id: { in: [c, d] } } }));
    expect(freed.every((o) => o.batchId === null)).toBe(true);
    // Free to be batched again.
    await executeCommand(manager, createBatch, { orderIds: [c, d] });
  });
});
