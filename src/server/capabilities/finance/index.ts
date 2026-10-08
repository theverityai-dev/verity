import { z } from "zod";
import { registerContribution } from "@/server/platform/contribution";
import { registerCommand, ValidationError, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { hasPermission } from "@/server/platform/authorization";
import { outletLabour, type OutletLabour } from "@/lib/labour-cost";

/**
 * The HR capability's salary entity (`ENTITY_HR_COMPENSATION`). Held as a literal
 * here so Finance does not import HR; Read on it is what lets a role see pay
 * (DECISIONS.md #3), and the P&L labour line follows the same rule.
 */
const COMPENSATION_ENTITY = "verity.hr.compensation";

/**
 * CAPABILITY: Finance — `verity.capability.finance` (Colonel Kebabz Phase 4,
 * lean V1)
 *
 * Authority: `clients/colonel-kebabz/prd.md` §44-46, 48-49 (Expense
 * Management, Cash Management, Payment Management, Finance Dashboard,
 * Outlet P&L). §46 (payment method breakdown) needed zero new code —
 * `dinein.salesSummary`'s own `byMethod` already covers it.
 *
 * NOT BUILT: §47 Delivery Platform Reconciliation, blocked on a real
 * Zomato/Swiggy integration decision (external credentials, API contract).
 *
 * `getOutletPnL` is an ESTIMATE, not accounting-grade P&L (PRD §49 itself
 * says "estimated" and "allow actual accounting integration later"):
 * - Revenue: settled Bill totals for the range (same basis as salesSummary).
 * - COGS: valued at InventoryItem.avgUnitCostPaise's CURRENT value, not the
 *   cost at the moment each ingredient was actually consumed — Issue
 *   movements don't carry a point-in-time unit cost (only Receipt does).
 *   Flagged in the result as `cogsIsApproximate: true`.
 * - Labour/payroll cost: NOT included. Verity's `attendance` capability
 *   supplies hours/days worked (PRD §42's own framing: "payroll-ready
 *   data," not a payroll engine) but has no wage-rate figure to multiply
 *   by — there is no salary data anywhere in this platform. A P&L line
 *   claiming a labour cost without a real number would be worse than
 *   omitting it.
 */

export const FINANCE_CAPABILITY = "verity.capability.finance";
export const ENTITY_EXPENSE = "verity.finance.expense";
export const ENTITY_CASH_RECONCILIATION = "verity.finance.cash_reconciliation";

export const EXPENSE_CATEGORIES = [
  "Rent",
  "Electricity",
  "Gas",
  "Water",
  "Maintenance",
  "Cleaning",
  "Packaging",
  "Transport",
  "Marketing",
  "Repairs",
  "Salaries",
  "Miscellaneous",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const PAYMENT_METHODS = ["Cash", "UPI", "Card", "Wallet", "BankTransfer", "DeliveryPlatform", "Other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const recordExpense: CommandDefinition<
  {
    locationId: string;
    category: ExpenseCategory;
    amountMinor: number;
    paymentMethod: PaymentMethod;
    expenseDate: string;
    vendor?: string;
    receiptEvidenceId?: string;
  },
  { id: string }
> = {
  key: "verity.finance.record_expense",
  entity: ENTITY_EXPENSE,
  verb: "Create",
  input: z.object({
    locationId: z.string().uuid(),
    category: z.enum(EXPENSE_CATEGORIES),
    amountMinor: z.number().int().positive(),
    paymentMethod: z.enum(PAYMENT_METHODS),
    expenseDate: z.string().date(),
    vendor: z.string().max(120).optional(),
    receiptEvidenceId: z.string().uuid().optional(),
  }),
  handler: async (ctx, input) => {
    const expense = await ctx.tx.expense.create({
      data: {
        tenantId: ctx.actor.tenantId,
        locationId: input.locationId,
        category: input.category,
        vendor: input.vendor ?? null,
        amountMinor: input.amountMinor,
        paymentMethod: input.paymentMethod,
        expenseDate: new Date(input.expenseDate),
        receiptEvidenceId: input.receiptEvidenceId ?? null,
        recordedById: ctx.actor.userId,
      },
    });
    return { result: { id: expense.id }, events: [{ name: "verity.finance.expense_recorded", entityId: expense.id }] };
  },
};

export const decideExpense: CommandDefinition<{ expenseId: string; approve: boolean }, { id: string }> = {
  key: "verity.finance.decide_expense",
  entity: ENTITY_EXPENSE,
  verb: "Edit",
  input: z.object({ expenseId: z.string().uuid(), approve: z.boolean() }),
  preconditions: async (ctx, input) => {
    const expense = await ctx.tx.expense.findUnique({ where: { id: input.expenseId } });
    if (!expense) throw new ValidationError("E_VALIDATION: expense not found");
    if (expense.status !== "Pending") throw new ValidationError("E_VALIDATION: expense already decided");
  },
  handler: async (ctx, input) => {
    const expense = await ctx.tx.expense.update({
      where: { id: input.expenseId },
      data: {
        status: input.approve ? "Approved" : "Rejected",
        approvedById: ctx.actor.userId,
        version: { increment: 1 },
      },
    });
    return {
      result: { id: expense.id },
      events: [
        {
          name: input.approve ? "verity.finance.expense_approved" : "verity.finance.expense_rejected",
          entityId: expense.id,
        },
      ],
    };
  },
};

export const listExpenses: QueryDefinition<
  { locationId?: string; status?: "Pending" | "Approved" | "Rejected"; fromDate?: string; toDate?: string },
  Array<{ id: string; category: ExpenseCategory; amountMinor: number; status: string; expenseDate: Date }>
> = {
  key: "verity.finance.list_expenses",
  entity: ENTITY_EXPENSE,
  input: z.object({
    locationId: z.string().uuid().optional(),
    status: z.enum(["Pending", "Approved", "Rejected"]).optional(),
    fromDate: z.string().date().optional(),
    toDate: z.string().date().optional(),
  }),
  handler: async (ctx, input) => {
    const rows = await ctx.tx.expense.findMany({
      where: {
        ...(input.locationId ? { locationId: input.locationId } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.fromDate || input.toDate
          ? {
              expenseDate: {
                ...(input.fromDate ? { gte: new Date(input.fromDate) } : {}),
                ...(input.toDate ? { lte: new Date(input.toDate) } : {}),
              },
            }
          : {}),
      },
      orderBy: { expenseDate: "desc" },
    });
    return rows.map((r) => ({
      id: r.id,
      category: r.category as ExpenseCategory,
      amountMinor: r.amountMinor,
      status: r.status,
      expenseDate: r.expenseDate,
    }));
  },
};

export const recordCashReconciliation: CommandDefinition<
  {
    locationId: string;
    date: string;
    openingCashMinor: number;
    cashWithdrawnMinor?: number;
    actualCashMinor: number;
    varianceNote?: string;
  },
  { id: string; expectedCashMinor: number; varianceMinor: number }
> = {
  key: "verity.finance.record_cash_reconciliation",
  entity: ENTITY_CASH_RECONCILIATION,
  verb: "Create",
  input: z.object({
    locationId: z.string().uuid(),
    date: z.string().date(),
    openingCashMinor: z.number().int().min(0),
    cashWithdrawnMinor: z.number().int().min(0).optional(),
    actualCashMinor: z.number().int().min(0),
    varianceNote: z.string().max(500).optional(),
  }),
  handler: async (ctx, input) => {
    const cashWithdrawnMinor = input.cashWithdrawnMinor ?? 0;
    const [cashSales, cashRefunds, cashExpenses] = await Promise.all([
      cashSalesForDay(ctx, input.locationId, input.date),
      cashRefundsForDay(ctx, input.locationId, input.date),
      cashExpensesForDay(ctx, input.locationId, input.date),
    ]);
    const expectedCashMinor = input.openingCashMinor + cashSales - cashRefunds - cashExpenses - cashWithdrawnMinor;
    const varianceMinor = input.actualCashMinor - expectedCashMinor;
    if (varianceMinor !== 0 && !input.varianceNote) {
      throw new ValidationError("E_VALIDATION: a variance requires an explanation (varianceNote)");
    }

    const record = await ctx.tx.dailyCashReconciliation.upsert({
      where: {
        tenantId_locationId_date: { tenantId: ctx.actor.tenantId, locationId: input.locationId, date: new Date(input.date) },
      },
      create: {
        tenantId: ctx.actor.tenantId,
        locationId: input.locationId,
        date: new Date(input.date),
        openingCashMinor: input.openingCashMinor,
        cashWithdrawnMinor,
        actualCashMinor: input.actualCashMinor,
        varianceNote: input.varianceNote ?? null,
        recordedById: ctx.actor.userId,
      },
      update: {
        openingCashMinor: input.openingCashMinor,
        cashWithdrawnMinor,
        actualCashMinor: input.actualCashMinor,
        varianceNote: input.varianceNote ?? null,
        version: { increment: 1 },
      },
    });
    return {
      result: { id: record.id, expectedCashMinor, varianceMinor },
      events: [{ name: "verity.finance.cash_reconciled", entityId: record.id, payload: { varianceMinor } }],
    };
  },
};

async function cashSalesForDay(
  ctx: { tx: import("@/server/platform/tenancy").TenantScopedClient },
  locationId: string,
  date: string,
): Promise<number> {
  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(`${date}T23:59:59.999Z`);
  const payments = await ctx.tx.payment.findMany({
    where: {
      method: "cash",
      createdAt: { gte: dayStart, lte: dayEnd },
      bill: { locationId },
    },
    select: { amountMinor: true },
  });
  return payments.reduce((sum, p) => sum + p.amountMinor, 0);
}

/** Cash handed back to guests that day: it left the drawer, so it is not there to count. */
async function cashRefundsForDay(
  ctx: { tx: import("@/server/platform/tenancy").TenantScopedClient },
  locationId: string,
  date: string,
): Promise<number> {
  const rows = await ctx.tx.billRefund.findMany({
    where: {
      method: "cash",
      createdAt: { gte: new Date(`${date}T00:00:00.000Z`), lte: new Date(`${date}T23:59:59.999Z`) },
      bill: { locationId },
    },
    select: { amountMinor: true },
  });
  return rows.reduce((sum, r) => sum + r.amountMinor, 0);
}

async function cashExpensesForDay(
  ctx: { tx: import("@/server/platform/tenancy").TenantScopedClient },
  locationId: string,
  date: string,
): Promise<number> {
  const rows = await ctx.tx.expense.findMany({
    where: { locationId, paymentMethod: "Cash", status: "Approved", expenseDate: new Date(date) },
    select: { amountMinor: true },
  });
  return rows.reduce((sum, r) => sum + r.amountMinor, 0);
}

export const getOutletPnL: QueryDefinition<
  { locationId: string; fromDate: string; toDate: string },
  {
    revenueMinor: number;
    refundsMinor: number;
    cogsMinor: number;
    cogsIsApproximate: true;
    grossProfitMinor: number;
    expensesByCategory: Array<{ category: ExpenseCategory; amountMinor: number }>;
    totalExpensesMinor: number;
    operatingContributionMinor: number;
    /** Null when the viewer lacks Read on compensation: the line is hidden, not zero. */
    labour: OutletLabour | null;
    /** Operating contribution less labour; null whenever `labour` is. */
    contributionAfterLabourMinor: number | null;
    note: string;
  }
> = {
  key: "verity.finance.get_outlet_pnl",
  entity: ENTITY_EXPENSE,
  input: z.object({ locationId: z.string().uuid(), fromDate: z.string().date(), toDate: z.string().date() }),
  handler: async (ctx, input) => {
    const bills = await ctx.tx.bill.findMany({
      where: {
        locationId: input.locationId,
        state: "settled",
        settledAt: { gte: new Date(input.fromDate), lte: new Date(`${input.toDate}T23:59:59.999Z`) },
      },
      select: { totalMinor: true },
    });
    const refunds = await ctx.tx.billRefund.findMany({
      where: {
        bill: { locationId: input.locationId },
        createdAt: { gte: new Date(input.fromDate), lte: new Date(`${input.toDate}T23:59:59.999Z`) },
      },
      select: { amountMinor: true },
    });
    const refundsMinor = refunds.reduce((sum, r) => sum + r.amountMinor, 0);
    // Net of refunds issued in the window, whichever day the bill was settled.
    const revenueMinor = bills.reduce((sum, b) => sum + b.totalMinor, 0) - refundsMinor;

    const consumption = await ctx.tx.inventoryStockMovement.findMany({
      where: {
        locationId: input.locationId,
        kind: "Issue",
        movedAt: { gte: new Date(input.fromDate), lte: new Date(`${input.toDate}T23:59:59.999Z`) },
      },
      select: { itemId: true, qty: true },
    });
    const itemIds = [...new Set(consumption.map((c) => c.itemId))];
    const items = await ctx.tx.inventoryItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, avgUnitCostPaise: true },
    });
    const costById = new Map(items.map((i) => [i.id, i.avgUnitCostPaise ?? 0]));
    const cogsMinor = Math.round(
      consumption.reduce((sum, c) => sum + Math.abs(c.qty) * (costById.get(c.itemId) ?? 0), 0),
    );

    const expenses = await ctx.tx.expense.findMany({
      where: {
        locationId: input.locationId,
        status: "Approved",
        expenseDate: { gte: new Date(input.fromDate), lte: new Date(input.toDate) },
      },
      select: { category: true, amountMinor: true },
    });
    const byCategory = new Map<string, number>();
    for (const e of expenses) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amountMinor);
    const totalExpensesMinor = expenses.reduce((sum, e) => sum + e.amountMinor, 0);

    const grossProfitMinor = revenueMinor - cogsMinor;
    const operatingContributionMinor = grossProfitMinor - totalExpensesMinor;

    // Labour is an aggregate for the outlet, never a per-person figure, and only
    // for roles that may read compensation.
    let labour: OutletLabour | null = null;
    if (await hasPermission(ctx.tx, ctx.actor.roleId, "Read", COMPENSATION_ENTITY)) {
      const from = new Date(input.fromDate);
      const to = new Date(input.toDate);
      const windowDays = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
      const people = await ctx.tx.hrEmployee.findMany({
        where: { active: true, monthlySalaryMinor: { not: null } },
        select: {
          monthlySalaryMinor: true,
          active: true,
          shifts: { where: { date: { gte: from, lte: to } }, select: { locationId: true, startTime: true, endTime: true } },
        },
      });
      labour = outletLabour(people, input.locationId, windowDays);
    }

    return {
      revenueMinor,
      refundsMinor,
      cogsMinor,
      cogsIsApproximate: true,
      grossProfitMinor,
      expensesByCategory: [...byCategory.entries()].map(([category, amountMinor]) => ({
        category: category as ExpenseCategory,
        amountMinor,
      })),
      totalExpensesMinor,
      operatingContributionMinor,
      labour,
      contributionAfterLabourMinor: labour ? operatingContributionMinor - labour.labourMinor : null,
      note:
        "COGS is valued at ingredients' current average cost, not the cost at the moment of consumption. " +
        "Labour, where shown, is monthly salary prorated to these dates and split between outlets by shift hours; " +
        "it is an estimate and leaves out anyone with no shifts in the period.",
    };
  },
};

/* ============================== registration ============================== */

export function registerFinanceCapability(): void {
  registerContribution({
    capabilityId: FINANCE_CAPABILITY,
    navigation: [
      {
        href: "/expenses",
        label: "Expenses",
        group: "Money",
        order: 50,
        icon: "wallet",
        requiresEntity: ENTITY_EXPENSE,
        shells: ["platform", "operations"],
      },
      {
        href: "/cash-reconciliation",
        label: "Cash reconciliation",
        group: "Money",
        order: 52,
        icon: "wallet",
        requiresEntity: ENTITY_CASH_RECONCILIATION,
        shells: ["platform", "operations"],
      },
      {
        href: "/outlet-pnl",
        label: "Outlet P&L",
        group: "Money",
        order: 53,
        icon: "finance",
        requiresEntity: ENTITY_EXPENSE,
        shells: ["platform", "operations"],
      },
    ],
  });
  registerCommand(recordExpense);
  registerCommand(decideExpense);
  registerCommand(recordCashReconciliation);
  registerQuery(listExpenses);
  registerQuery(getOutletPnL);
}
