import { describe, expect, it } from "vitest";
import { describeSource, overlappingRules, resolvePrice, type PriceRule } from "./menu-price";

const rule = (over: Partial<PriceRule> & { id: string }): PriceRule => ({
  locationId: null,
  channel: null,
  priceMinor: 10_000,
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  ...over,
});

const ctx = { locationId: "dc", channel: "dine_in", day: "2026-10-09" };

describe("resolvePrice", () => {
  it("keeps the item's own price when no rule applies", () => {
    expect(resolvePrice(8_000, [], ctx)).toEqual({ priceMinor: 8_000, ruleId: null, source: "base" });
    expect(resolvePrice(8_000, [rule({ id: "a", channel: "delivery_platform", priceMinor: 9_500 })], ctx).source).toBe("base");
  });

  it("uses a channel price for that channel only", () => {
    const zomato = rule({ id: "z", channel: "delivery_platform", priceMinor: 9_500 });
    expect(resolvePrice(8_000, [zomato], { ...ctx, channel: "delivery_platform" })).toEqual({ priceMinor: 9_500, ruleId: "z", source: "channel" });
    expect(resolvePrice(8_000, [zomato], ctx).priceMinor).toBe(8_000);
  });

  it("prefers outlet and channel over outlet over channel over a dated change", () => {
    const rules = [
      rule({ id: "dated", priceMinor: 8_100 }),
      rule({ id: "chan", channel: "dine_in", priceMinor: 8_200 }),
      rule({ id: "outlet", locationId: "dc", priceMinor: 8_300 }),
      rule({ id: "both", locationId: "dc", channel: "dine_in", priceMinor: 8_400 }),
    ];
    expect(resolvePrice(8_000, rules, ctx)).toMatchObject({ ruleId: "both", source: "outlet_channel", priceMinor: 8_400 });
    expect(resolvePrice(8_000, rules.filter((r) => r.id !== "both"), ctx)).toMatchObject({ ruleId: "outlet", source: "outlet" });
    expect(resolvePrice(8_000, rules.filter((r) => r.id === "chan" || r.id === "dated"), ctx)).toMatchObject({ ruleId: "chan", source: "channel" });
    expect(resolvePrice(8_000, [rules[0]!], ctx)).toMatchObject({ ruleId: "dated", source: "dated" });
  });

  it("ignores another outlet's rule", () => {
    expect(resolvePrice(8_000, [rule({ id: "x", locationId: "ggn", priceMinor: 9_900 })], ctx).source).toBe("base");
  });

  it("honours the dates, inclusive at both ends", () => {
    const r = rule({ id: "w", priceMinor: 9_000, effectiveFrom: "2026-10-01", effectiveTo: "2026-10-09" });
    expect(resolvePrice(8_000, [r], { ...ctx, day: "2026-09-30" }).source).toBe("base");
    expect(resolvePrice(8_000, [r], { ...ctx, day: "2026-10-01" }).priceMinor).toBe(9_000);
    expect(resolvePrice(8_000, [r], { ...ctx, day: "2026-10-09" }).priceMinor).toBe(9_000);
    expect(resolvePrice(8_000, [r], { ...ctx, day: "2026-10-10" }).source).toBe("base");
  });

  it("lets the latest start win a tie, whatever order the rules arrive in", () => {
    const older = rule({ id: "a", priceMinor: 8_500, effectiveFrom: "2026-03-01" });
    const newer = rule({ id: "b", priceMinor: 8_800, effectiveFrom: "2026-06-01" });
    expect(resolvePrice(8_000, [older, newer], ctx).ruleId).toBe("b");
    expect(resolvePrice(8_000, [newer, older], ctx).ruleId).toBe("b");
  });
});

describe("describeSource and overlaps", () => {
  it("says where a price came from, and stays silent for the base price", () => {
    expect(describeSource("base", {})).toBeNull();
    expect(describeSource("channel", { channel: "Zomato" })).toBe("Zomato price");
    expect(describeSource("outlet", { outlet: "Defence Colony" })).toBe("Defence Colony price");
    expect(describeSource("outlet_channel", { outlet: "DC", channel: "Zomato" })).toBe("DC Zomato price");
  });

  it("flags two rules of the same scope whose days overlap", () => {
    const a = rule({ id: "a", channel: "qr", effectiveFrom: "2026-01-01", effectiveTo: "2026-06-30" });
    const b = rule({ id: "b", channel: "qr", effectiveFrom: "2026-06-01" });
    const c = rule({ id: "c", channel: "qr", effectiveFrom: "2026-07-01", effectiveTo: "2026-08-01" });
    expect(overlappingRules([a, b, c])).toEqual([["a", "b"], ["b", "c"]]);
    expect(overlappingRules([a, rule({ id: "d", channel: "phone" })])).toEqual([]);
  });
});
