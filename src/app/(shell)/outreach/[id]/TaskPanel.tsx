"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, ErrorState, Field, Input, Panel, Select, Textarea } from "@/components/ui/primitives";
import { FormDateField } from "@/components/ui/DateTimePicker";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

const PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;

type Task = {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  origin: string;
  dueAt: string | null;
  assignedToPartyId: string;
};

/** Task list + create form on a lead (Task 106 Phase 5, spec §53-55). */
export function TaskPanel({
  leadId,
  teamId,
  tasks,
  teamMembers,
  partyName,
  canCreate,
  initiallyOpen = false,
}: {
  leadId: string;
  teamId: string;
  tasks: Task[];
  teamMembers: Array<{ id: string; name: string }>;
  partyName: Map<string, string>;
  canCreate: boolean;
  initiallyOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(initiallyOpen);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  function setStatus(taskId: string, status: "InProgress" | "Blocked" | "Done" | "Cancelled") {
    startTransition(async () => {
      const result = await runCommand("verity.outreach.set_task_status", { taskId, status }, `/outreach/${leadId}`);
      if (result.ok) router.refresh();
    });
  }

  return (
    <Panel title="Tasks">
      {tasks.length === 0 ? (
        <p className="text-[13px] text-text-tertiary">No tasks yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {tasks.map((t) => (
            <li key={t.id} className="flex flex-col gap-1.5 border-b border-line pb-3 last:border-none last:pb-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className={t.status === "Done" || t.status === "Cancelled" ? "text-[14px] text-text-tertiary line-through" : "text-[14px] text-text"}>
                  {t.title}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Badge>{t.priority}</Badge>
                  <Badge tone={t.status === "Done" ? "accent" : "neutral"}>{t.status.replace(/([A-Z])/g, " $1").trim()}</Badge>
                </span>
              </div>
              {t.description && <p className="m-0 text-[12px] text-text-secondary">{t.description}</p>}
              <span className="text-[12px] text-text-tertiary">
                {partyName.get(t.assignedToPartyId) ?? "—"}
                {t.dueAt && ` · Due ${new Date(t.dueAt).toISOString().slice(0, 10)}`}
                {" · "}
                {t.origin.replace(/([A-Z])/g, " $1").trim()}
              </span>
              {t.status !== "Done" && t.status !== "Cancelled" && (
                <div className="flex gap-1.5">
                  {t.status !== "InProgress" && (
                    <Button size="sm" variant="secondary" disabled={pending} onClick={() => setStatus(t.id, "InProgress")}>
                      Start
                    </Button>
                  )}
                  {t.status !== "Blocked" && (
                    <Button size="sm" variant="secondary" disabled={pending} onClick={() => setStatus(t.id, "Blocked")}>
                      Block
                    </Button>
                  )}
                  <Button size="sm" disabled={pending} onClick={() => setStatus(t.id, "Done")}>
                    Complete
                  </Button>
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => setStatus(t.id, "Cancelled")}>
                    Cancel
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canCreate && !open && (
        <div className="mt-4">
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            + Add task
          </Button>
        </div>
      )}

      {canCreate && open && (
        <form
          className="mt-4 grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setFailure(null);
            startTransition(async () => {
              const result = await runCommand(
                "verity.outreach.create_task",
                {
                  teamId,
                  leadId,
                  title: String(form.get("title") ?? ""),
                  description: String(form.get("description") ?? "") || undefined,
                  priority: String(form.get("priority") ?? "Medium"),
                  dueAt: form.get("dueAt") ? new Date(String(form.get("dueAt"))).toISOString() : undefined,
                  assignedToPartyId: String(form.get("assignedToPartyId") ?? ""),
                },
                `/outreach/${leadId}`,
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
          <Field label="Title" htmlFor="taskTitle" required>
            <Input id="taskTitle" name="title" required />
          </Field>
          <Field label="Assign to" htmlFor="assignedToPartyId" required>
            <Select id="assignedToPartyId" name="assignedToPartyId" required>
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="taskPriority">
            <Select id="taskPriority" name="priority" defaultValue="Medium">
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due date" htmlFor="dueAt">
            <FormDateField id="dueAt" name="dueAt" />
          </Field>
          <Field label="Description" htmlFor="taskDescription">
            <Textarea id="taskDescription" name="description" rows={2} />
          </Field>
          {failure && <ErrorState title="Could not create task" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save task"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}
