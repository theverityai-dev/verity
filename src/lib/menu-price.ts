/**
 * Which price an item sells at (ADR-043; Task 126 Wave 4). Pure: the caller supplies the
 * rules, the outlet, the channel and the outlet's service day.
 *
 * A rule may name an outlet, a channel, both or neither, and holds for a stretch of
 * days. Of the rules that match, the most specific wins: outlet and channel, then
 * outlet only, then channel only, then a rule naming neither (a dated change to the
 * base price). Within the same specificity the one that started latest wins, then the
 * one that sorts last by id, so the answer never depends on the order they arrive in.
 * With no matching rule the item's own price stands.
 *
 * There is exactly one place that decides a price; the order pad, the bill and the
 * self-order surface all ask it.
 */

export type PriceRule = {
  id: string;
  locationId: string | null;
  channel: string | null;
  priceMinor: number;
  /** YYYY-MM-DD, inclusive. */
  effectiveFrom: string;
  /** YYYY-MM-DD, inclusive; null while it has no end. */
  effectiveTo: string | null;
};

export type PriceContext = { locationId: string; channel: string; day: string };

export type PriceSource = "base" | "outlet_channel" | "outlet" | "channel" | "dated";

export type ResolvedPrice = { priceMinor: number; ruleId: string | null; source: PriceSource };

function specificity(rule: PriceRule): number {
  return (rule.locationId !== null ? 2 : 0) + (rule.channel !== null ? 1 : 0);
}

const SOURCE: Record<number, PriceSource> = { 3: "outlet_channel", 2: "outlet", 1: "channel", 0: "dated" };

export function ruleApplies(rule: PriceRule, ctx: PriceContext): boolean {
  if (rule.locationId !== null && rule.locationId !== ctx.locationId) return false;
  if (rule.channel !== null && rule.channel !== ctx.channel) return false;
  if (rule.effectiveFrom > ctx.day) return false;
  if (rule.effectiveTo !== null && rule.effectiveTo < ctx.day) return false;
  return true;
}

export function resolvePrice(basePriceMinor: number, rules: readonly PriceRule[], ctx: PriceContext): ResolvedPrice {
  const matching = rules.filter((rule) => ruleApplies(rule, ctx));
  if (matching.length === 0) return { priceMinor: basePriceMinor, ruleId: null, source: "base" };
  const best = [...matching].sort(
    (a, b) =>
      specificity(b) - specificity(a) ||
      (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0) ||
      (a.id < b.id ? 1 : -1),
  )[0]!;
  return { priceMinor: best.priceMinor, ruleId: best.id, source: SOURCE[specificity(best)]! };
}

/** Plain words for the order pad and the Menu screen, so a price is never a surprise (PRN-001). */
export function describeSource(source: PriceSource, labels: { outlet?: string; channel?: string }): string | null {
  switch (source) {
    case "base":
      return null;
    case "outlet_channel":
      return `${labels.outlet ?? "Outlet"} ${labels.channel ?? "channel"} price`;
    case "outlet":
      return `${labels.outlet ?? "Outlet"} price`;
    case "channel":
      return `${labels.channel ?? "Channel"} price`;
    case "dated":
      return "New price";
  }
}

/** Two rules of the same specificity whose days overlap and which could both match one order: worth warning about. */
export function overlappingRules(rules: readonly PriceRule[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i]!;
      const b = rules[j]!;
      if (specificity(a) !== specificity(b)) continue;
      if (a.locationId !== b.locationId || a.channel !== b.channel) continue;
      const aEnd = a.effectiveTo ?? "9999-12-31";
      const bEnd = b.effectiveTo ?? "9999-12-31";
      if (a.effectiveFrom <= bEnd && b.effectiveFrom <= aEnd) pairs.push([a.id, b.id]);
    }
  }
  return pairs;
}
