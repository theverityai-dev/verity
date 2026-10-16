"use client";

import Link from "next/link";
import { DataTable } from "@/components/ui/DataTable";
import { Icon } from "@/components/ui/icons";
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
  return (
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
  );
}
