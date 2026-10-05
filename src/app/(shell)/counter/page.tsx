import { withPageAccess } from "@/components/ui/PageAccess";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import { ForbiddenError } from "@/server/platform/authorization";
import { listOpenBills, ORDER_CHANNELS, ORDER_CHANNEL_LABEL, orderLabel } from "@/server/capabilities/dinein";
import {
  EmptyState,
  PageHeader,
  Panel,
  PermissionDenied,
  Stat,
  StatRow,
} from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { BillableOrders } from "./BillableOrders";
import { NewChannelOrder } from "./NewChannelOrder";

export const dynamic = "force-dynamic";

function rupees(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const openBillColumns: Column[] = [
  { key: "label", header: "Order", sortable: true },
  { key: "total", header: "Total", sortable: true },
  { key: "paid", header: "Paid", sortable: true },
  { key: "outstanding", header: "Outstanding", sortable: true },
  { key: "action", header: "", variant: "link", href: "/counter/{id}" },
];

const channelOrderColumns: Column[] = [
  { key: "label", header: "Order", sortable: true },
  { key: "outlet", header: "Outlet", sortable: true },
  { key: "status", header: "Status", sortable: true },
  { key: "action", header: "", variant: "link", href: "/floor/{id}" },
];

const ORDER_STATE_LABEL: Record<string, string> = {
  draft: "Taking the order",
  placed: "With the kitchen",
  partially_served: "Partly ready",
};

/**
 * The counter.
 *
 * Two lists, because a cashier has two jobs: tables that have finished eating
 * and need a bill, and bills waiting to be paid. Merging them into one queue
 * would hide which of the two a row actually needs.
 */
async function CounterPage() {
  installCapabilities();
  const actor = await requireActor();

  let openBills: Awaited<ReturnType<typeof listOpenBills.handler>>;
  let awaitingBill: Array<{
    id: string;
    covers: number;
    channel: string;
    platform: string | null;
    platformOrderRef: string | null;
    customerName: string | null;
    table: { label: string } | null;
    lines: Array<{ unitPriceMinor: number; qty: number }>;
  }>;
  let openChannelOrders: Array<{
    id: string;
    state: string;
    channel: string;
    platform: string | null;
    platformOrderRef: string | null;
    customerName: string | null;
    table: { label: string } | null;
    location: { name: string };
  }>;
  let outlets: Array<{ id: string; name: string }>;

  try {
    openBills = await executeQuery(actor, listOpenBills, {});

    // Served orders with no bill yet. Read directly rather than through a query
    // definition because it is one join used on one page, and a registered
    // query exists to be reused — inventing one for a single caller is the
    // ceremony this codebase avoids elsewhere.
    awaitingBill = await withTenant(actor.tenantId, (tx) =>
      tx.diningOrder.findMany({
        where: { state: "served", bill: null },
        include: {
          table: { select: { label: true } },
          lines: { where: { state: { not: "voided" } } },
        },
        orderBy: { servedAt: "asc" },
      }),
    );

    // Orders with no table never appear on the floor plan, so the counter is
    // where they are found again until they are billed.
    openChannelOrders = await withTenant(actor.tenantId, (tx) =>
      tx.diningOrder.findMany({
        where: { tableId: null, state: { in: ["draft", "placed", "partially_served"] } },
        include: { table: { select: { label: true } }, location: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      }),
    );
    outlets = await withTenant(actor.tenantId, (tx) =>
      tx.location.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    );
  } catch (error) {
    if (error instanceof ForbiddenError)
      return <PermissionDenied what="the counter" />;
    throw error;
  }

  const outstanding = openBills.reduce(
    (sum, bill) => sum + (bill.totalMinor - bill.paidMinor),
    0,
  );

  return (
    <>
      <PageHeader
        title="Counter"
        description="Takeaway and delivery orders, bills to raise, and money to take."
        actions={
          <NewChannelOrder
            outlets={outlets.map((o) => ({ value: o.id, label: o.name }))}
            channels={ORDER_CHANNELS.filter((c) => c !== "dine_in").map((c) => ({ value: c, label: ORDER_CHANNEL_LABEL[c] }))}
          />
        }
      />

      <StatRow className="mb-6" cols={3}>
        <Stat label="Orders awaiting a bill" value={awaitingBill.length} />
        <Stat label="Bills open" value={openBills.length} />
        <Stat label="Outstanding" value={rupees(outstanding)} />
      </StatRow>

      <div className="mb-6">
        <Panel title="Open takeaway and delivery orders" flush>
          <DataTable
            columns={channelOrderColumns}
            rows={openChannelOrders.map((order) => ({
              id: order.id,
              label: orderLabel(order),
              outlet: order.location.name,
              status: ORDER_STATE_LABEL[order.state] ?? order.state,
              action: "Open order",
            }))}
            caption="Orders without a table"
            emptyTitle="No open takeaway or delivery orders"
            emptyDescription="Start one with New order."
          />
        </Panel>
      </div>

      <div className="mb-6">
        <Panel title="Ready to bill" flush>
          {awaitingBill.length === 0 ? (
            <EmptyState compact title="Nothing waiting" />
          ) : (
            <BillableOrders
              orders={awaitingBill.map((order) => ({
                id: order.id,
                label: orderLabel(order),
                covers: order.covers,
                subtotalMinor: order.lines.reduce(
                  (sum, line) => sum + line.unitPriceMinor * line.qty,
                  0,
                ),
              }))}
            />
          )}
        </Panel>
      </div>

      <Panel title="Open bills" flush>
        <DataTable
          columns={openBillColumns}
          rows={openBills.map((bill) => ({
            id: bill.id,
            label: bill.label,
            total: rupees(bill.totalMinor),
            paid: rupees(bill.paidMinor),
            outstanding: rupees(bill.totalMinor - bill.paidMinor),
            action: "Take payment",
          }))}
          caption="Bills awaiting payment"
          emptyTitle="No bills open"
        />
      </Panel>
    </>
  );
}

export default withPageAccess(CounterPage);
