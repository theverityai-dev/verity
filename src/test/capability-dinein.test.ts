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
