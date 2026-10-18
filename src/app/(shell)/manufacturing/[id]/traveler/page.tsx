import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { publicUrl } from "@/server/platform/public-url";
import { installCapabilities } from "@/server/capabilities/registry";
import { MANUFACTURING_CAPABILITY } from "@/server/capabilities/manufacturing";
import { loadTraveler } from "@/server/capabilities/manufacturing/documents";
import { jobForOrder } from "@/server/capabilities/project";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { dateText } from "../../../jobs/format";
import { TravelerDoc, type TravelerDocData } from "./TravelerDoc";

export const dynamic = "force-dynamic";

const STATE_WORDS: Record<string, string> = {
  pending: "Not started",
  in_progress: "In progress",
  on_hold: "On hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

/**
 * The job card and traveler for one production order, printed from the order's own route, checkpoints and
 * materials. Nothing here is typed in separately: the stages and checks are the snapshot the order carries.
 * The QR opens the order inside Verity, so it needs a signed-in user with the right to read it; it carries no
 * job data and no token, only the order's address on the configured public origin (ADR-032).
 */
async function TravelerPage({ params }: { params: Promise<{ id: string }> }) {
  installCapabilities();
  const { id } = await params;
  const actor = await requireActor();

  const loaded = await withTenant(actor.tenantId, async (tx) => {
    const record = await loadTraveler(tx, actor, id);
    if (record === "denied" || record === null) return record;
    return { record, job: await jobForOrder(tx, actor, id) };
  });
  if (loaded === "denied") return <PermissionDenied what="viewing this manufacturing order" />;
  if (!loaded) notFound();

  const { record, job } = loaded;
  const zone = record.tenant.timeZone;
  const stamp = (d: Date | null) =>
    d ? d.toLocaleString("en-IN", { timeZone: zone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : null;

  const doc: TravelerDocData = {
    business: record.tenant.name,
    demo: record.tenant.demo,
    reference: record.order.reference ?? `MO ${record.order.id.slice(0, 8)}`,
    state: STATE_WORDS[record.order.state] ?? record.order.state.replace(/_/g, " "),
    product: record.order.product,
    quantity: record.order.quantity,
    location: record.order.location,
    bom: record.order.bom,
    job: job ? { reference: job.reference, title: job.title, customer: job.customer.name, promised: dateText(job.dueDate) } : null,
    qr: await QRCode.toDataURL(publicUrl(`/manufacturing/${record.order.id}`).toString(), { width: 288, margin: 1, errorCorrectionLevel: "M" }),
    qrNote: "Scan with a signed-in phone to open this order",
    printedOn: new Date().toLocaleString("en-IN", { timeZone: zone, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }),
    materials: record.materials,
    // Position on the sheet, not the stored sequence: a send-back leaves cancelled rows in between.
    stages:
      record.stages?.map((s, i) => ({
        id: s.id,
        sequence: i + 1,
        label: s.label,
        rework: s.rework,
        status: STATE_WORDS[s.state] ?? s.state,
        startedAt: stamp(s.startedAt),
        completedAt: stamp(s.completedAt),
        checks: s.checks,
      })) ?? null,
    backHref: `/manufacturing/${record.order.id}`,
  };

  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Job card and traveler" description="Print this and keep it with the job. Scan the code to open the order on a phone." />
      </div>
      <TravelerDoc doc={doc} />
    </>
  );
}

export default withCapabilityPageAccess(MANUFACTURING_CAPABILITY, TravelerPage);
