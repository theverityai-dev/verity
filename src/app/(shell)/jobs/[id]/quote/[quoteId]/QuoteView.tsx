"use client";

/* eslint-disable no-restricted-syntax -- print-only document table (REQ-019), same reasoning as PurchaseOrderView.tsx and InvoiceView.tsx: DataTable's on-screen chrome (filter, sort, pagination) has no place on a page a customer receives. */

import { Button, Panel } from "@/components/ui/primitives";

export type QuoteDoc = {
  business: string;
  reference: string;
  revision: number;
  status: string;
  issuedOn: string;
  validUntil: string | null;
  customer: { name: string; gstin: string | null; phone: string | null; email: string | null; contact: string | null };
  title: string;
  lines: Array<{ id: string; description: string; qty: number; unit: string; amount: string }>;
  total: string;
  scopeNote: string | null;
  backHref: string;
};

/** The quote as a document a customer can be handed. On screen it is a preview with a Print button. */
export function QuoteView({ doc }: { doc: QuoteDoc }) {
  const body = (
    <article className="text-[15px] leading-[22px] text-text">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
        <div>
          <p className="m-0 text-[20px] font-semibold">{doc.business}</p>
          <p className="m-0 text-text-secondary">Rau, Indore, Madhya Pradesh</p>
        </div>
        <div className="text-right">
          <p className="m-0 text-[20px] font-semibold">Quotation</p>
          <p className="m-0 tabular text-text-secondary">
            {doc.reference} · Revision {doc.revision}
          </p>
          <p className="m-0 text-text-secondary">Date {doc.issuedOn}</p>
          {doc.validUntil && <p className="m-0 text-text-secondary">Valid until {doc.validUntil}</p>}
        </div>
      </header>

      <section className="grid gap-4 py-4 sm:grid-cols-2">
        <div>
          <p className="m-0 text-[13px] text-text-secondary">Quoted to</p>
          <p className="m-0 font-semibold">{doc.customer.name}</p>
          {doc.customer.contact && <p className="m-0">Attn: {doc.customer.contact}</p>}
          {doc.customer.gstin && <p className="m-0">GSTIN {doc.customer.gstin}</p>}
          {doc.customer.phone && <p className="m-0">{doc.customer.phone}</p>}
          {doc.customer.email && <p className="m-0">{doc.customer.email}</p>}
        </div>
        <div>
          <p className="m-0 text-[13px] text-text-secondary">Subject</p>
          <p className="m-0 font-semibold">{doc.title}</p>
        </div>
      </section>

      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-y border-line text-[13px] text-text-secondary">
            <th className="py-2 pr-3 font-medium">Item</th>
            <th className="px-3 py-2 text-right font-medium">Qty</th>
            <th className="px-3 py-2 text-right font-medium">Unit price</th>
            <th className="py-2 pl-3 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l) => (
            <tr key={l.id} className="border-b border-line">
              <td className="py-2 pr-3">{l.description}</td>
              <td className="tabular px-3 py-2 text-right">{l.qty}</td>
              <td className="tabular px-3 py-2 text-right">{l.unit}</td>
              <td className="tabular py-2 pl-3 text-right">{l.amount}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="py-3 pr-3 text-right font-semibold">Total (excluding GST)</td>
            <td className="tabular py-3 pl-3 text-right text-[17px] font-semibold">{doc.total}</td>
          </tr>
        </tfoot>
      </table>

      {doc.scopeNote && (
        <section className="pt-4">
          <p className="m-0 text-[13px] text-text-secondary">Scope and terms</p>
          <p className="m-0 whitespace-pre-wrap">{doc.scopeNote}</p>
        </section>
      )}
    </article>
  );

  return (
    <>
      {/* The print-only document is the only thing that prints; the preview and controls stay on screen. */}
      <section className="hidden print:block">{body}</section>
      <div className="print:hidden">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => window.print()}>
            Print quote
          </Button>
          <a href={doc.backHref}>Back to the job</a>
        </div>
        <Panel>{body}</Panel>
      </div>
    </>
  );
}
