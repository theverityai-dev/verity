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
  ENTITY_CASH_RECONCILIATION,
  ENTITY_EXPENSE,
  FINANCE_CAPABILITY,
  decideExpense,
  getOutletPnL,
  listExpenses,
  recordCashReconciliation,
  recordExpense,
  registerFinanceCapability,
} from "@/server/capabilities/finance";

/** CAPABILITY: Finance — expense approve/reject, cash reconciliation
 * variance detection, and a lean Outlet P&L computed from real settled
 * sales and approved expenses (§44-46, 48-49). */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  const message = "capability-finance.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describeDb("capability: Finance", () => {
  const tenantId = randomUUID();

  let organizationId: string;
  let locationId: string;
  let manager: ActorContext;
  let zoneId: string;
  let kebabItemId: string;
  const today = new Date().toISOString().slice(0, 10);

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
    registerFinanceCapability();

    await withTenant(tenantId, async (tx) => {
      await tx.tenant.create({
        data: { id: tenantId, name: "Colonel Kebabz Finance Test", timeZone: "Asia/Kolkata" },
      });
      await activateCapability(tx, tenantId, LOCATION_CAPABILITY);
      await activateCapability(tx, tenantId, DINEIN_CAPABILITY);
      await activateCapability(tx, tenantId, FINANCE_CAPABILITY);

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
        ENTITY_EXPENSE,
        ENTITY_CASH_RECONCILIATION,
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

  it("approves an expense, reconciles cash with a variance, and computes a lean Outlet P&L", async () => {
    // One settled cash sale.
    const table = await executeCommand(manager, defineTable, { zoneId, label: "T-1", seats: 2 });
    await executeCommand(manager, moveTable, { tableId: table.id, to: "occupied" });
    const order = await executeCommand(manager, createOrder, { tableId: table.id, covers: 2 });
    await executeCommand(manager, addOrderLines, { orderId: order.id, lines: [{ itemId: kebabItemId, qty: 1 }] });
    await executeCommand(manager, placeOrder, { orderId: order.id });
    const queue = await executeQuery(manager, kitchenQueue, {});
    const ticket = queue.find((t) => t.orderId === order.id)!;
    await executeCommand(manager, advanceOrderLine, { lineId: ticket.lineId, to: "preparing" });
    await executeCommand(manager, advanceOrderLine, { lineId: ticket.lineId, to: "ready" });
    await executeCommand(manager, advanceOrderLine, { lineId: ticket.lineId, to: "served" });
    const bill = await executeCommand(manager, generateBill, { orderId: order.id });
    await executeCommand(manager, recordPayment, { billId: bill.id, method: "cash", amountMinor: bill.totalMinor });
    await executeCommand(manager, settleBill, { billId: bill.id });

    // A settled bill is closed; a refund sits beside it. It cannot exceed what
    // the bill took in, needs a reason, and never edits the bill.
    await expect(
      executeCommand(manager, refundBill, { billId: bill.id, amountMinor: bill.totalMinor + 1, method: "cash", reason: "Cold food" }),
    ).rejects.toThrow(/still refundable/);
    await expect(
      executeCommand(manager, refundBill, { billId: bill.id, amountMinor: 1_000, method: "cash", reason: " " }),
    ).rejects.toThrow();
    const refund = await executeCommand(manager, refundBill, {
      billId: bill.id, amountMinor: 1_000, method: "cash", reason: "Cold food, guest complaint",
    });
    expect(refund.refundableMinor).toBe(bill.totalMinor - 1_000);
    await expect(
      executeCommand(manager, refundBill, { billId: bill.id, amountMinor: bill.totalMinor, method: "cash", reason: "Again" }),
    ).rejects.toThrow(/still refundable/);

    // One approved cash expense.
    const expense = await executeCommand(manager, recordExpense, {
      locationId,
      category: "Cleaning",
      amountMinor: 5_000,
      paymentMethod: "Cash",
      expenseDate: today,
    });
    await executeCommand(manager, decideExpense, { expenseId: expense.id, approve: true });

    const listed = await executeQuery(manager, listExpenses, { locationId, status: "Approved" });
    expect(listed.some((e) => e.id === expense.id)).toBe(true);

    // Cash reconciliation: opening 10000, +cashSales(bill.totalMinor), -5000 expense,
    // no withdrawals. Actual is short by 100 paise -- must carry a note.
    // The Rs 10 cash refund left the drawer, so it is not there to count.
    const expected = 10_000 + bill.totalMinor - 1_000 - 5_000;
    await expect(
      executeCommand(manager, recordCashReconciliation, {
        locationId,
        date: today,
        openingCashMinor: 10_000,
        actualCashMinor: expected - 100,
      }),
    ).rejects.toThrow(/variance requires an explanation/);

    const reconciled = await executeCommand(manager, recordCashReconciliation, {
      locationId,
      date: today,
      openingCashMinor: 10_000,
      actualCashMinor: expected - 100,
      varianceNote: "Till was short, investigating",
    });
    expect(reconciled.expectedCashMinor).toBe(expected);
    expect(reconciled.varianceMinor).toBe(-100);

    const pnl = await executeQuery(manager, getOutletPnL, { locationId, fromDate: today, toDate: today });
    expect(pnl.revenueMinor).toBe(bill.totalMinor - 1_000);
    expect(pnl.refundsMinor).toBe(1_000);
    expect(pnl.totalExpensesMinor).toBe(5_000);
    expect(pnl.cogsIsApproximate).toBe(true);
    expect(pnl.operatingContributionMinor).toBe(pnl.grossProfitMinor - 5_000);
  });

  it("shows the labour line only to a role that may read compensation (DECISIONS.md #3)", async () => {
    // The manager has no Read on compensation: the line is hidden, not zero.
    const hidden = await executeQuery(manager, getOutletPnL, { locationId, fromDate: today, toDate: today });
    expect(hidden.labour).toBeNull();
    expect(hidden.contributionAfterLabourMinor).toBeNull();

    const owner = await withTenant(tenantId, async (tx): Promise<ActorContext> => {
      const role = await tx.role.create({ data: { tenantId, name: "Owner" }, select: { id: true } });
      await tx.permission.createMany({
        data: [ENTITY_EXPENSE, "verity.hr.compensation"].map((entity) => ({
          tenantId,
          roleId: role.id,
          verb: "Read" as const,
          entity,
          scope: "Tenant" as const,
        })),
      });
      const identity = await provisionIdentity(tx, { organizationId, authUserId: randomUUID(), displayName: "Owner" });
      await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId: role.id } });
      const cook = await provisionIdentity(tx, { organizationId, authUserId: randomUUID(), displayName: "Cook" });
      const employee = await tx.hrEmployee.create({ data: { tenantId, partyId: cook.partyId, monthlySalaryMinor: 3_000_000 } });
      await tx.shift.create({
        data: { tenantId, locationId, employeeId: employee.id, date: new Date(today), label: "Day", startTime: "09:00", endTime: "17:00" },
      });
      return { tenantId, userId: identity.userId, membershipId: identity.membershipId, organizationId, roleId: role.id };
    });

    // One day of a 30-day month at one outlet: 3,000,000 / 30.
    const shown = await executeQuery(owner, getOutletPnL, { locationId, fromDate: today, toDate: today });
    expect(shown.labour).toEqual({ labourMinor: 100_000, placed: 1, unplaced: 0 });
    expect(shown.contributionAfterLabourMinor).toBe(shown.operatingContributionMinor - 100_000);
  });
});
