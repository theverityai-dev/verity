import type { ReactNode } from "react";
import type { IconName } from "@/components/ui/icons";
import { StatTile } from "@/components/ui/primitives";
import { BarStrip } from "@/components/ui/charts";

/**
 * The dashboard stat card, kept for its callers as a thin wrapper over `StatTile` (Task 127 asked for the two to
 * be one component). Same disc, same label, same `figure` numeral, same card; only the props differ: a real
 * percentage `delta` and a real per-week `weeks` breakdown drawn by `BarStrip`. "Real" is load-bearing: both are
 * numbers the caller actually queried, never decoration.
 */
export function StatCard({
  icon,
  label,
  value,
  hint,
  delta,
  weeks,
  href,
}: {
  icon: IconName;
  label: string;
  value: ReactNode;
  /** Small supporting line under the value — "2 due today", "Nothing held". */
  hint?: ReactNode;
  /** A real percentage change vs. a real prior period. Omit rather than fake one. */
  delta?: { percent: number; direction: "up" | "down" };
  /** A real per-week (or per-day) breakdown for the inline `BarStrip`. */
  weeks?: number[];
  href?: string;
}) {
  return (
    <StatTile
      icon={icon}
      label={label}
      value={typeof value === "number" || typeof value === "string" ? value : String(value)}
      hint={hint}
      href={href}
      delta={delta ? { label: `${delta.direction === "up" ? "▲" : "▼"} ${delta.percent.toFixed(1)}%`, direction: delta.direction } : undefined}
      viz={weeks && weeks.length > 0 ? <div className="w-16"><BarStrip values={weeks} label={label} height={28} /></div> : undefined}
    />
  );
}
