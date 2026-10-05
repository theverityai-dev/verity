import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/server/platform/db";
import { withTenant } from "@/server/platform/tenancy";

/**
 * The HQ operator boundary — ADR-013.
 *
 * These assert the security properties of the mechanism itself, at the database
 * level, where the mechanism actually lives. The application layer is asserted
 * separately by the HQ end-to-end specs; a UI check alone would prove only that
 * a page redirects, not that the projection would have refused anyway.
 *
 * Work plan Workflow D is the shape being proven here: an actor without
 * operator authority attempts a platform-wide read, is refused, and nothing
 * leaks. Denial is as load-bearing as permission.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  const message =
    "operator-boundary.test.ts cannot run: DATABASE_URL is unset, so ADR-013's boundary is NOT verified.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

describeDb("operator authority (ADR-013)", () => {
  it("recognises no operator for an unknown principal", async () => {
    const [row] = await prisma.$queryRaw<{ ok: boolean }[]>`
      SELECT verity.is_platform_operator(${randomUUID()}::uuid) AS ok`;
    expect(row?.ok).toBe(false);
  });

  it("returns nothing from every projection for a non-operator", async () => {
    // A stranger, not merely an unauthorised user — the strongest form of the
    // question, and the one an attacker would ask first.
    const stranger = randomUUID();

    const directory = await prisma.$queryRaw<unknown[]>`
      SELECT * FROM verity.operator_client_directory(${stranger}::uuid)`;
    const activity = await prisma.$queryRaw<unknown[]>`
      SELECT * FROM verity.operator_platform_activity(${stranger}::uuid)`;
    const audit = await prisma.$queryRaw<unknown[]>`
      SELECT * FROM verity.operator_platform_audit(${stranger}::uuid, 10)`;

    // Empty, not an error. A distinguishable error is itself a disclosure —
    // "that function exists and you are not allowed" tells an attacker where to
    // aim next.
    expect(directory).toHaveLength(0);
    expect(activity).toHaveLength(0);
    expect(audit).toHaveLength(0);
  });

  it("refuses a tenant user who holds a role but no operator grant", async () => {
    const tenantId = randomUUID();
    const authUserId = randomUUID();

    await withTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: `boundary-${tenantId.slice(0, 8)}` } });
      const org = await tx.organization.create({
        data: { tenantId, name: "Root" },
        select: { id: true },
      });
      const role = await tx.role.create({
        data: { tenantId, name: "Ordinary" },
        select: { id: true },
      });
      // A real, broad grant — just not the operator one. This is the case that
      // matters: authority inside a tenant must never imply authority above it.
      await tx.permission.create({
        data: { tenantId, roleId: role.id, verb: "Read", entity: "verity.asset.asset", scope: "Tenant" },
      });

      const identity = await tx.$queryRaw<{ user_id: string }[]>`
        SELECT user_id FROM verity.provision_identity(
          ${org.id}::uuid, ${authUserId}::uuid, 'Boundary Tester', NULL, NULL, NULL, NULL)`;
      expect(identity[0]?.user_id).toBeTruthy();

      await tx.tenantMembership.updateMany({
        where: { tenantId, userId: identity[0]!.user_id },
        data: { roleId: role.id },
      });
    });

    const [row] = await prisma.$queryRaw<{ ok: boolean }[]>`
      SELECT verity.is_platform_operator(${authUserId}::uuid) AS ok`;
    expect(row?.ok).toBe(false);

    const directory = await prisma.$queryRaw<unknown[]>`
      SELECT * FROM verity.operator_client_directory(${authUserId}::uuid)`;
    expect(directory).toHaveLength(0);
  });

  it("keeps the platform tenant out of the client directory", async () => {
    // The directory answers "which clients exist". The platform tenant is not a
    // client, and listing it there would invite an operator to enter it as one —
    // exactly the distinction D18 requires be kept.
    const [platform] = await prisma.$queryRaw<{ id: string; name: string }[]>`
      SELECT id, name FROM tenant WHERE is_platform LIMIT 1`;

    if (!platform) {
      // Nothing to prove on an installation that has not been bootstrapped, and
      // inventing a platform tenant here would make the test its own evidence.
      return;
    }

    const [operator] = await prisma.$queryRaw<{ auth_user_id: string }[]>`
      SELECT u.auth_user_id
      FROM "user" u
      JOIN tenant_membership m ON m.user_id = u.id AND m.tenant_id = ${platform.id}::uuid
      LIMIT 1`;
    if (!operator) return;

    const rows = await prisma.$queryRaw<{ tenant_id: string }[]>`
      SELECT tenant_id FROM verity.operator_client_directory(${operator.auth_user_id}::uuid)`;

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.tenant_id === platform.id)).toBe(false);
  });

  it("allows at most one platform tenant", async () => {
    // Two would make "am I an operator?" ambiguous, and an ambiguous authority
    // question gets answered wrongly eventually. Enforced by index, not by code.
    const id = randomUUID();
    const attempt = () =>
      withTenant(id, async (tx) => {
        await tx.tenant.create({ data: { id, name: "Second platform", isPlatform: true } });
      });

    // Counting first is not an option: `tenant` is RLS-protected and the runtime
    // role sees nothing without a scope — which is the isolation working, and a
    // useful reminder that a test written to query "how many exist" would be
    // asserting on an empty result rather than on the truth.
    let created = false;
    try {
      await attempt();
      created = true;
    } catch (error) {
      expect(String(error)).toMatch(/[Uu]nique/);
    }

    if (created) {
      // No platform tenant existed, so the first insert is legitimately allowed.
      // Clean up and prove the SECOND one is refused.
      await expect(attempt()).rejects.toThrow();
      await withTenant(id, (tx) => tx.tenant.delete({ where: { id } }));
    }
  });

  it("refuses a client status change that does not come through the operator action (ADR-034)", async () => {
    const tenantId = randomUUID();
    await withTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: `lifecycle-${tenantId.slice(0, 8)}` } });
    });

    // A tenant-scoped write to its own row is allowed by tenant_isolation, so the
    // trigger is the only thing standing between a client and un-suspending itself.
    await expect(
      withTenant(tenantId, (tx) => tx.tenant.update({ where: { id: tenantId }, data: { status: "suspended" } })),
    ).rejects.toThrow(/operator action/);

    await withTenant(tenantId, async (tx) => {
      await tx.$executeRaw`SELECT set_config('verity.client_status_change', 'on', true)`;
      await tx.tenant.update({ where: { id: tenantId }, data: { status: "suspended" } });
    });
    const [row] = await withTenant(tenantId, (tx) =>
      tx.$queryRaw<{ status: string }[]>`SELECT status FROM tenant WHERE id = ${tenantId}::uuid`,
    );
    expect(row?.status).toBe("suspended");

    // The flag is transaction-local: the next transaction is guarded again.
    await expect(
      withTenant(tenantId, (tx) => tx.tenant.update({ where: { id: tenantId }, data: { status: "active" } })),
    ).rejects.toThrow(/operator action/);

    // Other columns on the tenant row stay writable without the flag.
    await withTenant(tenantId, (tx) => tx.tenant.update({ where: { id: tenantId }, data: { timeZone: "Asia/Kolkata" } }));
  });

  it("rejects an unknown lifecycle value at the database (ADR-034)", async () => {
    const tenantId = randomUUID();
    await expect(
      withTenant(tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: "bad-status", status: "deleted" } })),
    ).rejects.toThrow();
  });

  it("exposes the health counts as fixed columns, still empty for a non-operator (ADR-034)", async () => {
    const columns = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT unnest(proargnames) AS column_name FROM pg_proc
      WHERE proname = 'operator_platform_activity' AND pronamespace = 'verity'::regnamespace`;
    const names = columns.map((c) => c.column_name);
    for (const expected of ["undelivered_events", "sync_exceptions", "sla_breached", "people_invited"]) {
      expect(names).toContain(expected);
    }
    const rows = await prisma.$queryRaw<unknown[]>`
      SELECT * FROM verity.operator_platform_activity(${randomUUID()}::uuid)`;
    expect(rows).toHaveLength(0);
  });
});
