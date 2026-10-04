import { tenantZone } from "./clock";
import { z } from "zod";
import {
  financialYearOf,
  issueProvisionalPurchaseBill,
  issueSalesInvoice,
  nextDocumentNumber,
  outstandingReceivables,
} from "./finance";
import { lowStock } from "./stock";
import { productTaxRateMap } from "./tax";
import { assertGodownInScope, reachableGodownIds } from "./scope";
import {
  ValidationError,
  type ActorContext,
  type CommandDefinition,
} from "@/server/platform/command";
import { type QueryDefinition } from "@/server/platform/query";
import {
  diffFields,
  recordActivity,
  reconstructHistory,
} from "@/server/platform/audit";
import { transition } from "@/server/platform/state";
import { notify } from "@/server/platform/notification";
import { hasTenantPermission } from "@/server/platform/authorization";
import type { TenantScopedClient } from "@/server/platform/tenancy";
import {
  GSTIN,
  GST_STATE_CODE,
  ENTITY_CUSTOMER,
  ENTITY_CUSTOMER_PRICE,
  ENTITY_INVOICE,
  ENTITY_PURCHASE_ORDER,
  ENTITY_RESERVATION,
  ENTITY_SALES_ORDER,
  ENTITY_SUPPLIER,
  ENTITY_STOCK_BALANCE,
  ENTITY_SUPPLIER_PRICE,
} from "./keys";
import { formatProductSize } from "./format";
import { applyMovement, serviceProductIds } from "./stock";

/**
 * PLYWOOD STAGES 3 AND 4 — trading partners and orders.
 *
 * Requirement source: plywood.md §1.2 and §1.3. P5 (a reservation table) is
 * resolved in implementation/plywood-decisions.md.
 *
 * Purchase and sale live in one module because they are the same shape pointing
 * in opposite directions, and it is useful to read them beside each other. They
 * are NOT one abstraction with a direction flag: a credit limit, a partial
 * receipt and a reservation are three different rules, and collapsing them would
 * produce a union nobody can follow.
 */

const STATE_CODE = GST_STATE_CODE;

/**
 * A readable number for an order, when the user gave it none.
 *
 * Audit findings U2-1 and U2-2. Orders had a nullable free-text `reference` and
 * no document number, so a list identified a row by party name alone and the
 * detail page fell back to a UUID fragment — "Purchase order 462e7714". Two
 * orders to the same supplier were indistinguishable, and a warehouse user
 * receiving against one had nothing to check they had the right one.
 *
 * Uses the same gapless counter invoices use, so an order number is as
 * trustworthy as an invoice number and the two read as one family.
 *
 * A REFERENCE THE USER TYPED IS KEPT. Theirs carries meaning ours cannot — a
 * customer's own PO number, a phone-order note — and overwriting it to impose
 * our format would destroy the more useful of the two.
 */
async function orderNumber(
  tx: TenantScopedClient,
  tenantId: string,
  seriesKey: "PO" | "SO",
  raisedAt: Date,
): Promise<string> {
  const { invoiceNumber } = await nextDocumentNumber(
    tx,
    tenantId,
    seriesKey,
    financialYearOf(raisedAt, await tenantZone(tx)),
  );
  return invoiceNumber;
}

/**
 * REQ-EXPERIENCE-DESIGNSYSTEM-024 — everyone whose role holds `ActionExecute`
 * on `entity`, tenant-wide, minus the actor who just caused the transition.
 * The actor never needs telling about their own action.
 *
 * Same shape as `requestAccess` (`src/server/actions/access-request.ts`):
 * resolve recipients from the permission the next step actually requires,
 * not a separate "who gets told" list that can drift from it.
 */
async function notifyPermissionHolders(
  ctx: { tx: TenantScopedClient; actor: ActorContext },
  entity: string,
): Promise<string[]> {
  const memberships = await ctx.tx.tenantMembership.findMany({
    where: { tenantId: ctx.actor.tenantId, roleId: { not: null } },
    select: { userId: true, roleId: true },
  });
  const roleIds = [...new Set(memberships.map((m) => m.roleId!))];
  const permittedRoleIds = new Set<string>();
  for (const roleId of roleIds) {
    if (await hasTenantPermission(ctx.tx, roleId, "ActionExecute", entity)) {
      permittedRoleIds.add(roleId);
    }
  }
  return [
    ...new Set(
      memberships
        .filter(
          (m) => permittedRoleIds.has(m.roleId!) && m.userId !== ctx.actor.userId,
        )
        .map((m) => m.userId),
    ),
  ];
}

/* ================================ suppliers =============================== */

/**
 * A board's name with enough of its specification to tell it from its siblings.
 *
 * REPORTED: "in open orders it just says the item name and not its
 * specifications — there can be multiple items with the same name but a
 * different width or something else."
 *
 * Exactly right, and it is worse than cosmetic: a catalogue routinely carries
 * "MR Commercial Ply" in 6mm, 12mm and 19mm, and an order line reading only
 * "MR Commercial Ply" leaves a warehouse user guessing which one to load. The
 * distinguishing facts are thickness, then size, then grade, so the snapshot
 * carries them.
 *
 * A SNAPSHOT, so it is built once when the line is written and never recomputed:
 * a catalogue edit must not rewrite a placed order. Lines written before this
 * keep the bare name they were written with, which is the honest thing for a
 * snapshot to do.
 */
function describeProduct(product: {
  name: string;
  thicknessTenthMm?: number | null;
  sizeUnit?: string | null;
  widthTenth?: number | null;
  heightTenth?: number | null;
  grade?: string | null;
}): string {
  const parts = [product.name];
  if (product.thicknessTenthMm != null) {
    parts.push(`${(product.thicknessTenthMm / 10).toFixed(1)} mm`);
  }
  // The size carries its unit, because "8 × 4" and "96 × 5" are the same
  // shape of text and very different boards. A snapshot that dropped the unit
  // would be ambiguous on the one document where it matters most.
  if (product.widthTenth != null && product.heightTenth != null) {
    parts.push(
      formatProductSize({
        sizeUnit: product.sizeUnit ?? "MM",
        widthTenth: product.widthTenth,
        heightTenth: product.heightTenth,
      }),
    );
  }
  if (product.grade) parts.push(product.grade);
  return parts.join(" · ");
}

export const createSupplier: CommandDefinition<
  {
    displayName: string;
    gstin?: string;
    phone?: string;
    email?: string;
    stateCode?: string;
  },
  { id: string }
> = {
  key: "verity.trading.create_supplier",
  entity: ENTITY_SUPPLIER,
  verb: "Create",
  input: z.object({
    displayName: z.string().min(1).max(200),
    gstin: GSTIN.optional(),
    phone: z.string().max(40).optional(),
    email: z.string().email().max(200).optional(),
    stateCode: STATE_CODE.optional(),
  }),
  handler: async (ctx, input) => {
    const supplier = await ctx.tx.tradingSupplier.create({
      data: {
        tenantId: ctx.actor.tenantId,
        displayName: input.displayName,
        gstin: input.gstin ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        stateCode: input.stateCode ?? null,
      },
    });

    // EVERY SUPPLIER IS ALSO A CUSTOMER.
    //
    // Stated by the proprietor as a fact about this trade, not a preference:
    // the mills and dealers they buy from all buy back. So the matching
    // customer is created here rather than offered as a button somebody has to
    // remember to press — a relationship that always exists should not depend
    // on being declared.
    //
    // It is still a LINK and not a merge: buying and selling keep separate
    // documents, separate credit limits and separate ledgers, because they are
    // separate obligations and netting one against the other silently would
    // misstate both.
    //
    // An existing customer with the same GSTIN is linked instead of duplicated
    // — the same firm twice on the selling side is exactly the confusion this
    // is meant to remove.
    const existing = input.gstin
      ? await ctx.tx.tradingCustomer.findFirst({
          where: { gstin: input.gstin },
        })
      : null;

    const customer =
      existing ??
      (await ctx.tx.tradingCustomer.create({
        data: {
          tenantId: ctx.actor.tenantId,
          displayName: input.displayName,
          gstin: input.gstin ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          stateCode: input.stateCode ?? null,
          // Cash only until somebody decides otherwise. A credit limit is a
          // decision about a specific firm, and inventing one here would extend
          // credit nobody granted.
          creditLimitPaise: 0,
        },
      }));

    // Only when that customer is not already the other half of a different
    // supplier — one firm cannot be two suppliers, and the unique index says so.
    const alreadyLinked = await ctx.tx.tradingSupplier.findFirst({
      where: { linkedCustomerId: customer.id },
    });
    if (!alreadyLinked) {
      await ctx.tx.tradingSupplier.update({
        where: { id: supplier.id },
        data: { linkedCustomerId: customer.id },
      });
    }

    return {
      result: { id: supplier.id },
      events: [
        { name: "verity.trading.supplier_created", entityId: supplier.id },
        ...(existing
          ? []
          : [
              {
                name: "verity.trading.customer_created",
                entityId: customer.id,
              },
            ]),
      ],
    };
  },
};

/**
 * Correcting a supplier's details, and retiring one.
 *
 * Requested: "option to remove and edit customers, suppliers and godowns."
 *
 * REMOVING IS DEACTIVATION, NOT DELETION, and the difference is not pedantry.
 * A supplier is referenced by every order placed with them, every bill they
 * sent, and every ledger entry against them, all of which are ON DELETE
 * RESTRICT because a payable whose counterparty vanished is unexplainable. So
 * "remove" means "stop offering them", which is what the person clicking it
 * actually wants: the firm is gone from the pickers and the history is intact.
 *
 * A supplier who has never been traded with is a different case — a typo, a
 * duplicate — and is genuinely deleted, because there is no history to protect
 * and leaving a deactivated typo in the list is clutter that never goes away.
 */
export const editSupplier: CommandDefinition<
  {
    supplierId: string;
    displayName?: string;
    gstin?: string | null;
    phone?: string | null;
    email?: string | null;
    stateCode?: string | null;
    active?: boolean;
  },
  { id: string }
> = {
  key: "verity.trading.edit_supplier",
  entity: ENTITY_SUPPLIER,
  verb: "Edit",
  input: z.object({
    supplierId: z.string().uuid(),
    displayName: z.string().min(1).max(200).optional(),
    gstin: GSTIN.nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    email: z.string().email().max(200).nullable().optional(),
    stateCode: STATE_CODE.nullable().optional(),
    active: z.boolean().optional(),
  }),
  handler: async (ctx, input) => {
    const { supplierId, ...changes } = input;
    const supplier = await ctx.tx.tradingSupplier.findUniqueOrThrow({ where: { id: supplierId } });
    await ctx.tx.tradingSupplier.update({
      where: { id: supplierId },
      data: { ...changes, version: { increment: 1 } },
    });
    // ONE BUSINESS, TWO ROWS. A supplier linked to a customer is the same
    // legal entity, so its identity fields are one fact: a state code added
    // on either screen must be true on both (requested 2026-09-15 — the
    // customer side got a state code and the supplier side still refused
    // the bill). `active` is per-side and is deliberately not carried.
    const shared = sharedIdentityChanges(changes);
    if (supplier.linkedCustomerId && Object.keys(shared).length > 0) {
      await ctx.tx.tradingCustomer.update({
        where: { id: supplier.linkedCustomerId },
        data: { ...shared, version: { increment: 1 } },
      });
    }
    return {
      result: { id: supplierId },
      events: [
        { name: "verity.trading.supplier_edited", entityId: supplierId },
        ...(supplier.linkedCustomerId && Object.keys(shared).length > 0
          ? [{ name: "verity.trading.customer_edited", entityId: supplier.linkedCustomerId }]
          : []),
      ],
    };
  },
};

/**
 * The fields a linked customer and supplier hold in common — identity, not
 * terms. Credit limit is the customer's alone; `active` is per side.
 */
function sharedIdentityChanges(changes: {
  displayName?: string;
  gstin?: string | null;
  phone?: string | null;
  email?: string | null;
  stateCode?: string | null;
}): { displayName?: string; gstin?: string | null; phone?: string | null; email?: string | null; stateCode?: string | null } {
  const out: ReturnType<typeof sharedIdentityChanges> = {};
  if (changes.displayName !== undefined) out.displayName = changes.displayName;
  if (changes.gstin !== undefined) out.gstin = changes.gstin;
  if (changes.phone !== undefined) out.phone = changes.phone;
  if (changes.email !== undefined) out.email = changes.email;
  if (changes.stateCode !== undefined) out.stateCode = changes.stateCode;
  return out;
}

export const removeSupplier: CommandDefinition<
  { supplierId: string },
  { id: string; deleted: boolean }
> = {
  impact: "destructive",
  key: "verity.trading.remove_supplier",
  entity: ENTITY_SUPPLIER,
  verb: "Edit",
  input: z.object({ supplierId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const supplier = await ctx.tx.tradingSupplier.findUniqueOrThrow({
      where: { id: input.supplierId },
      include: {
        orders: { select: { id: true }, take: 1 },
        tradingInvoices: { select: { id: true }, take: 1 },
        tradingLedgerEntries: { select: { id: true }, take: 1 },
        tradingPayments: { select: { id: true }, take: 1 },
      },
    });

    const traded =
      supplier.orders.length > 0 ||
      supplier.tradingInvoices.length > 0 ||
      supplier.tradingLedgerEntries.length > 0 ||
      supplier.tradingPayments.length > 0;

    if (traded) {
      // History exists, so the row stays and stops being offered. Deleting it
      // would orphan orders, bills and ledger entries that explain money.
      await ctx.tx.tradingSupplier.update({
        where: { id: supplier.id },
        data: { active: false, version: { increment: 1 } },
      });
      return {
        result: { id: supplier.id, deleted: false },
        events: [
          {
            name: "verity.trading.supplier_deactivated",
            entityId: supplier.id,
          },
        ],
      };
    }

    // Never traded with: a typo or a duplicate, with nothing to protect.
    await ctx.tx.tradingSupplierPrice.deleteMany({
      where: { supplierId: supplier.id },
    });
    await ctx.tx.tradingSupplier.delete({ where: { id: supplier.id } });
    return {
      result: { id: supplier.id, deleted: true },
      events: [
        { name: "verity.trading.supplier_deleted", entityId: supplier.id },
      ],
    };
  },
};

/** The selling-side twin of `editSupplier`. Same rules, same reasoning. */
export const editCustomer: CommandDefinition<
  {
    customerId: string;
    displayName?: string;
    gstin?: string | null;
    phone?: string | null;
    email?: string | null;
    stateCode?: string | null;
    creditLimitPaise?: number;
    active?: boolean;
  },
  { id: string }
> = {
  key: "verity.trading.edit_customer",
  entity: ENTITY_CUSTOMER,
  verb: "Edit",
  input: z.object({
    customerId: z.string().uuid(),
    displayName: z.string().min(1).max(200).optional(),
    gstin: GSTIN.nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    email: z.string().email().max(200).nullable().optional(),
    stateCode: STATE_CODE.nullable().optional(),
    creditLimitPaise: z.number().int().min(0).optional(),
    active: z.boolean().optional(),
  }),
  handler: async (ctx, input) => {
    const { customerId, ...changes } = input;
    await ctx.tx.tradingCustomer.findUniqueOrThrow({ where: { id: customerId } });
    await ctx.tx.tradingCustomer.update({
      where: { id: customerId },
      data: { ...changes, version: { increment: 1 } },
    });
    // The same business on the supplier side takes the same identity change
    // — see `editSupplier` for the reasoning. Credit limit stays here.
    const shared = sharedIdentityChanges(changes);
    const linked = Object.keys(shared).length > 0
      ? await ctx.tx.tradingSupplier.findFirst({ where: { linkedCustomerId: customerId }, select: { id: true } })
      : null;
    if (linked) {
      await ctx.tx.tradingSupplier.update({
        where: { id: linked.id },
        data: { ...shared, version: { increment: 1 } },
      });
    }
    return {
      result: { id: customerId },
      events: [
        { name: "verity.trading.customer_edited", entityId: customerId },
        ...(linked ? [{ name: "verity.trading.supplier_edited", entityId: linked.id }] : []),
      ],
    };
  },
};

export const removeCustomer: CommandDefinition<
  { customerId: string },
  { id: string; deleted: boolean }
> = {
  impact: "destructive",
  key: "verity.trading.remove_customer",
  entity: ENTITY_CUSTOMER,
  verb: "Edit",
  input: z.object({ customerId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const customer = await ctx.tx.tradingCustomer.findUniqueOrThrow({
      where: { id: input.customerId },
      include: {
        orders: { select: { id: true }, take: 1 },
        tradingInvoices: { select: { id: true }, take: 1 },
        tradingLedgerEntries: { select: { id: true }, take: 1 },
        tradingPayments: { select: { id: true }, take: 1 },
      },
    });

    const traded =
      customer.orders.length > 0 ||
      customer.tradingInvoices.length > 0 ||
      customer.tradingLedgerEntries.length > 0 ||
      customer.tradingPayments.length > 0;

    if (traded) {
      await ctx.tx.tradingCustomer.update({
        where: { id: customer.id },
        data: { active: false, version: { increment: 1 } },
      });
      return {
        result: { id: customer.id, deleted: false },
        events: [
          {
            name: "verity.trading.customer_deactivated",
            entityId: customer.id,
          },
        ],
      };
    }

    // A supplier may be pointing at this customer as their own selling side.
    // The link is cleared rather than the delete being refused: the supplier is
    // untouched, and the link described a customer that no longer exists.
    await ctx.tx.tradingSupplier.updateMany({
      where: { linkedCustomerId: customer.id },
      data: { linkedCustomerId: null },
    });
    await ctx.tx.tradingCustomerPrice.deleteMany({
      where: { customerId: customer.id },
    });
    await ctx.tx.tradingCustomer.delete({ where: { id: customer.id } });
    return {
      result: { id: customer.id, deleted: true },
      events: [
        { name: "verity.trading.customer_deleted", entityId: customer.id },
      ],
    };
  },
};

/**
 * A whole price list at once, for one party.
 *
 * REPORTED: "there should be an Excel-sheet kind of sheet for agreeing a price
 * with suppliers and customers."
 *
 * Agreeing prices is not one decision at a time. A merchant sits down with a
 * mill's rate card and works through it, and the single-price command turned
 * that into one dialog, one save and one page reload per board — which is why
 * nobody did it and why the "blank uses agreed price" hint so often had nothing
 * behind it.
 *
 * One transaction for the sheet, so a rate card is applied whole or not at all:
 * half an applied rate card is worse than none, because nothing on the screen
 * says which half.
 *
 * A blank cell REMOVES the agreed price rather than storing zero. Zero is a
 * price — a free supply — and storing it would poison the weighted-average cost
 * of every sheet in the godown the first time an order took the default.
 */
export const setPriceSheet: CommandDefinition<
  {
    side: "supplier" | "customer";
    partyId: string;
    prices: Array<{ productId: string; pricePaise: number | null }>;
  },
  { saved: number; removed: number }
> = {
  key: "verity.trading.set_price_sheet",
  entity: ENTITY_SUPPLIER_PRICE,
  verb: "Edit",
  input: z.object({
    side: z.enum(["supplier", "customer"]),
    partyId: z.string().uuid(),
    prices: z
      .array(
        z.object({
          productId: z.string().uuid(),
          pricePaise: z.number().int().min(0).nullable(),
        }),
      )
      .max(1000),
  }),
  handler: async (ctx, input) => {
    if (input.side === "supplier") {
      const supplier = await ctx.tx.tradingSupplier.findUnique({
        where: { id: input.partyId },
      });
      if (!supplier) {
        throw new ValidationError(
          "E_VALIDATION: that supplier is not in this tenant",
        );
      }
    } else {
      const customer = await ctx.tx.tradingCustomer.findUnique({
        where: { id: input.partyId },
      });
      if (!customer) {
        throw new ValidationError(
          "E_VALIDATION: that customer is not in this tenant",
        );
      }
    }

    let saved = 0;
    let removed = 0;

    for (const row of input.prices) {
      if (row.pricePaise === null) {
        if (input.side === "supplier") {
          const { count } = await ctx.tx.tradingSupplierPrice.deleteMany({
            where: { supplierId: input.partyId, productId: row.productId },
          });
          removed += count;
        } else {
          const { count } = await ctx.tx.tradingCustomerPrice.deleteMany({
            where: { customerId: input.partyId, productId: row.productId },
          });
          removed += count;
        }
        continue;
      }

      if (input.side === "supplier") {
        await ctx.tx.tradingSupplierPrice.upsert({
          where: {
            tenantId_supplierId_productId: {
              tenantId: ctx.actor.tenantId,
              supplierId: input.partyId,
              productId: row.productId,
            },
          },
          create: {
            tenantId: ctx.actor.tenantId,
            supplierId: input.partyId,
            productId: row.productId,
            negotiatedCostPaise: row.pricePaise,
          },
          update: {
            negotiatedCostPaise: row.pricePaise,
            version: { increment: 1 },
          },
        });
      } else {
        await ctx.tx.tradingCustomerPrice.upsert({
          where: {
            tenantId_customerId_productId: {
              tenantId: ctx.actor.tenantId,
              customerId: input.partyId,
              productId: row.productId,
            },
          },
          create: {
            tenantId: ctx.actor.tenantId,
            customerId: input.partyId,
            productId: row.productId,
            customPricePaise: row.pricePaise,
          },
          update: {
            customPricePaise: row.pricePaise,
            version: { increment: 1 },
          },
        });
      }
      saved += 1;
    }

    return {
      result: { saved, removed },
      events: [
        {
          name:
            input.side === "supplier"
              ? "verity.trading.supplier_price_set"
              : "verity.trading.customer_price_set",
          entityId: input.partyId,
          payload: { saved, removed },
        },
      ],
    };
  },
};

export const setSupplierPrice: CommandDefinition<
  { supplierId: string; productId: string; negotiatedCostPaise: number },
  { id: string }
> = {
  key: "verity.trading.set_supplier_price",
  entity: ENTITY_SUPPLIER_PRICE,
  verb: "Edit",
  input: z.object({
    supplierId: z.string().uuid(),
    productId: z.string().uuid(),
    negotiatedCostPaise: z.number().int().min(0),
  }),
  handler: async (ctx, input) => {
    // Upsert rather than create-or-fail: a negotiated price is one current fact
    // per supplier per board, and the history of what it used to be lives in the
    // activity stream and in the orders that were placed at it.
    const price = await ctx.tx.tradingSupplierPrice.upsert({
      where: {
        tenantId_supplierId_productId: {
          tenantId: ctx.actor.tenantId,
          supplierId: input.supplierId,
          productId: input.productId,
        },
      },
      create: {
        tenantId: ctx.actor.tenantId,
        supplierId: input.supplierId,
        productId: input.productId,
        negotiatedCostPaise: input.negotiatedCostPaise,
      },
      update: {
        negotiatedCostPaise: input.negotiatedCostPaise,
        version: { increment: 1 },
      },
    });
    return {
      result: { id: price.id },
      events: [
        { name: "verity.trading.supplier_price_set", entityId: price.id },
      ],
    };
  },
};

/* ================================ customers =============================== */

export const createCustomer: CommandDefinition<
  {
    displayName: string;
    gstin?: string;
    phone?: string;
    email?: string;
    stateCode?: string;
    creditLimitPaise?: number;
  },
  { id: string }
> = {
  key: "verity.trading.create_customer",
  entity: ENTITY_CUSTOMER,
  verb: "Create",
  input: z.object({
    displayName: z.string().min(1).max(200),
    gstin: GSTIN.optional(),
    phone: z.string().max(40).optional(),
    email: z.string().email().max(200).optional(),
    stateCode: STATE_CODE.optional(),
    creditLimitPaise: z.number().int().min(0).optional(),
  }),
  handler: async (ctx, input) => {
    const customer = await ctx.tx.tradingCustomer.create({
      data: {
        tenantId: ctx.actor.tenantId,
        displayName: input.displayName,
        gstin: input.gstin ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        stateCode: input.stateCode ?? null,
        // Zero by default: a new customer is cash-only until someone decides
        // otherwise, rather than starting with credit nobody granted.
        creditLimitPaise: input.creditLimitPaise ?? 0,
      },
    });
    return {
      result: { id: customer.id },
      events: [
        { name: "verity.trading.customer_created", entityId: customer.id },
      ],
    };
  },
};

export const setCreditLimit: CommandDefinition<
  { customerId: string; creditLimitPaise: number },
  { id: string }
> = {
  key: "verity.trading.set_credit_limit",
  entity: ENTITY_CUSTOMER,
  // Granting credit is not editing a phone number. ActionExecute so it can be
  // held by the owner and finance without also withholding ordinary edits.
  verb: "ActionExecute",
  input: z.object({
    customerId: z.string().uuid(),
    creditLimitPaise: z.number().int().min(0),
  }),
  handler: async (ctx, input) => {
    const before = await ctx.tx.tradingCustomer.findUniqueOrThrow({
      where: { id: input.customerId },
    });
    const after = await ctx.tx.tradingCustomer.update({
      where: { id: input.customerId },
      data: {
        creditLimitPaise: input.creditLimitPaise,
        version: { increment: 1 },
      },
    });

    // Who raised whose limit, and from what, is the first question after a bad
    // debt. The diff answers it.
    await recordActivity(ctx, {
      entityKey: ENTITY_CUSTOMER,
      entityId: after.id,
      commandKey: "verity.trading.set_credit_limit",
      changes: diffFields(
        { creditLimitPaise: before.creditLimitPaise },
        { creditLimitPaise: after.creditLimitPaise },
      ),
    });

    return {
      result: { id: after.id },
      events: [{ name: "verity.trading.credit_limit_set", entityId: after.id }],
    };
  },
};

export const setCustomerPrice: CommandDefinition<
  { customerId: string; productId: string; customPricePaise: number },
  { id: string }
> = {
  key: "verity.trading.set_customer_price",
  entity: ENTITY_CUSTOMER_PRICE,
  verb: "Edit",
  input: z.object({
    customerId: z.string().uuid(),
    productId: z.string().uuid(),
    customPricePaise: z.number().int().min(0),
  }),
  handler: async (ctx, input) => {
    const price = await ctx.tx.tradingCustomerPrice.upsert({
      where: {
        tenantId_customerId_productId: {
          tenantId: ctx.actor.tenantId,
          customerId: input.customerId,
          productId: input.productId,
        },
      },
      create: {
        tenantId: ctx.actor.tenantId,
        customerId: input.customerId,
        productId: input.productId,
        customPricePaise: input.customPricePaise,
      },
      update: {
        customPricePaise: input.customPricePaise,
        version: { increment: 1 },
      },
    });
    return {
      result: { id: price.id },
      events: [
        { name: "verity.trading.customer_price_set", entityId: price.id },
      ],
    };
  },
};

/* ============================== purchase side ============================= */

/**
 * A TEMPLATE is not a thing anyone can order, receive or sell.
 *
 * It is the parent a laminate design's shade x texture variants were generated
 * from -- it holds what they share and nothing sits behind it in a godown.
 * Letting one onto an order line would create a payable, a reservation and a
 * stock movement for a row that is, by construction, never counted.
 *
 * Checked by name rather than filtered out of the query, so the refusal says
 * which product and why. "Unknown or withdrawn" would be a lie about a product
 * sitting right there in the catalogue.
 */
function assertNoTemplates(
  products: Array<{ name: string; type: string }>,
): void {
  const template = products.find((product) => product.type === "TEMPLATE");
  if (template) {
    throw new ValidationError(
      `E_VALIDATION: ${template.name} is a design, not a product. ` +
        "Choose one of its shade and texture variants.",
    );
  }
}

export const createPurchaseOrder: CommandDefinition<
  {
    supplierId: string;
    locationId: string;
    reference?: string;
    gstApplicable?: boolean;
    lines: Array<{
      productId: string;
      qtyOrdered: number;
      unitCostPaise?: number;
      discountBps?: number;
    }>;
  },
  { id: string; totalCostPaise: number }
> = {
  scopeHandling: "handler",
  key: "verity.trading.create_purchase_order",
  entity: ENTITY_PURCHASE_ORDER,
  verb: "Create",
  input: z.object({
    supplierId: z.string().uuid(),
    locationId: z.string().uuid(),
    reference: z.string().max(60).optional(),
    /**
     * Whether this purchase attracts GST. Defaults to ON, because the ordinary
     * registered supplier charges it and defaulting the other way would drop a
     * claimable input credit without anyone noticing. Turned off for an
     * unregistered or composition supplier: the bill raised from this order
     * then records no tax and claims no credit, rather than recording a tax
     * that was never charged and can never be reconciled against the portal.
     */
    gstApplicable: z.boolean().optional(),
    lines: z
      .array(
        z.object({
          productId: z.string().uuid(),
          qtyOrdered: z.number().int().positive(),
          unitCostPaise: z.number().int().min(0).optional(),
          /**
           * Basis points off the unit cost. 1250 is 12.5%; 10000 is the whole
           * price. A wholly discounted line IS a free supply with its own tax
           * treatment, and that is a judgement for whoever files the return —
           * refusing to record what happened does not stop it happening.
           */
          discountBps: z.number().int().min(0).max(10_000).optional(),
        }),
      )
      .min(1),
  }),
  preconditions: async (ctx, input) => {
    const supplier = await ctx.tx.tradingSupplier.findUnique({
      where: { id: input.supplierId },
    });
    if (!supplier)
      throw new ValidationError(
        "E_VALIDATION: supplier not found in this tenant",
      );
    if (!supplier.active) {
      throw new ValidationError(
        "E_VALIDATION: that supplier is no longer traded with",
      );
    }
    const godown = await ctx.tx.location.findUnique({
      where: { id: input.locationId },
    });
    if (!godown)
      throw new ValidationError(
        "E_VALIDATION: godown not found in this tenant",
      );
  },
  handler: async (ctx, input) => {
    const products = await ctx.tx.tradingProduct.findMany({
      where: {
        id: { in: input.lines.map((line) => line.productId) },
        active: true,
      },
    });
    if (
      products.length !==
      new Set(input.lines.map((line) => line.productId)).size
    ) {
      throw new ValidationError(
        "E_VALIDATION: a board on this order is unknown or withdrawn",
      );
    }
    assertNoTemplates(products);

    const negotiated = await ctx.tx.tradingSupplierPrice.findMany({
      where: { supplierId: input.supplierId },
    });

    const priced = input.lines.map((line) => {
      const product = products.find(
        (candidate) => candidate.id === line.productId,
      )!;
      const agreed = negotiated.find(
        (price) => price.productId === line.productId,
      );
      // The caller may override; otherwise the negotiated price applies. An
      // order with neither is refused rather than defaulted to zero, because a
      // zero-cost receipt would poison the weighted average silently.
      const listUnitCostPaise =
        line.unitCostPaise ?? agreed?.negotiatedCostPaise;
      if (listUnitCostPaise === undefined) {
        throw new ValidationError(
          `E_VALIDATION: no agreed price for ${product.name} with this supplier, and none given`,
        );
      }
      // The discount is applied ONCE, here, and `unitCostPaise` carries the
      // result. Every reader downstream — the stock movement's cost, the
      // weighted average, the payable, the purchase register — reads that one
      // field, so none of them can apply the discount a second time or miss it
      // entirely. The list price is kept only so the order can show what was
      // struck off.
      const discountBps = line.discountBps ?? 0;
      const unitCostPaise =
        discountBps === 0
          ? listUnitCostPaise
          : Math.round((listUnitCostPaise * (10_000 - discountBps)) / 10_000);
      return {
        productId: line.productId,
        // Snapshots. A catalogue edit must never rewrite a placed order.
        productNameSnapshot: describeProduct(product),
        hsnCodeSnapshot: product.hsnCode,
        qtyOrdered: line.qtyOrdered,
        unitCostPaise,
        discountBps,
        listUnitCostPaise: discountBps === 0 ? null : listUnitCostPaise,
      };
    });

    const totalCostPaise = priced.reduce(
      (sum, line) => sum + line.qtyOrdered * line.unitCostPaise,
      0,
    );

    // Layer 2 on the write path (P0-01). Holding Create on purchase orders is
    // not permission to order stock into somebody else's godown.
    await assertGodownInScope(
      ctx.tx,
      ctx.actor,
      ENTITY_PURCHASE_ORDER,
      "Create",
      input.locationId,
    );

    const order = await ctx.tx.tradingPurchaseOrder.create({
      data: {
        tenantId: ctx.actor.tenantId,
        supplierId: input.supplierId,
        locationId: input.locationId,
        reference:
          input.reference ??
          (await orderNumber(ctx.tx, ctx.actor.tenantId, "PO", new Date())),
        gstApplicable: input.gstApplicable ?? true,
        totalCostPaise,
      },
    });

    // Lines written separately rather than as a nested create. The relation is
    // keyed on (tenantId, purchaseOrderId), so Prisma treats `tenantId` as part
    // of the relation and refuses it as a nested field — the composite key that
    // makes a cross-tenant line impossible also makes the nested form
    // unavailable. Same transaction either way.
    await ctx.tx.tradingPurchaseOrderLine.createMany({
      data: priced.map((line) => ({
        ...line,
        tenantId: ctx.actor.tenantId,
        purchaseOrderId: order.id,
      })),
    });

    return {
      result: { id: order.id, totalCostPaise },
      events: [
        { name: "verity.trading.purchase_order_created", entityId: order.id },
      ],
    };
  },
};

export const submitPurchaseOrder: CommandDefinition<
  { orderId: string },
  { id: string }
> = {
  key: "verity.trading.submit_purchase_order",
  entity: ENTITY_PURCHASE_ORDER,
  verb: "ActionExecute",
  input: z.object({ orderId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const order = await ctx.tx.tradingPurchaseOrder.findUniqueOrThrow({
      where: { id: input.orderId },
      include: { lines: true },
    });
    const moved = await transition(ctx, {
      entityKey: ENTITY_PURCHASE_ORDER,
      entityId: order.id,
      fromKey: order.state,
      toKey: "submitted",
    });
    await ctx.tx.tradingPurchaseOrder.update({
      where: { id: order.id },
      data: { state: "submitted", version: { increment: 1 } },
    });

    // REQ-EXPERIENCE-DESIGNSYSTEM-024 — a submitted PO is next for whoever
    // holds the receiving permission; nobody else knows to expect the goods
    // until they happen to reopen the order.
    const receivers = await notifyPermissionHolders(ctx, ENTITY_PURCHASE_ORDER);
    if (receivers.length > 0) {
      await notify(ctx.tx, {
        tenantId: ctx.actor.tenantId,
        recipientIds: receivers,
        key: "verity.trading.purchase_order_submitted",
        entityKey: ENTITY_PURCHASE_ORDER,
        entityId: order.id,
        variables: { reference: order.reference ?? order.id.slice(0, 8) },
        fallback: {
          subject: `Purchase order ${order.reference ?? order.id.slice(0, 8)} submitted`,
          body: "Submitted and awaiting receipt against this order.",
        },
      });
    }

    return {
      result: { id: order.id },
      events: [
        moved.event,
        { name: "verity.trading.purchase_order_submitted", entityId: order.id },
      ],
    };
  },
};

/**
 * Records that a supplier and a customer are the same business.
 *
 * Reported: "the suppliers can be our customers as well." Buying and selling
 * stay separate — separate documents, separate tax treatment, separate credit
 * limit, separate ledger — because they are separate obligations, and offsetting
 * one against the other without saying so misstates both. What this records is
 * that they are one relationship, so the two can be shown together and a net
 * position stated when someone asks for it.
 *
 * Passing no customerId unlinks, which is the correct action when the link was
 * made against the wrong firm and is not a deletion of anything.
 */
export const linkSupplierToCustomer: CommandDefinition<
  { supplierId: string; customerId?: string },
  { supplierId: string; customerId: string | null }
> = {
  key: "verity.trading.link_supplier_to_customer",
  entity: ENTITY_SUPPLIER,
  verb: "Edit",
  input: z.object({
    supplierId: z.string().uuid(),
    customerId: z.string().uuid().optional(),
  }),
  handler: async (ctx, input) => {
    const supplier = await ctx.tx.tradingSupplier.findUniqueOrThrow({
      where: { id: input.supplierId },
    });

    if (input.customerId) {
      const customer = await ctx.tx.tradingCustomer.findUnique({
        where: { id: input.customerId },
      });
      if (!customer) {
        throw new ValidationError(
          "E_VALIDATION: that customer is not in this tenant",
        );
      }
      // Checked here as well as by the unique index, so the refusal names the
      // supplier already holding the link rather than surfacing a constraint.
      const taken = await ctx.tx.tradingSupplier.findFirst({
        where: { linkedCustomerId: input.customerId, id: { not: supplier.id } },
      });
      if (taken) {
        throw new ValidationError(
          `E_VALIDATION: ${customer.displayName} is already linked to ${taken.displayName}`,
        );
      }
      // Both sides describe the same legal entity, so two different GSTINs are
      // two different entities and the link would put one firm's tax identity
      // on another's documents.
      if (
        supplier.gstin &&
        customer.gstin &&
        supplier.gstin !== customer.gstin
      ) {
        throw new ValidationError(
          `E_VALIDATION: ${supplier.displayName} and ${customer.displayName} have different GSTINs, ` +
            "so they are not the same business",
        );
      }
    }

    await ctx.tx.tradingSupplier.update({
      where: { id: supplier.id },
      data: {
        linkedCustomerId: input.customerId ?? null,
        version: { increment: 1 },
      },
    });

    return {
      result: {
        supplierId: supplier.id,
        customerId: input.customerId ?? null,
      },
      events: [
        {
          name: input.customerId
            ? "verity.trading.supplier_linked_to_customer"
            : "verity.trading.supplier_unlinked_from_customer",
          entityId: supplier.id,
        },
      ],
    };
  },
};

/**
 * Amending an order that has not moved yet.
 *
 * Requested: "option to edit purchase and sales orders."
 *
 * WHAT CAN BE EDITED, AND WHEN. Only while nothing has physically happened —
 * no goods received on a purchase order, none issued on a sales order. Once a
 * delivery has been made against a line, that line describes a real event: the
 * stock ledger, the weighted-average cost and any bill raised from it all read
 * the ordered quantity and price, and rewriting them would restate history that
 * a warehouse and a supplier both witnessed. Such an order is amended the way
 * every other posted difference is — by cancelling the remainder, or by a note.
 *
 * Lines are REPLACED rather than patched. An amendment is "the order now reads
 * this", not a sequence of edits to reconcile, and replacing them wholesale is
 * the only version that cannot leave a line nobody meant to keep.
 */
export const editPurchaseOrder: CommandDefinition<
  {
    orderId: string;
    reference?: string | null;
    gstApplicable?: boolean;
    lines?: Array<{
      productId: string;
      qtyOrdered: number;
      unitCostPaise?: number;
      discountBps?: number;
    }>;
  },
  { id: string; totalCostPaise: number }
> = {
  scopeHandling: "handler",
  key: "verity.trading.edit_purchase_order",
  entity: ENTITY_PURCHASE_ORDER,
  verb: "Edit",
  input: z.object({
    orderId: z.string().uuid(),
    reference: z.string().max(60).nullable().optional(),
    gstApplicable: z.boolean().optional(),
    lines: z
      .array(
        z.object({
          productId: z.string().uuid(),
          qtyOrdered: z.number().int().positive(),
          unitCostPaise: z.number().int().min(0).optional(),
          discountBps: z.number().int().min(0).max(10_000).optional(),
        }),
      )
      .min(1)
      .optional(),
  }),
  handler: async (ctx, input) => {
    const order = await ctx.tx.tradingPurchaseOrder.findUniqueOrThrow({
      where: { id: input.orderId },
      include: { lines: true },
    });

    if (order.state === "cancelled" || order.state === "completed") {
      throw new ValidationError(
        `E_VALIDATION: a ${order.state} order cannot be amended`,
      );
    }
    const received = order.lines.some((line) => line.qtyReceived > 0);

    // The GST switch is fixed once goods arrive. Flipping it after a receipt
    // would change the tax on a bill that may already exist, or silently
    // change what the NEXT partial receipt is billed at while the earlier one
    // keeps the old treatment -- one order, two tax stories.
    if (
      input.gstApplicable !== undefined &&
      input.gstApplicable !== order.gstApplicable &&
      received
    ) {
      throw new ValidationError(
        "E_VALIDATION: goods have already arrived against this order, so whether it " +
          "carries GST is now a fact about a bill. Raise a credit or debit note instead.",
      );
    }

    if (received && input.lines) {
      throw new ValidationError(
        "E_VALIDATION: goods have already arrived against this order, so its lines " +
          "describe something that happened. Cancel what is still owed instead, or " +
          "correct the difference on the bill.",
      );
    }

    await assertGodownInScope(
      ctx.tx,
      ctx.actor,
      ENTITY_PURCHASE_ORDER,
      "Edit",
      order.locationId,
    );

    let totalCostPaise = order.totalCostPaise;

    if (input.lines) {
      const products = await ctx.tx.tradingProduct.findMany({
        where: { id: { in: input.lines.map((line) => line.productId) }, active: true },
      });
      if (products.length !== new Set(input.lines.map((l) => l.productId)).size) {
        throw new ValidationError(
          "E_VALIDATION: a board on this order is unknown or withdrawn",
        );
      }
      assertNoTemplates(products);
      const negotiated = await ctx.tx.tradingSupplierPrice.findMany({
        where: { supplierId: order.supplierId },
      });

      const priced = input.lines.map((line) => {
        const product = products.find((p) => p.id === line.productId)!;
        const listUnitCostPaise =
          line.unitCostPaise ??
          negotiated.find((price) => price.productId === line.productId)
            ?.negotiatedCostPaise;
        if (listUnitCostPaise === undefined) {
          throw new ValidationError(
            `E_VALIDATION: no agreed price for ${product.name} with this supplier, and none given`,
          );
        }
        const discountBps = line.discountBps ?? 0;
        const unitCostPaise =
          discountBps === 0
            ? listUnitCostPaise
            : Math.round((listUnitCostPaise * (10_000 - discountBps)) / 10_000);
        return {
          tenantId: ctx.actor.tenantId,
          purchaseOrderId: order.id,
          productId: line.productId,
          productNameSnapshot: describeProduct(product),
          hsnCodeSnapshot: product.hsnCode,
          qtyOrdered: line.qtyOrdered,
          unitCostPaise,
          discountBps,
          listUnitCostPaise: discountBps === 0 ? null : listUnitCostPaise,
        };
      });

      await ctx.tx.tradingPurchaseOrderLine.deleteMany({
        where: { purchaseOrderId: order.id },
      });
      await ctx.tx.tradingPurchaseOrderLine.createMany({ data: priced });
      totalCostPaise = priced.reduce(
        (sum, line) => sum + line.qtyOrdered * line.unitCostPaise,
        0,
      );
    }

    await ctx.tx.tradingPurchaseOrder.update({
      where: { id: order.id },
      data: {
        ...(input.reference === undefined ? {} : { reference: input.reference }),
        ...(input.gstApplicable === undefined
          ? {}
          : { gstApplicable: input.gstApplicable }),
        totalCostPaise,
        version: { increment: 1 },
      },
    });

    return {
      result: { id: order.id, totalCostPaise },
      events: [
        { name: "verity.trading.purchase_order_edited", entityId: order.id },
      ],
    };
  },
};

/** The selling-side twin of `editPurchaseOrder`. Same rules, same reasoning. */
export const editSalesOrder: CommandDefinition<
  {
    orderId: string;
    reference?: string | null;
    paymentTerms?: "prepaid" | "credit";
    lines?: Array<{
      productId: string;
      qtyOrdered: number;
      unitPricePaise?: number;
      discountBps?: number;
    }>;
  },
  { id: string; totalPricePaise: number }
> = {
  scopeHandling: "handler",
  key: "verity.trading.edit_sales_order",
  entity: ENTITY_SALES_ORDER,
  verb: "Edit",
  input: z.object({
    orderId: z.string().uuid(),
    reference: z.string().max(60).nullable().optional(),
    paymentTerms: z.enum(["prepaid", "credit"]).optional(),
    lines: z
      .array(
        z.object({
          productId: z.string().uuid(),
          qtyOrdered: z.number().int().positive(),
          unitPricePaise: z.number().int().min(0).optional(),
          discountBps: z.number().int().min(0).max(10_000).optional(),
        }),
      )
      .min(1)
      .optional(),
  }),
  handler: async (ctx, input) => {
    const order = await ctx.tx.tradingSalesOrder.findUniqueOrThrow({
      where: { id: input.orderId },
      include: { lines: true },
    });

    if (order.state === "cancelled" || order.state === "completed") {
      throw new ValidationError(
        `E_VALIDATION: a ${order.state} order cannot be amended`,
      );
    }
    const issued = order.lines.some((line) => line.qtyShipped > 0);
    if (issued && input.lines) {
      throw new ValidationError(
        "E_VALIDATION: goods have already left against this order, so its lines " +
          "describe something that happened. Cancel what is still owed instead, or " +
          "correct the difference with a credit note.",
      );
    }
    // Stock is held against the CURRENT lines. Changing them under a live hold
    // would leave sheets reserved for quantities the order no longer asks for.
    const held = await ctx.tx.tradingStockReservation.count({
      where: { salesOrderId: order.id, releasedAt: null },
    });
    if (held > 0 && input.lines) {
      throw new ValidationError(
        "E_VALIDATION: stock is held against this order. Cancel the order to release " +
          "the hold, or amend it before holding stock.",
      );
    }

    await assertGodownInScope(
      ctx.tx,
      ctx.actor,
      ENTITY_SALES_ORDER,
      "Edit",
      order.locationId,
    );

    let totalPricePaise = order.totalPricePaise;

    if (input.lines) {
      const products = await ctx.tx.tradingProduct.findMany({
        where: { id: { in: input.lines.map((line) => line.productId) }, active: true },
      });
      if (products.length !== new Set(input.lines.map((l) => l.productId)).size) {
        throw new ValidationError(
          "E_VALIDATION: a board on this order is unknown or withdrawn",
        );
      }
      assertNoTemplates(products);
      const agreed = await ctx.tx.tradingCustomerPrice.findMany({
        where: { customerId: order.customerId },
      });

      const priced = input.lines.map((line) => {
        const product = products.find((p) => p.id === line.productId)!;
        const listUnitPricePaise =
          line.unitPricePaise ??
          agreed.find((price) => price.productId === line.productId)
            ?.customPricePaise;
        if (listUnitPricePaise === undefined) {
          throw new ValidationError(
            `E_VALIDATION: no price for ${product.name} for this customer, and none given`,
          );
        }
        const discountBps = line.discountBps ?? 0;
        const unitPricePaise =
          discountBps === 0
            ? listUnitPricePaise
            : Math.round((listUnitPricePaise * (10_000 - discountBps)) / 10_000);
        return {
          tenantId: ctx.actor.tenantId,
          salesOrderId: order.id,
          productId: line.productId,
          productNameSnapshot: describeProduct(product),
          hsnCodeSnapshot: product.hsnCode,
          qtyOrdered: line.qtyOrdered,
          unitPricePaise,
          discountBps,
          listUnitPricePaise: discountBps === 0 ? null : listUnitPricePaise,
        };
      });

      await ctx.tx.tradingSalesOrderLine.deleteMany({
        where: { salesOrderId: order.id },
      });
      await ctx.tx.tradingSalesOrderLine.createMany({ data: priced });
      totalPricePaise = priced.reduce(
        (sum, line) => sum + line.qtyOrdered * line.unitPricePaise,
        0,
      );
    }

    await ctx.tx.tradingSalesOrder.update({
      where: { id: order.id },
      data: {
        ...(input.reference === undefined ? {} : { reference: input.reference }),
        ...(input.paymentTerms === undefined
          ? {}
          : { paymentTerms: input.paymentTerms }),
        totalPricePaise,
        version: { increment: 1 },
      },
    });

    return {
      result: { id: order.id, totalPricePaise },
      events: [
        { name: "verity.trading.sales_order_edited", entityId: order.id },
      ],
    };
  },
};

export const receiveGoods: CommandDefinition<
  {
    orderId: string;
    rackId?: string;
    supplierChallanNumber?: string;
    notes?: string;
    lines: Array<{ productId: string; qtyReceived: number }>;
  },
  {
    id: string;
    state: string;
    receiptId: string;
    receiptNumber: string;
    /** The supplier bill this receipt raised, when it completed the order. */
    billing: { id: string; invoiceNumber: string; totalPaise: number } | null;
    /** Why no bill was raised, when one was due but could not be. */
    billingRefusal: string | null;
  }
> = {
  scopeHandling: "handler",
  key: "verity.trading.receive_goods",
  entity: ENTITY_PURCHASE_ORDER,
  verb: "ActionExecute",
  input: z.object({
    orderId: z.string().uuid(),
    rackId: z.string().uuid().optional(),
    /** The supplier's own delivery note, as written on the paper. */
    supplierChallanNumber: z.string().max(60).optional(),
    notes: z.string().max(500).optional(),
    lines: z
      .array(
        z.object({
          productId: z.string().uuid(),
          qtyReceived: z.number().int().positive(),
        }),
      )
      .min(1),
  }),
  handler: async (ctx, input) => {
    const order = await ctx.tx.tradingPurchaseOrder.findUniqueOrThrow({
      where: { id: input.orderId },
      include: { lines: true },
    });
    if (order.state === "draft") {
      throw new ValidationError(
        "E_VALIDATION: submit the order before receiving against it",
      );
    }
    if (order.state === "completed" || order.state === "cancelled") {
      throw new ValidationError("E_VALIDATION: that order is closed");
    }

    // Layer 2 on the write path: receiving into a godown is an action against
    // that godown, not merely against the order.
    await assertGodownInScope(
      ctx.tx,
      ctx.actor,
      ENTITY_PURCHASE_ORDER,
      "ActionExecute",
      order.locationId,
    );

    const services = await serviceProductIds(
      ctx.tx,
      input.lines.map((line) => line.productId),
    );

    // THE RECEIPT IS A DOCUMENT (audit P0-04, slice 3).
    //
    // It used to be an incremented field plus a stock movement pointing at
    // nothing. A receipt nobody can open, print, or match against a supplier
    // invoice is not a receipt; it is a side effect. Numbered gaplessly through
    // the same allocator invoices use, because a receipt is what a supplier
    // dispute turns on.
    const receivedAt = new Date();
    const financialYear = financialYearOf(receivedAt, await tenantZone(ctx.tx));
    const numbering = await nextDocumentNumber(
      ctx.tx,
      ctx.actor.tenantId,
      "GRN",
      financialYear,
    );

    const receipt = await ctx.tx.tradingGoodsReceipt.create({
      data: {
        tenantId: ctx.actor.tenantId,
        purchaseOrderId: order.id,
        locationId: order.locationId,
        receiptNumber: numbering.invoiceNumber,
        financialYear,
        supplierChallanNumber: input.supplierChallanNumber ?? null,
        receivedAt,
        receivedBy: ctx.actor.userId,
        notes: input.notes ?? null,
      },
    });

    for (const received of input.lines) {
      const line = order.lines.find(
        (candidate) => candidate.productId === received.productId,
      );
      if (!line) {
        throw new ValidationError(
          "E_VALIDATION: that board is not on this order",
        );
      }
      const outstanding = line.qtyOrdered - line.qtyReceived;
      if (received.qtyReceived > outstanding) {
        // Refused rather than clamped. An over-receipt is a real event that
        // needs the order amended: silently accepting it would make "what is
        // still owed" negative and every outstanding report inherit that.
        throw new ValidationError(
          `E_VALIDATION: ${line.productNameSnapshot} has ${outstanding} outstanding, cannot receive ${received.qtyReceived}`,
        );
      }

      await ctx.tx.tradingPurchaseOrderLine.update({
        where: { id: line.id },
        data: { qtyReceived: { increment: received.qtyReceived } },
      });

      // The receipt IS the stock movement — except for a service line, which
      // has no godown to land in. The order progress above is still real and
      // recorded; only the stock side of it is skipped.
      if (services.has(received.productId)) continue;

      await applyMovement(ctx.tx, ctx.actor, {
        productId: received.productId,
        locationId: order.locationId,
        rackId: input.rackId ?? null,
        kind: "purchase_inward",
        qtyUnits: received.qtyReceived,
        unitCostPaise: line.unitCostPaise,
        // The movement now says what caused it. This is what makes the
        // specification's §13 possible: open a quantity, see the receipt.
        source: {
          type: "goods_receipt",
          id: receipt.id,
          number: receipt.receiptNumber,
        },
      });
    }

    // Written after the movements so a refused over-receipt leaves no line
    // behind. The whole handler is one transaction, so this is about reading
    // order rather than durability.
    await ctx.tx.tradingGoodsReceiptLine.createMany({
      data: input.lines.map((received) => {
        const line = order.lines.find(
          (candidate) => candidate.productId === received.productId,
        )!;
        return {
          tenantId: ctx.actor.tenantId,
          receiptId: receipt.id,
          purchaseOrderLineId: line.id,
          productId: received.productId,
          productNameSnapshot: line.productNameSnapshot,
          rackId: input.rackId ?? null,
          qtyReceived: received.qtyReceived,
          unitCostPaise: line.unitCostPaise,
        };
      }),
    });

    const after = await ctx.tx.tradingPurchaseOrderLine.findMany({
      where: { purchaseOrderId: order.id },
    });
    const complete = after.every((line) => line.qtyReceived >= line.qtyOrdered);
    const target = complete ? "completed" : "receiving";

    const stateEvents = [];
    if (order.state !== target) {
      const moved = await transition(ctx, {
        entityKey: ENTITY_PURCHASE_ORDER,
        entityId: order.id,
        fromKey: order.state,
        toKey: target,
      });
      await ctx.tx.tradingPurchaseOrder.update({
        where: { id: order.id },
        data: { state: target, version: { increment: 1 } },
      });
      stateEvents.push(moved.event);
    }

    // THE MONEY SIDE, WITHOUT ANYONE ASKING FOR IT (Task 71 item 7).
    //
    // The goods are here, so the money is owed. Raised at completion rather
    // than at every receipt because an order carries one invoice and an invoice
    // is immutable; until then the delivered value shows on the payables view
    // as received-not-yet-billed, which is what it is.
    //
    // A failure here does NOT roll back the receipt. Stock arriving is a
    // physical fact and the warehouse must be able to record it even when the
    // supplier is missing a state code or no tax rate is configured. The reason
    // is returned instead, so the desk can say why no bill exists rather than
    // leaving the buyer to notice its absence.
    let billing: {
      id: string;
      invoiceNumber: string;
      totalPaise: number;
    } | null = null;
    let billingRefusal: string | null = null;
    if (complete) {
      try {
        const bill = await issueProvisionalPurchaseBill(ctx, order.id);
        if (bill) billing = bill;
      } catch (error) {
        if (error instanceof ValidationError) {
          billingRefusal = error.message;
        } else {
          throw error;
        }
      }
    }

    return {
      result: {
        id: order.id,
        state: target,
        receiptId: receipt.id,
        receiptNumber: receipt.receiptNumber,
        billing,
        billingRefusal,
      },
      events: [
        ...stateEvents,
        {
          name: complete
            ? "verity.trading.purchase_order_completed"
            : "verity.trading.goods_partially_received",
          entityId: order.id,
          payload: { receiptNumber: receipt.receiptNumber },
        },
        ...(billing
          ? [
              {
                name: "verity.trading.purchase_bill_raised",
                entityId: order.id,
                payload: { invoiceNumber: billing.invoiceNumber },
              },
            ]
          : []),
      ],
    };
  },
};

export const cancelPurchaseOrder: CommandDefinition<
  { orderId: string; reason: string },
  { id: string }
> = {
  impact: "destructive",
  key: "verity.trading.cancel_purchase_order",
  entity: ENTITY_PURCHASE_ORDER,
  verb: "ActionExecute",
  input: z.object({
    orderId: z.string().uuid(),
    reason: z.string().min(3).max(400),
  }),
  handler: async (ctx, input) => {
    const order = await ctx.tx.tradingPurchaseOrder.findUniqueOrThrow({
      where: { id: input.orderId },
    });
    await transition(ctx, {
      entityKey: ENTITY_PURCHASE_ORDER,
      entityId: order.id,
      fromKey: order.state,
      toKey: "cancelled",
    });
    await ctx.tx.tradingPurchaseOrder.update({
      where: { id: order.id },
      data: { state: "cancelled", version: { increment: 1 } },
    });
    await recordActivity(ctx, {
      entityKey: ENTITY_PURCHASE_ORDER,
      entityId: input.orderId,
      commandKey: "verity.trading.cancel_purchase_order",
      changes: diffFields({ cancelReason: "" }, { cancelReason: input.reason }),
    });
    return {
      result: { id: input.orderId },
      events: [
        {
          name: "verity.trading.purchase_order_cancelled",
          entityId: input.orderId,
        },
      ],
    };
  },
};

/* =============================== sales side =============================== */

/**
 * What a customer already owes plus what they are about to.
 *
 * Until the finance stage exists there are no invoices, so exposure is the value
 * of their open orders. Stage 6 adds invoiced-and-unpaid to the same function
 * rather than introducing a second notion of "owed" beside it — which is the
 * mistake P3 exists to prevent.
 */
/**
 * What this customer currently owes us, plus what we have committed to supply
 * them and not yet billed.
 *
 * Authority: taskplans/archive/45_plywood_workflow_program.md §4.1 — the single
 * canonical formula. Any second definition of exposure anywhere in this
 * capability is a defect.
 *
 * ```text
 * exposure = unallocated_receivables + approved_uninvoiced_commitments
 * ```
 *
 * THE DEFECT THIS REPLACES (audit P0-02)
 * The previous implementation summed open orders and nothing else, and
 * dispatch moved an order to `completed`. So the moment goods left the
 * godown the customer's exposure fell to zero — while they still owed the
 * whole invoice. The next order then passed a credit check it should have
 * failed. Exposure fell precisely when the business's risk was highest.
 *
 * The three properties that must hold, and why each term is shaped as it is:
 *
 *   1. Issuing goods must not reduce exposure. It does not: the commitment
 *      converts into a receivable when the invoice is raised, and the
 *      receivable clears only when a payment is allocated against it.
 *   2. Nothing is counted twice. An order that has been invoiced contributes
 *      through its receivable; subtracting the invoiced value from the
 *      commitment is what stops it also contributing as a commitment.
 *   3. A draft order is not a commitment. Only an order the business has
 *      actually approved constrains further credit.
 *
 * Advances reduce exposure only once allocated. A disputed invoice is NOT
 * excluded — a dispute is not a payment.
 */
export async function customerExposurePaise(tx: TenantScopedClient, customerId: string): Promise<number> {
  return (await customerExposuresPaise(tx, [customerId])).get(customerId) ?? 0;
}

/** Three set-wise reads, independent of the number of customers. */
export async function customerExposuresPaise(
  tx: TenantScopedClient, customerIds: string[],
): Promise<Map<string, number>> {
  const exposure = new Map(customerIds.map((id) => [id, 0]));
  if (customerIds.length === 0) return exposure;
  const invoices = await tx.tradingInvoice.findMany({
    where: { customerId: { in: customerIds } },
    select: {
      customerId: true, totalPaise: true,
      allocations: { select: { amountPaise: true } },
      notes: { select: { noteType: true, totalPaise: true } },
    },
  });
  for (const invoice of invoices) {
    if (!invoice.customerId) continue;
    const paid = invoice.allocations.reduce((sum, allocation) => sum + allocation.amountPaise, 0);
    const adjustment = invoice.notes.reduce((sum, note) =>
      sum + (note.noteType === "debit" ? note.totalPaise : -note.totalPaise), 0);
    exposure.set(invoice.customerId, (exposure.get(invoice.customerId) ?? 0) +
      Math.max(0, invoice.totalPaise + adjustment - paid));
  }
  const orders = await tx.tradingSalesOrder.findMany({
    where: { customerId: { in: customerIds }, state: { in: [...COMMITTED_ORDER_STATES] } },
    select: { id: true, customerId: true, totalPricePaise: true },
  });
  const invoicedByOrder = new Map<string, number>();
  if (orders.length) {
    const raised = await tx.tradingInvoice.findMany({
      where: { salesOrderId: { in: orders.map((order) => order.id) } },
      select: { salesOrderId: true, totalPaise: true },
    });
    for (const invoice of raised) {
      if (invoice.salesOrderId) invoicedByOrder.set(invoice.salesOrderId,
        (invoicedByOrder.get(invoice.salesOrderId) ?? 0) + invoice.totalPaise);
    }
  }
  for (const order of orders) {
    exposure.set(order.customerId, (exposure.get(order.customerId) ?? 0) +
      Math.max(0, order.totalPricePaise - (invoicedByOrder.get(order.id) ?? 0)));
  }
  return exposure;
}

/**
 * Order states in which the business has committed to supply.
 *
 * `draft` is excluded (nothing promised) and so is `cancelled` (promise
 * withdrawn). `completed` IS included: a completed order whose invoice is
 * unpaid still represents money owed, and it is the subtraction of the
 * invoiced amount — not the order's state — that prevents double counting.
 */
export const COMMITTED_ORDER_STATES = [
  "pending_credit",
  "approved",
  "dispatching",
  "completed",
] as const;

export const createSalesOrder: CommandDefinition<
  {
    customerId: string;
    locationId: string;
    reference?: string;
    lines: Array<{
      productId: string;
      qtyOrdered: number;
      unitPricePaise?: number;
      discountBps?: number;
    }>;
    /** No GST on this supply, with the ground for it. */
    taxExempt?: boolean;
    taxExemptReason?: string;
    /** `prepaid` when the money is already in hand; `credit` when it is owed. */
    paymentTerms?: "prepaid" | "credit";
  },
  { id: string; totalPricePaise: number; state: string }
> = {
  scopeHandling: "handler",
  key: "verity.trading.create_sales_order",
  entity: ENTITY_SALES_ORDER,
  verb: "Create",
  input: z.object({
    customerId: z.string().uuid(),
    locationId: z.string().uuid(),
    reference: z.string().max(60).optional(),
    lines: z
      .array(
        z.object({
          productId: z.string().uuid(),
          qtyOrdered: z.number().int().positive(),
          unitPricePaise: z.number().int().min(0).optional(),
          /** Basis points off the unit price. See the purchase-order note. */
          discountBps: z.number().int().min(0).max(10_000).optional(),
        }),
      )
      .min(1),
    taxExempt: z.boolean().optional(),
    // Three characters is not a justification, but it stops an empty box being
    // submitted out of habit; the rest is a judgement no schema can make.
    taxExemptReason: z.string().min(3).max(200).optional(),
    paymentTerms: z.enum(["prepaid", "credit"]).optional(),
  }),
  preconditions: async (ctx, input) => {
    if (input.taxExempt && !input.taxExemptReason?.trim()) {
      throw new ValidationError(
        "E_VALIDATION: an order with no GST needs a reason — a zero-tax invoice " +
          "with no stated ground cannot be told apart from an under-declared one",
      );
    }
    const customer = await ctx.tx.tradingCustomer.findUnique({
      where: { id: input.customerId },
    });
    if (!customer)
      throw new ValidationError(
        "E_VALIDATION: customer not found in this tenant",
      );
    if (!customer.active)
      throw new ValidationError("E_VALIDATION: that customer is inactive");
    const godown = await ctx.tx.location.findUnique({
      where: { id: input.locationId },
    });
    if (!godown)
      throw new ValidationError(
        "E_VALIDATION: godown not found in this tenant",
      );
  },
  handler: async (ctx, input) => {
    const products = await ctx.tx.tradingProduct.findMany({
      where: {
        id: { in: input.lines.map((line) => line.productId) },
        active: true,
      },
    });
    if (
      products.length !==
      new Set(input.lines.map((line) => line.productId)).size
    ) {
      throw new ValidationError(
        "E_VALIDATION: a board on this order is unknown or withdrawn",
      );
    }
    assertNoTemplates(products);

    const agreed = await ctx.tx.tradingCustomerPrice.findMany({
      where: { customerId: input.customerId },
    });

    const priced = input.lines.map((line) => {
      const product = products.find(
        (candidate) => candidate.id === line.productId,
      )!;
      const customerPrice = agreed.find(
        (price) => price.productId === line.productId,
      );
      const listUnitPricePaise =
        line.unitPricePaise ?? customerPrice?.customPricePaise;
      if (listUnitPricePaise === undefined) {
        throw new ValidationError(
          `E_VALIDATION: no price for ${product.name} for this customer, and none given`,
        );
      }
      // Applied once; `unitPricePaise` is the net. The credit check below, the
      // invoice, the margin report and the ledger all read that one field, so
      // the discount reaches every one of them without any of them knowing it
      // exists.
      const discountBps = line.discountBps ?? 0;
      const unitPricePaise =
        discountBps === 0
          ? listUnitPricePaise
          : Math.round((listUnitPricePaise * (10_000 - discountBps)) / 10_000);
      return {
        productId: line.productId,
        productNameSnapshot: describeProduct(product),
        hsnCodeSnapshot: product.hsnCode,
        qtyOrdered: line.qtyOrdered,
        unitPricePaise,
        discountBps,
        listUnitPricePaise: discountBps === 0 ? null : listUnitPricePaise,
      };
    });

    const totalPricePaise = priced.reduce(
      (sum, line) => sum + line.qtyOrdered * line.unitPricePaise,
      0,
    );


    // Layer 2 on the write path (P0-01): the same rule for selling out of a
    // godown as for buying into one.
    await assertGodownInScope(
      ctx.tx,
      ctx.actor,
      ENTITY_SALES_ORDER,
      "Create",
      input.locationId,
    );

    const order = await ctx.tx.tradingSalesOrder.create({
      data: {
        tenantId: ctx.actor.tenantId,
        customerId: input.customerId,
        locationId: input.locationId,
        reference:
          input.reference ??
          (await orderNumber(ctx.tx, ctx.actor.tenantId, "SO", new Date())),
        totalPricePaise,
        paymentTerms: input.paymentTerms ?? "credit",
        taxExempt: input.taxExempt ?? false,
        taxExemptReason: input.taxExempt
          ? (input.taxExemptReason?.trim() ?? null)
          : null,
      },
    });

    // Separately, for the same reason as a purchase order's lines.
    await ctx.tx.tradingSalesOrderLine.createMany({
      data: priced.map((line) => ({
        ...line,
        tenantId: ctx.actor.tenantId,
        salesOrderId: order.id,
      })),
    });

    // Every order is approved. The credit gate it used to pass through held an
    // order until somebody with authority released it, which in a yard where
    // the proprietor takes the order is a step performed on oneself. What the
    // business actually needs to know is whether the money is in hand, and that
    // is `paymentTerms` — recorded, not gated.
    const target = "approved";
    await transition(ctx, {
      entityKey: ENTITY_SALES_ORDER,
      entityId: order.id,
      fromKey: order.state,
      toKey: target,
    });
    await ctx.tx.tradingSalesOrder.update({
      where: { id: order.id },
      data: { state: target, version: { increment: 1 } },
    });


    // The credit-approval notification is gone with the gate that produced it.
    // Nobody is being asked to release an order any more, so there is nothing
    // to tell them.

    return {
      result: { id: order.id, totalPricePaise, state: target },
      events: [
        { name: "verity.trading.sales_order_created", entityId: order.id },
      ],
    };
  },
};

export const approveCredit: CommandDefinition<
  { orderId: string; reason: string },
  { id: string }
> = {
  key: "verity.trading.approve_credit",
  entity: ENTITY_SALES_ORDER,
  verb: "ActionExecute",
  input: z.object({
    orderId: z.string().uuid(),
    reason: z.string().min(3).max(400),
  }),
  handler: async (ctx, input) => {
    const order = await ctx.tx.tradingSalesOrder.findUniqueOrThrow({
      where: { id: input.orderId },
    });
    await transition(ctx, {
      entityKey: ENTITY_SALES_ORDER,
      entityId: order.id,
      fromKey: order.state,
      toKey: "approved",
    });
    await ctx.tx.tradingSalesOrder.update({
      where: { id: order.id },
      data: { state: "approved", version: { increment: 1 } },
    });
    // Overriding a credit limit is exactly the decision someone asks about
    // after a bad debt, so the reason is mandatory and recorded.
    await recordActivity(ctx, {
      entityKey: ENTITY_SALES_ORDER,
      entityId: input.orderId,
      commandKey: "verity.trading.approve_credit",
      changes: diffFields(
        { creditOverrideReason: "" },
        { creditOverrideReason: input.reason },
      ),
    });
    return {
      result: { id: input.orderId },
      events: [
        { name: "verity.trading.credit_approved", entityId: input.orderId },
      ],
    };
  },
};

/**
 * Available = on hand − live reservations, for one board in one godown.
 *
 * Exported because the reservation command and the availability query must agree
 * on the definition; two implementations of "available" is how a business ends up
 * promising the same forty sheets twice.
 */
/**
 * Serializes concurrent reservation of the same product in the same godown.
 *
 * Authority: audit P0-06. Availability was read without a lock, so two
 * requests could both see 40 available and both reserve 40 — overselling stock
 * that physically exists once.
 *
 * A transaction-scoped advisory lock rather than `SELECT ... FOR UPDATE`,
 * because the row that would be locked is the `stock_balance`, and for a
 * product that has never moved in this godown **there is no such row** — the
 * very case where two concurrent first reservations race. An advisory key
 * exists whether or not the row does.
 *
 * Released automatically at commit or rollback; nothing can leak a lock.
 */
async function lockAvailability(
  tx: TenantScopedClient,
  productId: string,
  locationId: string,
): Promise<void> {
  // `$executeRaw`, not `$queryRaw`: pg_advisory_xact_lock returns void and the
  // client cannot deserialize a void column.
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`${productId}:${locationId}`}, 0)
    )`;
}

export async function availableUnits(
  tx: TenantScopedClient,
  productId: string,
  locationId: string,
  /**
   * Take the lock first. Required by any caller that is about to *consume*
   * what it reads; a read for display does not need it and should not pay for
   * it.
   */
  options: { forUpdate?: boolean } = {},
): Promise<{
  onHandUnits: number;
  reservedUnits: number;
  availableUnits: number;
}> {
  if (options.forUpdate) await lockAvailability(tx, productId, locationId);
  const balance = await tx.stockBalance.findFirst({
    where: { productId, locationId },
  });
  const held = await tx.tradingStockReservation.aggregate({
    where: { productId, locationId, releasedAt: null },
    _sum: { qtyUnits: true },
  });
  const onHandUnits = balance?.qtyUnits ?? 0;
  const reservedUnits = held._sum.qtyUnits ?? 0;
  return {
    onHandUnits,
    reservedUnits,
    availableUnits: onHandUnits - reservedUnits,
  };
}

/**
 * WHERE AN ORDER'S STOCK WOULD COME FROM.
 *
 * REPORTED: an order for 100 sheets against a godown holding 55 was refused
 * outright, even though the other godown held the rest. The refusal named the
 * other godown, which was already better than the "0 available" it used to
 * say, but it still left a salesperson to work out the split by hand and then
 * transfer stock to make it true.
 *
 * So the split is worked out here, and the rule is the client's own:
 *
 *   Take from the order's own godown first. Take the remainder from another.
 *   If more than one other godown could supply that remainder, ASK which --
 *   do not pick. Repeat until the line is filled or the stock runs out.
 *
 * "Ask, do not pick" is the whole point. Two godowns holding enough is not an
 * ambiguity the system can resolve: which one to empty is a question about
 * what else is coming, who collects from where, and which van is going that
 * way — none of which is in the database. Choosing the fullest one would be a
 * guess wearing the clothes of a decision.
 *
 * A choice is only raised when it is real. One candidate godown is not a
 * choice, and neither is a set of godowns that must ALL be drained to fill the
 * line — there is nothing to decide when every option is taken anyway.
 *
 * READ-ONLY. This plans; `reserveForOrder` writes, re-reads under lock, and is
 * free to disagree with a plan that has gone stale.
 */
export type AllocationStep = {
  locationId: string;
  locationName: string;
  qtyUnits: number;
};

export type AllocationLinePlan = {
  productId: string;
  name: string;
  qtyOrdered: number;
  /** A service holds nothing; the plan says so rather than showing 0 free. */
  isService: boolean;
  /** What the rule decides on its own, in the order it would draw. */
  steps: AllocationStep[];
  /**
   * Set when the remainder could come from more than one godown and the
   * person has to say which. `steps` then holds only what was NOT in doubt,
   * and `qtyToChoose` is what is still unplaced.
   */
  choice: {
    qtyToChoose: number;
    candidates: Array<{
      locationId: string;
      locationName: string;
      availableUnits: number;
    }>;
  } | null;
  /** Still unfilled once every reachable godown is counted. */
  shortfallUnits: number;
};

export async function planOrderAllocation(
  tx: TenantScopedClient,
  actor: ActorContext,
  order: {
    locationId: string;
    lines: Array<{
      productId: string;
      productNameSnapshot: string;
      qtyOrdered: number;
    }>;
  },
): Promise<AllocationLinePlan[]> {
  const services = await serviceProductIds(
    tx,
    order.lines.map((line) => line.productId),
  );
  const reachable = await reachableGodownIds(tx, actor, ENTITY_STOCK_BALANCE);
  // The order's own godown leads whether or not it is reachable through the
  // scope query -- it is the godown the order was raised against, and a
  // salesperson who may raise the order may draw from it.
  const godownIds = [
    order.locationId,
    ...reachable.filter((id) => id !== order.locationId),
  ];
  const locations = await tx.location.findMany({
    where: { id: { in: godownIds } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(locations.map((row) => [row.id, row.name]));

  const plans: AllocationLinePlan[] = [];
  for (const line of order.lines) {
    if (services.has(line.productId)) {
      plans.push({
        productId: line.productId,
        name: line.productNameSnapshot,
        qtyOrdered: line.qtyOrdered,
        isService: true,
        steps: [],
        choice: null,
        shortfallUnits: 0,
      });
      continue;
    }

    const free: AllocationStep[] = [];
    for (const locationId of godownIds) {
      const { availableUnits: qty } = await availableUnits(
        tx,
        line.productId,
        locationId,
      );
      if (qty > 0) {
        free.push({
          locationId,
          locationName: nameOf.get(locationId) ?? "Godown",
          qtyUnits: qty,
        });
      }
    }

    const steps: AllocationStep[] = [];
    let outstanding = line.qtyOrdered;
    let choice: AllocationLinePlan["choice"] = null;

    // The order's own godown first, in full, without being asked -- it is
    // where the order already said the goods would come from.
    const here = free.find((row) => row.locationId === order.locationId);
    if (here) {
      const take = Math.min(here.qtyUnits, outstanding);
      steps.push({ ...here, qtyUnits: take });
      outstanding -= take;
    }

    const elsewhere = free
      .filter((row) => row.locationId !== order.locationId)
      .sort((a, b) => b.qtyUnits - a.qtyUnits);

    while (outstanding > 0 && elsewhere.length > 0) {
      const total = elsewhere.reduce((sum, row) => sum + row.qtyUnits, 0);
      // Every remaining godown is needed, so which to draw from first is not a
      // decision anybody has to make. Draw from all of them.
      if (total <= outstanding) {
        for (const row of elsewhere) {
          steps.push(row);
          outstanding -= row.qtyUnits;
        }
        elsewhere.length = 0;
        break;
      }
      // One godown covers what is left, and it is the only one that does --
      // still not a choice.
      const sufficient = elsewhere.filter((row) => row.qtyUnits >= outstanding);
      if (sufficient.length === 1 && elsewhere.length === 1) {
        steps.push({ ...sufficient[0]!, qtyUnits: outstanding });
        outstanding = 0;
        break;
      }
      // A genuine choice. Stop planning this line and hand the question back.
      choice = {
        qtyToChoose: outstanding,
        candidates: elsewhere.map((row) => ({
          locationId: row.locationId,
          locationName: row.locationName,
          availableUnits: row.qtyUnits,
        })),
      };
      break;
    }

    plans.push({
      productId: line.productId,
      name: line.productNameSnapshot,
      qtyOrdered: line.qtyOrdered,
      isService: false,
      steps,
      choice,
      shortfallUnits: choice ? 0 : outstanding,
    });
  }
  return plans;
}

export const allocationPlan: QueryDefinition<
  { orderId: string },
  {
    orderId: string;
    locationId: string;
    locationName: string;
    /** True when nothing needs asking and the plan can simply be submitted. */
    settled: boolean;
    lines: AllocationLinePlan[];
  } | null
> = {
  key: "verity.trading.allocation_plan",
  entity: ENTITY_STOCK_BALANCE,
  input: z.object({ orderId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const order = await ctx.tx.tradingSalesOrder.findUnique({
      where: { id: input.orderId },
      include: { lines: true, location: { select: { name: true } } },
    });
    if (!order) return null;

    const lines = await planOrderAllocation(ctx.tx, ctx.actor, order);
    return {
      orderId: order.id,
      locationId: order.locationId,
      locationName: order.location.name,
      settled: lines.every(
        (line) => line.choice === null && line.shortfallUnits === 0,
      ),
      lines,
    };
  },
};

/**
 * Holds stock against an approved order, across as many godowns as it takes.
 *
 * `allocations` is what the person decided, when there was anything to decide
 * -- see `planOrderAllocation` for the rule and for why a real choice is asked
 * rather than guessed. Omitted, this command runs that same planner itself and
 * proceeds only if it settles with nothing to ask; a caller with no screen
 * (a test, a script, the API) therefore gets the automatic split for free and
 * an explicit refusal when a human judgement is genuinely required.
 *
 * The plan is advisory. Everything is re-read here under `forUpdate`, because
 * between planning and reserving another order can take the last sheet, and a
 * hold granted against a stale read is a promise the godown cannot keep.
 */
export const reserveForOrder: CommandDefinition<
  {
    orderId: string;
    allocations?: Array<{
      productId: string;
      locationId: string;
      qtyUnits: number;
    }>;
  },
  {
    reserved: Array<{
      productId: string;
      qtyUnits: number;
      /** Where it was held. More than one row per product is normal now. */
      locationId: string;
    }>;
  }
> = {
  key: "verity.trading.reserve_for_order",
  entity: ENTITY_RESERVATION,
  verb: "Create",
  input: z.object({
    orderId: z.string().uuid(),
    allocations: z
      .array(
        z.object({
          productId: z.string().uuid(),
          locationId: z.string().uuid(),
          qtyUnits: z.number().int().positive(),
        }),
      )
      .optional(),
  }),
  handler: async (ctx, input) => {
    const order = await ctx.tx.tradingSalesOrder.findUniqueOrThrow({
      where: { id: input.orderId },
      include: { lines: true, reservations: { where: { releasedAt: null } } },
    });
    if (order.state !== "approved") {
      throw new ValidationError(
        "E_VALIDATION: only an approved order can hold stock",
      );
    }
    if (order.reservations.length > 0) {
      throw new ValidationError("E_VALIDATION: this order already holds stock");
    }

    const services = await serviceProductIds(
      ctx.tx,
      order.lines.map((line) => line.productId),
    );

    // What to hold, and from where. Either the caller decided it, or the
    // planner did -- and if the planner could not, because a genuine choice
    // was open, the command refuses and says what the choice is rather than
    // making it.
    let allocations = input.allocations;
    if (!allocations) {
      const plan = await planOrderAllocation(ctx.tx, ctx.actor, order);
      const undecided = plan.find((line) => line.choice !== null);
      if (undecided) {
        const options = undecided.choice!.candidates
          .map((row) => `${row.locationName} has ${row.availableUnits}`)
          .join("; ");
        throw new ValidationError(
          `E_VALIDATION: ${undecided.name} still needs ${undecided.choice!.qtyToChoose} ` +
            `and more than one godown could supply them (${options}). ` +
            "Choose which godown to draw from.",
        );
      }
      const short = plan.find((line) => line.shortfallUnits > 0);
      if (short) {
        const held = short.steps
          .map((step) => `${step.locationName} has ${step.qtyUnits}`)
          .join("; ");
        // The whole hold fails rather than reserving what it can. A partial
        // hold on a multi-line order is a promise the business cannot keep and
        // would discover at dispatch.
        throw new ValidationError(
          `E_VALIDATION: ${short.name} is short by ${short.shortfallUnits} of the ` +
            `${short.qtyOrdered} ordered across every godown you can draw from` +
            (held ? ` (${held})` : "") +
            ". Raise a purchase order, or reduce the line.",
        );
      }
      allocations = plan.flatMap((line) =>
        line.steps.map((step) => ({
          productId: line.productId,
          locationId: step.locationId,
          qtyUnits: step.qtyUnits,
        })),
      );
    }

    const wanted = new Map(
      order.lines.map((line) => [line.productId, line.qtyOrdered]),
    );
    const allocatedBy = new Map<string, number>();
    for (const row of allocations) {
      if (!wanted.has(row.productId)) {
        throw new ValidationError(
          "E_VALIDATION: an allocation names a product that is not on this order",
        );
      }
      allocatedBy.set(
        row.productId,
        (allocatedBy.get(row.productId) ?? 0) + row.qtyUnits,
      );
    }

    const reserved: Array<{
      productId: string;
      qtyUnits: number;
      locationId: string;
    }> = [];

    for (const line of order.lines) {
      // A service line has nothing to hold — `availableUnits` would always
      // read 0 for it (no stock_balance row exists), refusing every order
      // that includes one. Skip straight to counting it reserved.
      if (services.has(line.productId)) {
        reserved.push({
          productId: line.productId,
          qtyUnits: line.qtyOrdered,
          locationId: order.locationId,
        });
        continue;
      }

      // Exactly the ordered quantity, no more and no less. Under is a hold
      // that will not fill the order; over quietly takes stock a second order
      // is counting on.
      const allocated = allocatedBy.get(line.productId) ?? 0;
      if (allocated !== line.qtyOrdered) {
        throw new ValidationError(
          `E_VALIDATION: ${line.productNameSnapshot} needs ${line.qtyOrdered} held, ` +
            `but ${allocated} were allocated across the godowns given`,
        );
      }
    }

    for (const row of allocations) {
      const line = order.lines.find(
        (candidate) => candidate.productId === row.productId,
      )!;
      if (services.has(row.productId)) continue;

      // forUpdate: this read decides a write. Without the lock two orders can
      // both reserve the last sheet (audit P0-06). Re-read here rather than
      // trusted from the plan, which was made without a lock and may be a
      // minute old.
      const { availableUnits: free } = await availableUnits(
        ctx.tx,
        row.productId,
        row.locationId,
        { forUpdate: true },
      );
      if (free < row.qtyUnits) {
        const where = await ctx.tx.location.findUnique({
          where: { id: row.locationId },
          select: { name: true },
        });
        throw new ValidationError(
          `E_VALIDATION: ${line.productNameSnapshot} has ${free} available in ` +
            `${where?.name ?? "that godown"}, so ${row.qtyUnits} cannot be reserved ` +
            "from it. Someone else may have taken it — plan the hold again.",
        );
      }

      await ctx.tx.tradingStockReservation.create({
        data: {
          tenantId: ctx.actor.tenantId,
          productId: row.productId,
          locationId: row.locationId,
          salesOrderId: order.id,
          qtyUnits: row.qtyUnits,
        },
      });
      reserved.push({
        productId: row.productId,
        qtyUnits: row.qtyUnits,
        locationId: row.locationId,
      });
    }

    await transition(ctx, {
      entityKey: ENTITY_SALES_ORDER,
      entityId: order.id,
      fromKey: order.state,
      toKey: "dispatching",
    });
    await ctx.tx.tradingSalesOrder.update({
      where: { id: order.id },
      data: { state: "dispatching", version: { increment: 1 } },
    });

    // REQ-EXPERIENCE-DESIGNSYSTEM-024 — stock is held; whoever dispatches is
    // the next actor and needs telling now, not on next reopening the order.
    const dispatchers = await notifyPermissionHolders(ctx, ENTITY_SALES_ORDER);
    if (dispatchers.length > 0) {
      await notify(ctx.tx, {
        tenantId: ctx.actor.tenantId,
        recipientIds: dispatchers,
        key: "verity.trading.stock_reserved",
        entityKey: ENTITY_SALES_ORDER,
        entityId: order.id,
        variables: { reference: order.reference ?? order.id.slice(0, 8) },
        fallback: {
          subject: `Order ${order.reference ?? order.id.slice(0, 8)} ready to dispatch`,
          body: "Stock is held against this order and ready to dispatch.",
        },
      });
    }

    return {
      result: { reserved },
      events: [{ name: "verity.trading.stock_reserved", entityId: order.id }],
    };
  },
};

/**
 * Material physically leaves the godown.
 *
 * Authority: taskplans/archive/45_plywood_workflow_program.md §5;
 * PLYWOOD_TARGET_WORKFLOW_GAP_AUDIT.md P0-04; specification §45–§47.
 *
 * WHAT THIS REPLACES
 * `dispatchOrder` moved every remaining line at once, released every hold and
 * completed the order in one step. Three things followed from that: a partial
 * issue was impossible, nothing recorded who handed the material over, and an
 * invoice could be raised for the quantity ORDERED rather than the quantity
 * that actually left the yard.
 *
 * The old key is kept — `verity.trading.dispatch_order` — because it is what
 * the existing screens and journeys call, and a rename is a migration of every
 * caller for no behavioural gain. The vocabulary in the result and the events
 * is the specification's.
 *
 * PARTIAL BY DEFAULT
 * `lines` is optional. Omitted, it issues everything outstanding, which is what
 * the old command did and what most orders need. Given, it issues exactly what
 * is named — and the order stays open until the balance follows.
 */
export const dispatchOrder: CommandDefinition<
  {
    orderId: string;
    rackId?: string;
    collectedBy?: string;
    notes?: string;
    /** Omit to issue everything outstanding. */
    lines?: Array<{ productId: string; qtyIssued: number }>;
  },
  {
    id: string;
    state: string;
    issueId: string;
    issueNumber: string;
    issuedFrom: Array<{ id: string; issueNumber: string; locationId: string }>;
    issuedLines: number;
    /** The invoice this issue raised, when it fulfilled the order. */
    invoicing: {
      id: string;
      invoiceNumber: string;
      totalPaise: number;
      interState: boolean;
    } | null;
    /** Why no invoice was raised, when one was due but could not be. */
    invoicingRefusal: string | null;
  }
> = {
  scopeHandling: "handler",
  key: "verity.trading.dispatch_order",
  entity: ENTITY_SALES_ORDER,
  verb: "ActionExecute",
  input: z.object({
    orderId: z.string().uuid(),
    rackId: z.string().uuid().optional(),
    collectedBy: z.string().max(120).optional(),
    notes: z.string().max(500).optional(),
    lines: z
      .array(
        z.object({
          productId: z.string().uuid(),
          qtyIssued: z.number().int().positive(),
        }),
      )
      .min(1)
      .optional(),
  }),
  handler: async (ctx, input) => {
    const order = await ctx.tx.tradingSalesOrder.findUniqueOrThrow({
      where: { id: input.orderId },
      include: { lines: true, reservations: { where: { releasedAt: null } } },
    });
    if (order.state !== "dispatching") {
      throw new ValidationError(
        "E_VALIDATION: hold stock for this order before issuing it",
      );
    }

    await assertGodownInScope(
      ctx.tx,
      ctx.actor,
      ENTITY_SALES_ORDER,
      "ActionExecute",
      order.locationId,
    );

    const services = await serviceProductIds(
      ctx.tx,
      order.lines.map((line) => line.productId),
    );

    // What to issue: exactly what was asked for, or everything outstanding.
    const requested =
      input.lines ??
      order.lines
        .filter((line) => line.qtyOrdered > line.qtyShipped)
        .map((line) => ({
          productId: line.productId,
          qtyIssued: line.qtyOrdered - line.qtyShipped,
        }));

    if (requested.length === 0) {
      throw new ValidationError(
        "E_VALIDATION: this order has nothing left to issue",
      );
    }

    const issuedAt = new Date();
    const financialYear = financialYearOf(issuedAt, await tenantZone(ctx.tx));
    const numbering = await nextDocumentNumber(
      ctx.tx,
      ctx.actor.tenantId,
      "GI",
      financialYear,
    );

    // ONE GATE PASS PER GODOWN.
    //
    // Stock can now be held across more than one godown for a single order
    // (see `planOrderAllocation`), and a goods issue is a document saying
    // these goods left THIS godown. Issuing everything against the order's own
    // godown would drive its balance negative while the other godown kept the
    // stock reserved forever -- one wrong number and one hold nobody could
    // release. So the issue documents are created per godown actually drawn
    // from, and each one is true.
    const issues = new Map<
      string,
      { id: string; issueNumber: string; locationId: string }
    >();
    const scoped = new Set<string>();

    async function issueDocumentFor(locationId: string) {
      const existing = issues.get(locationId);
      if (existing) return existing;

      // Layer 2, per godown rather than once for the order: holding
      // ActionExecute on this order is not permission to empty somebody
      // else's godown, and until now the only godown checked was the order's.
      if (!scoped.has(locationId)) {
        await assertGodownInScope(
          ctx.tx,
          ctx.actor,
          ENTITY_SALES_ORDER,
          "ActionExecute",
          locationId,
        );
        scoped.add(locationId);
      }

      const docNumber = await nextDocumentNumber(
        ctx.tx,
        ctx.actor.tenantId,
        "GI",
        financialYear,
      );
      const created = await ctx.tx.tradingGoodsIssue.create({
        data: {
          tenantId: ctx.actor.tenantId,
          salesOrderId: order.id,
          locationId,
          issueNumber: docNumber.invoiceNumber,
          financialYear,
          issuedAt,
          issuedBy: ctx.actor.userId,
          collectedBy: input.collectedBy ?? null,
          notes: input.notes ?? null,
        },
      });
      const record = {
        id: created.id,
        issueNumber: created.issueNumber,
        locationId,
      };
      issues.set(locationId, record);
      return record;
    }

    for (const line of requested) {
      const orderLine = order.lines.find(
        (candidate) => candidate.productId === line.productId,
      );
      if (!orderLine) {
        throw new ValidationError(
          "E_VALIDATION: that board is not on this order",
        );
      }
      const outstanding = orderLine.qtyOrdered - orderLine.qtyShipped;
      if (line.qtyIssued > outstanding) {
        // Refused rather than clamped, for the same reason an over-receipt is:
        // issuing more than was ordered makes "still to go" negative and every
        // fulfilment report inherits it.
        throw new ValidationError(
          `E_VALIDATION: ${orderLine.productNameSnapshot} has ${outstanding} left to issue, cannot issue ${line.qtyIssued}`,
        );
      }

      // A service line was never reserved and has nothing to move; only its
      // issued quantity is real. It is recorded against the order's own
      // godown, which is the only godown it has any relationship with.
      if (services.has(line.productId)) {
        const document = await issueDocumentFor(order.locationId);
        await ctx.tx.tradingGoodsIssueLine.create({
          data: {
            tenantId: ctx.actor.tenantId,
            issueId: document.id,
            salesOrderLineId: orderLine.id,
            productId: line.productId,
            productNameSnapshot: orderLine.productNameSnapshot,
            rackId: null,
            qtyIssued: line.qtyIssued,
            unitCostPaise: 0,
          },
        });
        await ctx.tx.tradingSalesOrderLine.update({
          where: { id: orderLine.id },
          data: { qtyShipped: { increment: line.qtyIssued } },
        });
        continue;
      }

      // Drawn from the holds themselves, order's own godown first, because
      // that is where the goods are and the hold is what says so.
      const holds = order.reservations
        .filter((hold) => hold.productId === line.productId)
        .sort((a, b) => {
          if (a.locationId === b.locationId) return 0;
          if (a.locationId === order.locationId) return -1;
          if (b.locationId === order.locationId) return 1;
          return 0;
        });

      let left = line.qtyIssued;
      for (const hold of holds) {
        if (left <= 0) break;
        const take = Math.min(left, hold.qtyUnits);
        const document = await issueDocumentFor(hold.locationId);

        const movement = await applyMovement(ctx.tx, ctx.actor, {
          productId: line.productId,
          locationId: hold.locationId,
          // A rack belongs to one godown, so it can only be honoured on the
          // godown the caller was looking at when they named it.
          rackId:
            hold.locationId === order.locationId ? (input.rackId ?? null) : null,
          kind: "sales_outward",
          qtyUnits: take,
          source: {
            type: "goods_issue",
            id: document.id,
            number: document.issueNumber,
          },
        });

        await ctx.tx.tradingGoodsIssueLine.create({
          data: {
            tenantId: ctx.actor.tenantId,
            issueId: document.id,
            salesOrderLineId: orderLine.id,
            productId: line.productId,
            productNameSnapshot: orderLine.productNameSnapshot,
            rackId:
              hold.locationId === order.locationId
                ? (input.rackId ?? null)
                : null,
            qtyIssued: take,
            unitCostPaise: movement.unitCostPaise,
          },
        });

        // Release only what left. Releasing the whole hold on a partial issue
        // would free stock the customer is still owed, and the next order
        // would quietly take it. A live hold is a running quantity;
        // immutability begins when it is released.
        const remaining = hold.qtyUnits - take;
        await ctx.tx.tradingStockReservation.update({
          where: { id: hold.id },
          data:
            remaining > 0
              ? { qtyUnits: remaining }
              : {
                  releasedAt: issuedAt,
                  releaseReason: `Issued on ${document.issueNumber}`,
                },
        });
        hold.qtyUnits = remaining;
        left -= take;
      }

      if (left > 0) {
        throw new ValidationError(
          `E_VALIDATION: only ${line.qtyIssued - left} of ${orderLine.productNameSnapshot} ` +
            "are held for this order. Hold the rest before issuing it.",
        );
      }

      await ctx.tx.tradingSalesOrderLine.update({
        where: { id: orderLine.id },
        data: { qtyShipped: { increment: line.qtyIssued } },
      });
    }

    const after = await ctx.tx.tradingSalesOrderLine.findMany({
      where: { salesOrderId: order.id },
    });
    const fulfilled = after.every((line) => line.qtyShipped >= line.qtyOrdered);

    // The first document raised, for the caller that wants one number to show.
    // `issuedFrom` carries them all, because a two-godown dispatch genuinely
    // produced two gate passes and hiding one would lose a record.
    const issuedFrom = [...issues.values()];
    const issue = issuedFrom[0]!;

    const target = fulfilled ? "completed" : "dispatching";
    if (order.state !== target) {
      await transition(ctx, {
        entityKey: ENTITY_SALES_ORDER,
        entityId: order.id,
        fromKey: order.state,
        toKey: target,
      });
      await ctx.tx.tradingSalesOrder.update({
        where: { id: order.id },
        data: { state: target, version: { increment: 1 } },
      });
    }

    // The customer's invoice, raised by the act of handing the goods over
    // (Task 71 item 10) — for the same reasons, and with the same refusal
    // handling, as the supplier bill at goods receipt. Goods leaving the yard
    // is a physical fact; a missing state code on the customer must not make it
    // unrecordable, only unbilled and visibly so.
    let invoicing: {
      id: string;
      invoiceNumber: string;
      totalPaise: number;
      interState: boolean;
    } | null = null;
    let invoicingRefusal: string | null = null;
    if (fulfilled) {
      try {
        invoicing = await issueSalesInvoice(ctx, { salesOrderId: order.id });
      } catch (error) {
        if (error instanceof ValidationError) {
          invoicingRefusal = error.message;
        } else {
          throw error;
        }
      }
    }

    return {
      result: {
        id: order.id,
        state: target,
        issueId: issue.id,
        issueNumber: issue.issueNumber,
        /** Every gate pass this dispatch raised — one per godown drawn from. */
        issuedFrom,
        issuedLines: requested.length,
        invoicing,
        invoicingRefusal,
      },
      events: [
        {
          name: fulfilled
            ? "verity.trading.sales_order_fulfilled"
            : "verity.trading.goods_partially_issued",
          entityId: order.id,
          payload: { issueNumber: issue.issueNumber },
        },
        ...(invoicing
          ? [
              {
                name: "verity.trading.sales_invoice_raised",
                entityId: order.id,
                payload: { invoiceNumber: invoicing.invoiceNumber },
              },
            ]
          : []),
      ],
    };
  },
};

export const cancelSalesOrder: CommandDefinition<
  { orderId: string; reason: string },
  { id: string }
> = {
  impact: "destructive",
  key: "verity.trading.cancel_sales_order",
  entity: ENTITY_SALES_ORDER,
  verb: "ActionExecute",
  input: z.object({
    orderId: z.string().uuid(),
    reason: z.string().min(3).max(400),
  }),
  handler: async (ctx, input) => {
    // Releasing the hold is the point of cancelling. Stock held for an order
    // nobody is going to fulfil is stock the business cannot sell.
    await ctx.tx.tradingStockReservation.updateMany({
      where: { salesOrderId: input.orderId, releasedAt: null },
      data: { releasedAt: new Date(), releaseReason: input.reason },
    });
    const order = await ctx.tx.tradingSalesOrder.findUniqueOrThrow({
      where: { id: input.orderId },
    });
    await transition(ctx, {
      entityKey: ENTITY_SALES_ORDER,
      entityId: order.id,
      fromKey: order.state,
      toKey: "cancelled",
    });
    await ctx.tx.tradingSalesOrder.update({
      where: { id: order.id },
      data: { state: "cancelled", version: { increment: 1 } },
    });
    return {
      result: { id: order.id },
      events: [
        { name: "verity.trading.sales_order_cancelled", entityId: order.id },
      ],
    };
  },
};

/* ================================= reads ================================== */

export const listSuppliers: QueryDefinition<
  { includeInactive?: boolean },
  Array<{
    id: string;
    displayName: string;
    gstin: string | null;
    phone: string | null;
    stateCode: string | null;
    active: boolean;
    openOrders: number;
    /// What we owe this supplier, from the ledger (§14).
    outstandingPaise: number;
    /// Value of purchase orders still open. A commitment, never a payable (§54).
    openCommitmentPaise: number;
    /// The same business on the selling side, when the two have been linked.
    linkedCustomerId: string | null;
    linkedCustomerName: string | null;
  }>
> = {
  key: "verity.trading.list_suppliers",
  entity: ENTITY_SUPPLIER,
  input: z.object({ includeInactive: z.boolean().optional() }),
  handler: async (ctx, input) => {
    const suppliers = await ctx.tx.tradingSupplier.findMany({
      where: input.includeInactive ? {} : { active: true },
      orderBy: { displayName: "asc" },
      include: {
        orders: {
          where: { state: { in: ["submitted", "receiving"] } },
          select: { id: true, totalCostPaise: true },
        },
        // Included rather than aggregated per supplier: the running balance is
        // a sum over the party's own entries, and one pass beats one query
        // per row on a list screen.
        tradingLedgerEntries: {
          select: { entryType: true, amountPaise: true },
        },
        linkedCustomer: { select: { id: true, displayName: true } },
      },
    });
    return suppliers.map((supplier) => ({
      id: supplier.id,
      displayName: supplier.displayName,
      gstin: supplier.gstin,
      phone: supplier.phone,
      stateCode: supplier.stateCode,
      active: supplier.active,
      openOrders: supplier.orders.length,
      outstandingPaise: supplier.tradingLedgerEntries.reduce(
        (sum, entry) =>
          sum +
          (entry.entryType === "debit"
            ? entry.amountPaise
            : -entry.amountPaise),
        0,
      ),
      openCommitmentPaise: supplier.orders.reduce(
        (sum, order) => sum + order.totalCostPaise,
        0,
      ),
      linkedCustomerId: supplier.linkedCustomer?.id ?? null,
      linkedCustomerName: supplier.linkedCustomer?.displayName ?? null,
    }));
  },
};

export const listCustomers: QueryDefinition<
  { includeInactive?: boolean },
  Array<{
    id: string;
    displayName: string;
    gstin: string | null;
    phone: string | null;
    stateCode: string | null;
    creditLimitPaise: number;
    exposurePaise: number;
    availableCreditPaise: number;
    active: boolean;
  }>
> = {
  key: "verity.trading.list_customers",
  entity: ENTITY_CUSTOMER,
  input: z.object({ includeInactive: z.boolean().optional() }),
  handler: async (ctx, input) => {
    const customers = await ctx.tx.tradingCustomer.findMany({
      where: input.includeInactive ? {} : { active: true },
      orderBy: { displayName: "asc" },
      select: {
        id: true,
        displayName: true,
        gstin: true,
        phone: true,
        stateCode: true,
        creditLimitPaise: true,
        active: true,
      },
    });

    const exposures = await customerExposuresPaise(ctx.tx, customers.map((customer) => customer.id));
    const rows = [];
    for (const customer of customers) {
      const exposurePaise = exposures.get(customer.id) ?? 0;
      rows.push({
        ...customer,
        exposurePaise,
        // Clamped at zero: a customer over their limit has no credit
        // available, and a negative headroom reads as a refund.
        availableCreditPaise: Math.max(
          0,
          customer.creditLimitPaise - exposurePaise,
        ),
      });
    }
    return rows;
  },
};

export const purchaseOrderDetail: QueryDefinition<
  { orderId: string },
  {
    id: string;
    /// Carried so the screen can link the supplier rather than print its name
    /// as dead text (§71).
    supplierId: string;
    supplierName: string;
    locationId: string;
    locationName: string;
    reference: string | null;
    state: string;
    /** Whether this purchase carries GST. False for an unregistered or
     *  composition supplier; the bill then records no tax and claims no
     *  input credit. */
    gstApplicable: boolean;
    /**
     * `totalCostPaise` is the TAXABLE value and stays that way — the
     * three-way match, the payable and the weighted average cost all read it.
     * This is the tax that will sit on top when the bill is raised, so the
     * page can show what the order actually commits the business to.
     *
     * Null when GST does not apply, or when no rate can be resolved for a
     * line. Withheld rather than quoted as zero: an order that says it costs
     * less than it does is worse than one that admits it does not know yet.
     */
    estimatedTaxPaise: number | null;
    totalCostPaise: number;
    createdAt: Date;
    qtyOrdered: number;
    qtyReceived: number;
    qtyOutstanding: number;
    lines: Array<{
      productId: string;
      name: string;
      hsnCode: string | null;
      qtyOrdered: number;
      qtyReceived: number;
      qtyOutstanding: number;
      unitCostPaise: number;
      lineTotalPaise: number;
    }>;
    /// §21 — the receipts already taken against this order.
    receipts: Array<{
      id: string;
      receiptNumber: string;
      receivedAt: Date;
      qtyUnits: number;
    }>;
    /// §21 — the supplier invoice, if one has been recorded. A purchase order
    /// is not a payable until this exists (§20).
    invoices: Array<{
      id: string;
      invoiceNumber: string;
      issuedAt: Date;
      totalPaise: number;
      paidPaise: number;
      balancePaise: number;
    }>;
    /// §21 and §78 — who did what to this order, and when.
    activity: Array<{
      occurredAt: Date;
      action: string;
      before: string | null;
      after: string | null;
      actorUserId: string | null;
      commandKey: string | null;
      kind: "change" | "fact";
    }>;
  } | null
> = {
  scopeHandling: "handler",
  key: "verity.trading.purchase_order_detail",
  entity: ENTITY_PURCHASE_ORDER,
  input: z.object({ orderId: z.string().uuid() }),
  handler: async (ctx, input) => {
    // Layer 2. Audit finding F-09: this read the order by id with no godown
    // filter, so a warehouse role restricted to one godown could open another
    // godown's purchase order — its supplier, its prices and its receipts —
    // given only the id. Same shape as the productMovements hole (Task 55).
    //
    // Intersected with the reachable set rather than checked afterwards: a
    // findUnique that returns the row and then refuses has already read it.
    const reachable = await reachableGodownIds(
      ctx.tx,
      ctx.actor,
      ENTITY_PURCHASE_ORDER,
    );
    const order = await ctx.tx.tradingPurchaseOrder.findFirst({
      where: { id: input.orderId, locationId: { in: reachable } },
      include: {
        lines: true,
        supplier: { select: { id: true, displayName: true } },
        location: { select: { id: true, name: true } },
        goodsReceipts: {
          orderBy: { receivedAt: "desc" },
          include: { lines: { select: { qtyReceived: true } } },
        },
        tradingInvoices: {
          orderBy: { issuedAt: "desc" },
          include: {
            allocations: { select: { amountPaise: true } },
            notes: { select: { noteType: true, totalPaise: true } },
          },
        },
      },
    });
    if (!order) return null;

    const history = await reconstructHistory(
      ctx.tx,
      ENTITY_PURCHASE_ORDER,
      order.id,
    );

    const qtyOrdered = order.lines.reduce(
      (sum, line) => sum + line.qtyOrdered,
      0,
    );
    const qtyReceived = order.lines.reduce(
      (sum, line) => sum + line.qtyReceived,
      0,
    );

    // What the bill will add on top. Per line, at the rate in force for that
    // line's own HSN, because two products on one order can attract different
    // rates — and if any line's rate cannot be resolved, the whole estimate is
    // withheld rather than quoted short.
    let estimatedTaxPaise: number | null = null;
    if (order.gstApplicable) {
      const rates = await productTaxRateMap(ctx.tx);
      let running = 0;
      let known = true;
      for (const line of order.lines) {
        const rateBp = rates.get(line.productId);
        if (rateBp == null) {
          known = false;
          break;
        }
        running += Math.round(
          (line.qtyOrdered * line.unitCostPaise * rateBp) / 10_000,
        );
      }
      estimatedTaxPaise = known ? running : null;
    }

    return {
      id: order.id,
      supplierId: order.supplier.id,
      supplierName: order.supplier.displayName,
      locationId: order.location.id,
      locationName: order.location.name,
      reference: order.reference,
      state: order.state,
      gstApplicable: order.gstApplicable,
      estimatedTaxPaise,
      totalCostPaise: order.totalCostPaise,
      createdAt: order.createdAt,
      qtyOrdered,
      qtyReceived,
      qtyOutstanding: qtyOrdered - qtyReceived,
      lines: order.lines.map((line) => ({
        productId: line.productId,
        name: line.productNameSnapshot,
        hsnCode: line.hsnCodeSnapshot,
        qtyOrdered: line.qtyOrdered,
        qtyReceived: line.qtyReceived,
        // The number the question is actually about: what is still owed on
        // this order. A column, not an arithmetic exercise for the reader.
        qtyOutstanding: line.qtyOrdered - line.qtyReceived,
        unitCostPaise: line.unitCostPaise,
        lineTotalPaise: line.qtyOrdered * line.unitCostPaise,
      })),
      receipts: order.goodsReceipts.map((receipt) => ({
        id: receipt.id,
        receiptNumber: receipt.receiptNumber,
        receivedAt: receipt.receivedAt,
        qtyUnits: receipt.lines.reduce(
          (sum, line) => sum + line.qtyReceived,
          0,
        ),
      })),
      invoices: order.tradingInvoices.map((invoice) => {
        const paid = invoice.allocations.reduce(
          (sum, payment) => sum + payment.amountPaise,
          0,
        );
        const credited = invoice.notes
          .filter((note) => note.noteType === "credit")
          .reduce((sum, note) => sum + note.totalPaise, 0);
        const debited = invoice.notes
          .filter((note) => note.noteType === "debit")
          .reduce((sum, note) => sum + note.totalPaise, 0);
        return {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          issuedAt: invoice.issuedAt,
          totalPaise: invoice.totalPaise,
          paidPaise: paid,
          balancePaise: Math.max(
            0,
            invoice.totalPaise + debited - paid - credited,
          ),
        };
      }),
      // Newest first here, unlike `reconstructHistory`'s forward order: an
      // activity panel on a live record answers "what just happened", and the
      // reader should not scroll to the bottom to find out.
      activity: history
        .slice()
        .reverse()
        .map((entry) => ({
          occurredAt: entry.occurredAt,
          action: entry.action,
          before: entry.before ?? null,
          after: entry.after ?? null,
          actorUserId: entry.actorUserId,
          commandKey: entry.commandKey,
          kind: entry.kind,
        })),
    };
  },
};

export const salesOrderDetail: QueryDefinition<
  { orderId: string },
  {
    id: string;
    customerId: string;
    customerName: string;
    /// §41 — the credit position at the moment this order is read, so the
    /// approver sees what they are approving rather than a bare "blocked".
    creditLimitPaise: number;
    exposurePaise: number;
    availableCreditPaise: number;
    overLimitPaise: number;
    locationId: string;
    locationName: string;
    reference: string | null;
    state: string;
    totalPricePaise: number;
    createdAt: Date;
    qtyOrdered: number;
    qtyReserved: number;
    qtyIssued: number;
    lines: Array<{
      productId: string;
      name: string;
      hsnCode: string | null;
      qtyOrdered: number;
      qtyShipped: number;
      qtyReserved: number;
      unitPricePaise: number;
      lineTotalPaise: number;
    }>;
    holds: Array<{
      productId: string;
      qtyUnits: number;
      releasedAt: Date | null;
    }>;
    /// §47 — the goods that have physically left the godown.
    issues: Array<{
      id: string;
      issueNumber: string;
      issuedAt: Date;
      qtyUnits: number;
    }>;
    invoices: Array<{
      id: string;
      invoiceNumber: string;
      issuedAt: Date;
      totalPaise: number;
      paidPaise: number;
      balancePaise: number;
    }>;
    activity: Array<{
      occurredAt: Date;
      action: string;
      before: string | null;
      after: string | null;
      actorUserId: string | null;
      commandKey: string | null;
      kind: "change" | "fact";
    }>;
  } | null
> = {
  scopeHandling: "handler",
  key: "verity.trading.sales_order_detail",
  entity: ENTITY_SALES_ORDER,
  input: z.object({ orderId: z.string().uuid() }),
  handler: async (ctx, input) => {
    // Layer 2. Audit finding F-09, selling side: the credit position, the
    // customer and the prices on another godown's order were readable by id.
    const reachable = await reachableGodownIds(
      ctx.tx,
      ctx.actor,
      ENTITY_SALES_ORDER,
    );
    const order = await ctx.tx.tradingSalesOrder.findFirst({
      where: { id: input.orderId, locationId: { in: reachable } },
      include: {
        lines: true,
        reservations: true,
        customer: {
          select: { id: true, displayName: true, creditLimitPaise: true },
        },
        location: { select: { id: true, name: true } },
        goodsIssues: {
          orderBy: { issuedAt: "desc" },
          include: { lines: { select: { qtyIssued: true } } },
        },
        tradingInvoices: {
          orderBy: { issuedAt: "desc" },
          include: {
            allocations: { select: { amountPaise: true } },
            notes: { select: { noteType: true, totalPaise: true } },
          },
        },
      },
    });
    if (!order) return null;

    // The canonical exposure, not a local recomputation. taskplans/45 §4.1 is
    // explicit that a second definition anywhere in this capability is a
    // defect, and an approval screen showing a different figure from the check
    // that blocked the order would be the worst place to have one.
    const exposurePaise = await customerExposurePaise(
      ctx.tx,
      order.customer.id,
    );
    const history = await reconstructHistory(
      ctx.tx,
      ENTITY_SALES_ORDER,
      order.id,
    );

    // Reservations are per product, and a line is per product, so the hold on
    // a line is the sum of its unreleased reservations. Released ones are kept
    // in `holds` because a cancellation that returned stock is history worth
    // reading (§69), but they hold nothing now.
    const reservedByProduct = new Map<string, number>();
    for (const hold of order.reservations) {
      if (hold.releasedAt !== null) continue;
      reservedByProduct.set(
        hold.productId,
        (reservedByProduct.get(hold.productId) ?? 0) + hold.qtyUnits,
      );
    }

    const qtyOrdered = order.lines.reduce(
      (sum, line) => sum + line.qtyOrdered,
      0,
    );
    const qtyIssued = order.lines.reduce(
      (sum, line) => sum + line.qtyShipped,
      0,
    );
    const qtyReserved = [...reservedByProduct.values()].reduce(
      (sum, qty) => sum + qty,
      0,
    );

    return {
      id: order.id,
      customerId: order.customer.id,
      customerName: order.customer.displayName,
      creditLimitPaise: order.customer.creditLimitPaise,
      exposurePaise,
      availableCreditPaise: Math.max(
        0,
        order.customer.creditLimitPaise - exposurePaise,
      ),
      overLimitPaise: Math.max(
        0,
        exposurePaise - order.customer.creditLimitPaise,
      ),
      locationId: order.location.id,
      locationName: order.location.name,
      reference: order.reference,
      state: order.state,
      totalPricePaise: order.totalPricePaise,
      createdAt: order.createdAt,
      qtyOrdered,
      qtyReserved,
      qtyIssued,
      lines: order.lines.map((line) => ({
        productId: line.productId,
        name: line.productNameSnapshot,
        hsnCode: line.hsnCodeSnapshot,
        qtyOrdered: line.qtyOrdered,
        qtyShipped: line.qtyShipped,
        qtyReserved: reservedByProduct.get(line.productId) ?? 0,
        unitPricePaise: line.unitPricePaise,
        lineTotalPaise: line.qtyOrdered * line.unitPricePaise,
      })),
      holds: order.reservations.map((hold) => ({
        productId: hold.productId,
        qtyUnits: hold.qtyUnits,
        releasedAt: hold.releasedAt,
      })),
      issues: order.goodsIssues.map((issue) => ({
        id: issue.id,
        issueNumber: issue.issueNumber,
        issuedAt: issue.issuedAt,
        qtyUnits: issue.lines.reduce((sum, line) => sum + line.qtyIssued, 0),
      })),
      invoices: order.tradingInvoices.map((invoice) => {
        const paid = invoice.allocations.reduce(
          (sum, payment) => sum + payment.amountPaise,
          0,
        );
        const credited = invoice.notes
          .filter((note) => note.noteType === "credit")
          .reduce((sum, note) => sum + note.totalPaise, 0);
        const debited = invoice.notes
          .filter((note) => note.noteType === "debit")
          .reduce((sum, note) => sum + note.totalPaise, 0);
        return {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          issuedAt: invoice.issuedAt,
          totalPaise: invoice.totalPaise,
          paidPaise: paid,
          balancePaise: Math.max(
            0,
            invoice.totalPaise + debited - paid - credited,
          ),
        };
      }),
      activity: history
        .slice()
        .reverse()
        .map((entry) => ({
          occurredAt: entry.occurredAt,
          action: entry.action,
          before: entry.before ?? null,
          after: entry.after ?? null,
          actorUserId: entry.actorUserId,
          commandKey: entry.commandKey,
          kind: entry.kind,
        })),
    };
  },
};

export const openOrders: QueryDefinition<
  Record<string, never>,
  {
    purchases: Array<{
      id: string;
      /// The order's own number, so two orders to one supplier are distinct.
      reference: string | null;
      supplierName: string;
      state: string;
      totalCostPaise: number;
      orderedUnits: number;
      receivedUnits: number;
      outstandingUnits: number;
      raisedAt: Date;
      /// What the order is FOR — the fact the desk was missing entirely.
      summary: string;
      /// Whether this purchase carries GST. False for an unregistered or
      /// composition supplier; the bill then records no tax.
      gstApplicable: boolean;
      /// The lines themselves, so receiving can be scoped to this order.
      lines: Array<{
        productId: string;
        name: string;
        qtyOrdered: number;
        qtyReceived: number;
        qtyOutstanding: number;
      }>;
      /// The whole order as it stands, for reopening it in the form.
      editable: {
        locationId: string;
        supplierId: string;
        lines: Array<{
          productId: string;
          qtyOrdered: number;
          unitCostPaise: number;
          listUnitCostPaise: number | null;
          discountBps: number;
        }>;
      };
    }>;
    sales: Array<{
      id: string;
      reference: string | null;
      customerId: string;
      customerName: string;
      state: string;
      totalPricePaise: number;
      orderedUnits: number;
      raisedAt: Date;
      summary: string;
      paymentTerms: string;
      taxExempt: boolean;
      taxExemptReason: string | null;
      editable: {
        locationId: string;
        customerId: string;
        lines: Array<{
          productId: string;
          qtyOrdered: number;
          unitPricePaise: number;
          listUnitPricePaise: number | null;
          discountBps: number;
        }>;
      };
      /// False once goods have gone out — see `editSalesOrder`.
      amendable: boolean;
    }>;
  }
> = {
  scopeHandling: "handler",
  key: "verity.trading.open_orders",
  entity: ENTITY_SALES_ORDER,
  input: z.object({}),
  handler: async (ctx) => {
    // Layer 2 (P0-01). Both lists are anchored to a godown, so both are
    // filtered by the godowns this actor reaches. Each is scoped against its
    // OWN entity: reading sales orders must not be what lets someone read
    // purchase orders, even on a screen that shows them side by side.
    const forPurchases = await reachableGodownIds(
      ctx.tx,
      ctx.actor,
      ENTITY_PURCHASE_ORDER,
    );
    const forSales = await reachableGodownIds(
      ctx.tx,
      ctx.actor,
      ENTITY_SALES_ORDER,
    );

    const purchases = await ctx.tx.tradingPurchaseOrder.findMany({
      where: {
        // Audit finding U0-2: select what is NOT finished, rather than what is
        // on a known-open list. A hard-coded open list silently drops any row
        // whose state it does not recognise — and a dropped order is invisible
        // on every screen while still consuming the customer's credit. Failing
        // toward "still open" is the safe direction: an order shown with an odd
        // label can be dealt with; one that is not shown cannot.
        state: { notIn: ["completed", "cancelled"] },
        locationId: { in: forPurchases },
      },
      include: { lines: true, supplier: { select: { displayName: true } } },
      orderBy: { createdAt: "desc" },
    });
    const sales = await ctx.tx.tradingSalesOrder.findMany({
      where: {
        // U0-2, selling side. See the note above.
        state: { notIn: ["completed", "cancelled"] },
        locationId: { in: forSales },
      },
      include: {
        lines: true,
        customer: { select: { id: true, displayName: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    /**
     * What an order is for, in the space a table cell has.
     *
     * One board is named in full. More than one names the first and counts the
     * rest, because "Century MR 19mm +2 more" tells a warehouse user which
     * order this is, and a truncated list of three tells them nothing while
     * taking three times the width.
     */
    const summarise = (names: string[]): string => {
      if (names.length === 0) return "No lines";
      const [first, ...rest] = names;
      return rest.length === 0 ? first! : `${first} +${rest.length} more`;
    };

    return {
      purchases: purchases.map((order) => ({
        id: order.id,
        reference: order.reference,
        supplierName: order.supplier.displayName,
        state: order.state,
        totalCostPaise: order.totalCostPaise,
        orderedUnits: order.lines.reduce(
          (sum, line) => sum + line.qtyOrdered,
          0,
        ),
        receivedUnits: order.lines.reduce(
          (sum, line) => sum + line.qtyReceived,
          0,
        ),
        outstandingUnits: order.lines.reduce(
          (sum, line) => sum + Math.max(0, line.qtyOrdered - line.qtyReceived),
          0,
        ),
        raisedAt: order.createdAt,
        summary: summarise(order.lines.map((line) => line.productNameSnapshot)),
        gstApplicable: order.gstApplicable,
        // Only lines with something still owed can be received against, so the
        // receive form is offered exactly the set it may act on (U0-4).
        lines: order.lines
          .filter((line) => line.qtyOrdered > line.qtyReceived)
          .map((line) => ({
            productId: line.productId,
            name: line.productNameSnapshot,
            qtyOrdered: line.qtyOrdered,
            qtyReceived: line.qtyReceived,
            qtyOutstanding: line.qtyOrdered - line.qtyReceived,
          })),
        // Everything the order form needs to reopen this order as it stands.
        // Separate from `lines` above, which is deliberately only what can
        // still be received — an amendment is about the whole order.
        editable: {
          locationId: order.locationId,
          supplierId: order.supplierId,
          lines: order.lines.map((line) => ({
            productId: line.productId,
            qtyOrdered: line.qtyOrdered,
            unitCostPaise: line.unitCostPaise,
            listUnitCostPaise: line.listUnitCostPaise,
            discountBps: line.discountBps,
          })),
        },
      })),
      sales: sales.map((order) => ({
        id: order.id,
        reference: order.reference,
        customerId: order.customer.id,
        customerName: order.customer.displayName,
        state: order.state,
        totalPricePaise: order.totalPricePaise,
        orderedUnits: order.lines.reduce(
          (sum, line) => sum + line.qtyOrdered,
          0,
        ),
        raisedAt: order.createdAt,
        summary: summarise(order.lines.map((line) => line.productNameSnapshot)),
        paymentTerms: order.paymentTerms,
        taxExempt: order.taxExempt,
        taxExemptReason: order.taxExemptReason,
        editable: {
          locationId: order.locationId,
          customerId: order.customerId,
          lines: order.lines.map((line) => ({
            productId: line.productId,
            qtyOrdered: line.qtyOrdered,
            unitPricePaise: line.unitPricePaise,
            listUnitPricePaise: line.listUnitPricePaise,
            discountBps: line.discountBps,
          })),
        },
        /** Whether an amendment is still possible — see `editSalesOrder`. */
        amendable:
          order.lines.every((line) => line.qtyShipped === 0) &&
          order.state !== "completed" &&
          order.state !== "cancelled",
      })),
    };
  },
};

/**
 * "Needs Attention" — Overview dashboard rework, plywood's own local
 * feature. NOT Task 90's platform-wide Attention contribution point (see
 * `taskplans/90_attention_platform_concept.md` — that stays gated behind
 * its own ADR). This composes plywood's already-canonical signals
 * (`lowStock`, `outstandingReceivables`, `openOrders`, called here as
 * ordinary functions, never re-deriving their numbers — Task 82's
 * source-of-truth rule) into one ordered list, matching the reference
 * board's bullet style.
 */
export const needsAttention: QueryDefinition<
  Record<string, never>,
  Array<{
    id: string;
    severity: "high" | "medium";
    label: string;
    sublabel?: string;
    href: string;
  }>
> = {
  key: "verity.trading.needs_attention",
  entity: ENTITY_INVOICE,
  input: z.object({}),
  handler: async (ctx) => {
    const [stock, receivables, orders] = await Promise.all([
      lowStock.handler(ctx, {}),
      outstandingReceivables.handler(ctx, {}),
      openOrders.handler(ctx, {}),
    ]);

    const items: Array<{
      id: string;
      severity: "high" | "medium";
      label: string;
      sublabel?: string;
      href: string;
    }> = [];

    const pendingCredit = orders.sales.filter((o) => o.state === "pending_credit");
    if (pendingCredit.length > 0) {
      items.push({
        id: "credit-approval",
        severity: "high",
        label: `${pendingCredit.length} sales order${pendingCredit.length === 1 ? "" : "s"} awaiting credit approval`,
        sublabel: pendingCredit.slice(0, 3).map((o) => o.reference ?? o.id.slice(0, 8)).join(", "),
        href: "/sales",
      });
    }

    const awaitingIssue = orders.sales.filter((o) => o.state === "approved");
    if (awaitingIssue.length > 0) {
      items.push({
        id: "goods-issue",
        severity: "medium",
        label: `${awaitingIssue.length} sales order${awaitingIssue.length === 1 ? "" : "s"} awaiting goods issue`,
        sublabel: awaitingIssue.slice(0, 3).map((o) => o.reference ?? o.id.slice(0, 8)).join(", "),
        href: "/sales",
      });
    }

    // "Delayed" per Task 81 rule 9's own worked example: a specific,
    // current, true detail, not a bare "cannot dispatch". Three days
    // outstanding on a submitted/receiving order, not an arbitrary flag.
    const delayed = orders.purchases.filter(
      (o) => o.outstandingUnits > 0 && Date.now() - o.raisedAt.getTime() > 3 * 24 * 60 * 60 * 1000,
    );
    if (delayed.length > 0) {
      items.push({
        id: "purchase-delayed",
        severity: "high",
        label: `${delayed.length} purchase receipt${delayed.length === 1 ? "" : "s"} delayed`,
        sublabel: delayed.slice(0, 3).map((o) => o.reference ?? o.id.slice(0, 8)).join(", "),
        href: "/purchases",
      });
    }

    if (stock.length > 0) {
      items.push({
        id: "low-stock",
        severity: "medium",
        label: `${stock.length} item${stock.length === 1 ? "" : "s"} approaching reorder point`,
        sublabel: stock.slice(0, 3).map((s) => s.productName).join(", "),
        href: "/stock",
      });
    }

    const overdue = receivables.filter(
      (r) => r.oldestUnpaidAt && Date.now() - r.oldestUnpaidAt.getTime() > 30 * 24 * 60 * 60 * 1000,
    );
    if (overdue.length > 0) {
      items.push({
        id: "overdue-receivables",
        severity: "high",
        label: `${overdue.length} customer payment${overdue.length === 1 ? "" : "s"} overdue`,
        sublabel: overdue.slice(0, 3).map((r) => r.customerName).join(", "),
        href: "/finance",
      });
    }

    return items;
  },
};

export const stockAvailability: QueryDefinition<
  { locationId: string },
  Array<{
    productId: string;
    productName: string;
    onHandUnits: number;
    reservedUnits: number;
    availableUnits: number;
  }>
> = {
  scopeHandling: "handler",
  key: "verity.trading.stock_availability",
  entity: ENTITY_RESERVATION,
  input: z.object({ locationId: z.string().uuid() }),
  handler: async (ctx, input) => {
    // Layer 2. Audit finding F-09: the godown was taken straight from input, so
    // naming another branch's godown returned its stock. Intersected rather
    // than replaced, which is the pattern `stockOnHand` already uses — an
    // empty result for an unreachable godown, not its contents.
    const reachable = await reachableGodownIds(
      ctx.tx,
      ctx.actor,
      ENTITY_STOCK_BALANCE,
    );
    if (!reachable.includes(input.locationId)) {
      return [];
    }
    const balances = await ctx.tx.stockBalance.findMany({
      where: { locationId: input.locationId },
      include: { product: { select: { name: true } } },
    });
    const holds = await ctx.tx.tradingStockReservation.groupBy({
      by: ["productId"],
      where: { locationId: input.locationId, releasedAt: null },
      _sum: { qtyUnits: true },
    });

    return balances
      .map((balance) => {
        const reservedUnits =
          holds.find((hold) => hold.productId === balance.productId)?._sum
            .qtyUnits ?? 0;
        return {
          productId: balance.productId,
          productName: balance.product.name,
          onHandUnits: balance.qtyUnits,
          reservedUnits,
          availableUnits: balance.qtyUnits - reservedUnits,
        };
      })
      .sort((a, b) => a.productName.localeCompare(b.productName));
  },
};

/* ========================== party workspaces (§14–16, §34–36, §55–56) ========================== */

/** An invoice with what has actually been collected or paid against it. */
type PartyInvoiceRow = {
  id: string;
  invoiceNumber: string;
  issuedAt: Date;
  totalPaise: number;
  paidPaise: number;
  balancePaise: number;
  purchaseOrderId: string | null;
  salesOrderId: string | null;
};

/**
 * §15 and §35 — a trading partner as an operating account rather than a
 * dropdown. One round trip fills every tab, because a person opening a supplier
 * is going to read more than one of them and six sequential queries to render
 * one page is six chances for the tabs to disagree with each other.
 */
export const supplierDetail: QueryDefinition<
  { supplierId: string },
  {
    id: string;
    displayName: string;
    gstin: string | null;
    phone: string | null;
    email: string | null;
    stateCode: string | null;
    active: boolean;
    /// What we owe, from the ledger.
    outstandingPaise: number;
    /// Value of purchase orders still open — a commitment, never a payable (§54).
    openCommitmentPaise: number;
    openOrders: number;
    incomingUnits: number;
    pricing: Array<{
      productId: string;
      productName: string;
      negotiatedCostPaise: number;
    }>;
    orders: Array<{
      id: string;
      reference: string | null;
      state: string;
      totalCostPaise: number;
      orderedUnits: number;
      receivedUnits: number;
      createdAt: Date;
    }>;
    invoices: PartyInvoiceRow[];
    payments: Array<{
      id: string;
      invoiceId: string;
      invoiceNumber: string;
      method: string;
      amountPaise: number;
      reference: string | null;
      receivedAt: Date;
    }>;
    ledger: Array<{
      id: string;
      entryType: string;
      amountPaise: number;
      narration: string | null;
      occurredAt: Date;
      invoiceId: string | null;
      runningBalancePaise: number;
    }>;
    activity: Array<{
      occurredAt: Date;
      action: string;
      before: string | null;
      after: string | null;
      actorUserId: string | null;
      commandKey: string | null;
      kind: "change" | "fact";
    }>;
  } | null
> = {
  key: "verity.trading.supplier_detail",
  entity: ENTITY_SUPPLIER,
  input: z.object({ supplierId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const supplier = await ctx.tx.tradingSupplier.findUnique({
      where: { id: input.supplierId },
      include: {
        pricing: { include: { product: { select: { name: true } } } },
        orders: {
          orderBy: { createdAt: "desc" },
          include: {
            lines: { select: { qtyOrdered: true, qtyReceived: true } },
          },
        },
        tradingInvoices: {
          orderBy: { issuedAt: "desc" },
          include: {
            allocations: { include: { payment: true }, orderBy: { payment: { receivedAt: "desc" } } },
            notes: { select: { noteType: true, totalPaise: true } },
          },
        },
        tradingLedgerEntries: { orderBy: { occurredAt: "asc" } },
      },
    });
    if (!supplier) return null;

    // Task 92 coverage extension — same pattern proven on purchase/sales
    // order detail, applied here for the first time. Newest first, same
    // reasoning as those panels: a live record's activity panel answers
    // "what just happened."
    const history = await reconstructHistory(ctx.tx, ENTITY_SUPPLIER, supplier.id);

    const openOrders = supplier.orders.filter((order) =>
      ["submitted", "receiving"].includes(order.state),
    );

    let running = 0;
    return {
      id: supplier.id,
      displayName: supplier.displayName,
      gstin: supplier.gstin,
      phone: supplier.phone,
      email: supplier.email,
      stateCode: supplier.stateCode,
      active: supplier.active,
      outstandingPaise: supplier.tradingLedgerEntries.reduce(
        (sum, entry) =>
          sum +
          (entry.entryType === "debit"
            ? entry.amountPaise
            : -entry.amountPaise),
        0,
      ),
      openCommitmentPaise: openOrders.reduce(
        (sum, order) => sum + order.totalCostPaise,
        0,
      ),
      openOrders: openOrders.length,
      // What is still on its way: ordered minus received, on open orders only.
      // A completed order has nothing incoming and a draft has not been placed.
      incomingUnits: openOrders.reduce(
        (sum, order) =>
          sum +
          order.lines.reduce(
            (u, line) => u + Math.max(0, line.qtyOrdered - line.qtyReceived),
            0,
          ),
        0,
      ),
      pricing: supplier.pricing
        .map((price) => ({
          productId: price.productId,
          productName: price.product.name,
          negotiatedCostPaise: price.negotiatedCostPaise,
        }))
        .sort((a, b) => a.productName.localeCompare(b.productName)),
      orders: supplier.orders.map((order) => ({
        id: order.id,
        reference: order.reference,
        state: order.state,
        totalCostPaise: order.totalCostPaise,
        orderedUnits: order.lines.reduce((u, line) => u + line.qtyOrdered, 0),
        receivedUnits: order.lines.reduce((u, line) => u + line.qtyReceived, 0),
        createdAt: order.createdAt,
      })),
      invoices: supplier.tradingInvoices.map((invoice) => {
        const paid = invoice.allocations.reduce(
          (p, payment) => p + payment.amountPaise,
          0,
        );
        const credited = invoice.notes
          .filter((note) => note.noteType === "credit")
          .reduce((c, note) => c + note.totalPaise, 0);
        const debited = invoice.notes
          .filter((note) => note.noteType === "debit")
          .reduce((d, note) => d + note.totalPaise, 0);
        return {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          issuedAt: invoice.issuedAt,
          totalPaise: invoice.totalPaise,
          paidPaise: paid,
          balancePaise: Math.max(
            0,
            invoice.totalPaise + debited - paid - credited,
          ),
          purchaseOrderId: invoice.purchaseOrderId,
          salesOrderId: invoice.salesOrderId,
        };
      }),
      payments: supplier.tradingInvoices.flatMap((invoice) =>
        invoice.allocations.map(({ payment, amountPaise }) => ({
          id: payment.id,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          method: payment.method,
          amountPaise,
          reference: payment.reference,
          receivedAt: payment.receivedAt,
        })),
      ),
      ledger: supplier.tradingLedgerEntries.map((entry) => {
        running +=
          entry.entryType === "debit" ? entry.amountPaise : -entry.amountPaise;
        return {
          id: entry.id,
          entryType: entry.entryType,
          amountPaise: entry.amountPaise,
          narration: entry.narration,
          occurredAt: entry.occurredAt,
          invoiceId: entry.invoiceId,
          runningBalancePaise: running,
        };
      }),
      activity: history
        .slice()
        .reverse()
        .map((entry) => ({
          occurredAt: entry.occurredAt,
          action: entry.action,
          before: entry.before ?? null,
          after: entry.after ?? null,
          actorUserId: entry.actorUserId,
          commandKey: entry.commandKey,
          kind: entry.kind,
        })),
    };
  },
};

/**
 * §35 — the customer's operating account, and the one screen where the credit
 * decision is legible: limit, exposure, headroom, side by side.
 *
 * Exposure comes from `customerExposurePaise` and from nowhere else. The
 * program plan is explicit that a second definition anywhere in this capability
 * is a defect, and a screen that recomputed it would be exactly that.
 */
export const customerDetail: QueryDefinition<
  { customerId: string },
  {
    id: string;
    displayName: string;
    gstin: string | null;
    phone: string | null;
    email: string | null;
    stateCode: string | null;
    active: boolean;
    creditLimitPaise: number;
    exposurePaise: number;
    availableCreditPaise: number;
    outstandingPaise: number;
    openCommitmentPaise: number;
    openOrders: number;
    pricing: Array<{
      productId: string;
      productName: string;
      customPricePaise: number;
    }>;
    orders: Array<{
      id: string;
      reference: string | null;
      state: string;
      totalPricePaise: number;
      orderedUnits: number;
      reservedUnits: number;
      issuedUnits: number;
      createdAt: Date;
    }>;
    invoices: PartyInvoiceRow[];
    payments: Array<{
      id: string;
      invoiceId: string;
      invoiceNumber: string;
      method: string;
      amountPaise: number;
      reference: string | null;
      receivedAt: Date;
    }>;
    ledger: Array<{
      id: string;
      entryType: string;
      amountPaise: number;
      narration: string | null;
      occurredAt: Date;
      invoiceId: string | null;
      runningBalancePaise: number;
    }>;
    activity: Array<{
      occurredAt: Date;
      action: string;
      before: string | null;
      after: string | null;
      actorUserId: string | null;
      commandKey: string | null;
      kind: "change" | "fact";
    }>;
  } | null
> = {
  key: "verity.trading.customer_detail",
  entity: ENTITY_CUSTOMER,
  input: z.object({ customerId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const customer = await ctx.tx.tradingCustomer.findUnique({
      where: { id: input.customerId },
      include: {
        pricing: { include: { product: { select: { name: true } } } },
        orders: {
          orderBy: { createdAt: "desc" },
          include: {
            lines: { select: { qtyOrdered: true, qtyShipped: true } },
            // Reserved is NOT a column on the order line. A reservation is its
            // own record with a release, which is what lets a cancellation
            // return stock to available without rewriting the order (§69).
            reservations: {
              where: { releasedAt: null },
              select: { qtyUnits: true },
            },
          },
        },
        tradingInvoices: {
          orderBy: { issuedAt: "desc" },
          include: {
            allocations: { include: { payment: true }, orderBy: { payment: { receivedAt: "desc" } } },
            notes: { select: { noteType: true, totalPaise: true } },
          },
        },
        tradingLedgerEntries: { orderBy: { occurredAt: "asc" } },
      },
    });
    if (!customer) return null;

    // Task 92 coverage extension — see supplierDetail for the same pattern.
    const history = await reconstructHistory(ctx.tx, ENTITY_CUSTOMER, customer.id);

    const exposurePaise = await customerExposurePaise(ctx.tx, customer.id);
    const committed = customer.orders.filter((order) =>
      COMMITTED_ORDER_STATES.includes(
        order.state as (typeof COMMITTED_ORDER_STATES)[number],
      ),
    );

    let running = 0;
    return {
      id: customer.id,
      displayName: customer.displayName,
      gstin: customer.gstin,
      phone: customer.phone,
      email: customer.email,
      stateCode: customer.stateCode,
      active: customer.active,
      creditLimitPaise: customer.creditLimitPaise,
      exposurePaise,
      // Clamped: a customer over their limit has no credit available, not a
      // negative amount of it, and a negative headroom reads as a refund.
      availableCreditPaise: Math.max(
        0,
        customer.creditLimitPaise - exposurePaise,
      ),
      outstandingPaise: customer.tradingLedgerEntries.reduce(
        (sum, entry) =>
          sum +
          (entry.entryType === "debit"
            ? entry.amountPaise
            : -entry.amountPaise),
        0,
      ),
      openCommitmentPaise: committed.reduce(
        (sum, order) => sum + order.totalPricePaise,
        0,
      ),
      openOrders: committed.length,
      pricing: customer.pricing
        .map((price) => ({
          productId: price.productId,
          productName: price.product.name,
          customPricePaise: price.customPricePaise,
        }))
        .sort((a, b) => a.productName.localeCompare(b.productName)),
      orders: customer.orders.map((order) => ({
        id: order.id,
        reference: order.reference,
        state: order.state,
        totalPricePaise: order.totalPricePaise,
        orderedUnits: order.lines.reduce((u, line) => u + line.qtyOrdered, 0),
        reservedUnits: order.reservations.reduce((u, r) => u + r.qtyUnits, 0),
        issuedUnits: order.lines.reduce((u, line) => u + line.qtyShipped, 0),
        createdAt: order.createdAt,
      })),
      invoices: customer.tradingInvoices.map((invoice) => {
        const paid = invoice.allocations.reduce(
          (p, payment) => p + payment.amountPaise,
          0,
        );
        const credited = invoice.notes
          .filter((note) => note.noteType === "credit")
          .reduce((c, note) => c + note.totalPaise, 0);
        const debited = invoice.notes
          .filter((note) => note.noteType === "debit")
          .reduce((d, note) => d + note.totalPaise, 0);
        return {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          issuedAt: invoice.issuedAt,
          totalPaise: invoice.totalPaise,
          paidPaise: paid,
          balancePaise: Math.max(
            0,
            invoice.totalPaise + debited - paid - credited,
          ),
          purchaseOrderId: invoice.purchaseOrderId,
          salesOrderId: invoice.salesOrderId,
        };
      }),
      payments: customer.tradingInvoices.flatMap((invoice) =>
        invoice.allocations.map(({ payment, amountPaise }) => ({
          id: payment.id,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          method: payment.method,
          amountPaise,
          reference: payment.reference,
          receivedAt: payment.receivedAt,
        })),
      ),
      ledger: customer.tradingLedgerEntries.map((entry) => {
        running +=
          entry.entryType === "debit" ? entry.amountPaise : -entry.amountPaise;
        return {
          id: entry.id,
          entryType: entry.entryType,
          amountPaise: entry.amountPaise,
          narration: entry.narration,
          occurredAt: entry.occurredAt,
          invoiceId: entry.invoiceId,
          runningBalancePaise: running,
        };
      }),
      activity: history
        .slice()
        .reverse()
        .map((entry) => ({
          occurredAt: entry.occurredAt,
          action: entry.action,
          before: entry.before ?? null,
          after: entry.after ?? null,
          actorUserId: entry.actorUserId,
          commandKey: entry.commandKey,
          kind: entry.kind,
        })),
    };
  },
};
