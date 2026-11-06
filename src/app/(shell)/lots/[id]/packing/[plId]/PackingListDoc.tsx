"use client";

/* eslint-disable no-restricted-syntax -- print-only document table: a packing list is a sheet handed to the forwarder and the buyer, not an on-screen list. */

import { Button, Panel } from "@/components/ui/primitives";
import type { PackingListDetail } from "@/server/capabilities/piecework";

const kg = (grams: number) => (grams / 1000).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The packing list as one printable sheet: carton runs with the size assortment, weights, measurement and totals. */
export function PackingListDoc({ doc, business, demo, printedOn, backHref }: { doc: PackingListDetail; business: string; demo: boolean; printedOn: string; backHref: string }) {
  // Columns are every size the list names, in the order it first names them.
  const sizes = [...new Set(doc.lines.flatMap((l) => l.sizes.map((s) => s.size)))];
  const th = "px-2 py-1.5 font-semibold";
  const body = (
    <article className="text-[12.5px] leading-[18px] text-text">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-text pb-3">
        <div className="min-w-0">
          <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.1em] text-text-secondary">{business}</p>
          <p className="m-0 text-[22px] font-medium leading-[28px] tracking-[-0.01em]">Packing list</p>
          <p className="m-0 tabular text-[16px] font-semibold leading-[22px]">{doc.number}{doc.cancelled ? " · CANCELLED" : ""}</p>
        </div>
        <div className="text-right text-text-secondary">
          <p className="m-0">Packed {doc.packedOn}</p>
          <p className="m-0">Printed {printedOn}</p>
        </div>
      </header>

      <section className="grid gap-4 py-3 sm:grid-cols-3">
        <div>
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">Buyer</p>
          <p className="m-0 text-[15px] font-semibold">{doc.buyer}</p>
          {doc.destination && <p className="m-0">To {doc.destination}</p>}
        </div>
        <div>
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">Order and invoice</p>
          <p className="m-0">{doc.reference ?? "—"}</p>
        </div>
        <div>
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">Style</p>
          <p className="m-0 font-medium">{doc.lot.design}</p>
          <p className="m-0">{doc.lot.number} · {doc.lot.name}</p>
        </div>
      </section>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-y border-line bg-[var(--color-surface-sunken)] text-[11px] uppercase tracking-[0.05em] text-text-secondary">
              <th className={th}>Carton no.</th>
              <th className={`${th} text-right`}>Ctns</th>
              <th className={th}>Colour</th>
              {sizes.map((s) => <th key={s} className={`${th} text-right`}>{s}</th>)}
              <th className={`${th} text-right`}>Pcs/ctn</th>
              <th className={`${th} text-right`}>Pcs</th>
              <th className={`${th} text-right`}>Net kg</th>
              <th className={`${th} text-right`}>Gross kg</th>
              <th className={th}>L×W×H cm</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l) => (
              <tr key={l.from} className="break-inside-avoid border-b border-line align-top tabular-nums">
                <td className="px-2 py-1.5">{l.from === l.to ? l.from : `${l.from}–${l.to}`}</td>
                <td className="px-2 py-1.5 text-right">{l.cartons}</td>
                <td className="px-2 py-1.5">{l.colour ?? ""}</td>
                {sizes.map((s) => <td key={s} className="px-2 py-1.5 text-right">{l.sizes.find((x) => x.size === s)?.qty ?? ""}</td>)}
                <td className="px-2 py-1.5 text-right">{l.perCarton}</td>
                <td className="px-2 py-1.5 text-right">{(l.cartons * l.perCarton).toLocaleString("en-IN")}</td>
                <td className="px-2 py-1.5 text-right">{kg(l.cartons * l.netGrams)}</td>
                <td className="px-2 py-1.5 text-right">{kg(l.cartons * l.grossGrams)}</td>
                <td className="px-2 py-1.5">{l.lengthCm}×{l.widthCm}×{l.heightCm}</td>
              </tr>
            ))}
            <tr className="border-b-2 border-text font-semibold tabular-nums">
              <td className="px-2 py-1.5">Total</td>
              <td className="px-2 py-1.5 text-right">{doc.totals.cartons}</td>
              <td className="px-2 py-1.5" />
              {sizes.map((s) => <td key={s} className="px-2 py-1.5 text-right">{(doc.totals.bySize.find((x) => x.size === s)?.pieces ?? 0).toLocaleString("en-IN")}</td>)}
              <td className="px-2 py-1.5" />
              <td className="px-2 py-1.5 text-right">{doc.totals.pieces.toLocaleString("en-IN")}</td>
              <td className="px-2 py-1.5 text-right">{kg(doc.totals.netGrams)}</td>
              <td className="px-2 py-1.5 text-right">{kg(doc.totals.grossGrams)}</td>
              <td className="px-2 py-1.5">{(doc.totals.cbmMilli / 1000).toFixed(3)} m³</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="m-0 mt-3">
        {doc.totals.cartons} cartons containing {doc.totals.pieces.toLocaleString("en-IN")} pieces. Net weight {kg(doc.totals.netGrams)} kg, gross weight {kg(doc.totals.grossGrams)} kg,
        measurement {(doc.totals.cbmMilli / 1000).toFixed(3)} m³.
      </p>
      {doc.note && <p className="m-0 mt-1">{doc.note}</p>}

      <footer className="mt-8 grid grid-cols-2 gap-8 border-t border-line pt-3">
        <div>
          <p className="m-0 mb-8 text-[11px] text-text-secondary">For {business}</p>
          <p className="m-0 border-t border-text pt-1 text-[11px] font-medium">Authorised signatory</p>
        </div>
        <div>
          <p className="m-0 mb-8 text-[11px] text-text-secondary">Prepared by {doc.by}</p>
          <p className="m-0 border-t border-text pt-1 text-[11px] font-medium">Checked by, signature and date</p>
        </div>
      </footer>
      {demo && <p className="m-0 mt-3 text-[10.5px] text-text-tertiary">Demo data: every name, number and value on this sheet is fictional.</p>}
    </article>
  );

  return (
    <>
      <section className="hidden print:block">{body}</section>
      <div className="print:hidden">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => window.print()}>Print packing list</Button>
          <a href={backHref} className="text-[14px] font-medium text-accent-ink">Back to {doc.lot.number}</a>
        </div>
        <Panel>{body}</Panel>
      </div>
    </>
  );
}
