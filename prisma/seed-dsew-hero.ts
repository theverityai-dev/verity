/**
 * Adds the "hero" journey to the D & S Electric Works demo tenant: one job that runs from enquiry to a delivered,
 * invoiced and paid order, plus one job that is running late. It uses only existing commands, so every record
 * is one the product really produces: two quote revisions, an approved quote, a production order made from the
 * 100 kVA bill of materials, every stage run with its inspection checks, a published verification passport, a
 * dispatch with its packing photograph record, a recorded delivery, tasks, milestones, time, costs and billing.
 *
 * EVERY customer, order, price, reading and date here is fictional demo data. Nothing is a real DSEW order and the
 * 100 kVA specification is illustrative until DSEW confirms its own. The readings are typed text on a Reading
 * evidence row, not measurements; the packing "photo" is a record that points at no image.
 *
 * Idempotent: does nothing when the hero job already exists. Touches ONLY the tenant flagged demoFor = "dsew".
 *
 *   npm run seed:dsew-hero
 */
import { PrismaClient } from "@prisma/client";
import { installCapabilities } from "../src/server/capabilities/registry";
import { activateCapability, invalidateCapabilityCache } from "../src/server/platform/capability";
import { ENTITY_EVIDENCE, EVIDENCE_CAPABILITY } from "../src/server/capabilities/evidence";
import { executeCommand as rawExecute, type ActorContext } from "../src/server/platform/command";
import * as manufacturing from "../src/server/capabilities/manufacturing";
import * as project from "../src/server/capabilities/project";
import * as trading from "../src/server/capabilities/trading/orders";
import { gstinCheckDigit } from "../src/server/capabilities/trading/keys";
import { createOrderFromBom } from "../src/server/capabilities/manufacturing/bom";
import { completeOperation, planOperations, recordCheckpoint, startOperation } from "../src/server/capabilities/manufacturing/stages";
import { issuePassport } from "../src/server/capabilities/manufacturing/passport";
import { confirmDelivery, dispatchOrder } from "../src/server/capabilities/manufacturing/logistics";

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
const HERO_TITLE = "100 kVA cast resin dry-type transformer, 11 kV / 415 V (hero journey)";
const HERO_CUSTOMER = "Malwa Cement Works (demo)";
const LATE_TITLE = "Helmholtz coil pair with regulated current supply";
const ORDER_REF = "DSEW 100 kVA | Malwa Cement (delivered, demo)";

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
const line = (description: string, qty: number, rupees: number) => ({ description, qty, unitPriceMinor: rupees * 100 });
const RATE = { winder: 45_000, engineer: 60_000, helper: 35_000 };

/** Typed instrument readings for the checks that need evidence, by checkpoint key. Fictional demo values. */
const READINGS: Record<string, { value: number; condition: string; instrument: string }> = {
  ratio_test: { value: 0.21, condition: "all taps, 11 kV to 415 V", instrument: "TTR meter" },
  ir_test: { value: 2400, condition: "HV to LV and earth, 60 s, after drying", instrument: "5 kV megger" },
  hv_withstand: { value: 28, condition: "applied 60 s, no breakdown", instrument: "HV test set" },
  noload_loss: { value: 312, condition: "at rated voltage", instrument: "Power analyser" },
  load_loss: { value: 1560, condition: "at 120 °C reference", instrument: "Power analyser" },
  temp_rise: { value: 82, condition: "at rated load, class F winding", instrument: "Winding RTD" },
};
/** The first insulation test fails before the coils are dried; the retest passes. A re-inspection the report shows. */
const FIRST_IR = { value: 640, condition: "HV to LV and earth, 60 s, before drying", instrument: "5 kV megger" };
const REMARKS: Record<string, string> = {
  ir_test: "Low reading: moisture in the coil. Dried and re-tested (demo).",
};

async function main() {
  installCapabilities();
  const tenants = await admin.$queryRaw<Array<{ id: string }>>`SELECT id FROM public.tenant WHERE custom_fields->>'demoFor' = 'dsew'`;
  if (tenants.length !== 1) throw new Error(`expected exactly one DSEW demo tenant, found ${tenants.length}`);
  const tenantId = tenants[0]!.id;

  const setup = await withTenant(tenantId, async (tx) => {
    const membership = await tx.tenantMembership.findFirst({
      where: { tenantId, role: { name: "Owner" } },
      include: { role: true },
    });
    if (!membership?.role) throw new Error("no Owner membership in the DSEW tenant");
    const bom = await tx.manufacturingBom.findFirst({ where: { tenantId, code: "TR-100K-R1" } });
    const route = await tx.manufacturingRoute.findFirst({ where: { tenantId, code: "DRY-TRAFO" } });
    const location = await tx.location.findFirst({ where: { tenantId, active: true } });
    const existing = await tx.projectJob.count({ where: { tenantId, title: HERO_TITLE } });
    const iit = await tx.tradingCustomer.findFirst({ where: { tenantId, displayName: { startsWith: "Dept of Physics" } } });
    if (!bom || !route || !location || !iit) throw new Error("the 100 kVA BOM, the DRY-TRAFO route, a location or the IIT customer is missing; run seed:dsew first");
    const actor: ActorContext = {
      tenantId,
      userId: membership.userId,
      membershipId: membership.id,
      organizationId: membership.organizationId,
      roleId: membership.role.id,
    };
    return { actor, bomId: bom.id, routeId: route.id, locationId: location.id, existing, iitId: iit.id };
  });
  // Evidence is a capability of its own. A checkpoint that requires a reading or photo cannot be completed without
  // it, and a role that cannot read Evidence cannot see the readings. Activate it for the demo tenant and let the
  // Owner use it, as a real DSEW setup would. Idempotent.
  await withTenant(tenantId, async (tx) => {
    await activateCapability(tx as never, tenantId, EVIDENCE_CAPABILITY);
    for (const verb of ["Read", "Create", "Edit", "ActionExecute"] as const) {
      const has = await tx.permission.findFirst({ where: { tenantId, roleId: setup.actor.roleId, verb, entity: ENTITY_EVIDENCE } });
      if (!has) await tx.permission.create({ data: { tenantId, roleId: setup.actor.roleId, verb, entity: ENTITY_EVIDENCE, scope: "Tenant" } });
    }
  });
  invalidateCapabilityCache();

  if (setup.existing > 0) {
    console.log("The hero journey already exists; nothing done (Evidence is active for the demo tenant).");
    return;
  }
  const owner = setup.actor;

  // The customer, with a GSTIN whose check digit is real so the platform's own validation accepts it.
  const body = `23AABCM9876K1Z`;
  const customer = await executeCommand(owner, trading.createCustomer, {
    displayName: HERO_CUSTOMER, gstin: body + gstinCheckDigit(body), phone: "98260 12345", email: "stores@malwacement.example", stateCode: "23",
  });

  // 1. Enquiry, two quote revisions after negotiation, approval.
  const job = await executeCommand(owner, project.createJob, {
    title: HERO_TITLE,
    customerId: customer.id,
    customerContact: "Mr. Dubey, Plant Electrical (demo)",
    description: "Illustrative job for the demo. Dyn11, IP21 enclosure, routine tests with a test sheet. Not a real order.",
    priority: "high",
    dueDate: day(0),
  });
  const scope = "Ex-works Rau, Indore. 12 months warranty. 50% advance, balance before dispatch. GST extra. (Demo terms.)";
  await executeCommand(owner, project.addQuoteRevision, { jobId: job.id, lines: [line("100 kVA cast resin dry-type transformer, 11 kV / 415 V", 1, 325_000), line("Routine tests with test sheet", 1, 12_000)], validUntil: day(-40), scopeNote: scope });
  const quote2 = await executeCommand(owner, project.addQuoteRevision, { jobId: job.id, lines: [line("100 kVA cast resin dry-type transformer, 11 kV / 415 V", 1, 310_000), line("Routine tests with test sheet", 1, 12_000)], validUntil: day(-30), scopeNote: scope });
  await executeCommand(owner, project.approveQuote, { quoteId: quote2.id });

  // 2. Production: order from the BOM, planned on the route, started (materials consumed), every stage run.
  const order = await executeCommand(owner, createOrderFromBom, { bomId: setup.bomId, locationId: setup.locationId, outputQty: 1, reference: ORDER_REF });
  await executeCommand(owner, planOperations, { orderId: order.id, routeId: setup.routeId });
  await executeCommand(owner, manufacturing.startManufacturingOrder, { orderId: order.id });
  await executeCommand(owner, project.linkOrder, { jobId: job.id, orderId: order.id });
  await executeCommand(owner, project.startJob, { jobId: job.id });

  const ops = await withTenant(tenantId, (tx) =>
    tx.manufacturingOperation.findMany({ where: { orderId: order.id, state: { not: "cancelled" } }, orderBy: { sequence: "asc" } }),
  );
  for (const op of ops) {
    await executeCommand(owner, startOperation, { operationId: op.id });
    const checkpoints = (Array.isArray(op.checkpoints) ? op.checkpoints : []) as Array<{
      key: string;
      requireEvidence?: boolean;
      requireRemarks?: boolean;
      measure?: { unit: string };
    }>;
    /** A reading as Evidence about this operation, with a photo record of the instrument where the check asks for one. */
    const captureReading = (cp: (typeof checkpoints)[number], r: { value: number; condition: string; instrument: string }) =>
      withTenant(tenantId, async (tx) => {
        const photo = cp.requireEvidence
          ? await tx.evidence.create({
              data: {
                tenantId, entityKey: manufacturing.ENTITY_MANUFACTURING_OPERATION, entityId: op.id, kind: "Photo",
                uri: "demo://instrument-photo", capturedAt: new Date(), capturedById: owner.userId,
              },
            })
          : null;
        return tx.evidence.create({
          data: {
            tenantId, entityKey: manufacturing.ENTITY_MANUFACTURING_OPERATION, entityId: op.id, kind: "Reading",
            capturedAt: new Date(), capturedById: owner.userId,
            payload: { value: r.value, unit: cp.measure!.unit, condition: r.condition, instrument: r.instrument, ...(photo ? { photoEvidenceId: photo.id } : {}) } as never,
          },
        });
      });
    for (const cp of checkpoints) {
      if (cp.key === "ir_test") {
        const first = await captureReading(cp, FIRST_IR);
        await executeCommand(owner, recordCheckpoint, { operationId: op.id, checkpointKey: cp.key, result: "fail", remarks: REMARKS.ir_test, evidenceId: first.id });
      }
      let evidenceId: string | undefined;
      if (cp.measure) {
        evidenceId = (await captureReading(cp, READINGS[cp.key] ?? { value: 0, condition: "demo", instrument: "demo" })).id;
      } else if (cp.requireEvidence) {
        const evidence = await withTenant(tenantId, (tx) =>
          tx.evidence.create({
            data: {
              tenantId, entityKey: manufacturing.ENTITY_MANUFACTURING_OPERATION, entityId: op.id, kind: "Photo",
              uri: "demo://photo", capturedAt: new Date(), capturedById: owner.userId,
            },
          }),
        );
        evidenceId = evidence.id;
      }
      await executeCommand(owner, recordCheckpoint, {
        operationId: op.id,
        checkpointKey: cp.key,
        result: "pass",
        remarks: cp.requireRemarks ? "Recorded on the test sheet (demo)." : undefined,
        evidenceId,
      });
    }
    await executeCommand(owner, completeOperation, { operationId: op.id });
  }
  await executeCommand(owner, manufacturing.completeManufacturingOrder, { orderId: order.id });

  // Spread the stage times over the build so the traveler reads like a real week of work. Stages are a plain
  // table (only the checkpoint results are append-only), so this changes timestamps, not facts.
  try {
    await withTenant(tenantId, async (tx) => {
      for (const [i, op] of ops.entries()) {
        const started = new Date(Date.now() - (22 - i * 4) * 86_400_000);
        const completed = new Date(started.getTime() + 3 * 86_400_000);
        await tx.manufacturingOperation.update({ where: { id: op.id }, data: { startedAt: started, completedAt: completed } });
      }
    });
  } catch (error) {
    console.warn("Could not spread the stage times; they keep the seed run's time.", (error as Error).message);
  }

  // 3. Passport and dispatch. The packing photograph is a record that points at no image.
  await executeCommand(owner, issuePassport, { orderId: order.id, reference: "DSEW-100K-DEMO-0001" });
  const photo = await withTenant(tenantId, (tx) =>
    tx.evidence.create({
      data: {
        tenantId,
        entityKey: manufacturing.ENTITY_MANUFACTURING_ORDER,
        entityId: order.id,
        kind: "Photo",
        uri: "demo://no-image-packing-record",
        capturedAt: new Date(),
        capturedById: owner.userId,
        payload: { demo: true, note: "Demo record: no photograph exists." } as never,
      },
    }),
  );
  await executeCommand(owner, dispatchOrder, {
    orderId: order.id,
    transporter: "Malwa Transport (demo)",
    vehicleNo: "MP 09 GA 4821",
    trackingRef: "LR 20417",
    packagingEvidenceId: photo.id,
    note: "One crate, strapped and shrink-wrapped. Demo record.",
  });
  await executeCommand(owner, confirmDelivery, { orderId: order.id, note: "Received at plant stores, signed by Mr. Dubey (demo)." });

  // 4. The job's own work: tasks, milestones, time, costs, billing, then completion.
  const task = (title: string, extra: Record<string, unknown> = {}) => executeCommand(owner, project.createTask, { jobId: job.id, title, ...extra });
  const finish = async (taskId: string) => {
    await executeCommand(owner, project.setTaskState, { taskId, toState: "in_progress" });
    await executeCommand(owner, project.setTaskState, { taskId, toState: "done" });
  };
  const design = await task("Confirm winding data and footprint with the customer", { assigneeLabel: "Engineering", weight: 1 });
  const procure = await task("Receive CRGO, copper and resin", { assigneeLabel: "Stores", weight: 1, dependsOnIds: [design.id] });
  const build = await task("Core, coils, casting and assembly", { assigneeLabel: "Shop floor", weight: 5, dependsOnIds: [procure.id] });
  const test = await task("Routine tests and test sheet", { assigneeLabel: "Quality", weight: 2, dependsOnIds: [build.id] });
  const ship = await task("Pack, dispatch and confirm delivery", { assigneeLabel: "Dispatch", weight: 1, dependsOnIds: [test.id] });
  for (const t of [design, procure, build, test, ship]) await finish(t.id);

  for (const [name, due] of [["Drawings agreed with customer", -38], ["Coils cast and cured", -16], ["Routine tests passed", -8], ["Delivered at Malwa Cement Works", 0]] as const) {
    const m = await executeCommand(owner, project.addMilestone, { jobId: job.id, name, dueDate: day(due) });
    await executeCommand(owner, project.reachMilestone, { milestoneId: m.id });
  }
  const time = (worker: string, ago: number, hours: number, rate: number, note: string, taskId: string) =>
    executeCommand(owner, project.logTime, { jobId: job.id, workerLabel: worker, workDate: day(-ago), minutes: Math.round(hours * 60), hourlyRateMinor: rate, note, taskId });
  await time("R. Verma (engineer)", 36, 6, RATE.engineer, "Winding data and drawing", design.id);
  await time("S. Yadav (winder)", 22, 8, RATE.winder, "LV coil", build.id);
  await time("S. Yadav (winder)", 21, 8, RATE.winder, "HV coil", build.id);
  await time("K. Chouhan (helper)", 18, 7, RATE.helper, "Core stacking and assembly", build.id);
  await time("Quality inspector", 9, 5, RATE.engineer, "Routine tests", test.id);
  await executeCommand(owner, project.addCost, { jobId: job.id, kind: "outsourced", description: "Enclosure fabrication and powder coat", supplierName: "Mehta Tooling, Pithampur (demo)", amountMinor: 3_800_000, incurredOn: day(-26) });
  await executeCommand(owner, project.addCost, { jobId: job.id, kind: "freight", description: "Delivery to the plant", supplierName: "Malwa Transport (demo)", amountMinor: 1_400_000, incurredOn: day(0) });

  const invoice = (kind: "advance" | "final", no: number, ago: number, rupees: number, tax: number) =>
    executeCommand(owner, project.recordInvoice, { jobId: job.id, kind, number: `DSEW/26-27/${String(no).padStart(3, "0")}`, issuedOn: day(-ago), amountMinor: rupees * 100, taxMinor: tax * 100 });
  const receive = (invoiceId: string, ago: number, rupees: number, reference: string) =>
    executeCommand(owner, project.recordReceipt, { jobId: job.id, invoiceId, receivedOn: day(-ago), amountMinor: rupees * 100, method: "bank", reference });
  const advance = await invoice("advance", 61, 40, 161_000, 28_980);
  await receive(advance.id, 37, 189_980, "NEFT MALWA/3318");
  const final = await invoice("final", 63, 1, 161_000, 28_980);
  await receive(final.id, 0, 189_980, "NEFT MALWA/3402");
  await executeCommand(owner, project.completeJob, { jobId: job.id });

  // 5. A job that is running late, so the Summary has a real one to flag. No production order: the point is the
  // promised date has passed and work is blocked on a supplier.
  const lateJob = await executeCommand(owner, project.createJob, {
    title: LATE_TITLE,
    customerId: setup.iitId,
    customerContact: "Prof. Mehta (demo)",
    description: "Illustrative late job: coil winding is waiting on enamelled wire from the supplier.",
    priority: "urgent",
    dueDate: day(-4),
  });
  const lateQuote = await executeCommand(owner, project.addQuoteRevision, { jobId: lateJob.id, lines: [line("Helmholtz coil pair, 300 mm mean diameter, with regulated supply", 1, 540_000)], validUntil: day(20), scopeNote: scope });
  await executeCommand(owner, project.approveQuote, { quoteId: lateQuote.id });
  await executeCommand(owner, project.startJob, { jobId: lateJob.id });
  const wire = await executeCommand(owner, project.createTask, { jobId: lateJob.id, title: "Receive enamelled copper wire", assigneeLabel: "Stores", weight: 1, dueDate: day(-9) });
  await executeCommand(owner, project.setTaskState, { taskId: wire.id, toState: "blocked" });
  await executeCommand(owner, project.createTask, { jobId: lateJob.id, title: "Wind and assemble the coil pair", assigneeLabel: "Shop floor", weight: 4, dueDate: day(-2), dependsOnIds: [wire.id] });
  await executeCommand(owner, project.addMilestone, { jobId: lateJob.id, name: "Coils wound", dueDate: day(-6) });

  console.log(`Hero journey added: job "${HERO_TITLE}", order ${order.id}, and a late job.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await admin.$disconnect();
  });
