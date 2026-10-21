/**
 * Seeds the Stylified demo tenant (clients/stylified): a Ludhiana garment maker working in lots with piece-rate
 * karigars. Synthetic data only, built on the client's own requirement workbook (shirt factory; bundles with a
 * 100 = 94 good + 2 rejected + 1 rework + 2 short + 1 open reconciliation; Karigar A at Rs 12 a piece on good
 * pieces). Safe to show a prospect.
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
  piecework.ENTITY_PIECEWORK_BUNDLE,
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
    // The owner reads lots, bundles, karigars, money and reports. The entry screen is the munshi's, so the owner is not
    // granted the entry entity at all: its menu item and buttons never appear.
    await tx.permission.createMany({
      data: ENTITIES.filter((entity) => entity !== piecework.ENTITY_PIECEWORK_ENTRY).map((entity) => ({ tenantId, roleId: ownerRole.id, verb: "Read" as const, entity, scope: "Tenant" as const })),
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

  // The process chain after cutting, from the requirement sheet's process master. Cutting happens before a bundle exists
  // (its charge is a lot cost, a later stage); thread is a cost category, not a stage.
  const stage: Record<string, string> = {};
  for (const [key, label] of [["pasting", "Pasting"], ["collar", "Collar & Cuff"], ["stitching", "Stitching"], ["kaj", "Button / Kaj"], ["finishing", "Finishing / Press"]] as const) {
    stage[key] = (await executeCommand(actor, piecework.defineStage, { stageKey: key, label })).id;
  }

  // Rates in paise per piece, each with the basis it is paid on. Pasting is paid on issued pieces, collar and cuff on
  // everything returned, the rest on accepted good pieces: the sheet says the factory uses more than one basis.
  const since = day(-60);
  const rate = (stageKey: string, rupees: number, wageBasis: "issued" | "good" | "returned") => ({ stageId: stage[stageKey]!, rateMinor: Math.round(rupees * 100), wageBasis, effectiveFrom: since });
  const worker: Record<string, string> = {};
  worker.C = (await executeCommand(actor, piecework.defineWorker, { name: "Karigar C (pasting)", mobile: "98140 11003", rates: [rate("pasting", 2, "issued")] })).id;
  worker.B = (await executeCommand(actor, piecework.defineWorker, { name: "Sharma Collar Works", mobile: "98140 11002", kind: "outside", address: "Focal Point Phase 5, Ludhiana", rates: [rate("collar", 5, "returned")] })).id;
  worker.A = (await executeCommand(actor, piecework.defineWorker, { name: "Karigar A", mobile: "98765 43210", rates: [rate("stitching", 12, "good")] })).id;
  worker.F = (await executeCommand(actor, piecework.defineWorker, { name: "Karigar F", mobile: "98765 43216", rates: [rate("stitching", 11, "good")] })).id;
  worker.D = (await executeCommand(actor, piecework.defineWorker, { name: "Karigar D (button and kaj)", mobile: "98765 43213", rates: [rate("kaj", 3, "good")] })).id;
  worker.E = (await executeCommand(actor, piecework.defineWorker, { name: "Karigar E (finishing)", mobile: "98765 43214", rates: [rate("finishing", 4, "good")] })).id;

  /** A lot or bundle made `ago` days ago: its creation date is moved back so entries can carry real, earlier dates. */
  const backdate = async (table: "piecework_lot" | "piecework_bundle", id: string, ago: number) => {
    await admin.$executeRawUnsafe(`UPDATE ${table} SET created_at = '${day(-ago)}T06:00:00Z' WHERE id = '${id}'::uuid`);
  };
  const lot = async (design: string, name: string, planned: number, ago: number, dueIn: number, fabric = "Oxford") => {
    const created = await executeCommand(actor, piecework.createLot, { design, name, plannedPieces: planned, fabricType: fabric, startDate: day(-ago), dueDate: day(dueIn) });
    await backdate("piecework_lot", created.id, ago);
    return created.id;
  };
  const bundle = async (lotId: string, pieces: number, ago: number, mix?: string) => {
    const made = await executeCommand(actor, piecework.createBundle, { lotId, netPieces: pieces, sizeNote: mix });
    await backdate("piecework_bundle", made.id, ago);
    return made.id;
  };
  const out = (bundleId: string, stageKey: string, who: string, pieces: number, ago: number, extra: Record<string, unknown> = {}) =>
    executeCommand(actor, piecework.recordIssue, { bundleId, stageId: stage[stageKey]!, workerId: worker[who]!, pieces, entryDate: day(-ago), ...extra });
  const back = (issueId: string, split: { good?: number; rejected?: number; rework?: number; short?: number }, ago: number) =>
    executeCommand(actor, piecework.recordReturn, { issueId, good: 0, rejected: 0, rework: 0, short: 0, ...split, entryDate: day(-ago) });

  // LOT-0001, Spring formals, 500 planned, four bundles cut, running.
  const lot1 = await lot("Oxford formal, full sleeve", "Spring formals", 500, 14, 20);
  await executeCommand(actor, piecework.setLotStatus, { lotId: lot1, to: "active" });
  const b1 = await bundle(lot1, 100, 13, "M and L mix");
  const b2 = await bundle(lot1, 100, 13, "L and XL mix");
  const b3 = await bundle(lot1, 100, 13);
  await bundle(lot1, 100, 13);

  // B-0001: the requirement sheet's reconciliation, 100 = 94 good + 2 rejected + 1 rework + 2 short + 1 open,
  // then its rework redone and the rest taken through to ready.
  const p1 = await out(b1, "pasting", "C", 100, 12);
  await back(p1.id, { good: 94, rejected: 2, rework: 1, short: 2 }, 10);
  const rw = await out(b1, "pasting", "C", 1, 9, { isRework: true });
  await back(rw.id, { good: 1 }, 8);
  const c1 = await out(b1, "collar", "B", 95, 8);
  await back(c1.id, { good: 90, rejected: 3, rework: 2 }, 6);
  const s1 = await out(b1, "stitching", "A", 90, 6);
  await back(s1.id, { good: 88, rejected: 1, short: 1 }, 3);
  const k1 = await out(b1, "kaj", "D", 88, 3);
  await back(k1.id, { good: 88 }, 2);
  const f1 = await out(b1, "finishing", "E", 88, 2);
  await back(f1.id, { good: 86, rejected: 2 }, 1);

  // B-0002: with Karigar A at stitching, 37 pieces still out, due in two days.
  const p2 = await out(b2, "pasting", "C", 100, 12);
  await back(p2.id, { good: 100 }, 10);
  const c2 = await out(b2, "collar", "B", 100, 10);
  await back(c2.id, { good: 97, rejected: 3 }, 7);
  const s2 = await out(b2, "stitching", "A", 97, 7, { dueDate: day(2) });
  await back(s2.id, { good: 60 }, 3);

  // B-0003: with the outside collar unit, past its expected return date.
  const p3 = await out(b3, "pasting", "C", 100, 9);
  await back(p3.id, { good: 98, short: 2 }, 7);
  await out(b3, "collar", "B", 98, 7, { dueDate: day(-1) });

  // LOT-0002, Winter shirts: planned, still a draft.
  await lot("Flannel check", "Winter shirts", 300, 1, 40, "Flannel");

  // LOT-0003, an older lot, finished, completed and closed: its ledger is locked.
  const lot3 = await lot("Poplin half sleeve", "Summer half sleeves", 50, 40, -18, "Poplin");
  await executeCommand(actor, piecework.setLotStatus, { lotId: lot3, to: "active" });
  const b5 = await bundle(lot3, 50, 39);
  let ago = 38;
  for (const [key, who] of [["pasting", "C"], ["collar", "B"], ["stitching", "A"], ["kaj", "D"], ["finishing", "E"]] as const) {
    const i = await out(b5, key, who, 50, ago);
    await back(i.id, { good: 50 }, ago - 1);
    ago -= 2;
  }
  await executeCommand(actor, piecework.setLotStatus, { lotId: lot3, to: "completed" });
  await executeCommand(actor, piecework.setLotStatus, { lotId: lot3, to: "closed" });

  // LOT-0004, on hold: part of one bundle is out.
  const lot4 = await lot("Export check shirt", "Export sample", 200, 6, 15, "Cotton check");
  await executeCommand(actor, piecework.setLotStatus, { lotId: lot4, to: "active" });
  const b6 = await bundle(lot4, 40, 5);
  await out(b6, "pasting", "C", 20, 4);
  await executeCommand(actor, piecework.setLotStatus, { lotId: lot4, to: "hold" });

  // The karigar ledger: an advance, part of it recovered out of wages, an approved deduction, and payments.
  const pay = (who: string, kind: "advance" | "recovery" | "deduction" | "payment", rupees: number, daysAgo: number, extra: Record<string, unknown> = {}) =>
    executeCommand(actor, piecework.recordPayment, { workerId: worker[who]!, kind, amountMinor: Math.round(rupees * 100), paidOn: day(-daysAgo), ...extra });
  await pay("A", "advance", 500, 10, { mode: "cash", note: "Festival advance" });
  await pay("A", "recovery", 300, 2, { note: "Part of the festival advance" });
  await pay("A", "payment", 1000, 3, { mode: "upi", reference: "UPI 5821993" });
  await pay("E", "deduction", 50, 1, { note: "Scorch mark on two pieces" });
  await pay("E", "payment", 200, 2, { mode: "cash" });
  await pay("B", "payment", 300, 4, { mode: "bank", reference: "NEFT 4471" });
  await pay("D", "payment", 200, 2, { mode: "cash" });

  // Put the owner back to view-only if they were promoted just to run the seed.
  if (!ids.munshi) await withTenant(tenantId, (tx) => tx.tenantMembership.update({ where: { id: ids.owner!.membershipId }, data: { roleId: ids.ownerRoleId } }));

  console.log("\nStylified demo tenant is ready.\n");
  console.log(`Tenant:  ${tenantId}`);
  for (const email of Object.keys(passwords)) console.log(`Login:   ${email}  password ${passwords[email]}  (shown once)`);
  if (!Object.keys(passwords).length) console.log(`Munshi:  ${MUNSHI_SUB ? `IdP sub ${MUNSHI_SUB}` : "(none)"}\nOwner:   ${OWNER_SUB ? `IdP sub ${OWNER_SUB}` : "(none)"}`);
  console.log("Lots: 4 (LOT-0001 running, LOT-0002 draft, LOT-0003 closed, LOT-0004 on hold), bundles: 6, karigars: 6, stages: 5. Everything is fictional.");
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
