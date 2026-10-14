/**
 * Removes a demo tenant so it can be seeded again clean. Demos are disposable by design: synthetic data,
 * shown to a prospect, then reset.
 *
 * Safety, in order of weight:
 *   1. Only a tenant flagged `customFields.demo = true` AND named exactly DEMO_TENANT_NAME is touched.
 *      A real client can never match, whatever its name, and the platform tenant is excluded outright.
 *   2. It is a dry run unless `--yes` is passed: it prints what it would delete and stops.
 *   3. Logins are removed only when they belong to no other tenant.
 *
 *   npx tsx prisma/reset-demo.ts            # dry run
 *   npx tsx prisma/reset-demo.ts --yes      # delete
 *
 * DEMO_TENANT_NAME defaults to "D & S Electric Works". With SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set
 * the demo's Supabase Auth logins are deleted too; without them only the database rows go.
 */
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

const NAME = process.env.DEMO_TENANT_NAME ?? "D & S Electric Works";
const CONFIRMED = process.argv.includes("--yes");
const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });

async function main() {
  const tenants = await admin.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM tenant
     WHERE name = ${NAME} AND NOT is_platform AND custom_fields->>'demo' = 'true'`;
  if (tenants.length === 0) {
    console.log(`No demo tenant named "${NAME}" (flagged demo) found. Nothing to do.`);
    return;
  }

  const supabase =
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
      ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
      : null;

  for (const { id } of tenants) {
    const users = await admin.$queryRaw<Array<{ user_id: string; auth_user_id: string; party_id: string }>>`
      SELECT DISTINCT u.id AS user_id, u.auth_user_id, u.party_id
        FROM tenant_membership m JOIN "user" u ON u.id = m.user_id
       WHERE m.tenant_id = ${id}::uuid`;
    console.log(`${CONFIRMED ? "Deleting" : "Would delete"} demo tenant ${id} and ${users.length} login(s) that belong to no other tenant.`);
    if (!CONFIRMED) continue;

    await admin.$executeRaw`DELETE FROM tenant WHERE id = ${id}::uuid AND custom_fields->>'demo' = 'true'`;

    for (const u of users) {
      const [{ n }] = await admin.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*)::bigint AS n FROM tenant_membership WHERE user_id = ${u.user_id}::uuid`;
      if (n > 0n) continue;
      await admin.$executeRaw`DELETE FROM "user" WHERE id = ${u.user_id}::uuid`;
      await admin.$executeRaw`DELETE FROM party WHERE id = ${u.party_id}::uuid`;
      if (supabase) await supabase.auth.admin.deleteUser(u.auth_user_id).catch(() => {});
    }
  }
  if (!CONFIRMED) console.log("Dry run only. Pass --yes to delete.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await admin.$disconnect();
  });
