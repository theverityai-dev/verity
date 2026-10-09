import { describe, expect, it } from "vitest";
import {
  baseline,
  groupBills,
  groupItems,
  hourLabel,
  median,
  serviceDayKey,
  totalsOf,
  type ReportBill,
} from "./sales-report";

const zone = { timeZone: "Asia/Kolkata", startMinute: 300 };

function bill(iso: string, over: Partial<ReportBill> = {}): ReportBill {
  return {
    settledAt: new Date(iso),
    channel: "dine_in",
    takenByUserId: "u1",
    covers: 2,
    totalMinor: 100_000,
    discountMinor: 0,
    taxMinor: 4_762,
    refundedMinor: 0,
    lines: [{ name: "Seekh kebab", qty: 2, unitPriceMinor: 20_000 }],
    ...over,
  };
}

describe("service day", () => {
  it("puts a bill settled at 00:40 in the previous service day, once", () => {
    // 00:40 IST on 10 Oct is 19:10 UTC on 9 Oct.
    expect(serviceDayKey(new Date("2026-10-09T19:10:00Z"), zone)).toBe("2026-10-09");
    // 05:00 IST on 10 Oct starts the 10 Oct service day.
    expect(serviceDayKey(new Date("2026-10-09T23:30:00Z"), zone)).toBe("2026-10-10");
    // 04:59 IST on 10 Oct is still the 9 Oct service day.
    expect(serviceDayKey(new Date("2026-10-09T23:29:00Z"), zone)).toBe("2026-10-09");
  });
});

describe("groupBills", () => {
  const bills = [
    bill("2026-10-09T13:00:00Z", { totalMinor: 120_000, covers: 3 }), // 18:30 IST, 9 Oct
    bill("2026-10-09T14:00:00Z", { totalMinor: 80_000, covers: 1, refundedMinor: 20_000, channel: "delivery_platform", takenByUserId: "u2" }), // 19:30 IST
    bill("2026-10-09T19:10:00Z", { totalMinor: 50_000, covers: 2 }), // 00:40 IST on 10 Oct => service day 9 Oct
    bill("2026-10-10T13:00:00Z", { totalMinor: 70_000, covers: 2 }), // 10 Oct
  ];

  it("groups by service day with no overlap and counts the late-night bill once", () => {
    const rows = groupBills(bills, "day", zone);
    expect(rows.map((r) => [r.key, r.bills, r.grossMinor])).toEqual([
      ["2026-10-09", 3, 250_000],
      ["2026-10-10", 1, 70_000],
    ]);
  });

  it("nets refunds against the bill they reverse and averages per bill", () => {
    const day = groupBills(bills, "day", zone)[0]!;
    expect(day.refundedMinor).toBe(20_000);
    expect(day.netMinor).toBe(230_000);
    expect(day.avgBillMinor).toBe(Math.round(250_000 / 3));
  });

  it("groups by hour, ordered from the day start", () => {
    const rows = groupBills(bills, "hour", zone);
    expect(rows.map((r) => r.key)).toEqual(["18", "19", "00"]);
    expect(rows[0]!.label).toBe(hourLabel(18));
  });

  it("groups by channel and staff using the supplied labels", () => {
    const labels = new Map([["delivery_platform", "Delivery platform"], ["u2", "Asha"]]);
    const channels = groupBills(bills, "channel", zone, labels);
    expect(channels.find((r) => r.key === "delivery_platform")!.label).toBe("Delivery platform");
    const staff = groupBills(bills, "staff", zone, labels);
    expect(staff.find((r) => r.key === "u2")!.label).toBe("Asha");
    expect(staff[0]!.grossMinor).toBeGreaterThanOrEqual(staff[1]!.grossMinor);
  });

  it("totals the rows", () => {
    const total = totalsOf(groupBills(bills, "day", zone));
    expect(total.bills).toBe(4);
    expect(total.grossMinor).toBe(320_000);
    expect(total.netMinor).toBe(300_000);
  });

  it("groups by month", () => {
    const rows = groupBills(bills, "month", zone);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.key).toBe("2026-10");
  });
});

describe("groupItems", () => {
  it("sums quantity and charged value per item, largest first", () => {
    const rows = groupItems([
      bill("2026-10-09T13:00:00Z", { lines: [{ name: "Naan", qty: 4, unitPriceMinor: 5_000 }, { name: "Dal", qty: 1, unitPriceMinor: 40_000 }] }),
      bill("2026-10-09T14:00:00Z", { lines: [{ name: "Naan", qty: 2, unitPriceMinor: 5_000 }] }),
    ]);
    expect(rows.map((r) => [r.label, r.qty, r.revenueMinor])).toEqual([
      ["Dal", 1, 40_000],
      ["Naan", 6, 30_000],
    ]);
  });
});

describe("median and baseline", () => {
  it("takes the middle value, averaging the middle pair", () => {
    expect(median([])).toBe(0);
    expect(median([5])).toBe(5);
    expect(median([1, 9, 5])).toBe(5);
    expect(median([2, 4])).toBe(3);
  });

  it("uses the same weekday and nearby hours of earlier days only", () => {
    // "Now" is Friday 9 Oct 2026, 19:00 IST (13:30 UTC).
    const now = new Date("2026-10-09T13:30:00Z");
    const history = [
      { settledAt: new Date("2026-10-02T13:30:00Z"), totalMinor: 100_000, covers: 4 }, // Fri 19:00
      { settledAt: new Date("2026-10-02T14:00:00Z"), totalMinor: 50_000, covers: 2 }, // Fri 19:30
      { settledAt: new Date("2026-09-25T13:30:00Z"), totalMinor: 90_000, covers: 3 }, // Fri 19:00
      { settledAt: new Date("2026-10-03T13:30:00Z"), totalMinor: 999_999, covers: 9 }, // Saturday: ignored
      { settledAt: new Date("2026-10-02T05:30:00Z"), totalMinor: 999_999, covers: 9 }, // Fri 11:00: wrong hour
      { settledAt: new Date("2026-10-09T13:00:00Z"), totalMinor: 999_999, covers: 9 }, // today: ignored
    ];
    const b = baseline(history, now, zone);
    expect(b.sampleDays).toBe(2);
    expect(b.medianSalesMinor).toBe(Math.round((150_000 + 90_000) / 2));
    expect(b.medianCovers).toBe(Math.round((6 + 3) / 2));
  });
});
