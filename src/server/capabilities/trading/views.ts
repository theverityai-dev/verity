import { z } from "zod";
import { reachableGodownIds } from "./scope";
import { productTaxRateMap } from "./tax";
import { type QueryDefinition } from "@/server/platform/query";
import {
  ENTITY_PRODUCT,
  ENTITY_STOCK_BALANCE,
  ENTITY_STOCK_LEDGER,
} from "./keys";
import type { TenantScopedClient } from "@/server/platform/tenancy";

/**
 * PLYWOOD — inventory drill-down projections.
 *
 * Specification: target user flow §10 (product detail), §11 (godown detail),
 * §12 (stock), §13 (the movement ledger that explains a quantity).
 * Program: taskplans/archive/53_plywood_connected_experience.md, slice 9.
 *
 * These are READS ONLY, and they are separated from `stock.ts` because they
 * answer a different question. `stock.ts` maintains the ledger and the balance
 * it summarises; this module composes those, plus orders and pricing, into the
 * shape one screen needs. Mixing the two would put page layout concerns into
 * the module that guards the append-only invariant.
 *
 * THE CANONICAL RELATIONSHIPS, restated once and never recomputed differently
 * (taskplans/45 §4.1, taskplans/53 §3):
 *
 * ```text
 * available = on_hand - reserved
 * on_hand   = sum(stock movements)
 * value     = on_hand * weighted average cost
 * ```
 *
 * `incoming` is ordered-minus-received on OPEN purchase orders only. A
 * completed order has nothing on the way and a draft has not been placed, so
 * neither contributes.
 */

/**
 * Turns a stock movement's source into a document a screen can link to.
 *
 * A movement records the receipt or issue that caused it, and those ids are NOT
 * order ids — linking `/purchases/<receiptId>` would produce a confident link
 * to nothing. §71 asks that a movement lead back to the record that explains
 * it, and the record a warehouse operator means is the order, so the hop from
 * receipt to purchase order is resolved here rather than guessed in the page.
 *
 * Batched: one query per source type for the whole page, not one per row.
 */
type MovementSource = { sourceType: string | null; sourceId: string | null };

/** Exported: `plywood/views.ts`'s `productDetail` needs it too. */
export async function resolveMovementOrders(
  tx: TenantScopedClient,
  movements: MovementSource[],
): Promise<Map<string, { orderType: "purchase" | "sales"; orderId: string }>> {
  const receiptIds = [
    ...new Set(
      movements
        .filter((m) => m.sourceType === "goods_receipt" && m.sourceId)
        .map((m) => m.sourceId!),
    ),
  ];
  const issueIds = [
    ...new Set(
      movements
        .filter((m) => m.sourceType === "goods_issue" && m.sourceId)
        .map((m) => m.sourceId!),
    ),
  ];

  const resolved = new Map<
    string,
    { orderType: "purchase" | "sales"; orderId: string }
  >();
  if (receiptIds.length > 0) {
    const receipts = await tx.tradingGoodsReceipt.findMany({
      where: { id: { in: receiptIds } },
      select: { id: true, purchaseOrderId: true },
    });
    for (const receipt of receipts) {
      resolved.set(receipt.id, {
        orderType: "purchase",
        orderId: receipt.purchaseOrderId,
      });
    }
  }
  if (issueIds.length > 0) {
    const issues = await tx.tradingGoodsIssue.findMany({
      where: { id: { in: issueIds } },
      select: { id: true, salesOrderId: true },
    });
    for (const issue of issues) {
      resolved.set(issue.id, {
        orderType: "sales",
        orderId: issue.salesOrderId,
      });
    }
  }
  return resolved;
}

/** Purchase orders that still owe the business goods. Exported: `plywood`'s
 *  own `productDetail` needs the same open-order definition. */
export const OPEN_PURCHASE_STATES = ["submitted", "receiving"];

/** Sales orders the business has committed to and not yet closed out. */
export const OPEN_SALES_STATES = ["pending_credit", "approved", "dispatching"];
/**
 * §11 — one godown: what it holds, what is promised out of it, what is coming.
 *
 * Returns null when the godown exists but is outside the actor's scope, exactly
 * as it does when the godown does not exist. Distinguishing the two would tell
 * a warehouse operator that a site they may not read is nevertheless there.
 */
export const godownDetail: QueryDefinition<
  { locationId: string },
  {
    id: string;
    name: string;
    onHandUnits: number;
    reservedUnits: number;
    availableUnits: number;
    incomingUnits: number;
    valuePaise: number;
    racks: Array<{ id: string; rackLabel: string; active: boolean }>;
    stock: Array<{
      productId: string;
      productName: string;
      brandName: string;
      onHandUnits: number;
      reservedUnits: number;
      availableUnits: number;
      avgUnitCostPaise: number;
      valuePaise: number;
      reorderLevelUnits: number;
      lowStock: boolean;
    }>;
    incoming: Array<{
      orderId: string;
      reference: string | null;
      supplierId: string;
      supplierName: string;
      state: string;
      qtyIncoming: number;
    }>;
    movements: Array<{
      id: string;
      kind: string;
      qtyDeltaUnits: number;
      productId: string;
      productName: string;
      rackLabel: string | null;
      reason: string | null;
      sourceType: string | null;
      sourceId: string | null;
      sourceNumber: string | null;
      sourceOrderType: "purchase" | "sales" | null;
      sourceOrderId: string | null;
      occurredAt: Date;
    }>;
  } | null
> = {
  scopeHandling: "handler",
  key: "verity.trading.godown_detail",
  entity: ENTITY_STOCK_BALANCE,
  input: z.object({ locationId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const reachable = await reachableGodownIds(
      ctx.tx,
      ctx.actor,
      ENTITY_STOCK_BALANCE,
    );
    if (!reachable.includes(input.locationId)) return null;

    const location = await ctx.tx.location.findUnique({
      where: { id: input.locationId },
      select: { id: true, name: true },
    });
    if (!location) return null;

    const [balances, reservations, racks, purchaseLines, movements] =
      await Promise.all([
        ctx.tx.stockBalance.findMany({
          where: { locationId: location.id },
          include: {
            product: { include: { brand: { select: { name: true } } } },
          },
        }),
        ctx.tx.tradingStockReservation.findMany({
          where: { locationId: location.id, releasedAt: null },
          select: { productId: true, qtyUnits: true },
        }),
        ctx.tx.godownRack.findMany({
          where: { locationId: location.id },
          orderBy: { rackLabel: "asc" },
          select: { id: true, rackLabel: true, active: true },
        }),
        ctx.tx.tradingPurchaseOrderLine.findMany({
          where: {
            purchaseOrder: {
              locationId: location.id,
              state: { in: OPEN_PURCHASE_STATES },
            },
          },
          include: {
            purchaseOrder: {
              select: {
                id: true,
                reference: true,
                state: true,
                supplier: { select: { id: true, displayName: true } },
              },
            },
          },
        }),
        ctx.tx.stockLedgerEntry.findMany({
          where: { locationId: location.id },
          orderBy: { occurredAt: "desc" },
          take: 50,
          include: {
            product: { select: { id: true, name: true } },
            rack: { select: { rackLabel: true } },
          },
        }),
      ]);

    const sourceOrders = await resolveMovementOrders(ctx.tx, movements);

    const reservedByProduct = new Map<string, number>();
    for (const reservation of reservations) {
      reservedByProduct.set(
        reservation.productId,
        (reservedByProduct.get(reservation.productId) ?? 0) +
          reservation.qtyUnits,
      );
    }

    const stock = balances
      .map((balance) => {
        const reserved = reservedByProduct.get(balance.productId) ?? 0;
        const available = balance.qtyUnits - reserved;
        return {
          productId: balance.productId,
          productName: balance.product.name,
          brandName: balance.product.brand.name,
          onHandUnits: balance.qtyUnits,
          reservedUnits: reserved,
          availableUnits: available,
          avgUnitCostPaise: balance.avgUnitCostPaise,
          valuePaise: balance.qtyUnits * balance.avgUnitCostPaise,
          reorderLevelUnits: balance.product.reorderLevelUnits,
          lowStock:
            balance.product.reorderLevelUnits > 0 &&
            available <= balance.product.reorderLevelUnits,
        };
      })
      .sort(
        (a, b) =>
          a.brandName.localeCompare(b.brandName) ||
          a.productName.localeCompare(b.productName),
      );

    // Grouped to the order rather than listed per line: the warehouse question
    // is "what is arriving", and one order arriving is one delivery whatever
    // the line count.
    const incomingByOrder = new Map<
      string,
      {
        orderId: string;
        reference: string | null;
        supplierId: string;
        supplierName: string;
        state: string;
        qtyIncoming: number;
      }
    >();
    for (const line of purchaseLines) {
      const outstanding = Math.max(0, line.qtyOrdered - line.qtyReceived);
      if (outstanding === 0) continue;
      const existing = incomingByOrder.get(line.purchaseOrder.id) ?? {
        orderId: line.purchaseOrder.id,
        reference: line.purchaseOrder.reference,
        supplierId: line.purchaseOrder.supplier.id,
        supplierName: line.purchaseOrder.supplier.displayName,
        state: line.purchaseOrder.state,
        qtyIncoming: 0,
      };
      existing.qtyIncoming += outstanding;
      incomingByOrder.set(line.purchaseOrder.id, existing);
    }
    const incoming = [...incomingByOrder.values()];

    return {
      id: location.id,
      name: location.name,
      onHandUnits: stock.reduce((sum, row) => sum + row.onHandUnits, 0),
      reservedUnits: stock.reduce((sum, row) => sum + row.reservedUnits, 0),
      availableUnits: stock.reduce((sum, row) => sum + row.availableUnits, 0),
      incomingUnits: incoming.reduce((sum, row) => sum + row.qtyIncoming, 0),
      valuePaise: stock.reduce((sum, row) => sum + row.valuePaise, 0),
      racks,
      stock,
      incoming,
      movements: movements.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        qtyDeltaUnits: entry.qtyDeltaUnits,
        productId: entry.productId,
        productName: entry.product.name,
        rackLabel: entry.rack?.rackLabel ?? null,
        reason: entry.reason,
        sourceOrderType: entry.sourceId
          ? (sourceOrders.get(entry.sourceId)?.orderType ?? null)
          : null,
        sourceOrderId: entry.sourceId
          ? (sourceOrders.get(entry.sourceId)?.orderId ?? null)
          : null,
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        sourceNumber: entry.sourceNumber,
        occurredAt: entry.occurredAt,
      })),
    };
  },
};

/**
 * §13 — why a quantity is what it is.
 *
 * The specification calls this "critical for warehouse staff and accountants",
 * and it is the screen that makes §9's rule enforceable: stock is never
 * hand-edited, so every sheet on hand traces to a movement that says who moved
 * it and why.
 *
 * Ordered OLDEST FIRST, unlike the recent-activity lists elsewhere, because a
 * running balance that counts downwards from the present is not a running
 * balance. The closing figure must be the last row.
 */
export const stockLedger: QueryDefinition<
  { productId: string; locationId?: string; limit?: number },
  {
    productId: string;
    productName: string;
    locationId: string | null;
    locationName: string | null;
    closingUnits: number;
    entries: Array<{
      id: string;
      kind: string;
      qtyDeltaUnits: number;
      unitCostPaise: number;
      locationId: string;
      locationName: string;
      rackLabel: string | null;
      reason: string | null;
      sourceType: string | null;
      sourceId: string | null;
      sourceNumber: string | null;
      sourceOrderType: "purchase" | "sales" | null;
      sourceOrderId: string | null;
      occurredAt: Date;
      runningBalanceUnits: number;
    }>;
  } | null
> = {
  scopeHandling: "handler",
  key: "verity.trading.stock_ledger",
  entity: ENTITY_STOCK_LEDGER,
  input: z.object({
    productId: z.string().uuid(),
    locationId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  }),
  handler: async (ctx, input) => {
    const reachable = await reachableGodownIds(
      ctx.tx,
      ctx.actor,
      ENTITY_STOCK_LEDGER,
    );

    const product = await ctx.tx.tradingProduct.findUnique({
      where: { id: input.productId },
      select: { id: true, name: true },
    });
    if (!product) return null;

    // An explicit godown is INTERSECTED with the reachable set rather than
    // replacing it, so naming another branch's godown returns nothing instead
    // of returning its ledger.
    const locationIds = input.locationId
      ? reachable.filter((id) => id === input.locationId)
      : reachable;

    const entries = await ctx.tx.stockLedgerEntry.findMany({
      where: { productId: product.id, locationId: { in: locationIds } },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: input.limit ?? 500,
      include: {
        location: { select: { id: true, name: true } },
        rack: { select: { rackLabel: true } },
      },
    });

    const sourceOrders = await resolveMovementOrders(ctx.tx, entries);

    let running = 0;
    const rows = entries.map((entry) => {
      running += entry.qtyDeltaUnits;
      return {
        id: entry.id,
        kind: entry.kind,
        qtyDeltaUnits: entry.qtyDeltaUnits,
        unitCostPaise: entry.unitCostPaise,
        locationId: entry.locationId,
        locationName: entry.location.name,
        rackLabel: entry.rack?.rackLabel ?? null,
        reason: entry.reason,
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        sourceNumber: entry.sourceNumber,
        sourceOrderType: entry.sourceId
          ? (sourceOrders.get(entry.sourceId)?.orderType ?? null)
          : null,
        sourceOrderId: entry.sourceId
          ? (sourceOrders.get(entry.sourceId)?.orderId ?? null)
          : null,
        occurredAt: entry.occurredAt,
        runningBalanceUnits: running,
      };
    });

    const named =
      input.locationId && locationIds.length === 1
        ? (entries[0]?.location ?? null)
        : null;

    return {
      productId: product.id,
      productName: product.name,
      locationId:
        input.locationId && locationIds.length === 1 ? input.locationId : null,
      locationName: named?.name ?? null,
      closingUnits: running,
      entries: rows,
    };
  },
};

/**
 * What can actually be sold, per board, per godown, with the agreed price.
 *
 * Audit findings U0-1 and U1-8. The sales-order form asked for a godown and a
 * board and told the salesperson nothing about either: not whether that godown
 * held any, and not what the customer's agreed price was. The result was an
 * order that could be created and APPROVED and then failed at reservation —
 * after the customer had been told yes — with an error that named neither the
 * quantity available elsewhere nor the missing price.
 *
 * Returned for every reachable godown at once rather than per selection, so the
 * form can react as the user changes either dropdown without another round
 * trip, and can show availability on the option itself.
 */
export const sellableStock: QueryDefinition<
  { customerId?: string },
  Array<{
    productId: string;
    productName: string;
    brandName: string;
    /// SERVICE products are excluded — they are not held in a godown.
    locationId: string;
    locationName: string;
    onHandUnits: number;
    reservedUnits: number;
    availableUnits: number;
    /// The customer's agreed price, when one was asked for and exists.
    agreedPricePaise: number | null;
    /**
     * The GST rate in force for this board's HSN today, in basis points —
     * 1800 for 18%.
     *
     * The COMBINED rate, deliberately, not a CGST/SGST/IGST split. The form
     * needs it to show an order total including tax before the order is placed,
     * and 18% is 18% whether it is collected as 9+9 within the state or as 18
     * across a border, so the split would be three numbers the form could get
     * wrong for no gain. Null only when neither a rule for the HSN nor the
     * tenant's default rate exists — the form then says the tax is unknown
     * rather than showing a total that is short.
     */
    taxRateBp: number | null;
  }>
> = {
  scopeHandling: "handler",
  key: "verity.trading.sellable_stock",
  entity: ENTITY_STOCK_BALANCE,
  input: z.object({ customerId: z.string().uuid().optional() }),
  handler: async (ctx, input) => {
    const reachable = await reachableGodownIds(
      ctx.tx,
      ctx.actor,
      ENTITY_STOCK_BALANCE,
    );

    const [balances, reservations, prices] = await Promise.all([
      ctx.tx.stockBalance.findMany({
        where: {
          locationId: { in: reachable },
          product: { active: true, type: "PHYSICAL" },
        },
        include: {
          product: { include: { brand: { select: { name: true } } } },
          location: { select: { name: true } },
        },
      }),
      ctx.tx.tradingStockReservation.findMany({
        where: { locationId: { in: reachable }, releasedAt: null },
        select: { productId: true, locationId: true, qtyUnits: true },
      }),
      input.customerId
        ? ctx.tx.tradingCustomerPrice.findMany({
            where: { customerId: input.customerId },
            select: { productId: true, customPricePaise: true },
          })
        : Promise.resolve([]),
    ]);

    // The rate in force today for every product, resolved by the SAME
    // function the order form's purchase side and the invoice use
    // (`productTaxRateMap`): per-HSN rule where one exists, the tenant's
    // configured default otherwise — including for a product that has no
    // HSN at all, since the catalogue stopped demanding one. This query used
    // to carry its own copy that stopped at the HSN rule and returned null
    // for everything else, so a board with no HSN showed "no GST rule" here
    // while the invoice would have taxed it at the default: the form was
    // under-quoting exactly the orders nobody would check. One resolver.
    const rateByProduct = await productTaxRateMap(ctx.tx);

    const reservedBy = new Map<string, number>();
    for (const hold of reservations) {
      const key = `${hold.productId}:${hold.locationId}`;
      reservedBy.set(key, (reservedBy.get(key) ?? 0) + hold.qtyUnits);
    }
    const priceBy = new Map(
      prices.map((price) => [price.productId, price.customPricePaise]),
    );

    return balances
      .map((balance) => {
        const reserved =
          reservedBy.get(`${balance.productId}:${balance.locationId}`) ?? 0;
        return {
          productId: balance.productId,
          productName: balance.product.name,
          brandName: balance.product.brand.name,
          locationId: balance.locationId,
          locationName: balance.location.name,
          onHandUnits: balance.qtyUnits,
          reservedUnits: reserved,
          availableUnits: balance.qtyUnits - reserved,
          agreedPricePaise: priceBy.get(balance.productId) ?? null,
          // Null only when the tenant has neither a rule for the HSN nor a
          // configured default — genuinely not known, never "no HSN".
          taxRateBp: rateByProduct.get(balance.productId) ?? null,
        };
      })
      .sort(
        (a, b) =>
          a.locationName.localeCompare(b.locationName) ||
          a.brandName.localeCompare(b.brandName) ||
          a.productName.localeCompare(b.productName),
      );
  },
};

/**
 * Every agreed supplier price, flat.
 *
 * TASK 71 ITEM 8 — "if I have set an agreed price for a supplier, it should
 * autofill the price per unit." The command has always fallen back to the
 * negotiated price when the cost is left blank, but the form could not SHOW
 * that price, so the buyer had a box labelled "blank uses agreed price" and no
 * way to know what would happen. The sales desk already solved this; the
 * purchase desk had no equivalent read.
 *
 * Flat rather than nested by supplier: the form needs a lookup keyed on
 * (supplier, product) and rebuilding that from a nested shape on every
 * keystroke is work the query can do once.
 */
export const supplierPrices: QueryDefinition<
  Record<string, never>,
  Array<{
    supplierId: string;
    productId: string;
    negotiatedCostPaise: number;
  }>
> = {
  key: "verity.trading.supplier_prices",
  entity: ENTITY_PRODUCT,
  input: z.object({}),
  handler: async (ctx) => {
    const rows = await ctx.tx.tradingSupplierPrice.findMany({
      select: {
        supplierId: true,
        productId: true,
        negotiatedCostPaise: true,
      },
    });
    return rows;
  },
};


/**
 * Every agreed customer price, flat — the selling-side twin of `supplierPrices`.
 */
export const customerPrices: QueryDefinition<
  Record<string, never>,
  Array<{ customerId: string; productId: string; customPricePaise: number }>
> = {
  key: "verity.trading.customer_prices",
  entity: ENTITY_PRODUCT,
  input: z.object({}),
  handler: async (ctx) => {
    return ctx.tx.tradingCustomerPrice.findMany({
      select: { customerId: true, productId: true, customPricePaise: true },
    });
  },
};
