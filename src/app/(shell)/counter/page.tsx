import Link from "next/link";
import { withPageAccess } from "@/components/ui/PageAccess";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import { ForbiddenError } from "@/server/platform/authorization";
import { resolveConfig } from "@/server/platform/capability";
import {
  CONFIG_ALERT_UNPAID_MINUTES,
  DEFAULT_ALERT_UNPAID_MINUTES,
  listOpenBills,
  ORDER_CHANNELS,
  ORDER_CHANNEL_LABEL,
  orderLabel,
  type OrderChannel,
} from "@/server/capabilities/dinein";
import { ButtonLink, FilterChipRow, PageHeader, PermissionDenied, StateBadge, StatTile, StatTileRow } from "@/components/ui/primitives";
import { DetailPane, MasterDetail, PaneFact } from "@/components/ui/DetailPane";
import { ActionBar } from "@/components/ui/ActionBar";
import { IconTile } from "@/components/ui/IconTile";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/viz";
import { channelKindFor } from "@/components/ui/business/domains";
import { NewChannelOrder } from "./NewChannelOrder";
import { RaiseBillButton } from "./RaiseBillButton";

export const dynamic = "force-dynamic";

function rupees(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function minutesSince(from: Date | null, now: number): number | null {
  return from ? Math.max(0, Math.floor((now - from.getTime()) / 60_000)) : null;
}

function ago(minutes: number | null): string {
  if (minutes === null) return "";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Read once per request, outside the component body, so every row agrees. */
function clock(): number {
  return Date.now();
}

const channelName = (channel: string) => ORDER_CHANNEL_LABEL[channel as OrderChannel] ?? channel;

/** What the cashier does next with a row. Three separate jobs, so three filters. */
type Job = "to_pay" | "to_bill" | "in_progress";

const JOB_CHIP: Record<Job, string> = { to_pay: "To collect", to_bill: "To bill", in_progress: "On the go" };

const ORDER_STATE: Record<string, { label: string; category: string }> = {
  draft: { label: "Taking the order", category: "Draft" },
  placed: { label: "With the kitchen", category: "Active" },
  partially_served: { label: "Partly ready", category: "Active" },
};

type Item = {
  key: string;
  job: Job;
  id: string;
  label: string;
  channel: string;
  detail: string;
  minutes: number | null;
  amountMinor: number | null;
  paidMinor: number;
  stateLabel: string;
  category: string;
  covers: number;
};

/**
 * The counter (Task 127 §4.2, P-WORK).
 *
 * A cashier has three jobs: collect money for bills already raised, raise bills for orders that have
 * finished, and keep track of takeaway and delivery orders that have no table to be found on. They
 * are one queue with three filters, oldest first, because the oldest is the guest standing at the
 * counter. Selecting a row opens it beside the list with its next step pinned.
 */
async function CounterPage({ searchParams }: { searchParams: Promise<{ show?: string; item?: string }> }) {
  installCapabilities();
  const actor = await requireActor();
  const { show, item: selectedKey } = await searchParams;
  const now = clock();

  let openBills: Awaited<ReturnType<typeof listOpenBills.handler>>;
  let awaitingBill: Array<{
    id: string;
    covers: number;
    channel: string;
    platform: string | null;
    platformOrderRef: string | null;
    customerName: string | null;
    servedAt: Date | null;
    table: { label: string } | null;
    location: { name: string };
    lines: Array<{ unitPriceMinor: number; qty: number }>;
  }>;
  let openChannelOrders: Array<{
    id: string;
    state: string;
    covers: number;
    channel: string;
    platform: string | null;
    platformOrderRef: string | null;
    customerName: string | null;
    createdAt: Date;
    table: { label: string } | null;
    location: { name: string };
  }>;
  let outlets: Array<{ id: string; name: string }>;
  let unpaidMinutes: number;

  try {
    openBills = await executeQuery(actor, listOpenBills, {});

    // Served orders with no bill yet. Read directly rather than through a query definition because
    // it is one join used on one page, and a registered query exists to be reused.
    awaitingBill = await withTenant(actor.tenantId, (tx) =>
      tx.diningOrder.findMany({
        where: { state: "served", bill: null },
        include: {
          table: { select: { label: true } },
          location: { select: { name: true } },
          lines: { where: { state: { not: "voided" } } },
        },
        orderBy: { servedAt: "asc" },
      }),
    );

    // Orders with no table never appear on the floor plan, so the counter is where they are found
    // again until they are billed.
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
    // The outlet's own "unpaid too long" setting, the same one the Today page flags with.
    unpaidMinutes = await withTenant(actor.tenantId, async (tx) =>
      (await resolveConfig<number>(tx, CONFIG_ALERT_UNPAID_MINUTES)) ?? DEFAULT_ALERT_UNPAID_MINUTES,
    );
  } catch (error) {
    if (error instanceof ForbiddenError) return <PermissionDenied what="the counter" />;
    throw error;
  }

  const multiOutlet = outlets.length > 1;
  const coversText = (n: number) => `${n} cover${n === 1 ? "" : "s"}`;
  const items: Item[] = [
    ...openBills.map((bill) => ({
      key: `bill-${bill.id}`,
      job: "to_pay" as const,
      id: bill.id,
      label: bill.label,
      channel: bill.channel,
      detail: `${channelName(bill.channel)} · ${coversText(bill.covers)}`,
      minutes: minutesSince(bill.createdAt, now),
      amountMinor: bill.totalMinor,
      paidMinor: bill.paidMinor,
      stateLabel: bill.paidMinor > 0 ? "Part paid" : "Awaiting payment",
      category: bill.paidMinor > 0 ? "Active" : "Pending",
      covers: bill.covers,
    })),
    ...awaitingBill.map((order) => ({
      key: `order-${order.id}`,
      job: "to_bill" as const,
      id: order.id,
      label: orderLabel(order),
      channel: order.channel,
      detail: `${channelName(order.channel)}${multiOutlet ? ` · ${order.location.name}` : ""} · ${coversText(order.covers)}`,
      minutes: minutesSince(order.servedAt, now),
      amountMinor: order.lines.reduce((sum, line) => sum + line.unitPriceMinor * line.qty, 0),
      paidMinor: 0,
      stateLabel: "Ready to bill",
      category: "Pending",
      covers: order.covers,
    })),
    ...openChannelOrders.map((order) => {
      const state = ORDER_STATE[order.state] ?? { label: order.state, category: "Active" };
      return {
        key: `order-${order.id}`,
        job: "in_progress" as const,
        id: order.id,
        label: orderLabel(order),
        channel: order.channel,
        detail: `${channelName(order.channel)}${multiOutlet ? ` · ${order.location.name}` : ""}`,
        minutes: minutesSince(order.createdAt, now),
        amountMinor: null,
        paidMinor: 0,
        stateLabel: state.label,
        category: state.category,
        covers: order.covers,
      };
    }),
  ];

  const filter: Job | null = show === "to_pay" || show === "to_bill" || show === "in_progress" ? show : null;
  const shown = filter ? items.filter((i) => i.job === filter) : items;
  const count = (job: Job) => items.filter((i) => i.job === job).length;
  const hrefFor = (params: { show?: Job | null; item?: string | null }) => {
    const query = new URLSearchParams();
    const s = params.show === undefined ? filter : params.show;
    if (s) query.set("show", s);
    if (params.item) query.set("item", params.item);
    const q = query.toString();
    return `/counter${q ? `?${q}` : ""}`;
  };

  const outstanding = openBills.reduce((sum, bill) => sum + (bill.totalMinor - bill.paidMinor), 0);
  const toBillMinor = items.filter((i) => i.job === "to_bill").reduce((sum, i) => sum + (i.amountMinor ?? 0), 0);
  const oldestBill = openBills[0];
  const oldestMinutes = oldestBill ? minutesSince(oldestBill.createdAt, now) : null;
  const selected = items.find((i) => i.key === selectedKey);

  const pane = selected ? (
    <DetailPane
      label="Selected"
      title={selected.label}
      subtitle={selected.detail}
      openHref={selected.job === "to_pay" ? `/counter/${selected.id}` : `/floor/${selected.id}`}
      closeHref={hrefFor({ item: null })}
      summary={
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <IconTile kind={channelKindFor(selected.channel)} />
            <StateBadge category={selected.category} label={selected.stateLabel} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            {selected.job === "to_pay" && (
              <>
                <PaneFact label="Total" value={rupees(selected.amountMinor!)} />
                <PaneFact label="Paid" value={rupees(selected.paidMinor)} />
                <PaneFact label="Due" value={rupees(selected.amountMinor! - selected.paidMinor)} />
              </>
            )}
            {selected.job === "to_bill" && (
              <>
                <PaneFact label="Before tax" value={rupees(selected.amountMinor!)} />
                <PaneFact label="Covers" value={selected.covers} />
                <PaneFact label="Served" value={selected.minutes === null ? "—" : `${ago(selected.minutes)} ago`} />
              </>
            )}
            {selected.job === "in_progress" && (
              <>
                <PaneFact label="Channel" value={channelName(selected.channel)} />
                <PaneFact label="Covers" value={selected.covers} />
                <PaneFact label="Open for" value={ago(selected.minutes) || "—"} />
              </>
            )}
          </div>
        </div>
      }
      footer={
        <ActionBar>
          {selected.job === "to_pay" && (
            <ButtonLink href={`/counter/${selected.id}`} variant="primary">
              Take payment
            </ButtonLink>
          )}
          {selected.job === "to_bill" && <RaiseBillButton orderId={selected.id} />}
          {selected.job !== "to_pay" && (
            <ButtonLink href={`/floor/${selected.id}`} variant={selected.job === "in_progress" ? "primary" : "secondary"}>
              Open order
            </ButtonLink>
          )}
        </ActionBar>
      }
    >
      {selected.job === "to_pay" && (
        <div className="flex flex-col gap-2 pt-1">
          <p className="m-0 text-[15px] font-semibold text-text">Payment</p>
          <ProgressBar
            value={selected.paidMinor}
            total={selected.amountMinor!}
            tone={selected.paidMinor >= selected.amountMinor! ? "completed" : "active"}
            label="Paid of the bill total"
            figures={`${rupees(selected.paidMinor)} of ${rupees(selected.amountMinor!)}`}
          />
          <p className="m-0 text-[13px] text-text-secondary">
            On the bill: split by items, take several payments, apply a discount, or refund.
          </p>
        </div>
      )}
      {selected.job === "to_bill" && (
        <p className="m-0 pt-1 text-[15px] text-text-secondary">
          The amount is before tax. Tax is worked out once, when the bill is raised, so the bill and the printout always agree.
        </p>
      )}
      {selected.job === "in_progress" && (
        <p className="m-0 pt-1 text-[15px] text-text-secondary">
          A takeaway or delivery order has no table on the floor plan. It stays here until it is served and billed.
        </p>
      )}
    </DetailPane>
  ) : undefined;

  const list =
    shown.length === 0 ? (
      <div className="glass-card flex flex-col items-center gap-2 px-6 py-12 text-center">
        <IconTile kind="bill" size="lg" />
        <p className="m-0 mt-2 text-[17px] font-semibold text-text">{filter ? `Nothing ${JOB_CHIP[filter].toLowerCase()}` : "The counter is clear"}</p>
        <p className="m-0 max-w-[44ch] text-[15px] text-text-secondary">
          Served orders appear here to be billed, and their bills stay until they are paid. Start a takeaway or delivery order with New order.
        </p>
      </div>
    ) : (
      <ul className="glass-card m-0 list-none overflow-hidden p-0" aria-label="Counter queue">
        {shown.map((row) => {
          const active = row.key === selected?.key;
          return (
            <li key={row.key} className="border-t border-line first:border-t-0">
              <Link
                href={hrefFor({ item: row.key })}
                scroll={false}
                aria-current={active ? "true" : undefined}
                className={
                  "flex items-center gap-3 px-4 py-3 no-underline transition-colors focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-accent-line)] " +
                  (active ? "bg-accent-subtle" : "hover:bg-[var(--color-control)]")
                }
              >
                <IconTile kind={channelKindFor(row.channel)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[17px] font-semibold text-text">{row.label}</span>
                  <span className="block truncate text-[13px] text-text-secondary">
                    {row.detail}
                    {row.minutes !== null && ` · ${ago(row.minutes)}`}
                  </span>
                  <span className="mt-1 block sm:hidden">
                    <StateBadge category={row.category} label={row.stateLabel} />
                  </span>
                </span>
                <span className="hidden sm:block">
                  <StateBadge category={row.category} label={row.stateLabel} />
                </span>
                {row.amountMinor !== null && (
                  <span className="tabular w-[104px] shrink-0 text-right text-[15px] font-semibold text-text">
                    {rupees(row.job === "to_pay" ? row.amountMinor - row.paidMinor : row.amountMinor)}
                    <span className="block text-[12px] font-normal text-text-tertiary">{row.job === "to_pay" ? "due" : "before tax"}</span>
                  </span>
                )}
                <Icon name="expand" size={16} className="shrink-0 text-text-tertiary" />
              </Link>
            </li>
          );
        })}
      </ul>
    );

  return (
    <>
      <PageHeader
        title="Counter"
        description="Bills to collect, orders to bill, and takeaway and delivery orders on the go. Oldest first."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <ButtonLink href="/counter/history">Order history</ButtonLink>
            <NewChannelOrder
              outlets={outlets.map((o) => ({ value: o.id, label: o.name }))}
              channels={ORDER_CHANNELS.filter((c) => c !== "dine_in").map((c) => ({ value: c, label: ORDER_CHANNEL_LABEL[c] }))}
            />
          </div>
        }
      />

      <StatTileRow className="mb-5">
        <StatTile
          kind="money"
          label="To collect"
          value={rupees(outstanding)}
          hint={`${openBills.length} bill${openBills.length === 1 ? "" : "s"} open`}
          href={hrefFor({ show: "to_pay", item: null })}
        />
        <StatTile
          kind="bill"
          label="Ready to bill"
          value={count("to_bill")}
          hint={count("to_bill") ? `${rupees(toBillMinor)} before tax` : "Nothing served and waiting"}
          href={hrefFor({ show: "to_bill", item: null })}
        />
        <StatTile
          kind="channel-takeaway"
          label="Takeaway and delivery"
          value={count("in_progress")}
          hint="Open, not yet served"
          href={hrefFor({ show: "in_progress", item: null })}
        />
        <StatTile
          icon="clock"
          state={oldestMinutes !== null && oldestMinutes > unpaidMinutes ? "pending" : "completed"}
          label="Oldest open bill"
          value={oldestBill ? ago(oldestMinutes) : "—"}
          hint={oldestBill ? `${oldestBill.label} · flagged after ${unpaidMinutes} min` : "No bills open"}
        />
      </StatTileRow>

      <nav aria-label="Filter the counter" className="mb-4">
        <FilterChipRow
          chips={[
            { label: "Everything", count: items.length, active: filter === null, href: hrefFor({ show: null, item: null }) },
            { label: JOB_CHIP.to_pay, count: count("to_pay"), icon: "wallet", active: filter === "to_pay", href: hrefFor({ show: "to_pay", item: null }) },
            { label: JOB_CHIP.to_bill, count: count("to_bill"), icon: "receipt", active: filter === "to_bill", href: hrefFor({ show: "to_bill", item: null }) },
            { label: JOB_CHIP.in_progress, count: count("in_progress"), icon: "takeaway", active: filter === "in_progress", href: hrefFor({ show: "in_progress", item: null }) },
          ]}
        />
      </nav>

      <MasterDetail list={list} pane={pane} />
    </>
  );
}

export default withPageAccess(CounterPage);
