import Link from "next/link";
import { notFound } from "next/navigation";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import {
  ENTITY_INVENTORY_PURCHASE_ORDER,
  ENTITY_INVENTORY_STOCK,
  INVENTORY_CAPABILITY,
  type PurchaseOrderDetail,
} from "@/server/capabilities/inventory";
import { requireActor } from "@/server/platform/auth";
import { hasPermission } from "@/server/platform/authorization";
import { withTenant } from "@/server/platform/tenancy";
import { runQuery } from "@/server/actions/platform";
import { DataTable } from "@/components/ui/DataTable";
import { ErrorState, PageHeader, Stat, StatRow } from "@/components/ui/primitives";
import { day } from "@/components/ui/business/format";
import { STATUS_LABEL, paiseToRupeesText } from "../format";
import { OrderActions } from "./OrderActions";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

async function PurchaseOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const actor = await requireActor();
  const { orderId } = await params;
  if (!UUID.test(orderId)) notFound();

  const result = await runQuery<PurchaseOrderDetail | null>("verity.inventory.get_purchase_order", { orderId });
  if (!result.ok) {
    return <ErrorState title="Could not load the order" message={result.message} issues={result.issues} retryable={result.retryable} />;
  }
  const order = result.data;
  if (!order) notFound();

  const [canEdit, canApprove, canReceive] = await Promise.all([
    withTenant(actor.tenantId, (tx) => hasPermission(tx, actor.roleId, "Edit", ENTITY_INVENTORY_PURCHASE_ORDER)),
    withTenant(actor.tenantId, (tx) => hasPermission(tx, actor.roleId, "ActionExecute", ENTITY_INVENTORY_PURCHASE_ORDER)),
    withTenant(actor.tenantId, (tx) => hasPermission(tx, actor.roleId, "Create", ENTITY_INVENTORY_STOCK)),
  ]);

  const nothingReceivedYet = order.lines.every((l) => l.receivedQty === 0 && l.rejectedQty === 0);
  const lineRows = order.lines.map((l) => ({
    id: l.id,
    item: l.itemName,
    ordered: `${l.qty.toLocaleString("en-IN")} ${l.unit}`,
    received: `${l.receivedQty.toLocaleString("en-IN")} ${l.unit}`,
    rejected: l.rejectedQty > 0 ? `${l.rejectedQty.toLocaleString("en-IN")} ${l.unit}` : "",
    price: paiseToRupeesText(l.unitPricePaise),
    amount: paiseToRupeesText(l.qty * l.unitPricePaise),
  }));
  const receiptRows = order.receipts.flatMap((r) =>
    r.lines.map((l, index) => ({
      id: `${r.id}-${index}`,
      date: day(r.receivedAt),
      item: l.itemName,
      accepted: l.acceptedQty.toLocaleString("en-IN"),
      rejected: l.rejectedQty > 0 ? `${l.rejectedQty.toLocaleString("en-IN")} · ${l.rejectReason ?? ""}` : "",
      price: paiseToRupeesText(l.unitPricePaise),
      invoice: r.invoiceRef ?? "",
    })),
  );

  return (
    <>
      <PageHeader
        title={order.number}
        description={`${order.vendorName} · deliver to ${order.locationName}${order.expectedDate ? ` · expected ${day(order.expectedDate)}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/inventory/purchase-orders" className="text-[13px] text-text-secondary underline-offset-4 hover:underline">
              Back to purchase orders
            </Link>
            <OrderActions
              orderId={order.id}
              status={order.status}
              canEdit={canEdit}
              canApprove={canApprove}
              canReceive={canReceive}
              nothingReceivedYet={nothingReceivedYet}
              lines={order.lines.map((l) => ({
                id: l.id,
                item: l.itemName,
                unit: l.unit,
                remaining: l.qty - l.receivedQty,
                unitPricePaise: l.unitPricePaise,
              }))}
            />
          </div>
        }
      />
      <StatRow cols={3} className="mb-6">
        <Stat label="Status" value={STATUS_LABEL[order.status] ?? order.status} />
        <Stat label="Order total" value={paiseToRupeesText(order.totalPaise)} />
        <Stat label="Received" value={`${order.receivedQty.toLocaleString("en-IN")} of ${order.orderedQty.toLocaleString("en-IN")}`} />
      </StatRow>
      {order.cancelReason && <p className="mb-4 text-[15px]">Cancelled: {order.cancelReason}</p>}
      {order.notes && <p className="mb-4 text-[15px] text-text-secondary">Note: {order.notes}</p>}
      <DataTable
        caption="Items on this order"
        filterable={false}
        emptyTitle="No items"
        columns={[
          { key: "item", header: "Item" },
          { key: "ordered", header: "Ordered", numeric: true },
          { key: "received", header: "Received", numeric: true },
          { key: "rejected", header: "Rejected", numeric: true },
          { key: "price", header: "Price", numeric: true },
          { key: "amount", header: "Amount", numeric: true },
        ]}
        rows={lineRows}
      />
      <div className="mt-8" />
      <DataTable
        caption="Deliveries received"
        filterable={false}
        emptyTitle="Nothing received yet"
        emptyDescription="Record a delivery when the goods arrive. Accepted quantities go into stock."
        columns={[
          { key: "date", header: "Date" },
          { key: "item", header: "Item" },
          { key: "accepted", header: "Accepted", numeric: true },
          { key: "rejected", header: "Rejected, and why" },
          { key: "price", header: "Price paid", numeric: true },
          { key: "invoice", header: "Invoice" },
        ]}
        rows={receiptRows}
      />
    </>
  );
}

export default withCapabilityPageAccess(INVENTORY_CAPABILITY, PurchaseOrderPage);
