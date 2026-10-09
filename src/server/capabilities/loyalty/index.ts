import { z } from "zod";
import { registerContribution } from "@/server/platform/contribution";
import {
  registerCommand,
  ValidationError,
  type CommandContext,
  type CommandDefinition,
} from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { resolveConfig } from "@/server/platform/capability";
import { findGuestByPhone, guestGroup } from "@/server/capabilities/crm/guests";
import { registerExportable } from "@/server/platform/data-export";

/**
 * CAPABILITY: Loyalty — `verity.capability.loyalty` (Colonel Kebabz Phase 2,
 * lean V1)
 *
 * Authority: `clients/colonel-kebabz/prd.md` §31 (Loyalty Program), scoped
 * to points only per the 2026-09-10 lean-scope correction — no tiers,
 * rewards catalogue, birthday/anniversary automation, or visit rewards.
 * Points are earned automatically on `dinein.settleBill` (spend after any
 * discount, the fairest basis) and redeemed through one plain command.
 * Redemption does NOT itself apply a bill discount — it only debits the
 * ledger and returns the paise value; a staff member applies that via the
 * existing `dinein.applyBillDiscount`, keeping this capability decoupled
 * from Bill's own state machine.
 */

export const LOYALTY_CAPABILITY = "verity.capability.loyalty";
export const ENTITY_LOYALTY_ENTRY = "verity.loyalty.point_entry";

/** Points earned per Rs 100 spent. PRD example: Rs 100 = 5 points. */
export const CONFIG_LOYALTY_EARN_POINTS_PER_100 = "verity.loyalty.earn_points_per_100";
/** Paise value of one redeemed point. PRD example: 500 points = Rs 100, i.e. 20 paise/point. */
export const CONFIG_LOYALTY_REDEEM_PAISE_PER_POINT = "verity.loyalty.redeem_paise_per_point";

const DEFAULT_EARN_POINTS_PER_100 = 5;
const DEFAULT_REDEEM_PAISE_PER_POINT = 20;

/**
 * Awards points for a settled bill. Plain function, not a registered
 * command — same posture as `recipe.postConsumptionForOrder` and
 * `crm.upsertCustomerForOrder`. A no-op when the order has no phone (no
 * Customer to credit).
 */
export async function awardPointsForOrder(ctx: CommandContext, orderId: string, billId: string): Promise<void> {
  const order = await ctx.tx.diningOrder.findUniqueOrThrow({ where: { id: orderId } });
  if (!order.customerPhone) return;
  // A phone merged into another guest earns on that guest (Task 125 item 5.1).
  const customer = await findGuestByPhone(ctx.tx, ctx.actor.tenantId, order.customerPhone);
  if (!customer) return; // upsertCustomerForOrder runs earlier in generateBill; this is defensive.

  const bill = await ctx.tx.bill.findUniqueOrThrow({ where: { id: billId } });
  const rate =
    Number((await resolveConfig<number>(ctx.tx, CONFIG_LOYALTY_EARN_POINTS_PER_100)) ?? DEFAULT_EARN_POINTS_PER_100);
  const points = Math.floor((bill.totalMinor / 10_000) * rate);
  if (points <= 0) return;

  await ctx.tx.loyaltyPointEntry.create({
    data: {
      tenantId: ctx.actor.tenantId,
      customerId: customer.id,
      points,
      reason: "earn",
      billId: bill.id,
    },
  });
}

/**
 * Takes back points earned on a bill in proportion to how much of it has been
 * refunded (decision 2026-10-06). Recomputed from totals each time, so a second
 * partial refund reverses only the difference, and the total taken back never
 * exceeds what was earned. Plain function under refund_bill's own authorization,
 * same posture as `awardPointsForOrder`. Reversals are `adjustment` entries
 * with negative points against the bill, so the ledger stays append-only.
 */
export async function reversePointsForRefund(ctx: CommandContext, billId: string): Promise<number> {
  const earned = await ctx.tx.loyaltyPointEntry.findFirst({ where: { billId, reason: "earn" } });
  if (!earned || earned.points <= 0) return 0;

  const [bill, refunded, reversed] = await Promise.all([
    ctx.tx.bill.findUniqueOrThrow({ where: { id: billId }, select: { totalMinor: true } }),
    ctx.tx.billRefund.aggregate({ where: { billId }, _sum: { amountMinor: true } }),
    ctx.tx.loyaltyPointEntry.aggregate({ where: { billId, reason: "adjustment", points: { lt: 0 } }, _sum: { points: true } }),
  ]);
  if (bill.totalMinor <= 0) return 0;
  const refundedMinor = Math.min(refunded._sum.amountMinor ?? 0, bill.totalMinor);
  const shouldReverse = Math.floor((earned.points * refundedMinor) / bill.totalMinor);
  const alreadyReversed = -(reversed._sum.points ?? 0);
  const delta = shouldReverse - alreadyReversed;
  if (delta <= 0) return 0;

  await ctx.tx.loyaltyPointEntry.create({
    data: {
      tenantId: ctx.actor.tenantId,
      customerId: earned.customerId,
      points: -delta,
      reason: "adjustment",
      billId,
    },
  });
  return delta;
}

/**
 * What a guest can redeem against an amount (Task 125 item 5.3): their balance,
 * the paise value of one point, and the most points whose value fits inside
 * `capMinor` (the bill's subtotal), so a redemption can never exceed the bill.
 */
/** A guest's balance across every phone merged into them. */
async function groupBalance(tx: CommandContext["tx"], customerId: string): Promise<number> {
  const ids = (await guestGroup(tx, customerId)).map((g) => g.id);
  const agg = await tx.loyaltyPointEntry.aggregate({ where: { customerId: { in: ids.length > 0 ? ids : [customerId] } }, _sum: { points: true } });
  return agg._sum.points ?? 0;
}

export async function redeemablePoints(
  tx: CommandContext["tx"],
  customerId: string,
  capMinor: number,
): Promise<{ balance: number; paisePerPoint: number; maxPoints: number; valueMinor: number }> {
  const balance = await groupBalance(tx, customerId);
  const paisePerPoint = Number(
    (await resolveConfig<number>(tx, CONFIG_LOYALTY_REDEEM_PAISE_PER_POINT)) ?? DEFAULT_REDEEM_PAISE_PER_POINT,
  );
  const maxPoints = paisePerPoint > 0 ? Math.max(0, Math.min(balance, Math.floor(capMinor / paisePerPoint))) : 0;
  return { balance, paisePerPoint, maxPoints, valueMinor: maxPoints * paisePerPoint };
}

/**
 * Debits points against a bill and returns their value in paise. A plain
 * function under the calling command's own authorization (same posture as
 * `awardPointsForOrder`), so `dinein.redeemPointsOnBill` can debit the ledger and
 * apply the discount in ONE transaction: points are never spent without the
 * discount, and the discount is never given without the points.
 */
export async function debitPointsForBill(
  ctx: CommandContext,
  input: { customerId: string; points: number; billId: string; capMinor: number },
): Promise<number> {
  const available = await redeemablePoints(ctx.tx, input.customerId, input.capMinor);
  if (input.points > available.balance) {
    throw new ValidationError(`E_VALIDATION: only ${available.balance} points available, cannot redeem ${input.points}`);
  }
  if (input.points > available.maxPoints) {
    throw new ValidationError(`E_VALIDATION: ${input.points} points are worth more than this bill; at most ${available.maxPoints} can be used`);
  }
  await ctx.tx.loyaltyPointEntry.create({
    data: {
      tenantId: ctx.actor.tenantId,
      customerId: input.customerId,
      points: -input.points,
      reason: "redeem",
      billId: input.billId,
    },
  });
  return input.points * available.paisePerPoint;
}

export const redeemPoints: CommandDefinition<
  { customerId: string; points: number },
  { valuePaise: number; remainingBalance: number }
> = {
  key: "verity.loyalty.redeem_points",
  entity: ENTITY_LOYALTY_ENTRY,
  verb: "Create",
  input: z.object({ customerId: z.string().uuid(), points: z.number().int().positive() }),
  preconditions: async (ctx, input) => {
    const customer = await ctx.tx.customer.findUnique({ where: { id: input.customerId } });
    if (!customer) throw new ValidationError("E_VALIDATION: customer not found in this tenant");
    const balance = await currentBalance(ctx, input.customerId);
    if (input.points > balance) {
      throw new ValidationError(`E_VALIDATION: only ${balance} points available, cannot redeem ${input.points}`);
    }
  },
  handler: async (ctx, input) => {
    await ctx.tx.loyaltyPointEntry.create({
      data: {
        tenantId: ctx.actor.tenantId,
        customerId: input.customerId,
        points: -input.points,
        reason: "redeem",
      },
    });
    const paisePerPoint = Number(
      (await resolveConfig<number>(ctx.tx, CONFIG_LOYALTY_REDEEM_PAISE_PER_POINT)) ?? DEFAULT_REDEEM_PAISE_PER_POINT,
    );
    const remainingBalance = await currentBalance(ctx, input.customerId);
    return {
      result: { valuePaise: input.points * paisePerPoint, remainingBalance },
      events: [
        {
          name: "verity.loyalty.points_redeemed",
          entityId: input.customerId,
          payload: { points: input.points },
        },
      ],
    };
  },
};

async function currentBalance(
  ctx: { tx: CommandContext["tx"] },
  customerId: string,
): Promise<number> {
  return groupBalance(ctx.tx, customerId);
}

export const getLoyaltyBalance: QueryDefinition<{ customerId: string }, { balance: number }> = {
  key: "verity.loyalty.get_balance",
  entity: ENTITY_LOYALTY_ENTRY,
  input: z.object({ customerId: z.string().uuid() }),
  handler: async (ctx, input) => ({ balance: await currentBalance(ctx, input.customerId) }),
};

/* ============================== registration ============================== */

export function registerLoyaltyCapability(): void {
  registerExportable({
    key: "loyalty_points",
    label: "Loyalty points",
    entity: ENTITY_LOYALTY_ENTRY,
    columns: ["id", "customer_id", "points", "reason", "bill_id", "created_at"],
    read: async (tx) =>
      (await tx.loyaltyPointEntry.findMany({ orderBy: { createdAt: "asc" } })).map((e) => [e.id, e.customerId, e.points, e.reason, e.billId, e.createdAt]),
  });
  registerContribution({
    capabilityId: LOYALTY_CAPABILITY,
    navigation: [],
  });
  registerCommand(redeemPoints);
  registerQuery(getLoyaltyBalance);
}
