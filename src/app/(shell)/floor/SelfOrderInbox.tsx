"use client";

import { usePathname } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { CommandFailure, useCommand } from "@/components/ui/CommandForm";
import { Input, Panel } from "@/components/ui/primitives";
import type { SelfOrderInbox as Inbox } from "@/server/capabilities/dinein";

function waited(at: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 60_000));
  return minutes === 0 ? "just now" : `${minutes} min ago`;
}

/**
 * What guests are waiting on (ADR-042): orders they proposed from their phone, and calls for a
 * waiter or the bill. A proposal is nothing until someone here accepts it; accepting adds the lines
 * to the table's order as the person who tapped. Pass `tableId` to show only one table's.
 */
export function SelfOrderInbox({ inbox, tableId }: { inbox: Inbox; tableId?: string | null }) {
  const pathname = usePathname();
  const decide = useCommand(pathname);
  const answer = useCommand(pathname);
  const submissions = tableId ? inbox.submissions.filter((s) => s.tableId === tableId) : inbox.submissions;
  const requests = tableId ? inbox.requests.filter((r) => r.tableId === tableId) : inbox.requests;
  if (submissions.length === 0 && requests.length === 0) return null;

  return (
    <div className="mb-6">
      <Panel title="Guests are waiting" action={<span className="text-[13px] text-text-secondary">{submissions.length + requests.length} open</span>}>
        <CommandFailure failure={decide.failure} title="Could not update the guest order" />
        <CommandFailure failure={answer.failure} title="Could not update the request" />
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {requests.map((request) => (
            <li key={request.id} className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[15px] text-text">
                <strong className="font-semibold">{request.tableLabel ? `Table ${request.tableLabel}` : "A guest"}</strong>{" "}
                {request.kind === "bill" ? "asked for the bill" : "called a waiter"}
                <span className="ml-2 text-[13px] text-text-secondary">{waited(request.at)}</span>
              </span>
              <span className="flex gap-2">
                {request.status === "open" && (
                  <CommandButton
                    commands={"verity.dinein.resolve_service_request"}
                    size="sm"
                    disabled={answer.pending}
                    onClick={() => answer.run("verity.dinein.resolve_service_request", { requestId: request.id, status: "acknowledged" })}
                  >
                    On my way
                  </CommandButton>
                )}
                <CommandButton
                  commands={"verity.dinein.resolve_service_request"}
                  size="sm"
                  variant="primary"
                  disabled={answer.pending}
                  onClick={() => answer.run("verity.dinein.resolve_service_request", { requestId: request.id, status: "resolved" })}
                >
                  Done
                </CommandButton>
              </span>
            </li>
          ))}

          {submissions.map((submission) => (
            <li key={submission.id} className="flex flex-col gap-2 border-t border-line pt-4 first:border-0 first:pt-0">
              <span className="text-[15px] text-text">
                <strong className="font-semibold">
                  {submission.kind === "pickup" ? `Pickup${submission.customerName ? ` · ${submission.customerName}` : ""}` : `Table ${submission.tableLabel ?? ""}`}
                </strong>
                <span className="ml-2 text-[13px] text-text-secondary">
                  {waited(submission.at)}
                  {submission.customerPhone ? ` · ${submission.customerPhone}` : ""}
                </span>
              </span>
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[15px] text-text-secondary">
                {submission.lines.map((line, index) => (
                  <li key={index}>
                    {line.qty} × {line.name}
                    {line.detail ? ` (${line.detail})` : ""}
                    {line.note ? ` — “${line.note}”` : ""}
                  </li>
                ))}
              </ul>
              <form
                className="flex flex-wrap items-center gap-2"
                action={(formData) =>
                  decide.run("verity.dinein.decide_self_order_submission", {
                    submissionId: submission.id,
                    decision: String(formData.get("decision")),
                    reason: String(formData.get("reason") ?? "") || undefined,
                  })
                }
              >
                <Input name="reason" aria-label="Reason, if you turn it down" placeholder="Reason, if you turn it down" maxLength={200} className="max-w-[260px]" />
                <CommandButton commands={"verity.dinein.decide_self_order_submission"} type="submit" name="decision" value="reject" size="sm" disabled={decide.pending}>
                  Turn down
                </CommandButton>
                <CommandButton commands={"verity.dinein.decide_self_order_submission"} type="submit" name="decision" value="accept" size="sm" variant="primary" disabled={decide.pending}>
                  Add to the order
                </CommandButton>
              </form>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
