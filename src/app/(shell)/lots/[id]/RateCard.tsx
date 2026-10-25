"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Checkbox, ErrorState, Field, Input } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import type { RateCardRow } from "@/server/capabilities/piecework";
import { rupees, toPaise } from "../format";

const SET = "verity.piecework.set_lot_rates";
const text = (minor: number | null) => (minor === null ? "" : String(minor / 100));

/**
 * What each stage pays on THIS lot, and what a lost piece costs. An empty rate means "use the stage's default" and the placeholder
 * shows what that is, so the card is never ambiguous. A stage the lot does not use is unticked: its pieces go on to the next one.
 * A stage that already has work on the lot cannot be unticked.
 */
export function RateCard({ lotId, rows, factoryCharge, canEdit }: { lotId: string; rows: RateCardRow[]; factoryCharge: number | null; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState(() => rows.map((r) => ({ stageId: r.stageId, use: !r.skipped, rate: text(r.rateMinor), charge: text(r.lostPieceChargeMinor) })));
  const set = (stageId: string, patch: Partial<(typeof draft)[number]>) => { setSaved(false); setDraft(draft.map((d) => (d.stageId === stageId ? { ...d, ...patch } : d))); };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFailure(null);
    start(async () => {
      const result = await runCommand(SET, {
        lotId,
        rows: draft.map((d) => ({
          stageId: d.stageId,
          skipped: !d.use,
          rateMinor: d.use && d.rate.trim() !== "" ? toPaise(d.rate) : null,
          lostPieceChargeMinor: d.use && d.charge.trim() !== "" ? toPaise(d.charge) : null,
        })),
      }, `/lots/${lotId}`);
      if (result.ok) { setSaved(true); router.refresh(); } else setFailure(result);
    });
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      {failure && <ErrorState title="The rate card was not saved" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
      {/* One row per stage: a list, not a grid of cells, so it stacks into one card per stage on a phone. */}
      <ul className="m-0 flex list-none flex-col divide-y divide-[var(--color-line)] p-0" aria-label="Rate card for this lot, one row per stage">
        <li aria-hidden="true" className="hidden grid-cols-[1.3fr_0.9fr_1fr_1fr] gap-3 px-1 pb-2 text-[12px] text-text-secondary md:grid">
          <span>Stage</span><span>Used on this lot</span><span>Rate per piece (₹)</span><span>Lost piece (₹)</span>
        </li>
        {rows.map((r) => {
          const d = draft.find((x) => x.stageId === r.stageId)!;
          return (
            <li key={r.stageId} className={`grid grid-cols-2 items-center gap-3 px-1 py-3 md:grid-cols-[1.3fr_0.9fr_1fr_1fr] ${d.use ? "" : "opacity-70"}`}>
              <span className="text-[15px] font-medium text-text">
                {r.label}
                {r.hasWork && <span className="ml-2 text-[12px] font-normal text-text-tertiary">has work</span>}{!r.optional && <span className="ml-2 text-[12px] font-normal text-text-tertiary">required</span>}
              </span>
              <Checkbox label={d.use ? "Used" : "Skipped"} checked={d.use} disabled={!canEdit || (d.use && (r.hasWork || !r.optional))} onChange={(e) => set(r.stageId, { use: e.target.checked })} />
              <Field label="Rate per piece (₹)" htmlFor={`rc-rate-${r.stageId}`}>
                <Input id={`rc-rate-${r.stageId}`} type="number" inputMode="decimal" min={0} step="0.5" value={d.rate} disabled={!canEdit || !d.use}
                  placeholder={r.stageDefaultMinor === null ? "none" : `${rupees(r.stageDefaultMinor)} default`} onChange={(e) => set(r.stageId, { rate: e.target.value })} />
              </Field>
              <Field label="Lost piece (₹)" htmlFor={`rc-lost-${r.stageId}`}>
                <Input id={`rc-lost-${r.stageId}`} type="number" inputMode="decimal" min={0} step="1" value={d.charge} disabled={!canEdit || !d.use}
                  placeholder={factoryCharge === null ? "none" : `${rupees(factoryCharge)} factory`} onChange={(e) => set(r.stageId, { charge: e.target.value })} />
              </Field>
            </li>
          );
        })}
      </ul>
      <p className="m-0 text-[13px] leading-[19px] text-text-secondary">
        A rate here beats the karigar&apos;s own rate, which beats the stage default. Leave a box empty to use the grey figure. Changes apply to work from now on.
      </p>
      {canEdit && (
        <div className="flex items-center gap-3">
          <CommandButton commands={SET} type="submit" variant="primary" disabled={pending}>{pending ? "Saving…" : "Save rate card"}</CommandButton>
          {saved && <span role="status" className="text-[13px] text-text-secondary">Saved</span>}
        </div>
      )}
    </form>
  );
}
