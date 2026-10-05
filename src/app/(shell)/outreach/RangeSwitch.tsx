import Link from "next/link";
import { RANGES, RANGE_LABEL, type RangeKey } from "./range";

/**
 * Today | This week | This month | All time. A row of links, not a client
 * component — the whole page re-reads server-side for the chosen window,
 * which is the honest shape for numbers that must match what the server
 * would report if asked directly.
 */
export function RangeSwitch({
  basePath,
  active,
  extraParams,
}: {
  basePath: string;
  active: RangeKey;
  extraParams?: Record<string, string | undefined>;
}) {
  const extra = Object.entries(extraParams ?? {})
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([k, v]) => `&${k}=${encodeURIComponent(v)}`)
    .join("");
  return (
    <nav aria-label="Time range" className="flex items-center gap-1 rounded-[12px] bg-surface p-0.5">
      {RANGES.map((key) => {
        const on = key === active;
        return (
          <Link
            key={key}
            href={`${basePath}?range=${key}${extra}`}
            aria-current={on ? "page" : undefined}
            className={
              "rounded-md px-3 py-1 text-[13px] no-underline transition-colors " +
              (on
                ? "bg-accent-subtle font-medium text-accent-ink"
                : "text-text-secondary hover:bg-surface-sunken hover:text-text")
            }
          >
            {RANGE_LABEL[key]}
          </Link>
        );
      })}
    </nav>
  );
}
