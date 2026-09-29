"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Button, ErrorState, Field, Input, Select } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

type Option = { id: string; name: string };
type Line = { key: number; componentItemId: string; qtyRequired: string };

const COMMAND = "verity.manufacturing.create_order";

/**
 * Creates a Manufacturing Order through the real command pipeline. There is no
 * client-side mutation path: `runCommand` resolves the actor server-side and
 * runs validation, authorization, preconditions, mutation, event and audit.
 * The command itself refuses a duplicate component or a component equal to the
 * output, so this form does not re-implement those rules.
 */
export function CreateOrderForm({ locations, items }: { locations: Option[]; items: Option[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const [nextKey, setNextKey] = useState(1);
  const [lines, setLines] = useState<Line[]>([{ key: 0, componentItemId: "", qtyRequired: "1" }]);

  if (!open) {
    return (
      <CommandButton commands={COMMAND} variant="primary" onClick={() => setOpen(true)}>
        New order
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
          const result = await runCommand(
            COMMAND,
            {
              locationId: String(formData.get("locationId") ?? ""),
              outputItemId: String(formData.get("outputItemId") ?? ""),
              outputQty: Number(formData.get("outputQty")),
              reference: String(formData.get("reference") ?? "").trim() || undefined,
              lines: lines.map((l) => ({ componentItemId: l.componentItemId, qtyRequired: Number(l.qtyRequired) })),
            },
            "/manufacturing",
          );
          if (result.ok) {
            setOpen(false);
            setLines([{ key: 0, componentItemId: "", qtyRequired: "1" }]);
            router.refresh();
          } else {
            setFailure(result);
          }
        });
      }}
    >
      {failure && (
        <ErrorState
          title="Could not create the order"
          message={failure.message}
          issues={failure.issues}
          retryable={failure.retryable}
        />
      )}

      <Field label="Reference" htmlFor="reference" hint="Optional. Shown in place of the generated order number.">
        <Input id="reference" name="reference" maxLength={200} />
      </Field>

      <Field label="Location" htmlFor="locationId" required hint="Components are consumed from, and output received into, this location.">
        <Select id="locationId" name="locationId" required defaultValue="">
          <option value="" disabled>Select a location</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </Select>
      </Field>

      <div className="grid grid-cols-[1fr_6rem] gap-3">
        <Field label="Produces" htmlFor="outputItemId" required>
          <Select id="outputItemId" name="outputItemId" required defaultValue="">
            <option value="" disabled>Select an item</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Quantity" htmlFor="outputQty" required>
          <Input id="outputQty" name="outputQty" type="number" min={1} step={1} defaultValue={1} required />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-3 border-0 p-0">
        <legend className="mb-1 text-[13px] font-medium text-text">Components consumed</legend>
        {lines.map((line, index) => (
          <div key={line.key} className="grid grid-cols-[1fr_6rem_auto] items-end gap-3">
            <Field label={index === 0 ? "Item" : "Item " + (index + 1)} htmlFor={`component-${line.key}`} required>
              <Select
                id={`component-${line.key}`}
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
            <Field label="Qty" htmlFor={`qty-${line.key}`} required>
              <Input
                id={`qty-${line.key}`}
                type="number"
                min={1}
                step={1}
                required
                value={line.qtyRequired}
                onChange={(e) => update(line.key, { qtyRequired: e.target.value })}
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
              setLines((ls) => [...ls, { key: nextKey, componentItemId: "", qtyRequired: "1" }]);
              setNextKey((k) => k + 1);
            }}
          >
            Add component
          </Button>
        </div>
      </fieldset>

      <div className="flex gap-2">
        <CommandButton commands={COMMAND} type="submit" variant="primary" disabled={pending}>
          {pending ? "Creating…" : "Create order"}
        </CommandButton>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
