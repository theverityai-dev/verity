"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { DateField } from "@/components/ui/DateTimePicker";
import { Button, Checkbox, ErrorState, Field, Input, Select } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import { LABELS, type Lang } from "../../shopfloor/labels";

const ISSUE = "verity.piecework.record_issue";
const RETURN = "verity.piecework.record_return";

export type EntryBundle = {
  id: string; number: string; lotNumber: string; netPieces: number;
  stages: Array<{ stageId: string; label: string; toIssue: number; reworkPool: number; pending: number }>;
};
export type OpenIssue = { issueId: string; bundleNumber: string; lotNumber: string; stageLabel: string; workerName: string; open: number; issued: number; isRework: boolean };
export type EntryWorker = { id: string; name: string; stageIds: string[] };

const num = (s: string) => (s.trim() === "" ? 0 : Number(s));

/**
 * The munshi's one screen. Issue gives a bundle to a karigar at a stage; Return settles one open issue and accounts for
 * its pieces as good, rejected, rework or short, so a missing piece is never silently classified. There is no size field.
 * The live line under the form says what the ledger will accept, so a refusal is rare.
 */
export function EntryScreen({ bundles, openIssues, workers, today, initialBundleId, lang = "en" }: {
  bundles: EntryBundle[]; openIssues: OpenIssue[]; workers: EntryWorker[]; today: string; initialBundleId?: string; lang?: Lang;
}) {
  const t = LABELS[lang];
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [mode, setMode] = useState<"issue" | "return">("issue");
  const [date, setDate] = useState(today);

  const firstBundle = bundles.find((b) => b.id === initialBundleId) ?? bundles[0];
  const [bundleId, setBundleId] = useState(firstBundle?.id ?? "");
  const [stageId, setStageId] = useState(firstBundle?.stages.find((s) => s.toIssue > 0)?.stageId ?? firstBundle?.stages[0]?.stageId ?? "");
  const [workerId, setWorkerId] = useState("");
  const [pieces, setPieces] = useState("");
  const [rework, setRework] = useState(false);
  const [basis, setBasis] = useState("");
  const [due, setDue] = useState("");

  const [issueId, setIssueId] = useState(openIssues[0]?.issueId ?? "");
  const [good, setGood] = useState("");
  const [rejected, setRejected] = useState("");
  const [reworkQty, setReworkQty] = useState("");
  const [short, setShort] = useState("");

  const bundle = bundles.find((b) => b.id === bundleId);
  const stage = bundle?.stages.find((s) => s.stageId === stageId);
  const worker = workers.find((w) => w.id === workerId);
  const count = num(pieces);
  const validIssue = Number.isInteger(count) && count > 0;
  const room = rework ? (stage?.reworkPool ?? 0) : (stage?.toIssue ?? 0);

  const line = openIssues.find((i) => i.issueId === issueId);
  const accounted = num(good) + num(rejected) + num(reworkQty) + num(short);
  const validReturn = [good, rejected, reworkQty, short].every((v) => v.trim() === "" || (Number.isInteger(Number(v)) && Number(v) >= 0)) && accounted > 0 && (line ? accounted <= line.open : false);

  const done = (message: string) => { setSaved(message); router.refresh(); };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFailure(null);
    setSaved(null);
    startTransition(async () => {
      if (mode === "issue") {
        const result = await runCommand(ISSUE, { bundleId, stageId, workerId, pieces: count, isRework: rework || undefined, wageBasis: basis || undefined, entryDate: date, dueDate: due || undefined }, "/lots/entry");
        if (result.ok) { setPieces(""); done(`${t.gaveOut}: ${count} · ${bundle?.number} → ${worker?.name} · ${stage?.label}`); } else setFailure(result);
      } else {
        const result = await runCommand<{ open: number }>(RETURN, { issueId, good: num(good), rejected: num(rejected), rework: num(reworkQty), short: num(short), entryDate: date }, "/lots/entry");
        if (result.ok) {
          setGood(""); setRejected(""); setReworkQty(""); setShort("");
          done(`${t.accounted} ${accounted} · ${line?.workerName}. ${result.data!.open === 0 ? t.fullySettled : `${result.data!.open} ${t.willStayOpen}.`}`);
        } else setFailure(result);
      }
    });
  };

  if (bundles.length === 0 && openIssues.length === 0) {
    return <p className="m-0 text-[14px] text-text-secondary">{t.noBundles}</p>;
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      {failure && <ErrorState title={t.refusedTitle} message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
      {saved && <p role="status" className="m-0 rounded-[12px] bg-state-completed-fill px-4 py-3 text-[14px] font-medium text-state-completed-on">{saved}</p>}

      <div role="group" aria-label={t.dailyEntry} className="grid grid-cols-2 gap-2">
        {(["issue", "return"] as const).map((m) => (
          <Button key={m} type="button" variant={mode === m ? "primary" : "secondary"} aria-pressed={mode === m} onClick={() => { setMode(m); setSaved(null); setFailure(null); }}>
            {m === "issue" ? t.giveOut : t.takeBack}
          </Button>
        ))}
      </div>

      <Field label={t.dateLabel} htmlFor="entry-date" required hint={t.dateHint}>
        <DateField id="entry-date" value={date} onChange={setDate} required />
      </Field>

      {mode === "issue" ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t.bundleLabel} htmlFor="entry-bundle" required>
              <Select id="entry-bundle" value={bundleId} onChange={(e) => { setBundleId(e.target.value); const b = bundles.find((x) => x.id === e.target.value); setStageId(b?.stages.find((s) => s.toIssue > 0)?.stageId ?? b?.stages[0]?.stageId ?? ""); setSaved(null); }} required>
                {bundles.map((b) => <option key={b.id} value={b.id}>{b.number} · {b.lotNumber} · {b.netPieces} pcs</option>)}
              </Select>
            </Field>
            <Field label={t.stageLabel} htmlFor="entry-stage" required>
              <Select id="entry-stage" value={stageId} onChange={(e) => { setStageId(e.target.value); setSaved(null); }} required>
                {bundle?.stages.map((s) => <option key={s.stageId} value={s.stageId}>{s.label}</option>)}
              </Select>
            </Field>
            <Field label={t.karigar} htmlFor="entry-karigar" required>
              <Select id="entry-karigar" value={workerId} onChange={(e) => { setWorkerId(e.target.value); setSaved(null); }} required>
                <option value="" disabled>{t.pickKarigar}</option>
                {workers.map((w) => <option key={w.id} value={w.id}>{w.name}{stageId && !w.stageIds.includes(stageId) ? " ({t.noRate})" : ""}</option>)}
              </Select>
            </Field>
            <Field label={t.pieces} htmlFor="entry-pieces" required hint={t.piecesHint}>
              <Input id="entry-pieces" type="number" inputMode="numeric" min={1} step={1} value={pieces} onChange={(e) => { setPieces(e.target.value); setSaved(null); }} required />
            </Field>
            <Field label={t.wagePaidOn} htmlFor="entry-basis">
              <Select id="entry-basis" value={basis} onChange={(e) => setBasis(e.target.value)}>
                <option value="">{t.usualBasis}</option>
                <option value="issued">{t.basisIssued}</option><option value="good">{t.basisGood}</option><option value="returned">{t.basisReturned}</option>
              </Select>
            </Field>
            <Field label={t.dueBack} htmlFor="entry-due">
              <DateField id="entry-due" value={due} onChange={setDue} min={date} />
            </Field>
          </div>
          {(stage?.reworkPool ?? 0) > 0 && <Checkbox label={`${t.isRework} (${stage?.reworkPool})`} checked={rework} onChange={(e) => setRework(e.target.checked)} />}
          <p className="m-0 text-[13px] text-text-secondary" aria-live="polite">
            {stage ? `Up to ${room} pieces can be ${rework ? "reissued as rework" : "issued"} at ${stage.label} right now.` : null}
            {worker && stageId && !worker.stageIds.includes(stageId) ? ` ${worker.name} has no rate for this stage; set it on the karigar's page first.` : ""}
          </p>
          <div>
            <CommandButton commands={ISSUE} type="submit" variant="primary" disabled={pending || !validIssue || !workerId || !stageId}>{pending ? t.saving : t.saveIssue}</CommandButton>
          </div>
        </>
      ) : (
        <>
          <Field label={t.pickIssue} htmlFor="entry-issue" required>
            <Select id="entry-issue" value={issueId} onChange={(e) => { setIssueId(e.target.value); setSaved(null); }} required>
              {openIssues.length === 0 && <option value="">{t.nothingOutShort}</option>}
              {openIssues.map((i) => <option key={i.issueId} value={i.issueId}>{i.bundleNumber} · {i.stageLabel} · {i.workerName} · {i.open} {t.of} {i.issued}{i.isRework ? ` (${t.rework})` : ""}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label={t.good} htmlFor="ret-good"><Input id="ret-good" type="number" inputMode="numeric" min={0} step={1} value={good} onChange={(e) => setGood(e.target.value)} /></Field>
            <Field label={t.rejected} htmlFor="ret-rej"><Input id="ret-rej" type="number" inputMode="numeric" min={0} step={1} value={rejected} onChange={(e) => setRejected(e.target.value)} /></Field>
            <Field label={t.rework} htmlFor="ret-rework"><Input id="ret-rework" type="number" inputMode="numeric" min={0} step={1} value={reworkQty} onChange={(e) => setReworkQty(e.target.value)} /></Field>
            <Field label={t.short} htmlFor="ret-short"><Input id="ret-short" type="number" inputMode="numeric" min={0} step={1} value={short} onChange={(e) => setShort(e.target.value)} /></Field>
          </div>
          <p className="m-0 text-[13px] text-text-secondary" aria-live="polite">
            {line
              ? `${t.accounted} ${accounted} ${t.of} ${line.open}. ${accounted > line.open ? t.moreThanOut : accounted === line.open ? t.fullySettled : `${line.open - accounted} ${t.willStayOpen}.`}`
              : t.pickIssue}
            {" "}{t.shortExplain}
          </p>
          <div>
            <CommandButton commands={RETURN} type="submit" variant="primary" disabled={pending || !validReturn}>{pending ? t.saving : t.saveReturn}</CommandButton>
          </div>
        </>
      )}
    </form>
  );
}
