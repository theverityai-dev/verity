import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { loadPassport } from "@/server/capabilities/manufacturing/passport-public";
import { publicUrl } from "@/server/platform/public-url";
import { VeritySymbol } from "@/components/brand/VerityMark";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nameplate", robots: { index: false, follow: false } };

/**
 * A printable nameplate for one published passport: product, maker, reference and the QR that leads to the
 * verification page. It is reachable only with the passport's own token and shows nothing the passport page does
 * not already show. The QR points at the configured public origin, never at the request's host (ADR-032).
 */
export default async function LabelPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const passport = await loadPassport(token);
  if (!passport) notFound();

  const target = publicUrl(`/verify/${token}`).toString();
  const qr = await QRCode.toDataURL(target, { width: 480, margin: 1, errorCorrectionLevel: "M" });

  return (
    <main className="mx-auto flex max-w-[640px] flex-col items-center gap-6 px-4 py-8">
      <style>{`@page { size: 100mm 70mm; margin: 0 } @media print { body { background: #fff !important } .no-print { display: none !important } .nameplate { box-shadow: none !important; border-radius: 0 !important; width: 100mm !important; height: 70mm !important; border: 0 !important } }`}</style>

      <div className="no-print flex flex-col items-center gap-3 text-center">
        <p className="m-0 text-[15px] text-text-secondary">Print on a sticker or etched plate. Set the paper to 100 × 70 mm, no margins.</p>
        <PrintButton />
      </div>

      <section
        className="nameplate flex h-[70mm] w-[100mm] items-center gap-4 overflow-hidden rounded-[14px] bg-white p-[6mm] text-[#0b1220] shadow-[0_18px_40px_-20px_rgba(11,18,32,0.5)]"
        aria-label="Product nameplate"
        style={{ border: "1px solid rgba(11,18,32,0.12)" }}
      >
        <div className="flex h-full min-w-0 flex-1 flex-col justify-between">
          <div>
            <p className="m-0 flex items-center gap-1.5 text-[7pt] font-bold uppercase tracking-[0.12em]">
              <VeritySymbol size={11} />
              <span className="truncate">{passport.tenant}</span>
            </p>
            <p className="m-0 mt-2 text-[13pt] font-bold leading-[1.15] tracking-[-0.01em]">{passport.product}</p>
          </div>
          <div>
            {passport.reference && <p className="m-0 font-mono text-[8pt] tracking-[0.04em]">{passport.reference}</p>}
            <p className="m-0 mt-1 text-[7pt] leading-[1.3]" style={{ color: "rgba(11,18,32,0.62)" }}>
              Scan to see the inspection record this unit passed.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1">
          <img src={qr} alt="QR code to this product's verification page" width={150} height={150} className="size-[34mm]" />
          <span className="text-[6.5pt] font-bold uppercase tracking-[0.14em]">Verified</span>
        </div>
      </section>
    </main>
  );
}
