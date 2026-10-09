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
  ENTITY_MENU_VARIANT,
  ENTITY_ORDER,
  ENTITY_ORDER_LINE,
  ENTITY_PAYMENT,
  ENTITY_SELF_ORDER_SUBMISSION,
  ENTITY_SERVICE_REQUEST,
  ENTITY_TABLE,
  ENTITY_ZONE,
  SELF_ORDER_CAPS,
  SELF_ORDER_ROLE,
  addOrderLines,
  createMenuCategory,
  createMenuItem,
  createMenuModifier,
  createOrder,
  createSelfOrderLink,
  decideSelfOrderSubmission,
  defineTable,
  defineZone,
  getOrderDetail,
  kitchenQueue,
  listFloor,
  listSelfOrderInbox,
  moveTable,
  purgeSelfOrderData,
  registerDineinCapability,
  requestService,
  resolveServiceRequest,
  saveOutletProfile,
  selfOrderSetup,
  selfOrderView,
  setMenuItemActive,
  setSelfOrder,
  submitSelfOrder,
} from "@/server/capabilities/dinein";
import { openGuestSession, resolveGuestSession, type GuestSession } from "@/server/capabilities/dinein/selforder-public";

/**
 * Customer self-order (ADR-042; Task 126 Wave 5), proven as an anonymous visitor would meet it:
 * a sticker link, a session token, and nothing else. The guest-facing calls run through the real
 * command pipeline as the outlet's provisioned ordering identity, so what is asserted is what
 * `enforcePolicy()` and the database actually do, not what a route intends.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  const message = "capability-dinein-selforder.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describeDb("capability: Dine-in customer self-order (ADR-042)", () => {
  const tenantId = randomUUID();

  let organizationId: string;
  let locationId: string;
  let manager: ActorContext;
  let waiter: ActorContext;
  let zoneId: string;
  let paneerId: string;
  let naanId: string;
  let extraCheeseId: string;
  let soldOutId: string;

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
      await tx.tenant.create({ data: { id: tenantId, name: "Self Order Test Kitchen", timeZone: "Asia/Kolkata" } });
      await activateCapability(tx, tenantId, DINEIN_CAPABILITY);
      organizationId = (await tx.organization.create({ data: { tenantId, name: "Defence Colony" } })).id;
      locationId = (await tx.location.create({ data: { tenantId, organizationId, name: "Defence Colony" } })).id;
      await setConfig(tx, tenantId, CONFIG_CGST_RATE, 2.5, "Tenant");
      await setConfig(tx, tenantId, CONFIG_SGST_RATE, 2.5, "Tenant");

      const managerRole = await tx.role.create({ data: { tenantId, name: "Manager" }, select: { id: true } });
      const waiterRole = await tx.role.create({ data: { tenantId, name: "Waiter" }, select: { id: true } });
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
        // Whoever turns self-order on must already hold what the ordering identity is given.
        ENTITY_SELF_ORDER_SUBMISSION,
        ENTITY_SERVICE_REQUEST,
      ];
      await tx.permission.createMany({
        data: everything.flatMap((entity) =>
          (["Read", "Create", "Edit", "ActionExecute"] as const).map((verb) => ({ tenantId, roleId: managerRole.id, verb, entity, scope: "Tenant" as const })),
        ),
      });
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
        ],
      });
      const managerIdentity = await provisionIdentity(tx, { organizationId, authUserId: randomUUID(), displayName: "Kent" });
      const waiterIdentity = await provisionIdentity(tx, { organizationId, authUserId: randomUUID(), displayName: "Ravi" });
      await tx.tenantMembership.update({ where: { id: managerIdentity.membershipId }, data: { roleId: managerRole.id } });
      await tx.tenantMembership.update({ where: { id: waiterIdentity.membershipId }, data: { roleId: waiterRole.id } });
      manager = { tenantId, userId: managerIdentity.userId, membershipId: managerIdentity.membershipId, organizationId, roleId: managerRole.id };
      waiter = { tenantId, userId: waiterIdentity.userId, membershipId: waiterIdentity.membershipId, organizationId, roleId: waiterRole.id };
    });
    invalidateCapabilityCache();

    const category = await executeCommand(manager, createMenuCategory, { name: "Mains" });
    paneerId = (await executeCommand(manager, createMenuItem, { categoryId: category.id, name: "Paneer Butter Masala", priceMinor: 42_000 })).id;
    naanId = (await executeCommand(manager, createMenuItem, { categoryId: category.id, name: "Butter Naan", priceMinor: 8_000 })).id;
    extraCheeseId = (await executeCommand(manager, createMenuModifier, { itemId: naanId, name: "Extra cheese", priceDeltaMinor: 2_500 })).id;
    soldOutId = (await executeCommand(manager, createMenuItem, { categoryId: category.id, name: "Seasonal Special", priceMinor: 30_000 })).id;
    await executeCommand(manager, setMenuItemActive, { itemId: soldOutId, active: false });
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

  /* ------------------------------- helpers ------------------------------- */

  const newTable = async (label: string, seat: boolean) => {
    const table = await executeCommand(manager, defineTable, { zoneId, label, seats: 4 });
    if (seat) await executeCommand(waiter, moveTable, { tableId: table.id, to: "occupied" });
    return table.id;
  };

  /** Opens a guest visit the way a phone would: sticker token to session token to actor. */
  const visit = async (tableId: string | null): Promise<GuestSession> => {
    const link = await executeCommand(manager, createSelfOrderLink, { locationId, tableId });
    const sessionToken = await openGuestSession(link.token);
    expect(sessionToken).not.toBeNull();
    const session = await resolveGuestSession(sessionToken!);
    expect(session).not.toBeNull();
    return session!;
  };

  const submit = (session: GuestSession, overrides: Record<string, unknown> = {}) =>
    executeCommand(
      session.actor,
      submitSelfOrder,
      {
        sessionId: session.sessionId,
        idempotencyKey: randomUUID(),
        lines: [{ itemId: paneerId, qty: 2 }],
        ...overrides,
      } as never,
      "api",
    );

  const asAdmin = async <T>(run: (db: PrismaClient) => Promise<T>): Promise<T> => {
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      return await run(admin);
    } finally {
      await admin.$disconnect();
    }
  };

  /* ---------------------------------- tests --------------------------------- */

  it("stays dark until an outlet with a profile turns it on, and only people who may edit the bill can", async () => {
    await expect(executeCommand(manager, setSelfOrder, { locationId, enabled: true })).rejects.toThrow(/profile first/);
    await executeCommand(manager, saveOutletProfile, {
      locationId,
      code: "DC",
      legalName: "Defence Colony Kitchen",
      registrationType: "unregistered",
      dayStartMinute: 300,
      serviceChargeBp: 0,
      platformTaxFree: true,
    });

    // Off: a sticker link opens nothing, whatever its token.
    const tableId = await newTable("D-1", true);
    const link = await executeCommand(manager, createSelfOrderLink, { locationId, tableId });
    expect(await openGuestSession(link.token)).toBeNull();

    await expect(executeCommand(waiter, setSelfOrder, { locationId, enabled: true })).rejects.toThrow();
    await executeCommand(manager, setSelfOrder, { locationId, enabled: true });

    // The ordering identity holds exactly the three grants, at Organization scope, and nothing else.
    const granted = await withTenant(tenantId, async (tx) => {
      const role = await tx.role.findFirstOrThrow({ where: { name: SELF_ORDER_ROLE }, include: { permissions: true } });
      return role.permissions.map((p) => `${p.verb} ${p.entity} ${p.scope}`).sort();
    });
    expect(granted).toEqual(
      [
        `Create ${ENTITY_SELF_ORDER_SUBMISSION} Organization`,
        `Create ${ENTITY_SERVICE_REQUEST} Organization`,
        `Read ${ENTITY_SELF_ORDER_SUBMISSION} Organization`,
      ].sort(),
    );

    const setup = await executeQuery(manager, selfOrderSetup, {});
    expect(setup.outlets.find((o) => o.locationId === locationId)).toMatchObject({ hasProfile: true, enabled: true });
    expect(await openGuestSession(link.token)).not.toBeNull();
  });

  it("opens only for a seated table, and answers every wrong token identically", async () => {
    const empty = await newTable("D-2", false);
    const link = await executeCommand(manager, createSelfOrderLink, { locationId, tableId: empty });
    // The sticker alone never orders: an empty table opens nothing.
    expect(await openGuestSession(link.token)).toBeNull();

    // Malformed, unknown and a real-but-unseated token are indistinguishable.
    expect(await openGuestSession("not-a-token")).toBeNull();
    expect(await openGuestSession("A".repeat(32))).toBeNull();
    expect(await resolveGuestSession("A".repeat(32))).toBeNull();

    await executeCommand(waiter, moveTable, { tableId: empty, to: "occupied" });
    const sessionToken = await openGuestSession(link.token);
    expect(sessionToken).not.toBeNull();
    // The visit's token is its own: the sticker's token is not a session.
    expect(await resolveGuestSession(link.token)).toBeNull();
    expect(await resolveGuestSession(sessionToken!)).not.toBeNull();

    // Issuing a new sticker ends the old one.
    const replacement = await executeCommand(manager, createSelfOrderLink, { locationId, tableId: empty });
    expect(await openGuestSession(link.token)).toBeNull();
    expect(await openGuestSession(replacement.token)).not.toBeNull();
  });

  it("lets a guest propose, prices it on the server, and leaves the kitchen to staff", async () => {
    const tableId = await newTable("D-3", true);
    const session = await visit(tableId);

    const view = await executeQuery(session.actor, selfOrderView, { sessionId: session.sessionId }, "api");
    const mains = view.menu.flatMap((c) => c.items);
    expect(mains.find((i) => i.id === paneerId)!.priceMinor).toBe(42_000);
    // A retired dish is not on the guest's menu.
    expect(mains.some((i) => i.id === soldOutId)).toBe(false);
    expect(view.tableLabel).toBe("D-3");

    const key = randomUUID();
    const first = await submit(session, { idempotencyKey: key });
    expect(first.status).toBe("pending");
    expect(first.orderId).toBeNull();
    // A retry with the same key makes nothing new.
    const retry = await submit(session, { idempotencyKey: key });
    expect(retry.id).toBe(first.id);
    expect(await withTenant(tenantId, (tx) => tx.selfOrderSubmission.count({ where: { sessionId: session.sessionId } }))).toBe(1);

    // Nothing reached the kitchen or the order book: it is a proposal.
    expect(await withTenant(tenantId, (tx) => tx.diningOrder.count({ where: { tableId } }))).toBe(0);
    expect((await executeQuery(manager, kitchenQueue, {})).filter((t) => t.label === "Table D-3")).toHaveLength(0);

    // Staff see it, by name, and accept it AS themselves.
    const inbox = await executeQuery(waiter, listSelfOrderInbox, {});
    const pending = inbox.submissions.find((s) => s.id === first.id)!;
    expect(pending.tableLabel).toBe("D-3");
    expect(pending.lines).toEqual([{ name: "Paneer Butter Masala", detail: null, qty: 2, note: null }]);

    const accepted = await executeCommand(waiter, decideSelfOrderSubmission, { submissionId: first.id, decision: "accept" });
    expect(accepted.orderId).not.toBeNull();
    const detail = await executeQuery(waiter, getOrderDetail, { orderId: accepted.orderId! });
    expect(detail!.lines).toHaveLength(1);
    expect(detail!.lines[0]).toMatchObject({ qty: 2, unitPriceMinor: 42_000 });
    const order = await withTenant(tenantId, (tx) => tx.diningOrder.findUniqueOrThrow({ where: { id: accepted.orderId! } }));
    expect(order.takenByUserId).toBe(waiter.userId);
    await expect(executeCommand(waiter, decideSelfOrderSubmission, { submissionId: first.id, decision: "accept" })).rejects.toThrow(/already accepted/);

    // With an order now open at the table, a person has vouched for it: the next proposal joins it at once.
    const direct = await submit(session, { lines: [{ itemId: naanId, modifierIds: [extraCheeseId], qty: 1, lineNote: "toasted" }] });
    expect(direct.status).toBe("accepted");
    expect(direct.orderId).toBe(accepted.orderId);
    const after = await executeQuery(waiter, getOrderDetail, { orderId: accepted.orderId! });
    expect(after!.lines).toHaveLength(2);
    // The price is the server's: item plus the add-on, not anything the guest sent.
    expect(after!.lines.find((l) => l.itemName === "Butter Naan")!.unitPriceMinor).toBe(10_500);
  });

  it("refuses what a guest may not do, whoever they pretend to be", async () => {
    const tableId = await newTable("D-4", true);
    const session = await visit(tableId);

    // The ordering identity can do exactly three things; the rest of the floor is closed to it.
    await expect(executeCommand(session.actor, createOrder, { tableId, covers: 1 }, "api")).rejects.toThrow();
    await expect(executeCommand(session.actor, addOrderLines, { orderId: randomUUID(), lines: [{ itemId: paneerId, qty: 1 }] }, "api")).rejects.toThrow();
    await expect(executeQuery(session.actor, listFloor, {}, "api")).rejects.toThrow();
    await expect(executeQuery(session.actor, kitchenQueue, {}, "api")).rejects.toThrow();
    await expect(executeQuery(session.actor, listSelfOrderInbox, {}, "api")).rejects.toThrow();

    // A retired dish, an add-on from another dish and an unknown dish are all turned away.
    await expect(submit(session, { lines: [{ itemId: soldOutId, qty: 1 }] })).rejects.toThrow(/not available/);
    await expect(submit(session, { lines: [{ itemId: paneerId, modifierIds: [extraCheeseId], qty: 1 }] })).rejects.toThrow(/add-on/);
    await expect(submit(session, { lines: [{ itemId: randomUUID(), qty: 1 }] })).rejects.toThrow(/not found/);
    // Quantities and line counts are capped.
    await expect(submit(session, { lines: [{ itemId: paneerId, qty: 21 }] })).rejects.toThrow();
    await expect(submit(session, { lines: Array.from({ length: SELF_ORDER_CAPS.linesPerSubmission + 1 }, () => ({ itemId: paneerId, qty: 1 })) })).rejects.toThrow();

    // A staff member, even one holding the grants, cannot write into a guest's visit: it is bound to the
    // outlet's own ordering identity.
    await expect(
      executeCommand(manager, submitSelfOrder, { sessionId: session.sessionId, idempotencyKey: randomUUID(), lines: [{ itemId: paneerId, qty: 1 }] }),
    ).rejects.toThrow(/no longer active/);
    // And a guest cannot reach a session that is not theirs.
    const other = await visit(await newTable("D-5", true));
    await expect(
      executeCommand(session.actor, submitSelfOrder, { sessionId: randomUUID(), idempotencyKey: randomUUID(), lines: [{ itemId: paneerId, qty: 1 }] }, "api"),
    ).rejects.toThrow(/no longer active/);
    expect(other.sessionId).not.toBe(session.sessionId);

    // Pending proposals per visit are capped.
    for (let i = 0; i < SELF_ORDER_CAPS.pendingPerSession; i += 1) await submit(session);
    await expect(submit(session)).rejects.toThrow(/still waiting/);
  });

  it("lets staff reject a proposal and answers a call for the waiter or the bill once", async () => {
    const tableId = await newTable("D-6", true);
    const session = await visit(tableId);

    const proposal = await submit(session);
    await executeCommand(waiter, decideSelfOrderSubmission, { submissionId: proposal.id, decision: "reject", reason: "Kitchen is closing" });
    const view = await executeQuery(session.actor, selfOrderView, { sessionId: session.sessionId }, "api");
    expect(view.submissions.find((s) => s.id === proposal.id)!.status).toBe("rejected");

    const call = await executeCommand(session.actor, requestService, { sessionId: session.sessionId, kind: "waiter" }, "api");
    const again = await executeCommand(session.actor, requestService, { sessionId: session.sessionId, kind: "waiter" }, "api");
    expect(again.id).toBe(call.id);
    await executeCommand(session.actor, requestService, { sessionId: session.sessionId, kind: "bill" }, "api");
    // Asking for the bill does not make one.
    expect(await withTenant(tenantId, (tx) => tx.bill.count({ where: { order: { tableId } } }))).toBe(0);

    const inbox = await executeQuery(waiter, listSelfOrderInbox, {});
    expect(inbox.requests.filter((r) => r.tableLabel === "D-6").map((r) => r.kind).sort()).toEqual(["bill", "waiter"]);
    await executeCommand(waiter, resolveServiceRequest, { requestId: call.id, status: "resolved" });
    const after = await executeQuery(waiter, listSelfOrderInbox, {});
    expect(after.requests.filter((r) => r.tableLabel === "D-6").map((r) => r.kind)).toEqual(["bill"]);
  });

  it("ends a visit when the table turns over, when it idles, or when the outlet turns self-order off", async () => {
    const tableId = await newTable("D-7", true);
    const session = await visit(tableId);
    const token = (await withTenant(tenantId, (tx) => tx.selfOrderSession.findUniqueOrThrow({ where: { id: session.sessionId } }))).tokenHash;
    expect(token).toHaveLength(64);

    // The table is released: the visit is over, and the next party at the same table starts fresh.
    await executeCommand(waiter, moveTable, { tableId, to: "cleaning" });
    await expect(submit(session)).rejects.toThrow(/no longer active/);
    await executeCommand(waiter, moveTable, { tableId, to: "available" });
    await executeCommand(waiter, moveTable, { tableId, to: "occupied" });
    const next = await visit(tableId);
    expect(next.sessionId).not.toBe(session.sessionId);

    // Idle for over half an hour: the token stops resolving at all.
    const sessionToken = await (async () => {
      const link = await executeCommand(manager, createSelfOrderLink, { locationId, tableId });
      return openGuestSession(link.token);
    })();
    expect(await resolveGuestSession(sessionToken!)).not.toBeNull();
    await asAdmin((db) => db.$executeRaw`UPDATE self_order_session SET last_activity_at = now() - interval '31 minutes' WHERE tenant_id = ${tenantId}::uuid`);
    expect(await resolveGuestSession(sessionToken!)).toBeNull();

    // Turning it off ends the live ones and refuses new ones.
    const fresh = await visit(tableId);
    await executeCommand(manager, setSelfOrder, { locationId, enabled: false });
    expect(await resolveGuestSession("A".repeat(32))).toBeNull();
    await expect(submit(fresh)).rejects.toThrow(/no longer active/);
    const link = await executeCommand(manager, createSelfOrderLink, { locationId, tableId });
    expect(await openGuestSession(link.token)).toBeNull();
    await executeCommand(manager, setSelfOrder, { locationId, enabled: true });
  });

  it("takes pickup orders at the outlet with a phone number, and accepts them as a QR order", async () => {
    const session = await visit(null);
    expect(session.kind).toBe("pickup");
    // A pickup guest has nobody at a table to ask, so it must leave a way to reach them.
    await expect(submit(session)).rejects.toThrow(/phone number/);
    await expect(executeCommand(session.actor, requestService, { sessionId: session.sessionId, kind: "waiter" }, "api")).rejects.toThrow(/no table/);

    const proposal = await submit(session, { customerName: "Meera", customerPhone: "+91 98100 00000" });
    expect(proposal.status).toBe("pending");
    const accepted = await executeCommand(waiter, decideSelfOrderSubmission, { submissionId: proposal.id, decision: "accept" });
    const order = await withTenant(tenantId, (tx) => tx.diningOrder.findUniqueOrThrow({ where: { id: accepted.orderId! } }));
    expect(order).toMatchObject({ channel: "qr", locationId, customerName: "Meera", customerPhone: "+91 98100 00000", takenByUserId: waiter.userId });
  });

  it("purges visits a month after they end, and nothing sooner", async () => {
    const now = new Date();
    const early = await withTenant(tenantId, (tx) => purgeSelfOrderData(tx, now));
    expect(early.sessions).toBe(0);
    const later = await withTenant(tenantId, (tx) => purgeSelfOrderData(tx, new Date(now.getTime() + 31 * 86_400_000)));
    expect(later.sessions).toBeGreaterThan(0);
    expect(await withTenant(tenantId, (tx) => tx.selfOrderSession.count())).toBe(0);
  });
});
