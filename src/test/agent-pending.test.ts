import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/platform/db";
import { assertRlsEnforceable, withTenant } from "@/server/platform/tenancy";
import { provisionIdentity } from "@/server/platform/identity";
import { clearCommands, registerCommand, type ActorContext, type CommandDefinition } from "@/server/platform/command";
import { clearQueries, registerQuery, type QueryDefinition } from "@/server/platform/query";
import { activateCapability, invalidateCapabilityCache } from "@/server/platform/capability";
import { decidePendingAction, runAgentTurn } from "@/server/platform/agent-chat";
import {
  PENDING_ACTION_TTL_MS,
  claimPendingAction,
  proposePendingAction,
  purgeAgentRecords,
  recordAgentTurn,
  TURN_OUTPUT_LIMIT,
} from "@/server/platform/agent-approval";

/**
 * ADR-055 against a real database and the real loop, with only the model scripted: a `confirm`-class command is stored and not
 * run, runs once and only for its proposer on Confirm, an invented id or a bad input is refused before anything is stored, a
 * destructive command never runs, and every turn is recorded and purged on schedule.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;
if (!hasDatabase) {
  const message = "agent-pending.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

const ENTITY = "verity.test.agent_ledger";
const CAPABILITY = "verity.capability.agent_test";

/** What actually ran, by command key. The handlers below are the only thing that writes here. */
const ran: string[] = [];

const recordPayment: CommandDefinition<{ thingId: string; note: string }, { note: string }> = {
  key: "verity.test.agent_record_payment",
  entity: ENTITY,
  verb: "Edit",
  description: "Record a payment against the thing.",
  input: z.object({ thingId: z.string().uuid(), note: z.string().min(1) }),
  handler: async (ctx, input) => {
    ran.push("record_payment");
    await ctx.tx.tenant.update({ where: { id: ctx.actor.tenantId }, data: { name: input.note } });
    return { result: { note: input.note } };
  },
};
const renameThing: CommandDefinition<{ note: string }, { note: string }> = {
  key: "verity.test.agent_rename_thing",
  entity: ENTITY,
  verb: "Edit",
  description: "Rename the thing.",
  input: z.object({ note: z.string().min(1) }),
  handler: async (ctx, input) => {
    ran.push("rename_thing");
    await ctx.tx.tenant.update({ where: { id: ctx.actor.tenantId }, data: { name: input.note } });
    return { result: { note: input.note } };
  },
};
const discardThing: CommandDefinition<{ note: string }, { note: string }> = {
  key: "verity.test.agent_discard_thing",
  entity: ENTITY,
  verb: "Edit",
  impact: "destructive",
  description: "Discard the thing.",
  input: z.object({ note: z.string().min(1) }),
  handler: async (_ctx, input) => {
    ran.push("discard_thing");
    return { result: { note: input.note } };
  },
};
const listThings: QueryDefinition<Record<string, never>, Array<{ id: string; name: string }>> = {
  key: "verity.test.agent_list_things",
  entity: ENTITY,
  description: "List the things.",
  input: z.object({}),
  handler: async (ctx) => [{ id: ctx.actor.tenantId, name: "the thing" }],
};

const toolName = (key: string) => key.replaceAll(".", "__");
type Reply = { content?: string; calls?: Array<{ key: string; args: unknown }> };

/** A model that says exactly what the test scripts. Every request body is kept so a test can read what the model was shown. */
function scriptModel(replies: Reply[]): { bodies: Array<{ messages: Array<{ role: string; content: string | null }> }> } {
  const bodies: Array<{ messages: Array<{ role: string; content: string | null }> }> = [];
  let next = 0;
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    const reply = replies[Math.min(next++, replies.length - 1)];
    const message = {
      role: "assistant",
      content: reply.content ?? null,
      tool_calls: reply.calls?.map((c, i) => ({
        id: `call_${next}_${i}`,
        type: "function",
        function: { name: toolName(c.key), arguments: JSON.stringify(c.args) },
      })),
    };
    return { ok: true, json: async () => ({ choices: [{ message }] }) };
  });
  return { bodies };
}

describeDb("agent pending actions and turn records (ADR-055)", () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let owner: ActorContext;
  let colleague: ActorContext;

  const pendingRows = () => withTenant(tenantA, (tx) => tx.agentPendingAction.findMany({ orderBy: { createdAt: "asc" } }));
  const lastOf = async () => (await pendingRows()).at(-1)!;

  beforeAll(async () => {
    await assertRlsEnforceable();
    registerCommand(recordPayment);
    registerCommand(renameThing);
    registerCommand(discardThing);
    registerQuery(listThings);
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_BASE_URL = "http://model.invalid/v1";
    process.env.OPENAI_MODEL = "scripted-model";

    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      await admin.capabilityDefinition.create({ data: { id: CAPABILITY, name: "Agent test", version: "1.0.0", entityTypes: [ENTITY] } });
      await admin.entityDefinition.create({ data: { key: ENTITY, capability: CAPABILITY, class: "Persistent", tableName: "tenant" } });
    } finally {
      await admin.$disconnect();
    }

    await withTenant(tenantB, (tx) => tx.tenant.create({ data: { id: tenantB, name: "Other Works" } }));
    await withTenant(tenantA, async (tx) => {
      await tx.tenant.create({ data: { id: tenantA, name: "Agent Works" } });
      await activateCapability(tx, tenantA, CAPABILITY);
      const org = await tx.organization.create({ data: { tenantId: tenantA, name: "HQ" } });
      const role = await tx.role.create({ data: { tenantId: tenantA, name: "Operator" } });
      await tx.permission.createMany({
        data: [
          { tenantId: tenantA, roleId: role.id, verb: "Read", entity: ENTITY, scope: "Tenant" },
          { tenantId: tenantA, roleId: role.id, verb: "Edit", entity: ENTITY, scope: "Tenant" },
        ],
      });
      const person = async (displayName: string): Promise<ActorContext> => {
        const identity = await provisionIdentity(tx, { organizationId: org.id, authUserId: randomUUID(), displayName });
        await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId: role.id } });
        return { tenantId: tenantA, userId: identity.userId, membershipId: identity.membershipId, organizationId: org.id, roleId: role.id };
      };
      owner = await person("Owner Ji");
      colleague = await person("Colleague Ji");
    });
    invalidateCapabilityCache();
  });

  beforeEach(() => {
    ran.length = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    clearCommands();
    clearQueries();
    invalidateCapabilityCache();
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      await admin.$executeRaw`DELETE FROM "user" WHERE id IN (${owner?.userId}::uuid, ${colleague?.userId}::uuid)`;
      await admin.$executeRaw`DELETE FROM tenant WHERE id IN (${tenantA}::uuid, ${tenantB}::uuid)`;
      await admin.$executeRaw`DELETE FROM entity_definition WHERE key = ${ENTITY}`;
      await admin.$executeRaw`DELETE FROM capability_definition WHERE id = ${CAPABILITY}`;
      await admin.$executeRaw`DELETE FROM party WHERE id NOT IN (SELECT party_id FROM "user")`;
    } finally {
      await admin.$disconnect();
    }
    await prisma.$disconnect();
  });

  it("runs a routine single write at once, as the person, and stores no pending action", async () => {
    scriptModel([{ calls: [{ key: renameThing.key, args: { note: "Renamed" } }] }, { content: "Done." }]);
    const result = await runAgentTurn(owner, [], "rename it");
    expect(ran).toEqual(["rename_thing"]);
    expect(result.preview).toBeUndefined();
    expect(await pendingRows()).toHaveLength(0);
  });

  it("stores a confirm-class command instead of running it, and shows the person what it holds", async () => {
    scriptModel([
      { calls: [{ key: listThings.key, args: {} }] },
      { calls: [{ key: recordPayment.key, args: { thingId: tenantA, note: "Paid 500" } }] },
    ]);
    const result = await runAgentTurn(owner, [], "record the payment");

    expect(ran).toEqual([]);
    expect(result.preview).toMatchObject({ commandKey: recordPayment.key, details: ["note: Paid 500"] });
    const row = await lastOf();
    expect(row).toMatchObject({ id: result.preview!.id, actorId: owner.userId, status: "pending", commandKey: recordPayment.key });
    expect(row.inputs).toEqual([{ thingId: tenantA, note: "Paid 500" }]);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeLessThanOrEqual(PENDING_ACTION_TTL_MS + 1000);
  });

  it("runs the stored inputs once on Confirm, as the proposer, and never again on a replay", async () => {
    scriptModel([
      { calls: [{ key: listThings.key, args: {} }] },
      { calls: [{ key: recordPayment.key, args: { thingId: tenantA, note: "Paid 700" } }] },
    ]);
    const { preview } = await runAgentTurn(owner, [], "record the payment");

    const first = await decidePendingAction(owner, preview!.id, "approve");
    expect(first.reply).toBe("Done — 1 of 1 succeeded.");
    expect(ran).toEqual(["record_payment"]);

    const replay = await decidePendingAction(owner, preview!.id, "approve");
    expect(replay.failure).toBe("E_ALREADY_DECIDED");
    expect(ran).toEqual(["record_payment"]);

    const row = await lastOf();
    expect(row).toMatchObject({ status: "approved", outcome: { total: 1, succeeded: 1, failed: 0, errorCodes: [] } });
    expect(row.decidedAt).not.toBeNull();
  });

  it("lets two clicks race and runs the action once", async () => {
    const view = await proposePendingAction(owner, { commandKey: recordPayment.key, summary: "x", inputs: [{ thingId: tenantA, note: "Race" }] });
    const [a, b] = await Promise.all([decidePendingAction(owner, view.id, "approve"), decidePendingAction(owner, view.id, "approve")]);
    expect([a.failure, b.failure].filter(Boolean)).toEqual(["E_ALREADY_DECIDED"]);
    expect(ran).toEqual(["record_payment"]);
  });

  it("will not let another person in the same tenant decide it, and does not say it exists", async () => {
    const view = await proposePendingAction(owner, { commandKey: recordPayment.key, summary: "x", inputs: [{ thingId: tenantA, note: "Mine" }] });
    const result = await decidePendingAction(colleague, view.id, "approve");
    expect(result.failure).toBe("E_NOT_FOUND");
    expect(ran).toEqual([]);
    expect((await pendingRows()).find((r) => r.id === view.id)!.status).toBe("pending");
  });

  it("keeps a pending action out of every other tenant (INV-001)", async () => {
    const view = await proposePendingAction(owner, { commandKey: recordPayment.key, summary: "x", inputs: [{ thingId: tenantA, note: "Secret" }] });
    expect(await withTenant(tenantB, (tx) => tx.agentPendingAction.findMany())).toEqual([]);
    const stranger: ActorContext = { ...owner, tenantId: tenantB };
    expect(await claimPendingAction(stranger, view.id, "approve")).toEqual({ ok: false, code: "E_NOT_FOUND" });
  });

  it("refuses an expired action and marks it expired, running nothing", async () => {
    const long = new Date(Date.now() - PENDING_ACTION_TTL_MS - 60_000);
    const view = await proposePendingAction(owner, { commandKey: recordPayment.key, summary: "x", inputs: [{ thingId: tenantA, note: "Late" }] }, long);
    const result = await decidePendingAction(owner, view.id, "approve");
    expect(result.failure).toBe("E_EXPIRED");
    expect(ran).toEqual([]);
    expect((await pendingRows()).find((r) => r.id === view.id)!.status).toBe("expired");
  });

  it("runs nothing when the person cancels", async () => {
    const view = await proposePendingAction(owner, { commandKey: recordPayment.key, summary: "x", inputs: [{ thingId: tenantA, note: "No" }] });
    expect((await decidePendingAction(owner, view.id, "reject")).reply).toBe("Cancelled — nothing was changed.");
    expect(ran).toEqual([]);
    expect((await pendingRows()).find((r) => r.id === view.id)!.status).toBe("rejected");
  });

  it("refuses an invented id before anything is stored, and tells the model so it can query", async () => {
    const before = (await pendingRows()).length;
    const { bodies } = scriptModel([
      { calls: [{ key: recordPayment.key, args: { thingId: randomUUID(), note: "Made up" } }] },
      { content: "I need to look it up first." },
    ]);
    const result = await runAgentTurn(owner, [], "record the payment");
    expect(result.preview).toBeUndefined();
    expect(ran).toEqual([]);
    expect(await pendingRows()).toHaveLength(before);
    const toolMessage = bodies[1].messages.find((m) => m.role === "tool")!;
    expect(toolMessage.content).toContain("E_UNGROUNDED");
  });

  it("refuses input the command would reject before anything is stored", async () => {
    const before = (await pendingRows()).length;
    const { bodies } = scriptModel([
      { calls: [{ key: listThings.key, args: {} }] },
      { calls: [{ key: recordPayment.key, args: { thingId: tenantA } }] },
      { content: "Sorry, I need a note." },
    ]);
    const result = await runAgentTurn(owner, [], "record the payment");
    expect(result.preview).toBeUndefined();
    expect(await pendingRows()).toHaveLength(before);
    expect(bodies[2].messages.filter((m) => m.role === "tool").at(-1)!.content).toContain("E_VALIDATION");
  });

  it("never runs a destructive command from the model, and stores nothing for it", async () => {
    const before = (await pendingRows()).length;
    const { bodies } = scriptModel([{ calls: [{ key: discardThing.key, args: { note: "bye" } }] }, { content: "Please do that in the app." }]);
    const result = await runAgentTurn(owner, [], "discard it");
    expect(ran).toEqual([]);
    expect(result.preview).toBeUndefined();
    expect(await pendingRows()).toHaveLength(before);
    expect(bodies[1].messages.find((m) => m.role === "tool")!.content).toContain("E_NEEDS_APPROVAL");
  });

  it("previews two calls to one routine command, as before, but as a stored action", async () => {
    scriptModel([{ calls: [{ key: renameThing.key, args: { note: "One" } }, { key: renameThing.key, args: { note: "Two" } }] }]);
    const result = await runAgentTurn(owner, [], "rename it twice");
    expect(ran).toEqual([]);
    expect(result.preview).toMatchObject({ commandKey: renameThing.key, details: ["note: One", "note: Two"] });
    expect((await lastOf()).inputs).toEqual([{ note: "One" }, { note: "Two" }]);
  });

  it("records every turn with the tool calls, and cuts long output", async () => {
    scriptModel([{ calls: [{ key: listThings.key, args: {} }] }, { content: "There is one thing." }]);
    const before = await withTenant(tenantA, (tx) => tx.agentTurn.count());
    await runAgentTurn(owner, [], "what things are there?");
    const turns = await withTenant(tenantA, (tx) => tx.agentTurn.findMany({ orderBy: { createdAt: "desc" }, take: 1 }));
    expect(await withTenant(tenantA, (tx) => tx.agentTurn.count())).toBe(before + 1);
    expect(turns[0]).toMatchObject({ actorId: owner.userId, userMessage: "what things are there?", reply: "There is one thing.", model: "scripted-model" });
    expect(turns[0].toolCalls).toMatchObject([{ key: listThings.key, kind: "query", ok: true }]);

    await recordAgentTurn(owner, {
      userMessage: "big", reply: "ok", durationMs: 1,
      toolCalls: [{ key: listThings.key, kind: "query", ok: true, input: {}, output: "x".repeat(TURN_OUTPUT_LIMIT * 3) }],
    });
    const big = (await withTenant(tenantA, (tx) => tx.agentTurn.findFirst({ where: { userMessage: "big" } })))!;
    expect(JSON.stringify(big.toolCalls).length).toBeLessThan(TURN_OUTPUT_LIMIT + 300);
  });

  it("still gives the reply when the record cannot be written", async () => {
    scriptModel([{ content: "Hello." }]);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    // A tenant that does not exist: the manifest is empty (no role), the model answers, and the record's insert then fails on its
    // tenant foreign key. A real failure, not a stub.
    const ghost: ActorContext = { tenantId: randomUUID(), userId: randomUUID(), membershipId: randomUUID(), organizationId: randomUUID(), roleId: null };
    try {
      const result = await runAgentTurn(ghost, [], "hi");
      expect(result.reply).toBe("Hello.");
      expect(spy).toHaveBeenCalledWith("agent turn record failed", expect.any(String));
    } finally {
      spy.mockRestore();
    }
  });

  it("purges turns after 90 days and decided actions after 30, and keeps what is newer", async () => {
    const now = new Date();
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    let ids: { oldTurn: string; newTurn: string; oldAction: string; newAction: string };
    try {
      const [oldTurn, newTurn] = [randomUUID(), randomUUID()];
      const [oldAction, newAction] = [randomUUID(), randomUUID()];
      await admin.$executeRaw`INSERT INTO agent_turn (id, tenant_id, actor_id, user_message, reply, duration_ms, created_at) VALUES
        (${oldTurn}::uuid, ${tenantA}::uuid, ${owner.userId}::uuid, 'old', 'old', 1, now() - interval '91 days'),
        (${newTurn}::uuid, ${tenantA}::uuid, ${owner.userId}::uuid, 'new', 'new', 1, now() - interval '89 days')`;
      await admin.$executeRaw`INSERT INTO agent_pending_action (id, tenant_id, actor_id, command_key, summary, inputs, status, expires_at, decided_at, created_at) VALUES
        (${oldAction}::uuid, ${tenantA}::uuid, ${owner.userId}::uuid, 'k', 's', '[]', 'approved', now() - interval '31 days', now() - interval '31 days', now() - interval '31 days'),
        (${newAction}::uuid, ${tenantA}::uuid, ${owner.userId}::uuid, 'k', 's', '[]', 'approved', now() - interval '29 days', now() - interval '29 days', now() - interval '29 days')`;
      ids = { oldTurn, newTurn, oldAction, newAction };
    } finally {
      await admin.$disconnect();
    }
    const purged = await withTenant(tenantA, (tx) => purgeAgentRecords(tx, now));
    expect(purged.turns).toBeGreaterThanOrEqual(1);
    expect(purged.actions).toBeGreaterThanOrEqual(1);
    const left = await withTenant(tenantA, async (tx) => ({
      turns: (await tx.agentTurn.findMany({ where: { id: { in: [ids.oldTurn, ids.newTurn] } } })).map((t) => t.id),
      actions: (await tx.agentPendingAction.findMany({ where: { id: { in: [ids.oldAction, ids.newAction] } } })).map((a) => a.id),
    }));
    expect(left).toEqual({ turns: [ids.newTurn], actions: [ids.newAction] });
  });
});
