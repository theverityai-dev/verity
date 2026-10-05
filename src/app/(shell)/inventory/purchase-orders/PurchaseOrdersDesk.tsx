"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CommandFailure, FormModal, formOptional, formText, useCommand } from "@/components/ui/CommandForm";
import { DataTable } from "@/components/ui/DataTable";
import { Modal, ModalCancel } from "@/components/ui/Modal";
import { Tabs } from "@/components/ui/Tabs";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { STATUS_CATEGORY, STATUS_LABEL, paiseToRupeesText, rupeesTextToPaise } from "./format";

export type OrderListRow = {
  id: string;
  number: string;
  status: string;
  vendor: string;
  outlet: string;
  total: string;
  progress: string;
  expected: string;
};
export type VendorRow = {
  id: string;
  name: string;
  gstin: string | null;
  phone: string | null;
  paymentTermsDays: number;
  terms: string;
  active: boolean;
  orders: number;
};
type Outlet = { id: string; name: string };
type Item = { id: string; name: string; unit: string; lastPricePaise: number | null };

const ROUTE = "/inventory/purchase-orders";

/* --------------------------------- new order -------------------------------- */

type Line = { key: number; itemId: string; qty: string; price: string };

function NewOrder({ vendors, outlets, items, onClose }: { vendors: VendorRow[]; outlets: Outlet[]; items: Item[]; onClose: () => void }) {
  const router = useRouter();
  const command = useCommand(ROUTE);
  const activeVendors = vendors.filter((v) => v.active);
  const [vendorId, setVendorId] = useState(activeVendors[0]?.id ?? "");
  const [locationId, setLocationId] = useState(outlets[0]?.id ?? "");
  const [expected, setExpected] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ key: 1, itemId: "", qty: "", price: "" }]);
  const [nextKey, setNextKey] = useState(2);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const parsed = lines.map((l) => ({
    key: l.key,
    itemId: l.itemId,
    qty: Number(l.qty),
    pricePaise: rupeesTextToPaise(l.price),
    blank: !l.itemId && l.qty.trim() === "" && l.price.trim() === "",
  }));
  const filled = parsed.filter((l) => !l.blank);
  const duplicate = new Set(filled.map((l) => l.itemId)).size !== filled.length;
  const lineProblem = filled.some((l) => !l.itemId || !Number.isInteger(l.qty) || l.qty < 1 || l.pricePaise === null);
  const total = filled.reduce((sum, l) => sum + (Number.isInteger(l.qty) && l.pricePaise !== null ? l.qty * l.pricePaise : 0), 0);
  const ready = vendorId && locationId && filled.length > 0 && !lineProblem && !duplicate;

  function setLine(key: number, patch: Partial<Line>) {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function pickItem(key: number, itemId: string) {
    const item = itemById.get(itemId);
    // Offer the last cost as a starting price; the buyer overwrites it with the quote.
    setLine(key, { itemId, price: item?.lastPricePaise != null ? String(item.lastPricePaise / 100) : "" });
  }

  function save() {
    command.run<{ id: string }>(
      "verity.inventory.create_purchase_order",
      {
        vendorId,
        locationId,
        expectedDate: expected || undefined,
        notes: notes.trim() || undefined,
        lines: filled.map((l) => ({ itemId: l.itemId, qty: l.qty, unitPricePaise: l.pricePaise })),
      },
      (data) => {
        onClose();
        router.push(`${ROUTE}/${data.id}`);
      },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      width="lg"
      title="New purchase order"
      description="Saved as a draft. Submit it from the order page when the quote is agreed."
      footer={
        <>
          <ModalCancel onClose={onClose} disabled={command.pending} />
          <Button variant="primary" onClick={save} disabled={!ready || command.pending}>
            {command.pending ? "Saving…" : `Save draft · ${paiseToRupeesText(total)}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {activeVendors.length === 0 && (
          <p role="status" className="m-0 text-[15px]">Add a vendor on the Vendors tab first.</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Vendor" htmlFor="po-vendor" required>
            <Select id="po-vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              {activeVendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Deliver to" htmlFor="po-outlet" required>
            <Select id="po-outlet" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Expected on" htmlFor="po-date">
            <Input id="po-date" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </Field>
          <Field label="Note to the vendor" htmlFor="po-notes">
            <Input id="po-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </Field>
        </div>

        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {lines.map((l, index) => {
            const item = itemById.get(l.itemId);
            return (
              <li key={l.key} className="grid grid-cols-[1fr_5.5rem_7rem_auto] items-end gap-2 max-sm:grid-cols-2">
                <Field label="Item" htmlFor={`po-item-${l.key}`}>
                  <Select id={`po-item-${l.key}`} value={l.itemId} onChange={(e) => pickItem(l.key, e.target.value)}>
                    <option value="">Choose an item</option>
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>{i.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label={item ? `Qty (${item.unit})` : "Qty"} htmlFor={`po-qty-${l.key}`}>
                  <Input id={`po-qty-${l.key}`} inputMode="numeric" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} />
                </Field>
                <Field label="Price (₹)" htmlFor={`po-price-${l.key}`}>
                  <Input id={`po-price-${l.key}`} inputMode="decimal" value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })} />
                </Field>
                <Button
                  variant="ghost"
                  aria-label={`Remove line ${index + 1}`}
                  disabled={lines.length === 1}
                  onClick={() => setLines((current) => current.filter((x) => x.key !== l.key))}
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              setLines((current) => [...current, { key: nextKey, itemId: "", qty: "", price: "" }]);
              setNextKey((k) => k + 1);
            }}
          >
            Add another item
          </Button>
        </div>
        {duplicate && <p role="alert" className="m-0 text-[13px] text-danger">An item can appear only once. Combine the quantities.</p>}
        {!duplicate && lineProblem && (
          <p role="alert" className="m-0 text-[13px] text-danger">Each line needs an item, a whole-number quantity and a price like 255 or 255.50.</p>
        )}
        <CommandFailure failure={command.failure} title="Could not save the order" />
      </div>
    </Modal>
  );
}

/* ---------------------------------- orders ---------------------------------- */

function OrdersTab({
  orders,
  vendors,
  outlets,
  items,
  canCreate,
}: {
  orders: OrderListRow[];
  vendors: VendorRow[];
  outlets: Outlet[];
  items: Item[];
  canCreate: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const rows = orders.map((o) => ({ ...o, label: STATUS_LABEL[o.status] ?? o.status, category: STATUS_CATEGORY[o.status] ?? "Draft" }));
  const newButton = canCreate ? <Button variant="primary" onClick={() => setCreating(true)}>New purchase order</Button> : null;
  return (
    <>
      <DataTable
        caption="Purchase orders, newest first"
        emptyTitle="No purchase orders yet"
        emptyDescription="Raise one when an outlet needs stock. You will approve, receive and track it from here."
        emptyAction={newButton}
        columns={[
          { key: "number", header: "Order", sortable: true, variant: "link", href: `${ROUTE}/{id}`, subKey: "vendor" },
          { key: "outlet", header: "Deliver to", sortable: true },
          { key: "label", header: "Status", variant: "state", categoryKey: "category" },
          { key: "progress", header: "Received" },
          { key: "expected", header: "Expected" },
          { key: "total", header: "Total", numeric: true },
        ]}
        rows={rows}
        toolbar={newButton}
      />
      {creating && <NewOrder vendors={vendors} outlets={outlets} items={items} onClose={() => setCreating(false)} />}
    </>
  );
}

/* ---------------------------------- vendors --------------------------------- */

function VendorsTab({ vendors, canAdd }: { vendors: VendorRow[]; canAdd: boolean }) {
  const [open, setOpen] = useState(false);
  const add = useCommand(ROUTE);
  const toggle = useCommand(ROUTE);
  const addButton = canAdd ? <Button variant="primary" onClick={() => setOpen(true)}>Add vendor</Button> : null;

  function close() {
    setOpen(false);
    add.clear();
  }

  return (
    <>
      <DataTable
        caption="Vendors"
        emptyTitle="No vendors yet"
        emptyDescription="Add the people you buy from, with their GSTIN and payment terms."
        emptyAction={addButton}
        columns={[
          { key: "name", header: "Vendor", sortable: true, subKey: "gstin" },
          { key: "phone", header: "Phone" },
          { key: "terms", header: "Pays in" },
          { key: "orders", header: "Orders", numeric: true, sortable: true },
          { key: "state", header: "Status" },
        ]}
        rows={vendors.map((v) => ({ ...v, state: v.active ? "Active" : "Inactive" }))}
        toolbar={addButton}
        rowActions={
          canAdd
            ? (row) => (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={toggle.pending}
                  onClick={() => toggle.run("verity.inventory.set_vendor_active", { vendorId: String(row.id), active: !row.active })}
                >
                  {row.active ? "Deactivate" : "Activate"}
                </Button>
              )
            : undefined
        }
      />
      <CommandFailure failure={toggle.failure} title="Could not change the vendor" />
      <FormModal
        title="Add vendor"
        description="Names are unique. GSTIN is optional but needed for input tax credit."
        open={open}
        onClose={close}
        submitLabel="Add vendor"
        pending={add.pending}
        failure={add.failure}
        failureTitle="Could not add the vendor"
        onSubmit={(form) => {
          const days = formOptional(form, "terms");
          add.run(
            "verity.inventory.create_vendor",
            {
              name: formText(form, "name"),
              gstin: formOptional(form, "gstin"),
              phone: formOptional(form, "phone"),
              paymentTermsDays: days === undefined ? undefined : Number(days),
            },
            close,
          );
        }}
      >
        <Field label="Name" htmlFor="vendor-name" required>
          <Input id="vendor-name" name="name" required maxLength={200} autoFocus placeholder="Fresh Poultry Co" />
        </Field>
        <Field label="GSTIN" htmlFor="vendor-gstin" hint="15 characters, like 07AAACD1234F1Z5">
          <Input id="vendor-gstin" name="gstin" maxLength={15} autoCapitalize="characters" />
        </Field>
        <Field label="Phone" htmlFor="vendor-phone">
          <Input id="vendor-phone" name="phone" type="tel" maxLength={20} />
        </Field>
        <Field label="Pays within (days)" htmlFor="vendor-terms" hint="0 means paid on delivery">
          <Input id="vendor-terms" name="terms" type="number" min={0} max={365} step={1} defaultValue={0} />
        </Field>
      </FormModal>
    </>
  );
}

/* ----------------------------------- desk ----------------------------------- */

export function PurchaseOrdersDesk({
  orders,
  vendors,
  outlets,
  items,
  canCreate,
  canAddVendor,
}: {
  orders: OrderListRow[];
  vendors: VendorRow[];
  outlets: Outlet[];
  items: Item[];
  canCreate: boolean;
  canAddVendor: boolean;
}) {
  const waiting = orders.filter((o) => o.status === "PendingApproval").length;
  return (
    <Tabs
      tabs={[
        {
          id: "orders",
          label: "Orders",
          count: waiting,
          content: <OrdersTab orders={orders} vendors={vendors} outlets={outlets} items={items} canCreate={canCreate} />,
        },
        { id: "vendors", label: "Vendors", count: vendors.length, content: <VendorsTab vendors={vendors} canAdd={canAddVendor} /> },
      ]}
    />
  );
}
