import Link from "next/link";
import { withPageAccess } from "@/components/ui/PageAccess";
import { requireActor } from "@/server/platform/auth";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import { ForbiddenError } from "@/server/platform/authorization";
import { ValidationError } from "@/server/platform/command";
import { exceptionsReport, salesReport } from "@/server/capabilities/dinein";
import { DataTable } from "@/components/ui/DataTable";
import { ErrorState, PageHeader, PermissionDenied, Stat, StatRow } from "@/components/ui/primitives";
import { day } from "@/components/ui/business/format";
import type { SALES_VIEWS } from "@/lib/sales-report";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const VIEWS = [
  { key: "day", label: "By day", first: "Day" },
  { key: "month", label: "By month", first: "Month" },
  { key: "hour", label: "By hour", first: "Hour" },
  { key: "item", label: "By item", first: "Item" },
  { key: "channel", label: "By order type", first: "Order type" },
  { key: "staff", label: "By staff", first: "Taken by" },
  { key: "exceptions", label: "Cancelled and refunded", first: "" },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];

function rupees(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const chip = (active: boolean) =>
  "inline-flex min-h-11 items-center rounded-full px-4 text-[14px] font-medium no-underline transition-colors " +
  (active ? "bg-accent text-accent-on" : "bg-[var(--color-control)] text-text hover:bg-[var(--color-control-strong)]");

const KIND_LABEL = { cancelled_order: "Cancelled order", voided_line: "Voided dish", refund: "Refund" } as const;

type Loaded =
  | { kind: "exceptions"; report: Awaited<ReturnType<typeof exceptionsReport.handler>> }
  | { kind: "sales"; report: Awaited<ReturnType<typeof salesReport.handler>> }
  | { kind: "problem"; message: string };

/**
 * Restaurant sales reports (Task 126 item 1.1). One page, one tab per question an
 * owner asks of the till: which days and hours earn, what sells, through which
 * channel, taken by whom, and what was cancelled or given back. Every figure is a
 * settled bill; the page says so, and says how a refund is shown.
 */
async function SalesReportsPage({ searchParams }: { searchParams: Promise<{ view?: string; from?: string; to?: string }> }) {
  installCapabilities();
  const actor = await requireActor();
  const params = await searchParams;
  const view: ViewKey = VIEWS.some((v) => v.key === params.view) ? (params.view as ViewKey) : "day";
  const from = params.from && DATE.test(params.from) ? params.from : undefined;
  const to = params.to && DATE.test(params.to) ? params.to : undefined;
  const href = (next: string) => {
    const q = new URLSearchParams({ view: next });
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    return `/sales-reports?${q.toString()}`;
  };

  let loaded: Loaded;
  try {
    loaded =
      view === "exceptions"
        ? { kind: "exceptions", report: await executeQuery(actor, exceptionsReport, { from, to }) }
        : { kind: "sales", report: await executeQuery(actor, salesReport, { view: view as (typeof SALES_VIEWS)[number] | "item", from, to }) };
  } catch (error) {
    if (error instanceof ForbiddenError) return <PermissionDenied what="sales reports" />;
    if (!(error instanceof ValidationError)) throw error;
    loaded = { kind: "problem", message: error.message.replace(/^E_VALIDATION:\s*/, "") };
  }

  const windowLabel = loaded.kind === "problem" ? "" : `${day(loaded.report.from)} to ${day(loaded.report.to)}. `;
  const first = VIEWS.find((v) => v.key === view)!.first;

  return (
    <>
      <PageHeader
        title="Sales reports"
        description={`${windowLabel}Settled bills only. A refund is shown against the bill it reverses. A day runs from 5 am to 5 am.`}
        actions={
          <Link href="/counter/history" className="text-[13px] text-text-secondary underline-offset-4 hover:underline">
            Order history
          </Link>
        }
      />
      <nav aria-label="Report" className="mb-4 flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Link key={v.key} href={href(v.key)} className={chip(v.key === view)} aria-current={v.key === view ? "page" : undefined}>
            {v.label}
          </Link>
        ))}
      </nav>
      <form className="mb-6 flex flex-wrap items-end gap-3" method="get">
        <input type="hidden" name="view" value={view} />
        <label className="flex flex-col gap-1 text-[13px] text-text-secondary">
          From
          <input type="date" name="from" defaultValue={from ?? ""} className="min-h-11 rounded-[10px] bg-control px-3 text-[15px] text-text" />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-text-secondary">
          To
          <input type="date" name="to" defaultValue={to ?? ""} className="min-h-11 rounded-[10px] bg-control px-3 text-[15px] text-text" />
        </label>
        <button type="submit" className="min-h-11 cursor-pointer rounded-[10px] border-0 bg-control px-4 text-[15px] font-semibold text-accent-ink hover:bg-control-strong">
          Show
        </button>
      </form>

      {loaded.kind === "problem" && <ErrorState title="Check the dates" message={loaded.message} retryable={false} />}

      {loaded.kind === "exceptions" && (
        <>
          <StatRow cols={3} className="mb-6">
            <Stat label="Cancelled orders" value={loaded.report.rows.filter((r) => r.kind === "cancelled_order").length} />
            <Stat label="Voided dishes" value={loaded.report.rows.filter((r) => r.kind === "voided_line").length} />
            <Stat label="Refunded" value={rupees(loaded.report.rows.filter((r) => r.kind === "refund").reduce((s, r) => s + r.amountMinor, 0))} />
          </StatRow>
          <DataTable
            caption="Cancelled orders, voided dishes and refunds, newest first"
            emptyTitle="Nothing was cancelled or refunded in these dates"
            emptyDescription="Cancelled orders, voided dishes and refunds appear here with the reason given."
            columns={[
              { key: "label", header: "Order", sortable: true, variant: "link", href: "{href}", subKey: "when" },
              { key: "kind", header: "What", sortable: true },
              { key: "detail", header: "Detail" },
              { key: "amount", header: "Value", numeric: true },
              { key: "reason", header: "Reason" },
            ]}
            rows={loaded.report.rows.map((r, i) => ({
              id: `${r.kind}-${i}`,
              href: r.href ?? "/counter/history",
              label: r.label,
              when: r.at.toLocaleString("en-IN", { timeZone: loaded.report.timeZone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }),
              kind: KIND_LABEL[r.kind],
              detail: r.detail,
              amount: rupees(r.amountMinor),
              reason: r.reason ?? "Not given",
            }))}
          />
        </>
      )}

      {loaded.kind === "sales" && (
        <>
          <StatRow cols={4} className="mb-6">
            <Stat label="Sales" value={rupees(loaded.report.totals.grossMinor)} hint={`${loaded.report.totals.bills} bill${loaded.report.totals.bills === 1 ? "" : "s"}`} />
            <Stat label="Refunded" value={rupees(loaded.report.totals.refundedMinor)} />
            <Stat label="Net" value={rupees(loaded.report.totals.netMinor)} />
            <Stat label="Average bill" value={rupees(loaded.report.totals.avgBillMinor)} hint={`${loaded.report.totals.covers} covers`} />
          </StatRow>
          {view === "item" ? (
            <DataTable
              caption="Items sold, largest first"
              emptyTitle="No sales in these dates"
              emptyDescription="Items appear once a bill is settled."
              columns={[
                { key: "label", header: first, sortable: true },
                { key: "qty", header: "Sold", numeric: true, sortable: true },
                { key: "revenue", header: "Charged", numeric: true, sortable: true },
              ]}
              rows={loaded.report.itemRows.map((r) => ({ id: r.key, label: r.label, qty: r.qty, revenue: rupees(r.revenueMinor) }))}
            />
          ) : (
            <DataTable
              caption={`Sales ${VIEWS.find((v) => v.key === view)!.label.toLowerCase()}`}
              emptyTitle="No settled bills in these dates"
              emptyDescription="Only settled bills count as sales."
              columns={[
                { key: "label", header: first, sortable: true },
                { key: "bills", header: "Bills", numeric: true, sortable: true },
                { key: "covers", header: "Covers", numeric: true, sortable: true },
                { key: "gross", header: "Sales", numeric: true, sortable: true },
                { key: "discount", header: "Discount", numeric: true },
                { key: "tax", header: "Tax", numeric: true },
                { key: "refunded", header: "Refunded", numeric: true },
                { key: "net", header: "Net", numeric: true, sortable: true },
                { key: "avg", header: "Average bill", numeric: true },
              ]}
              rows={loaded.report.rows.map((r) => ({
                id: r.key,
                label: r.label,
                bills: r.bills,
                covers: r.covers,
                gross: rupees(r.grossMinor),
                discount: r.discountMinor > 0 ? rupees(r.discountMinor) : "",
                tax: rupees(r.taxMinor),
                refunded: r.refundedMinor > 0 ? rupees(r.refundedMinor) : "",
                net: rupees(r.netMinor),
                avg: rupees(r.avgBillMinor),
              }))}
            />
          )}
        </>
      )}
    </>
  );
}

export default withPageAccess(SalesReportsPage);
