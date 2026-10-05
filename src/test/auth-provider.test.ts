import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

/**
 * The auth provider boundary (Task 28).
 *
 * `getAuthUser()`/`resolveActor()` had no unit coverage independent of a live
 * Supabase session before this file — every existing test constructs an
 * `ActorContext` by hand and never exercises principal resolution itself.
 *
 * Two kinds of test here, split by what they need:
 *
 *  - "provider behavior" mocks `@supabase/ssr` and `next/headers` (the same
 *    technique `proxy.test.ts` uses for `@supabase/ssr`) and needs no
 *    database — it verifies `SupabaseAuthProvider`/`getAuthUser()` map a
 *    Supabase session onto a `Principal` and nothing more.
 *  - "identity mapping" additionally needs a real database, since
 *    `verity.memberships_for_auth_user` is a Postgres function — gated by
 *    the same `hasDatabase` convention every other integration test in this
 *    suite uses. It provisions a real User via `provisionIdentity()` (the
 *    only supported path — see identity.ts) with a known `authUserId`, then
 *    mocks only the Supabase layer to report that id as "logged in",
 *    proving `resolveActor()` maps an external identity to the right
 *    Verity user without needing a real Supabase login.
 *
 * Every test dynamically imports `@/server/platform/auth` after
 * `vi.doMock` + `vi.resetModules()` — `createSupabaseServerClient` closes
 * over whatever `createServerClient`/`cookies` were at import time, so a
 * fresh module graph per test is the only way to observe a different mock.
 */

// DATABASE_URL is deliberately NOT touched here: config.ts only requires it
// to be a non-empty string (already true via the real .env setup-env.ts
// loads), and clobbering it with a fake value would break the identity-mapping
// suite below, which needs the real connection to run at all.
const REQUIRED_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project-ref.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-for-test",
};

let envSnapshot: Record<string, string | undefined>;
const createServerClient = vi.fn();

/** A fake cookie jar matching the subset of Next's cookies() API auth.ts uses. */
function fakeCookieStore() {
  const store = new Map<string, { name: string; value: string }>();
  return {
    getAll: () => [...store.values()],
    get: (name: string) => store.get(name),
    set: (name: string, value: string) => {
      store.set(name, { name, value });
    },
  };
}

function mockAuth(getUserResult: { data: { user: unknown }; error: unknown }) {
  vi.doMock("@supabase/ssr", () => ({
    createServerClient: createServerClient.mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue(getUserResult) },
    }),
  }));
  vi.doMock("next/headers", () => ({ cookies: vi.fn().mockResolvedValue(fakeCookieStore()) }));
}

beforeEach(() => {
  vi.resetModules();
  createServerClient.mockReset();
  envSnapshot = Object.fromEntries(
    Object.keys(REQUIRED_ENV).map((k) => [k, process.env[k]]),
  );
  Object.assign(process.env, REQUIRED_ENV);
});

afterEach(() => {
  for (const key of Object.keys(REQUIRED_ENV)) {
    if (envSnapshot[key] === undefined) delete process.env[key];
    else process.env[key] = envSnapshot[key];
  }
  vi.doUnmock("@supabase/ssr");
  vi.doUnmock("next/headers");
});

describe("getAuthUser(): provider behavior", () => {
  it("returns a Principal for an authenticated session", async () => {
    mockAuth({
      data: {
        user: {
          id: "11111111-1111-1111-1111-111111111111",
          email: "person@example.com",
          // Real Supabase User fields no consumer needs — asserted absent below.
          aud: "authenticated",
          app_metadata: { provider: "email" },
          user_metadata: { avatar_url: "https://example.com/a.png" },
          created_at: "2026-01-01T00:00:00Z",
        },
      },
      error: null,
    });

    const { getAuthUser } = await import("@/server/platform/auth");
    const principal = await getAuthUser();

    expect(principal).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      email: "person@example.com",
    });
    // Boundary enforcement: nothing Supabase-shaped survives the mapping.
    expect(Object.keys(principal!).sort()).toEqual(["email", "id"]);
  });

  it("returns null for an unauthenticated session", async () => {
    mockAuth({ data: { user: null }, error: null });

    const { getAuthUser } = await import("@/server/platform/auth");
    expect(await getAuthUser()).toBeNull();
  });

  it("returns null when Supabase reports an auth error (expired/invalid session)", async () => {
    mockAuth({
      data: { user: null },
      error: { message: "invalid JWT: token is expired" },
    });

    const { getAuthUser } = await import("@/server/platform/auth");
    expect(await getAuthUser()).toBeNull();
  });

  it("normalizes a missing email to null rather than undefined", async () => {
    mockAuth({
      data: { user: { id: "22222222-2222-2222-2222-222222222222" } },
      error: null,
    });

    const { getAuthUser } = await import("@/server/platform/auth");
    const principal = await getAuthUser();
    expect(principal?.email).toBeNull();
    expect("email" in principal!).toBe(true);
  });
});

/* ---------------------------------------------------------------------- */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  const message = "auth-provider.test.ts identity-mapping suite cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

describeDb("resolveActor()/listMemberships(): identity mapping", () => {
  const tenantId = randomUUID();
  const knownAuthUserId = randomUUID();
  let orgId: string;
  let userId: string;
  let membershipId: string;

  beforeAll(async () => {
    const { assertRlsEnforceable, withTenant } = await import("@/server/platform/tenancy");
    const { provisionIdentity } = await import("@/server/platform/identity");
    await assertRlsEnforceable();

    await withTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: "Auth Provider Test" } });
      orgId = (await tx.organization.create({ data: { tenantId, name: "HQ" } })).id;
    });

    const identity = await withTenant(tenantId, (tx) =>
      provisionIdentity(tx, {
        organizationId: orgId,
        authUserId: knownAuthUserId,
        displayName: "Provider Test User",
        email: "provider-test@example.com",
      }),
    );
    userId = identity.userId;
    membershipId = identity.membershipId;
  });

  afterAll(async () => {
    const { prisma } = await import("@/server/platform/db");
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      await admin.$executeRaw`DELETE FROM tenant WHERE id = ${tenantId}::uuid`;
    } finally {
      await admin.$disconnect();
    }
    await prisma.$disconnect();
  });

  it("maps a known external identity to its Verity user and membership", async () => {
    mockAuth({ data: { user: { id: knownAuthUserId, email: null } }, error: null });

    const { resolveActor, listMemberships } = await import("@/server/platform/auth");

    const memberships = await listMemberships();
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ userId, membershipId, tenantId });

    const actor = await resolveActor();
    expect(actor).toMatchObject({ userId, membershipId, tenantId, organizationId: orgId });
  });

  it("resolves no membership in a suspended client, says why, and recovers on reactivation (ADR-034)", async () => {
    const { withTenant } = await import("@/server/platform/tenancy");
    const setStatus = (status: string) =>
      withTenant(tenantId, async (tx) => {
        await tx.$executeRaw`SELECT set_config('verity.client_status_change', 'on', true)`;
        await tx.tenant.update({ where: { id: tenantId }, data: { status } });
      });

    await setStatus("suspended");
    try {
      mockAuth({ data: { user: { id: knownAuthUserId, email: null } }, error: null });
      const { resolveActor, listMemberships, suspendedWorkspaceNames } = await import("@/server/platform/auth");
      expect(await listMemberships()).toEqual([]);
      expect(await resolveActor()).toBeNull();
      expect(await suspendedWorkspaceNames()).toEqual(["Auth Provider Test"]);
    } finally {
      await setStatus("active");
    }

    mockAuth({ data: { user: { id: knownAuthUserId, email: null } }, error: null });
    const { listMemberships } = await import("@/server/platform/auth");
    expect(await listMemberships()).toHaveLength(1);
  });

  it("resolves no memberships and no actor for an unknown external identity", async () => {
    mockAuth({ data: { user: { id: randomUUID(), email: null } }, error: null });

    const { resolveActor, listMemberships } = await import("@/server/platform/auth");

    expect(await listMemberships()).toEqual([]);
    expect(await resolveActor()).toBeNull();
  });

  it("resolves no actor at all when there is no authenticated session", async () => {
    mockAuth({ data: { user: null }, error: null });

    const { resolveActor, listMemberships } = await import("@/server/platform/auth");

    expect(await listMemberships()).toEqual([]);
    expect(await resolveActor()).toBeNull();
  });
});
