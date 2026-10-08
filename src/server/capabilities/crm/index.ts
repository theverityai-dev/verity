import { z } from "zod";
import { registerContribution } from "@/server/platform/contribution";
import { registerCommand, ValidationError, type ActorContext, type CommandContext, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { diffFields, recordActivity } from "@/server/platform/audit";
import type { TenantScopedClient } from "@/server/platform/tenancy";

/** The subset shared by CommandContext and QueryContext — all this module needs. */
type ReadContext = { tx: TenantScopedClient; actor: ActorContext };

/**
 * CAPABILITY: CRM — `verity.capability.crm` (Colonel Kebabz Phase 2, lean V1)
 *
 * Authority: `clients/colonel-kebabz/prd.md` §28-30 (Customer CRM, Customer
 * 360, Segmentation), scoped down per the 2026-09-10 product-owner
 * correction to build the minimum needed, not the PRD's full depth — see
 * `docs/superpowers/specs/2026-09-10-colonel-kebabz-customer-360-design.md`.
 *
 * `Customer` is a new, tenant-scoped, capability-private identity — NOT the
 * platform's Party (a walk-in diner mints no login, per ADR-001/ADR-007).
 * Matched by phone number, shared across outlets.
 *
 * SCOPE BUILT: auto-upsert on `dinein.generateBill` (see
 * `upsertCustomerForOrder`, called from dinein the same way
 * `recipe.postConsumptionForOrder` is), a Customer/360 query with derived
 * spend/visit numbers computed live from settled Bills, and a
 * segment-filterable list query. NOT BUILT (separate later slices): loyalty
 * points, coupons, marketing campaigns, review aggregation, complaint
 * management, service recovery.
 */

export const CRM_CAPABILITY = "verity.capability.crm";
export const ENTITY_CUSTOMER = "verity.crm.customer";

/**
 * Upserts a Customer by phone whenever a bill is generated for an order that
 * carries a phone number. Plain function, not a registered command — same
 * posture as `recipe.postConsumptionForOrder`: one authorized command
 * (`generateBill`) has a natural side effect, not a second permission
 * surface. A no-op when the order has no phone.
 */
export async function upsertCustomerForOrder(ctx: CommandContext, orderId: string): Promise<void> {
  const order = await ctx.tx.diningOrder.findUniqueOrThrow({ where: { id: orderId } });
  if (!order.customerPhone) return;

  await ctx.tx.customer.upsert({
    where: { tenantId_phone: { tenantId: ctx.actor.tenantId, phone: order.customerPhone } },
    create: {
      tenantId: ctx.actor.tenantId,
      phone: order.customerPhone,
      name: order.customerName ?? null,
      preferredLocationId: order.locationId,
    },
    // Refresh the name if the guest gave one this visit; never overwrite
    // preferredLocationId once set (their FIRST outlet, not their latest).
    update: order.customerName ? { name: order.customerName } : {},
  });
}

type CustomerAggregates = {
  orderCount: number;
  totalSpendMinor: number;
  avgOrderValueMinor: number;
  lastOrderAt: Date | null;
};

async function computeAggregates(
  ctx: ReadContext,
  phone: string,
): Promise<CustomerAggregates> {
  const bills = await ctx.tx.bill.findMany({
    where: { state: "settled", order: { customerPhone: phone } },
    select: { totalMinor: true, settledAt: true },
    orderBy: { settledAt: "desc" },
  });
  const orderCount = bills.length;
  const totalSpendMinor = bills.reduce((sum, b) => sum + b.totalMinor, 0);
  return {
    orderCount,
    totalSpendMinor,
    avgOrderValueMinor: orderCount === 0 ? 0 : Math.round(totalSpendMinor / orderCount),
    lastOrderAt: bills[0]?.settledAt ?? null,
  };
}

export const getCustomer360: QueryDefinition<
  { customerId?: string; phone?: string },
  ({
    id: string;
    phone: string;
    name: string | null;
    email: string | null;
    birthday: Date | null;
    marketingConsent: boolean;
    preferredLocationId: string | null;
  } & CustomerAggregates) | null
> = {
  key: "verity.crm.get_customer_360",
  entity: ENTITY_CUSTOMER,
  input: z
    .object({ customerId: z.string().uuid().optional(), phone: z.string().optional() })
    .refine((v) => v.customerId || v.phone, "provide customerId or phone"),
  handler: async (ctx, input) => {
    const customer = input.customerId
      ? await ctx.tx.customer.findUnique({ where: { id: input.customerId } })
      : await ctx.tx.customer.findUnique({
          where: { tenantId_phone: { tenantId: ctx.actor.tenantId, phone: input.phone! } },
        });
    if (!customer) return null;

    const aggregates = await computeAggregates(ctx, customer.phone);
    return {
      id: customer.id,
      phone: customer.phone,
      name: customer.name,
      email: customer.email,
      birthday: customer.birthday,
      marketingConsent: customer.marketingConsent,
      preferredLocationId: customer.preferredLocationId,
      ...aggregates,
    };
  },
};

export const listCustomers: QueryDefinition<
  {
    minSpendMinor?: number;
    minVisits?: number;
    daysSinceLastOrder?: number;
    locationId?: string;
  },
  Array<{ id: string; phone: string; name: string | null } & CustomerAggregates>
> = {
  key: "verity.crm.list_customers",
  entity: ENTITY_CUSTOMER,
  input: z.object({
    minSpendMinor: z.number().int().min(0).optional(),
    minVisits: z.number().int().min(0).optional(),
    daysSinceLastOrder: z.number().int().min(0).optional(),
    locationId: z.string().uuid().optional(),
  }),
  handler: async (ctx, input) => {
    const customers = await ctx.tx.customer.findMany({
      where: input.locationId ? { preferredLocationId: input.locationId } : {},
      orderBy: { createdAt: "desc" },
    });

    const rows = await Promise.all(
      customers.map(async (c) => ({
        id: c.id,
        phone: c.phone,
        name: c.name,
        ...(await computeAggregates(ctx, c.phone)),
      })),
    );

    const now = Date.now();
    return rows.filter((r) => {
      if (input.minSpendMinor !== undefined && r.totalSpendMinor < input.minSpendMinor) return false;
      if (input.minVisits !== undefined && r.orderCount < input.minVisits) return false;
      if (input.daysSinceLastOrder !== undefined) {
        if (!r.lastOrderAt) return false;
        const days = (now - r.lastOrderAt.getTime()) / (1000 * 60 * 60 * 24);
        if (days < input.daysSinceLastOrder) return false;
      }
      return true;
    });
  },
};

/**
 * Edits what staff know about a guest (Task 125 item 5.1). The phone number is
 * the identity key and is NOT editable here: changing it would re-point every
 * past order's history (ADR-007: identity follows verified contact, not a typed
 * correction). A field left out is unchanged; `null` clears it.
 */
export const updateCustomer: CommandDefinition<
  {
    customerId: string;
    name?: string | null;
    email?: string | null;
    birthday?: string | null;
    marketingConsent?: boolean;
  },
  { id: string }
> = {
  key: "verity.crm.update_customer",
  entity: ENTITY_CUSTOMER,
  verb: "Edit",
  input: z.object({
    customerId: z.string().uuid(),
    name: z.string().trim().min(1).max(120).nullable().optional(),
    email: z.string().trim().email().max(200).nullable().optional(),
    birthday: z.string().date().nullable().optional(),
    marketingConsent: z.boolean().optional(),
  }),
  preconditions: async (ctx, input) => {
    if (!(await ctx.tx.customer.findUnique({ where: { id: input.customerId } }))) {
      throw new ValidationError("E_VALIDATION: guest not found");
    }
  },
  handler: async (ctx, input) => {
    const before = await ctx.tx.customer.findUniqueOrThrow({ where: { id: input.customerId } });
    const after = await ctx.tx.customer.update({
      where: { id: input.customerId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.birthday !== undefined ? { birthday: input.birthday ? new Date(input.birthday) : null } : {}),
        ...(input.marketingConsent !== undefined ? { marketingConsent: input.marketingConsent } : {}),
        version: { increment: 1 },
      },
    });
    await recordActivity(ctx, {
      entityKey: ENTITY_CUSTOMER,
      entityId: after.id,
      commandKey: "verity.crm.update_customer",
      changes: diffFields(
        { name: before.name, email: before.email, birthday: before.birthday?.toISOString().slice(0, 10) ?? null, marketingConsent: before.marketingConsent },
        { name: after.name, email: after.email, birthday: after.birthday?.toISOString().slice(0, 10) ?? null, marketingConsent: after.marketingConsent },
      ),
    });
    return { result: { id: after.id }, events: [{ name: "verity.crm.customer_updated", entityId: after.id }] };
  },
};

/**
 * Saved segments (Task 125 item 5.2): a named filter, not a list of people, so
 * membership is always the live result of `listCustomers` with these filters.
 * Reuses the guest entity's permissions: whoever may Create guest records may
 * save a segment, whoever may Edit them may remove one, and whoever may Read
 * guests may list them.
 */
export type SegmentRow = {
  id: string;
  name: string;
  minVisits: number | null;
  minSpendMinor: number | null;
  daysSinceLastOrder: number | null;
};

export const saveSegment: CommandDefinition<
  { name: string; minVisits?: number; minSpendMinor?: number; daysSinceLastOrder?: number },
  { id: string }
> = {
  key: "verity.crm.save_segment",
  entity: ENTITY_CUSTOMER,
  verb: "Create",
  input: z
    .object({
      name: z.string().trim().min(1).max(80),
      minVisits: z.number().int().min(0).optional(),
      minSpendMinor: z.number().int().min(0).optional(),
      daysSinceLastOrder: z.number().int().min(0).optional(),
    })
    .refine(
      (v) => v.minVisits !== undefined || v.minSpendMinor !== undefined || v.daysSinceLastOrder !== undefined,
      "a segment needs at least one filter",
    ),
  preconditions: async (ctx, input) => {
    if (await ctx.tx.customerSegment.findUnique({ where: { tenantId_name: { tenantId: ctx.actor.tenantId, name: input.name } } })) {
      throw new ValidationError(`E_VALIDATION: a segment called "${input.name}" already exists`);
    }
  },
  handler: async (ctx, input) => {
    const segment = await ctx.tx.customerSegment.create({
      data: {
        tenantId: ctx.actor.tenantId,
        name: input.name,
        minVisits: input.minVisits ?? null,
        minSpendMinor: input.minSpendMinor ?? null,
        daysSinceLastOrder: input.daysSinceLastOrder ?? null,
        createdByUserId: ctx.actor.userId,
      },
    });
    return { result: { id: segment.id }, events: [{ name: "verity.crm.segment_saved", entityId: segment.id }] };
  },
};

export const deleteSegment: CommandDefinition<{ segmentId: string }, { id: string }> = {
  key: "verity.crm.delete_segment",
  entity: ENTITY_CUSTOMER,
  // Edit, not Delete: removing a saved filter touches no guest record, and
  // Delete is the verb for removing records themselves.
  verb: "Edit",
  input: z.object({ segmentId: z.string().uuid() }),
  preconditions: async (ctx, input) => {
    if (!(await ctx.tx.customerSegment.findUnique({ where: { id: input.segmentId } }))) {
      throw new ValidationError("E_VALIDATION: segment not found");
    }
  },
  handler: async (ctx, input) => {
    // Deleting a segment removes only the saved filter; no guest is touched.
    await ctx.tx.customerSegment.delete({ where: { id: input.segmentId } });
    return { result: { id: input.segmentId }, events: [{ name: "verity.crm.segment_deleted", entityId: input.segmentId }] };
  },
};

export const listSegments: QueryDefinition<Record<string, never>, SegmentRow[]> = {
  key: "verity.crm.list_segments",
  entity: ENTITY_CUSTOMER,
  input: z.object({}),
  handler: async (ctx) => {
    const rows = await ctx.tx.customerSegment.findMany({ orderBy: { name: "asc" } });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      minVisits: r.minVisits,
      minSpendMinor: r.minSpendMinor,
      daysSinceLastOrder: r.daysSinceLastOrder,
    }));
  },
};

/* ============================== registration ============================== */

export function registerCrmCapability(): void {
  registerContribution({
    capabilityId: CRM_CAPABILITY,
    navigation: [
      {
        href: "/guests",
        label: "Guests",
        group: "Overview",
        order: 15,
        icon: "user",
        requiresEntity: ENTITY_CUSTOMER,
        shells: ["platform", "operations"],
      },
    ],
  });
  registerCommand(updateCustomer);
  registerCommand(saveSegment);
  registerCommand(deleteSegment);
  registerQuery(listSegments);
  registerQuery(getCustomer360);
  registerQuery(listCustomers);
}
