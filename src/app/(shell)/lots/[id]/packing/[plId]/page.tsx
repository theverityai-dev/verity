import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_PACKING_LIST, PIECEWORK_CAPABILITY, packingListDetail } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { PackingListDoc } from "./PackingListDoc";

export const dynamic = "force-dynamic";

/** One packing list, ready to print for the forwarder and the buyer. */
async function PackingListPage({ params }: { params: Promise<{ id: string; plId: string }> }) {
  installCapabilities();
  const { id, plId } = await params;
  const actor = await requireActor();
  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_PACKING_LIST));
  if (!allowed) return <PermissionDenied what="viewing packing lists" />;

  const doc = await executeQuery(actor, packingListDetail, { packingListId: plId });
  if (!doc || doc.lot.id !== id) notFound();
  const tenant = await withTenant(actor.tenantId, (tx) => tx.tenant.findFirst({ select: { name: true, customFields: true } }));

  return (
    <>
      <div className="print:hidden">
        <PageHeader back={{ href: `/lots/${id}`, label: doc.lot.number }} title={`${doc.number} · ${doc.buyer}`} description={doc.cancelled ? `Cancelled${doc.cancelReason ? `: ${doc.cancelReason}` : ""}` : `${doc.totals.cartons} cartons, ${doc.totals.pieces.toLocaleString("en-IN")} pieces`} />
      </div>
      <PackingListDoc
        doc={doc}
        business={tenant?.name ?? ""}
        demo={Boolean((tenant?.customFields as { demo?: boolean } | null)?.demo)}
        printedOn={new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}
        backHref={`/lots/${id}`}
      />
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, PackingListPage);
