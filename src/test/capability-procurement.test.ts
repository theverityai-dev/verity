import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/platform/db";
import { assertRlsEnforceable, withTenant } from "@/server/platform/tenancy";
import { activateCapability, invalidateCapabilityCache, setConfig } from "@/server/platform/capability";
import { clearCommands, clearHooks, executeCommand, type ActorContext } from "@/server/platform/command";
import { clearQueries, executeQuery } from "@/server/platform/query";
import { ForbiddenError, clearScopeResolvers } from "@/server/platform/authorization";
import { clearTransitionGuards } from "@/server/platform/state";
import { clearContributions } from "@/server/platform/contribution";
import { provisionIdentity } from "@/server/platform/identity";
import {
  CONFIG_PO_APPROVAL_THRESHOLD,
  ENTITY_INVENTORY_ITEM,
  ENTITY_INVENTORY_PURCHASE_ORDER,
  ENTITY_INVENTORY_STOCK,
  ENTITY_INVENTORY_VENDOR,
  INVENTORY_CAPABILITY,
  approvePurchaseOrder,
  cancelPurchaseOrder,
  createItem,
  createPurchaseOrder,
  createVendor,
  draftOrderFromLowStock,
  getPurchaseOrder,
  listPurchaseOrders,
  receiveGoods,
  registerInventoryCapability,
  stockOnHand,
  submitPurchaseOrder,
  vendorPriceHistory,
} from "@/server/capabilities/inventory";
import { LOCATION_CAPABILITY, registerLocationCapability } from "@/server/capabilities/location";

/**
 * CAPABILITY: Inventory procurement — vendor -> purchase order -> approval ->
 * goods receipt -> stock (Colonel Kebabz parity, procurement.md §7/§8).
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  const message = "capability-procurement.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

describeDb("capability: Inventory procurement", () => {
  const tenantId = randomUUID();
  let outlet: string;
  let manager: ActorContext; // can raise and receive, cannot approve
  let owner: ActorContext; // can approve
  let chicken: string;
  let oil: string;
  let vendorId: string;

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
      await tx.tenant.create({ data: { id: tenantId, name: "Procurement Kitchen", timeZone: "Asia/Kolkata" } });
      await activateCapability(tx, tenantId, LOCATION_CAPABILITY);
      await activateCapability(tx, tenantId, INVENTORY_CAPABILITY);

      const organizationId = (await tx.organization.create({ data: { tenantId, name: "Kitchen" } })).id;
      outlet = (await tx.location.create({ data: { tenantId, organizationId, name: "Defence Colony" } })).id;

      const managerRole = await tx.role.create({ data: { tenantId, name: "Manager" }, select: { id: true } });
      const ownerRole = await tx.role.create({ data: { tenantId, name: "Owner" }, select: { id: true } });
      const entities = [ENTITY_INVENTORY_ITEM, ENTITY_INVENTORY_STOCK, ENTITY_INVENTORY_VENDOR, ENTITY_INVENTORY_PURCHASE_ORDER];
      await tx.permission.createMany({
        data: entities.flatMap((entity) =>
          (["Read", "Create", "Edit"] as const).map((verb) => ({ tenantId, roleId: managerRole.id, verb, entity, scope: "Tenant" as const })),
        ),
      });
      await tx.permission.createMany({
        data: [
          ...entities.flatMap((entity) =>
            (["Read", "Create", "Edit"] as const).map((verb) => ({ tenantId, roleId: ownerRole.id, verb, entity, scope: "Tenant" as const })),
          ),
          { tenantId, roleId: ownerRole.id, verb: "ActionExecute" as const, entity: ENTITY_INVENTORY_PURCHASE_ORDER, scope: "Tenant" as const },
        ],
      });

      const make = async (displayName: string, roleId: string): Promise<ActorContext> => {
        const identity = await provisionIdentity(tx, { organizationId, authUserId: randomUUID(), displayName });
        await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId } });
        return { tenantId, userId: identity.userId, membershipId: identity.membershipId, organizationId, roleId };
      };
      manager = await make("Outlet Manager", managerRole.id);
      owner = await make("Owner", ownerRole.id);
    });
    invalidateCapabilityCache();

    chicken = (await executeCommand(manager, createItem, { sku: "CHK", name: "Chicken", unitLabel: "kg" })).id;
    oil = (await executeCommand(manager, createItem, { sku: "OIL", name: "Refined oil", unitLabel: "l" })).id;
    vendorId = (await executeCommand(manager, createVendor, { name: "Fresh Poultry Co", paymentTermsDays: 7 })).id;
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

  const onHand = async (itemId: string) => (await executeQuery(manager, stockOnHand, { itemId, locationId: outlet }))[0]?.qty ?? 0;
  const detail = async (orderId: string) => (await executeQuery(manager, getPurchaseOrder, { orderId }))!;

  it("validates vendors: unique name, well-formed GSTIN", async () => {
    await expect(executeCommand(manager, createVendor, { name: "Fresh Poultry Co" })).rejects.toThrow(/already exists/);
    await expect(executeCommand(manager, createVendor, { name: "Bad GST", gstin: "123" })).rejects.toThrow();
    const ok = await executeCommand(manager, createVendor, { name: "Delhi Dairy", gstin: "07AAACD1234F1Z5" });
    expect(ok.id).toBeTruthy();
  });

  it("a small order is approved on submit and totals to the paisa", async () => {
    const order = await executeCommand(manager, createPurchaseOrder, {
      vendorId,
      locationId: outlet,
      expectedDate: "2026-10-12",
      lines: [{ itemId: chicken, qty: 50, unitPricePaise: 25_500 }], // 50 kg at Rs 255 = Rs 12,750
    });
    expect(order.number).toMatch(/^PO-\d{4}$/);
    expect(order.totalPaise).toBe(1_275_000);

    const submitted = await executeCommand(manager, submitPurchaseOrder, { orderId: order.id });
    expect(submitted.status).toBe("Approved");
    await expect(executeCommand(manager, submitPurchaseOrder, { orderId: order.id })).rejects.toThrow(/only a draft/);
  });

  it("an order over the threshold waits for someone who may approve", async () => {
    const order = await executeCommand(manager, createPurchaseOrder, {
      vendorId,
      locationId: outlet,
      lines: [{ itemId: oil, qty: 200, unitPricePaise: 15_000 }], // Rs 30,000 > Rs 25,000
    });
    expect((await executeCommand(manager, submitPurchaseOrder, { orderId: order.id })).status).toBe("PendingApproval");

    // The outlet manager can raise and submit, not approve.
    await expect(executeCommand(manager, approvePurchaseOrder, { orderId: order.id })).rejects.toBeInstanceOf(ForbiddenError);
    // And cannot receive against an order nobody has approved.
    const lines = (await detail(order.id)).lines;
    await expect(
      executeCommand(manager, receiveGoods, { orderId: order.id, lines: [{ orderLineId: lines[0]!.id, acceptedQty: 1 }] }),
    ).rejects.toThrow(/approved order/);

    await executeCommand(owner, approvePurchaseOrder, { orderId: order.id });
    const after = await detail(order.id);
    expect(after.status).toBe("Approved");
    await expect(executeCommand(owner, approvePurchaseOrder, { orderId: order.id })).rejects.toThrow(/waiting for approval/);
  });

  it("the threshold is the tenant's to change", async () => {
    await withTenant(tenantId, (tx) => setConfig(tx, tenantId, CONFIG_PO_APPROVAL_THRESHOLD, 100_000, "Tenant"));
    const order = await executeCommand(manager, createPurchaseOrder, {
      vendorId,
      locationId: outlet,
      lines: [{ itemId: oil, qty: 10, unitPricePaise: 15_000 }], // Rs 1,500 > Rs 1,000 now
    });
    expect((await executeCommand(manager, submitPurchaseOrder, { orderId: order.id })).status).toBe("PendingApproval");
    await withTenant(tenantId, (tx) => setConfig(tx, tenantId, CONFIG_PO_APPROVAL_THRESHOLD, 2_500_000, "Tenant"));
  });

  it("partial receipt: accepts some, rejects some with a reason, stocks at the actual price", async () => {
    const order = await executeCommand(manager, createPurchaseOrder, {
      vendorId,
      locationId: outlet,
      lines: [{ itemId: chicken, qty: 50, unitPricePaise: 25_500 }],
    });
    await executeCommand(manager, submitPurchaseOrder, { orderId: order.id });
    const line = (await detail(order.id)).lines[0]!;

    // Rejecting without a reason is refused.
    await expect(
      executeCommand(manager, receiveGoods, { orderId: order.id, lines: [{ orderLineId: line.id, acceptedQty: 48, rejectedQty: 2 }] }),
    ).rejects.toThrow(/why/);

    const before = await onHand(chicken);
    const first = await executeCommand(manager, receiveGoods, {
      orderId: order.id,
      invoiceRef: "INV-8841",
      lines: [{ orderLineId: line.id, acceptedQty: 48, rejectedQty: 2, rejectReason: "Spoiled on arrival", unitPricePaise: 25_800 }],
    });
    expect(first.status).toBe("PartiallyReceived");
    expect(first.stockedLines).toBe(1);
    expect(await onHand(chicken)).toBe(before + 48);

    const d = await detail(order.id);
    expect(d.lines[0]).toMatchObject({ receivedQty: 48, rejectedQty: 2 });
    expect(d.receipts).toHaveLength(1);
    expect(d.receipts[0]).toMatchObject({ invoiceRef: "INV-8841" });
    expect(d.receipts[0]!.lines[0]).toMatchObject({ acceptedQty: 48, rejectedQty: 2, rejectReason: "Spoiled on arrival", unitPricePaise: 25_800 });

    // The replacement arrives; more than ordered is refused, the exact balance completes it.
    await expect(
      executeCommand(manager, receiveGoods, { orderId: order.id, lines: [{ orderLineId: line.id, acceptedQty: 3 }] }),
    ).rejects.toThrow(/more received than ordered/);
    const second = await executeCommand(manager, receiveGoods, { orderId: order.id, lines: [{ orderLineId: line.id, acceptedQty: 2 }] });
    expect(second.status).toBe("Received");
    expect(await onHand(chicken)).toBe(before + 50);

    // Done is done.
    await expect(
      executeCommand(manager, receiveGoods, { orderId: order.id, lines: [{ orderLineId: line.id, acceptedQty: 1 }] }),
    ).rejects.toThrow(/approved order/);
    await expect(executeCommand(manager, cancelPurchaseOrder, { orderId: order.id, reason: "late" })).rejects.toThrow(/cannot be cancelled/);
  });

  it("cancel needs a reason and is refused once goods have arrived", async () => {
    const order = await executeCommand(manager, createPurchaseOrder, {
      vendorId,
      locationId: outlet,
      lines: [{ itemId: oil, qty: 5, unitPricePaise: 12_000 }],
    });
    await expect(executeCommand(manager, cancelPurchaseOrder, { orderId: order.id, reason: "  " })).rejects.toThrow();
    await executeCommand(manager, cancelPurchaseOrder, { orderId: order.id, reason: "Vendor out of stock" });
    expect((await detail(order.id)).status).toBe("Cancelled");
    expect((await detail(order.id)).cancelReason).toBe("Vendor out of stock");

    const received = await executeCommand(manager, createPurchaseOrder, {
      vendorId,
      locationId: outlet,
      lines: [{ itemId: oil, qty: 5, unitPricePaise: 12_000 }],
    });
    await executeCommand(manager, submitPurchaseOrder, { orderId: received.id });
    const line = (await detail(received.id)).lines[0]!;
    await executeCommand(manager, receiveGoods, { orderId: received.id, lines: [{ orderLineId: line.id, acceptedQty: 0, rejectedQty: 5, rejectReason: "Wrong brand" }] });
    // A rejection-only receipt moved no stock but is still a delivery event.
    await expect(executeCommand(manager, cancelPurchaseOrder, { orderId: received.id, reason: "x" })).rejects.toThrow(/cannot be cancelled/);
  });

  it("refuses bad orders: duplicate item, foreign item, zero quantity, unknown vendor", async () => {
    const base = { vendorId, locationId: outlet };
    await expect(
      executeCommand(manager, createPurchaseOrder, { ...base, lines: [{ itemId: oil, qty: 1, unitPricePaise: 1 }, { itemId: oil, qty: 2, unitPricePaise: 1 }] }),
    ).rejects.toThrow(/twice/);
    await expect(
      executeCommand(manager, createPurchaseOrder, { ...base, lines: [{ itemId: randomUUID(), qty: 1, unitPricePaise: 1 }] }),
    ).rejects.toThrow(/not in this tenant/);
    await expect(
      executeCommand(manager, createPurchaseOrder, { ...base, lines: [{ itemId: oil, qty: 0, unitPricePaise: 1 }] }),
    ).rejects.toThrow();
    await expect(
      executeCommand(manager, createPurchaseOrder, { vendorId: randomUUID(), locationId: outlet, lines: [{ itemId: oil, qty: 1, unitPricePaise: 1 }] }),
    ).rejects.toThrow(/vendor not found/);
  });

  it("lists orders newest first with receipt progress", async () => {
    const rows = await executeQuery(manager, listPurchaseOrders, {});
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows[0]!.number > rows[rows.length - 1]!.number).toBe(true);
    const complete = rows.find((r) => r.status === "Received")!;
    expect(complete.receivedQty).toBe(complete.orderedQty);
    expect((await executeQuery(manager, listPurchaseOrders, { status: "Cancelled" })).every((r) => r.status === "Cancelled")).toBe(true);
  });

  it("drafts an order from low stock, topping each item up to twice its reorder level", async () => {
    const paneer = (await executeCommand(manager, createItem, { sku: "PNR", name: "Paneer", unitLabel: "kg", reorderLevel: 10 })).id;
    // Nothing on hand: needs 20. A well-stocked item with a reorder level stays off the draft.
    const flour = (await executeCommand(manager, createItem, { sku: "ATTA", name: "Atta", unitLabel: "kg", reorderLevel: 5 })).id;
    const vendor = await executeCommand(manager, createVendor, { name: "Mother Dairy Supplies" });
    const po = await executeCommand(manager, createPurchaseOrder, {
      vendorId: vendor.id, locationId: outlet, lines: [{ itemId: flour, qty: 50, unitPricePaise: 4_000 }],
    });
    await executeCommand(manager, submitPurchaseOrder, { orderId: po.id });
    const line = (await detail(po.id)).lines[0]!;
    await executeCommand(manager, receiveGoods, { orderId: po.id, lines: [{ orderLineId: line.id, acceptedQty: 50 }] });

    const draft = await executeCommand(manager, draftOrderFromLowStock, { vendorId: vendor.id, locationId: outlet });
    const d = await detail(draft.id);
    expect(d.status).toBe("Draft");
    const paneerLine = d.lines.find((l) => l.itemId === paneer)!;
    expect(paneerLine.qty).toBe(20);
    expect(d.lines.some((l) => l.itemId === flour)).toBe(false);
  });

  it("price history shows what each vendor actually charged, newest first", async () => {
    const rows = await executeQuery(manager, vendorPriceHistory, { vendorId });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.vendorId === vendorId)).toBe(true);
    // The partial receipt was charged Rs 258, not the Rs 255 that was ordered.
    expect(rows.some((r) => r.itemName === "Chicken" && r.unitPricePaise === 25_800)).toBe(true);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.receivedAt.getTime()).toBeGreaterThanOrEqual(rows[i]!.receivedAt.getTime());
    }
  });

});
