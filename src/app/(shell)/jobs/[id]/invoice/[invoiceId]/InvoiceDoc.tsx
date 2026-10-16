"use client";

/* eslint-disable no-restricted-syntax -- print-only document table (REQ-019): DataTable's on-screen chrome (filter, sort, pagination) has no place on a page a customer receives. */

import { Button, Panel } from "@/components/ui/primitives";

export type InvoiceDocData = {
  business: { name: string; address: string | null; gstin: string | null };
  number: string;
  issuedOn: string;
  kind: string;
  job: { reference: string; title: string };
  customer: { name: string; gstin: string | null; phone: string | null; email: string | null; contact: string | null };
  description: string;
  taxable: string;
  tax: string;
  taxRate: string | null;
  total: string;
  words: string;
  receipts: Array<{ id: string; date: string; method: string; reference: string | null; amount: string }>;
  received: string;
  due: string;
  paid: boolean;
  voided: string | null;
  bank: { name?: string; account?: string; ifsc?: string } | null;
  signatory: string | null;
  backHref: string;
};

/** The invoice as a document a customer can be handed. On screen it is a preview with a Print button. */
export function InvoiceDoc({ doc }: { doc: InvoiceDocData }) {
  const body = (
    <article className="relative text-[14px] leading-[21px] text-text">
      {(doc.paid || doc.voided) && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-10 top-[7.5rem] -rotate-12 rounded-md border-[3px] px-4 py-1 text-[22px] font-bold uppercase tracking-[0.12em] opacity-70"
          style={{ borderColor: doc.voided ? "var(--color-danger)" : "var(--color-state-completed-ink)", color: doc.voided ? "var(--color-danger)" : "var(--color-state-completed-ink)" }}
        >
          {doc.voided ? "Void" : "Paid"}
        </span>
      )}

      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-text pb-4">
        <div className="min-w-0">
          <p className="m-0 text-[22px] font-bold tracking-[-0.01em]">{doc.business.name}</p>
          {doc.business.address && <p className="m-0 whitespace-pre-line text-text-secondary">{doc.business.address}</p>}
          {doc.business.gstin && <p className="m-0 mt-1 font-medium">GSTIN {doc.business.gstin}</p>}
        </div>
        <div className="text-right">
          <p className="m-0 text-[22px] font-bold uppercase tracking-[0.06em]">Tax invoice</p>
          <p className="m-0 tabular font-semibold">{doc.number}</p>
          <p className="m-0 text-text-secondary">Date {doc.issuedOn}</p>
          <p className="m-0 text-text-secondary">{doc.kind} invoice</p>
        </div>
      </header>

      <section className="grid gap-4 py-4 sm:grid-cols-2">
        <div>
          <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-secondary">Bill to</p>
          <p className="m-0 text-[16px] font-semibold">{doc.customer.name}</p>
          {doc.customer.contact && <p className="m-0">Attn: {doc.customer.contact}</p>}
          {doc.customer.gstin && <p className="m-0">GSTIN {doc.customer.gstin}</p>}
          {doc.customer.phone && <p className="m-0">{doc.customer.phone}</p>}
          {doc.customer.email && <p className="m-0">{doc.customer.email}</p>}
        </div>
        <div>
          <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-secondary">Against</p>
          <p className="m-0 text-[16px] font-semibold">{doc.job.reference}</p>
          <p className="m-0">{doc.job.title}</p>
        </div>
      </section>

      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-y border-line bg-[var(--color-surface-sunken)] text-[12px] uppercase tracking-[0.06em] text-text-secondary">
            <th className="px-3 py-2 font-semibold">Description</th>
            <th className="px-3 py-2 text-right font-semibold">Taxable value</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-line">
            <td className="px-3 py-3">{doc.description}</td>
            <td className="tabular px-3 py-3 text-right">{doc.taxable}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td className="px-3 pt-3 text-right text-text-secondary">GST{doc.taxRate ? ` @ ${doc.taxRate}` : ""}</td>
            <td className="tabular px-3 pt-3 text-right">{doc.tax}</td>
          </tr>
          <tr>
            <td className="px-3 py-3 text-right text-[16px] font-bold">Invoice total</td>
            <td className="tabular px-3 py-3 text-right text-[18px] font-bold">{doc.total}</td>
          </tr>
        </tfoot>
      </table>

      <p className="m-0 border-y border-line py-2 text-[13px] italic text-text-secondary">{doc.words}</p>

      <section className="grid gap-6 pt-5 sm:grid-cols-2">
        <div>
          <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-secondary">Payments received</p>
          {doc.receipts.length === 0 ? (
            <p className="m-0 text-text-secondary">None yet.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {doc.receipts.map((r) => (
                <li key={r.id} className="flex justify-between gap-3">
                  <span>
                    {r.date} · {r.method}
                    {r.reference ? ` · ${r.reference}` : ""}
                  </span>
                  <span className="tabular">{r.amount}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="m-0 mt-2 flex justify-between gap-3 border-t border-line pt-2 font-semibold">
            <span>Balance due</span>
            <span className="tabular">{doc.due}</span>
          </p>
        </div>
        {doc.bank && (doc.bank.name || doc.bank.account) && (
          <div>
            <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-secondary">Bank details</p>
            {doc.bank.name && <p className="m-0">{doc.bank.name}</p>}
            {doc.bank.account && <p className="m-0 tabular">A/c {doc.bank.account}</p>}
            {doc.bank.ifsc && <p className="m-0 tabular">IFSC {doc.bank.ifsc}</p>}
          </div>
        )}
      </section>

      <footer className="mt-10 flex items-end justify-between gap-6 border-t border-line pt-4">
        <p className="m-0 max-w-[60%] text-[12px] text-text-tertiary">
          This is a computer-generated invoice. Tax is shown as recorded when the invoice was raised.
        </p>
        <div className="text-right">
          <p className="m-0 mb-8 text-[13px] text-text-secondary">For {doc.business.name}</p>
          <p className="m-0 border-t border-text pt-1 text-[13px] font-medium">{doc.signatory ?? "Authorised signatory"}</p>
        </div>
      </footer>
    </article>
  );

  return (
    <>
      {/* The print-only document is the only thing that prints; the preview and controls stay on screen. */}
      <section className="hidden print:block">{body}</section>
      <div className="print:hidden">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => window.print()}>
            Print invoice
          </Button>
          <a href={doc.backHref}>Back to the job</a>
        </div>
        <Panel>{body}</Panel>
      </div>
    </>
  );
}
