/**
 * Provisions one client-tenant user, with a role and data, for the
 * client-tenant authenticated smoke.
 *
 * Authority: taskplans/123_enterprise_readiness_evidence_program.md, Phase 3.
 *
 * WHY THIS EXISTS
 * The first authenticated smoke signed in as the platform operator, whose
 * tenant is the platform tenant. That proved authentication and RLS mechanics
 * but not the normal path: a client user, in a client tenant, reading that
 * tenant's data through a tenant-scoped capability. The other seeds cannot
 * supply that identity under OIDC (they write Supabase `auth.users`, which a
 * disposable Postgres does not have).
 *
 * WHAT IT DOES, ALL AS THE RUNTIME ROLE
 * Every write runs inside `withTenant`, as `verity_app`, so the tenant policies
 * apply to the provisioning itself. No migration role is used. For the client
 * tenant: a root organization, a role holding only Read on locations, the
 * location capability, a membership for the OIDC subject (ADR-020: the subject
 * must be pre-provisioned, never created at sign-in), and one location. For a
 * second tenant: a root organization, the capability and one location with a
 * different name, so a cross-tenant read has something to find.
 *
 * Both tenants must already exist (`npm run seed:scale` creates them).
 * IDEMPOTENT: re-running neither duplicates nor drifts.
 *
 * REQUIRED INPUTS, no defaults:
 *   SCALE_CONFIRM_DISPOSABLE=1
 *   CLIENT_TENANT_ID, OTHER_TENANT_ID   existing tenant ids
 *   CLIENT_AUTH_USER_ID                 the IdP subject (must be a UUID)
 *   CLIENT_EMAIL, CLIENT_DISPLAY_NAME
 *
 * Run:  node prisma/run-seed.cjs seed-scale-client.ts
 */

import { createHash } from "node:crypto";
import { installCapabilities } from "../src/server/capabilities/registry";
import { activateCapability } from "../src/server/platform/capability";
import { provisionIdentity } from "../src/server/platform/identity";
import { withTenant, type TenantScopedClient } from "../src/server/platform/tenancy";

const LOCATION_CAPABILITY = "verity.capability.location";
const LOCATION_ENTITY = "verity.location.location";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required (no default).`);
  return value;
}

/** Stable ids so a re-run finds what it made. */
function stableId(seed: string): string {
  const h = createHash("md5").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

async function ensureOrg(tx: TenantScopedClient, tenantId: string, name: string): Promise<string> {
  const id = stableId(`${tenantId}-org`);
  await tx.$executeRaw`
    INSERT INTO organization (id, tenant_id, parent_id, name, created_at, updated_at)
    VALUES (${id}::uuid, ${tenantId}::uuid, NULL, ${name}, now(), now())
    ON CONFLICT (id) DO NOTHING`;
  return id;
}

async function ensureLocation(
  tx: TenantScopedClient,
  tenantId: string,
  organizationId: string,
  name: string,
): Promise<string> {
  const id = stableId(`${tenantId}-location-${name}`);
  await tx.$executeRaw`
    INSERT INTO location (id, tenant_id, organization_id, name, active, created_at, updated_at)
    VALUES (${id}::uuid, ${tenantId}::uuid, ${organizationId}::uuid, ${name}, true, now(), now())
    ON CONFLICT (id) DO NOTHING`;
  return id;
}

async function ensureCapability(tx: TenantScopedClient, tenantId: string): Promise<void> {
  const live = await tx.tenantActivation.findFirst({
    where: { capabilityId: LOCATION_CAPABILITY, status: "Active" },
  });
  if (!live) await activateCapability(tx, tenantId, LOCATION_CAPABILITY);
}

async function main() {
  if (process.env.SCALE_CONFIRM_DISPOSABLE !== "1") {
    throw new Error("Set SCALE_CONFIRM_DISPOSABLE=1: this writes tenant data into a disposable database only.");
  }
  if (/supabase\.(com|co)/i.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("DATABASE_URL points at Supabase. Refusing (verity-shared-db-hygiene).");
  }

  const clientTenantId = required("CLIENT_TENANT_ID");
  const otherTenantId = required("OTHER_TENANT_ID");
  const authUserId = required("CLIENT_AUTH_USER_ID");
  const email = required("CLIENT_EMAIL");
  const displayName = required("CLIENT_DISPLAY_NAME");
  installCapabilities();

  const roleId = stableId(`${clientTenantId}-role-reader`);

  const client = await withTenant(clientTenantId, async (tx) => {
    const organizationId = await ensureOrg(tx, clientTenantId, "Smoke Client Org");
    await ensureCapability(tx, clientTenantId);

    await tx.$executeRaw`
      INSERT INTO role (id, tenant_id, name, created_at, updated_at)
      VALUES (${roleId}::uuid, ${clientTenantId}::uuid, 'Smoke Location Reader', now(), now())
      ON CONFLICT (id) DO NOTHING`;
    // Read on locations only: the point of this identity is what it cannot do.
    await tx.permission.createMany({
      data: [{ tenantId: clientTenantId, roleId, verb: "Read", entity: LOCATION_ENTITY, scope: "Tenant" as const }],
      skipDuplicates: true,
    });

    const locationId = await ensureLocation(tx, clientTenantId, organizationId, "Smoke Client Yard");

    const existing = await tx.user.findFirst({ where: { authUserId } });
    let membershipId: string;
    if (existing) {
      const m = await tx.tenantMembership.findFirst({ where: { userId: existing.id } });
      if (!m) throw new Error("user exists without a membership in this tenant");
      await tx.tenantMembership.update({ where: { id: m.id }, data: { roleId, organizationId } });
      membershipId = m.id;
    } else {
      const provisioned = await provisionIdentity(tx, { organizationId, authUserId, displayName, email });
      await tx.tenantMembership.update({ where: { id: provisioned.membershipId }, data: { roleId } });
      membershipId = provisioned.membershipId;
    }
    return { organizationId, locationId, membershipId };
  });

  const other = await withTenant(otherTenantId, async (tx) => {
    const organizationId = await ensureOrg(tx, otherTenantId, "Other Tenant Org");
    await ensureCapability(tx, otherTenantId);
    const locationId = await ensureLocation(tx, otherTenantId, organizationId, "Other Tenant Yard");
    return { organizationId, locationId };
  });

  console.log(JSON.stringify({ client: { tenantId: clientTenantId, ...client }, other: { tenantId: otherTenantId, ...other } }, null, 2));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
