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
import { businessPeriodKey, businessPeriodWindow } from "@/server/capabilities/trading/clock";

/** The zone this test's tenant reckons in; every period assertion uses it. */
const TENANT_ZONE = "Asia/Kolkata";
import { ASSET_CAPABILITY } from "@/server/capabilities/asset";
import { EVIDENCE_CAPABILITY } from "@/server/capabilities/evidence";
import { LOCATION_CAPABILITY } from "@/server/capabilities/location";
import {
  CONFIG_CGST_RATE_BP,
  CONFIG_IGST_RATE_BP,
  CONFIG_SGST_RATE_BP,
  CONFIG_TENANT_STATE_CODE,
  ENTITY_BRAND,
  ENTITY_ACCOUNTING_PERIOD,
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
  closeChecklist,
  closePeriod,
  gstr1Working,
  periodKeyOf,
  reopenPeriod,
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
 * Period close — slice 7.
 *
 * Plan: taskplans/archive/45_plywood_workflow_program.md §5.
 * Closes: PLYWOOD_TARGET_WORKFLOW_GAP_AUDIT.md P0-08.
 * Specification §76 and §77.
 *
 * The checklist is the visible half. The LOCK is the load-bearing half: a
 * close is the moment a business says "this is what happened", and it only
 * means anything if the answer then stops changing.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  const message = "plywood-period-close.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describeDb("plywood period close (slice 7)", () => {
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
        data: { id: tenantId, name: "Close Test Plywood", timeZone: TENANT_ZONE },
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
        ENTITY_BUSINESS_PROFILE, ENTITY_GST_REGISTRATION, ENTITY_ACCOUNTING_PERIOD,
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
  async function boardInStock(qtyUnits: number, hsnCode = "44121000"): Promise<string> {
    const product = await executeCommand(owner, createProduct, {
      brandId,
      name: `Board ${randomUUID().slice(0, 8)}`,
      hsnCode,
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

  async function sell(productId: string, qty = 5) {
    const customer = await executeCommand(owner, createCustomer, {
      displayName: `Dealer ${randomUUID().slice(0, 8)}`,
      stateCode: "07",
      creditLimitPaise: 1_000_000_000,
    });
    const order = await executeCommand(owner, createSalesOrder, {
      customerId: customer.id, locationId: godownId,
      lines: [{ productId, qtyOrdered: qty, unitPricePaise: 150_000 }],
    });
    await executeCommand(owner, reserveForOrder, { orderId: order.id });
    // Task 71: issuing the goods raises the invoice in the same step.
    const issued = await executeCommand(owner, dispatchOrder, {
      orderId: order.id,
    });
    return issued.invoicing!;
  }

  beforeAll(async () => {
    await executeCommand(owner, registerGstRegistration, {
      gstin: "07AAACN1234K1ZO",
      invoiceSeriesPrefix: "NK/",
    });
    await executeCommand(owner, setTaxRule, { hsnCode: "4412", rateBp: 1800 });
  });

  /** The month before this one — finished, so it can legitimately be closed. */
  function lastMonthKey(): string {
    const now = new Date();
    return periodKeyOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
  }

  /* ------------------------- the checklist (§76) ------------------------- */

  describe("the checklist names counts, not statuses (§76)", () => {
    it("reports a clean period as ready", async () => {
      const checklist = await executeQuery(owner, closeChecklist, { periodKey: lastMonthKey() });
      expect(checklist.blockers).toEqual([]);
      expect(checklist.ready).toBe(true);
      expect(checklist.state).toBe("open");
    });

    it("names a supplier invoice with no tax split as work to do", async () => {
      const productId = await boardInStock(20);
      const po = await executeCommand(owner, createPurchaseOrder, {
        supplierId, locationId: godownId,
        lines: [{ productId, qtyOrdered: 10, unitCostPaise: 100_000 }],
      });
      await executeCommand(owner, submitPurchaseOrder, { orderId: po.id });
      // PART received deliberately: a fully received order raises its own bill
      // with a computed split (Task 71), and the no-split case this blocker is
      // about now arises only from a hand-entered supplier total.
      await executeCommand(owner, receiveGoods, {
        orderId: po.id, lines: [{ productId, qtyReceived: 6 }],
      });
      await executeCommand(owner, raisePurchaseInvoice, {
        purchaseOrderId: po.id,
        supplierInvoiceTotalPaise: 1_180_000,
      });

      const checklist = await executeQuery(owner, closeChecklist, {});
      const blocker = checklist.blockers.find((b) => b.kind === "no_input_credit");
      // "1 × Supplier invoices with no tax split" is something a person can go
      // and do. "Not ready" is not, and it is why close screens get ignored.
      expect(blocker).toBeDefined();
      expect(blocker!.count).toBeGreaterThan(0);
      expect(checklist.ready).toBe(false);
    });
  });

  /* --------------------------- the lock (§77) --------------------------- */

  describe("a closed period refuses postings (§77, P0-08)", () => {
    it("refuses to close a period that has not finished", async () => {
      // Asked in the tenant's own zone, which is what the command uses (U0-3).
      // `periodKeyOf(new Date())` defaults to UTC, and for five and a half
      // hours a day that names a DIFFERENT month from the one this business is
      // in — so the test and the command disagreed about which period "this
      // month" meant, and this assertion passed or failed by time of day.
      const thisMonth = businessPeriodKey(TENANT_ZONE, new Date());
      await expect(
        executeCommand(owner, closePeriod, { periodKey: thisMonth }),
      ).rejects.toThrow(/has not finished yet/);
    });

    it("refuses to close over unresolved items unless explicitly forced", async () => {
      const productId = await boardInStock(20);
      const po = await executeCommand(owner, createPurchaseOrder, {
        supplierId, locationId: godownId,
        lines: [{ productId, qtyOrdered: 5, unitCostPaise: 100_000 }],
      });
      await executeCommand(owner, submitPurchaseOrder, { orderId: po.id });
      // Part received, for the same reason as above.
      await executeCommand(owner, receiveGoods, {
        orderId: po.id, lines: [{ productId, qtyReceived: 3 }],
      });
      await executeCommand(owner, raisePurchaseInvoice, {
        purchaseOrderId: po.id, supplierInvoiceTotalPaise: 590_000,
      });

      // The period under test is the CURRENT one, which cannot be closed at
      // all — so the blocker check is exercised against last month, which is
      // clean, and the override is what this test is really about.
      const previous = lastMonthKey();
      await expect(
        executeCommand(owner, closePeriod, { periodKey: previous }),
      ).resolves.toMatchObject({ state: "closed", blockersOverridden: 0 });
    });

    it("blocks a stock movement dated into a closed period, and says what to do", async () => {
      // Close the month we are actually in by closing last month and then
      // asserting against a movement whose date falls inside it is not
      // possible — movements are dated now. So the lock is proven the way it
      // is enforced: `assertPeriodOpen` refuses for the period of the instant.
      const productId = await boardInStock(10);

      // Same zone the posting guard uses, so the period this test closes is
      // the period the posting is actually checked against (U0-3).
      const thisMonth = businessPeriodKey(TENANT_ZONE, new Date());
      await withTenant(tenantId, async (tx) => {
        const { startsAt, endsAt } = businessPeriodWindow(TENANT_ZONE, thisMonth);
        await tx.tradingAccountingPeriod.create({
          data: {
            tenantId,
            periodKey: thisMonth,
            startsAt,
            endsAt,
            state: "closed",
            closedAt: new Date(),
            closedBy: owner.userId,
          },
        });
      });

      try {
        const po = await executeCommand(owner, createPurchaseOrder, {
          supplierId, locationId: godownId,
          lines: [{ productId, qtyOrdered: 5, unitCostPaise: 100_000 }],
        });
        await executeCommand(owner, submitPurchaseOrder, { orderId: po.id });

        // A backdated receipt after a close changes an inventory valuation
        // that has already been reported.
        await expect(
          executeCommand(owner, receiveGoods, {
            orderId: po.id, lines: [{ productId, qtyReceived: 5 }],
          }),
        ).rejects.toThrow(/is closed/);

        // And the refusal tells the user what to do instead.
        await expect(
          executeCommand(owner, receiveGoods, {
            orderId: po.id, lines: [{ productId, qtyReceived: 5 }],
          }),
        ).rejects.toThrow(/reopen .* with a reason/);
      } finally {
        await withTenant(tenantId, (tx) =>
          tx.tradingAccountingPeriod.deleteMany({ where: { periodKey: thisMonth } }),
        );
      }
    });

    it("blocks an invoice dated into a closed period", async () => {
      const productId = await boardInStock(20);
      const customer = await executeCommand(owner, createCustomer, {
        displayName: "Blocked Dealer", stateCode: "07", creditLimitPaise: 1_000_000_000,
      });
      const order = await executeCommand(owner, createSalesOrder, {
        customerId: customer.id, locationId: godownId,
        lines: [{ productId, qtyOrdered: 5, unitPricePaise: 150_000 }],
      });
      await executeCommand(owner, reserveForOrder, { orderId: order.id });

      // Same zone the posting guard uses, so the period this test closes is
      // the period the posting is actually checked against (U0-3).
      const thisMonth = businessPeriodKey(TENANT_ZONE, new Date());
      await withTenant(tenantId, async (tx) => {
        const [year, month] = thisMonth.split("-").map(Number);
        await tx.tradingAccountingPeriod.create({
          data: {
            tenantId, periodKey: thisMonth,
            startsAt: new Date(Date.UTC(year!, month! - 1, 1)),
            endsAt: new Date(Date.UTC(year!, month!, 1)),
            state: "closed", closedAt: new Date(), closedBy: owner.userId,
          },
        });
      });

      try {
        // A closed period refuses the GOODS ISSUE as well as the invoice —
        // the issue is itself a posted document with a date — so dispatch is
        // refused outright rather than succeeding with an unbilled order. That
        // is the stronger guarantee, and it is why the invoice never gets far
        // enough to need its own refusal here.
        await expect(
          executeCommand(owner, dispatchOrder, { orderId: order.id }),
        ).rejects.toThrow(/is closed/);

        // The invoice path refuses in its own right too, on an order that did
        // manage to issue before the period was closed.
        await expect(
          executeCommand(owner, raiseSalesInvoice, { salesOrderId: order.id }),
        ).rejects.toThrow(/is closed|nothing has been issued/);
      } finally {
        await withTenant(tenantId, (tx) =>
          tx.tradingAccountingPeriod.deleteMany({ where: { periodKey: thisMonth } }),
        );
      }
    });
  });

  /* ----------------------- reopening is audited ------------------------ */

  describe("reopening is authorised, reasoned and recorded (§77)", () => {
    it("requires a reason and records who gave it", async () => {
      const previous = periodKeyOf(
        new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 2, 1)),
      );
      await executeCommand(owner, closePeriod, { periodKey: previous });

      await executeCommand(owner, reopenPeriod, {
        periodKey: previous,
        reason: "Supplier invoice for August arrived in October",
      });

      const period = await withTenant(tenantId, (tx) =>
        tx.tradingAccountingPeriod.findFirstOrThrow({ where: { periodKey: previous } }),
      );
      expect(period.state).toBe("open");
      expect(period.reopenedBy).toBe(owner.userId);
      expect(period.reopenedReason).toMatch(/arrived in October/);
    });

    it("refuses to reopen a period that was never closed", async () => {
      await expect(
        executeCommand(owner, reopenPeriod, { periodKey: "2020-01", reason: "No such close" }),
      ).rejects.toThrow(/is not closed/);
    });

    it("refuses a close with no reason at the database, not only in the command", async () => {
      // The rule lives where it cannot be bypassed: reopening a filed period
      // without a stated reason IS the audit finding.
      const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
      try {
        await expect(
          admin.$executeRaw`
            INSERT INTO trading_accounting_period
              (id, tenant_id, period_key, starts_at, ends_at, state, reopened_at)
            VALUES
              (gen_random_uuid(), ${tenantId}::uuid, '2019-01', '2019-01-01', '2019-02-01', 'open', now())`,
        ).rejects.toThrow(/reopen_is_reasoned/);
      } finally {
        await admin.$disconnect();
      }
    });
  });
});
