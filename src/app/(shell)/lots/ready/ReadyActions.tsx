"use client";

import { useState } from "react";
import { CommandButton } from "@/components/ui/CommandAccess";
import { DateField } from "@/components/ui/DateTimePicker";
import { FormModal, formOptional, formText, useCommand } from "@/components/ui/CommandForm";
import { Field, Input, Select } from "@/components/ui/primitives";
import { fill, type OfficeLabels } from "../../fabric/office-labels";

const MOVE = "verity.piecework.record_ready_move";
const REVERSE = "verity.piecework.reverse_ready_move";

export type StockOption = { key: string; lotId: string | null; label: string; balance: number };

/** The value a stock choice is submitted as: a lot's id, or an opening line's name. */
const pick = (options: StockOption[], key: string) => options.find((o) => o.key === key);
const target = (o: StockOption) => (o.lotId ? { lotId: o.lotId } : { label: o.label });

function StockSelect({ o, id, options, value, onChange }: { o: OfficeLabels; id: string; options: StockOption[]; value: string; onChange: (v: string) => void }) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} required>
      <option value="">{o.chooseStock}</option>
      {options.map((x) => <option key={x.key} value={x.key}>{fill(o.stockOption, { l: x.label, n: x.balance.toLocaleString("en-IN") })}</option>)}
    </Select>
  );
}

/** Take garments out of stock: sold, dispatched, a sample. The screen refuses more than is there; so does the server. */
export function StockOut({ o, options, today }: { o: OfficeLabels; options: StockOption[]; today: string }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [day, setDay] = useState(today);
  const { run, pending, failure, clear } = useCommand("/lots/ready");
  const chosen = pick(options, key);
  const available = options.filter((x) => x.balance > 0);
  // The reason is stored in English whatever the screen's language, so the ledger and its exports read the same for everyone.
  const reasons: Array<[string, string]> = [["Sold", o.rSold], ["Dispatched", o.rDispatched], ["Sample", o.rSample], ["Damaged", o.rDamaged], ["Other", o.rOther]];
  return (
    <>
      <CommandButton commands={MOVE} variant="primary" onClick={() => setOpen(true)} disabled={available.length === 0}>{o.stockOut}</CommandButton>
      <FormModal
        open={open} onClose={() => { clear(); setOpen(false); }} width="md" title={o.soTitle}
        description={o.soDesc}
        submitLabel={o.takeOut} pendingLabel={o.saving} pending={pending} failure={failure} failureTitle={o.soFail}
        submitDisabled={!chosen}
        onSubmit={(f) => run(MOVE, { kind: "out", ...(chosen ? target(chosen) : {}), pieces: Number(f.get("pieces")), reason: formOptional(f, "reason"), party: formOptional(f, "party"), reference: formOptional(f, "reference"), movedOn: day || undefined, note: formOptional(f, "note") }, () => { setOpen(false); setKey(""); })}
      >
        <Field label={o.whichStock} htmlFor="so-line" required><StockSelect o={o} id="so-line" options={available} value={key} onChange={setKey} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={o.pieces} htmlFor="so-pieces" required hint={chosen ? fill(o.upTo, { n: chosen.balance.toLocaleString("en-IN") }) : undefined}>
            <Input id="so-pieces" name="pieces" type="number" inputMode="numeric" min={1} max={chosen?.balance} step={1} required autoFocus />
          </Field>
          <Field label={o.why} htmlFor="so-reason">
            <Select id="so-reason" name="reason" defaultValue="Dispatched">{reasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
          </Field>
          <Field label={o.toWhom} htmlFor="so-party" hint={o.toWhomHint}><Input id="so-party" name="party" maxLength={120} /></Field>
          <Field label={o.invoiceOrChallan} htmlFor="so-ref"><Input id="so-ref" name="reference" maxLength={60} /></Field>
          <Field label={o.onDate} htmlFor="so-day"><DateField id="so-day" value={day} onChange={setDay} /></Field>
          <Field label={o.note} htmlFor="so-note"><Input id="so-note" name="note" maxLength={300} /></Field>
        </div>
      </FormModal>
    </>
  );
}

/** Garments that were on the shelf before Verity: counted once on launch day, with a name that says what they are. */
export function OpeningStock({ o, today }: { o: OfficeLabels; today: string }) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(today);
  const { run, pending, failure, clear } = useCommand("/lots/ready");
  return (
    <>
      <CommandButton commands={MOVE} onClick={() => setOpen(true)}>{o.openingStockBtn}</CommandButton>
      <FormModal
        open={open} onClose={() => { clear(); setOpen(false); }} width="md" title={o.osTitle}
        description={o.osDesc}
        submitLabel={o.addToStock} pendingLabel={o.saving} pending={pending} failure={failure} failureTitle={o.osFail}
        onSubmit={(f) => run(MOVE, { kind: "opening", label: formText(f, "label"), pieces: Number(f.get("pieces")), movedOn: day || undefined, note: formOptional(f, "note") }, () => setOpen(false))}
      >
        <Field label={o.whatItIs} htmlFor="os-label" required hint={o.whatItIsHint}><Input id="os-label" name="label" required maxLength={120} autoFocus /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={o.piecesCounted} htmlFor="os-pieces" required><Input id="os-pieces" name="pieces" type="number" inputMode="numeric" min={1} step={1} required /></Field>
          <Field label={o.countedOn} htmlFor="os-day"><DateField id="os-day" value={day} onChange={setDay} /></Field>
        </div>
        <Field label={o.note} htmlFor="os-note"><Input id="os-note" name="note" maxLength={300} /></Field>
      </FormModal>
    </>
  );
}

/** A stock-take difference: pieces found or missing at the count, with the reason that explains it. */
export function CorrectCount({ o, options, today }: { o: OfficeLabels; options: StockOption[]; today: string }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [dir, setDir] = useState<"adjust_in" | "adjust_out">("adjust_out");
  const [day, setDay] = useState(today);
  const { run, pending, failure, clear } = useCommand("/lots/ready");
  const chosen = pick(options, key);
  return (
    <>
      <CommandButton commands={MOVE} onClick={() => setOpen(true)} disabled={options.length === 0}>{o.correctCount}</CommandButton>
      <FormModal
        open={open} onClose={() => { clear(); setOpen(false); }} width="md" title={o.ccTitle}
        description={o.ccDesc}
        submitLabel={o.record} pendingLabel={o.saving} pending={pending} failure={failure} failureTitle={o.ccFail}
        submitDisabled={!chosen}
        onSubmit={(f) => run(MOVE, { kind: dir, ...(chosen ? target(chosen) : {}), pieces: Number(f.get("pieces")), reason: formText(f, "reason"), movedOn: day || undefined }, () => { setOpen(false); setKey(""); })}
      >
        <Field label={o.whichStock} htmlFor="cc-line" required><StockSelect o={o} id="cc-line" options={options} value={key} onChange={setKey} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={o.countFound} htmlFor="cc-dir">
            <Select id="cc-dir" value={dir} onChange={(e) => setDir(e.target.value as typeof dir)}>
              <option value="adjust_out">{o.fewer}</option>
              <option value="adjust_in">{o.more}</option>
            </Select>
          </Field>
          <Field label={o.piecesOfDiff} htmlFor="cc-pieces" required><Input id="cc-pieces" name="pieces" type="number" inputMode="numeric" min={1} step={1} required /></Field>
        </div>
        <Field label={o.reasonLabel} htmlFor="cc-reason" required hint={o.reasonHint}><Input id="cc-reason" name="reason" required minLength={3} maxLength={80} /></Field>
        <Field label={o.onDate} htmlFor="cc-day"><DateField id="cc-day" value={day} onChange={setDay} /></Field>
      </FormModal>
    </>
  );
}

/** One ledger line's undo: a reversal with a reason. Both rows stay. */
export function ReverseMove({ o, moveId, summary }: { o: OfficeLabels; moveId: string; summary: string }) {
  const [open, setOpen] = useState(false);
  const { run, pending, failure, clear } = useCommand("/lots/ready");
  return (
    <>
      <CommandButton commands={REVERSE} variant="ghost" size="sm" onClick={() => setOpen(true)}>{o.reverse}</CommandButton>
      <FormModal
        open={open} onClose={() => { clear(); setOpen(false); }} width="sm" destructive title={o.reverseTitle} description={fill(o.reverseDesc, { s: summary })}
        submitLabel={o.reverse} pendingLabel={o.reversing} pending={pending} failure={failure} failureTitle={o.reverseFail}
        onSubmit={(f) => run(REVERSE, { moveId, reason: formText(f, "reason") }, () => setOpen(false))}
      >
        <Field label={o.why} htmlFor={`rv-${moveId}`} required><Input id={`rv-${moveId}`} name="reason" required minLength={3} maxLength={300} autoFocus /></Field>
      </FormModal>
    </>
  );
}
