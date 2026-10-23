"use client";

import Link from "next/link";
import { Button, Panel } from "@/components/ui/primitives";
import { SlipCard, type SlipData } from "../../bundles/[id]/slip/SlipDoc";

/** Every slip of a lot, ready to print on one go. On screen it is a preview; only the slips print, two to a row on A4. */
export function SlipSheet({ slips, lotHref, lotNumber }: { slips: SlipData[]; lotHref: string; lotNumber: string }) {
  return (
    <>
      <section className="hidden print:grid print:grid-cols-2 print:gap-4" aria-hidden="true">
        {slips.map((s) => <div key={s.bundleNumber} style={{ breakInside: "avoid" }}><SlipCard slip={s} /></div>)}
      </section>
      <div className="print:hidden">
        <Panel title={`${slips.length} slip${slips.length === 1 ? "" : "s"} for ${lotNumber}`}>
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => window.print()}>Print all slips</Button>
              <Link href={lotHref} className="inline-flex min-h-11 items-center rounded-[10px] px-4 text-[15px] font-semibold text-accent-ink no-underline hover:bg-[var(--color-control)]">Back to the lot</Link>
            </div>
            <ul className="m-0 grid list-none gap-4 p-0" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(10.5cm, max-content))" }}>
              {slips.map((s) => <li key={s.bundleNumber} className="max-w-full overflow-x-auto"><SlipCard slip={s} /></li>)}
            </ul>
            <p className="m-0 text-[13px] text-text-secondary">Each QR opens its bundle on a signed-in phone. It carries only the bundle&apos;s address, no counts and no names.</p>
          </div>
        </Panel>
      </div>
    </>
  );
}
