"use client";

/* eslint-disable no-restricted-syntax -- print-only document table (REQ-019): DataTable's on-screen chrome (filter, sort, pagination) has no place on a sheet that is printed and carried on the shop floor. */

import { Button, Panel } from "@/components/ui/primitives";

export type TravelerDocData = {
  business: string;
  demo: boolean;
  reference: string;
  state: string;
  product: string;
  quantity: number;
  location: string;
  bom: string | null;
  job: { reference: string; title: string; customer: string; promised: string } | null;
  qr: string;
  qrNote: string;
  printedOn: string;
  materials: Array<{ id: string; item: string; qty: number; unit: string }>;
  /** Null when the reader may not see stages (a separate grant); the sheet then prints without them. */
  stages: Array<{
    id: string;
    sequence: number;
    label: string;
    rework: boolean;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    checks: Array<{ key: string; label: string; needsEvidence: boolean; verdict: "pass" | "fail" | null }>;
  }> | null;
  backHref: string;
};

const VERDICT: Record<string, string> = { pass: "Passed", fail: "Failed" };

/** The shop-floor sheet for one production order. On screen it is a preview with a Print button. */
export function TravelerDoc({ doc }: { doc: TravelerDocData }) {
  const body = (
    <article className="text-[12.5px] leading-[18px] text-text">
      <header className="flex items-start justify-between gap-4 border-b-2 border-text pb-3">
        <div className="min-w-0">
          <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.1em] text-text-secondary">{doc.business}</p>
          <p className="m-0 text-[22px] font-bold tracking-[-0.01em]">Job card and traveler</p>
          <p className="m-0 tabular text-[16px] font-semibold">{doc.reference}</p>
          <p className="m-0 mt-1 text-text-secondary">
            {doc.quantity} × {doc.product} · {doc.location}
            {doc.bom ? ` · BOM ${doc.bom}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1 text-center">
          <img src={doc.qr} alt="QR code that opens this order in Verity" width={96} height={96} className="size-24 bg-white" />
          <span className="max-w-[9rem] text-[10px] leading-[13px] text-text-secondary">{doc.qrNote}</span>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-x-6 gap-y-1 py-3 sm:grid-cols-4">
        {doc.job ? (
          <>
            <Cell label="Job" value={doc.job.reference} />
            <Cell label="Customer" value={doc.job.customer} />
            <Cell label="Promised" value={doc.job.promised} />
            <Cell label="What" value={doc.job.title} />
          </>
        ) : (
          <Cell label="Job" value="Not linked to a job" />
        )}
        <Cell label="Order status when printed" value={doc.state} />
        <Cell label="Printed" value={doc.printedOn} />
      </section>

      <p className="m-0 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">Materials to issue</p>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-y border-line bg-[var(--color-surface-sunken)] text-[11px] uppercase tracking-[0.05em] text-text-secondary">
            <th className="px-2 py-1.5 font-semibold">Component</th>
            <th className="px-2 py-1.5 text-right font-semibold">Quantity</th>
            <th className="px-2 py-1.5 font-semibold">Lot or heat no.</th>
            <th className="px-2 py-1.5 font-semibold">Issued by</th>
          </tr>
        </thead>
        <tbody>
          {doc.materials.map((m) => (
            <tr key={m.id} className="border-b border-line">
              <td className="px-2 py-1.5">{m.item}</td>
              <td className="tabular px-2 py-1.5 text-right">
                {m.qty} {m.unit}
              </td>
              <td className="w-36 px-2 py-1.5" />
              <td className="w-28 px-2 py-1.5" />
            </tr>
          ))}
        </tbody>
      </table>
      <p className="m-0 mt-1 text-[10.5px] text-text-tertiary">
        Lot and heat numbers are written by hand here. Verity does not record them yet.
      </p>

      <p className="m-0 mt-4 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">Stages</p>
      {doc.stages === null || doc.stages.length === 0 ? (
        <p className="m-0 border-y border-line py-3 text-text-secondary">
          {doc.stages === null ? "Stages are not shown to this account." : "No stages are planned for this order yet."}
        </p>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-y border-line bg-[var(--color-surface-sunken)] text-[11px] uppercase tracking-[0.05em] text-text-secondary">
              <th className="w-8 px-2 py-1.5 font-semibold">#</th>
              <th className="px-2 py-1.5 font-semibold">Stage and checks</th>
              <th className="w-32 px-2 py-1.5 font-semibold">Recorded in Verity</th>
              <th className="w-28 px-2 py-1.5 font-semibold">Operator sign</th>
              <th className="w-28 px-2 py-1.5 font-semibold">Inspector sign</th>
            </tr>
          </thead>
          <tbody>
            {doc.stages.map((s) => (
              <tr key={s.id} className="break-inside-avoid border-b border-line align-top">
                <td className="tabular px-2 py-2">{s.sequence}</td>
                <td className="px-2 py-2">
                  <p className="m-0 font-semibold">
                    {s.label}
                    {s.rework ? " (rework)" : ""}
                  </p>
                  {s.checks.length > 0 && (
                    <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
                      {s.checks.map((c) => (
                        <li key={c.key} className="flex items-start gap-1.5">
                          <span aria-hidden="true" className="mt-[3px] inline-block size-3 shrink-0 border border-text" />
                          <span>
                            {c.label}
                            {c.needsEvidence ? " (photo or reading)" : ""}
                            {c.verdict ? <em className="ml-1 text-text-secondary"> — {VERDICT[c.verdict]}</em> : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="px-2 py-2 text-[11px] text-text-secondary">
                  <p className="m-0">{s.status}</p>
                  {s.startedAt && <p className="m-0">Start {s.startedAt}</p>}
                  {s.completedAt && <p className="m-0">Done {s.completedAt}</p>}
                </td>
                <td className="px-2 py-2" />
                <td className="px-2 py-2" />
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer className="mt-6 flex items-end justify-between gap-6 border-t border-line pt-3">
        <p className="m-0 max-w-[65%] text-[10.5px] text-text-tertiary">
          Scan the code with a phone signed in to Verity to open this order and record each stage. Checks ticked on paper are
          not a record until they are entered in Verity.
          {doc.demo ? " Demo data: every name, number and value on this sheet is fictional." : ""}
        </p>
        <div className="text-right">
          <p className="m-0 mb-6 text-[11px] text-text-secondary">Production head</p>
          <p className="m-0 border-t border-text pt-1 text-[11px] font-medium">Signature and date</p>
        </div>
      </footer>
    </article>
  );

  return (
    <>
      {/* The print-only sheet is the only thing that prints; the preview and controls stay on screen. */}
      <section className="hidden print:block">{body}</section>
      <div className="print:hidden">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => window.print()}>
            Print traveler
          </Button>
          <a href={doc.backHref}>Back to the order</a>
        </div>
        <Panel>{body}</Panel>
      </div>
    </>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="m-0 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-secondary">{label}</p>
      <p className="m-0 font-medium">{value}</p>
    </div>
  );
}
