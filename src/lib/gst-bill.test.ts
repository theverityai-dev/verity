import { describe, expect, it } from "vitest";
import {
  allocateProportionally,
  computeBill,
  financialYearOf,
  formatBillNumber,
  formatCreditNoteNumber,
  reverseTax,
  splitRate,
} from "./gst-bill";

describe("allocateProportionally", () => {
  it("always adds back to the total, giving leftovers to the largest remainder", () => {
    expect(allocateProportionally(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateProportionally(10, [3, 7])).toEqual([3, 7]);
    for (const total of [0, 1, 7, 99, 12345]) {
      const parts = allocateProportionally(total, [5, 13, 2, 0, 9]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
  it("gives nothing to nobody", () => {
    expect(allocateProportionally(50, [0, 0])).toEqual([0, 0]);
    expect(allocateProportionally(0, [4, 6])).toEqual([0, 0]);
  });
});

describe("splitRate", () => {
  it("halves a rate and gives the odd basis point to SGST", () => {
    expect(splitRate(500)).toEqual({ cgstBp: 250, sgstBp: 250 });
    expect(splitRate(1800)).toEqual({ cgstBp: 900, sgstBp: 900 });
    expect(splitRate(501)).toEqual({ cgstBp: 250, sgstBp: 251 });
  });
});

describe("computeBill", () => {
  it("matches the single-rate bill the system produced before (5%, one line)", () => {
    // 660 rupees at 2.5% + 2.5%, rounded to the rupee: the figures the original dine-in test asserts.
    const bill = computeBill({ lines: [{ amountMinor: 66_000, rateBp: 500 }], discountMinor: 0, serviceChargeBp: 0, taxFree: false });
    expect(bill.cgstMinor).toBe(1_650);
    expect(bill.sgstMinor).toBe(1_650);
    expect(bill.totalMinor).toBe(69_300);
    expect(bill.taxLines).toHaveLength(1);
  });

  it("bills two rates on one bill, each taxed at its own rate", () => {
    // Food 1000 at 5%, a soft drink 200 at 18%.
    const bill = computeBill({
      lines: [{ amountMinor: 100_000, rateBp: 500 }, { amountMinor: 20_000, rateBp: 1800 }],
      discountMinor: 0,
      serviceChargeBp: 0,
      taxFree: false,
    });
    expect(bill.taxLines.map((l) => [l.rateBp, l.cgstMinor, l.sgstMinor])).toEqual([[500, 2_500, 2_500], [1800, 1_800, 1_800]]);
    expect(bill.cgstMinor).toBe(4_300);
    expect(bill.totalMinor).toBe(Math.round((120_000 + 8_600) / 100) * 100);
    expect(bill.roundingMinor).toBe(bill.totalMinor - (120_000 + 8_600));
  });

  it("shares a discount across the rates in proportion, to the paisa", () => {
    const bill = computeBill({
      lines: [{ amountMinor: 100_000, rateBp: 500 }, { amountMinor: 50_000, rateBp: 1800 }],
      discountMinor: 15_001,
      serviceChargeBp: 0,
      taxFree: false,
    });
    expect(bill.taxLines.reduce((s, l) => s + l.discountMinor, 0)).toBe(15_001);
    expect(bill.taxableMinor).toBe(150_000 - 15_001);
    // The bigger group carries the bigger share.
    expect(bill.taxLines[0]!.discountMinor).toBeGreaterThan(bill.taxLines[1]!.discountMinor);
  });

  it("never discounts more than the bill", () => {
    const bill = computeBill({ lines: [{ amountMinor: 10_000, rateBp: 500 }], discountMinor: 99_999, serviceChargeBp: 0, taxFree: false });
    expect(bill.discountMinor).toBe(10_000);
    expect(bill.totalMinor).toBe(0);
  });

  it("adds a service charge on what remains after the discount and taxes it with the food", () => {
    // 1000 at 5%, 10% service charge: 100, taxed at 5% as part of the supply.
    const bill = computeBill({ lines: [{ amountMinor: 100_000, rateBp: 500 }], discountMinor: 0, serviceChargeBp: 1000, taxFree: false });
    expect(bill.serviceChargeMinor).toBe(10_000);
    expect(bill.taxLines[0]!.taxableMinor).toBe(110_000);
    expect(bill.cgstMinor).toBe(2_750);
    // With a 20% discount first: the charge is 10% of 800.
    const discounted = computeBill({ lines: [{ amountMinor: 100_000, rateBp: 500 }], discountMinor: 20_000, serviceChargeBp: 1000, taxFree: false });
    expect(discounted.serviceChargeMinor).toBe(8_000);
  });

  it("apportions a service charge across rates by value, so tax follows the supply", () => {
    const bill = computeBill({
      lines: [{ amountMinor: 80_000, rateBp: 500 }, { amountMinor: 20_000, rateBp: 1800 }],
      discountMinor: 0,
      serviceChargeBp: 1000,
      taxFree: false,
    });
    expect(bill.serviceChargeMinor).toBe(10_000);
    expect(bill.taxLines.map((l) => l.serviceChargeMinor)).toEqual([8_000, 2_000]);
  });

  it("carries no tax at all when the invoice is tax-free (a delivery platform's order)", () => {
    const bill = computeBill({ lines: [{ amountMinor: 45_050, rateBp: 500 }], discountMinor: 0, serviceChargeBp: 0, taxFree: true });
    expect(bill.cgstMinor + bill.sgstMinor).toBe(0);
    expect(bill.totalMinor).toBe(45_100);
    expect(bill.roundingMinor).toBe(50);
  });

  it("is deterministic for any lines: parts always foot to the total", () => {
    for (const discount of [0, 1, 999, 12_345]) {
      const bill = computeBill({
        lines: [
          { amountMinor: 33_333, rateBp: 500 },
          { amountMinor: 11_111, rateBp: 1200 },
          { amountMinor: 22_222, rateBp: 1800 },
        ],
        discountMinor: discount,
        serviceChargeBp: 500,
        taxFree: false,
      });
      expect(bill.taxableMinor + bill.cgstMinor + bill.sgstMinor + bill.roundingMinor).toBe(bill.totalMinor);
      expect(bill.totalMinor % 100).toBe(0);
    }
  });
});

describe("reverseTax", () => {
  const lines = [
    { rateBp: 500, taxableMinor: 100_000, cgstMinor: 2_500, sgstMinor: 2_500 },
    { rateBp: 1800, taxableMinor: 20_000, cgstMinor: 1_800, sgstMinor: 1_800 },
  ];

  it("splits a refund across the rate groups and states the tax in each", () => {
    const total = 105_000 + 23_600;
    const half = reverseTax(lines, total / 2);
    expect(half.reduce((s, l) => s + l.taxableMinor + l.cgstMinor + l.sgstMinor, 0)).toBe(total / 2);
    expect(half[0]!.cgstMinor).toBe(1_250);
    expect(half[1]!.cgstMinor).toBe(900);
  });

  it("reverses the whole tax on a full refund", () => {
    const full = reverseTax(lines, 105_000 + 23_600);
    expect(full.map((l) => [l.taxableMinor, l.cgstMinor, l.sgstMinor])).toEqual([[100_000, 2_500, 2_500], [20_000, 1_800, 1_800]]);
  });

  it("keeps a tax-free bill's refund tax-free", () => {
    const free = reverseTax([{ rateBp: 500, taxableMinor: 45_000, cgstMinor: 0, sgstMinor: 0 }], 10_000);
    expect(free).toEqual([{ rateBp: 500, taxableMinor: 10_000, cgstMinor: 0, sgstMinor: 0 }]);
  });
});

describe("financial year and numbers", () => {
  it("runs April to March in the outlet's own zone", () => {
    expect(financialYearOf(new Date("2026-10-09T12:00:00Z"), "Asia/Kolkata")).toEqual({ period: "2026-27", short: "26-27" });
    expect(financialYearOf(new Date("2027-03-31T12:00:00Z"), "Asia/Kolkata")).toEqual({ period: "2026-27", short: "26-27" });
    expect(financialYearOf(new Date("2027-04-01T00:00:00Z"), "Asia/Kolkata")).toEqual({ period: "2027-28", short: "27-28" });
    // 21:00 UTC on 31 March is already 1 April in India.
    expect(financialYearOf(new Date("2027-03-31T21:00:00Z"), "Asia/Kolkata").short).toBe("27-28");
  });

  it("formats bills and credit notes within sixteen characters", () => {
    expect(formatBillNumber("DC", "26-27", 123)).toBe("DC/26-27/000123");
    expect(formatBillNumber("GGN", "26-27", 999_999)).toHaveLength(16);
    expect(formatCreditNoteNumber("GGN", "26-27", 7)).toBe("CGGN/26-27/00007");
    expect(formatCreditNoteNumber("GGN", "26-27", 7)).toHaveLength(16);
    expect(() => formatBillNumber("GGNX", "26-27", 1)).toThrow(/longer than 16/);
    expect(() => formatCreditNoteNumber("DC", "26-27", 1_000_000)).toThrow(/longer than 16/);
  });
});
