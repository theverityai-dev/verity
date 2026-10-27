/**
 * The reusable core of `bootstrap-operator.ts`, extracted so Task 31's tests
 * (`src/test/bootstrap-operator.test.ts`) can exercise it directly rather
 * than shelling out to a CLI script. `bootstrap-operator.ts` is the CLI
 * entrypoint; this file has no argv handling, no `process.exit`, and prints
 * nothing — it returns a result the caller decides how to report.
 *
 * See `bootstrap-operator.ts`'s own header comment for the full authority
 * and design rationale (ADR-013, why this is not part of `seed.ts`, why it
 * connects as the migration role). Nothing about that reasoning changed —
 * this is a mechanical extraction, not a redesign.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { asMigrationRoleInTenant } from "./migration-role";

export const PLATFORM_TENANT_NAME = "Verity Platform";
export const OPERATOR_ROLE_NAME = "Verity Operator";
export const OPERATOR_ENTITY = "verity.platform.operator";

export type MembershipOutcome = "created" | "role_updated" | "already_operator";

export type BootstrapOperatorResult = {
  tenantId: string;
  organizationId: string;
  platformTenantCreated: boolean;
  roleCreated: boolean;
  grantCreated: boolean;
  membershipOutcome: MembershipOutcome;
};

/**
 * Creates the Verity platform tenant if one does not already exist, and
 * grants the identity behind `email` operator authority in it.
 *
 * Idempotent: a second call for the same email, against the same database,
 * makes no further change and reports `membershipOutcome: "already_operator"`
 * rather than erroring or duplicating anything. Throws if no Party/User
 * already carries `email` — this function grants authority, it never creates
 * credentials or an identity, matching `bootstrap-operator.ts`'s own
 * documented boundary.
 */
export async function bootstrapOperator(
  prisma: PrismaClient,
  email: string,
): Promise<BootstrapOperatorResult> {
  // The platform tenant is found by its marker, never by name — the marker is
  // the fact, the name is a label.
  const [existing] = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM tenant WHERE is_platform LIMIT 1`;

  let tenantId = existing?.id;
  let organizationId: string;
  const platformTenantCreated = !tenantId;

  if (tenantId) {
    organizationId = await asMigrationRoleInTenant(prisma, tenantId, async (tx) => {
      const org = await tx.organization.findFirst({
        where: { tenantId, parentId: null },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (!org) throw new Error("platform tenant has no root organization");
      return org.id;
    });
  } else {
    // Setting the scope to the id being created is what lets the INSERT satisfy
    // the tenant policy's WITH CHECK without any role that bypasses RLS.
    tenantId = randomUUID();
    organizationId = await asMigrationRoleInTenant(prisma, tenantId, async (tx) => {
      await tx.tenant.create({
        data: { id: tenantId!, name: PLATFORM_TENANT_NAME, isPlatform: true },
      });
      const org = await tx.organization.create({
        data: { tenantId: tenantId!, name: PLATFORM_TENANT_NAME, parentId: null },
        select: { id: true },
      });
      return org.id;
    });
  }

  // The person. Looked up, never created — see this file's header and
  // `bootstrap-operator.ts`'s. `to_regclass` guards the Supabase-specific
  // `auth.users` match: a bare PostgreSQL instance (Task 30's Compose `db`)
  // does not have that table, and referencing it unconditionally in a
  // static query is a parse-time error there, not a runtime null.
  const [{ has_auth_users }] = await prisma.$queryRaw<{ has_auth_users: boolean }[]>`
    SELECT to_regclass('auth.users') IS NOT NULL AS has_auth_users`;

  const user = has_auth_users
    ? (
        await prisma.$queryRaw<{ user_id: string }[]>`
          SELECT u.id AS user_id
          FROM "user" u
          JOIN party p ON p.id = u.party_id
          LEFT JOIN auth.users au ON au.id = u.auth_user_id
          WHERE lower(p.email) = lower(${email}) OR lower(au.email) = lower(${email})
          LIMIT 1`
      )[0]
    : (
        await prisma.$queryRaw<{ user_id: string }[]>`
          SELECT u.id AS user_id
          FROM "user" u
          JOIN party p ON p.id = u.party_id
          WHERE lower(p.email) = lower(${email})
          LIMIT 1`
      )[0];

  if (!user) {
    throw new Error(
      `no existing identity for ${email}. The person must be able to sign in first; ` +
        `this script grants authority, it does not create credentials.`,
    );
  }

  let roleCreated = false;
  let grantCreated = false;
  let membershipOutcome: MembershipOutcome;

  await asMigrationRoleInTenant(prisma, tenantId, async (tx) => {
    let role = await tx.role.findFirst({
      where: { tenantId, name: OPERATOR_ROLE_NAME },
      select: { id: true },
    });
    if (!role) {
      role = await tx.role.create({
        data: { tenantId, name: OPERATOR_ROLE_NAME },
        select: { id: true },
      });
      roleCreated = true;
    }

    const grant = await tx.permission.findFirst({
      where: { tenantId, roleId: role.id, verb: "ActionExecute", entity: OPERATOR_ENTITY },
      select: { id: true },
    });
    if (!grant) {
      await tx.permission.create({
        data: {
          tenantId,
          roleId: role.id,
          verb: "ActionExecute",
          entity: OPERATOR_ENTITY,
          scope: "Tenant",
        },
      });
      grantCreated = true;
    }

    const membership = await tx.tenantMembership.findFirst({
      where: { tenantId, userId: user.user_id },
      select: { id: true, roleId: true },
    });

    if (!membership) {
      await tx.tenantMembership.create({
        data: { tenantId, userId: user.user_id, organizationId, roleId: role.id },
      });
      membershipOutcome = "created";
    } else if (membership.roleId !== role.id) {
      await tx.tenantMembership.update({
        where: { id: membership.id },
        data: { roleId: role.id },
      });
      membershipOutcome = "role_updated";
    } else {
      membershipOutcome = "already_operator";
    }
  });

  return {
    tenantId,
    organizationId,
    platformTenantCreated,
    roleCreated,
    grantCreated,
    membershipOutcome: membershipOutcome!,
  };
}
