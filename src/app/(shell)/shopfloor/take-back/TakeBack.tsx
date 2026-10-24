"use client";

import { Icon } from "@/components/ui/icons";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { PhotoCapture } from "@/components/ui/PhotoCapture";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { Button, ButtonLink, ErrorState, Field, Input, Select, Surface } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import type { FloorIssue } from "@/server/capabilities/piecework";
import { shortDate } from "../../lots/format";
import { LABELS, type Lang } from "../labels";
import { runFloorCommand } from "../actions";
import { Cover, TONE } from "../FloorChrome";

const RETURN = "verity.piecework.record_return";
const daysBetween = (from: string, to: string) => Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));
const REQUEST = "verity.piecework.request_approval";
const ENTRY_ENTITY = "verity.piecework.entry";

type Saved = { entryId: string; rejected: number; rework: number; short: number; open: number; issue: FloorIssue; challan: string; chargeRequested: boolean };
export type ReasonChoice = { labelEn: string; labelHi: string; active: boolean };

/**
 * S2. Counts are entered with plus and minus, so a mistyped digit cannot add a zero. The line under the counters says what
 * the ledger will accept, in the chosen language, and Save stays disabled while the counts exceed what is out. After saving
 * the entry cannot be edited, only reversed, so the follow-ups (a photograph, a deduction request) hang off the saved entry.
 */
export function TakeBack({ lang, issues, initialIssueId, today, reasons }: { lang: Lang; issues: FloorIssue[]; initialIssueId?: string; today: string; reasons: { defect: ReasonChoice[]; short: ReasonChoice[] } }) {
  const t = LABELS[lang];
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [issueId, setIssueId] = useState(issues.find((i) => i.issueId === initialIssueId)?.issueId ?? "");
  const [good, setGood] = useState(0);
  const [rejected, setRejected] = useState(0);
  const [rework, setRework] = useState(0);
  const [short, setShort] = useState(0);
  const [reason, setReason] = useState("");
  const [shortReason, setShortReason] = useState("");
  const [detail, setDetail] = useState("");
  const [saved, setSaved] = useState<Saved | null>(null);

  const issue = issues.find((i) => i.issueId === issueId);
  const total = good + rejected + rework + short;
  const open = issue?.open ?? 0;
  const needsReason = rejected + rework > 0;
  const valid = issue !== undefined && total > 0 && total <= open && (!needsReason || reason !== "") && (short === 0 || shortReason !== "");

  const byWorker = useMemo(() => {
    const m = new Map<string, FloorIssue[]>();
    for (const i of issues) m.set(i.workerName, [...(m.get(i.workerName) ?? []), i]);
    return [...m.entries()];
  }, [issues]);

  // The factory words its own reasons, in both languages. The English wording is what is recorded, so the manager reads one thing.
  const label = (r: ReasonChoice) => (lang === "hi" ? r.labelHi : r.labelEn);
  const defectChoices = reasons.defect.filter((r) => r.active);
  const shortChoices = reasons.short.filter((r) => r.active);

  const reset = () => { setGood(0); setRejected(0); setRework(0); setShort(0); setReason(""); setShortReason(""); setDetail(""); };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!issue || !valid) return;
    setFailure(null);
    start(async () => {
      const note = [needsReason ? reason : "", short > 0 ? shortReason : "", detail.trim()].filter(Boolean).join(": ") || undefined;
      const result = await runFloorCommand<{ id: string; open: number; challanNumber: string }>(RETURN, { issueId: issue.issueId, good, rejected, rework, short, note }, "/shopfloor");
      if (result.ok) {
        setSaved({ entryId: result.data.id, rejected, rework, short, open: result.data.open, issue, challan: result.data.challanNumber, chargeRequested: result.data.chargeRequested === true });
        reset();
        router.refresh();
      } else setFailure(result);
    });
  };

  if (saved) return <AfterSave lang={lang} saved={saved} onAnother={() => { setSaved(null); setIssueId(""); }} />;

  if (issues.length === 0) return <Surface className="p-6"><p className="m-0 text-[15px] text-text-secondary">{t.nothingOut}</p></Surface>;

  return (
    <form className="flex flex-col gap-6" onSubmit={submit}>
      {failure && <ErrorState title={t.refusedTitle} message={failure.message} issues={failure.issues} retryable={failure.retryable} />}

      {!issue ? (
        <div className="flex flex-col gap-5">
          <h2 className="micro m-0 px-1">{t.pickIssue}</h2>
          {byWorker.map(([name, rows]) => (
            <div key={name} className="flex flex-col gap-2.5">
              <p className="m-0 px-1 text-[15px] font-semibold text-text"><Link href={`/shopfloor/karigar/${rows[0]!.workerId}`} className="text-text no-underline hover:underline">{name}</Link> <span className="font-normal text-text-secondary">· {rows.reduce((s, r) => s + r.open, 0)} {t.stillOut}</span></p>
              <ul className="m-0 grid list-none gap-3 p-0" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))" }}>
                {rows.map((i) => (
                  <li key={i.issueId} className="list-none">
                    <button type="button" onClick={() => setIssueId(i.issueId)} className="glass-card flex min-h-[84px] w-full cursor-pointer items-center gap-3.5 p-4 text-left transition-[transform] duration-150 active:scale-[0.99]">
                      <Cover src={i.cover} label={i.lotNumber} size={52} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[16px] font-semibold text-text">{i.bundleNumber} · {i.stageLabel}{i.isRework ? ` · ${t.rework}` : ""}</span>
                        <span className="block text-[13px] text-text-secondary">{i.open} {t.of} {i.issued} {t.stillOut} · {t.due} {shortDate(i.dueDate)}</span>
                      </span>
                      {i.late && <span className="shrink-0 text-[13px] font-semibold" style={{ color: "var(--color-state-blocked)" }}>{daysBetween(i.dueDate!, today)} {t.daysLate}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <>
          <Surface className="flex items-center gap-3.5 p-4">
            <Cover src={issue.cover} label={issue.lotNumber} size={52} />
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate text-[17px] font-semibold text-text">{issue.bundleNumber} · {issue.stageLabel}</p>
              <p className="m-0 text-[13px] text-text-secondary">{issue.workerName} · {issue.open} {t.of} {issue.issued} {t.stillOut}</p>
            </div>
            <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => { setIssueId(""); reset(); }}><Icon name="collapse" size={16} />{t.change}</Button>
          </Surface>

          <Surface className="flex flex-col gap-1 p-2 sm:p-3">
            {([
              [t.good, good, setGood, TONE.done],
              [t.rejected, rejected, setRejected, TONE.rejected],
              [t.rework, rework, setRework, TONE.rework],
              [t.short, short, setShort, TONE.short],
            ] as const).map(([label, value, set, tone]) => (
              <div key={label} className="flex min-h-[60px] items-center justify-between gap-3 px-3">
                <span className="flex items-center gap-2.5 text-[17px] font-medium text-text">
                  <span aria-hidden="true" className="size-2.5 rounded-full" style={{ backgroundColor: tone }} />
                  {label}
                </span>
                <QuantityStepper label={label} value={value} onChange={set} min={0} max={open} />
              </div>
            ))}
          </Surface>

          <p role="status" aria-live="polite" className="m-0 rounded-[12px] px-4 py-3 text-[15px] font-medium" style={total > open ? { background: "var(--color-danger-subtle, rgba(255,69,58,0.14))", color: "var(--color-danger-ink)" } : { background: "var(--color-control)", color: "var(--color-text)" }}>
            {total > open
              ? t.moreThanOut
              : `${t.accounted} ${total} ${t.of} ${open}. ${total === open ? t.fullySettled : total > 0 ? `${open - total} ${t.willStayOpen}.` : ""}`}
          </p>
          <p className="m-0 -mt-3 px-1 text-[13px] text-text-tertiary">{t.shortExplain}</p>

          {(needsReason || short > 0) && (
            <Surface className="flex flex-col gap-4 p-4">
              {needsReason && (
                <Field label={t.reason} htmlFor="tb-reason" required>
                  <Select id="tb-reason" value={reason} onChange={(e) => setReason(e.target.value)} required>
                    <option value="" disabled>{t.reasonRequired}</option>
                    {defectChoices.map((r) => <option key={r.labelEn} value={r.labelEn}>{label(r)}</option>)}
                  </Select>
                </Field>
              )}
              {short > 0 && (
                <Field label={t.reasonShort} htmlFor="tb-short" required>
                  <Select id="tb-short" value={shortReason} onChange={(e) => setShortReason(e.target.value)} required>
                    <option value="" disabled>{t.reasonRequired}</option>
                    {shortChoices.map((r) => <option key={r.labelEn} value={r.labelEn}>{label(r)}</option>)}
                  </Select>
                </Field>
              )}
              <Field label={t.reasonNote} htmlFor="tb-detail">
                <Input id="tb-detail" value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={200} />
              </Field>
            </Surface>
          )}

          <div className="sticky bottom-3 z-10">
            <CommandButton commands={RETURN} type="submit" variant="primary" className="min-h-14 w-full text-[17px]" disabled={pending || !valid}>
              {pending ? t.saving : t.save}
            </CommandButton>
          </div>
        </>
      )}
      <span className="sr-only">{today}</span>
    </form>
  );
}

function AfterSave({ lang, saved, onAnother }: { lang: Lang; saved: Saved; onAnother: () => void }) {
  const t = LABELS[lang];
  const [photoDone, setPhotoDone] = useState(false);
  const [asking, setAsking] = useState(false);
  const [amount, setAmount] = useState("");
  const [why, setWhy] = useState("");
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, start] = useTransition();
  const hasDefect = saved.rejected + saved.rework > 0;

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    setFailure(null);
    start(async () => {
      const result = await runCommand(REQUEST, { kind: "deduction", workerId: saved.issue.workerId, entryId: saved.entryId, amountMinor: Math.round(Number(amount) * 100), reason: why }, "/shopfloor/approvals");
      if (result.ok) setSent(true); else setFailure(result);
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <Surface className="p-5">
        <p role="status" className="m-0 text-[17px] font-semibold text-text">{t.entered}: {saved.issue.bundleNumber} · {saved.issue.workerName}</p>
        <p className="m-0 mt-1 text-[14px] text-text-secondary">{saved.open === 0 ? t.fullySettled : `${saved.open} ${t.willStayOpen}.`}</p>
        {saved.short > 0 && <p className="m-0 mt-2 text-[14px] text-text-secondary">{saved.chargeRequested ? t.shortCharged : t.shortExplain} <Link href="/shopfloor/cases" className="font-medium text-accent-ink">{t.cases}</Link></p>}
        <p className="m-0 mt-3"><Link href={`/shopfloor/challan/${saved.challan}`} className="inline-flex min-h-11 items-center rounded-[10px] bg-[var(--color-control)] px-4 text-[15px] font-semibold text-text no-underline active:scale-[0.98]">{t.printChallan} · {saved.challan}</Link></p>
      </Surface>

      {hasDefect && (
        <Surface className="flex flex-col gap-3 p-5">
          <h3 className="m-0 text-[16px] font-medium text-text">{t.addPhoto}</h3>
          <PhotoCapture entityKey={ENTRY_ENTITY} entityId={saved.entryId} revalidate="/shopfloor/approvals" onCaptured={(id) => setPhotoDone(id !== null)} />
          {photoDone && <p className="m-0 text-[13px] text-text-secondary">{t.saved}</p>}
        </Surface>
      )}

      {saved.rejected > 0 && (
        <Surface className="flex flex-col gap-3 p-5">
          {sent ? (
            <p role="status" className="m-0 text-[15px] text-text">{t.requestSent}</p>
          ) : !asking ? (
            <Button type="button" variant="secondary" onClick={() => setAsking(true)}>{t.requestDeduction}</Button>
          ) : (
            <form className="flex flex-col gap-3" onSubmit={send}>
              {failure && <ErrorState title={t.refusedTitle} message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
              <Field label={t.deductionAmount} htmlFor="ded-amt" required><Input id="ded-amt" type="number" inputMode="decimal" min={1} step="1" value={amount} onChange={(e) => setAmount(e.target.value)} required /></Field>
              <Field label={t.deductionReason} htmlFor="ded-why" required><Input id="ded-why" value={why} onChange={(e) => setWhy(e.target.value)} minLength={3} maxLength={300} required /></Field>
              <CommandButton commands={REQUEST} type="submit" variant="primary" disabled={pending || !amount || why.trim().length < 3}>{pending ? t.saving : t.sendRequest}</CommandButton>
            </form>
          )}
        </Surface>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Button type="button" variant="secondary" className="min-h-14" onClick={onAnother}>{t.takeBack}</Button>
        <ButtonLink href="/shopfloor" variant="primary" className="min-h-14">{t.backToFloor}</ButtonLink>
      </div>
    </div>
  );
}
