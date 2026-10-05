import { withPageAccess } from "@/components/ui/PageAccess";
import Link from "next/link";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import {
  lowStock,
  marginReport,
  needsAttention,
  onboardingChecklist,
  ownerConsole,
  recentActivityFeed,
  taxSummary,
  topCustomers,
  topItems,
  weeklyPurchaseTotals,
  weeklySalesTotals,
} from "@/server/capabilities/plywood";
import { metricsHistory } from "@/server/capabilities/trading";
import { SetupChecklist } from "./SetupChecklist";
import { loadPanel } from "@/components/ui/panelState";
import { StatCard } from "@/components/ui/business/StatCard";
import { HeroSignal, SignalRail } from "@/components/ui/business/HeroSignal";
import { AttentionList } from "@/components/ui/business/AttentionList";
import { RankedList } from "@/components/ui/business/RankedList";
import { ActivityLog } from "@/components/ui/business/ActivityLog";
import { commandLabelOf } from "@/components/ui/business/vocabulary";
import { BarStrip } from "@/components/ui/charts";
import {
  Button,
  ErrorState,
  Panel,
  PermissionDenied,
} from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { DataTable, type Column } from "@/components/ui/DataTable";

export const dynamic = "force-dynamic";

function rupees(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}

function delta(thisPeriod: number, lastPeriod: number): { percent: number; direction: "up" | "down" } | undefined {
  if (lastPeriod === 0) return undefined; // Nothing real to compare against yet.
  const percent = ((thisPeriod - lastPeriod) / lastPeriod) * 100;
  return { percent: Math.abs(percent), direction: percent >= 0 ? "up" : "down" };
}

function initialsOf(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * The owner console — rebuilt against a supplied reference board
 * (2026-09-04), inspired-by rather than pixel-exact: real Verity data
 * throughout, no fabricated trend lines (`weeklySalesTotals`/
 * `weeklyPurchaseTotals` are real `GROUP BY` week totals from actual
 * invoice history, not a projection). Built from the new platform-wide
 * card kit (`components/ui/business/StatCard`, `AttentionList`,
 * `RankedList`) so the next capability's own dashboard reuses these
 * instead of rebuilding flat stat rows again.
 *
 * `needsAttention` is plywood's own local composition of its already-
 * canonical signals — not Task 90's gated platform-wide contribution
 * point. Every panel below is independently `loadPanel`-wrapped (Task 86):
 * one failing panel shows its own inline error, the rest of the page
 * still renders.
 */
async function OverviewPage() {
  installCapabilities();
  const actor = await requireActor();

  const consolePanel = await loadPanel(executeQuery(actor, ownerConsole, {}));
  if (consolePanel.status === "denied") return <PermissionDenied what="the owner console" />;
  if (consolePanel.status === "error") {
    return <ErrorState title="The owner console could not load" message={consolePanel.message} retryable />;
  }
  const c = consolePanel.data;

  const [
    marginPanel,
    shortPanel,
    setupPanel,
    taxPanel,
    salesWeeksPanel,
    purchaseWeeksPanel,
    attentionPanel,
    activityPanel,
    customersPanel,
    itemsPanel,
    historyPanel,
  ] = await Promise.all([
    loadPanel(executeQuery(actor, marginReport, { sinceDays: 30 })),
    loadPanel(executeQuery(actor, lowStock, {})),
    loadPanel(executeQuery(actor, onboardingChecklist, {})),
    loadPanel(executeQuery(actor, taxSummary, {})),
    loadPanel(executeQuery(actor, weeklySalesTotals, {})),
    loadPanel(executeQuery(actor, weeklyPurchaseTotals, {})),
    loadPanel(executeQuery(actor, needsAttention, {})),
    loadPanel(executeQuery(actor, recentActivityFeed, { limit: 8 })),
    loadPanel(executeQuery(actor, topCustomers, {})),
    loadPanel(executeQuery(actor, topItems, {})),
    loadPanel(executeQuery(actor, metricsHistory, { days: 14 })),
  ]);

  const margin = marginPanel.status === "ok" ? marginPanel.data : null;
  const short = shortPanel.status === "ok" ? shortPanel.data : [];
  const setup = setupPanel.status === "ok" ? setupPanel.data : null;
  const taxExceptionCount = taxPanel.status === "ok" ? taxPanel.data.exceptions.length : null;
  const salesWeeks = salesWeeksPanel.status === "ok" ? salesWeeksPanel.data : [];
  const purchaseWeeks = purchaseWeeksPanel.status === "ok" ? purchaseWeeksPanel.data : [];
  const attention = attentionPanel.status === "ok" ? attentionPanel.data : [];
  const activity = activityPanel.status === "ok" ? activityPanel.data : [];
  const customers = customersPanel.status === "ok" ? customersPanel.data : [];
  const items = itemsPanel.status === "ok" ? itemsPanel.data : [];
  // Real daily snapshots only (Task 100) — never fewer than 2 points, so an
  // empty or single-row history (a tenant too new for the capture job to
  // have run twice) renders no sparkline rather than a flat or fake one.
  const history = historyPanel.status === "ok" ? historyPanel.data : [];
  const stockValueTrend = history.length > 1 ? history.map((h) => h.stockValuePaise) : undefined;
  const receivablesTrend = history.length > 1 ? history.map((h) => h.receivablesPaise) : undefined;
  const payablesTrend = history.length > 1 ? history.map((h) => h.payablesPaise) : undefined;

  const businessName = await withTenant(actor.tenantId, async (tx) => {
    const profile = await tx.tradingBusinessProfile.findFirst({
      select: { tradeName: true, legalName: true },
    });
    if (profile?.tradeName) return profile.tradeName;
    if (profile?.legalName) return profile.legalName;
    const tenant = await tx.tenant.findUnique({ where: { id: actor.tenantId }, select: { name: true } });
    return tenant?.name ?? "your business";
  });

  return (
    <>
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="m-0 text-[13px] uppercase tracking-[0.02em] text-text-secondary">
            {greeting()}
          </p>
          <h1 className="mt-1.5 truncate">Here's what's happening with your business.</h1>
          <p className="mb-0 mt-2 max-w-[62ch] text-[14px] leading-relaxed text-text-secondary">
            Track your operations, stay on top of what matters, and keep your business moving forward.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2.5">
          <Link href="/sales">
            <Button variant="primary" className="gap-1.5">
              <Icon name="plus" size={15} /> New Sale
            </Button>
          </Link>
          <Link href="/purchases">
            <Button className="gap-1.5">
              <Icon name="plus" size={15} /> Purchase
            </Button>
          </Link>
          <Link href="/customers">
            <Button className="gap-1.5">
              <Icon name="plus" size={15} /> Customer
            </Button>
          </Link>
        </div>
      </div>

      {setup && !setup.complete && (
        <div className="mb-6">
          <SetupChecklist checklist={setup} businessName={businessName} />
        </div>
      )}
      {setupPanel.status === "error" && (
        <div className="mb-6">
          <ErrorState title="Setup checklist could not load" message={setupPanel.message} retryable />
        </div>
      )}

      {/* Task 116 Phase 1 reference composition: one dominant real business
          signal and one compact operating rail. The previous layout repeated
          the sales total in two equally weighted card rows, so nothing on the
          page established priority. */}
      <div className="mb-6 grid items-stretch gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.8fr)]">
        <HeroSignal
          icon="sales"
          label="Sales this month"
          value={rupees(c.salesThisMonthPaise)}
          context={`${rupees(c.todaysSalesPaise)} today`}
          delta={(() => {
            const change = delta(c.salesThisMonthPaise, c.salesLastMonthPaise);
            return change
              ? {
                  label: `${change.percent.toFixed(1)}% vs last month`,
                  direction: change.direction,
                }
              : undefined;
          })()}
          action={
            <Link href="/finance" className="text-[12px] text-accent-ink no-underline hover:underline">
              View finances →
            </Link>
          }
          visual={
            salesWeeksPanel.status === "error" ? (
              <ErrorState title="Weekly sales could not load" message={salesWeeksPanel.message} retryable />
            ) : salesWeeks.length > 0 ? (
              <BarStrip values={salesWeeks} label="Sales by week" height={92} />
            ) : (
              <p className="m-0 text-[12px] text-text-tertiary">Weekly history will appear as sales are recorded.</p>
            )
          }
        />
        <SignalRail
          items={[
            {
              icon: "workspace",
              label: "Open orders",
              value: c.openSalesOrders,
              hint: "Taken, not yet closed out",
              href: "/sales",
            },
            {
              icon: "approvals",
              label: "Awaiting credit approval",
              value: c.awaitingCreditApproval,
              hint: c.awaitingCreditApproval === 0 ? "Nothing held" : "Held until approved",
              href: "/sales",
              tone: c.awaitingCreditApproval > 0 ? "warning" : "neutral",
            },
            {
              icon: "purchases",
              label: "Awaiting goods issue",
              value: c.awaitingGoodsIssue,
              hint: "Approved, still in the godown",
              href: "/sales",
              tone: c.awaitingGoodsIssue > 0 ? "warning" : "neutral",
            },
          ]}
        />
      </div>

      {/* Purchase movement and the action queue are the next layer: useful
          context, but visually subordinate to the business pulse above. */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Purchase overview">
          <p className="tabular m-0 text-[26px] font-normal leading-none text-text">
            {rupees(c.purchasesThisMonthPaise)}
          </p>
          <p className="m-0 mt-1 text-[12px] text-text-tertiary">Open purchase orders: {c.openPurchaseOrders}</p>
          {purchaseWeeksPanel.status === "error" ? (
            <div className="mt-4">
              <ErrorState title="Weekly purchases could not load" message={purchaseWeeksPanel.message} retryable />
            </div>
          ) : (
            purchaseWeeks.length > 0 && (
              <div className="mt-5">
                <BarStrip values={purchaseWeeks} label="Purchases by week" height={72} />
              </div>
            )
          )}
        </Panel>

        {attentionPanel.status === "error" ? (
          <ErrorState title="Needs Attention could not load" message={attentionPanel.message} retryable />
        ) : (
          <AttentionList items={attention} />
        )}
      </div>

      {/* Inventory Snapshot / Money at a Glance — same ownerConsole fields
          the page always had, re-skinned. */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Inventory Snapshot" action={<Link href="/stock" className="text-[12px] text-accent-ink no-underline hover:underline">View stock →</Link>}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="tabular m-0 text-[20px] leading-none text-text">{rupees(c.stockValuePaise)}</p>
              <p className="m-0 mt-1 text-[12px] text-text-tertiary">Inventory value</p>
              {stockValueTrend && (
                <div className="mt-2 h-6 w-20">
                  <BarStrip values={stockValueTrend} label="Inventory value, last 14 days" height={24} />
                </div>
              )}
            </div>
            <div>
              <p className="tabular m-0 text-[20px] leading-none text-text">{c.lowStockBoards}</p>
              <p className="m-0 mt-1 text-[12px] text-text-tertiary">Low stock</p>
            </div>
            <div>
              <p className="tabular m-0 text-[20px] leading-none text-text">{c.reservedUnits.toLocaleString("en-IN")}</p>
              <p className="m-0 mt-1 text-[12px] text-text-tertiary">Reserved (sheets)</p>
            </div>
            <div>
              <p className="tabular m-0 text-[20px] leading-none text-text">{c.incomingUnits.toLocaleString("en-IN")}</p>
              <p className="m-0 mt-1 text-[12px] text-text-tertiary">Incoming (sheets)</p>
            </div>
          </div>
        </Panel>

        <Panel title="Money at a Glance" action={<Link href="/finance" className="text-[12px] text-accent-ink no-underline hover:underline">View finances →</Link>}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="tabular m-0 text-[20px] leading-none text-text">{rupees(c.receivablesPaise)}</p>
              <p className="m-0 mt-1 text-[12px] text-text-tertiary">Owed to us</p>
              {receivablesTrend && (
                <div className="mt-2 h-6 w-20">
                  <BarStrip values={receivablesTrend} label="Owed to us, last 14 days" height={24} />
                </div>
              )}
            </div>
            <div>
              <p className="tabular m-0 text-[20px] leading-none text-danger">{rupees(c.overdueReceivablesPaise)}</p>
              <p className="m-0 mt-1 text-[12px] text-text-tertiary">Overdue</p>
            </div>
            <div>
              <p className="tabular m-0 text-[20px] leading-none text-text">{rupees(c.payablesPaise)}</p>
              <p className="m-0 mt-1 text-[12px] text-text-tertiary">Owed by us</p>
              {payablesTrend && (
                <div className="mt-2 h-6 w-20">
                  <BarStrip values={payablesTrend} label="Owed by us, last 14 days" height={24} />
                </div>
              )}
            </div>
            <div>
              <p className="tabular m-0 text-[20px] leading-none text-success">{rupees(c.collectionsTodayPaise)}</p>
              <p className="m-0 mt-1 text-[12px] text-text-tertiary">Collected today</p>
            </div>
          </div>
        </Panel>
      </div>

      {margin && (
        <div className="mb-6">
          <Panel title="Margin, last 30 days">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <p className="tabular m-0 text-[28px] font-normal leading-none tracking-[-0.02em] text-text">
                  {rupees(margin.marginPaise)}
                </p>
                <p className="mb-0 mt-2 text-[13px] text-text-secondary">
                  {rupees(margin.revenuePaise)} sold, {rupees(margin.costOfGoodsSoldPaise)} cost —{" "}
                  <span className="tabular">{(margin.marginBp / 100).toFixed(1)}%</span>
                </p>
              </div>
              <p className="m-0 max-w-[46ch] text-[12px] text-text-tertiary">
                Costed by {margin.costingMethod.toLowerCase()}. Revenue excludes tax collected — tax
                is not income. Cost is what the stock ledger recorded as consumed at the moment each
                sale happened, so a later purchase cannot restate a past margin.
              </p>
            </div>
          </Panel>
        </div>
      )}
      {marginPanel.status === "error" && (
        <div className="mb-6">
          <ErrorState title="Margin could not load" message={marginPanel.message} retryable />
        </div>
      )}

      {/* Recent Activity / Top Customers / Top Items — the reference's
          bottom row. Recent Activity reuses ActivityLog's own captioning
          (Task 92); Top Customers/Items are new real this-month
          aggregates. */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {activityPanel.status === "error" ? (
          <ErrorState title="Recent activity could not load" message={activityPanel.message} retryable />
        ) : (
          <ActivityLog
            title="Recent Activity"
            entries={activity.map((a) => ({
              occurredAt: a.occurredAt,
              action: a.action,
              before: null,
              after: null,
              actorUserId: null,
              commandKey: a.commandKey,
              kind: a.kind,
            }))}
          />
        )}

        {customersPanel.status === "error" ? (
          <ErrorState title="Top customers could not load" message={customersPanel.message} retryable />
        ) : (
          <RankedList
            title="Top Customers"
            period="This month"
            items={customers.map((cu) => ({
              id: cu.customerId,
              initials: initialsOf(cu.name),
              label: cu.name,
              sublabel: `${cu.orders} order${cu.orders === 1 ? "" : "s"}`,
              value: rupees(cu.totalPaise),
              href: `/customers/${cu.customerId}`,
            }))}
          />
        )}

        {itemsPanel.status === "error" ? (
          <ErrorState title="Top items could not load" message={itemsPanel.message} retryable />
        ) : (
          <RankedList
            title="Top Items"
            period="This month"
            items={items.map((it) => ({
              id: it.productId,
              initials: initialsOf(it.name),
              label: it.name,
              sublabel: `${it.qtyUnits.toLocaleString("en-IN")} ${it.unitLabel}`,
              value: rupees(it.totalPaise),
            }))}
          />
        )}
      </div>

      {shortPanel.status === "error" && (
        <div className="mb-6">
          <ErrorState title="Low-stock list could not load" message={shortPanel.message} retryable />
        </div>
      )}
      {short.length > 0 && (
        <div className="mb-6">
          <Panel
            title="Needs buying"
            action={
              <Link href="/purchases">
                <Button size="sm">Raise an order</Button>
              </Link>
            }
          >
            <DataTable
              columns={[
                { key: "board", header: "Board", sortable: true },
                { key: "onHand", header: "On hand", numeric: true, sortable: true },
                { key: "reorderAt", header: "Reorder at", numeric: true, sortable: true },
              ]}
              rows={short.slice(0, 10).map((row) => ({
                id: row.productId,
                board: `${row.brandName} · ${row.productName}`,
                onHand: `${row.onHandUnits} ${row.unitLabel}`,
                reorderAt: row.reorderLevelUnits,
              }))}
              caption="Boards at or below their reorder level"
            />
          </Panel>
        </div>
      )}

      {taxExceptionCount !== null && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard icon="tax" label="Output GST" value={rupees(c.outputTaxPaise)} hint="Charged this month" href="/tax/gstr-1" />
          <StatCard icon="tax" label="Eligible ITC" value={rupees(c.eligibleItcPaise)} hint="Evidenced on purchase invoices" href="/tax/gstr-3b" />
          <StatCard
            icon="tax"
            label="Tax exceptions"
            value={String(taxExceptionCount)}
            hint={taxExceptionCount === 0 ? "Nothing to fix" : "Need attention"}
            href="/tax/exceptions"
          />
        </div>
      )}
      {taxPanel.status === "error" && (
        <ErrorState title="Tax summary could not load" message={taxPanel.message} retryable />
      )}
    </>
  );
}

export default withPageAccess(OverviewPage);
