/**
 * Profit and loss and balance sheet, as pure functions over ledger totals.
 *
 * Authority: `clients/dsew/reference-parity/accounting.md` §7 item 2. The query layer
 * sums `JournalLine` per account and hands the totals here; nothing in this file
 * touches the database, so the arithmetic is testable on its own.
 *
 * Basis: accrual, meaning whatever is posted to the ledger on the entry's posted date.
 * Money is integer minor units (paise). A statement is only as complete as the ledger:
 * documents that are not posted to it (see ADR-044) are not in these figures.
 */

export type AccountType = "Asset" | "Liability" | "Equity" | "Income" | "Expense";

export type AccountTotals = {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  debitMinor: number;
  creditMinor: number;
};

export type StatementLine = { accountId: string; code: string; name: string; amountMinor: number };

/** Debit-normal accounts (assets, expenses) show debits minus credits; the rest show credits minus debits. */
export function naturalBalance(a: Pick<AccountTotals, "type" | "debitMinor" | "creditMinor">): number {
  return a.type === "Asset" || a.type === "Expense" ? a.debitMinor - a.creditMinor : a.creditMinor - a.debitMinor;
}

function linesOf(rows: AccountTotals[], type: AccountType): StatementLine[] {
  return rows
    .filter((r) => r.type === type)
    .map((r) => ({ accountId: r.accountId, code: r.code, name: r.name, amountMinor: naturalBalance(r) }))
    .filter((l) => l.amountMinor !== 0)
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

const sum = (lines: StatementLine[]) => lines.reduce((total, l) => total + l.amountMinor, 0);

export type ProfitAndLoss = {
  income: StatementLine[];
  expenses: StatementLine[];
  totalIncomeMinor: number;
  totalExpensesMinor: number;
  /** Income less expenses. Negative is a loss. */
  netMinor: number;
};

export function profitAndLoss(rows: AccountTotals[]): ProfitAndLoss {
  const income = linesOf(rows, "Income");
  const expenses = linesOf(rows, "Expense");
  const totalIncomeMinor = sum(income);
  const totalExpensesMinor = sum(expenses);
  return { income, expenses, totalIncomeMinor, totalExpensesMinor, netMinor: totalIncomeMinor - totalExpensesMinor };
}

export type BalanceSheet = {
  assets: StatementLine[];
  liabilities: StatementLine[];
  equity: StatementLine[];
  totalAssetsMinor: number;
  totalLiabilitiesMinor: number;
  totalEquityMinor: number;
  /**
   * Income less expenses to date that no closing entry has moved into equity. Shown as its own
   * line so the sheet balances without the books needing a year-end close first.
   */
  currentEarningsMinor: number;
  /** Assets less liabilities, equity and current earnings. Zero when the books balance. */
  differenceMinor: number;
  balanced: boolean;
};

export function balanceSheet(rows: AccountTotals[]): BalanceSheet {
  const assets = linesOf(rows, "Asset");
  const liabilities = linesOf(rows, "Liability");
  const equity = linesOf(rows, "Equity");
  const currentEarningsMinor = profitAndLoss(rows).netMinor;
  const totalAssetsMinor = sum(assets);
  const totalLiabilitiesMinor = sum(liabilities);
  const totalEquityMinor = sum(equity) + currentEarningsMinor;
  const differenceMinor = totalAssetsMinor - totalLiabilitiesMinor - totalEquityMinor;
  return {
    assets,
    liabilities,
    equity,
    totalAssetsMinor,
    totalLiabilitiesMinor,
    totalEquityMinor,
    currentEarningsMinor,
    differenceMinor,
    balanced: differenceMinor === 0,
  };
}

/** `YYYY-MM-DD` to the UTC instant that starts that day. Returns null for anything else. */
export function startOfDayUtc(iso: string | undefined): Date | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The first instant after the given day, so a range can be written `postedAt < endExclusive`. */
export function endExclusiveUtc(iso: string | undefined): Date | null {
  const start = startOfDayUtc(iso);
  return start ? new Date(start.getTime() + 24 * 60 * 60 * 1000) : null;
}
