"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { ErrorState } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

/**
 * Raise the bill for a served (or collected) order and go straight to it, where payment is taken.
 * Tax is computed once, by the command, so the counter never shows a total the printed bill would
 * disagree with.
 */
export function RaiseBillButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      {failure && (
        <div className="mb-3">
          <ErrorState title="The bill was not raised" message={failure.message} issues={failure.issues} retryable={failure.retryable} />
        </div>
      )}
      <CommandButton
        commands={"verity.dinein.generate_bill"}
        variant="primary"
        disabled={pending}
        onClick={() => {
          setFailure(null);
          startTransition(async () => {
            const result = await runCommand<{ id: string }>("verity.dinein.generate_bill", { orderId }, "/counter");
            if (result.ok) router.push(`/counter/${result.data.id}`);
            else setFailure(result);
          });
        }}
      >
        {pending ? "Raising the bill…" : "Raise bill"}
      </CommandButton>
    </>
  );
}
