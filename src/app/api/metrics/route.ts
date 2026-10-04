import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { buildIdentity, metricsSnapshot } from "@/server/platform/observability";

/**
 * A metric snapshot for an operator.
 *
 * Authority: taskplans/archive/40_enterprise_observability.md.
 *
 * Serves what the in-memory registry has measured **on this instance since it
 * started**. That limitation is stated rather than hidden: with more than one
 * replica an operator must scrape each, and the numbers reset on restart. It is
 * the honest shape for a platform that refuses to require a time-series
 * database in order to be observable — a real deployment points a collector at
 * this, and a small one reads it directly.
 *
 * AUTHENTICATION
 * Metrics name routes, dependencies, error codes and volumes. That is a map of
 * the system, so in production this endpoint requires the same shared secret
 * the scheduler uses (`CRON_SECRET`, ADR-015): constant-time comparison, 503
 * rather than an open endpoint when nothing is configured. Outside production
 * it is open, because a developer with no secret set should still be able to
 * see their own counters.
 *
 * It carries no tenant data by construction. Metric labels are dependency,
 * route, operation, outcome and error code — never an identifier belonging to
 * a tenant, which is what would make this endpoint an INV-001 problem.
 */

export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const identity = buildIdentity();

  if (identity.environment !== "production") return true;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const presented = header.replace(/^Bearer\s+/i, "");

  // Both sides hashed to a fixed width would be better still, but the length
  // of a configured secret is not itself sensitive here; what matters is that
  // the comparison does not return early on the first differing byte.
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    const secretConfigured = Boolean(process.env.CRON_SECRET);
    return NextResponse.json(
      {
        status: secretConfigured ? "unauthorized" : "unavailable",
        detail: secretConfigured
          ? "metrics require the operator secret in production"
          : "no operator secret is configured on this deployment",
      },
      { status: secretConfigured ? 401 : 503 },
    );
  }

  return NextResponse.json({
    ...buildIdentity(),
    uptimeSeconds: Math.round(process.uptime()),
    ...metricsSnapshot(),
  });
}
