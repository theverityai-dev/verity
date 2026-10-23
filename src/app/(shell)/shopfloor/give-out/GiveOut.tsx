"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { DateField } from "@/components/ui/DateTimePicker";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { Button, ButtonLink, Checkbox, ErrorState, Field, Select, Surface } from "@/components/ui/primitives";
import type { ActionFailure } from "@/server/platform/action-error";
import type { FloorWaiting, FloorWorker } from "@/server/capabilities/piecework";
import { LABELS, type Lang } from "../labels";
import { runFloorCommand } from "../actions";
import { Cover } from "../FloorChrome";

const ISSUE = "verity.piecework.record_issue";
const ACKS = ["signature", "attested"] as const;

/**
 * S3 · Give out. The receiver's count is the truth: the supervisor says how many pieces they handed over, the karigar counts them,
 * and what is recorded is the karigar's count, so a miscount at the door never becomes a loss on the floor. A handover that differs
 * shows up as a case. Several bundles given to one karigar in a row share one challan.
 *
 * A bundle waiting at one of my stages is a card with its lot's picture. Choosing it shows which karigars are set up for
 * that stage and what each already holds; a karigar with no rate for the stage is shown as such and refused by the ledger,
 * never silently paid at zero. No rate or wage appears here: the supervisor sees whether a rate exists, not what it is.
 */
export function GiveOut({ lang, waiting, workers, today, initial }: {
  lang: Lang; waiting: FloorWaiting[]; workers: FloorWorker[]; today: string; initial?: { bundleId: string; stageId: string; rework: boolean };
}) {
  const t = LABELS[lang];
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [key, setKey] = useState(initial ? `${initial.bundleId}:${initial.stageId}` : "");
  const [rework, setRework] = useState(initial?.rework ?? false);
  const [workerId, setWorkerId] = useState("");
  const [pieces, setPieces] = useState(1);
  const [due, setDue] = useState("");
  const [counted, setCounted] = useState(1);
  const [ack, setAck] = useState<(typeof ACKS)[number]>("signature");
  const [last, setLast] = useState<{ number: string; workerId: string } | null>(null);

  const card = waiting.find((w) => `${w.bundleId}:${w.stageId}` === key);
  const reworkOnly = card ? card.toIssue === 0 && card.reworkPool > 0 : false;
  const asRework = rework || reworkOnly;
  const room = card ? (asRework ? card.reworkPool : card.toIssue) : 0;
  const worker = workers.find((w) => w.id === workerId);
  // Only karigars set up for this stage are offered: a supervisor cannot set a rate, and the ledger refuses an unrated worker anyway.
  const eligible = card ? workers.filter((w) => w.stageIds.includes(card.stageId)) : workers;
  const valid = card !== undefined && worker !== undefined && eligible.some((w) => w.id === worker.id) && pieces >= 1 && pieces <= room && counted >= 1 && counted <= pieces;

  const choose = (w: FloorWaiting) => { setKey(`${w.bundleId}:${w.stageId}`); setRework(false); const n = Math.max(1, w.toIssue || w.reworkPool); setPieces(n); setCounted(n); setDone(null); setFailure(null); };
  const joins = last !== null && last.workerId === workerId;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!card || !valid) return;
    setFailure(null);
    start(async () => {
      const result = await runFloorCommand<{ id: string; challanNumber: string }>(ISSUE, { bundleId: card.bundleId, stageId: card.stageId, workerId, pieces: counted, sentPieces: pieces, ackMethod: ack, challanNumber: joins ? last!.number : undefined, isRework: asRework || undefined, dueDate: due || undefined }, "/shopfloor");
      if (result.ok) {
        setDone(`${t.gaveOut}: ${counted} · ${card.bundleNumber} → ${worker?.name}`);
        setLast({ number: result.data.challanNumber, workerId });
        setKey(""); setDue("");
        router.refresh();
      } else setFailure(result);
    });
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={submit}>
      {done && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-state-completed-fill px-4 py-3 text-[15px] font-medium text-state-completed-on">
          <span>{done}{last ? ` · ${last.number}` : ""}</span>
          {last && <Link href={`/shopfloor/challan/${last.number}`} className="inline-flex min-h-11 items-center rounded-[10px] bg-[rgba(255,255,255,0.22)] px-4 font-semibold text-state-completed-on no-underline active:scale-[0.98]">{t.printChallan}</Link>}
        </div>
      )}
      {failure && <ErrorState title={t.refusedTitle} message={failure.message} issues={failure.issues} retryable={failure.retryable} />}

      {!card ? (
        waiting.length === 0 ? (
          <Surface className="p-6"><p className="m-0 text-[15px] text-text-secondary">{t.nothingWaiting}</p></Surface>
        ) : (
          <div className="flex flex-col gap-3">
            <h2 className="micro m-0 px-1">{t.pickBundle}</h2>
            <ul className="m-0 grid list-none gap-3 p-0" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))" }}>
              {waiting.map((w) => (
                <li key={`${w.bundleId}:${w.stageId}`} className="list-none">
                  <button type="button" onClick={() => choose(w)} className="glass-card flex min-h-[88px] w-full cursor-pointer items-center gap-3.5 p-4 text-left transition-[transform] duration-150 active:scale-[0.99]">
                    <Cover src={w.cover} label={w.lotNumber} size={56} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[16px] font-semibold text-text">{w.bundleNumber} · {w.stageLabel}</span>
                      <span className="block text-[13px] text-text-secondary">{w.lotName}</span>
                      <span className="block text-[13px] text-text-secondary">
                        {w.toIssue > 0 && `${w.toIssue} ${t.toIssue}`}{w.toIssue > 0 && w.reworkPool > 0 && " · "}{w.reworkPool > 0 && <span style={{ color: "var(--color-state-pending)" }}>{w.reworkPool} {t.reworkWaiting}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      ) : (
        <>
          <Surface className="flex items-center gap-3.5 p-4">
            <Cover src={card.cover} label={card.lotNumber} size={52} />
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate text-[17px] font-semibold text-text">{card.bundleNumber} · {card.stageLabel}</p>
              <p className="m-0 text-[13px] text-text-secondary">{card.lotName}</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setKey("")}>↺</Button>
          </Surface>

          <Surface className="flex flex-col gap-4 p-4 sm:p-5">
            <Field label={t.karigar} htmlFor="go-worker" required>
              <Select id="go-worker" value={workerId} onChange={(e) => setWorkerId(e.target.value)} required>
                <option value="" disabled>{t.pickKarigar}</option>
                {eligible.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}{w.piecesHeld > 0 ? ` · ${t.holds} ${w.piecesHeld}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            {workers.length > eligible.length && <p className="m-0 text-[13px] text-text-tertiary">{workers.length - eligible.length} {t.notListedNoRate}</p>}
            {eligible.length === 0 && <p role="alert" className="m-0 text-[13px]" style={{ color: "var(--color-state-blocked)" }}>{t.noKarigarForStage}</p>}

            {card.toIssue > 0 && card.reworkPool > 0 && (
              <Checkbox label={`${t.isRework} (${card.reworkPool})`} checked={rework} onChange={(e) => { setRework(e.target.checked); setPieces(1); }} />
            )}

            <div className="flex min-h-[60px] items-center justify-between gap-3">
              <span className="text-[17px] font-medium text-text">{t.handingOver} <span className="text-[13px] font-normal text-text-secondary">({room})</span></span>
              <QuantityStepper label={t.handingOver} value={pieces} onChange={(n) => { setPieces(n); setCounted(Math.min(counted === pieces ? n : counted, n)); }} min={1} max={Math.max(1, room)} />
            </div>
            <div className="flex min-h-[60px] items-center justify-between gap-3">
              <span className="text-[17px] font-medium text-text">{t.karigarCounted}</span>
              <QuantityStepper label={t.karigarCounted} value={counted} onChange={setCounted} min={1} max={Math.max(1, pieces)} />
            </div>
            {counted !== pieces && <p role="status" className="m-0 rounded-[12px] px-4 py-3 text-[14px] font-medium" style={{ background: "var(--color-control)", color: "var(--color-state-pending-ink, var(--color-text))" }}>{t.countDiffers}</p>}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.dueBack} htmlFor="go-due"><DateField id="go-due" value={due} onChange={setDue} min={today} /></Field>
              <Field label={t.confirmedBy} htmlFor="go-ack">
                <Select id="go-ack" value={ack} onChange={(e) => setAck(e.target.value as (typeof ACKS)[number])}>
                  <option value="signature">{t.ackSigned}</option>
                  <option value="attested">{t.ackAttested}</option>
                </Select>
              </Field>
            </div>
            {joins && <p className="m-0 text-[13px] text-text-secondary">{t.challan}: {last!.number}</p>}
          </Surface>

          <div className="sticky bottom-3 z-10">
            <CommandButton commands={ISSUE} type="submit" variant="primary" className="min-h-14 w-full text-[17px]" disabled={pending || !valid}>{pending ? t.saving : t.giveOutNow}</CommandButton>
          </div>
        </>
      )}
      <div className="flex"><ButtonLink href="/shopfloor" variant="ghost">{t.backToFloor}</ButtonLink></div>
    </form>
  );
}
