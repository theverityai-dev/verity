"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorState, Select } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import { Modal } from "@/components/ui/Modal";

/**
 * Only ever picks from people already reachable in the tenant with no
 * active roster anywhere — never a way to create a new login. Provisioning
 * a brand-new person's account stays an admin action, deliberately not
 * exposed here.
 */
export function AddMemberForm({
  teamId,
  candidates,
  revalidatePath = "/outreach/team",
}: {
  teamId: string;
  candidates: Array<{ id: string; name: string }>;
  /** Defaults to the Senior's own team page; the Core admin roster view
   *  (`/outreach/teams/[teamId]`) passes its own route instead. */
  revalidatePath?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  if (candidates.length === 0) return null;


  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        + Add member
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add member">
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setFailure(null);
        startTransition(async () => {
          const result = await runCommand(
            "verity.outreach.add_team_member",
            { teamId, partyId: String(form.get("partyId")) },
            revalidatePath,
          );
          if (result.ok) {
            setOpen(false);
            router.refresh();
          } else {
            setFailure(result);
          }
        });
      }}
    >
      <Select name="partyId" className="h-9 w-56">
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm" disabled={pending}>
        Add
      </Button>
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {failure && <ErrorState title="Could not add member" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
    </form>
      </Modal>
    </>
  );
}
