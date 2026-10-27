/**
 * Gives the existing D & S Electric Works demo tenant a chart of accounts and a ledger that agrees with
 * the billing already seeded by seed-dsew.ts (the same invoice and receipt amounts), so Accounting,
 * the trial balance and the statements are not empty in a demo. Synthetic data only.
 *
 * Posts through the real accounting commands as the tenant's Owner. Idempotent: an account code that
 * exists is reused, and entries are posted only when the tenant has no journal entries yet.
 * Touches ONLY a tenant flagged `customFields.demoFor = "dsew"`.
 *
 *   npm run seed:dsew-ledger
 */
import { PrismaClient } from "@prisma/client";
import { installCapabilities } from "../src/server/capabilities/registry";
import { executeCommand as rawExecute, type ActorContext } from "../src/server/platform/command";
import * as accounting from "../src/server/capabilities/accounting";
import { asMigrationRoleInTenant } from "./migration-role";

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

const CHART = [
  { code: "1000", name: "Bank, current account", type: "Asset" },
  { code: "1100", name: "Trade receivables", type: "Asset" },
  { code: "1200", name: "Inventory, raw material and components", type: "Asset" },
  { code: "2000", name: "Trade payables", type: "Liability" },
  { code: "2100", name: "GST output payable", type: "Liability" },
  { code: "3000", name: "Owner's capital", type: "Equity" },
  { code: "4000", name: "Sales, transformers and electromagnets", type: "Income" },
  { code: "5000", name: "Cost of materials consumed", type: "Expense" },
] as const;

const rupees = (n: number) => n * 100;

/** Invoices as seeded in seed-dsew.ts: [number, taxable amount, GST]. */
const INVOICES: Array<[string, number, number]> = [
  ["DSEW/26-27/041", 575_000, 103_500],
  ["DSEW/26-27/044", 300_000, 54_000],
  ["DSEW/26-27/046", 256_000, 46_080],
  ["DSEW/26-27/049", 155_000, 27_900],
  ["DSEW/26-27/033", 160_000, 28_800],
  ["DSEW/26-27/038", 160_000, 28_800],
];
/** Receipts as seeded: reference and amount received. */
const RECEIPTS: Array<[string, number]> = [
  ["NEFT IITI/0910", 678_500],
  ["NEFT RAU/4471", 200_000],
  ["Cheque 004512", 302_080],
  ["NEFT SUN/2210", 188_800],
  ["UPI 5821993", 188_800],
];

async function main() {
  installCapabilities();
  const tenants = await admin.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM public.tenant WHERE custom_fields->>'demoFor' = 'dsew'`;
  if (tenants.length !== 1) throw new Error(`expected exactly one DSEW demo tenant, found ${tenants.length}`);
  const tenantId = tenants[0]!.id;

  const owner = await asMigrationRoleInTenant(admin, tenantId, async (tx) => {
    // More than one "Owner" role can exist in a tenant; the right one is the one a member holds
    // and that carries the accounting grant.
    const membership = await tx.tenantMembership.findFirst({
      where: { tenantId, role: { name: "Owner", permissions: { some: { entity: accounting.ENTITY_ACCOUNT, verb: "Create" } } } },
      include: { role: true },
    });
    if (!membership || !membership.role) throw new Error("no Owner membership with accounting access in the DSEW tenant");
    const role = membership.role;
    const actor: ActorContext = {
      tenantId,
      userId: membership.userId,
      membershipId: membership.id,
      organizationId: membership.organizationId,
      roleId: role.id,
    };
    return actor;
  });

  const existing = await asMigrationRoleInTenant(admin, tenantId, (tx) => tx.account.findMany({ select: { id: true, code: true } }));
  const byCode = new Map(existing.map((a) => [a.code, a.id]));
  for (const account of CHART) {
    if (byCode.has(account.code)) continue;
    const created = await executeCommand(owner, accounting.createAccount, account);
    byCode.set(account.code, created.id);
  }
  const acct = (code: string) => byCode.get(code)!;

  const entries = await asMigrationRoleInTenant(admin, tenantId, (tx) => tx.journalEntry.count());
  if (entries > 0) {
    console.log(`Ledger already has ${entries} entries; accounts ensured, nothing posted.`);
    return;
  }

  const post = (memo: string, lines: Array<{ code: string; debit?: number; credit?: number }>) =>
    executeCommand(owner, accounting.postJournalEntry, {
      memo,
      lines: lines.map((l) => ({ accountId: acct(l.code), debitMinor: rupees(l.debit ?? 0), creditMinor: rupees(l.credit ?? 0) })),
    });

  await post("Opening capital introduced by the owners", [{ code: "1000", debit: 3_000_000 }, { code: "3000", credit: 3_000_000 }]);
  await post("Opening raw material and components, part paid", [
    { code: "1200", debit: 2_415_990 },
    { code: "1000", credit: 1_200_000 },
    { code: "2000", credit: 1_215_990 },
  ]);
  for (const [number, amount, tax] of INVOICES) {
    await post(`Invoice ${number}`, [
      { code: "1100", debit: amount + tax },
      { code: "4000", credit: amount },
      { code: "2100", credit: tax },
    ]);
  }
  for (const [reference, amount] of RECEIPTS) {
    await post(`Receipt ${reference}`, [{ code: "1000", debit: amount }, { code: "1100", credit: amount }]);
  }
  console.log(`Posted ${2 + INVOICES.length + RECEIPTS.length} entries across ${CHART.length} accounts for tenant ${tenantId}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await admin.$disconnect();
  });
