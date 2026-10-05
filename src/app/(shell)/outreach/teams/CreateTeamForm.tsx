"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorState, Field, Input, Select } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

/**
 * Core-only: `/outreach/teams` had no way to create a team at all —
 * `verity.outreach.create_team` existed since Task 105 but no page ever
 * called it. Same candidate pool as `AddMemberForm`'s (reachable in the
 * tenant, not already on an active roster anywhere) — a brand-new team's
 * leader is picked from the same unassigned pool, not a fresh login.
 */
export function CreateTeamForm({ candidates }: { candidates: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  if (candidates.length === 0) return null;

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        + New team
      </Button>
    );
  }

  return (
    <form
      className="glass-card mb-4 grid gap-3 rounded-[12px] p-4 sm:grid-cols-[1fr_1fr_auto_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setFailure(null);
        startTransition(async () => {
          const result = await runCommand(
            "verity.outreach.create_team",
            { name: String(form.get("name") ?? ""), leaderId: String(form.get("leaderId")) },
            "/outreach/teams",
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
      <Field label="Team name" htmlFor="newTeamName" required>
        <Input id="newTeamName" name="name" required />
      </Field>
      <Field label="Leader" htmlFor="newTeamLeaderId" required>
        <Select id="newTeamLeaderId" name="leaderId">
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex items-end gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Creating…" : "Create"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {failure && (
        <div className="sm:col-span-full">
          <ErrorState title="Could not create team" message={failure.message} issues={failure.issues} retryable={failure.retryable} />
        </div>
      )}
    </form>
  );
}
