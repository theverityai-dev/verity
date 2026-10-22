"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { Button, ErrorState, Field, Input } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import { LABELS, type Lang } from "../labels";

const REQUEST = "verity.piecework.request_approval";

/** Asks the manager to write off short pieces that cannot be found. Nothing changes until someone else decides. */
export function WriteoffForm({ lang, entryId, open }: { lang: Lang; entryId: string; open: number }) {
  const t = LABELS[lang];
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const [pieces, setPieces] = useState(open);
  const [why, setWhy] = useState("");
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [sent, setSent] = useState(false);

  if (sent) return <p role="status" className="m-0 text-[14px] text-text-secondary">{t.requestSent}</p>;
  if (!asking) return <Button type="button" variant="secondary" onClick={() => setAsking(true)}>{t.requestWriteoff}</Button>;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFailure(null);
    start(async () => {
      const result = await runCommand(REQUEST, { kind: "writeoff", entryId, pieces, reason: why }, "/shopfloor/register");
      if (result.ok) { setSent(true); router.refresh(); } else setFailure(result);
    });
  };

  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      {failure && <ErrorState title={t.refusedTitle} message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[15px] font-medium text-text">{t.pieces}</span>
        <QuantityStepper label={t.pieces} value={pieces} onChange={setPieces} min={1} max={open} />
      </div>
      <Field label={t.writeoffReason} htmlFor={`wo-${entryId}`} required>
        <Input id={`wo-${entryId}`} value={why} onChange={(e) => setWhy(e.target.value)} minLength={3} maxLength={300} required />
      </Field>
      <CommandButton commands={REQUEST} type="submit" variant="primary" disabled={pending || why.trim().length < 3}>{pending ? t.saving : t.sendRequest}</CommandButton>
    </form>
  );
}
