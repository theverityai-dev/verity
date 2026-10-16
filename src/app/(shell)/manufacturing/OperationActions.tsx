"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Button, ErrorState, Input, Select } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import { ActionBar } from "@/components/ui/ActionBar";
import { ChecklistPanel } from "./ChecklistPanel";

type Stage = { stageKey: string; label: string };
export type ChecklistProgress = { total: number; passed: number; failed: number };

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
  checklist,
  revalidate,
  layout = "row",
}: {
  /** `row`: compact, in a table row. `bar`: the detail pane's sticky outcome bar (ADR-046 ActionBar). */
  layout?: "row" | "bar";
  operationId: string;
  state: string;
  actionable: boolean;
  sendBackTo: Stage[];
  checklist: ChecklistProgress;
  revalidate: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "hold" | "back" | "checklist">(null);
  // The server refuses to complete a stage until every checkpoint passes; this
  // only avoids offering a button that would be refused.
  const cleared = checklist.total === 0 || checklist.passed === checklist.total;
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

  const bar = layout === "bar";
  const size = bar ? "md" : "sm";
  const buttons = (
    <>
        {state === "pending" && actionable && (
          <CommandButton commands="verity.manufacturing.start_operation" size={size} variant="primary" disabled={pending}
            onClick={() => run("verity.manufacturing.start_operation", {})}>
            {bar ? "Start stage" : "Start"}
          </CommandButton>
        )}
        {state === "in_progress" && (
          <>
            {!bar && checklist.total > 0 && (
              <CommandButton commands="verity.manufacturing.record_checkpoint" size="sm" variant="secondary" disabled={pending}
                onClick={() => setMode(mode === "checklist" ? null : "checklist")}>
                Checklist {checklist.passed}/{checklist.total}
                {checklist.failed > 0 ? ` · ${checklist.failed} failed` : ""}
              </CommandButton>
            )}
            <CommandButton commands="verity.manufacturing.complete_operation" size={size} variant="primary" disabled={pending || !cleared}
              title={cleared ? undefined : "Every checkpoint must pass first"}
              onClick={() => run("verity.manufacturing.complete_operation", {})}>
              {bar && <Icon name="check" size={18} />}
              {bar ? "Mark stage complete" : "Complete"}
            </CommandButton>
            <CommandButton commands="verity.manufacturing.hold_operation" size={size} variant="secondary" disabled={pending}
              onClick={() => setMode(mode === "hold" ? null : "hold")}>
              {bar && <Icon name="hold" size={18} />}
              {bar ? "Hold stage" : "Hold"}
            </CommandButton>
          </>
        )}
        {state === "on_hold" && (
          <CommandButton commands="verity.manufacturing.resume_operation" size={size} variant="primary" disabled={pending}
            onClick={() => run("verity.manufacturing.resume_operation", {})}>
            {bar ? "Resume stage" : "Resume"}
          </CommandButton>
        )}
        {(state === "in_progress" || state === "on_hold") && sendBackTo.length > 0 && (
          <CommandButton commands="verity.manufacturing.send_back" size={size} variant="danger" disabled={pending}
            onClick={() => setMode(mode === "back" ? null : "back")}>
            {bar && <Icon name="rework" size={18} />}
            Send back
          </CommandButton>
        )}
    </>
  );

  const formWidth = bar ? "w-full" : "w-72";
  return (
    <div className={bar ? "flex flex-col gap-2" : "flex flex-col items-end gap-2"}>
      {!bar && <div className="flex flex-wrap justify-end gap-2">{buttons}</div>}

      {!bar && mode === "checklist" && <ChecklistPanel operationId={operationId} revalidate={revalidate} />}

      {mode === "hold" && (
        <form
          className={`flex ${formWidth} flex-col gap-2 rounded-lg bg-surface p-3`}
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
          className={`flex ${formWidth} flex-col gap-2 rounded-lg bg-surface p-3`}
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
        <div className={formWidth}>
          <ErrorState title="Could not do that" message={failure.message} issues={failure.issues} retryable={failure.retryable} />
        </div>
      )}
      {bar && (
        <ActionBar note={state === "in_progress" && !cleared ? "Every check must pass before the stage can be completed." : undefined}>
          {buttons}
        </ActionBar>
      )}
    </div>
  );
}
