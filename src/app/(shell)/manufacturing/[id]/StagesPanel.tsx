"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { DataTable } from "@/components/ui/DataTable";
import { Button, EmptyState, ErrorState, Field, Select, Textarea } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import { OperationActions } from "../OperationActions";
import { stageKeyFor } from "../routes/CreateRouteForm";

export type StageRow = {
  id: string;
  sequence: number;
  stageKey: string;
  label: string;
  state: string;
  category: string;
  note: string | null;
  rework: boolean;
  startedAt: string | null;
  completedAt: string | null;
  actionable: boolean;
};

type RouteOption = { id: string; code: string; name: string; stages: string };

const stamp = (iso: string | null) => (iso ? iso.replace("T", " ").slice(0, 16) : "—");

/**
 * An order's stages: plan them (from a route, or the order's own list, which is
 * how one order skips or reorders a stage), then work them. History is never
 * edited: a send-back appends, so a reworked order shows every attempt.
 */
export function StagesPanel({
  orderId,
  orderState,
  stages,
  routes,
}: {
  orderId: string;
  orderState: string;
  stages: StageRow[];
  routes: RouteOption[];
}) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const [custom, setCustom] = useState(false);

  if (stages.length === 0) {
    if (orderState !== "draft" && orderState !== "in_progress") {
      return <EmptyState title="No stages" description="This order was made without stages." compact />;
    }
    return (
      <form
        className="flex flex-col gap-3 p-4"
        action={(fd) => {
          setFailure(null);
          startTransition(async () => {
            const own = String(fd.get("own") ?? "")
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean)
              .map((label) => ({ stageKey: stageKeyFor(label), label }));
            const input = custom ? { orderId, stages: own } : { orderId, routeId: String(fd.get("routeId") ?? "") };
            const result = await runCommand("verity.manufacturing.plan_operations", input, "/manufacturing");
            if (result.ok) router.refresh();
            else setFailure(result);
          });
        }}
      >
        <p className="m-0 text-[13px] text-text-secondary">
          Plan this order into stages so the floor can work it. Use a route, or give this order its own stages.
        </p>
        {failure && <ErrorState title="Could not plan the stages" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
        {custom ? (
          <Field label="Stages, one per line, in order" htmlFor="own-stages" required>
            <Textarea id="own-stages" name="own" rows={5} required placeholder={"Cutting\nStitching\nPacking"} />
          </Field>
        ) : (
          <Field label="Route" htmlFor="plan-route" required hint={routes.length === 0 ? "No active routes. Create one first, or use this order's own stages." : undefined}>
            <Select id="plan-route" name="routeId" required defaultValue="">
              <option value="" disabled>Select a route</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>{r.code} · {r.stages}</option>
              ))}
            </Select>
          </Field>
        )}
        <div className="flex gap-2">
          <CommandButton commands="verity.manufacturing.plan_operations" type="submit" variant="primary" disabled={pending}>
            {pending ? "Planning…" : "Plan stages"}
          </CommandButton>
          <Button type="button" variant="ghost" onClick={() => setCustom((c) => !c)} disabled={pending}>
            {custom ? "Use a route" : "Use this order's own stages"}
          </Button>
        </div>
      </form>
    );
  }

  // Latest instance of each stage, in first-appearance order: what an operator can send back to.
  const stageOrder: Array<{ stageKey: string; label: string }> = [];
  for (const s of stages) if (!stageOrder.some((x) => x.stageKey === s.stageKey)) stageOrder.push({ stageKey: s.stageKey, label: s.label });

  const rows = stages.map((s) => ({
    id: s.id,
    step: s.sequence,
    stage: s.label + (s.rework ? " (rework)" : ""),
    state: s.state.replace(/_/g, " "),
    rawState: s.state,
    category: s.category,
    note: s.note ?? "",
    started: stamp(s.startedAt),
    finished: stamp(s.completedAt),
    actionable: s.actionable,
    sendBackTo: stageOrder.slice(0, stageOrder.findIndex((x) => x.stageKey === s.stageKey) + 1),
  }));

  return (
    <DataTable
      caption="Order stages"
      rows={rows}
      columns={[
        { key: "step", header: "#", numeric: true },
        { key: "stage", header: "Stage", subKey: "note" },
        { key: "state", header: "State", variant: "state", categoryKey: "category" },
        { key: "started", header: "Started" },
        { key: "finished", header: "Finished" },
      ]}
      emptyTitle="No stages"
      emptyDescription="This order has no stages."
      rowActions={(row) => (
        <OperationActions
          operationId={String(row.id)}
          state={String(row.rawState)}
          actionable={Boolean(row.actionable)}
          sendBackTo={row.sendBackTo as Array<{ stageKey: string; label: string }>}
          revalidate="/manufacturing"
        />
      )}
    />
  );
}
