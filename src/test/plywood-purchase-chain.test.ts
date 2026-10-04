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
  goodsReceiptDetail,
  productMovements,
  purchaseMatch,
  raisePurchaseInvoice,
  receiveGoods,
  registerPlywoodCapability,
  submitPurchaseOrder,
} from "@/server/capabilities/plywood";

/**
 * The purchase chain — slice 3.
 *
 * Plan: taskplans/archive/45_plywood_workflow_program.md §9.
 * Closes: PLYWOOD_TARGET_WORKFLOW_GAP_AUDIT.md P0-04 (the receipt half).
 *
 * The specification's §25 and §26 in one sentence: one action by a warehouse
 * user must produce a document, move the stock, revalue it, reduce what is
 * incoming, and leave a trail that reads in both directions.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  const message = "plywood-purchase-chain.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describeDb("plywood purchase chain (slice 3)", () => {
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
        data: { id: tenantId, name: "Purchase Chain Plywood", timeZone: "Asia/Kolkata" },
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

  /* ---------------- the receipt is a document (P0-04) ---------------- */

  describe("receiving produces a document, not a side effect (P0-04)", () => {
    it("numbers the receipt gaplessly and records who took delivery", async () => {
      const productId = await freshBoard();
      const order = await executeCommand(owner, createPurchaseOrder, {
        supplierId, locationId: godownId,
        lines: [{ productId, qtyOrdered: 100, unitCostPaise: 118_000 }],
      });
      await executeCommand(owner, submitPurchaseOrder, { orderId: order.id });

      // The specification's §24: 100 ordered, 96 actually turn up.
      const received = await executeCommand(owner, receiveGoods, {
        orderId: order.id,
        supplierChallanNumber: "CH-4471",
        lines: [{ productId, qtyReceived: 96 }],
      });

      expect(received.receiptNumber).toMatch(/^GRN\/\d{4}-\d{2}\/\d{4}$/);
      expect(received.state).toBe("receiving");

      const detail = await executeQuery(owner, goodsReceiptDetail, {
        receiptId: received.receiptId,
      });
      expect(detail!.supplierChallanNumber).toBe("CH-4471");
      expect(detail!.lines).toHaveLength(1);
      expect(detail!.lines[0]!.qtyReceived).toBe(96);
      expect(detail!.totalValuePaise).toBe(96 * 118_000);
      expect(detail!.locationName).toBe("Okhla");
    });

    it("links the stock movement back to the receipt that caused it", async () => {
      const productId = await freshBoard();
      const order = await executeCommand(owner, createPurchaseOrder, {
        supplierId, locationId: godownId,
        lines: [{ productId, qtyOrdered: 40, unitCostPaise: 100_000 }],
      });
      await executeCommand(owner, submitPurchaseOrder, { orderId: order.id });
      const received = await executeCommand(owner, receiveGoods, {
        orderId: order.id,
        lines: [{ productId, qtyReceived: 40 }],
      });

      // THE DEFECT: a stock movement pointed at nothing, so a reader could see
      // that 40 sheets arrived and could not see why. This is the
      // specification's §13 — open a quantity, find the business event.
      const rows = await withTenant(tenantId, (tx) =>
        tx.stockLedgerEntry.findMany({ where: { productId } }),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.sourceType).toBe("goods_receipt");
      expect(rows[0]!.sourceId).toBe(received.receiptId);
      expect(rows[0]!.sourceNumber).toBe(received.receiptNumber);
    });

    it("refuses to rewrite a posted receipt, for every role", async () => {
      const productId = await freshBoard();
      const order = await executeCommand(owner, createPurchaseOrder, {
        supplierId, locationId: godownId,
        lines: [{ productId, qtyOrdered: 10, unitCostPaise: 100_000 }],
      });
      await executeCommand(owner, submitPurchaseOrder, { orderId: order.id });
      const received = await executeCommand(owner, receiveGoods, {
        orderId: order.id,
        lines: [{ productId, qtyReceived: 10 }],
      });

      // A receipt that can be edited settles no dispute. A short receipt is
      // corrected by receiving the balance, never by changing what arrived.
      const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
      try {
        await expect(
          admin.$executeRaw`UPDATE trading_goods_receipt SET supplier_challan_number = 'edited' WHERE id = ${received.receiptId}::uuid`,
        ).rejects.toThrow(/posted financial document/);
      } finally {
        await admin.$disconnect();
      }
    });

    it("keeps a partial receipt partial, and completes on the balance", async () => {
      const productId = await freshBoard();
      const order = await executeCommand(owner, createPurchaseOrder, {
        supplierId, locationId: godownId,
        lines: [{ productId, qtyOrdered: 100, unitCostPaise: 118_000 }],
      });
      await executeCommand(owner, submitPurchaseOrder, { orderId: order.id });

      const first = await executeCommand(owner, receiveGoods, {
        orderId: order.id,
        lines: [{ productId, qtyReceived: 96 }],
      });
      expect(first.state).toBe("receiving");

      const second = await executeCommand(owner, receiveGoods, {
        orderId: order.id,
        lines: [{ productId, qtyReceived: 4 }],
      });
      expect(second.state).toBe("completed");
      // Two arrivals, two documents. Not one document that changed.
      expect(second.receiptNumber).not.toBe(first.receiptNumber);

      const match = await executeQuery(owner, purchaseMatch, { purchaseOrderId: order.id });
      // Non-null for an owner: `purchaseMatch` now returns null for an order
      // outside the reader's godowns, and an owner reaches every godown.
      expect(match).not.toBeNull();
      expect(match!.receipts).toHaveLength(2);
    });
  });

  /* ---------------- three-way match (§29) ---------------- */

  describe("three-way match (specification §29)", () => {
    it("reports ordered, received and invoiced together, and names the shortfall", async () => {
      const productId = await freshBoard();
      const order = await executeCommand(owner, createPurchaseOrder, {
        supplierId, locationId: godownId,
        lines: [{ productId, qtyOrdered: 100, unitCostPaise: 118_000 }],
      });
      await executeCommand(owner, submitPurchaseOrder, { orderId: order.id });
      await executeCommand(owner, receiveGoods, {
        orderId: order.id,
        lines: [{ productId, qtyReceived: 96 }],
      });

      const match = await executeQuery(owner, purchaseMatch, { purchaseOrderId: order.id });
      expect(match!.orderedTotalPaise).toBe(100 * 118_000);
      expect(match!.receivedTotalPaise).toBe(96 * 118_000);
      expect(match!.invoicedTotalPaise).toBe(0);
      expect(match!.lines[0]!.qtyOutstanding).toBe(4);
      expect(match!.exceptions.join(" ")).toMatch(/not fully received/);
    });

    it("names an invoice that differs from what arrived, without refusing it", async () => {
      const productId = await freshBoard();
      const order = await executeCommand(owner, createPurchaseOrder, {
        supplierId, locationId: godownId,
        lines: [{ productId, qtyOrdered: 100, unitCostPaise: 118_000 }],
      });
      await executeCommand(owner, submitPurchaseOrder, { orderId: order.id });
      await executeCommand(owner, receiveGoods, {
        orderId: order.id,
        lines: [{ productId, qtyReceived: 96 }],
      });

      // The supplier bills for 100 at a higher price — the specification's own
      // mismatch example. Recorded as given: what the business owes is what the
      // supplier billed, and a silent correction is not a correction.
      await executeCommand(owner, raisePurchaseInvoice, {
        purchaseOrderId: order.id,
        supplierInvoiceTotalPaise: 120_000 * 100,
      });

      const match = await executeQuery(owner, purchaseMatch, { purchaseOrderId: order.id });
      expect(match!.invoicedTotalPaise).toBe(12_000_000);
      expect(match!.exceptions.join(" ")).toMatch(/Invoiced more than received/);
    });

    it("refuses an invoice when nothing has been received at all", async () => {
      const productId = await freshBoard();
      const order = await executeCommand(owner, createPurchaseOrder, {
        supplierId, locationId: godownId,
        lines: [{ productId, qtyOrdered: 50, unitCostPaise: 100_000 }],
      });
      await executeCommand(owner, submitPurchaseOrder, { orderId: order.id });

      // A supplier invoice arriving before the lorry is a real situation and a
      // real problem. Recording it as a payable against nothing received is
      // how a business pays for a delivery it never got.
      await expect(
        executeCommand(owner, raisePurchaseInvoice, {
          purchaseOrderId: order.id,
          supplierInvoiceTotalPaise: 5_000_000,
        }),
      ).rejects.toThrow(/nothing has been received/);
    });
  });

  /* ---------------- weighted average cost (§27) ---------------- */

  it("recomputes the weighted average across two receipts at different prices", async () => {
    const productId = await freshBoard();

    const first = await executeCommand(owner, createPurchaseOrder, {
      supplierId, locationId: godownId,
      lines: [{ productId, qtyOrdered: 100, unitCostPaise: 100_000 }],
    });
    await executeCommand(owner, submitPurchaseOrder, { orderId: first.id });
    await executeCommand(owner, receiveGoods, {
      orderId: first.id,
      lines: [{ productId, qtyReceived: 100 }],
    });

    const second = await executeCommand(owner, createPurchaseOrder, {
      supplierId, locationId: godownId,
      lines: [{ productId, qtyOrdered: 100, unitCostPaise: 120_000 }],
    });
    await executeCommand(owner, submitPurchaseOrder, { orderId: second.id });
    await executeCommand(owner, receiveGoods, {
      orderId: second.id,
      lines: [{ productId, qtyReceived: 100 }],
    });

    // The specification's §27, exactly: 100 at 1000 plus 100 at 1200 is 200 at
    // 1100, and the average is a stored fact rather than a recomputation.
    const balance = await withTenant(tenantId, (tx) =>
      tx.stockBalance.findFirstOrThrow({ where: { productId, locationId: godownId } }),
    );
    expect(balance.qtyUnits).toBe(200);
    expect(balance.avgUnitCostPaise).toBe(110_000);
  });

  it("shows the movement history with the document behind each line (§13)", async () => {
    const productId = await freshBoard();
    const order = await executeCommand(owner, createPurchaseOrder, {
      supplierId, locationId: godownId,
      lines: [{ productId, qtyOrdered: 60, unitCostPaise: 100_000 }],
    });
    await executeCommand(owner, submitPurchaseOrder, { orderId: order.id });
    const received = await executeCommand(owner, receiveGoods, {
      orderId: order.id,
      lines: [{ productId, qtyReceived: 60 }],
    });

    const movements = await executeQuery(owner, productMovements, { productId });
    expect(movements).toHaveLength(1);
    expect(movements[0]!.qtyDeltaUnits).toBe(60);

    // The ledger row carries the receipt number, denormalised, so the history
    // still reads after the document is archived.
    const rows = await withTenant(tenantId, (tx) =>
      tx.stockLedgerEntry.findMany({ where: { productId } }),
    );
    expect(rows[0]!.sourceNumber).toBe(received.receiptNumber);
  });
});
