import { type JWTPayload, type JWTVerifyGetKey, jwtVerify } from "jose";
import type { Principal } from "./authProvider";

/**
 * OpenID Connect token verification and claim normalization.
 *
 * Authority: taskplans/archive/36_enterprise_identity_oidc.md; Bible V5 §1.A.4 (single
 * global authentication realm); PLA-IDE-003; PLA-TEN-006; ADR-007.
 *
 * This module is deliberately pure. It imports no `next/*`, no `@supabase/*`
 * and nothing that touches the database, so every rule an enterprise actually
 * cares about — is the issuer the one we configured, is the audience us, is the
 * signature ours to trust, has it expired — is a function of its arguments and
 * can be proven without a live identity provider. The request-shaped half (where
 * the token is read from) lives in `auth.ts`, which is the adapter.
 *
 * WHY `jose` AND NOT AN OIDC CLIENT LIBRARY
 * `auth.ts` already signs and verifies the active-membership cookie with `jose`.
 * A dedicated OIDC client would put a second JWT implementation in the tree, and
 * the part of OIDC this platform needs is token verification, not the full
 * relying-party dance.
 *
 * WHAT THIS MODULE REFUSES TO DO
 * It does not create users. A token is a claim about who someone is at the
 * identity provider, never an entitlement to exist inside a tenant — that is
 * `provisionIdentity()` and ADR-007's verified-contact rule. A verified
 * principal with no `User` row therefore resolves to no memberships and no
 * actor: unknown users fail closed by construction rather than by a check
 * somebody has to remember to write.
 *
 * It also never reads a tenant from a token. PLA-TEN-006 is absolute, and an
 * identity provider is exactly the kind of party that would otherwise be
 * tempted to assert one in a claim.
 */

export type OidcSettings = {
  /** The `iss` every accepted token must carry, verbatim. */
  issuer: string;
  /** This deployment's registered client id at the provider. */
  clientId: string;
  /**
   * The `aud` every accepted token must carry. Defaults to `clientId`, which is
   * what an id token carries; an access token issued for a named API resource
   * carries that resource instead, hence the override.
   */
  audience?: string;
  /** JWKS endpoint. Discovered from the issuer when not configured. */
  jwksUri?: string;
  /** Claim carrying the provider's stable subject identifier. */
  principalClaim: string;
  /** Claim carrying the email, for display only (ADR-007: never an identity key). */
  emailClaim: string;
  /** Tolerance for clock skew between this host and the provider. */
  clockToleranceSeconds: number;
  /** Browser relying-party settings. */
  redirectUri?: string;
  clientSecret?: string;
  scopes?: string;
  sessionMaxAgeSeconds?: number;
  sessionIdleSeconds?: number;
};

export type OidcProviderMetadata = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  endSessionEndpoint?: string;
};

export class OidcConfigurationError extends Error {
  readonly code = "E_OIDC_CONFIG" as const;
  constructor(message: string) {
    super(`E_OIDC_CONFIG: ${message}`);
    this.name = "OidcConfigurationError";
  }
}

/**
 * A token was well-formed and correctly signed but does not carry a usable
 * identity. Kept distinct from a verification failure because the operator
 * remedies it differently: this one is a claim-mapping problem at the provider,
 * not an attack.
 */
export class OidcClaimError extends Error {
  readonly code = "E_OIDC_CLAIMS" as const;
  constructor(message: string) {
    super(`E_OIDC_CLAIMS: ${message}`);
    this.name = "OidcClaimError";
  }
}

/** A token failed verification: signature, issuer, audience, expiry or shape. */
export class OidcVerificationError extends Error {
  readonly code = "E_OIDC_VERIFY" as const;
  constructor(message: string) {
    super(`E_OIDC_VERIFY: ${message}`);
    this.name = "OidcVerificationError";
  }
}

/**
 * The discovery document's URL for an issuer.
 *
 * The trailing slash matters: RFC 8414 appends the well-known path to the
 * issuer, and `new URL("./.well-known/...", issuer)` would silently drop the
 * last path segment of a path-carrying issuer — the shape Keycloak uses for
 * every realm (`https://host/realms/acme`).
 */
export function discoveryUrl(issuer: string): string {
  return `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
}

/**
 * Resolves the JWKS endpoint from the provider's discovery document.
 *
 * The document's own `issuer` is compared with the configured one before
 * anything in it is used. Without that check, a redirect or a misconfigured
 * hostname could hand us the key set of a different realm, and every later
 * signature check would pass against the wrong authority.
 */
export async function discoverJwksUri(
  issuer: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const url = discoveryUrl(issuer);
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new OidcConfigurationError(`discovery failed for ${url} (HTTP ${response.status})`);
  }

  const document = (await response.json()) as { issuer?: unknown; jwks_uri?: unknown };

  if (document.issuer !== issuer) {
    throw new OidcConfigurationError(
      `discovery document declares issuer ${String(document.issuer)}, expected ${issuer}`,
    );
  }
  if (typeof document.jwks_uri !== "string" || document.jwks_uri.length === 0) {
    throw new OidcConfigurationError(`discovery document for ${issuer} carries no jwks_uri`);
  }
  return document.jwks_uri;
}

/** Strict discovery used by the interactive authorization-code flow. */
export async function discoverProviderMetadata(
  issuer: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<OidcProviderMetadata> {
  const url = discoveryUrl(issuer);
  const response = await fetchImpl(url, { redirect: "error", signal });
  if (!response.ok) {
    throw new OidcConfigurationError(`discovery failed for ${url} (HTTP ${response.status})`);
  }
  const document = (await response.json()) as Record<string, unknown>;
  if (document.issuer !== issuer) {
    throw new OidcConfigurationError(
      `discovery document declares issuer ${String(document.issuer)}, expected ${issuer}`,
    );
  }

  const endpoint = (name: string): string => {
    const value = document[name];
    if (typeof value !== "string" || value.length === 0) {
      throw new OidcConfigurationError(`discovery document for ${issuer} carries no ${name}`);
    }
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      throw new OidcConfigurationError(`${name} must use HTTPS`);
    }
    return parsed.toString();
  };

  return {
    issuer,
    authorizationEndpoint: endpoint("authorization_endpoint"),
    tokenEndpoint: endpoint("token_endpoint"),
    jwksUri: endpoint("jwks_uri"),
    endSessionEndpoint:
      typeof document.end_session_endpoint === "string"
        ? endpoint("end_session_endpoint")
        : undefined,
  };
}

/**
 * Claims → `Principal`. The only place in the platform where a claim name is
 * written down, which is what keeps every other module free of OIDC.
 */
export function normalizePrincipal(claims: JWTPayload, settings: OidcSettings): Principal {
  const subject = claims[settings.principalClaim];
  if (typeof subject !== "string" || subject.trim().length === 0) {
    throw new OidcClaimError(
      `token carries no usable "${settings.principalClaim}" claim to identify the subject`,
    );
  }

  const email = claims[settings.emailClaim];

  return {
    id: subject,
    // Display only. ADR-007 links identity on a verified contact, never on an
    // email a provider asserts, so a wrong or absent email here can mislead a
    // screen but can never merge two people.
    email: typeof email === "string" && email.length > 0 ? email : null,
  };
}

/**
 * Verifies a token and returns the principal it identifies.
 *
 * `jwtVerify` is given the issuer and audience up front rather than checked
 * afterwards: an `if` after the fact is a branch someone can forget, and the
 * library refusing to return is not.
 */
export async function verifyIdToken(
  token: string,
  settings: OidcSettings,
  keys: JWTVerifyGetKey | CryptoKey | Uint8Array,
  options: { expectedNonce?: string } = {},
): Promise<Principal> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, keys as JWTVerifyGetKey, {
      issuer: settings.issuer,
      audience: settings.audience ?? settings.clientId,
      clockTolerance: settings.clockToleranceSeconds,
      algorithms: ["RS256", "PS256", "ES256"],
    }));
  } catch (error) {
    // The provider's message is kept because an operator debugging a federation
    // problem needs to know *which* check failed; it describes the token, and
    // the token is the caller's own, so nothing is disclosed that they did not
    // already hold.
    throw new OidcVerificationError(error instanceof Error ? error.message : String(error));
  }

  if (options.expectedNonce !== undefined && payload.nonce !== options.expectedNonce) {
    throw new OidcVerificationError("nonce does not match the initiating browser transaction");
  }
  if (payload.azp !== undefined && payload.azp !== settings.clientId) {
    throw new OidcVerificationError("authorized party does not match this client");
  }

  return normalizePrincipal(payload, settings);
}

/** Extracts a bearer token from an `Authorization` header value. */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer[ ]+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}
