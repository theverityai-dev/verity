import { withPageAccess } from "@/components/ui/PageAccess";
import { requireActor } from "@/server/platform/auth";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import { ForbiddenError } from "@/server/platform/authorization";
import { listOrderHistory } from "@/server/capabilities/dinein";
import { DataTable } from "@/components/ui/DataTable";
import { ButtonLink, FilterChipRow, PageHeader, PermissionDenied, StatTile, StatTileRow } from "@/components/ui/primitives";
import { Sparkline } from "@/components/ui/viz";
import { channelKindFor } from "@/components/ui/business/domains";
import { day } from "@/components/ui/business/format";
import { isoDay, trailingDaysRange } from "@/lib/date-range";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The most the query returns. Totals over a window that hits it are partial, and the page says so. */
const ROW_CAP = 300;

function rupees(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const RANGES = [
  { label: "Today", days: 0 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
] as const;

/**
 * Closed orders: what was settled, cancelled or refunded, newest first (pos-restaurant.md, order
 * history). Defaults to the last 7 days (Task 127 §4.2, P-LIST).
 *
 * The daily line groups settled sales by the calendar day the filter itself uses, so it always agrees
 * with the table beneath it. It is drawn only when the window spans three days or more.
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
  const cancelled = rows.length - settled.length;
  const sales = settled.reduce((sum, r) => sum + r.totalMinor, 0);
  const refunded = rows.reduce((sum, r) => sum + r.refundedMinor, 0);
  const avgBill = settled.length ? Math.round(sales / settled.length) : 0;

  // One value per calendar day in the window, oldest first, zero where nothing settled.
  const perDay = new Map<string, number>();
  const last = new Date(`${to}T00:00:00.000Z`).getTime();
  for (let t = new Date(`${from}T00:00:00.000Z`).getTime(); t <= last; t += 86_400_000) {
    perDay.set(isoDay(new Date(t)), 0);
  }
  for (const r of settled) {
    const key = isoDay(r.closedAt);
    if (perDay.has(key)) perDay.set(key, (perDay.get(key) ?? 0) + r.totalMinor);
  }
  const series = [...perDay.values()];

  const clipped = rows.length >= ROW_CAP;

  return (
    <>
      <PageHeader
        title="Order history"
        description={`Closed orders from ${day(from)} to ${day(to)}. Open a bill to reprint it or refund it.`}
        actions={<ButtonLink href="/counter">Back to counter</ButtonLink>}
      />

      <FilterChipRow
        className="mb-3"
        chips={RANGES.map((range) => {
          const r = trailingDaysRange(range.days);
          return { label: range.label, active: from === r.fromDate && to === r.toDate, href: `/counter/history?from=${r.fromDate}&to=${r.toDate}` };
        })}
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
        <button
          type="submit"
          className="min-h-11 cursor-pointer rounded-[10px] border-0 bg-control px-4 text-[15px] font-semibold text-accent-ink hover:bg-control-strong focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-accent-line)]"
        >
          Show
        </button>
      </form>

      <StatTileRow className="mb-3">
        <StatTile
          kind="money"
          label="Sales"
          value={rupees(sales)}
          hint={`${settled.length} settled order${settled.length === 1 ? "" : "s"}`}
          viz={series.length >= 3 ? <Sparkline values={series} label="Settled sales per day" hue="cyan" /> : undefined}
        />
        <StatTile kind="bill" label="Average bill" value={settled.length ? rupees(avgBill) : "—"} hint={settled.length ? "Settled orders only" : "Nothing settled yet"} />
        <StatTile
          icon="rework"
          state={refunded > 0 ? "pending" : "completed"}
          label="Refunded"
          value={rupees(refunded)}
          hint={refunded > 0 ? "Credit notes on settled bills" : "No refunds"}
        />
        <StatTile icon="lost" state={cancelled > 0 ? "cancelled" : "completed"} label="Cancelled" value={cancelled} hint="Orders closed without a bill" />
      </StatTileRow>

      {clipped && (
        <p className="mb-3 mt-0 text-[13px] text-text-secondary">
          Showing the latest {ROW_CAP} closed orders in these dates. Narrow the dates for totals that cover everything.
        </p>
      )}

      <DataTable
        caption="Closed orders, newest first"
        emptyTitle="No closed orders in these dates"
        emptyDescription="Settled and cancelled orders appear here."
        columns={[
          { key: "label", header: "Order", sortable: true, variant: "link", href: "/counter/{billId}", subKey: "when", kindKey: "kind" },
          { key: "status", header: "Status", sortable: true, variant: "state", categoryKey: "category" },
          { key: "items", header: "Items", numeric: true },
          { key: "total", header: "Total", numeric: true },
          { key: "refunded", header: "Refunded", numeric: true },
        ]}
        rows={rows.map((r) => ({
          id: r.orderId,
          billId: r.billId ?? "",
          label: r.label,
          kind: channelKindFor(r.channel),
          when: day(r.closedAt),
          status: r.state === "settled" ? (r.refundedMinor > 0 ? "Part refunded" : "Settled") : "Cancelled",
          category: r.state === "settled" ? "Completed" : "Cancelled",
          items: r.lines,
          total: r.billId ? rupees(r.totalMinor) : "",
          refunded: r.refundedMinor > 0 ? rupees(r.refundedMinor) : "",
        }))}
      />
    </>
  );
}

export default withPageAccess(OrderHistoryPage);
