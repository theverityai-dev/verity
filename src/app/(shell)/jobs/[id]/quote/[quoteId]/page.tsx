import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PROJECT_QUOTE, PROJECT_CAPABILITY, jobReference } from "@/server/capabilities/project";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { dateText, inr } from "../../../format";
import { QuoteView, type QuoteDoc } from "./QuoteView";

export const dynamic = "force-dynamic";

/** One quote revision as a printable document. Figures come from the stored lines, never recomputed from current prices. */
async function QuotePage({ params }: { params: Promise<{ id: string; quoteId: string }> }) {
  installCapabilities();
  const { id, quoteId } = await params;
  const actor = await requireActor();

  const doc = await withTenant(actor.tenantId, async (tx): Promise<QuoteDoc | "denied" | null> => {
    if (!(await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PROJECT_QUOTE))) return "denied";
    const quote = await tx.projectQuote.findUnique({
      where: { id: quoteId },
      include: { lines: { orderBy: { sequence: "asc" } }, job: { include: { customer: true } } },
    });
    if (!quote || quote.jobId !== id) return null;
    const tenant = await tx.tenant.findUnique({ where: { id: actor.tenantId }, select: { name: true } });
    const customer = quote.job.customer;
    return {
      business: tenant?.name ?? "Quotation",
      reference: jobReference(quote.job.number),
      revision: quote.revision,
      status: quote.status,
      issuedOn: dateText(quote.createdAt),
      validUntil: quote.validUntil ? dateText(quote.validUntil) : null,
      customer: {
        name: quote.job.customerName,
        gstin: customer?.gstin ?? null,
        phone: customer?.phone ?? null,
        email: customer?.email ?? null,
        contact: quote.job.customerContact,
      },
      title: quote.job.title,
      lines: quote.lines.map((l) => ({
        id: l.id,
        description: l.description,
        qty: l.qty,
        unit: inr(l.unitPriceMinor),
        amount: inr(l.qty * l.unitPriceMinor),
      })),
      total: inr(quote.amountMinor),
      scopeNote: quote.scopeNote,
      backHref: `/jobs/${id}`,
    };
  });

  if (doc === "denied") return <PermissionDenied what="reading this quote" />;
  if (!doc) notFound();

  return (
    <>
      <div className="print:hidden">
        <PageHeader title={`Quote ${doc.reference} · Revision ${doc.revision}`} description="Preview of the document the customer receives." />
      </div>
      <QuoteView doc={doc} />
    </>
  );
}

export default withCapabilityPageAccess(PROJECT_CAPABILITY, QuotePage);
