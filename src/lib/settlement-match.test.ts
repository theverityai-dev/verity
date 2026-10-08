import { describe, expect, it } from "vitest";
import { matchSettlement, normalizeRef, parseCsv, parseMoneyToMinor, type PlatformBill } from "./settlement-match";

const bill = (ref: string, totalMinor: number): PlatformBill => ({ ref, billId: `bill-${ref}`, label: `Zomato #${ref}`, totalMinor });

describe("money and references", () => {
  it("reads rupee amounts in the shapes a payout file uses", () => {
    expect(parseMoneyToMinor("₹1,234.50")).toBe(123_450);
    expect(parseMoneyToMinor("  840 ")).toBe(84_000);
    expect(parseMoneyToMinor("(120.00)")).toBe(-12_000);
    expect(parseMoneyToMinor("-5.5")).toBe(-550);
    expect(parseMoneyToMinor("Rs. 99")).toBe(9_900);
    expect(parseMoneyToMinor("n/a")).toBeNaN();
    expect(parseMoneyToMinor("")).toBeNaN();
  });

  it("ignores case, spaces and a leading hash in order numbers", () => {
    expect(normalizeRef(" #ZM 123 ab ")).toBe("zm123ab");
  });
});

describe("csv", () => {
  it("handles quotes, embedded commas and newlines, doubled quotes, CRLF and a BOM", () => {
    const rows = parseCsv('﻿Order,Note,Payout\r\n1001,"Cold, no ""onion""",420.00\r\n1002,"two\nlines",300\r\n');
    expect(rows).toEqual([
      ["Order", "Note", "Payout"],
      ["1001", 'Cold, no "onion"', "420.00"],
      ["1002", "two\nlines", "300"],
    ]);
  });

  it("detects a semicolon or tab delimiter from the header", () => {
    expect(parseCsv("Order;Payout\n1;2")).toEqual([["Order", "Payout"], ["1", "2"]]);
    expect(parseCsv("Order\tPayout\n1\t2")).toEqual([["Order", "Payout"], ["1", "2"]]);
  });

  it("skips blank lines", () => {
    expect(parseCsv("a,b\n\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("settlement matching", () => {
  // A 25% commission: Rs 400 bill is expected to pay out Rs 300.
  const bills = [bill("1001", 40_000), bill("1002", 20_000), bill("1003", 10_000), bill("1004", 8_000)];

  it("sorts payouts into matched, short and over, and finds the unmatched on both sides", () => {
    const report = matchSettlement({
      commissionBp: 2_500,
      bills,
      rows: [
        { ref: "#1001", amountMinor: 30_000 }, // exactly expected
        { ref: "1002", amountMinor: 14_000 }, // expected 15,000: Rs 10 short
        { ref: "1003", amountMinor: 8_500 }, // expected 7,500: Rs 10 over
        { ref: "9999", amountMinor: 5_000 }, // not our order
      ],
    });
    expect(report.matched.map((m) => m.ref)).toEqual(["1001"]);
    expect(report.short.map((m) => [m.ref, m.differenceMinor])).toEqual([["1002", -1_000]]);
    expect(report.over.map((m) => [m.ref, m.differenceMinor])).toEqual([["1003", 1_000]]);
    expect(report.unmatchedRows).toEqual([{ ref: "9999", amountMinor: 5_000 }]);
    expect(report.missingOrders.map((b) => b.ref)).toEqual(["1004"]);
    expect(report.totals).toEqual({ expectedMinor: 52_500, receivedMinor: 52_500, shortByMinor: 1_000 });
  });

  it("treats a difference within a rupee as matched", () => {
    const report = matchSettlement({ commissionBp: 0, bills: [bill("1", 10_000)], rows: [{ ref: "1", amountMinor: 9_950 }] });
    expect(report.matched).toHaveLength(1);
    expect(report.short).toHaveLength(0);
  });

  it("sums several rows for one order, so an adjustment nets against the payout", () => {
    const report = matchSettlement({
      commissionBp: 0,
      bills: [bill("1", 10_000)],
      rows: [{ ref: "1", amountMinor: 10_000 }, { ref: "1", amountMinor: -2_000 }],
    });
    expect(report.short.map((m) => m.differenceMinor)).toEqual([-2_000]);
  });

  it("an empty file leaves every order missing and invents nothing", () => {
    const report = matchSettlement({ commissionBp: 2_500, bills, rows: [] });
    expect(report.missingOrders).toHaveLength(4);
    expect(report.matched.length + report.short.length + report.over.length + report.unmatchedRows.length).toBe(0);
  });
});
