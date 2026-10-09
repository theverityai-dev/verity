"use client";

import { useState } from "react";
import { CommandButton } from "@/components/ui/CommandAccess";
import { CommandFailure, useCommand } from "@/components/ui/CommandForm";
import { Checkbox, EmptyState, Panel, Textarea } from "@/components/ui/primitives";
import type { ChecklistToday } from "@/server/capabilities/dinein";

const KIND_LABEL = { opening: "Opening", closing: "Closing" } as const;

/**
 * The day's opening and closing lists for each outlet. A tick saves at once and
 * says who and when; the list itself is edited as plain lines, one step per line.
 */
export function ChecklistBoard({ outlets }: { outlets: ChecklistToday }) {
  const tick = useCommand("/checklists");
  const save = useCommand("/checklists");
  const [editing, setEditing] = useState<string | null>(null);

  if (outlets.length === 0) {
    return <EmptyState title="No outlets in your scope" description="Checklists belong to an outlet." />;
  }

  return (
    <div className="flex flex-col gap-6">
      <CommandFailure failure={tick.failure} title="Could not save that tick" />
      <CommandFailure failure={save.failure} title="Could not save the list" />
      {outlets.map((outlet) => (
        <section key={outlet.locationId} aria-label={outlet.locationName} className="flex flex-col gap-4">
          <h2 className="m-0 text-[20px]">{outlet.locationName}</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {outlet.lists.map((list) => {
              const key = `${outlet.locationId}:${list.kind}`;
              const isEditing = editing === key;
              return (
                <Panel
                  key={key}
                  title={`${KIND_LABEL[list.kind]}${list.complete ? ", done" : ""}`}
                  action={
                    <CommandButton commands={"verity.dinein.set_checklist_steps"} size="sm" onClick={() => setEditing(isEditing ? null : key)}>
                      {isEditing ? "Close" : "Edit list"}
                    </CommandButton>
                  }
                >
                  {isEditing ? (
                    <form
                      className="flex flex-col gap-3"
                      action={(formData) =>
                        save.run(
                          "verity.dinein.set_checklist_steps",
                          {
                            locationId: outlet.locationId,
                            kind: list.kind,
                            steps: String(formData.get("steps") ?? "")
                              .split("\n")
                              .map((line) => line.trim())
                              .filter(Boolean),
                          },
                          () => setEditing(null),
                        )
                      }
                    >
                      <label htmlFor={`steps-${key}`} className="text-[13px] text-text-secondary">
                        One step per line. A step taken off the list is retired, so earlier days keep what they were asked.
                      </label>
                      <Textarea id={`steps-${key}`} name="steps" rows={8} defaultValue={list.steps.map((s) => s.label).join("\n")} />
                      <div>
                        <CommandButton commands={"verity.dinein.set_checklist_steps"} type="submit" variant="primary" disabled={save.pending}>
                          Save list
                        </CommandButton>
                      </div>
                    </form>
                  ) : list.steps.length === 0 ? (
                    <p className="m-0 text-[14px] text-text-secondary">
                      No {list.kind} steps yet. Use Edit list to write them, one per line.
                    </p>
                  ) : (
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                      {list.steps.map((step) => (
                        <li key={step.id} className="flex min-h-11 flex-col justify-center">
                          <Checkbox
                            label={<span className={step.done ? "text-text-secondary line-through" : "text-text"}>{step.label}</span>}
                            checked={step.done}
                            disabled={tick.pending}
                            onChange={(event) =>
                              tick.run("verity.dinein.tick_checklist_step", { stepId: step.id, done: event.target.checked })
                            }
                          />
                          {step.done && (
                            <span className="ml-8 text-[12px] text-text-tertiary">
                              {step.doneBy ?? "Someone"}
                              {step.doneAt ? `, ${new Date(step.doneAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : ""}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
