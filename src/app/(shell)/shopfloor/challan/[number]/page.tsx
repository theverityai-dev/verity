import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_ENTRY, PIECEWORK_CAPABILITY, challanSheet } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { ChallanDoc } from "./ChallanDoc";

export const dynamic = "force-dynamic";

/** The paper that goes with a handover: what was given or taken back, the counts, and a line for the karigar's signature. No rate, no wage. */
async function ChallanPage({ params }: { params: Promise<{ number: string }> }) {
  installCapabilities();
  const { number } = await params;
  const actor = await requireActor();
  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_ENTRY));
  if (!allowed) return <PermissionDenied what="printing a challan" />;
  if (!/^CH-\d{4,}$/.test(number)) notFound();
  const challan = await executeQuery(actor, challanSheet, { number });
  if (!challan) notFound();
  const tenant = await withTenant(actor.tenantId, (tx) => tx.tenant.findFirst({ select: { name: true } }));

  return (
    <>
      <PageHeader title={`Challan ${challan.number}`} description={`${challan.worker.name} · ${challan.lines.length} line${challan.lines.length === 1 ? "" : "s"}`} />
      <ChallanDoc challan={challan} business={tenant?.name ?? ""} backHref="/shopfloor" />
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, ChallanPage);
