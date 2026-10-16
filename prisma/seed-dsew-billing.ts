/**
 * Records the invoices and receipts seed-dsew.ts now creates, on the existing D & S Electric Works demo
 * tenant that was seeded before billing existed, so Summary's "Money to collect", each job's billing and
 * the ledger from seed-dsew-ledger.ts all agree. Synthetic data only.
 *
 * Posts through the real project commands as the tenant's Owner. Idempotent: does nothing when the tenant
 * already has any invoice. Touches ONLY a tenant flagged `customFields.demoFor = "dsew"`.
 *
 *   npm run seed:dsew-billing
 */
import { PrismaClient } from "@prisma/client";
import { installCapabilities } from "../src/server/capabilities/registry";
import { executeCommand as rawExecute, type ActorContext } from "../src/server/platform/command";
import * as project from "../src/server/capabilities/project";
import * as accounting from "../src/server/capabilities/accounting";

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });

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

/** Per customer: the invoices raised and what was received, as in seed-dsew.ts (amounts in rupees). */
const PLAN: Array<{
  match: string;
  invoices: Array<{ key: string; kind: "advance" | "progress" | "final"; no: number; ago: number; amount: number; tax: number }>;
  receipts: Array<{ invoice: string; ago: number; amount: number; method: "bank" | "cheque" | "upi"; reference: string }>;
}> = [
  { match: "IIT Indore", invoices: [{ key: "a", kind: "advance", no: 41, ago: 22, amount: 575_000, tax: 103_500 }], receipts: [{ invoice: "a", ago: 18, amount: 678_500, method: "bank", reference: "NEFT IITI/0910" }] },
  { match: "Rau Textiles", invoices: [{ key: "a", kind: "advance", no: 44, ago: 12, amount: 300_000, tax: 54_000 }], receipts: [{ invoice: "a", ago: 8, amount: 200_000, method: "bank", reference: "NEFT RAU/4471" }] },
  { match: "Metrology", invoices: [{ key: "a", kind: "advance", no: 46, ago: 14, amount: 256_000, tax: 46_080 }], receipts: [{ invoice: "a", ago: 11, amount: 302_080, method: "cheque", reference: "Cheque 004512" }] },
  { match: "Pithampur", invoices: [{ key: "a", kind: "advance", no: 49, ago: 3, amount: 155_000, tax: 27_900 }], receipts: [] },
  {
    match: "Sunrise",
    invoices: [
      { key: "a", kind: "advance", no: 33, ago: 38, amount: 160_000, tax: 28_800 },
      { key: "f", kind: "final", no: 38, ago: 10, amount: 160_000, tax: 28_800 },
    ],
    receipts: [
      { invoice: "a", ago: 35, amount: 188_800, method: "bank", reference: "NEFT SUN/2210" },
      { invoice: "f", ago: 4, amount: 188_800, method: "upi", reference: "UPI 5821993" },
    ],
  },
];

async function main() {
  installCapabilities();
  const tenants = await admin.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM public.tenant WHERE custom_fields->>'demoFor' = 'dsew'`;
  if (tenants.length !== 1) throw new Error(`expected exactly one DSEW demo tenant, found ${tenants.length}`);
  const tenantId = tenants[0]!.id;

  const { owner, jobs, invoices } = await withTenant(tenantId, async (tx) => {
    const membership = await tx.tenantMembership.findFirst({
      where: { tenantId, role: { name: "Owner", permissions: { some: { entity: accounting.ENTITY_ACCOUNT, verb: "Create" } } } },
      include: { role: true },
    });
    if (!membership || !membership.role) throw new Error("no Owner membership in the DSEW tenant");
    const actor: ActorContext = {
      tenantId,
      userId: membership.userId,
      membershipId: membership.id,
      organizationId: membership.organizationId,
      roleId: membership.role.id,
    };
    // A tenant seeded before billing existed has no grants on the invoice and receipt entities; a fresh
    // seed gives the owner every entity, so the demo Owner gets the same here (skipDuplicates keeps it idempotent).
    await tx.permission.createMany({
      data: [project.ENTITY_PROJECT_INVOICE, project.ENTITY_PROJECT_RECEIPT].flatMap((entity) =>
        (["Read", "Create", "Edit", "ActionExecute"] as const).map((verb) => ({
          tenantId, roleId: membership.role!.id, verb, entity, scope: "Tenant" as const,
        })),
      ),
      skipDuplicates: true,
    });
    return {
      owner: actor,
      jobs: await tx.projectJob.findMany({ select: { id: true, customerName: true } }),
      invoices: await tx.projectInvoice.count(),
    };
  });
  if (invoices > 0) {
    console.log(`Tenant already has ${invoices} invoices; nothing recorded.`);
    return;
  }

  let recorded = 0;
  for (const entry of PLAN) {
    const job = jobs.find((j) => j.customerName.includes(entry.match));
    if (!job) {
      console.log(`No job for "${entry.match}"; skipped.`);
      continue;
    }
    const ids = new Map<string, string>();
    for (const inv of entry.invoices) {
      const created = await executeCommand(owner, project.recordInvoice, {
        jobId: job.id,
        kind: inv.kind,
        number: `DSEW/26-27/${String(inv.no).padStart(3, "0")}`,
        issuedOn: day(-inv.ago),
        amountMinor: inv.amount * 100,
        taxMinor: inv.tax * 100,
      });
      ids.set(inv.key, created.id);
      recorded += 1;
    }
    for (const rec of entry.receipts) {
      await executeCommand(owner, project.recordReceipt, {
        jobId: job.id,
        invoiceId: ids.get(rec.invoice)!,
        receivedOn: day(-rec.ago),
        amountMinor: rec.amount * 100,
        method: rec.method,
        reference: rec.reference,
      });
    }
  }
  console.log(`Recorded ${recorded} invoices with their receipts for tenant ${tenantId}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await admin.$disconnect();
  });
