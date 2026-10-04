import { TRADING_CAPABILITY, sellableStock } from "@/server/capabilities/trading";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/platform/db";
import { assertRlsEnforceable, withTenant } from "@/server/platform/tenancy";
import {
  activateCapability,
  invalidateCapabilityCache,
  setConfig,
} from "@/server/platform/capability";
import {
  clearCommands,
  clearHooks,
  executeCommand,
  type ActorContext,
} from "@/server/platform/command";
import { clearQueries, executeQuery } from "@/server/platform/query";
import { clearScopeResolvers } from "@/server/platform/authorization";
import { clearTransitionGuards } from "@/server/platform/state";
import { clearContributions } from "@/server/platform/contribution";
import { provisionIdentity } from "@/server/platform/identity";
import { ASSET_CAPABILITY } from "@/server/capabilities/asset";
import { EVIDENCE_CAPABILITY } from "@/server/capabilities/evidence";
import { LOCATION_CAPABILITY } from "@/server/capabilities/location";
import {
  CONFIG_CGST_RATE_BP,
  CONFIG_IGST_RATE_BP,
  CONFIG_SGST_RATE_BP,
  CONFIG_TENANT_STATE_CODE,
  ENTITY_BRAND,
  ENTITY_BUSINESS_PROFILE,
  ENTITY_CUSTOMER,
  ENTITY_CUSTOMER_PRICE,
  ENTITY_GODOWN_RACK,
  ENTITY_GST_REGISTRATION,
  ENTITY_INVOICE,
  ENTITY_LEDGER_ENTRY,
  ENTITY_PAYMENT,
  ENTITY_PRODUCT,
  ENTITY_PURCHASE_ORDER,
  ENTITY_RESERVATION,
  ENTITY_SALES_ORDER,
  ENTITY_STOCK_BALANCE,
  ENTITY_STOCK_LEDGER,
  ENTITY_SUPPLIER,
  ENTITY_SUPPLIER_PRICE,
  PLYWOOD_CAPABILITY,
  createBrand,
  createProduct,
  raisePurchaseInvoice,
  createPurchaseOrder,
  createSupplier,
  createCustomer,
  customerExposurePaise,
  createSalesOrder,
  dispatchOrder,
  gstr1Working,
  raiseInvoiceNote,
  raiseSalesInvoice,
  registerGstRegistration,
  resolveTaxRate,
  setTaxRule,
  taxSummary,
  recordReturnedStock,
  receiveGoods,
  registerPlywoodCapability,
  reserveForOrder,
  stockAvailability,
  submitPurchaseOrder,
} from "@/server/capabilities/plywood";

/**
 * Tax — slice 6.
 *
 * Plan: taskplans/archive/45_plywood_workflow_program.md §4.4.
 * Closes: PLYWOOD_TARGET_WORKFLOW_GAP_AUDIT.md P0-07.
 * Specification §5, §58–§63.
 *
 * The rule that governs all of it: tax is DERIVED from posted documents and
 * never re-keyed. There is deliberately no command that lets somebody type a
 * figure into a return, because the moment there is one the return and the
 * invoices stop agreeing and nobody can say which is right.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  const message = "plywood-tax.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describeDb("plywood tax (slice 6)", () => {
  const tenantId = randomUUID();
  let organizationId: string;
  let owner: ActorContext;
  let godownId: string;
  let brandId: string;
  let supplierId: string;

  async function freshBoard(): Promise<string> {
    const product = await executeCommand(owner, createProduct, {
      brandId,
      name: `Board ${randomUUID().slice(0, 8)}`,
      hsnCode: "44121000",
      thicknessTenthMm: 180,
      widthTenth: 24400,
      heightTenth: 12200,
      grade: "BWR",
    });
    return product.id;
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

    await withTenant(tenantId, async (tx) => {
      await tx.tenant.create({
        data: { id: tenantId, name: "Tax Test Plywood", timeZone: "Asia/Kolkata" },
      });
      await activateCapability(tx, tenantId, LOCATION_CAPABILITY);
      await activateCapability(tx, tenantId, ASSET_CAPABILITY);
      await activateCapability(tx, tenantId, EVIDENCE_CAPABILITY);
      await activateCapability(tx, tenantId, TRADING_CAPABILITY);
      await activateCapability(tx, tenantId, PLYWOOD_CAPABILITY);

      await setConfig(tx, tenantId, CONFIG_TENANT_STATE_CODE, "07", "Tenant");
      await setConfig(tx, tenantId, CONFIG_CGST_RATE_BP, 900, "Tenant");
      await setConfig(tx, tenantId, CONFIG_SGST_RATE_BP, 900, "Tenant");
      await setConfig(tx, tenantId, CONFIG_IGST_RATE_BP, 1800, "Tenant");

      organizationId = (await tx.organization.create({ data: { tenantId, name: "HQ" } })).id;
      godownId = (
        await tx.location.create({ data: { tenantId, organizationId, name: "Okhla" } })
      ).id;

      const ownerRole = await tx.role.create({ data: { tenantId, name: "Owner" }, select: { id: true } });
      const everything = [
        ENTITY_BRAND, ENTITY_PRODUCT, ENTITY_GODOWN_RACK, ENTITY_STOCK_LEDGER,
        ENTITY_STOCK_BALANCE, ENTITY_SUPPLIER, ENTITY_SUPPLIER_PRICE, ENTITY_CUSTOMER,
        ENTITY_CUSTOMER_PRICE, ENTITY_PURCHASE_ORDER, ENTITY_SALES_ORDER, ENTITY_RESERVATION,
        ENTITY_INVOICE, ENTITY_PAYMENT, ENTITY_LEDGER_ENTRY,
        ENTITY_BUSINESS_PROFILE, ENTITY_GST_REGISTRATION,
      ];
      await tx.permission.createMany({
        data: everything.flatMap((entity) =>
          (["Read", "Create", "Edit", "ActionExecute"] as const).map((verb) => ({
            tenantId, roleId: ownerRole.id, verb, entity, scope: "Tenant" as const,
          })),
        ),
      });

      const identity = await provisionIdentity(tx, {
        organizationId, authUserId: randomUUID(), displayName: "Proprietor",
      });
      await tx.tenantMembership.update({
        where: { id: identity.membershipId },
        data: { roleId: ownerRole.id },
      });
      owner = {
        tenantId,
        userId: identity.userId,
        membershipId: identity.membershipId,
        organizationId,
        roleId: ownerRole.id,
      };
    });
    invalidateCapabilityCache();

    brandId = (await executeCommand(owner, createBrand, { name: `Century ${randomUUID().slice(0, 6)}` })).id;
    supplierId = (
      await executeCommand(owner, createSupplier, {
        displayName: `Mill ${randomUUID().slice(0, 6)}`,
        stateCode: "07",
      })
    ).id;
  });

  afterAll(async () => {
    clearCommands();
    clearQueries();
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      await admin.$executeRaw`DELETE FROM tenant WHERE id = ${tenantId}::uuid`;
    } finally {
      await admin.$disconnect();
    }
    await prisma.$disconnect();
  });

  /** A board with stock already standing in the godown. */
  async function boardInStock(qtyUnits: number, hsnCode: string | undefined = "44121000"): Promise<string> {
    const product = await executeCommand(owner, createProduct, {
      brandId,
      name: `Board ${randomUUID().slice(0, 8)}`,
      ...(hsnCode ? { hsnCode } : {}),
      thicknessTenthMm: 180,
      widthTenth: 24400,
      heightTenth: 12200,
      grade: "BWR",
    });
    const order = await executeCommand(owner, createPurchaseOrder, {
      supplierId, locationId: godownId,
      lines: [{ productId: product.id, qtyOrdered: qtyUnits, unitCostPaise: 100_000 }],
    });
    await executeCommand(owner, submitPurchaseOrder, { orderId: order.id });
    await executeCommand(owner, receiveGoods, {
      orderId: order.id,
      lines: [{ productId: product.id, qtyReceived: qtyUnits }],
    });
    return product.id;
  }

  async function customerIn(stateCode: string): Promise<string> {
    const customer = await executeCommand(owner, createCustomer, {
      displayName: `Dealer ${randomUUID().slice(0, 8)}`,
      stateCode,
      creditLimitPaise: 1_000_000_000,
    });
    return customer.id;
  }

  async function sell(productId: string, customerId: string, qty = 10, price = 150_000) {
    const order = await executeCommand(owner, createSalesOrder, {
      customerId, locationId: godownId,
      lines: [{ productId, qtyOrdered: qty, unitPricePaise: price }],
    });
    await executeCommand(owner, reserveForOrder, { orderId: order.id });
    // Task 71: issuing the goods raises the invoice. There is no second step
    // any more, and calling one would be refused as a duplicate — correctly,
    // since an order carries one invoice.
    const issued = await executeCommand(owner, dispatchOrder, {
      orderId: order.id,
    });
    return issued.invoicing!;
  }

  beforeAll(async () => {
    // The business registers, then sets its rates. Both are slice 2 and 6
    // master data, not configuration keys.
    await executeCommand(owner, registerGstRegistration, {
      gstin: "07AAACN1234K1ZO",
      invoiceSeriesPrefix: "NK/",
    });
    await executeCommand(owner, setTaxRule, {
      hsnCode: "4412",
      rateBp: 1800,
      authority: "Notification 1/2017 Schedule III",
    });
  });

  /* ---------------------- rate resolution (§4.4) ---------------------- */

  describe("the rate is a dated rule, not a global setting (P0-07)", () => {
    it("matches the most specific HSN first", async () => {
      // An 8-digit rule for one board beats the 4-digit rule for its chapter,
      // which is how the tariff itself is written.
      await executeCommand(owner, setTaxRule, { hsnCode: "44129900", rateBp: 1200 });

      const registration = await withTenant(tenantId, (tx) =>
        tx.tradingGstRegistration.findFirstOrThrow({ where: { active: true } }),
      );
      const specific = await withTenant(tenantId, (tx) =>
        resolveTaxRate(tx, { registrationId: registration.id, hsnCode: "44129900", on: new Date() }),
      );
      expect(specific.hsnMatched).toBe("44129900");
      expect(specific.cgstRateBp).toBe(600);

      const chapter = await withTenant(tenantId, (tx) =>
        resolveTaxRate(tx, { registrationId: registration.id, hsnCode: "44121000", on: new Date() }),
      );
      expect(chapter.hsnMatched).toBe("4412");
      expect(chapter.cgstRateBp).toBe(900);
    });

    it("quotes the tenant default on the sales form for a board with no HSN, never 'unknown'", async () => {
      // 2026-09-15: `sellableStock` carried its own rate lookup that stopped
      // at the per-HSN rule, so a board with no HSN (optional since the
      // catalogue stopped demanding one) showed "no GST rule" on the order
      // form while the invoice would have taxed it at the configured default.
      // One resolver now — the form must quote what the invoice will bill.
      const noHsn = await boardInStock(5, undefined);
      const rows = await executeQuery(owner, sellableStock, {});
      const row = rows.find((r) => r.productId === noHsn);
      expect(row).toBeDefined();
      expect(row!.taxRateBp).toBe(1800);
    });

    it("refuses rather than returning zero when no rule is in force", async () => {
      const registration = await withTenant(tenantId, (tx) =>
        tx.tradingGstRegistration.findFirstOrThrow({ where: { active: true } }),
      );

      // A missing rate used to mean a zero-tax invoice, which is
      // indistinguishable on screen from a genuinely exempt supply and is
      // discovered when the return is filed.
      await expect(
        withTenant(tenantId, (tx) =>
          resolveTaxRate(tx, { registrationId: registration.id, hsnCode: "7318", on: new Date() }),
        ),
      ).rejects.toThrow(/no tax rule is in force/);
    });

    it("supersedes a rate instead of overwriting it, so old invoices keep theirs", async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const result = await executeCommand(owner, setTaxRule, {
        hsnCode: "4412",
        rateBp: 1200,
        effectiveFrom: tomorrow.toISOString(),
        authority: "Rate reduced",
      });
      expect(result.supersededRuleId).not.toBeNull();

      const registration = await withTenant(tenantId, (tx) =>
        tx.tradingGstRegistration.findFirstOrThrow({ where: { active: true } }),
      );
      // Today still resolves to 18%; tomorrow to 12%. The old row is closed,
      // not rewritten — rewriting it would restate a filed return.
      const today = await withTenant(tenantId, (tx) =>
        resolveTaxRate(tx, { registrationId: registration.id, hsnCode: "4412", on: new Date() }),
      );
      expect(today.cgstRateBp).toBe(900);

      const later = await withTenant(tenantId, (tx) =>
        resolveTaxRate(tx, {
          registrationId: registration.id,
          hsnCode: "4412",
          on: new Date(Date.now() + 48 * 60 * 60 * 1000),
        }),
      );
      expect(later.cgstRateBp).toBe(600);
    });

    it("refuses a new rate that would take effect before the one it supersedes", async () => {
      await expect(
        executeCommand(owner, setTaxRule, {
          hsnCode: "4412",
          rateBp: 500,
          effectiveFrom: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      ).rejects.toThrow(/must take effect after/);
    });
  });

  /* ---------------------- place of supply (§50) ---------------------- */

  describe("place of supply decides the tax", () => {
    it("charges CGST and SGST within the state", async () => {
      const productId = await boardInStock(50);
      const customerId = await customerIn("07");
      const invoice = await sell(productId, customerId);

      const stored = await withTenant(tenantId, (tx) =>
        tx.tradingInvoice.findUniqueOrThrow({ where: { id: invoice.id } }),
      );
      expect(stored.cgstPaise).toBeGreaterThan(0);
      expect(stored.sgstPaise).toBe(stored.cgstPaise);
      expect(stored.igstPaise).toBe(0);
      expect(invoice.interState).toBe(false);
    });

    it("charges IGST across a border, at the same total rate", async () => {
      const productId = await boardInStock(50);
      const customerId = await customerIn("09");
      const invoice = await sell(productId, customerId);

      const stored = await withTenant(tenantId, (tx) =>
        tx.tradingInvoice.findUniqueOrThrow({ where: { id: invoice.id } }),
      );
      // 18% either way. Interstate is the two halves expressed once, derived
      // rather than stored twice so the two cannot drift apart.
      expect(stored.igstPaise).toBe(Math.round((stored.taxablePaise * 1800) / 10_000));
      expect(stored.cgstPaise).toBe(0);
      expect(invoice.interState).toBe(true);
    });
  });

  /* ---------------------- the tax position (§58) ---------------------- */

  describe("the tax position is derived, never entered (§58)", () => {
    it("sums output tax from invoices and nets credit notes off it", async () => {
      const productId = await boardInStock(100);
      const customerId = await customerIn("07");
      const invoice = await sell(productId, customerId, 20, 150_000);

      const before = await executeQuery(owner, taxSummary, {});
      const outputBefore = before.outputTaxPaise;

      await executeCommand(owner, raiseInvoiceNote, {
        invoiceId: invoice.id,
        noteType: "credit",
        taxablePaise: 150_000,
        reason: "One sheet returned",
      });

      const after = await executeQuery(owner, taxSummary, {});
      // A credit note reduces what is owed to the government, and the working
      // shows it separately rather than silently netting it away.
      expect(after.creditNoteTaxPaise).toBeGreaterThan(0);
      expect(after.outputTaxPaise).toBe(outputBefore - after.creditNoteTaxPaise);
    });

    it("names a supplier invoice with no tax split as ineligible for credit", async () => {
      const productId = await boardInStock(30);
      const po = await executeCommand(owner, createPurchaseOrder, {
        supplierId, locationId: godownId,
        lines: [{ productId, qtyOrdered: 10, unitCostPaise: 100_000 }],
      });
      await executeCommand(owner, submitPurchaseOrder, { orderId: po.id });
      // PART received on purpose. A fully received order raises its own bill
      // now (Task 71), with a computed split, so the only way to reach the
      // no-split case is the path that still exists for it: an accountant
      // entering a supplier's total by hand against an order the automatic
      // bill has not covered.
      await executeCommand(owner, receiveGoods, {
        orderId: po.id,
        lines: [{ productId, qtyReceived: 5 }],
      });
      const purchaseInvoice = await executeCommand(owner, raisePurchaseInvoice, {
        purchaseOrderId: po.id,
        supplierInvoiceTotalPaise: 1_180_000,
      });

      const summary = await executeQuery(owner, taxSummary, {});
      const exception = summary.exceptions.find(
        (e) => e.documentNumber === purchaseInvoice.invoiceNumber,
      );
      // The purchase invoice still records a total with no split, so no input
      // credit can be claimed against it. Surfaced as work for the accountant
      // rather than quietly counted as zero.
      expect(exception?.kind).toBe("no_input_credit");
    });
  });

  /* ---------------------- GSTR-1 working (§61) ---------------------- */

  describe("GSTR-1 is generated from posted invoices (§61)", () => {
    it("splits B2B from B2C on whether the buyer has a GSTIN", async () => {
      const productId = await boardInStock(100);

      const registered = await executeCommand(owner, createCustomer, {
        displayName: "Gupta Timber",
        stateCode: "07",
        gstin: "07AAACG1234K1ZV",
        creditLimitPaise: 1_000_000_000,
      });
      const walkIn = await customerIn("07");

      await sell(productId, registered.id, 5);
      await sell(productId, walkIn, 5);

      const working = await executeQuery(owner, gstr1Working, {});
      expect(working.b2b.some((row) => row.gstin === "07AAACG1234K1ZV")).toBe(true);
      expect(working.b2c.length).toBeGreaterThan(0);
    });

    it("summarises by HSN, which is what the return asks for", async () => {
      const productId = await boardInStock(60);
      const customerId = await customerIn("07");
      await sell(productId, customerId, 10, 150_000);

      const working = await executeQuery(owner, gstr1Working, {});
      const row = working.hsnSummary.find((entry) => entry.hsnCode === "44121000");
      expect(row).toBeDefined();
      expect(row!.qtyUnits).toBeGreaterThanOrEqual(10);
      expect(row!.taxPaise).toBeGreaterThan(0);
    });
  });
});
