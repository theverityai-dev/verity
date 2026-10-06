import Link from "next/link";
import { withPageAccess } from "@/components/ui/PageAccess";
import { requireActor } from "@/server/platform/auth";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import { ForbiddenError } from "@/server/platform/authorization";
import { listOrderHistory } from "@/server/capabilities/dinein";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader, PermissionDenied, Stat, StatRow } from "@/components/ui/primitives";
import { day } from "@/components/ui/business/format";
import { trailingDaysRange } from "@/lib/date-range";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function rupees(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Closed orders: what was settled, cancelled or refunded, newest first
 * (pos-restaurant.md, order history). Defaults to the last 7 days.
 */
async function OrderHistoryPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  installCapabilities();
  const actor = await requireActor();
  const params = await searchParams;
  const fallback = trailingDaysRange(7);
  const from = params.from && DATE.test(params.from) ? params.from : fallback.fromDate;
  const to = params.to && DATE.test(params.to) ? params.to : fallback.toDate;

  let rows: Awaited<ReturnType<typeof listOrderHistory.handler>>;
  try {
    rows = await executeQuery(actor, listOrderHistory, { from, to });
  } catch (error) {
    if (error instanceof ForbiddenError) return <PermissionDenied what="order history" />;
    throw error;
  }

  const settled = rows.filter((r) => r.state === "settled");
  const sales = settled.reduce((sum, r) => sum + r.totalMinor, 0);
  const refunded = rows.reduce((sum, r) => sum + r.refundedMinor, 0);

  return (
    <>
      <PageHeader
        title="Order history"
        description={`Closed orders from ${day(from)} to ${day(to)}. Open a bill to reprint it or refund it.`}
        actions={
          <Link href="/counter" className="text-[13px] text-text-secondary underline-offset-4 hover:underline">
            Back to counter
          </Link>
        }
      />
      <form className="mb-6 flex flex-wrap items-end gap-3" method="get">
        <label className="flex flex-col gap-1 text-[13px] text-text-secondary">
          From
          <input type="date" name="from" defaultValue={from} className="min-h-11 rounded-[10px] bg-control px-3 text-[15px] text-text" />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-text-secondary">
          To
          <input type="date" name="to" defaultValue={to} className="min-h-11 rounded-[10px] bg-control px-3 text-[15px] text-text" />
        </label>
        <button type="submit" className="min-h-11 cursor-pointer rounded-[10px] border-0 bg-control px-4 text-[15px] font-semibold text-accent-ink hover:bg-control-strong">
          Show
        </button>
      </form>
      <StatRow cols={3} className="mb-6">
        <Stat label="Settled orders" value={settled.length} />
        <Stat label="Sales" value={rupees(sales)} />
        <Stat label="Refunded" value={rupees(refunded)} />
      </StatRow>
      <DataTable
        caption="Closed orders, newest first"
        emptyTitle="No closed orders in these dates"
        emptyDescription="Settled and cancelled orders appear here."
        columns={[
          { key: "label", header: "Order", sortable: true, variant: "link", href: "/counter/{billId}", subKey: "when" },
          { key: "status", header: "Status", sortable: true },
          { key: "items", header: "Items", numeric: true },
          { key: "total", header: "Total", numeric: true },
          { key: "refunded", header: "Refunded", numeric: true },
        ]}
        rows={rows.map((r) => ({
          id: r.orderId,
          billId: r.billId ?? "",
          label: r.label,
          when: day(r.closedAt),
          status: r.state === "settled" ? "Settled" : "Cancelled",
          items: r.lines,
          total: r.billId ? rupees(r.totalMinor) : "",
          refunded: r.refundedMinor > 0 ? rupees(r.refundedMinor) : "",
        }))}
      />
    </>
  );
}

export default withPageAccess(OrderHistoryPage);
