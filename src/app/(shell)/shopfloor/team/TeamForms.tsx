"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Checkbox, ErrorState, Field, Input } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

const SET_LIMITS = "verity.piecework.set_limits";
const ASSIGN = "verity.piecework.assign_stages";

export function LimitsForm({ limits, canEdit }: { limits: { deductionLimitMinor: number; writeoffLimitPieces: number }; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rupees, setRupees] = useState(String(limits.deductionLimitMinor / 100));
  const [pieces, setPieces] = useState(String(limits.writeoffLimitPieces));
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFailure(null);
    setSaved(false);
    start(async () => {
      const result = await runCommand(SET_LIMITS, { deductionLimitMinor: Math.round(Number(rupees) * 100), writeoffLimitPieces: Number(pieces) }, "/shopfloor/team");
      if (result.ok) { setSaved(true); router.refresh(); } else setFailure(result);
    });
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      {failure && <ErrorState title="That was not saved" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
      <Field label="Deduction a manager may approve (rupees)" htmlFor="lim-ded"><Input id="lim-ded" type="number" inputMode="decimal" min={0} step="1" value={rupees} onChange={(e) => setRupees(e.target.value)} disabled={!canEdit} /></Field>
      <Field label="Pieces a manager may write off" htmlFor="lim-pcs"><Input id="lim-pcs" type="number" inputMode="numeric" min={0} step="1" value={pieces} onChange={(e) => setPieces(e.target.value)} disabled={!canEdit} /></Field>
      {canEdit && (
        <div className="flex items-center gap-3">
          <CommandButton commands={SET_LIMITS} type="submit" variant="primary" disabled={pending}>{pending ? "Saving…" : "Save limits"}</CommandButton>
          {saved && <span role="status" className="text-[13px] text-text-secondary">Saved</span>}
        </div>
      )}
    </form>
  );
}

export function StageAssignment({ userId, stages, assigned, canEdit }: { userId: string; stages: Array<{ id: string; label: string }>; assigned: string[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState(new Set(assigned));
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = picked.size !== assigned.length || assigned.some((id) => !picked.has(id));

  const toggle = (id: string) => { setSaved(false); setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const save = () => {
    setFailure(null);
    start(async () => {
      const result = await runCommand(ASSIGN, { userId, stageIds: [...picked] }, "/shopfloor/team");
      if (result.ok) { setSaved(true); router.refresh(); } else setFailure(result);
    });
  };

  return (
    <div className="flex flex-col gap-2.5">
      {failure && <ErrorState title="That was not saved" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {stages.map((s) => <Checkbox key={s.id} label={s.label} checked={picked.has(s.id)} disabled={!canEdit} onChange={() => toggle(s.id)} />)}
      </div>
      {canEdit && (dirty || saved) && (
        <div className="flex items-center gap-3">
          <CommandButton commands={ASSIGN} type="button" variant="secondary" size="sm" disabled={pending || !dirty} onClick={save}>{pending ? "Saving…" : "Save stages"}</CommandButton>
          {saved && !dirty && <span role="status" className="text-[13px] text-text-secondary">Saved</span>}
        </div>
      )}
    </div>
  );
}
