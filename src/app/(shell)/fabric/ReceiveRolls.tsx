"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { DateField } from "@/components/ui/DateTimePicker";
import { Button, Checkbox, Field, Input, Select } from "@/components/ui/primitives";
import { FormModal } from "@/components/ui/CommandForm";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import { toPaise } from "../lots/format";
import { fill, type OfficeLabels } from "./office-labels";

const RECEIVE = "verity.piecework.receive_rolls";

/**
 * Receive the rolls of one invoice. Rolls are entered as "how many, how long": ten rolls of 48 m is one line, and each still gets its own
 * number and its own label. Fabric types already received are offered, and a new one is just typed; there is no master list to maintain.
 * Labels come in the language chosen on this device.
 */
export function ReceiveRolls({ o, fabricTypes, today, seen }: { o: OfficeLabels; fabricTypes: string[]; today: string; seen: Array<{ supplier: string | null; invoice: string; number: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, start] = useTransition();
  const [type, setType] = useState("");
  const [unit, setUnit] = useState<"m" | "kg">("m");
  const [supplier, setSupplier] = useState("");
  const [invoice, setInvoice] = useState("");
  const [rate, setRate] = useState("");
  const [day, setDay] = useState(today);
  const [lines, setLines] = useState([{ count: "1", qty: "" }]);
  const [again, setAgain] = useState(false);
  // Rolls already on the shelf when the factory starts using Verity: received with no invoice, tagged so the ledger says where they came from.
  const [opening, setOpening] = useState(false);
  // The same supplier's invoice number received before: warn here, and the server refuses it unless this is confirmed.
  const twice = opening || invoice.trim() === "" ? undefined : seen.find((r) => r.invoice.toLowerCase() === invoice.trim().toLowerCase() && (r.supplier ?? "").toLowerCase() === supplier.trim().toLowerCase());

  const parsed = lines.map((l) => ({ count: Number(l.count), centi: Math.round(Number(l.qty) * 100) }));
  const linesOk = parsed.every((l) => Number.isInteger(l.count) && l.count >= 1 && l.count <= 100 && l.centi >= 1);
  const rolls = linesOk ? parsed.reduce((s, l) => s + l.count, 0) : 0;
  const total = linesOk ? parsed.reduce((s, l) => s + l.count * l.centi, 0) : 0;

  const submit = () => {
    setFailure(null);
    start(async () => {
      const result = await runCommand<{ rollIds: string[] }>(RECEIVE, {
        fabricType: type.trim(), unit,
        quantitiesCenti: parsed.flatMap((l) => Array.from({ length: l.count }, () => l.centi)),
        supplier: supplier.trim() || undefined, invoiceNumber: opening ? undefined : invoice.trim() || undefined, note: opening ? "Opening stock" : undefined,
        rateMinor: rate.trim() ? toPaise(rate) ?? undefined : undefined, receivedOn: day || undefined, confirmDuplicate: twice ? again : undefined,
      }, "/fabric");
      if (result.ok) { setOpen(false); router.push(`/fabric/labels?ids=${result.data!.rollIds.join(",")}`); } else setFailure(result);
    });
  };

  return (
    <>
      <CommandButton commands={RECEIVE} variant="primary" onClick={() => setOpen(true)}>{o.receiveRolls}</CommandButton>
      <FormModal
        open={open} onClose={() => setOpen(false)} width="lg"
        title={opening ? o.rrOpeningTitle : o.receiveRolls} description={opening ? o.rrOpeningDesc : o.rrDesc}
        submitLabel={o.rrSubmit} pendingLabel={o.rrReceiving} submitDisabled={!linesOk || type.trim() === "" || (twice !== undefined && !again)}
        pending={pending} failure={failure} failureTitle={o.rrFailTitle} onSubmit={submit}
      >
          <div className="grid gap-3 sm:grid-cols-[1.6fr_1fr]">
            <Field label={o.fabricField} htmlFor="rr-type" required>
              <Input id="rr-type" list="rr-types" value={type} onChange={(e) => setType(e.target.value)} maxLength={80} placeholder={o.fabricPlaceholder} required autoFocus />
              <datalist id="rr-types">{fabricTypes.map((t) => <option key={t} value={t} />)}</datalist>
            </Field>
            <Field label={o.measuredIn} htmlFor="rr-unit">
              <Select id="rr-unit" value={unit} onChange={(e) => setUnit(e.target.value as "m" | "kg")}>
                <option value="m">{o.metres}</option>
                <option value="kg">{o.kilograms}</option>
              </Select>
            </Field>
          </div>

          <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
            <legend className="mb-1 px-1 text-[15px] font-medium text-text">{o.rollsLegend}</legend>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] items-end gap-2">
                <Field label={o.howMany} htmlFor={`rr-n-${i}`}><Input id={`rr-n-${i}`} type="number" inputMode="numeric" min={1} max={100} step={1} value={l.count} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, count: e.target.value } : x)))} /></Field>
                <Field label={fill(o.eachIn, { u: unit })} htmlFor={`rr-q-${i}`}><Input id={`rr-q-${i}`} type="number" inputMode="decimal" min={0.01} step="0.01" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /></Field>
                <Button type="button" variant="ghost" size="sm" aria-label={o.removeLineAria} disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>{o.removeLine}</Button>
              </div>
            ))}
            <div><Button type="button" variant="secondary" size="sm" onClick={() => setLines([...lines, { count: "1", qty: "" }])}>{o.anotherLength}</Button></div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={o.supplier} htmlFor="rr-sup"><Input id="rr-sup" value={supplier} onChange={(e) => setSupplier(e.target.value)} maxLength={120} /></Field>
            {!opening && <Field label={o.invoiceNumber} htmlFor="rr-inv"><Input id="rr-inv" value={invoice} onChange={(e) => setInvoice(e.target.value)} maxLength={60} /></Field>}
            <Field label={fill(o.ratePer, { u: unit })} htmlFor="rr-rate" hint={o.rateHint}><Input id="rr-rate" type="number" inputMode="decimal" min={0} step="0.5" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
            <Field label={o.receivedOn} htmlFor="rr-day"><DateField id="rr-day" value={day} onChange={setDay} /></Field>
          </div>

          <Checkbox label={o.openingTick} checked={opening} onChange={(e) => setOpening(e.target.checked)} />
          {twice && (
            <div role="alert" className="flex flex-col gap-2 rounded-[12px] px-4 py-3 text-[14px] text-text" style={{ background: "color-mix(in srgb, var(--color-state-pending) 16%, transparent)" }}>
              <p className="m-0">{fill(o.dupWarn, { inv: invoice.trim(), from: supplier.trim() ? fill(o.fromSup, { s: supplier.trim() }) : "", num: twice.number })}</p>
              <Checkbox label={o.dupAgain} checked={again} onChange={(e) => setAgain(e.target.checked)} />
            </div>
          )}
          <p role="status" className="m-0 rounded-[12px] bg-[var(--color-control)] px-4 py-3 text-[15px] font-medium text-text">
            {linesOk ? `${rolls} ${rolls === 1 ? o.roll : o.rolls}, ${(total / 100).toLocaleString("en-IN")} ${unit}` : o.rrNeed}
          </p>
      </FormModal>
    </>
  );
}
