"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { DateField } from "@/components/ui/DateTimePicker";
import { Button, ErrorState, Field, Input } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

const CREATE_LOT = "verity.piecework.create_lot";
const DEFINE_STAGE = "verity.piecework.define_stage";

/** The same slug rule the server enforces: lower-case letters, digits, underscores, starting with a letter. */
const keyOf = (label: string) =>
  label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "s_$1").slice(0, 40);

export function NewLotForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const [start, setStart] = useState("");
  const [due, setDue] = useState("");

  return (
    <>
      <CommandButton commands={CREATE_LOT} variant="primary" onClick={() => setOpen(true)}>
        New lot
      </CommandButton>
      <Modal open={open} onClose={() => setOpen(false)} title="New lot" description="The system gives the lot its own number. It starts as a draft; start it when cutting begins. Bundles are cut from it afterwards." width="lg">
        <form
          className="flex flex-col gap-4"
          action={(formData) => {
            setFailure(null);
            const text = (name: string) => String(formData.get(name) ?? "").trim();
            startTransition(async () => {
              const result = await runCommand<{ id: string; number: string }>(
                CREATE_LOT,
                {
                  design: text("design"), name: text("name") || undefined, plannedPieces: Number(text("planned")),
                  fabricType: text("fabric") || undefined, startDate: start || undefined, dueDate: due || undefined, note: text("note") || undefined,
                },
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
            <Field label="Lot name" htmlFor="lot-name" hint="What the factory calls it, for example Spring formals.">
              <Input id="lot-name" name="name" maxLength={120} autoFocus />
            </Field>
            <Field label="Style or design" htmlFor="lot-design" required>
              <Input id="lot-design" name="design" required maxLength={120} />
            </Field>
            <Field label="Planned pieces" htmlFor="lot-planned" required>
              <Input id="lot-planned" name="planned" type="number" inputMode="numeric" min={1} max={1000000} step={1} required />
            </Field>
            <Field label="Fabric type" htmlFor="lot-fabric">
              <Input id="lot-fabric" name="fabric" maxLength={80} />
            </Field>
            <Field label="Start date" htmlFor="lot-start">
              <DateField id="lot-start" value={start} onChange={setStart} />
            </Field>
            <Field label="Due date" htmlFor="lot-due">
              <DateField id="lot-due" value={due} onChange={setDue} min={start || undefined} />
            </Field>
          </div>
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
      <Modal open={open} onClose={() => setOpen(false)} title={`Stage ${next}`} description="Stages run in the order you add them, for example Pasting, Collar & Cuff, Stitching, Button / Kaj, Finishing. They cannot change once work is recorded.">
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
