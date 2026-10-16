"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorState, Select } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import { Modal } from "@/components/ui/Modal";

/**
 * Core-only: reassigns a team's primary leader (`verity.outreach.set_team_leader`).
 * A leader who leaves the team has no other UI path off the roster — see that
 * command's own doc comment on why reassigning `leaderId` is enough by itself.
 */
export function ReassignLeaderForm({
  teamId,
  currentLeaderName,
  candidates,
}: {
  teamId: string;
  currentLeaderName: string;
  candidates: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();


  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Reassign leader ({currentLeaderName})
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Reassign leader">
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setFailure(null);
        startTransition(async () => {
          const result = await runCommand(
            "verity.outreach.set_team_leader",
            { teamId, leaderId: String(form.get("leaderId")) },
            `/outreach/teams/${teamId}`,
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
      <Select name="leaderId" className="h-9 w-56">
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm" disabled={pending}>
        Confirm
      </Button>
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {failure && <ErrorState title="Could not reassign leader" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
    </form>
      </Modal>
    </>
  );
}
