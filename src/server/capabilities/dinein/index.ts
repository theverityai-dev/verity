import { z } from "zod";
import { registerContribution } from "@/server/platform/contribution";
import { registerCommand, ValidationError, type CommandContext, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { registerTransitionGuard, transition } from "@/server/platform/state";
import { diffFields, recordActivity } from "@/server/platform/audit";
import {
  applyStateToClocks,
  startClock,
  remainingMinutes,
  sweepBreaches,
  urgencyFor,
} from "@/server/platform/sla";
import { notify } from "@/server/platform/notification";
import { resolveConfig } from "@/server/platform/capability";
import { withTenant, type TenantScopedClient } from "@/server/platform/tenancy";
import { effectiveTimeZone } from "@/server/platform/temporal";
import { postConsumptionForOrder } from "@/server/capabilities/recipe";
import { upsertCustomerForOrder } from "@/server/capabilities/crm";
import {
  ENTITY_LOYALTY_ENTRY,
  awardPointsForOrder,
  debitPointsForBill,
  redeemablePoints,
  reversePointsForRefund,
} from "@/server/capabilities/loyalty";
import { hasPermission } from "@/server/platform/authorization";
import { findGuestByPhone } from "@/server/capabilities/crm/guests";
import { registerExportable } from "@/server/platform/data-export";
import { minuteOfDay, unavailableReason, type AvailabilityRule, type RuleLabels } from "@/lib/menu-availability";
import { assertOutletInScope, reachableOutletIds, scopedLocationIds } from "./scope";
import { registerDineinReports } from "./reports";

/**
 * CAPABILITY: Dine-in — `verity.capability.dinein`
 *
 * Built for Kent's Restaurant, Defence Colony (KentsRestaurant.md), and reusable
 * by the next table-service restaurant without a fork: menu, floor, taxes and
 * staff are all data, and a tenant that never activates the capability never
 * sees it.
 *
 * PURPOSE-BUILT ON PURPOSE
 * The states below are a restaurant's states, the tax function computes GST, and
 * the floor map stores real coordinates. None of it is generic, and PLATFORM-
 * FREEZE is explicit that this is the encouraged half of "standardize the
 * foundation, not every behavior": configuration is not a virtue, and pushing a
 * dining order through a generic work renderer would trade real usability for a
 * uniformity nobody asked for.
 *
 * What IS configuration is the part that genuinely varies between restaurants —
 * tax rates, prep targets, currency — read through `resolveConfig` and never
 * hard-coded.
 *
 * WHAT THIS CAPABILITY DOES NOT TOUCH
 * Nothing in `src/server/platform/`. Every mutation is a registered command,
 * every read a registered query, and the SLA behaviour falls out of declaring
 * honest state categories rather than from any clock code written here.
 */

export * from "./keys";
import {
  CONFIG_CGST_RATE,
  CONFIG_PREP_TARGET_MINUTES,
  CONFIG_SGST_RATE,
  DINEIN_CAPABILITY,
  ENTITY_BILL,
  ENTITY_MENU_CATEGORY,
  ENTITY_MENU_ITEM,
  ENTITY_MENU_VARIANT,
  ENTITY_ORDER,
  ENTITY_ORDER_LINE,
  ENTITY_PAYMENT,
  ENTITY_TABLE,
  ENTITY_ZONE,
  ORDER_CHANNEL_LABEL,
  ORDER_CHANNELS,
  type OrderChannel,
} from "./keys";

/** The most of one item a single order line can hold. */
const MAX_LINE_QTY = 99;

/** How a bill can be paid (PRD §46). Stored as these keys on `Payment.method`. */
export const BILL_PAYMENT_METHODS = ["cash", "card", "upi", "wallet", "bank_transfer", "delivery_platform", "other"] as const;

/**
 * How an order is named on every screen: its table for dine-in, otherwise the
 * channel and whatever identifies the guest ("Takeaway · Ravi",
 * "Zomato #4821"). One function so the kitchen, counter and bill agree.
 */
export function orderLabel(order: {
  channel: string;
  table: { label: string } | null;
  platform: string | null;
  platformOrderRef: string | null;
  customerName: string | null;
}): string {
  if (order.table) return `Table ${order.table.label}`;
  if (order.channel === "delivery_platform") {
    const ref = order.platformOrderRef ? ` #${order.platformOrderRef}` : "";
    return `${order.platform ?? "Delivery platform"}${ref}`;
  }
  const channel = ORDER_CHANNEL_LABEL[order.channel as OrderChannel] ?? order.channel;
  return order.customerName ? `${channel} · ${order.customerName}` : channel;
}

/**
 * Mirrors `outreach`'s `outreachLandingRouteFor` / `trading`'s
 * `landingRouteFor` for the same reason those exist: `/` (the platform's
 * generic Overview) requires `Read` on `verity.platform.overview`, which no
 * dinein role is ever granted — dinein was never wired into `/`'s landing
 * check at all, so every dinein sign-in dead-ended on "You do not have
 * access to this". Derived from what the actor can DO, not from a role name.
 */
export function dineinLandingRouteFor(resolved: Array<{ verb: string; entity: string }>): string | null {
  const has = (verb: string, entity: string) => resolved.some((p) => p.verb === verb && p.entity === entity);
  if (has("Read", ENTITY_ORDER)) return "/floor";
  return null;
}

/* ================================== menu ================================== */

export const createMenuCategory: CommandDefinition<
  { name: string; sortOrder?: number },
  { id: string }
> = {
  key: "verity.dinein.create_menu_category",
  entity: ENTITY_MENU_CATEGORY,
  verb: "Create",
  input: z.object({ name: z.string().min(1).max(120), sortOrder: z.number().int().min(0).optional() }),
  preconditions: async (ctx, input) => {
    const clash = await ctx.tx.menuCategory.findFirst({ where: { name: input.name } });
    if (clash) throw new ValidationError("E_VALIDATION: a category with that name already exists");
  },
  handler: async (ctx, input) => {
    const category = await ctx.tx.menuCategory.create({
      data: { tenantId: ctx.actor.tenantId, name: input.name, sortOrder: input.sortOrder ?? 0 },
    });
    return {
      result: { id: category.id },
      events: [{ name: "verity.dinein.menu_category_created", entityId: category.id }],
    };
  },
};

export const createMenuItem: CommandDefinition<
  {
    categoryId: string;
    name: string;
    priceMinor: number;
    description?: string;
    costMinor?: number;
    sortOrder?: number;
  },
  { id: string }
> = {
  key: "verity.dinein.create_menu_item",
  entity: ENTITY_MENU_ITEM,
  verb: "Create",
  input: z.object({
    categoryId: z.string().uuid(),
    name: z.string().min(1).max(200),
    // Paise. A rupee price arriving here would be a hundredfold error, which is
    // why nothing in this capability ever accepts a decimal amount.
    priceMinor: z.number().int().min(0),
    description: z.string().max(2000).optional(),
    costMinor: z.number().int().min(0).optional(),
    sortOrder: z.number().int().min(0).optional(),
  }),
  preconditions: async (ctx, input) => {
    const category = await ctx.tx.menuCategory.findUnique({ where: { id: input.categoryId } });
    if (!category) throw new ValidationError("E_VALIDATION: category not found");
    if (!category.active) throw new ValidationError("E_VALIDATION: that category is retired");
  },
  handler: async (ctx, input) => {
    const item = await ctx.tx.menuItem.create({
      data: {
        tenantId: ctx.actor.tenantId,
        categoryId: input.categoryId,
        name: input.name,
        priceMinor: input.priceMinor,
        description: input.description ?? null,
        costMinor: input.costMinor ?? null,
        sortOrder: input.sortOrder ?? 0,
      },
    });
    return {
      result: { id: item.id },
      events: [{ name: "verity.dinein.menu_item_created", entityId: item.id }],
    };
  },
};

export const editMenuItem: CommandDefinition<
  { itemId: string; name?: string; priceMinor?: number; description?: string | null },
  { id: string }
> = {
  key: "verity.dinein.edit_menu_item",
  entity: ENTITY_MENU_ITEM,
  verb: "Edit",
  input: z.object({
    itemId: z.string().uuid(),
    name: z.string().min(1).max(200).optional(),
    priceMinor: z.number().int().min(0).optional(),
    description: z.string().max(2000).nullable().optional(),
  }),
  handler: async (ctx, input) => {
    const before = await ctx.tx.menuItem.findUniqueOrThrow({ where: { id: input.itemId } });
    const after = await ctx.tx.menuItem.update({
      where: { id: input.itemId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.priceMinor === undefined ? {} : { priceMinor: input.priceMinor }),
        ...(input.description === undefined ? {} : { description: input.description }),
        version: { increment: 1 },
      },
    });

    // A price change is a thing people ask about later. The diff records what it
    // was, not merely that it changed.
    await recordActivity(ctx, {
      entityKey: ENTITY_MENU_ITEM,
      entityId: after.id,
      commandKey: "verity.dinein.edit_menu_item",
      changes: diffFields(
        { name: before.name, priceMinor: before.priceMinor },
        { name: after.name, priceMinor: after.priceMinor },
      ),
    });

    return {
      result: { id: after.id },
      events: [{ name: "verity.dinein.menu_item_edited", entityId: after.id }],
    };
  },
};

/**
 * What an item has cost on the menu and when that changed (Task 125 item 3.4). Read
 * from the audit trail that `editMenuItem` already writes, so there is no second
 * copy to drift. Orders keep their own price snapshot; this is for the owner to see
 * what changed, when and by whom.
 */
export type PriceHistory = {
  itemName: string;
  currentPriceMinor: number;
  /** Oldest first. The first entry is the price the item was listed at. */
  entries: Array<{ at: Date; fromMinor: number | null; toMinor: number; by: string | null }>;
};

export const listMenuItemPriceHistory: QueryDefinition<{ itemId: string }, PriceHistory | null> = {
  key: "verity.dinein.list_menu_item_price_history",
  entity: ENTITY_MENU_ITEM,
  input: z.object({ itemId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const item = await ctx.tx.menuItem.findUnique({ where: { id: input.itemId } });
    if (!item) return null;
    const changes = await ctx.tx.activity.findMany({
      where: { entityKey: ENTITY_MENU_ITEM, entityId: item.id, fieldChanged: "priceMinor" },
      orderBy: { occurredAt: "asc" },
    });
    const users = await ctx.tx.user.findMany({
      where: { id: { in: [...new Set(changes.map((c) => c.actorUserId).filter((id): id is string => id !== null))] } },
      include: { party: { select: { displayName: true } } },
    });
    const nameOf = new Map(users.map((u) => [u.id, u.party.displayName]));

    const entries: PriceHistory["entries"] = [
      // Listed at what the first change replaced; if it never changed, at today's price.
      { at: item.createdAt, fromMinor: null, toMinor: changes[0] ? Number(changes[0].oldValue) : item.priceMinor, by: null },
      ...changes.map((c) => ({
        at: c.occurredAt,
        fromMinor: c.oldValue === null ? null : Number(c.oldValue),
        toMinor: Number(c.newValue),
        by: c.actorUserId ? (nameOf.get(c.actorUserId) ?? null) : null,
      })),
    ];
    return { itemName: item.name, currentPriceMinor: item.priceMinor, entries };
  },
};

/**
 * Retires or restores a menu item.
 *
 * There is no delete command and no Delete grant anywhere in this capability.
 * Bills reference what was sold; an item that could vanish would take the
 * catalogue's half of that history with it.
 */
export const setMenuItemActive: CommandDefinition<
  { itemId: string; active: boolean },
  { id: string; active: boolean }
> = {
  key: "verity.dinein.set_menu_item_active",
  entity: ENTITY_MENU_ITEM,
  verb: "ActionExecute",
  input: z.object({ itemId: z.string().uuid(), active: z.boolean() }),
  handler: async (ctx, input) => {
    const before = await ctx.tx.menuItem.findUniqueOrThrow({ where: { id: input.itemId } });
    const after = await ctx.tx.menuItem.update({
      where: { id: input.itemId },
      data: { active: input.active, version: { increment: 1 } },
    });

    await recordActivity(ctx, {
      entityKey: ENTITY_MENU_ITEM,
      entityId: after.id,
      commandKey: "verity.dinein.set_menu_item_active",
      changes: diffFields({ active: before.active }, { active: after.active }),
    });

    return {
      result: { id: after.id, active: after.active },
      events: [
        {
          name: input.active
            ? "verity.dinein.menu_item_activated"
            : "verity.dinein.menu_item_deactivated",
          entityId: after.id,
        },
      ],
    };
  },
};

export const createMenuVariant: CommandDefinition<
  { itemId: string; name: string; priceDeltaMinor: number },
  { id: string }
> = {
  key: "verity.dinein.create_menu_variant",
  entity: ENTITY_MENU_VARIANT,
  verb: "Create",
  input: z.object({
    itemId: z.string().uuid(),
    name: z.string().min(1).max(60),
    // A delta, and it may be negative: Half is cheaper than Full.
    priceDeltaMinor: z.number().int(),
  }),
  preconditions: async (ctx, input) => {
    const item = await ctx.tx.menuItem.findUnique({ where: { id: input.itemId } });
    if (!item) throw new ValidationError("E_VALIDATION: item not found");
  },
  handler: async (ctx, input) => {
    const variant = await ctx.tx.menuItemVariant.create({
      data: {
        tenantId: ctx.actor.tenantId,
        itemId: input.itemId,
        name: input.name,
        priceDeltaMinor: input.priceDeltaMinor,
      },
    });
    return {
      result: { id: variant.id },
      events: [{ name: "verity.dinein.menu_variant_created", entityId: variant.id }],
    };
  },
};

/**
 * Add-ons for one item (Task 125 item 3.1). Independent options priced zero or
 * more; the order line snapshots the chosen ones, so editing or retiring a
 * modifier never rewrites a bill. Governed by the same entity as portions.
 */
export type LineModifier = { name: string; priceDeltaMinor: number };

/** An order line's add-on rows as a list sorted by name, so the same set always compares equal. */
export function readModifiers(rows: ReadonlyArray<{ name: string; priceDeltaMinor: number }> | undefined): LineModifier[] {
  return (rows ?? []).map((r) => ({ name: r.name, priceDeltaMinor: r.priceDeltaMinor })).sort((a, b) => a.name.localeCompare(b.name));
}

const sameModifiers = (a: LineModifier[], b: LineModifier[]) =>
  a.length === b.length && a.every((m, i) => m.name === b[i]!.name && m.priceDeltaMinor === b[i]!.priceDeltaMinor);

export const createMenuModifier: CommandDefinition<
  { itemId: string; name: string; priceDeltaMinor: number },
  { id: string }
> = {
  key: "verity.dinein.create_menu_modifier",
  entity: ENTITY_MENU_VARIANT,
  verb: "Create",
  input: z.object({
    itemId: z.string().uuid(),
    name: z.string().trim().min(1).max(60),
    // Zero for a free option such as "Extra spicy"; never negative, since a
    // discount is a discount and not an add-on.
    priceDeltaMinor: z.number().int().min(0).max(1_000_000),
  }),
  preconditions: async (ctx, input) => {
    if (!(await ctx.tx.menuItem.findUnique({ where: { id: input.itemId } }))) {
      throw new ValidationError("E_VALIDATION: item not found");
    }
    if (await ctx.tx.menuModifier.findUnique({ where: { tenantId_itemId_name: { tenantId: ctx.actor.tenantId, itemId: input.itemId, name: input.name } } })) {
      throw new ValidationError(`E_VALIDATION: this item already has an add-on called "${input.name}"`);
    }
  },
  handler: async (ctx, input) => {
    const modifier = await ctx.tx.menuModifier.create({
      data: { tenantId: ctx.actor.tenantId, itemId: input.itemId, name: input.name, priceDeltaMinor: input.priceDeltaMinor },
    });
    return { result: { id: modifier.id }, events: [{ name: "verity.dinein.menu_modifier_created", entityId: modifier.id }] };
  },
};

/** Retire or restore an add-on. Orders already taken keep their snapshot either way. */
export const setMenuModifierActive: CommandDefinition<{ modifierId: string; active: boolean }, { id: string }> = {
  key: "verity.dinein.set_menu_modifier_active",
  entity: ENTITY_MENU_VARIANT,
  verb: "Edit",
  input: z.object({ modifierId: z.string().uuid(), active: z.boolean() }),
  preconditions: async (ctx, input) => {
    if (!(await ctx.tx.menuModifier.findUnique({ where: { id: input.modifierId } }))) {
      throw new ValidationError("E_VALIDATION: add-on not found");
    }
  },
  handler: async (ctx, input) => {
    await ctx.tx.menuModifier.update({ where: { id: input.modifierId }, data: { active: input.active, version: { increment: 1 } } });
    return { result: { id: input.modifierId }, events: [{ name: "verity.dinein.menu_modifier_updated", entityId: input.modifierId }] };
  },
};

/* ============================ menu availability =========================== */

/** One saved availability rule as the menu screens read it. */
export type AvailabilityRuleView = AvailabilityRule & { id: string; locationName: string | null };

const toRule = (r: { locationId: string | null; channel: string | null; fromMinute: number | null; toMinute: number | null }): AvailabilityRule => ({
  locationId: r.locationId,
  channel: r.channel,
  fromMinute: r.fromMinute,
  toMinute: r.toMinute,
});

const ruleKey = (r: AvailabilityRule) => `${r.channel ?? "*"}|${r.locationId ?? "*"}|${r.fromMinute ?? "*"}-${r.toMinute ?? "*"}`;

/** Outlet names for the "why is this hidden" text. */
async function ruleLabels(tx: TenantScopedClient, rules: readonly AvailabilityRule[]): Promise<RuleLabels> {
  const ids = [...new Set(rules.map((r) => r.locationId).filter((id): id is string => id !== null))];
  const rows = ids.length > 0 ? await tx.location.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const names = new Map(rows.map((l) => [l.id, l.name]));
  return {
    location: (id) => names.get(id) ?? "another outlet",
    channel: (key) => ORDER_CHANNEL_LABEL[key as OrderChannel] ?? key,
  };
}

/**
 * Where and when an order is being taken: its outlet, its channel, and the minute
 * of the day on that outlet's own clock. The zone comes from the outlet's
 * organization, so a 07:00 breakfast cut-off means 07:00 where the kitchen is.
 */
async function orderAvailabilityContext(tx: TenantScopedClient, order: { locationId: string; channel: string }, at = new Date()) {
  const location = await tx.location.findUniqueOrThrow({ where: { id: order.locationId }, select: { organizationId: true } });
  const timeZone = await effectiveTimeZone(tx, location.organizationId);
  return { locationId: order.locationId, channel: order.channel, minuteOfDay: minuteOfDay(at, timeZone) };
}

/**
 * Replaces an item's availability rules (Task 125 items 3.2 and 3.3). An empty
 * list removes every rule, so the item is available wherever it is active.
 * Replace-all keeps the editor simple: it submits what it shows.
 */
export const setMenuItemAvailability: CommandDefinition<
  { itemId: string; rules: AvailabilityRule[] },
  { id: string; rules: number }
> = {
  key: "verity.dinein.set_menu_item_availability",
  entity: ENTITY_MENU_ITEM,
  verb: "Edit",
  input: z.object({
    itemId: z.string().uuid(),
    rules: z
      .array(
        z
          .object({
            locationId: z.string().uuid().nullable(),
            channel: z.enum(ORDER_CHANNELS).nullable(),
            fromMinute: z.number().int().min(0).max(1439).nullable(),
            toMinute: z.number().int().min(0).max(1439).nullable(),
          })
          .superRefine((rule, issue) => {
            if ((rule.fromMinute === null) !== (rule.toMinute === null)) {
              issue.addIssue({ code: "custom", path: ["toMinute"], message: "give both a start and an end time, or neither" });
            }
            if (rule.fromMinute !== null && rule.fromMinute === rule.toMinute) {
              issue.addIssue({ code: "custom", path: ["toMinute"], message: "the start and end time must differ" });
            }
            if (rule.locationId === null && rule.channel === null && rule.fromMinute === null) {
              issue.addIssue({ code: "custom", path: ["channel"], message: "a rule must limit an outlet, a channel or a time of day" });
            }
          }),
      )
      .max(20),
  }),
  preconditions: async (ctx, input) => {
    if (!(await ctx.tx.menuItem.findUnique({ where: { id: input.itemId } }))) {
      throw new ValidationError("E_VALIDATION: item not found");
    }
    const outletIds = [...new Set(input.rules.map((r) => r.locationId).filter((id): id is string => id !== null))];
    if (outletIds.length > 0) {
      const found = await ctx.tx.location.count({ where: { id: { in: outletIds }, active: true } });
      if (found !== outletIds.length) throw new ValidationError("E_VALIDATION: an outlet in these rules was not found");
    }
  },
  handler: async (ctx, input) => {
    const before = await ctx.tx.menuAvailability.findMany({ where: { itemId: input.itemId } });
    await ctx.tx.menuAvailability.deleteMany({ where: { itemId: input.itemId } });
    if (input.rules.length > 0) {
      await ctx.tx.menuAvailability.createMany({
        data: input.rules.map((r) => ({ tenantId: ctx.actor.tenantId, itemId: input.itemId, ...r })),
      });
    }
    await recordActivity(ctx, {
      entityKey: ENTITY_MENU_ITEM,
      entityId: input.itemId,
      commandKey: "verity.dinein.set_menu_item_availability",
      changes: diffFields(
        { availability: before.map((r) => ruleKey(toRule(r))).sort().join(", ") || "always" },
        { availability: input.rules.map(ruleKey).sort().join(", ") || "always" },
      ),
    });
    return {
      result: { id: input.itemId, rules: input.rules.length },
      events: [{ name: "verity.dinein.menu_item_availability_set", entityId: input.itemId }],
    };
  },
};

/* ================================= floor ================================== */

export const defineZone: CommandDefinition<
  { locationId: string; name: string; floorLabel?: string; sortOrder?: number },
  { id: string }
> = {
  key: "verity.dinein.define_zone",
  entity: ENTITY_ZONE,
  verb: "Create",
  input: z.object({
    locationId: z.string().uuid(),
    name: z.string().min(1).max(120),
    floorLabel: z.string().max(60).optional(),
    sortOrder: z.number().int().min(0).optional(),
  }),
  preconditions: async (ctx, input) => {
    const location = await ctx.tx.location.findUnique({ where: { id: input.locationId } });
    if (!location) throw new ValidationError("E_VALIDATION: outlet not found");
    await assertOutletInScope(ctx.tx, ctx.actor, ENTITY_ZONE, "Create", input.locationId);
    const clash = await ctx.tx.diningZone.findFirst({
      where: { locationId: input.locationId, name: input.name },
    });
    if (clash) throw new ValidationError("E_VALIDATION: a zone with that name already exists at this outlet");
  },
  handler: async (ctx, input) => {
    const zone = await ctx.tx.diningZone.create({
      data: {
        tenantId: ctx.actor.tenantId,
        locationId: input.locationId,
        name: input.name,
        floorLabel: input.floorLabel ?? null,
        sortOrder: input.sortOrder ?? 0,
      },
    });
    return {
      result: { id: zone.id },
      events: [{ name: "verity.dinein.zone_defined", entityId: zone.id }],
    };
  },
};

export const defineTable: CommandDefinition<
  { zoneId: string; label: string; seats: number; shape?: string; posX?: number; posY?: number },
  { id: string }
> = {
  key: "verity.dinein.define_table",
  entity: ENTITY_TABLE,
  verb: "Create",
  input: z.object({
    zoneId: z.string().uuid(),
    label: z.string().min(1).max(30),
    seats: z.number().int().min(1).max(50),
    shape: z.string().max(20).optional(),
    posX: z.number().int().optional(),
    posY: z.number().int().optional(),
  }),
  preconditions: async (ctx, input) => {
    const zone = await ctx.tx.diningZone.findUnique({ where: { id: input.zoneId } });
    if (!zone) throw new ValidationError("E_VALIDATION: zone not found");
    await assertOutletInScope(ctx.tx, ctx.actor, ENTITY_TABLE, "Create", zone.locationId);
    const clash = await ctx.tx.diningTable.findFirst({
      where: { locationId: zone.locationId, label: input.label },
    });
    if (clash) throw new ValidationError("E_VALIDATION: a table with that label already exists at this outlet");
  },
  handler: async (ctx, input) => {
    const zone = await ctx.tx.diningZone.findUniqueOrThrow({ where: { id: input.zoneId } });
    const table = await ctx.tx.diningTable.create({
      data: {
        tenantId: ctx.actor.tenantId,
        zoneId: input.zoneId,
        locationId: zone.locationId,
        label: input.label,
        seats: input.seats,
        shape: input.shape ?? null,
        posX: input.posX ?? 0,
        posY: input.posY ?? 0,
      },
    });
    return {
      result: { id: table.id },
      events: [{ name: "verity.dinein.table_defined", entityId: table.id }],
    };
  },
};

/** Where the manager dragged it on the floor plan. */
export const positionTable: CommandDefinition<
  { tableId: string; posX: number; posY: number },
  { id: string }
> = {
  key: "verity.dinein.position_table",
  entity: ENTITY_TABLE,
  verb: "Edit",
  input: z.object({
    tableId: z.string().uuid(),
    posX: z.number().int().min(0).max(10_000),
    posY: z.number().int().min(0).max(10_000),
  }),
  handler: async (ctx, input) => {
    const table = await ctx.tx.diningTable.update({
      where: { id: input.tableId },
      data: { posX: input.posX, posY: input.posY, version: { increment: 1 } },
    });
    return {
      result: { id: table.id },
      events: [{ name: "verity.dinein.table_positioned", entityId: table.id }],
    };
  },
};

/**
 * Moves a table between states.
 *
 * One command rather than five, because the platform's transition engine
 * already refuses anything the machine does not declare — five commands would
 * be five copies of the same authorization and audit, differing only in a
 * string. The declared edges are the specification; this is the door.
 */
export const moveTable: CommandDefinition<
  { tableId: string; to: string },
  { from: string; to: string }
> = {
  key: "verity.dinein.move_table",
  entity: ENTITY_TABLE,
  verb: "ActionExecute",
  input: z.object({
    tableId: z.string().uuid(),
    to: z.enum(["available", "occupied", "reserved", "cleaning", "out_of_service", "retired"]),
  }),
  handler: async (ctx, input) => {
    const table = await ctx.tx.diningTable.findUniqueOrThrow({ where: { id: input.tableId } });

    const moved = await transition(ctx, {
      entityKey: ENTITY_TABLE,
      entityId: table.id,
      fromKey: table.state,
      toKey: input.to,
    });

    await ctx.tx.diningTable.update({
      where: { id: table.id },
      data: { state: input.to, version: { increment: 1 } },
    });

    await recordActivity(ctx, {
      entityKey: ENTITY_TABLE,
      entityId: table.id,
      commandKey: "verity.dinein.move_table",
      changes: diffFields({ state: table.state }, { state: input.to }),
    });

    return { result: { from: moved.from.key, to: moved.to.key }, events: [moved.event] };
  },
};

/* ================================ service ================================= */

export const createOrder: CommandDefinition<
  {
    channel?: OrderChannel;
    tableId?: string;
    locationId?: string;
    covers?: number;
    customerName?: string;
    customerPhone?: string;
    platform?: string;
    platformOrderRef?: string;
  },
  { id: string }
> = {
  key: "verity.dinein.create_order",
  entity: ENTITY_ORDER,
  verb: "Create",
  input: z
    .object({
      // Defaults to dine-in so every existing caller (the floor plan) is unchanged.
      channel: z.enum(ORDER_CHANNELS).default("dine_in"),
      tableId: z.string().uuid().optional(),
      // Only for orders with no table: the table already says which outlet.
      locationId: z.string().uuid().optional(),
      covers: z.number().int().min(1).max(50).default(1),
      customerName: z.string().trim().max(120).optional(),
      customerPhone: z.string().trim().max(20).optional(),
      platform: z.string().trim().min(1).max(60).optional(),
      platformOrderRef: z.string().trim().min(1).max(60).optional(),
    })
    .superRefine((input, issue) => {
      if (input.channel === "dine_in") {
        if (!input.tableId) issue.addIssue({ code: "custom", path: ["tableId"], message: "a dine-in order needs a table" });
        if (input.locationId) issue.addIssue({ code: "custom", path: ["locationId"], message: "a dine-in order takes its outlet from the table" });
      } else {
        if (input.tableId) issue.addIssue({ code: "custom", path: ["tableId"], message: "only a dine-in order sits at a table" });
        if (!input.locationId) issue.addIssue({ code: "custom", path: ["locationId"], message: "choose the outlet taking this order" });
      }
      if (input.channel === "delivery_platform" && !input.platform) {
        issue.addIssue({ code: "custom", path: ["platform"], message: "name the delivery platform" });
      }
      if (input.channel !== "delivery_platform" && (input.platform || input.platformOrderRef)) {
        issue.addIssue({ code: "custom", path: ["platform"], message: "a platform applies only to delivery-platform orders" });
      }
    }),
  preconditions: async (ctx, input) => {
    if (!input.tableId) {
      // No table: the outlet is chosen directly, and must be one the actor may
      // take orders for.
      const location = await ctx.tx.location.findUnique({ where: { id: input.locationId! } });
      if (!location || !location.active) throw new ValidationError("E_VALIDATION: outlet not found");
      await assertOutletInScope(ctx.tx, ctx.actor, ENTITY_ORDER, "Create", location.id);
      return;
    }
    const table = await ctx.tx.diningTable.findUnique({ where: { id: input.tableId } });
    if (!table) throw new ValidationError("E_VALIDATION: table not found");
    await assertOutletInScope(ctx.tx, ctx.actor, ENTITY_ORDER, "Create", table.locationId);
    if (table.state !== "occupied") {
      throw new ValidationError("E_VALIDATION: seat the guests first — the table is not occupied");
    }

    // Double-seating is prevented here rather than by a scheduling overlap
    // trigger. One open order per table is the whole rule.
    const open = await ctx.tx.diningOrder.findFirst({
      where: { tableId: input.tableId, state: { notIn: ["settled", "cancelled"] } },
    });
    if (open) throw new ValidationError("E_VALIDATION: that table already has an open order");
  },
  handler: async (ctx, input) => {
    const locationId = input.tableId
      ? (await ctx.tx.diningTable.findUniqueOrThrow({ where: { id: input.tableId } })).locationId
      : input.locationId!;
    const order = await ctx.tx.diningOrder.create({
      data: {
        tenantId: ctx.actor.tenantId,
        tableId: input.tableId ?? null,
        channel: input.channel ?? "dine_in",
        platform: input.platform ?? null,
        platformOrderRef: input.platformOrderRef ?? null,
        locationId,
        // From the session. A waiter cannot record an order as someone else by
        // putting their id in the payload (PLA-TEN-006).
        takenByUserId: ctx.actor.userId,
        covers: input.covers ?? 1,
        customerName: input.customerName || null,
        customerPhone: input.customerPhone || null,
      },
    });
    return {
      result: { id: order.id },
      events: [{ name: "verity.dinein.order_created", entityId: order.id }],
    };
  },
};

/**
 * Adds lines to an order, snapshotting name and price.
 *
 * Allowed after the order has been placed as well as before: a table ordering
 * dessert later is normal service, and those lines land in the kitchen queue as
 * `queued` exactly like the first round.
 *
 * While the order is still a draft, adding the same item (same portion, same
 * note) again raises the quantity on the existing line instead of stacking a
 * second "1 ×" line. Once sent, a later round stays a line of its own, because
 * the kitchen cooks it as a separate ticket.
 */
export const addOrderLines: CommandDefinition<
  {
    orderId: string;
    lines: Array<{ itemId: string; variantId?: string; modifierIds?: string[]; qty: number; lineNote?: string }>;
  },
  { added: number }
> = {
  key: "verity.dinein.add_order_lines",
  entity: ENTITY_ORDER,
  verb: "Edit",
  input: z.object({
    orderId: z.string().uuid(),
    lines: z
      .array(
        z.object({
          itemId: z.string().uuid(),
          variantId: z.string().uuid().optional(),
          // Add-ons asked for on this item; each at most once.
          modifierIds: z.array(z.string().uuid()).max(10).optional(),
          qty: z.number().int().min(1).max(MAX_LINE_QTY),
          lineNote: z.string().max(200).optional(),
        }),
      )
      .min(1),
  }),
  preconditions: async (ctx, input) => {
    const order = await ctx.tx.diningOrder.findUnique({ where: { id: input.orderId } });
    if (!order) throw new ValidationError("E_VALIDATION: order not found");
    if (!["draft", "placed", "partially_served"].includes(order.state)) {
      throw new ValidationError(`E_VALIDATION: cannot add to an order that is ${order.state}`);
    }
  },
  handler: async (ctx, input) => {
    const order = await ctx.tx.diningOrder.findUniqueOrThrow({ where: { id: input.orderId } });
    // Where and when this order is being taken, read once for every line.
    const where = await orderAvailabilityContext(ctx.tx, order);

    for (const line of input.lines) {
      const item = await ctx.tx.menuItem.findUnique({ where: { id: line.itemId } });
      if (!item) throw new ValidationError("E_VALIDATION: menu item not found");
      if (!item.active) {
        throw new ValidationError(`E_VALIDATION: ${item.name} is not available right now`);
      }
      const rules = (await ctx.tx.menuAvailability.findMany({ where: { itemId: item.id } })).map(toRule);
      const hidden = unavailableReason(rules, where, await ruleLabels(ctx.tx, rules));
      if (hidden) throw new ValidationError(`E_VALIDATION: ${item.name} is not available on this order. ${hidden}`);

      let unitPriceMinor = item.priceMinor;
      let variantName: string | null = null;
      if (line.variantId) {
        const variant = await ctx.tx.menuItemVariant.findUnique({ where: { id: line.variantId } });
        if (!variant || variant.itemId !== item.id) {
          throw new ValidationError("E_VALIDATION: that portion does not belong to this item");
        }
        unitPriceMinor += variant.priceDeltaMinor;
        variantName = variant.name;
      }
      if (unitPriceMinor < 0) {
        throw new ValidationError("E_VALIDATION: that portion prices the item below zero");
      }

      // Add-ons: resolved here, priced into the unit price, and snapshotted
      // (sorted by name) so the same set always compares equal.
      const wanted = [...new Set(line.modifierIds ?? [])];
      const chosen = wanted.length > 0 ? await ctx.tx.menuModifier.findMany({ where: { id: { in: wanted } } }) : [];
      if (chosen.length !== wanted.length || chosen.some((m) => m.itemId !== item.id)) {
        throw new ValidationError("E_VALIDATION: an add-on does not belong to this item");
      }
      const retired = chosen.find((m) => !m.active);
      if (retired) throw new ValidationError(`E_VALIDATION: ${retired.name} is not available right now`);
      const modifiers = readModifiers(chosen);
      unitPriceMinor += modifiers.reduce((sum, m) => sum + m.priceDeltaMinor, 0);

      if (order.state === "draft") {
        // A different set of add-ons is a different line, so compare them.
        const candidates = await ctx.tx.orderLine.findMany({
          where: {
            orderId: order.id,
            itemId: item.id,
            variantId: line.variantId ?? null,
            lineNote: line.lineNote ?? null,
            state: "queued",
          },
          include: { addOns: true },
        });
        const same = candidates.find((c) => sameModifiers(readModifiers(c.addOns), modifiers));
        if (same) {
          if (same.qty + line.qty > MAX_LINE_QTY) {
            throw new ValidationError(`E_VALIDATION: one line holds at most ${MAX_LINE_QTY} of ${item.name}`);
          }
          await ctx.tx.orderLine.update({ where: { id: same.id }, data: { qty: same.qty + line.qty, version: { increment: 1 } } });
          continue;
        }
      }

      const created = await ctx.tx.orderLine.create({
        data: {
          tenantId: ctx.actor.tenantId,
          orderId: order.id,
          itemId: item.id,
          variantId: line.variantId ?? null,
          // Snapshots. The bill must render what was charged even after the item
          // is renamed, repriced or retired.
          itemNameSnapshot: item.name,
          variantNameSnapshot: variantName,
          unitPriceMinor,
          qty: line.qty,
          lineNote: line.lineNote ?? null,
        },
      });
      // The add-on snapshot rows, written with the line in the same transaction.
      if (modifiers.length > 0) {
        await ctx.tx.orderLineModifier.createMany({
          data: modifiers.map((m) => ({
            tenantId: ctx.actor.tenantId,
            orderLineId: created.id,
            name: m.name,
            priceDeltaMinor: m.priceDeltaMinor,
          })),
        });
      }

      // A line added to an already-placed order is live work the moment it
      // exists, so its clock attaches now rather than at some later sweep.
      if (order.state !== "draft") {
        await startClock(ctx.tx, {
          tenantId: ctx.actor.tenantId,
          entityKey: ENTITY_ORDER_LINE,
          entityId: created.id,
        });
      }
    }

    await ctx.tx.diningOrder.update({
      where: { id: order.id },
      data: { version: { increment: 1 } },
    });

    return {
      result: { added: input.lines.length },
      events: [{ name: "verity.dinein.order_lines_added", entityId: order.id }],
    };
  },
};

/**
 * Changes how many of a line the table wants, or removes it (qty 0), while the
 * order is still a draft. Nothing has reached the kitchen yet, so this is an
 * edit, not a void. After the order is sent, taking something off is a void
 * with a reason (`void_order_line`), because by then it is money and work.
 */
export const setOrderLineQty: CommandDefinition<{ lineId: string; qty: number }, { lineId: string; qty: number }> = {
  key: "verity.dinein.set_order_line_qty",
  entity: ENTITY_ORDER,
  verb: "Edit",
  input: z.object({ lineId: z.string().uuid(), qty: z.number().int().min(0).max(MAX_LINE_QTY) }),
  preconditions: async (ctx, input) => {
    const line = await ctx.tx.orderLine.findUnique({ where: { id: input.lineId }, include: { order: { select: { state: true } } } });
    if (!line) throw new ValidationError("E_VALIDATION: order line not found");
    if (line.order.state !== "draft" || line.state !== "queued") {
      throw new ValidationError("E_VALIDATION: this line has gone to the kitchen; void it with a reason instead");
    }
  },
  handler: async (ctx, input) => {
    const line = await ctx.tx.orderLine.findUniqueOrThrow({ where: { id: input.lineId } });
    if (input.qty === 0) await ctx.tx.orderLine.delete({ where: { id: line.id } });
    else await ctx.tx.orderLine.update({ where: { id: line.id }, data: { qty: input.qty, version: { increment: 1 } } });
    await ctx.tx.diningOrder.update({ where: { id: line.orderId }, data: { version: { increment: 1 } } });
    return {
      result: { lineId: line.id, qty: input.qty },
      events: [{ name: "verity.dinein.order_line_quantity_set", entityId: line.orderId, payload: { lineId: line.id, qty: input.qty } }],
    };
  },
};

/** Sends the order to the kitchen. Prices are already frozen on the lines. */
export const placeOrder: CommandDefinition<{ orderId: string }, { id: string; lines: number }> = {
  key: "verity.dinein.place_order",
  entity: ENTITY_ORDER,
  verb: "ActionExecute",
  input: z.object({ orderId: z.string().uuid() }),
  preconditions: async (ctx, input) => {
    const lines = await ctx.tx.orderLine.count({ where: { orderId: input.orderId } });
    if (lines === 0) throw new ValidationError("E_VALIDATION: an empty order cannot be sent");
  },
  handler: async (ctx, input) => {
    const order = await ctx.tx.diningOrder.findUniqueOrThrow({ where: { id: input.orderId } });

    const moved = await transition(ctx, {
      entityKey: ENTITY_ORDER,
      entityId: order.id,
      fromKey: order.state,
      toKey: "placed",
    });

    await ctx.tx.diningOrder.update({
      where: { id: order.id },
      data: { state: "placed", placedAt: new Date(), version: { increment: 1 } },
    });

    // Every line gets a prep clock. Whether it RUNS is decided by the line's
    // state category — `queued` is Pending, so waiting in the queue does not
    // burn the kitchen's budget. Nothing here computes a deadline.
    const lines = await ctx.tx.orderLine.findMany({
      where: { orderId: order.id, state: "queued" },
      select: { id: true },
    });
    for (const line of lines) {
      await startClock(ctx.tx, {
        tenantId: ctx.actor.tenantId,
        entityKey: ENTITY_ORDER_LINE,
        entityId: line.id,
      });
    }

    await recordActivity(ctx, {
      entityKey: ENTITY_ORDER,
      entityId: order.id,
      commandKey: "verity.dinein.place_order",
      changes: diffFields({ state: order.state }, { state: "placed" }),
    });

    return { result: { id: order.id, lines: lines.length }, events: [moved.event] };
  },
};

/**
 * Moves one line through the kitchen and, when the last one lands, the order
 * with it.
 *
 * The order's state is DERIVED here rather than tapped separately: a waiter
 * marking the last dish served should not also have to remember to close the
 * order, and a kitchen that had to keep the two in sync by hand would drift
 * within one service.
 */
export const advanceOrderLine: CommandDefinition<
  { lineId: string; to: string },
  { lineState: string; orderState: string }
> = {
  key: "verity.dinein.advance_order_line",
  entity: ENTITY_ORDER_LINE,
  verb: "ActionExecute",
  input: z.object({
    lineId: z.string().uuid(),
    to: z.enum(["preparing", "ready", "served", "voided"]),
  }),
  handler: async (ctx, input) => {
    const line = await ctx.tx.orderLine.findUniqueOrThrow({ where: { id: input.lineId } });

    const moved = await transition(ctx, {
      entityKey: ENTITY_ORDER_LINE,
      entityId: line.id,
      fromKey: line.state,
      toKey: input.to,
    });

    await ctx.tx.orderLine.update({
      where: { id: line.id },
      data: { state: input.to, version: { increment: 1 } },
    });

    // Pause, resume or stop — decided from the category, not from the key.
    await applyStateToClocks(ctx.tx, {
      entityKey: ENTITY_ORDER_LINE,
      entityId: line.id,
      category: moved.to.category,
    });

    await recordActivity(ctx, {
      entityKey: ENTITY_ORDER_LINE,
      entityId: line.id,
      commandKey: "verity.dinein.advance_order_line",
      changes: diffFields({ state: line.state }, { state: input.to }),
    });

    const order = await ctx.tx.diningOrder.findUniqueOrThrow({ where: { id: line.orderId } });
    const siblings = await ctx.tx.orderLine.findMany({
      where: { orderId: order.id },
      select: { state: true },
    });

    // Voided lines do not count toward "is this order done" — a cancelled dish
    // is not an outstanding one.
    const live = siblings.filter((sibling) => sibling.state !== "voided");
    const allServed = live.length > 0 && live.every((sibling) => sibling.state === "served");
    const anyServed = live.some((sibling) => sibling.state === "served");

    let orderState = order.state;
    const events = [moved.event];

    if (allServed && order.state !== "served") {
      const orderMove = await transition(ctx, {
        entityKey: ENTITY_ORDER,
        entityId: order.id,
        fromKey: order.state,
        toKey: "served",
      });
      await ctx.tx.diningOrder.update({
        where: { id: order.id },
        data: { state: "served", servedAt: new Date(), version: { increment: 1 } },
      });
      orderState = "served";
      events.push(orderMove.event);
    } else if (anyServed && order.state === "placed") {
      const orderMove = await transition(ctx, {
        entityKey: ENTITY_ORDER,
        entityId: order.id,
        fromKey: order.state,
        toKey: "partially_served",
      });
      await ctx.tx.diningOrder.update({
        where: { id: order.id },
        data: { state: "partially_served", version: { increment: 1 } },
      });
      orderState = "partially_served";
      events.push(orderMove.event);
    }

    // The waiter who took the order is the one who needs to know a dish is on
    // the pass. Suppressed notifications are recorded, not dropped.
    if (input.to === "ready") {
      await notify(ctx.tx, {
        tenantId: ctx.actor.tenantId,
        recipientIds: [order.takenByUserId],
        key: "verity.dinein.item_ready",
        entityKey: ENTITY_ORDER_LINE,
        entityId: line.id,
        variables: { item: line.itemNameSnapshot },
        fallback: { subject: "Ready on the pass", body: "{item} is ready to serve." },
      });
    }

    return { result: { lineState: input.to, orderState }, events };
  },
};

export const voidOrderLine: CommandDefinition<
  { lineId: string; reason?: string },
  { lineId: string }
> = {
  key: "verity.dinein.void_order_line",
  entity: ENTITY_ORDER_LINE,
  verb: "ActionExecute",
  input: z.object({ lineId: z.string().uuid(), reason: z.string().max(200).optional() }),
  handler: async (ctx, input) => {
    const line = await ctx.tx.orderLine.findUniqueOrThrow({ where: { id: input.lineId } });

    const moved = await transition(ctx, {
      entityKey: ENTITY_ORDER_LINE,
      entityId: line.id,
      fromKey: line.state,
      toKey: "voided",
    });

    await ctx.tx.orderLine.update({
      where: { id: line.id },
      data: { state: "voided", version: { increment: 1 } },
    });
    await applyStateToClocks(ctx.tx, {
      entityKey: ENTITY_ORDER_LINE,
      entityId: line.id,
      category: moved.to.category,
    });

    // Voids are money. Who, when and why is a query afterwards, not an
    // investigation.
    await recordActivity(ctx, {
      entityKey: ENTITY_ORDER_LINE,
      entityId: line.id,
      commandKey: "verity.dinein.void_order_line",
      changes: diffFields(
        { state: line.state },
        { state: "voided", reason: input.reason ?? "not given" },
      ),
    });

    return { result: { lineId: line.id }, events: [moved.event] };
  },
};

export const cancelOrder: CommandDefinition<
  { orderId: string; reason?: string },
  { orderId: string }
> = {
  impact: "destructive",
  key: "verity.dinein.cancel_order",
  entity: ENTITY_ORDER,
  verb: "ActionExecute",
  input: z.object({ orderId: z.string().uuid(), reason: z.string().max(200).optional() }),
  preconditions: async (ctx, input) => {
    // Once food has reached the pass it has been cooked, and cancelling would
    // erase a cost the restaurant has already borne. Void the lines instead.
    const cooked = await ctx.tx.orderLine.count({
      where: { orderId: input.orderId, state: { in: ["ready", "served"] } },
    });
    if (cooked > 0) {
      throw new ValidationError(
        "E_VALIDATION: some dishes are already ready or served — void the remaining lines instead",
      );
    }
  },
  handler: async (ctx, input) => {
    const order = await ctx.tx.diningOrder.findUniqueOrThrow({ where: { id: input.orderId } });

    const moved = await transition(ctx, {
      entityKey: ENTITY_ORDER,
      entityId: order.id,
      fromKey: order.state,
      toKey: "cancelled",
    });

    await ctx.tx.diningOrder.update({
      where: { id: order.id },
      data: { state: "cancelled", version: { increment: 1 } },
    });

    await recordActivity(ctx, {
      entityKey: ENTITY_ORDER,
      entityId: order.id,
      commandKey: "verity.dinein.cancel_order",
      changes: diffFields(
        { state: order.state },
        { state: "cancelled", reason: input.reason ?? "not given" },
      ),
    });

    return { result: { orderId: order.id }, events: [moved.event] };
  },
};

/* ============================ table changes ============================= */

const OPEN_FOR_CHANGE = ["draft", "placed", "partially_served"];

/**
 * Moves a dine-in order to another table at the same outlet (pos-restaurant.md
 * §6). The new table must be free; it becomes occupied and the old one goes to
 * cleaning, both through the declared table transitions. Not allowed once a
 * bill exists, because the bill is printed against the table.
 */
export const moveOrderToTable: CommandDefinition<{ orderId: string; toTableId: string }, { orderId: string; tableId: string }> = {
  key: "verity.dinein.move_order_to_table",
  entity: ENTITY_ORDER,
  verb: "Edit",
  input: z.object({ orderId: z.string().uuid(), toTableId: z.string().uuid() }),
  preconditions: async (ctx, input) => {
    const order = await ctx.tx.diningOrder.findUnique({ where: { id: input.orderId } });
    if (!order) throw new ValidationError("E_VALIDATION: order not found");
    await assertOutletInScope(ctx.tx, ctx.actor, ENTITY_ORDER, "Edit", order.locationId);
    if (!order.tableId) throw new ValidationError("E_VALIDATION: only a dine-in order has a table to move");
    if (!OPEN_FOR_CHANGE.includes(order.state)) throw new ValidationError("E_VALIDATION: a billed or closed order cannot change table");
    if (order.tableId === input.toTableId) throw new ValidationError("E_VALIDATION: the order is already at that table");
    const target = await ctx.tx.diningTable.findUnique({ where: { id: input.toTableId } });
    if (!target || target.locationId !== order.locationId) throw new ValidationError("E_VALIDATION: choose a table at the same outlet");
    if (target.state !== "available") throw new ValidationError("E_VALIDATION: that table is not free");
  },
  handler: async (ctx, input) => {
    const order = await ctx.tx.diningOrder.findUniqueOrThrow({ where: { id: input.orderId } });
    const [from, to] = await Promise.all([
      ctx.tx.diningTable.findUniqueOrThrow({ where: { id: order.tableId! } }),
      ctx.tx.diningTable.findUniqueOrThrow({ where: { id: input.toTableId } }),
    ]);
    const seat = await transition(ctx, { entityKey: ENTITY_TABLE, entityId: to.id, fromKey: to.state, toKey: "occupied" });
    await ctx.tx.diningTable.update({ where: { id: to.id }, data: { state: "occupied", version: { increment: 1 } } });
    const leave = from.state === "occupied"
      ? await transition(ctx, { entityKey: ENTITY_TABLE, entityId: from.id, fromKey: "occupied", toKey: "cleaning" })
      : null;
    if (leave) await ctx.tx.diningTable.update({ where: { id: from.id }, data: { state: "cleaning", version: { increment: 1 } } });
    await ctx.tx.diningOrder.update({ where: { id: order.id }, data: { tableId: to.id, version: { increment: 1 } } });
    await recordActivity(ctx, {
      entityKey: ENTITY_ORDER,
      entityId: order.id,
      commandKey: "verity.dinein.move_order_to_table",
      changes: diffFields({ table: from.label }, { table: to.label }),
    });
    return {
      result: { orderId: order.id, tableId: to.id },
      events: [seat.event, ...(leave ? [leave.event] : [])],
    };
  },
};

/**
 * Joins one open order into another at the same outlet (guests pulling tables
 * together). Every line moves with its kitchen state, the emptied order is
 * cancelled through its declared transition, and its table goes to cleaning.
 * Neither order may have a bill yet.
 */
export const mergeOrders: CommandDefinition<{ fromOrderId: string; intoOrderId: string }, { intoOrderId: string; movedLines: number }> = {
  key: "verity.dinein.merge_orders",
  entity: ENTITY_ORDER,
  verb: "Edit",
  input: z.object({ fromOrderId: z.string().uuid(), intoOrderId: z.string().uuid() }),
  preconditions: async (ctx, input) => {
    if (input.fromOrderId === input.intoOrderId) throw new ValidationError("E_VALIDATION: choose a different order to merge into");
    const [from, into] = await Promise.all([
      ctx.tx.diningOrder.findUnique({ where: { id: input.fromOrderId } }),
      ctx.tx.diningOrder.findUnique({ where: { id: input.intoOrderId } }),
    ]);
    if (!from || !into) throw new ValidationError("E_VALIDATION: order not found");
    await assertOutletInScope(ctx.tx, ctx.actor, ENTITY_ORDER, "Edit", from.locationId);
    if (from.locationId !== into.locationId) throw new ValidationError("E_VALIDATION: both orders must be at the same outlet");
    if (!OPEN_FOR_CHANGE.includes(from.state) || !OPEN_FOR_CHANGE.includes(into.state)) {
      throw new ValidationError("E_VALIDATION: only open, unbilled orders can be merged");
    }
    const bills = await ctx.tx.bill.count({ where: { orderId: { in: [from.id, into.id] } } });
    if (bills > 0) throw new ValidationError("E_VALIDATION: a bill already exists for one of these orders");
  },
  handler: async (ctx, input) => {
    const [from, into] = await Promise.all([
      ctx.tx.diningOrder.findUniqueOrThrow({ where: { id: input.fromOrderId } }),
      ctx.tx.diningOrder.findUniqueOrThrow({ where: { id: input.intoOrderId } }),
    ]);
    const moved = await ctx.tx.orderLine.updateMany({ where: { orderId: from.id }, data: { orderId: into.id } });
    const events = [];

    // Food already sent to the kitchen means the merged order is placed too.
    if (into.state === "draft" && from.state !== "draft") {
      const placed = await transition(ctx, { entityKey: ENTITY_ORDER, entityId: into.id, fromKey: "draft", toKey: "placed" });
      await ctx.tx.diningOrder.update({ where: { id: into.id }, data: { state: "placed", version: { increment: 1 } } });
      events.push(placed.event);
    }
    await ctx.tx.diningOrder.update({
      where: { id: into.id },
      data: { covers: into.covers + from.covers, version: { increment: 1 } },
    });

    const closed = await transition(ctx, { entityKey: ENTITY_ORDER, entityId: from.id, fromKey: from.state, toKey: "cancelled" });
    await ctx.tx.diningOrder.update({ where: { id: from.id }, data: { state: "cancelled", version: { increment: 1 } } });
    events.push(closed.event);

    if (from.tableId && from.tableId !== into.tableId) {
      const table = await ctx.tx.diningTable.findUniqueOrThrow({ where: { id: from.tableId } });
      if (table.state === "occupied") {
        const cleaned = await transition(ctx, { entityKey: ENTITY_TABLE, entityId: table.id, fromKey: "occupied", toKey: "cleaning" });
        await ctx.tx.diningTable.update({ where: { id: table.id }, data: { state: "cleaning", version: { increment: 1 } } });
        events.push(cleaned.event);
      }
    }
    await recordActivity(ctx, {
      entityKey: ENTITY_ORDER,
      entityId: into.id,
      commandKey: "verity.dinein.merge_orders",
      changes: diffFields({ mergedFrom: null }, { mergedFrom: from.id, lines: moved.count }),
    });
    return { result: { intoOrderId: into.id, movedLines: moved.count }, events };
  },
};

/** Where an open order could move or merge to, for the order screen. */
export const listTableChangeTargets: QueryDefinition<
  { orderId: string },
  { freeTables: Array<{ id: string; label: string }>; openOrders: Array<{ id: string; label: string }> }
> = {
  key: "verity.dinein.list_table_change_targets",
  entity: ENTITY_ORDER,
  input: z.object({ orderId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const order = await ctx.tx.diningOrder.findUnique({ where: { id: input.orderId } });
    if (!order) return { freeTables: [], openOrders: [] };
    await assertOutletInScope(ctx.tx, ctx.actor, ENTITY_ORDER, "Read", order.locationId);
    const [tables, orders] = await Promise.all([
      ctx.tx.diningTable.findMany({ where: { locationId: order.locationId, state: "available" }, orderBy: { label: "asc" } }),
      ctx.tx.diningOrder.findMany({
        where: { locationId: order.locationId, state: { in: OPEN_FOR_CHANGE }, id: { not: order.id }, bill: null },
        include: { table: { select: { label: true } } },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    return {
      freeTables: tables.map((t) => ({ id: t.id, label: t.label })),
      openOrders: orders.map((o) => ({ id: o.id, label: orderLabel(o) })),
    };
  },
};

/**
 * Closed orders, newest first (pos-restaurant.md: order history). Settled and
 * cancelled orders with what was billed and refunded, for one outlet or every
 * outlet the actor may read, within a date range.
 */
export const listOrderHistory: QueryDefinition<
  { locationId?: string; from?: string; to?: string },
  Array<{
    orderId: string;
    billId: string | null;
    label: string;
    state: string;
    channel: string;
    closedAt: Date;
    totalMinor: number;
    refundedMinor: number;
    lines: number;
  }>
> = {
  key: "verity.dinein.list_order_history",
  entity: ENTITY_BILL,
  input: z.object({
    locationId: z.string().uuid().optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
  }),
  handler: async (ctx, input) => {
    const locationIds = await scopedLocationIds(ctx.tx, ctx.actor, ENTITY_BILL, input.locationId);
    const range = {
      ...(input.from ? { gte: new Date(`${input.from}T00:00:00.000Z`) } : {}),
      ...(input.to ? { lte: new Date(`${input.to}T23:59:59.999Z`) } : {}),
    };
    const orders = await ctx.tx.diningOrder.findMany({
      where: {
        locationId: { in: locationIds },
        state: { in: ["settled", "cancelled"] },
        ...(input.from || input.to ? { updatedAt: range } : {}),
      },
      include: {
        table: { select: { label: true } },
        bill: { select: { id: true, totalMinor: true, settledAt: true, refunds: { select: { amountMinor: true } } } },
        _count: { select: { lines: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 300,
    });
    return orders.map((o) => ({
      orderId: o.id,
      billId: o.bill?.id ?? null,
      label: orderLabel(o),
      state: o.state,
      channel: o.channel,
      closedAt: o.bill?.settledAt ?? o.updatedAt,
      totalMinor: o.bill?.totalMinor ?? 0,
      refundedMinor: o.bill?.refunds.reduce((sum, r) => sum + r.amountMinor, 0) ?? 0,
      lines: o._count.lines,
    }));
  },
};

/* ================================ billing ================================= */

/**
 * GST for one bill.
 *
 * A real function with real rules: CGST and SGST are each half the total GST
 * rate for an intra-state supply, computed on the discounted taxable value and
 * rounded per component. The RATES are configuration because they change by
 * legislation; the arithmetic is code because it does not, and a configurable
 * tax expression would put a stored program in a tenant's hands.
 *
 * Rounding is per component and then to the rupee, which is what an Indian
 * restaurant bill does — computing on the un-rounded total and rounding once at
 * the end produces a bill whose lines do not add up to their own sum.
 */
export function computeBillTotals(input: {
  subtotalMinor: number;
  discountMinor: number;
  /** Basis points. 2.5% is 250. */
  cgstRateBp: number;
  sgstRateBp: number;
}): {
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  roundingMinor: number;
  totalMinor: number;
} {
  const taxableMinor = Math.max(0, input.subtotalMinor - input.discountMinor);
  const cgstMinor = Math.round((taxableMinor * input.cgstRateBp) / 10_000);
  const sgstMinor = Math.round((taxableMinor * input.sgstRateBp) / 10_000);

  const beforeRounding = taxableMinor + cgstMinor + sgstMinor;
  // To the nearest rupee, and the adjustment is stored rather than absorbed, so
  // the bill can show it.
  const totalMinor = Math.round(beforeRounding / 100) * 100;

  return {
    taxableMinor,
    cgstMinor,
    sgstMinor,
    roundingMinor: totalMinor - beforeRounding,
    totalMinor,
  };
}

export const generateBill: CommandDefinition<
  { orderId: string },
  { id: string; totalMinor: number }
> = {
  key: "verity.dinein.generate_bill",
  entity: ENTITY_BILL,
  verb: "Create",
  input: z.object({ orderId: z.string().uuid() }),
  preconditions: async (ctx, input) => {
    const order = await ctx.tx.diningOrder.findUnique({ where: { id: input.orderId } });
    if (!order) throw new ValidationError("E_VALIDATION: order not found");
    await assertOutletInScope(ctx.tx, ctx.actor, ENTITY_BILL, "Create", order.locationId);
    if (order.state !== "served") {
      throw new ValidationError("E_VALIDATION: the order is not served yet");
    }
    const existing = await ctx.tx.bill.findFirst({ where: { orderId: input.orderId } });
    if (existing) throw new ValidationError("E_VALIDATION: this order already has a bill");
  },
  handler: async (ctx, input) => {
    const lines = await ctx.tx.orderLine.findMany({
      where: { orderId: input.orderId, state: { not: "voided" } },
    });

    const subtotalMinor = lines.reduce(
      (sum, line) => sum + line.unitPriceMinor * line.qty,
      0,
    );

    const cgst = await resolveConfig<number>(ctx.tx, CONFIG_CGST_RATE);
    const sgst = await resolveConfig<number>(ctx.tx, CONFIG_SGST_RATE);
    if (cgst == null || sgst == null || !Number.isFinite(Number(cgst)) ||
        !Number.isFinite(Number(sgst)) || Number(cgst) < 0 || Number(sgst) < 0 ||
        Number(cgst) + Number(sgst) > 100) {
      throw new ValidationError("E_VALIDATION: configure valid GST rates before generating a bill; zero must be explicit");
    }
    const cgstRateBp = Math.round(Number(cgst) * 100);
    const sgstRateBp = Math.round(Number(sgst) * 100);

    const totals = computeBillTotals({
      subtotalMinor,
      discountMinor: 0,
      cgstRateBp,
      sgstRateBp,
    });

    const orderForBill = await ctx.tx.diningOrder.findUniqueOrThrow({ where: { id: input.orderId } });
    const bill = await ctx.tx.bill.create({
      data: {
        tenantId: ctx.actor.tenantId,
        orderId: input.orderId,
        locationId: orderForBill.locationId,
        subtotalMinor,
        discountMinor: 0,
        // The rate is stored beside the amount: a reprint a year from now must
        // show the rate that actually applied, not today's.
        cgstRateBp,
        cgstMinor: totals.cgstMinor,
        sgstRateBp,
        sgstMinor: totals.sgstMinor,
        taxableMinor: totals.taxableMinor,
        totalMinor: totals.totalMinor,
        roundingMinor: totals.roundingMinor,
        generatedByUserId: ctx.actor.userId,
      },
    });

    const order = await ctx.tx.diningOrder.findUniqueOrThrow({ where: { id: input.orderId } });
    const moved = await transition(ctx, {
      entityKey: ENTITY_ORDER,
      entityId: order.id,
      fromKey: order.state,
      toKey: "billed",
    });
    await ctx.tx.diningOrder.update({
      where: { id: order.id },
      data: { state: "billed", version: { increment: 1 } },
    });

    // A phone-bearing guest gets a Customer record the moment they're
    // billed (PRD §28) — same posture as recipe's consumption hook: one
    // authorized command, a natural side effect, no second permission gate.
    await upsertCustomerForOrder(ctx, order.id);

    return {
      result: { id: bill.id, totalMinor: bill.totalMinor },
      events: [{ name: "verity.dinein.bill_generated", entityId: bill.id }, moved.event],
    };
  },
};

export const applyBillDiscount: CommandDefinition<
  { billId: string; discountMinor: number; reason: string },
  { totalMinor: number }
> = {
  key: "verity.dinein.apply_bill_discount",
  entity: ENTITY_BILL,
  verb: "ActionExecute",
  input: z.object({
    billId: z.string().uuid(),
    discountMinor: z.number().int().min(0),
    // Required, not optional. A discount without a stated reason is the one
    // every audit asks about.
    reason: z.string().min(1).max(200),
  }),
  preconditions: async (ctx, input) => {
    const bill = await ctx.tx.bill.findUnique({ where: { id: input.billId } });
    if (!bill) throw new ValidationError("E_VALIDATION: bill not found");
    if (bill.state !== "open") throw new ValidationError("E_VALIDATION: that bill is closed");
    if (input.discountMinor > bill.subtotalMinor) {
      throw new ValidationError("E_VALIDATION: a discount cannot exceed the bill");
    }
  },
  handler: (ctx, input) => setBillDiscount(ctx, "verity.dinein.apply_bill_discount", input),
};

/**
 * Sets a bill's discount and re-prices it. Shared by `applyBillDiscount` and
 * `redeemPointsOnBill`, so both reprice the same way and leave the same trail.
 */
async function setBillDiscount(
  ctx: CommandContext,
  commandKey: string,
  input: { billId: string; discountMinor: number; reason: string },
) {
  const before = await ctx.tx.bill.findUniqueOrThrow({ where: { id: input.billId } });

  // Recomputed at the rate the bill was RAISED at, not the rate configured
  // now — a discount is not an occasion to reprice yesterday's tax.
  const totals = computeBillTotals({
    subtotalMinor: before.subtotalMinor,
    discountMinor: input.discountMinor,
    cgstRateBp: before.cgstRateBp,
    sgstRateBp: before.sgstRateBp,
  });

  const after = await ctx.tx.bill.update({
    where: { id: input.billId },
    data: {
      discountMinor: input.discountMinor,
      cgstMinor: totals.cgstMinor,
      sgstMinor: totals.sgstMinor,
      taxableMinor: totals.taxableMinor,
      totalMinor: totals.totalMinor,
      roundingMinor: totals.roundingMinor,
      version: { increment: 1 },
    },
  });

  await recordActivity(ctx, {
    entityKey: ENTITY_BILL,
    entityId: after.id,
    commandKey,
    changes: diffFields(
      { discountMinor: before.discountMinor, totalMinor: before.totalMinor },
      { discountMinor: after.discountMinor, totalMinor: after.totalMinor, reason: input.reason },
    ),
  });

  return {
    result: { totalMinor: after.totalMinor },
    events: [{ name: "verity.dinein.bill_discount_applied", entityId: after.id }],
  };
}

/**
 * One tap at the counter (Task 125 item 5.3): spend a guest's loyalty points as
 * a discount on their open bill. The ledger debit and the discount happen in one
 * transaction. Offers do not stack (DECISIONS.md), so a bill that already has a
 * coupon or discount is refused rather than overwritten, and the value can never
 * exceed the bill's subtotal.
 */
export const redeemPointsOnBill: CommandDefinition<
  { billId: string; points: number },
  { totalMinor: number; valueMinor: number }
> = {
  key: "verity.dinein.redeem_points_on_bill",
  entity: ENTITY_BILL,
  verb: "ActionExecute",
  input: z.object({ billId: z.string().uuid(), points: z.number().int().positive() }),
  preconditions: async (ctx, input) => {
    const bill = await ctx.tx.bill.findUnique({ where: { id: input.billId }, include: { order: { select: { customerPhone: true } } } });
    if (!bill) throw new ValidationError("E_VALIDATION: bill not found");
    await assertOutletInScope(ctx.tx, ctx.actor, ENTITY_BILL, "ActionExecute", bill.locationId);
    if (bill.state !== "open") throw new ValidationError("E_VALIDATION: that bill is closed");
    if (bill.discountMinor > 0) {
      throw new ValidationError("E_VALIDATION: this bill already has a discount; points and coupons do not stack");
    }
    if (!bill.order.customerPhone) throw new ValidationError("E_VALIDATION: this order has no guest phone, so there are no points to use");
  },
  handler: async (ctx, input) => {
    const bill = await ctx.tx.bill.findUniqueOrThrow({ where: { id: input.billId }, include: { order: { select: { customerPhone: true } } } });
    const customer = await findGuestByPhone(ctx.tx, ctx.actor.tenantId, bill.order.customerPhone!);
    if (!customer) throw new ValidationError("E_VALIDATION: this guest has no loyalty record yet");

    const valueMinor = await debitPointsForBill(ctx, {
      customerId: customer.id,
      points: input.points,
      billId: bill.id,
      capMinor: bill.subtotalMinor,
    });
    const applied = await setBillDiscount(ctx, "verity.dinein.redeem_points_on_bill", {
      billId: bill.id,
      discountMinor: valueMinor,
      reason: `${input.points} loyalty points`,
    });
    return { result: { totalMinor: applied.result.totalMinor, valueMinor }, events: applied.events };
  },
};

export const recordPayment: CommandDefinition<
  { billId: string; method: string; amountMinor: number; reference?: string },
  { paymentId: string; outstandingMinor: number }
> = {
  key: "verity.dinein.record_payment",
  entity: ENTITY_PAYMENT,
  verb: "Create",
  input: z.object({
    billId: z.string().uuid(),
    // PRD §46. `delivery_platform` is money the platform collected and will
    // settle later; only `cash` counts toward the drawer (finance cashSalesForDay).
    method: z.enum(BILL_PAYMENT_METHODS),
    amountMinor: z.number().int().min(1),
    reference: z.string().max(120).optional(),
  }),
  preconditions: async (ctx, input) => {
    const bill = await ctx.tx.bill.findUnique({ where: { id: input.billId } });
    if (!bill) throw new ValidationError("E_VALIDATION: bill not found");
    if (bill.state !== "open") throw new ValidationError("E_VALIDATION: that bill is closed");

    const paid = await ctx.tx.payment.aggregate({
      where: { billId: input.billId },
      _sum: { amountMinor: true },
    });
    const outstanding = bill.totalMinor - (paid._sum.amountMinor ?? 0);
    if (input.amountMinor > outstanding) {
      // No tips in v1, so an overpayment is a mistake rather than a gratuity.
      // Accepting it would leave money the system cannot account for.
      throw new ValidationError(
        `E_VALIDATION: that is more than the outstanding ${outstanding} paise`,
      );
    }
  },
  handler: async (ctx, input) => {
    const payment = await ctx.tx.payment.create({
      data: {
        tenantId: ctx.actor.tenantId,
        billId: input.billId,
        method: input.method,
        amountMinor: input.amountMinor,
        reference: input.reference ?? null,
        receivedByUserId: ctx.actor.userId,
      },
    });

    const bill = await ctx.tx.bill.findUniqueOrThrow({ where: { id: input.billId } });
    const paid = await ctx.tx.payment.aggregate({
      where: { billId: input.billId },
      _sum: { amountMinor: true },
    });

    return {
      result: {
        paymentId: payment.id,
        outstandingMinor: bill.totalMinor - (paid._sum.amountMinor ?? 0),
      },
      events: [{ name: "verity.dinein.payment_recorded", entityId: payment.id }],
    };
  },
};

/**
 * Closes the bill, the order and the table in one transaction.
 *
 * The chain is the point: a settled bill whose table stayed "occupied" is how a
 * restaurant ends up with a floor plan nobody trusts by nine o'clock. All three
 * moves are declared transitions, so any one of them being illegal rolls the
 * whole settlement back.
 */
export const settleBill: CommandDefinition<
  { billId: string },
  /** `tableState` is null when the order had no table (takeaway, delivery…). */
  { billId: string; tableState: string | null }
> = {
  key: "verity.dinein.settle_bill",
  entity: ENTITY_BILL,
  verb: "ActionExecute",
  input: z.object({ billId: z.string().uuid() }),
  preconditions: async (ctx, input) => {
    const bill = await ctx.tx.bill.findUnique({ where: { id: input.billId } });
    if (!bill) throw new ValidationError("E_VALIDATION: bill not found");
    if (bill.state !== "open") throw new ValidationError("E_VALIDATION: that bill is already closed");

    const paid = await ctx.tx.payment.aggregate({
      where: { billId: input.billId },
      _sum: { amountMinor: true },
    });
    const outstanding = bill.totalMinor - (paid._sum.amountMinor ?? 0);
    if (outstanding > 0) {
      throw new ValidationError(`E_VALIDATION: ${outstanding} paise still outstanding`);
    }
  },
  handler: async (ctx, input) => {
    const bill = await ctx.tx.bill.findUniqueOrThrow({ where: { id: input.billId } });

    const billMove = await transition(ctx, {
      entityKey: ENTITY_BILL,
      entityId: bill.id,
      fromKey: bill.state,
      toKey: "settled",
    });
    await ctx.tx.bill.update({
      where: { id: bill.id },
      data: { state: "settled", settledAt: new Date(), version: { increment: 1 } },
    });

    const order = await ctx.tx.diningOrder.findUniqueOrThrow({ where: { id: bill.orderId } });
    const orderMove = await transition(ctx, {
      entityKey: ENTITY_ORDER,
      entityId: order.id,
      fromKey: order.state,
      toKey: "settled",
    });
    await ctx.tx.diningOrder.update({
      where: { id: order.id },
      data: { state: "settled", version: { increment: 1 } },
    });

    // ORDER COMPLETED -> Inventory Consumption (PRD §128). A settled order is
    // this platform's completion point for a Work-shaped restaurant order —
    // see recipe/index.ts's module doc for why this is a plain function call
    // under settle_bill's own authorize(), not a second registered command.
    await postConsumptionForOrder(ctx, order.id);

    // Loyalty points earned on final (post-discount) spend — same posture.
    await awardPointsForOrder(ctx, order.id, bill.id);

    // A takeaway or delivery order has no table to turn over.
    let tableMove: Awaited<ReturnType<typeof transition>> | null = null;
    if (order.tableId) {
      const table = await ctx.tx.diningTable.findUniqueOrThrow({ where: { id: order.tableId } });
      tableMove = await transition(ctx, {
        entityKey: ENTITY_TABLE,
        entityId: table.id,
        fromKey: table.state,
        toKey: "cleaning",
      });
      await ctx.tx.diningTable.update({
        where: { id: table.id },
        data: { state: "cleaning", version: { increment: 1 } },
      });
    }

    await recordActivity(ctx, {
      entityKey: ENTITY_BILL,
      entityId: bill.id,
      commandKey: "verity.dinein.settle_bill",
      changes: diffFields({ state: bill.state }, { state: "settled" }),
    });

    return {
      result: { billId: bill.id, tableState: tableMove ? "cleaning" : null },
      events: tableMove ? [billMove.event, orderMove.event, tableMove.event] : [billMove.event, orderMove.event],
    };
  },
};

/* ================================ queries ================================= */

/**
 * The menu. With `orderId`, each item also says why it cannot be ordered on that
 * order right now (`hiddenReason`), judged by its availability rules at that
 * order's outlet, channel and local time of day. Without it, `hiddenReason` is null.
 */
export const listMenu: QueryDefinition<
  { includeInactive?: boolean; orderId?: string },
  Array<{
    categoryId: string;
    categoryName: string;
    items: Array<{
      id: string;
      name: string;
      priceMinor: number;
      active: boolean;
      variants: Array<{ id: string; name: string; priceDeltaMinor: number }>;
      /** Add-ons; retired ones appear only when `includeInactive` is set. */
      modifiers: Array<{ id: string; name: string; priceDeltaMinor: number; active: boolean }>;
      availability: AvailabilityRuleView[];
      hiddenReason: string | null;
    }>;
  }>
> = {
  key: "verity.dinein.list_menu",
  entity: ENTITY_MENU_ITEM,
  input: z.object({ includeInactive: z.boolean().optional(), orderId: z.string().uuid().optional() }),
  handler: async (ctx, input) => {
    const categories = await ctx.tx.menuCategory.findMany({
      where: input.includeInactive ? {} : { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        items: {
          where: input.includeInactive ? {} : { active: true },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          include: {
            variants: { orderBy: { name: "asc" } },
            modifiers: { where: input.includeInactive ? {} : { active: true }, orderBy: { name: "asc" } },
            availability: { include: { location: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
          },
        },
      },
    });

    const order = input.orderId ? await ctx.tx.diningOrder.findUnique({ where: { id: input.orderId } }) : null;
    const where = order ? await orderAvailabilityContext(ctx.tx, order) : null;
    const labels = await ruleLabels(ctx.tx, categories.flatMap((c) => c.items.flatMap((i) => i.availability.map(toRule))));

    return categories.map((category) => ({
      categoryId: category.id,
      categoryName: category.name,
      items: category.items.map((item) => ({
        id: item.id,
        name: item.name,
        priceMinor: item.priceMinor,
        active: item.active,
        variants: item.variants.map((variant) => ({
          id: variant.id,
          name: variant.name,
          priceDeltaMinor: variant.priceDeltaMinor,
        })),
        modifiers: item.modifiers.map((m) => ({ id: m.id, name: m.name, priceDeltaMinor: m.priceDeltaMinor, active: m.active })),
        availability: item.availability.map((r) => ({ id: r.id, locationName: r.location?.name ?? null, ...toRule(r) })),
        hiddenReason: where ? unavailableReason(item.availability.map(toRule), where, labels) : null,
      })),
    }));
  },
};

export type FloorTable = {
  id: string;
  label: string;
  seats: number;
  shape: string | null;
  state: string;
  posX: number;
  posY: number;
  zoneId: string;
  zoneName: string;
  orderId: string | null;
  orderState: string | null;
  covers: number | null;
  openLines: number;
};

/** The floor map feed: every table, where it sits, and what it is doing. */
export const listFloor: QueryDefinition<{ locationId?: string }, FloorTable[]> = {
  key: "verity.dinein.list_floor",
  entity: ENTITY_TABLE,
  input: z.object({ locationId: z.string().uuid().optional() }),
  handler: async (ctx, input) => {
    const locationIds = await scopedLocationIds(ctx.tx, ctx.actor, ENTITY_TABLE, input.locationId);
    const tables = await ctx.tx.diningTable.findMany({
      where: {
        state: { not: "retired" },
        locationId: { in: locationIds },
      },
      orderBy: [{ zone: { sortOrder: "asc" } }, { label: "asc" }],
      include: {
        zone: { select: { id: true, name: true } },
        orders: {
          where: { state: { notIn: ["settled", "cancelled"] } },
          include: { lines: { where: { state: { notIn: ["served", "voided"] } } } },
          take: 1,
        },
      },
    });

    return tables.map((table) => {
      const order = table.orders[0];
      return {
        id: table.id,
        label: table.label,
        seats: table.seats,
        shape: table.shape,
        state: table.state,
        posX: table.posX,
        posY: table.posY,
        zoneId: table.zone.id,
        zoneName: table.zone.name,
        orderId: order?.id ?? null,
        orderState: order?.state ?? null,
        covers: order?.covers ?? null,
        openLines: order?.lines.length ?? 0,
      };
    });
  },
};

export type OrderDetail = {
  id: string;
  state: string;
  covers: number;
  /** "Table 4", "Takeaway · Ravi", "Zomato #4821" — see `orderLabel`. */
  label: string;
  channel: string;
  /** Null for orders with no table. */
  tableId: string | null;
  subtotalMinor: number;
  lines: Array<{
    id: string;
    itemName: string;
    variantName: string | null;
    modifiers: LineModifier[];
    qty: number;
    unitPriceMinor: number;
    lineTotalMinor: number;
    state: string;
    lineNote: string | null;
  }>;
};

export const getOrderDetail: QueryDefinition<{ orderId: string }, OrderDetail | null> = {
  key: "verity.dinein.get_order_detail",
  entity: ENTITY_ORDER,
  input: z.object({ orderId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const order = await ctx.tx.diningOrder.findUnique({
      where: { id: input.orderId },
      include: { table: { select: { id: true, label: true } }, lines: { orderBy: { createdAt: "asc" }, include: { addOns: true } } },
    });
    if (!order) return null;
    await assertOutletInScope(ctx.tx, ctx.actor, ENTITY_ORDER, "Read", order.locationId);

    const lines = order.lines.map((line) => ({
      id: line.id,
      itemName: line.itemNameSnapshot,
      variantName: line.variantNameSnapshot,
      modifiers: readModifiers(line.addOns),
      qty: line.qty,
      unitPriceMinor: line.unitPriceMinor,
      lineTotalMinor: line.unitPriceMinor * line.qty,
      state: line.state,
      lineNote: line.lineNote,
    }));

    return {
      id: order.id,
      state: order.state,
      covers: order.covers,
      tableId: order.table?.id ?? null,
      label: orderLabel(order),
      channel: order.channel,
      // Voided lines are shown but not charged, which is what a waiter reading
      // the screen back to a guest needs.
      subtotalMinor: order.lines
        .filter((line) => line.state !== "voided")
        .reduce((sum, line) => sum + line.unitPriceMinor * line.qty, 0),
      lines,
    };
  },
};

export type KitchenTicket = {
  lineId: string;
  itemName: string;
  variantName: string | null;
  /** Add-ons asked for, by name: the kitchen needs the words, not the prices. */
  modifiers: string[];
  qty: number;
  lineNote: string | null;
  state: string;
  /** Table or channel, see `orderLabel`. */
  label: string;
  channel: string;
  orderId: string;
  placedAt: Date | null;
  remainingMinutes: number | null;
  urgency: string;
};

/**
 * The kitchen queue.
 *
 * A query, not a screen. `KentsRestaurant.md` §2.2 records that DEC-001 excludes
 * a Kitchen Display System from Verity CORE; whether a purpose-built kitchen
 * screen inside a client capability is permitted is D11, an open ADR. The data
 * contract is capability code and unambiguous, so it exists; the surface waits
 * for the owner.
 */
export const kitchenQueue: QueryDefinition<{ locationId?: string }, KitchenTicket[]> = {
  key: "verity.dinein.kitchen_queue",
  entity: ENTITY_ORDER_LINE,
  input: z.object({ locationId: z.string().uuid().optional() }),
  handler: async (ctx, input) => {
    const locationIds = await scopedLocationIds(ctx.tx, ctx.actor, ENTITY_ORDER_LINE, input.locationId);
    const lines = await ctx.tx.orderLine.findMany({
      where: {
        state: { in: ["queued", "preparing", "ready"] },
        order: { is: { locationId: { in: locationIds } } },
      },
      orderBy: { createdAt: "asc" },
      include: {
        order: { include: { table: { select: { label: true } } } },
        addOns: true,
      },
    });

    const targetMinutes = Number(
      (await resolveConfig<number>(ctx.tx, CONFIG_PREP_TARGET_MINUTES)) ?? 15,
    );

    // One clock lookup per line rather than per ticket: `remainingMinutes` takes
    // a clock id, and the clock is what the SLA substrate attached when the line
    // was placed.
    const clocks = await ctx.tx.slaClock.findMany({
      where: { entityKey: ENTITY_ORDER_LINE, entityId: { in: lines.map((line) => line.id) } },
      select: { id: true, entityId: true },
    });
    const clockByLine = new Map(clocks.map((clock) => [clock.entityId, clock.id]));

    const tickets: KitchenTicket[] = [];
    for (const line of lines) {
      const clockId = clockByLine.get(line.id);
      const remaining = clockId ? await remainingMinutes(ctx.tx, clockId) : null;
      tickets.push({
        lineId: line.id,
        itemName: line.itemNameSnapshot,
        variantName: line.variantNameSnapshot,
        modifiers: readModifiers(line.addOns).map((m) => m.name),
        qty: line.qty,
        lineNote: line.lineNote,
        state: line.state,
        label: orderLabel(line.order),
        channel: line.order.channel,
        orderId: line.orderId,
        placedAt: line.order.placedAt,
        remainingMinutes: remaining,
        // A computed axis, separate from any business priority.
        urgency: urgencyFor(remaining, targetMinutes),
      });
    }
    return tickets;
  },
};

export type BillDetail = {
  id: string;
  state: string;
  /** Table or channel, see `orderLabel`. */
  label: string;
  subtotalMinor: number;
  discountMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  cgstRate: number;
  sgstRate: number;
  roundingMinor: number;
  totalMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  lines: Array<{ itemName: string; variantName: string | null; modifiers: LineModifier[]; qty: number; lineTotalMinor: number }>;
  payments: Array<{ method: string; amountMinor: number; reference: string | null }>;
  refunds: Array<{ method: string; amountMinor: number; reason: string; at: Date }>;
  refundableMinor: number;
  /**
   * Points the guest could spend on this open bill right now, or null when there
   * is nothing to offer (settled, already discounted, no guest, no points, or the
   * viewer may not read the loyalty ledger).
   */
  redeemable: { balance: number; maxPoints: number; valueMinor: number } | null;
};

/**
 * Money methods a refund can go back by. No `delivery_platform`: the platform
 * refunds its own customer, and a row here would invent drawer movement.
 */
export const REFUND_METHODS = ["cash", "card", "upi", "wallet", "bank_transfer", "other"] as const;

/**
 * Returns money for a settled bill (PRD §36–37, pos-restaurant.md §6).
 *
 * The bill and its payments stay exactly as they were (INV-002); the refund is
 * a new append-only row beside them. The cap is what the bill actually took in
 * less what was already refunded, so it cannot be refunded twice over. It needs
 * the manager-grade verb (`ActionExecute` on payment) and a reason, decided
 * 2026-10-06: a manager permission, not an approval workflow.
 */
export const refundBill: CommandDefinition<
  { billId: string; amountMinor: number; method: (typeof REFUND_METHODS)[number]; reason: string },
  { refundId: string; refundableMinor: number }
> = {
  key: "verity.dinein.refund_bill",
  entity: ENTITY_PAYMENT,
  verb: "ActionExecute",
  input: z.object({
    billId: z.string().uuid(),
    amountMinor: z.number().int().min(1),
    method: z.enum(REFUND_METHODS),
    reason: z.string().trim().min(3).max(300),
  }),
  preconditions: async (ctx, input) => {
    const bill = await ctx.tx.bill.findUnique({ where: { id: input.billId } });
    if (!bill) throw new ValidationError("E_VALIDATION: bill not found");
    await assertOutletInScope(ctx.tx, ctx.actor, ENTITY_PAYMENT, "ActionExecute", bill.locationId);
    if (bill.state !== "settled") {
      throw new ValidationError("E_VALIDATION: only a settled bill can be refunded; an open bill can still be edited or cancelled");
    }
    const refundable = await refundableMinor(ctx.tx, input.billId);
    if (input.amountMinor > refundable) {
      throw new ValidationError(
        `E_VALIDATION: that is more than the ${refundable} paise still refundable on this bill`,
      );
    }
  },
  handler: async (ctx, input) => {
    const refund = await ctx.tx.billRefund.create({
      data: {
        tenantId: ctx.actor.tenantId,
        billId: input.billId,
        amountMinor: input.amountMinor,
        method: input.method,
        reason: input.reason,
        refundedByUserId: ctx.actor.userId,
      },
    });
    // Points earned on this bill come back in proportion to what was refunded.
    // Coupons are not reversed: the refund is already net of the discount.
    await reversePointsForRefund(ctx, input.billId);
    return {
      result: { refundId: refund.id, refundableMinor: await refundableMinor(ctx.tx, input.billId) },
      events: [
        {
          name: "verity.dinein.bill_refunded",
          entityId: input.billId,
          payload: { amountMinor: input.amountMinor, method: input.method },
        },
      ],
    };
  },
};

/** What a bill took in, less what has already gone back. */
async function refundableMinor(tx: import("@/server/platform/tenancy").TenantScopedClient, billId: string): Promise<number> {
  const [paid, refunded] = await Promise.all([
    tx.payment.aggregate({ where: { billId }, _sum: { amountMinor: true } }),
    tx.billRefund.aggregate({ where: { billId }, _sum: { amountMinor: true } }),
  ]);
  return (paid._sum.amountMinor ?? 0) - (refunded._sum.amountMinor ?? 0);
}

export const getBillDetail: QueryDefinition<{ billId: string }, BillDetail | null> = {
  key: "verity.dinein.get_bill_detail",
  entity: ENTITY_BILL,
  input: z.object({ billId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const bill = await ctx.tx.bill.findUnique({
      where: { id: input.billId },
      include: {
        payments: { orderBy: { createdAt: "asc" } },
        refunds: { orderBy: { createdAt: "asc" } },
        order: {
          include: {
            table: { select: { label: true } },
            lines: { where: { state: { not: "voided" } }, orderBy: { createdAt: "asc" }, include: { addOns: true } },
          },
        },
      },
    });
    if (!bill) return null;
    await assertOutletInScope(ctx.tx, ctx.actor, ENTITY_BILL, "Read", bill.locationId);

    const paidMinor = bill.payments.reduce((sum, payment) => sum + payment.amountMinor, 0);

    // Offered only where a redemption would succeed: an open, undiscounted bill
    // for a guest with points, and only to a role that may read the loyalty
    // ledger (a bill's reader is not automatically a ledger reader).
    let redeemable: BillDetail["redeemable"] = null;
    if (bill.state === "open" && bill.discountMinor === 0 && bill.order.customerPhone) {
      const customer = await findGuestByPhone(ctx.tx, ctx.actor.tenantId, bill.order.customerPhone);
      if (customer && (await hasPermission(ctx.tx, ctx.actor.roleId, "Read", ENTITY_LOYALTY_ENTRY))) {
        const found = await redeemablePoints(ctx.tx, customer.id, bill.subtotalMinor);
        if (found.maxPoints > 0) redeemable = { balance: found.balance, maxPoints: found.maxPoints, valueMinor: found.valueMinor };
      }
    }

    return {
      id: bill.id,
      state: bill.state,
      label: orderLabel(bill.order),
      subtotalMinor: bill.subtotalMinor,
      discountMinor: bill.discountMinor,
      cgstMinor: bill.cgstMinor,
      sgstMinor: bill.sgstMinor,
      // Back to a percentage for display; basis points are a storage decision,
      // not something to print on a guest's bill.
      cgstRate: bill.cgstRateBp / 100,
      sgstRate: bill.sgstRateBp / 100,
      roundingMinor: bill.roundingMinor,
      totalMinor: bill.totalMinor,
      paidMinor,
      outstandingMinor: bill.totalMinor - paidMinor,
      lines: bill.order.lines.map((line) => ({
        itemName: line.itemNameSnapshot,
        variantName: line.variantNameSnapshot,
        modifiers: readModifiers(line.addOns),
        qty: line.qty,
        lineTotalMinor: line.unitPriceMinor * line.qty,
      })),
      payments: bill.payments.map((payment) => ({
        method: payment.method,
        amountMinor: payment.amountMinor,
        reference: payment.reference,
      })),
      refunds: bill.refunds.map((r) => ({ method: r.method, amountMinor: r.amountMinor, reason: r.reason, at: r.createdAt })),
      refundableMinor: paidMinor - bill.refunds.reduce((sum, r) => sum + r.amountMinor, 0),
      redeemable,
    };
  },
};

export const listOpenBills: QueryDefinition<
  { locationId?: string },
  Array<{ id: string; label: string; totalMinor: number; paidMinor: number }>
> = {
  key: "verity.dinein.list_open_bills",
  entity: ENTITY_BILL,
  input: z.object({ locationId: z.string().uuid().optional() }),
  handler: async (ctx, input) => {
    const locationIds = await scopedLocationIds(ctx.tx, ctx.actor, ENTITY_BILL, input.locationId);
    const bills = await ctx.tx.bill.findMany({
      where: { state: "open", locationId: { in: locationIds } },
      orderBy: { createdAt: "asc" },
      include: {
        payments: { select: { amountMinor: true } },
        order: { include: { table: { select: { label: true } } } },
      },
    });

    return bills.map((bill) => ({
      id: bill.id,
      label: orderLabel(bill.order),
      totalMinor: bill.totalMinor,
      paidMinor: bill.payments.reduce((sum, payment) => sum + payment.amountMinor, 0),
    }));
  },
};

export type SalesSummary = {
  billsSettled: number;
  grossMinor: number;
  discountMinor: number;
  taxMinor: number;
  byMethod: Array<{ method: string; amountMinor: number }>;
  topItems: Array<{ itemName: string; qty: number; revenueMinor: number }>;
};

/**
 * The day's takings.
 *
 * Settled bills only. Counting an open bill as revenue would report money the
 * restaurant has not been paid, and every figure here traces to a stored fact.
 */
/**
 * One service day, in the restaurant's own clock.
 *
 * A restaurant in Delhi is still serving at 19:00 UTC, so a day boundary taken
 * from the server would cut one evening's service across two reports and make
 * the summary disagree with the till. The zone comes from the organization,
 * resolved by the platform rather than guessed here.
 *
 * A service day starts at `startMinute` after local midnight (default 05:00) and
 * runs for 24 hours: a bill settled at 00:40 belongs to the night that earned it,
 * which is what anyone reading a day summary means. Consecutive days neither
 * overlap nor leave a gap (Task 126 G-02); "today" at 02:00 is yesterday's
 * service day, because that service is still running.
 */
export const DEFAULT_DAY_START_MINUTE = 300;

export async function serviceDayRange(
  tx: TenantScopedClient,
  organizationId: string,
  day?: string,
  startMinute: number = DEFAULT_DAY_START_MINUTE,
): Promise<{ from: Date; to: Date; day: string; timeZone: string }> {
  const timeZone = await effectiveTimeZone(tx, organizationId);

  let chosen: string;
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    chosen = day;
  } else {
    // The service day that contains "now": the local date of (now - day start).
    const [current] = await tx.$queryRaw<Array<{ day: string }>>`
      SELECT to_char(((now() AT TIME ZONE ${timeZone}) - make_interval(mins => ${startMinute}::int))::date, 'YYYY-MM-DD') AS day`;
    chosen = current!.day;
  }

  const [rows] = await tx.$queryRaw<Array<{ from: Date; to: Date }>>`
    SELECT ((${chosen}::date::timestamp + make_interval(mins => ${startMinute}::int)) AT TIME ZONE ${timeZone}) AS "from",
           (((${chosen}::date + 1)::timestamp + make_interval(mins => ${startMinute}::int)) AT TIME ZONE ${timeZone}) AS "to"`;

  return { from: rows.from, to: rows.to, day: chosen, timeZone };
}

export const salesSummary: QueryDefinition<
  { day?: string; locationId?: string },
  SalesSummary & { day: string }
> = {
  key: "verity.dinein.sales_summary",
  entity: ENTITY_BILL,
  input: z.object({ day: z.string().optional(), locationId: z.string().uuid().optional() }),
  handler: async (ctx, input) => {
    const range = await serviceDayRange(ctx.tx, ctx.actor.organizationId, input.day);
    const from = range.from;
    const to = range.to;
    const locationIds = await scopedLocationIds(ctx.tx, ctx.actor, ENTITY_BILL, input.locationId);

    const bills = await ctx.tx.bill.findMany({
      where: {
        state: "settled",
        settledAt: { gte: from, lt: to },
        locationId: { in: locationIds },
      },
      include: {
        payments: true,
        order: { include: { lines: { where: { state: { not: "voided" } } } } },
      },
    });

    const byMethod = new Map<string, number>();
    const items = new Map<string, { qty: number; revenueMinor: number }>();
    let grossMinor = 0;
    let discountMinor = 0;
    let taxMinor = 0;

    for (const bill of bills) {
      grossMinor += bill.totalMinor;
      discountMinor += bill.discountMinor;
      taxMinor += bill.cgstMinor + bill.sgstMinor;

      for (const payment of bill.payments) {
        byMethod.set(payment.method, (byMethod.get(payment.method) ?? 0) + payment.amountMinor);
      }
      for (const line of bill.order.lines) {
        const current = items.get(line.itemNameSnapshot) ?? { qty: 0, revenueMinor: 0 };
        items.set(line.itemNameSnapshot, {
          qty: current.qty + line.qty,
          revenueMinor: current.revenueMinor + line.unitPriceMinor * line.qty,
        });
      }
    }

    return {
      day: range.day,
      billsSettled: bills.length,
      grossMinor,
      discountMinor,
      taxMinor,
      byMethod: [...byMethod.entries()].map(([method, amountMinor]) => ({ method, amountMinor })),
      topItems: [...items.entries()]
        .map(([itemName, totals]) => ({ itemName, ...totals }))
        .sort((a, b) => b.revenueMinor - a.revenueMinor)
        .slice(0, 10),
    };
  },
};

/* ============================== registration ============================== */

export function registerDineinCapability(): void {
  // Exportable datasets (ADR-037). Cost price is left out: it is field-restricted
  // so it never reaches a shared floor tablet, and an export is no exception.
  registerExportable({
    key: "menu_items",
    label: "Menu",
    entity: ENTITY_MENU_ITEM,
    columns: ["id", "category", "name", "price_minor", "active", "created_at"],
    read: async (tx) =>
      (await tx.menuItem.findMany({ include: { category: { select: { name: true } } }, orderBy: { createdAt: "asc" } })).map((i) => [
        i.id, i.category.name, i.name, i.priceMinor, i.active, i.createdAt,
      ]),
  });
  registerExportable({
    key: "orders",
    label: "Orders",
    entity: ENTITY_ORDER,
    columns: ["id", "channel", "state", "location_id", "covers", "customer_name", "customer_phone", "placed_at", "served_at", "created_at"],
    read: async (tx) =>
      (await tx.diningOrder.findMany({ orderBy: { createdAt: "asc" } })).map((o) => [
        o.id, o.channel, o.state, o.locationId, o.covers, o.customerName, o.customerPhone, o.placedAt, o.servedAt, o.createdAt,
      ]),
  });
  registerExportable({
    key: "order_lines",
    label: "Order lines",
    entity: ENTITY_ORDER,
    columns: ["id", "order_id", "item", "portion", "unit_price_minor", "qty", "state", "note", "created_at"],
    read: async (tx) =>
      (await tx.orderLine.findMany({ orderBy: { createdAt: "asc" } })).map((l) => [
        l.id, l.orderId, l.itemNameSnapshot, l.variantNameSnapshot, l.unitPriceMinor, l.qty, l.state, l.lineNote, l.createdAt,
      ]),
  });
  registerExportable({
    key: "bills",
    label: "Bills",
    entity: ENTITY_BILL,
    columns: ["id", "order_id", "location_id", "state", "subtotal_minor", "discount_minor", "cgst_minor", "sgst_minor", "rounding_minor", "total_minor", "settled_at", "created_at"],
    read: async (tx) =>
      (await tx.bill.findMany({ orderBy: { createdAt: "asc" } })).map((b) => [
        b.id, b.orderId, b.locationId, b.state, b.subtotalMinor, b.discountMinor, b.cgstMinor, b.sgstMinor, b.roundingMinor, b.totalMinor, b.settledAt, b.createdAt,
      ]),
  });
  /**
   * A dish already on the pass has been cooked. Voiding it from the kitchen
   * would erase a cost the restaurant has borne, so only a manager may — and
   * "manager only" is not expressible as a transition edge, which is exactly
   * what guards are for.
   *
   * The guard reads the actor's grant rather than a role name: role names are a
   * client's to choose, permissions are the model.
   */
  registerTransitionGuard(ENTITY_ORDER_LINE, "ready", "voided", async (ctx) => {
    const allowed = await ctx.tx.permission.findFirst({
      where: {
        roleId: ctx.actor.roleId ?? "00000000-0000-0000-0000-000000000000",
        verb: "ActionExecute",
        entity: ENTITY_BILL,
      },
    });
    if (!allowed) {
      throw new ValidationError(
        "E_VALIDATION: a dish that has been cooked can only be voided by a manager",
      );
    }
  });

  registerContribution({
    capabilityId: DINEIN_CAPABILITY,
    navigation: [
      {
        href: "/floor",
        label: "Floor",
        group: "Capabilities",
        order: 20,
        icon: "locations",
        requiresEntity: ENTITY_TABLE,
        shells: ["platform", "operations"],
      },
      {
        // Permitted by ADR-014: capability-private, no platform vocabulary, no
        // recipe logic, timing from the SLA substrate. DEC-001 still excludes a
        // kitchen module from core.
        href: "/kitchen",
        label: "Kitchen",
        group: "Capabilities",
        order: 19,
        icon: "workspace",
        requiresEntity: ENTITY_ORDER_LINE,
        shells: ["platform", "operations"],
      },
      {
        href: "/counter",
        label: "Counter",
        group: "Capabilities",
        order: 21,
        icon: "approvals",
        requiresEntity: ENTITY_BILL,
        shells: ["platform", "operations"],
      },
      {
        href: "/menu",
        label: "Menu",
        group: "Administration",
        order: 22,
        icon: "evidence",
        requiresEntity: ENTITY_MENU_ITEM,
        shells: ["platform"],
      },
      {
        href: "/reports",
        label: "Day summary",
        group: "Capabilities",
        order: 23,
        icon: "audit",
        requiresEntity: ENTITY_BILL,
        shells: ["platform"],
      },
      {
        href: "/floor/setup",
        label: "Floor plan",
        group: "Administration",
        order: 24,
        icon: "locations",
        // Gated on CREATE rather than READ: everyone who works a shift can see
        // the floor, and only whoever shapes the room should reach the editor.
        requiresEntity: ENTITY_TABLE,
        requiresVerb: "Create",
        shells: ["platform"],
      },
    ],
    schedules: [
      {
        key: "verity.dinein.sweep_prep_breaches",
        label: "Sweep kitchen prep breaches",
        // "Frequent" rather than a cron string: the capability knows a late
        // dish is worth knowing about soon, and does not know whether this
        // deployment runs cron, a worker or something not yet chosen.
        cadence: "frequent",
        run: async ({ tx, now }) => {
          // Idempotent by construction — sweepBreaches only marks clocks past
          // their deadline that are not already breached, so a scheduler that
          // retries (and every real one does) changes nothing the second time.
          const breached = await sweepBreaches(tx, now);
          return {
            events: breached.map((event) => ({
              name: event.name,
              entityId: event.entityId ?? undefined,
            })),
          };
        },
      },
    ],
    workspace: [
      {
        key: "verity.dinein.open_bills",
        label: "Bills awaiting payment",
        href: "/counter",
        count: async ({ tx }) => tx.bill.count({ where: { state: "open" } }),
        shells: ["platform", "operations"],
      },
      {
        key: "verity.dinein.tables_to_clean",
        label: "Tables to clean",
        href: "/floor",
        count: async ({ tx }) => tx.diningTable.count({ where: { state: "cleaning" } }),
        shells: ["platform", "operations"],
      },
    ],
  });

  registerCommand(createMenuCategory);
  registerCommand(createMenuItem);
  registerCommand(editMenuItem);
  registerCommand(setMenuItemActive);
  registerCommand(createMenuVariant);
  registerCommand(createMenuModifier);
  registerCommand(setMenuModifierActive);
  registerCommand(setMenuItemAvailability);
  registerQuery(listMenuItemPriceHistory);
  registerCommand(defineZone);
  registerCommand(defineTable);
  registerCommand(positionTable);
  registerCommand(moveTable);
  registerCommand(createOrder);
  registerCommand(addOrderLines);
  registerCommand(placeOrder);
  registerCommand(advanceOrderLine);
  registerCommand(voidOrderLine);
  registerCommand(setOrderLineQty);
  registerCommand(cancelOrder);
  registerCommand(generateBill);
  registerCommand(applyBillDiscount);
  registerCommand(redeemPointsOnBill);
  registerCommand(recordPayment);
  registerCommand(settleBill);
  registerCommand(refundBill);
  registerCommand(moveOrderToTable);
  registerCommand(mergeOrders);
  registerQuery(listTableChangeTargets);
  registerQuery(listOrderHistory);

  registerQuery(listMenu);
  registerQuery(listFloor);
  registerQuery(getOrderDetail);
  registerQuery(kitchenQueue);
  registerQuery(getBillDetail);
  registerQuery(listOpenBills);
  registerQuery(salesSummary);
}
