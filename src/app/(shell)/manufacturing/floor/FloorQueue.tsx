"use client";

import { DataTable } from "@/components/ui/DataTable";
import { OperationActions, type ChecklistProgress } from "../OperationActions";

export type FloorRow = {
  id: string;
  orderId: string;
  order: string;
  item: string;
  qty: number;
  stage: string;
  /** Display label; `rawState` is what the actions key off. */
  state: string;
  rawState: string;
  category: string;
  actionable: boolean;
  sendBackTo: Array<{ stageKey: string; label: string }>;
  checklist: ChecklistProgress;
};

/**
 * The operator's work list. The table is a client component because row actions
 * are a render-prop (a function cannot cross from a server component); every
 * action still goes through the command pipeline.
 */
export function FloorQueue({ rows }: { rows: FloorRow[] }) {
  return (
    <DataTable
      caption="Open work on the floor"
      rows={rows}
      columns={[
        { key: "order", header: "Order", variant: "link", href: "/manufacturing/{orderId}", subKey: "item", sortable: true },
        { key: "stage", header: "Stage", sortable: true },
        { key: "qty", header: "Qty", numeric: true },
        { key: "state", header: "State", variant: "state", categoryKey: "category" },
      ]}
      emptyTitle="Nothing to do right now"
      emptyDescription="Open stages of running orders appear here. Start an order and plan its stages to see work."
      rowActions={(row) => (
        <OperationActions
          operationId={String(row.id)}
          state={String(row.rawState)}
          actionable={Boolean(row.actionable)}
          sendBackTo={row.sendBackTo as FloorRow["sendBackTo"]}
          checklist={row.checklist as ChecklistProgress}
          revalidate="/manufacturing/floor"
        />
      )}
    />
  );
}
