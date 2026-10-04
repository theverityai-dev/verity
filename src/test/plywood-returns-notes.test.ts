import { TRADING_CAPABILITY } from "@/server/capabilities/trading";
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
  createPurchaseOrder,
  createSupplier,
  createCustomer,
  customerExposurePaise,
  createSalesOrder,
  dispatchOrder,
  raiseInvoiceNote,
  raiseSalesInvoice,
  recordReturnedStock,
  receiveGoods,
  registerPlywoodCapability,
  reserveForOrder,
  stockAvailability,
  submitPurchaseOrder,
} from "@/server/capabilities/plywood";

/**
 * Returns and corrections — slice 5.
 *
 * Plan: taskplans/archive/45_plywood_workflow_program.md §4.5, §5.
 * Specification §66 and §67.
 *
 * Two rules that look like one and are not: material coming back is a stock
 * event, money coming back is a document. Conflating them is how a business
 * ends up crediting a customer for boards that never returned, or taking
 * boards back and never crediting anybody.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  const message = "plywood-returns-notes.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describeDb("plywood returns and corrections (slice 5)", () => {
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
        data: { id: tenantId, name: "Returns Test Plywood", timeZone: "Asia/Kolkata" },
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
  async function boardInStock(qtyUnits: number): Promise<string> {
    const productId = await freshBoard();
    const order = await executeCommand(owner, createPurchaseOrder, {
      supplierId, locationId: godownId,
      lines: [{ productId, qtyOrdered: qtyUnits, unitCostPaise: 100_000 }],
    });
    await executeCommand(owner, submitPurchaseOrder, { orderId: order.id });
    await executeCommand(owner, receiveGoods, {
      orderId: order.id,
      lines: [{ productId, qtyReceived: qtyUnits }],
    });
    return productId;
  }

  async function freshCustomer(): Promise<string> {
    const customer = await executeCommand(owner, createCustomer, {
      displayName: `Dealer ${randomUUID().slice(0, 8)}`,
      stateCode: "07",
      creditLimitPaise: 100_000_000,
    });
    return customer.id;
  }

  /** A sold, issued and invoiced order. */
  async function soldAndIssued(qtyOrdered = 40, unitPricePaise = 150_000) {
    const productId = await boardInStock(100);
    const customerId = await freshCustomer();
    const order = await executeCommand(owner, createSalesOrder, {
      customerId, locationId: godownId,
      lines: [{ productId, qtyOrdered, unitPricePaise }],
    });
    await executeCommand(owner, reserveForOrder, { orderId: order.id });
    // Task 71: issuing raises the invoice, so there is no second call. One
    // here would be refused as a duplicate, correctly — an order carries one
    // invoice.
    const issued = await executeCommand(owner, dispatchOrder, { orderId: order.id });
    return {
      productId,
      customerId,
      orderId: order.id,
      issued,
      invoice: issued.invoicing!,
    };
  }

  /* ---------------------------- returns (§66) ---------------------------- */

  describe("material coming back is a stock event, not a refund (§66)", () => {
    it("puts the boards back and links them to the issue they left on", async () => {
      const { productId, issued } = await soldAndIssued();

      await executeCommand(owner, recordReturnedStock, {
        productId,
        locationId: godownId,
        qtyUnits: 3,
        reason: "Three sheets delaminated, customer refused them",
        goodsIssueId: issued.issueId,
      });

      const rows = await withTenant(tenantId, (tx) =>
        tx.stockLedgerEntry.findMany({ where: { productId, kind: "returned_stock" } }),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.qtyDeltaUnits).toBe(3);
      // Followable in both directions: out of the gate on this issue, and back
      // in on the same one. Returns are where inventory fraud hides, because
      // nobody questions stock arriving.
      expect(rows[0]!.sourceType).toBe("goods_issue");
      expect(rows[0]!.sourceId).toBe(issued.issueId);
      expect(rows[0]!.reason).toMatch(/delaminated/);
    });

    it("values a return at what left, not at today's average", async () => {
      const { productId, issued } = await soldAndIssued();

      // Buy more at a different price, moving the weighted average.
      const topUp = await executeCommand(owner, createPurchaseOrder, {
        supplierId, locationId: godownId,
        lines: [{ productId, qtyOrdered: 100, unitCostPaise: 200_000 }],
      });
      await executeCommand(owner, submitPurchaseOrder, { orderId: topUp.id });
      await executeCommand(owner, receiveGoods, {
        orderId: topUp.id,
        lines: [{ productId, qtyReceived: 100 }],
      });

      await executeCommand(owner, recordReturnedStock, {
        productId,
        locationId: godownId,
        qtyUnits: 2,
        reason: "Wrong grade delivered",
        goodsIssueId: issued.issueId,
      });

      const rows = await withTenant(tenantId, (tx) =>
        tx.stockLedgerEntry.findMany({ where: { productId, kind: "returned_stock" } }),
      );
      // The board that comes back is the board that went out — 1,000 a sheet,
      // not the 1,500-ish average the later purchase created.
      expect(rows[0]!.unitCostPaise).toBe(100_000);
    });

    it("refuses a return larger than what that issue actually sent", async () => {
      const { productId, issued } = await soldAndIssued(40);

      // Without the cap, a "return" is a way to create stock out of nothing.
      await expect(
        executeCommand(owner, recordReturnedStock, {
          productId,
          locationId: godownId,
          qtyUnits: 41,
          reason: "Trying to return more than was ever sent",
          goodsIssueId: issued.issueId,
        }),
      ).rejects.toThrow(/can still come back/);
    });

    it("does not move any money", async () => {
      const { productId, customerId, issued, invoice } = await soldAndIssued();

      const before = await withTenant(tenantId, (tx) => customerExposurePaise(tx, customerId));
      await executeCommand(owner, recordReturnedStock, {
        productId, locationId: godownId, qtyUnits: 5,
        reason: "Customer over-ordered",
        goodsIssueId: issued.issueId,
      });
      const after = await withTenant(tenantId, (tx) => customerExposurePaise(tx, customerId));

      // §4.5: a return puts boards on a rack. It refunds nobody. The customer
      // still owes the invoice until somebody decides to credit it.
      expect(after).toBe(before);
      expect(after).toBe(invoice.totalPaise);
    });
  });

  /* ------------------------ credit / debit notes (§67) ------------------- */

  describe("money coming back is a document (§67, P0-05)", () => {
    it("credits an invoice without touching it, and reduces what is owed", async () => {
      const { customerId, invoice } = await soldAndIssued();

      const note = await executeCommand(owner, raiseInvoiceNote, {
        invoiceId: invoice.id,
        noteType: "credit",
        taxablePaise: 5 * 150_000,
        reason: "Five sheets returned delaminated",
      });

      expect(note.noteNumber).toMatch(/^CN\/\d{4}-\d{2}\/\d{4}$/);

      // The invoice is untouched — it is what the customer holds and what was
      // reported. The note is what changed.
      const stored = await withTenant(tenantId, (tx) =>
        tx.tradingInvoice.findUniqueOrThrow({ where: { id: invoice.id } }),
      );
      expect(stored.totalPaise).toBe(invoice.totalPaise);

      const exposure = await withTenant(tenantId, (tx) => customerExposurePaise(tx, customerId));
      expect(exposure).toBe(invoice.totalPaise - note.totalPaise);
    });

    it("carries the invoice's own tax rates, not today's", async () => {
      const { invoice } = await soldAndIssued();

      const note = await executeCommand(owner, raiseInvoiceNote, {
        invoiceId: invoice.id,
        noteType: "credit",
        taxablePaise: 100_000,
        reason: "Rate correction agreed with the customer",
      });

      const stored = await withTenant(tenantId, (tx) =>
        tx.tradingInvoiceNote.findUniqueOrThrow({ where: { id: note.id } }),
      );
      // 9% + 9% on 1,000 rupees. Recomputing from today's configuration would
      // let a rate change between the sale and the correction produce a note
      // that does not reconcile to the document it corrects.
      expect(stored.cgstPaise).toBe(9_000);
      expect(stored.sgstPaise).toBe(9_000);
      expect(stored.igstPaise).toBe(0);
      expect(stored.totalPaise).toBe(118_000);
    });

    it("refuses to credit more than the invoice ever charged", async () => {
      const { invoice } = await soldAndIssued(40);

      await executeCommand(owner, raiseInvoiceNote, {
        invoiceId: invoice.id,
        noteType: "credit",
        taxablePaise: 30 * 150_000,
        reason: "Thirty sheets returned",
      });

      // Crediting more than was charged is a refund — money out — not a
      // correction to a sale.
      await expect(
        executeCommand(owner, raiseInvoiceNote, {
          invoiceId: invoice.id,
          noteType: "credit",
          taxablePaise: 20 * 150_000,
          reason: "Trying to over-credit",
        }),
      ).rejects.toThrow(/remain creditable/);
    });

    it("raises what is owed with a debit note", async () => {
      const { customerId, invoice } = await soldAndIssued();

      const note = await executeCommand(owner, raiseInvoiceNote, {
        invoiceId: invoice.id,
        noteType: "debit",
        taxablePaise: 200_000,
        reason: "Freight recovered from the customer",
      });
      expect(note.noteNumber).toMatch(/^DN\//);

      const exposure = await withTenant(tenantId, (tx) => customerExposurePaise(tx, customerId));
      expect(exposure).toBe(invoice.totalPaise + note.totalPaise);
    });

    it("refuses to rewrite a posted note", async () => {
      const { invoice } = await soldAndIssued();
      const note = await executeCommand(owner, raiseInvoiceNote, {
        invoiceId: invoice.id,
        noteType: "credit",
        taxablePaise: 100_000,
        reason: "Short supply",
      });

      // Nothing corrects a note except another note.
      const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
      try {
        await expect(
          admin.$executeRaw`UPDATE trading_invoice_note SET reason = 'edited' WHERE id = ${note.id}::uuid`,
        ).rejects.toThrow(/posted financial document/);
      } finally {
        await admin.$disconnect();
      }
    });

    it("writes one party-ledger entry per note, in the right direction", async () => {
      const { customerId, invoice } = await soldAndIssued();
      await executeCommand(owner, raiseInvoiceNote, {
        invoiceId: invoice.id,
        noteType: "credit",
        taxablePaise: 150_000,
        reason: "One sheet returned",
      });

      const entries = await withTenant(tenantId, (tx) =>
        tx.tradingLedgerEntry.findMany({ where: { customerId }, orderBy: { occurredAt: "asc" } }),
      );
      const credit = entries.find((entry) => entry.narration?.startsWith("CN/"));
      expect(credit).toBeDefined();
      // `credit` reduces what the party owes — named from this business's
      // point of view, consistently with every other entry.
      expect(credit!.entryType).toBe("credit");
      expect(credit!.narration).toMatch(/against .* One sheet returned/);
    });
  });
});
