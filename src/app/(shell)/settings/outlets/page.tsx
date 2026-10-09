import { withPageAccess } from "@/components/ui/PageAccess";
import { requireActor } from "@/server/platform/auth";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import { ForbiddenError } from "@/server/platform/authorization";
import { listOutletProfiles } from "@/server/capabilities/dinein";
import { EmptyState, PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { OutletProfileForm } from "./OutletProfileForm";

export const dynamic = "force-dynamic";

/**
 * Each outlet's billing identity (ADR-040). Until an outlet is set up here it bills
 * as it always has; once it is, every bill is a numbered tax invoice naming this seller.
 */
async function OutletsPage() {
  installCapabilities();
  const actor = await requireActor();

  let outlets: Awaited<ReturnType<typeof listOutletProfiles.handler>>;
  try {
    outlets = await executeQuery(actor, listOutletProfiles, {});
  } catch (error) {
    if (error instanceof ForbiddenError) return <PermissionDenied what="outlet billing settings" />;
    throw error;
  }

  return (
    <>
      <PageHeader
        title="Outlets"
        description="Who the seller is on each outlet's bills, how bills are numbered, and when its service day starts."
      />
      {outlets.length === 0 ? (
        <EmptyState title="No outlets in your scope" description="Billing identity belongs to an outlet." />
      ) : (
        <div className="flex flex-col gap-6">
          {outlets.map((outlet) => (
            <OutletProfileForm key={outlet.locationId} outlet={outlet} />
          ))}
        </div>
      )}
    </>
  );
}

export default withPageAccess(OutletsPage);
