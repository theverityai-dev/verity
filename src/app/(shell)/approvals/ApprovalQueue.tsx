"use client";

import { CommandButton } from "@/components/ui/CommandAccess";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EmptyState, ErrorState, Field, Input, StateBadge } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

type Request = {
  id: string;
  subject: string;
  subjectId: string;
  createdAt: string;
  currentStepSequence: number | null;
  steps: Array<{ sequence: number; role: string; decision: string; comment: string | null }>;
};

/**
 * The actionable part of the queue.
 *
 * Approve and reject are the same command with a different argument, which is
 * how the platform models it — so the interface does not invent two operations
 * where the domain has one decision.
 */
export function ApprovalQueue({
  requests,
  canDecide,
}: {
  requests: Request[];
  canDecide: boolean;
}) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (requests.length === 0) {
    return (
      <EmptyState
        title="Nothing awaiting your decision"
        description="Chains appear here when their current step names a role you hold."
      />
    );
  }

  function submit(requestId: string, approve: boolean, comment: string) {
    setFailure(null);
    setBusy(requestId);
    startTransition(async () => {
      const result = await runCommand(
        "verity.approval.decide",
        { requestId, approve, comment: comment || undefined },
        "/approvals",
      );
      setBusy(null);
      if (result.ok) router.refresh();
      else setFailure(result);
    });
  }

  return (
    <>
      {failure && (
        <div className="border-b border-line p-4">
          <ErrorState
            title="Decision not recorded"
            message={failure.message}
            issues={failure.issues}
            retryable={failure.retryable}
          />
        </div>
      )}

      {/*
        One decision per row, not a card per record. The chain reads left to
        right as a sequence of steps with the current one marked, because "which
        step am I on and who comes after me" is the question an approver actually
        has — and a bulleted list of roles does not answer it at a glance.
      */}
      <ul className="m-0 list-none divide-y divide-line p-0">
        {requests.map((request) => (
          <li key={request.id} className="px-5 py-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="m-0 text-[15px] text-text">{request.subject}</p>
                <p className="m-0 mt-1 text-[12px] text-text-tertiary">
                  Raised {request.createdAt.replace("T", " ").slice(0, 16)} · step{" "}
                  {(request.currentStepSequence ?? 0) + 1} of {request.steps.length}
                </p>
              </div>
              <StateBadge category="Pending" label="Awaiting you" />
            </div>

            <ol className="m-0 mt-4 flex list-none flex-wrap items-center gap-x-1.5 gap-y-2 p-0">
              {request.steps.map((step, i) => {
                const current = step.sequence === request.currentStepSequence;
                const settled = step.decision !== "Pending";
                return (
                  <li key={step.sequence} className="flex items-center gap-1.5">
                    {i > 0 && (
                      <span aria-hidden="true" className="text-text-tertiary">
                        ·
                      </span>
                    )}
                    <span
                      className={
                        "inline-flex h-[22px] items-center gap-1.5 rounded-sm px-2 text-[12px] " +
                        (current
                          ? "bg-accent-subtle font-medium text-accent-ink"
                          : settled
                            ? "text-text-tertiary"
                            : "text-text-secondary")
                      }
                    >
                      <span aria-hidden="true" className="text-[11px] leading-none">
                        {settled ? "●" : current ? "◉" : "○"}
                      </span>
                      {step.role}
                      {settled && <span className="text-text-tertiary">{step.decision}</span>}
                    </span>
                  </li>
                );
              })}
            </ol>

            {canDecide ? (
              <form
                className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
                action={(formData) =>
                  submit(
                    request.id,
                    formData.get("intent") === "approve",
                    String(formData.get("comment") ?? ""),
                  )
                }
              >
                <div className="min-w-0 flex-1">
                  <Field
                    label="Comment"
                    htmlFor={`comment-${request.id}`}
                    hint="Recorded against the step."
                  >
                    <Input id={`comment-${request.id}`} name="comment" />
                  </Field>
                </div>
                {/* Approve leads; reject is a quieter secondary. Both are
                    destructive-ish and irreversible, but only one is the
                    expected path, and giving them equal visual weight makes the
                    reader stop and parse two identical buttons. */}
                <div className="flex shrink-0 gap-2">
                  <CommandButton commands={"verity.approval.decide"}
                    type="submit"
                    name="intent"
                    value="approve"
                    variant="primary"
                    disabled={pending && busy === request.id}
                  >
                    {pending && busy === request.id ? "Recording…" : "Approve"}
                  </CommandButton>
                  <CommandButton commands={"verity.approval.decide"}
                    type="submit"
                    name="intent"
                    value="reject"
                    variant="secondary"
                    disabled={pending && busy === request.id}
                  >
                    Reject
                  </CommandButton>
                </div>
              </form>
            ) : (
              <p className="m-0 mt-3 text-[12px] text-text-tertiary">
                Your role can see this chain but not decide it.
              </p>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
