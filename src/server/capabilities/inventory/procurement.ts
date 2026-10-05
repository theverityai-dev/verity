import { z } from "zod";
import { registerCommand, ValidationError, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { resolveConfig } from "@/server/platform/capability";
import { applyMovement } from "./ledger";
import { ENTITY_INVENTORY_STOCK } from "./kinds";

/**
 * Inventory procurement: vendors, purchase orders, goods receipts
 * (Colonel Kebabz parity, `procurement.md` §7; decision 2026-10-06 in
 * `clients/colonel-kebabz/reference-parity/DECISIONS.md`).
 *
 * Inventory-native on purpose: trading's purchase flow (plywood) is untouched.
 * Receiving goods posts `Receipt` movements through the same ledger a count or a
 * sale uses, so there is one stock ledger and one moving-average cost.
 *
 * Lifecycle: Draft -> (Submit) -> Approved, or PendingApproval when the total is
 * over the tenant's threshold -> (Approve) -> Approved -> PartiallyReceived ->
 * Received. Cancel is allowed until something has been received. There is no
 * "Sent" state: Verity has no outbound email or WhatsApp transport yet, and a
 * state that claims a message went out when it did not would be false.
 */

export const ENTITY_INVENTORY_VENDOR = "verity.inventory.vendor";
export const ENTITY_INVENTORY_PURCHASE_ORDER = "verity.inventory.purchase_order";

export const PO_STATUSES = ["Draft", "PendingApproval", "Approved", "PartiallyReceived", "Received", "Cancelled"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

/**
 * An order whose total is over this many paise waits for approval. The owner
 * changes it in settings; this is the default (Rs 25,000), decided 2026-10-06.
 */
export const CONFIG_PO_APPROVAL_THRESHOLD = "verity.inventory.po_approval_threshold_paise";
export const DEFAULT_PO_APPROVAL_THRESHOLD_PAISE = 2_500_000;

export function poNumber(seq: number): string {
  return `PO-${String(seq).padStart(4, "0")}`;
}

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

/* ================================== vendors ================================== */

export const createVendor: CommandDefinition<
  { name: string; gstin?: string; phone?: string; paymentTermsDays?: number },
  { id: string }
> = {
  key: "verity.inventory.create_vendor",
  entity: ENTITY_INVENTORY_VENDOR,
  verb: "Create",
  input: z.object({
    name: z.string().trim().min(1).max(200),
    gstin: z.string().trim().toUpperCase().regex(GSTIN, "enter a 15-character GSTIN").optional(),
    phone: z.string().trim().min(5).max(20).optional(),
    paymentTermsDays: z.number().int().min(0).max(365).optional(),
  }),
  preconditions: async (ctx, input) => {
    if (await ctx.tx.inventoryVendor.findFirst({ where: { name: input.name } })) {
      throw new ValidationError("E_VALIDATION: a vendor with that name already exists");
    }
  },
  handler: async (ctx, input) => {
    const vendor = await ctx.tx.inventoryVendor.create({
      data: {
        tenantId: ctx.actor.tenantId,
        name: input.name,
        gstin: input.gstin ?? null,
        phone: input.phone ?? null,
        paymentTermsDays: input.paymentTermsDays ?? 0,
      },
    });
    return { result: { id: vendor.id }, events: [{ name: "verity.inventory.vendor_created", entityId: vendor.id }] };
  },
};

export const setVendorActive: CommandDefinition<{ vendorId: string; active: boolean }, { id: string }> = {
  key: "verity.inventory.set_vendor_active",
  entity: ENTITY_INVENTORY_VENDOR,
  verb: "Edit",
  input: z.object({ vendorId: z.string().uuid(), active: z.boolean() }),
  preconditions: async (ctx, input) => {
    if (!(await ctx.tx.inventoryVendor.findUnique({ where: { id: input.vendorId } }))) {
      throw new ValidationError("E_VALIDATION: vendor not found in this tenant");
    }
  },
  handler: async (ctx, input) => {
    await ctx.tx.inventoryVendor.update({ where: { id: input.vendorId }, data: { active: input.active } });
    return { result: { id: input.vendorId }, events: [] };
  },
};

export const listVendors: QueryDefinition<
  Record<string, never>,
  Array<{ id: string; name: string; gstin: string | null; phone: string | null; paymentTermsDays: number; active: boolean; orders: number }>
> = {
  key: "verity.inventory.list_vendors",
  entity: ENTITY_INVENTORY_VENDOR,
  input: z.object({}),
  handler: async (ctx) => {
    const rows = await ctx.tx.inventoryVendor.findMany({
      include: { _count: { select: { purchaseOrders: true } } },
      orderBy: { name: "asc" },
    });
    return rows.map((v) => ({
      id: v.id,
      name: v.name,
      gstin: v.gstin,
      phone: v.phone,
      paymentTermsDays: v.paymentTermsDays,
      active: v.active,
      orders: v._count.purchaseOrders,
    }));
  },
};

/* ============================== purchase orders ============================== */

type CreateOrderInput = {
  vendorId: string;
  locationId: string;
  expectedDate?: string;
  notes?: string;
  lines: Array<{ itemId: string; qty: number; unitPricePaise: number }>;
};

export const createPurchaseOrder: CommandDefinition<CreateOrderInput, { id: string; number: string; totalPaise: number }> = {
  key: "verity.inventory.create_purchase_order",
  entity: ENTITY_INVENTORY_PURCHASE_ORDER,
  verb: "Create",
  input: z.object({
    vendorId: z.string().uuid(),
    locationId: z.string().uuid(),
    expectedDate: isoDate.optional(),
    notes: z.string().trim().max(500).optional(),
    lines: z
      .array(
        z.object({
          itemId: z.string().uuid(),
          qty: z.number().int().min(1),
          unitPricePaise: z.number().int().min(0),
        }),
      )
      .min(1)
      .max(100),
  }),
  preconditions: async (ctx, input) => {
    const vendor = await ctx.tx.inventoryVendor.findUnique({ where: { id: input.vendorId } });
    if (!vendor) throw new ValidationError("E_VALIDATION: vendor not found in this tenant");
    if (!vendor.active) throw new ValidationError("E_VALIDATION: vendor is deactivated");
    if (!(await ctx.tx.location.findUnique({ where: { id: input.locationId }, select: { id: true } }))) {
      throw new ValidationError("E_VALIDATION: outlet not found in this tenant");
    }
    const ids = input.lines.map((l) => l.itemId);
    if (new Set(ids).size !== ids.length) throw new ValidationError("E_VALIDATION: an item appears twice on the order");
    const items = await ctx.tx.inventoryItem.findMany({ where: { id: { in: ids } }, select: { active: true } });
    if (items.length !== ids.length) throw new ValidationError("E_VALIDATION: an item is not in this tenant");
    if (items.some((i) => !i.active)) throw new ValidationError("E_VALIDATION: a deactivated item cannot be ordered");
  },
  handler: async (ctx, input) => {
    const order = await insertOrder(ctx, input);
    return {
      result: order,
      events: [{ name: "verity.inventory.purchase_order_created", entityId: order.id }],
    };
  },
};

/** Writes a draft order and its lines; numbering is per tenant. */
async function insertOrder(
  ctx: { tx: import("@/server/platform/tenancy").TenantScopedClient; actor: { tenantId: string; userId: string } },
  input: CreateOrderInput,
): Promise<{ id: string; number: string; totalPaise: number }> {
  const last = await ctx.tx.inventoryPurchaseOrder.findFirst({ orderBy: { seq: "desc" }, select: { seq: true } });
  const seq = (last?.seq ?? 0) + 1;
  const totalPaise = input.lines.reduce((sum, l) => sum + l.qty * l.unitPricePaise, 0);
  const order = await ctx.tx.inventoryPurchaseOrder.create({
    data: {
      tenantId: ctx.actor.tenantId,
      seq,
      vendorId: input.vendorId,
      locationId: input.locationId,
      expectedDate: input.expectedDate ? new Date(`${input.expectedDate}T00:00:00.000Z`) : null,
      notes: input.notes ?? null,
      totalPaise,
      createdById: ctx.actor.userId,
      lines: {
        create: input.lines.map((l) => ({
          tenantId: ctx.actor.tenantId,
          itemId: l.itemId,
          qty: l.qty,
          unitPricePaise: l.unitPricePaise,
        })),
      },
    },
  });
  return { id: order.id, number: poNumber(seq), totalPaise };
}

/**
 * Items at an outlet that are at or below their reorder level, with the
 * quantity that brings each back to twice the reorder level (one cover of
 * buffer, decided 2026-10-06) and its last known cost.
 */
async function lowStockLines(tx: import("@/server/platform/tenancy").TenantScopedClient, locationId: string) {
  const items = await tx.inventoryItem.findMany({
    where: { active: true, reorderLevel: { gt: 0 } },
    select: { id: true, reorderLevel: true, avgUnitCostPaise: true },
  });
  const balances = await tx.inventoryStockBalance.findMany({
    where: { locationId, itemId: { in: items.map((i) => i.id) } },
    select: { itemId: true, qty: true },
  });
  const onHand = new Map(balances.map((b) => [b.itemId, b.qty]));
  return items
    .filter((i) => (onHand.get(i.id) ?? 0) <= i.reorderLevel)
    .map((i) => ({
      itemId: i.id,
      qty: Math.max(i.reorderLevel * 2 - (onHand.get(i.id) ?? 0), 1),
      unitPricePaise: i.avgUnitCostPaise ?? 0,
    }));
}

/**
 * PRD §21's first step: low stock becomes a draft order. The buyer reviews the
 * quantities and prices on the draft before submitting, so nothing is bought
 * without a person looking at it.
 */
export const draftOrderFromLowStock: CommandDefinition<
  { vendorId: string; locationId: string },
  { id: string; number: string; totalPaise: number; lines: number }
> = {
  key: "verity.inventory.draft_order_from_low_stock",
  entity: ENTITY_INVENTORY_PURCHASE_ORDER,
  verb: "Create",
  input: z.object({ vendorId: z.string().uuid(), locationId: z.string().uuid() }),
  preconditions: async (ctx, input) => {
    const vendor = await ctx.tx.inventoryVendor.findUnique({ where: { id: input.vendorId } });
    if (!vendor) throw new ValidationError("E_VALIDATION: vendor not found in this tenant");
    if (!vendor.active) throw new ValidationError("E_VALIDATION: vendor is deactivated");
    if (!(await ctx.tx.location.findUnique({ where: { id: input.locationId }, select: { id: true } }))) {
      throw new ValidationError("E_VALIDATION: outlet not found in this tenant");
    }
    if ((await lowStockLines(ctx.tx, input.locationId)).length === 0) {
      throw new ValidationError("E_VALIDATION: nothing at this outlet is at or below its reorder level");
    }
  },
  handler: async (ctx, input) => {
    const lines = await lowStockLines(ctx.tx, input.locationId);
    const order = await insertOrder(ctx, {
      vendorId: input.vendorId,
      locationId: input.locationId,
      notes: "Drafted from low stock. Check quantities and prices before submitting.",
      lines,
    });
    return {
      result: { ...order, lines: lines.length },
      events: [{ name: "verity.inventory.purchase_order_created", entityId: order.id, payload: { source: "low_stock" } }],
    };
  },
};

async function loadOrder(tx: import("@/server/platform/tenancy").TenantScopedClient, orderId: string) {
  const order = await tx.inventoryPurchaseOrder.findUnique({ where: { id: orderId }, include: { lines: true } });
  if (!order) throw new ValidationError("E_VALIDATION: purchase order not found in this tenant");
  return order;
}

export const submitPurchaseOrder: CommandDefinition<{ orderId: string }, { id: string; status: PoStatus }> = {
  key: "verity.inventory.submit_purchase_order",
  entity: ENTITY_INVENTORY_PURCHASE_ORDER,
  verb: "Edit",
  input: z.object({ orderId: z.string().uuid() }),
  preconditions: async (ctx, input) => {
    const order = await loadOrder(ctx.tx, input.orderId);
    if (order.status !== "Draft") throw new ValidationError(`E_VALIDATION: only a draft can be submitted (this one is ${order.status})`);
  },
  handler: async (ctx, input) => {
    const order = await loadOrder(ctx.tx, input.orderId);
    const threshold = (await resolveConfig<number>(ctx.tx, CONFIG_PO_APPROVAL_THRESHOLD)) ?? DEFAULT_PO_APPROVAL_THRESHOLD_PAISE;
    const status: PoStatus = order.totalPaise > threshold ? "PendingApproval" : "Approved";
    await ctx.tx.inventoryPurchaseOrder.update({ where: { id: order.id }, data: { status } });
    return {
      result: { id: order.id, status },
      events: [{ name: "verity.inventory.purchase_order_submitted", entityId: order.id, payload: { status } }],
    };
  },
};

export const approvePurchaseOrder: CommandDefinition<{ orderId: string }, { id: string }> = {
  key: "verity.inventory.approve_purchase_order",
  entity: ENTITY_INVENTORY_PURCHASE_ORDER,
  verb: "ActionExecute",
  input: z.object({ orderId: z.string().uuid() }),
  preconditions: async (ctx, input) => {
    const order = await loadOrder(ctx.tx, input.orderId);
    if (order.status !== "PendingApproval") {
      throw new ValidationError(`E_VALIDATION: only an order waiting for approval can be approved (this one is ${order.status})`);
    }
  },
  handler: async (ctx, input) => {
    await ctx.tx.inventoryPurchaseOrder.update({
      where: { id: input.orderId },
      data: { status: "Approved", approvedById: ctx.actor.userId, approvedAt: new Date() },
    });
    return { result: { id: input.orderId }, events: [{ name: "verity.inventory.purchase_order_approved", entityId: input.orderId }] };
  },
};

export const cancelPurchaseOrder: CommandDefinition<{ orderId: string; reason: string }, { id: string }> = {
  key: "verity.inventory.cancel_purchase_order",
  entity: ENTITY_INVENTORY_PURCHASE_ORDER,
  verb: "Edit",
  input: z.object({ orderId: z.string().uuid(), reason: z.string().trim().min(1).max(300) }),
  preconditions: async (ctx, input) => {
    const order = await loadOrder(ctx.tx, input.orderId);
    if (!["Draft", "PendingApproval", "Approved"].includes(order.status)) {
      throw new ValidationError(`E_VALIDATION: a ${order.status} order cannot be cancelled`);
    }
    if (order.lines.some((l) => l.receivedQty > 0 || l.rejectedQty > 0)) {
      throw new ValidationError("E_VALIDATION: goods have already been received against this order");
    }
  },
  handler: async (ctx, input) => {
    await ctx.tx.inventoryPurchaseOrder.update({
      where: { id: input.orderId },
      data: { status: "Cancelled", cancelReason: input.reason },
    });
    return { result: { id: input.orderId }, events: [{ name: "verity.inventory.purchase_order_cancelled", entityId: input.orderId }] };
  },
};

/* ================================ goods receipt ================================ */

type ReceiveInput = {
  orderId: string;
  invoiceRef?: string;
  lines: Array<{ orderLineId: string; acceptedQty: number; rejectedQty?: number; rejectReason?: string; unitPricePaise?: number }>;
};

/**
 * Records goods arriving at the outlet. Accepted quantity goes into stock at the
 * price actually charged; rejected quantity is recorded with its reason and does
 * not count as received, so the line stays open for the replacement. Entity is
 * the stock ledger because this is a stock operation: whoever may receive stock
 * may receive against an order.
 */
export const receiveGoods: CommandDefinition<ReceiveInput, { receiptId: string; status: PoStatus; stockedLines: number }> = {
  key: "verity.inventory.receive_goods",
  entity: ENTITY_INVENTORY_STOCK,
  verb: "Create",
  input: z.object({
    orderId: z.string().uuid(),
    invoiceRef: z.string().trim().max(100).optional(),
    lines: z
      .array(
        z.object({
          orderLineId: z.string().uuid(),
          acceptedQty: z.number().int().min(0),
          rejectedQty: z.number().int().min(0).optional(),
          rejectReason: z.string().trim().min(1).max(200).optional(),
          unitPricePaise: z.number().int().min(0).optional(),
        }),
      )
      .min(1)
      .max(100),
  }),
  preconditions: async (ctx, input) => {
    const order = await loadOrder(ctx.tx, input.orderId);
    if (order.status !== "Approved" && order.status !== "PartiallyReceived") {
      throw new ValidationError(`E_VALIDATION: goods can only be received against an approved order (this one is ${order.status})`);
    }
    const byId = new Map(order.lines.map((l) => [l.id, l]));
    const seen = new Set<string>();
    let anything = false;
    for (const line of input.lines) {
      const orderLine = byId.get(line.orderLineId);
      if (!orderLine) throw new ValidationError("E_VALIDATION: a line does not belong to this order");
      if (seen.has(line.orderLineId)) throw new ValidationError("E_VALIDATION: a line appears twice");
      seen.add(line.orderLineId);
      const rejected = line.rejectedQty ?? 0;
      if (rejected > 0 && !line.rejectReason) throw new ValidationError("E_VALIDATION: say why the rejected quantity was rejected");
      if (orderLine.receivedQty + line.acceptedQty > orderLine.qty) {
        throw new ValidationError(
          `E_VALIDATION: more received than ordered (ordered ${orderLine.qty}, already received ${orderLine.receivedQty}, now ${line.acceptedQty})`,
        );
      }
      if (line.acceptedQty > 0 || rejected > 0) anything = true;
    }
    if (!anything) throw new ValidationError("E_VALIDATION: enter a received or rejected quantity on at least one line");
  },
  handler: async (ctx, input) => {
    const order = await loadOrder(ctx.tx, input.orderId);
    const byId = new Map(order.lines.map((l) => [l.id, l]));
    const reference = poNumber(order.seq);

    const receipt = await ctx.tx.inventoryGoodsReceipt.create({
      data: {
        tenantId: ctx.actor.tenantId,
        orderId: order.id,
        receivedById: ctx.actor.userId,
        invoiceRef: input.invoiceRef ?? null,
      },
    });

    let stockedLines = 0;
    for (const line of input.lines) {
      const orderLine = byId.get(line.orderLineId)!;
      const rejectedQty = line.rejectedQty ?? 0;
      if (line.acceptedQty === 0 && rejectedQty === 0) continue;
      const unitPricePaise = line.unitPricePaise ?? orderLine.unitPricePaise;

      await ctx.tx.inventoryGoodsReceiptLine.create({
        data: {
          tenantId: ctx.actor.tenantId,
          receiptId: receipt.id,
          orderLineId: orderLine.id,
          acceptedQty: line.acceptedQty,
          rejectedQty,
          rejectReason: rejectedQty > 0 ? (line.rejectReason ?? null) : null,
          unitPricePaise,
        },
      });
      if (line.acceptedQty > 0) {
        await applyMovement(ctx.tx, ctx.actor, {
          itemId: orderLine.itemId,
          locationId: order.locationId,
          kind: "Receipt",
          qty: line.acceptedQty,
          reference: input.invoiceRef ? `${reference} / ${input.invoiceRef}` : reference,
          unitCostPaise: unitPricePaise,
        });
        stockedLines += 1;
      }
      await ctx.tx.inventoryPurchaseOrderLine.update({
        where: { id: orderLine.id },
        data: { receivedQty: { increment: line.acceptedQty }, rejectedQty: { increment: rejectedQty } },
      });
    }

    const after = await ctx.tx.inventoryPurchaseOrderLine.findMany({ where: { orderId: order.id } });
    const status: PoStatus = after.every((l) => l.receivedQty >= l.qty) ? "Received" : "PartiallyReceived";
    await ctx.tx.inventoryPurchaseOrder.update({ where: { id: order.id }, data: { status } });

    return {
      result: { receiptId: receipt.id, status, stockedLines },
      events: [{ name: "verity.inventory.goods_received", entityId: order.id, payload: { receiptId: receipt.id, status } }],
    };
  },
};

/* ================================== queries ================================== */

export type PurchaseOrderRow = {
  id: string;
  number: string;
  status: PoStatus;
  vendorName: string;
  locationId: string;
  locationName: string;
  totalPaise: number;
  orderedQty: number;
  receivedQty: number;
  expectedDate: string | null;
  createdAt: Date;
};

export const listPurchaseOrders: QueryDefinition<{ status?: PoStatus; locationId?: string }, PurchaseOrderRow[]> = {
  key: "verity.inventory.list_purchase_orders",
  entity: ENTITY_INVENTORY_PURCHASE_ORDER,
  input: z.object({ status: z.enum(PO_STATUSES).optional(), locationId: z.string().uuid().optional() }),
  handler: async (ctx, input) => {
    const rows = await ctx.tx.inventoryPurchaseOrder.findMany({
      where: { ...(input.status ? { status: input.status } : {}), ...(input.locationId ? { locationId: input.locationId } : {}) },
      include: { vendor: { select: { name: true } }, location: { select: { name: true } }, lines: { select: { qty: true, receivedQty: true } } },
      orderBy: { seq: "desc" },
      take: 200,
    });
    return rows.map((o) => ({
      id: o.id,
      number: poNumber(o.seq),
      status: o.status as PoStatus,
      vendorName: o.vendor.name,
      locationId: o.locationId,
      locationName: o.location.name,
      totalPaise: o.totalPaise,
      orderedQty: o.lines.reduce((n, l) => n + l.qty, 0),
      receivedQty: o.lines.reduce((n, l) => n + l.receivedQty, 0),
      expectedDate: o.expectedDate ? o.expectedDate.toISOString().slice(0, 10) : null,
      createdAt: o.createdAt,
    }));
  },
};

export type PurchaseOrderDetail = PurchaseOrderRow & {
  notes: string | null;
  cancelReason: string | null;
  lines: Array<{
    id: string;
    itemId: string;
    itemName: string;
    unit: string;
    qty: number;
    unitPricePaise: number;
    receivedQty: number;
    rejectedQty: number;
  }>;
  receipts: Array<{
    id: string;
    receivedAt: Date;
    invoiceRef: string | null;
    lines: Array<{ itemName: string; acceptedQty: number; rejectedQty: number; rejectReason: string | null; unitPricePaise: number }>;
  }>;
};

export const getPurchaseOrder: QueryDefinition<{ orderId: string }, PurchaseOrderDetail | null> = {
  key: "verity.inventory.get_purchase_order",
  entity: ENTITY_INVENTORY_PURCHASE_ORDER,
  input: z.object({ orderId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const o = await ctx.tx.inventoryPurchaseOrder.findUnique({
      where: { id: input.orderId },
      include: {
        vendor: { select: { name: true } },
        location: { select: { name: true } },
        lines: { include: { item: { select: { name: true, unitLabel: true } } } },
        receipts: {
          include: { lines: { include: { orderLine: { include: { item: { select: { name: true } } } } } } },
          orderBy: { receivedAt: "desc" },
        },
      },
    });
    if (!o) return null;
    return {
      id: o.id,
      number: poNumber(o.seq),
      status: o.status as PoStatus,
      vendorName: o.vendor.name,
      locationId: o.locationId,
      locationName: o.location.name,
      totalPaise: o.totalPaise,
      orderedQty: o.lines.reduce((n, l) => n + l.qty, 0),
      receivedQty: o.lines.reduce((n, l) => n + l.receivedQty, 0),
      expectedDate: o.expectedDate ? o.expectedDate.toISOString().slice(0, 10) : null,
      createdAt: o.createdAt,
      notes: o.notes,
      cancelReason: o.cancelReason,
      lines: o.lines.map((l) => ({
        id: l.id,
        itemId: l.itemId,
        itemName: l.item.name,
        unit: l.item.unitLabel,
        qty: l.qty,
        unitPricePaise: l.unitPricePaise,
        receivedQty: l.receivedQty,
        rejectedQty: l.rejectedQty,
      })),
      receipts: o.receipts.map((r) => ({
        id: r.id,
        receivedAt: r.receivedAt,
        invoiceRef: r.invoiceRef,
        lines: r.lines.map((rl) => ({
          itemName: rl.orderLine.item.name,
          acceptedQty: rl.acceptedQty,
          rejectedQty: rl.rejectedQty,
          rejectReason: rl.rejectReason,
          unitPricePaise: rl.unitPricePaise,
        })),
      })),
    };
  },
};

export type VendorPriceRow = {
  vendorId: string;
  itemName: string;
  unit: string;
  unitPricePaise: number;
  receivedAt: Date;
  orderNumber: string;
};

/**
 * What each vendor actually charged, delivery by delivery (PRD §26). Read from
 * goods receipts, so it is the invoice price, not the price that was ordered.
 */
export const vendorPriceHistory: QueryDefinition<{ vendorId?: string }, VendorPriceRow[]> = {
  key: "verity.inventory.vendor_price_history",
  entity: ENTITY_INVENTORY_VENDOR,
  input: z.object({ vendorId: z.string().uuid().optional() }),
  handler: async (ctx, input) => {
    const rows = await ctx.tx.inventoryGoodsReceiptLine.findMany({
      where: { acceptedQty: { gt: 0 }, ...(input.vendorId ? { receipt: { order: { vendorId: input.vendorId } } } : {}) },
      include: {
        receipt: { select: { receivedAt: true, order: { select: { vendorId: true, seq: true } } } },
        orderLine: { select: { item: { select: { name: true, unitLabel: true } } } },
      },
      orderBy: { receipt: { receivedAt: "desc" } },
      take: 500,
    });
    return rows.map((r) => ({
      vendorId: r.receipt.order.vendorId,
      itemName: r.orderLine.item.name,
      unit: r.orderLine.item.unitLabel,
      unitPricePaise: r.unitPricePaise,
      receivedAt: r.receipt.receivedAt,
      orderNumber: poNumber(r.receipt.order.seq),
    }));
  },
};

export function registerProcurement(): void {
  registerCommand(createVendor);
  registerCommand(setVendorActive);
  registerCommand(createPurchaseOrder);
  registerCommand(draftOrderFromLowStock);
  registerCommand(submitPurchaseOrder);
  registerCommand(approvePurchaseOrder);
  registerCommand(cancelPurchaseOrder);
  registerCommand(receiveGoods);
  registerQuery(listVendors);
  registerQuery(listPurchaseOrders);
  registerQuery(getPurchaseOrder);
  registerQuery(vendorPriceHistory);
}
