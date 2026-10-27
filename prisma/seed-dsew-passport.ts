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
import { asMigrationRoleInTenant } from "./migration-role";

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

/** Instrument readings for the measured checks, by checkpoint key: numeric, in the check's own unit (same figures as the hero journey). */
const READINGS: Record<string, { value: number; condition: string; instrument: string }> = {
  ratio_test: { value: 0.21, condition: "all taps, 11 kV to 415 V", instrument: "TTR meter" },
  ir_test: { value: 2400, condition: "HV to LV and earth, 60 s, after drying", instrument: "5 kV megger" },
  hv_withstand: { value: 28, condition: "applied 60 s, no breakdown", instrument: "HV test set" },
  noload_loss: { value: 312, condition: "at rated voltage", instrument: "Power analyser" },
  load_loss: { value: 1560, condition: "at 120 °C reference", instrument: "Power analyser" },
  temp_rise: { value: 82, condition: "at rated load, class F winding", instrument: "Winding RTD" },
};

async function main() {
  installCapabilities();
  const tenants = await admin.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM public.tenant WHERE custom_fields->>'demoFor' = 'dsew'`;
  if (tenants.length !== 1) throw new Error(`expected exactly one DSEW demo tenant, found ${tenants.length}`);
  const tenantId = tenants[0]!.id;

  const setup = await asMigrationRoleInTenant(admin, tenantId, async (tx) => {
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

  const ops = await asMigrationRoleInTenant(admin, tenantId, (tx) =>
    tx.manufacturingOperation.findMany({ where: { orderId: order.id, state: { not: "cancelled" } }, orderBy: { sequence: "asc" } }),
  );
  for (const op of ops) {
    await executeCommand(owner, startOperation, { operationId: op.id });
    const checkpoints = (Array.isArray(op.checkpoints) ? op.checkpoints : []) as Array<{
      key: string;
      label: string;
      requireEvidence?: boolean;
      requireRemarks?: boolean;
      measure?: { unit: string };
    }>;
    for (const cp of checkpoints) {
      let evidenceId: string | undefined;
      if (cp.measure) {
        // A measured check wants a numeric Reading in its own unit, and a photo record of the instrument where it asks for one.
        const r = READINGS[cp.key] ?? { value: 0, condition: "demo", instrument: "demo" };
        const reading = await asMigrationRoleInTenant(admin, tenantId, async (tx) => {
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
        evidenceId = reading.id;
      } else if (cp.requireEvidence) {
        const evidence = await asMigrationRoleInTenant(admin, tenantId, (tx) =>
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
