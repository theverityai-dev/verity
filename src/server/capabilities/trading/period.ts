import { z } from "zod";
import {
  registerCommand,
  ValidationError,
  type CommandDefinition,
} from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import {
  businessPeriodKey,
  businessPeriodWindow,
  businessZone,
  tenantZone,
} from "./clock";
import type { TenantScopedClient } from "@/server/platform/tenancy";
import { ENTITY_ACCOUNTING_PERIOD } from "./keys";

/**
 * Accounting periods, the posting lock, and the close checklist.
 *
 * Authority: taskplans/archive/45_plywood_workflow_program.md §5 and §8;
 * PLYWOOD_TARGET_WORKFLOW_GAP_AUDIT.md P0-08; specification §76 and §77.
 *
 * A close is the moment a business says "this is what happened in August". It
 * is only meaningful if the answer then stops changing — which is what makes
 * the lock, rather than the checklist, the load-bearing part.
 *
 * WHY A CALENDAR MONTH
 * The GST return period is a month, and the close exists so a return can be
 * filed against a set of documents that will not move afterwards. A financial
 * year is too coarse to be useful and an arbitrary range cannot be reconciled
 * to anything a tax authority recognises.
 */

/** "2026-08" for any instant. */
export function periodKeyOf(instant: Date, zone = "UTC"): string {
  // Audit finding U0-3. The UTC getters this replaced named the previous month
  // for five and a half hours out of every twenty-four in an IST business, so
  // an invoice raised at 01:00 IST on the 1st was filed under the month before.
  return businessPeriodKey(zone, instant);
}

export class PeriodClosedError extends ValidationError {
  constructor(periodKey: string) {
    super(
      `E_VALIDATION: ${periodKey} is closed. A document cannot be posted into a period ` +
        "that has been reported. Post it in the current period, or reopen " +
        `${periodKey} with a reason if it genuinely belongs there.`,
    );
  }
}

/**
 * Refuses a posting whose date falls in a closed period.
 *
 * Called by every command that writes a dated financial or stock fact. It is
 * deliberately a function rather than a database trigger: the check needs to
 * name the period and suggest what to do instead, and a trigger can only
 * refuse.
 *
 * A period that does not exist yet is OPEN. Periods are created by being posted
 * into, so a business that has never closed anything is never blocked, and the
 * first close is what creates the boundary.
 */
export async function assertPeriodOpen(
  tx: TenantScopedClient,
  on: Date,
): Promise<void> {
  // The period an instant belongs to is decided in the BUSINESS's zone (U0-3).
  // This is the highest-consequence use of that rule in the capability: it runs
  // on every document write, so getting it wrong files a real invoice into the
  // wrong month.
  const periodKey = periodKeyOf(on, await tenantZone(tx));
  const period = await tx.tradingAccountingPeriod.findFirst({
    where: { periodKey },
  });
  if (period?.state === "closed") throw new PeriodClosedError(periodKey);
}

/**
 * What stands between this period and a close.
 *
 * Specification §76. Every item is something a person has to go and resolve,
 * named with a count, because "3 GST mismatches" is actionable and "not ready"
 * is not.
 */
export const closeChecklist: QueryDefinition<
  { periodKey?: string },
  {
    periodKey: string;
    state: string;
    salesInvoices: number;
    purchaseInvoices: number;
    blockers: Array<{ kind: string; detail: string; count: number }>;
    ready: boolean;
  }
> = {
  key: "verity.trading.close_checklist",
  entity: ENTITY_ACCOUNTING_PERIOD,
  input: z.object({
    periodKey: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
  }),
  handler: async (ctx, input) => {
    // The period defaults to the month the BUSINESS is in, not UTC's (U0-3).
    const zone = await businessZone(ctx);
    const periodKey = input.periodKey ?? periodKeyOf(new Date(), zone);
    const { startsAt, endsAt } = businessPeriodWindow(zone, periodKey);

    const period = await ctx.tx.tradingAccountingPeriod.findFirst({
      where: { periodKey },
    });

    const invoices = await ctx.tx.tradingInvoice.findMany({
      where: { issuedAt: { gte: startsAt, lt: endsAt } },
      include: { customer: true, lines: true },
    });
    const sales = invoices.filter((invoice) => invoice.customerId !== null);
    const purchases = invoices.filter((invoice) => invoice.supplierId !== null);

    const blockers: Array<{ kind: string; detail: string; count: number }> = [];

    const missingState = sales.filter(
      (invoice) => !invoice.customer?.stateCode,
    ).length;
    if (missingState > 0) {
      blockers.push({
        kind: "missing_place_of_supply",
        detail: "Sales invoices whose customer has no state code",
        count: missingState,
      });
    }

    const missingHsn = sales.filter((invoice) =>
      invoice.lines.some((line) => !line.hsnCodeSnapshot),
    ).length;
    if (missingHsn > 0) {
      blockers.push({
        kind: "missing_hsn",
        detail: "Sales invoices with a line carrying no HSN code",
        count: missingHsn,
      });
    }

    const untaxedPurchases = purchases.filter(
      (invoice) =>
        invoice.cgstPaise + invoice.sgstPaise + invoice.igstPaise === 0,
    ).length;
    if (untaxedPurchases > 0) {
      blockers.push({
        kind: "no_input_credit",
        detail:
          "Supplier invoices with no tax split, so no input credit can be claimed",
        count: untaxedPurchases,
      });
    }

    // An order that shipped goods and was never invoiced is revenue sitting
    // outside the period it belongs to. This is the one blocker that is about
    // something MISSING rather than something wrong.
    // `TradingSalesOrder` carries no back-relation to its invoices, so the
    // set of invoiced orders is fetched and subtracted rather than expressed
    // as a `none` filter.
    const fulfilled = await ctx.tx.tradingSalesOrder.findMany({
      where: { state: "completed", updatedAt: { gte: startsAt, lt: endsAt } },
      select: { id: true },
    });
    const invoicedOrderIds = new Set(
      (
        await ctx.tx.tradingInvoice.findMany({
          where: { salesOrderId: { in: fulfilled.map((order) => order.id) } },
          select: { salesOrderId: true },
        })
      ).map((invoice) => invoice.salesOrderId),
    );
    const uninvoiced = fulfilled.filter(
      (order) => !invoicedOrderIds.has(order.id),
    ).length;
    if (uninvoiced > 0) {
      blockers.push({
        kind: "uninvoiced_fulfilment",
        detail: "Orders fulfilled in this period with no invoice raised",
        count: uninvoiced,
      });
    }

    return {
      periodKey,
      state: period?.state ?? "open",
      salesInvoices: sales.length,
      purchaseInvoices: purchases.length,
      blockers,
      ready: blockers.length === 0,
    };
  },
};

export const closePeriod: CommandDefinition<
  { periodKey: string; force?: boolean },
  { periodKey: string; state: string; blockersOverridden: number }
> = {
  impact: "destructive",
  key: "verity.trading.close_period",
  entity: ENTITY_ACCOUNTING_PERIOD,
  verb: "ActionExecute",
  input: z.object({
    periodKey: z.string().regex(/^\d{4}-\d{2}$/),
    // An override, not a default. Some blockers are genuinely acceptable — a
    // supplier who will never send a tax invoice, say — and a close that could
    // never happen would simply be worked around by not closing at all.
    force: z.boolean().optional(),
  }),
  handler: async (ctx, input) => {
    const [year, month] = input.periodKey.split("-").map(Number);
    // The window a period covers is the business's own month (U0-3).
    const { startsAt, endsAt } = businessPeriodWindow(
      await businessZone(ctx),
      input.periodKey,
    );

    if (endsAt > new Date()) {
      throw new ValidationError(
        `E_VALIDATION: ${input.periodKey} has not finished yet and cannot be closed`,
      );
    }

    const existing = await ctx.tx.tradingAccountingPeriod.findFirst({
      where: { periodKey: input.periodKey },
    });
    if (existing?.state === "closed") {
      throw new ValidationError(
        `E_VALIDATION: ${input.periodKey} is already closed`,
      );
    }

    const checklist = await closeChecklist.handler(ctx as never, {
      periodKey: input.periodKey,
    });
    if (checklist.blockers.length > 0 && !input.force) {
      throw new ValidationError(
        `E_VALIDATION: ${input.periodKey} has ${checklist.blockers.length} unresolved item(s): ` +
          checklist.blockers.map((b) => `${b.count} × ${b.detail}`).join("; "),
      );
    }

    const closedAt = new Date();
    const period = existing
      ? await ctx.tx.tradingAccountingPeriod.update({
          where: { id: existing.id },
          data: { state: "closed", closedAt, closedBy: ctx.actor.userId },
        })
      : await ctx.tx.tradingAccountingPeriod.create({
          data: {
            tenantId: ctx.actor.tenantId,
            periodKey: input.periodKey,
            startsAt,
            endsAt,
            state: "closed",
            closedAt,
            closedBy: ctx.actor.userId,
          },
        });

    return {
      result: {
        periodKey: period.periodKey,
        state: period.state,
        blockersOverridden: input.force ? checklist.blockers.length : 0,
      },
      events: [
        {
          name: "verity.trading.period_closed",
          entityId: period.id,
          payload: {
            periodKey: period.periodKey,
            blockersOverridden: input.force ? checklist.blockers.length : 0,
          },
        },
      ],
    };
  },
};

export const reopenPeriod: CommandDefinition<
  { periodKey: string; reason: string },
  { periodKey: string; state: string }
> = {
  impact: "destructive",
  key: "verity.trading.reopen_period",
  entity: ENTITY_ACCOUNTING_PERIOD,
  verb: "ActionExecute",
  input: z.object({
    periodKey: z.string().regex(/^\d{4}-\d{2}$/),
    // Required by the command AND by a CHECK constraint. Reopening a filed
    // period without a stated reason is the audit finding, so the rule lives
    // where it cannot be bypassed.
    reason: z.string().min(3).max(400),
  }),
  handler: async (ctx, input) => {
    const period = await ctx.tx.tradingAccountingPeriod.findFirst({
      where: { periodKey: input.periodKey },
    });
    if (!period || period.state !== "closed") {
      throw new ValidationError(
        `E_VALIDATION: ${input.periodKey} is not closed`,
      );
    }

    const reopened = await ctx.tx.tradingAccountingPeriod.update({
      where: { id: period.id },
      data: {
        state: "open",
        reopenedAt: new Date(),
        reopenedBy: ctx.actor.userId,
        reopenedReason: input.reason,
      },
    });

    return {
      result: { periodKey: reopened.periodKey, state: reopened.state },
      events: [
        {
          name: "verity.trading.period_reopened",
          entityId: reopened.id,
          // The reason travels with the event, so an operational audit shows
          // WHY a reported month was opened again without a second lookup.
          payload: { periodKey: reopened.periodKey, reason: input.reason },
        },
      ],
    };
  },
};

export function registerPeriods(): void {
  registerCommand(closePeriod);
  registerCommand(reopenPeriod);
  registerQuery(closeChecklist);
}
