"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Button, ErrorState, Field, Input } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

export type BatchableOrder = { id: string; label: string; location: string; detail: string };

/**
 * Group draft orders into one production batch. The server enforces the rules
 * (drafts only, one location, each order in at most one batch); the form only
 * collects the selection, so an invalid mix is explained by the server's reason
 * rather than silently filtered here.
 */
export function CreateBatchForm({ orders }: { orders: BatchableOrder[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <CommandButton commands="verity.manufacturing.create_batch" size="sm" variant="primary" onClick={() => setOpen(true)}>
        New batch
      </CommandButton>
    );
  }

  return (
    <form
      className="flex w-full flex-col gap-3 rounded-lg bg-surface p-4 sm:w-[28rem]"
      action={(fd) => {
        setFailure(null);
        startTransition(async () => {
          const result = await runCommand<{ id: string }>(
            "verity.manufacturing.create_batch",
            { orderIds: fd.getAll("orderIds").map(String), reference: String(fd.get("reference") ?? "").trim() || undefined },
            "/manufacturing/batches",
          );
          if (result.ok) router.push(`/manufacturing/batches/${result.data.id}`);
          else setFailure(result);
        });
      }}
    >
      <Field label="Reference" htmlFor="batch-ref" hint="Optional, for example a cutting run.">
        <Input id="batch-ref" name="reference" maxLength={120} />
      </Field>
      <fieldset className="m-0 flex max-h-64 flex-col gap-2 overflow-auto border-0 p-0">
        <legend className="mb-1 text-[13px] text-text-secondary">Draft orders to produce together (at least two, one location)</legend>
        {orders.length === 0 && <p className="m-0 text-[13px] text-text-secondary">No draft orders are free to batch.</p>}
        {orders.map((o) => (
          <label key={o.id} className="flex items-start gap-2 text-[13px]">
            <input type="checkbox" name="orderIds" value={o.id} className="mt-1" />
            <span>
              {o.label}
              <span className="block text-text-tertiary">{o.detail} · {o.location}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {failure && <ErrorState title="Could not create the batch" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
      <div className="flex gap-2">
        <CommandButton commands="verity.manufacturing.create_batch" type="submit" variant="primary" disabled={pending}>
          {pending ? "Creating…" : "Create batch"}
        </CommandButton>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Hold the whole batch's stock in one all-or-nothing step, or take the batch apart. */
export function BatchActions({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [confirmDissolve, setConfirmDissolve] = useState(false);
  const [pending, startTransition] = useTransition();

  const run = (key: string, after: () => void) =>
    startTransition(async () => {
      setFailure(null);
      const result = await runCommand(key, { batchId }, "/manufacturing/batches");
      if (result.ok) after();
      else setFailure(result);
    });

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <CommandButton
          commands="verity.manufacturing.reserve_batch"
          size="sm"
          variant="primary"
          disabled={pending}
          onClick={() => run("verity.manufacturing.reserve_batch", () => router.refresh())}
        >
          {pending ? "Working…" : "Hold stock for batch"}
        </CommandButton>
        {confirmDissolve ? (
          <>
            <CommandButton
              commands="verity.manufacturing.dissolve_batch"
              size="sm"
              variant="secondary"
              className="text-danger"
              disabled={pending}
              onClick={() => run("verity.manufacturing.dissolve_batch", () => router.push("/manufacturing/batches"))}
            >
              Dissolve now
            </CommandButton>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDissolve(false)} disabled={pending}>
              Keep it
            </Button>
          </>
        ) : (
          <CommandButton commands="verity.manufacturing.dissolve_batch" size="sm" variant="secondary" disabled={pending} onClick={() => setConfirmDissolve(true)}>
            Dissolve
          </CommandButton>
        )}
      </div>
      {failure && (
        <div className="w-full sm:w-96">
          <ErrorState title="Could not complete that" message={failure.message} issues={failure.issues} retryable={failure.retryable} />
        </div>
      )}
    </div>
  );
}
