/**
 * Seeds the D & S Electric Works demo tenant (clients/dsew/prd.md): a transformer and electromagnet
 * maker in Rau, Indore. Synthetic data only, safe to show a prospect.
 *
 * Two identity modes, chosen by the environment:
 *
 *   - Supabase (how every Verity deployment runs): with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set and no
 *     DSEW_OWNER_SUB, a real owner login is created through Supabase Auth with a generated password, printed once.
 *   - OIDC (ADR-020, the on-premise profile): DSEW_OWNER_SUB is the IdP `sub` of an existing login.
 *
 * The tenant is flagged `customFields.demo = true`, which is what `reset-demo.ts` requires before it will delete one.
 *
 * Idempotency: NONE. A second run creates a second tenant (same posture as seed-colonel-kebabz.ts); run
 * `npm run reset:demo` first to replace the demo.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { installCapabilities } from "../src/server/capabilities/registry";
import { provisionIdentity } from "../src/server/platform/identity";
import { activateCapability, invalidateCapabilityCache } from "../src/server/platform/capability";
import { executeCommand as rawExecute, type ActorContext } from "../src/server/platform/command";
import * as inventory from "../src/server/capabilities/inventory";
import * as manufacturing from "../src/server/capabilities/manufacturing";
import * as location from "../src/server/capabilities/location";
import * as evidence from "../src/server/capabilities/evidence";
import * as hr from "../src/server/capabilities/hr";
import * as accounting from "../src/server/capabilities/accounting";
import * as project from "../src/server/capabilities/project";
import * as trading from "../src/server/capabilities/trading/orders";
import { ENTITY_CUSTOMER, TRADING_CAPABILITY, gstinCheckDigit } from "../src/server/capabilities/trading/keys";
import { createBom, createOrderFromBom } from "../src/server/capabilities/manufacturing/bom";
import {
  completeOperation,
  createRoute,
  planOperations,
  startOperation,
} from "../src/server/capabilities/manufacturing/stages";
import { asMigrationRoleInTenant } from "./migration-role";

const OWNER_EMAIL = process.env.DSEW_OWNER_EMAIL ?? "owner@dsew.demo";
let OWNER_SUB = process.env.DSEW_OWNER_SUB;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!OWNER_SUB && !(SUPABASE_URL && SERVICE_ROLE_KEY)) {
  throw new Error("Set DSEW_OWNER_SUB (OIDC), or SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to create a Supabase login");
}

function suggestPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  let out = "";
  for (let i = 0; i < 14; i += 1) out += alphabet[parseInt(bytes.slice(i * 2, i * 2 + 2), 16) % alphabet.length];
  return out;
}

/** Set once when this run created the Supabase login, so a failed seed can remove it again. */
let createdAuthUserId: string | null = null;
let generatedPassword: string | null = null;

async function ensureOwnerLogin(): Promise<void> {
  if (OWNER_SUB) return;
  const supabaseAdmin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  // A reset keeps the same login when DSEW_OWNER_PASSWORD is given, so credentials already shared stay valid.
  generatedPassword = process.env.DSEW_OWNER_PASSWORD ?? suggestPassword();
  const created = await supabaseAdmin.auth.admin.createUser({
    email: OWNER_EMAIL,
    password: generatedPassword,
    email_confirm: true,
    user_metadata: { display_name: "D & S Owner" },
  });
  if (created.error || !created.data.user) throw new Error(`could not create the owner login: ${created.error?.message}`);
  createdAuthUserId = created.data.user.id;
  OWNER_SUB = createdAuthUserId;
}

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });

/**
 * The platform rate-limits commands per actor (a database-backed guard). A seed makes
 * hundreds of them, so it waits out the quota the way any client would rather than bypassing it.
 */
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

/** Every ENTITY_* a capability module exports, so the owner can use every screen without a hand list. */
function entitiesOf(...modules: Array<Record<string, unknown>>): string[] {
  const keys = new Set<string>();
  for (const mod of modules) {
    for (const [name, value] of Object.entries(mod)) {
      if (name.startsWith("ENTITY_") && typeof value === "string") keys.add(value);
    }
  }
  return [...keys];
}

// Trading first: Jobs depend on it for the customer master.
const CAPABILITIES = [
  TRADING_CAPABILITY,
  location.LOCATION_CAPABILITY,
  evidence.EVIDENCE_CAPABILITY,
  inventory.INVENTORY_CAPABILITY,
  manufacturing.MANUFACTURING_CAPABILITY,
  hr.HR_CAPABILITY,
  accounting.ACCOUNTING_CAPABILITY,
  project.PROJECT_CAPABILITY,
];

/** Opening unit costs in paise, so material cost on a job is real rather than zero. */
const UNIT_COST: Record<string, number> = {
  "CRGO-M4": 25_000, "CU-STRIP": 78_000, "CU-WIRE": 82_000, "EPOXY-RES": 45_000,
  "INS-NOMEX": 9_000, "TERM-SET": 350_000, "ENCL-IP21": 1_800_000, "COOL-COIL": 2_500_000,
};

const ITEMS = [
  { sku: "CRGO-M4", name: "CRGO silicon steel, M4 grade", unit: "kg", group: "Raw material", opening: 4000 },
  { sku: "CU-STRIP", name: "Copper strip, electrolytic", unit: "kg", group: "Raw material", opening: 1500 },
  { sku: "CU-WIRE", name: "Enamelled copper wire", unit: "kg", group: "Raw material", opening: 900 },
  { sku: "EPOXY-RES", name: "Epoxy casting resin and hardener", unit: "kg", group: "Raw material", opening: 800 },
  { sku: "INS-NOMEX", name: "Nomex insulation paper", unit: "m", group: "Raw material", opening: 1200 },
  { sku: "TERM-SET", name: "HV/LV terminal set", unit: "set", group: "Component", opening: 40 },
  { sku: "ENCL-IP21", name: "Sheet-steel enclosure, IP21", unit: "pc", group: "Component", opening: 12 },
  { sku: "COOL-COIL", name: "Water-cooling coil assembly", unit: "pc", group: "Component", opening: 6 },
  { sku: "TR-100K", name: "100 kVA cast resin dry-type transformer", unit: "pc", group: "Finished", opening: 0 },
  { sku: "TR-500K", name: "500 kVA cast resin dry-type transformer", unit: "pc", group: "Finished", opening: 0 },
  { sku: "EM-LAB05", name: "0.5 T lab electromagnet system", unit: "pc", group: "Finished", opening: 0 },
] as const;

// Units and limits are illustrative until DSEW confirms its own QAP; the unit belongs to the check, so no one types it.
const TEST_CHECKPOINTS = [
  { key: "ratio_test", label: "Turns ratio deviation", requireEvidence: false, requireRemarks: false, measure: { unit: "%", min: -0.5, max: 0.5 } },
  { key: "ir_test", label: "Insulation resistance (5 kV megger)", requireEvidence: true, requireRemarks: false, measure: { unit: "MΩ", min: 1000 } },
  { key: "hv_withstand", label: "Applied HV withstand, 60 s", requireEvidence: true, requireRemarks: false, measure: { unit: "kV", min: 28 } },
  { key: "noload_loss", label: "No-load loss", requireEvidence: false, requireRemarks: false, measure: { unit: "W", max: 450 } },
  { key: "load_loss", label: "Load loss", requireEvidence: false, requireRemarks: false, measure: { unit: "W", max: 1900 } },
  { key: "temp_rise", label: "Temperature rise at rated load", requireEvidence: false, requireRemarks: false, measure: { unit: "K", max: 100 } },
];

const TRAFO_ROUTE = [
  { stageKey: "core_cutting", label: "Core cutting and stacking" },
  { stageKey: "coil_winding", label: "LV/HV coil winding" },
  { stageKey: "vpi_casting", label: "Epoxy casting and VPI curing" },
  { stageKey: "assembly", label: "Core and coil assembly" },
  { stageKey: "testing", label: "Routine and type testing", checkpoints: TEST_CHECKPOINTS },
  { stageKey: "dispatch_prep", label: "Packing and dispatch preparation" },
];

const MAGNET_ROUTE = [
  { stageKey: "yoke_machining", label: "Yoke and pole machining" },
  { stageKey: "coil_winding", label: "Coil winding" },
  { stageKey: "assembly", label: "Magnet assembly" },
  {
    stageKey: "field_mapping",
    label: "3-axis field mapping",
    checkpoints: [
      { key: "uniformity", label: "Field uniformity within spec", requireEvidence: true, requireRemarks: false, measure: { unit: "%", max: 1 } },
      { key: "calibration", label: "Gaussmeter calibration reference noted", requireEvidence: false, requireRemarks: true },
    ],
  },
  { stageKey: "dispatch_prep", label: "Packing and dispatch preparation" },
];

async function main() {
  installCapabilities();
  await ensureOwnerLogin();
  const tenantId = randomUUID();

  const ids = await asMigrationRoleInTenant(admin, tenantId, async (tx) => {
    await tx.tenant.create({
      data: { id: tenantId, name: "D & S Electric Works", timeZone: "Asia/Kolkata", customFields: { demo: true, demoFor: "dsew" } },
    });
    const org = await tx.organization.create({ data: { tenantId, name: "D & S Electric Works", parentId: null } });
    const loc = await tx.location.create({ data: { tenantId, organizationId: org.id, name: "Rau Works, Indore" } });
    const role = await tx.role.create({ data: { tenantId, name: "Owner" } });

    const entities = entitiesOf(inventory, manufacturing, location, evidence, hr, accounting, project);
    await tx.permission.createMany({
      data: entities.flatMap((entity) =>
        (["Read", "Create", "Edit", "ActionExecute"] as const).map((verb) => ({
          tenantId,
          roleId: role.id,
          verb,
          entity,
          scope: "Tenant" as const,
        })),
      ),
    });

    // The generic landing page ("/") reads this; without it the owner lands on "no access".
    await tx.permission.create({
      data: { tenantId, roleId: role.id, verb: "Read", entity: "verity.platform.overview", scope: "Tenant" },
    });

    // Trading is active for its customer master only; its sales, purchase and stock screens stay
    // out of this tenant's sidebar because the owner is granted just the customer entity.
    await tx.permission.createMany({
      data: (["Read", "Create", "Edit", "ActionExecute"] as const).map((verb) => ({
        tenantId, roleId: role.id, verb, entity: ENTITY_CUSTOMER, scope: "Tenant" as const,
      })),
    });

    const identity = await provisionIdentity(tx, {
      organizationId: org.id,
      authUserId: OWNER_SUB!,
      displayName: "D & S Owner",
      email: OWNER_EMAIL,
    });
    await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId: role.id } });
    for (const key of CAPABILITIES) await activateCapability(tx, tenantId, key);
    return { orgId: org.id, locationId: loc.id, roleId: role.id, identity };
  });
  invalidateCapabilityCache();

  const owner: ActorContext = {
    tenantId,
    userId: ids.identity.userId,
    membershipId: ids.identity.membershipId,
    organizationId: ids.orgId,
    roleId: ids.roleId,
  };
  const locationId = ids.locationId;

  const groups = new Map<string, string>();
  for (const name of new Set(ITEMS.map((i) => i.group))) {
    groups.set(name, (await executeCommand(owner, inventory.createItemGroup, { name })).id);
  }
  const item = new Map<string, string>();
  for (const i of ITEMS) {
    const created = await executeCommand(owner, inventory.createItem, {
      sku: i.sku,
      name: i.name,
      unitLabel: i.unit,
      itemGroupId: groups.get(i.group),
      reorderLevel: i.opening > 0 ? Math.round(i.opening * 0.2) : 0,
    });
    item.set(i.sku, created.id);
    if (i.opening > 0) {
      await executeCommand(owner, inventory.recordStockMovement, {
        itemId: created.id,
        locationId,
        kind: "Receipt",
        qty: i.opening,
        reference: "Opening stock",
        unitCostPaise: UNIT_COST[i.sku],
      });
    }
  }
  const id = (sku: string) => item.get(sku)!;

  const trafoRoute = await executeCommand(owner, createRoute, { code: "DRY-TRAFO", name: "Cast resin transformer", stages: TRAFO_ROUTE });
  const magnetRoute = await executeCommand(owner, createRoute, { code: "ELECTROMAGNET", name: "Lab electromagnet", stages: MAGNET_ROUTE });

  const bom100 = await executeCommand(owner, createBom, {
    code: "TR-100K-R1",
    name: "100 kVA cast resin, rev 1",
    outputItemId: id("TR-100K"),
    lines: [
      { componentItemId: id("CRGO-M4"), qtyPerUnit: 210 },
      { componentItemId: id("CU-STRIP"), qtyPerUnit: 62 },
      { componentItemId: id("CU-WIRE"), qtyPerUnit: 48 },
      { componentItemId: id("EPOXY-RES"), qtyPerUnit: 55 },
      { componentItemId: id("INS-NOMEX"), qtyPerUnit: 14 },
      { componentItemId: id("TERM-SET"), qtyPerUnit: 1 },
      { componentItemId: id("ENCL-IP21"), qtyPerUnit: 1 },
    ],
  });
  const bom500 = await executeCommand(owner, createBom, {
    code: "TR-500K-R1",
    name: "500 kVA cast resin, rev 1",
    outputItemId: id("TR-500K"),
    lines: [
      { componentItemId: id("CRGO-M4"), qtyPerUnit: 780 },
      { componentItemId: id("CU-STRIP"), qtyPerUnit: 240 },
      { componentItemId: id("CU-WIRE"), qtyPerUnit: 160 },
      { componentItemId: id("EPOXY-RES"), qtyPerUnit: 190 },
      { componentItemId: id("INS-NOMEX"), qtyPerUnit: 40 },
      { componentItemId: id("TERM-SET"), qtyPerUnit: 1 },
      { componentItemId: id("ENCL-IP21"), qtyPerUnit: 1 },
    ],
  });
  const bomMagnet = await executeCommand(owner, createBom, {
    code: "EM-LAB05-R1",
    name: "0.5 T lab electromagnet, rev 1",
    outputItemId: id("EM-LAB05"),
    lines: [
      { componentItemId: id("CRGO-M4"), qtyPerUnit: 320 },
      { componentItemId: id("CU-WIRE"), qtyPerUnit: 210 },
      { componentItemId: id("INS-NOMEX"), qtyPerUnit: 18 },
      { componentItemId: id("COOL-COIL"), qtyPerUnit: 1 },
    ],
  });

  // Production orders first; each approved job below links to one of them.
  async function production(bomId: string, qty: number, ref: string, routeId: string, done: number, run: boolean) {
    const order = await executeCommand(owner, createOrderFromBom, { bomId, locationId, outputQty: qty, reference: ref });
    await executeCommand(owner, planOperations, { orderId: order.id, routeId });
    if (!run) return order.id;
    await executeCommand(owner, manufacturing.startManufacturingOrder, { orderId: order.id });
    const ops = await asMigrationRoleInTenant(admin, tenantId, (tx) =>
      tx.manufacturingOperation.findMany({ where: { orderId: order.id }, orderBy: { sequence: "asc" } }),
    );
    for (const op of ops.slice(0, done)) {
      // A stage with QC checkpoints cannot be completed without findings; leave those open.
      if (Array.isArray(op.checkpoints) && op.checkpoints.length > 0) break;
      await executeCommand(owner, startOperation, { operationId: op.id });
      await executeCommand(owner, completeOperation, { operationId: op.id });
    }
    return order.id;
  }

  const reasons = new Map<string, string>();
  for (const [key, label] of [
    ["price", "Price too high"],
    ["lead_time", "Delivery time too long"],
    ["spec_mismatch", "Could not meet the specification"],
    ["competitor", "Went with another maker"],
    ["project_dropped", "Customer dropped the project"],
  ] as const) {
    reasons.set(key, (await executeCommand(owner, project.defineLostReason, { key, label })).id);
  }

  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const line = (description: string, qty: number, rupees: number) => ({ description, qty, unitPriceMinor: rupees * 100 });
  const RATE = { winder: 45_000, engineer: 60_000, helper: 35_000 };

  /** A valid GSTIN built from a PAN-shaped body and the real check digit, so the platform's own validation accepts it. */
  const gstin = (state: string, pan: string) => {
    const body = `${state}${pan}1Z`;
    return body + gstinCheckDigit(body);
  };
  const CUSTOMERS: Array<{ name: string; gstin: string; phone: string; email: string }> = [
    { name: "Dept of Physics, IIT Indore", gstin: gstin("23", "AAAGI1234A"), phone: "98270 11122", email: "physics.stores@iiti.example" },
    { name: "Rau Textiles Ltd", gstin: gstin("23", "AABCR2345B"), phone: "94250 33445", email: "purchase@rautextiles.example" },
    { name: "Indore Metrology Lab", gstin: gstin("23", "AAATI3456C"), phone: "99810 22334", email: "lab@indoremetrology.example" },
    { name: "Pithampur Auto Components", gstin: gstin("23", "AABCP4567D"), phone: "97550 66778", email: "stores@pithampurauto.example" },
    { name: "MP Power Transmission Co", gstin: gstin("23", "AAACM5678E"), phone: "98930 88990", email: "aux.supply@mppower.example" },
    { name: "NIT Bhopal Electrical Dept", gstin: gstin("23", "AAAGN6789F"), phone: "98260 55667", email: "eee@nitbhopal.example" },
    { name: "Central University Lab, Sagar", gstin: gstin("23", "AAAGC7890G"), phone: "98273 44556", email: "lab@cusagar.example" },
    { name: "Ujjain Switchgear Works", gstin: gstin("23", "AABCU8901H"), phone: "94250 77889", email: "sales@ujjainswitchgear.example" },
    { name: "Sunrise Telecom Pvt Ltd", gstin: gstin("27", "AACCS9012J"), phone: "98270 99001", email: "infra@sunrisetelecom.example" },
  ];
  const customerIds = new Map<string, string>();
  for (const c of CUSTOMERS) {
    const created = await executeCommand(owner, trading.createCustomer, {
      displayName: c.name, gstin: c.gstin, phone: c.phone, email: c.email, stateCode: c.gstin.slice(0, 2),
    });
    customerIds.set(c.name, created.id);
  }

  type Seed = {
    title: string; customer: string; contact: string; priority: "low" | "normal" | "high" | "urgent"; due: number; notes: string;
    quotes: Array<Array<ReturnType<typeof line>>>;
    stage: "enquiry" | "quoted" | "approved" | "in_progress" | "lost" | "completed";
    order?: { bom: string; qty: number; ref: string; route: string; done: number; run: boolean };
  };
  const specs: Seed[] = [
    {
      title: "500 kVA cast resin transformer, 11 kV / 433 V", customer: "Dept of Physics, IIT Indore", contact: "Prof. Mehta, 98270 11122",
      priority: "high", due: 34, notes: "Vector group Dyn11, IP21 enclosure, with winding temperature indicator. Type test report required.",
      quotes: [[line("500 kVA cast resin dry-type transformer, 11 kV / 433 V", 1, 1_120_000), line("Type test at external lab", 1, 90_000)], [line("500 kVA cast resin dry-type transformer, 11 kV / 433 V", 1, 1_060_000), line("Type test at external lab", 1, 90_000)]],
      stage: "in_progress", order: { bom: bom500.id, qty: 1, ref: "DSEW 500 kVA | IIT Indore", route: trafoRoute.id, done: 6, run: true },
    },
    {
      title: "100 kVA dry-type transformers, 2 units", customer: "Rau Textiles Ltd", contact: "Mr. Jain, 94250 33445",
      priority: "normal", due: 21, notes: "Two identical units for the new spinning line. 415 V secondary.",
      quotes: [[line("100 kVA dry-type transformer, 11 kV / 415 V", 2, 300_000)]],
      stage: "in_progress", order: { bom: bom100.id, qty: 2, ref: "DSEW 100 kVA x2 | Rau Textiles", route: trafoRoute.id, done: 3, run: true },
    },
    {
      title: "0.5 T lab electromagnet system with field mapping", customer: "Indore Metrology Lab", contact: "Dr. Rao, 99810 22334",
      priority: "urgent", due: 12, notes: "Field uniformity better than 0.1% over a 20 mm sphere. 3-axis mapping certificate with the unit.",
      quotes: [[line("0.5 T electromagnet with water-cooled coils", 1, 560_000), line("3-axis field mapping and certificate", 1, 80_000)]],
      stage: "in_progress", order: { bom: bomMagnet.id, qty: 1, ref: "DSEW 0.5 T magnet | Metrology Lab", route: magnetRoute.id, done: 2, run: true },
    },
    {
      title: "100 kVA dry-type transformer", customer: "Pithampur Auto Components", contact: "Mr. Verma, 97550 66778",
      priority: "normal", due: 40, notes: "Replacement for a failed oil-type unit. Same footprint required.",
      quotes: [[line("100 kVA dry-type transformer, 11 kV / 415 V", 1, 310_000)]],
      stage: "in_progress", order: { bom: bom100.id, qty: 1, ref: "DSEW 100 kVA | Pithampur Auto", route: trafoRoute.id, done: 0, run: true },
    },
    {
      title: "500 kVA cast resin transformer (quote approved)", customer: "MP Power Transmission Co", contact: "Er. Sharma, 98930 88990",
      priority: "normal", due: 60, notes: "Substation auxiliary supply. Awaiting purchase order copy.",
      quotes: [[line("500 kVA cast resin dry-type transformer, 11 kV / 433 V", 1, 1_080_000)]],
      stage: "approved", order: { bom: bom500.id, qty: 1, ref: "DSEW 500 kVA | MP Power", route: trafoRoute.id, done: 0, run: false },
    },
    {
      title: "50 kV HV step-up test transformer", customer: "NIT Bhopal Electrical Dept", contact: "Prof. Iyer, 98260 55667",
      priority: "normal", due: 75, notes: "Teaching lab test set. Oil-free, portable on castors.",
      quotes: [[line("HV step-up transformer, 230 V to 50 kV, 5 kVA", 1, 480_000)], [line("HV step-up transformer, 230 V to 50 kV, 5 kVA", 1, 455_000), line("Protective discharge rod set", 1, 12_000)]],
      stage: "quoted",
    },
    {
      title: "Power supply for superconducting magnet", customer: "Central University Lab, Sagar", contact: "Dr. Khan, 98273 44556",
      priority: "low", due: 120, notes: "Enquiry by email. Wants 200 A, low ripple. Needs a technical call first.",
      quotes: [], stage: "enquiry",
    },
    {
      title: "Control panel for transformer test bay", customer: "Ujjain Switchgear Works", contact: "Mr. Patel, 94250 77889",
      priority: "normal", due: -5, notes: "Panel with metering and interlocks.",
      quotes: [[line("Control and metering panel", 1, 385_000)]], stage: "lost",
    },
    {
      title: "250 kVA isolation transformer", customer: "Sunrise Telecom Pvt Ltd", contact: "Ms. Kulkarni, 98270 99001",
      priority: "normal", due: -9, notes: "Delivered and commissioned.",
      quotes: [[line("250 kVA ultra-isolation transformer", 1, 320_000)]], stage: "completed",
    },
  ];

  const jobIds: string[] = [];
  for (const spec of specs) {
    const job = await executeCommand(owner, project.createJob, {
      title: spec.title, customerId: customerIds.get(spec.customer)!, customerContact: spec.contact, description: spec.notes,
      priority: spec.priority, dueDate: day(spec.due),
    });
    jobIds.push(job.id);
    let lastQuote: { id: string } | null = null;
    for (const lines of spec.quotes) {
      // A quote still waiting for a reply has run past its validity, so a follow-up shows on the Summary.
      lastQuote = await executeCommand(owner, project.addQuoteRevision, { jobId: job.id, lines, validUntil: day(spec.stage === "quoted" ? -2 : 30), scopeNote: "Ex-works Rau, Indore. 12 months warranty. 50% advance, balance before dispatch. GST extra." });
    }
    if (spec.stage === "lost") {
      await executeCommand(owner, project.markJobLost, { jobId: job.id, reasonId: reasons.get("price")!, note: "Customer found a lower price from a panel builder." });
      continue;
    }
    if (spec.stage === "enquiry" || spec.stage === "quoted") continue;

    await executeCommand(owner, project.approveQuote, { quoteId: lastQuote!.id });
    if (spec.order) {
      const orderId = await production(spec.order.bom, spec.order.qty, spec.order.ref, spec.order.route, spec.order.done, spec.order.run);
      await executeCommand(owner, project.linkOrder, { jobId: job.id, orderId });
    }
    if (spec.stage === "approved") continue;
    await executeCommand(owner, project.startJob, { jobId: job.id });
  }

  // A draft order not yet tied to any job, so "Link production order" has something to link.
  await production(bom100.id, 1, "DSEW 100 kVA | stock build, not yet sold", trafoRoute.id, 0, false);

  // Work on the running jobs: tasks, milestones, time and costs.
  const [iit, rau, magnet, pithampur, , , , , sunrise] = jobIds;
  const task = (jobId: string, title: string, extra: Record<string, unknown> = {}) =>
    executeCommand(owner, project.createTask, { jobId, title, ...extra });
  const finish = async (taskId: string) => {
    await executeCommand(owner, project.setTaskState, { taskId, toState: "in_progress" });
    await executeCommand(owner, project.setTaskState, { taskId, toState: "done" });
  };
  const time = (jobId: string, worker: string, ago: number, hours: number, rate: number, note?: string, taskId?: string) =>
    executeCommand(owner, project.logTime, { jobId, workerLabel: worker, workDate: day(-ago), minutes: Math.round(hours * 60), hourlyRateMinor: rate, note, taskId });

  // IIT Indore: design and winding done, testing ahead.
  const iitDesign = await task(iit!, "Design review and drawings approved", { assigneeLabel: "Engineering", weight: 2, expectedMinutes: 960 });
  const iitProc = await task(iit!, "Procure CRGO and copper", { assigneeLabel: "Stores", weight: 1, dependsOnIds: [iitDesign.id] });
  const iitCore = await task(iit!, "Core stacking and coil winding", { assigneeLabel: "Shop floor", weight: 4, dueDate: day(8), dependsOnIds: [iitProc.id] });
  const iitTest = await task(iit!, "Type test at external lab", { assigneeLabel: "Quality", weight: 3, dueDate: day(20), dependsOnIds: [iitCore.id] });
  await task(iit!, "Packing and dispatch to IIT Indore", { assigneeLabel: "Dispatch", weight: 1, dueDate: day(30), dependsOnIds: [iitTest.id] });
  await finish(iitDesign.id);
  await finish(iitProc.id);
  await executeCommand(owner, project.setTaskState, { taskId: iitCore.id, toState: "in_progress" });
  const iitM1 = await executeCommand(owner, project.addMilestone, { jobId: iit!, name: "Drawings approved by customer", dueDate: day(-12) });
  await executeCommand(owner, project.reachMilestone, { milestoneId: iitM1.id });
  await executeCommand(owner, project.addMilestone, { jobId: iit!, name: "Coils cast and cured", dueDate: day(6) });
  await executeCommand(owner, project.addMilestone, { jobId: iit!, name: "Test report issued", dueDate: day(22) });
  await executeCommand(owner, project.addMilestone, { jobId: iit!, name: "Delivered at IIT Indore", dueDate: day(32) });
  await time(iit!, "R. Verma (engineer)", 14, 6, RATE.engineer, "Drawings", iitDesign.id);
  await time(iit!, "R. Verma (engineer)", 13, 5.5, RATE.engineer, "Drawings", iitDesign.id);
  await time(iit!, "S. Yadav (winder)", 6, 8, RATE.winder, "LV coil", iitCore.id);
  await time(iit!, "S. Yadav (winder)", 5, 8, RATE.winder, "HV coil", iitCore.id);
  await time(iit!, "K. Chouhan (helper)", 5, 7.5, RATE.helper, "Core stacking", iitCore.id);
  await executeCommand(owner, project.addCost, { jobId: iit!, kind: "outsourced", description: "Epoxy mould fabrication", supplierName: "Mehta Tooling, Pithampur", amountMinor: 8_500_000, incurredOn: day(-16) });
  await executeCommand(owner, project.addCost, { jobId: iit!, kind: "testing", description: "Type test slot booking, advance", supplierName: "ERDA Vadodara", amountMinor: 4_000_000, incurredOn: day(-3) });

  // Rau Textiles: two units in assembly.
  const rauDesign = await task(rau!, "Confirm winding data with customer", { assigneeLabel: "Engineering", weight: 1 });
  const rauBuild = await task(rau!, "Build two units", { assigneeLabel: "Shop floor", weight: 5, dependsOnIds: [rauDesign.id] });
  await task(rau!, "Routine tests and report", { assigneeLabel: "Quality", weight: 2, dueDate: day(14), dependsOnIds: [rauBuild.id] });
  // A task stuck on a supplier delivery: blocked work shows under Needs attention on the Summary.
  const rauTerminals = await task(rau!, "Receive HV terminal sets from supplier", { assigneeLabel: "Stores", weight: 1, dueDate: day(-2) });
  await executeCommand(owner, project.setTaskState, { taskId: rauTerminals.id, toState: "blocked" });
  await finish(rauDesign.id);
  await executeCommand(owner, project.setTaskState, { taskId: rauBuild.id, toState: "in_progress" });
  await executeCommand(owner, project.addMilestone, { jobId: rau!, name: "Units assembled", dueDate: day(9) });
  await executeCommand(owner, project.addMilestone, { jobId: rau!, name: "Dispatch to Rau", dueDate: day(20) });
  await time(rau!, "S. Yadav (winder)", 9, 8, RATE.winder, "Coils unit 1", rauBuild.id);
  await time(rau!, "S. Yadav (winder)", 8, 8, RATE.winder, "Coils unit 2", rauBuild.id);
  await time(rau!, "K. Chouhan (helper)", 7, 6, RATE.helper, "Assembly", rauBuild.id);
  await executeCommand(owner, project.addCost, { jobId: rau!, kind: "freight", description: "Inward freight, enclosure sheets", supplierName: "Malwa Transport", amountMinor: 1_850_000, incurredOn: day(-10) });

  // Metrology lab magnet: urgent, field mapping still to come.
  const emDesign = await task(magnet!, "Pole shape and field simulation", { assigneeLabel: "Engineering", weight: 3 });
  await task(magnet!, "3-axis field mapping and certificate", { assigneeLabel: "Quality", weight: 3, dueDate: day(10), dependsOnIds: [emDesign.id] });
  await finish(emDesign.id);
  await executeCommand(owner, project.addMilestone, { jobId: magnet!, name: "Field mapping complete", dueDate: day(-1) });
  await executeCommand(owner, project.addMilestone, { jobId: magnet!, name: "Calibration certificate issued", dueDate: day(10) });
  await time(magnet!, "R. Verma (engineer)", 11, 7, RATE.engineer, "Simulation", emDesign.id);
  await time(magnet!, "R. Verma (engineer)", 10, 7, RATE.engineer, "Simulation", emDesign.id);
  await executeCommand(owner, project.addCost, { jobId: magnet!, kind: "outsourced", description: "Precision pole machining", supplierName: "Anand Precision, Indore", amountMinor: 11_000_000, incurredOn: day(-8) });

  // Pithampur: just started.
  const pDesign = await task(pithampur!, "Match footprint to the failed unit", { assigneeLabel: "Engineering", weight: 1 });
  await task(pithampur!, "Build and test", { assigneeLabel: "Shop floor", weight: 4, dependsOnIds: [pDesign.id] });
  await task(pithampur!, "Customer sign-off on footprint drawing", { assigneeLabel: "Engineering", weight: 1, dueDate: day(-1) });
  await executeCommand(owner, project.addMilestone, { jobId: pithampur!, name: "Dispatch", dueDate: day(38) });
  await time(pithampur!, "R. Verma (engineer)", 2, 3, RATE.engineer, "Site measurements", pDesign.id);

  // Sunrise Telecom: delivered job with its full cost, so a finished margin is visible.
  const sDesign = await task(sunrise!, "Design and winding data", { assigneeLabel: "Engineering", weight: 1 });
  const sBuild = await task(sunrise!, "Build, test and dispatch", { assigneeLabel: "Shop floor", weight: 4, dependsOnIds: [sDesign.id] });
  await finish(sDesign.id);
  await finish(sBuild.id);
  await time(sunrise!, "R. Verma (engineer)", 40, 8, RATE.engineer, "Design", sDesign.id);
  await time(sunrise!, "S. Yadav (winder)", 34, 8, RATE.winder, "Winding", sBuild.id);
  await time(sunrise!, "S. Yadav (winder)", 33, 8, RATE.winder, "Winding", sBuild.id);
  await time(sunrise!, "K. Chouhan (helper)", 30, 8, RATE.helper, "Assembly", sBuild.id);
  await executeCommand(owner, project.addCost, { jobId: sunrise!, kind: "outsourced", description: "Core and sheet-metal work", supplierName: "Mehta Tooling, Pithampur", amountMinor: 14_000_000, incurredOn: day(-36) });
  await executeCommand(owner, project.addCost, { jobId: sunrise!, kind: "testing", description: "Routine test report", supplierName: "ERDA Vadodara", amountMinor: 2_500_000, incurredOn: day(-20) });
  await executeCommand(owner, project.addCost, { jobId: sunrise!, kind: "freight", description: "Delivery to Pune", supplierName: "Malwa Transport", amountMinor: 3_200_000, incurredOn: day(-12) });
  await executeCommand(owner, project.completeJob, { jobId: sunrise! });

  // Billing, recorded as the business raised it (tax as printed on each invoice). Billing continues after a job
  // is finished, so the completed job carries its final invoice and receipts too.
  const invoice = async (jobId: string, kind: "advance" | "progress" | "final", no: number, ago: number, rupees: number, taxRupees: number) =>
    executeCommand(owner, project.recordInvoice, { jobId, kind, number: `DSEW/26-27/${String(no).padStart(3, "0")}`, issuedOn: day(-ago), amountMinor: rupees * 100, taxMinor: taxRupees * 100 });
  const receive = async (jobId: string, invoiceId: string, ago: number, rupees: number, method: "bank" | "cheque" | "upi", reference: string) =>
    executeCommand(owner, project.recordReceipt, { jobId, invoiceId, receivedOn: day(-ago), amountMinor: rupees * 100, method, reference });

  const iitAdvance = await invoice(iit!, "advance", 41, 22, 575_000, 103_500);
  await receive(iit!, iitAdvance.id, 18, 678_500, "bank", "NEFT IITI/0910");
  const rauAdvance = await invoice(rau!, "advance", 44, 12, 300_000, 54_000);
  await receive(rau!, rauAdvance.id, 8, 200_000, "bank", "NEFT RAU/4471");
  const emAdvance = await invoice(magnet!, "advance", 46, 14, 256_000, 46_080);
  await receive(magnet!, emAdvance.id, 11, 302_080, "cheque", "Cheque 004512");
  await invoice(pithampur!, "advance", 49, 3, 155_000, 27_900);
  const sunAdvance = await invoice(sunrise!, "advance", 33, 38, 160_000, 28_800);
  await receive(sunrise!, sunAdvance.id, 35, 188_800, "bank", "NEFT SUN/2210");
  const sunFinal = await invoice(sunrise!, "final", 38, 10, 160_000, 28_800);
  await receive(sunrise!, sunFinal.id, 4, 188_800, "upi", "UPI 5821993");

  console.log("\nD & S Electric Works demo tenant is ready.\n");
  console.log(`Tenant:   ${tenantId}`);
  console.log(`Owner:    ${OWNER_EMAIL} (${generatedPassword ? `Supabase login, password ${generatedPassword}` : `IdP sub ${OWNER_SUB}`})`);
  console.log(`Items:    ${ITEMS.length}, routes: 2, BOMs: 3, jobs: ${specs.length}`);
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
    if (createdAuthUserId && SUPABASE_URL && SERVICE_ROLE_KEY) {
      // Same posture as seed-colonel-kebabz.ts: do not leave a login behind for a tenant that was never completed.
      const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      await supabaseAdmin.auth.admin.deleteUser(createdAuthUserId).catch(() => {});
      console.error("Removed the Supabase login created by this run. Run reset:demo to clear any partial tenant.");
    }
  })
  .finally(async () => {
    await admin.$disconnect();
  });
