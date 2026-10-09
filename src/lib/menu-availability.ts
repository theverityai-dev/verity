/**
 * Menu availability rules: which items can be ordered where and when. Pure; the
 * caller supplies the outlet, channel and local minute of the day.
 *
 * An item with no rule is available wherever it is active. An item with rules is
 * available only where at least one rule matches. A rule leaves outlet, channel
 * or window null to mean "any". The window is minutes since local midnight and
 * wraps past midnight when it ends before it starts (22:00 to 02:00).
 *
 * Authority: Task 125 items 3.2 (time-of-day menus) and 3.3 (per outlet and
 * channel availability, with the reason shown on the order pad).
 */

export type AvailabilityRule = {
  locationId: string | null;
  channel: string | null;
  fromMinute: number | null;
  toMinute: number | null;
};

export type AvailabilityContext = {
  locationId: string;
  channel: string;
  /** Minutes since local midnight in the outlet's own time zone, 0 to 1439. */
  minuteOfDay: number;
};

/** Minutes since local midnight for an instant in an IANA zone. DST-safe via Intl. */
export function minuteOfDay(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

export function inWindow(minute: number, from: number, to: number): boolean {
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

export function ruleMatches(rule: AvailabilityRule, ctx: AvailabilityContext): boolean {
  if (rule.locationId !== null && rule.locationId !== ctx.locationId) return false;
  if (rule.channel !== null && rule.channel !== ctx.channel) return false;
  if (rule.fromMinute !== null && rule.toMinute !== null && !inWindow(ctx.minuteOfDay, rule.fromMinute, rule.toMinute)) return false;
  return true;
}

export function isAvailable(rules: readonly AvailabilityRule[], ctx: AvailabilityContext): boolean {
  return rules.length === 0 || rules.some((rule) => ruleMatches(rule, ctx));
}

/** `07:30` from 450. */
export function formatMinute(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** `07:30` to minutes, or null when it is not a valid `HH:MM`. */
export function parseMinute(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
}

export type RuleLabels = {
  location: (id: string) => string;
  channel: (key: string) => string;
};

/** One rule in words: "Takeaway · Main St · 07:00 to 11:00". */
export function describeRule(rule: AvailabilityRule, labels: RuleLabels): string {
  const parts: string[] = [];
  if (rule.channel !== null) parts.push(labels.channel(rule.channel));
  if (rule.locationId !== null) parts.push(labels.location(rule.locationId));
  if (rule.fromMinute !== null && rule.toMinute !== null) parts.push(`${formatMinute(rule.fromMinute)} to ${formatMinute(rule.toMinute)}`);
  return parts.join(" · ");
}

/**
 * Why an item is hidden right now, or null when it can be ordered. Names what the
 * item is available for, so staff can tell "wrong time" from "wrong outlet".
 */
export function unavailableReason(rules: readonly AvailabilityRule[], ctx: AvailabilityContext, labels: RuleLabels): string | null {
  if (isAvailable(rules, ctx)) return null;
  return `Only available: ${rules.map((rule) => describeRule(rule, labels)).join("; ")}`;
}
