import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/platform/db";
import { assertRlsEnforceable, withTenant } from "@/server/platform/tenancy";
import { activateCapability, invalidateCapabilityCache } from "@/server/platform/capability";
import { clearCommands, clearHooks, executeCommand, type ActorContext } from "@/server/platform/command";
import { clearQueries } from "@/server/platform/query";
import { clearScopeResolvers } from "@/server/platform/authorization";
import { clearTransitionGuards } from "@/server/platform/state";
import { clearContributions } from "@/server/platform/contribution";
import { provisionIdentity } from "@/server/platform/identity";
import * as inventory from "@/server/capabilities/inventory";
import * as manufacturing from "@/server/capabilities/manufacturing";
import * as location from "@/server/capabilities/location";
import * as project from "@/server/capabilities/project";

/**
 * Jobs (D & S Electric Works): lifecycle guards, quote snapshotting, task dependencies,
 * and the derived cost and margin. Costs are checked against figures worked out by hand.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;
if (!hasDatabase) {
  const message = "capability-project.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

function entitiesOf(...modules: Array<Record<string, unknown>>): string[] {
  const keys = new Set<string>();
  for (const mod of modules) for (const [n, v] of Object.entries(mod)) if (n.startsWith("ENTITY_") && typeof v === "string") keys.add(v);
  return [...keys];
}

describeDb("capability: Project (Jobs)", () => {
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const created = { users: [] as string[], parties: [] as string[] };
  let locationId: string;
  let actor: ActorContext;
  let copperId: string;
  let transformerId: string;
  let reasonId: string;

  beforeAll(async () => {
    await assertRlsEnforceable();
    clearCommands();
    clearQueries();
    clearHooks();
    clearScopeResolvers();
    clearTransitionGuards();
    clearContributions();
    location.registerLocationCapability();
    inventory.registerInventoryCapability();
    manufacturing.registerManufacturingCapability();
    project.registerProjectCapability();

    await withTenant(otherTenantId, async (tx) => {
      await tx.tenant.create({ data: { id: otherTenantId, name: "Other Works", timeZone: "Asia/Kolkata" } });
    });

    await withTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: "Job Test Works", timeZone: "Asia/Kolkata" } });
      for (const key of [location.LOCATION_CAPABILITY, inventory.INVENTORY_CAPABILITY, manufacturing.MANUFACTURING_CAPABILITY, project.PROJECT_CAPABILITY]) {
        await activateCapability(tx, tenantId, key);
      }
      const organizationId = (await tx.organization.create({ data: { tenantId, name: "Works" } })).id;
      locationId = (await tx.location.create({ data: { tenantId, organizationId, name: "Shop" } })).id;
      const role = await tx.role.create({ data: { tenantId, name: "Manager" }, select: { id: true } });
      await tx.permission.createMany({
        data: entitiesOf(inventory, manufacturing, project).flatMap((entity) =>
          (["Read", "Create", "Edit", "ActionExecute"] as const).map((verb) => ({ tenantId, roleId: role.id, verb, entity, scope: "Tenant" as const })),
        ),
      });
      const identity = await provisionIdentity(tx, { organizationId, authUserId: randomUUID(), displayName: "Job Manager" });
      created.users.push(identity.userId);
      created.parties.push(identity.partyId);
      await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId: role.id } });
      actor = { tenantId, userId: identity.userId, membershipId: identity.membershipId, organizationId, roleId: role.id };
      reasonId = (await tx.projectLostReason.create({ data: { tenantId, key: "price", label: "Price" } })).id;
    });
    invalidateCapabilityCache();

    copperId = (await executeCommand(actor, inventory.createItem, { sku: "CU", name: "Copper", unitLabel: "kg" })).id;
    transformerId = (await executeCommand(actor, inventory.createItem, { sku: "TR", name: "Transformer", unitLabel: "pc" })).id;
    // 100 kg at Rs 500.00/kg = 50000 paise each.
    await executeCommand(actor, inventory.recordStockMovement, { itemId: copperId, locationId, kind: "Receipt", qty: 100, unitCostPaise: 50_000, reference: "opening" });
  });

  afterAll(async () => {
    clearCommands();
    clearQueries();
    clearHooks();
    clearScopeResolvers();
    clearTransitionGuards();
    clearContributions();
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      await admin.$executeRaw`DELETE FROM tenant WHERE id IN (${tenantId}::uuid, ${otherTenantId}::uuid)`;
      for (const id of created.users) await admin.$executeRaw`DELETE FROM "user" WHERE id = ${id}::uuid`;
      for (const id of created.parties) await admin.$executeRaw`DELETE FROM party WHERE id = ${id}::uuid`;
    } finally {
      await admin.$disconnect();
    }
    await prisma.$disconnect();
  });

  const newJob = async (title = "500 kVA cast resin transformer") =>
    executeCommand(actor, project.createJob, { title, customerName: "IIT Indore", dueDate: "2026-12-01" });
  const quote = (jobId: string, unit = 1_000_000) =>
    executeCommand(actor, project.addQuoteRevision, { jobId, lines: [{ description: "Transformer", qty: 2, unitPriceMinor: unit }] });
  const stateOf = (jobId: string) => withTenant(tenantId, (tx) => tx.projectJob.findUniqueOrThrow({ where: { id: jobId } }));

  it("numbers jobs in sequence per tenant", async () => {
    const a = await newJob("First");
    const b = await newJob("Second");
    expect(b.number).toBe(a.number + 1);
    expect(project.jobReference(7)).toBe("J-0007");
  });

  it("walks enquiry -> quoted -> approved -> in progress, snapshotting the approved quote", async () => {
    const job = await newJob();
    expect((await stateOf(job.id)).state).toBe("enquiry");

    const r1 = await quote(job.id, 1_000_000);
    expect(r1.revision).toBe(1);
    expect(r1.amountMinor).toBe(2_000_000);
    expect((await stateOf(job.id)).state).toBe("quoted");

    const r2 = await quote(job.id, 900_000);
    expect(r2.revision).toBe(2);
    const quotes = await withTenant(tenantId, (tx) => tx.projectQuote.findMany({ where: { jobId: job.id }, orderBy: { revision: "asc" } }));
    expect(quotes.map((q) => q.status)).toEqual(["superseded", "open"]);

    // A superseded quote cannot be approved.
    await expect(executeCommand(actor, project.approveQuote, { quoteId: r1.id })).rejects.toThrow(/superseded|open quote/);

    await executeCommand(actor, project.approveQuote, { quoteId: r2.id });
    const approved = await stateOf(job.id);
    expect(approved.state).toBe("approved");
    expect(approved.quotedValueMinor).toBe(1_800_000);

    // Commercial terms are frozen: no new revision after approval.
    await expect(quote(job.id)).rejects.toThrow(/enquiry or quoted/);

    await executeCommand(actor, project.startJob, { jobId: job.id });
    expect((await stateOf(job.id)).state).toBe("in_progress");
    // An undeclared move is refused: in progress cannot be started again.
    await expect(executeCommand(actor, project.startJob, { jobId: job.id })).rejects.toThrow();
  });

  it("closes a lost job with a registry reason and then refuses work on it", async () => {
    const job = await newJob("Lost one");
    await quote(job.id);
    await expect(executeCommand(actor, project.markJobLost, { jobId: job.id, reasonId: randomUUID() })).rejects.toThrow(/lost reason/);
    await executeCommand(actor, project.markJobLost, { jobId: job.id, reasonId, note: "Competitor 8% cheaper" });
    const lost = await stateOf(job.id);
    expect(lost.state).toBe("lost");
    expect(lost.lostReasonId).toBe(reasonId);
    await expect(executeCommand(actor, project.addCost, { jobId: job.id, kind: "freight", description: "Freight to site", amountMinor: 100, incurredOn: "2026-10-01" })).rejects.toThrow(/approved job/);
    await expect(executeCommand(actor, project.editJob, { jobId: job.id, title: "Renamed" })).rejects.toThrow();
  });

  it("holds a task behind its prerequisite, refuses loops, and blocks completion while work is open", async () => {
    const job = await newJob("Tasks");
    const q = await quote(job.id);
    await executeCommand(actor, project.approveQuote, { quoteId: q.id });
    await executeCommand(actor, project.startJob, { jobId: job.id });

    const design = await executeCommand(actor, project.createTask, { jobId: job.id, title: "Design review", weight: 1 });
    const wind = await executeCommand(actor, project.createTask, { jobId: job.id, title: "Wind coils", weight: 3, dependsOnIds: [design.id] });

    await expect(executeCommand(actor, project.setTaskState, { taskId: wind.id, toState: "in_progress" })).rejects.toThrow(/waits for "Design review"/);
    await expect(executeCommand(actor, project.addTaskDependency, { taskId: design.id, dependsOnId: wind.id })).rejects.toThrow(/loop/);

    await expect(executeCommand(actor, project.completeJob, { jobId: job.id })).rejects.toThrow(/task\(s\) are not done/);

    await executeCommand(actor, project.setTaskState, { taskId: design.id, toState: "in_progress" });
    await executeCommand(actor, project.setTaskState, { taskId: design.id, toState: "done" });
    const detail = await withTenant(tenantId, (tx) => project.jobDetail(tx, job.id));
    expect(detail?.progress).toBe(25); // weight 1 of 4

    await executeCommand(actor, project.setTaskState, { taskId: wind.id, toState: "in_progress" });
    await executeCommand(actor, project.setTaskState, { taskId: wind.id, toState: "done" });
    await executeCommand(actor, project.completeJob, { jobId: job.id });
    expect((await stateOf(job.id)).state).toBe("completed");
    // Completed is terminal (INV-002).
    await expect(executeCommand(actor, project.createTask, { jobId: job.id, title: "Late" })).rejects.toThrow(/approved job/);
  });

  it("derives cost and margin from consumed material, logged time and recorded costs", async () => {
    const job = await newJob("Costed");
    const q = await quote(job.id, 1_000_000); // 2 x 10,000.00 = 2,000,000 minor
    await executeCommand(actor, project.approveQuote, { quoteId: q.id });
    await executeCommand(actor, project.startJob, { jobId: job.id });

    const order = await executeCommand(actor, manufacturing.createManufacturingOrder, {
      locationId, outputItemId: transformerId, outputQty: 1, reference: "MO-costed",
      lines: [{ componentItemId: copperId, qtyRequired: 10 }],
    });
    await executeCommand(actor, project.linkOrder, { jobId: job.id, orderId: order.id });
    // The same order cannot belong to two jobs.
    const other = await newJob("Other");
    const oq = await quote(other.id);
    await executeCommand(actor, project.approveQuote, { quoteId: oq.id });
    await expect(executeCommand(actor, project.linkOrder, { jobId: other.id, orderId: order.id })).rejects.toThrow(/already belongs/);

    // Not started yet: nothing consumed, so no material cost.
    let costing = await withTenant(tenantId, (tx) => project.jobCosting(tx, job.id));
    expect(costing.materialMinor).toBe(0);

    await executeCommand(actor, manufacturing.startManufacturingOrder, { orderId: order.id });
    // 10 kg x 50,000 paise.
    costing = await withTenant(tenantId, (tx) => project.jobCosting(tx, job.id));
    expect(costing.materialMinor).toBe(500_000);

    // 90 minutes at 40,000 paise/hour = 60,000.
    const t = await executeCommand(actor, project.logTime, { jobId: job.id, workerLabel: "Ramesh", workDate: "2026-10-10", minutes: 90, hourlyRateMinor: 40_000 });
    const c = await executeCommand(actor, project.addCost, { jobId: job.id, kind: "testing", description: "NABL lab test", supplierName: "TestCo", amountMinor: 150_000, incurredOn: "2026-10-11" });
    costing = await withTenant(tenantId, (tx) => project.jobCosting(tx, job.id));
    expect(costing).toMatchObject({ labourMinor: 60_000, otherMinor: 150_000, totalMinor: 710_000, marginMinor: 1_290_000, marginPercent: 64.5, loggedMinutes: 90 });

    // A wrong entry is voided, not deleted, and drops out of the totals.
    await executeCommand(actor, project.voidCostEntry, { entryId: c.id, reason: "Entered against the wrong job" });
    await executeCommand(actor, project.voidTimeEntry, { entryId: t.id, reason: "Duplicate" });
    costing = await withTenant(tenantId, (tx) => project.jobCosting(tx, job.id));
    expect(costing.totalMinor).toBe(500_000);
    const kept = await withTenant(tenantId, (tx) => tx.projectCostEntry.count({ where: { jobId: job.id } }));
    expect(kept).toBe(1);

    // The job cannot finish while its production order is open.
    await expect(executeCommand(actor, project.completeJob, { jobId: job.id })).rejects.toThrow(/production order/);
  });

  it("keeps one tenant's jobs invisible to another (INV-001)", async () => {
    await newJob("Visible only here");
    const mine = await withTenant(tenantId, (tx) => project.listJobs(tx));
    const theirs = await withTenant(otherTenantId, (tx) => project.listJobs(tx));
    expect(mine.length).toBeGreaterThan(0);
    expect(theirs).toEqual([]);
  });
});
