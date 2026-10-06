import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/platform/db";
import { assertRlsEnforceable, withTenant } from "@/server/platform/tenancy";
import { activateCapability, invalidateCapabilityCache, setConfig } from "@/server/platform/capability";
import { clearCommands, clearHooks, executeCommand, type ActorContext } from "@/server/platform/command";
import { clearQueries, executeQuery } from "@/server/platform/query";
import { clearScopeResolvers } from "@/server/platform/authorization";
import { clearTransitionGuards } from "@/server/platform/state";
import { clearContributions } from "@/server/platform/contribution";
import { provisionIdentity } from "@/server/platform/identity";
import {
  CONFIG_CGST_RATE,
  CONFIG_SGST_RATE,
  DINEIN_CAPABILITY,
  ENTITY_BILL,
  ENTITY_MENU_CATEGORY,
  ENTITY_MENU_ITEM,
  ENTITY_ORDER,
  ENTITY_ORDER_LINE,
  ENTITY_PAYMENT,
  ENTITY_TABLE,
  ENTITY_ZONE,
  addOrderLines,
  advanceOrderLine,
  createMenuCategory,
  createMenuItem,
  createOrder,
  defineTable,
  defineZone,
  generateBill,
  kitchenQueue,
  moveTable,
  placeOrder,
  recordPayment,
  refundBill,
  registerDineinCapability,
  settleBill,
} from "@/server/capabilities/dinein";
import { LOCATION_CAPABILITY, registerLocationCapability } from "@/server/capabilities/location";
import {
  CRM_CAPABILITY,
  ENTITY_CUSTOMER,
  getCustomer360,
  listCustomers,
  registerCrmCapability,
} from "@/server/capabilities/crm";
import {
  ENTITY_LOYALTY_ENTRY,
  LOYALTY_CAPABILITY,
  getLoyaltyBalance,
  redeemPoints,
  registerLoyaltyCapability,
} from "@/server/capabilities/loyalty";

/**
 * CAPABILITY: CRM — a bill for a phone-bearing guest creates a Customer,
 * and a second visit updates the same one rather than duplicating it
 * (PRD §28-30, lean V1 per docs/superpowers/specs/2026-09-10-colonel-
 * kebabz-customer-360-design.md).
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  const message = "capability-crm.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describeDb("capability: CRM", () => {
  const tenantId = randomUUID();

  let organizationId: string;
  let locationId: string;
  let manager: ActorContext;
  let zoneId: string;
  let kebabItemId: string;

  const guestPhone = "9876500000";

  beforeAll(async () => {
    await assertRlsEnforceable();
    clearCommands();
    clearQueries();
    clearHooks();
    clearScopeResolvers();
    clearTransitionGuards();
    clearContributions();
    registerLocationCapability();
    registerDineinCapability();
    registerCrmCapability();
    registerLoyaltyCapability();

    await withTenant(tenantId, async (tx) => {
      await tx.tenant.create({
        data: { id: tenantId, name: "Colonel Kebabz CRM Test", timeZone: "Asia/Kolkata" },
      });
      await activateCapability(tx, tenantId, LOCATION_CAPABILITY);
      await activateCapability(tx, tenantId, DINEIN_CAPABILITY);
      await activateCapability(tx, tenantId, CRM_CAPABILITY);
      await activateCapability(tx, tenantId, LOYALTY_CAPABILITY);

      organizationId = (await tx.organization.create({ data: { tenantId, name: "Outlet 1" } })).id;
      locationId = (
        await tx.location.create({ data: { tenantId, organizationId, name: "Outlet 1" } })
      ).id;

      await setConfig(tx, tenantId, CONFIG_CGST_RATE, 2.5, "Tenant");
      await setConfig(tx, tenantId, CONFIG_SGST_RATE, 2.5, "Tenant");

      const managerRole = await tx.role.create({ data: { tenantId, name: "Manager" }, select: { id: true } });

      const everything = [
        ENTITY_MENU_CATEGORY,
        ENTITY_MENU_ITEM,
        ENTITY_ZONE,
        ENTITY_TABLE,
        ENTITY_ORDER,
        ENTITY_ORDER_LINE,
        ENTITY_BILL,
        ENTITY_PAYMENT,
        ENTITY_CUSTOMER,
        ENTITY_LOYALTY_ENTRY,
      ];
      await tx.permission.createMany({
        data: everything.flatMap((entity) =>
          (["Read", "Create", "Edit", "ActionExecute"] as const).map((verb) => ({
            tenantId,
            roleId: managerRole.id,
            verb,
            entity,
            scope: "Tenant" as const,
          })),
        ),
      });

      const managerIdentity = await provisionIdentity(tx, {
        organizationId,
        authUserId: randomUUID(),
        displayName: "Manager",
      });
      await tx.tenantMembership.update({
        where: { id: managerIdentity.membershipId },
        data: { roleId: managerRole.id },
      });

      manager = {
        tenantId,
        userId: managerIdentity.userId,
        membershipId: managerIdentity.membershipId,
        organizationId,
        roleId: managerRole.id,
      };
    });

    invalidateCapabilityCache();

    const category = await executeCommand(manager, createMenuCategory, { name: "Kebabs" });
    kebabItemId = (
      await executeCommand(manager, createMenuItem, {
        categoryId: category.id,
        name: "Chicken Seekh Kebab",
        priceMinor: 25_000,
      })
    ).id;
    zoneId = (await executeCommand(manager, defineZone, { locationId, name: "Ground Floor" })).id;
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

  let lastBillId = "";
  async function runOneVisit(tableLabel: string, qty: number): Promise<number> {
    const table = await executeCommand(manager, defineTable, { zoneId, label: tableLabel, seats: 2 });
    await executeCommand(manager, moveTable, { tableId: table.id, to: "occupied" });
    const order = await executeCommand(manager, createOrder, {
      tableId: table.id,
      covers: 2,
      customerName: "Ravi Regular",
      customerPhone: guestPhone,
    });
    await executeCommand(manager, addOrderLines, {
      orderId: order.id,
      lines: [{ itemId: kebabItemId, qty }],
    });
    await executeCommand(manager, placeOrder, { orderId: order.id });

    const queue = await executeQuery(manager, kitchenQueue, {});
    const ticket = queue.find((t) => t.orderId === order.id)!;
    await executeCommand(manager, advanceOrderLine, { lineId: ticket.lineId, to: "preparing" });
    await executeCommand(manager, advanceOrderLine, { lineId: ticket.lineId, to: "ready" });
    await executeCommand(manager, advanceOrderLine, { lineId: ticket.lineId, to: "served" });

    const bill = await executeCommand(manager, generateBill, { orderId: order.id });
    await executeCommand(manager, recordPayment, {
      billId: bill.id,
      method: "cash",
      amountMinor: bill.totalMinor,
    });
    await executeCommand(manager, settleBill, { billId: bill.id });
    await executeCommand(manager, moveTable, { tableId: table.id, to: "available" });
    lastBillId = bill.id;
    return bill.totalMinor;
  }

  it("creates one Customer across two visits, not two", async () => {
    const firstTotal = await runOneVisit("T-1", 1);
    const secondTotal = await runOneVisit("T-2", 2);

    const customer = await executeQuery(manager, getCustomer360, { phone: guestPhone });
    expect(customer).not.toBeNull();
    expect(customer!.name).toBe("Ravi Regular");
    expect(customer!.orderCount).toBe(2);
    expect(customer!.totalSpendMinor).toBe(firstTotal + secondTotal);
    expect(customer!.avgOrderValueMinor).toBe(Math.round((firstTotal + secondTotal) / 2));
    expect(customer!.lastOrderAt).not.toBeNull();

    const list = await executeQuery(manager, listCustomers, { minVisits: 2 });
    expect(list.some((c) => c.phone === guestPhone)).toBe(true);

    const filtered = await executeQuery(manager, listCustomers, { minVisits: 3 });
    expect(filtered.some((c) => c.phone === guestPhone)).toBe(false);

    // Loyalty: default rate is 5 points per Rs 100 (10,000 paise) spent,
    // earned automatically on settle for each of the two visits above.
    const expectedPoints =
      Math.floor((firstTotal / 10_000) * 5) + Math.floor((secondTotal / 10_000) * 5);
    const balance = await executeQuery(manager, getLoyaltyBalance, { customerId: customer!.id });
    expect(balance.balance).toBe(expectedPoints);

    const redeemed = await executeCommand(manager, redeemPoints, {
      customerId: customer!.id,
      points: expectedPoints,
    });
    expect(redeemed.valuePaise).toBe(expectedPoints * 20);
    expect(redeemed.remainingBalance).toBe(0);

    await expect(
      executeCommand(manager, redeemPoints, { customerId: customer!.id, points: 1 }),
    ).rejects.toThrow(/only 0 points available/);
  });

  it("takes back points in proportion to a refund, never more than were earned (decision 2026-10-06)", async () => {
    const total = await runOneVisit("T-9", 20);
    const customer = (await executeQuery(manager, getCustomer360, { phone: guestPhone }))!;
    const earned = Math.floor((total / 10_000) * 5);
    expect(earned).toBeGreaterThan(1);
    const before = (await executeQuery(manager, getLoyaltyBalance, { customerId: customer.id })).balance;

    const half = Math.floor(total / 2);
    await executeCommand(manager, refundBill, { billId: lastBillId, amountMinor: half, method: "cash", reason: "Half the order was cold" });
    const afterHalf = (await executeQuery(manager, getLoyaltyBalance, { customerId: customer.id })).balance;
    expect(before - afterHalf).toBe(Math.floor((earned * half) / total));

    await executeCommand(manager, refundBill, { billId: lastBillId, amountMinor: total - half, method: "cash", reason: "Rest refunded" });
    const afterAll = (await executeQuery(manager, getLoyaltyBalance, { customerId: customer.id })).balance;
    expect(before - afterAll).toBe(earned);
  });
});
