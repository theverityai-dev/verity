import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/platform/db";
import { runtimeConfig } from "@/server/platform/config";
import { discoverProviderMetadata } from "@/server/platform/oidc";
import { publicUrl } from "@/server/platform/public-url";
import {
  OIDC_SESSION_COOKIE,
  OIDC_TRANSACTION_COOKIE,
  createOidcSession,
  exchangeOidcCode,
  oidcStateHash,
  readOidcTransaction,
} from "@/server/platform/oidc-browser";
import { captureError, increment, log } from "@/server/platform/observability";
import { recordSecurityEvent } from "@/server/platform/audit";
import { withTenant } from "@/server/platform/tenancy";

export const dynamic = "force-dynamic";

type Membership = { tenant_id: string; user_id: string; is_platform: boolean };

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function failed(request: NextRequest, reason: string, error?: unknown): NextResponse {
  increment("authentication_failed_total", { provider: "oidc", reason });
  log("warn", "OIDC authentication refused", { reason });
  if (error) captureError(error, { route: "oidc_callback", reason });
  let destination: URL;
  try {
    destination = publicUrl("/sign-in?error=oidc");
  } catch (configError) {
    // No public origin to send a browser to (ADR-032): refuse rather than guess one from the request.
    captureError(configError, { route: "oidc_callback_origin" });
    return NextResponse.json({ error: "E_CONFIG_INVALID" }, { status: 500, headers: { "cache-control": "no-store" } });
  }
  const response = NextResponse.redirect(destination);
  response.cookies.delete(OIDC_TRANSACTION_COOKIE);
  response.cookies.delete(OIDC_SESSION_COOKIE);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const settings = runtimeConfig.auth.oidc;
  if (runtimeConfig.auth.provider !== "oidc" || !settings) return failed(request, "provider");
  if (request.nextUrl.searchParams.has("error")) return failed(request, "provider_denied");

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const cookie = request.cookies.get(OIDC_TRANSACTION_COOKIE)?.value;
  if (!code || !state || !cookie) return failed(request, "missing_transaction");

  try {
    const transaction = await readOidcTransaction(cookie, settings, runtimeConfig.auth.jwtSecret);
    if (!sameSecret(state, transaction.state)) return failed(request, "state_mismatch");

    const consumed = await prisma.oidcLoginTransaction.updateMany({
      where: {
        stateHash: oidcStateHash(state),
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) return failed(request, "replayed_or_expired");

    const metadata = await discoverProviderMetadata(settings.issuer);
    const principal = await exchangeOidcCode({ code, transaction, settings, metadata });
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(principal.id)) {
      return failed(request, "unprovisionable_subject");
    }

    const memberships = await prisma.$queryRaw<Membership[]>`
      SELECT tenant_id, user_id, is_platform
        FROM verity.memberships_for_auth_user(${principal.id}::uuid)`;
    if (memberships.length === 0) return failed(request, "unprovisioned");

    const session = await createOidcSession(principal, settings, runtimeConfig.auth.jwtSecret);
    const preferred = memberships.find((membership) => membership.is_platform) ?? memberships[0]!;
    try {
      await withTenant(preferred.tenant_id, (tx) => recordSecurityEvent(tx, {
        tenantId: preferred.tenant_id,
        actorUserId: preferred.user_id,
        eventType: "AuthSuccess",
        payload: { provider: "oidc" },
      }));
    } catch (auditError) {
      captureError(auditError, { route: "oidc_callback_audit" });
    }

    const response = NextResponse.redirect(publicUrl(transaction.returnTo));
    response.cookies.delete(OIDC_TRANSACTION_COOKIE);
    response.cookies.set(OIDC_SESSION_COOKIE, session, {
      httpOnly: true,
      secure: runtimeConfig.nodeEnv === "production",
      sameSite: "lax",
      path: "/",
      maxAge: Math.min(settings.sessionIdleSeconds ?? 3_600, settings.sessionMaxAgeSeconds ?? 28_800),
      priority: "high",
    });
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    return failed(request, "callback_validation", error);
  }
}
