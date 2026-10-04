import { NextResponse } from "next/server";
import { buildIdentity } from "@/server/platform/observability";

/**
 * Liveness — "the process is alive and responding."
 *
 * Authority: taskplans/archive/32_health_readiness.md.
 *
 * Deliberately does NOTHING beyond reading a constant. No database, no
 * storage, no external call — the whole point of a liveness probe is that
 * it answers "is this process able to respond at all," a question a
 * dependency outage must not be able to answer "no" to. Readiness (can this
 * instance actually serve traffic) is `/api/ready`'s job, not this one's —
 * conflating the two is exactly what turns a database blip into every
 * container being killed and restarted by an orchestrator that read the
 * wrong signal.
 *
 * Task 40 added build identity to the response. An operator asking "which
 * deployment is affected" is asking a liveness-shaped question, and answering
 * it here costs nothing: it is still a constant read, still no I/O.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ status: "ok", ...buildIdentity() });
}
