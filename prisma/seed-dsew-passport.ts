/**
 * Gives the D & S Electric Works demo tenant one finished, fully inspected production order and a published
 * verification passport for it, so the customer-facing QR page can be shown live. Synthetic data only.
 *
 * It drives the real commands end to end: create the order from the 100 kVA bill of materials, plan the
 * cast-resin route, run every stage, pass every test checkpoint, complete the order, then issue the passport.
 * Checks that require evidence get a synthetic instrument reading (kind "Reading"), not an invented photo.
 *
 * Idempotent: does nothing when the order already exists. Touches ONLY a tenant flagged demoFor = "dsew".
 * The passport link is shown once, at the end, and is not stored anywhere.
 *
 *   npm run seed:dsew-passport
 */
import { PrismaClient } from "@prisma/client";
import { installCapabilities } from "../src/server/capabilities/registry";
import { executeCommand as rawExecute, type ActorContext } from "../src/server/platform/command";
import * as manufacturing from "../src/server/capabilities/manufacturing";
import * as accounting from "../src/server/capabilities/accounting";
import { createOrderFromBom } from "../src/server/capabilities/manufacturing/bom";
import {
  completeOperation,
  planOperations,
  recordCheckpoint,
  startOperation,
} from "../src/server/capabilities/manufacturing/stages";
import { issuePassport } from "../src/server/capabilities/manufacturing/passport";

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
const REFERENCE = "DSEW 100 kVA | Sunrise Telecom (delivered)";

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

/** Instrument readings for the checks that require evidence, by checkpoint key. */
const READINGS: Record<string, Record<string, unknown>> = {
  ir_test: { instrument: "5 kV megger", reading: "2,400 MΩ", note: "HV to LV and to earth, 60 s" },
  hv_withstand: { instrument: "HV test set", reading: "28 kV applied for 60 s; 2x rated induced, no breakdown" },
  uniformity: { instrument: "3-axis gaussmeter", reading: "within specification" },
};

async function main() {
  installCapabilities();
  const tenants = await admin.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM public.tenant WHERE custom_fields->>'demoFor' = 'dsew'`;
  if (tenants.length !== 1) throw new Error(`expected exactly one DSEW demo tenant, found ${tenants.length}`);
  const tenantId = tenants[0]!.id;

  const setup = await withTenant(tenantId, async (tx) => {
    const membership = await tx.tenantMembership.findFirst({
      where: { tenantId, role: { name: "Owner", permissions: { some: { entity: accounting.ENTITY_ACCOUNT, verb: "Create" } } } },
      include: { role: true },
    });
    if (!membership?.role) throw new Error("no Owner membership in the DSEW tenant");
    const bom = await tx.manufacturingBom.findFirst({ where: { tenantId, code: "TR-100K-R1" } });
    const route = await tx.manufacturingRoute.findFirst({ where: { tenantId, code: "DRY-TRAFO" } });
    const location = await tx.location.findFirst({ where: { tenantId, active: true } });
    const existing = await tx.manufacturingOrder.count({ where: { tenantId, reference: REFERENCE } });
    if (!bom || !route || !location) throw new Error("the 100 kVA BOM, the DRY-TRAFO route or a location is missing");
    const actor: ActorContext = {
      tenantId,
      userId: membership.userId,
      membershipId: membership.id,
      organizationId: membership.organizationId,
      roleId: membership.role.id,
    };
    return { actor, bomId: bom.id, routeId: route.id, locationId: location.id, existing };
  });
  if (setup.existing > 0) {
    console.log("The delivered demo order already exists; nothing done.");
    return;
  }
  const owner = setup.actor;

  const order = await executeCommand(owner, createOrderFromBom, {
    bomId: setup.bomId,
    locationId: setup.locationId,
    outputQty: 1,
    reference: REFERENCE,
  });
  await executeCommand(owner, planOperations, { orderId: order.id, routeId: setup.routeId });
  await executeCommand(owner, manufacturing.startManufacturingOrder, { orderId: order.id });

  const ops = await withTenant(tenantId, (tx) =>
    tx.manufacturingOperation.findMany({ where: { orderId: order.id, state: { not: "cancelled" } }, orderBy: { sequence: "asc" } }),
  );
  for (const op of ops) {
    await executeCommand(owner, startOperation, { operationId: op.id });
    const checkpoints = (Array.isArray(op.checkpoints) ? op.checkpoints : []) as Array<{
      key: string;
      label: string;
      requireEvidence?: boolean;
      requireRemarks?: boolean;
    }>;
    for (const cp of checkpoints) {
      let evidenceId: string | undefined;
      if (cp.requireEvidence) {
        const evidence = await withTenant(tenantId, (tx) =>
          tx.evidence.create({
            data: {
              tenantId,
              entityKey: manufacturing.ENTITY_MANUFACTURING_OPERATION,
              entityId: op.id,
              kind: "Reading",
              capturedAt: new Date(),
              capturedById: owner.userId,
              payload: (READINGS[cp.key] ?? { reading: "recorded" }) as never,
            },
          }),
        );
        evidenceId = evidence.id;
      }
      await executeCommand(owner, recordCheckpoint, {
        operationId: op.id,
        checkpointKey: cp.key,
        result: "pass",
        remarks: cp.requireRemarks ? "Within limits at rated load, recorded on the test sheet." : undefined,
        evidenceId,
      });
    }
    await executeCommand(owner, completeOperation, { operationId: op.id });
  }
  await executeCommand(owner, manufacturing.completeManufacturingOrder, { orderId: order.id });
  const passport = await executeCommand(owner, issuePassport, { orderId: order.id, reference: "DSEW-100K-0426" });
  console.log(`Finished order ${order.id} and published its passport.`);
  console.log(`Passport path (shown once): /verify/${passport.token}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await admin.$disconnect();
  });
