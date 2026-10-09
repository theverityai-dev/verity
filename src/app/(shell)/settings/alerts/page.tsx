import { withPageAccess } from "@/components/ui/PageAccess";
import { requireActor } from "@/server/platform/auth";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import { ForbiddenError } from "@/server/platform/authorization";
import { listNotificationSubscriptions } from "@/server/platform/notification-outbox";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { AlertsPanel } from "./AlertsPanel";

export const dynamic = "force-dynamic";

/**
 * Choose which events tell which people (ADR-039). Everything is off until an
 * administrator turns it on, and an alert only covers events from that moment on.
 */
async function AlertsPage() {
  installCapabilities();
  const actor = await requireActor();

  let view: Awaited<ReturnType<typeof listNotificationSubscriptions.handler>>;
  try {
    view = await executeQuery(actor, listNotificationSubscriptions, {});
  } catch (error) {
    if (error instanceof ForbiddenError) return <PermissionDenied what="alert settings" />;
    throw error;
  }

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Pick the events that should notify a role. Nothing is sent until you turn it on, and an alert covers only what happens after you do. People see them under Notifications."
      />
      <AlertsPanel view={view} />
    </>
  );
}

export default withPageAccess(AlertsPage);
