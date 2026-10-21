"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Button, ErrorState, Field, Input, Select } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

const DEFINE = "verity.inventory.define_attribute";
const ADD_VALUE = "verity.inventory.add_attribute_value";
const RETIRE = "verity.inventory.set_attribute_value_active";
const PATH = "/styles/lists";

const slug = (label: string) =>
  label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "l_$1").slice(0, 40);

/** Runs a command from a form, keeping the failure on screen until the next attempt. */
function useFormCommand(onDone: () => void) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (command: string, input: unknown) => {
    setFailure(null);
    startTransition(async () => {
      const result = await runCommand(command, input, PATH);
      if (result.ok) {
        onDone();
        router.refresh();
      } else {
        setFailure(result);
      }
    });
  };
  return { failure, pending, run, clear: () => setFailure(null) };
}

export function NewListForm() {
  const [open, setOpen] = useState(false);
  const { failure, pending, run, clear } = useFormCommand(() => setOpen(false));

  return (
    <>
      <CommandButton commands={DEFINE} variant="primary" onClick={() => setOpen(true)}>
        New list
      </CommandButton>
      <Modal open={open} onClose={() => { clear(); setOpen(false); }} title="New list" description="A colour list, a size run, or any other set of options a style can come in.">
        <form
          className="flex flex-col gap-4"
          action={(formData) => {
            const label = String(formData.get("label") ?? "").trim();
            run(DEFINE, { key: slug(label), label, kind: String(formData.get("kind") ?? "other") });
          }}
        >
          {failure && <ErrorState title="Could not create the list" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
          <Field label="Name" htmlFor="list-label" required hint="For example Colour, or Size (adult).">
            <Input id="list-label" name="label" required maxLength={80} autoFocus />
          </Field>
          <Field label="Kind" htmlFor="list-kind" required>
            <Select id="list-kind" name="kind" defaultValue="colour">
              <option value="colour">Colour (values carry a swatch)</option>
              <option value="size">Size run (ordered)</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <div className="flex gap-2">
            <CommandButton commands={DEFINE} type="submit" variant="primary" disabled={pending}>
              {pending ? "Creating…" : "Create list"}
            </CommandButton>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function AddValueForm({ attributeId, label, kind }: { attributeId: string; label: string; kind: string }) {
  const [open, setOpen] = useState(false);
  const { failure, pending, run, clear } = useFormCommand(() => setOpen(false));

  return (
    <>
      <CommandButton commands={ADD_VALUE} variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Add value
      </CommandButton>
      <Modal open={open} onClose={() => { clear(); setOpen(false); }} title={`Add to ${label}`} description="The code goes into every SKU made from this value, so keep it short and never reuse it.">
        <form
          className="flex flex-col gap-4"
          action={(formData) => {
            const text = (name: string) => String(formData.get(name) ?? "").trim();
            run(ADD_VALUE, {
              attributeId,
              code: text("code"),
              label: text("label"),
              swatchHex: kind === "colour" && text("swatch") ? text("swatch") : undefined,
            });
          }}
        >
          {failure && <ErrorState title="Could not add the value" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[8rem_1fr]">
            <Field label="Code" htmlFor={`code-${attributeId}`} required hint="1 to 12 letters or digits.">
              <Input id={`code-${attributeId}`} name="code" required maxLength={12} autoCapitalize="characters" autoFocus />
            </Field>
            <Field label="Name" htmlFor={`label-${attributeId}`} required>
              <Input id={`label-${attributeId}`} name="label" required maxLength={80} />
            </Field>
          </div>
          {kind === "colour" && (
            <Field label="Swatch" htmlFor={`swatch-${attributeId}`} hint="A hex colour such as #1F3A5F. Optional.">
              <Input id={`swatch-${attributeId}`} name="swatch" maxLength={7} pattern="#[0-9A-Fa-f]{6}" placeholder="#1F3A5F" />
            </Field>
          )}
          {kind === "size" && (
            <p className="m-0 text-[13px] text-text-secondary">New sizes join the end of the run. Add them smallest to largest.</p>
          )}
          <div className="flex gap-2">
            <CommandButton commands={ADD_VALUE} type="submit" variant="primary" disabled={pending}>
              {pending ? "Adding…" : "Add value"}
            </CommandButton>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function ValueToggle({ valueId, label, active }: { valueId: string; label: string; active: boolean }) {
  const { pending, run } = useFormCommand(() => undefined);
  return (
    <CommandButton
      commands={RETIRE}
      variant="ghost"
      size="sm"
      disabled={pending}
      aria-label={`${active ? "Retire" : "Restore"} ${label}`}
      onClick={() => run(RETIRE, { valueId, active: !active })}
    >
      {active ? "Retire" : "Restore"}
    </CommandButton>
  );
}
