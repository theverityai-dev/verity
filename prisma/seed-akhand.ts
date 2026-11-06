/**
 * Seeds the Akhand Export demo tenant (clients/akhand-exports): a small Noida garment exporter making knit and woven wear (kids
 * hoodies, baby rompers, ladies tops, men's tees) against buyer purchase orders, with piece-rate karigars and outside job workers.
 * Same `piecework` capability and screens as the Stylified demo; only the data differs. Synthetic data only: the buyers, karigars,
 * suppliers, purchase orders and figures are invented. Safe to show the prospect.
 *
 * How the export house maps onto the capability (see clients/akhand-exports/README.md):
 *   - a buyer's purchase order for one style is a lot (its name carries the PO and the buyer, its note the size break);
 *   - knit fabric arrives in rolls weighed in kilograms;
 *   - a size from the PO's size break is a bundle group (the size goes in the bundle note);
 *   - printing and embroidery go to an outside unit; a plain garment skips that stage;
 *   - final checking is the last stage, so its accepted pieces are the export-ready garments;
 *   - a shipment is a "Shipped" movement out of ready stock, against the export invoice number.
 *
 * Logins, chosen by the environment (same two modes as seed-stylified.ts):
 *   - OIDC: AKHAND_OWNER_SUB, AKHAND_MANAGER_SUB, AKHAND_SUPERVISOR_SUB, AKHAND_MUNSHI_SUB (at least the owner or the munshi);
 *   - Supabase: with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set and no subs, the four logins are created (AKHAND_PASSWORD
 *     gives them one known password; unset, each is generated and printed once).
 *
 * The tenant is flagged `customFields.demo = true`, which `reset-demo.ts` requires before it deletes one
 * (`DEMO_TENANT_NAME="Akhand Export" npx tsx prisma/reset-demo.ts`).
 *
 * NEVER run this against the production database without the product owner's say-so: it creates logins.
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
import { asMigrationRoleInTenant } from "./migration-role";

const TENANT_NAME = "Akhand Export";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const people = {
  owner: { sub: process.env.AKHAND_OWNER_SUB, email: process.env.AKHAND_OWNER_EMAIL ?? "owner@akhand.demo", name: "Owner", role: "Owner" },
  manager: { sub: process.env.AKHAND_MANAGER_SUB, email: process.env.AKHAND_MANAGER_EMAIL ?? "manager@akhand.demo", name: "Production Manager", role: "Manager" },
  supervisor: { sub: process.env.AKHAND_SUPERVISOR_SUB, email: process.env.AKHAND_SUPERVISOR_EMAIL ?? "supervisor@akhand.demo", name: "Floor Supervisor", role: "Supervisor" },
  munshi: { sub: process.env.AKHAND_MUNSHI_SUB, email: process.env.AKHAND_MUNSHI_EMAIL ?? "munshi@akhand.demo", name: "Munshi", role: "Munshi" },
};

if (!people.owner.sub && !people.munshi.sub && !(SUPABASE_URL && SERVICE_ROLE_KEY)) {
  throw new Error("Set AKHAND_OWNER_SUB and/or AKHAND_MUNSHI_SUB (OIDC), or SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
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
  const password = process.env.AKHAND_PASSWORD ?? suggestPassword();
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

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function main() {
  installCapabilities();
  if (!people.owner.sub && !people.munshi.sub) {
    for (const p of Object.values(people)) p.sub = await ensureLogin(p.email, p.name);
  }
  const tenantId = randomUUID();

  const ids = await asMigrationRoleInTenant(admin, tenantId, async (tx) => {
    await tx.tenant.create({ data: { id: tenantId, name: TENANT_NAME, timeZone: "Asia/Kolkata", customFields: { demo: true, demoFor: "akhand-exports" } } });
    const org = await tx.organization.create({ data: { tenantId, name: TENANT_NAME, parentId: null } });
    // The same role presets a new workspace installs from the Team screen. No role name is known to the code: a role is its grants.
    const roleId: Record<string, string> = {};
    for (const preset of piecework.ROLE_PRESETS) {
      const role = await tx.role.create({ data: { tenantId, name: preset.name } });
      roleId[preset.name] = role.id;
      await tx.permission.createMany({ data: piecework.presetPermissions(preset).map((g) => ({ tenantId, roleId: role.id, verb: g.verb, entity: g.entity, scope: g.scope })) });
    }
    const login = async (p: (typeof people)[keyof typeof people]) => {
      if (!p.sub) return null;
      const identity = await provisionIdentity(tx, { organizationId: org.id, authUserId: p.sub, displayName: p.name, email: p.email });
      await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId: roleId[p.role]! } });
      return { ...identity, roleId: roleId[p.role]! };
    };
    const owner = await login(people.owner);
    const manager = await login(people.manager);
    const supervisor = await login(people.supervisor);
    const munshi = await login(people.munshi);
    await activateCapability(tx, tenantId, piecework.PIECEWORK_CAPABILITY);
    // Photographs are platform Evidence, which depends on Location.
    await activateCapability(tx, tenantId, LOCATION_CAPABILITY);
    await activateCapability(tx, tenantId, EVIDENCE_CAPABILITY);
    return { orgId: org.id, owner, manager, supervisor, munshi };
  });
  invalidateCapabilityCache();

  const as = (who: { userId: string; membershipId: string; roleId: string } | null | undefined): ActorContext | null =>
    who ? { tenantId, userId: who.userId, membershipId: who.membershipId, organizationId: ids.orgId, roleId: who.roleId } : null;
  // Entries are written as the munshi, who writes them in the business; the owner holds every grant and can stand in.
  const actor = (as(ids.munshi) ?? as(ids.owner))!;
  const ownerActor = as(ids.owner);
  const supervisor = as(ids.supervisor);

  // The stages after cutting, in the order a knit export order runs. Each carries a default rate per piece, used when neither the
  // lot nor the karigar sets one. Print and embroidery is optional: a plain garment skips it.
  const stage: Record<string, string> = {};
  const stages: Array<[string, string, number]> = [
    ["print", "Print / Embroidery", 6],
    ["stitching", "Stitching (overlock and flatlock)", 10],
    ["threadcut", "Thread cutting", 1],
    ["press", "Press", 2],
    ["checking", "Final checking", 2],
  ];
  for (const [key, label, rupees] of stages) {
    stage[key] = (await executeCommand(actor, piecework.defineStage, { stageKey: key, label })).id;
    await executeCommand(actor, piecework.updateStage, { stageId: stage[key]!, defaultRateMinor: rupees * 100 });
  }
  await executeCommand(actor, piecework.updateStage, { stageId: stage.print!, optional: true });

  // The house's own settings: what a lost piece costs, its defect words in two languages (the floor speaks Hindi), the challan heading.
  if (ownerActor) {
    await executeCommand(ownerActor, piecework.setProductionSettings, { lostPieceChargeMinor: 4000, challanTitle: "Akhand Export", challanAddress: "Noida, Gautam Buddha Nagar, Uttar Pradesh" });
    await executeCommand(ownerActor, piecework.saveReasons, {
      kind: "short",
      items: [
        { labelEn: "Lost on the floor", labelHi: "फ्लोर पर खो गया" }, { labelEn: "Not returned by the job worker", labelHi: "जॉब वर्कर ने वापस नहीं किया" },
        { labelEn: "Miscounted at cutting", labelHi: "कटिंग पर गलत गिनती" }, { labelEn: "Other", labelHi: "अन्य" },
      ],
    });
    await executeCommand(ownerActor, piecework.saveReasons, {
      kind: "defect",
      items: [
        { labelEn: "Open seam", labelHi: "सिलाई खुली" }, { labelEn: "Needle hole", labelHi: "सुई का छेद" }, { labelEn: "Print smudge", labelHi: "प्रिंट फैला" },
        { labelEn: "Shade variation", labelHi: "रंग में फर्क" }, { labelEn: "Measurement out of tolerance", labelHi: "नाप सही नहीं" },
        { labelEn: "Oil or stain", labelHi: "तेल या दाग" }, { labelEn: "Other", labelHi: "अन्य" },
      ],
    });
  }

  // Karigars and job workers, rates in paise per piece with the basis each is paid on. The printer is paid on everything returned (a
  // print fault is caught later at checking); tailors on accepted good pieces. The helper has no rate of their own, so the stage
  // default pays them.
  const since = day(-60);
  const rate = (stageKey: string, rupees: number, wageBasis: "issued" | "good" | "returned") => ({ stageId: stage[stageKey]!, rateMinor: Math.round(rupees * 100), wageBasis, effectiveFrom: since });
  const supervisorUserId = ids.supervisor?.userId;
  const crew: Array<{ key: string; name: string; mobile: string; outside?: string; rates?: ReturnType<typeof rate>[]; joinedOn?: string; idNote?: string; emergencyContact?: string }> = [
    { key: "printer", name: "Shree Balaji Prints", mobile: "98110 42001", outside: "Sector 63, Noida", rates: [rate("print", 6, "returned")], joinedOn: "2024-07-01", idNote: "Job worker, GST registered", emergencyContact: "Balaji ji, 98110 42001" },
    { key: "fabricator", name: "Saini Fabricators", mobile: "98110 42002", outside: "Hosiery Complex, Phase II, Noida", rates: [rate("stitching", 9, "good")], joinedOn: "2025-03-12", idNote: "Job worker, GST registered", emergencyContact: "Saini ji, 98110 42002" },
    { key: "rafiq", name: "Rafiq (tailor)", mobile: "98110 42011", rates: [rate("stitching", 10, "good")], joinedOn: "2023-11-04", idNote: "Aadhaar ending 4410", emergencyContact: "Brother, 98110 50011" },
    { key: "mohan", name: "Mohan Lal (tailor)", mobile: "98110 42012", rates: [rate("stitching", 10, "good")], joinedOn: "2024-02-19", idNote: "Aadhaar ending 8823", emergencyContact: "Son, 98110 50012" },
    { key: "sunita", name: "Sunita (thread cutting)", mobile: "98110 42013", rates: [rate("threadcut", 1, "good")], joinedOn: "2025-01-08", idNote: "Aadhaar ending 3071", emergencyContact: "Husband, 98110 50013" },
    { key: "vikas", name: "Vikas (press)", mobile: "98110 42014", rates: [rate("press", 2, "good")], joinedOn: "2024-09-27", idNote: "Aadhaar ending 6152", emergencyContact: "Father, 98110 50014" },
    { key: "pooja", name: "Pooja (checking)", mobile: "98110 42015", rates: [rate("checking", 2, "returned")], joinedOn: "2025-05-15", idNote: "Aadhaar ending 2298", emergencyContact: "Mother, 98110 50015" },
    { key: "helper", name: "Raju (helper)", mobile: "98110 42016" },
  ];
  const worker: Record<string, string> = {};
  for (const { key, outside, ...rest } of crew) {
    worker[key] = (await executeCommand(actor, piecework.defineWorker, {
      ...rest, ...(outside ? { kind: "outside" as const, address: outside } : {}), ...(supervisorUserId ? { supervisorUserId } : {}),
    })).id;
  }

  /** A lot or bundle made `ago` days ago: its creation date is moved back so entries can carry real, earlier dates. */
  const backdate = async (table: "piecework_lot" | "piecework_bundle", id: string, ago: number) => {
    // The table name is one of two literals; the values are bound.
    await admin.$executeRawUnsafe(`UPDATE ${table} SET created_at = $1::timestamptz WHERE id = $2::uuid`, `${day(-ago)}T06:00:00Z`, id);
  };
  const lot = async (design: string, name: string, planned: number, ago: number, dueIn: number, fabricType: string, note: string) => {
    const created = await executeCommand(actor, piecework.createLot, { design, name, plannedPieces: planned, fabricType, startDate: day(-ago), dueDate: day(dueIn), note });
    await backdate("piecework_lot", created.id, ago);
    return created.id;
  };

  // Knit fabric arrives in rolls weighed in kilograms, bought from knitting and dyeing mills, priced per kilogram.
  const rolls = async (fabricType: string, kgs: number[], supplier: string, invoice: string, rupeesPerKg: number, ago: number) =>
    (await executeCommand(actor, piecework.receiveRolls, { fabricType, unit: "kg", quantitiesCenti: kgs.map((k) => Math.round(k * 100)), supplier, invoiceNumber: invoice, rateMinor: rupeesPerKg * 100, receivedOn: day(-ago) })).rollIds;
  const interlock = await rolls("Organic cotton interlock, 220 GSM, ecru", [22, 21.6, 22.4], "Om Dyeing & Knitting, Tiruppur", "ODK/3302", 540, 45);
  const fleece = await rolls("3-thread fleece, 320 GSM, heather grey", [24.5, 25, 24.8, 25.2, 24.6, 25], "Shiv Shakti Knits, Ludhiana", "SSK/1187", 410, 24);
  const jersey = await rolls("Single jersey, 180 GSM, navy", [26, 25.4, 25.8, 26.2], "Om Dyeing & Knitting, Tiruppur", "ODK/3361", 355, 10);
  await rolls("1x1 rib, 260 GSM, coral", [18, 18.4], "Shiv Shakti Knits, Ludhiana", "SSK/1201", 460, 6);

  /** Cut a lot: the fabric it took and the bundles it gave, one step. Bundles are dated to the cut. */
  const cut = async (lotId: string, groups: Array<{ copies: number; netPieces: number; sizeNote?: string }>, fabric: Array<[string, number]>, ago: number) => {
    const made = await executeCommand(actor, piecework.cutLot, { lotId, groups, fabric: fabric.map(([rollId, kg]) => ({ rollId, quantityCenti: Math.round(kg * 100) })) });
    for (const id of made.bundleIds) await backdate("piecework_bundle", id, ago);
    return made.bundleIds;
  };
  const out = (bundleId: string, stageKey: string, who: string, pieces: number, ago: number, extra: Record<string, unknown> = {}) =>
    executeCommand(actor, piecework.recordIssue, { bundleId, stageId: stage[stageKey]!, workerId: worker[who]!, pieces, entryDate: day(-ago), ackMethod: "signature", ...extra });
  const back = (issueId: string, split: { good?: number; rejected?: number; rework?: number; short?: number }, ago: number, note?: string) =>
    executeCommand(actor, piecework.recordReturn, { issueId, good: 0, rejected: 0, rework: 0, short: 0, ...split, entryDate: day(-ago), note });
  /** One bundle through a list of stages, every piece good, starting `ago` days back, a day per stage. */
  const runClean = async (bundleId: string, path: Array<[string, string]>, pieces: number, ago: number) => {
    let d = ago;
    for (const [key, who] of path) {
      const i = await out(bundleId, key, who, pieces, d);
      await back(i.id, { good: pieces }, d - 1);
      d -= 1;
    }
  };

  // LOT-0001: PO LT-504, a UK baby romper in organic interlock: made, checked, closed, and shipped. (Made first, so it is the oldest.)
  const lotRomper = await lot("Baby romper, organic interlock, envelope neck", "PO LT-504 · Little Tern Ltd, United Kingdom", 200, 44, -14, "Interlock",
    "Size break 0-3M 70, 3-6M 70, 6-12M 60. GOTS certified fabric. Shipped by air.");
  const romper = await cut(lotRomper, [{ copies: 1, netPieces: 70, sizeNote: "0-3M" }, { copies: 1, netPieces: 70, sizeNote: "3-6M" }, { copies: 1, netPieces: 60, sizeNote: "6-12M" }],
    [[interlock[0]!, 22], [interlock[1]!, 13]], 42);
  await executeCommand(actor, piecework.setLotRates, { lotId: lotRomper, rows: [{ stageId: stage.stitching!, rateMinor: 1400 }, { stageId: stage.print!, skipped: true }] });
  for (const [i, b] of romper.entries()) {
    await runClean(b, [["stitching", i === 2 ? "mohan" : "rafiq"], ["threadcut", "sunita"], ["press", "vikas"], ["checking", "pooja"]], [70, 70, 60][i]!, 40 - i * 2);
  }
  const lotCost = (lotIds: string[], category: string, rupees: number, ago: number, note?: string) =>
    executeCommand(actor, piecework.addLotCost, { lotIds, category, amountMinor: rupees * 100, incurredOn: day(-ago), note });
  await lotCost([lotRomper], "Labels and trims", 3_100, 38, "Woven main label, care label, hang tag, nickel-free snaps");
  await lotCost([lotRomper], "Testing", 8_500, 30, "Third-party lab test before shipment");
  await lotCost([lotRomper], "Packing", 6_400, 25, "Polybags with warning print, 5-ply export cartons");
  await executeCommand(actor, piecework.setLotStatus, { lotId: lotRomper, to: "completed" });
  await executeCommand(actor, piecework.setLotStatus, { lotId: lotRomper, to: "closed" });
  await executeCommand(actor, piecework.recordReadyMove, { kind: "out", lotId: lotRomper, pieces: 4, reason: "Sample", party: "Little Tern Ltd, United Kingdom", reference: "Shipment samples", movedOn: day(-17) });
  await executeCommand(actor, piecework.recordReadyMove, { kind: "out", lotId: lotRomper, pieces: 120, reason: "Shipped", party: "Little Tern Ltd, United Kingdom", reference: "AE/EXP/0031", movedOn: day(-16), note: "Air freight, 8 cartons" });
  await executeCommand(actor, piecework.recordReadyMove, { kind: "out", lotId: lotRomper, pieces: 76, reason: "Shipped", party: "Little Tern Ltd, United Kingdom", reference: "AE/EXP/0034", movedOn: day(-12), note: "Balance, 5 cartons" });
  // The buyer's final inspection before the first shipment (AQL 2.5 major / 4.0 minor, level II: 32 of 200 checked), and the packing
  // list of each shipment: sizes in the buyer's own labels, 15 rompers to a carton, the balance carton made up of what was left.
  await executeCommand(actor, piecework.recordInspection, {
    lotId: lotRomper, kind: "final", inspectedOn: day(-18), inspector: "Little Tern buyer QC", offeredPieces: 200, level: "II", aqlMajor: "2.5", aqlMinor: "4.0",
    criticalFound: 0, majorFound: 1, minorFound: 2, note: "1 open seam at the leg snap; 2 loose threads. Report LT-FI-0921.",
  });
  const romperCarton = (from: number, to: number, sizes: Array<[string, number]>, netGrams: number, grossGrams: number) =>
    ({ from, to, colour: "Oat melange", sizes: sizes.map(([size, qty]) => ({ size, qty })), netGrams, grossGrams, lengthCm: 50, widthCm: 35, heightCm: 25 });
  await executeCommand(actor, piecework.createPackingList, {
    lotId: lotRomper, buyer: "Little Tern Ltd, United Kingdom", reference: "PO LT-504 / AE/EXP/0031", destination: "London Heathrow (air)", packedOn: day(-17),
    cartons: [romperCarton(1, 8, [["0-3M", 5], ["3-6M", 5], ["6-12M", 5]], 1650, 2300)], note: "Shipping marks: LITTLE TERN / LT-504 / C/No. 1-13",
  });
  await executeCommand(actor, piecework.createPackingList, {
    lotId: lotRomper, buyer: "Little Tern Ltd, United Kingdom", reference: "PO LT-504 / AE/EXP/0034", destination: "London Heathrow (air)", packedOn: day(-13),
    cartons: [romperCarton(1, 4, [["0-3M", 5], ["3-6M", 5], ["6-12M", 5]], 1650, 2300), romperCarton(5, 5, [["0-3M", 6], ["3-6M", 6], ["6-12M", 4]], 1760, 2420)],
    note: "Balance shipment. Shipping marks: LITTLE TERN / LT-504 / C/No. 9-13",
  });
  // Stock that sat in the godown before Verity: surplus from an older order, sold in the domestic market.
  await executeCommand(actor, piecework.recordReadyMove, { kind: "opening", label: "Men's round neck tee, white, surplus", pieces: 260, note: "Counted in the godown at launch", movedOn: day(-30) });
  await executeCommand(actor, piecework.recordReadyMove, { kind: "out", label: "Men's round neck tee, white, surplus", pieces: 150, reason: "Sold", party: "Gupta Hosiery, Gandhi Nagar, Delhi", reference: "AE/DOM/0112", movedOn: day(-8) });

  // LOT-0002: PO NV-2611 from a Swedish kids' label, a zip hoodie in fleece with a chest print, 600 pieces in three sizes. The first
  // cut gave six bundles of 50 (two per size); the rest of the fleece waits for the second cut. The rate card pays the hoodie's
  // stitching and print more than a tee, and a lost hoodie costs more.
  const lotHoodie = await lot("Kids zip hoodie, fleece, chest print", "PO NV-2611 · Nordvik Kids AB, Sweden", 600, 18, 16, "Fleece",
    "Size break 2-3Y 200, 4-5Y 200, 6-7Y 200. FOB Nhava Sheva by sea. PP sample approved.");
  const hoodie = await cut(lotHoodie, [
    { copies: 2, netPieces: 50, sizeNote: "2-3Y" }, { copies: 2, netPieces: 50, sizeNote: "4-5Y" }, { copies: 2, netPieces: 50, sizeNote: "6-7Y" },
  ], [[fleece[0]!, 24.5], [fleece[1]!, 25], [fleece[2]!, 24.8], [fleece[3]!, 22]], 16);
  await executeCommand(actor, piecework.setLotRates, { lotId: lotHoodie, rows: [{ stageId: stage.stitching!, rateMinor: 2800, lostPieceChargeMinor: 18000 }, { stageId: stage.print!, rateMinor: 800 }] });
  const [h1, h2, h3, h4, h5, h6] = hoodie;
  // Bundle 1 (2-3Y) to checked, with a print reject, a seam rework redone, a piece lost at stitching, and two failed at checking.
  const pr1 = await out(h1!, "print", "printer", 50, 15, { sentPieces: 50 });
  await back(pr1.id, { good: 48, rejected: 2 }, 13, "Print smudge on 2 pieces");
  const st1 = await out(h1!, "stitching", "rafiq", 48, 12);
  const st1ret = await back(st1.id, { good: 45, rework: 2, short: 1 }, 9, "Open seam at the side; Lost on the floor");
  const rw1 = await out(h1!, "stitching", "rafiq", 2, 8, { isRework: true });
  await back(rw1.id, { good: 2 }, 7);
  await runClean(h1!, [["threadcut", "sunita"], ["press", "vikas"]], 47, 7);
  const ck1 = await out(h1!, "checking", "pooja", 47, 4);
  await back(ck1.id, { good: 45, rejected: 2 }, 3, "Measurement out of tolerance");
  // Bundle 2 (2-3Y) checked clean.
  await runClean(h2!, [["print", "printer"], ["stitching", "mohan"], ["threadcut", "sunita"], ["press", "vikas"], ["checking", "pooja"]], 50, 14);
  // Bundle 3 (4-5Y) at the outside fabricator, overdue; sent 50, the fabricator counted 49 on receipt: a handover case.
  const pr3 = await out(h3!, "print", "printer", 50, 13);
  await back(pr3.id, { good: 50 }, 11);
  await out(h3!, "stitching", "fabricator", 49, 10, { dueDate: day(-2), sentPieces: 50 });
  // Bundle 4 (4-5Y) with Mohan Lal, 30 of 50 back.
  const pr4 = await out(h4!, "print", "printer", 50, 12);
  await back(pr4.id, { good: 50 }, 10);
  const st4 = await out(h4!, "stitching", "mohan", 50, 6, { dueDate: day(1) });
  await back(st4.id, { good: 30 }, 2);
  // Bundles 5 and 6 (6-7Y) at the printer.
  await out(h5!, "print", "printer", 50, 3, { dueDate: day(2) });
  await out(h6!, "print", "printer", 50, 3, { dueDate: day(2) });
  // Inline checks on the hoodie: the first, on the opening bundles, failed on open side seams; after the rework the re-check passed.
  await executeCommand(actor, piecework.recordInspection, {
    lotId: lotHoodie, kind: "inline", inspectedOn: day(-9), inspector: "Pooja (own checker)", offeredPieces: 98, level: "II", aqlMajor: "2.5", aqlMinor: "4.0",
    criticalFound: 0, majorFound: 3, minorFound: 1, note: "Open side seams on 3 pieces from one machine. Rework given back to stitching.",
  });
  await executeCommand(actor, piecework.recordInspection, {
    lotId: lotHoodie, kind: "inline", inspectedOn: day(-5), inspector: "Pooja (own checker)", offeredPieces: 97, level: "II", aqlMajor: "2.5", aqlMinor: "4.0",
    criticalFound: 0, majorFound: 0, minorFound: 1, note: "Re-check after rework.",
  });

  // LOT-0003: a men's tee salesman-sample run for a new buyer, on hold for the buyer's fit comments.
  const lotSample = await lot("Men's round neck tee, 180 GSM, sample run", "Salesman samples · Kestrel Outfitters, Australia", 60, 9, 12, "Single jersey",
    "Proto approved, fit sample sent by courier. Hold until the buyer's fit comments arrive.");
  const [s1] = await cut(lotSample, [{ copies: 1, netPieces: 60, sizeNote: "S, M, L, XL mix" }], [[jersey[0]!, 11.5]], 8);
  await out(s1!, "print", "printer", 60, 7, { sentPieces: 60 });
  await executeCommand(actor, piecework.setLotStatus, { lotId: lotSample, to: "hold" });

  // LOT-0004: PO KO-77, a plain men's tee, no print: the rate card skips print and the pieces go from cutting straight to stitching.
  // The helper, who has no rate of their own, is paid the stage default for thread cutting.
  const lotTee = await lot("Men's plain round neck tee, 180 GSM, navy", "PO KO-77 · Kestrel Outfitters, Australia", 300, 5, 22, "Single jersey",
    "Size break S 60, M 90, L 90, XL 60. Pack 6 per inner, 48 per carton.");
  const tee = await cut(lotTee, [{ copies: 1, netPieces: 60, sizeNote: "S" }, { copies: 1, netPieces: 90, sizeNote: "M" }], [[jersey[1]!, 25.4], [jersey[2]!, 5]], 4);
  await executeCommand(actor, piecework.setLotRates, { lotId: lotTee, rows: [{ stageId: stage.print!, skipped: true }, { stageId: stage.stitching!, rateMinor: 900 }] });
  const t1 = await out(tee[0]!, "stitching", "fabricator", 60, 3);
  await back(t1.id, { good: 58, rework: 2 }, 1, "Needle hole");
  const tc = await out(tee[0]!, "threadcut", "helper", 58, 1);
  await back(tc.id, { good: 58 }, 1);
  await out(tee[1]!, "stitching", "rafiq", 90, 2, { dueDate: day(3) });

  // LOT-0005: PO MB-118, a French label's ladies rib crop top: fit sample approved, bulk not yet cut (the coral rib is on the shelf).
  const lotCrop = await lot("Ladies rib crop top, square neck", "PO MB-118 · Maison Bleue SARL, France", 400, 2, 35, "Rib",
    "Size break S 100, M 150, L 100, XL 50. Fit sample approved; bulk cut after shade approval.");

  // What the lots cost beyond fabric and wages: one thread bill shared by three lots (split by pieces cut), zips, trims, packing.
  await lotCost([lotHoodie, lotSample, lotTee], "Thread", 3_480, 5, "Bill 2290, poly-core thread");
  await lotCost([lotHoodie], "Zips", 7_200, 15, "No. 5 nylon zips, 300 pcs");
  await lotCost([lotHoodie], "Labels and trims", 2_850, 15, "Main label, size label, hang tag");
  await lotCost([lotTee], "Packing", 1_900, 2, "Polybags and inner boxes");

  // Lot pictures for the screens: the demo tenant's own generated images, served from public/demo/akhand (prompts in
  // clients/akhand-exports/image-prompts.md). They belong to this demo only.
  const covers: Array<[string, string]> = [[lotRomper, "lot-romper-thumb"], [lotHoodie, "lot-hoodie-thumb"], [lotSample, "lot-sample-tee-thumb"], [lotTee, "lot-plain-tee-thumb"], [lotCrop, "lot-crop-top-thumb"]];
  for (const [id, file] of covers) {
    await admin.$executeRaw`UPDATE piecework_lot SET custom_fields = custom_fields || jsonb_build_object('coverImage', ${`/demo/akhand/${file}.webp`}::text) WHERE id = ${id}::uuid`;
  }

  // The karigar ledger: an advance, part of it recovered out of wages, a deduction, payments to people and job workers.
  const pay = (who: string, kind: "advance" | "recovery" | "deduction" | "payment", rupees: number, daysAgo: number, extra: Record<string, unknown> = {}) =>
    executeCommand(actor, piecework.recordPayment, { workerId: worker[who]!, kind, amountMinor: Math.round(rupees * 100), paidOn: day(-daysAgo), ...extra });
  await pay("rafiq", "advance", 2000, 12, { mode: "cash", note: "Festival advance" });
  await pay("rafiq", "recovery", 1000, 3, { note: "Part of the festival advance" });
  await pay("rafiq", "payment", 1500, 7, { mode: "upi", reference: "UPI 6630217" });
  await pay("mohan", "payment", 1200, 7, { mode: "upi", reference: "UPI 6630218" });
  await pay("printer", "payment", 1500, 9, { mode: "bank", reference: "NEFT 88213" });
  await pay("sunita", "payment", 250, 7, { mode: "cash" });
  await pay("vikas", "deduction", 60, 2, { note: "Shine mark from the iron on 3 pieces" });

  // The floor: one supervisor looks after every stage at this size; what waits for a decision; one closed day.
  if (ownerActor) {
    await executeCommand(ownerActor, piecework.setLimits, { deductionLimitMinor: 150_000, writeoffLimitPieces: 5 });
    if (ids.supervisor) await executeCommand(ownerActor, piecework.assignStages, { userId: ids.supervisor.userId, stageIds: Object.values(stage) });
  }
  if (supervisor) {
    await executeCommand(supervisor, piecework.requestApproval, { kind: "deduction", workerId: worker.printer!, amountMinor: 1_600, reason: "2 hoodie fronts spoiled by print smudge, PO NV-2611" });
    await executeCommand(supervisor, piecework.requestApproval, { kind: "deduction", workerId: worker.fabricator!, amountMinor: 300_000, reason: "Bundle late past the ex-factory plan; air freight risk on PO NV-2611" });
    // Today's work, so the closed day carries real figures.
    const todayPress = await executeCommand(supervisor, piecework.recordIssue, { bundleId: tee[0]!, stageId: stage.press!, workerId: worker.vikas!, pieces: 58, sentPieces: 58, ackMethod: "attested", dueDate: day(1) });
    await executeCommand(supervisor, piecework.recordReturn, { issueId: todayPress.id, good: 58, rejected: 0, rework: 0, short: 0 });
    await executeCommand(supervisor, piecework.closeDay, { note: "आज KO-77 का S साइज़ प्रेस हो गया। NV-2611 का 4-5Y बंडल सैनी फैब्रिकेटर्स पर दो दिन लेट है, फोन किया।", lang: "hi" });
  }
  // The charge asked for the hoodie lost at stitching is decided by the owner, so the case shows as settled.
  if (ownerActor) {
    const asked = await asMigrationRoleInTenant(admin, tenantId, (tx) => tx.pieceworkApproval.findFirst({ where: { entryId: st1ret.id, kind: "deduction", status: "pending" } }));
    if (asked) await executeCommand(ownerActor, piecework.decideApproval, { approvalId: asked.id, decision: "approved" });
  }

  console.log("\nAkhand Export demo tenant is ready.\n");
  console.log(`Tenant:  ${tenantId}`);
  for (const email of Object.keys(passwords)) console.log(`Login:   ${email}  password ${passwords[email]}  (shown once)`);
  console.log("Lots: 5 buyer orders (LT-504 shipped and closed, NV-2611 running, salesman samples on hold, KO-77 skips print, MB-118 draft), 15 knit rolls in kg, 8 karigars and job workers, 5 stages. Everything is fictional.");
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
