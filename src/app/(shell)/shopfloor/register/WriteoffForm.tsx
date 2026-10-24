"use client";

import { useState } from "react";
import { CommandButton } from "@/components/ui/CommandAccess";
import { FormModal, useCommand } from "@/components/ui/CommandForm";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { Field, Input } from "@/components/ui/primitives";
import { LABELS, type Lang } from "../labels";

const REQUEST = "verity.piecework.request_approval";

/** Asks the manager to write off short pieces that cannot be found. Opens as a sheet like every other form; nothing changes until someone else decides. */
export function WriteoffForm({ lang, entryId, open }: { lang: Lang; entryId: string; open: number }) {
  const t = LABELS[lang];
  const { run, pending, failure, clear } = useCommand("/shopfloor/register");
  const [asking, setAsking] = useState(false);
  const [pieces, setPieces] = useState(open);
  const [why, setWhy] = useState("");
  const [sent, setSent] = useState(false);

  if (sent) return <p role="status" className="m-0 text-[14px] text-text-secondary">{t.requestSent}</p>;

  return (
    <>
      <CommandButton commands={REQUEST} type="button" variant="secondary" onClick={() => { clear(); setAsking(true); }}>{t.requestWriteoff}</CommandButton>
      <FormModal
        open={asking} onClose={() => setAsking(false)}
        title={t.requestWriteoff} description={t.shortExplain}
        submitLabel={t.sendRequest} pendingLabel={t.saving} submitDisabled={why.trim().length < 3}
        pending={pending} failure={failure} failureTitle={t.refusedTitle}
        onSubmit={() => run(REQUEST, { kind: "writeoff", entryId, pieces, reason: why }, () => { setSent(true); setAsking(false); })}
      >
        <div className="flex min-h-[60px] items-center justify-between gap-3">
          <span className="text-[17px] font-medium text-text">{t.pieces}</span>
          <QuantityStepper label={t.pieces} value={pieces} onChange={setPieces} min={1} max={open} />
        </div>
        <Field label={t.writeoffReason} htmlFor={`wo-${entryId}`} required>
          <Input id={`wo-${entryId}`} value={why} onChange={(e) => setWhy(e.target.value)} minLength={3} maxLength={300} required autoFocus />
        </Field>
      </FormModal>
    </>
  );
}
