"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Button, Field, Input, Textarea } from "@/components/ui/primitives";
import { FormModal, formText } from "@/components/ui/CommandForm";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

const COMMAND = "verity.manufacturing.create_route";

/** A stage's stable key, made from what the person typed: "Cut & Bind" -> "cut_bind". */
export function stageKeyFor(label: string): string {
  const key = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return /^[a-z]/.test(key) ? key : `s_${key}`.slice(0, 40);
}

/**
 * Turns a stage's checklist text into checkpoints. One item per line; `[photo]`
 * makes evidence mandatory, `[note]` makes remarks mandatory. Keys are derived
 * from the label and de-duplicated, so two similar lines cannot collide.
 */
export function parseChecklist(text: string) {
  const seen = new Map<string, number>();
  const bound = (line: string, word: "min" | "max") => {
    const m = line.match(new RegExp(`\\[${word}\\s+(-?[\\d.,]+)\\]`, "i"));
    const n = m ? Number(m[1]!.replace(/,/g, "")) : NaN;
    return Number.isFinite(n) ? n : undefined;
  };
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const label = line.replace(/\[(photo|note)\]/gi, "").replace(/\[unit\s+[^\]]*\]/gi, "").replace(/\[(min|max)\s+[^\]]*\]/gi, "").trim();
      const base = stageKeyFor(label);
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      const unit = line.match(/\[unit\s+([^\]\s]{1,12})\]/i)?.[1];
      const min = bound(line, "min");
      const max = bound(line, "max");
      return {
        key: n === 1 ? base : `${base}_${n}`.slice(0, 40),
        label,
        requireEvidence: /\[photo\]/i.test(line),
        requireRemarks: /\[note\]/i.test(line),
        // A range with no unit has nothing to be measured in, so it is ignored rather than guessed.
        ...(unit ? { measure: { unit, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) } } : {}),
      };
    })
    .filter((c) => c.label);
}

/**
 * Creates a production route. The person types stage names in order; the stable
 * key is derived. The chain is theirs to define: nothing here knows what a
 * factory's departments are. Opens as a sheet so the routes list stays put.
 */
const BLANK = () => [{ key: 0, label: "", checklist: "" }, { key: 1, label: "", checklist: "" }];

export function CreateRouteForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const [nextKey, setNextKey] = useState(2);
  const [stages, setStages] = useState<Array<{ key: number; label: string; checklist: string }>>(BLANK);
  const close = () => {
    setOpen(false);
    setFailure(null);
  };

  function submit(form: FormData) {
    setFailure(null);
    startTransition(async () => {
      const result = await runCommand(
        COMMAND,
        {
          code: formText(form, "code"),
          name: formText(form, "name"),
          stages: stages
            .filter((s) => s.label.trim())
            .map((s) => ({ stageKey: stageKeyFor(s.label), label: s.label.trim(), checkpoints: parseChecklist(s.checklist) })),
        },
        "/manufacturing/routes",
      );
      if (result.ok) {
        close();
        setStages(BLANK());
        setNextKey(2);
        router.refresh();
      } else {
        setFailure(result);
      }
    });
  }

  return (
    <>
      <CommandButton commands={COMMAND} variant="primary" onClick={() => setOpen(true)}>
        New route
      </CommandButton>
      <FormModal
        title="New route"
        description="The ordered stages an order passes through, with an optional checklist per stage."
        open={open}
        onClose={close}
        submitLabel="Create route"
        pending={pending}
        failure={failure}
        failureTitle="Could not create the route"
        onSubmit={submit}
      >
        <div className="grid grid-cols-[8rem_1fr] gap-3">
          <Field label="Code" htmlFor="route-code" required hint="Unique.">
            <Input id="route-code" name="code" required maxLength={60} autoFocus />
          </Field>
          <Field label="Name" htmlFor="route-name" required>
            <Input id="route-name" name="name" required maxLength={200} />
          </Field>
        </div>

        <fieldset className="flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 text-[13px] font-medium text-text">Stages, in order</legend>
          {stages.map((s, i) => (
            <div key={s.key} className="flex flex-col gap-2 border-b border-line pb-3 last:border-0">
              <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                <Field label={`Stage ${i + 1}`} htmlFor={`stage-${s.key}`}>
                  <Input
                    id={`stage-${s.key}`}
                    value={s.label}
                    maxLength={80}
                    placeholder={i === 0 ? "e.g. Cutting" : ""}
                    onChange={(e) => setStages((all) => all.map((x) => (x.key === s.key ? { ...x, label: e.target.value } : x)))}
                  />
                </Field>
                <Button type="button" variant="ghost" size="sm" aria-label={`Remove stage ${i + 1}`} disabled={stages.length <= 1 || pending}
                  onClick={() => setStages((all) => all.filter((x) => x.key !== s.key))}>
                  Remove
                </Button>
              </div>
              <Field label="Checklist (optional)" htmlFor={`checklist-${s.key}`} hint="One per line. Add [photo] or [note] to require them. For a measured check add [unit MΩ] and optionally [min 1000] [max 5000].">
                <Textarea
                  id={`checklist-${s.key}`}
                  rows={3}
                  value={s.checklist}
                  placeholder={"Seams are straight [photo]\nLabel attached [note]"}
                  onChange={(e) => setStages((all) => all.map((x) => (x.key === s.key ? { ...x, checklist: e.target.value } : x)))}
                />
              </Field>
            </div>
          ))}
          <div>
            <Button type="button" variant="ghost" size="sm" disabled={pending}
              onClick={() => { setStages((all) => [...all, { key: nextKey, label: "", checklist: "" }]); setNextKey((k) => k + 1); }}>
              Add stage
            </Button>
          </div>
        </fieldset>
      </FormModal>
    </>
  );
}
