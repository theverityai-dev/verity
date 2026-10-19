import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { installCapabilities } from "@/server/capabilities/registry";
import { MANUFACTURING_CAPABILITY } from "@/server/capabilities/manufacturing";
import { loadTestReport } from "@/server/capabilities/manufacturing/documents";
import { jobForOrder } from "@/server/capabilities/project";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { testReportDoc } from "../document-data";
import { TestReportView } from "./TestReportView";

export const dynamic = "force-dynamic";

/**
 * The test report for one order, read summary first: did everything pass, what failed, then each reading against
 * its accepted range with the condition it was taken under. Built only from the order's own findings and
 * readings; a reader without Evidence access sees the verdicts and units but not the readings.
 */
async function TestReportPage({ params }: { params: Promise<{ id: string }> }) {
  installCapabilities();
  const { id } = await params;
  const actor = await requireActor();

  const loaded = await withTenant(actor.tenantId, async (tx) => {
    const record = await loadTestReport(tx, actor, id);
    if (typeof record === "string" || record === null) return record;
    return { record, job: await jobForOrder(tx, actor, id) };
  });

  if (loaded === "denied") return <PermissionDenied what="viewing this test report" />;
  if (!loaded) notFound();

  const doc = testReportDoc(loaded.record, loaded.job);

  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Test report" description="Read the summary first; open a check for its detail." />
      </div>
      <TestReportView doc={doc} />
    </>
  );
}

export default withCapabilityPageAccess(MANUFACTURING_CAPABILITY, TestReportPage);
