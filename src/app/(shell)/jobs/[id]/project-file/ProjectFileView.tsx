"use client";

/* eslint-disable no-restricted-syntax -- print-only document table (REQ-019): DataTable's on-screen chrome has no place on a file handed to a client. */

import { Button } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { TestReportView, type TestReportDoc } from "../../../manufacturing/[id]/test-report/TestReportView";
import { DispatchPackDoc } from "../../../manufacturing/[id]/dispatch-pack/DispatchPackDoc";
import type { DispatchPackData } from "../../../manufacturing/[id]/dispatch-pack/DispatchPackDoc";

export type ProjectFileDoc = {
  business: string;
  demo: boolean;
  reference: string;
  title: string;
  customer: string;
  contact: string | null;
  stateLabel: string;
  dueOn: string | null;
  startedOn: string | null;
  finishedOn: string | null;
  agreedValue: { amount: string; revision: number } | null;
  milestones: Array<{ id: string; name: string; due: string | null; reached: string | null }>;
  orders: Array<{
    id: string;
    reference: string;
    product: string;
    quantity: number;
    testReport: TestReportDoc | null;
    dispatch: DispatchPackData | null;
    photos: Array<{ id: string; caption: string; on: string; src: string | null }>;
  }>;
  printedOn: string;
  backHref: string;
};

const LABEL = "m-0 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary";

/** The whole job as one document: cover, then per production order its test report, dispatch and photographs. */
export function ProjectFileView({ doc }: { doc: ProjectFileDoc }) {
  const checks = doc.orders.reduce((n, o) => n + (o.testReport?.stages.reduce((m, s) => m + s.checks.length, 0) ?? 0), 0);
  const photos = doc.orders.reduce((n, o) => n + o.photos.length, 0);
  const shownPhotos = doc.orders.reduce((n, o) => n + o.photos.filter((p) => p.src).length, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Button variant="primary" onClick={() => window.print()}>
          <Icon name="evidence" size={16} /> Print project file
        </Button>
        <a href={doc.backHref} className="inline-flex h-11 items-center px-2 text-[15px]">Back to the job</a>
        <p className="m-0 text-[13px] text-text-secondary">
          {doc.orders.length} {doc.orders.length === 1 ? "production order" : "production orders"} · {checks} test {checks === 1 ? "check" : "checks"} · {photos} {photos === 1 ? "photograph" : "photographs"}
          {photos > shownPhotos ? ` (${photos - shownPhotos} on record without a stored image)` : ""}. To save a PDF, choose “Save as PDF” in the print window.
        </p>
      </div>

      <article className="verity-solid rounded-[12px] p-5 text-[12.5px] leading-[18px] text-text print:rounded-none print:bg-transparent print:p-0">
        <header className="border-b-2 border-text pb-3">
          <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.1em] text-text-secondary">{doc.business}</p>
          <p className="m-0 text-[26px] font-bold tracking-[-0.01em]">Project file</p>
          <p className="m-0 text-[16px] font-semibold"><span className="tabular">{doc.reference}</span> · {doc.title}</p>
        </header>

        <section className="grid gap-4 py-3 sm:grid-cols-2">
          <div>
            <p className={LABEL}>Customer</p>
            <p className="m-0 text-[15px] font-semibold">{doc.customer}</p>
            {doc.contact && <p className="m-0">Attn: {doc.contact}</p>}
          </div>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
            <dt className="text-text-secondary">Status</dt><dd className="m-0 capitalize">{doc.stateLabel}</dd>
            {doc.agreedValue && (<><dt className="text-text-secondary">Agreed value</dt><dd className="tabular m-0">{doc.agreedValue.amount} (quote revision {doc.agreedValue.revision})</dd></>)}
            {doc.startedOn && (<><dt className="text-text-secondary">Started</dt><dd className="m-0">{doc.startedOn}</dd></>)}
            {doc.dueOn && (<><dt className="text-text-secondary">Promised</dt><dd className="m-0">{doc.dueOn}</dd></>)}
            {doc.finishedOn && (<><dt className="text-text-secondary">Finished</dt><dd className="m-0">{doc.finishedOn}</dd></>)}
            <dt className="text-text-secondary">Printed</dt><dd className="m-0">{doc.printedOn}</dd>
          </dl>
        </section>

        {doc.milestones.length > 0 && (
          <section className="mb-3 break-inside-avoid">
            <p className={LABEL}>Milestones</p>
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-y border-line bg-[var(--color-surface-sunken)] text-[11px] uppercase tracking-[0.05em] text-text-secondary">
                  <th className="px-2 py-1.5 font-semibold">Milestone</th>
                  <th className="w-28 px-2 py-1.5 font-semibold">Due</th>
                  <th className="w-28 px-2 py-1.5 font-semibold">Reached</th>
                </tr>
              </thead>
              <tbody>
                {doc.milestones.map((m) => (
                  <tr key={m.id} className="border-b border-line">
                    <td className="px-2 py-1.5">{m.name}</td>
                    <td className="px-2 py-1.5 text-text-secondary">{m.due ?? "—"}</td>
                    <td className="px-2 py-1.5">{m.reached ?? "Not yet"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="mb-2">
          <p className={LABEL}>Contents</p>
          {doc.orders.length === 0 ? (
            <p className="m-0 border-y border-line py-3 text-text-secondary">No production order is linked to this job, so the file holds the job record only.</p>
          ) : (
            <ol className="m-0 list-decimal pl-5">
              {doc.orders.map((o) => (
                <li key={o.id}>{o.product} × {o.quantity} ({o.reference}): test report{o.dispatch ? ", delivery note and packing list" : ""}{o.photos.length > 0 ? `, ${o.photos.length} photographs` : ""}</li>
              ))}
            </ol>
          )}
        </section>

        {doc.orders.map((o, i) => (
          <section key={o.id} className="mt-6 break-before-page border-t-2 border-text pt-3 print:mt-0 print:border-t-0 print:pt-0">
            <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.1em] text-text-secondary">Part {i + 1} of {doc.orders.length}</p>
            <p className="m-0 mb-3 text-[18px] font-bold">{o.product} × {o.quantity} <span className="tabular font-semibold text-text-secondary">({o.reference})</span></p>

            {o.testReport ? <TestReportView doc={o.testReport} sheetOnly /> : (
              <p className="m-0 border-y border-line py-3 text-text-secondary">No test report: this order has no inspection checks, or stage records are not shown to this account.</p>
            )}

            <div className="mt-6 break-before-page print:mt-0">
              {o.dispatch ? <DispatchPackDoc doc={o.dispatch} sheetOnly /> : (
                <p className="m-0 border-y border-line py-3 text-text-secondary">Not dispatched yet, so there is no delivery note.</p>
              )}
            </div>

            {o.photos.length > 0 && (
              <div className="mt-6 break-before-page print:mt-0">
                <p className={LABEL}>Photographs</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {o.photos.map((p) => (
                    <figure key={p.id} className="m-0 break-inside-avoid">
                      {p.src ? (
                        // eslint-disable-next-line @next/next/no-img-element -- a signed storage link, not a build-time asset
                        <img src={p.src} alt={p.caption} loading="eager" className="aspect-[4/3] w-full rounded-[8px] border border-line object-cover" />
                      ) : (
                        <div className="grid aspect-[4/3] w-full place-items-center rounded-[8px] border border-dashed border-line px-2 text-center text-[11px] text-text-tertiary">
                          Photograph on record; no image is stored
                        </div>
                      )}
                      <figcaption className="mt-1 text-[11px] text-text-secondary">{p.caption} · {p.on}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            )}
          </section>
        ))}

        <footer className="mt-8 grid break-inside-avoid grid-cols-2 gap-8 border-t border-line pt-3">
          <p className="m-0 border-t border-text pt-1 text-[11px] font-medium">Compiled by, signature and date</p>
          <p className="m-0 border-t border-text pt-1 text-[11px] font-medium">Approved by, signature, stamp and date</p>
        </footer>
        <p className="m-0 mt-2 text-[10.5px] text-text-tertiary">
          Everything in this file is read from the records kept in Verity at the time of printing. It is not a certificate issued by an accredited laboratory.
        </p>
        {doc.demo && <p className="m-0 mt-2 text-[10.5px] text-text-tertiary">Demo data: every name, number and value in this file is fictional.</p>}
      </article>
    </div>
  );
}
