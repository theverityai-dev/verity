import { GSTIN } from "./keys";
import { z } from "zod";
import {
  registerCommand,
  ValidationError,
  type CommandDefinition,
} from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import type { TenantScopedClient } from "@/server/platform/tenancy";
import { ENTITY_BUSINESS_PROFILE, ENTITY_GST_REGISTRATION } from "./keys";

/**
 * The business's own legal identity, and its GST registration.
 *
 * Authority: taskplans/archive/45_plywood_workflow_program.md §D-03 and §4.4;
 * PLYWOOD_TARGET_WORKFLOW_GAP_AUDIT.md P0-09.
 *
 * WHAT THIS REPLACES
 * A raw configuration key holding a two-character state code, and the live
 * tenant name read off the invoice page. Neither is master data: one is an
 * untyped string an administrator could set to anything, and the other changes
 * an invoice that was raised, given to a customer and reported to the portal.
 *
 * The specification's §5 is explicit that the accountant must never enter the
 * business's own GSTIN on an individual invoice. That is only possible if the
 * business has one, recorded once, in a place invoices can read.
 *
 * WHY REGISTRATION-KEYED WHEN THERE IS ONLY ONE
 * §D-03 decided a single registration. Everything downstream — tax rules,
 * invoice series, returns — is nevertheless keyed by registration id rather
 * than by tenant, so a Delhi business that later registers in Uttar Pradesh
 * adds a row instead of a migration. The single-registration rule is enforced
 * by a partial unique index, which is one line to relax when that decision
 * changes.
 */

/** The identity an invoice snapshots at the moment it is raised. */
export type SellerIdentity = {
  legalName: string | null;
  gstin: string | null;
  stateCode: string | null;
  invoiceSeriesPrefix: string | null;
};

/**
 * The seller identity for this tenant, or nulls where it has not been set up.
 *
 * Returns nulls rather than throwing: a tenant part-way through onboarding is a
 * real state, and the refusal belongs at the point a tax document is raised —
 * where it can say which specific field is missing — not at every read.
 */
export async function sellerIdentity(
  tx: TenantScopedClient,
): Promise<SellerIdentity> {
  const [profile, registration] = await Promise.all([
    tx.tradingBusinessProfile.findFirst(),
    tx.tradingGstRegistration.findFirst({ where: { active: true } }),
  ]);

  return {
    legalName: profile?.legalName ?? null,
    gstin: registration?.gstin ?? null,
    stateCode: registration?.stateCode ?? null,
    invoiceSeriesPrefix: registration?.invoiceSeriesPrefix ?? null,
  };
}

export const setBusinessProfile: CommandDefinition<
  {
    legalName: string;
    tradeName?: string;
    pan?: string;
    registeredAddress?: string;
    financialYearStartMonth?: number;
    currencyCode?: string;
  },
  { id: string; legalName: string }
> = {
  key: "verity.trading.set_business_profile",
  entity: ENTITY_BUSINESS_PROFILE,
  verb: "Edit",
  input: z.object({
    legalName: z.string().min(1).max(200),
    tradeName: z.string().max(200).optional(),
    // Shape only. Validity belongs to the income tax department; this catches
    // a phone number typed into the wrong box.
    pan: z
      .string()
      .regex(
        /^[A-Z]{5}[0-9]{4}[A-Z]$/,
        "PAN must be 5 letters, 4 digits, 1 letter",
      )
      .optional(),
    registeredAddress: z.string().max(500).optional(),
    financialYearStartMonth: z.number().int().min(1).max(12).optional(),
    currencyCode: z.string().length(3).optional(),
  }),
  handler: async (ctx, input) => {
    const existing = await ctx.tx.tradingBusinessProfile.findFirst();

    // Upsert by tenant rather than by id: there is exactly one profile per
    // tenant, and asking a caller to know its id to change the trade name
    // would be a foreign key masquerading as a form field.
    const profile = existing
      ? await ctx.tx.tradingBusinessProfile.update({
          where: { id: existing.id },
          data: {
            legalName: input.legalName,
            tradeName: input.tradeName ?? null,
            pan: input.pan ?? null,
            registeredAddress: input.registeredAddress ?? null,
            ...(input.financialYearStartMonth
              ? { financialYearStartMonth: input.financialYearStartMonth }
              : {}),
            ...(input.currencyCode ? { currencyCode: input.currencyCode } : {}),
          },
        })
      : await ctx.tx.tradingBusinessProfile.create({
          data: {
            tenantId: ctx.actor.tenantId,
            legalName: input.legalName,
            tradeName: input.tradeName ?? null,
            pan: input.pan ?? null,
            registeredAddress: input.registeredAddress ?? null,
            financialYearStartMonth: input.financialYearStartMonth ?? 4,
            currencyCode: input.currencyCode ?? "INR",
          },
        });

    return {
      result: { id: profile.id, legalName: profile.legalName },
      events: [
        {
          name: "verity.trading.business_profile_set",
          entityId: profile.id,
          payload: { legalName: profile.legalName },
        },
      ],
    };
  },
};

export const registerGstRegistration: CommandDefinition<
  {
    gstin: string;
    registrationType?: "regular" | "composition";
    invoiceSeriesPrefix: string;
  },
  { id: string; gstin: string; stateCode: string }
> = {
  key: "verity.trading.register_gst_registration",
  entity: ENTITY_GST_REGISTRATION,
  verb: "Create",
  input: z.object({
    gstin: GSTIN,
    registrationType: z.enum(["regular", "composition"]).optional(),
    invoiceSeriesPrefix: z.string().min(1).max(20),
  }),
  handler: async (ctx, input) => {
    if (input.registrationType === "composition") {
      throw new ValidationError("E_VALIDATION: composition registration is not supported yet; a Bill of Supply workflow is required");
    }
    // The state code is NOT asked for. It is the first two characters of the
    // GSTIN, always, and asking for it separately creates a field that can
    // disagree with the number it came from — a disagreement that decides
    // CGST+SGST against IGST on every invoice the business ever raises.
    const stateCode = input.gstin.slice(0, 2);

    const active = await ctx.tx.tradingGstRegistration.findFirst({
      where: { active: true },
    });
    if (active) {
      throw new ValidationError(
        `E_VALIDATION: this business already has an active GST registration (${active.gstin}). ` +
          "One registration is supported; a second state is a product decision, not a form.",
      );
    }

    const registration = await ctx.tx.tradingGstRegistration.create({
      data: {
        tenantId: ctx.actor.tenantId,
        gstin: input.gstin,
        stateCode,
        registrationType: input.registrationType ?? "regular",
        invoiceSeriesPrefix: input.invoiceSeriesPrefix,
      },
    });

    return {
      result: {
        id: registration.id,
        gstin: registration.gstin,
        stateCode: registration.stateCode,
      },
      events: [
        {
          name: "verity.trading.gst_registration_added",
          entityId: registration.id,
          // The GSTIN is not a secret — it is printed on every invoice — but
          // the event carries the state code because that is the fact other
          // parts of the system react to.
          payload: { stateCode: registration.stateCode },
        },
      ],
    };
  },
};

export const businessSettings: QueryDefinition<
  Record<string, never>,
  {
    legalName: string | null;
    tradeName: string | null;
    pan: string | null;
    registeredAddress: string | null;
    financialYearStartMonth: number;
    currencyCode: string;
    gstin: string | null;
    stateCode: string | null;
    registrationType: string | null;
    invoiceSeriesPrefix: string | null;
    /** What onboarding still needs, in the order a person would do it. */
    outstanding: string[];
  }
> = {
  key: "verity.trading.business_settings",
  entity: ENTITY_BUSINESS_PROFILE,
  input: z.object({}),
  handler: async (ctx) => {
    const [profile, registration] = await Promise.all([
      ctx.tx.tradingBusinessProfile.findFirst(),
      ctx.tx.tradingGstRegistration.findFirst({ where: { active: true } }),
    ]);

    // Named steps rather than a boolean "configured": the specification's §3
    // asks for a resumable checklist, and "not ready" with no reason is the
    // least useful thing an onboarding screen can say.
    const outstanding: string[] = [];
    if (!profile) outstanding.push("Business details");
    if (!registration) outstanding.push("Tax details");

    return {
      legalName: profile?.legalName ?? null,
      tradeName: profile?.tradeName ?? null,
      pan: profile?.pan ?? null,
      registeredAddress: profile?.registeredAddress ?? null,
      financialYearStartMonth: profile?.financialYearStartMonth ?? 4,
      currencyCode: profile?.currencyCode ?? "INR",
      gstin: registration?.gstin ?? null,
      stateCode: registration?.stateCode ?? null,
      registrationType: registration?.registrationType ?? null,
      invoiceSeriesPrefix: registration?.invoiceSeriesPrefix ?? null,
      outstanding,
    };
  },
};

/**
 * §3 — what a new business still has to do before it can trade.
 *
 * THE POINT OF THIS QUERY. §3 opens with an instruction rather than a feature:
 * "Do not drop them into an empty Overview." A first-time client landing on a
 * dashboard of eight zeroes has been told nothing — not that the figures are
 * zero because nothing has happened yet, not what to do about it, and not
 * whether the product is broken. The eight steps are the answer, in the order a
 * person would actually do them.
 *
 * ORDERED, AND EACH ONE CHECKED AGAINST REAL DATA. A step is complete when the
 * records it produces exist, never because somebody ticked it. A checklist with
 * its own state is a ninth thing to keep in sync with the eight it describes,
 * and the first time they disagree the checklist is the one that is wrong.
 *
 * `blockedBy` names the earlier step that must come first, so the screen can
 * explain why a step is not yet actionable instead of simply disabling it. You
 * cannot price a board before there is a board.
 */
export const onboardingChecklist: QueryDefinition<
  Record<string, never>,
  {
    complete: boolean;
    completedSteps: number;
    totalSteps: number;
    steps: Array<{
      key: string;
      label: string;
      description: string;
      href: string;
      done: boolean;
      /// The step that must be done first, when this one depends on it.
      blockedBy: string | null;
    }>;
  }
> = {
  key: "verity.trading.onboarding_checklist",
  entity: ENTITY_BUSINESS_PROFILE,
  input: z.object({}),
  handler: async (ctx) => {
    const [
      profile,
      registration,
      godowns,
      roles,
      products,
      suppliers,
      customers,
      orders,
      supplierPrices,
      customerPrices,
      salesOrders,
    ] = await Promise.all([
      ctx.tx.tradingBusinessProfile.findFirst({ select: { id: true } }),
      ctx.tx.tradingGstRegistration.findFirst({
        where: { active: true },
        select: { id: true },
      }),
      ctx.tx.location.count(),
      // A role with at least one permission. An empty role is not a
      // configured team — it is a role that grants nothing, and counting it
      // as done would tick a step that leaves everyone locked out.
      ctx.tx.role.count({ where: { permissions: { some: {} } } }),
      ctx.tx.tradingProduct.count({ where: { active: true } }),
      ctx.tx.tradingSupplier.count({ where: { active: true } }),
      ctx.tx.tradingCustomer.count({ where: { active: true } }),
      ctx.tx.tradingPurchaseOrder.count(),
      ctx.tx.tradingSupplierPrice.count(),
      ctx.tx.tradingCustomerPrice.count(),
      ctx.tx.tradingSalesOrder.count(),
    ]);
    // Either side agreeing a price counts — a client may start from
    // supplier cost, customer rate, or both, and there is no order between
    // them the checklist should impose.
    const prices = supplierPrices + customerPrices;

    const steps = [
      {
        key: "business_details",
        label: "Business details",
        description:
          "Legal name, PAN and registered address. These print on every invoice.",
        href: "/settings/business",
        done: profile !== null,
        blockedBy: null,
      },
      {
        key: "tax_details",
        label: "Tax details",
        description:
          "GSTIN, invoice series, and the rate for each HSN you trade.",
        href: "/settings/tax",
        done: registration !== null,
        blockedBy: profile === null ? "Business details" : null,
      },
      {
        key: "godowns",
        label: "Godowns",
        description:
          "Where stock physically sits. Everything you hold is held somewhere.",
        href: "/godowns",
        done: godowns > 0,
        blockedBy: null,
      },
      {
        key: "team",
        label: "Team & roles",
        description: "Who works here and what each of them is allowed to do.",
        href: "/roles",
        done: roles > 0,
        blockedBy: null,
      },
      {
        key: "catalogue",
        label: "Catalogue",
        description: "The boards you trade — brand, size, grade and HSN.",
        href: "/catalogue",
        done: products > 0,
        blockedBy: null,
      },
      {
        key: "suppliers",
        label: "Suppliers",
        description: "Who you buy from, and what they charge.",
        href: "/suppliers",
        done: suppliers > 0,
        blockedBy: products === 0 ? "Catalogue" : null,
      },
      {
        key: "customers",
        label: "Customers",
        description: "Who you sell to, their credit limit and their prices.",
        href: "/customers",
        done: customers > 0,
        blockedBy: products === 0 ? "Catalogue" : null,
      },
      {
        key: "pricing",
        label: "Agreed prices",
        description:
          "What a supplier charges you, or what a customer pays — set at least one before the first order.",
        href: "/prices",
        done: prices > 0,
        blockedBy:
          suppliers === 0 && customers === 0 ? "Suppliers or customers" : null,
      },
      {
        key: "first_order",
        label: "First purchase",
        description:
          "Raise your first purchase order and receive the stock against it.",
        href: "/purchases",
        done: orders > 0,
        blockedBy:
          suppliers === 0
            ? "Suppliers"
            : godowns === 0
              ? "Godowns"
              : products === 0
                ? "Catalogue"
                : null,
      },
      {
        key: "first_sale",
        label: "First sale",
        description: "Raise your first sales order and dispatch against it.",
        href: "/sales",
        done: salesOrders > 0,
        blockedBy:
          customers === 0
            ? "Customers"
            : orders === 0
              ? "First purchase"
              : null,
      },
    ];

    const completedSteps = steps.filter((step) => step.done).length;
    return {
      complete: completedSteps === steps.length,
      completedSteps,
      totalSteps: steps.length,
      steps,
    };
  },
};

export function registerBusinessIdentity(): void {
  registerCommand(setBusinessProfile);
  registerCommand(registerGstRegistration);
  registerQuery(onboardingChecklist);
  registerQuery(businessSettings);
}

/** Composition dealers cannot collect GST separately. Block unsupported tax
 * workflows rather than emit an ordinary tax invoice/return for them.
 * Authority: https://cbic-gst.gov.in/composition-rules.html */
export async function assertRegularRegistration(tx: TenantScopedClient): Promise<void> {
  const registration = await tx.tradingGstRegistration.findFirst({ where: { active: true } });
  if (registration?.registrationType === "composition") {
    throw new ValidationError("E_VALIDATION: composition registration requires a Bill of Supply and composition returns, which are not supported yet");
  }
}
