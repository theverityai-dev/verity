import { withPageAccess } from "@/components/ui/PageAccess";
import { requireActor } from "@/server/platform/auth";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import { ForbiddenError } from "@/server/platform/authorization";
import { businessSettings } from "@/server/capabilities/plywood";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { BusinessSettingsForm } from "./BusinessSettingsForm";

export const dynamic = "force-dynamic";

/**
 * Business Settings — who this business legally is, and how it is registered
 * for tax.
 *
 * Authority: taskplans/archive/45_plywood_workflow_program.md §D-03;
 * PLYWOOD_TARGET_WORKFLOW_GAP_AUDIT.md P0-09; specification §4 and §5.
 *
 * This is the master identity the specification asks for: entered once, and
 * read from then on by invoices, tax calculation, reports, ledgers, invoice
 * numbering and accounting periods. The accountant never types the business's
 * own GSTIN onto an invoice again.
 *
 * Deliberately NOT a configuration screen. `/configuration` edits raw keys and
 * is a platform surface; a business administrator setting their legal name
 * should never see `verity.trading.tax.state_code`.
 */
async function BusinessSettingsPage() {
  installCapabilities();
  const actor = await requireActor();

  let settings: Awaited<ReturnType<typeof businessSettings.handler>>;
  try {
    settings = await executeQuery(actor, businessSettings, {});
  } catch (error) {
    if (error instanceof ForbiddenError) return <PermissionDenied what="business settings" />;
    throw error;
  }

  return (
    <>
      <PageHeader
        title="Business Settings"
        description="The legal identity every invoice, return and report is issued under. Entered once here, never again on a document."
      />
      <BusinessSettingsForm settings={settings} />
    </>
  );
}

export default withPageAccess(BusinessSettingsPage);
