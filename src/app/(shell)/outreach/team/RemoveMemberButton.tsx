"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconButton, ErrorState } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

/** Soft-removes — the command deactivates the membership, never deletes it, so attribution history stays intact. */
export function RemoveMemberButton({
  teamId,
  partyId,
  name,
  revalidatePath = "/outreach/team",
}: {
  teamId: string;
  partyId: string;
  name: string;
  /** Defaults to the Senior's own team page; the Core admin roster view
   *  (`/outreach/teams/[teamId]`) passes its own route instead. */
  revalidatePath?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setFailure(null);
            startTransition(async () => {
              const result = await runCommand("verity.outreach.remove_team_member", { teamId, partyId }, revalidatePath);
              if (result.ok) router.refresh();
              else setFailure(result);
              setConfirming(false);
            });
          }}
          className="cursor-pointer rounded border-none bg-transparent p-0 text-[12px] text-danger underline"
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="cursor-pointer rounded border-none bg-transparent p-0 text-[12px] text-text-tertiary underline"
        >
          No
        </button>
        {failure && (
          <span className="absolute z-10 mt-8">
            <ErrorState title="Could not remove" message={failure.message} issues={failure.issues} retryable={failure.retryable} />
          </span>
        )}
      </span>
    );
  }

  return (
    <IconButton label={`Remove ${name} from team`} onClick={() => setConfirming(true)}>
      <span aria-hidden="true">×</span>
    </IconButton>
  );
}
