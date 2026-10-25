"use client";

import Link from "next/link";
import { Button, EmptyState, Panel } from "@/components/ui/primitives";
import { zplFile } from "@/lib/zpl";

export type RollLabel = { id: string; number: string; fabric: string; quantity: string; received: string; from: string; business: string; qr: string; qrUrl: string };

function Label({ l }: { l: RollLabel }) {
  return (
    <article className="grid w-[9cm] grid-cols-[1fr_auto] items-center gap-3 border-2 border-black p-3 text-black" style={{ background: "#fff" }}>
      <div className="min-w-0">
        <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.08em]">{l.business}</p>
        <p className="m-0 mt-1 text-[11px]">रोल नं. / Roll No.</p>
        <p className="m-0 text-[30px] font-extrabold leading-[1.05]">{l.number}</p>
        <p className="m-0 mt-1 truncate text-[14px] font-semibold">{l.fabric}</p>
        <p className="m-0 text-[18px] font-extrabold leading-[1.1]">{l.quantity}</p>
        <p className="m-0 mt-1 truncate text-[10px]">{l.received}{l.from ? ` · ${l.from}` : ""}</p>
      </div>
      <img src={l.qr} alt={`QR code that opens roll ${l.number}`} width={96} height={96} className="size-24" />
    </article>
  );
}

/** Roll labels, a preview on screen and, when printed, only the labels, two to a row. */
export function RollLabels({ labels }: { labels: RollLabel[] }) {
  if (labels.length === 0) return <EmptyState title="No labels to print" description="Open a roll and choose Print label, or receive rolls to print theirs." />;
  return (
    <>
      <section className="hidden print:grid print:grid-cols-2 print:gap-3" aria-hidden="true">
        {labels.map((l) => <div key={l.id} style={{ breakInside: "avoid" }}><Label l={l} /></div>)}
      </section>
      <div className="print:hidden">
        <Panel title={`${labels.length} label${labels.length === 1 ? "" : "s"}`}>
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => window.print()}>Print labels</Button>
              <Button variant="secondary" title="For a Zebra thermal label printer, 50 by 30 mm. Not yet tried on a printer." onClick={() => {
                const file = zplFile(labels.map((l) => ({ title: l.number, lines: [l.fabric, l.quantity, l.from || l.received], qr: l.qrUrl })));
                const url = URL.createObjectURL(new Blob([file], { type: "text/plain" }));
                const a = document.createElement("a"); a.href = url; a.download = "roll-labels.zpl"; a.click(); URL.revokeObjectURL(url);
              }}>Zebra file (.zpl)</Button>
              <Link href="/fabric" className="inline-flex min-h-11 items-center rounded-[10px] px-4 text-[15px] font-semibold text-accent-ink no-underline hover:bg-[var(--color-control)]">Back to fabric</Link>
            </div>
            <ul className="m-0 grid list-none gap-4 p-0" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(9.5cm, max-content))" }}>
              {labels.map((l) => <li key={l.id} className="max-w-full overflow-x-auto"><Label l={l} /></li>)}
            </ul>
          </div>
        </Panel>
      </div>
    </>
  );
}
