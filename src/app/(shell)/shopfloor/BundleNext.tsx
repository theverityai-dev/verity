import Link from "next/link";
import { Icon } from "@/components/ui/icons";
import type { FloorOverview } from "@/server/capabilities/piecework";
import { shortDate } from "../lots/format";
import type { Labels } from "./labels";

type Action = { href: string; title: string; detail: string; primary: boolean };

/** The one-tap moves a bundle allows right now at this person's stages: take it back from whoever holds it, or give it out. */
export function bundleActions(bundleId: string, floor: FloorOverview, t: Labels): Action[] {
  const out: Action[] = [];
  for (const i of floor.issues.filter((x) => x.bundleId === bundleId)) {
    out.push({ href: `/shopfloor/take-back?issue=${i.issueId}`, title: `${t.scanTakeFrom} ${i.workerName}`, detail: `${i.stageLabel} · ${i.open} ${t.stillOut}${i.dueDate ? ` · ${t.due} ${shortDate(i.dueDate)}` : ""}`, primary: true });
  }
  for (const w of floor.waiting.filter((x) => x.bundleId === bundleId)) {
    if (w.toIssue > 0) out.push({ href: `/shopfloor/give-out?bundle=${bundleId}&stage=${w.stageId}`, title: `${t.scanGiveAt} ${w.stageLabel}`, detail: `${w.toIssue} ${t.toIssue}`, primary: true });
    if (w.reworkPool > 0) out.push({ href: `/shopfloor/give-out?bundle=${bundleId}&stage=${w.stageId}&rework=1`, title: `${t.scanReworkAt} ${w.stageLabel}`, detail: `${w.reworkPool} ${t.reworkWaiting}`, primary: false });
  }
  return out;
}

export function ActionLink({ a }: { a: Action }) {
  return (
    <Link
      href={a.href}
      className={`flex min-h-14 items-center gap-3 rounded-[14px] px-4 py-3 no-underline transition-[transform,background-color] duration-150 active:scale-[0.99] focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--color-accent-subtle)] ${a.primary ? "bg-accent text-accent-on" : "bg-[var(--color-control)] text-text"}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-semibold">{a.title}</span>
        {a.detail && <span className={`block text-[13px] ${a.primary ? "opacity-85" : "text-text-secondary"}`}>{a.detail}</span>}
      </span>
      <Icon name="expand" size={18} />
    </Link>
  );
}

/** The list, or the sentence that says there is nothing for this person to do with the bundle. */
export function BundleNext({ bundleId, floor, t }: { bundleId: string; floor: FloorOverview; t: Labels }) {
  const actions = bundleActions(bundleId, floor, t);
  if (actions.length === 0) return <p className="m-0 text-[15px] text-text-secondary">{t.scanNothingHere}</p>;
  return <ul className="m-0 flex list-none flex-col gap-2 p-0">{actions.map((a) => <li key={a.href} className="list-none"><ActionLink a={a} /></li>)}</ul>;
}
