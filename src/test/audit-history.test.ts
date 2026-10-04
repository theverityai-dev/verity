import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/platform/db";
import { assertRlsEnforceable, withTenant } from "@/server/platform/tenancy";
import { activateCapability, invalidateCapabilityCache } from "@/server/platform/capability";
import {
  REDACTED,
  diffFields,
  isSensitiveField,
  recordActivity,
  recordSecurityEvent,
  reconstructHistory,
  reconstructRequest,
  redactPayload,
} from "@/server/platform/audit";
import {
  clearCommands,
  executeCommand,
  registerCommand,
  type ActorContext,
  type CommandDefinition,
} from "@/server/platform/command";

/**
 * Task 38 — Audit & Business History.
 * Plan: taskplans/archive/38_audit_business_history.md.
 *
 * The claim under test is the brief's: a sensitive business mutation can be
 * reconstructed — who did what, to which object, when, and what changed — and
 * no secret is retained while doing it.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  const message = "audit-history.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

const ENTITY = "verity.test.contract";
const CAPABILITY = "verity.capability.audit_history_test";

describe("sensitive value withholding (AC-03)", () => {
  it("recognises the field names whose values must never be stored", () => {
    for (const field of [
      "password", "passwordHash", "apiKey", "api_key", "clientSecret",
      "accessToken", "refresh_token", "credential", "privateKey", "otp",
      "pin", "salt", "signingKey", "otpCode",
    ]) {
      expect(isSensitiveField(field), field).toBe(true);
    }
  });

  it("errs toward withholding: a name containing a secret word is treated as one", () => {
    // Substring matching, deliberately. `tokenizerVersion` is not a secret and
    // is withheld anyway, which costs an audit reader one field of detail. The
    // opposite error costs a customer a leaked credential in a table that
    // cannot be edited afterwards. The asymmetry decides the design.
    expect(isSensitiveField("tokenizerVersion")).toBe(true);
  });

  it("does not withhold ordinary business fields", () => {
    for (const field of [
      "price", "quantity", "customerName", "status", "keyAccountManager",
      "description", "signatureRequired", "keyAccountId",
    ]) {
      expect(isSensitiveField(field), field).toBe(false);
    }
  });

  it("redacts a payload recursively while preserving its shape", () => {
    const payload = redactPayload({
      action: "rotate",
      apiKey: "sk-live-real-value",
      nested: { clientSecret: "another", region: "ap-south-1" },
      counts: [1, 2, 3],
      clearedToken: null,
    });

    expect(payload).toEqual({
      action: "rotate",
      apiKey: REDACTED,
      nested: { clientSecret: REDACTED, region: "ap-south-1" },
      counts: [1, 2, 3],
      // A cleared secret stays null: "removed" and "set to something" are
      // different events and must not flatten into one.
      clearedToken: null,
    });
  });
});

describe("diffFields", () => {
  it("records only fields whose value actually changed", () => {
    const changes = diffFields(
      { price: 100, status: "Draft", updatedAt: new Date(0) },
      { price: 120, status: "Draft", updatedAt: new Date(1) },
    );
    expect(changes.map((c) => c.field)).toEqual(["price"]);
  });
});

describeDb("audit and business history (Task 38)", () => {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const subjectId = randomUUID();
  let roleId: string;
  let organizationId: string;

  const actor = (): ActorContext => ({
    tenantId,
    userId,
    membershipId: randomUUID(),
    organizationId,
    roleId,
  });

  beforeAll(async () => {
    await assertRlsEnforceable();
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      await admin.capabilityDefinition.create({
        data: { id: CAPABILITY, name: "Audit history test", version: "1.0.0", entityTypes: [ENTITY] },
      });
      await admin.entityDefinition.create({
        data: { key: ENTITY, capability: CAPABILITY, class: "Persistent", tableName: "contract" },
      });
    } finally {
      await admin.$disconnect();
    }

    await withTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: "Audit Tenant" } });
      await activateCapability(tx, tenantId, CAPABILITY);
      organizationId = (await tx.organization.create({ data: { tenantId, name: "HQ" } })).id;
      roleId = (await tx.role.create({ data: { tenantId, name: "Contract Manager" } })).id;
      await tx.permission.createMany({
        data: [
          { tenantId, roleId, verb: "Edit", entity: ENTITY, scope: "Tenant" },
          { tenantId, roleId, verb: "Read", entity: ENTITY, scope: "Tenant" },
        ],
      });
    });
    invalidateCapabilityCache();
  });

  afterAll(async () => {
    clearCommands();
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      await admin.$executeRaw`DELETE FROM tenant WHERE id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM entity_definition WHERE key = ${ENTITY}`;
      await admin.$executeRaw`DELETE FROM capability_definition WHERE id = ${CAPABILITY}`;
    } finally {
      await admin.$disconnect();
    }
    await prisma.$disconnect();
  });

  /**
   * The command under test: a realistic sensitive mutation — a contract's
   * price is renegotiated and its integration credential is rotated in the
   * same operation, publishing a fact.
   */
  const repriceCommand: CommandDefinition<{ price: number; apiKey: string }, { ok: true }> = {
    key: "verity.test.contract.reprice",
    entity: ENTITY,
    verb: "Edit",
    input: z.object({ price: z.number(), apiKey: z.string() }),
    handler: async (ctx, input) => {
      await recordActivity(ctx, {
        entityKey: ENTITY,
        entityId: subjectId,
        commandKey: "verity.test.contract.reprice",
        changes: diffFields(
          { price: 1000, apiKey: "sk-live-OLD-SECRET-VALUE" },
          { price: input.price, apiKey: input.apiKey },
        ),
      });
      return {
        result: { ok: true } as const,
        events: [{ name: "verity.contract.repriced", entityId: subjectId, payload: { price: input.price } }],
      };
    },
  };

  it("correlates every row one command writes (AC-01, AC-05)", async () => {
    registerCommand(repriceCommand);
    await executeCommand(actor(), repriceCommand, { price: 1250, apiKey: "sk-live-NEW-SECRET" }, "human");

    const { changes, facts } = await withTenant(tenantId, async (tx) => {
      const rows = await tx.activity.findMany({ where: { entityId: subjectId } });
      const correlationId = rows[0]!.correlationId!;
      return reconstructRequest(tx, correlationId);
    });

    // Two field changes and one published fact, all in one request.
    expect(changes).toHaveLength(2);
    expect(facts).toHaveLength(1);

    const ids = new Set([...changes, ...facts].map((e) => e.correlationId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toBeTruthy();
  });

  it("records the channel the mutation arrived through (AC-02)", async () => {
    const rows = await withTenant(tenantId, (tx) =>
      tx.activity.findMany({ where: { entityId: subjectId } }),
    );

    // "human" was passed explicitly above; nothing defaulted it.
    expect(new Set(rows.map((r) => r.source))).toEqual(new Set(["human"]));

    const events = await withTenant(tenantId, (tx) =>
      tx.domainEvent.findMany({ where: { entityId: subjectId } }),
    );
    expect(events[0]!.source).toBe("human");
  });

  it("defaults an unstated channel to api, not to human (AC-02)", async () => {
    const other = randomUUID();
    const command: CommandDefinition<Record<string, never>, { ok: true }> = {
      key: "verity.test.contract.touch",
      entity: ENTITY,
      verb: "Edit",
      input: z.object({}),
      handler: async (ctx) => {
        await recordActivity(ctx, {
          entityKey: ENTITY,
          entityId: other,
          changes: [{ field: "status", oldValue: "Draft", newValue: "Active" }],
        });
        return { result: { ok: true } as const };
      },
    };
    registerCommand(command);
    await executeCommand(actor(), command, {});

    const rows = await withTenant(tenantId, (tx) =>
      tx.activity.findMany({ where: { entityId: other } }),
    );
    // A server action or route handler is an API caller. Recording it as a
    // human would be a fabricated fact in an evidence table.
    expect(rows[0]!.source).toBe("api");
  });

  it("never writes a secret value, but does record that it changed (AC-03)", async () => {
    const rows = await withTenant(tenantId, (tx) =>
      tx.activity.findMany({ where: { entityId: subjectId }, orderBy: { fieldChanged: "asc" } }),
    );

    const secret = rows.find((r) => r.fieldChanged === "apiKey")!;
    const price = rows.find((r) => r.fieldChanged === "price")!;

    // The change is recorded — who, when, which field.
    expect(secret.actorUserId).toBe(userId);
    expect(secret.commandKey).toBe("verity.test.contract.reprice");
    // The values are not.
    expect(secret.oldValue).toBe(REDACTED);
    expect(secret.newValue).toBe(REDACTED);
    expect(JSON.stringify(rows)).not.toContain("sk-live-OLD-SECRET-VALUE");
    expect(JSON.stringify(rows)).not.toContain("sk-live-NEW-SECRET");

    // An ordinary business value is retained in full: that is the evidence.
    expect(price.oldValue).toBe("1000");
    expect(price.newValue).toBe("1250");
  });

  it("reconstructs who did what, to which object, when, and what changed (AC-04)", async () => {
    const history = await withTenant(tenantId, (tx) =>
      reconstructHistory(tx, ENTITY, subjectId),
    );

    expect(history.length).toBeGreaterThanOrEqual(3);
    // Oldest first — a history is read forwards.
    for (let i = 1; i < history.length; i += 1) {
      expect(history[i]!.occurredAt.getTime()).toBeGreaterThanOrEqual(
        history[i - 1]!.occurredAt.getTime(),
      );
    }

    const price = history.find((e) => e.kind === "change" && e.action === "price")!;
    expect(price).toMatchObject({
      entityKey: ENTITY,          // which object
      entityId: subjectId,
      actorUserId: userId,        // who
      before: "1000",             // what changed
      after: "1250",
      source: "human",
      commandKey: "verity.test.contract.reprice",
    });
    expect(price.occurredAt).toBeInstanceOf(Date); // when

    const fact = history.find((e) => e.kind === "fact")!;
    expect(fact.action).toBe("verity.contract.repriced");
    expect(fact.correlationId).toBe(price.correlationId);
  });

  it("ties a security event to the request that caused it (AC-01)", async () => {
    const correlationId = randomUUID();
    await withTenant(tenantId, (tx) =>
      recordSecurityEvent(tx, {
        tenantId,
        eventType: "ApiKeyGenerated",
        actorUserId: userId,
        correlationId,
        payload: { apiKey: "sk-live-NEVER-STORE-ME", label: "integration" },
      }),
    );

    const { securityEvents } = await withTenant(tenantId, (tx) =>
      reconstructRequest(tx, correlationId),
    );
    expect(securityEvents).toHaveLength(1);
    expect(securityEvents[0]!.eventType).toBe("ApiKeyGenerated");

    // And the payload was redacted on the way in — the one moment it could be.
    const stored = await withTenant(tenantId, (tx) =>
      tx.securityAuditEvent.findMany({ where: { correlationId } }),
    );
    expect(JSON.stringify(stored[0]!.payload)).not.toContain("sk-live-NEVER-STORE-ME");
    expect(JSON.stringify(stored[0]!.payload)).toContain("integration");
  });

  /* ---- AC-06: the append-only guarantee still holds ---- */

  describe("append-only integrity (AC-06, EXE-AUD-003)", () => {
    /**
     * Two mechanisms, and the difference matters.
     *
     * RLS is the first line: the application role has no UPDATE or DELETE
     * policy on the audit tables, so a tampering statement sees no rows and
     * changes nothing. It does not raise — a policy that hides rows cannot
     * distinguish "you may not" from "there is nothing there" — so the test
     * for it must assert the row is unchanged, not that an error was thrown.
     *
     * The trigger is the second line, and it is the one that raises. It runs
     * for every role including a privileged one, which is why a migration or a
     * retention job cannot quietly rewrite history either.
     */
    it("leaves an audit row unchanged when the application role attempts UPDATE", async () => {
      const before = await withTenant(tenantId, (tx) =>
        tx.activity.findMany({ where: { entityId: subjectId, fieldChanged: "price" } }),
      );

      const affected = await withTenant(tenantId, (tx) =>
        tx.$executeRaw`UPDATE activity SET new_value = 'tampered' WHERE tenant_id = ${tenantId}::uuid`,
      );
      expect(affected).toBe(0);

      const after = await withTenant(tenantId, (tx) =>
        tx.activity.findMany({ where: { entityId: subjectId, fieldChanged: "price" } }),
      );
      expect(after[0]!.newValue).toBe(before[0]!.newValue);
      expect(after[0]!.newValue).not.toBe("tampered");
    });

    it("leaves an audit row present when the application role attempts DELETE", async () => {
      const affected = await withTenant(tenantId, (tx) =>
        tx.$executeRaw`DELETE FROM activity WHERE tenant_id = ${tenantId}::uuid`,
      );
      expect(affected).toBe(0);

      const rows = await withTenant(tenantId, (tx) =>
        tx.activity.findMany({ where: { entityId: subjectId } }),
      );
      expect(rows.length).toBeGreaterThan(0);
    });

    it("raises on UPDATE of an audit row even for a privileged role", async () => {
      const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
      try {
        await expect(
          admin.$executeRaw`UPDATE activity SET new_value = 'tampered' WHERE tenant_id = ${tenantId}::uuid`,
        ).rejects.toThrow(/append-only/);
      } finally {
        await admin.$disconnect();
      }
    });

    it("freezes a domain event's fact while permitting delivery marking", async () => {
      const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
      try {
        await expect(
          admin.$executeRaw`UPDATE domain_event SET name = 'rewritten' WHERE tenant_id = ${tenantId}::uuid`,
        ).rejects.toThrow(/write-once/);

        // The one column that may move: the dispatcher marking delivery.
        await expect(
          admin.$executeRaw`UPDATE domain_event SET delivered_at = now() WHERE tenant_id = ${tenantId}::uuid`,
        ).resolves.toBeGreaterThan(0);
      } finally {
        await admin.$disconnect();
      }
    });

    it("freezes the correlation and source of a domain event too", async () => {
      // Found while writing this task: the write-once trigger compares an
      // explicit column list, so the columns Task 38 added were mutable until
      // they were named in it. Correlation is what proves two records belong to
      // the same request; leaving it rewritable would let the part of the trail
      // that establishes context be edited while the part it contextualises
      // stayed frozen.
      const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
      try {
        await expect(
          admin.$executeRaw`UPDATE domain_event SET correlation_id = gen_random_uuid() WHERE tenant_id = ${tenantId}::uuid`,
        ).rejects.toThrow(/write-once/);

        await expect(
          admin.$executeRaw`UPDATE domain_event SET source = 'tampered' WHERE tenant_id = ${tenantId}::uuid`,
        ).rejects.toThrow(/write-once/);
      } finally {
        await admin.$disconnect();
      }
    });
  });

  /* ---- AC-07: the streams stay separate ---- */

  describe("stream separation (AC-07)", () => {
    it("keeps changes, facts and security events in three tables", async () => {
      const counts = await withTenant(tenantId, async (tx) => ({
        activity: await tx.activity.count(),
        events: await tx.domainEvent.count(),
        security: await tx.securityAuditEvent.count(),
      }));

      // Each stream answers a different question and carries a different
      // retention rule. Merging them would force the strictest retention on
      // all three and make each harder to read.
      expect(counts.activity).toBeGreaterThan(0);
      expect(counts.events).toBeGreaterThan(0);
      expect(counts.security).toBeGreaterThan(0);
    });

    it("does not fold a business ledger into the audit stream", async () => {
      // reconstructHistory returns changes and facts only. A ledger entry is a
      // business consequence owned by a capability; folding a bookkeeping
      // correction in here would make a legitimate adjustment
      // indistinguishable from a tampered audit row.
      const history = await withTenant(tenantId, (tx) =>
        reconstructHistory(tx, ENTITY, subjectId),
      );
      expect(new Set(history.map((e) => e.kind))).toEqual(new Set(["change", "fact"]));
    });
  });

  it("keeps another tenant's history invisible (INV-001)", async () => {
    const otherTenant = randomUUID();
    await withTenant(otherTenant, async (tx) => {
      await tx.tenant.create({ data: { id: otherTenant, name: "Other" } });
    });

    const history = await withTenant(otherTenant, (tx) =>
      reconstructHistory(tx, ENTITY, subjectId),
    );
    expect(history).toEqual([]);

    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      await admin.$executeRaw`DELETE FROM tenant WHERE id = ${otherTenant}::uuid`;
    } finally {
      await admin.$disconnect();
    }
  });
});
