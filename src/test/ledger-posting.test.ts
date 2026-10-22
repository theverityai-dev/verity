import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/platform/db";
import { assertRlsEnforceable, withTenant } from "@/server/platform/tenancy";
import { activateCapability, invalidateCapabilityCache, setConfig } from "@/server/platform/capability";
import { clearCommands, clearHooks, executeCommand, type ActorContext } from "@/server/platform/command";
import { clearQueries, executeQuery } from "@/server/platform/query";
import { clearScopeResolvers } from "@/server/platform/authorization";
import { clearTransitionGuards } from "@/server/platform/state";
import { clearContributions } from "@/server/platform/contribution";
import { provisionIdentity } from "@/server/platform/identity";
import { ASSET_CAPABILITY } from "@/server/capabilities/asset";
import { EVIDENCE_CAPABILITY } from "@/server/capabilities/evidence";
import { LOCATION_CAPABILITY } from "@/server/capabilities/location";
import { TRADING_CAPABILITY } from "@/server/capabilities/trading";
import {
  ACCOUNTING_CAPABILITY,
  ENTITY_ACCOUNT,
  ENTITY_JOURNAL_ENTRY,
  createAccount,
  registerAccountingCapability,
  trialBalance,
} from "@/server/capabilities/accounting";
import { postDocumentsNow, postPendingDocuments, postingSetup, setAccountMapping } from "@/server/capabilities/accounting/posting";
import {
  CONFIG_CGST_RATE_BP,
  CONFIG_IGST_RATE_BP,
  CONFIG_SGST_RATE_BP,
  CONFIG_TENANT_STATE_CODE,
  ENTITY_CUSTOMER,
  ENTITY_INVOICE,
  ENTITY_LEDGER_ENTRY,
  ENTITY_PAYMENT,
  ENTITY_SALES_ORDER,
  PLYWOOD_CAPABILITY,
  createCustomer,
  raiseSalesInvoice,
  recordPayment,
  registerPlywoodCapability,
} from "@/server/capabilities/plywood";

/**
 * Task 130 / ADR-044: sales invoices and customer receipts post to the ledger, idempotently, by a per-tenant account map.
 * Real database, runtime role, RLS in force. Each positive case has its refusal beside it.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  const message = "ledger-posting.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describeDb("ledger posting (ADR-044)", () => {
  const tenantId = randomUUID();
  const accountingOnlyTenantId = randomUUID();
  const otherTenantId = randomUUID();

  let organizationId: string;
  let actor: ActorContext;
  let godownId: string;
  let productId: string;
  const ids: Record<string, string> = {};

  const entries = (id = tenantId) =>
    withTenant(id, (tx) => tx.journalEntry.findMany({ where: { sourceKind: { not: null } }, include: { lines: true }, orderBy: { postedAt: "asc" } }));
  const post = (id = tenantId) => withTenant(id, (tx) => postPendingDocuments(tx, id));

  async function approvedOrder(customerId: string, qty: number, unitPricePaise: number): Promise<string> {
    return withTenant(tenantId, async (tx) => {
      const order = await tx.tradingSalesOrder.create({
        data: { tenantId, customerId, locationId: godownId, state: "approved", totalPricePaise: qty * unitPricePaise },
      });
      await tx.tradingSalesOrderLine.create({
        data: {
          tenantId, salesOrderId: order.id, productId, productNameSnapshot: "Sainik 710", hsnCodeSnapshot: "44121000",
          qtyOrdered: qty, qtyShipped: qty, unitPricePaise,
        },
      });
      return order.id;
    });
  }

  beforeAll(async () => {
    await assertRlsEnforceable();
    clearCommands();
    clearQueries();
    clearHooks();
    clearScopeResolvers();
    clearTransitionGuards();
    clearContributions();
    registerPlywoodCapability();
    registerAccountingCapability();

    await withTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: "Posting Test Traders", timeZone: "Asia/Kolkata" } });
      for (const capability of [LOCATION_CAPABILITY, ASSET_CAPABILITY, EVIDENCE_CAPABILITY, TRADING_CAPABILITY, PLYWOOD_CAPABILITY, ACCOUNTING_CAPABILITY]) {
        await activateCapability(tx, tenantId, capability);
      }
      await setConfig(tx, tenantId, CONFIG_TENANT_STATE_CODE, "07", "Tenant");
      await setConfig(tx, tenantId, CONFIG_CGST_RATE_BP, 900, "Tenant");
      await setConfig(tx, tenantId, CONFIG_SGST_RATE_BP, 900, "Tenant");
      await setConfig(tx, tenantId, CONFIG_IGST_RATE_BP, 1800, "Tenant");

      organizationId = (await tx.organization.create({ data: { tenantId, name: "HQ" } })).id;
      godownId = (await tx.location.create({ data: { tenantId, organizationId, name: "Okhla" } })).id;
      const brand = await tx.tradingBrand.create({ data: { tenantId, name: "Century Ply" } });
      productId = (
        await tx.tradingProduct.create({
          data: {
            tenantId, brandId: brand.id, name: "Sainik 710", hsnCode: "44121000",
            plywoodDetail: {
              create: { tenant: { connect: { id: tenantId } }, thicknessTenthMm: 180, widthTenth: 24400, heightTenth: 12200, grade: "BWR" },
            },
          },
        })
      ).id;

      const role = await tx.role.create({ data: { tenantId, name: "Accountant" }, select: { id: true } });
      await tx.permission.createMany({
        data: [ENTITY_INVOICE, "verity.platform.activity", ENTITY_PAYMENT, ENTITY_LEDGER_ENTRY, ENTITY_CUSTOMER, ENTITY_SALES_ORDER, ENTITY_ACCOUNT, ENTITY_JOURNAL_ENTRY].flatMap(
          (entity) =>
            (["Read", "Create", "Edit", "ActionExecute"] as const).map((verb) => ({ tenantId, roleId: role.id, verb, entity, scope: "Tenant" as const })),
        ),
      });
      const identity = await provisionIdentity(tx, { organizationId, authUserId: randomUUID(), displayName: "Accountant" });
      await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId: role.id } });
      actor = { tenantId, userId: identity.userId, membershipId: identity.membershipId, organizationId, roleId: role.id };
    });

    // Accounting without trading: the soft dependency must leave this tenant untouched.
    await withTenant(accountingOnlyTenantId, async (tx) => {
      await tx.tenant.create({ data: { id: accountingOnlyTenantId, name: "Books Only Ltd" } });
      await activateCapability(tx, accountingOnlyTenantId, ACCOUNTING_CAPABILITY);
    });
    await withTenant(otherTenantId, async (tx) => {
      await tx.tenant.create({ data: { id: otherTenantId, name: "Rival Traders" } });
    });
    invalidateCapabilityCache();

    for (const [key, code, name, type] of [
      ["receivable", "1200", "Customers owe us", "Asset"],
      ["cash", "1000", "Cash in hand", "Asset"],
      ["bank", "1100", "Bank", "Asset"],
      ["income", "4000", "Sales", "Income"],
      ["gst", "2200", "GST collected", "Liability"],
      ["expense", "5000", "Rent", "Expense"],
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
      await admin.$executeRaw`DELETE FROM tenant WHERE id IN (${tenantId}::uuid, ${accountingOnlyTenantId}::uuid, ${otherTenantId}::uuid)`;
      await admin.$executeRaw`DELETE FROM "user" WHERE id NOT IN (SELECT user_id FROM tenant_membership)`;
      await admin.$executeRaw`DELETE FROM party WHERE id NOT IN (SELECT party_id FROM "user")`;
    } finally {
      await admin.$disconnect();
    }
    await prisma.$disconnect();
  });

  it("refuses to post to a guessed account: an unmapped invoice waits, with the reason, and the ledger is untouched", async () => {
    const customer = await executeCommand(actor, createCustomer, { displayName: "Dealer A", stateCode: "07", creditLimitPaise: 1_000_000_000 });
    ids.customer = customer.id;
    ids.order1 = await approvedOrder(customer.id, 10, 100_000);
    const invoice = await executeCommand(actor, raiseSalesInvoice, { salesOrderId: ids.order1 });
    ids.invoice1 = invoice.id;

    const run = await post();
    expect(run).toEqual({ posted: 0, pending: 1, alreadyPosted: 0 });
    expect(await entries()).toEqual([]);

    const setup = await executeQuery(actor, postingSetup, {});
    expect(setup.pending).toHaveLength(1);
    expect(setup.pending[0]!.reason).toContain("needs an account for");
    expect(setup.kinds.find((k) => k.kind === "trading.sales_invoice")).toMatchObject({ waiting: 1, posted: 0 });
  });

  it("refuses an account of the wrong type or a deactivated one for a role", async () => {
    await expect(executeCommand(actor, setAccountMapping, { role: "receivable", accountId: ids.expense! })).rejects.toThrow(/needs a Asset account/);
    await expect(executeCommand(actor, setAccountMapping, { role: "sales_income", accountId: ids.receivable! })).rejects.toThrow(/needs a Income account/);
    await expect(executeCommand(actor, setAccountMapping, { role: "receivable", accountId: randomUUID() })).rejects.toThrow(/not found/);
  });

  it("posts the invoice from its own figures once mapped, and the trial balance moves by exactly its amounts", async () => {
    for (const [role, key] of [["receivable", "receivable"], ["sales_income", "income"], ["gst_output", "gst"], ["cash", "cash"], ["bank", "bank"]] as const) {
      await executeCommand(actor, setAccountMapping, { role, accountId: ids[key]! });
    }
    const run = await executeCommand(actor, postDocumentsNow, {});
    expect(run).toEqual({ posted: 1, pending: 0, alreadyPosted: 0 });

    const invoice = await withTenant(tenantId, (tx) => tx.tradingInvoice.findUniqueOrThrow({ where: { id: ids.invoice1! } }));
    const [entry] = await entries();
    expect(entry).toMatchObject({ sourceKind: "trading.sales_invoice", sourceId: ids.invoice1, postedById: actor.userId });
    expect(entry!.memo).toBe(`Sales invoice ${invoice.invoiceNumber}`);
    expect(entry!.postedAt.getTime()).toBe(invoice.issuedAt.getTime());

    const byAccount = Object.fromEntries(entry!.lines.map((l) => [l.accountId, l]));
    expect(byAccount[ids.receivable!]).toMatchObject({ debitMinor: invoice.totalPaise, creditMinor: 0 });
    expect(byAccount[ids.income!]).toMatchObject({ debitMinor: 0, creditMinor: invoice.taxablePaise });
    expect(byAccount[ids.gst!]).toMatchObject({ debitMinor: 0, creditMinor: invoice.cgstPaise + invoice.sgstPaise + invoice.igstPaise });

    const tb = await executeQuery(actor, trialBalance, {});
    const row = (id: string) => tb.find((r) => r.accountId === id)!;
    expect(row(ids.receivable!).debitMinor - row(ids.receivable!).creditMinor).toBe(invoice.totalPaise);
    expect(tb.reduce((n, r) => n + r.debitMinor, 0)).toBe(tb.reduce((n, r) => n + r.creditMinor, 0));

    const setup = await executeQuery(actor, postingSetup, {});
    expect(setup.pending).toEqual([]);
  });

  it("is idempotent: running again, or the button, posts nothing twice", async () => {
    expect(await post()).toEqual({ posted: 0, pending: 0, alreadyPosted: 0 });
    expect(await executeCommand(actor, postDocumentsNow, {})).toEqual({ posted: 0, pending: 0, alreadyPosted: 0 });
    expect(await entries()).toHaveLength(1);
  });

  it("posts a customer receipt: cash to the cash account, UPI to the bank account, and the receivable falls", async () => {
    await executeCommand(actor, recordPayment, { invoiceId: ids.invoice1!, amountPaise: 300_000, method: "cash" });
    await executeCommand(actor, recordPayment, { invoiceId: ids.invoice1!, amountPaise: 200_000, method: "upi", reference: "UTR123" });
    expect(await post()).toEqual({ posted: 2, pending: 0, alreadyPosted: 0 });

    const tb = await executeQuery(actor, trialBalance, {});
    const net = (id: string) => {
      const r = tb.find((x) => x.accountId === id)!;
      return r.debitMinor - r.creditMinor;
    };
    expect(net(ids.cash!)).toBe(300_000);
    expect(net(ids.bank!)).toBe(200_000);
    const invoice = await withTenant(tenantId, (tx) => tx.tradingInvoice.findUniqueOrThrow({ where: { id: ids.invoice1! } }));
    expect(net(ids.receivable!)).toBe(invoice.totalPaise - 500_000);
    expect(tb.reduce((n, r) => n + r.debitMinor, 0)).toBe(tb.reduce((n, r) => n + r.creditMinor, 0));
  });

  it("keeps a deactivated account out: documents wait again rather than post to it", async () => {
    await withTenant(tenantId, (tx) => tx.account.update({ where: { id: ids.bank! }, data: { active: false } }));
    await executeCommand(actor, recordPayment, { invoiceId: ids.invoice1!, amountPaise: 1_000, method: "bank" });
    const run = await post();
    expect(run.pending).toBe(1);
    expect(run.posted).toBe(0);
    const setup = await executeQuery(actor, postingSetup, {});
    expect(setup.pending[0]!.reason).toContain("Bank, UPI and cheques");
    await withTenant(tenantId, (tx) => tx.account.update({ where: { id: ids.bank! }, data: { active: true } }));
    expect((await post()).posted).toBe(1);
    expect((await executeQuery(actor, postingSetup, {})).pending).toEqual([]);
  });

  it("does nothing for a tenant that has accounting but not trading (the dependency is soft)", async () => {
    expect(await post(accountingOnlyTenantId)).toEqual({ posted: 0, pending: 0, alreadyPosted: 0 });
  });

  it("isolates tenants: the other workspace sees no mapping, no pending item and no entry", async () => {
    await withTenant(otherTenantId, async (tx) => {
      expect(await tx.accountMap.count()).toBe(0);
      expect(await tx.ledgerPostingPending.count()).toBe(0);
      expect(await tx.journalEntry.count()).toBe(0);
    });
  });

  it("makes the source key unique per tenant at the database, not just in code", async () => {
    const [existing] = await entries();
    await expect(
      withTenant(tenantId, (tx) =>
        tx.journalEntry.create({
          data: { tenantId, postedById: actor.userId, sourceKind: existing!.sourceKind, sourceId: existing!.sourceId },
        }),
      ),
    ).rejects.toThrow();
  });
});
