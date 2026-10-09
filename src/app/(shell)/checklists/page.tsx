import { withPageAccess } from "@/components/ui/PageAccess";
import { requireActor } from "@/server/platform/auth";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import { ForbiddenError } from "@/server/platform/authorization";
import { checklistToday } from "@/server/capabilities/dinein";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { day } from "@/components/ui/business/format";
import { ChecklistBoard } from "./ChecklistBoard";

export const dynamic = "force-dynamic";

/**
 * Opening and closing checklists for today's service (Task 126 item 1.8). Not a
 * gate on selling; an unfinished closing list from the day before is flagged on the
 * Today view.
 */
async function ChecklistsPage() {
  installCapabilities();
  const actor = await requireActor();

  let outlets: Awaited<ReturnType<typeof checklistToday.handler>>;
  try {
    outlets = await executeQuery(actor, checklistToday, {});
  } catch (error) {
    if (error instanceof ForbiddenError) return <PermissionDenied what="checklists" />;
    throw error;
  }

  return (
    <>
      <PageHeader
        title="Checklists"
        description={`Opening and closing steps for the service day of ${day(outlets[0]?.day)}. Tick a step as it is done; it records who and when.`}
      />
      <ChecklistBoard outlets={outlets} />
    </>
  );
}

export default withPageAccess(ChecklistsPage);
