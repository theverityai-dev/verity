"use client";

import { useState } from "react";
import { FormModal, formOptional, formText, useCommand } from "@/components/ui/CommandForm";
import { DataTable } from "@/components/ui/DataTable";
import { Button, Field, Input, Select } from "@/components/ui/primitives";

type Outlet = { id: string; name: string };
type Item = { id: string; name: string; unit: string };

export type StockRequestRow = {
  id: string;
  itemName: string;
  unit: string;
  toLocationId: string;
  toLocation: string;
  qty: number;
  reason: string | null;
  status: string;
  createdAt: string;
  decisionNote: string | null;
};

export type VarianceRowView = {
  itemId: string;
  itemName: string;
  unit: string;
  usedByRecipes: number;
  wasted: number;
  countCorrection: number;
  unexplained: string;
};

/**
 * An outlet asks for stock; someone who may move stock approves by sending it
 * from another outlet, or rejects with a reason (inventory.md transfers).
 */
export function RequestsTab({
  requests,
  items,
  outlets,
  outletId,
}: {
  requests: StockRequestRow[];
  items: Item[];
  outlets: Outlet[];
  outletId: string;
}) {
  const ask = useCommand("/inventory");
  const decide = useCommand("/inventory");
  const [asking, setAsking] = useState(false);
  const [deciding, setDeciding] = useState<{ row: StockRequestRow; approve: boolean } | null>(null);
  const open = requests.filter((r) => r.status === "Requested").length;

  return (
    <>
      <DataTable
        caption={`Stock requests · ${open} waiting`}
        emptyTitle="No stock requests"
        emptyDescription="An outlet running short can ask for stock here; another outlet sends it once approved."
        emptyAction={<Button variant="primary" onClick={() => setAsking(true)}>Request stock</Button>}
        columns={[
          { key: "itemName", header: "Item", sortable: true, subKey: "reason" },
          { key: "toLocation", header: "For outlet", sortable: true },
          { key: "quantity", header: "Quantity", numeric: true },
          { key: "status", header: "Status", sortable: true, subKey: "decisionNote" },
          { key: "createdAt", header: "Asked on" },
        ]}
        rows={requests.map((r) => ({ ...r, quantity: `${r.qty.toLocaleString("en-IN")} ${r.unit}`, reason: r.reason ?? "", decisionNote: r.decisionNote ?? "" }))}
        toolbar={<Button variant="primary" onClick={() => setAsking(true)}>Request stock</Button>}
        rowActions={(row) =>
          row.status === "Requested" ? (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setDeciding({ row: row as unknown as StockRequestRow, approve: true })}>Send</Button>
              <Button size="sm" variant="ghost" onClick={() => setDeciding({ row: row as unknown as StockRequestRow, approve: false })}>Reject</Button>
            </div>
          ) : null
        }
      />

      <FormModal
        title="Request stock"
        description="Ask for an item for this outlet. Someone who manages stock sends it from another outlet."
        open={asking}
        onClose={() => {
          setAsking(false);
          ask.clear();
        }}
        submitLabel="Send request"
        pending={ask.pending}
        failure={ask.failure}
        failureTitle="Could not send the request"
        onSubmit={(form) =>
          ask.run(
            "verity.inventory.request_stock",
            {
              itemId: formText(form, "itemId"),
              toLocationId: formText(form, "toLocationId"),
              qty: Number.parseInt(formText(form, "qty"), 10),
              reason: formOptional(form, "reason"),
            },
            () => setAsking(false),
          )
        }
      >
        <Field label="Item" htmlFor="req-item" required>
          <Select id="req-item" name="itemId" required>
            {items.map((i) => (
              <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>
            ))}
          </Select>
        </Field>
        <Field label="For outlet" htmlFor="req-to" required>
          <Select id="req-to" name="toLocationId" required defaultValue={outletId}>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Quantity" htmlFor="req-qty" required>
          <Input id="req-qty" name="qty" type="number" min={1} step={1} required />
        </Field>
        <Field label="Why" htmlFor="req-reason">
          <Input id="req-reason" name="reason" maxLength={200} placeholder="Weekend rush" />
        </Field>
      </FormModal>

      <FormModal
        title={deciding?.approve ? "Send this stock" : "Reject this request"}
        description={
          deciding
            ? `${deciding.row.qty.toLocaleString("en-IN")} ${deciding.row.unit} of ${deciding.row.itemName} for ${deciding.row.toLocation}.`
            : ""
        }
        open={deciding !== null}
        onClose={() => {
          setDeciding(null);
          decide.clear();
        }}
        submitLabel={deciding?.approve ? "Send stock" : "Reject"}
        destructive={deciding?.approve === false}
        pending={decide.pending}
        failure={decide.failure}
        failureTitle="Could not decide the request"
        onSubmit={(form) =>
          deciding &&
          decide.run(
            "verity.inventory.decide_stock_request",
            {
              requestId: deciding.row.id,
              approve: deciding.approve,
              fromLocationId: deciding.approve ? formText(form, "fromLocationId") : undefined,
              note: formOptional(form, "note"),
            },
            () => setDeciding(null),
          )
        }
      >
        {deciding?.approve && (
          <Field label="Send from" htmlFor="dec-from" required>
            <Select id="dec-from" name="fromLocationId" required>
              {outlets
                .filter((o) => o.id !== deciding.row.toLocationId)
                .map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
            </Select>
          </Field>
        )}
        <Field label={deciding?.approve ? "Note" : "Why it is rejected"} htmlFor="dec-note" required={deciding?.approve === false}>
          <Input id="dec-note" name="note" maxLength={200} required={deciding?.approve === false} />
        </Field>
      </FormModal>
    </>
  );
}

/**
 * What recipes used, what was wasted, and what counts had to correct at this
 * outlet (menu-recipes.md §16). Unexplained loss is stock that a count found
 * missing, valued at average cost.
 */
export function VarianceTab({ rows, days }: { rows: VarianceRowView[]; days: number }) {
  return (
    <DataTable
      caption={`Food-cost variance, last ${days} days`}
      emptyTitle="Nothing to compare yet"
      emptyDescription="Recipe usage, wastage and count corrections appear here once the outlet has sales and a stock count."
      columns={[
        { key: "itemName", header: "Item", sortable: true },
        { key: "used", header: "Used by recipes", numeric: true },
        { key: "wastedText", header: "Wasted", numeric: true },
        { key: "correction", header: "Count correction", numeric: true },
        { key: "unexplained", header: "Unexplained loss", numeric: true },
      ]}
      rows={rows.map((r) => ({
        ...r,
        id: r.itemId,
        used: `${r.usedByRecipes.toLocaleString("en-IN")} ${r.unit}`,
        wastedText: `${r.wasted.toLocaleString("en-IN")} ${r.unit}`,
        correction: `${r.countCorrection > 0 ? "+" : ""}${r.countCorrection.toLocaleString("en-IN")} ${r.unit}`,
      }))}
    />
  );
}
