"use client";

import { CommandFailure, FormModal, formOptional, formText, useCommand } from "@/components/ui/CommandForm";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/ui/DataTable";
import { Tabs } from "@/components/ui/Tabs";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";

export type StockRow = {
  id: string;
  name: string;
  sku: string;
  category: string;
  onHand: string;
  onHandQty: number;
  unit: string;
  reorderLevel: string;
  value: string;
  status: "In stock" | "Low stock" | "Inactive";
  active: boolean;
};
export type WastageRow = {
  id: string;
  date: string;
  item: string;
  quantity: string;
  reason: string;
  value: string;
  recordedBy: string;
  notes: string;
};
export type CategoryRow = { id: string; name: string; items: number };
type Outlet = { id: string; name: string };
type StockAction = "receive" | "use" | "count" | "waste";

const whole = (form: FormData, name: string) => Number.parseInt(formText(form, name), 10);
/** Rupees as typed (₹220.50) to paise; blank stays unknown rather than zero. */
const paiseFrom = (form: FormData, name: string) => {
  const raw = formText(form, name);
  return raw === "" ? undefined : Math.round(Number(raw) * 100);
};

/* ----------------------------- stock actions ------------------------------ */

const ACTION_COPY: Record<StockAction, { title: string; submit: string; failure: string }> = {
  receive: { title: "Receive stock", submit: "Receive", failure: "Could not record the delivery" },
  use: { title: "Record usage", submit: "Record usage", failure: "Could not record usage" },
  count: { title: "Correct the count", submit: "Save count", failure: "Could not save the count" },
  waste: { title: "Record wastage", submit: "Record wastage", failure: "Could not record wastage" },
};

function StockActionModal({
  action,
  item,
  outletId,
  outletName,
  wastageReasons,
  onClose,
}: {
  action: StockAction | null;
  item: StockRow | null;
  outletId: string;
  outletName: string;
  wastageReasons: string[];
  onClose: () => void;
}) {
  const command = useCommand("/inventory");
  const [unchanged, setUnchanged] = useState(false);
  if (!action || !item) return null;
  const copy = ACTION_COPY[action];
  const close = () => {
    command.clear();
    setUnchanged(false);
    onClose();
  };

  function submit(form: FormData) {
    if (!item || !action) return;
    const base = { itemId: item.id, locationId: outletId };
    if (action === "receive") {
      command.run(
        "verity.inventory.record_stock_movement",
        {
          ...base,
          kind: "Receipt",
          qty: whole(form, "qty"),
          unitCostPaise: paiseFrom(form, "unitCost"),
          reference: formOptional(form, "reference"),
        },
        close,
      );
    } else if (action === "use") {
      command.run(
        "verity.inventory.record_stock_movement",
        { ...base, kind: "Issue", qty: -whole(form, "qty"), reference: formOptional(form, "reference") },
        close,
      );
    } else if (action === "count") {
      const difference = whole(form, "counted") - item.onHandQty;
      if (difference === 0) {
        setUnchanged(true);
        return;
      }
      command.run(
        "verity.inventory.record_stock_movement",
        { ...base, kind: "Adjustment", qty: difference, reference: formOptional(form, "reference") ?? "Stock count" },
        close,
      );
    } else {
      command.run(
        "verity.inventory.record_wastage",
        { ...base, qty: whole(form, "qty"), reason: formText(form, "reason"), notes: formOptional(form, "notes") },
        close,
      );
    }
  }

  return (
    <FormModal
      title={copy.title}
      description={`${item.name} at ${outletName}. On hand now: ${item.onHand}.`}
      open
      onClose={close}
      submitLabel={copy.submit}
      pending={command.pending}
      failure={command.failure}
      failureTitle={copy.failure}
      onSubmit={submit}
    >
      {action === "count" ? (
        <Field label={`Counted quantity (${item.unit})`} htmlFor="inv-counted" required>
          <Input id="inv-counted" name="counted" type="number" min={0} step={1} required autoFocus defaultValue={item.onHandQty} />
        </Field>
      ) : (
        <Field label={`Quantity (${item.unit})`} htmlFor="inv-qty" required>
          <Input id="inv-qty" name="qty" type="number" min={1} step={1} required autoFocus />
        </Field>
      )}

      {action === "receive" && (
        <Field label={`Cost per ${item.unit} (₹)`} htmlFor="inv-cost" hint="Updates the item's average cost, which recipes use.">
          <Input id="inv-cost" name="unitCost" type="number" min={0} step="0.01" inputMode="decimal" placeholder="Leave blank if not known" />
        </Field>
      )}

      {action === "waste" ? (
        <>
          <Field label="Reason" htmlFor="inv-reason" required>
            <Select id="inv-reason" name="reason" required defaultValue="">
              <option value="" disabled>Choose a reason</option>
              {wastageReasons.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </Select>
          </Field>
          <Field label="Notes" htmlFor="inv-notes">
            <Textarea id="inv-notes" name="notes" rows={2} maxLength={500} placeholder="What happened" />
          </Field>
        </>
      ) : (
        <Field
          label={action === "receive" ? "Invoice or delivery note" : action === "count" ? "Note" : "What it was used for"}
          htmlFor="inv-reference"
        >
          <Input id="inv-reference" name="reference" maxLength={200} />
        </Field>
      )}

      {unchanged && (
        <p className="m-0 text-[13px] text-text-secondary" role="status">
          The counted quantity matches what is on hand, so there is nothing to correct.
        </p>
      )}
    </FormModal>
  );
}

/* ---------------------------------- stock ---------------------------------- */

function StockTab({
  stock,
  categories,
  outlets,
  outletId,
  wastageReasons,
}: {
  stock: StockRow[];
  categories: CategoryRow[];
  outlets: Outlet[];
  outletId: string;
  wastageReasons: string[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [action, setAction] = useState<{ kind: StockAction; item: StockRow } | null>(null);
  const add = useCommand("/inventory");
  const toggle = useCommand("/inventory");
  const outletName = outlets.find((o) => o.id === outletId)?.name ?? "";

  return (
    <>
      <DataTable
        caption={`Stock at ${outletName}`}
        emptyTitle="No items yet"
        emptyDescription="Add the ingredients and supplies you stock, then receive the first delivery."
        emptyAction={<Button variant="primary" onClick={() => setAdding(true)}>Add item</Button>}
        columns={[
          { key: "name", header: "Item", sortable: true, variant: "link", href: "/inventory/{id}", subKey: "sku" },
          { key: "category", header: "Category", sortable: true },
          { key: "onHand", header: "On hand", numeric: true },
          { key: "reorderLevel", header: "Reorder at", numeric: true },
          { key: "value", header: "Value", numeric: true },
          { key: "status", header: "Status", sortable: true },
        ]}
        rows={stock}
        toolbar={
          <>
            {outlets.length > 1 && (
              <Select
                aria-label="Outlet"
                value={outletId}
                onChange={(e) => router.push(`/inventory?outlet=${e.target.value}`)}
              >
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </Select>
            )}
            <Button variant="primary" onClick={() => setAdding(true)}>Add item</Button>
          </>
        }
        rowActions={(row) => {
          const item = row as unknown as StockRow;
          if (!item.active) {
            return (
              <Button
                size="sm"
                variant="secondary"
                disabled={toggle.pending}
                onClick={() => toggle.run("verity.inventory.set_item_active", { itemId: item.id, active: true })}
              >
                Reactivate
              </Button>
            );
          }
          return (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setAction({ kind: "receive", item })}>Receive</Button>
              <Button size="sm" variant="secondary" onClick={() => setAction({ kind: "use", item })}>Use</Button>
              <Button size="sm" variant="secondary" onClick={() => setAction({ kind: "count", item })}>Count</Button>
              <Button size="sm" variant="secondary" onClick={() => setAction({ kind: "waste", item })}>Waste</Button>
            </div>
          );
        }}
      />
      <CommandFailure failure={toggle.failure} title="Could not reactivate the item" />

      <StockActionModal
        action={action?.kind ?? null}
        item={action?.item ?? null}
        outletId={outletId}
        outletName={outletName}
        wastageReasons={wastageReasons}
        onClose={() => setAction(null)}
      />

      <FormModal
        title="Add item"
        description="Items are shared by every outlet; each outlet keeps its own quantity."
        open={adding}
        onClose={() => {
          setAdding(false);
          add.clear();
        }}
        submitLabel="Add item"
        pending={add.pending}
        failure={add.failure}
        failureTitle="Could not add the item"
        onSubmit={(form) => {
          const reorder = formText(form, "reorderLevel");
          add.run(
            "verity.inventory.create_item",
            {
              name: formText(form, "name"),
              sku: formText(form, "sku"),
              itemGroupId: formOptional(form, "itemGroupId"),
              unitLabel: formOptional(form, "unitLabel"),
              reorderLevel: reorder === "" ? undefined : Number.parseInt(reorder, 10),
            },
            () => setAdding(false),
          );
        }}
      >
        <Field label="Name" htmlFor="inv-item-name" required>
          <Input id="inv-item-name" name="name" required maxLength={200} autoFocus placeholder="Chicken breast" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Code" htmlFor="inv-item-sku" required hint="Unique, for example CHK-BR.">
            <Input id="inv-item-sku" name="sku" required maxLength={60} />
          </Field>
          <Field label="Unit" htmlFor="inv-item-unit" hint="Quantities are whole numbers: use g or ml for weighed items.">
            <Input id="inv-item-unit" name="unitLabel" maxLength={30} placeholder="g" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Category" htmlFor="inv-item-group">
            <Select id="inv-item-group" name="itemGroupId" defaultValue="">
              <option value="">Uncategorized</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Reorder level" htmlFor="inv-item-reorder">
            <Input id="inv-item-reorder" name="reorderLevel" type="number" min={0} step={1} />
          </Field>
        </div>
      </FormModal>
    </>
  );
}

/* --------------------------------- wastage --------------------------------- */

function WastageTab({ wastage }: { wastage: WastageRow[] }) {
  return (
    <DataTable
      caption="Wastage, last 30 days"
      emptyTitle="No wastage recorded"
      emptyDescription="Use Waste on an item to record spoilage, burnt food or damage with a reason."
      columns={[
        { key: "date", header: "Date", sortable: true },
        { key: "item", header: "Item", sortable: true, subKey: "notes" },
        { key: "quantity", header: "Quantity", numeric: true },
        { key: "reason", header: "Reason", sortable: true },
        { key: "value", header: "Value", numeric: true },
        { key: "recordedBy", header: "Recorded by", sortable: true },
      ]}
      rows={wastage}
    />
  );
}

/* -------------------------------- categories ------------------------------- */

function CategoriesTab({ categories }: { categories: CategoryRow[] }) {
  const [open, setOpen] = useState(false);
  const add = useCommand("/inventory");

  return (
    <>
      <DataTable
        caption="Categories"
        emptyTitle="No categories yet"
        emptyDescription="Group items as Poultry, Vegetables, Dairy, Packaging and so on."
        emptyAction={<Button variant="primary" onClick={() => setOpen(true)}>Add category</Button>}
        columns={[
          { key: "name", header: "Category", sortable: true },
          { key: "items", header: "Items", numeric: true, sortable: true },
        ]}
        rows={categories}
        toolbar={<Button variant="primary" onClick={() => setOpen(true)}>Add category</Button>}
      />
      <FormModal
        title="Add category"
        description="Names are unique within your organization."
        open={open}
        onClose={() => {
          setOpen(false);
          add.clear();
        }}
        submitLabel="Add category"
        pending={add.pending}
        failure={add.failure}
        failureTitle="Could not add the category"
        onSubmit={(form) => add.run("verity.inventory.create_item_group", { name: formText(form, "name") }, () => setOpen(false))}
      >
        <Field label="Name" htmlFor="inv-cat-name" required>
          <Input id="inv-cat-name" name="name" required maxLength={120} autoFocus placeholder="Poultry" />
        </Field>
      </FormModal>
    </>
  );
}

/* ----------------------------------- desk ---------------------------------- */

export function InventoryDesk({
  outlets,
  outletId,
  stock,
  wastage,
  categories,
  wastageReasons,
}: {
  outlets: Outlet[];
  outletId: string;
  stock: StockRow[];
  wastage: WastageRow[];
  categories: CategoryRow[];
  wastageReasons: string[];
}) {
  // The badge marks what needs attention, so Stock counts low items only.
  const low = stock.filter((s) => s.status === "Low stock").length;
  return (
    <Tabs
      tabs={[
        {
          id: "stock",
          label: "Stock",
          count: low,
          content: <StockTab stock={stock} categories={categories} outlets={outlets} outletId={outletId} wastageReasons={wastageReasons} />,
        },
        { id: "wastage", label: "Wastage", count: wastage.length, content: <WastageTab wastage={wastage} /> },
        { id: "categories", label: "Categories", count: categories.length, content: <CategoriesTab categories={categories} /> },
      ]}
    />
  );
}
