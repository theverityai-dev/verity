import { z } from "zod";
import { registerCommand, ValidationError, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { ForbiddenError } from "@/server/platform/authorization";
import { diffFields, recordActivity } from "@/server/platform/audit";
import type { TenantScopedClient } from "@/server/platform/tenancy";
import { overlappingRules, type PriceContext, type PriceRule } from "@/lib/menu-price";
import { ENTITY_MENU_ITEM, ORDER_CHANNELS, ORDER_CHANNEL_LABEL, type OrderChannel } from "./keys";
import { serviceDayRange } from "./day";
import { dayStartMinuteFor } from "./gst";
import { assertOutletInScope, reachableOutletIds } from "./scope";

/**
 * Prices that differ by outlet and channel (ADR-043; Task 126 Wave 4).
 *
 * The item's own price is the base. A rule says "at this outlet, in this channel, from
 * this day, it costs this". Which one applies is decided in one pure function
 * (`src/lib/menu-price.ts`); everything that prices an order asks it, nothing
 * else computes a price. Orders snapshot the result, so a rule changing later never
 * rewrites a bill.
 */

type RuleRow = {
  id: string;
  itemId: string;
  locationId: string | null;
  channel: string | null;
  priceMinor: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

const day = (d: Date) => d.toISOString().slice(0, 10);

export function toPriceRule(r: RuleRow): PriceRule {
  return {
    id: r.id,
    locationId: r.locationId,
    channel: r.channel,
    priceMinor: r.priceMinor,
    effectiveFrom: day(r.effectiveFrom),
    effectiveTo: r.effectiveTo ? day(r.effectiveTo) : null,
  };
}

/** The rules for some items, grouped by item. */
export async function loadPriceRules(tx: TenantScopedClient, itemIds: string[]): Promise<Map<string, PriceRule[]>> {
  const rows = await tx.menuPriceRule.findMany({ where: { itemId: { in: [...new Set(itemIds)] } } });
  const grouped = new Map<string, PriceRule[]>();
  for (const row of rows) grouped.set(row.itemId, [...(grouped.get(row.itemId) ?? []), toPriceRule(row)]);
  return grouped;
}

/** Where, in which channel and on which service day an order is being priced. */
export async function priceContextFor(
  tx: TenantScopedClient,
  organizationId: string,
  order: { locationId: string; channel: string },
): Promise<PriceContext> {
  const startMinute = await dayStartMinuteFor(tx, [order.locationId]);
  const { day: today } = await serviceDayRange(tx, organizationId, undefined, startMinute);
  return { locationId: order.locationId, channel: order.channel, day: today };
}

/**
 * A rule for the whole tenant (no outlet) is head-office's to set: it needs an Edit
 * grant that reaches every outlet, which is what a tenant-scoped grant is. A rule for
 * one outlet needs Edit at that outlet. No new primitive: the permission scopes that exist.
 */
async function assertMayManageRule(
  tx: TenantScopedClient,
  actor: Parameters<typeof reachableOutletIds>[1],
  locationId: string | null,
): Promise<void> {
  if (locationId) {
    await assertOutletInScope(tx, actor, ENTITY_MENU_ITEM, "Edit", locationId);
    return;
  }
  const reachable = new Set(await reachableOutletIds(tx, actor, ENTITY_MENU_ITEM, "Edit"));
  const everyOutlet = await tx.location.findMany({ where: { active: true }, select: { id: true } });
  if (everyOutlet.length === 0 || everyOutlet.some((l) => !reachable.has(l.id))) {
    throw new ForbiddenError("E_FORBIDDEN: a price for every outlet needs permission over every outlet");
  }
}

export const saveMenuPriceRule: CommandDefinition<
  { itemId: string; locationId?: string | null; channel?: string | null; priceMinor: number; effectiveFrom?: string; effectiveTo?: string | null },
  { id: string }
> = {
  key: "verity.dinein.save_menu_price_rule",
  entity: ENTITY_MENU_ITEM,
  verb: "Edit",
  input: z.object({
    itemId: z.string().uuid(),
    locationId: z.string().uuid().nullish(),
    channel: z.enum(ORDER_CHANNELS).nullish(),
    priceMinor: z.number().int().min(0),
    effectiveFrom: z.string().date().optional(),
    effectiveTo: z.string().date().nullish(),
  }),
  preconditions: async (ctx, input) => {
    const item = await ctx.tx.menuItem.findUnique({ where: { id: input.itemId } });
    if (!item) throw new ValidationError("E_VALIDATION: menu item not found");
    await assertMayManageRule(ctx.tx, ctx.actor, input.locationId ?? null);
    if (input.priceMinor === item.priceMinor) {
      throw new ValidationError("E_VALIDATION: that is the item's own price already, so a rule would change nothing");
    }
    if (input.effectiveFrom && input.effectiveTo && input.effectiveTo < input.effectiveFrom) {
      throw new ValidationError("E_VALIDATION: the price ends before it starts");
    }
  },
  handler: async (ctx, input) => {
    const startMinute = await dayStartMinuteFor(ctx.tx, input.locationId ? [input.locationId] : []);
    const from = input.effectiveFrom ?? (await serviceDayRange(ctx.tx, ctx.actor.organizationId, undefined, startMinute)).day;
    const rule = await ctx.tx.menuPriceRule.create({
      data: {
        tenantId: ctx.actor.tenantId,
        itemId: input.itemId,
        locationId: input.locationId ?? null,
        channel: input.channel ?? null,
        priceMinor: input.priceMinor,
        effectiveFrom: new Date(`${from}T00:00:00Z`),
        effectiveTo: input.effectiveTo ? new Date(`${input.effectiveTo}T00:00:00Z`) : null,
        createdByUserId: ctx.actor.userId,
      },
    });
    await recordActivity(ctx, {
      entityKey: ENTITY_MENU_ITEM,
      entityId: input.itemId,
      commandKey: "verity.dinein.save_menu_price_rule",
      changes: diffFields({}, {
        priceRule: `${input.priceMinor} from ${from}${input.locationId ? " at one outlet" : ""}${input.channel ? ` in ${input.channel}` : ""}`,
      }),
    });
    return { result: { id: rule.id }, events: [{ name: "verity.dinein.menu_price_rule_saved", entityId: rule.id }] };
  },
};

export const endMenuPriceRule: CommandDefinition<{ ruleId: string; on: string }, { id: string }> = {
  key: "verity.dinein.end_menu_price_rule",
  entity: ENTITY_MENU_ITEM,
  verb: "Edit",
  input: z.object({ ruleId: z.string().uuid(), on: z.string().date() }),
  preconditions: async (ctx, input) => {
    const rule = await ctx.tx.menuPriceRule.findUnique({ where: { id: input.ruleId } });
    if (!rule) throw new ValidationError("E_VALIDATION: price rule not found");
    await assertMayManageRule(ctx.tx, ctx.actor, rule.locationId);
    if (input.on < day(rule.effectiveFrom)) throw new ValidationError("E_VALIDATION: a price cannot end before it starts");
  },
  handler: async (ctx, input) => {
    const rule = await ctx.tx.menuPriceRule.update({
      where: { id: input.ruleId },
      data: { effectiveTo: new Date(`${input.on}T00:00:00Z`), version: { increment: 1 } },
    });
    await recordActivity(ctx, {
      entityKey: ENTITY_MENU_ITEM,
      entityId: rule.itemId,
      commandKey: "verity.dinein.end_menu_price_rule",
      changes: diffFields({}, { priceRuleEnded: `${rule.priceMinor} until ${input.on}` }),
    });
    return { result: { id: rule.id }, events: [{ name: "verity.dinein.menu_price_rule_ended", entityId: rule.id }] };
  },
};

export type PriceRuleView = {
  id: string;
  itemId: string;
  itemName: string;
  basePriceMinor: number;
  locationName: string | null;
  channelLabel: string | null;
  priceMinor: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** Holding today at the outlet's clock. */
  current: boolean;
  /** Another rule of the same scope covers some of the same days. */
  overlaps: boolean;
};

export const listMenuPriceRules: QueryDefinition<{ itemId?: string }, PriceRuleView[]> = {
  key: "verity.dinein.list_menu_price_rules",
  entity: ENTITY_MENU_ITEM,
  input: z.object({ itemId: z.string().uuid().optional() }),
  handler: async (ctx, input) => {
    const rows = await ctx.tx.menuPriceRule.findMany({
      where: input.itemId ? { itemId: input.itemId } : {},
      orderBy: [{ itemId: "asc" }, { effectiveFrom: "desc" }],
      include: { item: { select: { name: true, priceMinor: true } }, location: { select: { name: true } } },
    });
    const today = (await serviceDayRange(ctx.tx, ctx.actor.organizationId)).day;
    const rules = rows.map((r) => toPriceRule(r));
    const clashing = new Set<string>();
    const byItem = new Map<string, PriceRule[]>();
    for (const r of rows) byItem.set(r.itemId, [...(byItem.get(r.itemId) ?? []), toPriceRule(r)]);
    for (const group of byItem.values()) for (const [a, b] of overlappingRules(group)) { clashing.add(a); clashing.add(b); }
    void rules;
    return rows.map((r) => ({
      id: r.id,
      itemId: r.itemId,
      itemName: r.item.name,
      basePriceMinor: r.item.priceMinor,
      locationName: r.location?.name ?? null,
      channelLabel: r.channel ? (ORDER_CHANNEL_LABEL[r.channel as OrderChannel] ?? r.channel) : null,
      priceMinor: r.priceMinor,
      effectiveFrom: day(r.effectiveFrom),
      effectiveTo: r.effectiveTo ? day(r.effectiveTo) : null,
      current: day(r.effectiveFrom) <= today && (!r.effectiveTo || day(r.effectiveTo) >= today),
      overlaps: clashing.has(r.id),
    }));
  },
};

export function registerDineinPrices(): void {
  registerCommand(saveMenuPriceRule);
  registerCommand(endMenuPriceRule);
  registerQuery(listMenuPriceRules);
}
