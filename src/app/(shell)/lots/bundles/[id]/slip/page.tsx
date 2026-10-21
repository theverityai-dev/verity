import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { publicUrl } from "@/server/platform/public-url";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_BUNDLE, PIECEWORK_CAPABILITY, bundleDetail } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { SlipDoc } from "./SlipDoc";

export const dynamic = "force-dynamic";

async function SlipPage({ params }: { params: Promise<{ id: string }> }) {
  installCapabilities();
  const { id } = await params;
  const actor = await requireActor();

  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_BUNDLE));
  if (!allowed) return <PermissionDenied what="printing this slip" />;

  const b = await executeQuery(actor, bundleDetail, { bundleId: id });
  if (!b) notFound();
  const tenant = await withTenant(actor.tenantId, (tx) => tx.tenant.findFirst({ select: { name: true, customFields: true, timeZone: true } }));

  return (
    <>
      <PageHeader title={`Slip for ${b.number}`} description="Bundle number, net pieces, and lot name and number. No size is printed." />
      <SlipDoc
        slip={{
          business: tenant?.name ?? "",
          demo: Boolean((tenant?.customFields as { demo?: boolean } | null)?.demo),
          bundleNumber: b.number,
          netPieces: b.netPieces,
          lotNumber: b.lotNumber,
          lotName: b.lotName ?? b.lotDesign,
          design: b.lotDesign,
          cutOn: new Date(`${b.cutOn}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }),
          qr: await QRCode.toDataURL(publicUrl(`/lots/bundles/${b.id}`).toString(), { width: 276, margin: 1, errorCorrectionLevel: "M" }),
          backHref: `/lots/bundles/${b.id}`,
        }}
      />
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, SlipPage);
