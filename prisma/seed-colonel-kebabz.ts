/**
 * Bootstraps Colonel Kebabz as a Verity client tenant, end to end: Tenant,
 * root Organization, one child Organization per outlet (each owning exactly
 * one Location, per `trading/scope.ts`'s and `dinein/scope.ts`'s shared
 * assumption that a scoped record's Organization IS its outlet), a real
 * Supabase Auth login for the owner, roles, the shared central menu, and a
 * floor (zone + tables) at each of the three outlets.
 *
 * Modelled on `operator-bootstrap-core.ts`'s `asMigrationRoleInTenant` (raw tenant/org
 * rows, RLS satisfied by setting the tenant GUC even though this connection
 * is the migration role) and `seed-plywood-demo.ts`'s use of `executeCommand`
 * for everything the capability itself owns — a seed script writes through
 * commands wherever a command exists, exactly like the application does.
 *
 * Idempotency: NONE. Run once. A second run creates a second tenant.
 *
 * Run: npx tsx prisma/seed-colonel-kebabz.ts
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { installCapabilities } from "../src/server/capabilities/registry";
import { provisionIdentity } from "../src/server/platform/identity";
import { activateCapability, setConfig } from "../src/server/platform/capability";
import { executeCommand, type ActorContext } from "../src/server/platform/command";
import {
  CONFIG_CGST_RATE,
  CONFIG_SGST_RATE,
  CONFIG_PREP_TARGET_MINUTES,
  DINEIN_CAPABILITY,
  ENTITY_BILL,
  ENTITY_MENU_CATEGORY,
  ENTITY_MENU_ITEM,
  ENTITY_MENU_VARIANT,
  ENTITY_ORDER,
  ENTITY_ORDER_LINE,
  ENTITY_PAYMENT,
  ENTITY_TABLE,
  ENTITY_ZONE,
  createMenuCategory,
  createMenuItem,
  defineTable,
  defineZone,
} from "../src/server/capabilities/dinein";
import { ENTITY_LOCATION } from "../src/server/capabilities/location";
import { ENTITY_MEMBERSHIP, ENTITY_ORGANIZATION } from "../src/server/platform/administration";
import { asMigrationRoleInTenant } from "./migration-role";

const OWNER_EMAIL = "owner@colonelkebabz.verity.app";

function suggestPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  let out = "";
  for (let i = 0; i < 14; i += 1) {
    out += alphabet[parseInt(bytes.slice(i * 2, i * 2 + 2), 16) % alphabet.length];
  }
  return out;
}

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });

const OUTLETS = [
  { name: "Defence Colony" },
  { name: "R.K. Puram / Som Vihar" },
  { name: "Gurugram" },
] as const;

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are required to create a real login.");
  }

  installCapabilities();

  const tenantId = randomUUID();
  const password = suggestPassword();

  // Real auth account first, same order `createTeamLogin` uses: authorize
  // conceptually happens by virtue of this being an operator-run script,
  // account second, identity third, and the account is removed if anything
  // after it fails.
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const created = await supabaseAdmin.auth.admin.createUser({
    email: OWNER_EMAIL,
    password,
    email_confirm: true,
    user_metadata: { display_name: "Colonel Kebabz Owner" },
  });
  if (created.error || !created.data.user) {
    throw new Error(`could not create the owner login: ${created.error?.message}`);
  }
  const authUserId = created.data.user.id;

  try {
    const { rootOrgId, outletOrgIds, outletLocationIds, ownerRoleId, ownerMembershipId, ownerUserId } =
      await asMigrationRoleInTenant(admin, tenantId, async (tx) => {
        await tx.tenant.create({ data: { id: tenantId, name: "Colonel Kebabz", timeZone: "Asia/Kolkata" } });

        const rootOrg = await tx.organization.create({
          data: { tenantId, name: "Colonel Kebabz", parentId: null },
        });

        const outletOrgIds: string[] = [];
        const outletLocationIds: string[] = [];
        for (const outlet of OUTLETS) {
          const org = await tx.organization.create({
            data: { tenantId, name: outlet.name, parentId: rootOrg.id },
          });
          const location = await tx.location.create({
            data: { tenantId, organizationId: org.id, name: outlet.name },
          });
          outletOrgIds.push(org.id);
          outletLocationIds.push(location.id);
        }

        const ownerRole = await tx.role.create({ data: { tenantId, name: "Owner" } });

        const dineinEntities = [
          ENTITY_MENU_CATEGORY,
          ENTITY_MENU_ITEM,
          ENTITY_MENU_VARIANT,
          ENTITY_ZONE,
          ENTITY_TABLE,
          ENTITY_ORDER,
          ENTITY_ORDER_LINE,
          ENTITY_BILL,
          ENTITY_PAYMENT,
        ];
        await tx.permission.createMany({
          data: dineinEntities.flatMap((entity) =>
            (["Read", "Create", "Edit", "ActionExecute"] as const).map((verb) => ({
              tenantId,
              roleId: ownerRole.id,
              verb,
              entity,
              scope: "Tenant" as const,
            })),
          ),
        });
        // Enough to see outlets and create further logins from the People
        // screen (createTeamLogin, src/server/actions/people.ts) without
        // reaching into platform administration otherwise.
        await tx.permission.createMany({
          data: [
            { tenantId, roleId: ownerRole.id, verb: "Read", entity: ENTITY_LOCATION, scope: "Tenant" },
            { tenantId, roleId: ownerRole.id, verb: "Read", entity: ENTITY_ORGANIZATION, scope: "Tenant" },
            { tenantId, roleId: ownerRole.id, verb: "Create", entity: ENTITY_MEMBERSHIP, scope: "Tenant" },
            { tenantId, roleId: ownerRole.id, verb: "Edit", entity: ENTITY_MEMBERSHIP, scope: "Tenant" },
          ],
        });

        const identity = await provisionIdentity(tx, {
          organizationId: rootOrg.id,
          authUserId,
          displayName: "Colonel Kebabz Owner",
          email: OWNER_EMAIL,
        });
        await tx.tenantMembership.update({
          where: { id: identity.membershipId },
          data: { roleId: ownerRole.id },
        });

        await activateCapability(tx, tenantId, DINEIN_CAPABILITY);
        // 2.5% + 2.5% — the standard Indian restaurant GST split.
        await setConfig(tx, tenantId, CONFIG_CGST_RATE, 2.5, "Tenant");
        await setConfig(tx, tenantId, CONFIG_SGST_RATE, 2.5, "Tenant");
        await setConfig(tx, tenantId, CONFIG_PREP_TARGET_MINUTES, 15, "Tenant");

        return {
          rootOrgId: rootOrg.id,
          outletOrgIds,
          outletLocationIds,
          ownerRoleId: ownerRole.id,
          ownerMembershipId: identity.membershipId,
          ownerUserId: identity.userId,
        };
      });

    const owner: ActorContext = {
      tenantId,
      userId: ownerUserId,
      membershipId: ownerMembershipId,
      organizationId: rootOrgId,
      roleId: ownerRoleId,
    };

    // The shared central menu (PRD §12: one menu, HQ-controlled, visible at
    // every outlet — no per-outlet override in this slice).
    const starters = await executeCommand(owner, createMenuCategory, { name: "Starters", sortOrder: 0 });
    const mains = await executeCommand(owner, createMenuCategory, { name: "Mains", sortOrder: 1 });
    const breads = await executeCommand(owner, createMenuCategory, { name: "Breads", sortOrder: 2 });

    await executeCommand(owner, createMenuItem, {
      categoryId: starters.id,
      name: "Chicken Seekh Kebab",
      priceMinor: 32_000,
      costMinor: 11_000,
    });
    await executeCommand(owner, createMenuItem, {
      categoryId: starters.id,
      name: "Mutton Seekh Kebab",
      priceMinor: 38_000,
      costMinor: 14_000,
    });
    await executeCommand(owner, createMenuItem, {
      categoryId: starters.id,
      name: "Chicken Tikka",
      priceMinor: 34_000,
      costMinor: 12_000,
    });
    await executeCommand(owner, createMenuItem, {
      categoryId: mains.id,
      name: "Butter Chicken",
      priceMinor: 42_000,
      costMinor: 16_000,
    });
    await executeCommand(owner, createMenuItem, {
      categoryId: mains.id,
      name: "Dal Makhani",
      priceMinor: 28_000,
      costMinor: 8_000,
    });
    await executeCommand(owner, createMenuItem, {
      categoryId: breads.id,
      name: "Butter Naan",
      priceMinor: 6_500,
      costMinor: 1_800,
    });
    await executeCommand(owner, createMenuItem, {
      categoryId: breads.id,
      name: "Tandoori Roti",
      priceMinor: 4_000,
      costMinor: 1_000,
    });

    // A floor at each outlet, proving the same menu serves three independent
    // outlets without any outlet seeing another's tables.
    for (let i = 0; i < OUTLETS.length; i += 1) {
      const locationId = outletLocationIds[i];
      const zone = await executeCommand(owner, defineZone, { locationId, name: "Main Hall" });
      for (const label of ["T1", "T2", "T3", "T4"]) {
        await executeCommand(owner, defineTable, { zoneId: zone.id, label, seats: 4 });
      }
    }

    console.log("\nColonel Kebabz is live.\n");
    console.log(`Tenant:        ${tenantId}`);
    console.log(`Organization:  ${rootOrgId}`);
    OUTLETS.forEach((outlet, i) => {
      console.log(`Outlet:        ${outlet.name} -> org ${outletOrgIds[i]}, location ${outletLocationIds[i]}`);
    });
    console.log(`\nOwner login:   ${OWNER_EMAIL}`);
    console.log(`Password:      ${password}`);
    console.log(`\nSign in at whatever this deployment's /login is; this account is a Tenant-scoped Owner over the whole business.`);
  } catch (error) {
    await supabaseAdmin.auth.admin.deleteUser(authUserId).catch(() => {});
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
