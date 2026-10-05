import type { ReactNode } from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icons";
import { Surface } from "@/components/ui/primitives";

type SignalTone = "neutral" | "success" | "warning" | "danger";

const toneClass: Record<SignalTone, string> = {
  neutral: "text-text",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

/**
 * The dominant signal on an executive/owner dashboard.
 *
 * Authority: Task 116 §5.1/§7.1. A dashboard gets one primary visual anchor,
 * not a wall of equally loud metric cards. All values and the optional visual
 * are caller-owned real data; this component never invents a comparison.
 */
export function HeroSignal({
  icon,
  label,
  value,
  context,
  delta,
  visual,
  action,
  className,
}: {
  icon: IconName;
  label: string;
  value: ReactNode;
  context?: ReactNode;
  delta?: { label: string; direction: "up" | "down" | "flat" };
  visual?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Surface className={`relative isolate overflow-hidden p-6 sm:p-7 ${className ?? ""}`}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-28 -z-10 size-72 rounded-full border border-accent-line opacity-20"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-8 -top-16 -z-10 size-44 rounded-full border border-accent-line opacity-15"
      />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-subtle text-accent-ink">
            <Icon name={icon} size={19} />
          </span>
          <p className="m-0 text-[13px] text-text-secondary">{label}</p>
        </div>
        {action}
      </div>

      <div className="mt-7 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div>
          <p className="tabular m-0 text-[clamp(2rem,4vw,3.25rem)] font-bold leading-none tracking-[-0.035em] text-text">
            {value}
          </p>
          {context ? <p className="m-0 mt-2 text-[13px] text-text-tertiary">{context}</p> : null}
        </div>
        {delta ? (
          <p
            className={
              "tabular m-0 flex items-center gap-1 text-[12.5px] font-medium " +
              (delta.direction === "up"
                ? "text-success"
                : delta.direction === "down"
                  ? "text-danger"
                  : "text-text-tertiary")
            }
          >
            {delta.direction !== "flat" ? (
              <Icon
                name="chevronDown"
                size={13}
                className={delta.direction === "up" ? "rotate-180" : ""}
              />
            ) : null}
            {delta.label}
          </p>
        ) : null}
      </div>

      {visual ? <div className="mt-7 border-t border-line pt-5">{visual}</div> : null}
    </Surface>
  );
}

export type SignalRailItem = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: IconName;
  href?: string;
  tone?: SignalTone;
};

/**
 * Secondary dashboard signals grouped into one calm surface.
 *
 * The grouping is deliberate: these figures qualify the hero but must not
 * compete with it as separate full-size cards. Links preserve direct
 * metric-to-work drill-through.
 */
export function SignalRail({
  title = "Operating state",
  items,
  className,
}: {
  title?: string;
  items: SignalRailItem[];
  className?: string;
}) {
  return (
    <Surface className={`overflow-hidden ${className ?? ""}`}>
      <div className="border-b border-line px-5 py-4 sm:px-6">
        <h2 className="m-0 text-[14px] font-medium text-text">{title}</h2>
      </div>
      <div className="divide-y divide-line">
        {items.map((item) => {
          const body = (
            <>
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-sunken text-text-secondary transition-colors group-hover:bg-accent-subtle group-hover:text-accent-ink">
                <Icon name={item.icon} size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] text-text-secondary">{item.label}</span>
                {item.hint ? (
                  <span className="mt-0.5 block truncate text-[11.5px] text-text-tertiary">
                    {item.hint}
                  </span>
                ) : null}
              </span>
              <span className={`tabular text-[22px] font-bold leading-none ${toneClass[item.tone ?? "neutral"]}`}>
                {item.value}
              </span>
              {item.href ? <Icon name="chevronRight" size={14} className="text-text-tertiary" /> : null}
            </>
          );

          return item.href ? (
            <Link
              key={item.label}
              href={item.href}
              className="group flex min-h-20 items-center gap-3 px-5 py-4 no-underline transition-colors hover:bg-surface-sunken sm:px-6"
            >
              {body}
            </Link>
          ) : (
            <div key={item.label} className="group flex min-h-20 items-center gap-3 px-5 py-4 sm:px-6">
              {body}
            </div>
          );
        })}
      </div>
    </Surface>
  );
}
