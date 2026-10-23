"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Field, Input, Select } from "@/components/ui/primitives";
import { FormModal } from "@/components/ui/CommandForm";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

const MOVE = "verity.piecework.move_fabric";
const CANCEL = "verity.piecework.cancel_roll";

type Kind = "issue" | "return" | "adjust_more" | "adjust_less";
const KINDS: Array<[Kind, string]> = [["issue", "Send to a lot"], ["return", "Bring back from a lot"], ["adjust_less", "Take off (damage, wastage)"], ["adjust_more", "Add (found, re-measured)"]];

/** One roll's movements: fabric to a lot, back from a lot, or a correction with a reason. Nothing is edited; each is a new line. */
export function MoveFabric({ rollId, unit, balanceCenti, lots }: { rollId: string; unit: string; balanceCenti: number; lots: Array<{ id: string; label: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<Kind>("issue");
  const [lotId, setLotId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const needsLot = kind === "issue" || kind === "return";
  const centi = Math.round(Number(amount) * 100);
  const valid = centi >= 1 && (!needsLot || lotId !== "") && (needsLot || reason.trim().length >= 3) && (kind !== "issue" && kind !== "adjust_less" ? true : centi <= balanceCenti);

  const submit = () => {
    setFailure(null);
    start(async () => {
      const result = await runCommand(MOVE, {
        rollId,
        kind: kind === "issue" || kind === "return" ? kind : "adjust",
        quantityCenti: kind === "adjust_less" ? -centi : centi,
        lotId: needsLot ? lotId : undefined,
        reason: reason.trim() || undefined,
      }, `/fabric/${rollId}`);
      if (result.ok) { setOpen(false); setAmount(""); setReason(""); router.refresh(); } else setFailure(result);
    });
  };

  return (
    <>
      <CommandButton commands={MOVE} variant="secondary" onClick={() => setOpen(true)}>Move fabric</CommandButton>
      <FormModal
        open={open} onClose={() => setOpen(false)}
        title="Move fabric" description={`${(balanceCenti / 100).toLocaleString("en-IN")} ${unit} on the roll now.`}
        submitLabel="Save movement" submitDisabled={!valid}
        pending={pending} failure={failure} failureTitle="That was not saved" onSubmit={submit}
      >
          <Field label="What happened" htmlFor="mv-kind">
            <Select id="mv-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </Select>
          </Field>
          {needsLot && (
            <Field label="Lot" htmlFor="mv-lot" required>
              <Select id="mv-lot" value={lotId} onChange={(e) => setLotId(e.target.value)} required>
                <option value="" disabled>Choose a lot</option>
                {lots.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </Select>
            </Field>
          )}
          <Field label={`Quantity (${unit})`} htmlFor="mv-amt" required>
            <Input id="mv-amt" type="number" inputMode="decimal" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus />
          </Field>
          {!needsLot && (
            <Field label="Reason" htmlFor="mv-why" required>
              <Input id="mv-why" value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={300} placeholder="damp patch cut away" required />
            </Field>
          )}
      </FormModal>
    </>
  );
}

/** Only a roll nothing has left can be cancelled (a duplicate entry); its number stays used. */
export function CancelRoll({ rollId, number }: { rollId: string; number: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <CommandButton commands={CANCEL} variant="ghost" onClick={() => setOpen(true)}>Cancel roll</CommandButton>
      <FormModal
        open={open} onClose={() => setOpen(false)} destructive
        title={`Cancel ${number}?`} description="Only a roll that has never moved can be cancelled, for an entry made twice. Its number is not reused."
        submitLabel="Cancel this roll" pendingLabel="Cancelling…"
        pending={pending} failure={failure} failureTitle="Could not cancel the roll"
        onSubmit={(fd) => {
          setFailure(null);
          start(async () => {
            const result = await runCommand(CANCEL, { rollId, reason: String(fd.get("reason") ?? "").trim() }, "/fabric");
            if (result.ok) router.push("/fabric"); else setFailure(result);
          });
        }}
      >
        <Field label="Reason" htmlFor="cr-why" required><Input id="cr-why" name="reason" required minLength={3} maxLength={300} autoFocus /></Field>
      </FormModal>
    </>
  );
}
