import Image from "next/image";
import { VerityLockup } from "@/components/brand/VerityMark";

/**
 * The sign-in page's left marketing panel — headline, subcopy, and a
 * floating product-preview image (a real screenshot/render, not a
 * hand-built fake UI — `public/lightsignin.png` / `public/darksignin.png`,
 * swapped via the `dark:` variant). Purely decorative — no live data, no
 * query.
 */

export function BrandPanel() {
  return (
    <div className="relative hidden overflow-hidden bg-canvas lg:block">
      <div className="relative z-10 flex h-full flex-col px-14 pt-14">
        <div>
          <VerityLockup size={30} className="text-text" />
          <p className="m-0 mt-4 text-[13px] uppercase tracking-[0.02em] text-text-secondary">
            Operate. Optimize. <span className="text-accent-ink">Outperform.</span>
          </p>
        </div>

        <div className="mt-16 max-w-[460px]">
          <h1 className="m-0 text-[44px] font-bold leading-[1.08] tracking-[-0.02em] text-text">
            A more intelligent way to operate.
          </h1>
          <p className="m-0 mt-5 text-[15px] leading-relaxed text-text-secondary">
            Unify your operations. Turn data into decisions. Drive real outcomes.
          </p>
        </div>

        {/* The product preview — angled, floating, matching the reference's
            "screen tilted back into the scene" composition. Real supplied
            assets, one per theme — never a hand-built fake dashboard. */}
        <div className="relative mt-12 flex-1" style={{ perspective: "2400px" }}>
          <div
            className="absolute inset-x-0 top-0 mx-auto h-[420px] w-full max-w-[640px] overflow-hidden rounded-2xl shadow-lg"
            style={{ transform: "rotateX(8deg) rotateY(-6deg)", transformOrigin: "center top" }}
          >
            <Image
              src="/lightsignin.png"
              alt=""
              fill
              sizes="640px"
              priority
              className="object-cover object-top dark:hidden"
            />
            <Image
              src="/darksignin.png"
              alt=""
              fill
              sizes="640px"
              priority
              className="hidden object-cover object-top dark:block"
            />
          </div>
        </div>

        <p className="relative z-10 mb-10 mt-6 text-right text-[13px] uppercase tracking-[0.02em] text-text-secondary">
          Real operations. Tangible impact.
        </p>
      </div>
    </div>
  );
}
