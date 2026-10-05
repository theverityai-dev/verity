import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "./db";
import { withTenant } from "./tenancy";
import type { ActorContext } from "./command";
import { resolveDashboardWidgets } from "./dashboard";

/**
 * Dashboard composition (Authority: Task 108 WP-11B, VCA-009). Same
 * throwaway-tenant pattern as `pack.test.ts`.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  const message = "dashboard.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

const CAPABILITY = `verity.capability.test_dash_${randomUUID().slice(0, 8)}`;

describeDb("Dashboard composition (WP-11B)", () => {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const organizationId = randomUUID();
  let roleId = "";
  let instanceId = "";
  const releaseId = randomUUID();
  let actor: ActorContext;

  beforeAll(async () => {
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      await admin.capabilityDefinition.create({ data: { id: CAPABILITY, name: "Test Dashboard Capability", version: "1.0.0" } });
      // An Active pack instance must point at an applied release (database
      // trigger), and releases are writable only by the migration role.
      await admin.packRelease.create({
        data: {
          id: releaseId, key: "verity.pack.test_dash", version: "1.0.0", digest: `sha256:${randomUUID()}`,
          manifest: {}, publisher: "test", keyId: "test", platformRange: ">=0.1.0",
        },
      });
    } finally {
      await admin.$disconnect();
    }
    await withTenant(tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: `T-dash-${tenantId.slice(0, 4)}` } }));
    const role = await withTenant(tenantId, (tx) => tx.role.create({ data: { tenantId, name: "DashViewer" } }));
    roleId = role.id;
    await withTenant(tenantId, (tx) =>
      tx.permission.create({ data: { tenantId, roleId, verb: "Read", entity: "verity.test.dash_widget", scope: "Tenant" } }),
    );
    await withTenant(tenantId, (tx) =>
      tx.tenantActivation.create({ data: { tenantId, capabilityId: CAPABILITY, status: "Active", pinnedVersion: "1.0.0" } }),
    );
    const instance = await withTenant(tenantId, (tx) =>
      tx.packInstance.create({ data: { tenantId, packKey: "verity.pack.test_dash", state: "Active", appliedReleaseId: releaseId, desiredReleaseId: releaseId } }),
    );
    instanceId = instance.id;
    actor = { tenantId, userId, membershipId, organizationId, roleId };
  });

  afterAll(async () => {
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      await admin.$executeRaw`DELETE FROM tenant WHERE id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM pack_release WHERE id = ${releaseId}::uuid`;
      await admin.$executeRaw`DELETE FROM capability_definition WHERE id = ${CAPABILITY}`;
    } finally {
      await admin.$disconnect();
    }
    await prisma.$disconnect();
  });

  it("resolves a permitted, valid widget and skips an invalid one", async () => {
    await withTenant(tenantId, (tx) =>
      tx.packContribution.createMany({
        data: [
          {
            tenantId,
            instanceId,
            contributionId: "verity.test.dash.good",
            kind: "dashboard",
            ownerCapability: CAPABILITY,
            config: { queryKey: "verity.test.widget_query", title: "Good widget", requiresEntity: "verity.test.dash_widget" },
          },
          {
            tenantId,
            instanceId,
            contributionId: "verity.test.dash.malformed",
            kind: "dashboard",
            ownerCapability: CAPABILITY,
            config: { title: "Missing queryKey and requiresEntity" },
          },
        ],
      }),
    );

    const widgets = await withTenant(tenantId, (tx) => resolveDashboardWidgets(tx, actor));
    expect(widgets).toHaveLength(1);
    expect(widgets[0]!.contributionId).toBe("verity.test.dash.good");
    expect(widgets[0]!.queryKey).toBe("verity.test.widget_query");
  });

  it("excludes a widget whose owning capability is suspended", async () => {
    await withTenant(tenantId, (tx) =>
      tx.tenantActivation.update({ where: { tenantId_capabilityId: { tenantId, capabilityId: CAPABILITY } }, data: { status: "Suspended" } }),
    );
    const widgets = await withTenant(tenantId, (tx) => resolveDashboardWidgets(tx, actor));
    expect(widgets).toHaveLength(0);
  });
});
