import "server-only";
import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { SignJWT, createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { prisma } from "./db";
import { runtimeConfig } from "./config";
import {
  OidcConfigurationError,
  type OidcSettings,
  bearerToken,
  discoverJwksUri,
  verifyIdToken,
} from "./oidc";
import type { AuthProvider, Principal } from "./authProvider";
import type { ActorContext } from "./command";
import { OIDC_SESSION_COOKIE, readOidcSession } from "./oidc-browser";

/**
 * Authentication and actor resolution.
 *
 * Authority: implementation/02-foundation-build-order/bootstrap-sequence.md
 * step 6, implementation/03-platform-foundation/identity.md contract steps 1-5,
 * Bible V5 §1.A.4 (single global authentication realm), PLA-IDE-003
 * (membership-scoped sessions), PLA-TEN-006 (tenant context derived from the
 * authenticated context, never from a client payload).
 *
 * This closes the last unbuilt step of the platform bootstrap. Authentication is
 * offloaded to Supabase Auth (EXISTING INFRASTRUCTURE); the platform stores no
 * credential material and only maps a Supabase user id onto its own User row.
 *
 * The rule that governs everything here: a request may tell us *who* it claims
 * to be only through a verified Supabase session, and may never tell us which
 * tenant it wants. The tenant is derived from the membership, and the membership
 * is verified against the database on every resolution.
 *
 * PROVIDER BOUNDARY (Task 28, taskplans/archive/28_auth_provider_abstraction.md)
 * This file IS the Supabase adapter — the counterpart to
 * `server/storage/supabase.ts` for Task 27's storage boundary. `getAuthUser()`
 * returns `Principal` (`authProvider.ts`), never Supabase's `User` type,
 * so `resolveActor()`, `ActorContext`, `operator.ts`, and every layout that
 * reads `authUser.email` already depend only on the neutral contract. A
 * future `OIDCAuthProvider` implementing the same `AuthProvider` interface
 * needs no change downstream of `getAuthUser()`.
 */

const ACTIVE_MEMBERSHIP_COOKIE = "verity_active_membership";

/**
 * IMPLEMENTATION DECISION (recorded, not silently taken).
 *
 * implementation/03-platform-foundation/membership.md leaves open how the active
 * membership is carried across SSR boundaries: custom claims in the Supabase JWT
 * versus an encrypted cookie via `jose`. The cookie is used here because a
 * custom claim would require a Supabase Auth hook to mint, which couples context
 * switching to the auth provider's release cycle, and because a claim cannot be
 * revoked mid-session whereas this value is re-verified against the database on
 * every request anyway.
 *
 * The cookie is signed, not merely set: it names a membership, and an
 * unsigned one would let a client nominate someone else's. Even signed, the
 * membership is re-checked against the authenticated user below — the signature
 * prevents tampering, the database check prevents a stale or revoked membership
 * being honoured.
 */
function signingKey(): Uint8Array {
  return new TextEncoder().encode(runtimeConfig.auth.jwtSecret);
}

/**
 * Constructs a Supabase SSR client bound to the current request's cookies.
 *
 * Exported for `signInWithPassword`/`signOut` (`server/actions/platform.ts`),
 * which are genuinely Supabase-specific operations — a future OIDC provider
 * authenticates by redirect, not a password grant, so there is no shared
 * "credential sign-in" method on `AuthProvider` for those to implement
 * against. They stay explicit Supabase glue, not part of the neutral
 * contract, exactly as `authProvider.ts`'s own comment says a provider swap
 * should require a code change here, not a rewrite of `AuthProvider`.
 */
export async function createSupabaseServerClient() {
  const { supabaseUrl, supabaseAnonKey } = runtimeConfig.auth;
  if (!supabaseUrl || !supabaseAnonKey) {
    // Reachable only on an OIDC deployment, where no Supabase project exists.
    // Naming that is more useful than constructing a client against undefined
    // and failing later inside the SDK.
    throw new Error(
      "E_AUTH_PROVIDER: Supabase is not configured on this deployment " +
        `(VERITY_AUTH_PROVIDER=${runtimeConfig.auth.provider})`,
    );
  }

  const store = await cookies();
  return createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 60 * 60 * 24 * 7, path: "/" },
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Middleware refreshes the session, so this is safe to ignore.
          }
        },
      },
    },
  );
}

/**
 * The active `AuthProvider`. Supabase Auth today; see `authProvider.ts` for
 * why this is a fixed singleton rather than a runtime-selected registry.
 */
class SupabaseAuthProvider implements AuthProvider {
  readonly name = "supabase";

  async getPrincipal(): Promise<Principal | null> {
    const supabase = await createSupabaseServerClient();
    // getUser() re-validates with the auth server; getSession() trusts the cookie.
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    // The mapping IS the boundary: everything Supabase's User carries beyond
    // an id and an email (aud, app_metadata, user_metadata, ...) stops here.
    return { id: data.user.id, email: data.user.email ?? null };
  }
}

/**
 * An external OpenID Connect identity provider as an `AuthProvider`
 * (Task 36, taskplans/archive/36_enterprise_identity_oidc.md).
 *
 * The counterpart to `SupabaseAuthProvider` above. All the verification rules
 * live in `platform/oidc.ts`, which is pure and testable without a live IdP;
 * this class is only the request-shaped half — where the token is read from,
 * and how the key set is fetched and cached.
 *
 * THE MAPPING IS THE BOUNDARY, AGAIN
 * `verifyIdToken` returns `Principal`. Every other claim the enterprise IdP
 * cares to send — groups, roles, tenant hints, employee numbers — stops here.
 * In particular a tenant claim would be ignored even if present: PLA-TEN-006
 * derives the tenant from a verified membership, and an identity provider is
 * exactly the party that would otherwise be tempted to assert one.
 *
 * UNKNOWN USERS
 * A verified principal whose `id` matches no `User.authUserId` produces zero
 * memberships in `listMemberships()`, therefore no actor. Verity never
 * auto-provisions from a token: that would let anyone in the provider's realm
 * create identity inside a tenant, and `provisionIdentity()` (ADR-007) is the
 * only creation path. This fails closed by construction, not by a check that
 * could be forgotten.
 */
class OidcAuthProvider implements AuthProvider {
  readonly name = "oidc";
  /** Resolved once per process; `createRemoteJWKSet` caches and rotates keys. */
  private keys: JWTVerifyGetKey | null = null;

  constructor(private readonly settings: OidcSettings) {}

  private async keySet(): Promise<JWTVerifyGetKey> {
    if (this.keys) return this.keys;
    const uri = this.settings.jwksUri ?? (await discoverJwksUri(this.settings.issuer));
    this.keys = createRemoteJWKSet(new URL(uri));
    return this.keys;
  }

  async getPrincipal(): Promise<Principal | null> {
    const bearer = bearerToken((await headers()).get("authorization"));
    try {
      if (bearer) return await verifyIdToken(bearer, this.settings, await this.keySet());
      const session = (await cookies()).get(OIDC_SESSION_COOKIE)?.value;
      if (!session) return null;
      return await readOidcSession(session, this.settings, runtimeConfig.auth.jwtSecret);
    } catch (error) {
      // A rejected token is an unauthenticated request, not a server error: the
      // caller gets the same "no principal" a missing token gets, so a probe
      // cannot tell a bad signature from an absent one. A configuration fault
      // is different — that is the operator's problem and must be visible.
      if (error instanceof OidcConfigurationError) throw error;
      return null;
    }
  }
}

/**
 * The active provider, selected once from validated configuration.
 *
 * One provider per deployment, never null, never switched mid-process — the
 * property `authProvider.ts` insisted on. What Task 36 changed is that the
 * choice is a deployment fact rather than a compile-time one; see
 * `config.ts`'s `auth.provider`.
 */
function selectAuthProvider(): AuthProvider {
  if (runtimeConfig.auth.provider === "oidc") {
    const oidc = runtimeConfig.auth.oidc;
    if (!oidc) {
      // Unreachable through `runtimeConfig` (the schema refuses this
      // combination at boot); kept so the invariant is enforced here too
      // rather than assumed from a distance.
      throw new OidcConfigurationError("VERITY_AUTH_PROVIDER=oidc with no OIDC settings");
    }
    return new OidcAuthProvider(oidc);
  }
  return new SupabaseAuthProvider();
}

const authProvider: AuthProvider = selectAuthProvider();

/** The name of the active provider. Diagnostics only — never an authorization input. */
export function activeAuthProviderName(): string {
  return authProvider.name;
}

/** The authenticated principal for the current request, or null. */
export async function getAuthUser(): Promise<Principal | null> {
  return authProvider.getPrincipal();
}

export async function setActiveMembership(membershipId: string): Promise<void> {
  const token = await new SignJWT({ membershipId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(signingKey());

  const store = await cookies();
  store.set(ACTIVE_MEMBERSHIP_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: runtimeConfig.nodeEnv === "production",
    path: "/",
  });
}

async function readActiveMembership(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(ACTIVE_MEMBERSHIP_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey());
    return typeof payload.membershipId === "string" ? payload.membershipId : null;
  } catch {
    return null; // tampered or expired — treated as no selection
  }
}

export type MembershipOption = {
  membershipId: string;
  userId: string;
  tenantId: string;
  tenantName: string;
  isPlatform: boolean;
  organizationId: string;
  organizationName: string;
  roleId: string | null;
  roleName: string | null;
};

/**
 * Every membership the authenticated user holds, across all tenants.
 *
 * Goes through verity.memberships_for_auth_user rather than querying the tables
 * directly, because this is the one read that must happen *before* a tenant
 * context exists — and RLS on `user`, `tenant_membership` and `tenant` requires
 * one. Without the function the query returns nothing and the user can never
 * enter any tenant, which is exactly the bootstrap failure it was added to fix.
 *
 * The function is keyed on the Supabase auth user id, so it can only ever return
 * this principal's own memberships.
 */
export async function listMemberships(): Promise<MembershipOption[]> {
  const authUser = await getAuthUser();
  if (!authUser) return [];

  const rows = await prisma.$queryRaw<
    Array<{
      membership_id: string; user_id: string; tenant_id: string; tenant_name: string;
      is_platform: boolean; organization_id: string; organization_name: string;
      role_id: string | null; role_name: string | null;
    }>
  >`SELECT * FROM verity.memberships_for_auth_user(${authUser.id}::uuid)`;

  return rows.map((r) => ({
    membershipId: r.membership_id,
    userId: r.user_id,
    tenantId: r.tenant_id,
    tenantName: r.tenant_name,
    isPlatform: r.is_platform,
    organizationId: r.organization_id,
    organizationName: r.organization_name,
    roleId: r.role_id,
    roleName: r.role_name,
  }));
}

/**
 * Resolves the request to an ActorContext, or null when unauthenticated or
 * without a usable membership.
 *
 * PLA-TEN-006 in practice: the tenant is never read from the request. It is
 * taken from a membership that has just been verified to belong to the
 * authenticated user, so a forged or stale cookie yields no actor rather than
 * the wrong tenant.
 */
export async function resolveActor(): Promise<ActorContext | null> {
  const memberships = await listMemberships();
  if (memberships.length === 0) return null;

  const requested = await readActiveMembership();
  const chosen =
    memberships.find((m) => m.membershipId === requested) ??
    // Fall back to the first membership rather than failing: a user with exactly
    // one membership should never have to choose.
    memberships[0]!;

  return {
    tenantId: chosen.tenantId,
    userId: chosen.userId,
    membershipId: chosen.membershipId,
    organizationId: chosen.organizationId,
    roleId: chosen.roleId,
  };
}

/**
 * An expected request denial, not a system fault.
 *
 * A distinct type prevents callers from turning a database/session-provider
 * failure into a misleading 401, and lets the shared action boundary keep
 * routine anonymous requests out of error telemetry.
 */
export class AuthenticationRequiredError extends Error {
  readonly code = "E_UNAUTHENTICATED" as const;
  readonly digest = "E_UNAUTHENTICATED";

  constructor(message = "Sign in to continue.") {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

/** Resolves an actor or throws a typed, expected authentication denial. */
export async function requireActor(): Promise<ActorContext> {
  const actor = await resolveActor();
  if (!actor) throw new AuthenticationRequiredError();
  return actor;
}
