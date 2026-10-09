import { NextResponse } from "next/server";
import { z } from "zod";
import { installCapabilities } from "@/server/capabilities/registry";
import { requestService, selfOrderView, submitSelfOrder } from "@/server/capabilities/dinein/selforder";
import { resolveGuestSession } from "@/server/capabilities/dinein/selforder-public";
import { executeCommand } from "@/server/platform/command";
import { executeQuery } from "@/server/platform/query";
import { readBoundedJson } from "@/server/platform/request-limits";
import { sharedRateLimit } from "@/server/platform/shared-rate-limit";
import { toActionFailure } from "@/server/platform/action-error";

export const dynamic = "force-dynamic";

/**
 * The guest page's data and its two writes (ADR-042 items 6, 7 and 10).
 *
 * The session token in the path is the only credential. It resolves, through one definer function,
 * to the outlet's ordering identity, and every call then runs through the ordinary command and
 * query pipeline as that identity, so `enforcePolicy()` decides as for anyone. Nothing in the body
 * names a tenant, an outlet, a table or a price. GET reads the guest's own visit; POST is one of
 * two actions, and a submit needs an `Idempotency-Key` so a retry cannot double-send.
 */

const bodySchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("submit"),
      customerName: z.string().optional(),
      customerPhone: z.string().optional(),
      lines: z.array(z.unknown()),
    })
    .strict(),
  z.object({ action: z.literal("request"), kind: z.enum(["waiter", "bill"]) }).strict(),
]);

const noStore = { "Cache-Control": "no-store" };
const notFound = () => NextResponse.json({ ok: false, code: "E_NOT_FOUND", message: "Not found." }, { status: 404, headers: noStore });

async function sessionFor(request: Request, token: string) {
  const source = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = await sharedRateLimit(`selfapi:${source}`, "command");
  if (!limit.allowed) {
    return { response: NextResponse.json({ ok: false, code: "E_RATE_LIMIT", message: "Too many requests. Please slow down." }, { status: 429, headers: { ...noStore, "Retry-After": String(limit.retryAfterSeconds) } }) };
  }
  installCapabilities();
  const session = await resolveGuestSession(token);
  return session ? { session } : { response: notFound() };
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const found = await sessionFor(request, (await params).token);
  if (!found.session) return found.response;
  try {
    const view = await executeQuery(found.session.actor, selfOrderView, { sessionId: found.session.sessionId }, "api");
    return NextResponse.json({ ok: true, view }, { headers: noStore });
  } catch (error) {
    return refusal(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const found = await sessionFor(request, (await params).token);
  if (!found.session) return found.response;
  const { actor, sessionId } = found.session;

  const parsed = bodySchema.safeParse(await readBoundedJson(request, 16 * 1024).catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: "E_VALIDATION", message: "That request was not understood." }, { status: 422, headers: noStore });
  }

  try {
    if (parsed.data.action === "request") {
      const result = await executeCommand(actor, requestService, { sessionId, kind: parsed.data.kind }, "api");
      return NextResponse.json({ ok: true, result }, { headers: noStore });
    }
    const idempotencyKey = request.headers.get("idempotency-key") ?? "";
    const result = await executeCommand(
      actor,
      submitSelfOrder,
      { sessionId, idempotencyKey, customerName: parsed.data.customerName || undefined, customerPhone: parsed.data.customerPhone || undefined, lines: parsed.data.lines as never },
      "api",
    );
    return NextResponse.json({ ok: true, result }, { headers: noStore });
  } catch (error) {
    return refusal(error);
  }
}

/** A refusal the guest can act on, in the platform's own failure shape; anything unexpected is a plain 500. */
function refusal(error: unknown): Response {
  const failure = toActionFailure(error);
  const status = failure.code === "E_VALIDATION" ? 422 : failure.code === "E_RATE_LIMIT" ? 429 : failure.code === "E_UNKNOWN" ? 500 : 403;
  return NextResponse.json(failure, { status, headers: noStore });
}
