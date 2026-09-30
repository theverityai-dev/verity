import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { withTenant } from "./tenancy";
import type { ActorContext } from "./command";
import { hashSecret, parseApiKey, verifySecret } from "./external-tools";

/**
 * Authentication and idempotency for the external tool surface.
 *
 * Authority: ADR-029, ADR-017, PLA-TEN-006, Task 120.
 *
 * `authenticateApiKey` turns a presented key into an ordinary `ActorContext`
 * (tenant, user, membership, organization, role), the same shape a browser
 * session produces, so everything downstream is the unchanged pipeline. The key
 * decides who the caller is; nothing in the request body can.
 */

type KeyRow = {
  tenant_id: string;
  user_id: string;
  membership_id: string;
  organization_id: string;
  role_id: string | null;
  secret_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
};

/** Hashed against when no row exists, so a miss costs the same as a wrong secret. */
const DUMMY_HASH = hashSecret("no-such-key");

export type AuthenticatedKey = { actor: ActorContext; keyId: string };

/** The actor a key stands for, or `null`. Never says WHY, so it cannot be used as an oracle. */
export async function authenticateApiKey(presented: string, now = new Date()): Promise<AuthenticatedKey | null> {
  const parsed = parseApiKey(presented);
  if (!parsed) return null;

  const rows = await prisma.$queryRaw<KeyRow[]>(
    Prisma.sql`SELECT * FROM verity.authenticate_api_key(${parsed.id})`,
  );
  const row = rows[0];
  const secretOk = verifySecret(parsed.secret, row?.secret_hash ?? DUMMY_HASH);
  if (!row || !secretOk) return null;
  if (row.revoked_at || row.expires_at.getTime() <= now.getTime()) return null;

  const actor: ActorContext = {
    tenantId: row.tenant_id,
    userId: row.user_id,
    membershipId: row.membership_id,
    organizationId: row.organization_id,
    roleId: row.role_id,
  };
  return { actor, keyId: parsed.id };
}

/** Best-effort bookkeeping: a failure here must never fail the call it describes. */
export async function touchApiKey(actor: ActorContext, keyId: string): Promise<void> {
  try {
    await withTenant(actor.tenantId, (tx) =>
      tx.externalApiKey.update({ where: { keyId }, data: { lastUsedAt: new Date() } }),
    );
  } catch {
    /* last-used is informational */
  }
}

/* ------------------------------ idempotency ------------------------------ */

export function requestHash(tool: string, input: unknown): string {
  return createHash("sha256").update(JSON.stringify([tool, input ?? null])).digest("hex");
}

export type IdempotencyClaim =
  | { state: "claimed" }
  | { state: "replay"; response: unknown }
  | { state: "in_progress" }
  | { state: "mismatch" };

/**
 * Claims an (Idempotency-Key) for one call before the command runs. The unique
 * constraint is the lock: two concurrent retries cannot both claim it, so a
 * webhook redelivery can never run the same command twice.
 */
export async function claimIdempotency(
  actor: ActorContext,
  keyId: string,
  idempotencyKey: string,
  hash: string,
): Promise<IdempotencyClaim> {
  try {
    await withTenant(actor.tenantId, (tx) =>
      tx.externalIdempotency.create({
        data: { tenantId: actor.tenantId, keyId, idempotencyKey, requestHash: hash },
      }),
    );
    return { state: "claimed" };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
  }

  const existing = await withTenant(actor.tenantId, (tx) =>
    tx.externalIdempotency.findUnique({
      where: { tenantId_keyId_idempotencyKey: { tenantId: actor.tenantId, keyId, idempotencyKey } },
    }),
  );
  if (!existing) return { state: "in_progress" };
  if (existing.requestHash !== hash) return { state: "mismatch" };
  if (existing.response === null) return { state: "in_progress" };
  return { state: "replay", response: existing.response };
}

export async function completeIdempotency(
  actor: ActorContext,
  keyId: string,
  idempotencyKey: string,
  response: unknown,
): Promise<void> {
  await withTenant(actor.tenantId, (tx) =>
    tx.externalIdempotency.update({
      where: { tenantId_keyId_idempotencyKey: { tenantId: actor.tenantId, keyId, idempotencyKey } },
      data: { response: response as Prisma.InputJsonValue },
    }),
  );
}

/** A failed command releases its claim so the caller may retry it; only successes are remembered. */
export async function releaseIdempotency(actor: ActorContext, keyId: string, idempotencyKey: string): Promise<void> {
  await withTenant(actor.tenantId, (tx) =>
    tx.externalIdempotency.deleteMany({ where: { keyId, idempotencyKey } }),
  );
}
