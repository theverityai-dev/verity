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
  createSalesOrder,
  dispatchOrder,
  raiseSalesInvoice,
  receiveGoods,
  registerPlywoodCapability,
  reserveForOrder,
  stockAvailability,
  submitPurchaseOrder,
} from "@/server/capabilities/plywood";

/**
 * The sales chain — slice 4.
 *
 * Plan: taskplans/archive/45_plywood_workflow_program.md §9.
 * Closes: PLYWOOD_TARGET_WORKFLOW_GAP_AUDIT.md P0-04 (the issue half) and the
 * remainder of P0-03.
 *
 * The specification's §43–§47: reserving holds stock without moving it,
 * issuing moves it and releases only what left, and the invoice bills for what
 * actually went out of the gate — not for what was ordered.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  const message = "plywood-sales-chain.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describeDb("plywood sales chain (slice 4)", () => {
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
        data: { id: tenantId, name: "Sales Chain Plywood", timeZone: "Asia/Kolkata" },
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

  /* ------------- reservation holds without moving (§43, §44) ------------- */

  it("holds stock without moving it, and takes it out of what is available", async () => {
    const productId = await boardInStock(150);
    const customerId = await freshCustomer();

    const before = await executeQuery(owner, stockAvailability, { locationId: godownId });
    const beforeRow = before.find((row) => row.productId === productId)!;
    expect(beforeRow.onHandUnits).toBe(150);
    expect(beforeRow.reservedUnits).toBe(0);

    const order = await executeCommand(owner, createSalesOrder, {
      customerId, locationId: godownId,
      lines: [{ productId, qtyOrdered: 40, unitPricePaise: 150_000 }],
    });
    await executeCommand(owner, reserveForOrder, { orderId: order.id });

    // The specification's §43: on hand unchanged, reserved up, available down.
    // Physical stock has not left.
    const after = await executeQuery(owner, stockAvailability, { locationId: godownId });
    const afterRow = after.find((row) => row.productId === productId)!;
    expect(afterRow.onHandUnits).toBe(150);
    expect(afterRow.reservedUnits).toBe(40);
    expect(afterRow.availableUnits).toBe(110);
  });

  /* ---------------- the issue is a document (P0-04) ---------------- */

  describe("issuing produces a document (P0-04, §45–§47)", () => {
    it("numbers the issue, records who collected, and links the movement back", async () => {
      const productId = await boardInStock(100);
      const customerId = await freshCustomer();
      const order = await executeCommand(owner, createSalesOrder, {
        customerId, locationId: godownId,
        lines: [{ productId, qtyOrdered: 40, unitPricePaise: 150_000 }],
      });
      await executeCommand(owner, reserveForOrder, { orderId: order.id });

      const issued = await executeCommand(owner, dispatchOrder, {
        orderId: order.id,
        collectedBy: "Sharma at the yard",
      });

      expect(issued.issueNumber).toMatch(/^GI\/\d{4}-\d{2}\/\d{4}$/);
      expect(issued.state).toBe("completed");

      const rows = await withTenant(tenantId, (tx) =>
        tx.stockLedgerEntry.findMany({ where: { productId, kind: "sales_outward" } }),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.qtyDeltaUnits).toBe(-40);
      expect(rows[0]!.sourceType).toBe("goods_issue");
      expect(rows[0]!.sourceId).toBe(issued.issueId);

      // §46: on hand falls by what left, and the hold goes with it.
      const after = await executeQuery(owner, stockAvailability, { locationId: godownId });
      const row = after.find((entry) => entry.productId === productId)!;
      expect(row.onHandUnits).toBe(60);
      expect(row.reservedUnits).toBe(0);
    });

    it("issues part of an order and keeps the rest reserved", async () => {
      const productId = await boardInStock(100);
      const customerId = await freshCustomer();
      const order = await executeCommand(owner, createSalesOrder, {
        customerId, locationId: godownId,
        lines: [{ productId, qtyOrdered: 40, unitPricePaise: 150_000 }],
      });
      await executeCommand(owner, reserveForOrder, { orderId: order.id });

      // THE DEFECT: dispatch moved every remaining line at once and released
      // every hold, so a partial issue was impossible — and releasing the
      // whole hold would free stock the customer is still owed, which the next
      // order would quietly take.
      const first = await executeCommand(owner, dispatchOrder, {
        orderId: order.id,
        lines: [{ productId, qtyIssued: 25 }],
      });
      expect(first.state).toBe("dispatching");

      const mid = await executeQuery(owner, stockAvailability, { locationId: godownId });
      const midRow = mid.find((entry) => entry.productId === productId)!;
      expect(midRow.onHandUnits).toBe(75);
      // 15 still owed, so 15 still held.
      expect(midRow.reservedUnits).toBe(15);

      const second = await executeCommand(owner, dispatchOrder, {
        orderId: order.id,
        lines: [{ productId, qtyIssued: 15 }],
      });
      expect(second.state).toBe("completed");
      expect(second.issueNumber).not.toBe(first.issueNumber);

      const end = await executeQuery(owner, stockAvailability, { locationId: godownId });
      const endRow = end.find((entry) => entry.productId === productId)!;
      expect(endRow.onHandUnits).toBe(60);
      expect(endRow.reservedUnits).toBe(0);
    });

    it("refuses to issue more than the order still owes", async () => {
      const productId = await boardInStock(100);
      const customerId = await freshCustomer();
      const order = await executeCommand(owner, createSalesOrder, {
        customerId, locationId: godownId,
        lines: [{ productId, qtyOrdered: 20, unitPricePaise: 150_000 }],
      });
      await executeCommand(owner, reserveForOrder, { orderId: order.id });

      await expect(
        executeCommand(owner, dispatchOrder, {
          orderId: order.id,
          lines: [{ productId, qtyIssued: 25 }],
        }),
      ).rejects.toThrow(/has 20 left to issue/);
    });

    it("refuses to rewrite a posted issue", async () => {
      const productId = await boardInStock(50);
      const customerId = await freshCustomer();
      const order = await executeCommand(owner, createSalesOrder, {
        customerId, locationId: godownId,
        lines: [{ productId, qtyOrdered: 10, unitPricePaise: 150_000 }],
      });
      await executeCommand(owner, reserveForOrder, { orderId: order.id });
      const issued = await executeCommand(owner, dispatchOrder, { orderId: order.id });

      const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
      try {
        await expect(
          admin.$executeRaw`UPDATE trading_goods_issue SET collected_by = 'edited' WHERE id = ${issued.issueId}::uuid`,
        ).rejects.toThrow(/posted financial document/);
      } finally {
        await admin.$disconnect();
      }
    });
  });

  /* ------------- the invoice follows the goods (P0-03) ------------- */

  describe("the invoice bills for what left the yard (P0-03)", () => {
    it("invoices the issued quantity, not the ordered quantity", async () => {
      const productId = await boardInStock(100);
      const customerId = await freshCustomer();
      const order = await executeCommand(owner, createSalesOrder, {
        customerId, locationId: godownId,
        lines: [{ productId, qtyOrdered: 40, unitPricePaise: 150_000 }],
      });
      await executeCommand(owner, reserveForOrder, { orderId: order.id });
      await executeCommand(owner, dispatchOrder, {
        orderId: order.id,
        lines: [{ productId, qtyIssued: 25 }],
      });

      const invoice = await executeCommand(owner, raiseSalesInvoice, { salesOrderId: order.id });

      // 25 issued at 1,500 is 37,500 taxable — not 40 at 1,500. Billing the
      // ordered quantity charges a customer for boards still in the godown.
      const stored = await withTenant(tenantId, (tx) =>
        tx.tradingInvoice.findUniqueOrThrow({
          where: { id: invoice.id },
          include: { lines: true },
        }),
      );
      expect(stored.taxablePaise).toBe(25 * 150_000);
      expect(stored.lines[0]!.qtyUnits).toBe(25);
    });

    it("refuses to invoice an order where nothing has been issued", async () => {
      const productId = await boardInStock(50);
      const customerId = await freshCustomer();
      const order = await executeCommand(owner, createSalesOrder, {
        customerId, locationId: godownId,
        lines: [{ productId, qtyOrdered: 10, unitPricePaise: 150_000 }],
      });
      await executeCommand(owner, reserveForOrder, { orderId: order.id });

      await expect(
        executeCommand(owner, raiseSalesInvoice, { salesOrderId: order.id }),
      ).rejects.toThrow(/nothing has been issued/);
    });
  });
});
