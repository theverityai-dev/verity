"use client";

import { CommandButton } from "@/components/ui/CommandAccess";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

const columns: Column[] = [
  { key: "label", header: "Order", sortable: true },
  { key: "covers", header: "Covers", numeric: true, sortable: true },
  { key: "subtotal", header: "Subtotal", numeric: true, sortable: true },
];

function rupees(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Orders that are served (or collected) and need a bill.
 *
 * The amount shown is the pre-tax subtotal, labelled as such. Showing a total
 * here would mean computing tax on the client, and the two figures would
 * disagree with the printed bill the moment a rate changed.
 */
export function BillableOrders({
  orders,
}: {
  orders: Array<{ id: string; label: string; covers: number; subtotalMinor: number }>;
}) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  function generate(orderId: string) {
    setFailure(null);
    startTransition(async () => {
      const result = await runCommand<{ id: string }>(
        "verity.dinein.generate_bill",
        { orderId },
        "/counter",
      );
      if (result.ok) router.push(`/counter/${result.data.id}`);
      else setFailure(result);
    });
  }

  return (
    <>
      {failure && (
        <div className="px-4 pt-4">
          <ErrorState
            title="The bill was not raised"
            message={failure.message}
            issues={failure.issues}
            retryable={failure.retryable}
          />
        </div>
      )}

      <DataTable
        columns={columns}
        rows={orders.map((order) => ({
          id: order.id,
          label: order.label,
          covers: order.covers,
          subtotal: rupees(order.subtotalMinor),
        }))}
        caption="Served orders with no bill yet"
        rowActions={(row) => (
          <CommandButton
            commands={"verity.dinein.generate_bill"}
            size="sm"
            variant="primary"
            disabled={pending}
            onClick={() => generate(String(row.id))}
          >
            Raise bill
          </CommandButton>
        )}
      />
    </>
  );
}
