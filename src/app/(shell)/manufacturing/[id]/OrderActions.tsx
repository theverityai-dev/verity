"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Button, ErrorState, Field, Input } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

/**
 * Lifecycle actions for one order: draft -> in progress -> completed, and
 * cancel from either open state. Which buttons show is driven by the order's
 * current state; the command pipeline still authorizes and re-checks the state
 * on the server, so hiding a button is presentation, not authorization.
 * Cancelling asks for a reason first because it is the decision someone asks
 * about later (the command records it in the audit trail).
 */
export function OrderActions({ orderId, state }: { orderId: string; state: string }) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [pending, startTransition] = useTransition();

  if (state !== "draft" && state !== "in_progress") return null;

  const run = (key: string, input: Record<string, unknown>, after?: () => void) => {
    setFailure(null);
    startTransition(async () => {
      const result = await runCommand(key, { orderId, ...input }, "/manufacturing");
      if (result.ok) {
        after?.();
        router.refresh();
      } else {
        setFailure(result);
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        {state === "draft" && (
          <CommandButton
            commands="verity.manufacturing.start_order"
            size="sm"
            variant="primary"
            disabled={pending}
            onClick={() => run("verity.manufacturing.start_order", {})}
          >
            {pending ? "Working…" : "Start"}
          </CommandButton>
        )}
        {state === "in_progress" && (
          <CommandButton
            commands="verity.manufacturing.complete_order"
            size="sm"
            variant="primary"
            disabled={pending}
            onClick={() => run("verity.manufacturing.complete_order", {})}
          >
            {pending ? "Working…" : "Complete"}
          </CommandButton>
        )}
        {!cancelling && (
          <CommandButton
            commands="verity.manufacturing.cancel_order"
            size="sm"
            variant="secondary"
            className="text-danger"
            disabled={pending}
            onClick={() => setCancelling(true)}
          >
            Cancel order
          </CommandButton>
        )}
      </div>

      {cancelling && (
        <form
          className="flex w-full flex-col gap-3 rounded-lg bg-surface p-4 sm:w-96"
          action={(formData) =>
            run("verity.manufacturing.cancel_order", { reason: String(formData.get("reason") ?? "") }, () =>
              setCancelling(false),
            )
          }
        >
          <Field
            label="Reason"
            htmlFor="reason"
            required
            hint={state === "in_progress" ? "Stock already consumed will be returned." : "Recorded in the order history."}
          >
            <Input id="reason" name="reason" required minLength={3} maxLength={400} autoFocus />
          </Field>
          <div className="flex gap-2">
            <CommandButton commands="verity.manufacturing.cancel_order" type="submit" variant="primary" disabled={pending}>
              {pending ? "Cancelling…" : "Confirm cancel"}
            </CommandButton>
            <Button type="button" variant="ghost" onClick={() => setCancelling(false)} disabled={pending}>
              Keep order
            </Button>
          </div>
        </form>
      )}

      {failure && (
        <div className="w-full sm:w-96">
          <ErrorState
            title="Could not update the order"
            message={failure.message}
            issues={failure.issues}
            retryable={failure.retryable}
          />
        </div>
      )}
    </div>
  );
}
