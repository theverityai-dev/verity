"use client";

import { Icon } from "@/components/ui/icons";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Button, ErrorState, Field, Input, Textarea } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import { toPaise } from "../format";

const UPDATE_STAGE = "verity.piecework.update_stage";
const REORDER = "verity.piecework.reorder_stages";
const SET_SETTINGS = "verity.piecework.set_production_settings";
const SAVE_REASONS = "verity.piecework.save_reasons";
const PATH = "/lots/settings";

/** One command at a time, with the failure kept next to the form that caused it. */
function useSave() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [saved, setSaved] = useState(false);
  const run = (command: string, input: unknown) => {
    setFailure(null);
    setSaved(false);
    start(async () => {
      const result = await runCommand(command, input, PATH);
      if (result.ok) { setSaved(true); router.refresh(); } else setFailure(result);
    });
  };
  return { pending, failure, saved, run, forget: () => setSaved(false) };
}

const rupeeText = (minor: number | null) => (minor === null ? "" : String(minor / 100));

type StageRow = { id: string; label: string; sequence: number; defaultRateMinor: number | null; active: boolean; hasWork: boolean };

/**
 * The factory's stages, in order. Name and the rate a stage pays when neither the lot nor the karigar sets one are edited here.
 * The order is a ledger fact once any work exists, so the arrows are offered only before that and the page says why they are gone.
 */
export function StagesForm({ stages, canEdit }: { stages: StageRow[]; canEdit: boolean }) {
  const { pending, failure, saved, run } = useSave();
  const [rows, setRows] = useState(() => stages.map((s) => ({ ...s, rate: rupeeText(s.defaultRateMinor) })));
  const locked = stages.some((s) => s.hasWork);

  const move = (i: number, by: -1 | 1) => {
    const next = [...rows];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    setRows(next);
    run(REORDER, { stageIds: next.map((r) => r.id) });
  };
  const save = (r: (typeof rows)[number]) => {
    const paise = r.rate.trim() === "" ? null : toPaise(r.rate);
    run(UPDATE_STAGE, { stageId: r.id, label: r.label.trim(), defaultRateMinor: paise });
  };

  return (
    <div className="flex flex-col gap-3">
      {failure && <ErrorState title="That was not saved" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
      <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
        {rows.map((r, i) => {
          const dirty = r.label.trim() !== stages.find((s) => s.id === r.id)!.label || (r.rate.trim() === "" ? null : toPaise(r.rate)) !== stages.find((s) => s.id === r.id)!.defaultRateMinor;
          return (
            <li key={r.id} className="grid items-end gap-3 rounded-[14px] border border-[var(--color-line)] p-3 sm:grid-cols-[auto_1.4fr_1fr_auto]">
              <span className="figure hidden size-9 place-items-center text-[20px] text-text-secondary sm:grid" aria-hidden="true">{i + 1}</span>
              <Field label="Stage name" htmlFor={`st-name-${r.id}`}>
                <Input id={`st-name-${r.id}`} value={r.label} maxLength={80} disabled={!canEdit} onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, label: e.target.value } : x)))} />
              </Field>
              <Field label="Default rate per piece (₹)" htmlFor={`st-rate-${r.id}`}>
                <Input id={`st-rate-${r.id}`} type="number" inputMode="decimal" min={0} step="0.5" placeholder="none" value={r.rate} disabled={!canEdit} onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, rate: e.target.value } : x)))} />
              </Field>
              {canEdit && (
                <div className="flex items-center gap-1.5">
                  {!locked && (
                    <>
                      <Button type="button" variant="ghost" size="sm" aria-label={`Move ${r.label} earlier`} disabled={pending || i === 0} onClick={() => move(i, -1)}><Icon name="collapse" size={16} className="rotate-90" /></Button>
                      <Button type="button" variant="ghost" size="sm" aria-label={`Move ${r.label} later`} disabled={pending || i === rows.length - 1} onClick={() => move(i, 1)}><Icon name="expand" size={16} className="rotate-90" /></Button>
                    </>
                  )}
                  <CommandButton commands={UPDATE_STAGE} type="button" variant="secondary" size="sm" disabled={pending || !dirty || r.label.trim() === ""} onClick={() => save(r)}>Save</CommandButton>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <p className="m-0 text-[13px] leading-[19px] text-text-secondary">
        {locked ? "Work has been recorded, so the order is fixed: a piece's stage is part of the record. A lot can still skip a stage on its own rate card." : "Order the stages as work flows. This locks once the first piece is given out."}
        {" "}Rates follow this order of precedence: the lot&apos;s rate card, then the karigar&apos;s own rate, then the default here.
      </p>
      {saved && <p role="status" className="m-0 text-[13px] text-text-secondary">Saved</p>}
    </div>
  );
}

export function ChargeForm({ lostPieceChargeMinor, canEdit }: { lostPieceChargeMinor: number | null; canEdit: boolean }) {
  const { pending, failure, saved, run, forget } = useSave();
  const [charge, setCharge] = useState(rupeeText(lostPieceChargeMinor));
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); run(SET_SETTINGS, { lostPieceChargeMinor: charge.trim() === "" ? null : toPaise(charge) }); }}>
      {failure && <ErrorState title="That was not saved" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
      <Field label="Charge for each lost piece (₹)" htmlFor="chg" hint="Leave empty to raise no charge. A lot can set its own figure on its rate card.">
        <Input id="chg" type="number" inputMode="decimal" min={0} step="1" placeholder="no charge" value={charge} disabled={!canEdit} onChange={(e) => { forget(); setCharge(e.target.value); }} />
      </Field>
      <p className="m-0 text-[13px] leading-[19px] text-text-secondary">A short return asks for this amount per missing piece, to be charged to the karigar who held them. It is a request: a manager or the owner decides it, within their limits. Nothing is deducted silently.</p>
      {canEdit && (
        <div className="flex items-center gap-3">
          <CommandButton commands={SET_SETTINGS} type="submit" variant="primary" disabled={pending}>{pending ? "Saving…" : "Save charge"}</CommandButton>
          {saved && <span role="status" className="text-[13px] text-text-secondary">Saved</span>}
        </div>
      )}
    </form>
  );
}

export function ChallanForm({ title, address, canEdit }: { title: string | null; address: string | null; canEdit: boolean }) {
  const { pending, failure, saved, run, forget } = useSave();
  const [t, setT] = useState(title ?? "");
  const [a, setA] = useState(address ?? "");
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); run(SET_SETTINGS, { challanTitle: t.trim() || null, challanAddress: a.trim() || null }); }}>
      {failure && <ErrorState title="That was not saved" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
      <Field label="Name on the challan" htmlFor="ch-title"><Input id="ch-title" value={t} maxLength={120} disabled={!canEdit} onChange={(e) => { forget(); setT(e.target.value); }} /></Field>
      <Field label="Address and phone" htmlFor="ch-addr"><Textarea id="ch-addr" rows={3} value={a} maxLength={300} disabled={!canEdit} onChange={(e) => { forget(); setA(e.target.value); }} /></Field>
      {canEdit && (
        <div className="flex items-center gap-3">
          <CommandButton commands={SET_SETTINGS} type="submit" variant="primary" disabled={pending}>{pending ? "Saving…" : "Save heading"}</CommandButton>
          {saved && <span role="status" className="text-[13px] text-text-secondary">Saved</span>}
        </div>
      )}
    </form>
  );
}

type Reason = { labelEn: string; labelHi: string; active: boolean };

/** One list of reasons. What is saved is the whole list; the floor screens offer exactly these, in this order, in each person's language. */
export function ReasonList({ kind, title, hint, initial, canEdit }: { kind: "defect" | "short" | "cost"; title: string; hint: string; initial: Reason[]; canEdit: boolean }) {
  const { pending, failure, saved, run, forget } = useSave();
  const [items, setItems] = useState<Reason[]>(initial);
  const edit = (i: number, patch: Partial<Reason>) => { forget(); setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x))); };
  const valid = items.length > 0 && items.every((x) => x.labelEn.trim() && x.labelHi.trim());

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="m-0 text-[15px] font-medium text-text">{title}</h3>
        <p className="m-0 mt-0.5 text-[13px] leading-[19px] text-text-secondary">{hint}</p>
      </div>
      {failure && <ErrorState title="That was not saved" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((r, i) => (
          <li key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
            <Input aria-label={`${title}: English wording ${i + 1}`} value={r.labelEn} maxLength={60} placeholder="English" disabled={!canEdit} onChange={(e) => edit(i, { labelEn: e.target.value })} />
            <Input aria-label={`${title}: Hindi wording ${i + 1}`} lang="hi" value={r.labelHi} maxLength={60} placeholder="हिंदी" disabled={!canEdit} onChange={(e) => edit(i, { labelHi: e.target.value })} />
            {canEdit && <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${r.labelEn || "this reason"}`} disabled={items.length === 1} onClick={() => { forget(); setItems(items.filter((_, j) => j !== i)); }}>Remove</Button>}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="ghost" size="sm" disabled={items.length >= 30} onClick={() => { forget(); setItems([...items, { labelEn: "", labelHi: "", active: true }]); }}>Add a reason</Button>
          <CommandButton commands={SAVE_REASONS} type="button" variant="secondary" size="sm" disabled={pending || !valid} onClick={() => run(SAVE_REASONS, { kind, items })}>{pending ? "Saving…" : "Save list"}</CommandButton>
          {saved && <span role="status" className="text-[13px] text-text-secondary">Saved</span>}
        </div>
      )}
    </div>
  );
}
