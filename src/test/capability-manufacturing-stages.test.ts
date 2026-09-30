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
  ENTITY_MANUFACTURING_OPERATION,
  ENTITY_MANUFACTURING_ORDER,
  ENTITY_MANUFACTURING_ROUTE,
  MANUFACTURING_CAPABILITY,
  cancelManufacturingOrder,
  completeManufacturingOrder,
  createManufacturingOrder,
  manufacturingOrderDetail,
  registerManufacturingCapability,
  startManufacturingOrder,
} from "@/server/capabilities/manufacturing";
import {
  completeOperation,
  createRoute,
  holdOperation,
  listRoutes,
  operationQueue,
  orderOperations,
  planOperations,
  resumeOperation,
  sendBack,
  setRouteActive,
  startOperation,
} from "@/server/capabilities/manufacturing/stages";

/**
 * Task 118, from Carxen's factory floor: a route of stages, per-order operations
 * that must run in sequence, hold/resume, a QC send-back that appends rather than
 * edits, per-order routing, and the order's own lifecycle staying honest about
 * open stages.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;
if (!hasDatabase) {
  const message = "capability-manufacturing-stages.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const CHAIN = [
  { stageKey: "cad", label: "CAD" },
  { stageKey: "cutting", label: "Cutting" },
  { stageKey: "stitching", label: "Stitching" },
  { stageKey: "qc", label: "QC" },
  { stageKey: "packing", label: "Packing" },
];

describeDb("capability: Manufacturing stages (Carxen floor)", () => {
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
    registerManufacturingCapability();

    await withTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: "Stage Test Factory", timeZone: "Asia/Kolkata" } });
      await activateCapability(tx, tenantId, LOCATION_CAPABILITY);
      await activateCapability(tx, tenantId, INVENTORY_CAPABILITY);
      await activateCapability(tx, tenantId, MANUFACTURING_CAPABILITY);

      const organizationId = (await tx.organization.create({ data: { tenantId, name: "Factory" } })).id;
      locationId = (await tx.location.create({ data: { tenantId, organizationId, name: "Floor" } })).id;

      const role = await tx.role.create({ data: { tenantId, name: "Manager" }, select: { id: true } });
      const entities = [
        ENTITY_INVENTORY_ITEM, ENTITY_INVENTORY_STOCK, ENTITY_MANUFACTURING_ORDER,
        ENTITY_MANUFACTURING_ROUTE, ENTITY_MANUFACTURING_OPERATION,
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

    fabricId = (await executeCommand(manager, createItem, { sku: "FAB", name: "Fabric (cm)", unitLabel: "cm" })).id;
    coverId = (await executeCommand(manager, createItem, { sku: "COVER", name: "Seat cover", unitLabel: "set" })).id;
    await executeCommand(manager, recordStockMovement, { itemId: fabricId, locationId, kind: "Receipt", qty: 5000, reference: "r" });

    routeId = (await executeCommand(manager, createRoute, { code: "SEAT-COVER", name: "Seat cover", stages: CHAIN })).id;
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

  /** A draft order with one fabric line, optionally already running. */
  async function newOrder(opts: { run?: boolean; plan?: boolean | Array<{ stageKey: string; label: string }> } = {}) {
    const order = await executeCommand(manager, createManufacturingOrder, {
      locationId, outputItemId: coverId, outputQty: 1, lines: [{ componentItemId: fabricId, qtyRequired: 10 }],
    });
    if (opts.plan !== false) {
      await executeCommand(manager, planOperations, Array.isArray(opts.plan) ? { orderId: order.id, stages: opts.plan } : { orderId: order.id, routeId });
    }
    if (opts.run) await executeCommand(manager, startManufacturingOrder, { orderId: order.id });
    return order.id;
  }
  const ops = (orderId: string) => executeQuery(manager, orderOperations, { orderId });
  const opId = async (orderId: string, stageKey: string) => (await ops(orderId)).filter((o) => o.stageKey === stageKey).at(-1)!.id;
  const finish = async (orderId: string, stageKey: string) => {
    const id = await opId(orderId, stageKey);
    await executeCommand(manager, startOperation, { operationId: id });
    await executeCommand(manager, completeOperation, { operationId: id });
  };

  it("validates a route: stage keys, duplicates and codes", async () => {
    await expect(executeCommand(manager, createRoute, { code: "X1", name: "x", stages: [{ stageKey: "Bad Key", label: "x" }] })).rejects.toThrow();
    await expect(
      executeCommand(manager, createRoute, { code: "X2", name: "x", stages: [CHAIN[0]!, CHAIN[0]!] }),
    ).rejects.toThrow(/more than once/);
    await expect(executeCommand(manager, createRoute, { code: "SEAT-COVER", name: "dup", stages: CHAIN })).rejects.toThrow(/already exists/);
    const listed = await executeQuery(manager, listRoutes, {});
    expect(listed.find((r) => r.code === "SEAT-COVER")!.stages.map((s) => s.stageKey)).toEqual(CHAIN.map((s) => s.stageKey));
  });

  it("plans an order into stages, once, and refuses to work before the order is running", async () => {
    const orderId = await newOrder();
    const planned = await ops(orderId);
    expect(planned.map((o) => o.stageKey)).toEqual(CHAIN.map((s) => s.stageKey));
    expect(planned.every((o) => o.state === "pending" && !o.actionable)).toBe(true);

    await expect(executeCommand(manager, planOperations, { orderId, routeId })).rejects.toThrow(/already has operations/);
    await expect(
      executeCommand(manager, startOperation, { operationId: planned[0]!.id }),
    ).rejects.toThrow(/start the order first/);
  });

  it("enforces stage order, and supports hold and resume with a reason", async () => {
    const orderId = await newOrder({ run: true });
    let list = await ops(orderId);
    expect(list.map((o) => o.actionable)).toEqual([true, false, false, false, false]);

    await expect(executeCommand(manager, startOperation, { operationId: await opId(orderId, "cutting") })).rejects.toThrow(/CAD must be completed first/);

    const cad = await opId(orderId, "cad");
    await executeCommand(manager, startOperation, { operationId: cad });
    await expect(executeCommand(manager, holdOperation, { operationId: cad, reason: "" })).rejects.toThrow();
    await executeCommand(manager, holdOperation, { operationId: cad, reason: "Waiting for the pattern file" });
    list = await ops(orderId);
    expect(list[0]).toMatchObject({ state: "on_hold", category: "Blocked", note: "Waiting for the pattern file" });

    // Held work still blocks the next stage.
    await expect(executeCommand(manager, startOperation, { operationId: await opId(orderId, "cutting") })).rejects.toThrow(/must be completed first/);

    await executeCommand(manager, resumeOperation, { operationId: cad });
    await executeCommand(manager, completeOperation, { operationId: cad });
    list = await ops(orderId);
    expect(list[0]).toMatchObject({ state: "completed", category: "Completed" });
    expect(list[0]!.startedAt).toBeTruthy();
    expect(list[0]!.completedAt).toBeTruthy();
    expect(list[1]!.actionable).toBe(true);
  });

  it("refuses to complete the order while a stage is open, then completes once all are done", async () => {
    const orderId = await newOrder({ run: true });
    await finish(orderId, "cad");
    await expect(executeCommand(manager, completeManufacturingOrder, { orderId })).rejects.toThrow(/stage\(s\) are still open/);

    for (const key of ["cutting", "stitching", "qc", "packing"]) await finish(orderId, key);
    await executeCommand(manager, completeManufacturingOrder, { orderId });
    expect((await executeQuery(manager, manufacturingOrderDetail, { orderId })).state).toBe("completed");
  });

  it("sends a QC reject back by appending: history stays, open work is cancelled, the route restarts at the redone stage", async () => {
    const orderId = await newOrder({ run: true });
    for (const key of ["cad", "cutting", "stitching"]) await finish(orderId, key);

    const qc = await opId(orderId, "qc");
    await executeCommand(manager, startOperation, { operationId: qc });
    await expect(
      executeCommand(manager, sendBack, { operationId: qc, toStageKey: "packing", reason: "forward is not back" }),
    ).rejects.toThrow(/earlier stage/);
    await expect(executeCommand(manager, sendBack, { operationId: qc, toStageKey: "nope", reason: "no such stage" })).rejects.toThrow(/not part of/);

    const cuttingBefore = await opId(orderId, "cutting");
    const result = await executeCommand(manager, sendBack, { operationId: qc, toStageKey: "cutting", reason: "Panel misaligned on the left bolster" });
    expect(result.count).toBe(4); // cutting, stitching, qc, packing again

    const list = await ops(orderId);
    expect(list).toHaveLength(9);
    // The first three completed stages are untouched facts.
    expect(list.slice(0, 3).every((o) => o.state === "completed")).toBe(true);
    // The QC that rejected and the pending packing were cancelled, with the reason kept.
    expect(list[3]).toMatchObject({ stageKey: "qc", state: "cancelled" });
    expect(list[3]!.note).toContain("Panel misaligned");
    expect(list[4]).toMatchObject({ stageKey: "packing", state: "cancelled" });
    // The redo: fresh pending operations, the first pointing at the stage it redoes.
    expect(list.slice(5).map((o) => [o.stageKey, o.state])).toEqual([
      ["cutting", "pending"], ["stitching", "pending"], ["qc", "pending"], ["packing", "pending"],
    ]);
    expect(list[5]!.reworkOfId).toBe(cuttingBefore);
    expect(list[5]!.actionable).toBe(true);
    expect(list.slice(6).every((o) => !o.actionable)).toBe(true);

    for (const key of ["cutting", "stitching", "qc", "packing"]) await finish(orderId, key);
    await executeCommand(manager, completeManufacturingOrder, { orderId });
    expect((await executeQuery(manager, manufacturingOrderDetail, { orderId })).state).toBe("completed");
  });

  it("routes one order differently without a special case: it skips a stage", async () => {
    const orderId = await newOrder({ run: true, plan: [CHAIN[1]!, CHAIN[2]!, CHAIN[4]!] }); // no CAD, no QC
    expect((await ops(orderId)).map((o) => o.stageKey)).toEqual(["cutting", "stitching", "packing"]);
    for (const key of ["cutting", "stitching", "packing"]) await finish(orderId, key);
    await executeCommand(manager, completeManufacturingOrder, { orderId });
  });

  it("shows the floor only the open work of running orders, filterable by stage", async () => {
    const running = await newOrder({ run: true });
    const draft = await newOrder({ run: false });

    const all = await executeQuery(manager, operationQueue, {});
    const runningRows = all.filter((r) => r.orderId === running);
    expect(runningRows.length).toBe(5);
    expect(all.some((r) => r.orderId === draft)).toBe(false);
    expect(runningRows.find((r) => r.stageKey === "cad")!.actionable).toBe(true);
    // An operator at QC may reject back to any earlier stage, or redo QC itself; CAD can only be redone.
    expect(runningRows.find((r) => r.stageKey === "qc")!.sendBackTo.map((s) => s.stageKey)).toEqual(["cad", "cutting", "stitching", "qc"]);
    expect(runningRows.find((r) => r.stageKey === "cad")!.sendBackTo.map((s) => s.stageKey)).toEqual(["cad"]);

    const cutting = await executeQuery(manager, operationQueue, { stageKey: "cutting" });
    expect(cutting.every((r) => r.stageKey === "cutting")).toBe(true);
    expect(cutting.some((r) => r.orderId === running)).toBe(true);
  });

  it("cancelling an order cancels its open stages and still returns the consumed stock", async () => {
    const before = (await executeQuery(manager, stockOnHand, { itemId: fabricId, locationId }))[0]?.qty ?? 0;
    const orderId = await newOrder({ run: true });
    await finish(orderId, "cad");
    const running = await opId(orderId, "cutting");
    await executeCommand(manager, startOperation, { operationId: running });

    await executeCommand(manager, cancelManufacturingOrder, { orderId, reason: "Customer withdrew the order" });

    const list = await ops(orderId);
    expect(list[0]!.state).toBe("completed"); // history is left alone
    expect(list.slice(1).every((o) => o.state === "cancelled")).toBe(true);
    expect((await executeQuery(manager, stockOnHand, { itemId: fabricId, locationId }))[0]?.qty ?? 0).toBe(before);
  });

  it("makes a completed or cancelled stage read-only (INV-002)", async () => {
    const orderId = await newOrder({ run: true });
    const cad = await opId(orderId, "cad");
    await executeCommand(manager, startOperation, { operationId: cad });
    await executeCommand(manager, completeOperation, { operationId: cad });

    await expect(executeCommand(manager, startOperation, { operationId: cad })).rejects.toThrow();
    await expect(executeCommand(manager, holdOperation, { operationId: cad, reason: "too late now" })).rejects.toThrow();
    await expect(executeCommand(manager, completeOperation, { operationId: cad })).rejects.toThrow();
  });

  it("archives a route without disturbing orders already planned from it", async () => {
    const orderId = await newOrder();
    await executeCommand(manager, setRouteActive, { routeId, active: false });
    expect((await ops(orderId)).map((o) => o.stageKey)).toEqual(CHAIN.map((s) => s.stageKey));
    await expect(
      executeCommand(manager, planOperations, { orderId: await newOrder({ plan: false }), routeId }),
    ).rejects.toThrow(/archived/);
    await executeCommand(manager, setRouteActive, { routeId, active: true });
  });

  it("keeps routes and operations behind tenant isolation", async () => {
    const other = randomUUID();
    const counts = await withTenant(other, async (tx) => ({
      routes: await tx.manufacturingRoute.count(),
      operations: await tx.manufacturingOperation.count(),
    }));
    expect(counts).toEqual({ routes: 0, operations: 0 });
  });
});
