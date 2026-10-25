"use client";

import { useState } from "react";
import { CommandButton } from "@/components/ui/CommandAccess";
import { DateField } from "@/components/ui/DateTimePicker";
import { FormModal, formOptional, formText, useCommand } from "@/components/ui/CommandForm";
import { Field, Input, Select } from "@/components/ui/primitives";

const MOVE = "verity.piecework.record_ready_move";
const REVERSE = "verity.piecework.reverse_ready_move";
const OUT_REASONS = ["Sold", "Dispatched", "Sample", "Damaged", "Other"];

export type StockOption = { key: string; lotId: string | null; label: string; balance: number };

/** The value a stock choice is submitted as: a lot's id, or an opening line's name. */
const pick = (options: StockOption[], key: string) => options.find((o) => o.key === key);
const target = (o: StockOption) => (o.lotId ? { lotId: o.lotId } : { label: o.label });

function StockSelect({ id, options, value, onChange }: { id: string; options: StockOption[]; value: string; onChange: (v: string) => void }) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} required>
      <option value="">Choose the stock</option>
      {options.map((o) => <option key={o.key} value={o.key}>{o.label} ({o.balance.toLocaleString("en-IN")} in stock)</option>)}
    </Select>
  );
}

/** Take garments out of stock: sold, dispatched, a sample. The screen refuses more than is there; so does the server. */
export function StockOut({ options, today }: { options: StockOption[]; today: string }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [day, setDay] = useState(today);
  const { run, pending, failure, clear } = useCommand("/lots/ready");
  const chosen = pick(options, key);
  const available = options.filter((o) => o.balance > 0);
  return (
    <>
      <CommandButton commands={MOVE} variant="primary" onClick={() => setOpen(true)} disabled={available.length === 0}>Stock out</CommandButton>
      <FormModal
        open={open} onClose={() => { clear(); setOpen(false); }} width="md" title="Take garments out of stock"
        description="Sold, dispatched or given as a sample. What leaves is taken off the stock at once; a mistake is reversed, never edited."
        submitLabel="Take out" pendingLabel="Saving…" pending={pending} failure={failure} failureTitle="Nothing was taken out"
        submitDisabled={!chosen}
        onSubmit={(f) => run(MOVE, { kind: "out", ...(chosen ? target(chosen) : {}), pieces: Number(f.get("pieces")), reason: formOptional(f, "reason"), party: formOptional(f, "party"), reference: formOptional(f, "reference"), movedOn: day || undefined, note: formOptional(f, "note") }, () => { setOpen(false); setKey(""); })}
      >
        <Field label="Which stock" htmlFor="so-line" required><StockSelect id="so-line" options={available} value={key} onChange={setKey} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Pieces" htmlFor="so-pieces" required hint={chosen ? `Up to ${chosen.balance.toLocaleString("en-IN")}` : undefined}>
            <Input id="so-pieces" name="pieces" type="number" inputMode="numeric" min={1} max={chosen?.balance} step={1} required autoFocus />
          </Field>
          <Field label="Why" htmlFor="so-reason">
            <Select id="so-reason" name="reason" defaultValue="Dispatched">{OUT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}</Select>
          </Field>
          <Field label="To whom" htmlFor="so-party" hint="The buyer or party"><Input id="so-party" name="party" maxLength={120} /></Field>
          <Field label="Invoice or challan number" htmlFor="so-ref"><Input id="so-ref" name="reference" maxLength={60} /></Field>
          <Field label="On" htmlFor="so-day"><DateField id="so-day" value={day} onChange={setDay} /></Field>
          <Field label="Note" htmlFor="so-note"><Input id="so-note" name="note" maxLength={300} /></Field>
        </div>
      </FormModal>
    </>
  );
}

/** Garments that were on the shelf before Verity: counted once on launch day, with a name that says what they are. */
export function OpeningStock({ today }: { today: string }) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(today);
  const { run, pending, failure, clear } = useCommand("/lots/ready");
  return (
    <>
      <CommandButton commands={MOVE} onClick={() => setOpen(true)}>Opening stock</CommandButton>
      <FormModal
        open={open} onClose={() => { clear(); setOpen(false); }} width="md" title="Enter opening stock"
        description="Garments already on the shelf from before Verity. Name them by design and size so they can be told apart; count each kind once."
        submitLabel="Add to stock" pendingLabel="Saving…" pending={pending} failure={failure} failureTitle="The opening stock was not saved"
        onSubmit={(f) => run(MOVE, { kind: "opening", label: formText(f, "label"), pieces: Number(f.get("pieces")), movedOn: day || undefined, note: formOptional(f, "note") }, () => setOpen(false))}
      >
        <Field label="What it is" htmlFor="os-label" required hint="For example: Oxford formal, white, M to XL"><Input id="os-label" name="label" required maxLength={120} autoFocus /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Pieces counted" htmlFor="os-pieces" required><Input id="os-pieces" name="pieces" type="number" inputMode="numeric" min={1} step={1} required /></Field>
          <Field label="Counted on" htmlFor="os-day"><DateField id="os-day" value={day} onChange={setDay} /></Field>
        </div>
        <Field label="Note" htmlFor="os-note"><Input id="os-note" name="note" maxLength={300} /></Field>
      </FormModal>
    </>
  );
}

/** A stock-take difference: pieces found or missing at the count, with the reason that explains it. */
export function CorrectCount({ options, today }: { options: StockOption[]; today: string }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [dir, setDir] = useState<"adjust_in" | "adjust_out">("adjust_out");
  const [day, setDay] = useState(today);
  const { run, pending, failure, clear } = useCommand("/lots/ready");
  const chosen = pick(options, key);
  return (
    <>
      <CommandButton commands={MOVE} onClick={() => setOpen(true)} disabled={options.length === 0}>Correct a count</CommandButton>
      <FormModal
        open={open} onClose={() => { clear(); setOpen(false); }} width="md" title="Correct a count"
        description="After counting the shelf, record what is found or missing. A reason is needed, and both the correction and the reason stay on the ledger."
        submitLabel="Record" pendingLabel="Saving…" pending={pending} failure={failure} failureTitle="The count was not corrected"
        submitDisabled={!chosen}
        onSubmit={(f) => run(MOVE, { kind: dir, ...(chosen ? target(chosen) : {}), pieces: Number(f.get("pieces")), reason: formText(f, "reason"), movedOn: day || undefined }, () => { setOpen(false); setKey(""); })}
      >
        <Field label="Which stock" htmlFor="cc-line" required><StockSelect id="cc-line" options={options} value={key} onChange={setKey} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="The count found" htmlFor="cc-dir">
            <Select id="cc-dir" value={dir} onChange={(e) => setDir(e.target.value as typeof dir)}>
              <option value="adjust_out">Fewer than the system says</option>
              <option value="adjust_in">More than the system says</option>
            </Select>
          </Field>
          <Field label="Pieces of difference" htmlFor="cc-pieces" required><Input id="cc-pieces" name="pieces" type="number" inputMode="numeric" min={1} step={1} required /></Field>
        </div>
        <Field label="Reason" htmlFor="cc-reason" required hint="A few words: found on the shelf, torn in the godown"><Input id="cc-reason" name="reason" required minLength={3} maxLength={80} /></Field>
        <Field label="On" htmlFor="cc-day"><DateField id="cc-day" value={day} onChange={setDay} /></Field>
      </FormModal>
    </>
  );
}

/** One ledger line's undo: a reversal with a reason. Both rows stay. */
export function ReverseMove({ moveId, summary }: { moveId: string; summary: string }) {
  const [open, setOpen] = useState(false);
  const { run, pending, failure, clear } = useCommand("/lots/ready");
  return (
    <>
      <CommandButton commands={REVERSE} variant="ghost" size="sm" onClick={() => setOpen(true)}>Reverse</CommandButton>
      <FormModal
        open={open} onClose={() => { clear(); setOpen(false); }} width="sm" destructive title="Reverse this movement" description={`${summary}. The original stays on the ledger with its reversal; the stock goes back to what it was.`}
        submitLabel="Reverse" pendingLabel="Reversing…" pending={pending} failure={failure} failureTitle="It was not reversed"
        onSubmit={(f) => run(REVERSE, { moveId, reason: formText(f, "reason") }, () => setOpen(false))}
      >
        <Field label="Why" htmlFor={`rv-${moveId}`} required><Input id={`rv-${moveId}`} name="reason" required minLength={3} maxLength={300} autoFocus /></Field>
      </FormModal>
    </>
  );
}
