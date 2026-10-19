import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { readUrlFor } from "@/server/platform/files";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PROJECT_JOB, PROJECT_CAPABILITY, jobDetail, jobForOrder } from "@/server/capabilities/project";
import { loadDispatchPack, loadOrderPhotos, loadTestReport } from "@/server/capabilities/manufacturing/documents";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { dispatchPackDoc, printedOn, testReportDoc } from "../../../manufacturing/[id]/document-data";
import { dateText, inr } from "../../format";
import { ProjectFileView, type ProjectFileDoc } from "./ProjectFileView";

export const dynamic = "force-dynamic";

/** Photo links are signed and short-lived; long enough to load and print the file, short enough to stay private. */
const PHOTO_LINK_SECONDS = 900;

/**
 * The project file for one job: the stamped record a customer is handed when the work is done. It composes the
 * job's own record with, for each production order linked to it, the test report, the dispatch pack and the
 * photographs behind them. Each part is read through its own capability's grants, so a reader sees exactly the
 * parts they may; nothing here is written or recomputed.
 */
async function ProjectFilePage({ params }: { params: Promise<{ id: string }> }) {
  installCapabilities();
  const { id } = await params;
  const actor = await requireActor();

  const built = await withTenant(actor.tenantId, async (tx) => {
    if (!(await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PROJECT_JOB))) return "denied" as const;
    const detail = await jobDetail(tx, id);
    if (!detail) return null;
    const { job } = detail;
    const tenant = await tx.tenant.findUnique({ where: { id: actor.tenantId }, select: { name: true, timeZone: true, customFields: true } });
    const approved = job.quotes.find((q) => q.id === job.approvedQuoteId) ?? null;

    const orders: ProjectFileDoc["orders"] = [];
    for (const link of job.orders) {
      const orderJob = await jobForOrder(tx, actor, link.orderId);
      const report = await loadTestReport(tx, actor, link.orderId);
      const pack = await loadDispatchPack(tx, actor, link.orderId);
      const photos = await loadOrderPhotos(tx, actor, link.orderId);
      const shown: ProjectFileDoc["orders"][number]["photos"] = [];
      for (const p of photos) {
        let src: string | null = p.uri;
        if (p.fileId) {
          try {
            src = await readUrlFor(tx, p.fileId, PHOTO_LINK_SECONDS);
          } catch {
            src = null; // storage not bound, or the file is not readable: listed as on record, not shown
          }
        }
        shown.push({ id: p.id, caption: p.caption, on: dateText(p.capturedAt), src });
      }
      orders.push({
        id: link.orderId,
        reference: link.order.reference ?? `MO ${link.orderId.slice(0, 8)}`,
        product: link.order.outputItem.name,
        quantity: link.order.outputQty,
        testReport: typeof report === "string" || report === null ? null : testReportDoc(report, orderJob),
        dispatch: typeof pack === "string" || pack === null ? null : dispatchPackDoc(pack, orderJob),
        photos: shown,
      });
    }

    const doc: ProjectFileDoc = {
      business: tenant?.name ?? "",
      demo: (tenant?.customFields as { demo?: boolean } | null)?.demo === true,
      reference: detail.reference,
      title: job.title,
      customer: job.customerName,
      contact: job.customerContact,
      stateLabel: job.state.replace(/_/g, " "),
      dueOn: job.dueDate ? dateText(job.dueDate) : null,
      startedOn: job.startedAt ? dateText(job.startedAt) : null,
      finishedOn: job.finishedAt ? dateText(job.finishedAt) : null,
      agreedValue: approved ? { amount: inr(approved.amountMinor), revision: approved.revision } : null,
      milestones: job.milestones.map((m) => ({ id: m.id, name: m.name, due: m.dueDate ? dateText(m.dueDate) : null, reached: m.reachedAt ? dateText(m.reachedAt) : null })),
      orders,
      printedOn: printedOn(tenant?.timeZone ?? "Asia/Kolkata"),
      backHref: `/jobs/${id}`,
    };
    return doc;
  });

  if (built === "denied") return <PermissionDenied what="reading this job" />;
  if (!built) notFound();

  return (
    <>
      <div className="print:hidden">
        <PageHeader title={`Project file · ${built.reference}`} description="Everything recorded for this job, ready to print and stamp." />
      </div>
      <ProjectFileView doc={built} />
    </>
  );
}

export default withCapabilityPageAccess(PROJECT_CAPABILITY, ProjectFilePage);
