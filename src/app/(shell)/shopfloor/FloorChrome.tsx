import Link from "next/link";
import { Cover } from "@/components/ui/Cover";
import type { Labels } from "./labels";

export { Cover };

export type FloorTab = "scan" | "floor" | "take-back" | "give-out" | "cases" | "register" | "day-close";

/**
 * The strip every floor screen shares: the places a supervisor goes, as large pills that wrap onto a second row on a
 * phone, so none is hidden off screen. The active one is the tinted pill, as in the iPadOS sidebar.
 */
export function FloorTabs({ active, t }: { active: FloorTab; t: Labels }) {
  const tabs: Array<[FloorTab, string, string]> = [
    ["scan", "/shopfloor/scan", t.scan],
    ["floor", "/shopfloor", t.myFloor],
    ["take-back", "/shopfloor/take-back", t.takeBack],
    ["give-out", "/shopfloor/give-out", t.giveOut],
    ["cases", "/shopfloor/cases", t.cases],
    ["register", "/shopfloor/register", t.register],
    ["day-close", "/shopfloor/day-close", t.dayClose],
  ];
  return (
    <nav aria-label="Floor" className="mb-6 flex flex-wrap gap-1.5">
      {tabs.map(([key, href, label]) => (
        <Link
          key={key}
          href={href}
          aria-current={active === key ? "page" : undefined}
          className={`inline-flex min-h-11 shrink-0 items-center rounded-[12px] px-4 text-[15px] font-medium no-underline transition-[background-color,transform] duration-150 active:scale-[0.98] ${active === key ? "bg-accent text-accent-on" : "bg-[var(--color-control)] text-text-secondary hover:text-text"}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** A figure with its micro label, for the stat lines inside cards. */
export function Figure({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div>
      <dt className="micro flex items-center gap-2">
        {tone && <span aria-hidden="true" className="size-[7px] rounded-full" style={{ backgroundColor: tone }} />}
        {label}
      </dt>
      <dd className="figure m-0 mt-1 text-[30px] text-text">{value}</dd>
    </div>
  );
}

export const TONE = {
  done: "var(--color-state-completed)",
  out: "var(--color-state-active)",
  rework: "var(--color-state-pending)",
  rejected: "var(--color-state-blocked)",
  short: "var(--color-state-draft)",
} as const;
