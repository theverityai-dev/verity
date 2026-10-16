"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorState, Input } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import { Modal } from "@/components/ui/Modal";

export function RenameTeamForm({
  teamId,
  currentName,
  revalidatePath = "/outreach/team",
}: {
  teamId: string;
  currentName: string;
  /** Defaults to the Senior's own team page; the Core admin roster view
   *  (`/outreach/teams/[teamId]`) passes its own route instead. */
  revalidatePath?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();


  return (
    <>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="cursor-pointer border-none bg-transparent p-0 text-[12px] text-text-tertiary underline decoration-dotted hover:text-accent-ink"
      >
        Rename team
      </button>
      <Modal open={editing} onClose={() => setEditing(false)} title="Rename team">
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setFailure(null);
        startTransition(async () => {
          const result = await runCommand("verity.outreach.rename_team", { teamId, name: String(form.get("name") ?? "") }, revalidatePath);
          if (result.ok) {
            setEditing(false);
            router.refresh();
          } else {
            setFailure(result);
          }
        });
      }}
    >
      <Input name="name" defaultValue={currentName} required className="h-9 w-56" />
      <Button type="submit" size="sm" disabled={pending}>
        Save
      </Button>
      <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(false)}>
        Cancel
      </Button>
      {failure && <ErrorState title="Could not rename" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
    </form>
      </Modal>
    </>
  );
}
