/**
 * Links an identity-provider account to a Verity membership (Task 129 B2).
 *
 * ADR-020: OIDC memberships are pre-provisioned. The callback route looks the subject up and never creates a membership from a
 * token, so a person can sign in to a tenant only after an operator ran this step. The account itself lives in the identity
 * provider (Keycloak in Mode B); this script holds no credential and calls no identity-provider API.
 *
 *   OIDC_SUB=<uuid> npx tsx prisma/provision-oidc-user.ts <tenant name> <role name> <email> <display name>
 *
 * OIDC_SUB must be the account's `sub` claim and a UUID (Keycloak's user id is). Optional: ORGANIZATION_NAME to place the
 * person in a named organization instead of the tenant's root organization.
 *
 * CHECK_ONLY=1 validates the tenant, role and organization and writes nothing, so the shell wrapper can refuse before it
 * creates an account in the identity provider that nothing would be linked to.
 *
 * Idempotent: a second run for the same subject changes nothing and says so. It never re-assigns a role or moves a person
 * that already exists; do that through the application (HQ People) where it is audited.
 *
 * Connection: the migration role (DIRECT_URL), the same justification as bootstrap-operator.ts. It resolves a tenant by name
 * before any tenant scope exists. Everything it writes goes through verity.provision_identity inside a tenant-scoped
 * transaction, so the database re-checks the tenant and organization itself.
 */
import { PrismaClient } from "@prisma/client";
import { provisionIdentity } from "../src/server/platform/identity";

const [tenantName, roleName, email, displayName] = process.argv.slice(2);
const authUserId = process.env.OIDC_SUB;
const organizationName = process.env.ORGANIZATION_NAME;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!tenantName || !roleName || !email || !displayName) {
  throw new Error("usage: OIDC_SUB=<uuid> provision-oidc-user.ts <tenant name> <role name> <email> <display name>");
}
const checkOnly = process.env.CHECK_ONLY === "1";
if (!checkOnly && (!authUserId || !UUID.test(authUserId))) {
  throw new Error("OIDC_SUB must be set to the identity provider account's subject, a UUID");
}

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });

async function main() {
  const tenants = await admin.$queryRaw<{ id: string }[]>`SELECT id FROM tenant WHERE name = ${tenantName}`;
  if (tenants.length === 0) throw new Error(`no tenant named "${tenantName}"`);
  if (tenants.length > 1) throw new Error(`more than one tenant is named "${tenantName}"; refusing to guess`);
  const tenantId = tenants[0]!.id;

  const existing = checkOnly ? [] : await admin.$queryRaw<{ id: string }[]>`
    SELECT u.id FROM "user" u
    JOIN tenant_membership m ON m.user_id = u.id
    WHERE u.auth_user_id = ${authUserId}::uuid AND m.tenant_id = ${tenantId}::uuid`;
  if (existing.length > 0) {
    console.log(`Already provisioned: subject ${authUserId} is a member of "${tenantName}". Nothing changed.`);
    return;
  }

  const roles = await admin.$queryRaw<{ id: string }[]>`
    SELECT id FROM role WHERE tenant_id = ${tenantId}::uuid AND name = ${roleName}`;
  if (roles.length !== 1) throw new Error(`expected exactly one role "${roleName}" in "${tenantName}", found ${roles.length}`);
  const roleId = roles[0]!.id;

  const orgs = organizationName
    ? await admin.$queryRaw<{ id: string }[]>`
        SELECT id FROM organization WHERE tenant_id = ${tenantId}::uuid AND name = ${organizationName}`
    : await admin.$queryRaw<{ id: string }[]>`
        SELECT id FROM organization WHERE tenant_id = ${tenantId}::uuid AND parent_id IS NULL ORDER BY created_at LIMIT 1`;
  if (orgs.length !== 1) {
    throw new Error(
      organizationName
        ? `expected exactly one organization "${organizationName}" in "${tenantName}", found ${orgs.length}`
        : `"${tenantName}" has no single root organization`,
    );
  }
  const organizationId = orgs[0]!.id;

  if (checkOnly) {
    console.log(`ok: "${tenantName}" has role "${roleName}" and a place for ${email}`);
    return;
  }

  const identity = await admin.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('verity.tenant_id', ${tenantId}, true)`;
    const created = await provisionIdentity(tx as never, { organizationId, authUserId, displayName, email });
    await tx.$executeRaw`UPDATE tenant_membership SET role_id = ${roleId}::uuid WHERE id = ${created.membershipId}::uuid`;
    return created;
  });

  console.log(`Provisioned ${email} in "${tenantName}" as ${roleName} (membership ${identity.membershipId}).`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => admin.$disconnect());
