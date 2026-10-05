"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Modal, ModalCancel } from "@/components/ui/Modal";
import { Button, ErrorState, Field, Input, Select } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

type Option = { value: string; label: string };

/**
 * Starts an order that has no table: takeaway, phone, delivery, a Zomato or
 * Swiggy order, and so on (PRD §9). After creating it the cashier lands on the
 * same order pad a waiter uses, so adding items, notes and sending to the
 * kitchen work exactly as for a table.
 */
export function NewChannelOrder({ outlets, channels }: { outlets: Option[]; channels: Option[] }) {
  const router = useRouter();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState(channels[0]?.value ?? "takeaway");
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const isPlatform = channel === "delivery_platform";

  const close = () => {
    setOpen(false);
    setFailure(null);
  };

  function submit(form: FormData) {
    const value = (name: string) => String(form.get(name) ?? "").trim() || undefined;
    setFailure(null);
    startTransition(async () => {
      const result = await runCommand<{ id: string }>(
        "verity.dinein.create_order",
        {
          channel,
          locationId: value("locationId"),
          customerName: value("customerName"),
          customerPhone: value("customerPhone"),
          platform: isPlatform ? value("platform") : undefined,
          platformOrderRef: isPlatform ? value("platformOrderRef") : undefined,
        },
        "/counter",
      );
      if (result.ok) router.push(`/floor/${result.data.id}`);
      else setFailure(result);
    });
  }

  return (
    <>
      <CommandButton commands="verity.dinein.create_order" variant="primary" onClick={() => setOpen(true)} disabled={outlets.length === 0}>
        New order
      </CommandButton>
      <Modal
        open={open}
        onClose={close}
        title="New order without a table"
        description="Takeaway, phone, delivery and platform orders. For guests at a table, seat them on the floor plan."
        footer={
          <>
            <ModalCancel onClose={close} disabled={pending} />
            <Button type="submit" form={formId} variant="primary" disabled={pending}>
              {pending ? "Starting…" : "Start order"}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit(new FormData(event.currentTarget));
          }}
        >
          <div className="grid grid-cols-2 gap-4">
            <Field label="Order type" htmlFor="co-channel" required>
              <Select id="co-channel" value={channel} onChange={(event) => setChannel(event.target.value)}>
                {channels.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Outlet" htmlFor="co-outlet" required>
              <Select id="co-outlet" name="locationId" required defaultValue={outlets[0]?.value}>
                {outlets.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </Field>
          </div>
          {isPlatform && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Platform" htmlFor="co-platform" required>
                <Input id="co-platform" name="platform" required maxLength={60} list="co-platforms" placeholder="Zomato" />
                <datalist id="co-platforms">
                  <option value="Zomato" />
                  <option value="Swiggy" />
                </datalist>
              </Field>
              <Field label="Platform order number" htmlFor="co-ref">
                <Input id="co-ref" name="platformOrderRef" maxLength={60} placeholder="4821" />
              </Field>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Guest name" htmlFor="co-name">
              <Input id="co-name" name="customerName" maxLength={120} />
            </Field>
            <Field label="Phone" htmlFor="co-phone" hint="Links the order to the guest's history.">
              <Input id="co-phone" name="customerPhone" type="tel" maxLength={20} />
            </Field>
          </div>
          {failure && <ErrorState title="Could not start the order" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
        </form>
      </Modal>
    </>
  );
}
