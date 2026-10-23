import { VerityLockup } from "@/components/brand/VerityMark";
import { IconDisc } from "@/components/ui/IconTile";
import type { IconName } from "@/components/ui/icons";
import type { StateTone } from "@/components/ui/business/domains";

/**
 * The sign-in page's left panel: what the product is for, in plain words.
 *
 * It used to carry a tilted dashboard render with invented figures (uptime, task
 * completion) and a slogan line. The real product is plainer than that render,
 * so the first screen promised something the second did not deliver. This says
 * what the person will actually find after signing in, and nothing else.
 *
 * Each point wears the state colour of the thing it names (late and blocked are
 * attention states, "next" is the active one), the same disc the Summary tiles
 * use after sign-in. The panel has no fill of its own: the blue light field
 * shows through, and the three points sit in one glass cell.
 */

const POINTS: Array<{ term: string; detail: string; icon: IconName; state: StateTone }> = [
  { term: "What is late", detail: "Jobs, milestones and quotes past their date, most urgent first.", icon: "flag", state: "blocked" },
  { term: "What is blocked", detail: "Tasks and production stages waiting on something, and who to ask.", icon: "clock", state: "pending" },
  { term: "What to do next", detail: "The next task on each job, one tap to start it.", icon: "chevronRight", state: "active" },
];

export function BrandPanel() {
  return (
    <div className="relative hidden lg:block">
      <div className="relative z-10 flex h-full flex-col px-14 pt-14">
        <VerityLockup size={30} className="text-text" />

        <div className="my-auto max-w-[520px] pb-20">
          <p className="micro m-0">Today</p>
          <p className="m-0 mt-3 text-balance text-[44px] font-extralight leading-[1.08] tracking-[-0.045em] text-text">
            Know what needs you today.
          </p>
          <p className="m-0 mt-5 max-w-[44ch] text-[17px] leading-relaxed text-text-secondary">
            Jobs, production, stock and purchasing in one place, so the day starts from what matters.
          </p>

          <dl className="glass-card m-0 mt-10 flex list-none flex-col divide-y divide-line p-2">
            {POINTS.map((p) => (
              <div key={p.term} className="flex items-start gap-4 px-4 py-4">
                <IconDisc icon={p.icon} state={p.state} size="md" />
                <div className="min-w-0">
                  <dt className="text-[15px] font-medium text-text">{p.term}</dt>
                  <dd className="m-0 mt-0.5 text-[14px] leading-[21px] text-text-secondary">{p.detail}</dd>
                </div>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
