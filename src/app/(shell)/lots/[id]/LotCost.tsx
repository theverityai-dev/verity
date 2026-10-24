"use client";

import { useState } from "react";
import { CommandButton } from "@/components/ui/CommandAccess";
import { FormModal, useCommand } from "@/components/ui/CommandForm";
import { DateField } from "@/components/ui/DateTimePicker";
import { Checkbox, Field, Input, Row, RowList, Select } from "@/components/ui/primitives";
import type { LotCosting } from "@/server/capabilities/piecework";
import { rupees, shortDate, toPaise } from "../format";

const ADD = "verity.piecework.add_lot_cost";
const REVERSE = "verity.piecework.reverse_lot_cost";

/** Splits paise over weights so the parts add up exactly; the same rule the server applies, shown before saving. */
function split(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const parts = exact.map(Math.floor);
  let left = total - parts.reduce((s, x) => s + x, 0);
  for (const [, i] of exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1])) {
    if (left-- <= 0) break;
    parts[i]! += 1;
  }
  return parts;
}

type OtherLot = { id: string; label: string; pieces: number };

/**
 * What this lot cost, built from its parts: fabric and wages come from records already kept, other costs are entered by the factory's
 * own categories, and charges recovered from karigars come off. One figure answers the owner's question (cost per good piece);
 * every line under it says where it came from. A cost shared with other lots shows its split before it is saved.
 */
export function LotCost({ lotId, lotNumber, pieces, costing, categories, otherLots, today, canAdd }: {
  lotId: string; lotNumber: string; pieces: number; costing: LotCosting; categories: string[]; otherLots: OtherLot[]; today: string; canAdd: boolean;
}) {
  const path = `/lots/${lotId}`;
  const add = useCommand(path);
  const reverse = useCommand(path);
  const [open, setOpen] = useState(false);
  const [undo, setUndo] = useState<{ id: string; label: string } | null>(null);
  const [category, setCategory] = useState(categories[0] ?? "");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState(today);
  const [shareWith, setShareWith] = useState<string[]>([]);

  const paise = toPaise(amount) ?? 0;
  const sharing = [{ id: lotId, label: lotNumber, pieces }, ...otherLots.filter((l) => shareWith.includes(l.id))];
  const parts = split(paise, sharing.map((l) => l.pieces));

  const breakdown: Array<[string, number | null, string?]> = [
    ["Fabric", costing.fabricMinor, costing.fabricMinor === null ? "No roll with an invoice rate yet" : undefined],
    ["Wages", costing.wagesMinor],
    ...costing.other.map((o): [string, number] => [o.category, o.amountMinor]),
    ...(costing.recoveredMinor > 0 ? [["Charged to karigars for lost pieces", -costing.recoveredMinor] as [string, number]] : []),
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="micro m-0">Cost per good piece</p>
          <p className="figure m-0 text-[40px] text-text">{costing.perGoodPieceMinor === null ? "—" : rupees(costing.perGoodPieceMinor)}</p>
          <p className="m-0 text-[13px] text-text-secondary">{rupees(costing.totalMinor)} over {costing.goodPieces.toLocaleString("en-IN")} good piece{costing.goodPieces === 1 ? "" : "s"} so far</p>
        </div>
        {canAdd && <CommandButton commands={ADD} variant="secondary" onClick={() => { add.clear(); setOpen(true); }}>Add a cost</CommandButton>}
      </div>

      <dl className="m-0 flex flex-col divide-y divide-[var(--color-line)]">
        {breakdown.map(([label, value, note]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 py-2">
            <dt className="text-[14px] text-text-secondary">{label}{note && <span className="ml-2 text-[12px] text-text-tertiary">{note}</span>}</dt>
            <dd className="m-0 text-[15px] tabular-nums text-text">{value === null ? "—" : rupees(value)}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3 py-2">
          <dt className="text-[14px] font-medium text-text">Total so far</dt>
          <dd className="m-0 text-[15px] font-medium tabular-nums text-text">{rupees(costing.totalMinor)}</dd>
        </div>
      </dl>

      {costing.lines.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[14px] font-medium text-accent-ink">Every cost entered ({costing.lines.length})</summary>
          <RowList>
            {costing.lines.map((l) => (
              <Row key={l.id} className={l.reversed || l.isReversal ? "opacity-70" : ""}>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[14px] font-medium text-text">{l.isReversal ? "Reversed: " : ""}{l.category} · {rupees(l.amountMinor)}{l.shared ? <span className="ml-2 text-[12px] font-normal text-text-tertiary">shared</span> : null}</span>
                  <span className="text-[13px] text-text-secondary">{shortDate(l.incurredOn)}{l.note ? ` · ${l.note}` : ""}</span>
                </div>
                {canAdd && !l.isReversal && !l.reversed && (
                  <CommandButton commands={REVERSE} variant="ghost" size="sm" onClick={() => { reverse.clear(); setUndo({ id: l.id, label: `${l.category} ${rupees(l.amountMinor)}` }); }}>Reverse</CommandButton>
                )}
              </Row>
            ))}
          </RowList>
        </details>
      )}

      <FormModal
        open={open} onClose={() => setOpen(false)}
        title="Add a cost" description="Thread, buttons, packing or anything else this lot used. Share it when one bill covers several lots."
        submitLabel={sharing.length > 1 ? `Add to ${sharing.length} lots` : "Add cost"} submitDisabled={paise <= 0 || category === ""}
        pending={add.pending} failure={add.failure} failureTitle="The cost was not added"
        onSubmit={(fd) => add.run(ADD, {
          lotIds: sharing.map((l) => l.id), category, amountMinor: paise, incurredOn: day || undefined,
          note: String(fd.get("note") ?? "").trim() || undefined,
        }, () => { setOpen(false); setAmount(""); setShareWith([]); })}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Category" htmlFor="lc-cat" required>
            <Select id="lc-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Amount (₹)" htmlFor="lc-amt" required>
            <Input id="lc-amt" type="number" inputMode="decimal" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </Field>
          <Field label="Date" htmlFor="lc-day"><DateField id="lc-day" value={day} onChange={setDay} /></Field>
          <Field label="Note" htmlFor="lc-note"><Input id="lc-note" name="note" maxLength={300} placeholder="bill number, supplier" /></Field>
        </div>
        {otherLots.length > 0 && (
          <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
            <legend className="mb-1 px-1 text-[15px] font-medium text-text">Share with other lots <span className="font-normal text-text-secondary">(split by pieces cut)</span></legend>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {otherLots.map((l) => (
                <Checkbox key={l.id} label={`${l.label} · ${l.pieces.toLocaleString("en-IN")} pcs`} checked={shareWith.includes(l.id)}
                  onChange={(e) => setShareWith(e.target.checked ? [...shareWith, l.id] : shareWith.filter((x) => x !== l.id))} />
              ))}
            </div>
          </fieldset>
        )}
        {sharing.length > 1 && paise > 0 && (
          <ul role="status" className="m-0 flex list-none flex-col gap-1 rounded-[12px] bg-[var(--color-control)] px-4 py-3 text-[14px] text-text">
            {sharing.map((l, i) => <li key={l.id} className="flex justify-between gap-3"><span>{l.label}</span><span className="tabular-nums">{rupees(parts[i]!)}</span></li>)}
          </ul>
        )}
      </FormModal>

      <FormModal
        open={undo !== null} onClose={() => setUndo(null)} destructive
        title={`Reverse ${undo?.label ?? ""}?`} description="The line stays in the record with its reversal beside it. Add it again if it belongs elsewhere."
        submitLabel="Reverse it" pendingLabel="Reversing…"
        pending={reverse.pending} failure={reverse.failure} failureTitle="It was not reversed"
        onSubmit={(fd) => { if (undo) reverse.run(REVERSE, { costId: undo.id, reason: String(fd.get("reason") ?? "").trim() }, () => setUndo(null)); }}
      >
        <Field label="Why?" htmlFor="lc-why" required><Input id="lc-why" name="reason" required minLength={3} maxLength={300} autoFocus /></Field>
      </FormModal>
    </div>
  );
}
