import { NextResponse } from "next/server";
import { z } from "zod";
import { installCapabilities } from "@/server/capabilities/registry";
import { installAdministration } from "@/server/platform/administration";
import { executeCommand, getCommand } from "@/server/platform/command";
import { executeQuery, getQuery } from "@/server/platform/query";
import { buildToolManifest } from "@/server/platform/tool-manifest";
import { withTenant } from "@/server/platform/tenancy";
import { readBoundedJson, RateLimitError } from "@/server/platform/request-limits";
import { toActionFailure, type ActionFailure } from "@/server/platform/action-error";
import { dispatchExternalTool } from "@/server/platform/external-tools";
import {
  authenticateApiKey,
  claimIdempotency,
  completeIdempotency,
  releaseIdempotency,
  requestHash,
  touchApiKey,
} from "@/server/platform/external-auth";

export const dynamic = "force-dynamic";

/**
 * External tool-invocation surface (ADR-029, Task 120).
 *
 * A machine caller presents a key; the key names the tenant, user and role, and
 * the call then runs through the ordinary command/query pipeline as that actor.
 * Nothing in the body can widen scope, and `enforcePolicy()` still decides every
 * call (ADR-017). Dark unless `EXTERNAL_TOOLS_ENABLED=1`: an unset deployment
 * answers 503 rather than running anything (the ADR-015 posture).
 */

const bodySchema = z.object({ tool: z.string().min(1).max(200), input: z.unknown().optional() }).strict();
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{16,128}$/;

const STATUS: Record<ActionFailure["code"], number> = {
  E_UNAUTHENTICATED: 401,
  E_FORBIDDEN: 403,
  E_VALIDATION: 422,
  E_CONFLICT: 409,
  E_CAPABILITY_INACTIVE: 403,
  E_CAPABILITY_UNKNOWN: 403,
  E_CAPABILITY_DEPENDENCY_INACTIVE: 403,
  E_CAPABILITY_VERSION_INCOMPATIBLE: 403,
  E_UNGROUNDED: 422,
  E_RATE_LIMIT: 429,
  E_UNKNOWN: 500,
};

function fail(error: unknown): Response {
  const failure = toActionFailure(error);
  const headers: Record<string, string> = {};
  if (error instanceof RateLimitError) headers["Retry-After"] = String(error.retryAfterSeconds);
  return NextResponse.json(failure, { status: STATUS[failure.code], headers });
}

function reject(code: "E_UNAUTHENTICATED" | "E_VALIDATION" | "E_CONFLICT", message: string, status: number): Response {
  return NextResponse.json({ ok: false, code, message, retryable: false } satisfies ActionFailure, { status });
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.EXTERNAL_TOOLS_ENABLED !== "1") {
    return NextResponse.json({ ok: false, code: "E_UNKNOWN", message: "Not available.", retryable: false }, { status: 503 });
  }

  const bearer = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  const authenticated = bearer ? await authenticateApiKey(bearer) : null;
  // One answer for a missing, malformed, wrong, expired or revoked key.
  if (!authenticated) return reject("E_UNAUTHENTICATED", "Invalid credentials.", 401);
  const { actor, keyId } = authenticated;

  const parsed = bodySchema.safeParse(await readBoundedJson(request, 64 * 1024).catch(() => null));
  if (!parsed.success) return reject("E_VALIDATION", "Body must be { tool, input }.", 422);
  const { tool, input } = parsed.data;

  installCapabilities();
  installAdministration();
  void touchApiKey(actor, keyId);

  const idempotencyKey = request.headers.get("idempotency-key");
  let claimed = false;
  const isCommand = getCommand(tool) !== undefined;

  try {
    if (isCommand) {
      if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
        return reject("E_VALIDATION", "Commands require an Idempotency-Key header (16-128 chars).", 422);
      }
      const claim = await claimIdempotency(actor, keyId, idempotencyKey, requestHash(tool, input));
      if (claim.state === "replay") {
        return NextResponse.json(claim.response, { headers: { "Idempotent-Replay": "true" } });
      }
      if (claim.state === "in_progress") return reject("E_CONFLICT", "A request with this Idempotency-Key is in progress.", 409);
      if (claim.state === "mismatch") return reject("E_VALIDATION", "Idempotency-Key was used with a different request.", 422);
      claimed = true;
    }

    const outcome = await dispatchExternalTool(
      { tool, input },
      {
        manifest: () => withTenant(actor.tenantId, (tx) => buildToolManifest(tx, actor)),
        getCommand,
        getQuery,
        runCommand: (def, raw) => executeCommand(actor, def, raw, "api"),
        runQuery: (def, raw) => executeQuery(actor, def, raw, "api"),
      },
    );

    if (!outcome.ok) {
      if (claimed) await releaseIdempotency(actor, keyId, idempotencyKey!);
      const status = outcome.code === "E_UNKNOWN_TOOL" ? 404 : 403;
      return NextResponse.json({ ok: false, code: outcome.code, message: outcome.message }, { status });
    }

    // Round-trip through JSON so what is stored is exactly what is replayed
    // (Dates become ISO strings, undefined disappears).
    const body = JSON.parse(JSON.stringify({ ok: true, result: outcome.result ?? null }));
    if (claimed) await completeIdempotency(actor, keyId, idempotencyKey!, body);
    return NextResponse.json(body);
  } catch (error) {
    // A failed command releases its claim so the caller may retry it.
    if (claimed) await releaseIdempotency(actor, keyId, idempotencyKey!).catch(() => undefined);
    return fail(error);
  }
}
