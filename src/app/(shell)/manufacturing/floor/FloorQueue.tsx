"use client";

import Link from "next/link";
import { DataTable } from "@/components/ui/DataTable";
import { Icon } from "@/components/ui/icons";
import { IconTile } from "@/components/ui/IconTile";
import { StateBadge } from "@/components/ui/primitives";
import { OperationActions, type ChecklistProgress } from "../OperationActions";

export type FloorRow = {
  id: string;
  orderId: string;
  order: string;
  item: string;
  qty: number;
  stage: string;
  /** Stage kind for the icon tile (`domains.ts`). */
  kind: string;
  /** "Stage 5 of 6". */
  position: string;
  /** Display label; `rawState` is what the actions key off. */
  state: string;
  rawState: string;
  category: string;
  actionable: boolean;
  sendBackTo: Array<{ stageKey: string; label: string }>;
  checklist: ChecklistProgress;
};

/**
 * The operator's work list (ADR-046 list + pane). Clicking a row selects it into the detail pane
 * through the URL (`?op=`), so the page stays server-rendered and a selection can be shared. The row
 * keeps one quick action (Start, when the stage may start); everything else is in the pane's action
 * bar. Every action still goes through the command pipeline.
 */
export function FloorQueue({ rows, selectedId, baseQuery }: { rows: FloorRow[]; selectedId?: string; baseQuery: string }) {
  const hrefFor = (id: string) => `/manufacturing/floor?${baseQuery ? `${baseQuery}&` : ""}op=${id}`;
  const cards = (
    <ul className="m-0 flex list-none flex-col gap-3 p-0 md:hidden" aria-label="Open work on the floor">
      {rows.map((row) => {
        const waiting = row.rawState === "pending" && !row.actionable;
        return (
          <li key={row.id} className={`glass-card flex flex-col gap-3 p-4 ${row.id === selectedId ? "ring-2 ring-[var(--color-accent-line)]" : ""}`}>
            <Link href={hrefFor(row.id)} scroll={false} className="flex items-start gap-3 text-text no-underline">
              <IconTile kind={row.kind} size="lg" />
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-semibold leading-[22px]">{row.stage}</span>
                <span className="block text-[13px] text-text-secondary">{row.position} · {row.qty} × {row.item}</span>
                <span className="mt-0.5 block truncate text-[13px] text-text-tertiary">{row.order}</span>
              </span>
              <Icon name="chevronRight" size={20} className="mt-1 shrink-0 text-text-tertiary" />
            </Link>
            <div className="flex items-center justify-between gap-3">
              <StateBadge category={row.category} label={waiting ? "waiting" : row.state} />
              {row.checklist.total > 0 && (
                <span className="text-[13px] text-text-secondary">{row.checklist.passed} of {row.checklist.total} checks</span>
              )}
            </div>
            {row.rawState === "pending" && row.actionable ? (
              <OperationActions operationId={row.id} state="pending" actionable sendBackTo={[]} checklist={row.checklist} revalidate="/manufacturing/floor" large />
            ) : waiting ? (
              <p className="m-0 text-[13px] text-text-secondary">Waiting for the earlier stage to finish.</p>
            ) : (
              <Link href={hrefFor(row.id)} scroll={false} className="grid min-h-12 place-items-center rounded-[12px] bg-[var(--color-control)] text-[17px] font-semibold text-accent-ink no-underline">Open stage</Link>
            )}
          </li>
        );
      })}
      {rows.length === 0 && <li className="p-6 text-center text-[15px] text-text-secondary">Nothing to do right now.</li>}
    </ul>
  );
  return (
    <>
    {cards}
    <div className="max-md:hidden">
    <DataTable
      caption="Open work on the floor"
      rows={rows}
      activeKey={selectedId}
      rowHref={(row) => hrefFor(String(row.id))}
      columns={[
        { key: "order", header: "Order", variant: "link", href: "/manufacturing/{orderId}", subKey: "item", sortable: true },
        { key: "stage", header: "Stage", kindKey: "kind", subKey: "position", sortable: true },
        { key: "qty", header: "Qty", numeric: true },
        { key: "state", header: "State", variant: "state", categoryKey: "category" },
      ]}
      emptyTitle="Nothing to do right now"
      emptyDescription="Open stages of running orders appear here. Start an order and plan its stages to see work."
      rowActions={(row) => (
        <span className="inline-flex items-center gap-2">
          {row.rawState === "pending" && row.actionable ? (
            <OperationActions
              operationId={String(row.id)}
              state="pending"
              actionable
              sendBackTo={[]}
              checklist={row.checklist as ChecklistProgress}
              revalidate="/manufacturing/floor"
            />
          ) : null}
          <Link
            href={hrefFor(String(row.id))}
            scroll={false}
            aria-label={`Open ${String(row.order)}, ${String(row.stage)}`}
            className="grid size-9 place-items-center rounded-full text-text-tertiary hover:bg-[var(--color-control)] hover:text-text max-sm:size-11"
          >
            <Icon name="chevronRight" size={18} />
          </Link>
        </span>
      )}
    />
    </div>
    </>
  );
}
