"use client";

import { useState } from "react";
import { CommandFailure, formText, useCommand } from "@/components/ui/CommandForm";
import { Button, Field, Input, Panel, RowList, Row, Select } from "@/components/ui/primitives";

export type CashMovementItem = { id: string; direction: "in" | "out"; kind: string; amountMinor: number; reason: string; at: string };

const KINDS = {
  in: [
    { value: "float", label: "Float top-up" },
    { value: "owner_injection", label: "Owner put money in" },
    { value: "other", label: "Other" },
  ],
  out: [
    { value: "petty_cash", label: "Petty cash" },
    { value: "owner_drawing", label: "Owner took money out" },
    { value: "bank_deposit", label: "Taken to the bank" },
    { value: "other", label: "Other" },
  ],
} as const;

const rupees = (minor: number) => (minor / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const label = (direction: "in" | "out", kind: string) => KINDS[direction].find((k) => k.value === kind)?.label ?? kind;

/**
 * Task 125 item 4.1 — cash that enters or leaves the till without being a sale,
 * refund or approved expense. Entries cannot be edited or deleted; a mistake is
 * corrected by an opposite entry. The reconciliation counts them as in minus out.
 */
export function CashMovements({
  locations,
  locationId,
  date,
  movements,
}: {
  locations: Array<{ id: string; name: string }>;
  locationId: string;
  date: string;
  movements: CashMovementItem[];
}) {
  const [direction, setDirection] = useState<"in" | "out">("out");
  const record = useCommand("/cash-reconciliation");
  const inMinor = movements.filter((m) => m.direction === "in").reduce((s, m) => s + m.amountMinor, 0);
  const outMinor = movements.filter((m) => m.direction === "out").reduce((s, m) => s + m.amountMinor, 0);

  return (
    <Panel title="Cash in and out" className="mt-6">
      <form method="get" action="/cash-reconciliation" className="mb-4 grid items-end gap-3 sm:grid-cols-3">
        <Field label="Outlet" htmlFor="mv-outlet">
          <Select id="mv-outlet" name="outlet" defaultValue={locationId}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
        <Field label="Day" htmlFor="mv-date">
          <Input id="mv-date" name="date" type="date" defaultValue={date} />
        </Field>
        <Button type="submit" variant="secondary">Show this day</Button>
      </form>

      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          record.run("verity.finance.record_cash_movement", {
            locationId,
            date,
            direction,
            kind: formText(form, "kind"),
            amountMinor: Math.round(Number(formText(form, "amount")) * 100),
            reason: formText(form, "reason"),
          });
        }}
      >
        <Field label="Direction" htmlFor="mv-direction">
          <Select id="mv-direction" value={direction} onChange={(e) => setDirection(e.target.value as "in" | "out")}>
            <option value="out">Cash out of the till</option>
            <option value="in">Cash into the till</option>
          </Select>
        </Field>
        <Field label="What for" htmlFor="mv-kind" required>
          <Select id="mv-kind" name="kind" key={direction} defaultValue={KINDS[direction][0].value}>
            {KINDS[direction].map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </Select>
        </Field>
        <Field label="Amount (₹)" htmlFor="mv-amount" required>
          <Input id="mv-amount" name="amount" type="number" min={0.01} step="0.01" inputMode="decimal" required />
        </Field>
        <Field label="Reason" htmlFor="mv-reason" required hint="Required. This cannot be edited later; a mistake is fixed with an opposite entry.">
          <Input id="mv-reason" name="reason" required minLength={3} maxLength={300} placeholder="Gas cylinder, cash paid to the delivery boy" />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={record.pending || locationId === ""}>{record.pending ? "Saving…" : "Record"}</Button>
        </div>
      </form>
      <CommandFailure failure={record.failure} title="Could not record" />

      <div className="mt-6 border-t border-line pt-4">
        {movements.length === 0 ? (
          <p className="m-0 text-[13px] text-text-tertiary">Nothing recorded for this day.</p>
        ) : (
          <>
            <RowList>
              {movements.map((m) => (
                <Row key={m.id} className="justify-between">
                  <span className="min-w-0 text-text">
                    {label(m.direction, m.kind)}
                    <span className="block text-[13px] text-text-secondary">{m.reason}</span>
                  </span>
                  <span className="tabular shrink-0 font-medium text-text">
                    {m.direction === "in" ? "+" : "−"} {rupees(m.amountMinor)}
                  </span>
                </Row>
              ))}
            </RowList>
            <p className="m-0 mt-3 text-[13px] text-text-secondary">
              In {rupees(inMinor)}, out {rupees(outMinor)}. The reconciliation for this day counts these.
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}
