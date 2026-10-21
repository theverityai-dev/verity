"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Button, ErrorState, Field, Input, Row, RowList } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import { rupees, shortDate } from "../format";

const CANCEL = "verity.piecework.cancel_lot";
const REVERSE = "verity.piecework.reverse_entry";

export function CancelLot({ lotId, number }: { lotId: string; number: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <CommandButton commands={CANCEL} variant="ghost" onClick={() => setOpen(true)}>
        Cancel lot
      </CommandButton>
      <Modal open={open} onClose={() => setOpen(false)} title={`Cancel ${number}?`} description="Only a lot that no pieces have left can be cancelled. Its number is never reused.">
        <form
          className="flex flex-col gap-4"
          action={(formData) => {
            setFailure(null);
            startTransition(async () => {
              const result = await runCommand(CANCEL, { lotId, reason: String(formData.get("reason") ?? "").trim() }, "/lots");
              if (result.ok) {
                setOpen(false);
                router.refresh();
              } else setFailure(result);
            });
          }}
        >
          {failure && <ErrorState title="Could not cancel the lot" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
          <Field label="Reason" htmlFor="cancel-reason" required>
            <Input id="cancel-reason" name="reason" required minLength={3} maxLength={300} autoFocus />
          </Field>
          <div className="flex gap-2">
            <CommandButton commands={CANCEL} type="submit" variant="danger" disabled={pending}>
              {pending ? "Cancelling…" : "Cancel this lot"}
            </CommandButton>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Keep it</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export type LedgerLine = {
  id: string; entryDate: string; stageLabel: string; workerName: string; kind: "issue" | "receive"; pieces: number;
  bundles: number; wageMinor: number; isReversal: boolean; reversed: boolean; enteredBy: string; createdAt: string; note: string | null;
};

/** Every entry on the lot, oldest first. A wrong line is reversed here, never edited; both stay in the record. */
export function EntryLedger({ lines, canWage }: { lines: LedgerLine[]; canWage: boolean }) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<string | null>(null);

  const reverse = (entryId: string) => {
    setFailure(null);
    startTransition(async () => {
      const result = await runCommand(REVERSE, { entryId, note: "Entered by mistake" }, "/lots");
      setConfirm(null);
      if (result.ok) router.refresh();
      else setFailure(result);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {failure && <ErrorState title="Could not reverse that entry" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
      {lines.length === 0 ? (
        <p className="m-0 px-5 pb-4 text-[14px] text-text-secondary">No entries yet. Record the first issue from Daily entry.</p>
      ) : (
        <RowList>
          {lines.map((l) => (
            <Row key={l.id} className={l.reversed || l.isReversal ? "opacity-70" : ""}>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[14px] font-medium text-text">
                  {l.isReversal ? "Reversal: " : ""}
                  {l.kind === "issue" ? "Issued" : "Received"} {Math.abs(l.pieces)} pieces · {l.stageLabel} · {l.workerName}
                  {l.reversed && <span className="ml-2 text-[12px] font-normal text-text-tertiary">Reversed</span>}
                </span>
                <span className="text-[13px] text-text-secondary">
                  {shortDate(l.entryDate)} · {Math.abs(l.bundles)} bundles · entered by {l.enteredBy}
                  {canWage && l.kind === "receive" && l.wageMinor !== 0 ? ` · wage ${rupees(l.wageMinor)}` : ""}
                  {l.note ? ` · ${l.note}` : ""}
                </span>
              </div>
              {!l.isReversal && !l.reversed && (
                confirm === l.id ? (
                  <span className="flex items-center gap-2">
                    <CommandButton commands={REVERSE} variant="danger" size="sm" disabled={pending} onClick={() => reverse(l.id)}>
                      {pending ? "Reversing…" : "Yes, reverse"}
                    </CommandButton>
                    <Button variant="ghost" size="sm" onClick={() => setConfirm(null)} disabled={pending}>No</Button>
                  </span>
                ) : (
                  <CommandButton commands={REVERSE} variant="ghost" size="sm" onClick={() => setConfirm(l.id)} aria-label={`Reverse this entry: ${l.stageLabel}, ${l.workerName}`}>
                    Reverse
                  </CommandButton>
                )
              )}
            </Row>
          ))}
        </RowList>
      )}
    </div>
  );
}
