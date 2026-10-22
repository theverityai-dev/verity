import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";

/**
 * The session-refresh boundary's response contract.
 *
 * Authority: implementation/03-platform-foundation/identity.md contract step 2.
 *
 * `src/proxy.ts` is the ONLY code in the platform that must produce a `Response`
 * — there are no route handlers. Next.js awaits what it returns and converts the
 * value to a Response; if the function rejects instead, the browser reports
 *
 *     Uncaught (in promise) TypeError: Failed to convert value to 'Response'
 *
 * and EVERY route 500s, including `/sign-in`, which locks the user out of the
 * one page that could recover the session.
 *
 * The refresh call reaches an external service on every request, so it fails for
 * ordinary reasons: a Supabase outage, DNS, a timeout, a revoked refresh token,
 * or a missing environment variable at boot. None of those should take down the
 * application. The proxy performs no authorization — the page's own
 * `requireActor()` does that — so a failed refresh may safely degrade to "no
 * session refreshed" and let the page redirect to sign-in.
 *
 * These tests exist because the failure only appears under a condition that does
 * not occur locally, which is exactly the kind of defect that ships.
 */

const getClaims = vi.fn();

vi.mock("@supabase/ssr", () => ({
  // Mirrors the real client, which validates its arguments and throws
  // synchronously on a missing URL — the boot-misconfiguration case.
  createServerClient: vi.fn((url?: string) => {
    if (!url) throw new Error("supabaseUrl is required.");
    return { auth: { getClaims } };
  }),
}));

async function callProxy(): Promise<Response> {
  const { proxy } = await import("@/proxy");
  return proxy(new NextRequest(new Request("http://localhost:3000/workspace")));
}

describe("session refresh boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    getClaims.mockReset();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-for-test";
    delete process.env.VERITY_AUTH_PROVIDER;
  });

  it("returns a Response on the happy path", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });
    const response = await callProxy();
    expect(response).toBeInstanceOf(Response);
  });

  it("still returns a Response when the auth service throws", async () => {
    // The regression. Before the fix this rejected, and Next reported
    // "Failed to convert value to 'Response'" for every route at once.
    getClaims.mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));

    const response = await callProxy();
    expect(response).toBeInstanceOf(Response);
  });

  it("still returns a Response when the auth client cannot be constructed", async () => {
    // A missing or malformed env var throws synchronously, before any await.
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    getClaims.mockResolvedValue({ data: null, error: null });

    const response = await callProxy();
    expect(response).toBeInstanceOf(Response);
  });

  it("does not swallow the failure silently", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    getClaims.mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));

    await callProxy();

    // Degrading is not the same as hiding. An operator has to be able to see
    // that session refresh is failing, or a provider outage looks like users
    // being randomly signed out.
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("does not contact Supabase for an OIDC deployment", async () => {
    process.env.VERITY_AUTH_PROVIDER = "oidc";
    vi.mocked(createServerClient).mockClear();

    const response = await callProxy();

    expect(response).toBeInstanceOf(Response);
    expect(createServerClient).not.toHaveBeenCalled();
  });
  it("serves a fresh enforcing CSP and requests private, week-long session cookies", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    const first = await callProxy();
    const second = await callProxy();
    expect(first.headers.get("content-security-policy")).toContain("'strict-dynamic'");
    expect(first.headers.get("content-security-policy")).not.toBe(second.headers.get("content-security-policy"));
    expect(createServerClient).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({
      cookieOptions: expect.objectContaining({ httpOnly: true, sameSite: "lax", maxAge: 604800 }),
    }));
  });

});
