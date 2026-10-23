"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { DateField } from "@/components/ui/DateTimePicker";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { FormModal } from "@/components/ui/CommandForm";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import { toPaise } from "../lots/format";

const RECEIVE = "verity.piecework.receive_rolls";

/**
 * Receive the rolls of one invoice. Rolls are entered as "how many, how long": ten rolls of 48 m is one line, and each still gets its own
 * number and its own label. Fabric types already received are offered, and a new one is just typed; there is no master list to maintain.
 */
export function ReceiveRolls({ fabricTypes, today }: { fabricTypes: string[]; today: string }) {
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
        supplier: supplier.trim() || undefined, invoiceNumber: invoice.trim() || undefined,
        rateMinor: rate.trim() ? toPaise(rate) ?? undefined : undefined, receivedOn: day || undefined,
      }, "/fabric");
      if (result.ok) { setOpen(false); router.push(`/fabric/labels?ids=${result.data!.rollIds.join(",")}`); } else setFailure(result);
    });
  };

  return (
    <>
      <CommandButton commands={RECEIVE} variant="primary" onClick={() => setOpen(true)}>Receive rolls</CommandButton>
      <FormModal
        open={open} onClose={() => setOpen(false)} width="lg"
        title="Receive rolls" description="One invoice, one fabric. Each roll gets a number and a label with a QR to stick on it."
        submitLabel="Receive and print labels" pendingLabel="Receiving…" submitDisabled={!linesOk || type.trim() === ""}
        pending={pending} failure={failure} failureTitle="The rolls were not received" onSubmit={submit}
      >
          <div className="grid gap-3 sm:grid-cols-[1.6fr_1fr]">
            <Field label="Fabric" htmlFor="rr-type" required>
              <Input id="rr-type" list="rr-types" value={type} onChange={(e) => setType(e.target.value)} maxLength={80} placeholder="Poplin, 60 count, white" required autoFocus />
              <datalist id="rr-types">{fabricTypes.map((t) => <option key={t} value={t} />)}</datalist>
            </Field>
            <Field label="Measured in" htmlFor="rr-unit">
              <Select id="rr-unit" value={unit} onChange={(e) => setUnit(e.target.value as "m" | "kg")}>
                <option value="m">Metres</option>
                <option value="kg">Kilograms</option>
              </Select>
            </Field>
          </div>

          <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
            <legend className="mb-1 px-1 text-[15px] font-medium text-text">Rolls</legend>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] items-end gap-2">
                <Field label="How many" htmlFor={`rr-n-${i}`}><Input id={`rr-n-${i}`} type="number" inputMode="numeric" min={1} max={100} step={1} value={l.count} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, count: e.target.value } : x)))} /></Field>
                <Field label={`Each (${unit})`} htmlFor={`rr-q-${i}`}><Input id={`rr-q-${i}`} type="number" inputMode="decimal" min={0.01} step="0.01" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /></Field>
                <Button type="button" variant="ghost" size="sm" aria-label="Remove this line" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</Button>
              </div>
            ))}
            <div><Button type="button" variant="secondary" size="sm" onClick={() => setLines([...lines, { count: "1", qty: "" }])}>Rolls of another length</Button></div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Supplier" htmlFor="rr-sup"><Input id="rr-sup" value={supplier} onChange={(e) => setSupplier(e.target.value)} maxLength={120} /></Field>
            <Field label="Invoice number" htmlFor="rr-inv"><Input id="rr-inv" value={invoice} onChange={(e) => setInvoice(e.target.value)} maxLength={60} /></Field>
            <Field label={`Rate per ${unit} (₹)`} htmlFor="rr-rate" hint="Optional. Lets a lot show what its fabric cost."><Input id="rr-rate" type="number" inputMode="decimal" min={0} step="0.5" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
            <Field label="Received on" htmlFor="rr-day"><DateField id="rr-day" value={day} onChange={setDay} /></Field>
          </div>

          <p role="status" className="m-0 rounded-[12px] bg-[var(--color-control)] px-4 py-3 text-[15px] font-medium text-text">
            {linesOk ? `${rolls} roll${rolls === 1 ? "" : "s"}, ${(total / 100).toLocaleString("en-IN")} ${unit}` : "Say how many rolls and how long each is."}
          </p>
      </FormModal>
    </>
  );
}
