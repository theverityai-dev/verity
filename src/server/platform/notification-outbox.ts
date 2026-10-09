import { z } from "zod";
import { registerCommand, ValidationError, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { registerPlatformSchedule } from "@/server/platform/contribution";
import { diffFields, recordActivity } from "@/server/platform/audit";
import { isEnabled } from "@/server/platform/notification";
import { entityLabel, humanizeSegment } from "@/server/platform/label";
import type { TenantScopedClient } from "@/server/platform/tenancy";

/**
 * Outbound notifications through an outbox (ADR-039).
 *
 * `domain_event` is the outbox. A dispatcher reads a tenant's undelivered events
 * oldest first and, for each one a role is subscribed to, writes one in-app
 * notification per member of that role, then sets `delivered_at` (the one column
 * the write-once trigger lets change). It is at-least-once: a notification
 * carries a dedupe key (event, channel, recipient), so a run that crashes after
 * writing and before marking delivered repeats harmlessly.
 *
 * Default off. With no subscription nothing is sent, and the event is simply
 * marked processed so the queue drains. A subscription only covers events raised
 * after it was made, so turning an alert on never floods people with history.
 * The person who caused an event is not told about their own action.
 *
 * In-app is the only channel for now: it needs no credential or provider and
 * proves the dispatcher, the dedupe and the opt-in. Email and WhatsApp-class
 * channels are adapters that would widen the channel check later (ADR-039 cl. 4).
 */

export const ENTITY_NOTIFICATION_SUBSCRIPTION = "verity.platform.notification_subscription";
const CHANNEL = "InApp" as const;
const DISPATCH_BATCH = 200;

/** `verity.dinein.order_lines_added` becomes "Order Lines Added". */
export function eventLabel(eventName: string): string {
  return humanizeSegment(eventName.split(".").at(-1) ?? eventName);
}

export type DispatchResult = { events: number; notified: number; suppressed: number };

/**
 * One run for one tenant. Idempotent: events already delivered are not read, and
 * notifications are written with `skipDuplicates` against the dedupe key.
 */
export async function dispatchEvents(tx: TenantScopedClient, now: Date = new Date()): Promise<DispatchResult> {
  const events = await tx.domainEvent.findMany({
    where: { deliveredAt: null },
    orderBy: { occurredAt: "asc" },
    take: DISPATCH_BATCH,
  });
  if (events.length === 0) return { events: 0, notified: 0, suppressed: 0 };

  const subscriptions = await tx.notificationSubscription.findMany({ where: { channel: CHANNEL } });
  const rolesByEvent = new Map<string, Array<{ roleId: string; since: Date }>>();
  for (const sub of subscriptions) {
    rolesByEvent.set(sub.eventName, [...(rolesByEvent.get(sub.eventName) ?? []), { roleId: sub.roleId, since: sub.createdAt }]);
  }

  const roleIds = [...new Set(subscriptions.map((s) => s.roleId))];
  const members = roleIds.length > 0
    ? await tx.tenantMembership.findMany({ where: { roleId: { in: roleIds } }, select: { userId: true, roleId: true } })
    : [];
  const usersByRole = new Map<string, string[]>();
  for (const m of members) usersByRole.set(m.roleId!, [...(usersByRole.get(m.roleId!) ?? []), m.userId]);

  let notified = 0;
  let suppressed = 0;
  for (const event of events) {
    const roles = (rolesByEvent.get(event.name) ?? []).filter((r) => r.since <= event.occurredAt);
    const recipients = [...new Set(roles.flatMap((r) => usersByRole.get(r.roleId) ?? []))].filter((id) => id !== event.actorUserId);

    const rows = [];
    for (const recipientId of recipients) {
      const wanted = await isEnabled(tx, { userId: recipientId, key: event.name, channel: CHANNEL });
      rows.push({
        tenantId: event.tenantId,
        recipientId,
        key: event.name,
        channel: CHANNEL,
        status: wanted ? ("Sent" as const) : ("Suppressed" as const),
        subject: eventLabel(event.name),
        // Only what the recipient may already see: the kind of record, never a figure.
        body: entityLabel(event.entityKey),
        entityKey: event.entityKey,
        entityId: event.entityId,
        sentAt: wanted ? now : null,
        dedupeKey: `${event.id}:${CHANNEL}:${recipientId}`,
      });
      if (wanted) notified++;
      else suppressed++;
    }
    if (rows.length > 0) await tx.notification.createMany({ data: rows, skipDuplicates: true });
  }

  await tx.domainEvent.updateMany({ where: { id: { in: events.map((e) => e.id) } }, data: { deliveredAt: now } });
  return { events: events.length, notified, suppressed };
}

export type SubscriptionView = {
  events: Array<{ name: string; label: string }>;
  roles: Array<{ id: string; name: string }>;
  subscriptions: Array<{ eventName: string; roleId: string }>;
};

export const listNotificationSubscriptions: QueryDefinition<Record<string, never>, SubscriptionView> = {
  key: "verity.platform.list_notification_subscriptions",
  entity: ENTITY_NOTIFICATION_SUBSCRIPTION,
  input: z.object({}),
  handler: async (ctx) => {
    const since = new Date(Date.now() - 90 * 86_400_000);
    const [seen, roles, subs] = await Promise.all([
      ctx.tx.domainEvent.findMany({ where: { occurredAt: { gte: since } }, distinct: ["name"], select: { name: true } }),
      ctx.tx.role.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      ctx.tx.notificationSubscription.findMany({ where: { channel: CHANNEL } }),
    ]);
    const names = [...new Set([...seen.map((e) => e.name), ...subs.map((s) => s.eventName)])].sort();
    return {
      events: names.map((name) => ({ name, label: eventLabel(name) })),
      roles: roles.filter((r) => r.name !== "Verity Operator"),
      subscriptions: subs.map((s) => ({ eventName: s.eventName, roleId: s.roleId })),
    };
  },
};

export const setNotificationSubscription: CommandDefinition<{ eventName: string; roleId: string; enabled: boolean }, { eventName: string; roleId: string; enabled: boolean }> = {
  key: "verity.platform.set_notification_subscription",
  entity: ENTITY_NOTIFICATION_SUBSCRIPTION,
  verb: "Edit",
  input: z.object({
    eventName: z.string().regex(/^[a-z][a-z0-9_.]{2,120}$/),
    roleId: z.string().uuid(),
    enabled: z.boolean(),
  }),
  preconditions: async (ctx, input) => {
    if (!(await ctx.tx.role.findUnique({ where: { id: input.roleId } }))) {
      throw new ValidationError("E_VALIDATION: role not found");
    }
  },
  handler: async (ctx, input) => {
    const where = { tenantId_eventName_roleId_channel: { tenantId: ctx.actor.tenantId, eventName: input.eventName, roleId: input.roleId, channel: CHANNEL } };
    const existing = await ctx.tx.notificationSubscription.findUnique({ where });
    if (input.enabled && !existing) {
      await ctx.tx.notificationSubscription.create({
        data: { tenantId: ctx.actor.tenantId, eventName: input.eventName, roleId: input.roleId, channel: CHANNEL, createdByUserId: ctx.actor.userId },
      });
    } else if (!input.enabled && existing) {
      await ctx.tx.notificationSubscription.delete({ where });
    }
    await recordActivity(ctx, {
      entityKey: ENTITY_NOTIFICATION_SUBSCRIPTION,
      entityId: input.roleId,
      commandKey: "verity.platform.set_notification_subscription",
      changes: diffFields({ [input.eventName]: existing ? "on" : "off" }, { [input.eventName]: input.enabled ? "on" : "off" }),
    });
    return { result: input, events: [] };
  },
};

export function registerNotificationOutbox(): void {
  registerCommand(setNotificationSubscription);
  registerQuery(listNotificationSubscriptions);
  registerPlatformSchedule({
    key: "verity.platform.dispatch_events",
    label: "Deliver subscribed alerts",
    cadence: "frequent",
    run: async ({ tx, now }) => {
      await dispatchEvents(tx, now);
      return {};
    },
  });
}
