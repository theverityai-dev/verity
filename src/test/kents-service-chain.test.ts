import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/platform/db";
import { assertRlsEnforceable, withTenant } from "@/server/platform/tenancy";
import {
  activateCapability,
  invalidateCapabilityCache,
  setConfig,
} from "@/server/platform/capability";
import {
  clearCommands,
  clearHooks,
  executeCommand,
  type ActorContext,
} from "@/server/platform/command";
import { clearQueries, executeQuery } from "@/server/platform/query";
import { clearScopeResolvers } from "@/server/platform/authorization";
import { clearTransitionGuards } from "@/server/platform/state";
import { clearContributions, runDueWork } from "@/server/platform/contribution";
import { provisionIdentity } from "@/server/platform/identity";
import {
  CONFIG_CGST_RATE,
  CONFIG_PREP_TARGET_MINUTES,
  CONFIG_SGST_RATE,
  DINEIN_CAPABILITY,
  ENTITY_BILL,
  ENTITY_MENU_CATEGORY,
  ENTITY_MENU_ITEM,
  ENTITY_MENU_VARIANT,
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
  listFloor,
  listMenu,
  moveTable,
  placeOrder,
  recordPayment,
  registerDineinCapability,
  salesSummary,
  settleBill,
} from "@/server/capabilities/dinein";

/**
 * Kent's Restaurant — one dinner service, end to end.
 *
 * A FIXTURE, not seed data. It builds a realistic restaurant inside a temporary
 * tenant, runs a service through it, and destroys the tenant afterwards. No
 * demo restaurant exists in the application, and none is left behind here — a
 * fake business in a real database is the thing PLATFORM-FREEZE forbids, and a
 * fixture that survived its own run would become one.
 *
 * The other dine-in suite asserts each rule in isolation. This one asserts the
 * shape of an evening:
 *
 *   menu → table → order → kitchen → preparation → bill → payment → report
 *
 * That distinction matters because the failures a restaurant actually suffers
 * are sequencing failures. Every individual command can be correct while the
 * service still ends with a settled bill on a table that still says occupied.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  const message = "kents-service-chain.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describeDb("Kent's Restaurant: one service, end to end", () => {
  const tenantId = randomUUID();

  let organizationId: string;
  // A floor belongs to an outlet (multi-outlet change); one outlet is enough here.
  let locationId: string;
  let owner: ActorContext;
  let waiter: ActorContext;
  let cook: ActorContext;
  let cashier: ActorContext;

  const menu: Record<string, string> = {};
  const tables: Record<string, string> = {};

  beforeAll(async () => {
    await assertRlsEnforceable();
    clearCommands();
    clearQueries();
    clearHooks();
    clearScopeResolvers();
    clearTransitionGuards();
    clearContributions();
    registerDineinCapability();

    await withTenant(tenantId, async (tx) => {
      // The tenant Kent's would actually have: one legal business, one outlet,
      // its own clock. Asia/Kolkata is stated, never inferred — a wrong zone
      // misplaces every service day by the offset.
      await tx.tenant.create({
        data: { id: tenantId, name: "Kent's Restaurant (fixture)", timeZone: "Asia/Kolkata" },
      });
      await activateCapability(tx, tenantId, DINEIN_CAPABILITY);

      organizationId = (
        await tx.organization.create({ data: { tenantId, name: "Defence Colony" } })
      ).id;
      locationId = (
        await tx.location.create({ data: { tenantId, organizationId, name: "Defence Colony" } })
      ).id;

      await setConfig(tx, tenantId, CONFIG_CGST_RATE, 2.5, "Tenant");
      await setConfig(tx, tenantId, CONFIG_SGST_RATE, 2.5, "Tenant");
      await setConfig(tx, tenantId, CONFIG_PREP_TARGET_MINUTES, 12, "Tenant");

      // A prep target, so the kitchen board has something to be late against.
      await tx.slaPolicy.create({
        data: {
          tenantId,
          entityKey: ENTITY_ORDER_LINE,
          name: "Kitchen prep target",
          targetMinutes: 12,
        },
      });

      // The four roles Kent's runs on, each holding what that job needs and
      // nothing else. This is where "a waiter cannot take money" becomes true.
      const roles: Record<string, string> = {};
      for (const name of ["Owner", "Waiter", "Cook", "Cashier"]) {
        roles[name] = (
          await tx.role.create({ data: { tenantId, name }, select: { id: true } })
        ).id;
      }

      const grants: Array<{ role: string; verb: "Read" | "Create" | "Edit" | "ActionExecute"; entity: string }> = [];
      const everything = [
        ENTITY_MENU_CATEGORY,
        ENTITY_MENU_ITEM,
        ENTITY_MENU_VARIANT,
        ENTITY_ZONE,
        ENTITY_TABLE,
        ENTITY_ORDER,
        ENTITY_ORDER_LINE,
        ENTITY_BILL,
        ENTITY_PAYMENT,
      ];
      for (const entity of everything) {
        for (const verb of ["Read", "Create", "Edit", "ActionExecute"] as const) {
          grants.push({ role: "Owner", verb, entity });
        }
      }

      // Waiter: the floor and the order pad.
      grants.push(
        { role: "Waiter", verb: "Read", entity: ENTITY_MENU_ITEM },
        { role: "Waiter", verb: "Read", entity: ENTITY_TABLE },
        { role: "Waiter", verb: "ActionExecute", entity: ENTITY_TABLE },
        { role: "Waiter", verb: "Read", entity: ENTITY_ORDER },
        { role: "Waiter", verb: "Create", entity: ENTITY_ORDER },
        { role: "Waiter", verb: "Edit", entity: ENTITY_ORDER },
        { role: "Waiter", verb: "ActionExecute", entity: ENTITY_ORDER },
        { role: "Waiter", verb: "Read", entity: ENTITY_ORDER_LINE },
        { role: "Waiter", verb: "ActionExecute", entity: ENTITY_ORDER_LINE },
      );

      // Cook: the board. No bills — revenue is none of the kitchen's business,
      // and a tablet by a stove should carry as little as possible.
      grants.push(
        { role: "Cook", verb: "Read", entity: ENTITY_ORDER_LINE },
        { role: "Cook", verb: "ActionExecute", entity: ENTITY_ORDER_LINE },
        { role: "Cook", verb: "Read", entity: ENTITY_ORDER },
        { role: "Cook", verb: "Read", entity: ENTITY_TABLE },
      );

      // Cashier: the till.
      grants.push(
        { role: "Cashier", verb: "Read", entity: ENTITY_ORDER },
        { role: "Cashier", verb: "Read", entity: ENTITY_ORDER_LINE },
        { role: "Cashier", verb: "Read", entity: ENTITY_TABLE },
        { role: "Cashier", verb: "Read", entity: ENTITY_BILL },
        { role: "Cashier", verb: "Create", entity: ENTITY_BILL },
        { role: "Cashier", verb: "ActionExecute", entity: ENTITY_BILL },
        { role: "Cashier", verb: "Read", entity: ENTITY_PAYMENT },
        { role: "Cashier", verb: "Create", entity: ENTITY_PAYMENT },
      );

      await tx.permission.createMany({
        data: grants.map((grant) => ({
          tenantId,
          roleId: roles[grant.role]!,
          verb: grant.verb,
          entity: grant.entity,
          scope: "Tenant" as const,
        })),
      });

      const staff: Record<string, ActorContext> = {};
      for (const [role, displayName] of [
        ["Owner", "Kent"],
        ["Waiter", "Ravi"],
        ["Cook", "Anita"],
        ["Cashier", "Meera"],
      ] as const) {
        const identity = await provisionIdentity(tx, {
          organizationId,
          authUserId: randomUUID(),
          displayName,
        });
        await tx.tenantMembership.update({
          where: { id: identity.membershipId },
          data: { roleId: roles[role]! },
        });
        staff[role] = {
          tenantId,
          userId: identity.userId,
          membershipId: identity.membershipId,
          organizationId,
          roleId: roles[role]!,
        };
      }

      owner = staff.Owner!;
      waiter = staff.Waiter!;
      cook = staff.Cook!;
      cashier = staff.Cashier!;
    });

    invalidateCapabilityCache();
  });

  afterAll(async () => {
    clearCommands();
    clearQueries();
    clearHooks();
    clearScopeResolvers();
    clearTransitionGuards();
    clearContributions();

    // The restaurant is destroyed. Cascades take the menu, floor, orders, bills
    // and payments with the tenant; the identities are removed once no
    // membership holds them. Nothing this fixture built survives the run.
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      await admin.$executeRaw`DELETE FROM tenant WHERE id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM "user" WHERE id NOT IN (SELECT user_id FROM tenant_membership)`;
      await admin.$executeRaw`DELETE FROM party WHERE id NOT IN (SELECT party_id FROM "user")`;

      const [remaining] = await admin.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) AS n FROM tenant WHERE id = ${tenantId}::uuid`;
      expect(Number(remaining?.n ?? 0)).toBe(0);
    } finally {
      await admin.$disconnect();
    }
    await prisma.$disconnect();
  });

  /* ------------------------------ 1. the menu ----------------------------- */

  it("opens: the owner builds a menu and lays out the floor", async () => {
    const mains = await executeCommand(owner, createMenuCategory, { name: "Mains", sortOrder: 1 });
    const breads = await executeCommand(owner, createMenuCategory, { name: "Breads", sortOrder: 2 });

    menu.paneer = (
      await executeCommand(owner, createMenuItem, {
        categoryId: mains.id,
        name: "Paneer Butter Masala",
        priceMinor: 42_000,
        costMinor: 14_000,
      })
    ).id;
    menu.dal = (
      await executeCommand(owner, createMenuItem, {
        categoryId: mains.id,
        name: "Dal Makhani",
        priceMinor: 38_000,
      })
    ).id;
    menu.naan = (
      await executeCommand(owner, createMenuItem, {
        categoryId: breads.id,
        name: "Butter Naan",
        priceMinor: 8_000,
      })
    ).id;

    const ground = await executeCommand(owner, defineZone, { locationId, name: "Ground Floor" });
    tables.four = (
      await executeCommand(owner, defineTable, {
        zoneId: ground.id,
        label: "T-4",
        seats: 4,
        posX: 40,
        posY: 40,
      })
    ).id;
    tables.nine = (
      await executeCommand(owner, defineTable, {
        zoneId: ground.id,
        label: "T-9",
        seats: 2,
        posX: 200,
        posY: 40,
      })
    ).id;

    // A waiter reads the same menu the owner wrote, without being able to write
    // it — the read is the one they will use all evening.
    const visible = await executeQuery(waiter, listMenu, {});
    expect(visible.flatMap((category) => category.items).map((item) => item.name)).toEqual(
      expect.arrayContaining(["Paneer Butter Masala", "Dal Makhani", "Butter Naan"]),
    );

    const floor = await executeQuery(waiter, listFloor, {});
    expect(floor).toHaveLength(2);
    expect(floor.every((table) => table.state === "available")).toBe(true);
  });

  /* --------------------------- 2. guests arrive --------------------------- */

  it("seats a table and takes an order", async () => {
    await executeCommand(waiter, moveTable, { tableId: tables.four!, to: "occupied" });

    const order = await executeCommand(waiter, createOrder, {
      tableId: tables.four!,
      covers: 3,
    });
    menu.orderId = order.id;

    await executeCommand(waiter, addOrderLines, {
      orderId: order.id,
      lines: [
        { itemId: menu.paneer!, qty: 1 },
        { itemId: menu.dal!, qty: 1, lineNote: "less spice" },
        { itemId: menu.naan!, qty: 4 },
      ],
    });

    const placed = await executeCommand(waiter, placeOrder, { orderId: order.id });
    expect(placed.lines).toBe(3);

    // The floor now shows a working table, not merely a flag.
    const floor = await executeQuery(waiter, listFloor, {});
    const seated = floor.find((table) => table.id === tables.four);
    expect(seated?.state).toBe("occupied");
    expect(seated?.covers).toBe(3);
    expect(seated?.openLines).toBe(3);
  });

  /* ------------------------------ 3. the pass ----------------------------- */

  it("cooks the order, one line at a time, and the clocks follow", async () => {
    const queue = await executeQuery(cook, kitchenQueue, {});
    expect(queue).toHaveLength(3);
    // Waiting is not late: a queued line is Pending, and a Pending state does
    // not burn the prep budget.
    expect(queue.every((ticket) => ticket.state === "queued")).toBe(true);
    expect(queue.every((ticket) => ticket.urgency === "none" || ticket.urgency === "low")).toBe(
      true,
    );

    for (const ticket of queue) {
      await executeCommand(cook, advanceOrderLine, { lineId: ticket.lineId, to: "preparing" });
    }

    // Now the clocks run — and the capability wrote no clock code to make that
    // true. It declared honest categories and the substrate did the rest.
    const running = await withTenant(tenantId, (tx) =>
      tx.slaClock.findMany({ where: { entityKey: ENTITY_ORDER_LINE, status: "Running" } }),
    );
    expect(running).toHaveLength(3);

    for (const ticket of queue) {
      await executeCommand(cook, advanceOrderLine, { lineId: ticket.lineId, to: "ready" });
    }

    const stopped = await withTenant(tenantId, (tx) =>
      tx.slaClock.findMany({ where: { entityKey: ENTITY_ORDER_LINE, status: "Stopped" } }),
    );
    expect(stopped).toHaveLength(3);

    // The waiter is told, on the waiter's own account — not broadcast.
    const notifications = await withTenant(tenantId, (tx) =>
      tx.notification.findMany({ where: { recipientId: waiter.userId } }),
    );
    expect(notifications.length).toBeGreaterThanOrEqual(3);
  });

  /* ------------------------------ 4. service ------------------------------ */

  it("serves the food and the order closes itself", async () => {
    const ready = await executeQuery(waiter, kitchenQueue, {});
    expect(ready.every((ticket) => ticket.state === "ready")).toBe(true);

    let orderState = "";
    for (const ticket of ready) {
      const result = await executeCommand(waiter, advanceOrderLine, {
        lineId: ticket.lineId,
        to: "served",
      });
      orderState = result.orderState;
    }

    // Nobody closed the order by hand. The last dish did it.
    expect(orderState).toBe("served");
  });

  /* ------------------------------- 5. the bill ---------------------------- */

  it("bills, takes payment in two parts, and turns the table", async () => {
    const bill = await executeCommand(cashier, generateBill, { orderId: menu.orderId! });

    // 420 + 380 + 4×80 = 1120 rupees, plus 2.5% + 2.5%, rounded to the rupee.
    const detail = await executeQuery(cashier, getBillDetail, { billId: bill.id });
    expect(detail?.subtotalMinor).toBe(112_000);
    expect(detail?.cgstMinor).toBe(2_800);
    expect(detail?.sgstMinor).toBe(2_800);
    expect(detail?.totalMinor).toBe(117_600);
    // The rate is on the bill, not merely in the total (PRN-001).
    expect(detail?.cgstRate).toBe(2.5);

    await executeCommand(cashier, recordPayment, {
      billId: bill.id,
      method: "cash",
      amountMinor: 60_000,
    });
    const settled = await executeCommand(cashier, recordPayment, {
      billId: bill.id,
      method: "upi",
      amountMinor: 57_600,
      reference: "UPI-KENT-0001",
    });
    expect(settled.outstandingMinor).toBe(0);

    const closed = await executeCommand(cashier, settleBill, { billId: bill.id });
    expect(closed.tableState).toBe("cleaning");

    // The failure a restaurant actually fears: a paid bill on a table the floor
    // still shows as occupied.
    const floor = await executeQuery(waiter, listFloor, {});
    const table = floor.find((candidate) => candidate.id === tables.four);
    expect(table?.state).toBe("cleaning");
    expect(table?.orderId).toBeNull();

    await executeCommand(waiter, moveTable, { tableId: tables.four!, to: "available" });
  });

  /* ----------------------------- 6. the report ---------------------------- */

  it("reports the evening, and only what was actually taken", async () => {
    const summary = await executeQuery(owner, salesSummary, {});

    expect(summary.billsSettled).toBe(1);
    expect(summary.grossMinor).toBe(117_600);
    expect(summary.taxMinor).toBe(5_600);

    // Payment methods add up to the takings, because both come from the same
    // recorded rows rather than from two calculations that agree by luck.
    const paid = summary.byMethod.reduce((sum, row) => sum + row.amountMinor, 0);
    expect(paid).toBe(summary.grossMinor);

    expect(summary.topItems.map((item) => item.itemName)).toEqual(
      expect.arrayContaining(["Paneer Butter Masala", "Dal Makhani", "Butter Naan"]),
    );
  });

  /* --------------------------- 7. scheduled work -------------------------- */

  it("sweeps a late dish when the scheduler calls, and again without changing it", async () => {
    // A second table, sent to the kitchen and left there.
    await executeCommand(waiter, moveTable, { tableId: tables.nine!, to: "occupied" });
    const order = await executeCommand(waiter, createOrder, { tableId: tables.nine!, covers: 2 });
    await executeCommand(waiter, addOrderLines, {
      orderId: order.id,
      lines: [{ itemId: menu.dal!, qty: 1 }],
    });
    await executeCommand(waiter, placeOrder, { orderId: order.id });

    const queue = (await executeQuery(cook, kitchenQueue, {})).filter(
      (ticket) => ticket.orderId === order.id,
    );
    await executeCommand(cook, advanceOrderLine, { lineId: queue[0]!.lineId, to: "preparing" });

    // Push its deadline into the past: the point is what the SWEEP does, not
    // waiting twelve real minutes to find out.
    await withTenant(tenantId, (tx) =>
      tx.slaClock.updateMany({
        where: { entityKey: ENTITY_ORDER_LINE, entityId: queue[0]!.lineId },
        data: { deadlineAt: new Date(Date.now() - 60_000) },
      }),
    );

    const first = await runDueWork({
      tenantId,
      activeCapabilityIds: [DINEIN_CAPABILITY],
      cadence: "frequent",
    });
    const sweep = first.find((outcome) => outcome.key === "verity.dinein.sweep_prep_breaches");
    expect(sweep?.status).toBe("ok");
    expect(sweep?.events).toBeGreaterThan(0);

    const breached = await withTenant(tenantId, (tx) =>
      tx.slaClock.findMany({ where: { status: "Breached" } }),
    );
    expect(breached).toHaveLength(1);

    // Run it again. Every real scheduler retries, and the second pass must find
    // nothing left to do rather than breaching the same clock twice.
    const second = await runDueWork({
      tenantId,
      activeCapabilityIds: [DINEIN_CAPABILITY],
      cadence: "frequent",
    });
    expect(
      second.find((outcome) => outcome.key === "verity.dinein.sweep_prep_breaches")?.events,
    ).toBe(0);

    const stillOne = await withTenant(tenantId, (tx) =>
      tx.slaClock.findMany({ where: { status: "Breached" } }),
    );
    expect(stillOne).toHaveLength(1);

    // The breach survives being finished late — history is not laundered.
    await executeCommand(cook, advanceOrderLine, { lineId: queue[0]!.lineId, to: "ready" });
    const afterService = await withTenant(tenantId, (tx) =>
      tx.slaClock.findFirst({ where: { entityId: queue[0]!.lineId } }),
    );
    expect(afterService?.breachedAt).not.toBeNull();
  });

  /* ------------------------------ 8. the audit ---------------------------- */

  it("leaves a trail of what happened, by whom", async () => {
    const activity = await withTenant(tenantId, (tx) =>
      tx.activity.findMany({ orderBy: { occurredAt: "asc" } }),
    );

    const commands = new Set(activity.map((row) => row.commandKey));
    expect(commands).toContain("verity.dinein.place_order");
    expect(commands).toContain("verity.dinein.advance_order_line");
    expect(commands).toContain("verity.dinein.settle_bill");

    // Every row names an actor. "Who settled table 4" is a query, not an
    // investigation.
    expect(activity.every((row) => row.actorUserId !== null)).toBe(true);

    const events = await withTenant(tenantId, (tx) => tx.domainEvent.findMany());
    expect(events.map((event) => event.name)).toEqual(
      expect.arrayContaining([
        "verity.dinein.order_created",
        "verity.dinein.bill_generated",
      ]),
    );
  });
});
