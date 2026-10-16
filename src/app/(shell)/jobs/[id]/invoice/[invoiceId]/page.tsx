import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PROJECT_INVOICE, PROJECT_CAPABILITY, jobReference } from "@/server/capabilities/project";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { rupeesInWords } from "@/lib/amount-words";
import { dateText, inr } from "../../../format";
import { InvoiceDoc, type InvoiceDocData } from "./InvoiceDoc";

export const dynamic = "force-dynamic";

const KIND_WORDS: Record<string, string> = { advance: "Advance", progress: "Progress", final: "Final" };
const METHOD_WORDS: Record<string, string> = { bank: "Bank transfer", cheque: "Cheque", upi: "UPI", cash: "Cash", other: "Other" };

/** What the tenant prints at the top and foot of its invoices, kept in `customFields.billing`. Nothing is invented when it is absent. */
type BillingProfile = {
  legalName?: string;
  address?: string;
  gstin?: string;
  bank?: { name?: string; account?: string; ifsc?: string };
  signatory?: string;
};

/**
 * One recorded invoice as a document. The figures are the ones recorded (amount before tax and the tax as
 * printed in the billing system); Verity does not work out GST, so the tax is one line, not a split.
 */
async function InvoicePage({ params }: { params: Promise<{ id: string; invoiceId: string }> }) {
  installCapabilities();
  const { id, invoiceId } = await params;
  const actor = await requireActor();

  const doc = await withTenant(actor.tenantId, async (tx): Promise<InvoiceDocData | "denied" | null> => {
    if (!(await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PROJECT_INVOICE))) return "denied";
    const invoice = await tx.projectInvoice.findUnique({
      where: { id: invoiceId },
      include: { job: { include: { customer: true } }, receipts: { where: { voidedAt: null }, orderBy: { receivedOn: "asc" } } },
    });
    if (!invoice || invoice.jobId !== id) return null;
    const tenant = await tx.tenant.findUnique({ where: { id: actor.tenantId }, select: { name: true, customFields: true } });
    const profile = ((tenant?.customFields as { billing?: BillingProfile } | null)?.billing ?? {}) as BillingProfile;
    const customer = invoice.job.customer;
    const total = invoice.amountMinor + invoice.taxMinor;
    const received = invoice.receipts.reduce((n, r) => n + r.amountMinor, 0);
    const due = Math.max(0, total - received);
    const rate = invoice.amountMinor > 0 ? Math.round((invoice.taxMinor * 10000) / invoice.amountMinor) / 100 : null;
    return {
      business: { name: profile.legalName ?? tenant?.name ?? "Tax invoice", address: profile.address ?? null, gstin: profile.gstin ?? null },
      number: invoice.number,
      issuedOn: dateText(invoice.issuedOn),
      kind: KIND_WORDS[invoice.kind] ?? invoice.kind,
      job: { reference: jobReference(invoice.job.number), title: invoice.job.title },
      customer: {
        name: invoice.job.customerName,
        gstin: customer?.gstin ?? null,
        phone: customer?.phone ?? null,
        email: customer?.email ?? null,
        contact: invoice.job.customerContact,
      },
      description: `${KIND_WORDS[invoice.kind] ?? invoice.kind} invoice against ${invoice.job.title}`,
      taxable: inr(invoice.amountMinor),
      tax: inr(invoice.taxMinor),
      taxRate: rate === null ? null : `${rate}%`,
      total: inr(total),
      words: rupeesInWords(total),
      receipts: invoice.receipts.map((r) => ({
        id: r.id,
        date: dateText(r.receivedOn),
        method: METHOD_WORDS[r.method] ?? r.method,
        reference: r.reference,
        amount: inr(r.amountMinor),
      })),
      received: inr(received),
      due: inr(due),
      paid: due === 0,
      voided: invoice.voidedAt ? (invoice.voidReason ?? "Void") : null,
      bank: profile.bank ?? null,
      signatory: profile.signatory ?? null,
      backHref: `/jobs/${id}`,
    };
  });

  if (doc === "denied") return <PermissionDenied what="reading this invoice" />;
  if (!doc) notFound();

  return (
    <>
      <div className="print:hidden">
        <PageHeader title={`Invoice ${doc.number}`} description="Preview of the document the customer receives." />
      </div>
      <InvoiceDoc doc={doc} />
    </>
  );
}

export default withCapabilityPageAccess(PROJECT_CAPABILITY, InvoicePage);
