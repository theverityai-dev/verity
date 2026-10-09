import { z } from "zod";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { ValidationError } from "@/server/platform/command";
import { resolveConfig } from "@/server/platform/capability";
import { hasPermission } from "@/server/platform/authorization";
import type { TenantScopedClient } from "@/server/platform/tenancy";
import {
  baseline,
  groupBills,
  groupItems,
  SALES_VIEWS,
  totalsOf,
  type ItemRow,
  type ReportBill,
  type SalesRow,
  type SalesView,
} from "@/lib/sales-report";
import {
  CONFIG_ALERT_SEATED_MINUTES,
  CONFIG_ALERT_UNPAID_MINUTES,
  DEFAULT_ALERT_SEATED_MINUTES,
  DEFAULT_ALERT_UNPAID_MINUTES,
  ENTITY_BILL,
  ENTITY_ORDER,
  ORDER_CHANNEL_LABEL,
  type OrderChannel,
} from "./keys";
import { DEFAULT_DAY_START_MINUTE, serviceDayRange } from "./day";
import { scopedLocationIds } from "./scope";

/**
 * Restaurant reports and the "today" view (Task 126 Wave 1; URY's report pack and
 * dashboard). Read-only queries over facts the capability already stores: settled
 * bills, payments, refunds, order lines. Nothing here has its own version of a
 * number: revenue is a settled bill's total, net of refunds, the same basis as
 * the outlet P&L.
 */

/**
 * The inventory capability's stock entity. A key, not an import: the "running low"
 * panel only asks whether the actor may read stock and then reads the balances the
 * actor's own scope already exposes; it calls no inventory code.
 */
const ENTITY_INVENTORY_STOCK = "verity.inventory.stock";

const MAX_REPORT_DAYS = 93;
const SERVICE_LINE_OVER_MINUTES = 75;

function orderName(order: {
  channel: string;
  table: { label: string } | null;
  platform: string | null;
  platformOrderRef: string | null;
  customerName: string | null;
}): string {
  if (order.table) return `Table ${order.table.label}`;
  if (order.channel === "delivery_platform") {
    const ref = order.platformOrderRef ? ` #${order.platformOrderRef}` : "";
    return `${order.platform ?? "Delivery platform"}${ref}`;
  }
  const channel = ORDER_CHANNEL_LABEL[order.channel as OrderChannel] ?? order.channel;
  return order.customerName ? `${channel} · ${order.customerName}` : channel;
}

/** Service days from `from` to `to` inclusive; throws when the range is backwards or too long. */
async function resolveWindow(
  tx: TenantScopedClient,
  organizationId: string,
  from: string | undefined,
  to: string | undefined,
): Promise<{ from: string; to: string; start: Date; end: Date; timeZone: string }> {
  const last = await serviceDayRange(tx, organizationId, to);
  const first = from
    ? await serviceDayRange(tx, organizationId, from)
    : await serviceDayRange(
        tx,
        organizationId,
        new Date(new Date(`${last.day}T00:00:00Z`).getTime() - 6 * 86_400_000).toISOString().slice(0, 10),
      );
  const days = Math.round((new Date(`${last.day}T00:00:00Z`).getTime() - new Date(`${first.day}T00:00:00Z`).getTime()) / 86_400_000) + 1;
  if (days < 1) throw new ValidationError("E_VALIDATION: the start date is after the end date");
  if (days > MAX_REPORT_DAYS) {
    throw new ValidationError(`E_VALIDATION: choose at most ${MAX_REPORT_DAYS} days at a time`);
  }
  return { from: first.day, to: last.day, start: first.from, end: last.to, timeZone: last.timeZone };
}

async function staffNames(tx: TenantScopedClient, userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const users = await tx.user.findMany({
    where: { id: { in: userIds } },
    include: { party: { select: { displayName: true } } },
  });
  return new Map(users.map((u) => [u.id, u.party.displayName]));
}

/* ============================== sales report ============================== */

export type SalesReport = {
  view: SalesView | "item";
  from: string;
  to: string;
  timeZone: string;
  rows: SalesRow[];
  totals: SalesRow;
  itemRows: ItemRow[];
};

export const salesReport: QueryDefinition<
  { view: SalesView | "item"; from?: string; to?: string; locationId?: string },
  SalesReport
> = {
  key: "verity.dinein.sales_report",
  entity: ENTITY_BILL,
  input: z.object({
    view: z.enum([...SALES_VIEWS, "item"]),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    locationId: z.string().uuid().optional(),
  }),
  handler: async (ctx, input) => {
    const locationIds = await scopedLocationIds(ctx.tx, ctx.actor, ENTITY_BILL, input.locationId);
    const window = await resolveWindow(ctx.tx, ctx.actor.organizationId, input.from, input.to);
    const zone = { timeZone: window.timeZone, startMinute: DEFAULT_DAY_START_MINUTE };

    const found = await ctx.tx.bill.findMany({
      where: {
        state: "settled",
        settledAt: { gte: window.start, lt: window.end },
        locationId: { in: locationIds },
      },
      include: {
        refunds: { select: { amountMinor: true } },
        order: {
          select: {
            channel: true,
            takenByUserId: true,
            covers: true,
            ...(input.view === "item"
              ? { lines: { where: { state: { not: "voided" } }, select: { itemNameSnapshot: true, qty: true, unitPriceMinor: true } } }
              : {}),
          },
        },
      },
    });

    const bills: ReportBill[] = found.map((b) => ({
      settledAt: b.settledAt!,
      channel: b.order.channel,
      takenByUserId: b.order.takenByUserId,
      covers: b.order.covers,
      totalMinor: b.totalMinor,
      discountMinor: b.discountMinor,
      taxMinor: b.cgstMinor + b.sgstMinor,
      refundedMinor: b.refunds.reduce((sum, r) => sum + r.amountMinor, 0),
      lines:
        "lines" in b.order && Array.isArray(b.order.lines)
          ? b.order.lines.map((l) => ({ name: l.itemNameSnapshot, qty: l.qty, unitPriceMinor: l.unitPriceMinor }))
          : [],
    }));

    if (input.view === "item") {
      return {
        view: "item",
        from: window.from,
        to: window.to,
        timeZone: window.timeZone,
        rows: [],
        totals: totalsOf(groupBills(bills, "day", zone)),
        itemRows: groupItems(bills),
      };
    }

    const labels = new Map<string, string>(Object.entries(ORDER_CHANNEL_LABEL));
    if (input.view === "staff") {
      for (const [id, name] of await staffNames(ctx.tx, [...new Set(bills.map((b) => b.takenByUserId))])) {
        labels.set(id, name);
      }
    }
    const rows = groupBills(bills, input.view, zone, labels);
    return {
      view: input.view,
      from: window.from,
      to: window.to,
      timeZone: window.timeZone,
      rows,
      totals: totalsOf(rows),
      itemRows: [],
    };
  },
};

/* ============================ exceptions report =========================== */

export type ExceptionRow = {
  kind: "cancelled_order" | "voided_line" | "refund";
  at: Date;
  label: string;
  detail: string;
  amountMinor: number;
  reason: string | null;
  href: string | null;
};

export const exceptionsReport: QueryDefinition<
  { from?: string; to?: string; locationId?: string },
  { from: string; to: string; timeZone: string; rows: ExceptionRow[] }
> = {
  key: "verity.dinein.exceptions_report",
  entity: ENTITY_BILL,
  input: z.object({
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    locationId: z.string().uuid().optional(),
  }),
  handler: async (ctx, input) => {
    const locationIds = await scopedLocationIds(ctx.tx, ctx.actor, ENTITY_BILL, input.locationId);
    const window = await resolveWindow(ctx.tx, ctx.actor.organizationId, input.from, input.to);
    const when = { gte: window.start, lt: window.end };
    const orderInclude = { table: { select: { label: true } } } as const;

    const [cancelled, voided, refunds] = await Promise.all([
      ctx.tx.diningOrder.findMany({
        where: { state: "cancelled", updatedAt: when, locationId: { in: locationIds } },
        include: { ...orderInclude, lines: { select: { qty: true, unitPriceMinor: true } } },
        take: 300,
      }),
      ctx.tx.orderLine.findMany({
        where: {
          state: "voided",
          updatedAt: when,
          order: { is: { locationId: { in: locationIds }, state: { not: "cancelled" } } },
        },
        include: { order: { include: orderInclude } },
        take: 300,
      }),
      ctx.tx.billRefund.findMany({
        where: { createdAt: when, bill: { is: { locationId: { in: locationIds } } } },
        include: { bill: { include: { order: { include: orderInclude } } } },
        take: 300,
      }),
    ]);

    // Reasons are written to the audit trail by the commands, one row per field.
    const reasons = new Map<string, string>();
    const subjectIds = [...cancelled.map((o) => o.id), ...voided.map((l) => l.id)];
    if (subjectIds.length > 0) {
      const rows = await ctx.tx.activity.findMany({
        where: { entityId: { in: subjectIds }, fieldChanged: "reason", commandKey: { in: ["verity.dinein.cancel_order", "verity.dinein.void_order_line"] } },
        select: { entityId: true, newValue: true },
      });
      for (const row of rows) if (row.newValue) reasons.set(row.entityId, row.newValue);
    }

    const out: ExceptionRow[] = [
      ...cancelled.map((o): ExceptionRow => ({
        kind: "cancelled_order",
        at: o.updatedAt,
        label: orderName(o),
        detail: `${o.lines.length} line${o.lines.length === 1 ? "" : "s"} cancelled`,
        amountMinor: o.lines.reduce((sum, l) => sum + l.qty * l.unitPriceMinor, 0),
        reason: reasons.get(o.id) ?? null,
        href: null,
      })),
      ...voided.map((l): ExceptionRow => ({
        kind: "voided_line",
        at: l.updatedAt,
        label: orderName(l.order),
        detail: `${l.qty} × ${l.itemNameSnapshot}`,
        amountMinor: l.qty * l.unitPriceMinor,
        reason: reasons.get(l.id) ?? null,
        href: null,
      })),
      ...refunds.map((r): ExceptionRow => ({
        kind: "refund",
        at: r.createdAt,
        label: orderName(r.bill.order),
        detail: `Refunded by ${r.method}`,
        amountMinor: r.amountMinor,
        reason: r.reason,
        href: `/counter/${r.billId}`,
      })),
    ];
    out.sort((a, b) => b.at.getTime() - a.at.getTime());
    return { from: window.from, to: window.to, timeZone: window.timeZone, rows: out.slice(0, 300) };
  },
};

/* ============================== outlet today ============================== */

export type ServiceStage = "free" | "seated" | "with_kitchen" | "ready" | "served" | "reserved" | "cleaning" | "out_of_service";

export type OutletToday = {
  day: string;
  timeZone: string;
  /** Null when the actor cannot read bills. */
  sales: {
    grossMinor: number;
    bills: number;
    avgBillMinor: number;
    covers: number;
    avgPerCoverMinor: number;
    avgTicketMinutes: number | null;
  } | null;
  tables: { seated: number; total: number };
  attention: Array<{ kind: "unpaid" | "seated_long" | "left_open" | "closing_open"; message: string; count: number; href: string }>;
  baseline: { sampleDays: number; medianSalesMinor: number; medianCovers: number };
  floorLoad: Array<{ staffName: string; tables: number }>;
  serviceLine: Array<{ tableId: string; label: string; stage: ServiceStage; minutes: number | null; over: boolean }>;
  runningLow: Array<{ name: string; onHand: number; reorderLevel: number }> | null;
  thresholds: { unpaidMinutes: number; seatedMinutes: number };
};

export const outletToday: QueryDefinition<{ locationId?: string }, OutletToday> = {
  key: "verity.dinein.outlet_today",
  entity: ENTITY_ORDER,
  input: z.object({ locationId: z.string().uuid().optional() }),
  handler: async (ctx, input) => {
    const tx = ctx.tx;
    const now = new Date();
    const locationIds = await scopedLocationIds(tx, ctx.actor, ENTITY_ORDER, input.locationId);
    const today = await serviceDayRange(tx, ctx.actor.organizationId);
    const zone = { timeZone: today.timeZone, startMinute: DEFAULT_DAY_START_MINUTE };

    const unpaidMinutes = (await resolveConfig<number>(tx, CONFIG_ALERT_UNPAID_MINUTES)) ?? DEFAULT_ALERT_UNPAID_MINUTES;
    const seatedMinutes = (await resolveConfig<number>(tx, CONFIG_ALERT_SEATED_MINUTES)) ?? DEFAULT_ALERT_SEATED_MINUTES;
    const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

    const canSeeMoney = await hasPermission(tx, ctx.actor.roleId, "Read", ENTITY_BILL);

    /* sales */
    let sales: OutletToday["sales"] = null;
    let history: Array<{ settledAt: Date; totalMinor: number; covers: number }> = [];
    if (canSeeMoney) {
      const settled = await tx.bill.findMany({
        where: { state: "settled", settledAt: { gte: today.from, lt: today.to }, locationId: { in: locationIds } },
        include: { order: { select: { covers: true, placedAt: true, servedAt: true } } },
      });
      const gross = settled.reduce((s, b) => s + b.totalMinor, 0);
      const covers = settled.reduce((s, b) => s + b.order.covers, 0);
      const tickets = settled
        .filter((b) => b.order.placedAt && b.order.servedAt)
        .map((b) => (b.order.servedAt!.getTime() - b.order.placedAt!.getTime()) / 60_000);
      sales = {
        grossMinor: gross,
        bills: settled.length,
        avgBillMinor: settled.length ? Math.round(gross / settled.length) : 0,
        covers,
        avgPerCoverMinor: covers ? Math.round(gross / covers) : 0,
        avgTicketMinutes: tickets.length ? Math.round(tickets.reduce((a, b) => a + b, 0) / tickets.length) : null,
      };
      const past = await tx.bill.findMany({
        where: {
          state: "settled",
          settledAt: { gte: new Date(now.getTime() - 42 * 86_400_000), lt: today.from },
          locationId: { in: locationIds },
        },
        select: { settledAt: true, totalMinor: true, order: { select: { covers: true } } },
      });
      history = past.map((b) => ({ settledAt: b.settledAt!, totalMinor: b.totalMinor, covers: b.order.covers }));
    }

    /* floor */
    const tables = await tx.diningTable.findMany({
      where: { state: { not: "retired" }, locationId: { in: locationIds } },
      orderBy: { label: "asc" },
      select: { id: true, label: true, state: true },
    });
    const openOrders = await tx.diningOrder.findMany({
      where: { state: { notIn: ["settled", "cancelled"] }, locationId: { in: locationIds } },
      include: { lines: { where: { state: { not: "voided" } }, select: { state: true } } },
    });
    const orderByTable = new Map(openOrders.filter((o) => o.tableId).map((o) => [o.tableId!, o]));

    const serviceLine: OutletToday["serviceLine"] = tables.map((t) => {
      const order = orderByTable.get(t.id);
      const minutes = order ? Math.floor((now.getTime() - order.createdAt.getTime()) / 60_000) : null;
      let stage: ServiceStage;
      if (t.state === "available") stage = "free";
      else if (t.state === "reserved") stage = "reserved";
      else if (t.state === "cleaning") stage = "cleaning";
      else if (t.state === "out_of_service") stage = "out_of_service";
      else if (!order || order.state === "draft" || order.lines.length === 0) stage = "seated";
      else if (order.lines.some((l) => l.state === "queued" || l.state === "preparing")) stage = "with_kitchen";
      else if (order.lines.some((l) => l.state === "ready")) stage = "ready";
      else stage = "served";
      return {
        tableId: t.id,
        label: t.label,
        stage,
        minutes,
        over: t.state === "occupied" && minutes !== null && minutes > SERVICE_LINE_OVER_MINUTES,
      };
    });

    /* attention */
    const attention: OutletToday["attention"] = [];
    const unpaid = await tx.bill.count({
      where: { state: "open", createdAt: { lt: minutesAgo(unpaidMinutes) }, locationId: { in: locationIds } },
    });
    if (unpaid > 0) {
      attention.push({
        kind: "unpaid",
        count: unpaid,
        message: `${unpaid} bill${unpaid === 1 ? "" : "s"} unpaid for over ${unpaidMinutes} minutes`,
        href: "/counter",
      });
    }
    const seatedLong = openOrders.filter((o) => o.tableId && o.createdAt < minutesAgo(seatedMinutes)).length;
    if (seatedLong > 0) {
      attention.push({
        kind: "seated_long",
        count: seatedLong,
        message: `${seatedLong} table${seatedLong === 1 ? "" : "s"} seated for over ${seatedMinutes} minutes`,
        href: "/floor",
      });
    }
    const leftOpen = openOrders.filter((o) => o.createdAt < today.from).length;
    if (leftOpen > 0) {
      attention.push({
        kind: "left_open",
        count: leftOpen,
        message: `${leftOpen} order${leftOpen === 1 ? "" : "s"} still open from before today`,
        href: "/floor",
      });
    }

    /* yesterday's closing list: asked for, trading happened, and it was not finished */
    {
      const prevDay = new Date(new Date(`${today.day}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
      const closingSteps = await tx.outletChecklistStep.groupBy({
        by: ["locationId"],
        where: { kind: "closing", active: true, locationId: { in: locationIds } },
        _count: { _all: true },
      });
      if (closingSteps.length > 0) {
        const prev = await serviceDayRange(tx, ctx.actor.organizationId, prevDay);
        const runs = await tx.outletChecklistRun.findMany({
          where: { kind: "closing", serviceDay: new Date(`${prevDay}T00:00:00Z`), locationId: { in: closingSteps.map((c) => c.locationId) } },
          select: { locationId: true, completedAt: true },
        });
        let unfinished = 0;
        for (const c of closingSteps) {
          const run = runs.find((r) => r.locationId === c.locationId);
          if (run?.completedAt) continue;
          const traded = await tx.bill.count({
            where: { locationId: c.locationId, state: "settled", settledAt: { gte: prev.from, lt: prev.to } },
          });
          if (traded > 0) unfinished += 1;
        }
        if (unfinished > 0) {
          attention.push({
            kind: "closing_open",
            count: unfinished,
            message: `${unfinished} outlet${unfinished === 1 ? "" : "s"} did not finish the closing checklist yesterday`,
            href: "/checklists",
          });
        }
      }
    }

    /* floor load */
    const byWaiter = new Map<string, Set<string>>();
    for (const o of openOrders) {
      if (!o.tableId) continue;
      const set = byWaiter.get(o.takenByUserId) ?? new Set<string>();
      set.add(o.tableId);
      byWaiter.set(o.takenByUserId, set);
    }
    const names = await staffNames(tx, [...byWaiter.keys()]);
    const floorLoad = [...byWaiter.entries()]
      .map(([id, set]) => ({ staffName: names.get(id) ?? "Unknown", tables: set.size }))
      .sort((a, b) => b.tables - a.tables);

    /* running low (only for a role that may read stock) */
    let runningLow: OutletToday["runningLow"] = null;
    if (await hasPermission(tx, ctx.actor.roleId, "Read", ENTITY_INVENTORY_STOCK)) {
      const items = await tx.inventoryItem.findMany({
        where: { active: true, reorderLevel: { gt: 0 } },
        select: { id: true, name: true, reorderLevel: true },
      });
      const balances = await tx.inventoryStockBalance.findMany({
        where: { locationId: { in: locationIds }, itemId: { in: items.map((i) => i.id) } },
        select: { itemId: true, locationId: true, qty: true },
      });
      const low: NonNullable<OutletToday["runningLow"]> = [];
      for (const item of items) {
        for (const locationId of locationIds) {
          const onHand = balances.find((b) => b.itemId === item.id && b.locationId === locationId)?.qty ?? 0;
          if (onHand <= item.reorderLevel) low.push({ name: item.name, onHand, reorderLevel: item.reorderLevel });
        }
      }
      runningLow = low.sort((a, b) => a.onHand - b.onHand).slice(0, 10);
    }

    return {
      day: today.day,
      timeZone: today.timeZone,
      sales,
      tables: {
        seated: tables.filter((t) => t.state === "occupied").length,
        total: tables.filter((t) => t.state !== "out_of_service").length,
      },
      attention,
      baseline: canSeeMoney ? baseline(history, now, zone) : { sampleDays: 0, medianSalesMinor: 0, medianCovers: 0 },
      floorLoad,
      serviceLine,
      runningLow,
      thresholds: { unpaidMinutes, seatedMinutes },
    };
  },
};

export function registerDineinReports(): void {
  registerQuery(salesReport);
  registerQuery(exceptionsReport);
  registerQuery(outletToday);
}
