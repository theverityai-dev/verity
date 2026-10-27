/**
 * Provisions ONE pre-provisioned OIDC identity for the WP-09 isolated
 * enterprise lab (Task 108 taskplans/108_complete_audit_remediation_and_upgrade_program.md).
 *
 * Lab-only. Never run against a real deployment: it exists so the CI lab can
 * prove the OIDC browser lifecycle (WP-05's own exit criterion — "a fresh
 * IdP/Supabase lab completes the full browser lifecycle") against a real
 * local IdP (Dex) with no Supabase `auth.users` schema available at all,
 * since the bare `docker-compose.yml` Postgres has no Supabase extensions.
 *
 * ADR-020 requires pre-provisioned OIDC memberships — the platform never
 * links a tenant/role from an unverified email/domain claim alone
 * (`src/server/platform/CLAUDE.md` "Authorization shape"; the OIDC callback
 * route looks the subject up via `verity.memberships_for_auth_user`, it does
 * not create one). This script is that pre-provisioning step, done once
 * against a fresh lab database, mirroring `create-login.ts`'s shape but for
 * OIDC (`authUserId` = the IdP's `sub`) instead of a Supabase auth row.
 *
 *   DEX_TEST_USER_ID=<uuid> npx tsx prisma/bootstrap-oidc-lab-identity.ts <email> <displayName>
 *
 * `DEX_TEST_USER_ID` MUST equal the `userID` set for the matching entry in
 * `deploy/lab/dex-config.yaml` — that is what makes Dex's issued `sub` claim
 * resolve to this exact membership.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { provisionIdentity } from "../src/server/platform/identity";
import { bootstrapOperator } from "./operator-bootstrap-core";
import { asMigrationRoleInTenant } from "./migration-role";

const email = process.argv[2];
const displayName = process.argv[3] ?? "WP-09 Lab Operator";
const authUserId = process.env.DEX_TEST_USER_ID;

if (!email) throw new Error("usage: bootstrap-oidc-lab-identity.ts <email> [displayName]");
if (!authUserId) throw new Error("DEX_TEST_USER_ID must be set to the Dex static user's userID (a UUID)");

// Migration-role connection, same justification as `bootstrap-operator.ts`:
// this provisions the platform tenant itself, which has no tenant scope of
// its own to run under.
const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });

async function main() {
  const [existingPlatform] = await admin.$queryRaw<{ id: string }[]>`SELECT id FROM tenant WHERE is_platform LIMIT 1`;

  let tenantId = existingPlatform?.id;
  let organizationId: string;

  if (tenantId) {
    organizationId = await asMigrationRoleInTenant(admin, tenantId, async (tx) => {
      const org = await tx.organization.findFirst({ where: { tenantId, parentId: null }, orderBy: { createdAt: "asc" }, select: { id: true } });
      if (!org) throw new Error("platform tenant has no root organization");
      return org.id;
    });
  } else {
    tenantId = randomUUID();
    organizationId = await asMigrationRoleInTenant(admin, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId!, name: "Verity Platform", isPlatform: true } });
      const org = await tx.organization.create({ data: { tenantId: tenantId!, name: "Verity Platform", parentId: null }, select: { id: true } });
      return org.id;
    });
  }

  const [existingParty] = await admin.$queryRaw<{ id: string }[]>`
    SELECT p.id FROM party p WHERE EXISTS (
      SELECT 1 FROM "user" u WHERE u.party_id = p.id AND u.auth_user_id = ${authUserId}::uuid
    )`;

  if (existingParty) {
    console.log(`Identity for auth_user_id ${authUserId} already provisioned (party ${existingParty.id})`);
  } else {
    const identity = await asMigrationRoleInTenant(admin, tenantId, (tx) =>
      provisionIdentity(tx as never, { organizationId, authUserId: authUserId!, displayName, email }),
    );
    console.log(`Provisioned party ${identity.partyId}, user ${identity.userId}, membership ${identity.membershipId}`);
  }

  const result = await bootstrapOperator(admin, email);
  console.log(`Operator bootstrap: ${result.membershipOutcome} (tenant ${result.tenantId})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => admin.$disconnect());
