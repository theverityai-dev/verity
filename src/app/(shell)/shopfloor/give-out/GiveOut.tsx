"use client";

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

/**
 * S3. A bundle waiting at one of my stages is a card with its lot's picture. Choosing it shows which karigars are set up for
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
  const [basis, setBasis] = useState("");

  const card = waiting.find((w) => `${w.bundleId}:${w.stageId}` === key);
  const reworkOnly = card ? card.toIssue === 0 && card.reworkPool > 0 : false;
  const asRework = rework || reworkOnly;
  const room = card ? (asRework ? card.reworkPool : card.toIssue) : 0;
  const worker = workers.find((w) => w.id === workerId);
  const hasRate = !card || !worker ? true : worker.stageIds.includes(card.stageId);
  const valid = card !== undefined && workerId !== "" && hasRate && pieces >= 1 && pieces <= room;

  const choose = (w: FloorWaiting) => { setKey(`${w.bundleId}:${w.stageId}`); setRework(false); setPieces(Math.max(1, w.toIssue || w.reworkPool)); setDone(null); setFailure(null); };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!card || !valid) return;
    setFailure(null);
    start(async () => {
      const result = await runFloorCommand(ISSUE, { bundleId: card.bundleId, stageId: card.stageId, workerId, pieces, isRework: asRework || undefined, wageBasis: basis || undefined, dueDate: due || undefined }, "/shopfloor");
      if (result.ok) {
        setDone(`${t.gaveOut}: ${pieces} · ${card.bundleNumber} → ${worker?.name}`);
        setKey(""); setWorkerId(""); setDue(""); setBasis("");
        router.refresh();
      } else setFailure(result);
    });
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={submit}>
      {done && <p role="status" className="m-0 rounded-[12px] bg-state-completed-fill px-4 py-3 text-[15px] font-medium text-state-completed-on">{done}</p>}
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
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}{w.piecesHeld > 0 ? ` · ${t.holds} ${w.piecesHeld}` : ""}{!w.stageIds.includes(card.stageId) ? ` (${t.noRate})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            {!hasRate && <p role="alert" className="m-0 text-[13px]" style={{ color: "var(--color-state-blocked)" }}>{worker?.name}: {t.noRate}</p>}

            {card.toIssue > 0 && card.reworkPool > 0 && (
              <Checkbox label={`${t.isRework} (${card.reworkPool})`} checked={rework} onChange={(e) => { setRework(e.target.checked); setPieces(1); }} />
            )}

            <div className="flex min-h-[60px] items-center justify-between gap-3">
              <span className="text-[17px] font-medium text-text">{t.pieces} <span className="text-[13px] font-normal text-text-secondary">({room})</span></span>
              <QuantityStepper label={t.pieces} value={pieces} onChange={setPieces} min={1} max={Math.max(1, room)} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.dueBack} htmlFor="go-due"><DateField id="go-due" value={due} onChange={setDue} min={today} /></Field>
              <Field label={t.wagePaidOn} htmlFor="go-basis">
                <Select id="go-basis" value={basis} onChange={(e) => setBasis(e.target.value)}>
                  <option value="">{t.usualBasis}</option>
                  <option value="issued">{t.basisIssued}</option>
                  <option value="good">{t.basisGood}</option>
                  <option value="returned">{t.basisReturned}</option>
                </Select>
              </Field>
            </div>
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
