"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Button, ErrorState, Field, Input } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

const CREATE_LOT = "verity.piecework.create_lot";
const DEFINE_STAGE = "verity.piecework.define_stage";

/** The same slug rule the server enforces: lower-case letters, digits, underscores, starting with a letter. */
const keyOf = (label: string) =>
  label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "s_$1").slice(0, 40);

export function NewLotForm({ defaultBundleSize = 20 }: { defaultBundleSize?: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <CommandButton commands={CREATE_LOT} variant="primary" onClick={() => setOpen(true)}>
        New lot
      </CommandButton>
      <Modal open={open} onClose={() => setOpen(false)} title="New lot" description="The system gives the lot its own number. Pieces are counted as numbers; there is no size.">
        <form
          className="flex flex-col gap-4"
          action={(formData) => {
            setFailure(null);
            const text = (name: string) => String(formData.get(name) ?? "").trim();
            startTransition(async () => {
              const result = await runCommand<{ id: string; number: string }>(
                CREATE_LOT,
                { design: text("design"), totalPieces: Number(text("pieces")), bundleSize: Number(text("bundle")) || undefined, note: text("note") || undefined },
                "/lots",
              );
              if (result.ok) {
                setOpen(false);
                router.push(`/lots/${result.data!.id}`);
              } else setFailure(result);
            });
          }}
        >
          {failure && <ErrorState title="Could not create the lot" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Design" htmlFor="lot-design" required hint="The design name or code, as you write it.">
              <Input id="lot-design" name="design" required maxLength={120} autoFocus />
            </Field>
            <Field label="Total pieces" htmlFor="lot-pieces" required>
              <Input id="lot-pieces" name="pieces" type="number" inputMode="numeric" min={1} max={1000000} step={1} required />
            </Field>
          </div>
          <Field label="Pieces in one bundle" htmlFor="lot-bundle" hint="Bundles are counted for you from this. Change it only if this lot is bundled differently.">
            <Input id="lot-bundle" name="bundle" type="number" inputMode="numeric" min={1} step={1} defaultValue={defaultBundleSize} />
          </Field>
          <Field label="Note" htmlFor="lot-note">
            <Input id="lot-note" name="note" maxLength={500} />
          </Field>
          <div className="flex gap-2">
            <CommandButton commands={CREATE_LOT} type="submit" variant="primary" disabled={pending}>
              {pending ? "Creating…" : "Create lot"}
            </CommandButton>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/** Adds the next stage of the work chain. Allowed only until the first entry is recorded. */
export function DefineStageForm({ next }: { next: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <CommandButton commands={DEFINE_STAGE} variant="primary" onClick={() => setOpen(true)}>
        {next === 1 ? "Set up the first stage" : "Add a stage"}
      </CommandButton>
      <Modal open={open} onClose={() => setOpen(false)} title={`Stage ${next}`} description="Stages run in the order you add them, for example Cutting, Stitching, Button / Kaj, Finishing, Press. They cannot change once work is recorded.">
        <form
          className="flex flex-col gap-4"
          action={(formData) => {
            setFailure(null);
            const label = String(formData.get("label") ?? "").trim();
            startTransition(async () => {
              const result = await runCommand(DEFINE_STAGE, { stageKey: keyOf(label), label }, "/lots");
              if (result.ok) {
                setOpen(false);
                router.refresh();
              } else setFailure(result);
            });
          }}
        >
          {failure && <ErrorState title="Could not add the stage" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
          <Field label="Stage name" htmlFor="stage-label" required>
            <Input id="stage-label" name="label" required maxLength={80} autoFocus />
          </Field>
          <div className="flex gap-2">
            <CommandButton commands={DEFINE_STAGE} type="submit" variant="primary" disabled={pending}>
              {pending ? "Adding…" : "Add stage"}
            </CommandButton>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
