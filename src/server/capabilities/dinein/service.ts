import { z } from "zod";
import { registerCommand, ValidationError, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { diffFields, recordActivity } from "@/server/platform/audit";
import { hasPermission } from "@/server/platform/authorization";
import type { TenantScopedClient } from "@/server/platform/tenancy";
import { ENTITY_ORDER } from "./keys";
import { assertOutletInScope } from "./scope";

/**
 * Service floor actions that are neither menu, kitchen nor money (Task 126 Wave 1).
 *
 * HAND OVER AN ORDER (captain transfer, URY's `CaptainTransferDialog`)
 * A waiter's shift ends or a section is reshuffled while tables are still
 * eating. The order keeps its table, its lines and its bill; only the person
 * answerable for it changes. The new taker is chosen from people who work this
 * outlet and may edit orders, so an order can never be handed to someone who
 * could not have taken it. Who held it before is in the audit trail.
 */

const OPEN_STATES = ["draft", "placed", "partially_served", "served", "billed"];

/** People who may take over an order: staff of the outlet's organization who can edit orders. */
async function eligibleTakers(
  tx: TenantScopedClient,
  organizationId: string,
): Promise<Array<{ userId: string; name: string }>> {
  const memberships = await tx.tenantMembership.findMany({
    where: { organizationId, roleId: { not: null } },
    include: { user: { include: { party: { select: { displayName: true } } } } },
  });
  const allowedRole = new Map<string, boolean>();
  const out: Array<{ userId: string; name: string }> = [];
  for (const m of memberships) {
    const roleId = m.roleId!;
    if (!allowedRole.has(roleId)) allowedRole.set(roleId, await hasPermission(tx, roleId, "Edit", ENTITY_ORDER));
    if (allowedRole.get(roleId)) out.push({ userId: m.userId, name: m.user.party.displayName });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export const handOverOrder: CommandDefinition<
  { orderId: string; toUserId: string; reason?: string },
  { orderId: string; toUserId: string }
> = {
  key: "verity.dinein.hand_over_order",
  entity: ENTITY_ORDER,
  verb: "Edit",
  input: z.object({
    orderId: z.string().uuid(),
    toUserId: z.string().uuid(),
    reason: z.string().max(200).optional(),
  }),
  preconditions: async (ctx, input) => {
    const order = await ctx.tx.diningOrder.findUnique({ where: { id: input.orderId } });
    if (!order) throw new ValidationError("E_VALIDATION: order not found");
    await assertOutletInScope(ctx.tx, ctx.actor, ENTITY_ORDER, "Edit", order.locationId);
    if (!OPEN_STATES.includes(order.state)) {
      throw new ValidationError("E_VALIDATION: this order is closed and cannot be handed over");
    }
    if (order.takenByUserId === input.toUserId) {
      throw new ValidationError("E_VALIDATION: that person already has this order");
    }
    const location = await ctx.tx.location.findUniqueOrThrow({ where: { id: order.locationId }, select: { organizationId: true } });
    const takers = await eligibleTakers(ctx.tx, location.organizationId);
    if (!takers.some((t) => t.userId === input.toUserId)) {
      throw new ValidationError("E_VALIDATION: that person does not work this outlet or cannot take orders");
    }
  },
  handler: async (ctx, input) => {
    const before = await ctx.tx.diningOrder.findUniqueOrThrow({ where: { id: input.orderId } });
    await ctx.tx.diningOrder.update({
      where: { id: input.orderId },
      data: { takenByUserId: input.toUserId, version: { increment: 1 } },
    });
    await recordActivity(ctx, {
      entityKey: ENTITY_ORDER,
      entityId: input.orderId,
      commandKey: "verity.dinein.hand_over_order",
      changes: diffFields(
        { takenByUserId: before.takenByUserId },
        { takenByUserId: input.toUserId, reason: input.reason ?? "not given" },
      ),
    });
    return {
      result: { orderId: input.orderId, toUserId: input.toUserId },
      events: [{ name: "verity.dinein.order_handed_over", entityId: input.orderId }],
    };
  },
};

export const listHandoverTargets: QueryDefinition<{ orderId: string }, Array<{ userId: string; name: string }>> = {
  key: "verity.dinein.list_handover_targets",
  entity: ENTITY_ORDER,
  input: z.object({ orderId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const order = await ctx.tx.diningOrder.findUnique({ where: { id: input.orderId } });
    if (!order) return [];
    const location = await ctx.tx.location.findUnique({ where: { id: order.locationId }, select: { organizationId: true } });
    if (!location) return [];
    const takers = await eligibleTakers(ctx.tx, location.organizationId);
    return takers.filter((t) => t.userId !== order.takenByUserId);
  },
};

export function registerDineinService(): void {
  registerCommand(handOverOrder);
  registerQuery(listHandoverTargets);
}
