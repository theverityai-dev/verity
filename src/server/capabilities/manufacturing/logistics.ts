import { z } from "zod";
import { registerCommand, ValidationError, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import type { TenantScopedClient } from "@/server/platform/tenancy";
import { ENTITY_MANUFACTURING_DISPATCH, ENTITY_MANUFACTURING_ORDER } from "./shared";

/**
 * Dispatch of a finished order (Task 118, Carxen's logistics module).
 *
 * The delivery is an append-only ledger of two kinds of event: the order leaves
 * (`dispatched`, which REQUIRES a packaging photograph captured as evidence about
 * this order) and later arrives (`delivered`). The latest row is the order's
 * logistics state; nothing is ever edited, so a wrong transporter is corrected by
 * a newer fact and the history still shows what was first recorded.
 */

export type DispatchStatus = "dispatched" | "delivered";

async function currentStatus(tx: TenantScopedClient, orderId: string): Promise<DispatchStatus | null> {
  const latest = await tx.manufacturingDispatch.findFirst({ where: { orderId }, orderBy: { recordedAt: "desc" } });
  return (latest?.status as DispatchStatus | undefined) ?? null;
}

/** A finished order is the only kind there is anything to send. */
async function assertCompleted(tx: TenantScopedClient, orderId: string): Promise<void> {
  const order = await tx.manufacturingOrder.findUnique({ where: { id: orderId } });
  if (!order) throw new ValidationError("E_VALIDATION: order not found in this tenant");
  if (order.state !== "completed") {
    throw new ValidationError("E_VALIDATION: only a completed order can be dispatched");
  }
}

export const dispatchOrder: CommandDefinition<
  { orderId: string; transporter: string; vehicleNo?: string; trackingRef?: string; packagingEvidenceId: string; note?: string },
  { id: string }
> = {
  key: "verity.manufacturing.dispatch_order",
  entity: ENTITY_MANUFACTURING_DISPATCH,
  verb: "Create",
  input: z.object({
    orderId: z.string().uuid(),
    transporter: z.string().trim().min(2).max(120),
    vehicleNo: z.string().trim().max(40).optional(),
    trackingRef: z.string().trim().max(120).optional(),
    packagingEvidenceId: z.string().uuid(),
    note: z.string().trim().max(400).optional(),
  }),
  preconditions: async (ctx, input) => {
    await assertCompleted(ctx.tx, input.orderId);
    if ((await currentStatus(ctx.tx, input.orderId)) !== null) {
      throw new ValidationError("E_VALIDATION: this order has already been dispatched");
    }
    // The photograph must be evidence about THIS order, so a packing picture of
    // something else cannot stand in for it.
    const evidence = await ctx.tx.evidence.findUnique({ where: { id: input.packagingEvidenceId } });
    if (
      !evidence ||
      evidence.entityKey !== ENTITY_MANUFACTURING_ORDER ||
      evidence.entityId !== input.orderId ||
      evidence.kind !== "Photo"
    ) {
      throw new ValidationError("E_VALIDATION: the packaging photo was not captured for this order");
    }
  },
  handler: async (ctx, input) => {
    const row = await ctx.tx.manufacturingDispatch.create({
      data: {
        tenantId: ctx.actor.tenantId,
        orderId: input.orderId,
        status: "dispatched",
        transporter: input.transporter,
        vehicleNo: input.vehicleNo || null,
        trackingRef: input.trackingRef || null,
        packagingEvidenceId: input.packagingEvidenceId,
        note: input.note || null,
        recordedById: ctx.actor.userId,
      },
    });
    return { result: { id: row.id }, events: [{ name: "verity.manufacturing.order_dispatched", entityId: input.orderId }] };
  },
};

export const confirmDelivery: CommandDefinition<{ orderId: string; note?: string }, { id: string }> = {
  key: "verity.manufacturing.confirm_delivery",
  entity: ENTITY_MANUFACTURING_DISPATCH,
  verb: "Create",
  input: z.object({ orderId: z.string().uuid(), note: z.string().trim().max(400).optional() }),
  preconditions: async (ctx, input) => {
    const status = await currentStatus(ctx.tx, input.orderId);
    if (status === null) throw new ValidationError("E_VALIDATION: this order has not been dispatched");
    if (status === "delivered") throw new ValidationError("E_VALIDATION: this order is already marked delivered");
  },
  handler: async (ctx, input) => {
    // The journey's details stay on the dispatched row; delivery adds only its own fact.
    const row = await ctx.tx.manufacturingDispatch.create({
      data: {
        tenantId: ctx.actor.tenantId,
        orderId: input.orderId,
        status: "delivered",
        note: input.note || null,
        recordedById: ctx.actor.userId,
      },
    });
    return { result: { id: row.id }, events: [{ name: "verity.manufacturing.order_delivered", entityId: input.orderId }] };
  },
};

export type DispatchView = {
  status: DispatchStatus | null;
  events: Array<{
    id: string;
    status: DispatchStatus;
    transporter: string | null;
    vehicleNo: string | null;
    trackingRef: string | null;
    packagingEvidenceId: string | null;
    note: string | null;
    recordedAt: Date;
  }>;
};

/** The order's delivery history, newest first, and where it stands now. */
export const orderDispatch: QueryDefinition<{ orderId: string }, DispatchView> = {
  key: "verity.manufacturing.order_dispatch",
  entity: ENTITY_MANUFACTURING_DISPATCH,
  input: z.object({ orderId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const rows = await ctx.tx.manufacturingDispatch.findMany({ where: { orderId: input.orderId }, orderBy: { recordedAt: "desc" } });
    return {
      status: (rows[0]?.status as DispatchStatus | undefined) ?? null,
      events: rows.map((r) => ({
        id: r.id,
        status: r.status as DispatchStatus,
        transporter: r.transporter,
        vehicleNo: r.vehicleNo,
        trackingRef: r.trackingRef,
        packagingEvidenceId: r.packagingEvidenceId,
        note: r.note,
        recordedAt: r.recordedAt,
      })),
    };
  },
};

export function registerManufacturingLogistics(): void {
  registerCommand(dispatchOrder);
  registerCommand(confirmDelivery);
  registerQuery(orderDispatch);
}
