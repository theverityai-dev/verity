"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Badge, Button, ErrorState, Field, Input } from "@/components/ui/primitives";
import { runCommand, runQuery } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

type Item = {
  key: string;
  label: string;
  requireEvidence: boolean;
  requireRemarks: boolean;
  latest: { result: string; remarks: string | null; evidenceId: string | null; recordedAt: string | Date } | null;
  attempts: number;
};

const OPERATION_ENTITY = "verity.manufacturing.operation";

/**
 * An inspector's checklist for one stage. Each finding is a new, permanent
 * record: a fail is not overwritten by a later pass, it is followed by one, so
 * the history shows what was found and what was fixed. A checkpoint that needs a
 * photo captures it as evidence about THIS operation first, then records the
 * finding against it; the server refuses evidence that belongs to anything else.
 */
export function ChecklistPanel({ operationId, revalidate }: { operationId: string; revalidate: string }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[] | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [drafting, setDrafting] = useState<{ key: string; result: "pass" | "fail" } | null>(null);
  const [pending, startTransition] = useTransition();

  const load = () =>
    startTransition(async () => {
      const result = await runQuery<Item[]>("verity.manufacturing.operation_checklist", { operationId });
      if (result.ok) setItems(result.data);
      else setFailure(result);
    });
  useEffect(load, [operationId]);

  const save = (item: Item, fd: FormData) => {
    setFailure(null);
    startTransition(async () => {
      const remarks = String(fd.get("remarks") ?? "").trim();
      const photo = String(fd.get("photo") ?? "").trim();
      let evidenceId: string | undefined;
      if (photo) {
        const captured = await runCommand<{ id: string }>(
          "verity.evidence.capture",
          { entityKey: OPERATION_ENTITY, entityId: operationId, kind: "Photo", uri: photo, capturedAt: new Date().toISOString() },
          revalidate,
        );
        if (!captured.ok) return setFailure(captured);
        evidenceId = captured.data.id;
      }
      const result = await runCommand(
        "verity.manufacturing.record_checkpoint",
        { operationId, checkpointKey: item.key, result: drafting!.result, remarks: remarks || undefined, evidenceId },
        revalidate,
      );
      if (!result.ok) return setFailure(result);
      setDrafting(null);
      router.refresh();
      const fresh = await runQuery<Item[]>("verity.manufacturing.operation_checklist", { operationId });
      if (fresh.ok) setItems(fresh.data);
    });
  };

  if (!items) return <p className="m-0 text-[13px] text-text-tertiary">{failure ? failure.message : "Loading checklist…"}</p>;
  if (items.length === 0) return <p className="m-0 text-[13px] text-text-tertiary">This stage has no checklist.</p>;

  return (
    <div className="flex w-[22rem] flex-col gap-2 rounded-lg bg-surface p-3">
      {failure && <ErrorState title="Could not record that" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
      <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
        {items.map((item) => (
          <li key={item.key} className="flex flex-col gap-2 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[13.5px] text-text">{item.label}</div>
                <div className="text-[12px] text-text-tertiary">
                  {item.requireEvidence ? "Photo required" : ""}
                  {item.requireEvidence && item.requireRemarks ? " · " : ""}
                  {item.requireRemarks ? "Remarks required" : ""}
                  {item.attempts > 1 ? ` · inspected ${item.attempts} times` : ""}
                </div>
                {item.latest?.remarks && <div className="mt-0.5 text-[12.5px] text-text-secondary">{item.latest.remarks}</div>}
              </div>
              {item.latest ? (
                <Badge tone={item.latest.result === "pass" ? "accent" : "neutral"}>{item.latest.result === "pass" ? "Pass" : "Fail"}</Badge>
              ) : (
                <span className="text-[12px] text-text-tertiary">Not recorded</span>
              )}
            </div>

            {drafting?.key === item.key ? (
              <form className="flex flex-col gap-2" action={(fd) => save(item, fd)}>
                <Field label={`Remarks${drafting.result === "fail" || item.requireRemarks ? " (required)" : ""}`} htmlFor={`rm-${item.key}`}>
                  <Input id={`rm-${item.key}`} name="remarks" maxLength={1000} required={drafting.result === "fail" || item.requireRemarks} autoFocus />
                </Field>
                <Field label={`Photo link${item.requireEvidence ? " (required)" : ""}`} htmlFor={`ph-${item.key}`}>
                  <Input id={`ph-${item.key}`} name="photo" type="url" placeholder="https://…" required={item.requireEvidence} />
                </Field>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" variant="primary" disabled={pending}>
                    {drafting.result === "pass" ? "Record pass" : "Record fail"}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setDrafting(null)} disabled={pending}>Cancel</Button>
                </div>
              </form>
            ) : (
              <div className="flex gap-2">
                <CommandButton commands="verity.manufacturing.record_checkpoint" size="sm" variant="secondary" disabled={pending}
                  onClick={() => setDrafting({ key: item.key, result: "pass" })}>
                  Pass
                </CommandButton>
                <CommandButton commands="verity.manufacturing.record_checkpoint" size="sm" variant="secondary" className="text-danger" disabled={pending}
                  onClick={() => setDrafting({ key: item.key, result: "fail" })}>
                  Fail
                </CommandButton>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
