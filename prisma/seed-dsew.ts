/**
 * Seeds the D & S Electric Works demo tenant (clients/dsew/prd.md): a transformer and electromagnet
 * maker in Rau, Indore. Synthetic data only, safe to show a prospect.
 *
 * Identity is OIDC (ADR-020): the owner's `authUserId` is the IdP `sub`, passed as DSEW_OWNER_SUB.
 * Nothing here talks to Supabase. Run against a throwaway database only:
 *
 *   DSEW_OWNER_SUB=<uuid> npm run seed:dsew
 *
 * Idempotency: NONE. A second run creates a second tenant (same posture as seed-colonel-kebabz.ts).
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { installCapabilities } from "../src/server/capabilities/registry";
import { provisionIdentity } from "../src/server/platform/identity";
import { activateCapability, invalidateCapabilityCache } from "../src/server/platform/capability";
import { executeCommand, type ActorContext } from "../src/server/platform/command";
import * as inventory from "../src/server/capabilities/inventory";
import * as manufacturing from "../src/server/capabilities/manufacturing";
import * as location from "../src/server/capabilities/location";
import * as hr from "../src/server/capabilities/hr";
import * as accounting from "../src/server/capabilities/accounting";
import { createBom, createOrderFromBom } from "../src/server/capabilities/manufacturing/bom";
import {
  completeOperation,
  createRoute,
  planOperations,
  startOperation,
} from "../src/server/capabilities/manufacturing/stages";

const OWNER_EMAIL = process.env.DSEW_OWNER_EMAIL ?? "owner@dsew.demo";
const OWNER_SUB = process.env.DSEW_OWNER_SUB;
if (!OWNER_SUB) throw new Error("DSEW_OWNER_SUB must be the IdP subject (a UUID) of the owner login");

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });

async function withTenant<T>(tenantId: string, fn: (tx: typeof admin) => Promise<T>): Promise<T> {
  return admin.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('verity.tenant_id', ${tenantId}, true)`;
    return fn(tx as typeof admin);
  });
}

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

const CAPABILITIES = [
  location.LOCATION_CAPABILITY,
  inventory.INVENTORY_CAPABILITY,
  manufacturing.MANUFACTURING_CAPABILITY,
  hr.HR_CAPABILITY,
  accounting.ACCOUNTING_CAPABILITY,
];

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

const TEST_CHECKPOINTS = [
  { key: "ratio_test", label: "Turns ratio test within 0.5%", requireEvidence: false, requireRemarks: false },
  { key: "ir_test", label: "Insulation resistance (5 kV megger)", requireEvidence: true, requireRemarks: false },
  { key: "hv_withstand", label: "Applied and induced HV withstand", requireEvidence: true, requireRemarks: false },
  { key: "losses", label: "No-load and load loss measured", requireEvidence: false, requireRemarks: true },
  { key: "temp_rise", label: "Temperature rise at rated load", requireEvidence: false, requireRemarks: true },
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
      { key: "uniformity", label: "Field uniformity within spec", requireEvidence: true, requireRemarks: false },
      { key: "calibration", label: "Gaussmeter calibration reference noted", requireEvidence: false, requireRemarks: true },
    ],
  },
  { stageKey: "dispatch_prep", label: "Packing and dispatch preparation" },
];

async function main() {
  installCapabilities();
  const tenantId = randomUUID();

  const ids = await withTenant(tenantId, async (tx) => {
    await tx.tenant.create({ data: { id: tenantId, name: "D & S Electric Works", timeZone: "Asia/Kolkata" } });
    const org = await tx.organization.create({ data: { tenantId, name: "D & S Electric Works", parentId: null } });
    const loc = await tx.location.create({ data: { tenantId, organizationId: org.id, name: "Rau Works, Indore" } });
    const role = await tx.role.create({ data: { tenantId, name: "Owner" } });

    const entities = entitiesOf(inventory, manufacturing, location, hr, accounting);
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

  // Orders as the jobs the business runs. References carry the customer, since the project
  // capability (clients/dsew/phase-plan.md, Phase 2) is what will own that link.
  const jobs = [
    { bom: bom500.id, qty: 1, ref: "DSEW-J-0412 | Dept of Physics, IIT Indore | 500 kVA step-down", route: trafoRoute.id, done: 6, run: true },
    { bom: bom100.id, qty: 2, ref: "DSEW-J-0415 | Rau Textiles Ltd | 100 kVA, 2 units", route: trafoRoute.id, done: 3, run: true },
    { bom: bomMagnet.id, qty: 1, ref: "DSEW-J-0418 | RRCAT-style calibration lab | 0.5 T electromagnet", route: magnetRoute.id, done: 2, run: true },
    { bom: bom100.id, qty: 1, ref: "DSEW-J-0421 | Pithampur Auto Components | 100 kVA", route: trafoRoute.id, done: 0, run: true },
    { bom: bom500.id, qty: 1, ref: "DSEW-J-0424 | MP Power Transmission Co | 500 kVA (quote approved)", route: trafoRoute.id, done: 0, run: false },
  ];

  for (const job of jobs) {
    const order = await executeCommand(owner, createOrderFromBom, {
      bomId: job.bom,
      locationId,
      outputQty: job.qty,
      reference: job.ref,
    });
    await executeCommand(owner, planOperations, { orderId: order.id, routeId: job.route });
    if (!job.run) continue;
    await executeCommand(owner, manufacturing.startManufacturingOrder, { orderId: order.id });
    if (job.done > 0) {
      const ops = await withTenant(tenantId, (tx) =>
        tx.manufacturingOperation.findMany({ where: { orderId: order.id }, orderBy: { sequence: "asc" } }),
      );
      for (const op of ops.slice(0, job.done)) {
        // A stage with QC checkpoints cannot be completed without findings; leave those open.
        if (Array.isArray(op.checkpoints) && op.checkpoints.length > 0) break;
        await executeCommand(owner, startOperation, { operationId: op.id });
        await executeCommand(owner, completeOperation, { operationId: op.id });
      }
    }
  }

  console.log("\nD & S Electric Works demo tenant is ready.\n");
  console.log(`Tenant:   ${tenantId}`);
  console.log(`Owner:    ${OWNER_EMAIL} (IdP sub ${OWNER_SUB})`);
  console.log(`Items:    ${ITEMS.length}, routes: 2, BOMs: 3, jobs: ${jobs.length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await admin.$disconnect();
  });
