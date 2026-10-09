"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormModal, formText, useCommand } from "@/components/ui/CommandForm";
import { Button, Field, Input, Select } from "@/components/ui/primitives";

type Target = { id: string; label: string };

/**
 * Move this order to a free table, or join it into another open order at the
 * same outlet (pos-restaurant.md §6). Both are refused by the server once a bill
 * exists; the buttons only appear while the order is still open.
 */
export function TableActions({
  orderId,
  freeTables,
  openOrders,
  takers,
}: {
  orderId: string;
  freeTables: Target[];
  openOrders: Target[];
  /** Staff who could take this order over (Task 126 item 1.4). */
  takers: Array<{ userId: string; name: string }>;
}) {
  const router = useRouter();
  const move = useCommand(`/floor/${orderId}`);
  const merge = useCommand("/floor");
  const handOver = useCommand(`/floor/${orderId}`);
  const [moving, setMoving] = useState(false);
  const [merging, setMerging] = useState(false);
  const [handing, setHanding] = useState(false);

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={freeTables.length === 0} onClick={() => setMoving(true)}>
        Move table
      </Button>
      <Button size="sm" disabled={openOrders.length === 0} onClick={() => setMerging(true)}>
        Merge into another order
      </Button>
      <Button size="sm" disabled={takers.length === 0} onClick={() => setHanding(true)}>
        Hand over
      </Button>

      <FormModal
        title="Hand this order to someone else"
        description="The table, the dishes and the bill stay as they are. Only the person looking after the order changes, and the change is recorded."
        open={handing}
        onClose={() => {
          setHanding(false);
          handOver.clear();
        }}
        submitLabel="Hand over"
        pending={handOver.pending}
        failure={handOver.failure}
        failureTitle="Could not hand the order over"
        onSubmit={(form) =>
          handOver.run(
            "verity.dinein.hand_over_order",
            { orderId, toUserId: formText(form, "toUserId"), reason: formText(form, "reason") || undefined },
            () => setHanding(false),
          )
        }
      >
        <Field label="Hand over to" htmlFor="handover-to" required>
          <Select id="handover-to" name="toUserId" required>
            {takers.map((t) => (
              <option key={t.userId} value={t.userId}>{t.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Reason (optional)" htmlFor="handover-reason">
          <Input id="handover-reason" name="reason" placeholder="For example: end of shift" maxLength={200} />
        </Field>
      </FormModal>

      <FormModal
        title="Move to another table"
        description="The new table is marked occupied and this one goes for cleaning."
        open={moving}
        onClose={() => {
          setMoving(false);
          move.clear();
        }}
        submitLabel="Move order"
        pending={move.pending}
        failure={move.failure}
        failureTitle="Could not move the order"
        onSubmit={(form) =>
          move.run("verity.dinein.move_order_to_table", { orderId, toTableId: formText(form, "toTableId") }, () => setMoving(false))
        }
      >
        <Field label="Free table" htmlFor="move-table" required>
          <Select id="move-table" name="toTableId" required>
            {freeTables.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </Select>
        </Field>
      </FormModal>

      <FormModal
        title="Merge into another order"
        description="Every dish on this order moves across with its kitchen status. This order closes and its table goes for cleaning."
        open={merging}
        onClose={() => {
          setMerging(false);
          merge.clear();
        }}
        submitLabel="Merge orders"
        pending={merge.pending}
        failure={merge.failure}
        failureTitle="Could not merge the orders"
        onSubmit={(form) => {
          const intoOrderId = formText(form, "intoOrderId");
          merge.run("verity.dinein.merge_orders", { fromOrderId: orderId, intoOrderId }, () => {
            setMerging(false);
            router.push(`/floor/${intoOrderId}`);
          });
        }}
      >
        <Field label="Merge into" htmlFor="merge-into" required>
          <Select id="merge-into" name="intoOrderId" required>
            {openOrders.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </Select>
        </Field>
      </FormModal>
    </div>
  );
}
