"use client";

/* eslint-disable no-restricted-syntax -- print-only document table (REQ-019): DataTable's on-screen chrome has no place on a sheet handed over with a delivery. */

import { Button, Panel } from "@/components/ui/primitives";

export type DispatchPackData = {
  business: string;
  demo: boolean;
  reference: string;
  product: string;
  quantity: number;
  job: { reference: string; title: string } | null;
  customer: { name: string; contact: string | null; phone: string | null; email: string | null; gstin: string | null } | null;
  dispatch: { dispatchedOn: string; transporter: string; vehicleNo: string | null; trackingRef: string | null; note: string | null; photoOnRecord: boolean };
  delivered: string | null;
  materials: Array<{ id: string; item: string; qty: number; unit: string }>;
  /** Null when the reader may not see stages; the pack then prints without the test checks. */
  checks: Array<{ id: string; stage: string; label: string; verdict: string; on: string; remarks: string | null; reading: string | null }> | null;
  passport: { issuedOn: string; reference: string | null } | null;
  printedOn: string;
  backHref: string;
};

/** The packing list, delivery note and the test checks that supported the release, as one sheet. */
export function DispatchPackDoc({ doc, sheetOnly = false }: { doc: DispatchPackData; sheetOnly?: boolean }) {
  const body = (
    <article className="text-[12.5px] leading-[18px] text-text">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-text pb-3">
        <div className="min-w-0">
          <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.1em] text-text-secondary">{doc.business}</p>
          <p className="m-0 text-[22px] font-bold tracking-[-0.01em]">Delivery note and packing list</p>
          <p className="m-0 tabular text-[16px] font-semibold">{doc.reference}</p>
        </div>
        <div className="text-right text-text-secondary">
          <p className="m-0">Dispatched {doc.dispatch.dispatchedOn}</p>
          {doc.delivered && <p className="m-0">Delivered {doc.delivered}</p>}
          <p className="m-0">Printed {doc.printedOn}</p>
        </div>
      </header>

      <section className="grid gap-4 py-3 sm:grid-cols-2">
        <div>
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">Deliver to</p>
          {doc.customer ? (
            <>
              <p className="m-0 text-[15px] font-semibold">{doc.customer.name}</p>
              {doc.customer.contact && <p className="m-0">Attn: {doc.customer.contact}</p>}
              {doc.customer.gstin && <p className="m-0">GSTIN {doc.customer.gstin}</p>}
              {doc.customer.phone && <p className="m-0">{doc.customer.phone}</p>}
              {doc.customer.email && <p className="m-0">{doc.customer.email}</p>}
            </>
          ) : (
            <p className="m-0 text-text-secondary">This order is not linked to a job, so no customer is shown.</p>
          )}
          {doc.job && (
            <p className="m-0 mt-1">
              Against {doc.job.reference} · {doc.job.title}
            </p>
          )}
        </div>
        <div>
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">Transport</p>
          <p className="m-0 font-medium">{doc.dispatch.transporter}</p>
          {doc.dispatch.vehicleNo && <p className="m-0">Vehicle {doc.dispatch.vehicleNo}</p>}
          {doc.dispatch.trackingRef && <p className="m-0">Reference {doc.dispatch.trackingRef}</p>}
          <p className="m-0 text-text-secondary">{doc.dispatch.photoOnRecord ? "Packing photograph is on record." : "No packing photograph on record."}</p>
          {doc.dispatch.note && <p className="m-0">{doc.dispatch.note}</p>}
        </div>
      </section>

      <p className="m-0 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">Packing list</p>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-y border-line bg-[var(--color-surface-sunken)] text-[11px] uppercase tracking-[0.05em] text-text-secondary">
            <th className="px-2 py-1.5 font-semibold">Description</th>
            <th className="w-24 px-2 py-1.5 text-right font-semibold">Quantity</th>
            <th className="w-32 px-2 py-1.5 font-semibold">Packages</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-line">
            <td className="px-2 py-2 font-medium">{doc.product}</td>
            <td className="tabular px-2 py-2 text-right">{doc.quantity}</td>
            <td className="px-2 py-2" />
          </tr>
        </tbody>
      </table>
      <p className="m-0 mt-1 text-[10.5px] text-text-tertiary">
        Number of packages and weights are not recorded in Verity; write them here before the vehicle leaves.
      </p>

      <p className="m-0 mt-4 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">Test and inspection checks passed</p>
      {doc.checks === null ? (
        <p className="m-0 border-y border-line py-3 text-text-secondary">Stage records are not shown to this account.</p>
      ) : doc.checks.length === 0 ? (
        <p className="m-0 border-y border-line py-3 text-text-secondary">No inspection checks were defined for this order.</p>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-y border-line bg-[var(--color-surface-sunken)] text-[11px] uppercase tracking-[0.05em] text-text-secondary">
              <th className="px-2 py-1.5 font-semibold">Stage</th>
              <th className="px-2 py-1.5 font-semibold">Check</th>
              <th className="w-20 px-2 py-1.5 font-semibold">Result</th>
              <th className="px-2 py-1.5 font-semibold">Reading or remark</th>
              <th className="w-24 px-2 py-1.5 font-semibold">Date</th>
            </tr>
          </thead>
          <tbody>
            {doc.checks.map((c) => (
              <tr key={c.id} className="break-inside-avoid border-b border-line align-top">
                <td className="px-2 py-1.5">{c.stage}</td>
                <td className="px-2 py-1.5">{c.label}</td>
                <td className="px-2 py-1.5 font-medium">{c.verdict}</td>
                <td className="px-2 py-1.5">{[c.reading, c.remarks].filter(Boolean).join(" · ") || "—"}</td>
                <td className="px-2 py-1.5 text-text-secondary">{c.on}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="m-0 mt-1 text-[10.5px] text-text-tertiary">
        Results are the inspection findings recorded in Verity. This sheet is not a certificate issued by an accredited laboratory.
      </p>

      {doc.passport && (
        <p className="m-0 mt-3 border-y border-line py-2">
          Verification passport published {doc.passport.issuedOn}
          {doc.passport.reference ? `, reference ${doc.passport.reference}` : ""}. The nameplate carries its QR code.
        </p>
      )}

      <p className="m-0 mt-4 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">Materials consumed in manufacture</p>
      <p className="m-0 text-text-secondary">{doc.materials.map((m) => `${m.item} ${m.qty} ${m.unit}`).join(" · ")}</p>

      <footer className="mt-8 grid grid-cols-2 gap-8 border-t border-line pt-3">
        <div>
          <p className="m-0 mb-8 text-[11px] text-text-secondary">For {doc.business}</p>
          <p className="m-0 border-t border-text pt-1 text-[11px] font-medium">Dispatched by, signature and date</p>
        </div>
        <div>
          <p className="m-0 mb-8 text-[11px] text-text-secondary">Goods received in good condition</p>
          <p className="m-0 border-t border-text pt-1 text-[11px] font-medium">Receiver name, signature, stamp and date</p>
        </div>
      </footer>
      {doc.demo && <p className="m-0 mt-3 text-[10.5px] text-text-tertiary">Demo data: every name, number and value on this sheet is fictional.</p>}
    </article>
  );

  if (sheetOnly) return body;

  return (
    <>
      <section className="hidden print:block">{body}</section>
      <div className="print:hidden">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => window.print()}>
            Print dispatch pack
          </Button>
          <a href={doc.backHref}>Back to the order</a>
        </div>
        <Panel>{body}</Panel>
      </div>
    </>
  );
}
