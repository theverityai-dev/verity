"use client";

import { CommandButton } from "@/components/ui/CommandAccess";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EmptyState, ErrorState, Panel } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import type { KitchenTicket } from "@/server/capabilities/dinein";

/**
 * The kitchen board.
 *
 * Three columns, because a cook has three questions: what is waiting, what am I
 * on, and what is ready to leave. One list sorted by state would answer none of
 * them at a glance, and glancing is the whole interaction — the reader has their
 * hands full and is standing two feet further away than anyone else using this
 * product.
 *
 * Hence the type sizes, the target sizes, and one tap per move. There is no
 * confirmation dialog: a mis-tap is corrected by a manager, and a modal between
 * a cook and a hot pan is worse than the mistake it prevents.
 *
 * URGENCY is read, never computed here. `urgencyFor()` derives it from the
 * platform's SLA clocks, which are driven by state category. A timer written in
 * this file would be the bump timer DEC-001 excludes.
 */

const COLUMNS = [
  { state: "queued", title: "Waiting", next: "preparing", action: "Start" },
  { state: "preparing", title: "On", next: "ready", action: "Ready" },
  { state: "ready", title: "Ready to go", next: null, action: null },
] as const;

const URGENCY_STYLE: Record<string, string> = {
  none: "border-line",
  low: "border-line",
  medium: "border-info/50",
  high: "border-warning/60",
  critical: "border-warning",
  breached: "border-danger",
};

const URGENCY_LABEL: Record<string, string> = {
  none: "",
  low: "",
  medium: "",
  high: "Getting on",
  critical: "Nearly late",
  breached: "Late",
};

export function KitchenBoard({ tickets }: { tickets: KitchenTicket[] }) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  // Polled, not pushed. D1 records the decision: at Kent's scale a refresh every
  // ten seconds is indistinguishable from a socket, and a socket is a transport
  // to run, secure and reconnect. It becomes worth it above ten devices or below
  // a second, and neither is true here.
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(timer);
  }, [router]);

  const byState = useMemo(() => {
    const grouped = new Map<string, KitchenTicket[]>();
    for (const ticket of tickets) {
      grouped.set(ticket.state, [...(grouped.get(ticket.state) ?? []), ticket]);
    }
    return grouped;
  }, [tickets]);

  function advance(lineId: string, to: string) {
    setFailure(null);
    startTransition(async () => {
      const result = await runCommand(
        "verity.dinein.advance_order_line",
        { lineId, to },
        "/kitchen",
      );
      if (result.ok) router.refresh();
      else setFailure(result);
    });
  }

  return (
    <>
      {failure && (
        <div className="mb-4">
          <ErrorState
            title="That did not happen"
            message={failure.message}
            issues={failure.issues}
            retryable={failure.retryable}
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {COLUMNS.map((column) => {
          const items = byState.get(column.state) ?? [];
          return (
            <Panel
              key={column.state}
              title={column.title}
              action={
                <span className="tabular text-[13px] text-text-tertiary">{items.length}</span>
              }
            >
              {items.length === 0 ? (
                <EmptyState compact title="Nothing here" />
              ) : (
                <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                  {items.map((ticket) => (
                    <li
                      key={ticket.lineId}
                      className={
                        "rounded-lg border-2 bg-surface p-3.5 " +
                        (URGENCY_STYLE[ticket.urgency] ?? "border-line")
                      }
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        {/* Quantity first and large: the number is what a cook
                            acts on, and "2 ×" read as "1 ×" is a wasted dish. */}
                        <span className="text-[17px] text-text">
                          <span className="tabular font-medium">{ticket.qty} ×</span>{" "}
                          {ticket.itemName}
                          {ticket.variantName && (
                            <span className="text-text-secondary"> ({ticket.variantName})</span>
                          )}
                        </span>
                        <span className="shrink-0 text-[14px] font-medium text-text-secondary">
                          {ticket.label}
                        </span>
                      </div>

                      {ticket.lineNote && (
                        <p className="mb-0 mt-1.5 text-[14px] text-accent-ink">{ticket.lineNote}</p>
                      )}

                      <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="text-[13px]">
                          {/* Never colour alone: a kitchen light is bad, and a
                              cook may be colour-blind. */}
                          {URGENCY_LABEL[ticket.urgency] ? (
                            <span
                              className={
                                ticket.urgency === "breached" ? "text-danger" : "text-warning"
                              }
                            >
                              {URGENCY_LABEL[ticket.urgency]}
                              {ticket.remainingMinutes !== null &&
                                ` · ${Math.abs(Math.round(ticket.remainingMinutes))} min ${
                                  ticket.remainingMinutes < 0 ? "over" : "left"
                                }`}
                            </span>
                          ) : (
                            <span className="text-text-tertiary">
                              {ticket.remainingMinutes === null
                                ? "No target"
                                : `${Math.round(ticket.remainingMinutes)} min left`}
                            </span>
                          )}
                        </span>

                        {column.next && column.action && (
                          <CommandButton commands={"verity.dinein.advance_order_line"}
                            size="md"
                            variant="primary"
                            disabled={pending}
                            onClick={() => advance(ticket.lineId, column.next!)}
                          >
                            {column.action}
                          </CommandButton>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          );
        })}
      </div>

      <p className="mb-0 mt-4 text-[12px] text-text-tertiary">
        Refreshes every ten seconds. A dish tapped by mistake is corrected by a manager — there are
        no backwards steps here, so that a board always reads as what happened.
      </p>
    </>
  );
}
