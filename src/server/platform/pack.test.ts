import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "./db";
import { withTenant, type TenantScopedClient } from "./tenancy";
import type { ActorContext } from "./command";
import { packManifestBytes, packManifestDigest, packManifestSchema, type PackManifest, type SignedPackEnvelope } from "./pack-manifest";
import {
  PackError,
  applyPlannedPackOperation,
  importPackRelease,
  planPackOperation,
  previewPack,
  removePackInstance,
  rollbackPackOperation,
} from "./pack";

/**
 * Industry Pack control plane lifecycle (Authority: Task 108 WP-10, VCA-007).
 *
 * Runs against the configured `DATABASE_URL`, following the same pattern as
 * `src/test/capability-registry.test.ts`: throwaway `randomUUID()` tenant and
 * capability ids that cannot collide with real data, cleaned up in `afterAll`.
 * A dedicated ephemeral lab database (WP-09) is a separate, still-pending exit
 * gate — this proves the service is correct today under the isolation the
 * platform actually enforces (RLS + tenant scoping), not a substitute for it.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  const message = "pack.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

const CAPABILITY = `verity.capability.test_pack_${randomUUID().slice(0, 8)}`;
const CONFLICTING_CAPABILITY = `verity.capability.test_pack_conflict_${randomUUID().slice(0, 8)}`;
const keys = generateKeyPairSync("ed25519");
const publicPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const trusted = new Map([["verity-labs", new Map([["release-1", publicPem]])]]);

function manifestV(version: string, overrides: Partial<PackManifest> = {}): PackManifest {
  return packManifestSchema.parse({
    schemaVersion: 1,
    key: "verity.pack.test_sample",
    version,
    name: "Test sample pack",
    platform: ">=0.1.0 <1.0.0",
    configSchemaVersion: "1.0.0",
    requiredCapabilities: [{ id: CAPABILITY, version: "^1.0.0" }],
    roles: [{ key: "verity.pack.test_sample.operator", permissions: [{ entity: "verity.test.pack_widget", verbs: ["Read", "Create"] }] }],
    contributions: [{ id: `verity.pack.test_sample.dashboard.${version}`, kind: "dashboard" }],
    rollback: "reversible",
    ...overrides,
  });
}

function envelope(manifest: PackManifest): SignedPackEnvelope {
  return {
    manifest,
    digest: packManifestDigest(manifest),
    signature: {
      algorithm: "Ed25519",
      publisher: "verity-labs",
      keyId: "release-1",
      value: sign(null, packManifestBytes(manifest), keys.privateKey).toString("base64"),
    },
  };
}

/**
 * Releases are global platform metadata: readable inside any tenant context but
 * writable only by the privileged import tool (the `pack_release` policy in the
 * control-plane migration has a SELECT policy and no write policy). A
 * tenant-scoped runtime connection is therefore refused by RLS, correctly, so
 * the test imports the way the import tool does: as the migration role.
 */
async function importRelease(manifest: PackManifest) {
  const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
  try {
    return await admin.$transaction((tx) =>
      importPackRelease(tx as unknown as TenantScopedClient, envelope(manifest), trusted, "0.1.0"),
    );
  } finally {
    await admin.$disconnect();
  }
}

describeDb("Industry Pack control plane (WP-10)", () => {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const organizationId = randomUUID();
  let roleId = "";
  let actor: ActorContext;

  beforeAll(async () => {
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      await admin.capabilityDefinition.createMany({
        data: [
          { id: CAPABILITY, name: "Test Pack Capability", version: "1.0.0" },
          { id: CONFLICTING_CAPABILITY, name: "Test Pack Conflict Capability", version: "1.0.0" },
        ],
      });
    } finally {
      await admin.$disconnect();
    }
    await withTenant(tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: `T-pack-${tenantId.slice(0, 4)}` } }));
    const role = await withTenant(tenantId, (tx) =>
      tx.role.create({ data: { tenantId, name: "PackAdmin" } }),
    );
    roleId = role.id;
    await withTenant(tenantId, (tx) =>
      tx.permission.create({
        data: { tenantId, roleId, verb: "ActionExecute", entity: "verity.platform.pack", scope: "Tenant" },
      }),
    );
    await withTenant(tenantId, (tx) =>
      tx.permission.create({
        data: { tenantId, roleId, verb: "Read", entity: "verity.platform.pack", scope: "Tenant" },
      }),
    );
    actor = { tenantId, userId, membershipId, organizationId, roleId };
  });

  afterAll(async () => {
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      await admin.$executeRaw`DELETE FROM tenant WHERE id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM pack_release WHERE key = 'verity.pack.test_sample'`;
      await admin.$executeRaw`DELETE FROM capability_definition WHERE id IN (${CAPABILITY}, ${CONFLICTING_CAPABILITY})`;
    } finally {
      await admin.$disconnect();
    }
    await prisma.$disconnect();
  });

  it("completes empty tenant → import → preview → approve/apply → verify → reapply (WP-10 acceptance scenario)", async () => {
    const release = await importRelease(manifestV("1.0.0"));

    const { diff } = await withTenant(tenantId, (tx) => previewPack(tx, tenantId, release.id));
    expect(diff.fromVersion).toBeNull();
    expect(diff.toVersion).toBe("1.0.0");
    expect(diff.newCapabilities).toContain(CAPABILITY);
    expect(diff.newRoles).toContain("verity.pack.test_sample.operator");

    const planned = await withTenant(tenantId, (tx) => planPackOperation(tx, actor, release.id, "Apply"));
    expect(planned.operation.state).toBe("Planned");

    const applied = await withTenant(tenantId, (tx) =>
      applyPlannedPackOperation(tx, actor, planned.operation.id, planned.planHash),
    );
    expect(applied.operation.state).toBe("Completed");
    expect(applied.instance.state).toBe("Active");
    expect(applied.instance.appliedReleaseId).toBe(release.id);

    const activation = await withTenant(tenantId, (tx) =>
      tx.tenantActivation.findUniqueOrThrow({ where: { tenantId_capabilityId: { tenantId, capabilityId: CAPABILITY } } }),
    );
    expect(activation.status).toBe("Active");

    const role = await withTenant(tenantId, (tx) =>
      tx.role.findUniqueOrThrow({ where: { tenantId_name: { tenantId, name: "verity.pack.test_sample.operator" } } }),
    );
    const permissions = await withTenant(tenantId, (tx) => tx.permission.findMany({ where: { roleId: role.id } }));
    expect(permissions.map((p) => p.verb).sort()).toEqual(["Create", "Read"]);

    const contributions = await withTenant(tenantId, (tx) =>
      tx.packContribution.findMany({ where: { tenantId, instanceId: applied.instance.id } }),
    );
    expect(contributions).toHaveLength(1);

    // Reapply same digest is idempotent (WP-10 §Lifecycle "Reapply").
    const reapplyPlanned = await withTenant(tenantId, (tx) => planPackOperation(tx, actor, release.id, "Apply"));
    expect(reapplyPlanned.diff.newCapabilities).toEqual([]);
    const reapplied = await withTenant(tenantId, (tx) =>
      applyPlannedPackOperation(tx, actor, reapplyPlanned.operation.id, reapplyPlanned.planHash),
    );
    expect(reapplied.operation.state).toBe("Completed");
    const contributionsAfterReapply = await withTenant(tenantId, (tx) =>
      tx.packContribution.count({ where: { tenantId, instanceId: applied.instance.id } }),
    );
    expect(contributionsAfterReapply).toBe(1);
  });

  it("upgrades to a new version and rolls back within the supported boundary", async () => {
    const releaseV2 = await importRelease(manifestV("1.1.0"));
    const planned = await withTenant(tenantId, (tx) => planPackOperation(tx, actor, releaseV2.id, "Upgrade"));
    expect(planned.diff.fromVersion).toBe("1.0.0");

    const applied = await withTenant(tenantId, (tx) =>
      applyPlannedPackOperation(tx, actor, planned.operation.id, planned.planHash),
    );
    expect(applied.instance.appliedReleaseId).toBe(releaseV2.id);

    const rolledBack = await withTenant(tenantId, (tx) => rollbackPackOperation(tx, actor, applied.instance.id));
    expect(rolledBack.instance.appliedReleaseId).not.toBe(releaseV2.id);
    expect(rolledBack.instance.state).toBe("Active");
  });

  it("refuses to apply a plan whose diff changed since it was approved (WP-10 §Approve)", async () => {
    const release = await withTenant(tenantId, (tx) => tx.packRelease.findFirstOrThrow({ where: { version: "1.1.0" } }));
    const planned = await withTenant(tenantId, (tx) => planPackOperation(tx, actor, release.id, "Reapply"));
    await expect(
      withTenant(tenantId, (tx) => applyPlannedPackOperation(tx, actor, planned.operation.id, "sha256:stale")),
    ).rejects.toThrow(PackError);
  });

  it("refuses a pack that conflicts with an already-active capability", async () => {
    await withTenant(tenantId, (tx) => tx.tenantActivation.upsert({
      where: { tenantId_capabilityId: { tenantId, capabilityId: CONFLICTING_CAPABILITY } },
      create: { tenantId, capabilityId: CONFLICTING_CAPABILITY, status: "Active", pinnedVersion: "1.0.0" },
      update: { status: "Active" },
    }));
    const conflicting = await importRelease(manifestV("9.9.9", { conflicts: [CONFLICTING_CAPABILITY] }));
    await expect(
      withTenant(tenantId, (tx) => planPackOperation(tx, actor, conflicting.id, "Apply")),
    ).rejects.toThrow(/E_PACK_CAPABILITY_INCOMPATIBLE/);
  });

  it("removing an instance clears contribution ownership but keeps its history", async () => {
    const release = await withTenant(tenantId, (tx) => tx.packRelease.findFirstOrThrow({ where: { version: "1.1.0" } }));
    const instance = await withTenant(tenantId, (tx) =>
      tx.packInstance.findUniqueOrThrow({ where: { tenantId_packKey: { tenantId, packKey: "verity.pack.test_sample" } } }),
    );
    await withTenant(tenantId, (tx) => removePackInstance(tx, actor, instance.id));

    const afterRemoval = await withTenant(tenantId, (tx) =>
      tx.packInstance.findUniqueOrThrow({ where: { id: instance.id } }),
    );
    expect(afterRemoval.state).toBe("Absent");
    expect(afterRemoval.appliedReleaseId).toBeNull();

    const contributions = await withTenant(tenantId, (tx) =>
      tx.packContribution.count({ where: { tenantId, instanceId: instance.id } }),
    );
    expect(contributions).toBe(0);

    const events = await withTenant(tenantId, (tx) => tx.packEvent.count({ where: { tenantId, instanceId: instance.id } }));
    expect(events).toBeGreaterThan(0);
    void release;
  });
});
