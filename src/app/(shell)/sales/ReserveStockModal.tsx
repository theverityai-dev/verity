"use client";

import { useEffect, useState } from "react";
import { Button, EmptyState, ErrorState, Panel } from "@/components/ui/primitives";
import { Modal, ModalCancel } from "@/components/ui/Modal";
import { runQuery } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

type Step = { locationId: string; locationName: string; qtyUnits: number };

type LinePlan = {
  productId: string;
  name: string;
  qtyOrdered: number;
  isService: boolean;
  steps: Step[];
  choice: {
    qtyToChoose: number;
    candidates: Array<{
      locationId: string;
      locationName: string;
      availableUnits: number;
    }>;
  } | null;
  shortfallUnits: number;
};

type Plan = {
  orderId: string;
  locationId: string;
  locationName: string;
  settled: boolean;
  lines: LinePlan[];
};

export type Allocation = {
  productId: string;
  locationId: string;
  qtyUnits: number;
};

/**
 * WHERE THE STOCK COMES FROM, BEFORE IT IS HELD.
 *
 * An order for 100 sheets against a godown holding 55 used to be refused
 * outright. It is not a refusal — it is a question, and the question has an
 * answer the person standing at the counter knows and the database does not:
 * which of the other godowns to empty. What else is arriving there, who
 * collects from where, which van is going that way. Picking the fullest one
 * would be a guess wearing the clothes of a decision.
 *
 * So the server plans what is not in doubt and this asks about what is. The
 * order's own godown is drawn from first, without being asked. A remainder
 * that only one godown can supply is taken, without being asked. Only a real
 * choice — two or more godowns that could each cover what is left — stops and
 * waits, and choosing one recomputes the remainder so the next choice is
 * asked in turn until the line is filled.
 *
 * THE PLAN IS NOT A PROMISE. Nothing is locked while this is open, so another
 * order can take the last sheet between reading and confirming. The command
 * re-reads every figure under a row lock and will refuse a stale plan by name.
 */
export function ReserveStockModal({
  orderId,
  pending,
  onClose,
  onConfirm,
}: {
  orderId: string | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (allocations: Allocation[]) => void;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [loading, setLoading] = useState(false);
  /** What the person chose, per product, beyond what the plan settled. */
  const [chosen, setChosen] = useState<Record<string, Step[]>>({});

  useEffect(() => {
    if (!orderId) {
      setPlan(null);
      setChosen({});
      setFailure(null);
      return;
    }
    let live = true;
    setLoading(true);
    setFailure(null);
    void runQuery<Plan>("verity.trading.allocation_plan", { orderId }).then(
      (result) => {
        if (!live) return;
        setLoading(false);
        if (result.ok) {
          setPlan(result.data);
          setChosen({});
        } else {
          setFailure(result);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [orderId]);

  /** What is still unplaced on a line, after the plan and the choices so far. */
  function outstanding(line: LinePlan): number {
    if (line.isService || !line.choice) return 0;
    const taken = (chosen[line.productId] ?? []).reduce(
      (sum, step) => sum + step.qtyUnits,
      0,
    );
    return line.choice.qtyToChoose - taken;
  }

  /** What a godown still has, after this line's own choices have drawn on it. */
  function remainingAt(line: LinePlan, locationId: string): number {
    const candidate = line.choice?.candidates.find(
      (row) => row.locationId === locationId,
    );
    if (!candidate) return 0;
    const drawn = (chosen[line.productId] ?? [])
      .filter((step) => step.locationId === locationId)
      .reduce((sum, step) => sum + step.qtyUnits, 0);
    return candidate.availableUnits - drawn;
  }

  // Take as much as this godown can give, up to what is still needed. One tap
  // per godown: the person is answering "where from", not doing arithmetic.
  function drawFrom(line: LinePlan, locationId: string, locationName: string) {
    const need = outstanding(line);
    const take = Math.min(need, remainingAt(line, locationId));
    if (take <= 0) return;
    setChosen((current) => {
      const steps = current[line.productId] ?? [];
      const at = steps.findIndex((step) => step.locationId === locationId);
      const next =
        at === -1
          ? [...steps, { locationId, locationName, qtyUnits: take }]
          : steps.map((step, index) =>
              index === at
                ? { ...step, qtyUnits: step.qtyUnits + take }
                : step,
            );
      return { ...current, [line.productId]: next };
    });
  }

  function clearChoices(line: LinePlan) {
    setChosen((current) => ({ ...current, [line.productId]: [] }));
  }

  const shortLine = plan?.lines.find((line) => line.shortfallUnits > 0) ?? null;
  const unresolved =
    plan?.lines.filter((line) => outstanding(line) > 0).length ?? 0;
  const ready = plan !== null && shortLine === null && unresolved === 0;

  function allocations(): Allocation[] {
    if (!plan) return [];
    return plan.lines.flatMap((line) =>
      line.isService
        ? []
        : [...line.steps, ...(chosen[line.productId] ?? [])].map((step) => ({
            productId: line.productId,
            locationId: step.locationId,
            qtyUnits: step.qtyUnits,
          })),
    );
  }

  return (
    <Modal
      open={orderId !== null}
      onClose={onClose}
      title="Hold stock for this order"
      description={
        plan
          ? `Drawn from ${plan.locationName} first, then from wherever else you choose.`
          : "Working out where the stock is."
      }
      width="lg"
      footer={
        <>
          <ModalCancel onClose={onClose} disabled={pending} />
          <Button
            variant="primary"
            disabled={pending || !ready}
            onClick={() => onConfirm(allocations())}
          >
            {pending ? "Holding…" : "Hold stock"}
          </Button>
        </>
      }
    >
      {failure && (
        <ErrorState
          title="That could not be worked out"
          message={failure.message}
          issues={failure.issues}
          retryable={failure.retryable}
        />
      )}

      {!failure && loading && (
        <p className="m-0 text-[13px] text-text-secondary">
          Reading stock across your godowns…
        </p>
      )}

      {!failure && !loading && plan && plan.lines.length === 0 && (
        <EmptyState
          compact
          title="Nothing to hold"
          description="This order has no lines."
        />
      )}

      {!failure && !loading && plan && plan.lines.length > 0 && (
        <div className="flex flex-col gap-3">
          {plan.lines.map((line) => {
            const need = outstanding(line);
            const picked = chosen[line.productId] ?? [];
            return (
              <Panel key={line.productId} title={line.name}>
                {line.isService ? (
                  <p className="m-0 text-[13px] text-text-secondary">
                    A service — nothing to hold.
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                      {[...line.steps, ...picked].map((step) => (
                        <li
                          key={`${step.locationId}-${step.qtyUnits}`}
                          className="flex items-baseline justify-between gap-3 text-[13px]"
                        >
                          <span className="text-text-secondary">
                            {step.locationName}
                          </span>
                          <span className="tabular text-text">
                            {step.qtyUnits}
                          </span>
                        </li>
                      ))}
                      {line.steps.length + picked.length === 0 && (
                        <li className="text-[13px] text-text-tertiary">
                          Nothing allocated yet.
                        </li>
                      )}
                    </ul>

                    {line.shortfallUnits > 0 && (
                      <p className="m-0 text-[13px] text-danger">
                        Short by {line.shortfallUnits} of the {line.qtyOrdered}{" "}
                        ordered, across every godown you can draw from. Raise a
                        purchase order, or reduce the line.
                      </p>
                    )}

                    {line.choice && need > 0 && (
                      <div className="flex flex-col gap-2 border-t border-line pt-3">
                        <p className="m-0 text-[13px] text-text">
                          {need} still to place. Which godown?
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {line.choice.candidates.map((candidate) => {
                            const left = remainingAt(
                              line,
                              candidate.locationId,
                            );
                            return (
                              <button
                                key={candidate.locationId}
                                type="button"
                                disabled={left <= 0}
                                onClick={() =>
                                  drawFrom(
                                    line,
                                    candidate.locationId,
                                    candidate.locationName,
                                  )
                                }
                                className={
                                  "rounded-[10px] px-2.5 py-1.5 text-[13px] bg-control " +
                                  "text-text-secondary transition-colors duration-150 " +
                                  "hover:border-line-strong hover:text-text " +
                                  "focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--color-accent-subtle)] " +
                                  "disabled:cursor-not-allowed disabled:opacity-55"
                                }
                              >
                                {candidate.locationName}
                                <span className="ml-1.5 tabular text-text-tertiary">
                                  {Math.min(left, need)} of {left}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {picked.length > 0 && (
                      <button
                        type="button"
                        onClick={() => clearChoices(line)}
                        className={
                          "self-start text-[12px] text-text-tertiary underline underline-offset-2 " +
                          "hover:text-text focus-visible:outline-none " +
                          "focus-visible:shadow-[0_0_0_3px_var(--color-accent-subtle)]"
                        }
                      >
                        Start this line again
                      </button>
                    )}
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
