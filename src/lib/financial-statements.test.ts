import { describe, expect, it } from "vitest";
import {
  balanceSheet,
  endExclusiveUtc,
  naturalBalance,
  profitAndLoss,
  startOfDayUtc,
  type AccountTotals,
} from "./financial-statements";

const acct = (code: string, type: AccountTotals["type"], debitMinor: number, creditMinor: number): AccountTotals => ({
  accountId: `id-${code}`,
  code,
  name: `Account ${code}`,
  type,
  debitMinor,
  creditMinor,
});

// Owner puts in 100,000; buys stock for 30,000 cash; sells for 50,000 cash; pays 10,000 rent.
const books: AccountTotals[] = [
  acct("1000", "Asset", 100_000 + 50_000 - 30_000 - 10_000, 0), // cash 110,000
  acct("1200", "Asset", 30_000, 0), // stock
  acct("3000", "Equity", 0, 100_000),
  acct("4000", "Income", 0, 50_000),
  acct("5100", "Expense", 10_000, 0),
];

describe("natural balance", () => {
  it("shows debits minus credits for assets and expenses, the reverse for the rest", () => {
    expect(naturalBalance(acct("1", "Asset", 500, 200))).toBe(300);
    expect(naturalBalance(acct("5", "Expense", 500, 200))).toBe(300);
    expect(naturalBalance(acct("2", "Liability", 200, 500))).toBe(300);
    expect(naturalBalance(acct("4", "Income", 200, 500))).toBe(300);
    expect(naturalBalance(acct("3", "Equity", 200, 500))).toBe(300);
  });
});

describe("profit and loss", () => {
  it("is income less expenses", () => {
    const p = profitAndLoss(books);
    expect(p.totalIncomeMinor).toBe(50_000);
    expect(p.totalExpensesMinor).toBe(10_000);
    expect(p.netMinor).toBe(40_000);
  });

  it("reports a loss as a negative figure", () => {
    expect(profitAndLoss([acct("4000", "Income", 0, 1_000), acct("5000", "Expense", 4_000, 0)]).netMinor).toBe(-3_000);
  });

  it("leaves out accounts with nothing in them and sorts by code as numbers", () => {
    const p = profitAndLoss([acct("5100", "Expense", 1, 0), acct("5020", "Expense", 2, 0), acct("5300", "Expense", 0, 0)]);
    expect(p.expenses.map((l) => l.code)).toEqual(["5020", "5100"]);
  });

  it("treats a refund against income as a reduction", () => {
    expect(profitAndLoss([acct("4000", "Income", 2_000, 10_000)]).totalIncomeMinor).toBe(8_000);
  });
});

describe("balance sheet", () => {
  it("balances once current earnings are included, with no closing entry", () => {
    const b = balanceSheet(books);
    expect(b.totalAssetsMinor).toBe(140_000);
    expect(b.currentEarningsMinor).toBe(40_000);
    expect(b.totalEquityMinor).toBe(140_000);
    expect(b.differenceMinor).toBe(0);
    expect(b.balanced).toBe(true);
  });

  it("shows the gap when the ledger itself does not balance", () => {
    const b = balanceSheet([acct("1000", "Asset", 1_000, 0), acct("3000", "Equity", 0, 900)]);
    expect(b.balanced).toBe(false);
    expect(b.differenceMinor).toBe(100);
  });

  it("includes liabilities", () => {
    const b = balanceSheet([acct("1000", "Asset", 500, 0), acct("2000", "Liability", 0, 500)]);
    expect(b.totalLiabilitiesMinor).toBe(500);
    expect(b.balanced).toBe(true);
  });

  it("an empty ledger balances at zero", () => {
    expect(balanceSheet([]).balanced).toBe(true);
  });
});

describe("date helpers", () => {
  it("parses a plain date and rejects anything else", () => {
    expect(startOfDayUtc("2026-10-16")?.toISOString()).toBe("2026-10-16T00:00:00.000Z");
    expect(startOfDayUtc("16/10/2026")).toBeNull();
    expect(startOfDayUtc(undefined)).toBeNull();
    expect(startOfDayUtc("2026-13-45")).toBeNull();
  });

  it("makes the end of a range exclusive so the whole last day counts", () => {
    expect(endExclusiveUtc("2026-10-31")?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
});
