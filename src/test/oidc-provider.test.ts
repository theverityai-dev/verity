import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JWK } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OidcClaimError,
  OidcConfigurationError,
  OidcVerificationError,
  bearerToken,
  discoverJwksUri,
  discoveryUrl,
  normalizePrincipal,
  verifyIdToken,
  type OidcSettings,
} from "@/server/platform/oidc";

/**
 * Task 36 — Enterprise Identity / OIDC.
 * Plan: taskplans/archive/36_enterprise_identity_oidc.md (P1..P10).
 *
 * No live identity provider and no database. `platform/oidc.ts` is pure by
 * design precisely so the rules an enterprise buys — issuer, audience,
 * signature, expiry, claim mapping — can be proven here against a key pair
 * generated in-process. A test that needed Keycloak running would prove the
 * deployment, not the boundary.
 */

const ISSUER = "https://idp.example.test/realms/acme";
const CLIENT_ID = "verity-web";

const SETTINGS: OidcSettings = {
  issuer: ISSUER,
  clientId: CLIENT_ID,
  principalClaim: "sub",
  emailClaim: "email",
  clockToleranceSeconds: 0,
};

let signingKey: CryptoKey;
let publicJwk: JWK;
let foreignKey: CryptoKey;
let keys: ReturnType<typeof createLocalJWKSet>;

beforeEach(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), alg: "RS256", kid: "test-key" };
  keys = createLocalJWKSet({ keys: [publicJwk] });

  const other = await generateKeyPair("RS256", { extractable: true });
  foreignKey = other.privateKey;
});

async function token(
  claims: Record<string, unknown>,
  options: { issuer?: string; audience?: string; expiresIn?: string; key?: CryptoKey } = {},
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuedAt()
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? CLIENT_ID)
    .setExpirationTime(options.expiresIn ?? "5m")
    .sign(options.key ?? signingKey);
}

describe("OIDC token verification (P2-P6)", () => {
  it("accepts a well-formed token and returns a Principal", async () => {
    const principal = await verifyIdToken(
      await token({ sub: "idp-user-1", email: "person@acme.test" }),
      SETTINGS,
      keys,
    );

    expect(principal).toEqual({ id: "idp-user-1", email: "person@acme.test" });
  });

  it("rejects a token from a foreign issuer (P2)", async () => {
    await expect(
      verifyIdToken(
        await token({ sub: "u" }, { issuer: "https://attacker.example.test" }),
        SETTINGS,
        keys,
      ),
    ).rejects.toThrow(OidcVerificationError);
  });

  it("rejects a token issued for another client (P3)", async () => {
    await expect(
      verifyIdToken(await token({ sub: "u" }, { audience: "some-other-app" }), SETTINGS, keys),
    ).rejects.toThrow(/E_OIDC_VERIFY/);
  });

  it("rejects an authorization response with the wrong nonce", async () => {
    await expect(
      verifyIdToken(await token({ sub: "u", nonce: "unexpected" }), SETTINGS, keys, {
        expectedNonce: "expected",
      }),
    ).rejects.toThrow(/E_OIDC_VERIFY/);
  });

  it("rejects an authorized-party claim for another client", async () => {
    await expect(
      verifyIdToken(await token({ sub: "u", azp: "another-client" }), SETTINGS, keys),
    ).rejects.toThrow(/E_OIDC_VERIFY/);
  });

  it("honours an explicit audience override distinct from the client id (P3)", async () => {
    const settings = { ...SETTINGS, audience: "https://api.verity.test" };

    const principal = await verifyIdToken(
      await token({ sub: "u" }, { audience: "https://api.verity.test" }),
      settings,
      keys,
    );
    expect(principal.id).toBe("u");

    // The client id alone is no longer sufficient once an audience is named.
    await expect(
      verifyIdToken(await token({ sub: "u" }, { audience: CLIENT_ID }), settings, keys),
    ).rejects.toThrow(/E_OIDC_VERIFY/);
  });

  it("rejects a token signed by a key the provider does not publish (P4)", async () => {
    await expect(
      verifyIdToken(await token({ sub: "u" }, { key: foreignKey }), SETTINGS, keys),
    ).rejects.toThrow(/E_OIDC_VERIFY/);
  });

  it("rejects an expired token (P5)", async () => {
    const expired = await new SignJWT({ sub: "u" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(signingKey);

    await expect(verifyIdToken(expired, SETTINGS, keys)).rejects.toThrow(/E_OIDC_VERIFY/);
  });

  it("accepts a marginally expired token within the configured clock tolerance (P5)", async () => {
    const justExpired = await new SignJWT({ sub: "u" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(signingKey);

    await expect(verifyIdToken(justExpired, SETTINGS, keys)).rejects.toThrow(/E_OIDC_VERIFY/);

    const tolerant = { ...SETTINGS, clockToleranceSeconds: 60 };
    await expect(verifyIdToken(justExpired, tolerant, keys)).resolves.toEqual({
      id: "u",
      email: null,
    });
  });

  it("rejects a structurally invalid token", async () => {
    await expect(verifyIdToken("not.a.jwt", SETTINGS, keys)).rejects.toThrow(OidcVerificationError);
  });
});

describe("claim normalization (P6)", () => {
  it("defaults to sub and email", () => {
    expect(normalizePrincipal({ sub: "abc", email: "a@b.test" }, SETTINGS)).toEqual({
      id: "abc",
      email: "a@b.test",
    });
  });

  it("maps configurable claims, as Azure AD's oid and upn require", () => {
    const settings = { ...SETTINGS, principalClaim: "oid", emailClaim: "upn" };

    expect(
      normalizePrincipal({ sub: "ignored", oid: "azure-oid", upn: "p@corp.test" }, settings),
    ).toEqual({ id: "azure-oid", email: "p@corp.test" });
  });

  it("returns a null email rather than throwing when the provider sends none", () => {
    expect(normalizePrincipal({ sub: "abc" }, SETTINGS).email).toBeNull();
    expect(normalizePrincipal({ sub: "abc", email: "" }, SETTINGS).email).toBeNull();
    expect(normalizePrincipal({ sub: "abc", email: 42 }, SETTINGS).email).toBeNull();
  });

  it("refuses a token carrying no usable subject claim", () => {
    expect(() => normalizePrincipal({ email: "a@b.test" }, SETTINGS)).toThrow(OidcClaimError);
    expect(() => normalizePrincipal({ sub: "   " }, SETTINGS)).toThrow(/E_OIDC_CLAIMS/);
    // `sub` is typed as a string in JWTPayload, but a provider can send
    // anything and the runtime check is the one that matters.
    expect(() => normalizePrincipal({ sub: 12345 } as never, SETTINGS)).toThrow(/E_OIDC_CLAIMS/);
  });

  it("carries no claim beyond id and email into the Principal (P10)", async () => {
    const principal = await verifyIdToken(
      await token({
        sub: "u",
        email: "a@b.test",
        // The kind of payload a real enterprise IdP sends. None of it may cross.
        groups: ["admins"],
        realm_access: { roles: ["operator"] },
        tenant_id: "some-other-tenant",
        employee_number: "E-1001",
      }),
      SETTINGS,
      keys,
    );

    expect(Object.keys(principal).sort()).toEqual(["email", "id"]);
    // PLA-TEN-006: a tenant asserted by the identity provider is not a tenant.
    expect(JSON.stringify(principal)).not.toContain("some-other-tenant");
  });
});

describe("discovery", () => {
  it("appends the well-known path without eating a realm path segment", () => {
    expect(discoveryUrl(ISSUER)).toBe(`${ISSUER}/.well-known/openid-configuration`);
    expect(discoveryUrl(`${ISSUER}/`)).toBe(`${ISSUER}/.well-known/openid-configuration`);
  });

  it("returns the jwks_uri from a matching discovery document", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ issuer: ISSUER, jwks_uri: `${ISSUER}/protocol/openid-connect/certs` }),
    });

    await expect(discoverJwksUri(ISSUER, fetchImpl as unknown as typeof fetch)).resolves.toBe(
      `${ISSUER}/protocol/openid-connect/certs`,
    );
  });

  it("refuses a discovery document that declares a different issuer", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ issuer: "https://elsewhere.test", jwks_uri: "https://elsewhere.test/c" }),
    });

    await expect(
      discoverJwksUri(ISSUER, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(OidcConfigurationError);
  });

  it("refuses a discovery document with no jwks_uri, and a failed fetch", async () => {
    const noKeys = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ issuer: ISSUER }),
    });
    await expect(
      discoverJwksUri(ISSUER, noKeys as unknown as typeof fetch),
    ).rejects.toThrow(/no jwks_uri/);

    const failed = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    await expect(
      discoverJwksUri(ISSUER, failed as unknown as typeof fetch),
    ).rejects.toThrow(/HTTP 503/);
  });
});

describe("bearer token extraction", () => {
  it("reads a bearer token case-insensitively and ignores anything else", () => {
    expect(bearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(bearerToken("bearer  abc")).toBe("abc");
    expect(bearerToken("Basic dXNlcjpwYXNz")).toBeNull();
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken("")).toBeNull();
  });
});

describe("provider selection through the configuration boundary (P1, AC-04)", () => {
  const SNAPSHOT = [
    "DATABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_JWT_SECRET",
    "JWT_SECRET",
    "VERITY_SESSION_SECRET",
    "VERITY_AUTH_PROVIDER",
    "VERITY_OIDC_ISSUER",
    "VERITY_OIDC_CLIENT_ID",
    "VERITY_OIDC_REDIRECT_URI",
    "VERITY_OIDC_PRINCIPAL_CLAIM",
    "VERITY_OIDC_CLOCK_TOLERANCE_SECONDS",
  ] as const;

  let snapshot: Record<string, string | undefined>;

  beforeEach(() => {
    vi.resetModules();
    snapshot = Object.fromEntries(SNAPSHOT.map((k) => [k, process.env[k]]));
    for (const key of SNAPSHOT) delete process.env[key];
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/verity_test";
  });

  afterEach(() => {
    for (const key of SNAPSHOT) {
      if (snapshot[key] === undefined) delete process.env[key];
      else process.env[key] = snapshot[key];
    }
  });

  it("defaults to supabase with private signing material (AC-05)", async () => {
    process.env.VERITY_SESSION_SECRET = "private-configuration-test-secret";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://ref.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

    const { runtimeConfig } = await import("@/server/platform/config");
    expect(runtimeConfig.auth.provider).toBe("supabase");
    expect(runtimeConfig.auth.oidc).toBeUndefined();
  });

  it("boots an OIDC deployment with no Supabase variables at all (AC-04)", async () => {
    process.env.VERITY_AUTH_PROVIDER = "oidc";
    process.env.VERITY_OIDC_ISSUER = ISSUER;
    process.env.VERITY_OIDC_CLIENT_ID = CLIENT_ID;
    process.env.VERITY_OIDC_REDIRECT_URI = "https://verity.example.test/api/auth/oidc/callback";
    process.env.VERITY_SESSION_SECRET = "a-session-signing-secret";

    const { runtimeConfig } = await import("@/server/platform/config");

    expect(runtimeConfig.auth.provider).toBe("oidc");
    expect(runtimeConfig.auth.supabaseUrl).toBeUndefined();
    expect(runtimeConfig.auth.oidc).toMatchObject({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      // Defaults, so a minimal enterprise configuration is two variables.
      principalClaim: "sub",
      emailClaim: "email",
      clockToleranceSeconds: 60,
    });
  });

  it("refuses provider=oidc with no issuer configured, naming the variables", async () => {
    process.env.VERITY_AUTH_PROVIDER = "oidc";
    process.env.VERITY_SESSION_SECRET = "s";

    await expect(import("@/server/platform/config")).rejects.toThrow(/VERITY_OIDC_ISSUER/);
  });

  it("refuses an OIDC deployment with no session signing secret", async () => {
    process.env.VERITY_AUTH_PROVIDER = "oidc";
    process.env.VERITY_OIDC_ISSUER = ISSUER;
    process.env.VERITY_OIDC_CLIENT_ID = CLIENT_ID;
    process.env.VERITY_OIDC_REDIRECT_URI = "https://verity.example.test/api/auth/oidc/callback";

    await expect(import("@/server/platform/config")).rejects.toThrow(/VERITY_SESSION_SECRET/);
  });

  it("still refuses a supabase deployment missing its public variables (AC-05)", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

    await expect(import("@/server/platform/config")).rejects.toThrow(
      /NEXT_PUBLIC_SUPABASE_URL is required/,
    );
  });
});

describe("architectural boundary (P10, AC-06)", () => {
  const read = (relative: string) => readFileSync(resolve(process.cwd(), relative), "utf8");

  /**
   * Comments stripped before matching. These assertions are about what the code
   * *does*, and a boundary test that a prose paragraph can fail is a test of
   * the prose — it would push the next author to stop explaining the boundary
   * in order to keep it.
   */
  const codeOf = (relative: string) =>
    read(relative)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("keeps the OIDC verification module free of Next, Supabase and the database", () => {
    const source = codeOf("src/server/platform/oidc.ts");

    expect(source).not.toMatch(/from "next\//);
    expect(source).not.toMatch(/@supabase/);
    expect(source).not.toMatch(/from "\.\/db"/);
    expect(source).not.toMatch(/prisma/i);
  });

  it("confines OIDC and JWT symbols to the adapter, never business logic", () => {
    // The adapter (`auth.ts`) and the verification module are allowed to know
    // about tokens. Nothing else may: the whole point of Task 28's `Principal`
    // is that a capability cannot tell which provider authenticated the actor.
    const forbidden = /\b(jwtVerify|createRemoteJWKSet|OidcSettings|verifyIdToken|id_token)\b/;

    for (const file of [
      "src/server/platform/command.ts",
      "src/server/platform/authorization.ts",
      "src/server/platform/identity.ts",
      "src/server/platform/query.ts",
      "src/server/capabilities/registry.ts",
      "src/server/capabilities/plywood/index.ts",
    ]) {
      expect(codeOf(file), `${file} must not know about OIDC`).not.toMatch(forbidden);
    }
  });

  it("leaves the Principal contract at exactly two fields", () => {
    const source = codeOf("src/server/platform/authProvider.ts");

    // A provider that needed to widen `Principal` to carry its own claims would
    // have broken the boundary Task 28 established; Task 36 did not need to.
    expect(source).toMatch(/id: string;/);
    expect(source).toMatch(/email: string \| null;/);
    expect(source).not.toMatch(/claims/);
  });
});
