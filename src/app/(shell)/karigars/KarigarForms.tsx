"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Button, ErrorState, Field, Input } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import { toPaise } from "../lots/format";

const DEFINE = "verity.piecework.define_worker";

export function NewKarigarForm({ stages }: { stages: Array<{ id: string; label: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <CommandButton commands={DEFINE} variant="primary" onClick={() => setOpen(true)}>
        New karigar
      </CommandButton>
      <Modal open={open} onClose={() => setOpen(false)} title="New karigar" description="Name and mobile, and the rate per piece for each kind of work. A rate of 0 means the work is unpaid." width="lg">
        <form
          className="flex flex-col gap-4"
          action={(formData) => {
            setFailure(null);
            const text = (name: string) => String(formData.get(name) ?? "").trim();
            const rates = stages.flatMap((s) => {
              const paise = toPaise(text(`rate:${s.id}`));
              return paise === null ? [] : [{ stageId: s.id, rateMinor: paise }];
            });
            startTransition(async () => {
              const result = await runCommand<{ id: string }>(DEFINE, { name: text("name"), mobile: text("mobile") || undefined, rates }, "/karigars");
              if (result.ok) {
                setOpen(false);
                router.push(`/karigars/${result.data!.id}`);
              } else setFailure(result);
            });
          }}
        >
          {failure && <ErrorState title="Could not add the karigar" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="karigar-name" required>
              <Input id="karigar-name" name="name" required maxLength={120} autoFocus />
            </Field>
            <Field label="Mobile number" htmlFor="karigar-mobile">
              <Input id="karigar-mobile" name="mobile" type="tel" inputMode="tel" maxLength={20} />
            </Field>
          </div>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-1 text-[13px] font-medium text-text">Rate per piece, in rupees (leave blank for work this karigar does not do)</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {stages.map((s) => (
                <Field key={s.id} label={s.label} htmlFor={`rate-${s.id}`}>
                  <Input id={`rate-${s.id}`} name={`rate:${s.id}`} type="number" inputMode="decimal" min={0} step="0.01" placeholder="e.g. 12" />
                </Field>
              ))}
            </div>
          </fieldset>
          <div className="flex gap-2">
            <CommandButton commands={DEFINE} type="submit" variant="primary" disabled={pending}>
              {pending ? "Adding…" : "Add karigar"}
            </CommandButton>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
