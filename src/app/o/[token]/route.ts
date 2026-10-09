import { installCapabilities } from "@/server/capabilities/registry";
import { openGuestSession } from "@/server/capabilities/dinein/selforder-public";
import { sharedRateLimit } from "@/server/platform/shared-rate-limit";

export const dynamic = "force-dynamic";

/**
 * A printed sticker's entry point (ADR-042 items 2, 10 and 11).
 *
 * Opening the link starts a visit only while the outlet has self-order on and, for a table, only
 * while staff have it seated: the sticker alone never orders. The visit gets its OWN token, held in
 * the URL it redirects to, so the sticker's token never reaches a page the guest could share.
 * Every failure is the same bare 404, so a wrong, revoked, disabled or unseated link cannot be
 * told apart. The redirect is relative: the origin is never derived from the request (ADR-032).
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const source = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = await sharedRateLimit(`selfopen:${source}`, "query");
  if (!limit.allowed) {
    return new Response("Too many requests. Please try again shortly.", { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds), "Cache-Control": "no-store" } });
  }

  installCapabilities();
  const session = await openGuestSession(token);
  if (!session) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(null, { status: 302, headers: { Location: `/o/s/${session}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
