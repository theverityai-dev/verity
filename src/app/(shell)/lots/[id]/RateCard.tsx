"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Checkbox, ErrorState, Input } from "@/components/ui/primitives";
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
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left text-[14px]">
          <caption className="sr-only">Rate card for this lot, one row per stage</caption>
          <thead>
            <tr className="text-[12px] text-text-secondary">
              <th scope="col" className="px-3 pb-2 font-normal">Stage</th>
              <th scope="col" className="px-3 pb-2 font-normal">Used</th>
              <th scope="col" className="px-3 pb-2 font-normal">Rate per piece (₹)</th>
              <th scope="col" className="px-3 pb-2 font-normal">Lost piece (₹)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = draft.find((x) => x.stageId === r.stageId)!;
              return (
                <tr key={r.stageId} className="border-t border-[var(--color-line)] align-middle">
                  <th scope="row" className="px-3 py-2.5 text-[15px] font-medium text-text">
                    {r.label}
                    {r.hasWork && <span className="ml-2 text-[12px] font-normal text-text-tertiary">has work</span>}
                  </th>
                  <td className="px-3 py-2.5">
                    <Checkbox label={d.use ? "Yes" : "Skipped"} checked={d.use} disabled={!canEdit || (r.hasWork && d.use)} onChange={(e) => set(r.stageId, { use: e.target.checked })} />
                  </td>
                  <td className="px-3 py-2.5">
                    <Input aria-label={`${r.label} rate per piece in rupees`} type="number" inputMode="decimal" min={0} step="0.5" className="max-w-[9rem]" value={d.rate} disabled={!canEdit || !d.use}
                      placeholder={r.stageDefaultMinor === null ? "none" : `${rupees(r.stageDefaultMinor)} default`} onChange={(e) => set(r.stageId, { rate: e.target.value })} />
                  </td>
                  <td className="px-3 py-2.5">
                    <Input aria-label={`${r.label} charge per lost piece in rupees`} type="number" inputMode="decimal" min={0} step="1" className="max-w-[9rem]" value={d.charge} disabled={!canEdit || !d.use}
                      placeholder={factoryCharge === null ? "none" : `${rupees(factoryCharge)} factory`} onChange={(e) => set(r.stageId, { charge: e.target.value })} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
