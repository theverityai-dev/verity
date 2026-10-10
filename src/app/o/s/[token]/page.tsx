import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { installCapabilities } from "@/server/capabilities/registry";
import { selfOrderView } from "@/server/capabilities/dinein/selforder";
import { resolveGuestSession } from "@/server/capabilities/dinein/selforder-public";
import { executeQuery } from "@/server/platform/query";
import { sharedRateLimit } from "@/server/platform/shared-rate-limit";
import { GuestOrder } from "./GuestOrder";

export const dynamic = "force-dynamic";

// Never indexed, never cached, and the visit's token never leaves in a Referer (ADR-042 item 10).
export const metadata = { title: "Order", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

/**
 * A guest's visit (ADR-042). No sign-in. The token in the address is the only credential: it
 * resolves, through one definer function, to this visit and the outlet's ordering identity. Anything
 * wrong with it (unknown, expired, closed, outlet off, table released) is the same "not found".
 */
export default async function GuestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const source = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = await sharedRateLimit(`selfpage:${source}`, "query");
  if (!limit.allowed) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <p className="text-[17px] text-text-secondary">Too many requests. Please try again in {limit.retryAfterSeconds} seconds.</p>
      </main>
    );
  }

  installCapabilities();
  const session = await resolveGuestSession(token);
  if (!session) notFound();
  const view = await executeQuery(session.actor, selfOrderView, { sessionId: session.sessionId }, "api");

  return <GuestOrder token={token} initial={view} />;
}
