"use client";

import { useState } from "react";
import { CommandFailure, FormModal, formText, useCommand } from "@/components/ui/CommandForm";
import { Modal, ModalCancel } from "@/components/ui/Modal";
import { Button, Field, Input } from "@/components/ui/primitives";
import { paiseToRupeesText, rupeesTextToPaise } from "../format";

type ReceiveLine = { id: string; item: string; unit: string; remaining: number; unitPricePaise: number };
type Entry = { accepted: string; rejected: string; reason: string; price: string };

const ROUTE = "/inventory/purchase-orders";

/**
 * What can be done to this order right now. Buttons appear only for what the
 * person's role may do; the server still decides, so a hidden button is a
 * convenience and never the control.
 */
export function OrderActions({
  orderId,
  status,
  canEdit,
  canApprove,
  canReceive,
  nothingReceivedYet,
  lines,
}: {
  orderId: string;
  status: string;
  canEdit: boolean;
  canApprove: boolean;
  canReceive: boolean;
  nothingReceivedYet: boolean;
  lines: ReceiveLine[];
}) {
  const command = useCommand(`${ROUTE}/${orderId}`);
  const [cancelling, setCancelling] = useState(false);
  const [receiving, setReceiving] = useState(false);

  const canCancel = canEdit && nothingReceivedYet && (status === "Draft" || status === "PendingApproval" || status === "Approved");
  const canReceiveNow = canReceive && (status === "Approved" || status === "PartiallyReceived");

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {status === "Draft" && canEdit && (
          <Button
            variant="primary"
            disabled={command.pending}
            onClick={() => command.run("verity.inventory.submit_purchase_order", { orderId })}
          >
            Submit order
          </Button>
        )}
        {status === "PendingApproval" && canApprove && (
          <Button
            variant="primary"
            disabled={command.pending}
            onClick={() => command.run("verity.inventory.approve_purchase_order", { orderId })}
          >
            Approve order
          </Button>
        )}
        {canReceiveNow && (
          <Button variant="primary" onClick={() => setReceiving(true)}>Receive goods</Button>
        )}
        {canCancel && (
          <Button variant="ghost" onClick={() => setCancelling(true)}>Cancel order</Button>
        )}
      </div>
      {status === "PendingApproval" && !canApprove && (
        <p role="status" className="m-0 mt-2 w-full text-[13px] text-text-secondary">
          This order is over the approval limit and is waiting for the owner.
        </p>
      )}
      {!receiving && !cancelling && <CommandFailure failure={command.failure} title="Could not update the order" />}

      <FormModal
        title="Cancel this order"
        description="The vendor is not told automatically. Say why, so the next buyer knows."
        open={cancelling}
        onClose={() => {
          setCancelling(false);
          command.clear();
        }}
        submitLabel="Cancel order"
        destructive
        pending={command.pending}
        failure={command.failure}
        failureTitle="Could not cancel the order"
        onSubmit={(form) =>
          command.run("verity.inventory.cancel_purchase_order", { orderId, reason: formText(form, "reason") }, () => setCancelling(false))
        }
      >
        <Field label="Reason" htmlFor="po-cancel-reason" required>
          <Input id="po-cancel-reason" name="reason" required maxLength={300} autoFocus placeholder="Vendor out of stock" />
        </Field>
      </FormModal>

      {receiving && <ReceiveSheet orderId={orderId} lines={lines.filter((l) => l.remaining > 0)} onClose={() => setReceiving(false)} />}
    </>
  );
}

/* --------------------------------- receiving -------------------------------- */

function ReceiveSheet({ orderId, lines, onClose }: { orderId: string; lines: ReceiveLine[]; onClose: () => void }) {
  const command = useCommand(`${ROUTE}/${orderId}`);
  const [invoice, setInvoice] = useState("");
  const [entries, setEntries] = useState<Record<string, Entry>>(
    Object.fromEntries(lines.map((l) => [l.id, { accepted: String(l.remaining), rejected: "", reason: "", price: String(l.unitPricePaise / 100) }])),
  );

  function patch(id: string, change: Partial<Entry>) {
    setEntries((current) => ({ ...current, [id]: { ...current[id]!, ...change } }));
  }

  const parsed = lines.map((l) => {
    const e = entries[l.id]!;
    const accepted = e.accepted.trim() === "" ? 0 : Number(e.accepted);
    const rejected = e.rejected.trim() === "" ? 0 : Number(e.rejected);
    const pricePaise = rupeesTextToPaise(e.price);
    const problem =
      !Number.isInteger(accepted) || accepted < 0 || !Number.isInteger(rejected) || rejected < 0
        ? "Quantities must be whole numbers, zero or more."
        : accepted > l.remaining
          ? `Only ${l.remaining.toLocaleString("en-IN")} ${l.unit} is still due.`
          : rejected > 0 && e.reason.trim() === ""
            ? "Say why it was rejected."
            : pricePaise === null
              ? "Enter the price as 255 or 255.50."
              : null;
    return { line: l, entry: e, accepted, rejected, pricePaise, problem };
  });
  const anything = parsed.some((p) => p.accepted > 0 || p.rejected > 0);
  const blocked = parsed.find((p) => p.problem && (p.accepted > 0 || p.rejected > 0 || p.entry.accepted.trim() !== ""));
  const accepted = parsed.reduce((sum, p) => sum + (p.problem ? 0 : p.accepted * (p.pricePaise ?? 0)), 0);

  function save() {
    command.run(
      "verity.inventory.receive_goods",
      {
        orderId,
        invoiceRef: invoice.trim() || undefined,
        lines: parsed
          .filter((p) => p.accepted > 0 || p.rejected > 0)
          .map((p) => ({
            orderLineId: p.line.id,
            acceptedQty: p.accepted,
            rejectedQty: p.rejected > 0 ? p.rejected : undefined,
            rejectReason: p.rejected > 0 ? p.entry.reason.trim() : undefined,
            unitPricePaise: p.pricePaise ?? undefined,
          })),
      },
      onClose,
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      width="lg"
      title="Receive goods"
      description="Count what came off the truck. Accepted quantities go into stock at the price on the invoice."
      footer={
        <>
          <ModalCancel onClose={onClose} disabled={command.pending} />
          <Button variant="primary" onClick={save} disabled={command.pending || !anything || Boolean(blocked)}>
            {command.pending ? "Saving…" : `Add to stock · ${paiseToRupeesText(accepted)}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Invoice or delivery note number" htmlFor="grn-invoice">
          <Input id="grn-invoice" value={invoice} onChange={(e) => setInvoice(e.target.value)} maxLength={100} />
        </Field>
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {parsed.map(({ line, entry, problem }) => (
            <li key={line.id} className="flex flex-col gap-2 border-b border-border pb-4 last:border-b-0">
              <div className="text-[15px] font-medium">
                {line.item} <span className="text-[13px] font-normal text-text-secondary">still due {line.remaining.toLocaleString("en-IN")} {line.unit}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-2">
                <Field label="Accepted" htmlFor={`grn-acc-${line.id}`}>
                  <Input id={`grn-acc-${line.id}`} inputMode="numeric" value={entry.accepted} onChange={(e) => patch(line.id, { accepted: e.target.value })} />
                </Field>
                <Field label="Rejected" htmlFor={`grn-rej-${line.id}`}>
                  <Input id={`grn-rej-${line.id}`} inputMode="numeric" value={entry.rejected} onChange={(e) => patch(line.id, { rejected: e.target.value })} />
                </Field>
                <Field label="Price paid (₹)" htmlFor={`grn-price-${line.id}`}>
                  <Input id={`grn-price-${line.id}`} inputMode="decimal" value={entry.price} onChange={(e) => patch(line.id, { price: e.target.value })} />
                </Field>
              </div>
              {Number(entry.rejected) > 0 && (
                <Field label="Why was it rejected?" htmlFor={`grn-why-${line.id}`} required>
                  <Input id={`grn-why-${line.id}`} value={entry.reason} onChange={(e) => patch(line.id, { reason: e.target.value })} maxLength={200} placeholder="Spoiled on arrival" />
                </Field>
              )}
              {problem && (entry.accepted.trim() !== "" || entry.rejected.trim() !== "") && (
                <p role="alert" className="m-0 text-[13px] text-danger">{problem}</p>
              )}
            </li>
          ))}
        </ul>
        <CommandFailure failure={command.failure} title="Could not record the delivery" />
      </div>
    </Modal>
  );
}
