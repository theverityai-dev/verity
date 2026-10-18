import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Provider-specific account actions under OIDC.
 *
 * `changeOwnPassword`, `createTeamLogin` and `resetTeamPassword` talk to Supabase Auth. A deployment that
 * authenticates through an OIDC identity provider has no Supabase project, so they must refuse with a clear
 * message BEFORE touching a session, the database or any Supabase client, rather than fail against a placeholder
 * URL. The identity provider owns passwords and accounts there (deploy/docs/install.md).
 */

const KEYS = [
  "DATABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_JWT_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
  "JWT_SECRET",
  "VERITY_SESSION_SECRET",
  "VERITY_AUTH_PROVIDER",
  "VERITY_OIDC_ISSUER",
  "VERITY_OIDC_CLIENT_ID",
  "VERITY_OIDC_REDIRECT_URI",
] as const;

describe("password and account-creation actions under OIDC", () => {
  let snapshot: Record<string, string | undefined>;

  beforeEach(() => {
    vi.resetModules();
    snapshot = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const key of KEYS) delete process.env[key];
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/verity_test";
    process.env.VERITY_AUTH_PROVIDER = "oidc";
    process.env.VERITY_OIDC_ISSUER = "https://idp.example.test/realms/dsew";
    process.env.VERITY_OIDC_CLIENT_ID = "verity-web";
    process.env.VERITY_OIDC_REDIRECT_URI = "https://verity.example.test/api/auth/oidc/callback";
    process.env.VERITY_SESSION_SECRET = "a-session-signing-secret-of-sufficient-length";
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (snapshot[key] === undefined) delete process.env[key];
      else process.env[key] = snapshot[key];
    }
  });

  it("changing your own password is refused with a message naming the identity provider", async () => {
    const { changeOwnPassword } = await import("@/server/actions/account");
    const result = await changeOwnPassword("current-password", "a-new-password");
    expect(result).toMatchObject({ ok: false, code: "E_VALIDATION", retryable: false });
    expect(result.ok === false && result.message).toMatch(/identity provider/i);
  });

  it("creating a login is refused, and does not ask for a Supabase service key", async () => {
    const { createTeamLogin } = await import("@/server/actions/people");
    const result = await createTeamLogin({
      displayName: "New Person",
      email: "new.person@example.test",
      password: "a-new-password",
      organizationId: "00000000-0000-0000-0000-000000000000",
    });
    expect(result).toMatchObject({ ok: false, code: "E_VALIDATION", retryable: false });
    const message = result.ok === false ? result.message : "";
    expect(message).toMatch(/identity provider/i);
    expect(message).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("resetting a teammate's password is refused", async () => {
    const { resetTeamPassword } = await import("@/server/actions/people");
    const result = await resetTeamPassword({ authUserId: "00000000-0000-0000-0000-000000000000", password: "a-new-password" });
    expect(result).toMatchObject({ ok: false, code: "E_VALIDATION", retryable: false });
    expect(result.ok === false && result.message).toMatch(/identity provider/i);
  });
});
