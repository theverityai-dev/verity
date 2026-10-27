/**
 * Bootstraps PlotArmour Studio as a NEW Verity tenant (taskplan 105's
 * resolved tenant-boundary decision) and seeds the real 19-person org
 * roster given by the product owner 2026-09-12: Tenant, one root
 * Organization (no sub-units — teams are capability-private
 * `OutreachTeam` rows, not `Organization` nodes, per the taskplan), a real
 * Supabase Auth login for every person, three Roles (Founders / Senior /
 * Junior) with Tenant-scope permissions over the `outreach` capability's
 * entities, two `OutreachTeam`s with their Juniors, and the `outreach`
 * capability activated.
 *
 * Company Core (Divo, Naksh, Ayush, Shubhankar) now have real
 * `@plotarmour.in` emails, given 2026-09-12. The two Seniors (Kulsoom,
 * Radhika) still had none given — they get synthesized internal logins
 * (`<name>@plotarmour.verity.app`), the same shape `seed-colonel-kebabz.ts`
 * uses for its owner login. The 13 Juniors keep their real given
 * emails/phones exactly as provided; phone formats are stored as-is
 * (leading `0`, `+62` country code, no country code) per taskplan 105's
 * explicit "don't silently normalize" note.
 *
 * `email_confirm: true` with no SMTP send means nothing is emailed to
 * anyone — this only creates a Supabase Auth row under each real address.
 * Each login's password is printed to this console ONCE, at creation time,
 * and nowhere else — there is no way to retrieve it after this run exits.
 *
 * Modelled directly on `seed-colonel-kebabz.ts` — same `asMigrationRoleInTenant` raw-row
 * bootstrap, same `executeCommand`-through-commands discipline for
 * everything the capability itself owns.
 *
 * Idempotency: NONE. Run once. A second run creates a second tenant and
 * 19 duplicate Supabase Auth accounts.
 *
 * Run: npx tsx prisma/seed-pa-oms.ts
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { installCapabilities } from "../src/server/capabilities/registry";
import { provisionIdentity } from "../src/server/platform/identity";
import { activateCapability } from "../src/server/platform/capability";
import { executeCommand, type ActorContext } from "../src/server/platform/command";
import {
  createOutreachTeam,
  addTeamMember,
  OUTREACH_CAPABILITY,
  ENTITY_TEAM,
  ENTITY_TEAM_MEMBERSHIP,
  ENTITY_LEAD,
  ENTITY_ACTIVITY,
  ENTITY_TARGET,
  ENTITY_CHECK_IN,
  ENTITY_WEEKLY_REPORT,
  ENTITY_TEAM_WEEKLY_ASSESSMENT,
  ENTITY_DIRECTION,
  ENTITY_TEAM_LEADERSHIP,
  ENTITY_JUNIOR_WORKSPACE,
  ENTITY_CONTACT,
  ENTITY_RESEARCH,
  ENTITY_TASK,
  ENTITY_MEETING,
  ENTITY_COACHING_NOTE,
  ENTITY_AI_INSIGHT,
} from "../src/server/capabilities/outreach";
import { asMigrationRoleInTenant } from "./migration-role";

const TENANT_NAME = "PlotArmour Studio";

function suggestPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  let out = "";
  for (let i = 0; i < 14; i += 1) {
    out += alphabet[parseInt(bytes.slice(i * 2, i * 2 + 2), 16) % alphabet.length];
  }
  return out;
}

type Person = {
  displayName: string;
  email: string;
  phone?: string;
  location?: string;
};

const COMPANY_CORE: Person[] = [
  { displayName: "Divo", email: "divyom.sharma@plotarmour.in" },
  { displayName: "Naksh", email: "nakshshatra.aggarwal@plotarmour.in" },
  { displayName: "Ayush", email: "ayushmaan.gaur@plotarmour.in" },
  { displayName: "Shubhankar", email: "shubhankar.rakshit@plotarmour.in" },
];

// 2026-09-17: corrected from a synthesized `@plotarmour.verity.app` placeholder
// (this file's own outdated comment) to the real address — Supabase Auth
// already has a `kulsoom@plotarmour.in` account, same pattern as Company
// Core's real addresses. Using the placeholder here would have created a
// second, wrong-address account instead of linking the real one.
const TEAM_1_LEADER: Person = { displayName: "Kulsoom", email: "kulsoom@plotarmour.in" };
const TEAM_1_JUNIORS: Person[] = [
  { displayName: "Shreya Bansal", email: "shreyabansal2806@gmail.com", phone: "8383014672", location: "Dehradun, Uttarakhand, India" },
  { displayName: "Prakhar Maheshwari", email: "prakharm385@gmail.com", phone: "9981146588" },
  { displayName: "Hikari Permana Putri", email: "hikaripermana@gmail.com", phone: "+6282318443511", location: "Kota Bandung, Jawa Barat, Indonesia" },
  { displayName: "Mehak Bhatia", email: "bhatiamehak091007@gmail.com", phone: "8080440426", location: "India" },
  { displayName: "Abhishek Singh Chauhan", email: "chauhanabhishek5881@gmail.com", phone: "09336156736", location: "Lucknow, Uttar Pradesh, India" },
  { displayName: "Nishika", email: "nishikaaggarwal84@gmail.com", phone: "8595893323", location: "Delhi, Delhi, India" },
  { displayName: "Khushboo", email: "khushbooyadav6675@gmail.com", phone: "8750074191", location: "Faridabad, Haryana, India" },
];

// 2026-09-17: same correction as Kulsoom above — real registered address.
const TEAM_2_LEADER: Person = { displayName: "Radhika", email: "radhika@plotarmour.in" };
const TEAM_2_JUNIORS: Person[] = [
  { displayName: "Ananya Sree Pentakota", email: "ananyasree1677@gmail.com", phone: "9490185801" },
  { displayName: "Gaurav Thakur", email: "gaurax.3@gmail.com", phone: "8219636135" },
  { displayName: "Neeraj Kumar", email: "neeraj18official@gmail.com", phone: "9315281029" },
  { displayName: "Alvina Sheikh", email: "alvinasheikh.as@gmail.com", phone: "8447155785" },
  { displayName: "Jyoti Tiwari", email: "jt933558@gmail.com", phone: "7835879829" },
  { displayName: "Ananya Tripathi", email: "tripathiananya964@gmail.com", phone: "7897477936" },
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are required to create real logins.");
  }

  installCapabilities();

  const tenantId = randomUUID();
  const supabaseAdmin: SupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const createdAuthUserIds: string[] = [];

  // 2026-09-17: this Supabase project already had real Auth accounts for
  // most of the 19 people (a prior attempt's Auth-side succeeded before its
  // Postgres side did, or was reset separately — Auth and this database are
  // independent systems). Linking to an existing account by email, rather
  // than erroring or creating a duplicate, is what turns this script from
  // "run once on a clean project" into "safe to run against this project's
  // actual current state" — existing people keep their existing password.
  async function findExistingAuthUserId(email: string): Promise<string | null> {
    const rows = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM auth.users WHERE email = ${email} LIMIT 1
    `;
    return rows[0]?.id ?? null;
  }

  async function createLogin(person: Person): Promise<string> {
    const existingId = await findExistingAuthUserId(person.email);
    if (existingId) {
      console.log(`  ${person.displayName.padEnd(24)} ${person.email.padEnd(34)} (existing account — password unchanged)`);
      return existingId;
    }
    const password = suggestPassword();
    const created = await supabaseAdmin.auth.admin.createUser({
      email: person.email,
      password,
      email_confirm: true,
      user_metadata: { display_name: person.displayName },
    });
    if (created.error || !created.data.user) {
      throw new Error(`could not create login for ${person.displayName}: ${created.error?.message}`);
    }
    createdAuthUserIds.push(created.data.user.id);
    console.log(`  ${person.displayName.padEnd(24)} ${person.email.padEnd(34)} ${password}`);
    return created.data.user.id;
  }

  try {
    console.log("Creating logins (password printed once, right here, for each person):\n");

    // All 19 Supabase Auth calls happen BEFORE the DB transaction opens —
    // network round-trips inside an interactive transaction blew its 5s
    // default timeout on the first attempt (rolled back clean, verified).
    // colonel-kebazb's seed only ever had one such call before its
    // transaction; this mirrors that shape at 19x the count instead of
    // nesting the calls inside it.
    console.log("Company Core:");
    const authUserIds = new Map<string, string>(); // email -> authUserId
    for (const p of COMPANY_CORE) authUserIds.set(p.email, await createLogin(p));
    console.log("Team 1:");
    authUserIds.set(TEAM_1_LEADER.email, await createLogin(TEAM_1_LEADER));
    for (const p of TEAM_1_JUNIORS) authUserIds.set(p.email, await createLogin(p));
    console.log("Team 2:");
    authUserIds.set(TEAM_2_LEADER.email, await createLogin(TEAM_2_LEADER));
    for (const p of TEAM_2_JUNIORS) authUserIds.set(p.email, await createLogin(p));

    const { rootOrgId, founderRoleId, byPartyId, byEmail } = await asMigrationRoleInTenant(admin, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: TENANT_NAME, timeZone: "Asia/Kolkata" } });
      const rootOrg = await tx.organization.create({ data: { tenantId, name: TENANT_NAME, parentId: null } });

      const founderRole = await tx.role.create({ data: { tenantId, name: "Founders' Office" } });
      const seniorRole = await tx.role.create({ data: { tenantId, name: "Senior Outreach Officer" } });
      const juniorRole = await tx.role.create({ data: { tenantId, name: "Junior Outreach Officer" } });

      const outreachEntities = [
        ENTITY_TEAM,
        ENTITY_TEAM_MEMBERSHIP,
        ENTITY_LEAD,
        ENTITY_ACTIVITY,
        ENTITY_TARGET,
        ENTITY_CHECK_IN,
        ENTITY_WEEKLY_REPORT,
        ENTITY_TEAM_WEEKLY_ASSESSMENT,
        ENTITY_CONTACT,
        ENTITY_RESEARCH,
        ENTITY_TASK,
        ENTITY_MEETING,
        ENTITY_COACHING_NOTE,
        ENTITY_AI_INSIGHT,
      ];
      // Founders' Office: full company-wide visibility (master-context §7-10).
      await tx.permission.createMany({
        data: outreachEntities.flatMap((entity) =>
          (["Read", "Create", "Edit", "ActionExecute"] as const).map((verb) => ({
            tenantId,
            roleId: founderRole.id,
            verb,
            entity,
            scope: "Tenant" as const,
          })),
        ),
      });
      // Senior: same entity access at Tenant scope for this MVP — real
      // per-team row narrowing happens in query params today, not an
      // Organization-scope grant (teams are capability-private, per the
      // taskplan's resolved decision). Known P0 limitation.
      await tx.permission.createMany({
        data: [
          ...outreachEntities.flatMap((entity) =>
            (["Read", "Create", "Edit", "ActionExecute"] as const).map((verb) => ({
              tenantId,
              roleId: seniorRole.id,
              verb,
              entity,
              scope: "Tenant" as const,
            })),
          ),
          // Nav-gating marker only (2026-09-14) — Senior/Junior share the
          // broad grants above, so entity+verb alone can't tell them apart
          // for the "Team Command"/"My Workspace" sidebar items.
          { tenantId, roleId: seniorRole.id, verb: "Read" as const, entity: ENTITY_TEAM_LEADERSHIP, scope: "Tenant" as const },
        ],
      });
      // Junior: can create/read/act on their own work; cannot edit team or
      // membership rows (master-context §16/§68 — Juniors don't reassign
      // ownership or set targets). Edit on leads is deliberate, not an
      // oversight: advancing a lead's own stage and flagging it for
      // escalation are both ordinary Junior responsibilities (spec §17-19).
      await tx.permission.createMany({
        data: [
          ...[ENTITY_LEAD, ENTITY_ACTIVITY, ENTITY_CHECK_IN, ENTITY_WEEKLY_REPORT, ENTITY_CONTACT, ENTITY_RESEARCH, ENTITY_TASK, ENTITY_MEETING, ENTITY_AI_INSIGHT].flatMap((entity) =>
            (["Read", "Create", "ActionExecute"] as const).map((verb) => ({
              tenantId,
              roleId: juniorRole.id,
              verb,
              entity,
              scope: "Tenant" as const,
            })),
          ),
          { tenantId, roleId: juniorRole.id, verb: "Edit" as const, entity: ENTITY_LEAD, scope: "Tenant" as const },
          { tenantId, roleId: juniorRole.id, verb: "Read" as const, entity: ENTITY_TEAM, scope: "Tenant" as const },
          { tenantId, roleId: juniorRole.id, verb: "Read" as const, entity: ENTITY_TARGET, scope: "Tenant" as const },
          // Read only — a Junior never authors a coaching note, only reads
          // the JuniorVisible ones about themselves (listCoachingNotes'
          // own handler enforces the self-only + visibility narrowing).
          { tenantId, roleId: juniorRole.id, verb: "Read" as const, entity: ENTITY_COACHING_NOTE, scope: "Tenant" as const },
          { tenantId, roleId: juniorRole.id, verb: "Read" as const, entity: ENTITY_DIRECTION, scope: "Tenant" as const },
          // Nav-gating marker only (2026-09-14) — see the Senior grant above.
          { tenantId, roleId: juniorRole.id, verb: "Read" as const, entity: ENTITY_JUNIOR_WORKSPACE, scope: "Tenant" as const },
        ],
      });

      // Company Direction (master-context §10-11): only Founders post it —
      // a separate, narrower grant from the shared `outreachEntities` loop
      // above, which both Founders and Seniors get in full. Senior gets
      // read-only here too (added just above for Junior).
      await tx.permission.createMany({
        data: [
          ...(["Read", "Create", "Edit"] as const).map((verb) => ({
            tenantId,
            roleId: founderRole.id,
            verb,
            entity: ENTITY_DIRECTION,
            scope: "Tenant" as const,
          })),
          { tenantId, roleId: seniorRole.id, verb: "Read" as const, entity: ENTITY_DIRECTION, scope: "Tenant" as const },
        ],
      });

      const byPartyId = new Map<string, { userId: string; membershipId: string }>();
      const byEmail = new Map<string, string>(); // email -> partyId

      // 2026-09-17: this Supabase Auth user may already have a global
      // Party/User from an earlier, differently-completed attempt (the
      // `auth_user_id` unique constraint is what surfaces this — Party/User
      // are global tables per identity.ts's own doc). `provisionIdentity`
      // has no de-dup path by design (its own comment: "do not paper over
      // it here" — that rule is about NOT guessing whether two different
      // logins are the same human). This IS the same login, so it is not
      // that ambiguous case: the correct move is a new TenantMembership on
      // the existing identity, exactly what a second tenant does for one
      // real person (Bible V2 Primitive 2 §2).
      async function findExistingIdentity(authUserId: string): Promise<{ partyId: string; userId: string } | null> {
        const rows = await admin.$queryRaw<Array<{ user_id: string; party_id: string }>>`
          SELECT id::text AS user_id, party_id::text AS party_id FROM public."user" WHERE auth_user_id = ${authUserId}::uuid LIMIT 1
        `;
        const row = rows[0];
        return row ? { userId: row.user_id, partyId: row.party_id } : null;
      }

      async function provision(person: Person, roleId: string) {
        const authUserId = authUserIds.get(person.email)!;
        const existing = await findExistingIdentity(authUserId);
        if (existing) {
          const membership = await tx.tenantMembership.create({
            data: { tenantId, organizationId: rootOrg.id, userId: existing.userId, roleId },
          });
          byPartyId.set(person.email, { userId: existing.userId, membershipId: membership.id });
          byEmail.set(person.email, existing.partyId);
          return;
        }
        const identity = await provisionIdentity(tx, {
          organizationId: rootOrg.id,
          authUserId,
          displayName: person.displayName,
          email: person.email,
          phone: person.phone ?? null,
        });
        await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId } });
        byPartyId.set(person.email, { userId: identity.userId, membershipId: identity.membershipId });
        byEmail.set(person.email, identity.partyId);
      }

      for (const p of COMPANY_CORE) await provision(p, founderRole.id);
      await provision(TEAM_1_LEADER, seniorRole.id);
      for (const p of TEAM_1_JUNIORS) await provision(p, juniorRole.id);
      await provision(TEAM_2_LEADER, seniorRole.id);
      for (const p of TEAM_2_JUNIORS) await provision(p, juniorRole.id);

      await activateCapability(tx, tenantId, OUTREACH_CAPABILITY);

      return { rootOrgId: rootOrg.id, founderRoleId: founderRole.id, byPartyId, byEmail };
    });

    // The first Founder acts as the seeding actor for the outreach commands
    // below — a one-time bootstrap action, not a live product action.
    const founder = COMPANY_CORE[0];
    const founderIdentity = byPartyId.get(founder.email)!;
    const actor: ActorContext = {
      tenantId,
      userId: founderIdentity.userId,
      membershipId: founderIdentity.membershipId,
      organizationId: rootOrgId,
      roleId: founderRoleId,
    };

    const team1 = await executeCommand(actor, createOutreachTeam, {
      name: "Team 1",
      leaderId: byEmail.get(TEAM_1_LEADER.email)!,
    });
    for (const j of TEAM_1_JUNIORS) {
      await executeCommand(actor, addTeamMember, { teamId: team1.id, partyId: byEmail.get(j.email)! });
    }

    const team2 = await executeCommand(actor, createOutreachTeam, {
      name: "Team 2",
      leaderId: byEmail.get(TEAM_2_LEADER.email)!,
    });
    for (const j of TEAM_2_JUNIORS) {
      await executeCommand(actor, addTeamMember, { teamId: team2.id, partyId: byEmail.get(j.email)! });
    }

    console.log("\nPlotArmour Studio is live.\n");
    console.log(`Tenant:        ${tenantId}`);
    console.log(`Organization:  ${rootOrgId}`);
    console.log(`Team 1:        ${team1.id} (Kulsoom + ${TEAM_1_JUNIORS.length} Juniors)`);
    console.log(`Team 2:        ${team2.id} (Radhika + ${TEAM_2_JUNIORS.length} Juniors)`);
    console.log(`\nEvery password above was printed exactly once. Nothing was emailed to anyone.`);
  } catch (error) {
    for (const id of createdAuthUserIds) {
      await supabaseAdmin.auth.admin.deleteUser(id).catch(() => {});
    }
    throw error;
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
