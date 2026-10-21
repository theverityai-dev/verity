"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Button, ErrorState, Field, Input, Row, RowList, Select } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import { rupees, shortDate, toPaise } from "../../lots/format";

const PAY = "verity.piecework.record_payment";
const RATE = "verity.piecework.set_worker_rate";
const REVERSE = "verity.piecework.reverse_payment";

function useAction(path: string, onDone: () => void) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (command: string, input: unknown) => {
    setFailure(null);
    startTransition(async () => {
      const result = await runCommand(command, input, path);
      if (result.ok) {
        onDone();
        router.refresh();
      } else setFailure(result);
    });
  };
  return { failure, pending, run, clear: () => setFailure(null) };
}

export function RecordMoney({ workerId, name, balanceMinor }: { workerId: string; name: string; balanceMinor: number }) {
  const [open, setOpen] = useState(false);
  const { failure, pending, run, clear } = useAction(`/karigars/${workerId}`, () => setOpen(false));
  return (
    <>
      <CommandButton commands={PAY} variant="primary" onClick={() => setOpen(true)}>Record advance or payment</CommandButton>
      <Modal open={open} onClose={() => { clear(); setOpen(false); }} title={`Money for ${name}`} description={`Balance due now: ${rupees(balanceMinor)}. A payment cannot be more than the balance due; record anything extra as an advance.`}>
        <form
          className="flex flex-col gap-4"
          action={(formData) => {
            const amount = toPaise(String(formData.get("amount") ?? ""));
            run(PAY, { workerId, kind: String(formData.get("kind")), amountMinor: amount ?? 0, note: String(formData.get("note") ?? "").trim() || undefined });
          }}
        >
          {failure && <ErrorState title="Could not record it" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Type" htmlFor="money-kind" required>
              <Select id="money-kind" name="kind" defaultValue="payment">
                <option value="payment">Payment (settles wages)</option>
                <option value="advance">Advance (given before wages are earned)</option>
              </Select>
            </Field>
            <Field label="Amount in rupees" htmlFor="money-amount" required>
              <Input id="money-amount" name="amount" type="number" inputMode="decimal" min={0.01} step="0.01" required autoFocus />
            </Field>
          </div>
          <Field label="Note" htmlFor="money-note">
            <Input id="money-note" name="note" maxLength={300} />
          </Field>
          <div className="flex gap-2">
            <CommandButton commands={PAY} type="submit" variant="primary" disabled={pending}>{pending ? "Saving…" : "Save"}</CommandButton>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function ChangeRate({ workerId, name, stages }: { workerId: string; name: string; stages: Array<{ id: string; label: string }> }) {
  const [open, setOpen] = useState(false);
  const { failure, pending, run, clear } = useAction(`/karigars/${workerId}`, () => setOpen(false));
  return (
    <>
      <CommandButton commands={RATE} variant="secondary" onClick={() => setOpen(true)}>Set a rate</CommandButton>
      <Modal open={open} onClose={() => { clear(); setOpen(false); }} title={`Rate for ${name}`} description="A new rate applies from today. Work already returned keeps the rate it was paid at.">
        <form
          className="flex flex-col gap-4"
          action={(formData) => {
            const paise = toPaise(String(formData.get("rate") ?? ""));
            run(RATE, { workerId, stageId: String(formData.get("stage")), rateMinor: paise ?? -1 });
          }}
        >
          {failure && <ErrorState title="Could not set the rate" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Work" htmlFor="rate-stage" required>
              <Select id="rate-stage" name="stage" defaultValue={stages[0]?.id}>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
            </Field>
            <Field label="Rate per piece, in rupees" htmlFor="rate-amount" required hint="0 means the work is unpaid.">
              <Input id="rate-amount" name="rate" type="number" inputMode="decimal" min={0} step="0.01" required autoFocus />
            </Field>
          </div>
          <div className="flex gap-2">
            <CommandButton commands={RATE} type="submit" variant="primary" disabled={pending}>{pending ? "Saving…" : "Set rate"}</CommandButton>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

const ACTIVE = "verity.piecework.set_worker_active";

/** Retire or restore a karigar. A karigar who still holds pieces cannot be retired; the refusal says how many. */
export function ActiveToggle({ workerId, active }: { workerId: string; active: boolean }) {
  const { failure, pending, run } = useAction(`/karigars/${workerId}`, () => undefined);
  return (
    <>
      <CommandButton commands={ACTIVE} variant="ghost" disabled={pending} onClick={() => run(ACTIVE, { workerId, active: !active })}>
        {active ? "Retire" : "Restore"}
      </CommandButton>
      {failure && (
        <div className="basis-full">
          <ErrorState title="Could not change this karigar" message={failure.message} issues={failure.issues} retryable={failure.retryable} />
        </div>
      )}
    </>
  );
}

export type MoneyLine = { id: string; paidOn: string; kind: "advance" | "payment"; amountMinor: number; isReversal: boolean; reversed: boolean; note: string | null };

/** Advances and payments, newest first. A wrong one is reversed here, never edited; both stay in the record. */
export function PaymentLedger({ workerId, lines }: { workerId: string; lines: MoneyLine[] }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const { failure, pending, run } = useAction(`/karigars/${workerId}`, () => setConfirm(null));
  return (
    <div className="flex flex-col gap-3">
      {failure && <ErrorState title="Could not reverse that" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
      {lines.length === 0 ? (
        <p className="m-0 px-5 pb-4 text-[14px] text-text-secondary">No advances or payments yet.</p>
      ) : (
        <RowList>
          {lines.map((l) => (
            <Row key={l.id} className={l.reversed || l.isReversal ? "opacity-70" : ""}>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[14px] font-medium text-text">
                  {l.isReversal ? "Reversal: " : ""}
                  {l.kind === "advance" ? "Advance" : "Payment"} {rupees(Math.abs(l.amountMinor))}
                  {l.reversed && <span className="ml-2 text-[12px] font-normal text-text-tertiary">Reversed</span>}
                </span>
                <span className="text-[13px] text-text-secondary">{shortDate(l.paidOn)}{l.note ? ` · ${l.note}` : ""}</span>
              </div>
              {!l.isReversal && !l.reversed && (
                confirm === l.id ? (
                  <span className="flex items-center gap-2">
                    <CommandButton commands={REVERSE} variant="danger" size="sm" disabled={pending} onClick={() => run(REVERSE, { paymentId: l.id })}>
                      {pending ? "Reversing…" : "Yes, reverse"}
                    </CommandButton>
                    <Button variant="ghost" size="sm" onClick={() => setConfirm(null)} disabled={pending}>No</Button>
                  </span>
                ) : (
                  <CommandButton commands={REVERSE} variant="ghost" size="sm" onClick={() => setConfirm(l.id)} aria-label={`Reverse this ${l.kind}`}>Reverse</CommandButton>
                )
              )}
            </Row>
          ))}
        </RowList>
      )}
    </div>
  );
}
