"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Field, Input, Select } from "@/components/ui/primitives";
import { FormModal } from "@/components/ui/CommandForm";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import { BASIS_LABEL, toPaise } from "../lots/format";

const DEFINE = "verity.piecework.define_worker";

export function NewKarigarForm({ stages }: { stages: Array<{ id: string; label: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <CommandButton commands={DEFINE} variant="primary" onClick={() => setOpen(true)}>New karigar or unit</CommandButton>
      <FormModal
        open={open} onClose={() => setOpen(false)} title="New karigar or outside unit" description="Name, contact, and for each kind of work the rate per piece and what it is paid on. A rate of 0 means the work is unpaid." width="lg"
        submitLabel="Add karigar" pendingLabel="Adding…"
        pending={pending} failure={failure} failureTitle="Could not add the karigar"
        onSubmit={(formData) => {
            setFailure(null);
            const text = (name: string) => String(formData.get(name) ?? "").trim();
            const rates = stages.flatMap((s) => {
              const paise = toPaise(text(`rate:${s.id}`));
              return paise === null ? [] : [{ stageId: s.id, rateMinor: paise, wageBasis: text(`basis:${s.id}`) || "good" }];
            });
            startTransition(async () => {
              const result = await runCommand<{ id: string }>(DEFINE, { name: text("name"), mobile: text("mobile") || undefined, kind: text("kind") || "in_house", address: text("address") || undefined, rates }, "/karigars");
              if (result.ok) {
                setOpen(false);
                router.push(`/karigars/${result.data!.id}`);
              } else setFailure(result);
            });
          }}
      >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="karigar-name" required><Input id="karigar-name" name="name" required maxLength={120} autoFocus /></Field>
            <Field label="Mobile number" htmlFor="karigar-mobile"><Input id="karigar-mobile" name="mobile" type="tel" inputMode="tel" maxLength={20} /></Field>
            <Field label="Works" htmlFor="karigar-kind">
              <Select id="karigar-kind" name="kind" defaultValue="in_house">
                <option value="in_house">In the factory</option>
                <option value="outside">Outside unit</option>
              </Select>
            </Field>
            <Field label="Address" htmlFor="karigar-address"><Input id="karigar-address" name="address" maxLength={300} /></Field>
          </div>
          <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
            <legend className="mb-1 text-[13px] font-medium text-text">Rate per piece, in rupees, for the work this karigar does (leave blank for work they do not do)</legend>
            {stages.map((s) => (
              <div key={s.id} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_9rem_1fr]">
                <span className="self-center text-[14px] text-text">{s.label}</span>
                <Field label="Rate" htmlFor={`rate-${s.id}`}><Input id={`rate-${s.id}`} name={`rate:${s.id}`} type="number" inputMode="decimal" min={0} step="0.01" placeholder="e.g. 12" /></Field>
                <Field label="Paid on" htmlFor={`basis-${s.id}`}>
                  <Select id={`basis-${s.id}`} name={`basis:${s.id}`} defaultValue="good">
                    {Object.entries(BASIS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
              </div>
            ))}
          </fieldset>
      </FormModal>
    </>
  );
}
