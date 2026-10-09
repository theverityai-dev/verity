import { describe, expect, it } from "vitest";
import { expenseShareInWindow } from "./expense-proration";

const monthly = { amountMinor: 3_000_000, expenseDate: "2026-09-03", periodFrom: "2026-09-01", periodTo: "2026-09-30" };

describe("expenseShareInWindow", () => {
  it("counts a one-off expense in full when its date is inside the window, and not at all outside", () => {
    const e = { amountMinor: 50_000, expenseDate: "2026-09-10", periodFrom: null, periodTo: null };
    expect(expenseShareInWindow(e, "2026-09-01", "2026-09-30")).toBe(50_000);
    expect(expenseShareInWindow(e, "2026-09-10", "2026-09-10")).toBe(50_000);
    expect(expenseShareInWindow(e, "2026-09-11", "2026-09-30")).toBe(0);
  });

  it("spreads a period expense evenly across its days", () => {
    // 30 days, so 10 days is a third.
    expect(expenseShareInWindow(monthly, "2026-09-01", "2026-09-10")).toBe(1_000_000);
    expect(expenseShareInWindow(monthly, "2026-09-01", "2026-09-30")).toBe(3_000_000);
  });

  it("ignores when it was paid: the share depends on the days it covers", () => {
    const paidLate = { ...monthly, expenseDate: "2026-10-05" };
    expect(expenseShareInWindow(paidLate, "2026-09-01", "2026-09-15")).toBe(1_500_000);
  });

  it("counts only the overlap when the window straddles the period", () => {
    // 25 to 30 Sept is 6 days of the 30; the window runs on into October.
    expect(expenseShareInWindow(monthly, "2026-09-25", "2026-10-31")).toBe(600_000);
    expect(expenseShareInWindow(monthly, "2026-10-01", "2026-10-31")).toBe(0);
  });

  it("rounds each expense to the paisa", () => {
    const odd = { amountMinor: 100, expenseDate: "2026-09-01", periodFrom: "2026-09-01", periodTo: "2026-09-03" };
    expect(expenseShareInWindow(odd, "2026-09-01", "2026-09-01")).toBe(33);
  });
});
