import type { TenantScopedClient } from "@/server/platform/tenancy";
import { effectiveTimeZone } from "@/server/platform/temporal";

/**
 * One service day, in the restaurant's own clock.
 *
 * A restaurant in Delhi is still serving at 19:00 UTC, so a day boundary taken
 * from the server would cut one evening's service across two reports and make
 * the summary disagree with the till. The zone comes from the organization,
 * resolved by the platform rather than guessed here.
 *
 * A service day starts at `startMinute` after local midnight (default 05:00) and
 * runs for 24 hours: a bill settled at 00:40 belongs to the night that earned it,
 * which is what anyone reading a day summary means. Consecutive days neither
 * overlap nor leave a gap (Task 126 G-02); "today" at 02:00 is yesterday's
 * service day, because that service is still running.
 */
export const DEFAULT_DAY_START_MINUTE = 300;

export async function serviceDayRange(
  tx: TenantScopedClient,
  organizationId: string,
  day?: string,
  startMinute: number = DEFAULT_DAY_START_MINUTE,
): Promise<{ from: Date; to: Date; day: string; timeZone: string }> {
  const timeZone = await effectiveTimeZone(tx, organizationId);

  let chosen: string;
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    chosen = day;
  } else {
    // The service day that contains "now": the local date of (now - day start).
    const [current] = await tx.$queryRaw<Array<{ day: string }>>`
      SELECT to_char(((now() AT TIME ZONE ${timeZone}) - make_interval(mins => ${startMinute}::int))::date, 'YYYY-MM-DD') AS day`;
    chosen = current!.day;
  }

  const [rows] = await tx.$queryRaw<Array<{ from: Date; to: Date }>>`
    SELECT ((${chosen}::date::timestamp + make_interval(mins => ${startMinute}::int)) AT TIME ZONE ${timeZone}) AS "from",
           (((${chosen}::date + 1)::timestamp + make_interval(mins => ${startMinute}::int)) AT TIME ZONE ${timeZone}) AS "to"`;

  return { from: rows.from, to: rows.to, day: chosen, timeZone };
}
