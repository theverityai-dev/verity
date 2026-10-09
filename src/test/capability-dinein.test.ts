import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { minuteOfDay } from "@/lib/menu-availability";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/platform/db";
import { assertRlsEnforceable, withTenant } from "@/server/platform/tenancy";
import { activateCapability, invalidateCapabilityCache, setConfig } from "@/server/platform/capability";
import {
  clearCommands,
  clearHooks,
  executeCommand,
  type ActorContext,
} from "@/server/platform/command";
import { clearQueries, executeQuery } from "@/server/platform/query";
import { ForbiddenError, clearScopeResolvers } from "@/server/platform/authorization";
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
  ENTITY_MENU_VARIANT,
  ENTITY_ORDER,
  ENTITY_ORDER_LINE,
  ENTITY_PAYMENT,
  ENTITY_TABLE,
  ENTITY_ZONE,
  addOrderLines,
  advanceOrderLine,
  applyBillDiscount,
  cancelOrder,
  computeBillTotals,
  createMenuCategory,
  createMenuItem,
  createMenuModifier,
  createMenuVariant,
  createOrder,
  defineTable,
  editMenuItem,
  defineZone,
  acknowledgeCancelledLine,
  checklistToday,
  getKitchenTicket,
  kitchenCancelled,
  listKitchenSetup,
  listUnprintedTickets,
  recordTicketPrint,
  saveKitchenStation,
  saveMenuCourse,
  setStationCategories,
  gstSummary,
  saveOutletProfile,
  waiveServiceCharge,
  refundBill,
  exceptionsReport,
  handOverOrder,
  setChecklistSteps,
  tickChecklistStep,
  listHandoverTargets,
  outletToday,
  positionTable,
  salesReport,
  generateBill,
  getBillDetail,
  getOrderDetail,
  kitchenQueue,
  listFloor,
  listMenu,
  listMenuItemPriceHistory,
  listOrderHistory,
  listTableChangeTargets,
  mergeOrders,
  moveOrderToTable,
  moveTable,
  placeOrder,
  setMenuItemAvailability,
  setOrderLineQty,
  recordPayment,
  registerDineinCapability,
  salesSummary,
  setMenuItemActive,
  setMenuModifierActive,
  settleBill,
  voidOrderLine,
} from "@/server/capabilities/dinein";

/**
 * CAPABILITY: Dine-in — the first real client requirement.
 *
 * Requirement source: KentsRestaurant.md. This asserts the service chain a
 * restaurant actually runs — seat, order, send, cook, serve, bill, pay, turn the
 * table — plus the refusals that keep the money honest.
 *
 * The chain matters more than any individual command: the failure mode a
 * restaurant fears is not "the button errored", it is a settled bill whose table
 * still shows occupied at nine o'clock.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  const message = "capability-dinein.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

// A full service is twenty-odd commands, each a transaction against a remote
// pooled database. That is latency, not slowness in the code — and the default
// five-second timeout measures the network rather than the capability.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describeDb("capability: Dine-in", () => {
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();

  let organizationId: string;
  let locationId: string;
  let manager: ActorContext;
  let waiter: ActorContext;
  let zoneId: string;
  let tableId: string;
  let paneerId: string;
  let naanId: string;
  let naanFullVariantId: string;

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
      await tx.tenant.create({
        data: { id: tenantId, name: "Kent's Test Kitchen", timeZone: "Asia/Kolkata" },
      });
      await activateCapability(tx, tenantId, DINEIN_CAPABILITY);

      organizationId = (
        await tx.organization.create({ data: { tenantId, name: "Defence Colony" } })
      ).id;
      locationId = (
        await tx.location.create({ data: { tenantId, organizationId, name: "Defence Colony" } })
      ).id;

      // GST as configuration. 2.5 + 2.5 is the restaurant rate; the arithmetic
      // is code, the rate is not.
      await setConfig(tx, tenantId, CONFIG_CGST_RATE, 2.5, "Tenant");
      await setConfig(tx, tenantId, CONFIG_SGST_RATE, 2.5, "Tenant");

      const managerRole = await tx.role.create({
        data: { tenantId, name: "Manager" },
        select: { id: true },
      });
      const waiterRole = await tx.role.create({
        data: { tenantId, name: "Waiter" },
        select: { id: true },
      });

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

      // A waiter serves. They do not price the menu, and they do not take money —
      // which is what makes the refusals below meaningful rather than decorative.
      await tx.permission.createMany({
        data: [
          { tenantId, roleId: waiterRole.id, verb: "Read", entity: ENTITY_MENU_ITEM, scope: "Tenant" },
          { tenantId, roleId: waiterRole.id, verb: "Read", entity: ENTITY_TABLE, scope: "Tenant" },
          { tenantId, roleId: waiterRole.id, verb: "ActionExecute", entity: ENTITY_TABLE, scope: "Tenant" },
          { tenantId, roleId: waiterRole.id, verb: "Read", entity: ENTITY_ORDER, scope: "Tenant" },
          { tenantId, roleId: waiterRole.id, verb: "Create", entity: ENTITY_ORDER, scope: "Tenant" },
          { tenantId, roleId: waiterRole.id, verb: "Edit", entity: ENTITY_ORDER, scope: "Tenant" },
          { tenantId, roleId: waiterRole.id, verb: "ActionExecute", entity: ENTITY_ORDER, scope: "Tenant" },
          { tenantId, roleId: waiterRole.id, verb: "Read", entity: ENTITY_ORDER_LINE, scope: "Tenant" },
          { tenantId, roleId: waiterRole.id, verb: "ActionExecute", entity: ENTITY_ORDER_LINE, scope: "Tenant" },
        ],
      });

      const managerIdentity = await provisionIdentity(tx, {
        organizationId,
        authUserId: randomUUID(),
        displayName: "Kent",
      });
      const waiterIdentity = await provisionIdentity(tx, {
        organizationId,
        authUserId: randomUUID(),
        displayName: "Ravi",
      });
      await tx.tenantMembership.update({
        where: { id: managerIdentity.membershipId },
        data: { roleId: managerRole.id },
      });
      await tx.tenantMembership.update({
        where: { id: waiterIdentity.membershipId },
        data: { roleId: waiterRole.id },
      });

      manager = {
        tenantId,
        userId: managerIdentity.userId,
        membershipId: managerIdentity.membershipId,
        organizationId,
        roleId: managerRole.id,
      };
      waiter = {
        tenantId,
        userId: waiterIdentity.userId,
        membershipId: waiterIdentity.membershipId,
        organizationId,
        roleId: waiterRole.id,
      };
    });

    await withTenant(otherTenantId, async (tx) => {
      await tx.tenant.create({ data: { id: otherTenantId, name: "Another Restaurant" } });
    });

    invalidateCapabilityCache();

    // The menu and the floor, through commands. Even a fixture goes through the
    // pipeline — a test that seeds by direct insert proves the pipeline works
    // for data the pipeline never touched.
    const category = await executeCommand(manager, createMenuCategory, { name: "Mains" });
    paneerId = (
      await executeCommand(manager, createMenuItem, {
        categoryId: category.id,
        name: "Paneer Butter Masala",
        priceMinor: 42_000,
        costMinor: 14_000,
      })
    ).id;
    naanId = (
      await executeCommand(manager, createMenuItem, {
        categoryId: category.id,
        name: "Butter Naan",
        priceMinor: 8_000,
      })
    ).id;
    naanFullVariantId = (
      await executeCommand(manager, createMenuVariant, {
        itemId: naanId,
        name: "Family portion",
        priceDeltaMinor: 4_000,
      })
    ).id;

    zoneId = (await executeCommand(manager, defineZone, { locationId, name: "Ground Floor" })).id;
    tableId = (
      await executeCommand(manager, defineTable, { zoneId, label: "T-12", seats: 4 })
    ).id;
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
      await admin.$executeRaw`DELETE FROM "user" WHERE id NOT IN (SELECT user_id FROM tenant_membership)`;
      await admin.$executeRaw`DELETE FROM party WHERE id NOT IN (SELECT party_id FROM "user")`;
    } finally {
      await admin.$disconnect();
    }
    await prisma.$disconnect();
  });

  /* ---------------------------- the service chain --------------------------- */

  it("runs a whole service: seat, order, cook, serve, bill, pay, turn the table", async () => {
    // Seat.
    await seatTable();

    const order = await executeCommand(waiter, createOrder, { tableId, covers: 3 });

    await executeCommand(waiter, addOrderLines, {
      orderId: order.id,
      lines: [
        { itemId: paneerId, qty: 1 },
        { itemId: naanId, variantId: naanFullVariantId, qty: 2, lineNote: "less butter" },
      ],
    });

    const placed = await executeCommand(waiter, placeOrder, { orderId: order.id });
    expect(placed.lines).toBe(2);

    // Cook. The kitchen advances lines, not orders — a twelve-item order is not
    // done when one dish is.
    const queue = await executeQuery(manager, kitchenQueue, {});
    expect(queue).toHaveLength(2);
    expect(queue.every((ticket) => ticket.state === "queued")).toBe(true);

    for (const ticket of queue) {
      await executeCommand(manager, advanceOrderLine, { lineId: ticket.lineId, to: "preparing" });
      await executeCommand(manager, advanceOrderLine, { lineId: ticket.lineId, to: "ready" });
    }

    // Serve the first line: the order becomes partially served, not served.
    const partial = await executeCommand(waiter, advanceOrderLine, {
      lineId: queue[0]!.lineId,
      to: "served",
    });
    expect(partial.orderState).toBe("partially_served");

    // Serve the last one and the order closes itself. The waiter does not have
    // to remember to do it separately.
    const complete = await executeCommand(waiter, advanceOrderLine, {
      lineId: queue[1]!.lineId,
      to: "served",
    });
    expect(complete.orderState).toBe("served");

    // Bill. 420 + 2×120 = 660 rupees; 2.5% + 2.5% GST; rounded to the rupee.
    const bill = await executeCommand(manager, generateBill, { orderId: order.id });
    const detailed = await executeQuery(manager, getBillDetail, { billId: bill.id });
    expect(detailed?.subtotalMinor).toBe(66_000);
    expect(detailed?.cgstMinor).toBe(1_650);
    expect(detailed?.sgstMinor).toBe(1_650);
    expect(detailed?.totalMinor).toBe(69_300);
    expect(detailed?.outstandingMinor).toBe(69_300);

    // Pay in two parts, because tables do that.
    await executeCommand(manager, recordPayment, {
      billId: bill.id,
      method: "cash",
      amountMinor: 30_000,
    });
    const second = await executeCommand(manager, recordPayment, {
      billId: bill.id,
      method: "upi",
      amountMinor: 39_300,
      reference: "UPI-77231",
    });
    expect(second.outstandingMinor).toBe(0);

    // Settle — and the table turns.
    const settled = await executeCommand(manager, settleBill, { billId: bill.id });
    expect(settled.tableState).toBe("cleaning");

    const floor = await executeQuery(manager, listFloor, {});
    const seated = floor.find((table) => table.id === tableId);
    expect(seated?.state).toBe("cleaning");
    // The settled order is no longer the table's open order.
    expect(seated?.orderId).toBeNull();

    await executeCommand(manager, moveTable, { tableId, to: "available" });
  });

  /* ----------------------------- order channels ----------------------------- */

  it("runs a Zomato order with no table: kitchen, bill, platform payment, settle", async () => {
    const order = await executeCommand(waiter, createOrder, {
      channel: "delivery_platform",
      locationId,
      platform: "Zomato",
      platformOrderRef: "4821",
      customerName: "Asha",
    });
    await executeCommand(waiter, addOrderLines, {
      orderId: order.id,
      lines: [{ itemId: paneerId, qty: 1, lineNote: "no onion" }],
    });
    await executeCommand(waiter, placeOrder, { orderId: order.id });

    const detail = await executeQuery(manager, getOrderDetail, { orderId: order.id });
    expect(detail?.channel).toBe("delivery_platform");
    expect(detail?.tableId).toBeNull();
    expect(detail?.label).toBe("Zomato #4821");

    const ticket = (await executeQuery(manager, kitchenQueue, {})).find((t) => t.orderId === order.id)!;
    expect(ticket.label).toBe("Zomato #4821");
    expect(ticket.lineNote).toBe("no onion");
    await executeCommand(manager, advanceOrderLine, { lineId: ticket.lineId, to: "preparing" });
    await executeCommand(manager, advanceOrderLine, { lineId: ticket.lineId, to: "ready" });
    await executeCommand(waiter, advanceOrderLine, { lineId: ticket.lineId, to: "served" });

    const bill = await executeCommand(manager, generateBill, { orderId: order.id });
    const billed = await executeQuery(manager, getBillDetail, { billId: bill.id });
    await executeCommand(manager, recordPayment, {
      billId: bill.id,
      method: "delivery_platform",
      amountMinor: billed!.totalMinor,
    });
    // No table to turn over.
    const settled = await executeCommand(manager, settleBill, { billId: bill.id });
    expect(settled.tableState).toBeNull();
  });

  it("labels a takeaway order by channel and guest", async () => {
    const order = await executeCommand(waiter, createOrder, { channel: "takeaway", locationId, customerName: "Ravi" });
    const detail = await executeQuery(manager, getOrderDetail, { orderId: order.id });
    expect(detail?.label).toBe("Takeaway · Ravi");
    await executeCommand(waiter, cancelOrder, { orderId: order.id });
  });

  it("combines the same item on a draft order, lets the waiter change or remove it, and refuses once sent", async () => {
    const order = await executeCommand(waiter, createOrder, { channel: "takeaway", locationId, customerName: "Steps" });
    await executeCommand(waiter, addOrderLines, { orderId: order.id, lines: [{ itemId: paneerId, qty: 1 }] });
    await executeCommand(waiter, addOrderLines, { orderId: order.id, lines: [{ itemId: paneerId, qty: 2 }] });
    // A different note is a different dish for the kitchen, so it stays apart.
    await executeCommand(waiter, addOrderLines, { orderId: order.id, lines: [{ itemId: paneerId, qty: 1, lineNote: "no onion" }] });
    let detail = (await executeQuery(manager, getOrderDetail, { orderId: order.id }))!;
    const plain = detail.lines.find((l) => !l.lineNote)!;
    const noted = detail.lines.find((l) => l.lineNote)!;
    expect(detail.lines).toHaveLength(2);
    expect(plain.qty).toBe(3);

    await executeCommand(waiter, setOrderLineQty, { lineId: plain.id, qty: 5 });
    await executeCommand(waiter, setOrderLineQty, { lineId: noted.id, qty: 0 });
    detail = (await executeQuery(manager, getOrderDetail, { orderId: order.id }))!;
    expect(detail.lines.map((l) => l.qty)).toEqual([5]);

    await executeCommand(waiter, placeOrder, { orderId: order.id });
    await expect(executeCommand(waiter, setOrderLineQty, { lineId: plain.id, qty: 1 })).rejects.toThrow(/void it/);
    await executeCommand(manager, cancelOrder, { orderId: order.id, reason: "test cleanup" });
  });

  it("prices add-ons into the line, snapshots them, and keeps different add-on sets apart (Task 125 3.1)", async () => {
    const cheese = await executeCommand(manager, createMenuModifier, { itemId: paneerId, name: "Extra cheese", priceDeltaMinor: 3_000 });
    const spicy = await executeCommand(manager, createMenuModifier, { itemId: paneerId, name: "Extra spicy", priceDeltaMinor: 0 });
    const garlic = await executeCommand(manager, createMenuModifier, { itemId: naanId, name: "Garlic", priceDeltaMinor: 1_000 });

    const paneer = (await executeQuery(manager, listMenu, {})).flatMap((c) => c.items).find((i) => i.id === paneerId)!;
    expect(paneer.modifiers.map((m) => m.name)).toEqual(["Extra cheese", "Extra spicy"]);

    const order = await executeCommand(waiter, createOrder, { channel: "takeaway", locationId, customerName: "Mods" });
    await executeCommand(waiter, addOrderLines, { orderId: order.id, lines: [{ itemId: paneerId, qty: 1, modifierIds: [cheese.id] }] });
    // The same add-ons again combine, whatever order they are listed in.
    await executeCommand(waiter, addOrderLines, { orderId: order.id, lines: [{ itemId: paneerId, qty: 1, modifierIds: [cheese.id, cheese.id] }] });
    // A different set, and no add-ons at all, are different dishes for the kitchen.
    await executeCommand(waiter, addOrderLines, { orderId: order.id, lines: [{ itemId: paneerId, qty: 1, modifierIds: [spicy.id, cheese.id] }] });
    await executeCommand(waiter, addOrderLines, { orderId: order.id, lines: [{ itemId: paneerId, qty: 1 }] });

    const detail = (await executeQuery(manager, getOrderDetail, { orderId: order.id }))!;
    expect(detail.lines).toHaveLength(3);
    const byNames = (names: string[]) => detail.lines.find((l) => l.modifiers.map((m) => m.name).join("|") === names.join("|"))!;
    expect(byNames(["Extra cheese"])).toMatchObject({ qty: 2, unitPriceMinor: 42_000 + 3_000 });
    expect(byNames(["Extra cheese", "Extra spicy"])).toMatchObject({ qty: 1, unitPriceMinor: 42_000 + 3_000 });
    expect(byNames([])).toMatchObject({ qty: 1, unitPriceMinor: 42_000 });

    // An add-on belongs to its own item, a name is unique per item, and a free one is fine but not a negative one.
    await expect(executeCommand(waiter, addOrderLines, { orderId: order.id, lines: [{ itemId: paneerId, qty: 1, modifierIds: [garlic.id] }] })).rejects.toThrow(/does not belong/);
    await expect(executeCommand(manager, createMenuModifier, { itemId: paneerId, name: "Extra cheese", priceDeltaMinor: 100 })).rejects.toThrow(/already has/);
    await expect(executeCommand(manager, createMenuModifier, { itemId: paneerId, name: "Discount", priceDeltaMinor: -100 })).rejects.toThrow();

    // Retiring an add-on stops new orders but never rewrites the one already taken.
    await executeCommand(manager, setMenuModifierActive, { modifierId: cheese.id, active: false });
    await expect(executeCommand(waiter, addOrderLines, { orderId: order.id, lines: [{ itemId: paneerId, qty: 1, modifierIds: [cheese.id] }] })).rejects.toThrow(/not available/);
    expect(((await executeQuery(manager, getOrderDetail, { orderId: order.id }))!).lines.find((l) => l.modifiers.length === 1)!.unitPriceMinor).toBe(45_000);
    const afterRetire = (await executeQuery(manager, listMenu, {})).flatMap((c) => c.items).find((i) => i.id === paneerId)!;
    expect(afterRetire.modifiers.map((m) => m.name)).toEqual(["Extra spicy"]);

    // The kitchen reads the words; the bill carries what was charged.
    await executeCommand(waiter, placeOrder, { orderId: order.id });
    const tickets = (await executeQuery(manager, kitchenQueue, {})).filter((t) => t.orderId === order.id);
    expect(tickets.map((t) => t.modifiers.join("+")).sort()).toEqual(["", "Extra cheese", "Extra cheese+Extra spicy"]);
    await executeCommand(manager, cancelOrder, { orderId: order.id, reason: "test cleanup" });
  });

  it("keeps a price history from the audit trail: listed price, each change, when and by whom (Task 125 3.4)", async () => {
    const category = await executeCommand(manager, createMenuCategory, { name: "History Test" });
    const item = await executeCommand(manager, createMenuItem, { categoryId: category.id, name: "Seekh Roll", priceMinor: 18_000 });

    const fresh = (await executeQuery(manager, listMenuItemPriceHistory, { itemId: item.id }))!;
    expect(fresh.entries.map((e) => e.toMinor)).toEqual([18_000]);

    await executeCommand(manager, editMenuItem, { itemId: item.id, priceMinor: 20_000 });
    await executeCommand(manager, editMenuItem, { itemId: item.id, name: "Seekh Roll Large" }); // not a price change
    await executeCommand(manager, editMenuItem, { itemId: item.id, priceMinor: 22_000 });

    const history = (await executeQuery(manager, listMenuItemPriceHistory, { itemId: item.id }))!;
    expect(history.currentPriceMinor).toBe(22_000);
    expect(history.entries.map((e) => [e.fromMinor, e.toMinor])).toEqual([[null, 18_000], [18_000, 20_000], [20_000, 22_000]]);
    expect(history.entries[1]!.by).toBe("Kent"); // the manager in this file's fixtures
    const times = history.entries.map((e) => e.at.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times); // oldest first

    expect(await executeQuery(manager, listMenuItemPriceHistory, { itemId: randomUUID() })).toBeNull();
  });

  it("limits an item by channel, outlet and hours, says why, and refuses it at the till (Task 125 3.2, 3.3)", async () => {
    const category = await executeCommand(manager, createMenuCategory, { name: "Hours Test" });
    const item = await executeCommand(manager, createMenuItem, { categoryId: category.id, name: "Lunch Thali", priceMinor: 25_000 });
    const takeaway = await executeCommand(waiter, createOrder, { channel: "takeaway", locationId, customerName: "Hours" });
    const platform = await executeCommand(waiter, createOrder, { channel: "delivery_platform", locationId, platform: "Zomato" });
    const hidden = async (orderId: string) =>
      (await executeQuery(manager, listMenu, { orderId })).flatMap((c) => c.items).find((i) => i.id === item.id)!.hiddenReason;

    // No rule: available everywhere.
    expect(await hidden(takeaway.id)).toBeNull();

    // A takeaway-only rule hides it from the platform order, with the reason.
    await executeCommand(manager, setMenuItemAvailability, {
      itemId: item.id,
      rules: [{ locationId: null, channel: "takeaway", fromMinute: null, toMinute: null }],
    });
    expect(await hidden(takeaway.id)).toBeNull();
    expect(await hidden(platform.id)).toBe("Only available: Takeaway");
    await expect(executeCommand(waiter, addOrderLines, { orderId: platform.id, lines: [{ itemId: item.id, qty: 1 }] })).rejects.toThrow(/not available on this order. Only available: Takeaway/);
    await executeCommand(waiter, addOrderLines, { orderId: takeaway.id, lines: [{ itemId: item.id, qty: 1 }] });

    // An hours window that excludes right now, in the outlet's own clock, hides it too.
    const zone = (await withTenant(tenantId, (tx) => tx.$queryRaw<Array<{ z: string }>>`SELECT verity.effective_time_zone(organization_id) AS z FROM location WHERE id = ${locationId}::uuid`))[0]!.z;
    const now = minuteOfDay(new Date(), zone);
    const from = (now + 120) % 1440;
    const to = (now + 180) % 1440;
    await executeCommand(manager, setMenuItemAvailability, { itemId: item.id, rules: [{ locationId: null, channel: null, fromMinute: from, toMinute: to }] });
    expect(await hidden(takeaway.id)).toMatch(/^Only available: [0-9]{2}:[0-9]{2} to [0-9]{2}:[0-9]{2}$/);
    // A window around now lets it through again.
    await executeCommand(manager, setMenuItemAvailability, { itemId: item.id, rules: [{ locationId: null, channel: null, fromMinute: (now + 1380) % 1440, toMinute: (now + 60) % 1440 }] });
    expect(await hidden(takeaway.id)).toBeNull();

    // The shown rules carry the outlet name; clearing them restores "always".
    await executeCommand(manager, setMenuItemAvailability, { itemId: item.id, rules: [{ locationId, channel: null, fromMinute: null, toMinute: null }] });
    const shown = (await executeQuery(manager, listMenu, {})).flatMap((c) => c.items).find((i) => i.id === item.id)!;
    expect(shown.availability).toHaveLength(1);
    expect(shown.availability[0]!.locationName).toBeTruthy();
    await executeCommand(manager, setMenuItemAvailability, { itemId: item.id, rules: [] });
    expect(await hidden(platform.id)).toBeNull();

    // A rule that limits nothing, or half a window, is refused, and so is an unknown outlet.
    const empty = { locationId: null, channel: null, fromMinute: null, toMinute: null };
    await expect(executeCommand(manager, setMenuItemAvailability, { itemId: item.id, rules: [empty] })).rejects.toThrow();
    await expect(executeCommand(manager, setMenuItemAvailability, { itemId: item.id, rules: [{ ...empty, fromMinute: 60 }] })).rejects.toThrow();
    await expect(executeCommand(manager, setMenuItemAvailability, { itemId: item.id, rules: [{ ...empty, locationId: randomUUID() }] })).rejects.toThrow(/outlet/);

    await executeCommand(waiter, cancelOrder, { orderId: takeaway.id });
    await executeCommand(waiter, cancelOrder, { orderId: platform.id });
  });

  it("records a failed command as metadata only: command, code, who and channel, never the input or the message (ADR-036)", async () => {
    const before = await withTenant(tenantId, (tx) => tx.commandFailure.count());
    // A refusal that names a guest in its input and a message that quotes them.
    await expect(
      executeCommand(waiter, createOrder, { channel: "takeaway", locationId, customerName: "Secret Guest" }, "api").then(() =>
        executeCommand(waiter, addOrderLines, { orderId: randomUUID(), lines: [{ itemId: randomUUID(), qty: 1 }] }),
      ),
    ).rejects.toThrow(/order not found/);
    const rows = await withTenant(tenantId, (tx) => tx.commandFailure.findMany({ orderBy: { occurredAt: "desc" }, take: 1 }));
    expect(await withTenant(tenantId, (tx) => tx.commandFailure.count())).toBe(before + 1);
    expect(rows[0]).toMatchObject({ commandKey: "verity.dinein.add_order_lines", errorCode: "E_VALIDATION", channel: "api" });
    expect(rows[0]!.actorUserId).toBeTruthy();
    expect(rows[0]!.correlationId).toBeTruthy();
    // Nothing else is stored: no column can hold the input or the message.
    expect(JSON.stringify(rows[0])).not.toMatch(/Secret Guest|order not found/);

    // Append-only: no policy lets the application edit or remove a record of a failure.
    const total = await withTenant(tenantId, (tx) => tx.commandFailure.count());
    expect((await withTenant(tenantId, (tx) => tx.commandFailure.deleteMany({}))).count).toBe(0);
    expect((await withTenant(tenantId, (tx) => tx.commandFailure.updateMany({ data: { errorCode: "E_FAKE" } }))).count).toBe(0);
    expect(await withTenant(tenantId, (tx) => tx.commandFailure.count())).toBe(total);
  });

  it("refuses inconsistent channel input: dine-in without a table, takeaway at a table, platform without a name", async () => {
    // Input validation refuses all three before any table state is read, so
    // no table needs seating (and none is left occupied for later tests).
    await expect(executeCommand(waiter, createOrder, { channel: "dine_in", locationId })).rejects.toThrow(/input rejected/);
    await expect(executeCommand(waiter, createOrder, { channel: "takeaway", tableId, locationId })).rejects.toThrow(/input rejected/);
    await expect(executeCommand(waiter, createOrder, { channel: "delivery_platform", locationId })).rejects.toThrow(/input rejected/);
  });

  it("refuses a dine-in row without a table at the database, whatever the caller", async () => {
    await expect(
      withTenant(tenantId, (tx) =>
        tx.diningOrder.create({
          data: { tenantId, locationId, takenByUserId: waiter.userId, channel: "dine_in", tableId: null },
        }),
      ),
    ).rejects.toThrow(/dining_order_dine_in_has_table/);
  });

  /* -------------------------------- refusals ------------------------------- */

  it("refuses to open an order on a table nobody is sitting at", async () => {
    await expect(
      executeCommand(waiter, createOrder, { tableId, covers: 2 }),
    ).rejects.toThrow(/not occupied/);
  });

  it("refuses a second open order on the same table", async () => {
    await seatTable();
    const first = await executeCommand(waiter, createOrder, { tableId, covers: 2 });

    await expect(
      executeCommand(waiter, createOrder, { tableId, covers: 2 }),
    ).rejects.toThrow(/already has an open order/);

    await executeCommand(manager, cancelOrder, { orderId: first.id, reason: "test cleanup" });
    await releaseTable();
  });

  it("refuses to send an empty order to the kitchen", async () => {
    await seatTable();
    const order = await executeCommand(waiter, createOrder, { tableId, covers: 1 });

    await expect(executeCommand(waiter, placeOrder, { orderId: order.id })).rejects.toThrow(
      /empty order/,
    );

    await executeCommand(manager, cancelOrder, { orderId: order.id });
    await releaseTable();
  });

  it("refuses to cancel an order once food has reached the pass", async () => {
    await seatTable();
    const order = await executeCommand(waiter, createOrder, { tableId, covers: 2 });
    await executeCommand(waiter, addOrderLines, {
      orderId: order.id,
      lines: [{ itemId: paneerId, qty: 1 }],
    });
    await executeCommand(waiter, placeOrder, { orderId: order.id });

    const queue = await executeQuery(manager, kitchenQueue, {});
    const ticket = queue.find((t) => t.orderId === order.id)!;
    await executeCommand(manager, advanceOrderLine, { lineId: ticket.lineId, to: "preparing" });
    await executeCommand(manager, advanceOrderLine, { lineId: ticket.lineId, to: "ready" });

    // The dish has been cooked. Cancelling would erase a cost already borne.
    await expect(
      executeCommand(manager, cancelOrder, { orderId: order.id }),
    ).rejects.toThrow(/already ready or served/);

    // Voiding it is allowed — for a manager.
    await executeCommand(manager, voidOrderLine, { lineId: ticket.lineId, reason: "dropped" });

    await releaseTable();
  });

  it("refuses a waiter the manager-only void of a cooked dish", async () => {
    await seatTable();
    const order = await executeCommand(waiter, createOrder, { tableId, covers: 2 });
    await executeCommand(waiter, addOrderLines, {
      orderId: order.id,
      lines: [{ itemId: naanId, qty: 1 }],
    });
    await executeCommand(waiter, placeOrder, { orderId: order.id });

    const queue = await executeQuery(manager, kitchenQueue, {});
    const ticket = queue.find((t) => t.orderId === order.id)!;
    await executeCommand(manager, advanceOrderLine, { lineId: ticket.lineId, to: "preparing" });
    await executeCommand(manager, advanceOrderLine, { lineId: ticket.lineId, to: "ready" });

    // The guard reads the actor's grant, not their job title.
    await expect(
      executeCommand(waiter, voidOrderLine, { lineId: ticket.lineId }),
    ).rejects.toThrow(/only be voided by a manager/);

    await executeCommand(manager, voidOrderLine, { lineId: ticket.lineId, reason: "burnt" });
    await releaseTable();
  });

  it("refuses an undeclared table move", async () => {
    // available → cleaning is not an edge. Nothing declares it, so the engine
    // refuses it by absence rather than by a rule written here.
    await expect(
      executeCommand(manager, moveTable, { tableId, to: "cleaning" }),
    ).rejects.toThrow();
  });

  it("refuses to bill an order that has not been served", async () => {
    await seatTable();
    const order = await executeCommand(waiter, createOrder, { tableId, covers: 2 });
    await executeCommand(waiter, addOrderLines, {
      orderId: order.id,
      lines: [{ itemId: naanId, qty: 1 }],
    });
    await executeCommand(waiter, placeOrder, { orderId: order.id });

    await expect(
      executeCommand(manager, generateBill, { orderId: order.id }),
    ).rejects.toThrow(/not served yet/);

    await executeCommand(manager, cancelOrder, { orderId: order.id });
    await releaseTable();
  });

  it("refuses an overpayment rather than holding money it cannot account for", async () => {
    const bill = await freshSettledBillFixture();
    await expect(
      executeCommand(manager, recordPayment, {
        billId: bill.billId,
        method: "cash",
        amountMinor: bill.totalMinor + 100,
      }),
    ).rejects.toThrow(/more than the outstanding/);

    await executeCommand(manager, recordPayment, {
      billId: bill.billId,
      method: "cash",
      amountMinor: bill.totalMinor,
    });
    await executeCommand(manager, settleBill, { billId: bill.billId });
    await releaseTable();
  });

  it("refuses to settle a bill that is not fully paid", async () => {
    const bill = await freshSettledBillFixture();
    await executeCommand(manager, recordPayment, {
      billId: bill.billId,
      method: "cash",
      amountMinor: 100,
    });

    await expect(executeCommand(manager, settleBill, { billId: bill.billId })).rejects.toThrow(
      /still outstanding/,
    );

    await executeCommand(manager, recordPayment, {
      billId: bill.billId,
      method: "cash",
      amountMinor: bill.totalMinor - 100,
    });
    await executeCommand(manager, settleBill, { billId: bill.billId });
    await releaseTable();
  });

  it("refuses a waiter the till", async () => {
    const bill = await freshSettledBillFixture();

    // A waiter may serve and may not take money. Both halves are the point.
    await expect(
      executeCommand(waiter, recordPayment, {
        billId: bill.billId,
        method: "cash",
        amountMinor: 100,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      executeCommand(waiter, applyBillDiscount, {
        billId: bill.billId,
        discountMinor: 5_000,
        reason: "friend of the house",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await executeCommand(manager, recordPayment, {
      billId: bill.billId,
      method: "cash",
      amountMinor: bill.totalMinor,
    });
    await executeCommand(manager, settleBill, { billId: bill.billId });
    await releaseTable();
  });

  /* -------------------------------- the money ------------------------------ */

  it("computes GST on the discounted value and stores the rate beside the amount", async () => {
    const bill = await freshSettledBillFixture();

    await executeCommand(manager, applyBillDiscount, {
      billId: bill.billId,
      discountMinor: 8_000,
      reason: "regular",
    });

    const detail = await executeQuery(manager, getBillDetail, { billId: bill.billId });
    // Tax follows the discount down — charging GST on money nobody paid is the
    // error this asserts against.
    expect(detail?.discountMinor).toBe(8_000);
    expect(detail?.cgstMinor).toBe(Math.round(((bill.subtotalMinor - 8_000) * 2.5) / 100));
    // The rate that applied is stored, so a reprint next year still shows 2.5.
    expect(detail?.cgstRate).toBe(2.5);

    await executeCommand(manager, recordPayment, {
      billId: bill.billId,
      method: "card",
      amountMinor: detail!.totalMinor,
    });
    await executeCommand(manager, settleBill, { billId: bill.billId });
    await releaseTable();
  });

  it("rounds to the rupee and records the adjustment rather than absorbing it", () => {
    // 333.33 with 5% GST lands on a fraction of a rupee. The bill must show
    // where the difference went.
    const totals = computeBillTotals({
      subtotalMinor: 33_333,
      discountMinor: 0,
      cgstRateBp: 250,
      sgstRateBp: 250,
    });
    expect(totals.totalMinor % 100).toBe(0);
    expect(totals.taxableMinor + totals.cgstMinor + totals.sgstMinor + totals.roundingMinor).toBe(
      totals.totalMinor,
    );
  });

  it("never charges for a voided line", async () => {
    await seatTable();
    const order = await executeCommand(waiter, createOrder, { tableId, covers: 2 });
    await executeCommand(waiter, addOrderLines, {
      orderId: order.id,
      lines: [
        { itemId: paneerId, qty: 1 },
        { itemId: naanId, qty: 1 },
      ],
    });
    await executeCommand(waiter, placeOrder, { orderId: order.id });

    const queue = (await executeQuery(manager, kitchenQueue, {})).filter(
      (ticket) => ticket.orderId === order.id,
    );
    // Void one before it is cooked, serve the other.
    await executeCommand(manager, voidOrderLine, { lineId: queue[1]!.lineId, reason: "86'd" });
    await executeCommand(manager, advanceOrderLine, { lineId: queue[0]!.lineId, to: "preparing" });
    await executeCommand(manager, advanceOrderLine, { lineId: queue[0]!.lineId, to: "ready" });
    await executeCommand(waiter, advanceOrderLine, { lineId: queue[0]!.lineId, to: "served" });

    const bill = await executeCommand(manager, generateBill, { orderId: order.id });
    const detail = await executeQuery(manager, getBillDetail, { billId: bill.id });
    // Only the paneer.
    expect(detail?.subtotalMinor).toBe(42_000);
    expect(detail?.lines).toHaveLength(1);

    await executeCommand(manager, recordPayment, {
      billId: bill.id,
      method: "cash",
      amountMinor: detail!.totalMinor,
    });
    await executeCommand(manager, settleBill, { billId: bill.id });
    await releaseTable();
  });

  it("prices from the snapshot after the menu moves on", async () => {
    await seatTable();
    const order = await executeCommand(waiter, createOrder, { tableId, covers: 1 });
    await executeCommand(waiter, addOrderLines, {
      orderId: order.id,
      lines: [{ itemId: paneerId, qty: 1 }],
    });
    await executeCommand(waiter, placeOrder, { orderId: order.id });

    // The kitchen reprices mid-service. The guest pays what they were quoted.
    await executeCommand(manager, editMenuItem, { itemId: paneerId, priceMinor: 99_900 });

    const queue = (await executeQuery(manager, kitchenQueue, {})).filter(
      (ticket) => ticket.orderId === order.id,
    );
    await executeCommand(manager, advanceOrderLine, { lineId: queue[0]!.lineId, to: "preparing" });
    await executeCommand(manager, advanceOrderLine, { lineId: queue[0]!.lineId, to: "ready" });
    await executeCommand(waiter, advanceOrderLine, { lineId: queue[0]!.lineId, to: "served" });

    const bill = await executeCommand(manager, generateBill, { orderId: order.id });
    const detail = await executeQuery(manager, getBillDetail, { billId: bill.id });
    expect(detail?.subtotalMinor).toBe(42_000);

    await executeCommand(manager, recordPayment, {
      billId: bill.id,
      method: "cash",
      amountMinor: detail!.totalMinor,
    });
    await executeCommand(manager, settleBill, { billId: bill.id });
    await releaseTable();
  });

  /* --------------------------------- menu ---------------------------------- */

  it("hides a retired item from ordering while history keeps it", async () => {
    await executeCommand(manager, setMenuItemActive, { itemId: naanId, active: false });

    const menu = await executeQuery(waiter, listMenu, {});
    const names = menu.flatMap((category) => category.items.map((item) => item.name));
    expect(names).not.toContain("Butter Naan");

    await seatTable();
    const order = await executeCommand(waiter, createOrder, { tableId, covers: 1 });
    await expect(
      executeCommand(waiter, addOrderLines, {
        orderId: order.id,
        lines: [{ itemId: naanId, qty: 1 }],
      }),
    ).rejects.toThrow(/not available right now/);

    await executeCommand(manager, cancelOrder, { orderId: order.id });
    await releaseTable();
    await executeCommand(manager, setMenuItemActive, { itemId: naanId, active: true });
  });

  /* ------------------------------- reporting ------------------------------- */

  it("reports only settled money", async () => {
    const summary = await executeQuery(manager, salesSummary, {
      from: new Date(Date.now() - 86_400_000).toISOString(),
      to: new Date(Date.now() + 86_400_000).toISOString(),
    });

    expect(summary.billsSettled).toBeGreaterThan(0);
    expect(summary.grossMinor).toBeGreaterThan(0);
    // Every rupee reported traces to a payment that was actually recorded.
    const paid = summary.byMethod.reduce((sum, row) => sum + row.amountMinor, 0);
    expect(paid).toBe(summary.grossMinor);
  });

  /* ------------------------------- isolation ------------------------------- */

  it("keeps one restaurant's floor out of another's", async () => {
    const visible = await withTenant(otherTenantId, (tx) => tx.diningTable.findMany());
    expect(visible).toHaveLength(0);

    const mine = await withTenant(tenantId, (tx) => tx.diningTable.findMany());
    expect(mine.length).toBeGreaterThan(0);
  });

  /* --------------------------------- helpers -------------------------------- */


  /** Brings the table back to  from wherever it is. */
  it("moves an open order to a free table and merges two open orders (pos-restaurant.md §6)", async () => {
    const t1 = await executeCommand(manager, defineTable, { zoneId, label: "M-1", seats: 4 });
    const t2 = await executeCommand(manager, defineTable, { zoneId, label: "M-2", seats: 4 });
    const t3 = await executeCommand(manager, defineTable, { zoneId, label: "M-3", seats: 2 });
    await executeCommand(manager, moveTable, { tableId: t1.id, to: "occupied" });
    await executeCommand(manager, moveTable, { tableId: t3.id, to: "occupied" });

    const a = await executeCommand(manager, createOrder, { tableId: t1.id, covers: 2 });
    await executeCommand(manager, addOrderLines, { orderId: a.id, lines: [{ itemId: paneerId, qty: 1 }] });
    await executeCommand(manager, placeOrder, { orderId: a.id });
    const b = await executeCommand(manager, createOrder, { tableId: t3.id, covers: 2 });
    await executeCommand(manager, addOrderLines, { orderId: b.id, lines: [{ itemId: paneerId, qty: 2 }] });

    // Move A from M-1 to the free M-2: M-2 occupied, M-1 to cleaning.
    const targets = await executeQuery(manager, listTableChangeTargets, { orderId: a.id });
    expect(targets.freeTables.some((t) => t.id === t2.id)).toBe(true);
    await expect(executeCommand(manager, moveOrderToTable, { orderId: a.id, toTableId: t3.id })).rejects.toThrow(/not free/);
    await executeCommand(manager, moveOrderToTable, { orderId: a.id, toTableId: t2.id });
    const floor = await withTenant(tenantId, (tx) => tx.diningTable.findMany({ where: { id: { in: [t1.id, t2.id] } } }));
    expect(floor.find((t) => t.id === t2.id)!.state).toBe("occupied");
    expect(floor.find((t) => t.id === t1.id)!.state).toBe("cleaning");
    expect((await executeQuery(manager, getOrderDetail, { orderId: a.id }))!.tableId).toBe(t2.id);

    // Merge B (draft) into A (placed): lines move, covers add up, B closes, M-3 to cleaning.
    const merged = await executeCommand(manager, mergeOrders, { fromOrderId: b.id, intoOrderId: a.id });
    expect(merged.movedLines).toBe(1);
    const after = (await executeQuery(manager, getOrderDetail, { orderId: a.id }))!;
    expect(after.covers).toBe(4);
    expect(after.lines.length).toBe(2);
    const closed = await withTenant(tenantId, (tx) => tx.diningOrder.findUniqueOrThrow({ where: { id: b.id } }));
    expect(closed.state).toBe("cancelled");
    const m3 = await withTenant(tenantId, (tx) => tx.diningTable.findUniqueOrThrow({ where: { id: t3.id } }));
    expect(m3.state).toBe("cleaning");
    await expect(executeCommand(manager, mergeOrders, { fromOrderId: a.id, intoOrderId: a.id })).rejects.toThrow();

    // The cancelled order shows in history.
    const history = await executeQuery(manager, listOrderHistory, {});
    expect(history.some((h) => h.orderId === b.id && h.state === "cancelled")).toBe(true);
  });

  /* ------------------- Task 126 waves 0 to 2: days, reports, GST bill ------------------- */

  it("honours the day asked for, and gives each service day its own bills (Task 126 G-01, G-02)", async () => {
    const today = await executeQuery(manager, salesSummary, {});
    expect(today.billsSettled).toBeGreaterThan(0);
    // Before the fix a malformed pattern ignored `day`, so any date returned today's bills.
    const long_ago = await executeQuery(manager, salesSummary, { day: "2020-01-01" });
    expect(long_ago.billsSettled).toBe(0);
    // Asking for today's own date returns the same figures as asking for "now".
    const named = await executeQuery(manager, salesSummary, { day: today.day });
    expect(named.billsSettled).toBe(today.billsSettled);
    expect(named.grossMinor).toBe(today.grossMinor);
    // Neighbouring days do not share a boundary instant.
    const tomorrow = new Date(`${today.day}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const next = await executeQuery(manager, salesSummary, { day: tomorrow.toISOString().slice(0, 10) });
    expect(next.billsSettled).toBe(0);
  });

  it("answers the sales report by day, hour, channel, staff and item from the same settled bills", async () => {
    const summary = await executeQuery(manager, salesSummary, {});
    const range = { from: summary.day, to: summary.day };

    const byDay = await executeQuery(manager, salesReport, { view: "day", ...range });
    expect(byDay.rows).toHaveLength(1);
    expect(byDay.totals.bills).toBe(summary.billsSettled);
    expect(byDay.totals.grossMinor).toBe(summary.grossMinor);
    expect(byDay.totals.netMinor).toBe(byDay.totals.grossMinor - byDay.totals.refundedMinor);

    for (const view of ["hour", "channel", "staff"] as const) {
      const report = await executeQuery(manager, salesReport, { view, ...range });
      expect(report.totals.grossMinor).toBe(summary.grossMinor);
      expect(report.rows.reduce((s, r) => s + r.bills, 0)).toBe(summary.billsSettled);
    }
    const channels = await executeQuery(manager, salesReport, { view: "channel", ...range });
    expect(channels.rows.some((r) => r.key === "delivery_platform" && r.label === "Delivery platform")).toBe(true);
    const staff = await executeQuery(manager, salesReport, { view: "staff", ...range });
    expect(staff.rows.every((r) => r.label !== "Unknown")).toBe(true);

    const items = await executeQuery(manager, salesReport, { view: "item", ...range });
    expect(items.itemRows.length).toBeGreaterThan(0);
    expect(items.itemRows.some((r) => r.label === "Paneer Butter Masala")).toBe(true);

    await expect(executeQuery(manager, salesReport, { view: "day", from: "2026-01-31", to: "2026-01-01" })).rejects.toThrow(/after the end/);
    await expect(executeQuery(manager, salesReport, { view: "day", from: "2025-01-01", to: "2026-01-01" })).rejects.toThrow(/at most/);
    // A waiter has no Read on bills at all.
    await expect(executeQuery(waiter, salesReport, { view: "day", ...range })).rejects.toThrow();
  });

  it("lists cancelled orders, voided lines and refunds in the exceptions report", async () => {
    const summary = await executeQuery(manager, salesSummary, {});
    const report = await executeQuery(manager, exceptionsReport, { from: summary.day, to: summary.day });
    expect(report.rows.some((r) => r.kind === "cancelled_order")).toBe(true);
    expect(report.rows.every((r) => r.amountMinor >= 0)).toBe(true);
  });

  it("shows the outlet's day: sales, tables, stages, attention and floor load", async () => {
    const today = await executeQuery(manager, outletToday, {});
    const summary = await executeQuery(manager, salesSummary, {});
    expect(today.sales?.grossMinor).toBe(summary.grossMinor);
    expect(today.sales?.bills).toBe(summary.billsSettled);
    expect(today.tables.total).toBeGreaterThan(0);
    // The moved order is placed with lines still in the kitchen.
    expect(today.serviceLine.some((t) => t.stage === "with_kitchen")).toBe(true);
    expect(today.serviceLine.some((t) => t.stage === "cleaning")).toBe(true);
    expect(today.floorLoad.length).toBeGreaterThan(0);
    expect(today.thresholds).toEqual({ unpaidMinutes: 15, seatedMinutes: 60 });
    // A waiter reads orders but not bills: the money is withheld, the floor is not.
    const forWaiter = await executeQuery(waiter, outletToday, {});
    expect(forWaiter.sales).toBeNull();
    expect(forWaiter.serviceLine.length).toBeGreaterThan(0);
  });

  it("hands an open order to another waiter, only to someone who can take orders, and only while open (Task 126 1.4)", async () => {
    const table = await executeCommand(manager, defineTable, { zoneId, label: "H-1", seats: 2 });
    await executeCommand(manager, moveTable, { tableId: table.id, to: "occupied" });
    const order = await executeCommand(manager, createOrder, { tableId: table.id, covers: 2 });

    const targets = await executeQuery(manager, listHandoverTargets, { orderId: order.id });
    expect(targets.some((t) => t.userId === waiter.userId)).toBe(true);
    // The manager took it, so the manager is not offered.
    expect(targets.some((t) => t.userId === manager.userId)).toBe(false);

    await expect(
      executeCommand(manager, handOverOrder, { orderId: order.id, toUserId: randomUUID() }),
    ).rejects.toThrow(/does not work this outlet/);
    await expect(
      executeCommand(manager, handOverOrder, { orderId: order.id, toUserId: manager.userId }),
    ).rejects.toThrow(/already has this order/);

    await executeCommand(manager, handOverOrder, { orderId: order.id, toUserId: waiter.userId, reason: "end of shift" });
    const after = await withTenant(tenantId, (tx) => tx.diningOrder.findUniqueOrThrow({ where: { id: order.id } }));
    expect(after.takenByUserId).toBe(waiter.userId);

    // Who held it before is a question for the audit trail, with the reason.
    const trail = await withTenant(tenantId, (tx) =>
      tx.activity.findMany({ where: { entityId: order.id, commandKey: "verity.dinein.hand_over_order" } }),
    );
    expect(trail.some((r) => r.fieldChanged === "takenByUserId" && r.oldValue === manager.userId)).toBe(true);
    expect(trail.some((r) => r.fieldChanged === "reason" && r.newValue === "end of shift")).toBe(true);

    await executeCommand(manager, cancelOrder, { orderId: order.id });
    await expect(
      executeCommand(manager, handOverOrder, { orderId: order.id, toUserId: manager.userId }),
    ).rejects.toThrow(/closed/);
  });

  it("keeps an opening and closing list per outlet, records who ticked what, and does not block selling (Task 126 1.8)", async () => {
    // Floor staff may tick; setting the list is floor setup, which a waiter may not do.
    await expect(
      executeCommand(waiter, setChecklistSteps, { locationId, kind: "opening", steps: ["Unlock the gate"] }),
    ).rejects.toThrow();
    await executeCommand(manager, setChecklistSteps, { locationId, kind: "opening", steps: ["Unlock the gate", "Switch on the fridges", "Count the float"] });
    await expect(
      executeCommand(manager, setChecklistSteps, { locationId, kind: "opening", steps: ["Same", "same"] }),
    ).rejects.toThrow(/same wording/);

    let today = await executeQuery(waiter, checklistToday, {});
    const list = () => today.find((o) => o.locationId === locationId)!.lists.find((l) => l.kind === "opening")!;
    expect(list().steps).toHaveLength(3);
    expect(list().complete).toBe(false);

    for (const step of list().steps) await executeCommand(waiter, tickChecklistStep, { stepId: step.id, done: true });
    today = await executeQuery(waiter, checklistToday, {});
    expect(list().complete).toBe(true);
    expect(list().steps.every((s) => s.done && s.doneBy === "Ravi")).toBe(true);

    // Un-ticking reopens the list.
    await executeCommand(waiter, tickChecklistStep, { stepId: list().steps[0]!.id, done: false });
    today = await executeQuery(waiter, checklistToday, {});
    expect(list().complete).toBe(false);

    // Taking a step off retires it: it leaves the list, and cannot be ticked.
    const gone = list().steps[2]!.id;
    await executeCommand(manager, setChecklistSteps, { locationId, kind: "opening", steps: ["Unlock the gate", "Switch on the fridges"] });
    today = await executeQuery(waiter, checklistToday, {});
    expect(list().steps.map((s) => s.label)).toEqual(["Unlock the gate", "Switch on the fridges"]);
    await expect(executeCommand(waiter, tickChecklistStep, { stepId: gone, done: true })).rejects.toThrow(/no longer on the list/);

    // A closing list nobody finished yesterday is flagged on the day view only if trading happened;
    // with no steps at all there is nothing to flag.
    const view = await executeQuery(manager, outletToday, {});
    expect(view.attention.some((a) => a.kind === "closing_open")).toBe(false);
  });

  it("raises a numbered GST invoice at an outlet with a profile, leaves an outlet without one alone, and issues credit notes (ADR-040)", async () => {
    // A second outlet with a profile; the first has none and must keep billing as it did.
    const ggn = await withTenant(tenantId, (tx) => tx.location.create({ data: { tenantId, organizationId, name: "Gurugram" } }));
    const gzone = await executeCommand(manager, defineZone, { locationId: ggn.id, name: "Hall" });
    const gtable = async (label: string) => {
      const t = await executeCommand(manager, defineTable, { zoneId: gzone.id, label, seats: 4 });
      await executeCommand(manager, moveTable, { tableId: t.id, to: "occupied" });
      return t.id;
    };
    const profile = {
      locationId: ggn.id,
      code: "GG",
      legalName: "Kebabz Gurugram Pvt Ltd",
      gstin: "06AAAAA0000A1Z5",
      stateCode: "06",
      registrationType: "regular" as const,
      fssai: "10012345000678",
      addressLines: "Sector 29, Gurugram",
      dayStartMinute: 300,
      serviceChargeBp: 0,
      platformTaxFree: true,
    };
    await expect(executeCommand(waiter, saveOutletProfile, profile)).rejects.toThrow();
    await expect(executeCommand(manager, saveOutletProfile, { ...profile, gstin: null })).rejects.toThrow();
    await executeCommand(manager, saveOutletProfile, profile);
    // Another outlet may not take the same code.
    await expect(
      executeCommand(manager, saveOutletProfile, { ...profile, locationId, code: "GG", legalName: "Other" }),
    ).rejects.toThrow(/already another outlet/);

    const drinkId = (await executeCommand(manager, createMenuItem, {
      categoryId: (await executeQuery(manager, listMenu, {}))[0]!.categoryId,
      name: "Cold Drink",
      priceMinor: 6_000,
      taxRateBp: 1800,
    })).id;

    // Earlier tests edit the fixture prices, so work from what the menu says now.
    const paneerNow = (await executeQuery(manager, listMenu, {})).flatMap((c) => c.items).find((i) => i.id === paneerId)!.priceMinor;
    const food = Math.round((paneerNow * 250) / 10_000);

    const serve = async (orderId: string) => {
      const detail = (await executeQuery(manager, getOrderDetail, { orderId }))!;
      for (const line of detail.lines) {
        for (const to of ["preparing", "ready", "served"]) {
          await executeCommand(manager, advanceOrderLine, { lineId: line.id, to });
        }
      }
    };

    // Food at 5% and a drink at 18% on one bill.
    const t1 = await gtable("G-1");
    const o1 = await executeCommand(manager, createOrder, { tableId: t1, covers: 2 });
    await executeCommand(manager, addOrderLines, { orderId: o1.id, lines: [{ itemId: paneerId, qty: 1 }, { itemId: drinkId, qty: 1 }] });
    await executeCommand(manager, placeOrder, { orderId: o1.id });
    await serve(o1.id);
    const b1 = await executeCommand(manager, generateBill, { orderId: o1.id });
    const d1 = (await executeQuery(manager, getBillDetail, { billId: b1.id }))!;
    expect(d1.number).toMatch(/^GG\/\d{2}-\d{2}\/000001$/);
    expect(d1.seller).toMatchObject({ legalName: "Kebabz Gurugram Pvt Ltd", gstin: "06AAAAA0000A1Z5", fssai: "10012345000678" });
    expect(d1.taxLines.map((t) => [t.rateBp, t.cgstMinor, t.sgstMinor])).toEqual([[500, food, food], [1800, 540, 540]]);
    const beforeRounding = paneerNow + 6_000 + 2 * food + 1_080;
    expect(d1.totalMinor).toBe(Math.round(beforeRounding / 100) * 100);
    expect(d1.roundingMinor).toBe(d1.totalMinor - beforeRounding);

    // A discount reprices from the tax lines and the invoice keeps its number.
    await executeCommand(manager, applyBillDiscount, { billId: b1.id, discountMinor: 4_800, reason: "regular guest" });
    const d1b = (await executeQuery(manager, getBillDetail, { billId: b1.id }))!;
    expect(d1b.number).toBe(d1.number);
    expect(d1b.taxLines.reduce((s, t) => s + t.taxableMinor, 0)).toBe(paneerNow + 6_000 - 4_800);
    const foot = d1b.taxLines.reduce((s, t) => s + t.taxableMinor + t.cgstMinor + t.sgstMinor, 0) + d1b.roundingMinor;
    expect(foot).toBe(d1b.totalMinor);

    // Numbers are consecutive: the next bill is 000002, whichever table.
    const t2 = await gtable("G-2");
    const o2 = await executeCommand(manager, createOrder, { tableId: t2, covers: 1 });
    await executeCommand(manager, addOrderLines, { orderId: o2.id, lines: [{ itemId: naanId, qty: 2 }] });
    await executeCommand(manager, placeOrder, { orderId: o2.id });
    await serve(o2.id);
    const b2 = await executeCommand(manager, generateBill, { orderId: o2.id });
    expect((await executeQuery(manager, getBillDetail, { billId: b2.id }))!.number).toMatch(/\/000002$/);

    // A service charge is taxed with the supply, and a manager can waive it on one bill.
    await executeCommand(manager, saveOutletProfile, { ...profile, serviceChargeBp: 1000 });
    const t3 = await gtable("G-3");
    const o3 = await executeCommand(manager, createOrder, { tableId: t3, covers: 2 });
    await executeCommand(manager, addOrderLines, { orderId: o3.id, lines: [{ itemId: paneerId, qty: 1 }] });
    await executeCommand(manager, placeOrder, { orderId: o3.id });
    await serve(o3.id);
    const b3 = await executeCommand(manager, generateBill, { orderId: o3.id });
    const d3 = (await executeQuery(manager, getBillDetail, { billId: b3.id }))!;
    expect(d3.serviceChargeMinor).toBe(Math.round(paneerNow / 10));
    expect(d3.taxLines[0]!.taxableMinor).toBe(paneerNow + Math.round(paneerNow / 10));
    await expect(executeCommand(waiter, waiveServiceCharge, { billId: b3.id, reason: "guest asked" })).rejects.toThrow();
    await executeCommand(manager, waiveServiceCharge, { billId: b3.id, reason: "guest asked" });
    const d3b = (await executeQuery(manager, getBillDetail, { billId: b3.id }))!;
    expect(d3b.serviceChargeMinor).toBe(0);
    expect(d3b.taxLines[0]!.taxableMinor).toBe(paneerNow);
    await expect(executeCommand(manager, waiveServiceCharge, { billId: b3.id, reason: "again" })).rejects.toThrow(/no service charge/);

    // A delivery-platform order carries no tax on the restaurant's own invoice.
    const op = await executeCommand(manager, createOrder, { channel: "delivery_platform", locationId: ggn.id, platform: "Zomato", platformOrderRef: "Z-9", customerName: "Asha" });
    await executeCommand(manager, addOrderLines, { orderId: op.id, lines: [{ itemId: paneerId, qty: 1 }] });
    await executeCommand(manager, placeOrder, { orderId: op.id });
    await serve(op.id);
    const bp = await executeCommand(manager, generateBill, { orderId: op.id });
    const dp = (await executeQuery(manager, getBillDetail, { billId: bp.id }))!;
    expect(dp.taxFree).toBe(true);
    expect(dp.cgstMinor + dp.sgstMinor).toBe(0);
    expect(dp.serviceChargeMinor).toBe(0);

    // A refund is a credit note, with its own series and the tax it reverses.
    await executeCommand(manager, recordPayment, { billId: b2.id, method: "cash", amountMinor: (await executeQuery(manager, getBillDetail, { billId: b2.id }))!.totalMinor });
    await executeCommand(manager, settleBill, { billId: b2.id });
    const full = (await executeQuery(manager, getBillDetail, { billId: b2.id }))!;
    await executeCommand(manager, refundBill, { billId: b2.id, amountMinor: Math.floor(full.totalMinor / 2), method: "cash", reason: "Dish was cold" });
    const refunded = (await executeQuery(manager, getBillDetail, { billId: b2.id }))!;
    expect(refunded.refunds[0]!.creditNoteNumber).toMatch(/^CGG\/\d{2}-\d{2}\/00001$/);
    const reversed = refunded.refunds[0]!.taxLines.reduce((s, t) => s + t.taxableMinor + t.cgstMinor + t.sgstMinor, 0);
    expect(reversed).toBe(refunded.refunds[0]!.amountMinor);

    // The month's summary: supplies by rate, the platform order as tax-free, the credit note, the number range.
    await executeCommand(manager, recordPayment, { billId: b1.id, method: "cash", amountMinor: (await executeQuery(manager, getBillDetail, { billId: b1.id }))!.totalMinor });
    await executeCommand(manager, settleBill, { billId: b1.id });
    await executeCommand(manager, recordPayment, { billId: bp.id, method: "delivery_platform", amountMinor: dp.totalMinor });
    await executeCommand(manager, settleBill, { billId: bp.id });
    const summary = await executeQuery(manager, gstSummary, { locationId: ggn.id });
    const outlet = summary.outlets[0]!;
    expect(outlet.gstin).toBe("06AAAAA0000A1Z5");
    expect(outlet.invoices.count).toBe(4);
    expect(outlet.invoices.first).toMatch(/\/000001$/);
    expect(outlet.invoices.last).toMatch(/\/000004$/);
    expect(outlet.rates.map((r) => r.rateBp)).toContain(500);
    expect(outlet.rates.map((r) => r.rateBp)).toContain(1800);
    expect(outlet.taxFreeMinor).toBeGreaterThan(0);
    expect(outlet.creditNotes.count).toBe(1);

    // The outlet with no profile is untouched: no number, and its single-rate arithmetic as before.
    const legacy = await withTenant(tenantId, (tx) => tx.bill.findMany({ where: { locationId }, select: { number: true } }));
    expect(legacy.length).toBeGreaterThan(0);
    expect(legacy.every((b) => b.number === null)).toBe(true);

    // The code prefixes every number, so it cannot change once bills carry it.
    await expect(executeCommand(manager, saveOutletProfile, { ...profile, code: "GX" })).rejects.toThrow(/cannot change/);
  });

  it("routes dishes to stations, orders them by course, writes tickets, and tells the kitchen when a started dish is withdrawn (ADR-041)", async () => {
    const mains = (await executeQuery(manager, listMenu, {}))[0]!.categoryId;
    const drinksCat = (await executeCommand(manager, createMenuCategory, { name: "Drinks (kitchen test)" })).id;
    const lassi = (await executeCommand(manager, createMenuItem, { categoryId: drinksCat, name: "Sweet Lassi", priceMinor: 9_000 })).id;

    const starter = (await executeCommand(manager, saveMenuCourse, { name: "Starter (kitchen test)", priority: 1, active: true })).id;
    const mainCourse = (await executeCommand(manager, saveMenuCourse, { name: "Main (kitchen test)", priority: 2, active: true })).id;
    await expect(executeCommand(manager, saveMenuCourse, { name: "Starter (kitchen test)", priority: 3, active: true })).rejects.toThrow(/already exists/);
    await executeCommand(manager, editMenuItem, { itemId: paneerId, courseId: mainCourse });
    await executeCommand(manager, editMenuItem, { itemId: naanId, courseId: starter });

    // A waiter does not set up stations.
    await expect(
      executeCommand(waiter, saveKitchenStation, { locationId, name: "Nope", isDefault: false, active: true }),
    ).rejects.toThrow();
    const kitchen = (await executeCommand(manager, saveKitchenStation, { locationId, name: "Kitchen", isDefault: true, active: true })).id;
    const bar = (await executeCommand(manager, saveKitchenStation, { locationId, name: "Bar", isDefault: false, active: true })).id;
    await expect(
      executeCommand(manager, saveKitchenStation, { locationId, name: "Bar", isDefault: false, active: true }),
    ).rejects.toThrow(/already has a station/);
    await executeCommand(manager, setStationCategories, { stationId: bar, categoryIds: [drinksCat] });

    const setup = await executeQuery(manager, listKitchenSetup, {});
    const outlet = setup.outlets.find((o) => o.locationId === locationId)!;
    expect(outlet.stations.find((s) => s.id === bar)!.categoryIds).toEqual([drinksCat]);

    const t = await executeCommand(manager, defineTable, { zoneId, label: "KS-1", seats: 4 });
    await executeCommand(manager, moveTable, { tableId: t.id, to: "occupied" });
    const order = await executeCommand(manager, createOrder, { tableId: t.id, covers: 2 });
    await executeCommand(manager, addOrderLines, {
      orderId: order.id,
      lines: [{ itemId: paneerId, qty: 1 }, { itemId: lassi, qty: 2 }, { itemId: naanId, qty: 1 }],
    });
    // Nothing is told to the kitchen until the order is sent.
    expect((await executeQuery(manager, getOrderDetail, { orderId: order.id }))!.lines).toHaveLength(3);
    const before = await executeQuery(manager, listUnprintedTickets, {});
    await executeCommand(manager, placeOrder, { orderId: order.id });

    const fresh = (await executeQuery(manager, listUnprintedTickets, {})).filter((x) => !before.some((b) => b.id === x.id));
    expect(fresh.map((x) => [x.kind, x.stationName]).sort()).toEqual([["new", "Bar"], ["new", "Kitchen"]]);
    const [first, second] = [...fresh].sort((a, b) => a.number.localeCompare(b.number));
    expect(Number(second!.number.slice(1))).toBe(Number(first!.number.slice(1)) + 1);

    // Each station sees its own dishes; the main kitchen lists starters before mains.
    const barQueue = await executeQuery(manager, kitchenQueue, { stationId: bar });
    expect(barQueue.filter((q) => q.orderId === order.id).map((q) => q.itemName)).toEqual(["Sweet Lassi"]);
    const kitchenQueueRows = (await executeQuery(manager, kitchenQueue, { stationId: kitchen })).filter((q) => q.orderId === order.id);
    expect(kitchenQueueRows.map((q) => q.courseName)).toEqual(["Starter (kitchen test)", "Main (kitchen test)"]);
    expect((await executeQuery(manager, kitchenQueue, {})).filter((q) => q.orderId === order.id)).toHaveLength(3);

    // The ticket says what to cook, with the course; the first print is a print, the next a reprint.
    const ticket = (await executeQuery(manager, getKitchenTicket, { ticketId: first!.id }))!;
    expect(ticket.lines.length).toBeGreaterThan(0);
    expect(ticket.label).toBe("Table KS-1");
    expect((await executeCommand(manager, recordTicketPrint, { ticketId: first!.id })).reprint).toBe(false);
    expect((await executeCommand(manager, recordTicketPrint, { ticketId: first!.id })).reprint).toBe(true);
    expect((await executeQuery(manager, getKitchenTicket, { ticketId: first!.id }))!.prints).toBe(2);
    expect((await executeQuery(manager, listUnprintedTickets, {})).some((x) => x.id === first!.id)).toBe(false);

    // A ticket is a fact: the runtime role has no policy to edit or delete one, so both touch nothing.
    expect(await withTenant(tenantId, (tx) => tx.$executeRaw`UPDATE kitchen_ticket SET kind = 'void' WHERE id = ${first!.id}::uuid`)).toBe(0);
    expect(await withTenant(tenantId, (tx) => tx.$executeRaw`DELETE FROM kitchen_ticket WHERE id = ${first!.id}::uuid`)).toBe(0);
    expect((await executeQuery(manager, getKitchenTicket, { ticketId: first!.id }))!.kind).toBe("new");

    // A dish added after sending is an addition and goes to the right station.
    await executeCommand(manager, addOrderLines, { orderId: order.id, lines: [{ itemId: lassi, qty: 1 }] });
    const added = (await executeQuery(manager, listUnprintedTickets, {})).filter((x) => x.kind === "addition" && x.stationName === "Bar");
    expect(added.length).toBeGreaterThan(0);

    // Changing what a station cooks never moves a dish already sent.
    await executeCommand(manager, setStationCategories, { stationId: kitchen, categoryIds: [drinksCat] });
    expect((await executeQuery(manager, kitchenQueue, { stationId: bar })).filter((q) => q.orderId === order.id).length).toBeGreaterThan(0);
    await executeCommand(manager, setStationCategories, { stationId: bar, categoryIds: [drinksCat] });
    void mains;

    // Withdrawing a dish nobody started: a void ticket, and no flag on the screen.
    const lines = (await executeQuery(manager, getOrderDetail, { orderId: order.id }))!.lines;
    const queuedDish = lines.find((l) => l.itemName === "Butter Naan")!;
    await executeCommand(manager, voidOrderLine, { lineId: queuedDish.id, reason: "guest changed their mind" });
    expect((await executeQuery(manager, listUnprintedTickets, {})).some((x) => x.kind === "void")).toBe(true);
    expect((await executeQuery(manager, kitchenCancelled, {})).some((c) => c.lineId === queuedDish.id)).toBe(false);

    // Withdrawing one being cooked: the station keeps seeing it until someone confirms.
    const cooking = lines.find((l) => l.itemName === "Paneer Butter Masala")!;
    await executeCommand(manager, advanceOrderLine, { lineId: cooking.id, to: "preparing" });
    await executeCommand(manager, voidOrderLine, { lineId: cooking.id, reason: "table left" });
    const flagged = await executeQuery(manager, kitchenCancelled, {});
    expect(flagged.some((c) => c.lineId === cooking.id)).toBe(true);
    await executeCommand(manager, acknowledgeCancelledLine, { lineId: cooking.id });
    expect((await executeQuery(manager, kitchenCancelled, {})).some((c) => c.lineId === cooking.id)).toBe(false);
    await expect(executeCommand(manager, acknowledgeCancelledLine, { lineId: cooking.id })).rejects.toThrow(/not waiting/);

    // Cancelling the whole order withdraws what was sent: the board stops showing it.
    await executeCommand(manager, cancelOrder, { orderId: order.id, reason: "walked out" });
    expect((await executeQuery(manager, kitchenQueue, {})).some((q) => q.orderId === order.id)).toBe(false);
    expect((await executeQuery(manager, kitchenCancelled, {})).some((c) => c.label === "Table KS-1")).toBe(false);
  });

  it("draws a table at a size, marks specials, and says how long a table has been open (Task 126 1.5, 1.6, 1.9)", async () => {
    const table = await executeCommand(manager, defineTable, { zoneId, label: "S-1", seats: 6 });
    await executeCommand(manager, positionTable, { tableId: table.id, posX: 40, posY: 60, width: 200, height: 120 });
    await expect(
      executeCommand(manager, positionTable, { tableId: table.id, posX: 0, posY: 0, width: 5 }),
    ).rejects.toThrow();

    await executeCommand(manager, moveTable, { tableId: table.id, to: "occupied" });
    const order = await executeCommand(manager, createOrder, { tableId: table.id, covers: 4 });
    const floor = await executeQuery(manager, listFloor, {});
    const row = floor.find((t) => t.id === table.id)!;
    expect([row.width, row.height]).toEqual([200, 120]);
    expect(row.openMinutes).toBe(0);
    expect(row.needsAttention).toBe(false);
    await executeCommand(manager, cancelOrder, { orderId: order.id });

    // A flag on an item shows up in the menu and in the audit diff.
    await executeCommand(manager, editMenuItem, { itemId: paneerId, featured: true });
    const menu = await executeQuery(manager, listMenu, {});
    expect(menu.flatMap((c) => c.items).find((i) => i.id === paneerId)!.featured).toBe(true);
    await executeCommand(manager, editMenuItem, { itemId: paneerId, featured: false });
  });

  async function releaseTable(): Promise<void> {
    const table = await withTenant(tenantId, (tx) =>
      tx.diningTable.findUniqueOrThrow({ where: { id: tableId } }),
    );
    if (table.state === "occupied") {
      await executeCommand(waiter, moveTable, { tableId, to: "cleaning" });
      await executeCommand(waiter, moveTable, { tableId, to: "available" });
    } else if (table.state !== "available") {
      await executeCommand(waiter, moveTable, { tableId, to: "available" });
    }
  }

  /**
   * Seats guests at a table nobody else is using.
   *
   * A table per test rather than one shared row: tests that share a row also
   * share its state, so a failure in one leaves the next in a position it did
   * not ask for — and a stalled transaction anywhere blocks all of them.
   */
  async function seatTable(): Promise<void> {
    const created = await executeCommand(manager, defineTable, {
      zoneId,
      label: `T-${Math.random().toString(36).slice(2, 8)}`,
      seats: 4,
    });
    tableId = created.id;
    await executeCommand(waiter, moveTable, { tableId, to: "occupied" });
  }

  /** Seats a table, serves one dish and bills it. Returns the open bill. */
  async function freshSettledBillFixture(): Promise<{
    billId: string;
    totalMinor: number;
    subtotalMinor: number;
  }> {
    await seatTable();
    const order = await executeCommand(waiter, createOrder, { tableId, covers: 2 });
    await executeCommand(waiter, addOrderLines, {
      orderId: order.id,
      lines: [{ itemId: paneerId, qty: 1 }],
    });
    await executeCommand(waiter, placeOrder, { orderId: order.id });

    const queue = (await executeQuery(manager, kitchenQueue, {})).filter(
      (ticket) => ticket.orderId === order.id,
    );
    await executeCommand(manager, advanceOrderLine, { lineId: queue[0]!.lineId, to: "preparing" });
    await executeCommand(manager, advanceOrderLine, { lineId: queue[0]!.lineId, to: "ready" });
    await executeCommand(waiter, advanceOrderLine, { lineId: queue[0]!.lineId, to: "served" });

    const bill = await executeCommand(manager, generateBill, { orderId: order.id });
    const detail = await executeQuery(manager, getBillDetail, { billId: bill.id });
    return {
      billId: bill.id,
      totalMinor: detail!.totalMinor,
      subtotalMinor: detail!.subtotalMinor,
    };
  }
});
