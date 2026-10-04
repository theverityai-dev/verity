import { effectiveTimeZone } from "@/server/platform/temporal";
import type { TenantScopedClient } from "@/server/platform/tenancy";

/**
 * When a business day and a business month begin.
 *
 * Audit finding U0-3 (`taskplans/archive/68_plywood_usability_audit.md`). Every period
 * boundary in this capability was computed in UTC while the tenant reckons in
 * `Asia/Kolkata`. The consequences ran from cosmetic to filing-grade:
 *
 *   - "Today's sales" showed yesterday's figure until 05:30 IST, every day.
 *   - The tax screen read "August 2026" at 01:55 IST on 1 September.
 *   - An invoice raised between 00:00 and 05:30 IST on the 1st was stamped into
 *     the PREVIOUS month's GST period. That is a filing error with a paper
 *     trail behind it.
 *
 * The platform already solved this. `temporal.ts` resolves a zone
 * organization → tenant → UTC and validates it on write; the capability simply
 * never imported it. This module is that import, plus the boundary arithmetic.
 *
 * WHAT DOES NOT CHANGE. Instants are still stored in UTC, and nothing here
 * alters how a moment is recorded. This is only about where a boundary falls —
 * which day a sale counts in, which month a return covers.
 */

/**
 * The tenant's own zone, resolved from the tenant row alone.
 *
 * For the call sites that hold a transaction and no actor — `assertPeriodOpen`
 * is the important one, because it decides which GST period a posting lands in
 * and is reached from every command that writes a document. Falling back to UTC
 * there would put an invoice raised at 01:00 IST on the 1st into the previous
 * month, which is precisely U0-3.
 */
export async function tenantZone(tx: TenantScopedClient): Promise<string> {
  const tenant = await tx.tenant.findFirst({ select: { timeZone: true } });
  return tenant?.timeZone ?? "UTC";
}

/** The zone this actor's business reckons in. Never null; UTC is explicit. */
export async function businessZone(ctx: {
  tx: TenantScopedClient;
  actor: { organizationId: string };
}): Promise<string> {
  return effectiveTimeZone(ctx.tx, ctx.actor.organizationId);
}

/**
 * How far the zone's wall clock is from UTC at a given instant.
 *
 * `Intl` rather than a fixed offset, for the reason `formatInZone` gives: an
 * offset is wrong for half the year in any zone that observes daylight saving.
 * India does not, but the next client might, and a helper correct for only one
 * zone is a trap left for whoever adds the second.
 */
function offsetMs(instant: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const at = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  // `hour` renders as 24 at midnight under some ICU versions; 24 % 24 is the
  // same instant as 0 and keeps the arithmetic honest.
  const asIfUtc = Date.UTC(
    at("year"),
    at("month") - 1,
    at("day"),
    at("hour") % 24,
    at("minute"),
    at("second"),
  );
  return asIfUtc - instant.getTime();
}

/** The wall-clock calendar date in the zone. */
function partsIn(
  instant: Date,
  zone: string,
): { year: number; month: number; day: number } {
  const shifted = new Date(instant.getTime() + offsetMs(instant, zone));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/**
 * The instant at which local midnight occurs on a given date in a zone.
 *
 * Two passes. The first subtracts the offset in force at the naive guess; the
 * second re-measures at the candidate, which matters when the boundary being
 * sought is itself a daylight-saving transition and the two offsets differ.
 */
function instantAtLocalMidnight(
  zone: string,
  year: number,
  month: number,
  day: number,
): Date {
  const naive = Date.UTC(year, month - 1, day);
  const firstPass = naive - offsetMs(new Date(naive), zone);
  return new Date(naive - offsetMs(new Date(firstPass), zone));
}

/** Midnight today, in the business's own zone. */
export function startOfBusinessDay(zone: string, at: Date = new Date()): Date {
  const { year, month, day } = partsIn(at, zone);
  return instantAtLocalMidnight(zone, year, month, day);
}

/** Midnight on the first of this month, in the business's own zone. */
export function startOfBusinessMonth(
  zone: string,
  at: Date = new Date(),
): Date {
  const { year, month } = partsIn(at, zone);
  return instantAtLocalMidnight(zone, year, month, 1);
}

/** The first instant of the month after the one containing `at`. */
export function startOfNextBusinessMonth(
  zone: string,
  at: Date = new Date(),
): Date {
  const { year, month } = partsIn(at, zone);
  return month === 12
    ? instantAtLocalMidnight(zone, year + 1, 1, 1)
    : instantAtLocalMidnight(zone, year, month + 1, 1);
}

/**
 * `YYYY-MM` for the month the business is currently in.
 *
 * Replaces `periodKeyOf`'s UTC getters, which named the wrong month for five
 * and a half hours out of every twenty-four.
 */
export function businessPeriodKey(zone: string, at: Date = new Date()): string {
  const { year, month } = partsIn(at, zone);
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** The half-open window `[start, end)` a `YYYY-MM` key covers in a zone. */
export function businessPeriodWindow(
  zone: string,
  periodKey: string,
): { startsAt: Date; endsAt: Date } {
  const [year, month] = periodKey.split("-").map(Number) as [number, number];
  return {
    startsAt: instantAtLocalMidnight(zone, year, month, 1),
    endsAt:
      month === 12
        ? instantAtLocalMidnight(zone, year + 1, 1, 1)
        : instantAtLocalMidnight(zone, year, month + 1, 1),
  };
}

/** Convenience for a query handler that has a context but no zone yet. */
export async function businessClock(ctx: {
  tx: TenantScopedClient;
  actor: { organizationId: string };
}): Promise<{
  zone: string;
  dayStart: Date;
  monthStart: Date;
  periodKey: string;
}> {
  const zone = await businessZone(ctx);
  return {
    zone,
    dayStart: startOfBusinessDay(zone),
    monthStart: startOfBusinessMonth(zone),
    periodKey: businessPeriodKey(zone),
  };
}
