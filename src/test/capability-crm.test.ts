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
  getBillDetail,
  kitchenQueue,
  moveTable,
  placeOrder,
  recordPayment,
  redeemPointsOnBill,
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
  deleteSegment,
  listSegments,
  registerCrmCapability,
  saveSegment,
  updateCustomer,
  mergeCustomers,
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
  async function runOneVisit(tableLabel: string, qty: number, phone: string = guestPhone): Promise<number> {
    const table = await executeCommand(manager, defineTable, { zoneId, label: tableLabel, seats: 2 });
    await executeCommand(manager, moveTable, { tableId: table.id, to: "occupied" });
    const order = await executeCommand(manager, createOrder, {
      tableId: table.id,
      covers: 2,
      customerName: "Ravi Regular",
      customerPhone: phone,
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

  it("edits a guest's details, clears a field with null, and never touches the phone (Task 125 5.1)", async () => {
    const customer = (await executeQuery(manager, getCustomer360, { phone: guestPhone }))!;
    await executeCommand(manager, updateCustomer, {
      customerId: customer.id,
      name: "Ravi Regular Kumar",
      email: "ravi@example.com",
      birthday: "1990-03-14",
      marketingConsent: true,
    });
    const edited = (await executeQuery(manager, getCustomer360, { customerId: customer.id }))!;
    expect(edited).toMatchObject({ name: "Ravi Regular Kumar", email: "ravi@example.com", marketingConsent: true, phone: guestPhone });
    expect(edited.birthday?.toISOString().slice(0, 10)).toBe("1990-03-14");

    // Left out means unchanged; null clears.
    await executeCommand(manager, updateCustomer, { customerId: customer.id, email: null, birthday: null });
    const cleared = (await executeQuery(manager, getCustomer360, { customerId: customer.id }))!;
    expect(cleared).toMatchObject({ name: "Ravi Regular Kumar", email: null, birthday: null, marketingConsent: true });

    await expect(executeCommand(manager, updateCustomer, { customerId: customer.id, email: "not-an-email" })).rejects.toThrow();
  });

  it("merges a duplicate guest without rewriting history: one guest, both phones, one balance (Task 125 5.1)", async () => {
    const otherPhone = "9876511111";
    const keep = (await executeQuery(manager, getCustomer360, { phone: guestPhone }))!;
    const keepBalance = (await executeQuery(manager, getLoyaltyBalance, { customerId: keep.id })).balance;

    await runOneVisit("T-20", 3, otherPhone);
    const dup = (await executeQuery(manager, getCustomer360, { phone: otherPhone }))!;
    expect(dup.id).not.toBe(keep.id);
    const dupBalance = (await executeQuery(manager, getLoyaltyBalance, { customerId: dup.id })).balance;
    expect(dupBalance).toBeGreaterThan(0);

    const merged = await executeCommand(manager, mergeCustomers, { keepId: keep.id, mergeId: dup.id });
    expect(merged).toMatchObject({ id: keep.id, mergedPhone: otherPhone });

    // Reading either row gives the one guest, counting both phones.
    const after = (await executeQuery(manager, getCustomer360, { customerId: keep.id }))!;
    const viaDuplicate = (await executeQuery(manager, getCustomer360, { customerId: dup.id }))!;
    expect(viaDuplicate.id).toBe(keep.id);
    expect(after.mergedPhones).toEqual([otherPhone]);
    expect(after.orderCount).toBe(keep.orderCount + 1);
    expect(after.totalSpendMinor).toBeGreaterThan(keep.totalSpendMinor);
    expect((await executeQuery(manager, getLoyaltyBalance, { customerId: keep.id })).balance).toBe(keepBalance + dupBalance);

    // The duplicate is no longer listed on its own.
    const listed = await executeQuery(manager, listCustomers, {});
    expect(listed.some((c) => c.id === dup.id)).toBe(false);
    expect(listed.some((c) => c.id === keep.id)).toBe(true);

    // History is untouched: the duplicate row keeps its own ledger entry.
    const dupEntries = await withTenant(tenantId, (tx) => tx.loyaltyPointEntry.count({ where: { customerId: dup.id } }));
    expect(dupEntries).toBe(1);

    // A later visit on the merged phone earns for the kept guest.
    await runOneVisit("T-21", 1, otherPhone);
    const keptNow = (await executeQuery(manager, getLoyaltyBalance, { customerId: keep.id })).balance;
    expect(keptNow).toBeGreaterThan(keepBalance + dupBalance);
    expect(await withTenant(tenantId, (tx) => tx.loyaltyPointEntry.count({ where: { customerId: dup.id } }))).toBe(1);

    // Refusals: itself, an already merged guest, and keeping a merged row.
    await expect(executeCommand(manager, mergeCustomers, { keepId: keep.id, mergeId: keep.id })).rejects.toThrow(/two different guests/);
    await expect(executeCommand(manager, mergeCustomers, { keepId: keep.id, mergeId: dup.id })).rejects.toThrow(/already merged/);
    await expect(executeCommand(manager, mergeCustomers, { keepId: dup.id, mergeId: keep.id })).rejects.toThrow(/itself merged/);
  });

  it("saves a segment as a filter, not a list, and rejects duplicates and empty filters (Task 125 5.2)", async () => {
    const saved = await executeCommand(manager, saveSegment, { name: "Regulars", minVisits: 2 });
    await executeCommand(manager, saveSegment, { name: "Big spenders gone quiet", minSpendMinor: 100_000, daysSinceLastOrder: 30 });

    const segments = await executeQuery(manager, listSegments, {});
    expect(segments.map((s) => s.name)).toEqual(["Big spenders gone quiet", "Regulars"]);
    const regulars = segments.find((s) => s.id === saved.id)!;
    expect(regulars).toMatchObject({ minVisits: 2, minSpendMinor: null, daysSinceLastOrder: null });

    // The saved filter gives the same guests as typing it: membership is live, not stored.
    const live = await executeQuery(manager, listCustomers, { minVisits: regulars.minVisits ?? undefined });
    expect(live.some((c) => c.phone === guestPhone)).toBe(true);

    await expect(executeCommand(manager, saveSegment, { name: "Regulars", minVisits: 5 })).rejects.toThrow(/already exists/);
    await expect(executeCommand(manager, saveSegment, { name: "Everyone" })).rejects.toThrow();

    await executeCommand(manager, deleteSegment, { segmentId: saved.id });
    expect((await executeQuery(manager, listSegments, {})).map((s) => s.name)).toEqual(["Big spenders gone quiet"]);
    // Deleting a segment never touches a guest.
    expect((await executeQuery(manager, getCustomer360, { phone: guestPhone }))).not.toBeNull();
  });

  it("spends points as a discount on an open bill in one step, and does not stack (Task 125 5.3)", async () => {
    await runOneVisit("T-10", 20); // earns points for the guest
    const customer = (await executeQuery(manager, getCustomer360, { phone: guestPhone }))!;
    const startBalance = (await executeQuery(manager, getLoyaltyBalance, { customerId: customer.id })).balance;
    expect(startBalance).toBeGreaterThan(0);

    // A second visit, billed but not yet paid.
    const table = await executeCommand(manager, defineTable, { zoneId, label: "T-11", seats: 2 });
    await executeCommand(manager, moveTable, { tableId: table.id, to: "occupied" });
    const order = await executeCommand(manager, createOrder, { tableId: table.id, covers: 2, customerName: "Ravi Regular", customerPhone: guestPhone });
    await executeCommand(manager, addOrderLines, { orderId: order.id, lines: [{ itemId: kebabItemId, qty: 2 }] });
    await executeCommand(manager, placeOrder, { orderId: order.id });
    const queue = await executeQuery(manager, kitchenQueue, {});
    for (const ticket of queue.filter((t) => t.orderId === order.id)) {
      for (const to of ["preparing", "ready", "served"] as const) await executeCommand(manager, advanceOrderLine, { lineId: ticket.lineId, to });
    }
    const bill = await executeCommand(manager, generateBill, { orderId: order.id });

    const offered = (await executeQuery(manager, getBillDetail, { billId: bill.id }))!.redeemable;
    expect(offered).not.toBeNull();
    // 2 x Rs 250 = 50,000 paise subtotal; 20 paise a point caps the bill at 2,500 points.
    expect(offered!.maxPoints).toBe(Math.min(startBalance, 2_500));

    const redeemed = await executeCommand(manager, redeemPointsOnBill, { billId: bill.id, points: offered!.maxPoints });
    expect(redeemed.valueMinor).toBe(offered!.maxPoints * 20);
    const after = (await executeQuery(manager, getBillDetail, { billId: bill.id }))!;
    expect(after.discountMinor).toBe(redeemed.valueMinor);
    expect(after.redeemable).toBeNull();
    expect((await executeQuery(manager, getLoyaltyBalance, { customerId: customer.id })).balance).toBe(startBalance - offered!.maxPoints);

    // The same bill cannot be discounted twice, and the points are not taken again.
    await expect(executeCommand(manager, redeemPointsOnBill, { billId: bill.id, points: 1 })).rejects.toThrow(/do not stack/);
    expect((await executeQuery(manager, getLoyaltyBalance, { customerId: customer.id })).balance).toBe(startBalance - offered!.maxPoints);
  });
});
