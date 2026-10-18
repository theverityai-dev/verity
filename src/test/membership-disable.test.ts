import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/platform/db";
import { assertRlsEnforceable, withTenant } from "@/server/platform/tenancy";
import { clearCommands, executeCommand, type ActorContext } from "@/server/platform/command";
import { clearQueries, executeQuery } from "@/server/platform/query";
import { ForbiddenError, clearScopeResolvers } from "@/server/platform/authorization";
import { provisionIdentity } from "@/server/platform/identity";
import { invalidateCapabilityCache } from "@/server/platform/capability";
import { authenticateApiKey } from "@/server/platform/external-auth";
import {
  ENTITY_MEMBERSHIP_ACCESS,
  createApiKey,
  disableMembership,
  installAdministration,
  listPeople,
  resetAdministrationInstall,
  restoreMembership,
} from "@/server/platform/administration";
import { OPERATOR_GRANTS, OPERATOR_ROLE_NAME } from "@/server/platform/operator";

/**
 * ADR-049: a disabled membership authorizes nothing from the next check.
 *
 * Covers the command that flips `disabled_at`, then every place a membership turns into authority: the session
 * (`resolveActor`), the API key, the HQ operator functions and the operator entry points. Each positive case has its refusal
 * beside it. Runs against the real local Postgres through the application role, so RLS is in force.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  const message = "membership-disable.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

const REASON = "left the company";
const ACCESS_GRANTS: Array<[string, string]> = [
  ["ActionExecute", ENTITY_MEMBERSHIP_ACCESS],
  ["Read", "verity.platform.membership"],
];

type Person = { actor: ActorContext; authUserId: string; partyId: string };
type Grants = Array<[string, string]>;

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

describeDb("ADR-049 membership disable and restore", () => {
  const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
  const tenants: string[] = [];

  /** A tenant with a root organization and named roles. Everything is synthetic and removed in afterAll. */
  async function makeTenant(label: string, roles: Record<string, Grants>, opts: { platform?: boolean } = {}) {
    const tenantId = randomUUID();
    tenants.push(tenantId);
    return withTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: `ADR049 ${label} ${tenantId.slice(0, 6)}`, isPlatform: opts.platform ?? false } });
      const org = await tx.organization.create({ data: { tenantId, name: "Root" }, select: { id: true } });
      const roleIds: Record<string, string> = {};
      for (const [name, grants] of Object.entries(roles)) {
        const role = await tx.role.create({ data: { tenantId, name }, select: { id: true } });
        await tx.permission.createMany({
          data: grants.map(([verb, entity]) => ({ tenantId, roleId: role.id, verb: verb as never, entity, scope: "Tenant" as const })),
        });
        roleIds[name] = role.id;
      }
      return { tenantId, orgId: org.id, roleIds };
    });
  }

  async function addPerson(t: { tenantId: string; orgId: string; roleIds: Record<string, string> }, role: string, name: string): Promise<Person> {
    const authUserId = randomUUID();
    const roleId = t.roleIds[role]!;
    const made = await withTenant(t.tenantId, async (tx) => {
      const identity = await provisionIdentity(tx, { organizationId: t.orgId, authUserId, displayName: name });
      await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId } });
      return identity;
    });
    return {
      authUserId,
      partyId: made.partyId,
      actor: { tenantId: t.tenantId, userId: made.userId, membershipId: made.membershipId, organizationId: t.orgId, roleId },
    };
  }

  const state = (m: ActorContext) =>
    withTenant(m.tenantId, (tx) => tx.tenantMembership.findUniqueOrThrow({ where: { id: m.membershipId } }));
  const disable = (by: ActorContext, target: ActorContext, reason: string = REASON) =>
    executeCommand(by, disableMembership, { membershipId: target.membershipId, reason });
  const restore = (by: ActorContext, target: ActorContext, reason = "restored for test") =>
    executeCommand(by, restoreMembership, { membershipId: target.membershipId, reason });

  const OWNER: Grants = [...ACCESS_GRANTS, ["Edit", "verity.platform.membership"], ["Read", "verity.asset.asset"]];

  // Shared fixtures: t1 has two owners; t2 is a separate client.
  let t1: Awaited<ReturnType<typeof makeTenant>>;
  let t2: Awaited<ReturnType<typeof makeTenant>>;
  let ownerA: Person;
  let ownerB: Person;
  let owner2: Person;

  beforeAll(async () => {
    await assertRlsEnforceable();
    clearCommands();
    clearQueries();
    clearScopeResolvers();
    resetAdministrationInstall();
    installAdministration();

    t1 = await makeTenant("One", {
      Owner: OWNER,
      Plain: [["Read", "verity.asset.asset"]],
      "Access Only": ACCESS_GRANTS,
      "Edit Only": [["Edit", "verity.platform.membership"]],
    });
    t2 = await makeTenant("Two", { Owner: OWNER, Plain: [["Read", "verity.asset.asset"]] });
    ownerA = await addPerson(t1, "Owner", "Owner A");
    ownerB = await addPerson(t1, "Owner", "Owner B");
    owner2 = await addPerson(t2, "Owner", "Owner Two");
    invalidateCapabilityCache();
  });

  afterAll(async () => {
    clearCommands();
    clearQueries();
    clearScopeResolvers();
    resetAdministrationInstall();
    try {
      await admin.$executeRaw`DROP TRIGGER IF EXISTS adr049_fail_security_event ON security_audit_event`;
      await admin.$executeRaw`DROP FUNCTION IF EXISTS adr049_fail_security_event()`;
      for (const id of tenants) await admin.$executeRaw`DELETE FROM tenant WHERE id = ${id}::uuid`;
      await admin.$executeRaw`DELETE FROM "user" WHERE id NOT IN (SELECT user_id FROM tenant_membership)`;
      await admin.$executeRaw`DELETE FROM party WHERE id NOT IN (SELECT party_id FROM "user")`;
    } finally {
      await admin.$disconnect();
    }
  });

  /* -------------------------------- schema --------------------------------- */

  it("adds a nullable disabled_at and leaves the three authority functions definer-only with a fixed search_path", async () => {
    const col = await admin.$queryRaw<{ is_nullable: string }[]>`
      SELECT is_nullable FROM information_schema.columns WHERE table_name = 'tenant_membership' AND column_name = 'disabled_at'`;
    expect(col[0]?.is_nullable).toBe("YES");

    const fns = await admin.$queryRaw<{ proname: string; pub: boolean; app: boolean; definer: boolean; cfg: string }[]>`
      SELECT p.proname,
             has_function_privilege('public', p.oid, 'EXECUTE') AS pub,
             has_function_privilege('verity_app', p.oid, 'EXECUTE') AS app,
             p.prosecdef AS definer,
             coalesce(p.proconfig::text, '') AS cfg
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'verity' AND p.proname IN ('memberships_for_auth_user', 'authenticate_api_key', 'is_platform_operator')`;
    expect(fns).toHaveLength(3);
    for (const fn of fns) {
      expect(fn).toMatchObject({ pub: false, app: true, definer: true });
      expect(fn.cfg).toContain("search_path");
    }
  });

  it("keeps RLS enabled and forced on tenant_membership", async () => {
    const [row] = await admin.$queryRaw<{ on: boolean; forced: boolean }[]>`
      SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE relname = 'tenant_membership'`;
    expect(row).toEqual({ on: true, forced: true });
  });

  /* --------------------------- permission and reason ----------------------- */

  it("needs the dedicated permission: Edit on membership is not enough, and an unprivileged role is refused", async () => {
    const target = await addPerson(t1, "Plain", "Target One");
    const plain = await addPerson(t1, "Plain", "Plain Actor");
    const editOnly = await addPerson(t1, "Edit Only", "Edit Only Actor");
    await expect(disable(plain.actor, target.actor)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(disable(editOnly.actor, target.actor)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(restore(plain.actor, target.actor)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await state(target.actor)).disabledAt).toBeNull();
  });

  it.each([["missing", undefined], ["empty", ""], ["blank", "   "], ["too short", "ab"]])(
    "requires a reason (%s) and changes nothing without one",
    async (_label, reason) => {
      const target = await addPerson(t1, "Plain", "Needs A Reason");
      await expect(executeCommand(ownerA.actor, disableMembership, { membershipId: target.actor.membershipId, reason })).rejects.toThrow();
      expect((await state(target.actor)).disabledAt).toBeNull();

      await disable(ownerA.actor, target.actor);
      await expect(executeCommand(ownerA.actor, restoreMembership, { membershipId: target.actor.membershipId, reason })).rejects.toThrow();
      expect((await state(target.actor)).disabledAt).not.toBeNull();
    },
  );

  /* ---------------------------------- guards ------------------------------- */

  it("refuses self-disable", async () => {
    await expect(disable(ownerA.actor, ownerA.actor)).rejects.toThrow(/your own membership/);
    expect((await state(ownerA.actor)).disabledAt).toBeNull();
  });

  it("protects the last active owner; operator memberships neither count as owners nor can the client disable them", async () => {
    const t = await makeTenant("Last Owner", { Owner: ACCESS_GRANTS, Plain: [["Read", "verity.asset.asset"]], [OPERATOR_ROLE_NAME]: OPERATOR_GRANTS.map((g) => [g.verb, g.entity] as [string, string]) });
    const h1 = await addPerson(t, "Owner", "Holder One");
    const h2 = await addPerson(t, "Owner", "Holder Two");
    const plain = await addPerson(t, "Plain","Plain Member");
    const support = await addPerson(t, OPERATOR_ROLE_NAME, "Support Operator");

    // A non-owner can always be disabled, even while the tenant has few owners.
    await disable(h1.actor, plain.actor);
    // Two active owners: one may be disabled.
    await disable(h1.actor, h2.actor);
    // h1 is now the only active owner. The operator holds the permission through OPERATOR_GRANTS but does not count.
    await expect(disable(support.actor, h1.actor)).rejects.toThrow(/last active owner/);
    expect((await state(h1.actor)).disabledAt).toBeNull();
    // The client cannot withdraw the support membership either.
    await expect(disable(h1.actor, support.actor)).rejects.toThrow(/support access/);

    // Restoring the second owner makes disabling the first legal again, and then the second is the last.
    await restore(h1.actor, h2.actor);
    await disable(h2.actor, h1.actor);
    await expect(disable(support.actor, h2.actor)).rejects.toThrow(/last active owner/);
    expect((await state(h2.actor)).disabledAt).toBeNull();
    expect((await state(h1.actor)).disabledAt).not.toBeNull();
  });

  it("is concurrency-safe: two owners disabling each other at once always leave one active", async () => {
    const t = await makeTenant("Race", { Owner: ACCESS_GRANTS });
    const x = await addPerson(t, "Owner", "Racer X");
    const y = await addPerson(t, "Owner", "Racer Y");

    for (let round = 0; round < 10; round++) {
      const settled = await Promise.allSettled([disable(x.actor, y.actor), disable(y.actor, x.actor)]);
      const won = settled.filter((s) => s.status === "fulfilled").length;
      const active = [await state(x.actor), await state(y.actor)].filter((s) => s.disabledAt === null);
      expect(won, `round ${round}: exactly one disable wins`).toBe(1);
      expect(active, `round ${round}: one owner stays active`).toHaveLength(1);
      const lost = settled.find((s) => s.status === "rejected") as PromiseRejectedResult;
      expect(String(lost.reason)).toMatch(/last active owner/);

      const [survivor, loser] = (await state(x.actor)).disabledAt === null ? [x, y] : [y, x];
      await restore(survivor.actor, loser.actor, `reset ${round}`);
    }
  });

  /* ---------------------- the session path (resolveActor) ------------------ */

  describe("session path", () => {
    const REQUIRED_ENV = { NEXT_PUBLIC_SUPABASE_URL: "https://project-ref.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-for-test" };
    let snapshot: Record<string, string | undefined>;
    let jar: ReturnType<typeof fakeCookieStore>;

    beforeEach(() => {
      vi.resetModules();
      snapshot = Object.fromEntries(Object.keys(REQUIRED_ENV).map((k) => [k, process.env[k]]));
      Object.assign(process.env, REQUIRED_ENV);
      jar = fakeCookieStore();
    });
    afterEach(() => {
      for (const k of Object.keys(REQUIRED_ENV)) {
        if (snapshot[k] === undefined) delete process.env[k];
        else process.env[k] = snapshot[k];
      }
      vi.doUnmock("@supabase/ssr");
      vi.doUnmock("next/headers");
    });

    async function signedInAs(authUserId: string) {
      vi.doMock("@supabase/ssr", () => ({
        createServerClient: vi.fn().mockReturnValue({
          auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: authUserId, email: "p@example.com" } }, error: null }) },
        }),
      }));
      vi.doMock("next/headers", () => ({ cookies: vi.fn().mockResolvedValue(jar) }));
      return import("@/server/platform/auth");
    }

    it("a disabled membership resolves to no actor, and a restore resolves again, across repeated cycles", async () => {
      const person = await addPerson(t1, "Plain", "Cycle Person");
      const auth = await signedInAs(person.authUserId);
      expect((await auth.resolveActor())?.membershipId).toBe(person.actor.membershipId);

      for (let cycle = 1; cycle <= 3; cycle++) {
        await disable(ownerA.actor, person.actor, `cycle ${cycle} disable`);
        expect(await auth.resolveActor(), `cycle ${cycle}: disabled`).toBeNull();
        expect(await auth.listMemberships()).toHaveLength(0);
        // requireActor is the gate every server action and route handler passes through.
        await expect(auth.requireActor()).rejects.toBeInstanceOf(auth.AuthenticationRequiredError);

        await restore(ownerA.actor, person.actor, `cycle ${cycle} restore`);
        expect((await auth.resolveActor())?.membershipId, `cycle ${cycle}: restored`).toBe(person.actor.membershipId);
      }
    });

    it("a cookie that still names a disabled membership is not honoured", async () => {
      const person = await addPerson(t1, "Plain", "Cookie Person");
      const auth = await signedInAs(person.authUserId);
      await auth.setActiveMembership(person.actor.membershipId);
      expect((await auth.resolveActor())?.membershipId).toBe(person.actor.membershipId);
      await disable(ownerA.actor, person.actor);
      expect(await auth.resolveActor()).toBeNull();
    });

    it("disabling one workspace leaves the person's other workspace working, even when the cookie names the disabled one", async () => {
      const person = await addPerson(t1, "Plain", "Two Workspaces");
      const inT2 = await withTenant(t2.tenantId, async (tx) => {
        const m = await tx.tenantMembership.create({
          data: { tenantId: t2.tenantId, userId: person.actor.userId, organizationId: t2.orgId, roleId: t2.roleIds.Plain! },
          select: { id: true },
        });
        return { tenantId: t2.tenantId, userId: person.actor.userId, membershipId: m.id, organizationId: t2.orgId, roleId: t2.roleIds.Plain! } as ActorContext;
      });
      const auth = await signedInAs(person.authUserId);
      await auth.setActiveMembership(person.actor.membershipId);
      expect((await auth.resolveActor())?.tenantId).toBe(t1.tenantId);

      await disable(ownerA.actor, person.actor);

      const actor = await auth.resolveActor();
      expect(actor?.tenantId).toBe(t2.tenantId);
      expect(actor?.membershipId).toBe(inT2.membershipId);
      expect((await auth.listMemberships()).map((m) => m.tenantId)).toEqual([t2.tenantId]);
      expect((await state(inT2)).disabledAt).toBeNull();

      await restore(ownerA.actor, person.actor);
      expect((await auth.listMemberships()).map((m) => m.tenantId).sort()).toEqual([t1.tenantId, t2.tenantId].sort());
    });
  });

  /* ---------------------------------- API key ------------------------------ */

  it("an API key stops authorizing when its membership is disabled and works again on restore", async () => {
    const holder = await addPerson(t1, "Plain", "Key Holder");
    const minted = await executeCommand(ownerA.actor, createApiKey, { membershipId: holder.actor.membershipId, name: "ci", expiresInDays: 30 });
    expect((await authenticateApiKey(minted.key))?.actor.membershipId).toBe(holder.actor.membershipId);

    await disable(ownerA.actor, holder.actor);
    expect(await authenticateApiKey(minted.key)).toBeNull();
    await expect(executeCommand(ownerA.actor, createApiKey, { membershipId: holder.actor.membershipId, name: "late", expiresInDays: 30 })).rejects.toThrow(/disabled/);

    await restore(ownerA.actor, holder.actor);
    expect((await authenticateApiKey(minted.key))?.actor.membershipId).toBe(holder.actor.membershipId);
  });

  /* -------------------------------- HQ operator ---------------------------- */

  describe("HQ operator path", () => {
    async function platformTenant() {
      const existing = await admin.$queryRaw<{ id: string }[]>`SELECT id FROM tenant WHERE is_platform LIMIT 1`;
      return existing[0]?.id ?? null;
    }

    /** A person, in the platform tenant, with the given role. Reuses the installation's platform tenant if there is one. */
    async function inPlatform(roles: Record<string, Grants>, who: Array<[string, string]>) {
      const existing = await platformTenant();
      const tenantId = existing ?? randomUUID();
      if (!existing) tenants.push(tenantId);
      return withTenant(tenantId, async (tx) => {
        if (!existing) await tx.tenant.create({ data: { id: tenantId, name: `ADR049 Platform ${tenantId.slice(0, 6)}`, isPlatform: true } });
        const org = await tx.organization.create({ data: { tenantId, name: `ADR049 HQ ${randomUUID().slice(0, 6)}` }, select: { id: true } });
        const roleIds: Record<string, string> = {};
        for (const [name, grants] of Object.entries(roles)) {
          const r = await tx.role.create({ data: { tenantId, name: `${name} ${randomUUID().slice(0, 6)}` }, select: { id: true } });
          await tx.permission.createMany({ data: grants.map(([verb, entity]) => ({ tenantId, roleId: r.id, verb: verb as never, entity, scope: "Tenant" as const })) });
          roleIds[name] = r.id;
        }
        const people: Person[] = [];
        for (const [name, role] of who) {
          const authUserId = randomUUID();
          const i = await provisionIdentity(tx, { organizationId: org.id, authUserId, displayName: name });
          await tx.tenantMembership.update({ where: { id: i.membershipId }, data: { roleId: roleIds[role]! } });
          people.push({ authUserId, partyId: i.partyId, actor: { tenantId, userId: i.userId, membershipId: i.membershipId, organizationId: org.id, roleId: roleIds[role]! } });
        }
        return { tenantId, people };
      });
    }

    it("a disabled platform membership is no longer an operator and the operator_* functions return nothing", async () => {
      const made = await inPlatform(
        { Operator: [["ActionExecute", "verity.platform.operator"]], HqAdmin: [...ACCESS_GRANTS, ["ActionExecute", "verity.platform.operator"]] },
        [["HQ Operator", "Operator"], ["HQ Admin", "HqAdmin"]],
      );
      const [op, hq] = made.people as [Person, Person];

      const isOp = async () => (await prisma.$queryRaw<{ ok: boolean }[]>`SELECT verity.is_platform_operator(${op.authUserId}::uuid) AS ok`)[0]!.ok;
      const rowCount = async (fn: "operator_client_directory" | "operator_platform_activity") =>
        (await prisma.$queryRawUnsafe<unknown[]>(`SELECT * FROM verity.${fn}($1::uuid)`, op.authUserId)).length;
      const auditCount = async () => (await prisma.$queryRaw<unknown[]>`SELECT * FROM verity.operator_platform_audit(${op.authUserId}::uuid, 5)`).length;

      expect(await isOp()).toBe(true);
      expect(await rowCount("operator_client_directory")).toBeGreaterThan(0);

      await disable(hq.actor, op.actor);
      expect(await isOp()).toBe(false);
      expect(await rowCount("operator_client_directory")).toBe(0);
      expect(await rowCount("operator_platform_activity")).toBe(0);
      expect(await auditCount()).toBe(0);

      await restore(hq.actor, op.actor);
      expect(await isOp()).toBe(true);
    });

    it("operatorActorFor and enterClient fail closed on a disabled in-client support membership and never re-enable it", async () => {
      const made = await inPlatform({ Operator: [["ActionExecute", "verity.platform.operator"]] }, [["Support Op", "Operator"]]);
      const op = made.people[0]!;

      vi.resetModules();
      vi.doMock("@/server/platform/auth", async (importOriginal) => ({
        ...(await importOriginal<typeof import("@/server/platform/auth")>()),
        getAuthUser: vi.fn().mockResolvedValue({ id: op.authUserId, email: null }),
        resolveActor: vi.fn().mockResolvedValue(op.actor),
        setActiveMembership: vi.fn().mockResolvedValue(undefined),
      }));
      try {
        const operator = await import("@/server/platform/operator");
        const first = await operator.operatorActorFor(t1.tenantId);
        expect(first.membershipId).toBeTruthy();
        // Out-of-band write: the command refuses to do this (asserted in the guard test), so this is the only way it occurs.
        await admin.$executeRaw`UPDATE tenant_membership SET disabled_at = now() WHERE id = ${first.membershipId}::uuid`;
        await expect(operator.operatorActorFor(t1.tenantId)).rejects.toThrow(/disabled/);
        await expect(operator.enterClient(t1.tenantId, "checking the disabled path")).rejects.toThrow(/disabled/);
        expect((await state(first)).disabledAt).not.toBeNull();
      } finally {
        vi.doUnmock("@/server/platform/auth");
      }
    });
  });

  /* ----------------------------- tenant boundary --------------------------- */

  it("an administrator of one client cannot disable or restore a membership in another", async () => {
    await expect(disable(ownerA.actor, owner2.actor)).rejects.toThrow();
    await expect(restore(ownerA.actor, owner2.actor)).rejects.toThrow();
    expect((await state(owner2.actor)).disabledAt).toBeNull();
  });

  it("restoring cannot escalate: an actor who lacks what the member holds is refused", async () => {
    const target = await addPerson(t1, "Plain", "Ceiling Target");
    const accessOnly = await addPerson(t1, "Access Only", "Access Only Actor");
    await disable(ownerA.actor, target.actor);
    await expect(restore(accessOnly.actor, target.actor)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await state(target.actor)).disabledAt).not.toBeNull();
  });

  /* ----------------------- visibility helpers fail closed ------------------ */

  it("party_visible and user_visible keep a disabled person listed in their own tenant, invisible elsewhere and with no scope", async () => {
    const person = await addPerson(t1, "Plain", "Visible Person");
    await disable(ownerA.actor, person.actor);

    const visibleIn = (tenantId: string) =>
      withTenant(tenantId, async (tx) => {
        const [p] = await tx.$queryRaw<{ v: boolean }[]>`SELECT verity.party_visible(${person.partyId}::uuid) AS v`;
        const [u] = await tx.$queryRaw<{ v: boolean }[]>`SELECT verity.user_visible(${person.actor.userId}::uuid) AS v`;
        return { party: p!.v, user: u!.v };
      });
    expect(await visibleIn(t1.tenantId)).toEqual({ party: true, user: true });
    expect(await visibleIn(t2.tenantId)).toEqual({ party: false, user: false });
    const [bare] = await prisma.$queryRaw<{ v: boolean }[]>`SELECT verity.party_visible(${person.partyId}::uuid) AS v`;
    expect(bare!.v).toBe(false);

    // Administrators still see them, marked disabled, so they can restore.
    const people = await executeQuery(ownerA.actor, listPeople, {});
    expect(people.find((p) => p.membershipId === person.actor.membershipId)?.disabled).toBe(true);
  });

  /* ---------------------------------- audit -------------------------------- */

  it("records who, whom, where, when and why; repeats are no-ops; restore leaves the disable record untouched", async () => {
    const target = await addPerson(t1, "Plain", "Audited Person");
    const rows = () => withTenant(t1.tenantId, (tx) => tx.activity.findMany({
      where: { entityId: target.actor.membershipId, commandKey: { in: ["verity.platform.disable_membership", "verity.platform.restore_membership"] } },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    }));
    const events = () => withTenant(t1.tenantId, (tx) => tx.securityAuditEvent.findMany({
      where: { eventType: { in: ["MembershipDisabled", "MembershipRestored"] }, payload: { path: ["membershipId"], equals: target.actor.membershipId } },
      orderBy: { occurredAt: "asc" },
    }));

    const startedAt = Date.now();
    await disable(ownerA.actor, target.actor, "first reason");
    const afterFirst = await rows();
    expect(afterFirst.length).toBeGreaterThan(0);
    expect(afterFirst.every((r) => r.actorUserId === ownerA.actor.userId && r.entityId === target.actor.membershipId && r.tenantId === t1.tenantId)).toBe(true);
    expect(afterFirst.every((r) => r.occurredAt.getTime() >= startedAt - 5_000)).toBe(true);
    expect(afterFirst.map((r) => r.newValue).join("|")).toContain("first reason");
    const snapshot = JSON.stringify(afterFirst);

    const repeat = await disable(ownerA.actor, target.actor, "again");
    expect(repeat).toMatchObject({ disabled: true, changed: false });
    expect(JSON.stringify(await rows())).toBe(snapshot);

    await restore(ownerB.actor, target.actor, "second reason");
    await disable(ownerA.actor, target.actor, "third reason");

    const all = await rows();
    expect(JSON.stringify(all.slice(0, afterFirst.length))).toBe(snapshot);
    expect(all).toHaveLength(afterFirst.length * 3);
    expect(all.some((r) => r.commandKey === "verity.platform.restore_membership" && r.actorUserId === ownerB.actor.userId)).toBe(true);

    const stream = await events();
    expect(stream.map((e) => e.eventType)).toEqual(["MembershipDisabled", "MembershipRestored", "MembershipDisabled"]);
    expect(stream[0]!.payload).toMatchObject({ membershipId: target.actor.membershipId, targetUserId: target.actor.userId, reason: "first reason" });
    expect(stream[0]!.actorUserId).toBe(ownerA.actor.userId);

    // The application role cannot rewrite or remove the history.
    // Append-only policies refuse by hiding the rows from UPDATE/DELETE, so the write affects nothing (or throws).
    const affected = async (write: (tx: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<{ count: number }>) =>
      withTenant(t1.tenantId, write).then((r) => r.count, () => 0);
    expect(await affected((tx) => tx.activity.deleteMany({ where: { entityId: target.actor.membershipId } }))).toBe(0);
    expect(await affected((tx) => tx.activity.updateMany({ where: { entityId: target.actor.membershipId }, data: { newValue: "x" } }))).toBe(0);
    expect(JSON.stringify((await rows()).slice(0, afterFirst.length))).toBe(snapshot);
  });

  it("is atomic: a failed audit write leaves the membership enabled and writes no activity row", async () => {
    const target = await addPerson(t1, "Plain", "Atomic Person");
    await admin.$executeRaw`
      CREATE OR REPLACE FUNCTION adr049_fail_security_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type::text = 'MembershipDisabled' THEN RAISE EXCEPTION 'adr049 injected audit failure'; END IF;
        RETURN NEW;
      END $$`;
    await admin.$executeRaw`CREATE TRIGGER adr049_fail_security_event BEFORE INSERT ON security_audit_event FOR EACH ROW EXECUTE FUNCTION adr049_fail_security_event()`;
    try {
      await expect(disable(ownerA.actor, target.actor)).rejects.toThrow(/injected audit failure/);
    } finally {
      await admin.$executeRaw`DROP TRIGGER IF EXISTS adr049_fail_security_event ON security_audit_event`;
      await admin.$executeRaw`DROP FUNCTION IF EXISTS adr049_fail_security_event()`;
    }
    expect((await state(target.actor)).disabledAt).toBeNull();
    const written = await withTenant(t1.tenantId, (tx) => tx.activity.count({ where: { entityId: target.actor.membershipId, commandKey: "verity.platform.disable_membership" } }));
    expect(written).toBe(0);

    await disable(ownerA.actor, target.actor);
    expect((await state(target.actor)).disabledAt).not.toBeNull();
  });
});
