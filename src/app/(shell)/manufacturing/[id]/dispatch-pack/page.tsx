import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { installCapabilities } from "@/server/capabilities/registry";
import { MANUFACTURING_CAPABILITY } from "@/server/capabilities/manufacturing";
import { loadDispatchPack } from "@/server/capabilities/manufacturing/documents";
import { jobForOrder } from "@/server/capabilities/project";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { EmptyState, PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { dateText } from "../../../jobs/format";
import { DispatchPackDoc, type DispatchPackData } from "./DispatchPackDoc";

export const dynamic = "force-dynamic";

/**
 * The dispatch pack for one dispatched order: delivery note, packing list and the inspection checks that
 * supported the release. It is built only from the dispatch ledger and the order's own records. The
 * verification passport's link is shown once when published and only its hash is stored, so this page states
 * that a passport exists but cannot print its QR: the nameplate carries it.
 */
async function DispatchPackPage({ params }: { params: Promise<{ id: string }> }) {
  installCapabilities();
  const { id } = await params;
  const actor = await requireActor();

  const loaded = await withTenant(actor.tenantId, async (tx) => {
    const record = await loadDispatchPack(tx, actor, id);
    if (typeof record === "string" || record === null) return record;
    return { record, job: await jobForOrder(tx, actor, id) };
  });

  if (loaded === "denied") return <PermissionDenied what="viewing this dispatch" />;
  if (loaded === "undispatched") {
    return (
      <>
        <PageHeader title="Dispatch pack" />
        <EmptyState title="Not dispatched yet" description="The pack is built from the dispatch record. Record the dispatch on the order first, then print it here." />
      </>
    );
  }
  if (!loaded) notFound();

  const { record, job } = loaded;
  const doc: DispatchPackData = {
    business: record.tenant.name,
    demo: record.tenant.demo,
    reference: record.order.reference ?? `MO ${record.order.id.slice(0, 8)}`,
    product: record.order.product,
    quantity: record.order.quantity,
    job: job ? { reference: job.reference, title: job.title } : null,
    customer: job ? job.customer : null,
    dispatch: {
      dispatchedOn: dateText(record.sent.recordedAt),
      transporter: record.sent.transporter ?? "—",
      vehicleNo: record.sent.vehicleNo,
      trackingRef: record.sent.trackingRef,
      note: record.sent.note,
      photoOnRecord: record.sent.photoOnRecord,
    },
    delivered: record.deliveredAt ? dateText(record.deliveredAt) : null,
    materials: record.materials,
    checks:
      record.checks?.map((c) => ({
        id: c.id,
        stage: c.stage,
        label: c.label,
        verdict: c.verdict === "pass" ? "Passed" : "Failed",
        on: dateText(c.recordedAt),
        remarks: c.remarks,
        reading: c.reading,
      })) ?? null,
    passport: record.passport ? { issuedOn: dateText(record.passport.issuedAt), reference: record.passport.reference } : null,
    printedOn: new Date().toLocaleString("en-IN", { timeZone: record.tenant.timeZone, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }),
    backHref: `/manufacturing/${record.order.id}`,
  };

  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Dispatch pack" description="Delivery note, packing list and the inspection checks that supported the release." />
      </div>
      <DispatchPackDoc doc={doc} />
    </>
  );
}

export default withCapabilityPageAccess(MANUFACTURING_CAPABILITY, DispatchPackPage);
