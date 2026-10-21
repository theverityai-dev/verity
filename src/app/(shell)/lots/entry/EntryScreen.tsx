"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { DateField } from "@/components/ui/DateTimePicker";
import { Button, ErrorState, Field, Input, Select } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

const RECORD = "verity.piecework.record_entry";

export type EntryLot = {
  id: string;
  number: string;
  design: string;
  bundleSize: number;
  stages: Array<{ stageId: string; label: string; toIssue: number; pending: number; workers: Record<string, number> }>;
};
export type EntryWorker = { id: string; name: string; stageIds: string[] };

/**
 * The munshi's one screen: record pieces given out or received back. There is no size field, and the bundle count is
 * shown from the pieces, never typed. The hint under the form says what the ledger will accept, so a refusal is rare.
 */
export function EntryScreen({ lots, workers, today, initialLotId }: { lots: EntryLot[]; workers: EntryWorker[]; today: string; initialLotId?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const first = lots.find((l) => l.id === initialLotId) ?? lots[0];
  const [lotId, setLotId] = useState(first?.id ?? "");
  const [kind, setKind] = useState<"issue" | "receive">("issue");
  const [stageId, setStageId] = useState(first?.stages.find((s) => s.toIssue > 0)?.stageId ?? first?.stages[0]?.stageId ?? "");
  const [workerId, setWorkerId] = useState("");
  const [pieces, setPieces] = useState("");
  const [date, setDate] = useState(today);

  const lot = lots.find((l) => l.id === lotId);
  const stage = lot?.stages.find((s) => s.stageId === stageId);
  const worker = workers.find((w) => w.id === workerId);
  const count = Number(pieces);
  const valid = Number.isInteger(count) && count > 0;
  const bundles = lot && valid ? Math.ceil(count / lot.bundleSize) : 0;

  const hint = useMemo(() => {
    if (!lot || !stage) return null;
    if (kind === "issue") return `Up to ${stage.toIssue} pieces can be issued at ${stage.label} right now.`;
    if (!worker) return `${stage.pending} pieces are out at ${stage.label}. Pick the karigar who is returning them.`;
    return `${worker.name} has ${stage.workers[worker.id] ?? 0} pieces pending at ${stage.label}.`;
  }, [lot, stage, kind, worker]);

  const noRate = kind === "receive" && worker && stageId && !worker.stageIds.includes(stageId);

  const pickLot = (id: string) => {
    setLotId(id);
    const next = lots.find((l) => l.id === id);
    setStageId(next?.stages.find((s) => (kind === "issue" ? s.toIssue > 0 : s.pending > 0))?.stageId ?? next?.stages[0]?.stageId ?? "");
    setSaved(null);
  };

  if (lots.length === 0) {
    return <p className="m-0 text-[14px] text-text-secondary">There are no open lots. Create a lot first.</p>;
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setFailure(null);
        setSaved(null);
        startTransition(async () => {
          const result = await runCommand<{ bundles: number }>(
            RECORD,
            { lotId, stageId, workerId, kind, pieces: count, entryDate: date },
            "/lots/entry",
          );
          if (result.ok) {
            setSaved(`${kind === "issue" ? "Issued" : "Received"} ${count} pieces ${kind === "issue" ? "to" : "from"} ${worker?.name} at ${stage?.label}. ${result.data!.bundles} bundles.`);
            setPieces("");
            router.refresh();
          } else setFailure(result);
        });
      }}
    >
      {failure && <ErrorState title="That entry was not saved" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
      {saved && (
        <p role="status" className="m-0 rounded-[12px] bg-state-completed-fill px-4 py-3 text-[14px] font-medium text-state-completed-ink">
          {saved}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Date" htmlFor="entry-date" required hint="Today unless you are writing up an earlier day.">
          <DateField id="entry-date" value={date} onChange={setDate} required />
        </Field>
        <Field label="Lot" htmlFor="entry-lot" required>
          <Select id="entry-lot" value={lotId} onChange={(e) => pickLot(e.target.value)} required>
            {lots.map((l) => (
              <option key={l.id} value={l.id}>{l.number} · {l.design}</option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex flex-col gap-1">
        <span className="px-1 text-[13px] text-text-secondary" id="entry-kind-label">Entry type</span>
        <div role="group" aria-labelledby="entry-kind-label" className="grid grid-cols-2 gap-2">
          {(["issue", "receive"] as const).map((k) => (
            <Button
              key={k}
              type="button"
              variant={kind === k ? "primary" : "secondary"}
              aria-pressed={kind === k}
              onClick={() => { setKind(k); setSaved(null); }}
            >
              {k === "issue" ? "Issue (given out)" : "Receive (came back)"}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Stage" htmlFor="entry-stage" required>
          <Select id="entry-stage" value={stageId} onChange={(e) => { setStageId(e.target.value); setSaved(null); }} required>
            {lot?.stages.map((s) => (
              <option key={s.stageId} value={s.stageId}>{s.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Karigar" htmlFor="entry-karigar" required>
          <Select id="entry-karigar" value={workerId} onChange={(e) => { setWorkerId(e.target.value); setSaved(null); }} required>
            <option value="" disabled>Select a karigar</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}{kind === "receive" && stageId && !w.stageIds.includes(stageId) ? " (no rate for this stage)" : ""}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr]">
        <Field label="Pieces" htmlFor="entry-pieces" required hint="Pieces are counted as plain numbers. There is no size.">
          <Input id="entry-pieces" type="number" inputMode="numeric" min={1} step={1} value={pieces} onChange={(e) => { setPieces(e.target.value); setSaved(null); }} required />
        </Field>
        <Field label="Bundles (automatic)" htmlFor="entry-bundles" hint={`${lot?.bundleSize ?? 20} pieces to a bundle. Counted for you.`}>
          <Input id="entry-bundles" value={valid ? String(bundles) : "—"} readOnly tabIndex={-1} aria-live="polite" />
        </Field>
      </div>

      {hint && <p className="m-0 text-[13px] text-text-secondary" aria-live="polite">{hint}</p>}
      {noRate && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {worker?.name} has no rate for {stage?.label}. Set it on the karigar&apos;s page first; this entry will be refused until then.
        </p>
      )}

      <div>
        <CommandButton commands={RECORD} type="submit" variant="primary" disabled={pending || !valid || !workerId || !stageId}>
          {pending ? "Saving…" : "Save entry"}
        </CommandButton>
      </div>
    </form>
  );
}
