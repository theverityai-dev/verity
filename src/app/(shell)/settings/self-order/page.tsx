import { withPageAccess } from "@/components/ui/PageAccess";
import { requireActor } from "@/server/platform/auth";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import { ForbiddenError } from "@/server/platform/authorization";
import { publicOrigin } from "@/server/platform/public-url";
import { selfOrderSetup } from "@/server/capabilities/dinein";
import { EmptyState, ErrorState, PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { SelfOrderSetup } from "./SelfOrderSetup";

export const dynamic = "force-dynamic";

/**
 * Customer ordering from a phone (ADR-042). Off until an outlet turns it on; once on, each seated
 * table's sticker and the outlet's pickup sticker are printed from here.
 */
async function SelfOrderSettingsPage() {
  installCapabilities();
  const actor = await requireActor();

  let setup: Awaited<ReturnType<typeof selfOrderSetup.handler>>;
  try {
    setup = await executeQuery(actor, selfOrderSetup, {});
  } catch (error) {
    if (error instanceof ForbiddenError) return <PermissionDenied what="customer ordering settings" />;
    throw error;
  }

  // The address on a sticker is the one Verity is configured with, never one read from this request.
  let origin: string | null = null;
  try {
    origin = publicOrigin();
  } catch {
    origin = null;
  }

  return (
    <>
      <PageHeader
        title="Customer ordering"
        description="Guests scan a sticker on their table, choose from the menu and send it to you. Nothing reaches the kitchen until your team adds it to the order, unless a waiter has already opened the table's order."
      />
      {origin === null && (
        <div className="mb-6">
          <ErrorState title="Stickers cannot be printed yet" message="The public address of this system is not configured, so a sticker would point nowhere. Ask whoever runs the deployment to set it." />
        </div>
      )}
      {setup.outlets.length === 0 ? (
        <EmptyState title="No outlets in your scope" description="Customer ordering is set up per outlet." />
      ) : (
        <div className="flex flex-col gap-6">
          {setup.outlets.map((outlet) => (
            <SelfOrderSetup key={outlet.locationId} outlet={outlet} origin={origin} />
          ))}
        </div>
      )}
    </>
  );
}

export default withPageAccess(SelfOrderSettingsPage);
