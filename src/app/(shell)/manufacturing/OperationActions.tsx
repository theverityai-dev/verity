"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Button, ErrorState, Input, Select } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

type Stage = { stageKey: string; label: string };

/**
 * What an operator can do to one stage, driven by its state. The command
 * pipeline re-checks state, sequence and authorization on the server, so the
 * buttons are presentation: they only avoid offering what would be refused.
 * Hold and send-back each ask for a reason first, because those are the
 * decisions someone asks about later.
 */
export function OperationActions({
  operationId,
  state,
  actionable,
  sendBackTo,
  revalidate,
}: {
  operationId: string;
  state: string;
  actionable: boolean;
  sendBackTo: Stage[];
  revalidate: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "hold" | "back">(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (key: string, input: Record<string, unknown>) => {
    setFailure(null);
    startTransition(async () => {
      const result = await runCommand(key, { operationId, ...input }, revalidate);
      if (result.ok) {
        setMode(null);
        router.refresh();
      } else {
        setFailure(result);
      }
    });
  };

  const open = state === "pending" || state === "in_progress" || state === "on_hold";
  if (!open) return null;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {state === "pending" && actionable && (
          <CommandButton commands="verity.manufacturing.start_operation" size="sm" variant="primary" disabled={pending}
            onClick={() => run("verity.manufacturing.start_operation", {})}>
            Start
          </CommandButton>
        )}
        {state === "in_progress" && (
          <>
            <CommandButton commands="verity.manufacturing.complete_operation" size="sm" variant="primary" disabled={pending}
              onClick={() => run("verity.manufacturing.complete_operation", {})}>
              Complete
            </CommandButton>
            <CommandButton commands="verity.manufacturing.hold_operation" size="sm" variant="secondary" disabled={pending}
              onClick={() => setMode(mode === "hold" ? null : "hold")}>
              Hold
            </CommandButton>
          </>
        )}
        {state === "on_hold" && (
          <CommandButton commands="verity.manufacturing.resume_operation" size="sm" variant="primary" disabled={pending}
            onClick={() => run("verity.manufacturing.resume_operation", {})}>
            Resume
          </CommandButton>
        )}
        {(state === "in_progress" || state === "on_hold") && sendBackTo.length > 0 && (
          <CommandButton commands="verity.manufacturing.send_back" size="sm" variant="secondary" className="text-danger" disabled={pending}
            onClick={() => setMode(mode === "back" ? null : "back")}>
            Send back
          </CommandButton>
        )}
      </div>

      {mode === "hold" && (
        <form
          className="flex w-72 flex-col gap-2 rounded-lg bg-surface p-3"
          action={(fd) => run("verity.manufacturing.hold_operation", { reason: String(fd.get("reason") ?? "") })}
        >
          <Input name="reason" placeholder="Why is it on hold?" required minLength={3} maxLength={400} autoFocus aria-label="Reason for hold" />
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="primary" disabled={pending}>Put on hold</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode(null)} disabled={pending}>Cancel</Button>
          </div>
        </form>
      )}

      {mode === "back" && (
        <form
          className="flex w-72 flex-col gap-2 rounded-lg bg-surface p-3"
          action={(fd) =>
            run("verity.manufacturing.send_back", {
              toStageKey: String(fd.get("toStageKey") ?? ""),
              reason: String(fd.get("reason") ?? ""),
            })
          }
        >
          <Select name="toStageKey" required defaultValue="" aria-label="Send back to">
            <option value="" disabled>Send back to…</option>
            {sendBackTo.map((s) => (
              <option key={s.stageKey} value={s.stageKey}>{s.label}</option>
            ))}
          </Select>
          <Input name="reason" placeholder="What is wrong?" required minLength={3} maxLength={400} aria-label="Reason" />
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="primary" disabled={pending}>Send back</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode(null)} disabled={pending}>Cancel</Button>
          </div>
        </form>
      )}

      {failure && (
        <div className="w-72">
          <ErrorState title="Could not do that" message={failure.message} issues={failure.issues} retryable={failure.retryable} />
        </div>
      )}
    </div>
  );
}
