"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Button, ErrorState, Field, Input } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

const REQUEST = "verity.piecework.request_approval";

/**
 * For a person who may not change a lot's status themselves (a supervisor): ask for it to be held, or closed once it is
 * completed. The manager or owner decides in the approvals inbox; nothing changes until they do.
 */
export function LotRequests({ lotId, status }: { lotId: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState("");
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [sent, setSent] = useState(false);
  const kind = status === "active" ? "hold" : status === "completed" ? "close" : null;
  if (!kind) return null;
  const label = kind === "hold" ? "Request a hold" : "Request to close";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFailure(null);
    start(async () => {
      const result = await runCommand(REQUEST, { kind, lotId, reason: why }, "/shopfloor/approvals");
      if (result.ok) { setSent(true); setOpen(false); router.refresh(); } else setFailure(result);
    });
  };

  return (
    <>
      {sent ? <span role="status" className="text-[14px] text-text-secondary">Request sent to the manager.</span> : <Button type="button" variant="secondary" onClick={() => setOpen(true)}>{label}</Button>}
      <Modal open={open} onClose={() => setOpen(false)} title={label}>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          {failure && <ErrorState title="That was not sent" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
          <Field label="Why?" htmlFor="lr-why" required hint="The manager reads this with the lot's figures.">
            <Input id="lr-why" value={why} onChange={(e) => setWhy(e.target.value)} minLength={3} maxLength={300} required autoFocus />
          </Field>
          <CommandButton commands={REQUEST} type="submit" variant="primary" disabled={pending || why.trim().length < 3}>{pending ? "Sending…" : "Send to the manager"}</CommandButton>
        </form>
      </Modal>
    </>
  );
}
