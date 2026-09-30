"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Button, ErrorState, Field, Input, Select } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

type Option = { id: string; name: string };
type CustomField = { name: string; type: string; required: boolean; options: string[] };
type Line = { key: number; componentItemId: string; qtyPerUnit: string };

const COMMAND = "verity.manufacturing.create_bom";

/** Turns one submitted custom-field value into what the command's validator expects, or omits it when blank. */
function customValue(field: CustomField, formData: FormData): unknown {
  if (field.type === "Boolean") return formData.get(`cf:${field.name}`) === "on";
  const raw = String(formData.get(`cf:${field.name}`) ?? "").trim();
  if (raw === "") return undefined;
  return field.type === "Number" ? Number(raw) : raw;
}

/**
 * Creates a BOM through the real command pipeline. The custom-field section is
 * rendered from what the tenant declared for BOMs, so a client with different
 * product variants gets different fields with no code change (PLA-EXT-001).
 */
export function CreateBomForm({ items, fields }: { items: Option[]; fields: CustomField[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const [nextKey, setNextKey] = useState(1);
  const [lines, setLines] = useState<Line[]>([{ key: 0, componentItemId: "", qtyPerUnit: "1" }]);

  if (!open) {
    return (
      <CommandButton commands={COMMAND} variant="primary" onClick={() => setOpen(true)}>
        New BOM
      </CommandButton>
    );
  }

  const update = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <form
      className="flex w-full flex-col gap-4 rounded-lg bg-surface p-4 sm:w-[28rem]"
      action={(formData) => {
        setFailure(null);
        startTransition(async () => {
          const customFields = Object.fromEntries(
            fields.map((f) => [f.name, customValue(f, formData)]).filter(([, v]) => v !== undefined),
          );
          const result = await runCommand(
            COMMAND,
            {
              code: String(formData.get("code") ?? ""),
              name: String(formData.get("name") ?? ""),
              outputItemId: String(formData.get("outputItemId") ?? ""),
              lines: lines.map((l) => ({ componentItemId: l.componentItemId, qtyPerUnit: Number(l.qtyPerUnit) })),
              customFields,
            },
            "/manufacturing/boms",
          );
          if (result.ok) {
            setOpen(false);
            setLines([{ key: 0, componentItemId: "", qtyPerUnit: "1" }]);
            router.refresh();
          } else {
            setFailure(result);
          }
        });
      }}
    >
      {failure && (
        <ErrorState title="Could not create the BOM" message={failure.message} issues={failure.issues} retryable={failure.retryable} />
      )}

      <div className="grid grid-cols-[8rem_1fr] gap-3">
        <Field label="Code" htmlFor="bom-code" required hint="Unique. A changed recipe takes a new code.">
          <Input id="bom-code" name="code" required maxLength={60} autoFocus />
        </Field>
        <Field label="Name" htmlFor="bom-name" required>
          <Input id="bom-name" name="name" required maxLength={200} />
        </Field>
      </div>

      <Field label="Produces (one unit)" htmlFor="bom-output" required>
        <Select id="bom-output" name="outputItemId" required defaultValue="">
          <option value="" disabled>Select an item</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>{i.name}</option>
          ))}
        </Select>
      </Field>

      <fieldset className="flex flex-col gap-3 border-0 p-0">
        <legend className="mb-1 text-[13px] font-medium text-text">Components for one unit</legend>
        {lines.map((line, index) => (
          <div key={line.key} className="grid grid-cols-[1fr_6rem_auto] items-end gap-3">
            <Field label={index === 0 ? "Item" : `Item ${index + 1}`} htmlFor={`bom-c-${line.key}`} required>
              <Select
                id={`bom-c-${line.key}`}
                required
                value={line.componentItemId}
                onChange={(e) => update(line.key, { componentItemId: e.target.value })}
              >
                <option value="" disabled>Select an item</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Qty" htmlFor={`bom-q-${line.key}`} required>
              <Input
                id={`bom-q-${line.key}`}
                type="number"
                min={1}
                step={1}
                required
                value={line.qtyPerUnit}
                onChange={(e) => update(line.key, { qtyPerUnit: e.target.value })}
              />
            </Field>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove component ${index + 1}`}
              disabled={lines.length === 1 || pending}
              onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
            >
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              setLines((ls) => [...ls, { key: nextKey, componentItemId: "", qtyPerUnit: "1" }]);
              setNextKey((k) => k + 1);
            }}
          >
            Add component
          </Button>
        </div>
      </fieldset>

      {fields.length > 0 && (
        <fieldset className="flex flex-col gap-3 border-0 p-0">
          <legend className="mb-1 text-[13px] font-medium text-text">Details</legend>
          {fields.map((f) => {
            const id = `cf-${f.name}`;
            return (
              <Field key={f.name} label={f.name.replace(/_/g, " ")} htmlFor={id} required={f.required}>
                {f.type === "Select" ? (
                  <Select id={id} name={`cf:${f.name}`} required={f.required} defaultValue="">
                    <option value="">{f.required ? "Select" : "—"}</option>
                    {f.options.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </Select>
                ) : f.type === "Boolean" ? (
                  <input id={id} name={`cf:${f.name}`} type="checkbox" className="size-4" />
                ) : (
                  <Input
                    id={id}
                    name={`cf:${f.name}`}
                    type={f.type === "Number" ? "number" : f.type === "Date" ? "date" : "text"}
                    required={f.required}
                  />
                )}
              </Field>
            );
          })}
        </fieldset>
      )}

      <div className="flex gap-2">
        <CommandButton commands={COMMAND} type="submit" variant="primary" disabled={pending}>
          {pending ? "Creating…" : "Create BOM"}
        </CommandButton>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
