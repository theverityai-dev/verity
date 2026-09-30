import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/platform/db";
import { assertRlsEnforceable, withTenant } from "@/server/platform/tenancy";
import { activateCapability, invalidateCapabilityCache } from "@/server/platform/capability";
import { executeCommand, type ActorContext } from "@/server/platform/command";
import { provisionIdentity } from "@/server/platform/identity";
import { installCapabilities } from "@/server/capabilities/registry";
import { installAdministration, createApiKey, revokeApiKey, ENTITY_MEMBERSHIP } from "@/server/platform/administration";
import { ENTITY_INVENTORY_ITEM, INVENTORY_CAPABILITY, createItem } from "@/server/capabilities/inventory";
import { LOCATION_CAPABILITY } from "@/server/capabilities/location";
import { authenticateApiKey } from "@/server/platform/external-auth";
import { POST } from "@/app/api/tools/invoke/route";

/**
 * ADR-029 end to end: key issue and revoke through real commands, authentication
 * through the SECURITY DEFINER lookup, and the route's isolation, idempotency and
 * tool-scoping rules. Every fixture is its own random tenant and is deleted by
 * id afterwards; nothing here sweeps rows it did not create.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;
if (!hasDatabase) {
  const message = "external-api.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

type Fixture = { tenantId: string; organizationId: string; admin: ActorContext; machineMembershipId: string };

const created = { tenants: [] as string[], users: [] as string[], parties: [] as string[] };

async function makeTenant(name: string, adminCanGrantMachine: boolean): Promise<Fixture> {
  const tenantId = randomUUID();
  created.tenants.push(tenantId);

  return withTenant(tenantId, async (tx) => {
    await tx.tenant.create({ data: { id: tenantId, name, timeZone: "Asia/Kolkata" } });
    await activateCapability(tx, tenantId, LOCATION_CAPABILITY);
    await activateCapability(tx, tenantId, INVENTORY_CAPABILITY);
    const organizationId = (await tx.organization.create({ data: { tenantId, name: "Org" } })).id;

    const machineRole = await tx.role.create({ data: { tenantId, name: "Machine" }, select: { id: true } });
    await tx.permission.createMany({
      data: (["Read", "Create"] as const).map((verb) => ({
        tenantId, roleId: machineRole.id, verb, entity: ENTITY_INVENTORY_ITEM, scope: "Tenant" as const,
      })),
    });

    // The admin can issue keys (Edit on membership) and, when asked, holds every
    // permission the machine role holds, which is what the grant ceiling demands.
    const adminRole = await tx.role.create({ data: { tenantId, name: "Admin" }, select: { id: true } });
    await tx.permission.createMany({
      data: [
        { verb: "Edit" as const, entity: ENTITY_MEMBERSHIP },
        { verb: "Read" as const, entity: ENTITY_MEMBERSHIP },
        ...(adminCanGrantMachine
          ? [
              { verb: "Read" as const, entity: ENTITY_INVENTORY_ITEM },
              { verb: "Create" as const, entity: ENTITY_INVENTORY_ITEM },
            ]
          : []),
      ].map((p) => ({ tenantId, roleId: adminRole.id, scope: "Tenant" as const, ...p })),
    });

    const adminIdentity = await provisionIdentity(tx, { organizationId, authUserId: randomUUID(), displayName: `${name} Admin` });
    const machineIdentity = await provisionIdentity(tx, { organizationId, authUserId: randomUUID(), displayName: `${name} Machine` });
    created.users.push(adminIdentity.userId, machineIdentity.userId);
    created.parties.push(adminIdentity.partyId, machineIdentity.partyId);
    await tx.tenantMembership.update({ where: { id: adminIdentity.membershipId }, data: { roleId: adminRole.id } });
    await tx.tenantMembership.update({ where: { id: machineIdentity.membershipId }, data: { roleId: machineRole.id } });

    return {
      tenantId,
      organizationId,
      machineMembershipId: machineIdentity.membershipId,
      admin: {
        tenantId,
        userId: adminIdentity.userId,
        membershipId: adminIdentity.membershipId,
        organizationId,
        roleId: adminRole.id,
      },
    };
  });
}

const call = (key: string | null, body: unknown, extra: Record<string, string> = {}) =>
  POST(
    new Request("http://localhost/api/tools/invoke", {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}), ...extra },
      body: JSON.stringify(body),
    }),
  );

const listSkus = async (key: string) => {
  const res = await call(key, { tool: "verity.inventory.list_items", input: {} });
  return ((await res.json()) as { result: Array<{ sku: string }> }).result.map((r) => r.sku);
};

describeDb("external tool surface (ADR-029)", () => {
  let a: Fixture;
  let b: Fixture;
  let noCeiling: Fixture;
  let keyA: { keyId: string; key: string };

  beforeAll(async () => {
    process.env.EXTERNAL_TOOLS_ENABLED = "1";
    await assertRlsEnforceable();
    installCapabilities();
    installAdministration();

    a = await makeTenant("Ext A", true);
    b = await makeTenant("Ext B", true);
    noCeiling = await makeTenant("Ext C", false);
    invalidateCapabilityCache();

    keyA = await executeCommand(a.admin, createApiKey, {
      membershipId: a.machineMembershipId, name: "relay", expiresInDays: 30,
    });
  });

  afterAll(async () => {
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      for (const id of created.tenants) await admin.$executeRaw`DELETE FROM tenant WHERE id = ${id}::uuid`;
      for (const id of created.users) await admin.$executeRaw`DELETE FROM "user" WHERE id = ${id}::uuid`;
      for (const id of created.parties) await admin.$executeRaw`DELETE FROM party WHERE id = ${id}::uuid`;
    } finally {
      await admin.$disconnect();
    }
    await prisma.$disconnect();
  });

  it("stores only a hash, and the key authenticates to the machine's own actor", async () => {
    const row = await withTenant(a.tenantId, (tx) => tx.externalApiKey.findUniqueOrThrow({ where: { keyId: keyA.keyId } }));
    expect(row.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(keyA.key.split(".")[1]!);

    const auth = await authenticateApiKey(keyA.key);
    expect(auth?.actor).toMatchObject({ tenantId: a.tenantId, membershipId: a.machineMembershipId });
  });

  it("refuses to issue a key for a role the issuer could not grant (grant ceiling)", async () => {
    await expect(
      executeCommand(noCeiling.admin, createApiKey, { membershipId: noCeiling.machineMembershipId, name: "x", expiresInDays: 5 }),
    ).rejects.toThrow();
  });

  it("authenticates nothing malformed, wrong, expired or revoked", async () => {
    const { key } = keyA;
    expect(await authenticateApiKey("nope")).toBeNull();
    expect(await authenticateApiKey(key.slice(0, -1) + (key.endsWith("A") ? "B" : "A"))).toBeNull();
    expect(await authenticateApiKey(`vrk_${"0".repeat(16)}.${"A".repeat(43)}`)).toBeNull();

    const expiring = await executeCommand(a.admin, createApiKey, { membershipId: a.machineMembershipId, name: "short", expiresInDays: 1 });
    expect(await authenticateApiKey(expiring.key, new Date(Date.now() + 2 * 86_400_000))).toBeNull();

    const revoked = await executeCommand(a.admin, createApiKey, { membershipId: a.machineMembershipId, name: "gone", expiresInDays: 30 });
    expect(await authenticateApiKey(revoked.key)).not.toBeNull();
    await executeCommand(a.admin, revokeApiKey, { keyId: revoked.keyId });
    expect(await authenticateApiKey(revoked.key)).toBeNull();
    expect(await authenticateApiKey(key)).not.toBeNull();
  });

  it("keeps key rows behind tenant isolation", async () => {
    const seenByB = await withTenant(b.tenantId, (tx) => tx.externalApiKey.findMany());
    expect(seenByB).toHaveLength(0);
  });

  it("answers 503 when the surface is not enabled, and 401 without a valid key", async () => {
    process.env.EXTERNAL_TOOLS_ENABLED = "0";
    expect((await call(keyA.key, { tool: "verity.inventory.list_items" })).status).toBe(503);
    process.env.EXTERNAL_TOOLS_ENABLED = "1";

    expect((await call(null, { tool: "verity.inventory.list_items" })).status).toBe(401);
    expect((await call("vrk_bad", { tool: "verity.inventory.list_items" })).status).toBe(401);
  });

  it("runs a query as the key's tenant and never shows another tenant's rows", async () => {
    await executeCommand(b.admin, createItem, { sku: "B-ONLY", name: "Tenant B item", unitLabel: "pcs" });
    const res = await call(keyA.key, { tool: "verity.inventory.list_items", input: {} });
    expect(res.status).toBe(200);
    expect(await listSkus(keyA.key)).not.toContain("B-ONLY");
  });

  it("refuses a body that tries to name another tenant", async () => {
    const res = await call(keyA.key, { tool: "verity.inventory.list_items", input: {}, tenantId: b.tenantId });
    expect(res.status).toBe(422);
  });

  it("requires an Idempotency-Key on commands, and applies a retried command exactly once", async () => {
    const body = { tool: "verity.inventory.create_item", input: { sku: "IDEM-1", name: "Once", unitLabel: "pcs" } };

    expect((await call(keyA.key, body)).status).toBe(422);

    const idem = `idem-${randomUUID()}`;
    const first = await call(keyA.key, body, { "idempotency-key": idem });
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    const replay = await call(keyA.key, body, { "idempotency-key": idem });
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotent-replay")).toBe("true");
    expect(await replay.json()).toEqual(firstBody);

    expect((await listSkus(keyA.key)).filter((s) => s === "IDEM-1")).toHaveLength(1);
  });

  it("rejects the same Idempotency-Key reused with a different request", async () => {
    const idem = `idem-${randomUUID()}`;
    await call(keyA.key, { tool: "verity.inventory.create_item", input: { sku: "IDEM-2", name: "Two", unitLabel: "pcs" } }, { "idempotency-key": idem });
    const other = await call(
      keyA.key,
      { tool: "verity.inventory.create_item", input: { sku: "IDEM-3", name: "Three", unitLabel: "pcs" } },
      { "idempotency-key": idem },
    );
    expect(other.status).toBe(422);
  });

  it("lets a failed command be retried: only successes are remembered", async () => {
    const idem = `idem-${randomUUID()}`;
    const bad = { tool: "verity.inventory.create_item", input: { sku: "", name: "", unitLabel: "" } };
    expect((await call(keyA.key, bad, { "idempotency-key": idem })).status).toBe(422);
    const rows = await withTenant(a.tenantId, (tx) => tx.externalIdempotency.count({ where: { idempotencyKey: idem } }));
    expect(rows).toBe(0);
  });

  it("throttles repeated failed authentication by source, without touching a valid caller", async () => {
    const source = { "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200)}-${randomUUID()}` };
    let throttled = false;
    for (let i = 0; i < 60 && !throttled; i++) {
      const res = await call("vrk_wrong", { tool: "verity.inventory.list_items" }, source);
      throttled = res.status === 429;
      if (throttled) expect(res.headers.get("retry-after")).toBeTruthy();
    }
    expect(throttled).toBe(true);

    // The same source with a valid key is not counted and not refused.
    expect((await call(keyA.key, { tool: "verity.inventory.list_items", input: {} }, source)).status).toBe(200);
  });

  it("does not let a machine key mint or revoke keys, or reach a tool it holds no grant for", async () => {
    const mint = await call(
      keyA.key,
      { tool: "verity.platform.create_api_key", input: { membershipId: a.machineMembershipId, name: "x", expiresInDays: 1 } },
      { "idempotency-key": `idem-${randomUUID()}` },
    );
    const revoke = await call(
      keyA.key,
      { tool: "verity.platform.revoke_api_key", input: { keyId: keyA.keyId } },
      { "idempotency-key": `idem-${randomUUID()}` },
    );
    const unknown = await call(keyA.key, { tool: "verity.does.not.exist", input: {} });

    // Not granted, so indistinguishable from a tool that does not exist.
    expect(mint.status).toBe(404);
    expect(revoke.status).toBe(404);
    expect(unknown.status).toBe(404);
  });
});
