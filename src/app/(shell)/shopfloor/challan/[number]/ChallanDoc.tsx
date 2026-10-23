"use client";

import Link from "next/link";
import { Button, Panel } from "@/components/ui/primitives";
import type { Challan } from "@/server/capabilities/piecework";

const when = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

function Sheet({ c, business }: { c: Challan; business: string }) {
  const gave = c.lines.filter((l) => l.kind === "issue");
  const took = c.lines.filter((l) => l.kind === "receive");
  return (
    <article className="w-[14.8cm] border-2 border-black p-5 text-black" style={{ background: "#fff" }}>
      <header className="flex items-start justify-between gap-4 border-b-2 border-black pb-3">
        <div>
          <p className="m-0 text-[18px] font-extrabold leading-tight">{c.heading.title || business}</p>
          {c.heading.address && <p className="m-0 mt-0.5 whitespace-pre-line text-[11px]">{c.heading.address}</p>}
        </div>
        <div className="text-right">
          <p className="m-0 text-[11px]">चालान / Challan</p>
          <p className="m-0 text-[24px] font-extrabold leading-tight">{c.number}</p>
          <p className="m-0 text-[11px]">{when(c.date)}</p>
        </div>
      </header>

      <p className="m-0 mt-3 text-[13px]">कारीगर / Karigar: <strong className="text-[15px]">{c.worker.name}</strong>{c.worker.mobile ? ` · ${c.worker.mobile}` : ""}</p>

      {gave.length > 0 && (
        <table className="mt-3 w-full border-collapse text-[12px]">
          <caption className="pb-1 text-left text-[11px] font-semibold uppercase tracking-[0.06em]">दिया / Given out</caption>
          <thead>
            <tr className="border-y border-black text-left">
              <th className="py-1 pr-2 font-semibold">बंडल / Bundle</th><th className="pr-2 font-semibold">लॉट / Lot</th><th className="pr-2 font-semibold">स्टेज / Stage</th>
              <th className="pr-2 text-right font-semibold">दिए / Handed</th><th className="text-right font-semibold">गिने / Counted</th>
            </tr>
          </thead>
          <tbody>
            {gave.map((l) => (
              <tr key={l.entryId} className="border-b border-black/40 align-top">
                <td className="py-1 pr-2 font-semibold">{l.bundleNumber}{l.sizeNote ? ` (${l.sizeNote})` : ""}</td>
                <td className="pr-2">{l.lotNumber} {l.design}</td>
                <td className="pr-2">{l.stageLabel}{l.isRework ? " · rework" : ""}</td>
                <td className="pr-2 text-right">{l.sent}</td>
                <td className="text-right font-extrabold">{l.counted}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={3} className="pt-1 font-semibold">कुल / Total</td><td className="pt-1 text-right">{c.totalSent}</td><td className="pt-1 text-right font-extrabold">{gave.reduce((s, l) => s + l.counted, 0)}</td></tr>
          </tfoot>
        </table>
      )}

      {took.length > 0 && (
        <table className="mt-3 w-full border-collapse text-[12px]">
          <caption className="pb-1 text-left text-[11px] font-semibold uppercase tracking-[0.06em]">वापस लिया / Taken back</caption>
          <thead>
            <tr className="border-y border-black text-left">
              <th className="py-1 pr-2 font-semibold">बंडल / Bundle</th><th className="pr-2 font-semibold">स्टेज / Stage</th>
              <th className="pr-2 text-right font-semibold">ठीक / Good</th><th className="pr-2 text-right font-semibold">रिजेक्ट / Rej.</th><th className="pr-2 text-right font-semibold">रीवर्क / Rework</th><th className="text-right font-semibold">कम / Short</th>
            </tr>
          </thead>
          <tbody>
            {took.map((l) => (
              <tr key={l.entryId} className="border-b border-black/40 align-top">
                <td className="py-1 pr-2 font-semibold">{l.bundleNumber}</td><td className="pr-2">{l.stageLabel}</td>
                <td className="pr-2 text-right">{l.good}</td><td className="pr-2 text-right">{l.rejected}</td><td className="pr-2 text-right">{l.rework}</td><td className="text-right font-extrabold">{l.short}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {c.lines.some((l) => l.note) && <p className="m-0 mt-2 text-[11px]">{c.lines.filter((l) => l.note).map((l) => `${l.bundleNumber}: ${l.note}`).join(" · ")}</p>}
      {c.differences > 0 && <p className="m-0 mt-2 border border-black px-2 py-1 text-[11px] font-semibold">गिनती में फ़र्क / Count differs on {c.differences} line{c.differences === 1 ? "" : "s"}. प्राप्तकर्ता की गिनती मान्य / The receiver&apos;s count stands.</p>}

      <div className="mt-8 grid grid-cols-2 gap-8 text-[11px]">
        <div className="border-t border-black pt-1">कारीगर के हस्ताक्षर / Karigar signature</div>
        <div className="border-t border-black pt-1">सुपरवाइज़र / Supervisor{c.preparedBy ? `: ${c.preparedBy}` : ""}</div>
      </div>
    </article>
  );
}

/** A challan to print and hand over. On screen a preview with Print; only the sheet prints. */
export function ChallanDoc({ challan, business, backHref }: { challan: Challan; business: string; backHref: string }) {
  return (
    <>
      <section className="hidden print:block"><Sheet c={challan} business={business} /></section>
      <div className="print:hidden">
        <Panel title="Challan preview">
          <div className="flex flex-col gap-4">
            <div className="overflow-x-auto"><Sheet c={challan} business={business} /></div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => window.print()}>Print the challan</Button>
              <Link href={backHref} className="inline-flex min-h-11 items-center rounded-[10px] px-4 text-[15px] font-semibold text-accent-ink no-underline hover:bg-[var(--color-control)]">Back to my floor</Link>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
