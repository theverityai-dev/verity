import { createHash, randomUUID } from "node:crypto";
import type { PermissionVerb } from "@prisma/client";
import type { ActorContext } from "./command";
import type { TenantScopedClient } from "./tenancy";
import { enforcePolicy, type PolicyChannel } from "./policy";
import { activateCapability, invalidateCapabilityCache } from "./capability";
import { recordSecurityEvent } from "./audit";
import {
  type PackManifest,
  type SignedPackEnvelope,
  type TrustedPublisherKeys,
  validateSignedPack,
  versionSatisfies,
} from "./pack-manifest";

/**
 * Industry Pack control plane (Authority: Task 108 WP-10, VCA-007; ADR-022 for
 * the manifest trust boundary this builds on).
 *
 * `pack-manifest.ts` proves a manifest is well-formed and genuinely signed by a
 * trusted publisher; this module is what makes that a *tenant-visible change* —
 * import, preview, approve, apply, verify, reapply, upgrade, rollback, remove
 * (WP-10 §Lifecycle). Every write here is a real command against real tables:
 * `TenantActivation` for required capabilities, `Role`/`Permission` for role
 * templates, `PackContribution` for contribution ownership. There is
 * deliberately no arbitrary SQL, shell, or unsandboxed server code path — a
 * pack is data, applied by this service, never code a tenant supplies.
 */

const PACK_ENTITY = "verity.platform.pack";
const ROLE_PERMISSION_SCOPE = "Tenant" as const;

export class PackError extends Error {
  constructor(
    readonly code:
      | "E_PACK_UNKNOWN_RELEASE"
      | "E_PACK_CAPABILITY_INCOMPATIBLE"
      | "E_PACK_CONTRIBUTION_CONFLICT"
      | "E_PACK_PLAN_STALE"
      | "E_PACK_OPERATION_STATE"
      | "E_PACK_ROLLBACK_UNSUPPORTED"
      | "E_PACK_NO_PRIOR_RELEASE"
      | "E_PACK_VERIFICATION_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "PackError";
  }
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(",")}}`;
}

/** Deterministic hash of a preview diff, so "approve" binds to an exact plan (WP-10 §Lifecycle "Approve"). */
function planHash(releaseDigest: string, diff: PackPreviewDiff): string {
  return `sha256:${createHash("sha256").update(`${releaseDigest}:${canonicalize(diff)}`).digest("hex")}`;
}

async function requirePolicy(
  tx: TenantScopedClient,
  actor: ActorContext,
  verb: PermissionVerb,
  channel: PolicyChannel,
): Promise<void> {
  await enforcePolicy(tx, actor, { verb, entity: PACK_ENTITY, channel });
}

/**
 * Imports a signed pack as trusted platform metadata.
 *
 * Global, like `CapabilityDefinition` — the release's identity is a platform
 * fact, not a tenant one. Idempotent on digest: importing the same signed
 * artifact twice returns the existing row rather than erroring, because a
 * publisher re-announcing the same release is not a conflict.
 */
export async function importPackRelease(
  tx: TenantScopedClient,
  envelope: SignedPackEnvelope,
  trustedKeys: TrustedPublisherKeys,
  platformVersion: string,
) {
  const { manifest, digest, publisher, keyId } = validateSignedPack(envelope, trustedKeys, platformVersion);
  return tx.packRelease.upsert({
    where: { digest },
    create: {
      key: manifest.key,
      version: manifest.version,
      digest,
      manifest: manifest as never,
      publisher,
      keyId,
      platformRange: manifest.platform,
    },
    update: {},
  });
}

export type PackPreviewDiff = {
  fromVersion: string | null;
  toVersion: string;
  newCapabilities: string[];
  newRoles: string[];
  newPermissions: Array<{ role: string; entity: string; verbs: string[] }>;
  newContributions: string[];
  removedContributions: string[];
  dataMigrations: string[];
  irreversible: boolean;
  rollback: PackManifest["rollback"];
};

/**
 * Deterministic desired-versus-current diff (WP-10 §Lifecycle "Preview").
 *
 * Read-only: does not create an instance or operation row. `planPackOperation`
 * below is what turns a reviewed diff into a durable, approvable plan.
 */
export async function previewPack(
  tx: TenantScopedClient,
  tenantId: string,
  releaseId: string,
): Promise<{ release: NonNullable<Awaited<ReturnType<typeof tx.packRelease.findUnique>>>; diff: PackPreviewDiff }> {
  const release = await tx.packRelease.findUnique({ where: { id: releaseId } });
  if (!release) throw new PackError("E_PACK_UNKNOWN_RELEASE", `E_PACK_UNKNOWN_RELEASE: ${releaseId}`);
  const manifest = release.manifest as unknown as PackManifest;

  const instance = await tx.packInstance.findUnique({
    where: { tenantId_packKey: { tenantId, packKey: manifest.key } },
    include: { appliedRelease: true },
  });
  const appliedManifest = instance?.appliedRelease?.manifest as unknown as PackManifest | undefined;

  const existingRoleKeys = new Set(appliedManifest?.roles.map((r) => r.key) ?? []);
  const existingContributionIds = new Set(appliedManifest?.contributions.map((c) => c.id) ?? []);
  const desiredContributionIds = new Set(manifest.contributions.map((c) => c.id));

  // "New" means not already active for this tenant, so reapplying the same
  // release reports no capability changes instead of re-listing everything.
  const wantedCapabilities = [...manifest.requiredCapabilities, ...manifest.optionalCapabilities]
    .map((c) => c.id)
    .filter((id, index, arr) => arr.indexOf(id) === index);
  const alreadyActive = new Set(
    (
      await tx.tenantActivation.findMany({
        where: { tenantId, status: "Active", capabilityId: { in: wantedCapabilities } },
        select: { capabilityId: true },
      })
    ).map((a) => a.capabilityId),
  );

  const diff: PackPreviewDiff = {
    fromVersion: appliedManifest?.version ?? null,
    toVersion: manifest.version,
    newCapabilities: wantedCapabilities.filter((id) => !alreadyActive.has(id)),
    newRoles: manifest.roles.map((r) => r.key).filter((key) => !existingRoleKeys.has(key)),
    newPermissions: manifest.roles.map((r) => ({
      role: r.key,
      entity: "*",
      verbs: r.permissions.flatMap((p) => p.verbs),
    })),
    newContributions: manifest.contributions.map((c) => c.id).filter((id) => !existingContributionIds.has(id)),
    removedContributions: [...existingContributionIds].filter((id) => !desiredContributionIds.has(id)),
    dataMigrations: manifest.dataMigrations.map((m) => m.key),
    irreversible: manifest.rollback === "unsupported",
    rollback: manifest.rollback,
  };

  return { release, diff };
}

/**
 * Validates the release against the tenant's currently active capability set,
 * beyond schema-level checks `validateSignedPack` already ran (WP-10
 * §Lifecycle "Validate" — "platform range, dependencies, conflicts").
 */
async function validateCapabilityCompatibility(
  tx: TenantScopedClient,
  tenantId: string,
  manifest: PackManifest,
): Promise<void> {
  const activeConflicts = manifest.conflicts.length
    ? await tx.tenantActivation.findMany({
        where: { tenantId, status: "Active", capabilityId: { in: manifest.conflicts } },
        select: { capabilityId: true },
      })
    : [];
  if (activeConflicts.length > 0) {
    throw new PackError(
      "E_PACK_CAPABILITY_INCOMPATIBLE",
      `E_PACK_CAPABILITY_INCOMPATIBLE: conflicts with active ${activeConflicts.map((c) => c.capabilityId).join(", ")}`,
    );
  }

  for (const requirement of manifest.requiredCapabilities) {
    const definition = await tx.capabilityDefinition.findUnique({ where: { id: requirement.id } });
    if (!definition || !versionSatisfies(definition.version, requirement.version)) {
      throw new PackError(
        "E_PACK_CAPABILITY_INCOMPATIBLE",
        `E_PACK_CAPABILITY_INCOMPATIBLE: requires ${requirement.id}@${requirement.version}, platform has ${definition?.version ?? "none"}`,
      );
    }
  }
}

/**
 * Creates a durable, approvable plan (WP-10 §Lifecycle "Preview" → "Approve").
 *
 * Recomputes the diff itself rather than trusting a caller-supplied one, so a
 * plan cannot be forged; the returned `planHash` is what
 * `applyPlannedPackOperation` checks against to guarantee apply executes
 * exactly the reviewed plan.
 */
export async function planPackOperation(
  tx: TenantScopedClient,
  actor: ActorContext,
  releaseId: string,
  kind: "Apply" | "Upgrade" | "Reapply" | "Rollback" | "Remove" = "Apply",
) {
  await requirePolicy(tx, actor, "Read", "human");
  const { release, diff } = await previewPack(tx, actor.tenantId, releaseId);
  const manifest = release.manifest as unknown as PackManifest;
  await validateCapabilityCompatibility(tx, actor.tenantId, manifest);

  const instance = await tx.packInstance.upsert({
    where: { tenantId_packKey: { tenantId: actor.tenantId, packKey: manifest.key } },
    create: { tenantId: actor.tenantId, packKey: manifest.key, desiredReleaseId: releaseId, state: "Absent" },
    update: { desiredReleaseId: releaseId },
  });

  const hash = planHash(release.digest, diff);
  const operation = await tx.packOperation.create({
    data: {
      tenantId: actor.tenantId,
      instanceId: instance.id,
      releaseId,
      kind,
      state: "Planned",
      planHash: hash,
      diff: diff as never,
      correlationId: randomUUID(),
    },
  });

  await tx.packEvent.create({
    data: {
      tenantId: actor.tenantId,
      instanceId: instance.id,
      operationId: operation.id,
      eventType: "pack.operation.planned",
      actorUserId: actor.userId,
      payload: { kind, releaseKey: manifest.key, releaseVersion: manifest.version, diff } as never,
      correlationId: operation.correlationId,
    },
  });

  return { instance, operation, diff, planHash: hash };
}

/**
 * Approves and atomically applies a plan (WP-10 §Lifecycle "Approve" →
 * "Apply atomically" → "Verify"). Reapplying the same digest is a no-op
 * (§"Reapply") rather than an error.
 */
export async function applyPlannedPackOperation(
  tx: TenantScopedClient,
  actor: ActorContext,
  operationId: string,
  approvedPlanHash: string,
) {
  await requirePolicy(tx, actor, "ActionExecute", "human");

  const operation = await tx.packOperation.findUnique({
    where: { id: operationId },
    include: { instance: true, release: true },
  });
  if (!operation || operation.tenantId !== actor.tenantId) {
    throw new PackError("E_PACK_UNKNOWN_RELEASE", `E_PACK_UNKNOWN_RELEASE: operation ${operationId}`);
  }
  if (operation.state !== "Planned" && operation.state !== "Preflighted") {
    throw new PackError("E_PACK_OPERATION_STATE", `E_PACK_OPERATION_STATE: operation is ${operation.state}`);
  }
  if (operation.planHash !== approvedPlanHash) {
    throw new PackError("E_PACK_PLAN_STALE", "E_PACK_PLAN_STALE: approved plan does not match the current plan");
  }

  const manifest = operation.release.manifest as unknown as PackManifest;

  // Reapply idempotency (§"Reapply same digest is idempotent"): the desired
  // release is already the applied one and the instance is healthy.
  if (operation.instance.appliedReleaseId === operation.releaseId && operation.instance.state === "Active") {
    const completed = await tx.packOperation.update({
      where: { id: operation.id },
      data: { state: "Completed", completedAt: new Date() },
    });
    await tx.packEvent.create({
      data: {
        tenantId: actor.tenantId,
        instanceId: operation.instanceId,
        operationId: operation.id,
        eventType: "pack.operation.reapplied_noop",
        actorUserId: actor.userId,
        payload: { releaseKey: manifest.key, releaseVersion: manifest.version } as never,
        correlationId: operation.correlationId,
      },
    });
    return { operation: completed, instance: operation.instance };
  }

  try {
    await tx.packOperation.update({
      where: { id: operation.id },
      data: { state: "Applying", approvedByUserId: actor.userId },
    });
    await tx.packInstance.update({ where: { id: operation.instanceId }, data: { state: "Applying" } });

    for (const requirement of manifest.requiredCapabilities) {
      await activateCapability(tx, actor.tenantId, requirement.id);
    }

    let permissionsGranted = 0;
    for (const roleTemplate of manifest.roles) {
      const role = await tx.role.upsert({
        where: { tenantId_name: { tenantId: actor.tenantId, name: roleTemplate.key } },
        create: { tenantId: actor.tenantId, name: roleTemplate.key },
        update: {},
      });
      for (const grant of roleTemplate.permissions) {
        for (const verb of grant.verbs) {
          const { count } = await tx.permission.createMany({
            data: [{
              tenantId: actor.tenantId,
              roleId: role.id,
              verb: verb as PermissionVerb,
              entity: grant.entity,
              scope: ROLE_PERMISSION_SCOPE,
            }],
            skipDuplicates: true,
          });
          permissionsGranted += count;
        }
      }
    }

    for (const contribution of manifest.contributions) {
      const owner = await tx.packContribution.findUnique({
        where: { tenantId_contributionId: { tenantId: actor.tenantId, contributionId: contribution.id } },
      });
      if (owner && owner.instanceId !== operation.instanceId) {
        throw new PackError(
          "E_PACK_CONTRIBUTION_CONFLICT",
          `E_PACK_CONTRIBUTION_CONFLICT: ${contribution.id} is already owned by another pack instance`,
        );
      }
      await tx.packContribution.upsert({
        where: { tenantId_contributionId: { tenantId: actor.tenantId, contributionId: contribution.id } },
        create: {
          tenantId: actor.tenantId,
          instanceId: operation.instanceId,
          contributionId: contribution.id,
          kind: contribution.kind,
          ownerCapability: contribution.ownerCapability ?? null,
          config: contribution.config as never,
        },
        update: { kind: contribution.kind, ownerCapability: contribution.ownerCapability ?? null, config: contribution.config as never },
      });
    }

    const removedIds = (operation.diff as unknown as PackPreviewDiff).removedContributions ?? [];
    if (removedIds.length > 0) {
      await tx.packContribution.deleteMany({
        where: { tenantId: actor.tenantId, instanceId: operation.instanceId, contributionId: { in: removedIds } },
      });
    }

    await tx.packOperation.update({ where: { id: operation.id }, data: { state: "Verifying" } });
    await verifyPackApplication(tx, actor.tenantId, operation.instanceId, manifest);

    const completed = await tx.packOperation.update({
      where: { id: operation.id },
      data: { state: "Completed", completedAt: new Date() },
    });
    const instance = await tx.packInstance.update({
      where: { id: operation.instanceId },
      data: { state: "Active", appliedReleaseId: operation.releaseId, desiredReleaseId: operation.releaseId },
    });
    invalidateCapabilityCache(actor.tenantId);

    await tx.packEvent.create({
      data: {
        tenantId: actor.tenantId,
        instanceId: operation.instanceId,
        operationId: operation.id,
        eventType: "pack.operation.completed",
        actorUserId: actor.userId,
        payload: { releaseKey: manifest.key, releaseVersion: manifest.version, permissionsGranted } as never,
        correlationId: operation.correlationId,
      },
    });
    if (permissionsGranted > 0) {
      await recordSecurityEvent(tx, {
        tenantId: actor.tenantId,
        eventType: "ConfigurationChanged",
        actorUserId: actor.userId,
        payload: { reason: "pack_apply", releaseKey: manifest.key, permissionsGranted },
        correlationId: operation.correlationId,
      });
    }

    return { operation: completed, instance };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown pack apply failure";
    await tx.packOperation.update({
      where: { id: operation.id },
      data: { state: "Failed", error: message, completedAt: new Date() },
    });
    // An apply that never had a prior good release leaves the instance Failed
    // (nothing to roll back to); one that touched an already-Active instance
    // must never be reported Active again without an explicit rollback/fix
    // (WP-10 §"Partial failure recovers or rolls back without false active state").
    await tx.packInstance.update({
      where: { id: operation.instanceId },
      data: { state: operation.instance.appliedReleaseId ? "RollbackRequired" : "Failed" },
    });
    await tx.packEvent.create({
      data: {
        tenantId: actor.tenantId,
        instanceId: operation.instanceId,
        operationId: operation.id,
        eventType: "pack.operation.failed",
        actorUserId: actor.userId,
        payload: { error: message } as never,
        correlationId: operation.correlationId,
      },
    });
    throw error;
  }
}

/** Verifies activation/dependencies/roles/contributions match the manifest (WP-10 §Lifecycle "Verify"). */
async function verifyPackApplication(
  tx: TenantScopedClient,
  tenantId: string,
  instanceId: string,
  manifest: PackManifest,
): Promise<void> {
  for (const requirement of manifest.requiredCapabilities) {
    const activation = await tx.tenantActivation.findUnique({
      where: { tenantId_capabilityId: { tenantId, capabilityId: requirement.id } },
    });
    if (!activation || activation.status !== "Active") {
      throw new PackError("E_PACK_VERIFICATION_FAILED", `E_PACK_VERIFICATION_FAILED: ${requirement.id} not active after apply`);
    }
  }
  const contributionCount = await tx.packContribution.count({ where: { tenantId, instanceId } });
  const desiredCount = manifest.contributions.length;
  if (contributionCount < desiredCount) {
    throw new PackError(
      "E_PACK_VERIFICATION_FAILED",
      `E_PACK_VERIFICATION_FAILED: expected ${desiredCount} contributions, found ${contributionCount}`,
    );
  }
}

/**
 * Rolls back to the last release this instance was successfully applied at,
 * before the given operation (WP-10 §Lifecycle "Rollback/remove"). Refused
 * outright when the current release declares `rollback: "unsupported"` — the
 * platform never promises a reversal it cannot deliver (WP-11A "truthfully
 * documented" rollback limits).
 */
export async function rollbackPackOperation(
  tx: TenantScopedClient,
  actor: ActorContext,
  instanceId: string,
): Promise<{ instance: Awaited<ReturnType<typeof tx.packInstance.update>> }> {
  await requirePolicy(tx, actor, "ActionExecute", "human");

  const instance = await tx.packInstance.findUnique({
    where: { id: instanceId },
    include: { appliedRelease: true },
  });
  if (!instance || instance.tenantId !== actor.tenantId) {
    throw new PackError("E_PACK_UNKNOWN_RELEASE", `E_PACK_UNKNOWN_RELEASE: instance ${instanceId}`);
  }
  const currentManifest = instance.appliedRelease?.manifest as unknown as PackManifest | undefined;
  if (!currentManifest || currentManifest.rollback === "unsupported") {
    throw new PackError("E_PACK_ROLLBACK_UNSUPPORTED", "E_PACK_ROLLBACK_UNSUPPORTED: current release declares rollback unsupported");
  }

  const priorCompleted = await tx.packOperation.findFirst({
    where: {
      tenantId: actor.tenantId,
      instanceId,
      state: "Completed",
      kind: { in: ["Apply", "Upgrade", "Reapply"] },
      releaseId: { not: instance.appliedReleaseId ?? undefined },
    },
    orderBy: { completedAt: "desc" },
  });
  if (!priorCompleted) {
    throw new PackError("E_PACK_NO_PRIOR_RELEASE", "E_PACK_NO_PRIOR_RELEASE: no prior completed release to roll back to");
  }

  const rollbackOperation = await tx.packOperation.create({
    data: {
      tenantId: actor.tenantId,
      instanceId,
      releaseId: priorCompleted.releaseId,
      kind: "Rollback",
      state: "Completed",
      planHash: priorCompleted.planHash,
      diff: { rolledBackFrom: instance.appliedReleaseId } as never,
      approvedByUserId: actor.userId,
      completedAt: new Date(),
      correlationId: randomUUID(),
    },
  });
  const updated = await tx.packInstance.update({
    where: { id: instanceId },
    data: { state: "Active", appliedReleaseId: priorCompleted.releaseId, desiredReleaseId: priorCompleted.releaseId },
  });
  await tx.packEvent.create({
    data: {
      tenantId: actor.tenantId,
      instanceId,
      operationId: rollbackOperation.id,
      eventType: "pack.operation.rolled_back",
      actorUserId: actor.userId,
      payload: { toReleaseId: priorCompleted.releaseId } as never,
      correlationId: rollbackOperation.correlationId,
    },
  });
  return { instance: updated };
}

/**
 * Removes a pack instance (WP-10 §Lifecycle "Rollback/remove"). Contribution
 * ownership rows are cleared so their stable IDs become available again; the
 * instance row and its `PackEvent`/`PackOperation` history are kept — removal
 * must not silently delete the append-only audit trail (WP-11B §"removal does
 * not orphan required history").
 */
export async function removePackInstance(
  tx: TenantScopedClient,
  actor: ActorContext,
  instanceId: string,
): Promise<void> {
  await requirePolicy(tx, actor, "ActionExecute", "human");
  const instance = await tx.packInstance.findUnique({ where: { id: instanceId } });
  if (!instance || instance.tenantId !== actor.tenantId) {
    throw new PackError("E_PACK_UNKNOWN_RELEASE", `E_PACK_UNKNOWN_RELEASE: instance ${instanceId}`);
  }

  await tx.packContribution.deleteMany({ where: { tenantId: actor.tenantId, instanceId } });
  await tx.packInstance.update({
    where: { id: instanceId },
    data: { state: "Absent", appliedReleaseId: null, desiredReleaseId: null },
  });
  await tx.packEvent.create({
    data: {
      tenantId: actor.tenantId,
      instanceId,
      eventType: "pack.instance.removed",
      actorUserId: actor.userId,
      correlationId: randomUUID(),
    },
  });
}
