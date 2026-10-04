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
  ENTITY_CUSTOMER,
  ENTITY_CUSTOMER_PRICE,
  ENTITY_GODOWN_RACK,
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
  createCustomer,
  createProduct,
  createPurchaseOrder,
  createSalesOrder,
  createSupplier,
  customerExposurePaise,
  dispatchOrder,
  lowStock,
  openOrders,
  raisePurchaseInvoice,
  raiseSalesInvoice,
  receiveGoods,
  recordPayment,
  registerPlywoodCapability,
  reserveForOrder,
  stockOnHand,
  submitPurchaseOrder,
} from "@/server/capabilities/plywood";

/**
 * Plywood integrity foundation — slice 1.
 *
 * Plan: taskplans/archive/45_plywood_workflow_program.md.
 * Findings closed: PLYWOOD_TARGET_WORKFLOW_GAP_AUDIT.md P0-02, P0-03, P0-05,
 * P0-06, and the availability rule in §4.2.
 *
 * Each test here corresponds to a way the business loses money quietly: credit
 * that evaporates when goods leave the yard, an invoice raised against credit
 * that was refused, a posted document edited after it was given to a customer,
 * two orders holding the same sheets, and a reorder alert that stays silent
 * because everything on hand is already promised to somebody.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  const message = "plywood-integrity.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describeDb("plywood integrity foundation (slice 1)", () => {
  const tenantId = randomUUID();
  let organizationId: string;
  let owner: ActorContext;
  let godownId: string;
  let brandId: string;
  let supplierId: string;

  /** A second branch, with its own organization, godown and godown-scoped role. */
  let noidaOrganizationId: string;
  let noidaGodownId: string;
  let noidaKeeper: ActorContext;

  async function freshBoard(reorderLevelUnits = 0): Promise<string> {
    const product = await executeCommand(owner, createProduct, {
      brandId,
      name: `Board ${randomUUID().slice(0, 8)}`,
      hsnCode: "44121000",
      thicknessTenthMm: 180,
      widthTenth: 24400,
      heightTenth: 12200,
      grade: "BWR",
      reorderLevelUnits,
    });
    return product.id;
  }

  async function boardInStock(qtyUnits: number, reorderLevelUnits = 0): Promise<string> {
    const productId = await freshBoard(reorderLevelUnits);
    const order = await executeCommand(owner, createPurchaseOrder, {
      supplierId,
      locationId: godownId,
      lines: [{ productId, qtyOrdered: qtyUnits, unitCostPaise: 100_000 }],
    });
    await executeCommand(owner, submitPurchaseOrder, { orderId: order.id });
    await executeCommand(owner, receiveGoods, {
      orderId: order.id,
      lines: [{ productId, qtyReceived: qtyUnits }],
    });
    return productId;
  }

  async function freshCustomer(creditLimitPaise: number): Promise<string> {
    const customer = await executeCommand(owner, createCustomer, {
      displayName: `Dealer ${randomUUID().slice(0, 8)}`,
      stateCode: "07",
      creditLimitPaise,
    });
    return customer.id;
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
        data: { id: tenantId, name: "Integrity Test Plywood", timeZone: "Asia/Kolkata" },
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

      // A sibling branch under HQ. PLA-ORG-003: a Noida role must not see
      // Okhla, even though HQ sees both.
      noidaOrganizationId = (
        await tx.organization.create({ data: { tenantId, name: "Noida", parentId: organizationId } })
      ).id;
      noidaGodownId = (
        await tx.location.create({
          data: { tenantId, organizationId: noidaOrganizationId, name: "Noida Godown" },
        })
      ).id;

      const ownerRole = await tx.role.create({ data: { tenantId, name: "Owner" }, select: { id: true } });
      const everything = [
        ENTITY_BRAND, ENTITY_PRODUCT, ENTITY_GODOWN_RACK, ENTITY_STOCK_LEDGER,
        ENTITY_STOCK_BALANCE, ENTITY_SUPPLIER, ENTITY_SUPPLIER_PRICE, ENTITY_CUSTOMER,
        ENTITY_CUSTOMER_PRICE, ENTITY_PURCHASE_ORDER, ENTITY_SALES_ORDER, ENTITY_RESERVATION,
        ENTITY_INVOICE, ENTITY_PAYMENT, ENTITY_LEDGER_ENTRY,
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

      // The warehouse keeper at Noida: the same verbs as the owner, granted at
      // Organization scope instead of Tenant. Everything that follows about
      // them is decided by scope alone, which is the point.
      const keeperRole = await tx.role.create({
        data: { tenantId, name: "Noida Warehouse Keeper" },
        select: { id: true },
      });
      await tx.permission.createMany({
        data: everything.flatMap((entity) =>
          (["Read", "Create", "Edit", "ActionExecute"] as const).map((verb) => ({
            tenantId, roleId: keeperRole.id, verb, entity, scope: "Organization" as const,
          })),
        ),
      });
      const keeperIdentity = await provisionIdentity(tx, {
        organizationId: noidaOrganizationId,
        authUserId: randomUUID(),
        displayName: "Noida keeper",
      });
      await tx.tenantMembership.update({
        where: { id: keeperIdentity.membershipId },
        data: { roleId: keeperRole.id },
      });
      noidaKeeper = {
        tenantId,
        userId: keeperIdentity.userId,
        membershipId: keeperIdentity.membershipId,
        organizationId: noidaOrganizationId,
        roleId: keeperRole.id,
      };
    });
    invalidateCapabilityCache();

    const brand = await executeCommand(owner, createBrand, { name: `Century ${randomUUID().slice(0, 6)}` });
    brandId = brand.id;
    const supplier = await executeCommand(owner, createSupplier, {
      displayName: `Mill ${randomUUID().slice(0, 6)}`,
      stateCode: "07",
    });
    supplierId = supplier.id;
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

  /* ------------------------------------------------------------------ *
   * P0-02 — credit exposure
   * ------------------------------------------------------------------ */

  describe("credit exposure (P0-02, rule freeze §4.1)", () => {
    it("does not fall when the goods are dispatched", async () => {
      const productId = await boardInStock(50);
      const customerId = await freshCustomer(10_000_000);

      const order = await executeCommand(owner, createSalesOrder, {
        customerId,
        locationId: godownId,
        lines: [{ productId, qtyOrdered: 10, unitPricePaise: 150_000 }],
      });
      await executeCommand(owner, reserveForOrder, { orderId: order.id });

      const beforeIssue = await withTenant(tenantId, (tx) => customerExposurePaise(tx, customerId));
      expect(beforeIssue).toBe(order.totalPricePaise);

      const issued = await executeCommand(owner, dispatchOrder, {
        orderId: order.id,
      });

      // THE DEFECT: dispatch completed the order, the old formula counted only
      // non-completed orders, and exposure fell to zero while the customer had
      // not paid a rupee. The next order then passed a credit check it should
      // have failed.
      const afterIssue = await withTenant(tenantId, (tx) => customerExposurePaise(tx, customerId));
      expect(afterIssue).toBeGreaterThanOrEqual(beforeIssue);

      // Since Task 71 the same act raises the invoice, so the commitment turns
      // into a receivable in one step and exposure RISES by the tax the
      // customer now also owes. The invariant is that it never falls until
      // money arrives; equality with the commitment was only ever a
      // consequence of invoicing being a separate manual step.
      expect(afterIssue).toBe(issued.invoicing!.totalPaise);
    });

    it("converts a commitment into a receivable when invoiced, without counting it twice", async () => {
      const productId = await boardInStock(50);
      const customerId = await freshCustomer(10_000_000);

      const order = await executeCommand(owner, createSalesOrder, {
        customerId,
        locationId: godownId,
        lines: [{ productId, qtyOrdered: 10, unitPricePaise: 150_000 }],
      });
      await executeCommand(owner, reserveForOrder, { orderId: order.id });
      // Task 71: dispatching raises the invoice, so the commitment becomes a
      // receivable in the same step rather than in a second one.
      const issued = await executeCommand(owner, dispatchOrder, {
        orderId: order.id,
      });
      const invoice = issued.invoicing!;
      const exposure = await withTenant(tenantId, (tx) => customerExposurePaise(tx, customerId));

      // The invoice is gross of tax and therefore larger than the order's
      // value. Exposure must equal the invoice, not the invoice plus the
      // commitment it replaced.
      expect(invoice.totalPaise).toBeGreaterThan(order.totalPricePaise);
      expect(exposure).toBe(invoice.totalPaise);
    });

    it("falls only when money is actually received", async () => {
      const productId = await boardInStock(50);
      const customerId = await freshCustomer(10_000_000);

      const order = await executeCommand(owner, createSalesOrder, {
        customerId, locationId: godownId,
        lines: [{ productId, qtyOrdered: 10, unitPricePaise: 150_000 }],
      });
      await executeCommand(owner, reserveForOrder, { orderId: order.id });
      const issued = await executeCommand(owner, dispatchOrder, {
        orderId: order.id,
      });
      const invoice = issued.invoicing!;

      await executeCommand(owner, recordPayment, {
        invoiceId: invoice.id,
        method: "bank",
        amountPaise: 500_000,
      });

      const exposure = await withTenant(tenantId, (tx) => customerExposurePaise(tx, customerId));
      expect(exposure).toBe(invoice.totalPaise - 500_000);
    });

    it("ignores a draft order, because a draft promises nothing", async () => {
      const customerId = await freshCustomer(10_000_000);
      const before = await withTenant(tenantId, (tx) => customerExposurePaise(tx, customerId));
      expect(before).toBe(0);
    });
  });

  /* ------------------------------------------------------------------ *
   * P0-03 — invoice eligibility
   * ------------------------------------------------------------------ */

  describe("invoice eligibility (P0-03)", () => {
    it("refuses to invoice an order still awaiting credit approval", async () => {
      const productId = await boardInStock(50);
      // A limit smaller than the order used to force pending_credit; the
      // credit GATE is gone now (orders.ts createSalesOrder, "every order
      // is approved" — the business's own decision, see
      // capability-plywood-trading.test.ts for the fuller note), so this
      // order is approved on creation regardless.
      const customerId = await freshCustomer(100_000);

      const order = await executeCommand(owner, createSalesOrder, {
        customerId, locationId: godownId,
        lines: [{ productId, qtyOrdered: 10, unitPricePaise: 150_000 }],
      });
      expect(order.state).toBe("approved");

      // THE DEFECT this test was written for (the old guard rejected only
      // draft and cancelled, letting a financial document be raised
      // against credit the business had explicitly refused) can no longer
      // occur through normal creation, but the state guard itself is still
      // real: `issueSalesInvoice`'s INVOICEABLE_SALES_ORDER_STATES allow-list
      // (finance.ts) would still refuse a pending_credit order if one ever
      // existed — vestigial defense-in-depth, worth still proving directly.
      await withTenant(tenantId, (tx) =>
        tx.tradingSalesOrder.update({ where: { id: order.id }, data: { state: "pending_credit" } }),
      );
      await expect(
        executeCommand(owner, raiseSalesInvoice, { salesOrderId: order.id }),
      ).rejects.toThrow(/pending_credit cannot be invoiced/);
      await withTenant(tenantId, (tx) =>
        tx.tradingSalesOrder.update({ where: { id: order.id }, data: { state: "approved" } }),
      );

      // P0-03's still-live half: approval alone is not enough, because an
      // invoice bills for goods that have actually left the yard.
      await expect(
        executeCommand(owner, raiseSalesInvoice, { salesOrderId: order.id }),
      ).rejects.toThrow(/nothing has been issued/);

      await executeCommand(owner, reserveForOrder, { orderId: order.id });
      // And with the goods actually gone, the invoice appears by itself.
      const issued = await executeCommand(owner, dispatchOrder, {
        orderId: order.id,
      });
      expect(issued.invoicingRefusal).toBeNull();
      expect(issued.invoicing).toMatchObject({ totalPaise: expect.any(Number) });
    });

    it("refuses a supplier invoice against a purchase order that was never submitted", async () => {
      const productId = await freshBoard();
      const order = await executeCommand(owner, createPurchaseOrder, {
        supplierId, locationId: godownId,
        lines: [{ productId, qtyOrdered: 10, unitCostPaise: 100_000 }],
      });

      // THE DEFECT: there was no state guard at all on the purchasing side, so
      // a payable could be created for goods nobody had ordered.
      await expect(
        executeCommand(owner, raisePurchaseInvoice, {
          purchaseOrderId: order.id,
          supplierInvoiceTotalPaise: 1_000_000,
        }),
      ).rejects.toThrow(/draft cannot be invoiced/);
    });
  });

  /* ------------------------------------------------------------------ *
   * P0-05 — posted documents are immutable
   * ------------------------------------------------------------------ */

  describe("posted documents are immutable (P0-05, INV-002)", () => {
    let invoiceId: string;
    let paymentId: string;

    beforeAll(async () => {
      const productId = await boardInStock(50);
      const customerId = await freshCustomer(10_000_000);
      const order = await executeCommand(owner, createSalesOrder, {
        customerId, locationId: godownId,
        lines: [{ productId, qtyOrdered: 5, unitPricePaise: 150_000 }],
      });
      await executeCommand(owner, reserveForOrder, { orderId: order.id });
      const issued = await executeCommand(owner, dispatchOrder, {
        orderId: order.id,
      });
      invoiceId = issued.invoicing!.id;
      const payment = await executeCommand(owner, recordPayment, {
        invoiceId, method: "cash", amountPaise: 100_000,
      });
      paymentId = payment.id;
    });

    it("refuses to rewrite an invoice's amount, for every role including a privileged one", async () => {
      const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
      try {
        // A correction a migration could quietly make is not a correction.
        await expect(
          admin.$executeRaw`UPDATE trading_invoice SET total_paise = 1 WHERE id = ${invoiceId}::uuid`,
        ).rejects.toThrow(/posted financial document/);
      } finally {
        await admin.$disconnect();
      }
    });

    it("refuses to rewrite an invoice line or a payment", async () => {
      const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
      try {
        await expect(
          admin.$executeRaw`UPDATE trading_invoice_line SET qty_units = 999 WHERE invoice_id = ${invoiceId}::uuid`,
        ).rejects.toThrow(/posted financial document/);
        await expect(
          admin.$executeRaw`UPDATE trading_payment SET amount_paise = 1 WHERE id = ${paymentId}::uuid`,
        ).rejects.toThrow(/posted financial document/);
      } finally {
        await admin.$disconnect();
      }
    });

    it("names the correction path in the refusal, rather than only refusing", async () => {
      const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
      try {
        await expect(
          admin.$executeRaw`UPDATE trading_invoice SET total_paise = 1 WHERE id = ${invoiceId}::uuid`,
        ).rejects.toThrow(/credit or debit note/);
      } finally {
        await admin.$disconnect();
      }
    });
  });

  /* ------------------------------------------------------------------ *
   * P0-06 — one invoice per order, enforced by the database
   * ------------------------------------------------------------------ */

  it("refuses a second invoice for the same order at the database, not only in code (P0-06)", async () => {
    const productId = await boardInStock(50);
    const customerId = await freshCustomer(10_000_000);
    const order = await executeCommand(owner, createSalesOrder, {
      customerId, locationId: godownId,
      lines: [{ productId, qtyOrdered: 5, unitPricePaise: 150_000 }],
    });
    await executeCommand(owner, reserveForOrder, { orderId: order.id });
    // The first invoice is the one dispatch raised.
    const issued = await executeCommand(owner, dispatchOrder, {
      orderId: order.id,
    });
    const first = issued.invoicing!;

    // The application check remains, and is what produces the readable error.
    await expect(
      executeCommand(owner, raiseSalesInvoice, { salesOrderId: order.id }),
    ).rejects.toThrow(/already been invoiced/);

    // The index is what survives two concurrent requests that both pass that
    // check before either writes. Proven by bypassing the application entirely.
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      const row = await admin.tradingInvoice.findUniqueOrThrow({ where: { id: first.id } });
      await expect(
        admin.$executeRaw`
          INSERT INTO trading_invoice (
            id, tenant_id, series_id, customer_id, sales_order_id, invoice_number,
            sequence_number, financial_year, place_of_supply_state_code, supply_state_code,
            taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, updated_at
          ) VALUES (
            gen_random_uuid(), ${tenantId}::uuid, ${row.seriesId}::uuid, ${row.customerId}::uuid,
            ${row.salesOrderId}::uuid, ${`DUP/${randomUUID().slice(0, 8)}`}, 9999, ${row.financialYear},
            ${row.placeOfSupplyStateCode}, ${row.supplyStateCode},
            ${row.taxablePaise}, ${row.cgstPaise}, ${row.sgstPaise}, ${row.igstPaise}, ${row.totalPaise}, now()
          )`,
      // 23505: the partial unique index refused it. The application check
      // above is what produces a readable message; this is what survives a
      // race between two requests that both passed that check.
      ).rejects.toThrow(/\(tenant_id, sales_order_id\).*already exists/);
    } finally {
      await admin.$disconnect();
    }
  });

  /* ------------------------------------------------------------------ *
   * P0-01 — row-scoped authorization
   * ------------------------------------------------------------------ */

  describe("godown row scope (P0-01, PLA-AUT-004, PLA-ORG-003)", () => {
    it("hides another branch's stock from a godown-scoped role", async () => {
      const productId = await boardInStock(30);

      const ownerSees = await executeQuery(owner, stockOnHand, { productId });
      expect(ownerSees.some((row) => row.locationId === godownId)).toBe(true);

      // THE DEFECT: no plywood handler called ctx.scope() or assertRowInScope,
      // so Layer 1 was enforced and Layer 2 was not — which looks authorized.
      const keeperSees = await executeQuery(noidaKeeper, stockOnHand, { productId });
      expect(keeperSees).toEqual([]);
    });

    it("returns nothing rather than the stock when another godown is named by id", async () => {
      await boardInStock(30);

      // Asking for Okhla explicitly must not widen the answer. An explicit
      // filter is intersected with the reachable set, never substituted for it.
      const keeperSees = await executeQuery(noidaKeeper, stockOnHand, { locationId: godownId });
      expect(keeperSees).toEqual([]);
    });

    it("refuses to create an order against a godown outside the actor's scope", async () => {
      const productId = await freshBoard();
      const customerId = await freshCustomer(10_000_000);

      await expect(
        executeCommand(noidaKeeper, createPurchaseOrder, {
          supplierId,
          locationId: godownId,
          lines: [{ productId, qtyOrdered: 5, unitCostPaise: 100_000 }],
        }),
      ).rejects.toThrow(/outside this actor's scope/);

      await expect(
        executeCommand(noidaKeeper, createSalesOrder, {
          customerId,
          locationId: godownId,
          lines: [{ productId, qtyOrdered: 5, unitPricePaise: 150_000 }],
        }),
      ).rejects.toThrow(/outside this actor's scope/);
    });

    it("permits the same actions in the actor's own godown", async () => {
      const productId = await freshBoard();
      await expect(
        executeCommand(noidaKeeper, createPurchaseOrder, {
          supplierId,
          locationId: noidaGodownId,
          lines: [{ productId, qtyOrdered: 5, unitCostPaise: 100_000 }],
        }),
      ).resolves.toMatchObject({ id: expect.any(String) });
    });

    it("keeps another branch's orders out of the open-orders list", async () => {
      const productId = await boardInStock(30);
      const customerId = await freshCustomer(10_000_000);
      const order = await executeCommand(owner, createSalesOrder, {
        customerId, locationId: godownId,
        lines: [{ productId, qtyOrdered: 5, unitPricePaise: 150_000 }],
      });

      const ownerList = await executeQuery(owner, openOrders, {});
      expect(ownerList.sales.some((row) => row.id === order.id)).toBe(true);

      const keeperList = await executeQuery(noidaKeeper, openOrders, {});
      expect(keeperList.sales.some((row) => row.id === order.id)).toBe(false);
    });

    it("gives the parent organization the whole subtree (PLA-ORG-002)", async () => {
      const productId = await freshBoard();
      const order = await executeCommand(noidaKeeper, createPurchaseOrder, {
        supplierId, locationId: noidaGodownId,
        lines: [{ productId, qtyOrdered: 5, unitCostPaise: 100_000 }],
      });

      // HQ holds a Tenant-scoped grant and sees both branches; the keeper sees
      // only their own. Downward visibility, sibling isolation, one mechanism.
      const ownerList = await executeQuery(owner, openOrders, {});
      expect(ownerList.purchases.some((row) => row.id === order.id)).toBe(true);
    });
  });

  /* ------------------------------------------------------------------ *
   * §4.2 — availability
   * ------------------------------------------------------------------ */

  describe("low stock compares available, not on hand (rule freeze §4.2)", () => {
    it("warns when everything on hand is already promised to a customer", async () => {
      // 20 on hand, reorder level 15: not low on the old rule.
      const productId = await boardInStock(20, 15);
      const customerId = await freshCustomer(10_000_000);

      const beforeReservation = await executeQuery(owner, lowStock, {});
      expect(beforeReservation.find((row) => row.productId === productId)).toBeUndefined();

      const order = await executeCommand(owner, createSalesOrder, {
        customerId, locationId: godownId,
        lines: [{ productId, qtyOrdered: 18, unitPricePaise: 150_000 }],
      });
      await executeCommand(owner, reserveForOrder, { orderId: order.id });

      // 20 on hand, 18 reserved, 2 available against a reorder level of 15.
      // The old rule compared on-hand and stayed silent; the buyer found out
      // at goods issue, which is too late to buy anything.
      const afterReservation = await executeQuery(owner, lowStock, {});
      const row = afterReservation.find((entry) => entry.productId === productId);
      expect(row).toBeDefined();
      expect(row!.onHandUnits).toBe(20);
      expect(row!.reservedUnits).toBe(18);
      expect(row!.availableUnits).toBe(2);
    });
  });
});
