import Link from "next/link";
import Image from "next/image";
import type { Labels } from "./labels";

export type FloorTab = "floor" | "take-back" | "give-out" | "register" | "day-close";

/**
 * The strip every floor screen shares: five places a supervisor goes, as large pills that scroll sideways on a phone only
 * for the tab row itself (never for cards). The active one is the tinted pill, as in the iPadOS sidebar.
 */
export function FloorTabs({ active, t }: { active: FloorTab; t: Labels }) {
  const tabs: Array<[FloorTab, string, string]> = [
    ["floor", "/shopfloor", t.myFloor],
    ["take-back", "/shopfloor/take-back", t.takeBack],
    ["give-out", "/shopfloor/give-out", t.giveOut],
    ["register", "/shopfloor/register", t.register],
    ["day-close", "/shopfloor/day-close", t.dayClose],
  ];
  return (
    <nav aria-label="Floor" className="-mx-1 mb-6 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
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

/** A lot or bundle picture: the lot's cover photograph, or a typed tile carrying the lot number when it has none. */
export function Cover({ src, label, size = 56 }: { src: string | null; label: string; size?: number }) {
  const px = { width: size, height: size };
  if (src) {
    return <Image src={src} alt="" width={size} height={size} unoptimized className="shrink-0 rounded-[12px] object-cover" style={px} />;
  }
  return (
    <span aria-hidden="true" className="grid shrink-0 place-items-center rounded-[12px] bg-[var(--color-control)] text-[11px] font-medium tracking-[0.04em] text-text-secondary" style={px}>
      {label.replace(/^LOT-0*/, "L")}
    </span>
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
