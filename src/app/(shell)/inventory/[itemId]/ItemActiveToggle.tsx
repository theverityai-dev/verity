"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorState } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

/** Deactivating hides an item from new movements; its ledger stays. */
export function ItemActiveToggle({ itemId, active }: { itemId: string; active: boolean }) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => {
          setFailure(null);
          startTransition(async () => {
            const result = await runCommand("verity.inventory.set_item_active", { itemId, active: !active }, "/inventory");
            if (result.ok) router.refresh();
            else setFailure(result);
          });
        }}
      >
        {pending ? "Saving…" : active ? "Deactivate item" : "Reactivate item"}
      </Button>
      {failure && <ErrorState title="Could not update the item" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
    </>
  );
}
