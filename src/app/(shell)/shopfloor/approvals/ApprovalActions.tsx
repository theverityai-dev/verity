"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Button, ErrorState, Field, Input } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

const DECIDE = "verity.piecework.decide_approval";

/**
 * Approve or decline. A decline needs a reason. Above the manager's limit the Approve button is shown disabled with the
 * reason, so the rule is visible; the server refuses it as well, for anyone who is not the owner.
 */
export function ApprovalActions({ id, aboveLimit }: { id: string; aboveLimit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const [failure, setFailure] = useState<ActionFailure | null>(null);

  const decide = (decision: "approved" | "declined") => {
    setFailure(null);
    start(async () => {
      const result = await runCommand(DECIDE, { approvalId: id, decision, note: decision === "declined" ? note.trim() : undefined }, "/shopfloor/approvals");
      if (result.ok) router.refresh(); else setFailure(result);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {failure && <ErrorState title="That was not saved" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
      {declining ? (
        <>
          <Field label="Why are you declining?" htmlFor={`dn-${id}`} required>
            <Input id={`dn-${id}`} value={note} onChange={(e) => setNote(e.target.value)} minLength={3} maxLength={300} autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Button type="button" variant="ghost" onClick={() => setDeclining(false)}>Back</Button>
            <CommandButton commands={DECIDE} type="button" variant="danger" disabled={pending || note.trim().length < 3} onClick={() => decide("declined")}>{pending ? "Saving…" : "Decline"}</CommandButton>
          </div>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          <Button type="button" variant="secondary" className="min-h-12" disabled={pending} onClick={() => setDeclining(true)}>Decline</Button>
          <CommandButton commands={DECIDE} type="button" variant="primary" className="min-h-12" disabled={pending || aboveLimit} onClick={() => decide("approved")}>{pending ? "Saving…" : "Approve"}</CommandButton>
        </div>
      )}
      {aboveLimit && !declining && <p className="m-0 text-[12px] text-text-tertiary">Above the limit set for managers. Only the owner can approve this.</p>}
    </div>
  );
}
