import Link from "next/link";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PROJECT_LOST_REASON, PROJECT_CAPABILITY } from "@/server/capabilities/project";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { NewLostReasonButton } from "../JobForms";
import { ActionTable } from "../JobTables";

export const dynamic = "force-dynamic";

/**
 * The reasons a job can be marked lost for. A reason that has been used is retired, never deleted, so a
 * lost job always keeps the reason it was lost for.
 */
async function LostReasonsPage() {
  installCapabilities();
  const actor = await requireActor();

  const reasons = await withTenant(actor.tenantId, async (tx) => {
    if (!(await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PROJECT_LOST_REASON))) return null;
    return tx.projectLostReason.findMany({ orderBy: [{ active: "desc" }, { label: "asc" }], include: { _count: { select: { jobs: true } } } });
  });
  if (!reasons) return <PermissionDenied what="reading lost reasons" />;

  return (
    <>
      <PageHeader
        title="Lost reasons"
        description="Why enquiries and quotes do not turn into orders. Choosing from a list, not typing, is what lets you see the pattern later."
        actions={
          <>
            <Link href="/jobs" className="text-[15px] text-accent-ink">Back to jobs</Link>
            <NewLostReasonButton />
          </>
        }
      />
      <ActionTable
        kind="reason"
        working
        caption="Lost reasons"
        emptyTitle="No lost reasons yet"
        rows={reasons.map((r) => ({
          id: r.id,
          label: r.label,
          used: r._count.jobs,
          status: r.active ? "Active" : "Retired",
          category: r.active ? "Active" : "Cancelled",
          active: r.active ? "yes" : "no",
        }))}
        columns={[
          { key: "label", header: "Reason" },
          { key: "used", header: "Jobs lost for this", numeric: true },
          { key: "status", header: "Status", variant: "state", categoryKey: "category" },
        ]}
      />
    </>
  );
}

export default withCapabilityPageAccess(PROJECT_CAPABILITY, LostReasonsPage);
