"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Button, ErrorState, Field, Input } from "@/components/ui/primitives";
import { PhotoCapture } from "@/components/ui/PhotoCapture";
import { ChecklistHeader, ChecklistRows, type ChecklistRow } from "@/components/ui/Checklist";
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
export function ChecklistPanel({
  operationId,
  revalidate,
  layout = "popover",
}: {
  operationId: string;
  revalidate: string;
  /** `popover`: under a table row. `pane`: full width inside the detail pane. */
  layout?: "popover" | "pane";
}) {
  const router = useRouter();
  const [items, setItems] = useState<Item[] | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [drafting, setDrafting] = useState<{ key: string; result: "pass" | "fail" } | null>(null);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const begin = (key: string, result: "pass" | "fail") => { setPhotoId(null); setDrafting({ key, result }); };

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
      if (item.requireEvidence && !photoId) {
        return setFailure({ ok: false, code: "E_VALIDATION", message: "This check needs a photo. Take one first.", retryable: false });
      }
      const result = await runCommand(
        "verity.manufacturing.record_checkpoint",
        { operationId, checkpointKey: item.key, result: drafting!.result, remarks: remarks || undefined, evidenceId: photoId ?? undefined },
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

  const passed = items.filter((i) => i.latest?.result === "pass").length;
  const rows: ChecklistRow[] = items.map((item) => {
    const needs = [
      item.requireEvidence ? "Photo required" : "",
      item.requireRemarks ? "Remarks required" : "",
      item.attempts > 1 ? `inspected ${item.attempts} times` : "",
    ].filter(Boolean);
    const open = drafting?.key === item.key;
    return {
      key: item.key,
      label: item.label,
      requirement: needs.join(" · ") || undefined,
      verdict: item.latest ? (item.latest.result === "pass" ? "pass" : "fail") : "none",
      note: item.latest?.remarks ?? undefined,
      actions: open ? undefined : (
        <>
          <CommandButton commands="verity.manufacturing.record_checkpoint" size="sm" variant="secondary" disabled={pending}
            onClick={() => begin(item.key, "pass")}>
            Pass
          </CommandButton>
          <CommandButton commands="verity.manufacturing.record_checkpoint" size="sm" variant="danger" disabled={pending}
            onClick={() => begin(item.key, "fail")}>
            Fail
          </CommandButton>
        </>
      ),
      expanded: open ? (
        <form className="flex flex-col gap-2" action={(fd) => save(item, fd)}>
          <Field label={`Remarks${drafting!.result === "fail" || item.requireRemarks ? " (required)" : ""}`} htmlFor={`rm-${item.key}`}>
            <Input id={`rm-${item.key}`} name="remarks" maxLength={1000} required={drafting!.result === "fail" || item.requireRemarks} autoFocus />
          </Field>
          <PhotoCapture key={item.key} entityKey={OPERATION_ENTITY} entityId={operationId} revalidate={revalidate}
            required={item.requireEvidence} onCaptured={setPhotoId} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="primary" disabled={pending}>
              {drafting!.result === "pass" ? "Record pass" : "Record fail"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDrafting(null)} disabled={pending}>Cancel</Button>
          </div>
        </form>
      ) : undefined,
    };
  });

  return (
    <div className={layout === "pane" ? "flex flex-col gap-2" : "flex w-[22rem] flex-col gap-2 rounded-lg bg-surface p-3"}>
      {failure && <ErrorState title="Could not record that" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
      <ChecklistHeader title="Quality checks" passed={passed} total={items.length} />
      <ChecklistRows rows={rows} />
    </div>
  );
}
