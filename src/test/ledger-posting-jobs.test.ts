import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/platform/db";
import { assertRlsEnforceable, withTenant } from "@/server/platform/tenancy";
import { activateCapability, invalidateCapabilityCache } from "@/server/platform/capability";
import { clearCommands, clearHooks, executeCommand, type ActorContext } from "@/server/platform/command";
import { clearQueries, executeQuery } from "@/server/platform/query";
import { clearScopeResolvers } from "@/server/platform/authorization";
import { clearTransitionGuards } from "@/server/platform/state";
import { clearContributions } from "@/server/platform/contribution";
import { provisionIdentity } from "@/server/platform/identity";
import { INVENTORY_CAPABILITY } from "@/server/capabilities/inventory";
import { MANUFACTURING_CAPABILITY } from "@/server/capabilities/manufacturing";
import { LOCATION_CAPABILITY } from "@/server/capabilities/location";
import { TRADING_CAPABILITY } from "@/server/capabilities/trading";
import { PROJECT_CAPABILITY, ENTITY_PROJECT_INVOICE, ENTITY_PROJECT_RECEIPT, recordInvoice, recordReceipt, voidInvoice, voidReceipt } from "@/server/capabilities/project";
import { ACCOUNTING_CAPABILITY, ENTITY_ACCOUNT, ENTITY_JOURNAL_ENTRY, createAccount, registerAccountingCapability, trialBalance } from "@/server/capabilities/accounting";
import { postPendingDocuments, postingSetup, setAccountMapping } from "@/server/capabilities/accounting/posting";
import { registerProjectCapability } from "@/server/capabilities/project";
import { registerPlywoodCapability } from "@/server/capabilities/plywood";
import { registerInventoryCapability } from "@/server/capabilities/inventory";
import { registerManufacturingCapability } from "@/server/capabilities/manufacturing";

/**
 * Task 130 / ADR-044: job invoices and receipts (the project capability, DSEW's own billing) post to the ledger, and a void after
 * posting reverses the entry. Real database, runtime role, RLS in force.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  const message = "ledger-posting-jobs.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describeDb("ledger posting: job invoices and receipts", () => {
  const tenantId = randomUUID();
  let actor: ActorContext;
  let jobId: string;
  const ids: Record<string, string> = {};

  const post = () => withTenant(tenantId, (tx) => postPendingDocuments(tx, tenantId));
  const net = async (accountId: string) => {
    const tb = await executeQuery(actor, trialBalance, {});
    const row = tb.find((r) => r.accountId === accountId)!;
    return row.debitMinor - row.creditMinor;
  };
  const entries = (kind: string) =>
    withTenant(tenantId, (tx) => tx.journalEntry.findMany({ where: { sourceKind: kind }, include: { lines: true }, orderBy: { postedAt: "asc" } }));

  beforeAll(async () => {
    await assertRlsEnforceable();
    clearCommands();
    clearQueries();
    clearHooks();
    clearScopeResolvers();
    clearTransitionGuards();
    clearContributions();
    registerPlywoodCapability();
    registerInventoryCapability();
    registerManufacturingCapability();
    registerProjectCapability();
    registerAccountingCapability();

    await withTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: "Job Posting Works", timeZone: "Asia/Kolkata" } });
      for (const capability of [TRADING_CAPABILITY, LOCATION_CAPABILITY, INVENTORY_CAPABILITY, MANUFACTURING_CAPABILITY, PROJECT_CAPABILITY, ACCOUNTING_CAPABILITY]) {
        await activateCapability(tx, tenantId, capability);
      }
      const organizationId = (await tx.organization.create({ data: { tenantId, name: "HQ" } })).id;
      const role = await tx.role.create({ data: { tenantId, name: "Accountant" }, select: { id: true } });
      await tx.permission.createMany({
        data: [ENTITY_PROJECT_INVOICE, ENTITY_PROJECT_RECEIPT, ENTITY_ACCOUNT, ENTITY_JOURNAL_ENTRY, "verity.platform.activity"].flatMap((entity) =>
          (["Read", "Create", "Edit", "ActionExecute"] as const).map((verb) => ({ tenantId, roleId: role.id, verb, entity, scope: "Tenant" as const })),
        ),
      });
      const identity = await provisionIdentity(tx, { organizationId, authUserId: randomUUID(), displayName: "Accountant" });
      await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId: role.id } });
      actor = { tenantId, userId: identity.userId, membershipId: identity.membershipId, organizationId, roleId: role.id };
      jobId = (await tx.projectJob.create({ data: { tenantId, number: 1, title: "11 kV panel", customerName: "Atomic Research Centre", state: "approved" } })).id;
    });
    invalidateCapabilityCache();

    for (const [key, code, name, type] of [
      ["receivable", "1200", "Customers owe us", "Asset"],
      ["cash", "1000", "Cash", "Asset"],
      ["bank", "1100", "Bank", "Asset"],
      ["income", "4000", "Sales", "Income"],
      ["gst", "2200", "GST collected", "Liability"],
    ] as const) {
      ids[key] = (await executeCommand(actor, createAccount, { code, name, type })).id;
    }
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
      await admin.$executeRaw`DELETE FROM tenant WHERE id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM "user" WHERE id NOT IN (SELECT user_id FROM tenant_membership)`;
      await admin.$executeRaw`DELETE FROM party WHERE id NOT IN (SELECT party_id FROM "user")`;
    } finally {
      await admin.$disconnect();
    }
    await prisma.$disconnect();
  });

  it("waits, with the reason, until the accounts are mapped; nothing posts to a guess", async () => {
    ids.invoice = (await executeCommand(actor, recordInvoice, { jobId, kind: "advance", number: "DS/001", issuedOn: "2026-10-01", amountMinor: 1_000_000, taxMinor: 180_000 })).id;
    expect(await post()).toEqual({ posted: 0, pending: 1, alreadyPosted: 0 });
    expect(await entries("project.invoice")).toEqual([]);
    const setup = await executeQuery(actor, postingSetup, {});
    expect(setup.kinds.find((k) => k.kind === "project.invoice")).toMatchObject({ waiting: 1, posted: 0 });
    expect(setup.pending[0]!.reason).toContain("needs an account for");
  });

  it("posts the invoice from its own figures: debit the customer for amount plus tax, credit the sale and the tax", async () => {
    for (const [role, key] of [["receivable", "receivable"], ["sales_income", "income"], ["gst_output", "gst"], ["cash", "cash"], ["bank", "bank"]] as const) {
      await executeCommand(actor, setAccountMapping, { role, accountId: ids[key]! });
    }
    expect(await post()).toEqual({ posted: 1, pending: 0, alreadyPosted: 0 });
    const [entry] = await entries("project.invoice");
    expect(entry).toMatchObject({ sourceId: ids.invoice, memo: "Job invoice DS/001", postedById: actor.userId });
    expect(entry!.postedAt.toISOString().slice(0, 10)).toBe("2026-10-01");
    const by = Object.fromEntries(entry!.lines.map((l) => [l.accountId, l]));
    expect(by[ids.receivable!]).toMatchObject({ debitMinor: 1_180_000, creditMinor: 0 });
    expect(by[ids.income!]).toMatchObject({ debitMinor: 0, creditMinor: 1_000_000 });
    expect(by[ids.gst!]).toMatchObject({ debitMinor: 0, creditMinor: 180_000 });
    expect(await net(ids.receivable!)).toBe(1_180_000);
  });

  it("is idempotent", async () => {
    expect(await post()).toEqual({ posted: 0, pending: 0, alreadyPosted: 0 });
    expect(await entries("project.invoice")).toHaveLength(1);
  });

  it("posts receipts: bank-type methods to the bank, cash to the cash account, and the receivable falls", async () => {
    ids.upiReceipt = (await executeCommand(actor, recordReceipt, { jobId, invoiceId: ids.invoice!, receivedOn: "2026-10-05", amountMinor: 500_000, method: "upi", reference: "UTR9" })).id;
    ids.cashReceipt = (await executeCommand(actor, recordReceipt, { jobId, invoiceId: ids.invoice!, receivedOn: "2026-10-06", amountMinor: 100_000, method: "cash" })).id;
    expect(await post()).toEqual({ posted: 2, pending: 0, alreadyPosted: 0 });
    expect(await net(ids.bank!)).toBe(500_000);
    expect(await net(ids.cash!)).toBe(100_000);
    expect(await net(ids.receivable!)).toBe(1_180_000 - 600_000);
  });

  it("reverses a receipt that is voided after posting, linking it to the original, and then the invoice", async () => {
    await executeCommand(actor, voidReceipt, { receiptId: ids.cashReceipt!, reason: "entered twice" });
    expect(await post()).toEqual({ posted: 1, pending: 0, alreadyPosted: 0 });
    const [reversal] = await entries("project.receipt_void");
    const [original] = (await entries("project.receipt")).filter((e) => e.sourceId === ids.cashReceipt);
    expect(reversal).toMatchObject({ sourceId: ids.cashReceipt, reversalOfId: original!.id });
    expect(await net(ids.cash!)).toBe(0);
    expect(await net(ids.receivable!)).toBe(1_180_000 - 500_000);

    await executeCommand(actor, voidReceipt, { receiptId: ids.upiReceipt!, reason: "wrong job" });
    await executeCommand(actor, voidInvoice, { invoiceId: ids.invoice!, reason: "wrong customer" });
    expect(await post()).toEqual({ posted: 2, pending: 0, alreadyPosted: 0 });
    expect(await net(ids.receivable!)).toBe(0);
    expect(await net(ids.income!)).toBe(0);
    expect(await net(ids.gst!)).toBe(0);
    const tb = await executeQuery(actor, trialBalance, {});
    expect(tb.reduce((n, r) => n + r.debitMinor, 0)).toBe(tb.reduce((n, r) => n + r.creditMinor, 0));
  });

  it("is idempotent after reversals, and never posts an invoice that was voided before it posted", async () => {
    expect(await post()).toEqual({ posted: 0, pending: 0, alreadyPosted: 0 });
    const mistake = (await executeCommand(actor, recordInvoice, { jobId, kind: "progress", number: "DS/002", issuedOn: "2026-10-08", amountMinor: 200_000 })).id;
    await executeCommand(actor, voidInvoice, { invoiceId: mistake, reason: "typo" });
    expect(await post()).toEqual({ posted: 0, pending: 0, alreadyPosted: 0 });
    expect((await entries("project.invoice")).filter((e) => e.sourceId === mistake)).toEqual([]);
  });

  it("posts a tax-free job invoice without needing a GST account", async () => {
    await withTenant(tenantId, (tx) => tx.accountMap.deleteMany({ where: { role: "gst_output" } }));
    const free = (await executeCommand(actor, recordInvoice, { jobId, kind: "progress", number: "DS/003", issuedOn: "2026-10-09", amountMinor: 50_000 })).id;
    expect(await post()).toEqual({ posted: 1, pending: 0, alreadyPosted: 0 });
    const [entry] = (await entries("project.invoice")).filter((e) => e.sourceId === free);
    expect(entry!.lines).toHaveLength(2);
  });
});
