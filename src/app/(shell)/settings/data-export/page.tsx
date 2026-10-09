import { withPageAccess } from "@/components/ui/PageAccess";
import { requireActor } from "@/server/platform/auth";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import { ForbiddenError } from "@/server/platform/authorization";
import { listDataExports } from "@/server/platform/data-export";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { DataExportPanel } from "./DataExportPanel";

export const dynamic = "force-dynamic";

/**
 * Export your data (ADR-037). A copy of what this business holds, as CSV files
 * in one ZIP. It contains only what the person asking may read, and it is the
 * client's own act: Verity staff never export a client's records.
 */
async function DataExportPage() {
  installCapabilities();
  const actor = await requireActor();

  let exports: Awaited<ReturnType<typeof listDataExports.handler>>;
  try {
    exports = await executeQuery(actor, listDataExports, {});
  } catch (error) {
    if (error instanceof ForbiddenError) return <PermissionDenied what="data export" />;
    throw error;
  }

  return (
    <>
      <PageHeader
        title="Export your data"
        description="A copy of your records as spreadsheets in one ZIP file. It includes only what your role can read, and each download link works for five minutes."
      />
      <DataExportPanel
        exports={exports.map((e) => ({
          id: e.id,
          status: e.status,
          requestedAt: e.requestedAt.toISOString(),
          datasetCount: e.datasetCount,
          rowCount: e.rowCount,
          byteSize: e.byteSize,
        }))}
      />
    </>
  );
}

export default withPageAccess(DataExportPage);
