import { z } from "zod";
import {
  registerCommand,
  ValidationError,
  type CommandDefinition,
} from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { registerNameResolver } from "@/server/platform/agent-targets";
import { ENTITY_CUSTOMER, ENTITY_SUPPLIER } from "./keys";
import { reachableGodownIds } from "./scope";
import { registerBusinessIdentity } from "./business";
import { registerTradingImport } from "./import";
import { registerTax } from "./tax";
import { registerBusinessActivities } from "./activities";
import { registerReports } from "./reports";
import { registerItc } from "./itc";
import { registerPeriods } from "./period";
import { ENTITY_BRAND, ENTITY_GODOWN_RACK } from "./keys";
import {
  goodsReceiptDetail,
  purchaseMatch,
  purchaseReviewQueue,
  raiseInvoiceNote,
  invoiceDetail,
  listInvoices,
  outstandingReceivables,
  partyBalances,
  paymentJournal,
  unbilledMovements,
  partyLedger,
  raisePurchaseInvoice,
  marginReport,
  ownerConsole,
  raiseSalesInvoice,
  recordPayment,
  recordPartyPayment,
  confirmPurchaseBill,
  raisePurchaseBillFromOrder,
  metricsHistory,
  weeklySalesTotals,
  weeklyPurchaseTotals,
  topCustomers,
  topItems,
  recentActivityFeed,
} from "./finance";
import {
  godownDetail,
  supplierPrices,
  customerPrices,
  sellableStock,
  stockLedger,
} from "./views";
import {
  adjustStock,
  issueStock,
  lowStock,
  productMovements,
  receiveStock,
  recordDamagedStock,
  recordReturnedStock,
  stockOnHand,
  transferStock,
} from "./stock";
import {
  approveCredit,
  cancelPurchaseOrder,
  cancelSalesOrder,
  createCustomer,
  createPurchaseOrder,
  createSalesOrder,
  createSupplier,
  editSalesOrder,
  editPurchaseOrder,
  removeCustomer,
  editCustomer,
  removeSupplier,
  editSupplier,
  dispatchOrder,
  customerDetail,
  listCustomers,
  listSuppliers,
  supplierDetail,
  openOrders,
  purchaseOrderDetail,
  receiveGoods,
  linkSupplierToCustomer,
  allocationPlan,
  reserveForOrder,
  salesOrderDetail,
  setCreditLimit,
  setCustomerPrice,
  setSupplierPrice,
  setPriceSheet,
  stockAvailability,
  submitPurchaseOrder,
  needsAttention,
} from "./orders";

/**
 * CAPABILITY: Trading — `verity.capability.trading`
 *
 * ADR-018. The generic order-to-cash/procure-to-pay engine extracted out of
 * `plywood`: parties, purchase/sales orders, invoicing, GST tax, payments,
 * ledger, accounting periods, stock ledger/balance, catalogue brands and
 * godown racks. None of it references a product's own attributes beyond
 * name/HSN/brand — `TradingProduct` is the generic base a capability-owned
 * detail table (like plywood's `PlywoodProductDetail`) extends.
 *
 * This capability has NO navigation of its own — it is a pure engine.
 * `plywood` (and, later, the auto-parts capability) each declare a
 * dependency on this one (`CapabilityDefinition.dependencies`) and supply
 * their own client-facing navigation over these entities.
 */

export * from "./keys";
export * from "./format";
export * from "./business";
export * from "./tax";
export * from "./period";
export * from "./stock";
export * from "./orders";
export * from "./finance";
export * from "./views";
export * from "./activities";
export * from "./reports";
export * from "./itc";
export * from "./import";

/* ================================= brands ================================= */

export const createBrand: CommandDefinition<{ name: string }, { id: string }> =
  {
    key: "verity.trading.create_brand",
    entity: ENTITY_BRAND,
    verb: "Create",
    input: z.object({ name: z.string().min(1).max(120) }),
    preconditions: async (ctx, input) => {
      // The unique index would catch this, but a named failure reads better than
      // a constraint violation on a screen.
      const clash = await ctx.tx.tradingBrand.findFirst({
        where: { name: input.name },
      });
      if (clash)
        throw new ValidationError(
          "E_VALIDATION: a brand with that name already exists",
        );
    },
    handler: async (ctx, input) => {
      const brand = await ctx.tx.tradingBrand.create({
        data: { tenantId: ctx.actor.tenantId, name: input.name },
      });
      return {
        result: { id: brand.id },
        events: [{ name: "verity.trading.brand_created", entityId: brand.id }],
      };
    },
  };

export const setBrandActive: CommandDefinition<
  { brandId: string; active: boolean },
  { id: string }
> = {
  key: "verity.trading.set_brand_active",
  entity: ENTITY_BRAND,
  verb: "Edit",
  input: z.object({ brandId: z.string().uuid(), active: z.boolean() }),
  handler: async (ctx, input) => {
    // Deactivated, never deleted. A brand that has been traded is referenced by
    // products, and eventually by ledger history that must stay readable.
    const brand = await ctx.tx.tradingBrand.update({
      where: { id: input.brandId },
      data: { active: input.active, version: { increment: 1 } },
    });
    return {
      result: { id: brand.id },
      events: [
        {
          name: input.active
            ? "verity.trading.brand_activated"
            : "verity.trading.brand_deactivated",
          entityId: brand.id,
        },
      ],
    };
  },
};

/**
 * Find-or-create, unlike `createBrand`'s create-only (clash-rejecting)
 * semantics. Task 87's own precedent (`plywood/index.ts`'s `resolveAxis`
 * for shades/textures): an import naming a brand by text cannot know
 * whether that name already exists, and refusing a whole product import
 * because "Century" was added last month is a worse answer than quietly
 * meaning the same "Century". Deliberately its own command rather than a
 * flag on `createBrand` — the two have different failure behaviour for
 * the same clash, and a flag that flips which error path runs is the
 * harder-to-read version of two named commands.
 */
export const ensureBrand: CommandDefinition<{ name: string }, { id: string }> =
  {
    key: "verity.trading.ensure_brand",
    entity: ENTITY_BRAND,
    verb: "Create",
    input: z.object({ name: z.string().min(1).max(120) }),
    handler: async (ctx, input) => {
      const existing = await ctx.tx.tradingBrand.findFirst({
        where: { name: input.name },
      });
      if (existing) return { result: { id: existing.id }, events: [] };
      const brand = await ctx.tx.tradingBrand.create({
        data: { tenantId: ctx.actor.tenantId, name: input.name },
      });
      return {
        result: { id: brand.id },
        events: [{ name: "verity.trading.brand_created", entityId: brand.id }],
      };
    },
  };

/* ============================== godown racks ============================== */

export const defineGodownRack: CommandDefinition<
  { locationId: string; rackLabel: string },
  { id: string }
> = {
  key: "verity.trading.define_godown_rack",
  entity: ENTITY_GODOWN_RACK,
  verb: "Create",
  input: z.object({
    locationId: z.string().uuid(),
    rackLabel: z.string().min(1).max(60),
  }),
  preconditions: async (ctx, input) => {
    // The composite foreign key would reject a cross-tenant Location, but a
    // named precondition is a better error than a constraint violation.
    const location = await ctx.tx.location.findUnique({
      where: { id: input.locationId },
    });
    if (!location)
      throw new ValidationError(
        "E_VALIDATION: godown not found in this tenant",
      );
    const clash = await ctx.tx.godownRack.findFirst({
      where: { locationId: input.locationId, rackLabel: input.rackLabel },
    });
    if (clash)
      throw new ValidationError(
        "E_VALIDATION: that rack already exists in this godown",
      );
  },
  handler: async (ctx, input) => {
    const rack = await ctx.tx.godownRack.create({
      data: {
        tenantId: ctx.actor.tenantId,
        locationId: input.locationId,
        rackLabel: input.rackLabel,
      },
    });
    return {
      result: { id: rack.id },
      events: [
        { name: "verity.trading.godown_rack_defined", entityId: rack.id },
      ],
    };
  },
};

export const setGodownRackActive: CommandDefinition<
  { rackId: string; active: boolean },
  { id: string }
> = {
  key: "verity.trading.set_godown_rack_active",
  entity: ENTITY_GODOWN_RACK,
  verb: "Edit",
  input: z.object({ rackId: z.string().uuid(), active: z.boolean() }),
  handler: async (ctx, input) => {
    const rack = await ctx.tx.godownRack.update({
      where: { id: input.rackId },
      data: { active: input.active, version: { increment: 1 } },
    });
    return {
      result: { id: rack.id },
      events: [
        {
          name: input.active
            ? "verity.trading.godown_rack_activated"
            : "verity.trading.godown_rack_retired",
          entityId: rack.id,
        },
      ],
    };
  },
};

export const listGodownRacks: QueryDefinition<
  { locationId?: string; includeInactive?: boolean },
  Array<{
    locationId: string;
    locationName: string;
    racks: Array<{ id: string; rackLabel: string; active: boolean }>;
  }>
> = {
  scopeHandling: "handler",
  key: "verity.trading.list_godown_racks",
  entity: ENTITY_GODOWN_RACK,
  input: z.object({
    locationId: z.string().uuid().optional(),
    includeInactive: z.boolean().optional(),
  }),
  handler: async (ctx, input) => {
    // Layer 2. Audit finding F-09: rack layout is a map of another branch's
    // godown, and it was readable tenant-wide.
    const reachable = await reachableGodownIds(
      ctx.tx,
      ctx.actor,
      ENTITY_GODOWN_RACK,
    );
    const racks = await ctx.tx.godownRack.findMany({
      where: {
        locationId: { in: reachable },
        ...(input.locationId ? { locationId: input.locationId } : {}),
        ...(input.includeInactive ? {} : { active: true }),
      },
      orderBy: [{ locationId: "asc" }, { rackLabel: "asc" }],
      include: { location: { select: { id: true, name: true } } },
    });

    // Grouped in code rather than by a second query: the row count here is
    // racks in one business's godowns, and a join already carried the name.
    const byLocation = new Map<
      string,
      {
        locationId: string;
        locationName: string;
        racks: Array<{ id: string; rackLabel: string; active: boolean }>;
      }
    >();
    for (const rack of racks) {
      const existing = byLocation.get(rack.locationId) ?? {
        locationId: rack.locationId,
        locationName: rack.location.name,
        racks: [],
      };
      existing.racks.push({
        id: rack.id,
        rackLabel: rack.rackLabel,
        active: rack.active,
      });
      byLocation.set(rack.locationId, existing);
    }
    return [...byLocation.values()];
  },
};

/* ============================== registration ============================== */

/**
 * Registers the generic trading engine. Takes no navigation — see the module
 * doc comment. A capability that depends on `trading` (its
 * `CapabilityDefinition.dependencies`, enforced by a DB trigger — same
 * mechanism every other capability prerequisite already uses) calls this
 * before registering its own commands/queries/navigation.
 */
export function registerTradingCapability(): void {
  // Task 132 A9: the assistant looks a customer or supplier up by the name someone typed; inactive ones are left out.
  registerNameResolver({
    noun: "customer",
    entity: ENTITY_CUSTOMER,
    find: async (tx, text, limit) =>
      (await tx.tradingCustomer.findMany({ where: { active: true, displayName: { contains: text, mode: "insensitive" } }, orderBy: { displayName: "asc" }, take: limit, select: { id: true, displayName: true } })).map((r) => ({ id: r.id, name: r.displayName })),
  });
  registerNameResolver({
    noun: "supplier",
    entity: ENTITY_SUPPLIER,
    find: async (tx, text, limit) =>
      (await tx.tradingSupplier.findMany({ where: { active: true, displayName: { contains: text, mode: "insensitive" } }, orderBy: { displayName: "asc" }, take: limit, select: { id: true, displayName: true } })).map((r) => ({ id: r.id, name: r.displayName })),
  });
  registerBusinessIdentity();
  registerTradingImport();
  registerTax();
  registerBusinessActivities();
  registerReports();
  registerItc();
  registerPeriods();

  registerCommand(createBrand);
  registerCommand(ensureBrand);
  registerCommand(setBrandActive);
  registerCommand(defineGodownRack);
  registerCommand(setGodownRackActive);
  registerCommand(receiveStock);
  registerCommand(issueStock);
  registerCommand(transferStock);
  registerCommand(adjustStock);
  registerCommand(recordDamagedStock);
  registerCommand(recordReturnedStock);
  registerCommand(createSupplier);
  registerCommand(editSalesOrder);
  registerCommand(editPurchaseOrder);
  registerCommand(removeCustomer);
  registerCommand(editCustomer);
  registerCommand(removeSupplier);
  registerCommand(editSupplier);
  registerCommand(setSupplierPrice);
  registerCommand(setPriceSheet);
  registerCommand(createCustomer);
  registerCommand(setCustomerPrice);
  registerCommand(setCreditLimit);
  registerCommand(createPurchaseOrder);
  registerCommand(submitPurchaseOrder);
  registerCommand(receiveGoods);
  registerCommand(linkSupplierToCustomer);
  registerCommand(cancelPurchaseOrder);
  registerCommand(createSalesOrder);
  registerCommand(approveCredit);
  registerCommand(reserveForOrder);
  registerCommand(dispatchOrder);
  registerCommand(cancelSalesOrder);
  registerCommand(raiseSalesInvoice);
  registerCommand(raisePurchaseInvoice);
  registerCommand(recordPayment);
  registerCommand(recordPartyPayment);
  registerCommand(confirmPurchaseBill);
  registerCommand(raisePurchaseBillFromOrder);
  registerCommand(raiseInvoiceNote);

  registerQuery(listGodownRacks);
  registerQuery(stockOnHand);
  registerQuery(lowStock);
  registerQuery(productMovements);
  registerQuery(purchaseMatch);
  registerQuery(goodsReceiptDetail);
  registerQuery(listSuppliers);
  registerQuery(supplierDetail);
  registerQuery(listCustomers);
  registerQuery(customerDetail);
  registerQuery(supplierPrices);
  registerQuery(customerPrices);
  registerQuery(godownDetail);
  registerQuery(stockLedger);
  registerQuery(sellableStock);
  registerQuery(purchaseReviewQueue);
  registerQuery(purchaseOrderDetail);
  registerQuery(salesOrderDetail);
  registerQuery(openOrders);
  registerQuery(stockAvailability);
  registerQuery(allocationPlan);
  registerQuery(listInvoices);
  registerQuery(invoiceDetail);
  registerQuery(outstandingReceivables);
  registerQuery(partyLedger);
  registerQuery(partyBalances);
  registerQuery(paymentJournal);
  registerQuery(unbilledMovements);
  registerQuery(ownerConsole);
  registerQuery(metricsHistory);
  registerQuery(weeklySalesTotals);
  registerQuery(weeklyPurchaseTotals);
  registerQuery(topCustomers);
  registerQuery(topItems);
  registerQuery(recentActivityFeed);
  registerQuery(needsAttention);
  registerQuery(marginReport);
}
