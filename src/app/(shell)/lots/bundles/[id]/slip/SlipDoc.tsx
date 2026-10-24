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
export function SlipCard({ slip, compact = false }: { slip: SlipData; compact?: boolean }) {
  // Full: 10 cm, two across an A4 sheet. Sticker: 6.4 cm, three across, for a label that goes on the bundle's tie.
  const c = compact;
  return (
    <article className={`${c ? "w-[6.4cm] border p-2" : "w-[10cm] border-2 p-4"} border-black text-black`} style={{ background: "#fff" }}>
      <p className={`m-0 truncate font-semibold uppercase tracking-[0.08em] ${c ? "text-[8px]" : "text-[11px]"}`}>{slip.business}{slip.demo ? " · demo" : ""}</p>
      <div className={`grid grid-cols-[1fr_auto] items-center ${c ? "mt-1 gap-2" : "mt-2 gap-3"}`}>
        <div className="min-w-0">
          <p className={`m-0 ${c ? "text-[8px]" : "text-[12px]"}`}>बंडल नं. / Bundle No.</p>
          <p className={`m-0 font-extrabold leading-[1.05] tracking-[-0.01em] ${c ? "text-[22px]" : "text-[34px]"}`}>{slip.bundleNumber}</p>
        </div>
        <img src={slip.qr} alt={`QR code that opens bundle ${slip.bundleNumber}`} width={c ? 62 : 92} height={c ? 62 : 92} className={c ? "size-[62px]" : "size-[92px]"} />
      </div>
      <div className={`grid grid-cols-2 border-t border-black ${c ? "mt-1.5 gap-2 pt-1.5" : "mt-3 gap-3 pt-3"}`}>
        <div>
          <p className={`m-0 ${c ? "text-[8px]" : "text-[12px]"}`}>नेट पीस / Net Pieces</p>
          <p className={`m-0 font-extrabold leading-[1.05] ${c ? "text-[20px]" : "text-[30px]"}`}>{slip.netPieces}</p>
        </div>
        <div className="min-w-0">
          <p className={`m-0 ${c ? "text-[8px]" : "text-[12px]"}`}>लॉट / Lot</p>
          <p className={`m-0 font-extrabold leading-[1.1] ${c ? "text-[13px]" : "text-[20px]"}`}>{slip.lotNumber}</p>
          <p className={`m-0 leading-[1.2] ${c ? "truncate text-[9px]" : "text-[13px]"}`}>{slip.lotName}</p>
        </div>
      </div>
      <p className={`m-0 border-t border-black ${c ? "mt-1.5 truncate pt-1 text-[8px]" : "mt-3 pt-2 text-[11px]"}`}>{slip.design} · कटिंग / Cut {slip.cutOn}</p>
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
