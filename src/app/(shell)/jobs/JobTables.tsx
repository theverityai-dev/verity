"use client";

import { DataTable, type Column } from "@/components/ui/DataTable";
import { LostReasonToggle, ReachMilestoneButton, TaskMoves, VoidEntryButton } from "./JobForms";

/**
 * `DataTable` takes row actions as a function, which only a client component may pass. The
 * job page is a server component, so the four tables that carry row actions live here and
 * receive plain data. Which action a row gets is decided by `kind` and the row's own fields.
 */
export function ActionTable({
  kind,
  working,
  caption,
  rows,
  columns,
  emptyTitle,
}: {
  kind: "task" | "milestone" | "time" | "cost" | "reason" | "invoice" | "receipt";
  /** False once the job is finished: no row action is offered, and the server would refuse it anyway. */
  working: boolean;
  caption: string;
  rows: Array<Record<string, unknown>>;
  columns: Column[];
  emptyTitle: string;
}) {
  return (
    <DataTable
      caption={caption}
      rows={rows}
      columns={columns}
      emptyTitle={emptyTitle}
      rowActions={(row) => {
        if (!working) return null;
        const id = String(row.id);
        if (kind === "task") {
          return (
            <TaskMoves
              taskId={id}
              state={String(row.rawState)}
              task={{ id, title: String(row.rawTitle), assignee: String(row.rawAssignee ?? ""), due: String(row.rawDue ?? ""), hours: String(row.rawHours ?? ""), weight: Number(row.rawWeight ?? 1) }}
            />
          );
        }
        if (kind === "milestone") {
          return row.reached === "no" ? (
            <ReachMilestoneButton milestoneId={id} milestone={{ id, name: String(row.rawName), due: String(row.rawDue ?? ""), visible: row.rawVisible === "yes" }} />
          ) : null;
        }
        if (kind === "reason") return <LostReasonToggle reasonId={id} active={row.active === "yes"} />;
        if (kind === "invoice") return row.void === "no" ? <VoidEntryButton kind="invoice" entryId={id} /> : null;
        if (kind === "receipt") return row.void === "no" ? <VoidEntryButton kind="receipt" entryId={id} /> : null;
        if (kind === "time") return row.void === "no" ? <VoidEntryButton kind="time" entryId={id} /> : null;
        return row.void === "no" ? <VoidEntryButton kind="cost" entryId={id} /> : null;
      }}
    />
  );
}
