"use client";

import { useState } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Field, Panel, Select, Textarea } from "@/components/ui/primitives";
import { CommandFailure, FormModal, formOptional, formText, useCommand } from "@/components/ui/CommandForm";

export type CheckInRow = { id: string; member: string; summary: string; blocker: string; review: string };
export type AssignmentRow = { id: string; member: string; kind: string; value: string };
export type TargetRow = { id: string; who: string; metric: string; target: string; period: string };
export type EscalationRow = { id: string; company: string; note: string; status: string };

const ROUTE = "/outreach/team";

/**
 * A team lead's operating lists: today's check-ins to review, territory
 * assignments, current targets, and open escalations. Each list carries the
 * action that closes the loop on it.
 */
export function TeamOpsPanels({
  checkIns,
  assignments,
  targets,
  escalations,
}: {
  checkIns: CheckInRow[];
  assignments: AssignmentRow[];
  targets: TargetRow[];
  escalations: EscalationRow[];
}) {
  const [reviewing, setReviewing] = useState<CheckInRow | null>(null);
  const review = useCommand(ROUTE);
  const row = useCommand(ROUTE);

  return (
    <div className="flex flex-col gap-6">
      <Panel title="Today's check-ins" flush>
        <DataTable
          caption="Today's check-ins"
          filterable={false}
          emptyTitle="No check-ins yet today"
          columns={[
            { key: "member", header: "Member", sortable: true, subKey: "summary" },
            { key: "blocker", header: "Blocker" },
            { key: "review", header: "Review" },
          ]}
          rows={checkIns}
          rowActions={(r) => {
            const checkIn = r as unknown as CheckInRow;
            return (
              <CommandButton commands="verity.outreach.review_check_in" size="sm" variant="secondary" onClick={() => setReviewing(checkIn)}>
                Review
              </CommandButton>
            );
          }}
        />
      </Panel>

      <Panel title="Territory assignments" flush>
        <DataTable
          caption="Territory assignments"
          filterable={false}
          emptyTitle="No territories assigned"
          columns={[
            { key: "member", header: "Member", sortable: true },
            { key: "kind", header: "Kind" },
            { key: "value", header: "Territory" },
          ]}
          rows={assignments}
          rowActions={(r) => (
            <CommandButton
              commands="verity.outreach.deactivate_assignment"
              size="sm"
              variant="ghost"
              disabled={row.pending}
              onClick={() => row.run("verity.outreach.deactivate_assignment", { assignmentId: (r as unknown as AssignmentRow).id })}
            >
              End
            </CommandButton>
          )}
        />
      </Panel>

      <Panel title="Current targets" flush>
        <DataTable
          caption="Current targets"
          filterable={false}
          emptyTitle="No targets set"
          columns={[
            { key: "who", header: "For" },
            { key: "metric", header: "Metric" },
            { key: "target", header: "Target", numeric: true },
            { key: "period", header: "Period" },
          ]}
          rows={targets}
        />
      </Panel>

      <Panel title="Escalations" flush>
        <DataTable
          caption="Escalations"
          filterable={false}
          emptyTitle="No escalations"
          columns={[
            { key: "company", header: "Lead", subKey: "note" },
            { key: "status", header: "Status" },
          ]}
          rows={escalations}
          rowActions={(r) => {
            const escalation = r as unknown as EscalationRow;
            if (escalation.status !== "Open") return null;
            return (
              <CommandButton
                commands="verity.outreach.set_escalation_in_review"
                size="sm"
                variant="secondary"
                disabled={row.pending}
                onClick={() => row.run("verity.outreach.set_escalation_in_review", { escalationId: escalation.id })}
              >
                Mark in review
              </CommandButton>
            );
          }}
        />
      </Panel>
      <CommandFailure failure={row.failure} title="That change was refused" />

      <FormModal
        title="Review check-in"
        description={reviewing ? `${reviewing.member}: ${reviewing.summary}` : ""}
        open={reviewing !== null}
        onClose={() => {
          setReviewing(null);
          review.clear();
        }}
        submitLabel="Save review"
        pending={review.pending}
        failure={review.failure}
        failureTitle="Could not save the review"
        onSubmit={(form) => {
          if (!reviewing) return;
          review.run(
            "verity.outreach.review_check_in",
            { checkInId: reviewing.id, reviewStatus: formText(form, "status"), leaderFeedback: formOptional(form, "feedback") },
            () => setReviewing(null),
          );
        }}
      >
        <Field label="Outcome" htmlFor="rv-status" required>
          <Select id="rv-status" name="status" required defaultValue="Reviewed">
            <option value="Reviewed">Reviewed</option>
            <option value="NeedsClarification">Needs clarification</option>
          </Select>
        </Field>
        <Field label="Feedback" htmlFor="rv-feedback">
          <Textarea id="rv-feedback" name="feedback" rows={3} autoFocus />
        </Field>
      </FormModal>
    </div>
  );
}
