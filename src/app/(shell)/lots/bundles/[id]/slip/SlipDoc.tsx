"use client";

import { Button, Panel } from "@/components/ui/primitives";

export type SlipData = {
  business: string;
  demo: boolean;
  bundleNumber: string;
  netPieces: number;
  lotNumber: string;
  lotName: string;
  design: string;
  cutOn: string;
  qr: string;
  backHref: string;
};

/**
 * One bundle's slip: exactly the three things the factory asked for, large (Bundle No, Net Pieces, Lot name and number),
 * with Hindi beside each English label, and a QR that opens the bundle. No size is printed. On screen it is a preview
 * with a Print button; only the slip itself prints.
 */
export function SlipCard({ slip }: { slip: SlipData }) {
  return (
    <article className="w-[10cm] border-2 border-black p-4 text-black" style={{ background: "#fff" }}>
      <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.08em]">{slip.business}{slip.demo ? " · demo" : ""}</p>
      <div className="mt-2 grid grid-cols-[1fr_auto] items-center gap-3">
        <div>
          <p className="m-0 text-[12px]">बंडल नं. / Bundle No.</p>
          <p className="m-0 text-[34px] font-extrabold leading-[1.05] tracking-[-0.01em]">{slip.bundleNumber}</p>
        </div>
        <img src={slip.qr} alt={`QR code that opens bundle ${slip.bundleNumber}`} width={92} height={92} className="size-[92px]" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-black pt-3">
        <div>
          <p className="m-0 text-[12px]">नेट पीस / Net Pieces</p>
          <p className="m-0 text-[30px] font-extrabold leading-[1.05]">{slip.netPieces}</p>
        </div>
        <div>
          <p className="m-0 text-[12px]">लॉट / Lot</p>
          <p className="m-0 text-[20px] font-extrabold leading-[1.1]">{slip.lotNumber}</p>
          <p className="m-0 text-[13px] leading-[1.2]">{slip.lotName}</p>
        </div>
      </div>
      <p className="m-0 mt-3 border-t border-black pt-2 text-[11px]">{slip.design} · कटिंग / Cut {slip.cutOn}</p>
    </article>
  );
}

export function SlipDoc({ slip }: { slip: SlipData }) {
  const body = <SlipCard slip={slip} />;

  return (
    <>
      <section className="hidden print:block">{body}</section>
      <div className="print:hidden">
        <Panel title="Slip preview">
          <div className="flex flex-col gap-4">
            <div className="overflow-x-auto">{body}</div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => window.print()}>Print this slip</Button>
              <a href={slip.backHref} className="inline-flex min-h-11 items-center rounded-[10px] px-4 text-[15px] font-semibold text-accent-ink no-underline hover:bg-[var(--color-control)]">Back to the bundle</a>
            </div>
            <p className="m-0 text-[13px] text-text-secondary">
              The QR opens this bundle for a signed-in phone. It carries only the bundle&apos;s address, no piece counts and no names.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}
