"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { ErrorState, Field, Input } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

const ORDER_ENTITY = "verity.manufacturing.order";

export type DispatchEvent = {
  id: string;
  status: "dispatched" | "delivered";
  transporter: string | null;
  vehicleNo: string | null;
  trackingRef: string | null;
  note: string | null;
  recordedAt: string;
};

/**
 * Sending a finished order out: transporter, vehicle, tracking and a packaging
 * photograph, then confirming it arrived. The photo is captured as evidence about
 * THIS order first and the dispatch is recorded against it; the server refuses a
 * photo that belongs to anything else. The trail is append-only, so what is shown
 * below is the whole history, newest first.
 */
export function DispatchPanel({
  orderId,
  orderState,
  status,
  events,
}: {
  orderId: string;
  orderState: string;
  status: "dispatched" | "delivered" | null;
  events: DispatchEvent[];
}) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  const trail = events.length > 0 && (
    <ol className="m-0 flex list-none flex-col gap-2 p-0">
      {events.map((e) => (
        <li key={e.id} className="text-[13px] text-text-secondary">
          <span className="text-text">{e.status === "delivered" ? "Delivered" : "Dispatched"}</span>{" "}
          {e.recordedAt.slice(0, 16).replace("T", " ")}
          {e.transporter ? ` · ${e.transporter}` : ""}
          {e.vehicleNo ? ` · ${e.vehicleNo}` : ""}
          {e.trackingRef ? ` · tracking ${e.trackingRef}` : ""}
          {e.note ? ` — ${e.note}` : ""}
        </li>
      ))}
    </ol>
  );

  if (status === null && orderState !== "completed") {
    return <p className="m-0 p-4 text-[13px] text-text-secondary">An order can be dispatched once it is completed.</p>;
  }

  if (status === null) {
    return (
      <form
        className="flex flex-col gap-3 p-4"
        action={(fd) =>
          startTransition(async () => {
            setFailure(null);
            const captured = await runCommand<{ id: string }>(
              "verity.evidence.capture",
              {
                entityKey: ORDER_ENTITY,
                entityId: orderId,
                kind: "Photo",
                uri: String(fd.get("photo") ?? "").trim(),
                capturedAt: new Date().toISOString(),
              },
              "/manufacturing",
            );
            if (!captured.ok) return setFailure(captured);
            const result = await runCommand(
              "verity.manufacturing.dispatch_order",
              {
                orderId,
                transporter: String(fd.get("transporter") ?? "").trim(),
                vehicleNo: String(fd.get("vehicleNo") ?? "").trim() || undefined,
                trackingRef: String(fd.get("trackingRef") ?? "").trim() || undefined,
                packagingEvidenceId: captured.data.id,
                note: String(fd.get("note") ?? "").trim() || undefined,
              },
              "/manufacturing",
            );
            if (result.ok) router.refresh();
            else setFailure(result);
          })
        }
      >
        {failure && <ErrorState title="Could not dispatch" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Transporter" htmlFor="dispatch-transporter" required>
            <Input id="dispatch-transporter" name="transporter" minLength={2} maxLength={120} required />
          </Field>
          <Field label="Vehicle number" htmlFor="dispatch-vehicle">
            <Input id="dispatch-vehicle" name="vehicleNo" maxLength={40} />
          </Field>
          <Field label="Tracking reference" htmlFor="dispatch-tracking">
            <Input id="dispatch-tracking" name="trackingRef" maxLength={120} />
          </Field>
          <Field label="Packaging photo" htmlFor="dispatch-photo" required hint="Link to the photo of the packed order.">
            <Input id="dispatch-photo" name="photo" type="url" required />
          </Field>
        </div>
        <Field label="Note" htmlFor="dispatch-note" hint="Optional.">
          <Input id="dispatch-note" name="note" maxLength={400} />
        </Field>
        <div>
          <CommandButton commands="verity.manufacturing.dispatch_order" type="submit" variant="primary" disabled={pending}>
            {pending ? "Dispatching…" : "Dispatch order"}
          </CommandButton>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {failure && <ErrorState title="Could not update" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
      {trail}
      {status === "dispatched" && (
        <div>
          <CommandButton
            commands="verity.manufacturing.confirm_delivery"
            size="sm"
            variant="primary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setFailure(null);
                const result = await runCommand("verity.manufacturing.confirm_delivery", { orderId }, "/manufacturing");
                if (result.ok) router.refresh();
                else setFailure(result);
              })
            }
          >
            {pending ? "Saving…" : "Mark delivered"}
          </CommandButton>
        </div>
      )}
    </div>
  );
}

/**
 * Holding stock for a draft order so no other order is promised it. Reserving is
 * all-or-nothing across the order's components; starting the order consumes the
 * hold, and cancelling it gives the stock back.
 */
export function StockHoldPanel({ orderId, held, lines }: { orderId: string; held: number; lines: number }) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const holding = held > 0;

  const run = (key: string) =>
    startTransition(async () => {
      setFailure(null);
      const result = await runCommand(key, { orderId }, "/manufacturing");
      if (result.ok) router.refresh();
      else setFailure(result);
    });

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="m-0 text-[13px] text-text-secondary">
        {holding
          ? `Stock is held for ${held} of ${lines} component${lines === 1 ? "" : "s"}. No other order can be promised it.`
          : "Nothing is held for this order yet. Hold its components so another order cannot take them first."}
      </p>
      {failure && <ErrorState title="Could not update the hold" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
      <div className="flex gap-2">
        {held < lines && (
          <CommandButton commands="verity.manufacturing.reserve_order" size="sm" variant="secondary" disabled={pending} onClick={() => run("verity.manufacturing.reserve_order")}>
            {pending ? "Working…" : "Hold stock"}
          </CommandButton>
        )}
        {holding && (
          <CommandButton commands="verity.manufacturing.release_reservation" size="sm" variant="ghost" disabled={pending} onClick={() => run("verity.manufacturing.release_reservation")}>
            Release hold
          </CommandButton>
        )}
      </div>
    </div>
  );
}
