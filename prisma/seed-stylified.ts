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
import { EVIDENCE_CAPABILITY } from "../src/server/capabilities/evidence";
import { LOCATION_CAPABILITY } from "../src/server/capabilities/location";

const TENANT_NAME = "Stylified";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
let MUNSHI_SUB = process.env.STYLIFIED_MUNSHI_SUB;
let OWNER_SUB = process.env.STYLIFIED_OWNER_SUB;
let MANAGER_SUB = process.env.STYLIFIED_MANAGER_SUB;
let SUPA_SUB = process.env.STYLIFIED_SUPERVISOR_A_SUB;
let SUPB_SUB = process.env.STYLIFIED_SUPERVISOR_B_SUB;
const MUNSHI_EMAIL = process.env.STYLIFIED_MUNSHI_EMAIL ?? "munshi@stylified.demo";
const OWNER_EMAIL = process.env.STYLIFIED_OWNER_EMAIL ?? "owner@stylified.demo";
const MANAGER_EMAIL = process.env.STYLIFIED_MANAGER_EMAIL ?? "manager@stylified.demo";
const SUPA_EMAIL = process.env.STYLIFIED_SUPERVISOR_A_EMAIL ?? "supervisor.a@stylified.demo";
const SUPB_EMAIL = process.env.STYLIFIED_SUPERVISOR_B_EMAIL ?? "supervisor.b@stylified.demo";

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
  // STYLIFIED_PASSWORD gives every demo login one known password (a demonstration, shown to a prospect); unset, each is generated.
  const password = process.env.STYLIFIED_PASSWORD ?? suggestPassword();
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

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function main() {
  installCapabilities();
  if (!MUNSHI_SUB && !OWNER_SUB) {
    MUNSHI_SUB = await ensureLogin(MUNSHI_EMAIL, "Munshi");
    OWNER_SUB = await ensureLogin(OWNER_EMAIL, "Owner");
    MANAGER_SUB = await ensureLogin(MANAGER_EMAIL, "Manager");
    SUPA_SUB = await ensureLogin(SUPA_EMAIL, "Supervisor A");
    SUPB_SUB = await ensureLogin(SUPB_EMAIL, "Supervisor B");
  }
  const tenantId = randomUUID();

  const ids = await withTenant(tenantId, async (tx) => {
    await tx.tenant.create({ data: { id: tenantId, name: TENANT_NAME, timeZone: "Asia/Kolkata", customFields: { demo: true, demoFor: "stylified" } } });
    const org = await tx.organization.create({ data: { tenantId, name: TENANT_NAME, parentId: null } });

    // The factory's role presets (Owner, Manager, Supervisor, Munshi, Store, Cutting master), the same data a new workspace installs
    // from the Team screen. No role name is known to the code: a role is only its grants.
    const roleId: Record<string, string> = {};
    for (const preset of piecework.ROLE_PRESETS) {
      const role = await tx.role.create({ data: { tenantId, name: preset.name } });
      roleId[preset.name] = role.id;
      await tx.permission.createMany({ data: piecework.presetPermissions(preset).map((g) => ({ tenantId, roleId: role.id, verb: g.verb, entity: g.entity, scope: g.scope })) });
    }
    const login = async (sub: string | undefined, name: string, email: string, role: string) => {
      if (!sub) return null;
      const identity = await provisionIdentity(tx, { organizationId: org.id, authUserId: sub, displayName: name, email });
      await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId: roleId[role]! } });
      return { ...identity, roleId: roleId[role]! };
    };
    const munshi = await login(MUNSHI_SUB, "Munshi", MUNSHI_EMAIL, "Munshi");
    const owner = await login(OWNER_SUB, "Owner", OWNER_EMAIL, "Owner");
    const manager = await login(MANAGER_SUB, "Manager", MANAGER_EMAIL, "Manager");
    const supA = await login(SUPA_SUB, "Supervisor A", SUPA_EMAIL, "Supervisor");
    const supB = await login(SUPB_SUB, "Supervisor B", SUPB_EMAIL, "Supervisor");
    await activateCapability(tx, tenantId, piecework.PIECEWORK_CAPABILITY);
    // Photographs are platform Evidence, which depends on Location.
    await activateCapability(tx, tenantId, LOCATION_CAPABILITY);
    await activateCapability(tx, tenantId, EVIDENCE_CAPABILITY);
    return { orgId: org.id, munshiRoleId: roleId.Munshi!, ownerRoleId: roleId.Owner!, munshi, owner, manager, supA, supB };
  });
  invalidateCapabilityCache();

  // Entries are written as the munshi, which is who writes them in the business; the owner holds every grant and can stand in.
  const writer = ids.munshi ?? ids.owner!;
  const actor: ActorContext = { tenantId, userId: writer.userId, membershipId: writer.membershipId, organizationId: ids.orgId, roleId: writer.roleId };
  invalidateCapabilityCache();
  const as = (who: { userId: string; membershipId: string; roleId: string } | null | undefined): ActorContext | null =>
    who ? { tenantId, userId: who.userId, membershipId: who.membershipId, organizationId: ids.orgId, roleId: who.roleId } : null;
  const ownerActor = as(ids.owner);
  const managerActor = as(ids.manager);
  const supA = as(ids.supA);
  const supB = as(ids.supB);

  // The five stages Stylified runs today, in order. Each carries a default rate per piece (what it pays when a lot and a karigar set
  // nothing): that is how a karigar with no rate of their own can still be given work.
  const stage: Record<string, string> = {};
  const defaults: Record<string, number> = { pasting: 2, collar: 5, stitching: 12, kaj: 3, finishing: 4 };
  for (const [key, label] of [["pasting", "Pasting"], ["collar", "Collar & Cuff"], ["stitching", "Stitching"], ["kaj", "Button / Kaj"], ["finishing", "Finishing / Press"]] as const) {
    stage[key] = (await executeCommand(actor, piecework.defineStage, { stageKey: key, label })).id;
    await executeCommand(actor, piecework.updateStage, { stageId: stage[key]!, defaultRateMinor: defaults[key]! * 100 });
  }

  // The factory's own settings, as the owner would enter them: what a lost piece costs, the words on the floor screens in two
  // languages, and the heading of a challan.
  if (ownerActor) {
    await executeCommand(ownerActor, piecework.setProductionSettings, { lostPieceChargeMinor: 2500, challanTitle: "Stylified Garments", challanAddress: "Focal Point Phase 5, Ludhiana 141010 · 98140 11000" });
    await executeCommand(ownerActor, piecework.saveReasons, {
      kind: "short",
      items: [
        { labelEn: "Lost on the floor", labelHi: "फ्लोर पर खो गया" }, { labelEn: "Not returned by the karigar", labelHi: "कारीगर ने वापस नहीं किया" },
        { labelEn: "Miscounted earlier", labelHi: "पहले गलत गिनती हुई" }, { labelEn: "Other", labelHi: "अन्य" },
      ],
    });
    await executeCommand(ownerActor, piecework.saveReasons, {
      kind: "defect",
      items: [
        { labelEn: "Stitch defect", labelHi: "सिलाई की खराबी" }, { labelEn: "Measurement", labelHi: "नाप की गलती" }, { labelEn: "Stain", labelHi: "दाग" },
        { labelEn: "Hole or cut", labelHi: "छेद या कट" }, { labelEn: "Button or kaj fault", labelHi: "बटन या काज की गलती" }, { labelEn: "Other", labelHi: "अन्य" },
      ],
    });
  }

  // Rates in paise per piece, each with the basis it is paid on. Pasting is paid on issued pieces, collar and cuff on everything
  // returned, the rest on accepted good pieces: the sheet says the factory uses more than one basis. Karigars G and H have no rate of
  // their own, so the lot's rate card or the stage default pays them.
  const since = day(-60);
  const rate = (stageKey: string, rupees: number, wageBasis: "issued" | "good" | "returned") => ({ stageId: stage[stageKey]!, rateMinor: Math.round(rupees * 100), wageBasis, effectiveFrom: since });
  const worker: Record<string, string> = {};
  worker.C = (await executeCommand(actor, piecework.defineWorker, { name: "Karigar C (pasting)", mobile: "98140 11003", rates: [rate("pasting", 2, "issued")] })).id;
  worker.B = (await executeCommand(actor, piecework.defineWorker, { name: "Sharma Collar Works", mobile: "98140 11002", kind: "outside", address: "Focal Point Phase 5, Ludhiana", rates: [rate("collar", 5, "returned")] })).id;
  worker.A = (await executeCommand(actor, piecework.defineWorker, { name: "Karigar A", mobile: "98765 43210", rates: [rate("stitching", 12, "good")] })).id;
  worker.F = (await executeCommand(actor, piecework.defineWorker, { name: "Karigar F", mobile: "98765 43216", rates: [rate("stitching", 11, "good")] })).id;
  worker.D = (await executeCommand(actor, piecework.defineWorker, { name: "Karigar D (button and kaj)", mobile: "98765 43213", rates: [rate("kaj", 3, "good")] })).id;
  worker.E = (await executeCommand(actor, piecework.defineWorker, { name: "Karigar E (finishing)", mobile: "98765 43214", rates: [rate("finishing", 4, "good")] })).id;
  worker.G = (await executeCommand(actor, piecework.defineWorker, { name: "Karigar G (helper)", mobile: "98765 43217" })).id;
  // Who looks after whom: each supervisor has the karigars at their own stages (Supervisor A collar, cuff and stitching; B the rest);
  // the helper stays open to any supervisor. A few profile notes so the profile panel shows what it is for.
  const profiles: Array<[string, typeof supA, string, string, string]> = [
    ["B", supA, "2025-04-10", "GST 03AAAAA0000A1Z5", "Sharma ji, 98140 11002"],
    ["A", supA, "2024-08-01", "Aadhaar ending 4321", "Wife, 98765 00011"],
    ["F", supA, "2025-01-15", "Aadhaar ending 7788", "Brother, 98765 00012"],
    ["C", supB, "2025-06-02", "Aadhaar ending 1209", "Mother, 98140 22003"],
    ["D", supB, "2024-11-20", "Aadhaar ending 5640", "Wife, 98765 00013"],
    ["E", supB, "2025-02-08", "Aadhaar ending 9021", "Father, 98765 00014"],
  ];
  for (const [key, sup, joinedOn, idNote, emergencyContact] of profiles) {
    await executeCommand(actor, piecework.updateWorker, { workerId: worker[key]!, joinedOn, idNote, emergencyContact, ...(sup ? { supervisorUserId: sup.userId } : {}) });
  }

  /** A lot or bundle made `ago` days ago: its creation date is moved back so entries can carry real, earlier dates. */
  const backdate = async (table: "piecework_lot" | "piecework_bundle", id: string, ago: number) => {
    await admin.$executeRawUnsafe(`UPDATE ${table} SET created_at = '${day(-ago)}T06:00:00Z' WHERE id = '${id}'::uuid`);
  };
  const lot = async (design: string, name: string, planned: number, ago: number, dueIn: number, fabric = "Oxford") => {
    const created = await executeCommand(actor, piecework.createLot, { design, name, plannedPieces: planned, fabricType: fabric, startDate: day(-ago), dueDate: day(dueIn) });
    await backdate("piecework_lot", created.id, ago);
    return created.id;
  };

  // Fabric: four invoices of rolls, each roll numbered. Lots below are cut from them, so every roll page shows where its metres went.
  const roll = async (fabricType: string, lengths: number[], supplier: string, invoice: string, rupeesPerMetre: number, ago: number) =>
    (await executeCommand(actor, piecework.receiveRolls, { fabricType, unit: "m", quantitiesCenti: lengths.map((m) => m * 100), supplier, invoiceNumber: invoice, rateMinor: rupeesPerMetre * 100, receivedOn: day(-ago) })).rollIds;
  const oxford = await roll("Oxford, white", [120, 120, 120, 118, 122], "Mehta Textiles, Ludhiana", "MT/2210", 180, 22);
  const poplin = await roll("Poplin, sky blue", [90, 90, 88], "Mehta Textiles, Ludhiana", "MT/2214", 150, 20);
  const flannel = await roll("Flannel check, grey", [80, 80], "Gupta Fabrics, Panipat", "GF/771", 210, 9);
  const check = await roll("Cotton check, navy", [100, 100], "Gupta Fabrics, Panipat", "GF/775", 195, 7);
  const mandarin = await roll("Linen blend, ecru", [80, 80], "Jain Mills, Amritsar", "JM/5509", 260, 5);

  /** Cut a lot: the fabric it took and the bundles it gave, one step. The cut also starts a draft lot. Bundles are dated to the cut. */
  const cut = async (lotId: string, groups: Array<{ copies: number; netPieces: number; sizeNote?: string }>, fabric: Array<[string, number]>, ago: number) => {
    const made = await executeCommand(actor, piecework.cutLot, { lotId, groups, fabric: fabric.map(([rollId, metres]) => ({ rollId, quantityCenti: metres * 100 })) });
    for (const id of made.bundleIds) await backdate("piecework_bundle", id, ago);
    return made.bundleIds;
  };
  const out = (bundleId: string, stageKey: string, who: string, pieces: number, ago: number, extra: Record<string, unknown> = {}) =>
    executeCommand(actor, piecework.recordIssue, { bundleId, stageId: stage[stageKey]!, workerId: worker[who]!, pieces, entryDate: day(-ago), ackMethod: "signature", ...extra });
  const back = (issueId: string, split: { good?: number; rejected?: number; rework?: number; short?: number }, ago: number, note?: string) =>
    executeCommand(actor, piecework.recordReturn, { issueId, good: 0, rejected: 0, rework: 0, short: 0, ...split, entryDate: day(-ago), note });

  // LOT-0001, Spring formals, 500 planned, four bundles cut from two rolls, running. Its rate card pays stitching a little more and
  // sets what a lost piece costs there; the other stages follow the stage defaults.
  const lot1 = await lot("Oxford formal, full sleeve", "Spring formals", 500, 14, 20);
  const [b1, b2, b3] = await cut(lot1, [{ copies: 4, netPieces: 100, sizeNote: "M, L and XL mix" }], [[oxford[0]!, 118], [oxford[1]!, 119]], 13);
  await executeCommand(actor, piecework.setLotRates, { lotId: lot1, rows: [{ stageId: stage.stitching!, rateMinor: 1300, lostPieceChargeMinor: 4000 }] });

  // B-0001: the requirement sheet's reconciliation, 100 = 94 good + 2 rejected + 1 rework + 2 short + 1 open,
  // then its rework redone and the rest taken through to ready. The two short pieces ask for a charge on Karigar C.
  const p1 = await out(b1!, "pasting", "C", 100, 12);
  const p1ret = await back(p1.id, { good: 94, rejected: 2, rework: 1, short: 2 }, 10, "Stitch defect: loose thread, Lost on the floor");
  const rw = await out(b1!, "pasting", "C", 1, 9, { isRework: true });
  await back(rw.id, { good: 1 }, 8);
  const c1 = await out(b1!, "collar", "B", 95, 8);
  const c1ret = await back(c1.id, { good: 90, rejected: 3, rework: 2 }, 6, "Stitch defect: collar points uneven");
  const s1 = await out(b1!, "stitching", "A", 90, 6);
  await back(s1.id, { good: 88, rejected: 1, short: 1 }, 3, "Not returned by the karigar");
  const k1 = await out(b1!, "kaj", "D", 88, 3);
  await back(k1.id, { good: 88 }, 2);
  const f1 = await out(b1!, "finishing", "E", 88, 2);
  await back(f1.id, { good: 86, rejected: 2 }, 1, "Stain");

  // B-0002: with Karigar A at stitching, 37 pieces still out, due in two days.
  const p2 = await out(b2!, "pasting", "C", 100, 12);
  await back(p2.id, { good: 100 }, 10);
  const c2 = await out(b2!, "collar", "B", 100, 10);
  await back(c2.id, { good: 97, rejected: 3 }, 7, "Measurement");
  const s2 = await out(b2!, "stitching", "A", 97, 7, { dueDate: day(2) });
  await back(s2.id, { good: 60 }, 3);

  // B-0003: with the outside collar unit, past its expected return date. Handed over 98, the unit counted 96: a handover case.
  const p3 = await out(b3!, "pasting", "G", 100, 9);
  await back(p3.id, { good: 98, short: 2 }, 7, "Miscounted earlier");
  await out(b3!, "collar", "B", 96, 7, { dueDate: day(-1), sentPieces: 98 });

  // LOT-0002, Winter shirts: planned, still a draft, nothing cut.
  const lot2 = await lot("Flannel check", "Winter shirts", 300, 1, 40, "Flannel");

  // LOT-0003, an older lot, finished, completed and closed: its ledger is locked.
  const lot3 = await lot("Poplin half sleeve", "Summer half sleeves", 50, 40, -18, "Poplin");
  const [b5] = await cut(lot3, [{ copies: 1, netPieces: 50, sizeNote: "L" }], [[poplin[0]!, 62]], 39);
  let ago = 38;
  for (const [key, who] of [["pasting", "C"], ["collar", "B"], ["stitching", "A"], ["kaj", "D"], ["finishing", "E"]] as const) {
    const i = await out(b5!, key, who, 50, ago);
    await back(i.id, { good: 50 }, ago - 1);
    ago -= 2;
  }
  await executeCommand(actor, piecework.addLotCost, { lotIds: [lot3], category: "Packing", amountMinor: 38_000, incurredOn: day(-30), note: "Polybags and cartons" });
  await executeCommand(actor, piecework.setLotStatus, { lotId: lot3, to: "completed" });
  await executeCommand(actor, piecework.setLotStatus, { lotId: lot3, to: "closed" });

  // LOT-0004, on hold: part of one bundle is out.
  const lot4 = await lot("Export check shirt", "Export sample", 200, 6, 15, "Cotton check");
  const [b6] = await cut(lot4, [{ copies: 1, netPieces: 40, sizeNote: "M" }], [[check[0]!, 52]], 5);
  await out(b6!, "pasting", "C", 20, 4);
  await executeCommand(actor, piecework.setLotStatus, { lotId: lot4, to: "hold" });

  // LOT-0005, Mandarin-collar shirt: it has no collar stand, so its rate card skips Collar & Cuff and the pieces go from pasting
  // straight to stitching. Karigar G, who has no rate of his own, is paid the stage default for pasting.
  const lot5 = await lot("Mandarin collar, linen blend", "Mandarin collar shirts", 120, 4, 18, "Linen blend");
  const [b7, b8] = await cut(lot5, [{ copies: 2, netPieces: 60, sizeNote: "M and L" }], [[mandarin[0]!, 74], [mandarin[1]!, 70]], 4);
  // A lot may skip only an optional stage: collar and cuff is optional at this factory (a shirt without one is a different design).
  await executeCommand(actor, piecework.updateStage, { stageId: stage.collar!, optional: true });
  await executeCommand(actor, piecework.setLotRates, { lotId: lot5, rows: [{ stageId: stage.collar!, skipped: true }, { stageId: stage.stitching!, rateMinor: 1500, lostPieceChargeMinor: 6000 }] });
  const p7 = await out(b7!, "pasting", "G", 60, 3);
  await back(p7.id, { good: 60 }, 2);
  await out(b7!, "stitching", "F", 60, 2, { dueDate: day(3) });
  await out(b8!, "pasting", "G", 60, 1);

  // Fabric that is neither cut nor wasted stays on the shelf: one roll of flannel waits for LOT-0002, which is still a draft.
  void flannel;

  // What the lots cost beyond fabric and wages: one thread bill shared by three lots (split by pieces cut), buttons, trims, and
  // interlining. A closed lot's cost is final, so LOT-0003 carries only what it had when it closed.
  const cost = (lotIds: string[], category: string, rupees: number, ago: number, note?: string) =>
    executeCommand(actor, piecework.addLotCost, { lotIds, category, amountMinor: rupees * 100, incurredOn: day(-ago), note });
  await cost([lot1, lot4, lot5], "Thread", 2_260, 4, "Bill 4471, Vardhman thread");
  await cost([lot1], "Buttons", 960, 11, "4 hole, 14 line, white");
  await cost([lot1], "Labels and trims", 420, 11);
  await cost([lot5], "Interlining", 310, 3);

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

  // The floor: who looks after which stage, what is waiting for a decision, and one closed day. Supervisor A looks after
  // the collar and stitching (where an outside unit is late and Karigar A holds 37 pieces), Supervisor B the rest.
  if (ownerActor) {
    await executeCommand(ownerActor, piecework.setLimits, { deductionLimitMinor: 100_000, writeoffLimitPieces: 5 });
    if (ids.supA) await executeCommand(ownerActor, piecework.assignStages, { userId: ids.supA.userId, stageIds: [stage.collar!, stage.stitching!] });
    if (ids.supB) await executeCommand(ownerActor, piecework.assignStages, { userId: ids.supB.userId, stageIds: [stage.pasting!, stage.kaj!, stage.finishing!] });
  }
  if (supA) {
    // Two requests the manager will see: a deduction inside the limit with its photographable defect, and a larger deduction only
    // the owner may approve.
    await executeCommand(supA, piecework.requestApproval, { kind: "deduction", workerId: worker.B!, entryId: c1ret.id, amountMinor: 15_000, reason: "3 collars rejected for stitch defect" });
    await executeCommand(supA, piecework.requestApproval, { kind: "deduction", workerId: worker.A!, amountMinor: 250_000, reason: "Whole stitching batch re-done at the factory's cost" });
  }
  if (supB) {
    await executeCommand(supB, piecework.requestApproval, { kind: "writeoff", entryId: p1ret.id, pieces: 2, reason: "2 pieces lost at the pasting table, searched twice" });
    // Today's work at Supervisor B's stages, so the closed day below carries real figures: 60 good pieces of B-0002 reached
    // button and kaj, 40 went to Karigar D this morning and came back counted.
    const todayKaj = await executeCommand(supB, piecework.recordIssue, { bundleId: b2!, stageId: stage.kaj!, workerId: worker.D!, pieces: 40, sentPieces: 40, ackMethod: "attested", dueDate: day(1) });
    await executeCommand(supB, piecework.recordReturn, { issueId: todayKaj.id, good: 36, rejected: 2, rework: 0, short: 0, note: "Stain: 2 pieces" });
    await executeCommand(supB, piecework.closeDay, { note: "आज पेस्टिंग और फिनिशिंग पूरी हुई। फिनिशिंग में 2 पीस पर जले का निशान, फोटो के साथ मैनेजर को भेजा।", lang: "hi" });
  }
  // The charge asked for Karigar C's two lost pieces is decided: approved by the owner, so the case shows as settled.
  if (ownerActor) {
    const asked = await withTenant(tenantId, (tx) => tx.pieceworkApproval.findFirst({ where: { entryId: p1ret.id, kind: "deduction", status: "pending" } }));
    if (asked) await executeCommand(ownerActor, piecework.decideApproval, { approvalId: asked.id, decision: "approved" });
  }
  void managerActor;

  // Lot pictures for the screens: the demo tenant's own images, served from public/demo/stylified. Customer pictures belong to
  // the customer; these are generated stills and belong to this demo only.
  const covers: Array<[string, string]> = [[lot1, "lot-spring-formals-thumb"], [lot2, "lot-winter-flannel-thumb"], [lot3, "lot-summer-poplin-thumb"], [lot4, "lot-export-check-thumb"]];
  for (const [id, file] of covers) {
    await admin.$executeRawUnsafe(`UPDATE piecework_lot SET custom_fields = custom_fields || '{"coverImage":"/demo/stylified/${file}.webp"}'::jsonb WHERE id = '${id}'::uuid`);
  }

  console.log("\nStylified demo tenant is ready.\n");
  console.log(`Tenant:  ${tenantId}`);
  for (const email of Object.keys(passwords)) console.log(`Login:   ${email}  password ${passwords[email]}  (shown once)`);
  if (!Object.keys(passwords).length) console.log(`Munshi:  ${MUNSHI_SUB ? `IdP sub ${MUNSHI_SUB}` : "(none)"}\nOwner:   ${OWNER_SUB ? `IdP sub ${OWNER_SUB}` : "(none)"}`);
  console.log("Roles: Owner, Manager, Supervisor (two people), Munshi. Lots: 5 (LOT-0001 running, LOT-0002 draft, LOT-0003 closed, LOT-0004 on hold, LOT-0005 skips collar), 14 rolls of fabric, 7 karigars, 5 stages, open cases and charge requests. Everything is fictional.");
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
