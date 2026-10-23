"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { FormModal } from "@/components/ui/CommandForm";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

const CUT = "verity.piecework.cut_lot";

export type RollChoice = { id: string; number: string; fabricType: string; unit: string; balanceCenti: number };

const centi = (v: string) => Math.round(Number(v) * 100);
const metres = (c: number, unit: string) => `${(c / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${unit}`;

/**
 * Cutting a lot in one step: which rolls the fabric came from and how much, and what the cut produced as bundles ("12 bundles of 25,
 * size M"). The system numbers the bundles and opens the sheet of slips to print. Fabric is optional (a lot may be cut from stock
 * that was never rolled), but when given it leaves the roll's balance, so the roll page and the lot agree.
 */
export function CutLot({ lotId, lotNumber, rolls, label = "Cut the lot" }: { lotId: string; lotNumber: string; rolls: RollChoice[] | null; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, start] = useTransition();
  const [groups, setGroups] = useState([{ copies: "1", pieces: "", size: "" }]);
  const [fabric, setFabric] = useState<Array<{ rollId: string; amount: string }>>([]);

  const parsed = groups.map((g) => ({ copies: Number(g.copies), netPieces: Number(g.pieces), sizeNote: g.size.trim() || undefined }));
  const okGroups = parsed.length > 0 && parsed.every((g) => Number.isInteger(g.copies) && g.copies >= 1 && Number.isInteger(g.netPieces) && g.netPieces >= 1);
  const bundles = okGroups ? parsed.reduce((s, g) => s + g.copies, 0) : 0;
  const pieces = okGroups ? parsed.reduce((s, g) => s + g.copies * g.netPieces, 0) : 0;
  const rollOf = (id: string) => rolls?.find((r) => r.id === id);
  const fabricOk = fabric.every((f) => f.rollId && centi(f.amount) >= 1 && centi(f.amount) <= (rollOf(f.rollId)?.balanceCenti ?? 0));

  const submit = () => {
    setFailure(null);
    start(async () => {
      const result = await runCommand<{ bundleIds: string[] }>(CUT, {
        lotId, groups: parsed,
        fabric: fabric.length > 0 ? fabric.map((f) => ({ rollId: f.rollId, quantityCenti: centi(f.amount) })) : undefined,
      }, `/lots/${lotId}`);
      if (result.ok) { setOpen(false); router.push(`/lots/${lotId}/slips`); } else setFailure(result);
    });
  };

  return (
    <>
      <CommandButton commands={CUT} variant="primary" onClick={() => setOpen(true)}>{label}</CommandButton>
      <FormModal
        open={open} onClose={() => setOpen(false)} width="lg"
        title={`Cut ${lotNumber}`} description="Say where the fabric came from and what the cut gave. Every bundle gets its own number and a slip with a QR."
        submitLabel="Cut and open the slips" pendingLabel="Cutting…" submitDisabled={!okGroups || !fabricOk}
        pending={pending} failure={failure} failureTitle="The lot was not cut" onSubmit={submit}
      >

          {rolls !== null && (
            <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
              <legend className="mb-1 px-1 text-[15px] font-medium text-text">Fabric from rolls <span className="font-normal text-text-secondary">(optional)</span></legend>
              {fabric.map((f, i) => {
                const roll = rollOf(f.rollId);
                return (
                  <div key={i} className="grid grid-cols-[1.6fr_1fr_auto] items-end gap-2">
                    <Field label="Roll" htmlFor={`cut-roll-${i}`}>
                      <Select id={`cut-roll-${i}`} value={f.rollId} onChange={(e) => setFabric(fabric.map((x, j) => (j === i ? { ...x, rollId: e.target.value } : x)))}>
                        <option value="" disabled>Choose a roll</option>
                        {rolls.filter((r) => r.id === f.rollId || !fabric.some((x) => x.rollId === r.id)).map((r) => <option key={r.id} value={r.id}>{r.number} · {r.fabricType} · {metres(r.balanceCenti, r.unit)} left</option>)}
                      </Select>
                    </Field>
                    <Field label={`Used (${roll?.unit ?? "m"})`} htmlFor={`cut-amt-${i}`}>
                      <Input id={`cut-amt-${i}`} type="number" inputMode="decimal" min={0.01} step="0.01" value={f.amount} onChange={(e) => setFabric(fabric.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                    </Field>
                    <Button type="button" variant="ghost" size="sm" aria-label="Remove this roll" onClick={() => setFabric(fabric.filter((_, j) => j !== i))}>Remove</Button>
                  </div>
                );
              })}
              {rolls.length > fabric.length ? (
                <div><Button type="button" variant="secondary" size="sm" onClick={() => setFabric([...fabric, { rollId: "", amount: "" }])}>{fabric.length === 0 ? "Take fabric from a roll" : "Another roll"}</Button></div>
              ) : fabric.length === 0 && <p className="m-0 text-[13px] text-text-secondary">No roll has fabric left. Receive rolls on the Fabric page first.</p>}
            </fieldset>
          )}

          <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
            <legend className="mb-1 px-1 text-[15px] font-medium text-text">Bundles</legend>
            {groups.map((g, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1.2fr_auto] items-end gap-2">
                <Field label="How many" htmlFor={`cut-n-${i}`}><Input id={`cut-n-${i}`} type="number" inputMode="numeric" min={1} max={200} step={1} value={g.copies} onChange={(e) => setGroups(groups.map((x, j) => (j === i ? { ...x, copies: e.target.value } : x)))} /></Field>
                <Field label="Pieces each" htmlFor={`cut-p-${i}`}><Input id={`cut-p-${i}`} type="number" inputMode="numeric" min={1} step={1} value={g.pieces} autoFocus={i === 0} onChange={(e) => setGroups(groups.map((x, j) => (j === i ? { ...x, pieces: e.target.value } : x)))} /></Field>
                <Field label="Size note" htmlFor={`cut-s-${i}`}><Input id={`cut-s-${i}`} maxLength={200} placeholder="M, or M and L" value={g.size} onChange={(e) => setGroups(groups.map((x, j) => (j === i ? { ...x, size: e.target.value } : x)))} /></Field>
                <Button type="button" variant="ghost" size="sm" aria-label="Remove this line" disabled={groups.length === 1} onClick={() => setGroups(groups.filter((_, j) => j !== i))}>Remove</Button>
              </div>
            ))}
            <div><Button type="button" variant="secondary" size="sm" onClick={() => setGroups([...groups, { copies: "1", pieces: "", size: "" }])}>Another size or count</Button></div>
          </fieldset>

          <p role="status" className="m-0 rounded-[12px] bg-[var(--color-control)] px-4 py-3 text-[15px] font-medium text-text">
            {okGroups ? `${bundles} bundle${bundles === 1 ? "" : "s"}, ${pieces.toLocaleString("en-IN")} pieces` : "Fill in how many bundles and how many pieces in each."}
          </p>
      </FormModal>
    </>
  );
}
