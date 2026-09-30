import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { registerCommand, ValidationError, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { recordSecurityEvent } from "@/server/platform/audit";
import type { TenantScopedClient } from "@/server/platform/tenancy";
import { ENTITY_MANUFACTURING_PASSPORT } from "./shared";
import { latestFindings, readCheckpoints } from "./stages";

/**
 * Public verification passport (ADR-030).
 *
 * A passport is a deliberately PUBLISHED, revocable, minimal, FROZEN projection
 * of one completed and fully-inspected order, reachable only by an unguessable
 * token. Nothing is public by default and completing an order publishes nothing:
 * `issue_passport` is an authorized command.
 *
 * What is published is computed ONCE, here, and stored; the public page reads
 * only that stored snapshot (through the `verity.passport_lookup` definer
 * function) and never live order or QC data. So a later edit cannot silently
 * change what a printed code says: a rework or recall is a revocation followed by
 * a new issue. The snapshot carries labels and verdicts only, never remarks,
 * photographs, staff, customers, costs or stock.
 */

/* --------------------------------- tokens --------------------------------- */

const TOKEN_PATTERN = /^vpp_[A-Za-z0-9_-]{43}$/;

/** A fresh token (shown once, in the QR URL) and the hash that is stored instead. */
export function mintPassportToken(): { token: string; hash: string } {
  const token = `vpp_${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashPassportToken(token) };
}

export function hashPassportToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A malformed token is rejected before any database work. */
export function isPassportToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

/* -------------------------------- snapshot -------------------------------- */

export const passportSnapshotSchema = z.object({
  v: z.literal(1),
  tenant: z.string(),
  product: z.string(),
  reference: z.string().nullable(),
  completedAt: z.string(),
  issuedAt: z.string(),
  /** Inspection stages and the checks each passed, by label only. */
  stages: z.array(z.object({ label: z.string(), checks: z.array(z.object({ label: z.string() })) })),
});
export type PassportSnapshot = z.infer<typeof passportSnapshotSchema>;

/**
 * Builds the public projection, or explains why the order cannot be published.
 * Only a COMPLETED order qualifies, and only if it has at least one inspected
 * stage (a passport that verifies nothing is not a passport) and every
 * checkpoint of every inspected stage currently passes.
 */
async function buildSnapshot(
  tx: TenantScopedClient,
  orderId: string,
  tenantId: string,
  reference: string | undefined,
): Promise<PassportSnapshot> {
  const order = await tx.manufacturingOrder.findUnique({ where: { id: orderId }, include: { outputItem: true } });
  if (!order) throw new ValidationError("E_VALIDATION: order not found in this tenant");
  if (order.state !== "completed") throw new ValidationError("E_VALIDATION: only a completed order can be given a passport");

  const completed = await tx.manufacturingOperation.findMany({ where: { orderId, state: "completed" }, orderBy: { sequence: "asc" } });
  // A reworked stage has several completed instances; the latest is the one that stands.
  const byStage = new Map(completed.map((o) => [o.stageKey, o]));
  const inspected = [...byStage.values()].filter((o) => readCheckpoints(o.checkpoints).length > 0);
  if (inspected.length === 0) {
    throw new ValidationError("E_VALIDATION: this order has no inspection checklist, so there is nothing to verify");
  }

  const findings = await tx.manufacturingCheckpointResult.findMany({ where: { operationId: { in: inspected.map((o) => o.id) } } });
  const stages: PassportSnapshot["stages"] = [];
  for (const op of inspected) {
    const latest = latestFindings(findings.filter((f) => f.operationId === op.id));
    const checks = readCheckpoints(op.checkpoints);
    const notPassing = checks.filter((c) => latest.get(c.key)?.result !== "pass");
    if (notPassing.length > 0) {
      throw new ValidationError(`E_VALIDATION: ${op.label} has checkpoints that do not currently pass, so it cannot be published`);
    }
    stages.push({ label: op.label, checks: checks.map((c) => ({ label: c.label })) });
  }

  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const finished = completed.map((o) => o.completedAt).filter((d): d is Date => d !== null);
  const completedAt = (finished.length ? new Date(Math.max(...finished.map((d) => d.getTime()))) : order.updatedAt).toISOString();

  return {
    v: 1,
    tenant: tenant.name,
    product: order.outputItem.name,
    reference: reference?.trim() || null,
    completedAt,
    issuedAt: new Date().toISOString(),
    stages,
  };
}

/* -------------------------------- commands -------------------------------- */

export const issuePassport: CommandDefinition<
  { orderId: string; reference?: string },
  { id: string; token: string }
> = {
  key: "verity.manufacturing.issue_passport",
  entity: ENTITY_MANUFACTURING_PASSPORT,
  verb: "Create",
  input: z.object({ orderId: z.string().uuid(), reference: z.string().trim().max(100).optional() }),
  preconditions: async (ctx, input) => {
    const active = await ctx.tx.manufacturingPassport.count({ where: { orderId: input.orderId, revokedAt: null } });
    if (active > 0) throw new ValidationError("E_VALIDATION: this order already has an active passport; revoke it to issue a new one");
  },
  handler: async (ctx, input) => {
    const snapshot = await buildSnapshot(ctx.tx, input.orderId, ctx.actor.tenantId, input.reference);
    const { token, hash } = mintPassportToken();
    const row = await ctx.tx.manufacturingPassport.create({
      data: {
        tenantId: ctx.actor.tenantId,
        orderId: input.orderId,
        tokenHash: hash,
        snapshot: snapshot as never,
        issuedById: ctx.actor.userId,
      },
    });
    // Publishing is a disclosure decision: it goes on the security stream. The
    // token is never written anywhere; only the passport's id is.
    await recordSecurityEvent(ctx.tx, {
      tenantId: ctx.actor.tenantId,
      eventType: "ConfigurationChanged",
      actorUserId: ctx.actor.userId,
      payload: { action: "passport_issued", passportId: row.id, orderId: input.orderId },
    });
    return {
      result: { id: row.id, token },
      events: [{ name: "verity.manufacturing.passport_issued", entityId: input.orderId }],
    };
  },
};

/** Takes a passport offline at once. The row stays as the record that it existed. */
export const revokePassport: CommandDefinition<{ passportId: string }, { id: string }> = {
  key: "verity.manufacturing.revoke_passport",
  entity: ENTITY_MANUFACTURING_PASSPORT,
  verb: "Edit",
  input: z.object({ passportId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const passport = await ctx.tx.manufacturingPassport.findUniqueOrThrow({ where: { id: input.passportId } });
    if (!passport.revokedAt) {
      await ctx.tx.manufacturingPassport.update({
        where: { id: passport.id },
        data: { revokedAt: new Date(), revokedById: ctx.actor.userId },
      });
      await recordSecurityEvent(ctx.tx, {
        tenantId: ctx.actor.tenantId,
        eventType: "ConfigurationChanged",
        actorUserId: ctx.actor.userId,
        payload: { action: "passport_revoked", passportId: passport.id, orderId: passport.orderId },
      });
    }
    return { result: { id: passport.id }, events: [{ name: "verity.manufacturing.passport_revoked", entityId: passport.orderId }] };
  },
};

/* --------------------------------- queries -------------------------------- */

/** Whether an order has a live passport. Never returns the token (it is not stored). */
export const orderPassport: QueryDefinition<
  { orderId: string },
  { active: { id: string; issuedAt: Date; reference: string | null } | null; revoked: number }
> = {
  key: "verity.manufacturing.order_passport",
  entity: ENTITY_MANUFACTURING_PASSPORT,
  input: z.object({ orderId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const all = await ctx.tx.manufacturingPassport.findMany({ where: { orderId: input.orderId }, orderBy: { issuedAt: "desc" } });
    const active = all.find((p) => !p.revokedAt);
    const snapshot = active ? passportSnapshotSchema.safeParse(active.snapshot) : null;
    return {
      active: active ? { id: active.id, issuedAt: active.issuedAt, reference: snapshot?.success ? snapshot.data.reference : null } : null,
      revoked: all.filter((p) => p.revokedAt).length,
    };
  },
};

export function registerManufacturingPassport(): void {
  registerCommand(issuePassport);
  registerCommand(revokePassport);
  registerQuery(orderPassport);
}
