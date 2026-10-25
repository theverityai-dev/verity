import QRCode from "qrcode";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { publicUrl } from "@/server/platform/public-url";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_ROLL, PIECEWORK_CAPABILITY, rollDetail } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { shortDate } from "../../lots/format";
import { qty } from "../format";
import { RollLabels } from "./RollLabels";

export const dynamic = "force-dynamic";

/** Labels for the rolls named in ?ids=, each with a QR that opens the roll on a signed-in phone. */
async function LabelsPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  installCapabilities();
  const { ids } = await searchParams;
  const actor = await requireActor();
  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_ROLL));
  if (!allowed) return <PermissionDenied what="printing roll labels" />;
  const wanted = (ids ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 100);
  const tenant = await withTenant(actor.tenantId, (tx) => tx.tenant.findFirst({ select: { name: true } }));
  const found = await Promise.all(wanted.map((id) => executeQuery(actor, rollDetail, { rollId: id })));
  const labels = await Promise.all(found.flatMap((d) => (d ? [d.roll] : [])).map(async (r) => ({
    id: r.id, number: r.number, fabric: r.fabricType, quantity: qty(r.receivedCenti, r.unit), received: shortDate(r.receivedOn),
    from: [r.supplier, r.invoiceNumber].filter(Boolean).join(" · "), business: tenant?.name ?? "",
    qrUrl: publicUrl(`/fabric/${r.id}`).toString(),
    qr: await QRCode.toDataURL(publicUrl(`/fabric/${r.id}`).toString(), { width: 240, margin: 1, errorCorrectionLevel: "M" }),
  })));

  return (
    <>
      <PageHeader back={{ href: "/fabric", label: "Fabric" }} title={labels.length === 1 ? `Label for ${labels[0]!.number}` : "Roll labels"} description="Stick one on each roll. Scanning it opens the roll." />
      <RollLabels labels={labels} />
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, LabelsPage);
