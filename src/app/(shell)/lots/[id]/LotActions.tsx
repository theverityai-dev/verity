"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Button, ErrorState, Field, Input, Row, RowList } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import { shortDate } from "../format";

const CANCEL = "verity.piecework.cancel_lot";
const REVERSE = "verity.piecework.reverse_entry";
const STATUS = "verity.piecework.set_lot_status";

function useAction(onDone?: () => void) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (command: string, input: unknown, path = "/lots") => {
    setFailure(null);
    startTransition(async () => {
      const result = await runCommand(command, input, path);
      if (result.ok) {
        onDone?.();
        router.refresh();
      } else setFailure(result);
    });
  };
  return { failure, pending, run, clear: () => setFailure(null) };
}

const NEXT: Record<string, Array<{ to: string; label: string; variant: "primary" | "secondary" | "ghost" }>> = {
  draft: [{ to: "active", label: "Start the lot", variant: "primary" }],
  active: [{ to: "completed", label: "Mark completed", variant: "secondary" }, { to: "hold", label: "Put on hold", variant: "ghost" }],
  hold: [{ to: "active", label: "Resume", variant: "primary" }],
  completed: [{ to: "closed", label: "Close the lot", variant: "primary" }, { to: "active", label: "Reopen", variant: "ghost" }],
  closed: [],
};

/** The moves a lot's status allows. Completing and closing are refused, with the figures, while pieces are still out. */
export function StatusActions({ lotId, status }: { lotId: string; status: string }) {
  const { failure, pending, run } = useAction();
  return (
    <>
      {(NEXT[status] ?? []).map((n) => (
        <CommandButton key={n.to} commands={STATUS} variant={n.variant} disabled={pending} onClick={() => run(STATUS, { lotId, to: n.to })}>
          {n.label}
        </CommandButton>
      ))}
      {failure && (
        <div className="basis-full">
          <ErrorState title="The lot did not change" message={failure.message} issues={failure.issues} retryable={failure.retryable} />
        </div>
      )}
    </>
  );
}

export function CancelLot({ lotId, number }: { lotId: string; number: string }) {
  const [open, setOpen] = useState(false);
  const { failure, pending, run, clear } = useAction(() => setOpen(false));
  return (
    <>
      <CommandButton commands={CANCEL} variant="ghost" onClick={() => setOpen(true)}>Cancel lot</CommandButton>
      <Modal open={open} onClose={() => { clear(); setOpen(false); }} title={`Cancel ${number}?`} description="Only a lot with no work recorded can be cancelled. Its number is never reused.">
        <form className="flex flex-col gap-4" action={(formData) => run(CANCEL, { lotId, reason: String(formData.get("reason") ?? "").trim() })}>
          {failure && <ErrorState title="Could not cancel the lot" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
          <Field label="Reason" htmlFor="cancel-reason" required>
            <Input id="cancel-reason" name="reason" required minLength={3} maxLength={300} autoFocus />
          </Field>
          <div className="flex gap-2">
            <CommandButton commands={CANCEL} type="submit" variant="danger" disabled={pending}>{pending ? "Cancelling…" : "Cancel this lot"}</CommandButton>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Keep it</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export type LedgerLine = {
  id: string; entryDate: string; bundleNumber: string; stageLabel: string; workerName: string; kind: "issue" | "receive"; pieces: number;
  good: number; rejected: number; rework: number; short: number; isReversal: boolean; reversed: boolean; isRework: boolean; enteredBy: string; createdAt: string; note: string | null;
};

const split = (l: LedgerLine) =>
  [l.good && `good ${Math.abs(l.good)}`, l.rejected && `rejected ${Math.abs(l.rejected)}`, l.rework && `rework ${Math.abs(l.rework)}`, l.short && `short ${Math.abs(l.short)}`].filter(Boolean).join(", ");

/** Every entry on the lot, oldest first. A wrong line is reversed here, never edited; both stay in the record. */
export function EntryLedger({ lines }: { lines: LedgerLine[] }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const { failure, pending, run } = useAction(() => setConfirm(null));
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
                  {l.kind === "issue" ? (l.isRework ? "Rework issued" : "Issued") : "Returned"} {Math.abs(l.pieces)} · {l.bundleNumber} · {l.stageLabel} · {l.workerName}
                  {l.reversed && <span className="ml-2 text-[12px] font-normal text-text-tertiary">Reversed</span>}
                </span>
                <span className="text-[13px] text-text-secondary">
                  {shortDate(l.entryDate)} · entered by {l.enteredBy}
                  {l.kind === "receive" ? ` · ${split(l)}` : ""}
                  {l.note ? ` · ${l.note}` : ""}
                </span>
              </div>
              {!l.isReversal && !l.reversed && (
                confirm === l.id ? (
                  <span className="flex items-center gap-2">
                    <CommandButton commands={REVERSE} variant="danger" size="sm" disabled={pending} onClick={() => run(REVERSE, { entryId: l.id, note: "Entered by mistake" })}>
                      {pending ? "Reversing…" : "Yes, reverse"}
                    </CommandButton>
                    <Button variant="ghost" size="sm" onClick={() => setConfirm(null)} disabled={pending}>No</Button>
                  </span>
                ) : (
                  <CommandButton commands={REVERSE} variant="ghost" size="sm" onClick={() => setConfirm(l.id)} aria-label={`Reverse this entry: ${l.bundleNumber}, ${l.stageLabel}, ${l.workerName}`}>
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
