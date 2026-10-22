"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { ErrorState, Field, Surface, Textarea } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import { LABELS, type Lang } from "../labels";

const CLOSE = "verity.piecework.close_day";

export function DayCloseForm({ lang }: { lang: Lang }) {
  const t = LABELS[lang];
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [failure, setFailure] = useState<ActionFailure | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFailure(null);
    start(async () => {
      const result = await runCommand(CLOSE, { note: note.trim() || undefined, lang }, "/shopfloor/day-close");
      if (result.ok) router.refresh(); else setFailure(result);
    });
  };

  return (
    <form onSubmit={submit}>
      <Surface className="flex flex-col gap-4 p-6">
        {failure && <ErrorState title={t.refusedTitle} message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
        <Field label={t.handoverNote} htmlFor="dc-note" hint={t.handoverHint}>
          <Textarea id="dc-note" lang={lang} rows={4} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <CommandButton commands={CLOSE} type="submit" variant="primary" className="min-h-14 w-full text-[17px] sm:w-auto" disabled={pending}>{pending ? t.saving : t.closeTheDay}</CommandButton>
      </Surface>
    </form>
  );
}
