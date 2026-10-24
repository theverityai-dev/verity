"use client";

import { useState } from "react";
import { CommandButton } from "@/components/ui/CommandAccess";
import { CommandFailure, FormModal, useCommand } from "@/components/ui/CommandForm";
import { Button, Field, Input } from "@/components/ui/primitives";

const DECIDE = "verity.piecework.decide_approval";

/**
 * Approve or decline. A decline asks for its reason in a sheet, like every other form. Above the manager's limit the Approve button is
 * shown disabled with the reason, so the rule is visible; the server refuses it as well, for anyone who is not the owner.
 */
export function ApprovalActions({ id, aboveLimit }: { id: string; aboveLimit: boolean }) {
  const approve = useCommand("/shopfloor/approvals");
  const decline = useCommand("/shopfloor/approvals");
  const [declining, setDeclining] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <CommandFailure failure={approve.failure} title="That was not saved" />
      <div className="grid grid-cols-2 gap-2.5">
        <Button type="button" variant="secondary" className="min-h-12" disabled={approve.pending} onClick={() => { decline.clear(); setDeclining(true); }}>Decline</Button>
        <CommandButton commands={DECIDE} type="button" variant="primary" className="min-h-12" disabled={approve.pending || aboveLimit} onClick={() => approve.run(DECIDE, { approvalId: id, decision: "approved" })}>{approve.pending ? "Saving…" : "Approve"}</CommandButton>
      </div>
      {aboveLimit && <p className="m-0 text-[12px] text-text-tertiary">Above the limit set for managers. Only the owner can approve this.</p>}

      <FormModal
        open={declining} onClose={() => setDeclining(false)} destructive
        title="Decline this request" description="Say why, so the person who asked can see it."
        submitLabel="Decline" pendingLabel="Saving…"
        pending={decline.pending} failure={decline.failure} failureTitle="That was not saved"
        onSubmit={(fd) => decline.run(DECIDE, { approvalId: id, decision: "declined", note: String(fd.get("note") ?? "").trim() }, () => setDeclining(false))}
      >
        <Field label="Why are you declining?" htmlFor={`dn-${id}`} required>
          <Input id={`dn-${id}`} name="note" minLength={3} maxLength={300} required autoFocus />
        </Field>
      </FormModal>
    </div>
  );
}
