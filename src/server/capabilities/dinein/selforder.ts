import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { registerCommand, ValidationError, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { diffFields, recordActivity, recordSecurityEvent } from "@/server/platform/audit";
import { assertGrantCeiling } from "@/server/platform/authorization";
import { provisionIdentity } from "@/server/platform/identity";
import type { TenantScopedClient } from "@/server/platform/tenancy";
import type { addOrderLines, createOrder, listMenu } from "./index";
import { ENTITY_BILL, ENTITY_ORDER, ENTITY_SELF_ORDER_SUBMISSION, ENTITY_SERVICE_REQUEST, ENTITY_TABLE } from "./keys";
import { loadOutletProfile } from "./gst";
import { assertOutletInScope, scopedLocationIds } from "./scope";

/**
 * Customer self-order (ADR-042; Task 126 Wave 5).
 *
 * A guest is not an identity. A sticker holds a link; opening it at a seated table starts a
 * short-lived session; what the guest sends is a PROPOSAL that staff accept, except at a table
 * staff have already opened an order for, where it joins that order at once because a person
 * has already vouched for the table. Every guest action runs through the ordinary command
 * pipeline as one provisioned ordering identity per outlet (ADR-017 / ADR-029): no service
 * account, no carve-out in `policy.ts`. The server prices and checks everything; the guest only
 * names items, portions, add-ons, quantities and notes.
 */

/** The caps ADR-042 proposes. Per submission, per session and per outlet. */
export const SELF_ORDER_CAPS = {
  linesPerSubmission: 30,
  pendingPerSession: 3,
  submissionsPerSession: 20,
  pendingPerOutlet: 10,
} as const;

export const SELF_ORDER_ROLE = "Self Order Guest";

/** Exactly what the guest role holds (ADR-042 item 4); nothing else, at Organization scope. */
const GUEST_GRANTS = [
  { verb: "Read", entity: ENTITY_SELF_ORDER_SUBMISSION, scope: "Organization" },
  { verb: "Create", entity: ENTITY_SELF_ORDER_SUBMISSION, scope: "Organization" },
  { verb: "Create", entity: ENTITY_SERVICE_REQUEST, scope: "Organization" },
] as const;

/* -------------------------------- tokens --------------------------------- */

/** 192 random bits, URL-safe, 32 characters. Only the SHA-256 is ever stored. */
export const mintToken = (): string => randomBytes(24).toString("base64url");
export const isToken = (value: string): boolean => /^[A-Za-z0-9_-]{32}$/.test(value);
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/** Closes every open session at a table, so a token from one party cannot order for the next. */
export async function closeTableSessions(tx: TenantScopedClient, tableId: string): Promise<void> {
  await tx.selfOrderSession.updateMany({ where: { tableId, closedAt: null }, data: { closedAt: new Date() } });
}

/** Retention (ADR-042 item 12): a month after they ended, sessions and what hung off them go. */
export async function purgeSelfOrderData(tx: TenantScopedClient, now: Date): Promise<{ sessions: number; requests: number }> {
  const cutoff = new Date(now.getTime() - 30 * 86_400_000);
  const requests = await tx.serviceRequest.deleteMany({ where: { createdAt: { lt: cutoff } } });
  const sessions = await tx.selfOrderSession.deleteMany({ where: { expiresAt: { lt: cutoff } } });
  return { sessions: sessions.count, requests: requests.count };
}

/* ------------------------------ dependencies ------------------------------ */

type OrderableLine = { itemId: string; variantId?: string; modifierIds?: string[] };

/** The order pad's own commands and checks, handed in so this file does not import back into `index.ts`. */
export type SelfOrderDeps = {
  addOrderLines: typeof addOrderLines;
  createOrder: typeof createOrder;
  listMenu: typeof listMenu;
  validateOrderableLine: (tx: TenantScopedClient, where: { locationId: string; channel: string }, line: OrderableLine) => Promise<void>;
};
let deps: SelfOrderDeps | undefined;
const need = (): SelfOrderDeps => {
  if (!deps) throw new Error("self-order dependencies are not registered");
  return deps;
};

const ACCEPTING_STATES = ["draft", "placed", "partially_served"];

/** The channel a session is priced and checked as: its table's order, or a QR pickup order. */
const channelOf = (kind: string): string => (kind === "table" ? "dine_in" : "qr");

/**
 * The session this actor may act in, or a refusal that says nothing about WHY: a closed,
 * expired, wrong or disabled session all read the same. Also binds the call to the outlet's own
 * ordering identity, so no other user can write into a guest session.
 */
async function assertGuestSession(tx: TenantScopedClient, actorUserId: string, sessionId: string) {
  const session = await tx.selfOrderSession.findUnique({ where: { id: sessionId } });
  const profile = session ? await loadOutletProfile(tx, session.locationId) : null;
  const live =
    session &&
    profile &&
    !session.closedAt &&
    session.expiresAt.getTime() > Date.now() &&
    profile.selfOrderEnabled &&
    profile.selfOrderUserId === actorUserId;
  if (!live) throw new ValidationError("E_VALIDATION: this link is no longer active");
  return session;
}

/* ============================ staff: set-up ============================= */

export const setSelfOrder: CommandDefinition<{ locationId: string; enabled: boolean }, { enabled: boolean }> = {
  key: "verity.dinein.set_self_order",
  entity: ENTITY_BILL,
  verb: "Edit",
  input: z.object({ locationId: z.string().uuid(), enabled: z.boolean() }),
  preconditions: async (ctx, input) => {
    await assertOutletInScope(ctx.tx, ctx.actor, ENTITY_BILL, "Edit", input.locationId);
    if (!(await loadOutletProfile(ctx.tx, input.locationId))) {
      throw new ValidationError("E_VALIDATION: save this outlet's profile first");
    }
  },
  handler: async (ctx, input) => {
    const profile = (await loadOutletProfile(ctx.tx, input.locationId))!;
    let userId = profile.selfOrderUserId;

    if (input.enabled && !userId) {
      // The outlet's ordering identity: an ordinary User with a narrow role and no credentials.
      // Whoever creates it must already hold what it is given (the platform's grant ceiling).
      await assertGrantCeiling(ctx.tx, ctx.actor, [...GUEST_GRANTS]);
      const location = await ctx.tx.location.findUniqueOrThrow({ where: { id: input.locationId } });
      const role =
        (await ctx.tx.role.findFirst({ where: { name: SELF_ORDER_ROLE } })) ??
        (await ctx.tx.role.create({ data: { tenantId: ctx.actor.tenantId, name: SELF_ORDER_ROLE } }));
      await ctx.tx.permission.createMany({
        data: GUEST_GRANTS.map((g) => ({ tenantId: ctx.actor.tenantId, roleId: role.id, verb: g.verb, entity: g.entity, scope: g.scope })),
        skipDuplicates: true,
      });
      const identity = await provisionIdentity(ctx.tx, {
        organizationId: location.organizationId,
        authUserId: randomUUID(),
        displayName: `Self order, ${location.name}`,
      });
      await ctx.tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId: role.id } });
      await recordSecurityEvent(ctx.tx, {
        tenantId: ctx.actor.tenantId,
        eventType: "RoleAssigned",
        actorUserId: ctx.actor.userId,
        payload: { membershipId: identity.membershipId, roleId: role.id },
      });
      userId = identity.userId;
    }

    await ctx.tx.outletProfile.update({
      where: { id: profile.id },
      data: { selfOrderEnabled: input.enabled, selfOrderUserId: userId, version: { increment: 1 } },
    });
    // Turning it off ends every open visit at once (ADR-042 item 11).
    if (!input.enabled) {
      await ctx.tx.selfOrderSession.updateMany({ where: { locationId: input.locationId, closedAt: null }, data: { closedAt: new Date() } });
    }
    await recordActivity(ctx, {
      entityKey: ENTITY_BILL,
      entityId: profile.id,
      commandKey: "verity.dinein.set_self_order",
      changes: diffFields({ selfOrderEnabled: profile.selfOrderEnabled }, { selfOrderEnabled: input.enabled }),
    });
    return { result: { enabled: input.enabled }, events: [{ name: "verity.dinein.self_order_set", entityId: profile.id }] };
  },
};

/**
 * Mints the sticker link for one table, or for the outlet's pickup point, and ends the one it
 * replaces. The token is in this result and nowhere else: only its hash is stored, so a lost
 * sticker is replaced, never recovered.
 */
export const createSelfOrderLink: CommandDefinition<
  { locationId: string; tableId?: string | null },
  { token: string; kind: "table" | "pickup" }
> = {
  key: "verity.dinein.create_self_order_link",
  entity: ENTITY_TABLE,
  verb: "Edit",
  input: z.object({ locationId: z.string().uuid(), tableId: z.string().uuid().nullish() }),
  preconditions: async (ctx, input) => {
    await assertOutletInScope(ctx.tx, ctx.actor, ENTITY_TABLE, "Edit", input.locationId);
    if (input.tableId) {
      const table = await ctx.tx.diningTable.findUnique({ where: { id: input.tableId } });
      if (!table || table.locationId !== input.locationId || table.state === "retired") {
        throw new ValidationError("E_VALIDATION: table not found at this outlet");
      }
    }
  },
  handler: async (ctx, input) => {
    const kind = input.tableId ? "table" : "pickup";
    const token = mintToken();
    await ctx.tx.selfOrderLink.updateMany({
      where: { revokedAt: null, kind, ...(input.tableId ? { tableId: input.tableId } : { locationId: input.locationId }) },
      data: { revokedAt: new Date() },
    });
    const link = await ctx.tx.selfOrderLink.create({
      data: {
        tenantId: ctx.actor.tenantId,
        locationId: input.locationId,
        tableId: input.tableId ?? null,
        kind,
        tokenHash: hashToken(token),
        createdByUserId: ctx.actor.userId,
      },
    });
    await recordActivity(ctx, {
      entityKey: ENTITY_TABLE,
      entityId: input.tableId ?? input.locationId,
      commandKey: "verity.dinein.create_self_order_link",
      // The link's id, never the token.
      changes: diffFields({}, { linkId: link.id, kind }),
    });
    return { result: { token, kind }, events: [{ name: "verity.dinein.self_order_link_created", entityId: link.id }] };
  },
};

/* ======================== staff: deciding and answering ======================== */

/** What a guest asked for, in the shape `add_order_lines` takes. */
const linesOf = async (tx: TenantScopedClient, submissionId: string) =>
  (await tx.selfOrderSubmissionLine.findMany({ where: { submissionId } })).map((l) => ({
    itemId: l.itemId,
    variantId: l.variantId ?? undefined,
    modifierIds: l.modifierIds,
    qty: l.qty,
    lineNote: l.lineNote ?? undefined,
  }));

/**
 * Accepts or rejects a guest's pending proposal. Accepting runs `add_order_lines` AS THE
 * ACCEPTING STAFF MEMBER (ADR-042 item 5), opening the table's order first if there is none.
 * The order stays a draft until staff send it, like any other.
 */
export const decideSelfOrderSubmission: CommandDefinition<
  { submissionId: string; decision: "accept" | "reject"; reason?: string },
  { orderId: string | null }
> = {
  key: "verity.dinein.decide_self_order_submission",
  entity: ENTITY_ORDER,
  verb: "Edit",
  input: z.object({
    submissionId: z.string().uuid(),
    decision: z.enum(["accept", "reject"]),
    reason: z.string().trim().max(200).optional(),
  }),
  preconditions: async (ctx, input) => {
    const submission = await ctx.tx.selfOrderSubmission.findUnique({ where: { id: input.submissionId } });
    if (!submission) throw new ValidationError("E_VALIDATION: that guest order is not here any more");
    await assertOutletInScope(ctx.tx, ctx.actor, ENTITY_ORDER, "Edit", submission.locationId);
    if (submission.status !== "pending") throw new ValidationError(`E_VALIDATION: that guest order was already ${submission.status}`);
  },
  handler: async (ctx, input) => {
    const submission = await ctx.tx.selfOrderSubmission.findUniqueOrThrow({ where: { id: input.submissionId } });
    const decided = { decidedAt: new Date(), decidedByUserId: ctx.actor.userId };

    if (input.decision === "reject") {
      await ctx.tx.selfOrderSubmission.update({ where: { id: submission.id }, data: { ...decided, status: "rejected", rejectReason: input.reason || null } });
      await recordActivity(ctx, {
        entityKey: ENTITY_SELF_ORDER_SUBMISSION,
        entityId: submission.id,
        commandKey: "verity.dinein.decide_self_order_submission",
        changes: diffFields({ status: "pending" }, { status: "rejected", reason: input.reason ?? null }),
      });
      return { result: { orderId: null }, events: [{ name: "verity.dinein.self_order_rejected", entityId: submission.id }] };
    }

    const d = need();
    const events: Array<{ name: string; entityId?: string | null; payload?: Record<string, unknown> }> = [];
    let order = submission.tableId
      ? await ctx.tx.diningOrder.findFirst({ where: { tableId: submission.tableId, state: { notIn: ["settled", "cancelled"] } } })
      : null;
    if (order && !ACCEPTING_STATES.includes(order.state)) {
      throw new ValidationError(`E_VALIDATION: that table's order is ${order.state}, so it cannot take more; reject this and ask the guest to see a waiter`);
    }
    if (!order) {
      if (submission.tableId) {
        const table = await ctx.tx.diningTable.findUniqueOrThrow({ where: { id: submission.tableId } });
        if (table.state !== "occupied") throw new ValidationError("E_VALIDATION: that table is no longer seated, so reject this guest order");
      }
      const created = await d.createOrder.handler(
        ctx,
        submission.tableId
          ? { channel: "dine_in", tableId: submission.tableId, covers: 1 }
          : { channel: "qr", locationId: submission.locationId, covers: 1, customerName: submission.customerName ?? undefined, customerPhone: submission.customerPhone ?? undefined },
      );
      events.push(...(created.events ?? []));
      order = await ctx.tx.diningOrder.findUniqueOrThrow({ where: { id: created.result.id } });
    }

    const added = await d.addOrderLines.handler(ctx, { orderId: order.id, lines: await linesOf(ctx.tx, submission.id) });
    events.push(...(added.events ?? []));
    await ctx.tx.selfOrderSubmission.update({ where: { id: submission.id }, data: { ...decided, status: "accepted", orderId: order.id } });
    await recordActivity(ctx, {
      entityKey: ENTITY_SELF_ORDER_SUBMISSION,
      entityId: submission.id,
      commandKey: "verity.dinein.decide_self_order_submission",
      changes: diffFields({ status: "pending" }, { status: "accepted", orderId: order.id }),
    });
    events.push({ name: "verity.dinein.self_order_accepted", entityId: submission.id });
    return { result: { orderId: order.id }, events };
  },
};

export const resolveServiceRequest: CommandDefinition<{ requestId: string; status: "acknowledged" | "resolved" }, { id: string }> = {
  key: "verity.dinein.resolve_service_request",
  entity: ENTITY_ORDER,
  verb: "Edit",
  input: z.object({ requestId: z.string().uuid(), status: z.enum(["acknowledged", "resolved"]) }),
  preconditions: async (ctx, input) => {
    const request = await ctx.tx.serviceRequest.findUnique({ where: { id: input.requestId } });
    if (!request) throw new ValidationError("E_VALIDATION: request not found");
    await assertOutletInScope(ctx.tx, ctx.actor, ENTITY_ORDER, "Edit", request.locationId);
  },
  handler: async (ctx, input) => {
    const request = await ctx.tx.serviceRequest.findUniqueOrThrow({ where: { id: input.requestId } });
    const done = input.status === "resolved";
    await ctx.tx.serviceRequest.update({
      where: { id: request.id },
      data: { status: input.status, resolvedAt: done ? new Date() : null, resolvedByUserId: done ? ctx.actor.userId : null },
    });
    return { result: { id: request.id }, events: [{ name: "verity.dinein.service_request_updated", entityId: request.id }] };
  },
};

/* ====================== guest: run as the ordering identity ====================== */

const lineInput = z.object({
  itemId: z.string().uuid(),
  variantId: z.string().uuid().optional(),
  modifierIds: z.array(z.string().uuid()).max(10).optional(),
  qty: z.number().int().min(1).max(20),
  lineNote: z.string().trim().max(200).optional(),
});

export const submitSelfOrder: CommandDefinition<
  {
    sessionId: string;
    idempotencyKey: string;
    customerName?: string;
    customerPhone?: string;
    lines: Array<z.infer<typeof lineInput>>;
  },
  { id: string; status: string; orderId: string | null }
> = {
  key: "verity.dinein.submit_self_order",
  entity: ENTITY_SELF_ORDER_SUBMISSION,
  verb: "Create",
  scopeHandling: "handler",
  input: z.object({
    sessionId: z.string().uuid(),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_.:-]{16,128}$/),
    customerName: z.string().trim().max(80).optional(),
    customerPhone: z.string().trim().regex(/^\+?[0-9 ]{7,15}$/, "a phone number").optional(),
    lines: z.array(lineInput).min(1).max(SELF_ORDER_CAPS.linesPerSubmission),
  }),
  preconditions: async (ctx, input) => {
    const session = await assertGuestSession(ctx.tx, ctx.actor.userId, input.sessionId);
    const repeat = await ctx.tx.selfOrderSubmission.findUnique({
      where: { self_order_submission_once: { sessionId: session.id, idempotencyKey: input.idempotencyKey } },
    });
    if (repeat) return; // a retry; the handler answers with what was already made
    // Pickup has nobody at a table to ask, so it must leave a way to reach the guest (ADR-042 open (b)).
    if (session.kind === "pickup" && !input.customerPhone) throw new ValidationError("E_VALIDATION: add a phone number so the outlet can reach you");
    const pendingHere = await ctx.tx.selfOrderSubmission.count({ where: { sessionId: session.id, status: "pending" } });
    if (pendingHere >= SELF_ORDER_CAPS.pendingPerSession) throw new ValidationError("E_VALIDATION: your earlier orders are still waiting; please ask a waiter");
    if ((await ctx.tx.selfOrderSubmission.count({ where: { sessionId: session.id } })) >= SELF_ORDER_CAPS.submissionsPerSession) {
      throw new ValidationError("E_VALIDATION: that is the most this visit can send; please ask a waiter");
    }
    const pendingOutlet = await ctx.tx.selfOrderSubmission.count({ where: { locationId: session.locationId, status: "pending" } });
    if (pendingOutlet >= SELF_ORDER_CAPS.pendingPerOutlet) throw new ValidationError("E_VALIDATION: the outlet is busy right now; please ask a waiter");
    const where = { locationId: session.locationId, channel: channelOf(session.kind) };
    for (const line of input.lines) await need().validateOrderableLine(ctx.tx, where, line);
  },
  handler: async (ctx, input) => {
    const session = await assertGuestSession(ctx.tx, ctx.actor.userId, input.sessionId);
    const repeat = await ctx.tx.selfOrderSubmission.findUnique({
      where: { self_order_submission_once: { sessionId: session.id, idempotencyKey: input.idempotencyKey } },
    });
    if (repeat) return { result: { id: repeat.id, status: repeat.status, orderId: repeat.orderId } };

    // One rule: at a table staff have already opened an order for, a person has vouched for the table.
    const open = session.tableId
      ? await ctx.tx.diningOrder.findFirst({ where: { tableId: session.tableId, state: { in: ACCEPTING_STATES } } })
      : null;
    const submission = await ctx.tx.selfOrderSubmission.create({
      data: {
        tenantId: ctx.actor.tenantId,
        sessionId: session.id,
        locationId: session.locationId,
        tableId: session.tableId,
        customerName: input.customerName || null,
        customerPhone: input.customerPhone || null,
        idempotencyKey: input.idempotencyKey,
      },
    });
    await ctx.tx.selfOrderSubmissionLine.createMany({
      data: input.lines.map((l) => ({
        tenantId: ctx.actor.tenantId,
        submissionId: submission.id,
        itemId: l.itemId,
        variantId: l.variantId ?? null,
        modifierIds: [...new Set(l.modifierIds ?? [])],
        qty: l.qty,
        lineNote: l.lineNote || null,
      })),
    });
    const events: Array<{ name: string; entityId?: string | null }> = [{ name: "verity.dinein.self_order_submitted", entityId: submission.id }];
    let status = "pending";
    let orderId: string | null = null;
    if (open) {
      const added = await need().addOrderLines.handler(ctx, { orderId: open.id, lines: await linesOf(ctx.tx, submission.id) });
      events.push(...(added.events ?? []));
      await ctx.tx.selfOrderSubmission.update({
        where: { id: submission.id },
        data: { status: "accepted", autoApplied: true, orderId: open.id, decidedAt: new Date() },
      });
      status = "accepted";
      orderId = open.id;
    }
    await recordActivity(ctx, {
      entityKey: ENTITY_SELF_ORDER_SUBMISSION,
      entityId: submission.id,
      commandKey: "verity.dinein.submit_self_order",
      // The session, so what a visit did can be read back; never the guest's token.
      changes: diffFields({}, { sessionId: session.id, lines: input.lines.length, status }),
    });
    return { result: { id: submission.id, status, orderId }, events };
  },
};

export const requestService: CommandDefinition<{ sessionId: string; kind: "waiter" | "bill" }, { id: string }> = {
  key: "verity.dinein.request_service",
  entity: ENTITY_SERVICE_REQUEST,
  verb: "Create",
  scopeHandling: "handler",
  input: z.object({ sessionId: z.string().uuid(), kind: z.enum(["waiter", "bill"]) }),
  preconditions: async (ctx, input) => {
    const session = await assertGuestSession(ctx.tx, ctx.actor.userId, input.sessionId);
    if (session.kind !== "table") throw new ValidationError("E_VALIDATION: there is no table to send a waiter to");
  },
  handler: async (ctx, input) => {
    const session = await assertGuestSession(ctx.tx, ctx.actor.userId, input.sessionId);
    // Asking twice is asking once.
    const open = await ctx.tx.serviceRequest.findFirst({ where: { sessionId: session.id, kind: input.kind, status: { not: "resolved" } } });
    if (open) return { result: { id: open.id } };
    const created = await ctx.tx.serviceRequest.create({
      data: { tenantId: ctx.actor.tenantId, locationId: session.locationId, tableId: session.tableId, sessionId: session.id, kind: input.kind },
    });
    // Asking for the bill does not generate it (ADR-042 item 8): staff see the request and act.
    return { result: { id: created.id }, events: [{ name: "verity.dinein.service_requested", entityId: created.id }] };
  },
};

/* ================================ queries ================================ */

export type GuestView = {
  outletName: string;
  tableLabel: string | null;
  kind: string;
  menu: Array<{
    categoryName: string;
    items: Array<{
      id: string;
      name: string;
      priceMinor: number;
      variants: Array<{ id: string; name: string; priceDeltaMinor: number }>;
      modifiers: Array<{ id: string; name: string; priceDeltaMinor: number }>;
    }>;
  }>;
  submissions: Array<{ id: string; status: string; at: string; lines: Array<{ name: string; qty: number }> }>;
  openRequests: Array<"waiter" | "bill">;
};

/** Everything the guest page may show, and nothing beyond this one visit (ADR-042 item 7). */
export const selfOrderView: QueryDefinition<{ sessionId: string }, GuestView> = {
  key: "verity.dinein.self_order_view",
  entity: ENTITY_SELF_ORDER_SUBMISSION,
  scopeHandling: "handler",
  input: z.object({ sessionId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const session = await assertGuestSession(ctx.tx, ctx.actor.userId, input.sessionId);
    const location = await ctx.tx.location.findUniqueOrThrow({ where: { id: session.locationId }, select: { name: true } });
    const table = session.tableId ? await ctx.tx.diningTable.findUnique({ where: { id: session.tableId }, select: { label: true } }) : null;
    const menu = await need().listMenu.handler(ctx, { locationId: session.locationId, channel: channelOf(session.kind) as "dine_in" | "qr" });
    const submissions = await ctx.tx.selfOrderSubmission.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
      include: { lines: true },
    });
    const names = new Map(
      (await ctx.tx.menuItem.findMany({ where: { id: { in: submissions.flatMap((s) => s.lines.map((l) => l.itemId)) } }, select: { id: true, name: true } })).map((i) => [i.id, i.name]),
    );
    const requests = await ctx.tx.serviceRequest.findMany({ where: { sessionId: session.id, status: { not: "resolved" } }, select: { kind: true } });
    return {
      outletName: location.name,
      tableLabel: table?.label ?? null,
      kind: session.kind,
      menu: menu
        .map((c) => ({
          categoryName: c.categoryName,
          items: c.items
            .filter((i) => i.active && !i.hiddenReason)
            .map((i) => ({
              id: i.id,
              name: i.name,
              priceMinor: i.priceMinor,
              variants: i.variants,
              modifiers: i.modifiers.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name, priceDeltaMinor: m.priceDeltaMinor })),
            })),
        }))
        .filter((c) => c.items.length > 0),
      submissions: submissions.map((s) => ({
        id: s.id,
        status: s.status,
        at: s.createdAt.toISOString(),
        lines: s.lines.map((l) => ({ name: names.get(l.itemId) ?? "Item", qty: l.qty })),
      })),
      openRequests: [...new Set(requests.map((r) => r.kind as "waiter" | "bill"))],
    };
  },
};

export type SelfOrderInbox = {
  submissions: Array<{
    id: string;
    locationId: string;
    tableId: string | null;
    tableLabel: string | null;
    kind: "table" | "pickup";
    customerName: string | null;
    customerPhone: string | null;
    at: string;
    lines: Array<{ name: string; detail: string | null; qty: number; note: string | null }>;
  }>;
  requests: Array<{ id: string; locationId: string; tableId: string | null; tableLabel: string | null; kind: "waiter" | "bill"; status: string; at: string }>;
};

/** What guests are waiting on, for the outlets the actor can see: pending proposals and open requests. */
export const listSelfOrderInbox: QueryDefinition<{ locationId?: string }, SelfOrderInbox> = {
  key: "verity.dinein.list_self_order_inbox",
  entity: ENTITY_ORDER,
  scopeHandling: "handler",
  input: z.object({ locationId: z.string().uuid().optional() }),
  handler: async (ctx, input) => {
    const locationIds = await scopedLocationIds(ctx.tx, ctx.actor, ENTITY_ORDER, input.locationId);
    const [submissions, requests] = await Promise.all([
      ctx.tx.selfOrderSubmission.findMany({ where: { status: "pending", locationId: { in: locationIds } }, orderBy: { createdAt: "asc" }, include: { lines: true, session: { select: { kind: true } } } }),
      ctx.tx.serviceRequest.findMany({ where: { status: { not: "resolved" }, locationId: { in: locationIds } }, orderBy: { createdAt: "asc" } }),
    ]);
    const lines = submissions.flatMap((s) => s.lines);
    const [items, variants, modifiers, tables] = await Promise.all([
      ctx.tx.menuItem.findMany({ where: { id: { in: lines.map((l) => l.itemId) } }, select: { id: true, name: true } }),
      ctx.tx.menuItemVariant.findMany({ where: { id: { in: lines.flatMap((l) => (l.variantId ? [l.variantId] : [])) } }, select: { id: true, name: true } }),
      ctx.tx.menuModifier.findMany({ where: { id: { in: lines.flatMap((l) => l.modifierIds) } }, select: { id: true, name: true } }),
      ctx.tx.diningTable.findMany({ where: { id: { in: [...submissions.map((s) => s.tableId), ...requests.map((r) => r.tableId)].filter((t): t is string => !!t) } }, select: { id: true, label: true } }),
    ]);
    const name = (rows: Array<{ id: string; name: string }>) => new Map(rows.map((r) => [r.id, r.name]));
    const itemName = name(items);
    const variantName = name(variants);
    const modifierName = name(modifiers);
    const label = new Map(tables.map((t) => [t.id, t.label]));
    return {
      submissions: submissions.map((s) => ({
        id: s.id,
        locationId: s.locationId,
        tableId: s.tableId,
        tableLabel: s.tableId ? (label.get(s.tableId) ?? null) : null,
        kind: s.session.kind as "table" | "pickup",
        customerName: s.customerName,
        customerPhone: s.customerPhone,
        at: s.createdAt.toISOString(),
        lines: s.lines.map((l) => ({
          name: itemName.get(l.itemId) ?? "Item",
          detail: [l.variantId ? variantName.get(l.variantId) : null, ...l.modifierIds.map((m) => modifierName.get(m))].filter(Boolean).join(", ") || null,
          qty: l.qty,
          note: l.lineNote,
        })),
      })),
      requests: requests.map((r) => ({
        id: r.id,
        locationId: r.locationId,
        tableId: r.tableId,
        tableLabel: r.tableId ? (label.get(r.tableId) ?? null) : null,
        kind: r.kind as "waiter" | "bill",
        status: r.status,
        at: r.createdAt.toISOString(),
      })),
    };
  },
};

export type SelfOrderSetupView = {
  outlets: Array<{
    locationId: string;
    name: string;
    hasProfile: boolean;
    enabled: boolean;
    tables: Array<{ id: string; label: string }>;
  }>;
};

/** The outlets the actor may set up, with their tables for printing stickers. */
export const selfOrderSetup: QueryDefinition<Record<string, never>, SelfOrderSetupView> = {
  key: "verity.dinein.self_order_setup",
  entity: ENTITY_BILL,
  scopeHandling: "handler",
  input: z.object({}),
  handler: async (ctx) => {
    const locationIds = await scopedLocationIds(ctx.tx, ctx.actor, ENTITY_BILL, undefined);
    const outlets = await ctx.tx.location.findMany({ where: { id: { in: locationIds }, active: true }, orderBy: { name: "asc" } });
    const profiles = await ctx.tx.outletProfile.findMany({ where: { locationId: { in: locationIds } }, select: { locationId: true, selfOrderEnabled: true } });
    const tables = await ctx.tx.diningTable.findMany({
      where: { locationId: { in: locationIds }, state: { not: "retired" } },
      orderBy: { label: "asc" },
      select: { id: true, label: true, locationId: true },
    });
    return {
      outlets: outlets.map((o) => {
        const profile = profiles.find((p) => p.locationId === o.id);
        return {
          locationId: o.id,
          name: o.name,
          hasProfile: !!profile,
          enabled: !!profile?.selfOrderEnabled,
          tables: tables.filter((t) => t.locationId === o.id).map((t) => ({ id: t.id, label: t.label })),
        };
      }),
    };
  },
};

export function registerDineinSelfOrder(dependencies: SelfOrderDeps): void {
  deps = dependencies;
  registerCommand(setSelfOrder);
  registerCommand(createSelfOrderLink);
  registerCommand(decideSelfOrderSubmission);
  registerCommand(resolveServiceRequest);
  registerCommand(submitSelfOrder);
  registerCommand(requestService);
  registerQuery(selfOrderView);
  registerQuery(listSelfOrderInbox);
  registerQuery(selfOrderSetup);
}
