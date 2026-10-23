/**
 * Gives every login of the DSEW demo tenant one known password, so the demonstration can be shown without hunting for the one the
 * seed printed. Touches ONLY the tenant flagged demoFor = "dsew", and only the Supabase logins that belong to its members. Never prints
 * the password; prints each login's email and role.
 *
 *   DSEW_DEMO_PASSWORD=... node prisma/run-seed.cjs set-dsew-demo-passwords.ts      (needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)
 *
 * A demonstration password is a convenience for a prospect meeting, not a pattern for a client's workspace.
 */
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

const password = process.env.DSEW_DEMO_PASSWORD;
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!password || password.length < 8) throw new Error("Set DSEW_DEMO_PASSWORD (at least 8 characters)");
if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });

async function main() {
  const tenants = await admin.$queryRaw<Array<{ id: string }>>`SELECT id FROM public.tenant WHERE custom_fields->>'demoFor' = 'dsew'`;
  if (tenants.length !== 1) throw new Error(`expected exactly one DSEW demo tenant, found ${tenants.length}`);
  const members = await admin.$queryRaw<Array<{ auth_user_id: string; role: string | null }>>`
    SELECT u.auth_user_id::text AS auth_user_id, r.name AS role
      FROM public.tenant_membership m
      JOIN public."user" u ON u.id = m.user_id
      LEFT JOIN public.role r ON r.id = m.role_id
     WHERE m.tenant_id = ${tenants[0]!.id}::uuid AND m.disabled_at IS NULL
       -- The platform operator is a member of every client tenant it supports; its login is not part of the demonstration.
       AND (r.name IS NULL OR r.name <> 'Verity Operator')`;
  const supabase = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const member of members) {
    const found = await supabase.auth.admin.getUserById(member.auth_user_id);
    if (found.error || !found.data.user) {
      console.log(`${member.role ?? "no role"}: no Supabase login for ${member.auth_user_id}, skipped`);
      continue;
    }
    const done = await supabase.auth.admin.updateUserById(member.auth_user_id, { password, email_confirm: true });
    console.log(`${(member.role ?? "no role").padEnd(14)} ${found.data.user.email}: ${done.error ? `FAILED ${done.error.message}` : "password set"}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await admin.$disconnect();
  });
