/**
 * Adds two shop-floor roles and a demo login for each to the existing D & S Electric Works demo tenant,
 * so the worker experience (phone and tablet) can be shown and tested as a worker would see it.
 *
 *   Floor worker  reads and works stages only: Shop floor and nothing else. No jobs, customers, money,
 *                 stock values or accounting. Lands on the Shop floor.
 *   Supervisor    the floor plus what a lead needs to plan it: manufacturing orders, routes, bills of
 *                 materials, batches. Still no money, jobs, customers or accounting.
 *
 * Grants are per entity (Read / ActionExecute at Tenant scope); the sidebar, the phone tab bar and the
 * landing page all follow from them, so nothing here names a screen. Synthetic data only.
 * Idempotent: a role or login that exists is kept. Touches ONLY a tenant flagged demoFor = "dsew".
 *
 * Supabase logins need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The password is DSEW_WORKER_PASSWORD
 * when set, otherwise generated and printed once.
 *
 *   npm run seed:dsew-roles
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { provisionIdentity } from "../src/server/platform/identity";
import * as manufacturing from "../src/server/capabilities/manufacturing";

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

type Verb = "Read" | "Create" | "Edit" | "ActionExecute";
const ROLES: Array<{ name: string; email: string; person: string; grants: Array<[string, Verb[]]> }> = [
  {
    name: "Floor worker",
    email: "worker@dsew.demo",
    person: "Floor Worker",
    grants: [[manufacturing.ENTITY_MANUFACTURING_OPERATION, ["Read", "ActionExecute"]]],
  },
  {
    name: "Supervisor",
    email: "supervisor@dsew.demo",
    person: "Floor Supervisor",
    grants: [
      [manufacturing.ENTITY_MANUFACTURING_OPERATION, ["Read", "ActionExecute"]],
      [manufacturing.ENTITY_MANUFACTURING_ORDER, ["Read"]],
      [manufacturing.ENTITY_MANUFACTURING_ROUTE, ["Read"]],
      [manufacturing.ENTITY_MANUFACTURING_BOM, ["Read"]],
      [manufacturing.ENTITY_MANUFACTURING_BATCH, ["Read"]],
    ],
  },
];

function password(): string {
  if (process.env.DSEW_WORKER_PASSWORD) return process.env.DSEW_WORKER_PASSWORD;
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  let out = "";
  for (let i = 0; i < 14; i += 1) out += alphabet[parseInt(bytes.slice(i * 2, i * 2 + 2), 16) % alphabet.length];
  return out;
}

async function withTenant<T>(tenantId: string, fn: (tx: typeof admin) => Promise<T>): Promise<T> {
  return admin.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('verity.tenant_id', ${tenantId}, true)`;
    return fn(tx as typeof admin);
  });
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to create the logins");
  const tenants = await admin.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM public.tenant WHERE custom_fields->>'demoFor' = 'dsew'`;
  if (tenants.length !== 1) throw new Error(`expected exactly one DSEW demo tenant, found ${tenants.length}`);
  const tenantId = tenants[0]!.id;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const shared = password();
  let generated = !process.env.DSEW_WORKER_PASSWORD;

  const organizationId = await withTenant(tenantId, async (tx) => {
    const m = await tx.tenantMembership.findFirst({ where: { tenantId }, select: { organizationId: true } });
    if (!m) throw new Error("tenant has no membership");
    return m.organizationId;
  });

  for (const spec of ROLES) {
    const roleId = await withTenant(tenantId, async (tx) => {
      const existing = await tx.role.findFirst({ where: { tenantId, name: spec.name } });
      const role = existing ?? (await tx.role.create({ data: { tenantId, name: spec.name } }));
      await tx.permission.createMany({
        data: spec.grants.flatMap(([entity, verbs]) => verbs.map((verb) => ({ tenantId, roleId: role.id, verb, entity, scope: "Tenant" as const }))),
        skipDuplicates: true,
      });
      return role.id;
    });

    const have = await withTenant(tenantId, (tx) => tx.tenantMembership.count({ where: { tenantId, roleId } }));
    if (have > 0) {
      console.log(`${spec.name}: role and login already exist.`);
      generated = false;
      continue;
    }
    const created = await supabase.auth.admin.createUser({
      email: spec.email,
      password: shared,
      email_confirm: true,
      user_metadata: { display_name: spec.person },
    });
    if (created.error || !created.data.user) throw new Error(`could not create ${spec.email}: ${created.error?.message}`);
    try {
      await withTenant(tenantId, async (tx) => {
        const identity = await provisionIdentity(tx, { organizationId, authUserId: created.data.user!.id, displayName: spec.person, email: spec.email });
        await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId } });
      });
    } catch (error) {
      await supabase.auth.admin.deleteUser(created.data.user.id).catch(() => {});
      throw error;
    }
    console.log(`${spec.name}: created ${spec.email}`);
  }
  if (generated) console.log(`Password for both logins (shown once): ${shared}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await admin.$disconnect();
  });
