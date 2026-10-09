import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { PageHeader } from "@/components/ui/primitives";
import { NotificationList } from "./NotificationList";

export const dynamic = "force-dynamic";

/**
 * The signed-in person's own notifications, newest first. Everyone has this
 * page: it shows only rows addressed to them, so it needs no permission.
 * Alerts a client administrator subscribed this person's role to (ADR-039)
 * land here, next to anything the platform raised for them directly.
 */
export default async function NotificationsPage() {
  const actor = await requireActor();
  const rows = await withTenant(actor.tenantId, (tx) =>
    tx.notification.findMany({
      where: { recipientId: actor.userId, channel: "InApp", status: { not: "Suppressed" } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  );

  return (
    <>
      <PageHeader title="Notifications" description="Alerts and messages addressed to you." />
      <NotificationList
        items={rows.map((n) => ({
          id: n.id,
          subject: n.subject,
          body: n.body,
          at: n.createdAt.toISOString(),
          unread: n.readAt === null,
        }))}
      />
    </>
  );
}
