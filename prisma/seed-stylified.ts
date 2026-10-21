/**
 * Seeds the Stylified demo tenant (clients/stylified): a Ludhiana garment maker working in lots with piece-rate
 * karigars. Synthetic data only, built on the client's own PRD sample (Garment_Visual_Blueprint: LOT-0001, design D-101,
 * 500 pieces; Karigar A at Rs 12 a piece). Safe to show a prospect.
 *
 * Two logins, so the "only the munshi enters data" rule can be shown rather than described:
 *   - the Munshi can create and edit everything;
 *   - the Owner can only read (dashboard, lots, karigars, reports).
 *
 * Identity, chosen by the environment (same two modes as seed-dsew.ts):
 *   - OIDC: STYLIFIED_MUNSHI_SUB and/or STYLIFIED_OWNER_SUB are the IdP `sub` of existing logins (at least one);
 *   - Supabase: with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set and no subs, both logins are created with
 *     generated passwords, printed once.
 *
 * The tenant is flagged `customFields.demo = true`, which `reset-demo.ts` requires before it deletes one
 * (`DEMO_TENANT_NAME=Stylified npx tsx prisma/reset-demo.ts`).
 *
 * NEVER run this against the production database without the product owner's say-so: it creates a login.
 * Idempotency: NONE. A second run makes a second tenant; reset first.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { installCapabilities } from "../src/server/capabilities/registry";
import { provisionIdentity } from "../src/server/platform/identity";
import { activateCapability, invalidateCapabilityCache } from "../src/server/platform/capability";
import { executeCommand as rawExecute, type ActorContext } from "../src/server/platform/command";
import * as piecework from "../src/server/capabilities/piecework";

const TENANT_NAME = "Stylified";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
let MUNSHI_SUB = process.env.STYLIFIED_MUNSHI_SUB;
let OWNER_SUB = process.env.STYLIFIED_OWNER_SUB;
const MUNSHI_EMAIL = process.env.STYLIFIED_MUNSHI_EMAIL ?? "munshi@stylified.demo";
const OWNER_EMAIL = process.env.STYLIFIED_OWNER_EMAIL ?? "owner@stylified.demo";

if (!MUNSHI_SUB && !OWNER_SUB && !(SUPABASE_URL && SERVICE_ROLE_KEY)) {
  throw new Error("Set STYLIFIED_MUNSHI_SUB and/or STYLIFIED_OWNER_SUB (OIDC), or SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
}

function suggestPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  let out = "";
  for (let i = 0; i < 14; i += 1) out += alphabet[parseInt(bytes.slice(i * 2, i * 2 + 2), 16) % alphabet.length];
  return out;
}

const createdAuthUsers: string[] = [];
const passwords: Record<string, string> = {};

async function ensureLogin(email: string, displayName: string): Promise<string> {
  const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const password = suggestPassword();
  const created = await supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: displayName } });
  if (created.error || !created.data.user) throw new Error(`could not create the login ${email}: ${created.error?.message}`);
  createdAuthUsers.push(created.data.user.id);
  passwords[email] = password;
  return created.data.user.id;
}

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });

/** The platform rate-limits commands per actor; a seed makes hundreds, so it waits the quota out like any client. */
const executeCommand = (async (...args: Parameters<typeof rawExecute>) => {
  for (;;) {
    try {
      return await rawExecute(...args);
    } catch (error) {
      const e = error as { code?: string; retryAfterSeconds?: number };
      if (e.code !== "E_RATE_LIMIT") throw error;
      await new Promise((resolve) => setTimeout(resolve, ((e.retryAfterSeconds ?? 5) + 1) * 1000));
    }
  }
}) as typeof rawExecute;

async function withTenant<T>(tenantId: string, fn: (tx: typeof admin) => Promise<T>): Promise<T> {
  return admin.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('verity.tenant_id', ${tenantId}, true)`;
    return fn(tx as typeof admin);
  });
}

const ENTITIES = [
  piecework.ENTITY_PIECEWORK_STAGE,
  piecework.ENTITY_PIECEWORK_LOT,
  piecework.ENTITY_PIECEWORK_WORKER,
  piecework.ENTITY_PIECEWORK_ENTRY,
  piecework.ENTITY_PIECEWORK_PAYMENT,
];

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function main() {
  installCapabilities();
  if (!MUNSHI_SUB && !OWNER_SUB) {
    MUNSHI_SUB = await ensureLogin(MUNSHI_EMAIL, "Munshi");
    OWNER_SUB = await ensureLogin(OWNER_EMAIL, "Owner");
  }
  const tenantId = randomUUID();

  const ids = await withTenant(tenantId, async (tx) => {
    await tx.tenant.create({ data: { id: tenantId, name: TENANT_NAME, timeZone: "Asia/Kolkata", customFields: { demo: true, demoFor: "stylified" } } });
    const org = await tx.organization.create({ data: { tenantId, name: TENANT_NAME, parentId: null } });

    // The munshi writes; the owner only reads. Both land on the generic overview after sign-in.
    const munshiRole = await tx.role.create({ data: { tenantId, name: "Munshi" } });
    const ownerRole = await tx.role.create({ data: { tenantId, name: "Owner" } });
    await tx.permission.createMany({
      data: ENTITIES.flatMap((entity) =>
        (["Read", "Create", "Edit", "ActionExecute"] as const).map((verb) => ({ tenantId, roleId: munshiRole.id, verb, entity, scope: "Tenant" as const })),
      ),
    });
    // The owner reads lots, karigars, money and reports. The entry screen is the munshi's, so the owner is not
    // granted the entry entity at all: its menu item and buttons never appear.
    await tx.permission.createMany({
      data: ENTITIES.filter((entity) => entity !== piecework.ENTITY_PIECEWORK_ENTRY).map((entity) => ({
        tenantId, roleId: ownerRole.id, verb: "Read" as const, entity, scope: "Tenant" as const,
      })),
    });
    for (const role of [munshiRole, ownerRole]) {
      await tx.permission.create({ data: { tenantId, roleId: role.id, verb: "Read", entity: "verity.platform.overview", scope: "Tenant" } });
    }

    const login = async (sub: string | undefined, name: string, email: string, roleId: string) => {
      if (!sub) return null;
      const identity = await provisionIdentity(tx, { organizationId: org.id, authUserId: sub, displayName: name, email });
      await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId } });
      return identity;
    };
    const munshi = await login(MUNSHI_SUB, "Munshi", MUNSHI_EMAIL, munshiRole.id);
    const owner = await login(OWNER_SUB, "Owner", OWNER_EMAIL, ownerRole.id);
    await activateCapability(tx, tenantId, piecework.PIECEWORK_CAPABILITY);
    return { orgId: org.id, munshiRoleId: munshiRole.id, ownerRoleId: ownerRole.id, munshi, owner };
  });
  invalidateCapabilityCache();

  // Entries are written as the munshi, which is who writes them in the business. With only an owner login the
  // owner is promoted for the seeding run and put back to view-only afterwards.
  const writer = ids.munshi ?? ids.owner!;
  if (!ids.munshi) await withTenant(tenantId, (tx) => tx.tenantMembership.update({ where: { id: ids.owner!.membershipId }, data: { roleId: ids.munshiRoleId } }));
  const actor: ActorContext = { tenantId, userId: writer.userId, membershipId: writer.membershipId, organizationId: ids.orgId, roleId: ids.munshiRoleId };
  invalidateCapabilityCache();

  // The stage chain, as the client wrote it. Lot Creation and Ready are the start and the end, not stages.
  const stage: Record<string, string> = {};
  for (const [key, label] of [["cutting", "Cutting"], ["stitching", "Stitching"], ["kaj", "Button / Kaj"], ["finishing", "Finishing"], ["press", "Press"]] as const) {
    stage[key] = (await executeCommand(actor, piecework.defineStage, { stageKey: key, label })).id;
  }

  // Rates are in paise per piece. Karigar A at Rs 12 is the PRD's own sample.
  const since = day(-60);
  const rate = (stageKey: string, rupees: number) => ({ stageId: stage[stageKey]!, rateMinor: Math.round(rupees * 100), effectiveFrom: since });
  const worker: Record<string, string> = {};
  const workers: Array<[string, string, string, number]> = [
    ["masterji", "Master Ji (cutter)", "98140 11001", 2],
    ["A", "Karigar A", "98765 43210", 12],
    ["B", "Karigar B", "98765 43211", 12.5],
    ["F", "Karigar F", "98765 43216", 11],
    ["C", "Karigar C (button and kaj)", "98765 43212", 4],
    ["D", "Karigar D (finishing)", "98765 43213", 3],
    ["E", "Karigar E (press)", "98765 43214", 2.5],
  ];
  const workStage: Record<string, string> = { masterji: "cutting", A: "stitching", B: "stitching", F: "stitching", C: "kaj", D: "finishing", E: "press" };
  for (const [key, name, mobile, rupees] of workers) {
    worker[key] = (await executeCommand(actor, piecework.defineWorker, { name, mobile, rates: [rate(workStage[key]!, rupees)] })).id;
  }

  /** A lot made `ago` days ago: its creation date is moved back so entries can carry real, earlier dates. */
  async function lot(design: string, total: number, ago: number, note?: string) {
    const created = await executeCommand(actor, piecework.createLot, { design, totalPieces: total, note });
    await admin.$executeRaw`UPDATE piecework_lot SET created_at = ${new Date(`${day(-ago)}T06:00:00.000Z`)} WHERE id = ${created.id}::uuid`;
    return created.id;
  }
  const put = (lotId: string, stageKey: string, who: string, kind: "issue" | "receive", pieces: number, ago: number) =>
    executeCommand(actor, piecework.recordEntry, { lotId, stageId: stage[stageKey]!, workerId: worker[who]!, kind, pieces, entryDate: day(-ago) });

  // LOT-0001, design D-101, 500 pieces: the PRD's own picture. Stitching 500/320/180, kaj 320/200/120,
  // finishing 200/150/50, press 150/100/50, 100 ready (5 bundles).
  const lot1 = await lot("D-101", 500, 14, "The sample lot from the blueprint");
  await put(lot1, "cutting", "masterji", "issue", 500, 14);
  await put(lot1, "cutting", "masterji", "receive", 500, 12);
  await put(lot1, "stitching", "A", "issue", 300, 12);
  await put(lot1, "stitching", "B", "issue", 200, 12);
  await put(lot1, "stitching", "A", "receive", 200, 8);
  await put(lot1, "stitching", "B", "receive", 120, 6);
  await put(lot1, "kaj", "C", "issue", 320, 6);
  await put(lot1, "kaj", "C", "receive", 200, 2);
  await put(lot1, "finishing", "D", "issue", 200, 2);
  await put(lot1, "finishing", "D", "receive", 150, 1);
  await put(lot1, "press", "E", "issue", 150, 1);
  await put(lot1, "press", "E", "receive", 100, 0);

  // LOT-0002, D-205, 300 pieces: with one karigar at stitching for nine days.
  const lot2 = await lot("D-205", 300, 10);
  await put(lot2, "cutting", "masterji", "issue", 300, 10);
  await put(lot2, "cutting", "masterji", "receive", 300, 9);
  await put(lot2, "stitching", "F", "issue", 300, 9);
  await put(lot2, "stitching", "F", "receive", 100, 4);

  // LOT-0003, D-310, 400 pieces: just handed to the cutter.
  const lot3 = await lot("D-310", 400, 2);
  await put(lot3, "cutting", "masterji", "issue", 400, 2);

  // LOT-0004, D-120, 200 pieces: finished, all ready (10 bundles).
  const lot4 = await lot("D-120", 200, 20);
  await put(lot4, "cutting", "masterji", "issue", 200, 20);
  await put(lot4, "cutting", "masterji", "receive", 200, 19);
  await put(lot4, "stitching", "A", "issue", 200, 19);
  await put(lot4, "stitching", "A", "receive", 200, 16);
  await put(lot4, "kaj", "C", "issue", 200, 16);
  await put(lot4, "kaj", "C", "receive", 200, 15);
  await put(lot4, "finishing", "D", "issue", 200, 15);
  await put(lot4, "finishing", "D", "receive", 200, 14);
  await put(lot4, "press", "E", "issue", 200, 14);
  await put(lot4, "press", "E", "receive", 200, 13);

  // LOT-0005, D-450, 150 pieces: created today, not started.
  await executeCommand(actor, piecework.createLot, { design: "D-450", totalPieces: 150 });

  // The karigar ledger: an advance, then a payment inside what had been earned.
  await executeCommand(actor, piecework.recordPayment, { workerId: worker.A!, kind: "advance", amountMinor: 50_000, paidOn: day(-10), note: "Festival advance" });
  await executeCommand(actor, piecework.recordPayment, { workerId: worker.A!, kind: "payment", amountMinor: 100_000, paidOn: day(-3) });
  await executeCommand(actor, piecework.recordPayment, { workerId: worker.C!, kind: "payment", amountMinor: 60_000, paidOn: day(-2) });
  await executeCommand(actor, piecework.recordPayment, { workerId: worker.masterji!, kind: "advance", amountMinor: 20_000, paidOn: day(-5) });

  // Put the owner back to view-only if they were promoted just to run the seed.
  if (!ids.munshi) await withTenant(tenantId, (tx) => tx.tenantMembership.update({ where: { id: ids.owner!.membershipId }, data: { roleId: ids.ownerRoleId } }));

  console.log("\nStylified demo tenant is ready.\n");
  console.log(`Tenant:  ${tenantId}`);
  for (const email of Object.keys(passwords)) console.log(`Login:   ${email}  password ${passwords[email]}  (shown once)`);
  if (!Object.keys(passwords).length) console.log(`Munshi:  ${MUNSHI_SUB ? `IdP sub ${MUNSHI_SUB}` : "(none)"}\nOwner:   ${OWNER_SUB ? `IdP sub ${OWNER_SUB}` : "(none)"}`);
  console.log("Lots: 5 (LOT-0001 is the PRD sample), karigars: 7, stages: 5. Everything is fictional.");
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
    if (createdAuthUsers.length && SUPABASE_URL && SERVICE_ROLE_KEY) {
      const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      for (const id of createdAuthUsers) await supabase.auth.admin.deleteUser(id).catch(() => {});
      console.error("Removed the logins created by this run. Run reset-demo to clear any partial tenant.");
    }
  })
  .finally(async () => {
    await admin.$disconnect();
  });
