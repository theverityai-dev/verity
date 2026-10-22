import { VerityLockup } from "@/components/brand/VerityMark";

/**
 * The sign-in page's left panel: what the product is for, in plain words.
 *
 * It used to carry a tilted dashboard render with invented figures (uptime, task
 * completion) and a slogan line. The real product is plainer than that render,
 * so the first screen promised something the second did not deliver. This says
 * what the person will actually find after signing in, and nothing else.
 */

const POINTS = [
  { term: "What is late", detail: "Jobs, milestones and quotes past their date, most urgent first." },
  { term: "What is blocked", detail: "Tasks and production stages waiting on something, and who to ask." },
  { term: "What to do next", detail: "The next task on each job, one tap to start it." },
];

export function BrandPanel() {
  return (
    <div className="relative hidden overflow-hidden bg-canvas lg:block">
      <div className="relative z-10 flex h-full flex-col px-14 pt-14">
        <VerityLockup size={30} className="text-text" />

        <div className="my-auto max-w-[480px] pb-24">
          <p className="m-0 text-balance text-[44px] font-extralight leading-[1.08] tracking-[-0.045em] text-text">
            Know what needs you today.
          </p>
          <p className="m-0 mt-5 max-w-[44ch] text-[17px] leading-relaxed text-text-secondary">
            Jobs, production, stock and purchasing in one place, so the day starts from what matters.
          </p>

          <dl className="m-0 mt-12 flex flex-col divide-y divide-line border-y border-line">
            {POINTS.map((p) => (
              <div key={p.term} className="grid grid-cols-[9.5rem_1fr] gap-4 py-4">
                <dt className="text-[15px] font-semibold text-text">{p.term}</dt>
                <dd className="m-0 text-[15px] leading-[22px] text-text-secondary">{p.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
