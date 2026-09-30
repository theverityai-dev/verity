"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Button, ErrorState, Field, Input, Select } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

type Option = { id: string; name: string };

/**
 * Archive/restore a BOM, and make an order from it. Both go through the real
 * command pipeline; the order form only collects where and how many, because
 * the components and their scaled quantities come from the BOM itself.
 */
export function BomActions({
  bomId,
  active,
  locations,
}: {
  bomId: string;
  active: boolean;
  locations: Option[];
}) {
  const router = useRouter();
  const [ordering, setOrdering] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        {active && !ordering && (
          <CommandButton
            commands="verity.manufacturing.create_order_from_bom"
            size="sm"
            variant="primary"
            disabled={pending}
            onClick={() => setOrdering(true)}
          >
            Make an order
          </CommandButton>
        )}
        <CommandButton
          commands="verity.manufacturing.set_bom_active"
          size="sm"
          variant="secondary"
          className={active ? "text-danger" : undefined}
          disabled={pending}
          onClick={() => {
            setFailure(null);
            startTransition(async () => {
              const result = await runCommand("verity.manufacturing.set_bom_active", { bomId, active: !active }, "/manufacturing/boms");
              if (result.ok) router.refresh();
              else setFailure(result);
            });
          }}
        >
          {pending ? "Working…" : active ? "Archive" : "Restore"}
        </CommandButton>
      </div>

      {ordering && (
        <form
          className="flex w-full flex-col gap-3 rounded-lg bg-surface p-4 sm:w-96"
          action={(formData) => {
            setFailure(null);
            startTransition(async () => {
              const result = await runCommand<{ id: string }>(
                "verity.manufacturing.create_order_from_bom",
                {
                  bomId,
                  locationId: String(formData.get("locationId") ?? ""),
                  outputQty: Number(formData.get("outputQty")),
                  reference: String(formData.get("reference") ?? "").trim() || undefined,
                },
                "/manufacturing",
              );
              if (result.ok) router.push(`/manufacturing/${result.data.id}`);
              else setFailure(result);
            });
          }}
        >
          <Field label="Location" htmlFor="order-location" required hint="Components are consumed from here.">
            <Select id="order-location" name="locationId" required defaultValue="">
              <option value="" disabled>Select a location</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-[6rem_1fr] gap-3">
            <Field label="Quantity" htmlFor="order-qty" required>
              <Input id="order-qty" name="outputQty" type="number" min={1} step={1} defaultValue={1} required />
            </Field>
            <Field label="Reference" htmlFor="order-ref" hint="Optional.">
              <Input id="order-ref" name="reference" maxLength={200} />
            </Field>
          </div>
          <div className="flex gap-2">
            <CommandButton
              commands="verity.manufacturing.create_order_from_bom"
              type="submit"
              variant="primary"
              disabled={pending}
            >
              {pending ? "Creating…" : "Create order"}
            </CommandButton>
            <Button type="button" variant="ghost" onClick={() => setOrdering(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {failure && (
        <div className="w-full sm:w-96">
          <ErrorState title="Could not complete that" message={failure.message} issues={failure.issues} retryable={failure.retryable} />
        </div>
      )}
    </div>
  );
}
