import type { ReactNode } from "react";
import { Icon } from "./icons";
import { ProgressRing } from "./viz";

/**
 * Checklist rows (ADR-046 §8; the shop-floor mockup's "Quality checks").
 *
 * Each row: a selection circle showing the verdict, the check, what it needs ("Photo required"), and
 * where its evidence stands. Pass is a green filled circle with a tick, fail a red one with a cross,
 * not yet recorded an empty circle; the word is always written as well. `expanded` lets the caller
 * render a recording form under one row. Presentational only: recording goes through the command
 * path in the caller.
 */

export type ChecklistVerdict = "pass" | "fail" | "none";

export type ChecklistRow = {
  key: string;
  label: string;
  /** "Photo required · Remarks required". */
  requirement?: string;
  verdict: ChecklistVerdict;
  /** Extra line under the label: the latest remark. */
  note?: string;
  /** Always-visible content under the label: a measured reading and its range, a condition chip. */
  detail?: ReactNode;
  /** Controls at the right of the row (Pass / Fail). */
  actions?: ReactNode;
  /** Rendered under the row when it is open. */
  expanded?: ReactNode;
};

const VERDICT: Record<ChecklistVerdict, { word: string; style: React.CSSProperties; icon?: "check" | "close" }> = {
  pass: { word: "Passed", style: { backgroundColor: "var(--color-state-completed)", color: "#fff" }, icon: "check" },
  fail: { word: "Failed", style: { backgroundColor: "var(--color-state-blocked)", color: "#fff" }, icon: "close" },
  none: { word: "Not recorded", style: { boxShadow: "inset 0 0 0 1.5px var(--color-line-strong)" } },
};

export function ChecklistHeader({ title, passed, total }: { title: string; passed: number; total: number }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h3 className="m-0 text-[17px] font-semibold text-text">{title}</h3>
      <span className="flex items-center gap-2 text-[13px] text-text-secondary">
        {passed} of {total} passed
        <ProgressRing value={passed} total={total} label={title} size={28} showValue={false} />
      </span>
    </div>
  );
}

export function ChecklistRows({ rows }: { rows: readonly ChecklistRow[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {rows.map((row) => {
        const v = VERDICT[row.verdict];
        return (
          <li key={row.key} className="rounded-[12px] bg-[var(--color-surface-sunken)] px-3 py-3">
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="mt-0.5 grid size-[22px] shrink-0 place-items-center rounded-full" style={v.style}>
                {v.icon && <Icon name={v.icon} size={14} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="m-0 text-[15px] leading-[20px] text-text">{row.label}</p>
                {row.requirement && <p className="m-0 mt-0.5 text-[13px] text-text-tertiary">{row.requirement}</p>}
                {row.detail && <div className="mt-1.5">{row.detail}</div>}
                {row.note && <p className="m-0 mt-1 text-[13px] text-text-secondary">{row.note}</p>}
              </div>
              <span
                className="shrink-0 text-[13px] font-medium"
                style={{
                  color:
                    row.verdict === "pass"
                      ? "var(--color-state-completed-ink)"
                      : row.verdict === "fail"
                        ? "var(--color-state-blocked-ink)"
                        : "var(--color-text-tertiary)",
                }}
              >
                {v.word}
              </span>
            </div>
            {row.actions && <div className="mt-2 flex justify-end gap-2 pl-[34px]">{row.actions}</div>}
            {row.expanded && <div className="mt-3 pl-[34px]">{row.expanded}</div>}
          </li>
        );
      })}
    </ul>
  );
}
