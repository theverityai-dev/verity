"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Button, Checkbox, ErrorState, Field, Input, Select } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

type List = { id: string; label: string; kind: string; values: Array<{ id: string; label: string; code: string }> };
type Group = { id: string; name: string };

const COMMAND = "verity.inventory.create_template";

/** GST slabs in basis points; the first option is the honest "not decided yet". */
const GST_SLABS = [
  { value: "", label: "Not set yet" },
  { value: "0", label: "0%" },
  { value: "500", label: "5%" },
  { value: "1200", label: "12%" },
  { value: "1800", label: "18%" },
];

/**
 * Creates a style through the real command pipeline. The colour and size choices come from the lists the tenant
 * defined; a list with nothing ticked is simply not an axis of this style.
 */
export function CreateStyleForm({ lists, groups }: { lists: List[]; groups: Group[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<Record<string, string[]>>({});

  const usable = lists.filter((l) => l.values.length > 0);
  const count = usable.reduce((n, l) => (picked[l.id]?.length ? n * picked[l.id]!.length : n), 1);
  const axesUsed = usable.filter((l) => picked[l.id]?.length).length;

  const toggle = (listId: string, valueId: string, on: boolean) =>
    setPicked((p) => {
      const current = new Set(p[listId] ?? []);
      if (on) current.add(valueId);
      else current.delete(valueId);
      return { ...p, [listId]: [...current] };
    });

  return (
    <>
      <CommandButton commands={COMMAND} variant="primary" onClick={() => setOpen(true)}>
        New style
      </CommandButton>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New style"
        description="Choose the colours and sizes it comes in. Variants are generated on the next screen."
        width="lg"
      >
        <form
          className="flex flex-col gap-4"
          action={(formData) => {
            setFailure(null);
            startTransition(async () => {
              const text = (name: string) => String(formData.get(name) ?? "").trim();
              const tax = text("tax");
              const result = await runCommand<{ id: string }>(
                COMMAND,
                {
                  code: text("code"),
                  name: text("name"),
                  season: text("season") || undefined,
                  hsnCode: text("hsn") || undefined,
                  taxRateBp: tax === "" ? undefined : Number(tax),
                  itemGroupId: text("group") || undefined,
                  unitLabel: text("unit") || undefined,
                  axes: usable
                    .filter((l) => picked[l.id]?.length)
                    .map((l) => ({ attributeId: l.id, valueIds: picked[l.id]! })),
                },
                "/styles",
              );
              if (result.ok) {
                setOpen(false);
                setPicked({});
                router.push(`/styles/${result.data!.id}`);
              } else {
                setFailure(result);
              }
            });
          }}
        >
          {failure && (
            <ErrorState title="Could not create the style" message={failure.message} issues={failure.issues} retryable={failure.retryable} />
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_1fr]">
            <Field label="Style code" htmlFor="style-code" required hint="Letters, digits, hyphens. Starts every SKU.">
              <Input id="style-code" name="code" required maxLength={30} autoFocus autoCapitalize="characters" />
            </Field>
            <Field label="Name" htmlFor="style-name" required>
              <Input id="style-name" name="name" required maxLength={160} />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Season" htmlFor="style-season">
              <Input id="style-season" name="season" maxLength={40} />
            </Field>
            <Field label="HSN code" htmlFor="style-hsn" hint="4, 6 or 8 digits.">
              <Input id="style-hsn" name="hsn" inputMode="numeric" pattern="\d{4}(\d{2}(\d{2})?)?" maxLength={8} />
            </Field>
            <Field label="GST rate" htmlFor="style-tax">
              <Select id="style-tax" name="tax" defaultValue="">
                {GST_SLABS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Item group" htmlFor="style-group">
              <Select id="style-group" name="group" defaultValue="">
                <option value="">None</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Unit" htmlFor="style-unit" hint="Defaults to pcs.">
              <Input id="style-unit" name="unit" maxLength={30} placeholder="pcs" />
            </Field>
          </div>

          {usable.length === 0 ? (
            <p className="m-0 text-[13px] text-text-secondary">
              No colour or size list has values yet. Add them under Colours and sizes first.
            </p>
          ) : (
            usable.map((list) => (
              <fieldset key={list.id} className="m-0 flex flex-col gap-2 border-0 p-0">
                <legend className="mb-1 flex w-full items-baseline justify-between text-[13px] font-medium text-text">
                  <span>{list.label}</span>
                  <button
                    type="button"
                    className="border-0 bg-transparent p-0 text-[13px] font-normal text-accent-ink hover:underline"
                    onClick={() =>
                      setPicked((p) => ({
                        ...p,
                        [list.id]: (p[list.id]?.length ?? 0) === list.values.length ? [] : list.values.map((v) => v.id),
                      }))
                    }
                  >
                    {(picked[list.id]?.length ?? 0) === list.values.length ? "Clear" : "Select all"}
                  </button>
                </legend>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                  {list.values.map((v) => (
                    <Checkbox
                      key={v.id}
                      label={`${v.label} (${v.code})`}
                      checked={picked[list.id]?.includes(v.id) ?? false}
                      onChange={(e) => toggle(list.id, v.id, e.target.checked)}
                    />
                  ))}
                </div>
              </fieldset>
            ))
          )}

          <p className="m-0 text-[13px] text-text-secondary" aria-live="polite">
            {axesUsed === 0 ? "Tick at least one colour or size." : `${count} variant${count === 1 ? "" : "s"} will be possible.`}
          </p>

          <div className="flex gap-2">
            <CommandButton commands={COMMAND} type="submit" variant="primary" disabled={pending || axesUsed === 0}>
              {pending ? "Creating…" : "Create style"}
            </CommandButton>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
