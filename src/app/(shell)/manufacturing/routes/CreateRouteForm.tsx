"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Button, ErrorState, Field, Input } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

const COMMAND = "verity.manufacturing.create_route";

/** A stage's stable key, made from what the person typed: "Cut & Bind" -> "cut_bind". */
export function stageKeyFor(label: string): string {
  const key = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return /^[a-z]/.test(key) ? key : `s_${key}`.slice(0, 40);
}

/**
 * Creates a production route. The person types stage names in order; the stable
 * key is derived. The chain is theirs to define: nothing here knows what a
 * factory's departments are.
 */
export function CreateRouteForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const [nextKey, setNextKey] = useState(2);
  const [stages, setStages] = useState<Array<{ key: number; label: string }>>([{ key: 0, label: "" }, { key: 1, label: "" }]);

  if (!open) {
    return (
      <CommandButton commands={COMMAND} variant="primary" onClick={() => setOpen(true)}>
        New route
      </CommandButton>
    );
  }

  return (
    <form
      className="flex w-full flex-col gap-4 rounded-lg bg-surface p-4 sm:w-[26rem]"
      action={(fd) => {
        setFailure(null);
        startTransition(async () => {
          const result = await runCommand(
            COMMAND,
            {
              code: String(fd.get("code") ?? ""),
              name: String(fd.get("name") ?? ""),
              stages: stages.filter((s) => s.label.trim()).map((s) => ({ stageKey: stageKeyFor(s.label), label: s.label.trim() })),
            },
            "/manufacturing/routes",
          );
          if (result.ok) {
            setOpen(false);
            setStages([{ key: 0, label: "" }, { key: 1, label: "" }]);
            router.refresh();
          } else {
            setFailure(result);
          }
        });
      }}
    >
      {failure && <ErrorState title="Could not create the route" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}

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
          <div key={s.key} className="grid grid-cols-[1fr_auto] items-end gap-2">
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
        ))}
        <div>
          <Button type="button" variant="ghost" size="sm" disabled={pending}
            onClick={() => { setStages((all) => [...all, { key: nextKey, label: "" }]); setNextKey((k) => k + 1); }}>
            Add stage
          </Button>
        </div>
      </fieldset>

      <div className="flex gap-2">
        <CommandButton commands={COMMAND} type="submit" variant="primary" disabled={pending}>
          {pending ? "Creating…" : "Create route"}
        </CommandButton>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
      </div>
    </form>
  );
}
