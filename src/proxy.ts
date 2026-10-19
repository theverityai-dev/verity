import { contentSecurityPolicy } from "./server/platform/csp";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  OIDC_SESSION_COOKIE,
  renewOidcSessionIfNeeded,
} from "./server/platform/oidc-browser";

/**
 * Session refresh at the Next.js request boundary.
 *
 * Authority: implementation/03-platform-foundation/identity.md contract step 2,
 * which names "the Next.js middleware boundary". Next 16 renamed that convention
 * from `middleware` to `proxy` (node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/proxy.md); this is the same boundary under its current name,
 * not a departure from the handoff.
 *
 * This refreshes the Supabase session cookie so Server Components — which cannot
 * write cookies — always observe a valid session. It deliberately performs no
 * authorization: the proxy runs before the platform can resolve a membership,
 * and duplicating permission logic here would create the second permission
 * system the brief forbids. Route protection is the page's own job, through
 * requireActor().
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV !== "production");
  request.headers.set("x-nonce", nonce);
  // The shell redirects a signed-out visitor to sign-in; this lets it send them back to the page they asked for.
  request.headers.set("x-return-path", request.nextUrl.pathname + request.nextUrl.search);
  request.headers.set("Content-Security-Policy", csp);
  let response = NextResponse.next({ request: { headers: request.headers } });

  try {
    if (process.env.VERITY_AUTH_PROVIDER === "oidc") {
      const token = request.cookies.get(OIDC_SESSION_COOKIE)?.value;
      if (token) {
        const clientId = process.env.VERITY_OIDC_CLIENT_ID;
        const secret = process.env.VERITY_SESSION_SECRET;
        if (!clientId || !secret) throw new Error("OIDC session renewal is not configured");
        const renewed = await renewOidcSessionIfNeeded(
          token,
          {
            issuer: process.env.VERITY_OIDC_ISSUER ?? "",
            clientId,
            principalClaim: process.env.VERITY_OIDC_PRINCIPAL_CLAIM ?? "sub",
            emailClaim: process.env.VERITY_OIDC_EMAIL_CLAIM ?? "email",
            clockToleranceSeconds: Number(process.env.VERITY_OIDC_CLOCK_TOLERANCE_SECONDS ?? 60),
            sessionIdleSeconds: Number(process.env.VERITY_OIDC_SESSION_IDLE_SECONDS ?? 3_600),
            sessionMaxAgeSeconds: Number(process.env.VERITY_OIDC_SESSION_MAX_AGE_SECONDS ?? 28_800),
          },
          secret,
        );
        if (renewed) {
          response.cookies.set(OIDC_SESSION_COOKIE, renewed.token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: renewed.maxAge,
            path: "/",
            priority: "high",
          });
        }
      }
    } else {
    // Deliberately NOT `runtimeConfig` (src/server/platform/config.ts): that
    // module validates and throws on import, which is exactly wrong for this
    // boundary — a throw here must stay inside this try/catch and degrade,
    // never reject the module graph before proxy() even runs. proxy.test.ts's
    // "auth client cannot be constructed" case exercises precisely this.
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 60 * 60 * 24 * 7, path: "/" },
      cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: (list) => {
            list.forEach(({ name, value }) => request.cookies.set(name, value));
            response = NextResponse.next({ request: { headers: request.headers } });
            list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          },
        },
      },
    );

    // Touching getUser() is what triggers the refresh.
    await supabase.auth.getUser();
    }
  } catch (error) {
    /**
     * This function's contract with Next.js is that it resolves to a Response.
     * Everything above reaches an external service on every single request, so
     * it fails for ordinary reasons — a Supabase outage, DNS, a timeout, a
     * revoked refresh token, a missing environment variable at boot. Letting any
     * of those reject leaves Next with a rejected promise where a Response
     * belongs, which surfaces as
     *
     *     Uncaught (in promise) TypeError: Failed to convert value to 'Response'
     *
     * and takes down EVERY route at once, including /sign-in — the one page that
     * could have recovered the session.
     *
     * Degrading here is safe precisely because this boundary performs no
     * authorization: a request that fails to refresh simply carries no refreshed
     * session, and the page's own requireActor() redirects to sign-in. The
     * failure is logged rather than swallowed, because an operator has to be
     * able to tell a provider outage from users being randomly signed out.
     */
    console.error("[verity] session refresh failed; continuing without it", error);
  }

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Task 32: /api/health and /api/ready are infrastructure probes — no
  // authentication, no session, called by Docker/orchestrator tooling that
  // has no cookie jar. Routing them through this proxy would add an
  // unbounded Supabase network call ahead of every liveness/readiness
  // check, which is exactly what a liveness probe's own contract forbids
  // ("no external service calls," "deterministic"). Excluding them here
  // does not skip any authorization — this proxy never performed any; see
  // its own doc comment above.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/health|api/ready|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
