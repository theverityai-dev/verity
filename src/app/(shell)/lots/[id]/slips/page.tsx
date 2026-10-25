import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { publicUrl } from "@/server/platform/public-url";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_BUNDLE, PIECEWORK_CAPABILITY, lotDetail } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { SlipSheet } from "./SlipSheet";

export const dynamic = "force-dynamic";

/** All the slips of one lot, newest cut last. Opened right after cutting; also reachable from the lot to reprint. */
async function SlipsPage({ params }: { params: Promise<{ id: string }> }) {
  installCapabilities();
  const { id } = await params;
  const actor = await requireActor();
  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_BUNDLE));
  if (!allowed) return <PermissionDenied what="printing slips" />;

  const lot = await executeQuery(actor, lotDetail, { lotId: id });
  if (!lot) notFound();
  const tenant = await withTenant(actor.tenantId, (tx) => tx.tenant.findFirst({ select: { name: true, customFields: true } }));
  // Cancelled, split and joined bundles have no slip to print: their pieces are on the new bundles.
  const slips = await Promise.all(lot.bundleRows.filter((b) => !b.cancelled).map(async (b) => ({
    id: b.id,
    fresh: b.lastMovement === null,
    printed: b.slipPrinted === true,
    business: tenant?.name ?? "",
    demo: Boolean((tenant?.customFields as { demo?: boolean } | null)?.demo),
    bundleNumber: b.number,
    netPieces: b.netPieces,
    lotNumber: lot.number,
    lotName: lot.name ?? lot.design,
    design: lot.design,
    cutOn: new Date(`${b.cutOn}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }),
    qr: await QRCode.toDataURL(publicUrl(`/lots/bundles/${b.id}`).toString(), { width: 276, margin: 1, errorCorrectionLevel: "M" }),
    backHref: `/lots/bundles/${b.id}`,
  })));

  return (
    <>
      <PageHeader back={{ href: `/lots/${lot.id}`, label: lot.number }} title={`Slips for ${lot.number}`} description="Bundle number, net pieces, lot and a QR on each. No size is printed." />
      <SlipSheet slips={slips} lotHref={`/lots/${lot.id}`} lotNumber={lot.number} />
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, SlipsPage);
