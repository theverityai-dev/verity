import { withPageAccess } from "@/components/ui/PageAccess";
import { requireActor } from "@/server/platform/auth";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import { ForbiddenError } from "@/server/platform/authorization";
import { closeChecklist, taxSummary } from "@/server/capabilities/plywood";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { ClosePeriodPanel } from "./ClosePeriodPanel";

export const dynamic = "force-dynamic";

/**
 * Month-end close.
 *
 * Authority: specification §76 and §77;
 * taskplans/archive/45_plywood_workflow_program.md §8 — the close lives under Tax &
 * Compliance because closing is a compliance act and the checklist is mostly
 * tax exceptions.
 *
 * The checklist is the visible half; the LOCK is the load-bearing half. Once a
 * period is closed nothing may be posted into it, which is what makes a filed
 * return reproducible.
 */
async function ClosePeriodPage() {
  installCapabilities();
  const actor = await requireActor();

  let checklist: Awaited<ReturnType<typeof closeChecklist.handler>>;
  let tax: Awaited<ReturnType<typeof taxSummary.handler>>;
  try {
    [checklist, tax] = await Promise.all([
      executeQuery(actor, closeChecklist, {}),
      executeQuery(actor, taxSummary, {}),
    ]);
  } catch (error) {
    if (error instanceof ForbiddenError) return <PermissionDenied what="the period close" />;
    throw error;
  }

  return (
    <>
      <PageHeader
        title="Close period"
        description="Closing says: this is what happened. Nothing can be posted into a closed period afterwards, which is what makes a filed return reproducible."
      />
      <ClosePeriodPanel checklist={checklist} tax={tax} />
    </>
  );
}

export default withPageAccess(ClosePeriodPage);
