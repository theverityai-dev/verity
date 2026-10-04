import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/platform/db";
import { assertRlsEnforceable, withTenant } from "@/server/platform/tenancy";
import { activateCapability, invalidateCapabilityCache } from "@/server/platform/capability";
import { ForbiddenError, fieldGrantKey } from "@/server/platform/authorization";
import {
  evaluatePolicy,
  enforcePolicy,
  explainDecision,
  grantedScopes,
  permittedVerbs,
  type PolicyChannel,
} from "@/server/platform/policy";
import {
  clearCommands,
  executeCommand,
  registerCommand,
  type ActorContext,
  type CommandDefinition,
} from "@/server/platform/command";

/**
 * Task 37 — the authorization decision point.
 * Plan: taskplans/archive/37_enterprise_rbac_policy.md.
 *
 * Organization tree, the same shape `authorization-layers.test.ts` uses:
 *
 *   HQ
 *   ├── North ── Manchester
 *   └── South ── London
 *
 * These tests are about the *decision point*, not about the rules underneath
 * it: the rules already have thirty tests in `authorization.test.ts` and
 * `authorization-layers.test.ts`. What is new and must be proven here is that
 * there is one answer, that it explains itself, that every path that cannot say
 * yes says no, and that the channel cannot change a verdict.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  const message = "policy-engine.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

const ENTITY = "verity.test.policy_job";
const CAPABILITY = "verity.capability.policy_engine_test";
const CHANNELS: PolicyChannel[] = ["human", "api", "job", "agent"];

describeDb("authorization decision point (Task 37)", () => {
  const tenantId = randomUUID();
  const orgs: Record<string, string> = {};
  let regionalRole: string;
  let tenantRole: string;
  let supervisorRole: string;
  let unpermittedRole: string;

  const actorIn = (organizationId: string, roleId: string | null): ActorContext => ({
    tenantId,
    userId: randomUUID(),
    membershipId: randomUUID(),
    organizationId,
    roleId,
  });

  beforeAll(async () => {
    await assertRlsEnforceable();
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      await admin.capabilityDefinition.create({
        data: { id: CAPABILITY, name: "Policy engine test", version: "1.0.0", entityTypes: [ENTITY] },
      });
      await admin.entityDefinition.create({
        data: { key: ENTITY, capability: CAPABILITY, class: "Persistent", tableName: "job" },
      });
      await admin.fieldPermission.create({
        data: { entityKey: ENTITY, fieldName: "billable_rate" },
      });
    } finally {
      await admin.$disconnect();
    }

    await withTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: "Policy Tenant" } });
      await activateCapability(tx, tenantId, CAPABILITY);

      const hq = await tx.organization.create({ data: { tenantId, name: "HQ" } });
      const north = await tx.organization.create({ data: { tenantId, name: "North", parentId: hq.id } });
      const south = await tx.organization.create({ data: { tenantId, name: "South", parentId: hq.id } });
      const manchester = await tx.organization.create({ data: { tenantId, name: "Manchester", parentId: north.id } });
      const london = await tx.organization.create({ data: { tenantId, name: "London", parentId: south.id } });
      Object.assign(orgs, {
        hq: hq.id, north: north.id, south: south.id, manchester: manchester.id, london: london.id,
      });

      regionalRole = (await tx.role.create({ data: { tenantId, name: "Regional Manager" } })).id;
      tenantRole = (await tx.role.create({ data: { tenantId, name: "Head Office" } })).id;
      supervisorRole = (await tx.role.create({ data: { tenantId, name: "Supervisor" } })).id;
      unpermittedRole = (await tx.role.create({ data: { tenantId, name: "Receptionist" } })).id;

      await tx.permission.createMany({
        data: [
          { tenantId, roleId: regionalRole, verb: "Read", entity: ENTITY, scope: "Organization" },
          { tenantId, roleId: regionalRole, verb: "Edit", entity: ENTITY, scope: "Organization" },
          { tenantId, roleId: tenantRole, verb: "Read", entity: ENTITY, scope: "Tenant" },
          { tenantId, roleId: supervisorRole, verb: "Read", entity: ENTITY, scope: "Tenant" },
          { tenantId, roleId: supervisorRole, verb: "Read", entity: fieldGrantKey(ENTITY, "billable_rate"), scope: "Tenant" },
          // Location-scoped, with no resolver registered for the axis.
          { tenantId, roleId: tenantRole, verb: "Delete", entity: ENTITY, scope: "Location" },
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
      await admin.$executeRaw`DELETE FROM field_permission WHERE entity_key = ${ENTITY}`;
      await admin.$executeRaw`DELETE FROM capability_definition WHERE id = ${CAPABILITY}`;
    } finally {
      await admin.$disconnect();
    }
    await prisma.$disconnect();
  });

  const decide = (actor: ActorContext, request: Parameters<typeof evaluatePolicy>[2]) =>
    withTenant(tenantId, (tx) => evaluatePolicy(tx, actor, request));

  /* ---- AC-01: a reasoned decision, both ways ---- */

  describe("reasoned decisions (AC-01)", () => {
    it("allows a type-level request and names the scope it was granted at", async () => {
      const decision = await decide(actorIn(orgs.north, regionalRole), {
        verb: "Read",
        entity: ENTITY,
      });

      expect(decision.allowed).toBe(true);
      expect(decision.code).toBe("ALLOW");
      expect(decision.layer).toBe(1);
      expect(decision.reason).toMatch(/Organization/);
      expect(decision.grants).toHaveLength(1);
    });

    it("denies with the layer that refused and a reason an operator can act on", async () => {
      const decision = await decide(actorIn(orgs.north, unpermittedRole), {
        verb: "Read",
        entity: ENTITY,
      });

      expect(decision.allowed).toBe(false);
      expect(decision.code).toBe("E_FORBIDDEN");
      expect(decision.layer).toBe(1);
      expect(decision.reason).toBe(`role holds no Read grant on ${ENTITY}`);
    });

    it("distinguishes a layer 1 refusal from a layer 2 refusal", async () => {
      const noGrant = await decide(actorIn(orgs.north, unpermittedRole), {
        verb: "Read", entity: ENTITY, resource: { organizationId: orgs.north },
      });
      const wrongBranch = await decide(actorIn(orgs.north, regionalRole), {
        verb: "Read", entity: ENTITY, resource: { organizationId: orgs.london },
      });

      // Different problems, different fixes: grant a permission, versus move
      // the record or widen the scope.
      expect(noGrant.layer).toBe(1);
      expect(wrongBranch.layer).toBe(2);
      expect(wrongBranch.reason).toMatch(/outside the actor's scope/);
    });

    it("renders a decision as one explainable line (PRN-001)", async () => {
      const decision = await decide(actorIn(orgs.north, regionalRole), {
        verb: "Read", entity: ENTITY, channel: "agent",
      });

      expect(explainDecision(decision)).toMatch(
        new RegExp(`^ALLOW Read ${ENTITY} \\[layer 1, via agent\\] — `),
      );
    });
  });

  /* ---- AC-02: every deny-by-default path ---- */

  describe("deny by default (AC-02)", () => {
    it("denies a membership carrying no role", async () => {
      const decision = await decide(actorIn(orgs.north, null), { verb: "Read", entity: ENTITY });

      expect(decision.allowed).toBe(false);
      expect(decision.layer).toBeNull();
      expect(decision.reason).toMatch(/no role/);
    });

    it("denies an entity the role holds no grant on", async () => {
      const decision = await decide(actorIn(orgs.north, regionalRole), {
        verb: "Read",
        entity: "verity.test.entity_that_does_not_exist",
      });
      expect(decision.allowed).toBe(false);
    });

    it("denies a verb the role does not hold on an entity it otherwise reaches", async () => {
      const decision = await decide(actorIn(orgs.north, regionalRole), {
        verb: "Delete",
        entity: ENTITY,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.layer).toBe(1);
    });

    it("denies a record in a sibling branch (PLA-ORG-003)", async () => {
      const decision = await decide(actorIn(orgs.manchester, regionalRole), {
        verb: "Read", entity: ENTITY, resource: { organizationId: orgs.london },
      });
      expect(decision.allowed).toBe(false);
      expect(decision.layer).toBe(2);
    });

    it("denies an unscoped record unless the grant is tenant-wide", async () => {
      const organizationScoped = await decide(actorIn(orgs.north, regionalRole), {
        verb: "Read", entity: ENTITY, resource: { organizationId: null },
      });
      expect(organizationScoped.allowed).toBe(false);
      expect(organizationScoped.reason).toMatch(/no Tenant-scoped Read grant/);

      const tenantScoped = await decide(actorIn(orgs.north, tenantRole), {
        verb: "Read", entity: ENTITY, resource: { organizationId: null },
      });
      expect(tenantScoped.allowed).toBe(true);
    });

    it("denies a grant whose scope axis has no resolver, and says so", async () => {
      // The role holds Delete at Location scope, but no capability has
      // registered a Location resolver — an unevaluable grant must reach
      // nothing rather than widen to the tenant.
      const decision = await decide(actorIn(orgs.north, tenantRole), {
        verb: "Delete", entity: ENTITY, resource: { organizationId: orgs.north },
      });

      expect(decision.allowed).toBe(false);
      expect(decision.layer).toBe(2);
      expect(decision.reason).toMatch(/cannot be evaluated \(no resolver registered\)/);
    });

    it("denies a restricted field to a role without the field grant", async () => {
      const decision = await decide(actorIn(orgs.north, tenantRole), {
        verb: "Read", entity: ENTITY, field: "billable_rate",
      });

      expect(decision.allowed).toBe(false);
      expect(decision.layer).toBe(3);
      expect(decision.reason).toMatch(/billable_rate/);
    });

    it("permits a restricted field to the role that holds the field grant", async () => {
      const decision = await decide(actorIn(orgs.north, supervisorRole), {
        verb: "Read", entity: ENTITY, field: "billable_rate",
      });
      expect(decision.allowed).toBe(true);
      expect(decision.layer).toBe(3);
    });

    it("does not require a grant for a field nobody declared restricted", async () => {
      const decision = await decide(actorIn(orgs.north, tenantRole), {
        verb: "Read", entity: ENTITY, field: "reference",
      });
      expect(decision.allowed).toBe(true);
    });

    it("never returns a Global-scope grant to the decision", async () => {
      await withTenant(tenantId, async (tx) => {
        await tx.permission.create({
          data: { tenantId, roleId: unpermittedRole, verb: "Read", entity: ENTITY, scope: "Global" },
        });
      });

      // Global is defined (PLA-AUT-002) but never granted: honouring it means
      // bypassing the RLS that enforces INV-001. It is filtered in
      // resolve_permissions, so the row can exist without taking effect.
      const decision = await decide(actorIn(orgs.north, unpermittedRole), {
        verb: "Read", entity: ENTITY,
      });
      expect(decision.allowed).toBe(false);

      await withTenant(tenantId, async (tx) => {
        await tx.permission.deleteMany({ where: { roleId: unpermittedRole, scope: "Global" } });
      });
    });
  });

  /* ---- AC-03/AC-04: one model for every kind of actor ---- */

  describe("the channel is recorded, never consulted (AC-03, AC-04)", () => {
    it("returns the identical verdict for a human, an API caller, a job and an agent", async () => {
      const permitted = actorIn(orgs.north, regionalRole);
      const refused = actorIn(orgs.north, unpermittedRole);

      for (const channel of CHANNELS) {
        const allow = await decide(permitted, { verb: "Read", entity: ENTITY, channel });
        const deny = await decide(refused, { verb: "Read", entity: ENTITY, channel });

        expect(allow.allowed, `${channel} must be allowed`).toBe(true);
        expect(deny.allowed, `${channel} must be denied`).toBe(false);
        // The verdict is identical; only the recorded channel differs.
        expect(allow.channel).toBe(channel);
        expect(allow.reason).toBe(
          (await decide(permitted, { verb: "Read", entity: ENTITY, channel: "human" })).reason,
        );
      }
    });

    it("scopes an agent exactly as narrowly as the person whose role it carries", async () => {
      const agent = actorIn(orgs.manchester, regionalRole);

      const own = await decide(agent, {
        verb: "Read", entity: ENTITY, resource: { organizationId: orgs.manchester }, channel: "agent",
      });
      const sibling = await decide(agent, {
        verb: "Read", entity: ENTITY, resource: { organizationId: orgs.london }, channel: "agent",
      });

      expect(own.allowed).toBe(true);
      expect(sibling.allowed).toBe(false);
    });

    it("defaults an unstated channel to human rather than to something privileged", async () => {
      const decision = await decide(actorIn(orgs.north, regionalRole), {
        verb: "Read", entity: ENTITY,
      });
      expect(decision.channel).toBe("human");
    });

    it("has no branch on channel anywhere in the evaluation (structural)", () => {
      const source = readFileSync(resolve(process.cwd(), "src/server/platform/policy.ts"), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");

      // `channel` may be assigned into a decision and defaulted. It may never
      // be compared, switched on, or used in a condition — that is the line
      // between "recorded for audit" and "trusted differently".
      expect(source).not.toMatch(/channel\s*===/);
      expect(source).not.toMatch(/channel\s*!==/);
      expect(source).not.toMatch(/switch\s*\(\s*\w*[Cc]hannel/);
      expect(source).not.toMatch(/if\s*\([^)]*\bchannel\b[^)]*\)/);
    });
  });

  /* ---- AC-05: isolation holds through the decision point ---- */

  describe("tenant and organization isolation (AC-05)", () => {
    it("resolves nothing for a role belonging to another tenant", async () => {
      const otherTenant = randomUUID();
      await withTenant(otherTenant, async (tx) => {
        await tx.tenant.create({ data: { id: otherTenant, name: "Other Tenant" } });
      });

      // The role id is real, but it is not visible inside this tenant's RLS
      // boundary, so it resolves to no permissions — INV-001 holds through the
      // policy point exactly as it holds through a raw query.
      const decision = await withTenant(otherTenant, (tx) =>
        evaluatePolicy(tx, { ...actorIn(orgs.north, regionalRole), tenantId: otherTenant }, {
          verb: "Read",
          entity: ENTITY,
        }),
      );
      expect(decision.allowed).toBe(false);

      const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
      try {
        await admin.$executeRaw`DELETE FROM tenant WHERE id = ${otherTenant}::uuid`;
      } finally {
        await admin.$disconnect();
      }
    });

    it("gives a parent-node actor the whole subtree and nothing above it", async () => {
      const northManager = actorIn(orgs.north, regionalRole);

      expect(
        (await decide(northManager, { verb: "Read", entity: ENTITY, resource: { organizationId: orgs.manchester } }))
          .allowed,
      ).toBe(true);
      expect(
        (await decide(northManager, { verb: "Read", entity: ENTITY, resource: { organizationId: orgs.hq } }))
          .allowed,
      ).toBe(false);
    });
  });

  /* ---- AC-06: the UI reflects authorization, it does not constitute it ---- */

  describe("advisory reads for the UI (AC-06)", () => {
    it("reports the verbs and scopes a role holds, for rendering", async () => {
      const verbs = await withTenant(tenantId, (tx) =>
        permittedVerbs(tx, actorIn(orgs.north, regionalRole), ENTITY),
      );
      expect(verbs).toEqual(["Edit", "Read"]);

      const scopes = await withTenant(tenantId, (tx) =>
        grantedScopes(tx, actorIn(orgs.north, tenantRole), "Read", ENTITY),
      );
      expect(scopes).toEqual(["Tenant"]);
    });

    it("reports nothing for a membership with no role", async () => {
      const verbs = await withTenant(tenantId, (tx) =>
        permittedVerbs(tx, actorIn(orgs.north, null), ENTITY),
      );
      expect(verbs).toEqual([]);
    });

    it("still refuses the command when a client acts as though it were permitted", async () => {
      // The failure this guards against: a client that renders the button
      // anyway, or calls the action directly. Server-side enforcement is what
      // decides, and it is reached through the same policy point.
      const command: CommandDefinition<{ note: string }, { ok: true }> = {
        key: "verity.test.policy_job.touch",
        entity: ENTITY,
        verb: "Delete",
        input: z.object({ note: z.string() }),
        handler: async () => ({ result: { ok: true } as const }),
      };
      registerCommand(command);

      await expect(
        executeCommand(actorIn(orgs.north, regionalRole), command, { note: "acting anyway" }),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  /* ---- AC-07: the command path goes through the decision point ---- */

  describe("the command path (AC-07)", () => {
    it("executes when the policy point allows", async () => {
      const command: CommandDefinition<{ note: string }, { ok: true }> = {
        key: "verity.test.policy_job.update",
        entity: ENTITY,
        verb: "Read",
        input: z.object({ note: z.string() }),
        handler: async () => ({ result: { ok: true } as const }),
      };
      registerCommand(command);

      await expect(
        executeCommand(actorIn(orgs.north, tenantRole), command, { note: "fine" }),
      ).resolves.toEqual({ ok: true });
    });

    it("refuses with E_FORBIDDEN when it denies, and the handler never runs", async () => {
      let handlerRan = false;
      const command: CommandDefinition<Record<string, never>, { ok: true }> = {
        key: "verity.test.policy_job.destroy",
        entity: ENTITY,
        verb: "Delete",
        input: z.object({}),
        handler: async () => {
          handlerRan = true;
          return { result: { ok: true } as const };
        },
      };
      registerCommand(command);

      await expect(
        executeCommand(actorIn(orgs.north, unpermittedRole), command, {}),
      ).rejects.toMatchObject({ code: "E_FORBIDDEN" });
      expect(handlerRan).toBe(false);
    });

    it("routes through the policy point rather than calling Layer 1 directly (structural)", () => {
      const source = readFileSync(resolve(process.cwd(), "src/server/platform/command.ts"), "utf8");
      expect(source).toMatch(/enforcePolicy\(/);
      expect(source).not.toMatch(/\bawait authorize\(/);
    });
  });

  /* ---- enforcePolicy is the gate ---- */

  describe("enforcePolicy", () => {
    it("returns the decision when permitted, so a caller need not ask twice", async () => {
      const decision = await withTenant(tenantId, (tx) =>
        enforcePolicy(tx, actorIn(orgs.north, regionalRole), { verb: "Read", entity: ENTITY }),
      );
      expect(decision.allowed).toBe(true);
    });

    it("throws ForbiddenError carrying the reason when denied", async () => {
      await expect(
        withTenant(tenantId, (tx) =>
          enforcePolicy(tx, actorIn(orgs.north, unpermittedRole), { verb: "Read", entity: ENTITY }),
        ),
      ).rejects.toThrow(/E_FORBIDDEN: role holds no Read grant/);
    });
  });
});
