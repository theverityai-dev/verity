import { assertRegularRegistration } from "./business";
import { z } from "zod";

/**
 * A uuid no godown will ever have, so `location_id = ANY(...)` on an empty
 * reachable set matches nothing rather than being rendered as an empty array
 * some driver might treat as unconstrained. Empty means NOTHING here, always.
 */
const NO_GODOWN = "00000000-0000-0000-0000-000000000000";
import { sellerIdentity } from "./business";
import { resolveTaxRate } from "./tax";
import { assertPeriodOpen } from "./period";
import { reachableGodownIds } from "./scope";
import { businessZone, businessPeriodKey, tenantZone } from "./clock";
import {
  ValidationError,
  type CommandContext,
  type CommandDefinition,
} from "@/server/platform/command";
import { type QueryDefinition } from "@/server/platform/query";
import { resolveConfig } from "@/server/platform/capability";
import type { TenantScopedClient } from "@/server/platform/tenancy";
import { effectiveTimeZone } from "@/server/platform/temporal";
import {
  CONFIG_CGST_RATE_BP,
  CONFIG_IGST_RATE_BP,
  CONFIG_SGST_RATE_BP,
  CONFIG_TENANT_STATE_CODE,
  ENTITY_INVOICE,
  ENTITY_LEDGER_ENTRY,
  ENTITY_PAYMENT,
  ENTITY_PURCHASE_ORDER,
  ENTITY_STOCK_BALANCE,
} from "./keys";

/**
 * The order states a financial document may be raised against.
 *
 * Authority: taskplans/archive/45_plywood_workflow_program.md §5 (state machines) and
 * PLYWOOD_TARGET_WORKFLOW_GAP_AUDIT.md P0-03.
 *
 * Allow-lists, not deny-lists. When the Goods Issue and Goods Receipt
 * documents arrive, these sets tighten further — an invoice will be limited to
 * the quantity actually issued or received, rather than the quantity ordered —
 * and the sets are where that change belongs.
 */
const INVOICEABLE_SALES_ORDER_STATES = new Set([
  "approved",
  "dispatching",
  "completed",
]);

const INVOICEABLE_PURCHASE_ORDER_STATES = new Set([
  "submitted",
  // The implementation's name for Part Received. The rule freeze's state
  // machine (§5) calls it "Part Received"; renaming the stored value is a
  // migration on live orders and belongs to the slice that unifies the
  // vocabulary, not to a guard that would silently stop matching if it
  // guessed the new name early.
  "receiving",
  "completed",
]);

/**
 * PLYWOOD STAGE 6 — finance.
 *
 * Requirement source: plywood.md §1.4 and §1.5. Three decisions from
 * implementation/plywood-decisions.md land here.
 *
 * P2 — invoice numbers come from a counter row locked inside the invoice
 * transaction. Gapless is a legal requirement under GST, and a PostgreSQL
 * sequence cannot deliver it: sequences are non-transactional by design, so a
 * rolled-back invoice burns its number and the client explains the gap to a tax
 * officer.
 *
 * P3 — a party's balance is derived from the append-only ledger. Nothing caches
 * it. When a cache and a ledger disagree, nobody can say which is right.
 *
 * P4 — place of supply decides CGST + SGST against IGST. The rule is one
 * function, and it is deliberately NOT shared with Kent's: different rules,
 * capability-private both times. Merging them is how a "generic tax engine" gets
 * born.
 */

/* ================================== tax =================================== */

/**
 * A configuration value read as a number.
 *
 * `setConfig` stores JSON, and the two writers disagree about type: a test
 * writes `900`, while the Configuration screen writes what the operator typed,
 * which is `"900"`. JavaScript would coerce the string through the arithmetic
 * below and produce the right answer by accident — until somebody types `9 %`
 * and gets `NaN` silently folded into a tax figure.
 *
 * So it is converted once, here, and a value that is not a number is refused
 * rather than propagated. Tax is the last place to trust coercion.
 */
export function safeAggregate(value: bigint | number | string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new ValidationError("E_VALIDATION: this financial total exceeds the supported integer range");
  return result;
}

function configNumber(value: unknown, key: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed =
    typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed)) {
    throw new ValidationError(
      `E_VALIDATION: ${key} is not a number (${String(value)})`,
    );
  }
  return parsed;
}

/**
 * Indian financial years run April to March, so a calendar year would split an
 * invoice series across two of them — and a series that restarts mid-year is not
 * the gapless sequence GST asks for.
 */
export function financialYearOf(instant: Date, zone = "UTC"): string {
  const [year, month] = businessPeriodKey(zone, instant).split("-").map(Number);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/**
 * The place-of-supply rule (P4), whole, in one function.
 *
 * Same state is an intra-state supply and attracts CGST + SGST; different states
 * is inter-state and attracts IGST. Rates arrive in basis points — 2.5% is 250 —
 * because a percentage stored as a float is a rounding error waiting for a
 * filing.
 */
export function computeInvoiceTax(input: {
  taxablePaise: number;
  supplyStateCode: string;
  placeOfSupplyStateCode: string;
  cgstRateBp: number;
  sgstRateBp: number;
  igstRateBp: number;
}): {
  interState: boolean;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
} {
  const interState = input.supplyStateCode !== input.placeOfSupplyStateCode;

  const cgstPaise = interState
    ? 0
    : Math.round((input.taxablePaise * input.cgstRateBp) / 10_000);
  const sgstPaise = interState
    ? 0
    : Math.round((input.taxablePaise * input.sgstRateBp) / 10_000);
  const igstPaise = interState
    ? Math.round((input.taxablePaise * input.igstRateBp) / 10_000)
    : 0;

  return {
    interState,
    cgstPaise,
    sgstPaise,
    igstPaise,
    // No invoice-level rounding to the nearest rupee here, unlike Kent's bill:
    // a tax invoice must foot exactly to its own parts, and the CHECK constraint
    // on the column enforces that.
    totalPaise: input.taxablePaise + cgstPaise + sgstPaise + igstPaise,
  };
}

/**
 * Takes the next number in a series, gaplessly (P2).
 *
 * `SELECT ... FOR UPDATE` on the counter row inside the caller's transaction, so
 * two invoices raised at the same moment serialise rather than colliding, and a
 * rollback returns the number instead of burning it. The cost is that invoice
 * creation serialises per series; at this business's volume that is nothing.
 */
export async function nextDocumentNumber(
  tx: TenantScopedClient,
  tenantId: string,
  seriesKey: string,
  financialYear: string,
): Promise<{
  seriesId: string;
  sequenceNumber: number;
  invoiceNumber: string;
}> {
  await assertRegularRegistration(tx);
  // Also serializes an absent series row; row locks alone cannot do that.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([tenantId, seriesKey, financialYear])}, 0))`;
  const locked = await tx.$queryRaw<{ id: string; next_number: number }[]>`
    SELECT id, next_number
      FROM trading_invoice_series
     WHERE series_key = ${seriesKey}
       AND financial_year = ${financialYear}
     FOR UPDATE`;

  let seriesId: string;
  let sequenceNumber: number;

  if (locked[0]) {
    seriesId = locked[0].id;
    sequenceNumber = locked[0].next_number;
    await tx.tradingInvoiceSeries.update({
      where: { id: seriesId },
      data: { nextNumber: sequenceNumber + 1, version: { increment: 1 } },
    });
  } else {
    // First invoice in this series this year. The unique index on
    // (tenant, series, year) is what resolves two callers racing to create it.
    const created = await tx.tradingInvoiceSeries.create({
      data: { tenantId, seriesKey, financialYear, nextNumber: 2 },
    });
    seriesId = created.id;
    sequenceNumber = 1;
  }

  return {
    seriesId,
    sequenceNumber,
    invoiceNumber: `${seriesKey}/${financialYear}/${String(sequenceNumber).padStart(4, "0")}`,
  };
}

/**
 * Kept under its old name for the invoicing path, which is the only caller
 * that needs the series id back.
 *
 * The allocator itself is shared with Goods Receipt numbering (slice 3): a
 * receipt is a document a supplier dispute turns on, so it is numbered
 * gaplessly for the same reason an invoice is, and two implementations of
 * "allocate the next number" is how one of them ends up with gaps.
 */
const nextInvoiceNumber = nextDocumentNumber;

/* ================================ invoicing =============================== */

export type SalesInvoiceResult = {
  id: string;
  invoiceNumber: string;
  totalPaise: number;
  interState: boolean;
};

/**
 * Raises the sales invoice for an order that has issued goods.
 *
 * Extracted from the command so `dispatch_order` can call it directly when the
 * last line leaves the yard (Task 71 item 10). The product owner's complaint
 * was that nothing in finance happens by itself — a clerk records a sale, and
 * then has to know that a second, separately-named action turns it into money
 * owed. That is not a workflow a shop runs; it is an accounting chore bolted
 * onto one.
 *
 * The command stays, because raising an invoice deliberately — a different
 * series, a re-raise after a cancelled note — is a real thing to want. It is
 * now a second door onto the same room rather than the only one.
 */
export async function issueSalesInvoice(
  ctx: CommandContext,
  input: { salesOrderId: string; seriesKey?: string },
): Promise<SalesInvoiceResult> {
  {
    const order = await ctx.tx.tradingSalesOrder.findUniqueOrThrow({
      where: { id: input.salesOrderId },
      include: { lines: true, customer: true },
    });

    const existing = await ctx.tx.tradingInvoice.findFirst({
      where: { salesOrderId: order.id },
    });
    if (existing) {
      throw new ValidationError(
        "E_VALIDATION: this order has already been invoiced",
      );
    }
    // Audit P0-03. The previous guard rejected only `draft` and `cancelled`,
    // which let an order sitting in `pending_credit` be invoiced — a financial
    // document raised against credit the business had explicitly refused to
    // grant. Stated as an allow-list rather than a deny-list: a state added
    // later is then refused until somebody decides it should be invoiceable,
    // which is the safe direction to be wrong in.
    if (!INVOICEABLE_SALES_ORDER_STATES.has(order.state)) {
      throw new ValidationError(
        `E_VALIDATION: a sales order in ${order.state} cannot be invoiced; ` +
          "credit must be approved first",
      );
    }

    // Checked AFTER the state guard: an order awaiting credit approval has
    // also issued nothing, and "approve the credit" is the useful thing to
    // tell someone. The more specific refusal goes first.
    // Nothing has left the yard: there is nothing to bill for. Slice 4
    // completes P0-03 — the invoice follows the Goods Issue, not the order.
    const issuedTotal = order.lines.reduce(
      (sum, line) => sum + line.qtyShipped,
      0,
    );
    if (issuedTotal === 0) {
      throw new ValidationError(
        "E_VALIDATION: nothing has been issued against this order, so there is " +
          "nothing to invoice. Issue the goods first.",
      );
    }

    // The seller's identity comes from the GST registration (P0-09), not from
    // a configuration key. The key remains as a transitional fallback for
    // tenants provisioned before slice 2; it is removed when the effective-dated
    // tax rules land in slice 6, and until then a deployment that has completed
    // onboarding never reads it.
    const seller = await sellerIdentity(ctx.tx);
    const supplyStateCode =
      seller.stateCode ??
      String(
        (await resolveConfig<unknown>(ctx.tx, CONFIG_TENANT_STATE_CODE)) ?? "",
      ).trim();
    if (!supplyStateCode) {
      throw new ValidationError(
        "E_VALIDATION: this business has no GST registration, so tax cannot be decided. " +
          "Add one under Business Settings.",
      );
    }

    // Place of supply, in order of what the business actually knows:
    //
    // 1. The customer's recorded state.
    // 2. Failing that, the first two digits of their GSTIN — a registered
    //    buyer's state is a fact of the registration, not a field somebody
    //    has to remember to type twice.
    // 3. Failing both, the buyer is unregistered with no address on record:
    //    an over-the-counter sale, delivered at the seller's premises, whose
    //    place of supply IS the seller's state (IGST Act s.10(1)(c)).
    //
    // Rule freeze §4.4 refused case 3 outright, on the ground that a fallback
    // to the seller's state silently mislabels an interstate supply. That
    // guard stays exactly where it bites — a REGISTERED buyer never reaches
    // case 3, because case 2 answers from the GSTIN — and is withdrawn for
    // the walk-in buyer it was blocking (product owner, 2026-09-15: "I am not
    // able to raise invoice if a customer doesn't have state code"). The
    // resolved code is snapshotted onto the invoice either way, so a customer
    // who later moves state does not retrospectively change how it was taxed.
    const placeOfSupplyStateCode =
      order.customer.stateCode ??
      (order.customer.gstin ? order.customer.gstin.slice(0, 2) : null) ??
      supplyStateCode;

    // The day of supply. Declared before the rate lookup because the rate is
    // resolved AS AT this instant — the whole point of an effective-dated rule.
    const issuedAt = new Date();

    // Slice 7 (P0-08): nothing is posted into a period that has been reported.
    await assertPeriodOpen(ctx.tx, issuedAt);

    // THE RATE COMES FROM AN EFFECTIVE-DATED RULE (slice 6, P0-07).
    //
    // Resolved for the HSN on the line, under this registration, on the day of
    // supply. The three global configuration keys remain as a fallback for a
    // tenant that has not yet set any rules, and only as that: a business that
    // has completed tax setup never reads them, and the fallback is removed
    // when the last such tenant is migrated.
    //
    // ONE RATE PER INVOICE, DELIBERATELY
    // The invoice model carries one set of rates. A mixed-rate invoice — 18%
    // boards and 12% hardware on one document — needs line-level tax, which is
    // a schema change and its own task. Until then an invoice whose lines
    // resolve to DIFFERENT rates is refused rather than silently taxed at the
    // first one, because the second behaviour is wrong in a way nobody sees.
    //
    // One call rather than the two branches this used to carry. `ratesFor`
    // holds all three cases now — a registration with rules, no registration
    // at all, and (since HSN became optional on a product) a line whose HSN
    // has not been recorded yet, which takes the tenant's default rate rather
    // than refusing the sale.
    const {
      cgstRateBp,
      sgstRateBp,
      igstRateBp,
    }: { cgstRateBp?: number; sgstRateBp?: number; igstRateBp?: number } =
      await ratesFor(
        ctx.tx,
        order.lines.map((line) => line.hsnCodeSnapshot),
        issuedAt,
      );

    const taxablePaise = order.lines.reduce(
      // ISSUED, not ordered (audit P0-03, slice 4). Invoicing the ordered
      // quantity bills a customer for boards still sitting in the godown —
      // and on a partial issue it bills them for goods they have not been
      // given, which is the version of this defect that reaches a customer.
      (sum, line) => sum + line.qtyShipped * line.unitPricePaise,
      0,
    );
    // AN EXEMPT SUPPLY CARRIES NO TAX, and says why on its face.
    //
    // The rates are zeroed here rather than the resolution above being skipped,
    // so the reason this invoice has no tax is a recorded decision on the order
    // and not an accident of a missing rule. `interState` is still resolved
    // correctly, because place of supply matters to the return even when the
    // rate is nil.
    const exempt = order.taxExempt;
    const tax = computeInvoiceTax({
      taxablePaise,
      supplyStateCode,
      placeOfSupplyStateCode,
      cgstRateBp: exempt ? 0 : (cgstRateBp ?? 0),
      sgstRateBp: exempt ? 0 : (sgstRateBp ?? 0),
      igstRateBp: exempt ? 0 : (igstRateBp ?? 0),
    });

    const financialYear = financialYearOf(issuedAt, await tenantZone(ctx.tx));
    const numbering = await nextInvoiceNumber(
      ctx.tx,
      ctx.actor.tenantId,
      input.seriesKey ?? "SALES",
      financialYear,
    );

    const invoice = await ctx.tx.tradingInvoice.create({
      data: {
        tenantId: ctx.actor.tenantId,
        seriesId: numbering.seriesId,
        customerId: order.customerId,
        salesOrderId: order.id,
        invoiceNumber: numbering.invoiceNumber,
        sequenceNumber: numbering.sequenceNumber,
        financialYear,
        supplyStateCode,
        placeOfSupplyStateCode,
        // The seller's own identity, frozen with the document (P0-09). A
        // business that renames itself or re-registers must not restate an
        // invoice it has already given to a customer and reported.
        sellerLegalNameSnapshot: seller.legalName,
        sellerGstinSnapshot: seller.gstin,
        cgstRateBp: exempt || tax.interState ? 0 : (cgstRateBp ?? 0),
        sgstRateBp: exempt || tax.interState ? 0 : (sgstRateBp ?? 0),
        igstRateBp: !exempt && tax.interState ? (igstRateBp ?? 0) : 0,
        taxablePaise,
        cgstPaise: tax.cgstPaise,
        sgstPaise: tax.sgstPaise,
        igstPaise: tax.igstPaise,
        totalPaise: tax.totalPaise,
        // Snapshotted with the document: a reader asked about this invoice in a
        // year cannot go and look at an order that may since have been amended.
        taxExemptReason: exempt ? order.taxExemptReason : null,
        issuedAt,
      },
    });

    await ctx.tx.tradingInvoiceLine.createMany({
      data: order.lines.map((line) => ({
        tenantId: ctx.actor.tenantId,
        invoiceId: invoice.id,
        productId: line.productId,
        productNameSnapshot: line.productNameSnapshot,
        hsnCodeSnapshot: line.hsnCodeSnapshot,
        qtyUnits: line.qtyShipped,
        unitPricePaise: line.unitPricePaise,
        lineTotalPaise: line.qtyShipped * line.unitPricePaise,
      })),
    });

    // The customer now owes the invoice total. A debit from this business's
    // point of view, consistently — a ledger that flips perspective between
    // customers and suppliers is unreadable.
    await ctx.tx.tradingLedgerEntry.create({
      data: {
        tenantId: ctx.actor.tenantId,
        customerId: order.customerId,
        entryType: "debit",
        amountPaise: tax.totalPaise,
        invoiceId: invoice.id,
        narration: `Invoice ${numbering.invoiceNumber}`,
      },
    });

    // PAID ACROSS THE COUNTER SETTLES ITSELF.
    //
    // The order recorded whether the money was already in hand. If it was, the
    // payment is written here rather than left for somebody to remember —
    // otherwise a cash sale would sit on Who owes what as a debt that was
    // settled before the customer left the yard, and chasing it would be the
    // first anyone heard of the mistake.
    //
    // Recorded as a real payment with a real allocation, not as a flag on the
    // invoice: the money moved, and the cash book on Transactions has to show
    // it moving.
    if (order.paymentTerms === "prepaid" && tax.totalPaise > 0) {
      const payment = await ctx.tx.tradingPayment.create({
        data: {
          tenantId: ctx.actor.tenantId,
          invoiceId: invoice.id,
          customerId: order.customerId,
          direction: "in",
          method: "cash",
          amountPaise: tax.totalPaise,
          reference: `Paid on ${numbering.invoiceNumber}`,
          byUserId: ctx.actor.userId,
        },
      });
      await ctx.tx.tradingPaymentAllocation.create({
        data: {
          tenantId: ctx.actor.tenantId,
          paymentId: payment.id,
          invoiceId: invoice.id,
          amountPaise: tax.totalPaise,
        },
      });
      await ctx.tx.tradingLedgerEntry.create({
        data: {
          tenantId: ctx.actor.tenantId,
          customerId: order.customerId,
          entryType: "credit",
          amountPaise: tax.totalPaise,
          invoiceId: invoice.id,
          paymentId: payment.id,
          narration: `Paid at the counter against ${numbering.invoiceNumber}`,
        },
      });
    }

    return {
      id: invoice.id,
      invoiceNumber: numbering.invoiceNumber,
      totalPaise: tax.totalPaise,
      interState: tax.interState,
    };
  }
}

export const raiseSalesInvoice: CommandDefinition<
  { salesOrderId: string; seriesKey?: string },
  SalesInvoiceResult
> = {
  key: "verity.trading.raise_sales_invoice",
  entity: ENTITY_INVOICE,
  verb: "Create",
  input: z.object({
    salesOrderId: z.string().uuid(),
    seriesKey: z.string().min(1).max(20).optional(),
  }),
  handler: async (ctx, input) => {
    const result = await issueSalesInvoice(ctx, input);
    return {
      result,
      events: [
        { name: "verity.trading.sales_invoice_raised", entityId: result.id },
      ],
    };
  },
};

/**
 * Records the supplier's invoice against a purchase order.
 *
 * THE DEFECT THIS CLOSES (specification 30, 62). A purchase invoice used to
 * be stored with `taxablePaise = totalPaise` and every tax column at zero, on
 * the reasoning that the split is the supplier's and not ours to compute. The
 * reasoning is right and the conclusion was wrong: the consequence was that
 * **input credit was structurally always nil**. `taxSummary` read those zeros,
 * so eligible ITC came out at zero whatever the business had actually been
 * charged, every purchase invoice raised a `no_input_credit` exception, and
 * the net GST estimate overstated what was payable by the entire input side.
 * A business filing from that number pays its tax twice.
 *
 * So the split is RECORDED, not computed. These are the supplier's figures,
 * transcribed from their document. What is validated is only that the parts
 * add up to the total and that IGST does not appear alongside CGST/SGST —
 * both are transcription errors, and both belong on the exceptions list
 * rather than in a return.
 */
export const raisePurchaseInvoice: CommandDefinition<
  {
    purchaseOrderId: string;
    supplierInvoiceTotalPaise: number;
    /** The supplier's tax split, transcribed rather than computed. */
    taxablePaise?: number;
    cgstPaise?: number;
    sgstPaise?: number;
    igstPaise?: number;
    /** The supplier's own invoice number, for matching against GST records. */
    supplierInvoiceNumber?: string;
    seriesKey?: string;
  },
  { id: string; invoiceNumber: string }
> = {
  key: "verity.trading.raise_purchase_invoice",
  entity: ENTITY_INVOICE,
  verb: "Create",
  input: z.object({
    purchaseOrderId: z.string().uuid(),
    // The supplier's own figure. Recorded as given rather than recomputed: what
    // this business owes is what the supplier billed, and a mismatch with the
    // order is a conversation, not a silent correction.
    supplierInvoiceTotalPaise: z.number().int().min(0),
    taxablePaise: z.number().int().min(0).optional(),
    cgstPaise: z.number().int().min(0).optional(),
    sgstPaise: z.number().int().min(0).optional(),
    igstPaise: z.number().int().min(0).optional(),
    supplierInvoiceNumber: z.string().max(60).optional(),
    seriesKey: z.string().min(1).max(20).optional(),
  }),
  handler: async (ctx, input) => {
    const order = await ctx.tx.tradingPurchaseOrder.findUniqueOrThrow({
      where: { id: input.purchaseOrderId },
      include: { lines: true, supplier: true },
    });
    const existing = await ctx.tx.tradingInvoice.findFirst({
      where: { purchaseOrderId: order.id },
    });
    if (existing) {
      throw new ValidationError(
        "E_VALIDATION: this purchase order has already been invoiced",
      );
    }

    // Audit P0-03, the purchasing half: there was no state guard at all, so a
    // supplier invoice could be recorded against a draft or cancelled purchase
    // order — a payable for goods nobody had ordered.
    if (!INVOICEABLE_PURCHASE_ORDER_STATES.has(order.state)) {
      throw new ValidationError(
        `E_VALIDATION: a purchase order in ${order.state} cannot be invoiced; ` +
          "it must be submitted first",
      );
    }

    // Slice 3 tightens P0-03 on the purchasing side: an invoice is a claim for
    // goods, so there must be goods. A supplier invoice arriving before the
    // lorry is a real situation and a real problem — recording it as a payable
    // against nothing received is how a business pays for a delivery it never
    // got. A quantity or price DIFFERENCE is not refused here; that is a
    // conversation, and `purchaseMatch` names it.
    const receiptCount = await ctx.tx.tradingGoodsReceipt.count({
      where: { purchaseOrderId: order.id },
    });
    if (receiptCount === 0) {
      throw new ValidationError(
        "E_VALIDATION: nothing has been received against this purchase order, " +
          "so there is nothing to invoice. Record the goods receipt first.",
      );
    }

    const supplyStateCode =
      order.supplier.stateCode ??
      (await resolveConfig<string>(ctx.tx, CONFIG_TENANT_STATE_CODE)) ??
      "00";
    const placeOfSupplyStateCode =
      (await resolveConfig<string>(ctx.tx, CONFIG_TENANT_STATE_CODE)) ?? "00";

    const issuedAt = new Date();
    await assertPeriodOpen(ctx.tx, issuedAt);
    const financialYear = financialYearOf(issuedAt, await tenantZone(ctx.tx));
    const numbering = await nextInvoiceNumber(
      ctx.tx,
      ctx.actor.tenantId,
      input.seriesKey ?? "PURCHASE",
      financialYear,
    );

    // A purchase invoice records what was billed. The split is the supplier's,
    // transcribed rather than computed — but it is RECORDED, because a tax
    // column left at zero is not "unknown", it is a claim that no tax was
    // charged, and the input-credit side of every return reads it as one.
    const cgstPaise = input.cgstPaise ?? 0;
    const sgstPaise = input.sgstPaise ?? 0;
    const igstPaise = input.igstPaise ?? 0;
    const taxPaise = cgstPaise + sgstPaise + igstPaise;

    // The order says this supplier does not charge GST, and the document being
    // transcribed does. One of the two is wrong, and guessing which would
    // either book a credit that cannot be claimed or discard one that can.
    if (!order.gstApplicable && taxPaise > 0) {
      throw new ValidationError(
        "E_VALIDATION: this purchase order is marked as carrying no GST, but the " +
          "supplier's document shows tax. Turn GST back on for the order, or check " +
          "the figures.",
      );
    }
    // Defaulted rather than required, so an invoice can still be recorded from
    // a document whose split has not been read off yet. That case now surfaces
    // as an exception instead of silently costing the business its credit.
    const taxablePaise =
      input.taxablePaise ?? input.supplierInvoiceTotalPaise - taxPaise;

    if (taxablePaise < 0) {
      throw new ValidationError(
        "E_VALIDATION: the tax on this invoice exceeds its total; check the figures",
      );
    }
    if (taxablePaise + taxPaise !== input.supplierInvoiceTotalPaise) {
      throw new ValidationError(
        `E_VALIDATION: taxable ${taxablePaise} plus tax ${taxPaise} does not equal ` +
          `the invoice total ${input.supplierInvoiceTotalPaise}`,
      );
    }
    // Intra-state carries CGST and SGST; inter-state carries IGST. Both at once
    // is not a rate question, it is a transcription error, and it must not
    // reach a return.
    if (igstPaise > 0 && (cgstPaise > 0 || sgstPaise > 0)) {
      throw new ValidationError(
        "E_VALIDATION: an invoice carries either IGST or CGST+SGST, never both",
      );
    }

    const invoice = await ctx.tx.tradingInvoice.create({
      data: {
        tenantId: ctx.actor.tenantId,
        seriesId: numbering.seriesId,
        supplierId: order.supplierId,
        purchaseOrderId: order.id,
        invoiceNumber: numbering.invoiceNumber,
        sequenceNumber: numbering.sequenceNumber,
        financialYear,
        supplyStateCode,
        placeOfSupplyStateCode,
        taxablePaise,
        cgstPaise,
        sgstPaise,
        igstPaise,
        totalPaise: input.supplierInvoiceTotalPaise,
        issuedAt,
        // The supplier's own number, kept in custom fields rather than as a
        // column: it identifies THEIR document, and this table's
        // `invoiceNumber` is ours. Conflating the two would break our own
        // sequence guarantee.
        ...(input.supplierInvoiceNumber
          ? {
              customFields: {
                supplierInvoiceNumber: input.supplierInvoiceNumber,
              },
            }
          : {}),
      },
    });

    // Lines, so the purchase register has an HSN summary to file from (§60).
    // Quantities are what was RECEIVED, not what was ordered: the invoice is
    // for goods that arrived, and §29 wants an ordered-versus-received
    // difference shown rather than hidden inside a line.
    const receivedLines = order.lines.filter((line) => line.qtyReceived > 0);
    if (receivedLines.length > 0) {
      await ctx.tx.tradingInvoiceLine.createMany({
        data: receivedLines.map((line) => ({
          tenantId: ctx.actor.tenantId,
          invoiceId: invoice.id,
          productId: line.productId,
          productNameSnapshot: line.productNameSnapshot,
          hsnCodeSnapshot: line.hsnCodeSnapshot,
          qtyUnits: line.qtyReceived,
          unitPricePaise: line.unitCostPaise,
          lineTotalPaise: line.qtyReceived * line.unitCostPaise,
        })),
      });
    }

    // This business now owes the supplier. Credit, from the same point of view.
    await ctx.tx.tradingLedgerEntry.create({
      data: {
        tenantId: ctx.actor.tenantId,
        supplierId: order.supplierId,
        entryType: "credit",
        amountPaise: input.supplierInvoiceTotalPaise,
        invoiceId: invoice.id,
        narration: `Purchase invoice ${numbering.invoiceNumber}`,
      },
    });

    return {
      result: { id: invoice.id, invoiceNumber: numbering.invoiceNumber },
      events: [
        {
          name: "verity.trading.purchase_invoice_raised",
          entityId: invoice.id,
        },
      ],
    };
  },
};

/**
 * The tax rates in force for a set of HSN codes on a given day.
 *
 * One rate per document, for the reason `raiseSalesInvoice` gives: the invoice
 * model carries one set of rates, and a document whose lines resolve to
 * different ones is refused rather than silently taxed at whichever line was
 * read first.
 */
/**
 * The tenant's configured default rate, used in two places: when there is no
 * GST registration at all, and — since HSN became optional on a product — for
 * a line whose HSN nobody has recorded yet.
 *
 * Refused rather than defaulted to zero. A document computed at 0% is not
 * "tax unknown" — it is a statement that no tax was charged, and on a purchase
 * bill that statement costs the business its input credit.
 */
async function configuredFallbackRates(
  tx: TenantScopedClient,
): Promise<{ cgstRateBp: number; sgstRateBp: number; igstRateBp: number }> {
  const [rawCgst, rawSgst, rawIgst] = await Promise.all([
    resolveConfig<unknown>(tx, CONFIG_CGST_RATE_BP),
    resolveConfig<unknown>(tx, CONFIG_SGST_RATE_BP),
    resolveConfig<unknown>(tx, CONFIG_IGST_RATE_BP),
  ]);
  const cgstRateBp = configNumber(rawCgst, CONFIG_CGST_RATE_BP);
  const sgstRateBp = configNumber(rawSgst, CONFIG_SGST_RATE_BP);
  const igstRateBp = configNumber(rawIgst, CONFIG_IGST_RATE_BP);
  if (
    cgstRateBp === undefined ||
    sgstRateBp === undefined ||
    igstRateBp === undefined
  ) {
    throw new ValidationError(
      "E_VALIDATION: no GST registration and no fallback rates are configured, " +
        "so tax cannot be decided. Add a registration under Business Settings.",
    );
  }
  return { cgstRateBp, sgstRateBp, igstRateBp };
}

async function ratesFor(
  tx: TenantScopedClient,
  hsnCodes: Array<string | null>,
  on: Date,
): Promise<{ cgstRateBp: number; sgstRateBp: number; igstRateBp: number }> {
  const registration = await tx.tradingGstRegistration.findFirst({
    where: { active: true },
  });

  if (!registration) return configuredFallbackRates(tx);

  const seen = new Set<string>();
  let cgstRateBp = 0;
  let sgstRateBp = 0;
  // Resolved once and reused: the fallback is the same three numbers for every
  // line that needs it, and reading configuration inside the loop would hit
  // the database once per line to learn what it already knows.
  let fallback: Awaited<ReturnType<typeof configuredFallbackRates>> | null =
    null;
  for (const hsnCode of hsnCodes) {
    // HSN IS OPTIONAL ON A PRODUCT, so a line can genuinely have none. The
    // rate then comes from the tenant's default rather than refusing the
    // document: the client asked for HSN not to block the counter, and the
    // period-close checklist already lists every invoice missing one, so this
    // is deferred rather than lost.
    const rate =
      hsnCode == null
        ? (fallback ??= await configuredFallbackRates(tx))
        : await resolveTaxRate(tx, {
            registrationId: registration.id,
            hsnCode,
            on,
          });
    seen.add(`${rate.cgstRateBp}:${rate.sgstRateBp}`);
    cgstRateBp = rate.cgstRateBp;
    sgstRateBp = rate.sgstRateBp;
  }
  if (seen.size > 1) {
    throw new ValidationError(
      "E_VALIDATION: these lines attract different tax rates, and one document " +
        "carries one rate. Split them into one order per rate.",
    );
  }
  return { cgstRateBp, sgstRateBp, igstRateBp: cgstRateBp + sgstRateBp };
}

/**
 * Raises the supplier's bill from the order itself, at goods receipt.
 *
 * TASK 71 ITEM 7 — the complaint this exists for. Placing an order offered
 * "receive goods" and nothing else; the money side had to be raised by hand,
 * and doing so was refused with *"nothing has been received against this
 * purchase order, so there is nothing to invoice"*. That refusal is CORRECT —
 * a payable for goods that have not arrived is how a business pays for a
 * delivery it never got — and the fix is not to remove it. It is to stop
 * asking a person to raise the document at all, and to raise it at the moment
 * the goods actually arrive, which is the moment the money is genuinely owed.
 *
 * WHAT MAKES THIS BILL PROVISIONAL. Its figures come from the order's agreed
 * prices and its tax split from the effective HSN rules. Both are this
 * business's own view of what it was charged, not the supplier's. That is
 * enough to owe money against and to chase a payment, and it is NOT enough to
 * claim input credit — a computed split filed as though a supplier had issued
 * it is a false return. So no `trading_purchase_bill_confirmation` row is
 * written here, and every reader that files or claims must exclude bills that
 * have none. `confirmPurchaseBill` records the supplier's own document later.
 *
 * WHY AT COMPLETION, NOT AT EVERY RECEIPT. `plywood_invoice_one_per_purchase_
 * order` allows one invoice per order, and an invoice is immutable, so a bill
 * raised on the first of three deliveries could never grow to cover the other
 * two. Until the order is fully received its delivered value shows on the
 * payables view as received-not-yet-billed, which is the truth: the goods are
 * here, the supplier has not finished delivering, and no document exists yet.
 *
 * Returns null when there is nothing to bill or a bill already exists, so the
 * caller can stay indifferent to both.
 */
/**
 * The supplier's bill when the order says GST does not apply.
 *
 * An unregistered dealer and a composition dealer both charge the goods and no
 * tax. The document must still exist -- the business owes the money and the
 * payable has to appear on the ledger like any other -- so this writes the same
 * invoice, the same lines and the same ledger entry as the taxed path, with
 * every tax figure zero.
 *
 * Zero here is a STATEMENT, not a gap: it says no tax was charged, which is
 * true, and it is what stops the ITC reconciliation looking for a credit that
 * was never available. That is exactly why `ratesFor` refuses to default to
 * zero on the taxed path -- the same number means the opposite thing when
 * nobody decided it.
 *
 * The state codes are recorded for the record, not for arithmetic. With no tax
 * to split there is no intra/inter-state question to answer, so a supplier with
 * no state code is not a reason to refuse the bill the way it is when tax has
 * to be worked out.
 */
async function issueZeroTaxPurchaseBill(
  ctx: CommandContext,
  order: {
    id: string;
    supplierId: string;
    supplier: { stateCode: string | null };
  },
  received: Array<{
    productId: string;
    productNameSnapshot: string;
    hsnCodeSnapshot: string | null;
    qtyReceived: number;
    unitCostPaise: number;
  }>,
  issuedAt: Date,
): Promise<{ id: string; invoiceNumber: string; totalPaise: number }> {
  const totalPaise = received.reduce(
    (sum, line) => sum + line.qtyReceived * line.unitCostPaise,
    0,
  );

  const ourStateCode =
    (await sellerIdentity(ctx.tx)).stateCode ??
    String(
      (await resolveConfig<unknown>(ctx.tx, CONFIG_TENANT_STATE_CODE)) ?? "",
    ).trim();

  const financialYear = financialYearOf(issuedAt, await tenantZone(ctx.tx));
  const numbering = await nextInvoiceNumber(
    ctx.tx,
    ctx.actor.tenantId,
    "PURCHASE",
    financialYear,
  );

  const invoice = await ctx.tx.tradingInvoice.create({
    data: {
      tenantId: ctx.actor.tenantId,
      seriesId: numbering.seriesId,
      supplierId: order.supplierId,
      purchaseOrderId: order.id,
      invoiceNumber: numbering.invoiceNumber,
      sequenceNumber: numbering.sequenceNumber,
      financialYear,
      supplyStateCode: order.supplier.stateCode ?? ourStateCode,
      placeOfSupplyStateCode: ourStateCode,
      cgstRateBp: 0,
      sgstRateBp: 0,
      igstRateBp: 0,
      taxablePaise: totalPaise,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      totalPaise,
      issuedAt,
    },
  });

  await ctx.tx.tradingInvoiceLine.createMany({
    data: received.map((line) => ({
      tenantId: ctx.actor.tenantId,
      invoiceId: invoice.id,
      productId: line.productId,
      productNameSnapshot: line.productNameSnapshot,
      hsnCodeSnapshot: line.hsnCodeSnapshot,
      qtyUnits: line.qtyReceived,
      unitPricePaise: line.unitCostPaise,
      lineTotalPaise: line.qtyReceived * line.unitCostPaise,
    })),
  });

  await ctx.tx.tradingLedgerEntry.create({
    data: {
      tenantId: ctx.actor.tenantId,
      supplierId: order.supplierId,
      entryType: "credit",
      amountPaise: totalPaise,
      invoiceId: invoice.id,
      narration: `Purchase bill ${numbering.invoiceNumber} (no GST; awaiting supplier document)`,
    },
  });

  return { id: invoice.id, invoiceNumber: numbering.invoiceNumber, totalPaise };
}

export async function issueProvisionalPurchaseBill(
  ctx: CommandContext,
  purchaseOrderId: string,
): Promise<{ id: string; invoiceNumber: string; totalPaise: number } | null> {
  const order = await ctx.tx.tradingPurchaseOrder.findUniqueOrThrow({
    where: { id: purchaseOrderId },
    include: { lines: true, supplier: true },
  });

  const existing = await ctx.tx.tradingInvoice.findFirst({
    where: { purchaseOrderId: order.id },
  });
  if (existing) return null;

  const received = order.lines.filter((line) => line.qtyReceived > 0);
  if (received.length === 0) return null;

  const issuedAt = new Date();
  await assertPeriodOpen(ctx.tx, issuedAt);

  // GST TURNED OFF ON THE ORDER.
  //
  // An unregistered or composition supplier charges none, so there is nothing
  // to decide: no rate to resolve, no registration to require, no state codes
  // to compare, and no input credit to claim. Everything below this block
  // exists to work out how much tax was charged, and the honest answer here is
  // that none was — so the whole of it is skipped rather than run and then
  // multiplied by zero, which would still refuse the bill for a missing
  // registration the business does not need.
  if (!order.gstApplicable) {
    return issueZeroTaxPurchaseBill(ctx, order, received, issuedAt);
  }

  // The supply is the SUPPLIER's, so the supply state is theirs and the place
  // of supply is ours — the mirror of a sales invoice, and the reason a
  // supplier in another state bills IGST.
  const ourStateCode =
    (await sellerIdentity(ctx.tx)).stateCode ??
    String(
      (await resolveConfig<unknown>(ctx.tx, CONFIG_TENANT_STATE_CODE)) ?? "",
    ).trim();
  if (!ourStateCode) {
    throw new ValidationError(
      "E_VALIDATION: this business has no GST registration, so tax on a supplier " +
        "bill cannot be decided. Add one under Business Settings.",
    );
  }
  // A supplier with no state code is not guessed at. Defaulting to our own
  // would tax an interstate purchase as local, which claims the wrong credit
  // and fails in the direction that looks right on screen.
  if (!order.supplier.stateCode) {
    throw new ValidationError(
      `E_VALIDATION: ${order.supplier.displayName} has no state code, so tax on their ` +
        "bill cannot be decided. Add it on the supplier before receiving.",
    );
  }

  const rates = await ratesFor(
    ctx.tx,
    received.map((line) => line.hsnCodeSnapshot),
    issuedAt,
  );
  const taxablePaise = received.reduce(
    (sum, line) => sum + line.qtyReceived * line.unitCostPaise,
    0,
  );
  const tax = computeInvoiceTax({
    taxablePaise,
    supplyStateCode: order.supplier.stateCode,
    placeOfSupplyStateCode: ourStateCode,
    ...rates,
  });

  const financialYear = financialYearOf(issuedAt, await tenantZone(ctx.tx));
  const numbering = await nextInvoiceNumber(
    ctx.tx,
    ctx.actor.tenantId,
    "PURCHASE",
    financialYear,
  );

  const invoice = await ctx.tx.tradingInvoice.create({
    data: {
      tenantId: ctx.actor.tenantId,
      seriesId: numbering.seriesId,
      supplierId: order.supplierId,
      purchaseOrderId: order.id,
      invoiceNumber: numbering.invoiceNumber,
      sequenceNumber: numbering.sequenceNumber,
      financialYear,
      supplyStateCode: order.supplier.stateCode,
      placeOfSupplyStateCode: ourStateCode,
      cgstRateBp: tax.interState ? 0 : rates.cgstRateBp,
      sgstRateBp: tax.interState ? 0 : rates.sgstRateBp,
      igstRateBp: tax.interState ? rates.igstRateBp : 0,
      taxablePaise,
      cgstPaise: tax.cgstPaise,
      sgstPaise: tax.sgstPaise,
      igstPaise: tax.igstPaise,
      totalPaise: tax.totalPaise,
      issuedAt,
    },
  });

  await ctx.tx.tradingInvoiceLine.createMany({
    data: received.map((line) => ({
      tenantId: ctx.actor.tenantId,
      invoiceId: invoice.id,
      productId: line.productId,
      productNameSnapshot: line.productNameSnapshot,
      hsnCodeSnapshot: line.hsnCodeSnapshot,
      qtyUnits: line.qtyReceived,
      unitPricePaise: line.unitCostPaise,
      lineTotalPaise: line.qtyReceived * line.unitCostPaise,
    })),
  });

  await ctx.tx.tradingLedgerEntry.create({
    data: {
      tenantId: ctx.actor.tenantId,
      supplierId: order.supplierId,
      entryType: "credit",
      amountPaise: tax.totalPaise,
      invoiceId: invoice.id,
      narration: `Purchase bill ${numbering.invoiceNumber} (awaiting supplier document)`,
    },
  });

  return {
    id: invoice.id,
    invoiceNumber: numbering.invoiceNumber,
    totalPaise: tax.totalPaise,
  };
}

/**
 * Re-runs the automatic supplier bill for one order.
 *
 * REPORTED: raising a bill from the finance desk answered *"nothing has been
 * received against this purchase order, so there is nothing to invoice"* for an
 * order that had, and the desk was offering no other outstanding purchase.
 *
 * Two faults, both mine. The desk's retry called `raise_purchase_invoice`,
 * which requires a goods RECEIPT document, while the list that offered it was
 * built from `qty_received` on the line — a quantity an order can carry with no
 * receipt behind it, from data written before receipts were documents. So the
 * button appeared for orders the command would always refuse. And it passed the
 * order's pre-tax value as `supplierInvoiceTotalPaise`, which would have booked
 * a payable short by the whole GST if it had ever succeeded.
 *
 * The retry now runs exactly what goods receipt runs, with no figures guessed
 * by the caller, and the list is built from receipts.
 */
export const raisePurchaseBillFromOrder: CommandDefinition<
  { purchaseOrderId: string },
  { id: string; invoiceNumber: string; totalPaise: number }
> = {
  key: "verity.trading.raise_purchase_bill_from_order",
  entity: ENTITY_INVOICE,
  verb: "Create",
  input: z.object({ purchaseOrderId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const bill = await issueProvisionalPurchaseBill(ctx, input.purchaseOrderId);
    if (!bill) {
      throw new ValidationError(
        "E_VALIDATION: this order already has a bill, or nothing has been " +
          "received against it yet",
      );
    }
    return {
      result: bill,
      events: [
        {
          name: "verity.trading.purchase_bill_raised",
          entityId: bill.id,
        },
      ],
    };
  },
};

/**
 * Records the supplier's own document against a bill this system raised.
 *
 * Not an edit. `trading_invoice` is immutable by trigger and that rule is not
 * being weakened for convenience, so the supplier's number and figures are
 * appended as a confirmation and a money DIFFERENCE is corrected the way every
 * other posted difference is — a debit or credit note, which `raiseInvoiceNote`
 * already does. What this command changes is eligibility: an unconfirmed bill
 * is a payable but not a credit claim, and confirming it makes it both.
 */
export const confirmPurchaseBill: CommandDefinition<
  {
    invoiceId: string;
    supplierInvoiceNumber: string;
    supplierInvoiceDate: string;
    taxablePaise: number;
    cgstPaise?: number;
    sgstPaise?: number;
    igstPaise?: number;
    totalPaise: number;
  },
  { id: string; differencePaise: number }
> = {
  key: "verity.trading.confirm_purchase_bill",
  entity: ENTITY_INVOICE,
  verb: "Edit",
  input: z.object({
    invoiceId: z.string().uuid(),
    supplierInvoiceNumber: z.string().min(1).max(60),
    supplierInvoiceDate: z.string().min(1),
    taxablePaise: z.number().int().min(0),
    cgstPaise: z.number().int().min(0).optional(),
    sgstPaise: z.number().int().min(0).optional(),
    igstPaise: z.number().int().min(0).optional(),
    totalPaise: z.number().int().min(0),
  }),
  handler: async (ctx, input) => {
    const invoice = await ctx.tx.tradingInvoice.findUniqueOrThrow({
      where: { id: input.invoiceId },
      include: { confirmation: true },
    });
    if (!invoice.supplierId) {
      throw new ValidationError(
        "E_VALIDATION: only a purchase bill is confirmed against a supplier document",
      );
    }
    if (invoice.confirmation) {
      throw new ValidationError(
        `E_VALIDATION: this bill was already confirmed against ${invoice.confirmation.supplierInvoiceNumber}`,
      );
    }

    const cgstPaise = input.cgstPaise ?? 0;
    const sgstPaise = input.sgstPaise ?? 0;
    const igstPaise = input.igstPaise ?? 0;
    if (input.taxablePaise + cgstPaise + sgstPaise + igstPaise !== input.totalPaise) {
      throw new ValidationError(
        `E_VALIDATION: taxable ${input.taxablePaise} plus tax ` +
          `${cgstPaise + sgstPaise + igstPaise} does not equal the total ${input.totalPaise}`,
      );
    }
    if (igstPaise > 0 && (cgstPaise > 0 || sgstPaise > 0)) {
      throw new ValidationError(
        "E_VALIDATION: a bill carries either IGST or CGST+SGST, never both",
      );
    }

    const supplierInvoiceDate = new Date(input.supplierInvoiceDate);
    if (Number.isNaN(supplierInvoiceDate.getTime())) {
      throw new ValidationError(
        "E_VALIDATION: that supplier invoice date could not be read",
      );
    }

    await ctx.tx.tradingPurchaseBillConfirmation.create({
      data: {
        tenantId: ctx.actor.tenantId,
        invoiceId: invoice.id,
        supplierInvoiceNumber: input.supplierInvoiceNumber,
        supplierInvoiceDate,
        taxablePaise: input.taxablePaise,
        cgstPaise,
        sgstPaise,
        igstPaise,
        totalPaise: input.totalPaise,
        confirmedBy: ctx.actor.userId,
      },
    });

    // The difference is REPORTED, not posted. Posting it here would put a
    // correction into the books that nobody had decided to accept — the
    // supplier may be wrong, and the answer to a disagreement is a
    // conversation followed by a note, not a silent adjustment.
    const differencePaise = input.totalPaise - invoice.totalPaise;

    return {
      result: { id: invoice.id, differencePaise },
      events: [
        {
          name: "verity.trading.purchase_bill_confirmed",
          entityId: invoice.id,
          payload: { differencePaise },
        },
      ],
    };
  },
};

/** What one invoice still has outstanding, from its allocations. */
async function outstandingOnInvoice(
  tx: TenantScopedClient,
  invoiceId: string,
  totalPaise: number,
): Promise<number> {
  const allocated = await tx.tradingPaymentAllocation.aggregate({
    where: { invoiceId },
    _sum: { amountPaise: true },
  });
  const notes = await tx.tradingInvoiceNote.aggregate({
    where: { invoiceId },
    _sum: { totalPaise: true },
  });
  return totalPaise - (allocated._sum.amountPaise ?? 0) - (notes._sum.totalPaise ?? 0);
}

/**
 * Money moved, recorded against a party rather than a document.
 *
 * TASK 71 ITEM 11 — "record payment which asks us if we made a payment or
 * received, it can be from or to the suppliers/customers, then we add amount
 * and it automatically handles the finances."
 *
 * The existing `record_payment` required an invoice id, which meant the person
 * entering a cheque had to know which document it settled and enter it three
 * times when it settled three. That is bookkeeping, and this business wanted a
 * record of what happened.
 *
 * ALLOCATION IS OLDEST-FIRST. Not because a payer intends it, but because it
 * is the only rule that needs no further information, and every alternative
 * (largest first, by due date, by reference) silently guesses at an intention
 * the payer did not state. Anything left over is an ADVANCE, kept as an
 * unallocated payment on the party's account rather than refused — a customer
 * paying ahead is ordinary, and refusing it makes the record wrong rather than
 * the transaction impossible.
 */
export const recordPartyPayment: CommandDefinition<
  {
    party: { customerId: string } | { supplierId: string };
    direction: "in" | "out";
    amountPaise: number;
    method: "cash" | "bank" | "upi" | "cheque";
    reference?: string;
    receivedAt?: string;
  },
  {
    id: string;
    allocatedPaise: number;
    unallocatedPaise: number;
    settled: Array<{ invoiceNumber: string; amountPaise: number }>;
    balancePaise: number;
  }
> = {
  key: "verity.trading.record_party_payment",
  entity: ENTITY_PAYMENT,
  verb: "Create",
  input: z.object({
    party: z.union([
      z.object({ customerId: z.string().uuid() }),
      z.object({ supplierId: z.string().uuid() }),
    ]),
    direction: z.enum(["in", "out"]),
    amountPaise: z.number().int().positive(),
    method: z.enum(["cash", "bank", "upi", "cheque"]),
    reference: z.string().max(120).optional(),
    receivedAt: z.string().optional(),
  }),
  handler: async (ctx, input) => {
    const customerId = "customerId" in input.party ? input.party.customerId : null;
    const supplierId = "supplierId" in input.party ? input.party.supplierId : null;

    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
    if (Number.isNaN(receivedAt.getTime())) {
      throw new ValidationError("E_VALIDATION: that payment date could not be read");
    }
    await assertPeriodOpen(ctx.tx, receivedAt);

    // Existence is checked explicitly rather than left to the foreign key,
    // because a foreign-key violation surfaces as a database error a user
    // cannot act on.
    if (customerId) {
      await ctx.tx.tradingCustomer.findUniqueOrThrow({ where: { id: customerId } });
    } else if (supplierId) {
      await ctx.tx.tradingSupplier.findUniqueOrThrow({ where: { id: supplierId } });
    }

    const payment = await ctx.tx.tradingPayment.create({
      data: {
        tenantId: ctx.actor.tenantId,
        customerId,
        supplierId,
        direction: input.direction,
        method: input.method,
        amountPaise: input.amountPaise,
        reference: input.reference ?? null,
        receivedAt,
        byUserId: ctx.actor.userId,
      },
    });

    // Which invoices this payment can settle. Money IN settles what a customer
    // owes us; money OUT settles what we owe a supplier. A refund — money out
    // to a customer, or in from a supplier — settles nothing and is left
    // wholly unallocated, which is exactly right: it is a movement against the
    // account, not a settlement of a document.
    const settles =
      (input.direction === "in" && customerId) ||
      (input.direction === "out" && supplierId);

    const settled: Array<{ invoiceNumber: string; amountPaise: number }> = [];
    let remaining = input.amountPaise;

    if (settles) {
      const open = await ctx.tx.tradingInvoice.findMany({
        where: customerId ? { customerId } : { supplierId },
        orderBy: { issuedAt: "asc" },
      });
      for (const invoice of open) {
        if (remaining <= 0) break;
        const outstanding = await outstandingOnInvoice(
          ctx.tx,
          invoice.id,
          invoice.totalPaise,
        );
        if (outstanding <= 0) continue;
        const amountPaise = Math.min(outstanding, remaining);
        await ctx.tx.tradingPaymentAllocation.create({
          data: {
            tenantId: ctx.actor.tenantId,
            paymentId: payment.id,
            invoiceId: invoice.id,
            amountPaise,
          },
        });
        settled.push({ invoiceNumber: invoice.invoiceNumber, amountPaise });
        remaining -= amountPaise;
      }
    }

    // ONE ledger entry for the whole payment, not one per allocation. The
    // ledger records that money moved against this party; how it was split
    // across their documents is the allocation table's job, and writing it
    // twice would double the balance.
    await ctx.tx.tradingLedgerEntry.create({
      data: {
        tenantId: ctx.actor.tenantId,
        customerId,
        supplierId,
        // A customer paying us reduces what they owe: a credit. Paying a
        // supplier reduces what we owe them, which in this ledger's single
        // point of view — positive means owed to us — is a debit.
        entryType: input.direction === "in" ? "credit" : "debit",
        amountPaise: input.amountPaise,
        paymentId: payment.id,
        narration:
          settled.length > 0
            ? `${input.method} ${input.direction === "in" ? "received" : "paid"}, against ${settled
                .map((row) => row.invoiceNumber)
                .join(", ")}`
            : `${input.method} ${input.direction === "in" ? "received" : "paid"} on account`,
        occurredAt: receivedAt,
      },
    });

    return {
      result: {
        id: payment.id,
        allocatedPaise: input.amountPaise - remaining,
        unallocatedPaise: remaining,
        settled,
        balancePaise: await partyBalancePaise(ctx.tx, {
          ...(customerId ? { customerId } : {}),
          ...(supplierId ? { supplierId } : {}),
        }),
      },
      events: [
        { name: "verity.trading.payment_recorded", entityId: payment.id },
      ],
    };
  },
};

export const recordPayment: CommandDefinition<
  {
    invoiceId: string;
    amountPaise: number;
    method: "cash" | "bank" | "upi" | "cheque";
    reference?: string;
  },
  { id: string; outstandingPaise: number }
> = {
  key: "verity.trading.record_payment",
  entity: ENTITY_PAYMENT,
  verb: "Create",
  input: z.object({
    invoiceId: z.string().uuid(),
    amountPaise: z.number().int().positive(),
    method: z.enum(["cash", "bank", "upi", "cheque"]),
    reference: z.string().max(120).optional(),
  }),
  handler: async (ctx, input) => {
    const invoice = await ctx.tx.tradingInvoice.findUniqueOrThrow({
      where: { id: input.invoiceId },
    });

    // From ALLOCATIONS, not from payments joined on invoice_id. Since Task 71 a
    // payment is recorded against a party and allocated across documents, so a
    // payment that settled this invoice may carry a different invoice_id or
    // none at all. Summing payments would report such an invoice as unpaid and
    // let it be paid twice.
    const outstandingBefore = await outstandingOnInvoice(
      ctx.tx,
      invoice.id,
      invoice.totalPaise,
    );
    if (input.amountPaise > outstandingBefore) {
      // Refused rather than accepted as an overpayment. An overpayment is a real
      // event with its own treatment — an advance, or a refund — and quietly
      // absorbing it here would leave money the ledger cannot explain.
      throw new ValidationError(
        `E_VALIDATION: ${outstandingBefore} paise outstanding on this invoice, cannot receive more`,
      );
    }

    const payment = await ctx.tx.tradingPayment.create({
      data: {
        tenantId: ctx.actor.tenantId,
        invoiceId: invoice.id,
        // The party and direction the schema now requires. Taken from the
        // invoice rather than asked for: a payment against a sales invoice is
        // money in from that customer, and there is no other reading.
        customerId: invoice.customerId,
        supplierId: invoice.supplierId,
        direction: invoice.customerId ? "in" : "out",
        method: input.method,
        amountPaise: input.amountPaise,
        reference: input.reference ?? null,
        byUserId: ctx.actor.userId,
      },
    });

    // The allocation is what every outstanding read now sums. Without it this
    // payment would settle the invoice in the ledger and leave it looking
    // wholly unpaid on the desk.
    await ctx.tx.tradingPaymentAllocation.create({
      data: {
        tenantId: ctx.actor.tenantId,
        paymentId: payment.id,
        invoiceId: invoice.id,
        amountPaise: input.amountPaise,
      },
    });

    // The mirror of the invoice entry, so the two sum to what is still owed.
    await ctx.tx.tradingLedgerEntry.create({
      data: {
        tenantId: ctx.actor.tenantId,
        customerId: invoice.customerId,
        supplierId: invoice.supplierId,
        entryType: invoice.customerId ? "credit" : "debit",
        amountPaise: input.amountPaise,
        invoiceId: invoice.id,
        paymentId: payment.id,
        narration: `Payment against ${invoice.invoiceNumber}`,
      },
    });

    return {
      result: {
        id: payment.id,
        outstandingPaise: outstandingBefore - input.amountPaise,
      },
      events: [
        { name: "verity.trading.payment_recorded", entityId: payment.id },
      ],
    };
  },
};

/* ================================= reads ================================== */

/**
 * What a party owes, derived (P3).
 *
 * `SUM(debit) - SUM(credit)` over the append-only ledger. Positive means the
 * customer owes this business; for a supplier the sign is reversed by the entry
 * types, so a positive figure always means "owed to us" and a negative one
 * "owed by us".
 */
export async function partyBalancePaise(
  tx: TenantScopedClient,
  party: { customerId?: string; supplierId?: string },
): Promise<number> {
  const rows = await tx.$queryRaw<{ balance: bigint | null }[]>`
    SELECT COALESCE(SUM(CASE WHEN entry_type = 'debit' THEN amount_paise ELSE -amount_paise END), 0)::bigint AS balance
      FROM trading_ledger_entry
     WHERE (${party.customerId ?? null}::uuid IS NULL OR customer_id = ${party.customerId ?? null}::uuid)
       AND (${party.supplierId ?? null}::uuid IS NULL OR supplier_id = ${party.supplierId ?? null}::uuid)
       AND (${party.customerId ?? null}::uuid IS NOT NULL OR customer_id IS NULL)
       AND (${party.supplierId ?? null}::uuid IS NOT NULL OR supplier_id IS NULL)`;
  return safeAggregate(rows[0]?.balance ?? 0);
}

export const outstandingReceivables: QueryDefinition<
  Record<string, never>,
  Array<{
    customerId: string;
    customerName: string;
    invoicedPaise: number;
    receivedPaise: number;
    outstandingPaise: number;
    oldestUnpaidAt: Date | null;
  }>
> = {
  key: "verity.trading.outstanding_receivables",
  entity: ENTITY_LEDGER_ENTRY,
  input: z.object({}),
  handler: async (ctx) => {
    const invoices = await ctx.tx.tradingInvoice.findMany({
      where: { customerId: { not: null } },
      include: { customer: { select: { displayName: true } }, allocations: true },
    });

    const byCustomer = new Map<
      string,
      {
        customerId: string;
        customerName: string;
        invoicedPaise: number;
        receivedPaise: number;
        outstandingPaise: number;
        oldestUnpaidAt: Date | null;
      }
    >();

    for (const invoice of invoices) {
      const customerId = invoice.customerId!;
      // Allocations, not payments: a party payment settles documents through
      // the allocation table and carries no invoice_id of its own.
      const paid = invoice.allocations.reduce(
        (sum, allocation) => sum + allocation.amountPaise,
        0,
      );
      const outstanding = invoice.totalPaise - paid;
      const row = byCustomer.get(customerId) ?? {
        customerId,
        customerName: invoice.customer!.displayName,
        invoicedPaise: 0,
        receivedPaise: 0,
        outstandingPaise: 0,
        oldestUnpaidAt: null,
      };
      row.invoicedPaise += invoice.totalPaise;
      row.receivedPaise += paid;
      row.outstandingPaise += outstanding;
      // The age of the oldest unpaid invoice is what a collections call is
      // about, so it is carried rather than left to be derived from a list.
      if (
        outstanding > 0 &&
        (!row.oldestUnpaidAt || invoice.issuedAt < row.oldestUnpaidAt)
      ) {
        row.oldestUnpaidAt = invoice.issuedAt;
      }
      byCustomer.set(customerId, row);
    }

    return [...byCustomer.values()]
      .filter((row) => row.outstandingPaise !== 0)
      .sort((a, b) => b.outstandingPaise - a.outstandingPaise);
  },
};

/**
 * Everything owed, in both directions, in one read.
 *
 * TASK 71 ITEM 10 — "finance is completely useless right now, nothing is
 * linked to it". The desk had a list of invoices and no answer to the two
 * questions a proprietor actually asks: who owes me, and who do I owe.
 *
 * `uninvoicedPaise` is the honest half of the answer. Goods received against a
 * part-delivered order are a real obligation with no document yet, because a
 * purchase order carries one invoice and it is raised when the order completes
 * (see `issueProvisionalPurchaseBill`). Leaving that value out would show a
 * payables figure lower than what the business will actually pay; showing it
 * inside the invoiced figure would claim a document exists. It is its own
 * column.
 */
/**
 * Orders whose goods have moved but which carry no document.
 *
 * Since Task 71 a delivery raises the customer's invoice and a receipt raises
 * the supplier's bill, both automatically. So an order in this list is a
 * FAILURE, not a queue — something refused the automatic raise, almost always a
 * missing GST state code on the party — and the finance desk presents it as a
 * repair with a retry rather than as work waiting to be done.
 *
 * It cannot be answered from `openOrders`, which deliberately excludes
 * completed orders: a fully received purchase order whose bill was refused is
 * exactly the case that matters and exactly the case that query drops.
 */
export const unbilledMovements: QueryDefinition<
  Record<string, never>,
  {
    sales: Array<{
      id: string;
      customerName: string;
      reference: string | null;
      valuePaise: number;
    }>;
    purchases: Array<{
      id: string;
      supplierName: string;
      reference: string | null;
      valuePaise: number;
    }>;
  }
> = {
  key: "verity.trading.unbilled_movements",
  entity: ENTITY_INVOICE,
  input: z.object({}),
  handler: async (ctx) => {
    const salesOrders = await ctx.tx.tradingSalesOrder.findMany({
      where: {
        state: { notIn: ["draft", "cancelled"] },
        tradingInvoices: { none: {} },
        goodsIssues: { some: {} },
      },
      include: { lines: true, customer: { select: { displayName: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const purchaseOrders = await ctx.tx.tradingPurchaseOrder.findMany({
      where: {
        // Completed only. A part-received order has no bill BY DESIGN — one
        // invoice per order, raised when the last delivery lands — so listing
        // it here would report correct behaviour as a fault.
        state: "completed",
        tradingInvoices: { none: {} },
        // A RECEIPT, not a received quantity. `qty_received` can be non-zero on
        // an order with no receipt document behind it — data written before
        // receipts became documents does exactly that — and the bill is raised
        // from receipts. Listing such an order offered a button that could only
        // ever be refused.
        goodsReceipts: { some: {} },
      },
      include: { lines: true, supplier: { select: { displayName: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return {
      sales: salesOrders.map((order) => ({
        id: order.id,
        customerName: order.customer.displayName,
        reference: order.reference,
        // What was actually SHIPPED, which is what the invoice would be for.
        valuePaise: order.lines.reduce(
          (sum, line) => sum + line.qtyShipped * line.unitPricePaise,
          0,
        ),
      })),
      purchases: purchaseOrders.map((order) => ({
        id: order.id,
        supplierName: order.supplier.displayName,
        reference: order.reference,
        valuePaise: order.lines.reduce(
          (sum, line) => sum + line.qtyReceived * line.unitCostPaise,
          0,
        ),
      })),
    };
  },
};

/**
 * Every movement of money, both directions, newest first.
 *
 * REPORTED: "there should be a whole record of payments being received and
 * being sent, no matter from whom or to whom."
 *
 * `partyLedger` answers "what happened with this one party" and needs a party
 * chosen before it says anything. That is the wrong question for a proprietor
 * closing the day, whose question is "what money moved". This is that list, and
 * it is deliberately about PAYMENTS rather than ledger entries: an invoice is
 * also a ledger entry, and mixing documents into a cash book is how a cash book
 * stops being one.
 */
export const paymentJournal: QueryDefinition<
  { limit?: number },
  Array<{
    id: string;
    direction: "in" | "out";
    partyId: string;
    partyName: string;
    partySide: "customer" | "supplier";
    method: string;
    reference: string | null;
    amountPaise: number;
    allocatedPaise: number;
    receivedAt: Date;
    settled: string[];
  }>
> = {
  key: "verity.trading.payment_journal",
  entity: ENTITY_PAYMENT,
  input: z.object({ limit: z.number().int().min(1).max(500).optional() }),
  handler: async (ctx, input) => {
    const payments = await ctx.tx.tradingPayment.findMany({
      include: {
        customer: { select: { id: true, displayName: true } },
        supplier: { select: { id: true, displayName: true } },
        allocations: {
          include: { invoice: { select: { invoiceNumber: true } } },
        },
      },
      orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
      take: input.limit ?? 200,
    });

    return payments.map((payment) => {
      const party = payment.customer ?? payment.supplier;
      return {
        id: payment.id,
        direction: payment.direction === "out" ? ("out" as const) : ("in" as const),
        partyId: party?.id ?? "",
        partyName: party?.displayName ?? "—",
        partySide: payment.customerId
          ? ("customer" as const)
          : ("supplier" as const),
        method: payment.method,
        reference: payment.reference,
        amountPaise: payment.amountPaise,
        allocatedPaise: payment.allocations.reduce(
          (sum, allocation) => sum + allocation.amountPaise,
          0,
        ),
        receivedAt: payment.receivedAt,
        settled: payment.allocations.map(
          (allocation) => allocation.invoice.invoiceNumber,
        ),
      };
    });
  },
};

export const partyBalances: QueryDefinition<
  { side?: "customer" | "supplier" },
  Array<{
    partyId: string;
    partyName: string;
    side: "customer" | "supplier";
    invoicedPaise: number;
    settledPaise: number;
    outstandingPaise: number;
    /** Received or issued, no document yet. Zero for customers. */
    uninvoicedPaise: number;
    /**
     * Money that flowed in the direction that settles THIS party's obligation
     * but has not been matched to a document — a customer paying ahead, or a
     * supplier we have paid ahead. It reduces what they owe.
     */
    onAccountPaise: number;
    /**
     * Unmatched money that flowed the OTHER way: cash we handed a customer, or
     * cash a supplier sent us. It increases what they owe, and treating it like
     * the field above — which is what this query used to do — reverses the sign
     * of a real obligation.
     */
    counterAdvancePaise: number;
    oldestOpenAt: Date | null;
    provisionalBills: number;
    /**
     * The same business on the other side of the trade, when the two have been
     * linked. Carried so a reader can be shown one relationship instead of two
     * rows that happen to share a name.
     */
    sameBusinessAs: string | null;
  }>
> = {
  key: "verity.trading.party_balances",
  entity: ENTITY_LEDGER_ENTRY,
  input: z.object({ side: z.enum(["customer", "supplier"]).optional() }),
  handler: async (ctx, input) => {
    const rows: Array<{
      partyId: string;
      partyName: string;
      side: "customer" | "supplier";
      invoicedPaise: number;
      settledPaise: number;
      outstandingPaise: number;
      uninvoicedPaise: number;
      onAccountPaise: number;
      counterAdvancePaise: number;
      oldestOpenAt: Date | null;
      provisionalBills: number;
      sameBusinessAs: string | null;
    }> = [];

    const sides: Array<"customer" | "supplier"> = input.side
      ? [input.side]
      : ["customer", "supplier"];

    // Suppliers that are the same business as a customer, both ways round, so
    // either row can name its counterpart without a second query per row.
    const links = await ctx.tx.tradingSupplier.findMany({
      where: { linkedCustomerId: { not: null } },
      select: { id: true, linkedCustomerId: true },
    });
    const sameBusiness = new Map<string, string>();
    for (const link of links) {
      if (!link.linkedCustomerId) continue;
      sameBusiness.set(link.id, link.linkedCustomerId);
      sameBusiness.set(link.linkedCustomerId, link.id);
    }

    for (const side of sides) {
      const invoices = await ctx.tx.tradingInvoice.findMany({
        where:
          side === "customer"
            ? { customerId: { not: null } }
            : { supplierId: { not: null } },
        include: {
          allocations: true,
          confirmation: { select: { id: true } },
          customer: { select: { id: true, displayName: true } },
          supplier: { select: { id: true, displayName: true } },
          notes: { select: { totalPaise: true } },
        },
        orderBy: { issuedAt: "asc" },
      });

      const byParty = new Map<string, (typeof rows)[number]>();

      for (const invoice of invoices) {
        const party =
          side === "customer" ? invoice.customer : invoice.supplier;
        if (!party) continue;
        const settled = invoice.allocations.reduce(
          (sum, allocation) => sum + allocation.amountPaise,
          0,
        );
        const noted = invoice.notes.reduce(
          (sum, note) => sum + note.totalPaise,
          0,
        );
        const outstanding = invoice.totalPaise - settled - noted;

        const row =
          byParty.get(party.id) ??
          ({
            partyId: party.id,
            partyName: party.displayName,
            side,
            invoicedPaise: 0,
            settledPaise: 0,
            outstandingPaise: 0,
            uninvoicedPaise: 0,
            onAccountPaise: 0,
            counterAdvancePaise: 0,
            oldestOpenAt: null,
            provisionalBills: 0,
            sameBusinessAs: sameBusiness.get(party.id) ?? null,
          } satisfies (typeof rows)[number]);

        row.invoicedPaise += invoice.totalPaise;
        row.settledPaise += settled;
        row.outstandingPaise += outstanding;
        if (side === "supplier" && !invoice.confirmation) {
          row.provisionalBills += 1;
        }
        if (outstanding > 0 && row.oldestOpenAt === null) {
          row.oldestOpenAt = invoice.issuedAt;
        }
        byParty.set(party.id, row);
      }

      // Unmatched money — paid or received with no document to settle.
      //
      // TWO BUGS LIVED HERE, and together they are the reported one: "I sent a
      // customer some amount and after that it wasn't shown in who owes what."
      //
      // First, a party with no invoices was dropped outright — the row was
      // looked up and `continue`d when absent, so a customer we had only ever
      // paid never appeared anywhere. The row is created here now.
      //
      // Second, direction was ignored. Cash handed TO a customer is not the
      // same event as cash received FROM one: the first means they owe us that
      // money back, the second means they have paid ahead. Adding both to one
      // subtracted figure reversed the sign of a real obligation.
      const payments = await ctx.tx.tradingPayment.findMany({
        where:
          side === "customer"
            ? { customerId: { not: null } }
            : { supplierId: { not: null } },
        include: {
          allocations: { select: { amountPaise: true } },
          customer: { select: { id: true, displayName: true } },
          supplier: { select: { id: true, displayName: true } },
        },
      });
      for (const payment of payments) {
        const party =
          side === "customer" ? payment.customer : payment.supplier;
        if (!party) continue;
        const allocated = payment.allocations.reduce(
          (sum, allocation) => sum + allocation.amountPaise,
          0,
        );
        const unallocated = payment.amountPaise - allocated;
        if (unallocated <= 0) continue;

        const row =
          byParty.get(party.id) ??
          ({
            partyId: party.id,
            partyName: party.displayName,
            side,
            invoicedPaise: 0,
            settledPaise: 0,
            outstandingPaise: 0,
            uninvoicedPaise: 0,
            onAccountPaise: 0,
            counterAdvancePaise: 0,
            oldestOpenAt: null,
            provisionalBills: 0,
            sameBusinessAs: sameBusiness.get(party.id) ?? null,
          } satisfies (typeof rows)[number]);

        // Money moving in the direction that settles THIS party's obligation
        // reduces it; money moving the other way increases it. Symmetric across
        // both sides: a customer's payment in and our payment to a supplier are
        // the same kind of event seen from opposite ends of the trade.
        const settlesTheirObligation =
          side === "customer"
            ? payment.direction === "in"
            : payment.direction === "out";
        if (settlesTheirObligation) {
          row.onAccountPaise += unallocated;
        } else {
          row.counterAdvancePaise += unallocated;
        }
        byParty.set(party.id, row);
      }

      if (side === "customer") {
        // ORDERED ON CREDIT, NOT YET BILLED.
        //
        // Reported: "if I already owe someone ₹1000 and they order ₹5000 worth
        // of goods, it should simplify it and tell me they owe ₹4000. It is
        // currently only updating on the sales page under customers."
        //
        // Right: an order taken on credit is money the customer will owe, and
        // showing it only against a credit LIMIT answers a different question
        // than "where do we stand". It is carried as its own figure rather than
        // folded into the invoiced total — no document exists yet — and it nets
        // against anything they have paid ahead, which is the arithmetic the
        // example asks for.
        //
        // Prepaid orders are excluded: that money is already in hand and
        // counting it as owed would invent a debt.
        const committed = await ctx.tx.tradingSalesOrder.findMany({
          where: {
            state: { notIn: ["draft", "cancelled"] },
            paymentTerms: "credit",
            tradingInvoices: { none: {} },
          },
          include: { customer: { select: { id: true, displayName: true } } },
        });
        for (const order of committed) {
          if (order.totalPricePaise <= 0) continue;
          const row =
            byParty.get(order.customerId) ??
            ({
              partyId: order.customerId,
              partyName: order.customer.displayName,
              side,
              invoicedPaise: 0,
              settledPaise: 0,
              outstandingPaise: 0,
              uninvoicedPaise: 0,
              onAccountPaise: 0,
              counterAdvancePaise: 0,
              oldestOpenAt: null,
              provisionalBills: 0,
              sameBusinessAs: sameBusiness.get(order.customerId) ?? null,
            } satisfies (typeof rows)[number]);
          row.uninvoicedPaise += order.totalPricePaise;
          byParty.set(order.customerId, row);
        }
      }

      if (side === "supplier") {
        // Delivered but not yet billed: sum over orders that have received
        // something and carry no invoice. This is the figure that keeps the
        // payables total honest on a part-delivered order.
        const openOrders = await ctx.tx.tradingPurchaseOrder.findMany({
          where: {
            state: { notIn: ["draft", "cancelled"] },
            tradingInvoices: { none: {} },
          },
          include: {
            lines: true,
            supplier: { select: { id: true, displayName: true } },
          },
        });
        for (const order of openOrders) {
          const value = order.lines.reduce(
            (sum, line) => sum + line.qtyReceived * line.unitCostPaise,
            0,
          );
          if (value <= 0) continue;
          const row =
            byParty.get(order.supplierId) ??
            ({
              partyId: order.supplierId,
              partyName: order.supplier.displayName,
              side,
              invoicedPaise: 0,
              settledPaise: 0,
              outstandingPaise: 0,
              uninvoicedPaise: 0,
              onAccountPaise: 0,
              counterAdvancePaise: 0,
              oldestOpenAt: null,
              provisionalBills: 0,
              sameBusinessAs: sameBusiness.get(order.supplierId) ?? null,
            } satisfies (typeof rows)[number]);
          row.uninvoicedPaise += value;
          byParty.set(order.supplierId, row);
        }
      }

      for (const row of byParty.values()) {
        // A party who owes nothing, is owed nothing and has nothing on account
        // is not a balance; listing them makes the real ones harder to find.
        if (
          row.outstandingPaise === 0 &&
          row.uninvoicedPaise === 0 &&
          row.onAccountPaise === 0 &&
          row.counterAdvancePaise === 0
        ) {
          continue;
        }
        rows.push(row);
      }
    }

    return rows.sort(
      (a, b) =>
        b.outstandingPaise + b.uninvoicedPaise -
        (a.outstandingPaise + a.uninvoicedPaise),
    );
  },
};

/**
 * One business's ledger, both sides of the trade together when they are
 * linked, and every obligation — not only the ones with a document yet.
 *
 * Requested 2026-09-15: "the ledger should contain all transactions that
 * are already made, or if we or they owe something." Two changes:
 *
 * 1. A linked customer+supplier is ONE ledger. Pass both ids and the
 *    entries interleave by date under one running balance.
 * 2. Money owed with no invoice yet — an order taken on credit, goods
 *    received and not yet billed — appears as a PENDING line, flagged, so
 *    the balance at the foot agrees with "Who owes what". It used to show
 *    only `trading_ledger_entry` rows, and a customer with ₹50,000 ordered
 *    on credit read as owing nothing here while owing ₹50,000 there.
 *
 * SIGN: positive means they owe us, on both sides. A customer's invoice is
 * a debit (+), their payment a credit (−); a supplier's bill is a credit
 * (−), our payment to them a debit (+). Same rule the ledger rows already
 * carry, so the two sides sum without translation.
 */
export const partyLedger: QueryDefinition<
  { customerId?: string; supplierId?: string },
  {
    balancePaise: number;
    entries: Array<{
      id: string;
      side: "customer" | "supplier";
      entryType: string;
      amountPaise: number;
      narration: string | null;
      occurredAt: Date;
      runningBalancePaise: number;
      /** Owed with no document yet — an order on credit, goods received unbilled. */
      pending: boolean;
    }>;
  }
> = {
  key: "verity.trading.party_ledger",
  entity: ENTITY_LEDGER_ENTRY,
  input: z.object({
    customerId: z.string().uuid().optional(),
    supplierId: z.string().uuid().optional(),
  }),
  handler: async (ctx, input) => {
    if (!input.customerId && !input.supplierId) {
      throw new ValidationError("E_VALIDATION: name at least one party");
    }

    type Row = {
      id: string;
      side: "customer" | "supplier";
      entryType: string;
      amountPaise: number;
      narration: string | null;
      occurredAt: Date;
      pending: boolean;
    };
    const rows: Row[] = [];

    const entries = await ctx.tx.tradingLedgerEntry.findMany({
      where: {
        OR: [
          ...(input.customerId ? [{ customerId: input.customerId }] : []),
          ...(input.supplierId ? [{ supplierId: input.supplierId }] : []),
        ],
      },
      orderBy: { occurredAt: "asc" },
    });
    for (const entry of entries) {
      rows.push({
        id: entry.id,
        side: entry.customerId ? "customer" : "supplier",
        entryType: entry.entryType,
        amountPaise: entry.amountPaise,
        narration: entry.narration,
        occurredAt: entry.occurredAt,
        pending: false,
      });
    }

    if (input.customerId) {
      // The same rule `partyBalances` applies: credit orders with no invoice.
      const committed = await ctx.tx.tradingSalesOrder.findMany({
        where: {
          customerId: input.customerId,
          state: { notIn: ["draft", "cancelled"] },
          paymentTerms: "credit",
          tradingInvoices: { none: {} },
        },
        select: { id: true, reference: true, totalPricePaise: true, createdAt: true },
      });
      for (const order of committed) {
        if (order.totalPricePaise <= 0) continue;
        rows.push({
          id: `pending-so-${order.id}`,
          side: "customer",
          entryType: "debit",
          amountPaise: order.totalPricePaise,
          narration: `Order ${order.reference ?? order.id.slice(0, 8)} taken on credit — not yet billed`,
          occurredAt: order.createdAt,
          pending: true,
        });
      }
    }

    if (input.supplierId) {
      const openOrders = await ctx.tx.tradingPurchaseOrder.findMany({
        where: {
          supplierId: input.supplierId,
          state: { notIn: ["draft", "cancelled"] },
          tradingInvoices: { none: {} },
        },
        select: { id: true, reference: true, createdAt: true, lines: { select: { qtyReceived: true, unitCostPaise: true } } },
      });
      for (const order of openOrders) {
        const value = order.lines.reduce((sum, line) => sum + line.qtyReceived * line.unitCostPaise, 0);
        if (value <= 0) continue;
        rows.push({
          id: `pending-po-${order.id}`,
          side: "supplier",
          entryType: "credit",
          amountPaise: value,
          narration: `Goods received on order ${order.reference ?? order.id.slice(0, 8)} — not yet billed`,
          occurredAt: order.createdAt,
          pending: true,
        });
      }
    }

    rows.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    // The running balance is computed for DISPLAY and never stored (P3). A
    // stored one would be a second source of truth that can disagree with the
    // entries it summarises.
    let running = 0;
    const out = rows.map((entry) => {
      running += entry.entryType === "debit" ? entry.amountPaise : -entry.amountPaise;
      return { ...entry, runningBalancePaise: running };
    });

    return { balancePaise: running, entries: out };
  },
};

export const invoiceDetail: QueryDefinition<
  { invoiceId: string },
  {
    id: string;
    invoiceNumber: string;
    direction: "sales" | "purchase";
    /// Carried so the document can link back to the records that produced it
    /// (§70, §71). Without these the invoice is a dead end: the reader has the
    /// figure and no way to reach the order or the party behind it.
    customerId: string | null;
    supplierId: string | null;
    salesOrderId: string | null;
    purchaseOrderId: string | null;
    partyName: string;
    /// Legally required on a tax invoice alongside the supplier's own.
    partyGstin: string | null;
    issuedAt: Date;
    interState: boolean;
    supplyStateCode: string;
    placeOfSupplyStateCode: string;
    /// Basis points, as they were when the invoice was raised. A rate change
    /// next quarter must not restate a filed document, so these are read from
    /// the invoice rather than from configuration.
    cgstRateBp: number;
    sgstRateBp: number;
    igstRateBp: number;
    taxablePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    totalPaise: number;
    paidPaise: number;
    outstandingPaise: number;
    payments: Array<{
      method: string;
      amountPaise: number;
      reference: string | null;
      receivedAt: Date;
    }>;
    lines: Array<{
      name: string;
      hsnCode: string | null;
      qtyUnits: number;
      unitPricePaise: number;
      lineTotalPaise: number;
    }>;
  } | null
> = {
  key: "verity.trading.invoice_detail",
  entity: ENTITY_INVOICE,
  input: z.object({ invoiceId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const invoice = await ctx.tx.tradingInvoice.findUnique({
      where: { id: input.invoiceId },
      include: {
        lines: true,
        allocations: { include: { payment: true } },
        customer: { select: { displayName: true, gstin: true } },
        supplier: { select: { displayName: true, gstin: true } },
      },
    });
    if (!invoice) return null;

    const paidPaise = invoice.allocations.reduce(
      (sum, allocation) => sum + allocation.amountPaise,
      0,
    );
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      direction: invoice.customerId
        ? ("sales" as const)
        : ("purchase" as const),
      customerId: invoice.customerId,
      supplierId: invoice.supplierId,
      salesOrderId: invoice.salesOrderId,
      purchaseOrderId: invoice.purchaseOrderId,
      partyName:
        invoice.customer?.displayName ?? invoice.supplier?.displayName ?? "—",
      partyGstin: invoice.customer?.gstin ?? invoice.supplier?.gstin ?? null,
      issuedAt: invoice.issuedAt,
      interState: invoice.igstPaise > 0,
      supplyStateCode: invoice.supplyStateCode,
      placeOfSupplyStateCode: invoice.placeOfSupplyStateCode,
      cgstRateBp: invoice.cgstRateBp,
      sgstRateBp: invoice.sgstRateBp,
      igstRateBp: invoice.igstRateBp,
      // What settled THIS invoice, through the allocation and back to the
      // payment that made it — so a cheque that covered three bills shows on
      // each of them for its own share rather than its whole face value.
      payments: invoice.allocations
        .slice()
        .sort(
          (a, b) =>
            a.payment.receivedAt.getTime() - b.payment.receivedAt.getTime(),
        )
        .map((allocation) => ({
          method: allocation.payment.method,
          amountPaise: allocation.amountPaise,
          reference: allocation.payment.reference,
          receivedAt: allocation.payment.receivedAt,
        })),
      taxablePaise: invoice.taxablePaise,
      cgstPaise: invoice.cgstPaise,
      sgstPaise: invoice.sgstPaise,
      igstPaise: invoice.igstPaise,
      totalPaise: invoice.totalPaise,
      paidPaise,
      outstandingPaise: invoice.totalPaise - paidPaise,
      lines: invoice.lines.map((line) => ({
        name: line.productNameSnapshot,
        hsnCode: line.hsnCodeSnapshot,
        qtyUnits: line.qtyUnits,
        unitPricePaise: line.unitPricePaise,
        lineTotalPaise: line.lineTotalPaise,
      })),
    };
  },
};

export const listInvoices: QueryDefinition<
  { unpaidOnly?: boolean },
  Array<{
    id: string;
    invoiceNumber: string;
    partyName: string;
    direction: "sales" | "purchase";
    issuedAt: Date;
    totalPaise: number;
    outstandingPaise: number;
    /**
     * A purchase bill raised at goods receipt whose supplier document has not
     * been recorded yet. Its tax split was computed, so it is a payable but not
     * a credit claim — the desk has to be able to tell the two apart.
     */
    provisional: boolean;
  }>
> = {
  key: "verity.trading.list_invoices",
  entity: ENTITY_INVOICE,
  input: z.object({ unpaidOnly: z.boolean().optional() }),
  handler: async (ctx, input) => {
    const invoices = await ctx.tx.tradingInvoice.findMany({
      include: {
        allocations: true,
        confirmation: { select: { id: true } },
        customer: { select: { displayName: true } },
        supplier: { select: { displayName: true } },
      },
      orderBy: { issuedAt: "desc" },
      take: 200,
    });

    return invoices
      .map((invoice) => {
        const paid = invoice.allocations.reduce(
          (sum, allocation) => sum + allocation.amountPaise,
          0,
        );
        return {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          partyName:
            invoice.customer?.displayName ??
            invoice.supplier?.displayName ??
            "—",
          direction: invoice.customerId
            ? ("sales" as const)
            : ("purchase" as const),
          issuedAt: invoice.issuedAt,
          totalPaise: invoice.totalPaise,
          outstandingPaise: invoice.totalPaise - paid,
          provisional:
            invoice.supplierId !== null && invoice.confirmation === null,
        };
      })
      .filter((row) => !input.unpaidOnly || row.outstandingPaise > 0);
  },
};

/* =============================== the console ============================== */

/**
 * PLYWOOD STAGE 7 — the owner console.
 *
 * plywood.md §8.1 names the eight figures, so this returns exactly those eight
 * and nothing invented alongside them. One query rather than eight, because a
 * dashboard that fans out into eight round trips is a dashboard that is slow at
 * precisely the moment somebody opens it to check on the business.
 *
 * Every figure is the sum of records that already exist. Nothing here is typed
 * in, and nothing is estimated.
 */
export const ownerConsole: QueryDefinition<
  Record<string, never>,
  {
    /* Sales (§7) */
    salesThisMonthPaise: number;
    salesLastMonthPaise: number;
    todaysSalesPaise: number;
    openSalesOrders: number;
    awaitingCreditApproval: number;
    awaitingGoodsIssue: number;
    /* Purchase */
    openPurchaseOrders: number;
    pendingReceipt: number;
    incomingUnits: number;
    todaysPurchasesPaise: number;
    purchasesThisMonthPaise: number;
    purchasesLastMonthPaise: number;
    /* Inventory */
    stockValuePaise: number;
    lowStockBoards: number;
    reservedUnits: number;
    /* Money */
    receivablesPaise: number;
    overdueReceivablesPaise: number;
    payablesPaise: number;
    collectionsTodayPaise: number;
    /* Tax */
    outputTaxPaise: number;
    eligibleItcPaise: number;
  }
> = {
  scopeHandling: "handler",
  key: "verity.trading.owner_console",
  entity: ENTITY_INVOICE,
  input: z.object({}),
  handler: async (ctx) => {
    // §7 groups the owner's morning into Sales, Purchase, Inventory, Money and
    // Tax, and every figure it names is here. One statement rather than
    // eighteen: this is the first query of the day on the busiest screen, and
    // eighteen round trips to a pooled connection is eighteen latencies.
    //
    // LAYER 2 ON THE STOCK FIGURES, which was missing.
    // `stock_value`, `low_stock` and `reserved` read the physical inventory,
    // and they read it through no godown filter at all — so a role restricted
    // to one godown saw the whole business's inventory value on its home
    // screen. The order and money figures are deliberately NOT filtered: an
    // invoice is not anchored to a godown, and inventing a filter for it would
    // be a scope rule with no basis in the model. The stock figures are, and
    // now say so.
    // Audit finding U0-3: "today" and "this month" are the BUSINESS's, not
    // UTC's. Read at 01:55 IST on the 1st, a UTC boundary reports last month's
    // sales as this month's and yesterday's as today's.
    const zone = await businessZone(ctx);

    const reachable = await reachableGodownIds(
      ctx.tx,
      ctx.actor,
      ENTITY_STOCK_BALANCE,
    );
    // An empty reachable set means nothing, never everything. Prisma renders an
    // empty `IN ()` as false, which is the correct reading, but the array is
    // passed explicitly so the intent survives a future refactor.
    const godowns = reachable.length > 0 ? reachable : [NO_GODOWN];

    const rows = await ctx.tx.$queryRaw<Record<string, bigint | null>[]>`SELECT
        (SELECT COALESCE(SUM(total_paise), 0) FROM trading_invoice
          WHERE customer_id IS NOT NULL AND issued_at >= date_trunc('month', now() AT TIME ZONE ${zone}) AT TIME ZONE ${zone})::bigint
          AS sales_this_month,
        -- Real month-over-month delta (Task 100's dashboard rework) --
        -- the FULL prior calendar month, not "same number of days ago",
        -- because a delta against a partial month is not comparable.
        (SELECT COALESCE(SUM(total_paise), 0) FROM trading_invoice
          WHERE customer_id IS NOT NULL
            AND issued_at >= date_trunc('month', now() AT TIME ZONE ${zone}) AT TIME ZONE ${zone} - interval '1 month'
            AND issued_at < date_trunc('month', now() AT TIME ZONE ${zone}) AT TIME ZONE ${zone})::bigint
          AS sales_last_month,
        (SELECT COALESCE(SUM(total_paise), 0) FROM trading_invoice
          WHERE customer_id IS NOT NULL AND issued_at >= date_trunc('day', now() AT TIME ZONE ${zone}) AT TIME ZONE ${zone})::bigint
          AS todays_sales,
        (SELECT COALESCE(SUM(total_paise), 0) FROM trading_invoice
          WHERE supplier_id IS NOT NULL AND issued_at >= date_trunc('day', now() AT TIME ZONE ${zone}) AT TIME ZONE ${zone})::bigint
          AS todays_purchases,
        (SELECT COALESCE(SUM(total_paise), 0) FROM trading_invoice
          WHERE supplier_id IS NOT NULL AND issued_at >= date_trunc('month', now() AT TIME ZONE ${zone}) AT TIME ZONE ${zone})::bigint
          AS purchases_this_month,
        (SELECT COALESCE(SUM(total_paise), 0) FROM trading_invoice
          WHERE supplier_id IS NOT NULL
            AND issued_at >= date_trunc('month', now() AT TIME ZONE ${zone}) AT TIME ZONE ${zone} - interval '1 month'
            AND issued_at < date_trunc('month', now() AT TIME ZONE ${zone}) AT TIME ZONE ${zone})::bigint
          AS purchases_last_month,
        (SELECT count(*) FROM trading_sales_order
          WHERE state IN ('draft', 'pending_credit', 'approved', 'dispatching'))::bigint
          AS open_sales_orders,
        (SELECT count(*) FROM trading_sales_order WHERE state = 'pending_credit')::bigint
          AS awaiting_credit,
        (SELECT count(*) FROM trading_sales_order
          WHERE state IN ('approved', 'dispatching'))::bigint
          AS awaiting_goods_issue,
        (SELECT count(*) FROM trading_purchase_order
          WHERE state IN ('submitted', 'receiving'))::bigint
          AS open_purchase_orders,
        -- Orders with something still owed, which is not the same as orders
        -- that are open: a fully received order stays open until it is closed
        -- out, and counting it as "pending receipt" would send someone to the
        -- gate for a lorry that already came.
        (SELECT count(DISTINCT o.id) FROM trading_purchase_order o
           JOIN trading_purchase_order_line l ON l.purchase_order_id = o.id
          WHERE o.state IN ('submitted', 'receiving')
            AND l.qty_ordered > l.qty_received)::bigint
          AS pending_receipt,
        (SELECT COALESCE(SUM(GREATEST(l.qty_ordered - l.qty_received, 0)), 0)
           FROM trading_purchase_order o
           JOIN trading_purchase_order_line l ON l.purchase_order_id = o.id
          WHERE o.state IN ('submitted', 'receiving'))::bigint
          AS incoming_units,
        (SELECT COALESCE(SUM(qty_units * avg_unit_cost_paise), 0) FROM stock_balance
          WHERE location_id = ANY(${godowns}::uuid[]))::bigint
          AS stock_value,
        (SELECT COALESCE(SUM(r.qty_units), 0) FROM trading_stock_reservation r
          WHERE r.released_at IS NULL
            AND r.location_id = ANY(${godowns}::uuid[]))::bigint
          AS reserved_units,
        -- Settled amounts come from trading_payment_allocation, not from
        -- payments joined on invoice_id. Since Task 71 a payment names a PARTY
        -- and is allocated across their documents, so a settled invoice may
        -- have no payment pointing at it at all; the old join reported every
        -- such invoice as fully outstanding.
        (SELECT COALESCE(SUM(i.total_paise), 0) - COALESCE((
           SELECT SUM(a.amount_paise) FROM trading_payment_allocation a
            JOIN trading_invoice pi ON pi.id = a.invoice_id
           WHERE pi.customer_id IS NOT NULL), 0)
           FROM trading_invoice i WHERE i.customer_id IS NOT NULL)::bigint
          AS receivables,
        -- Overdue is age, not a due-date column: this capability records no
        -- payment terms, so "older than 30 days and not settled" is stated as
        -- the rule rather than dressed up as a term the business never agreed.
        (SELECT COALESCE(SUM(i.total_paise - COALESCE((
             SELECT SUM(a.amount_paise) FROM trading_payment_allocation a WHERE a.invoice_id = i.id
           ), 0)), 0)
           FROM trading_invoice i
          WHERE i.customer_id IS NOT NULL
            AND i.issued_at < now() - interval '30 days'
            AND i.total_paise > COALESCE((
              SELECT SUM(a.amount_paise) FROM trading_payment_allocation a WHERE a.invoice_id = i.id), 0))::bigint
          AS overdue_receivables,
        (SELECT COALESCE(SUM(i.total_paise), 0) - COALESCE((
           SELECT SUM(a.amount_paise) FROM trading_payment_allocation a
            JOIN trading_invoice pi ON pi.id = a.invoice_id
           WHERE pi.supplier_id IS NOT NULL), 0)
           FROM trading_invoice i WHERE i.supplier_id IS NOT NULL)::bigint
          AS payables,
        -- Money actually taken in today, from the payment itself rather than
        -- through an invoice: an advance is a collection even before it settles
        -- anything, and the old join could not see one.
        (SELECT COALESCE(SUM(p.amount_paise), 0) FROM trading_payment p
          WHERE p.customer_id IS NOT NULL AND p.direction = 'in'
            AND p.received_at >= date_trunc('day', now() AT TIME ZONE ${zone}) AT TIME ZONE ${zone})::bigint
          AS collections_today,
        (SELECT COALESCE(SUM(cgst_paise + sgst_paise + igst_paise), 0) FROM trading_invoice
          WHERE customer_id IS NOT NULL AND issued_at >= date_trunc('month', now() AT TIME ZONE ${zone}) AT TIME ZONE ${zone})::bigint
          AS output_tax,
        -- CONFIRMED bills only. A provisional bill's tax split was computed
        -- from this business's own rules, not read off a supplier's document,
        -- and presenting it as eligible credit would overstate what can be
        -- claimed by exactly the amount nobody has evidence for.
        (SELECT COALESCE(SUM(i.cgst_paise + i.sgst_paise + i.igst_paise), 0)
           FROM trading_invoice i
           JOIN trading_purchase_bill_confirmation c ON c.invoice_id = i.id
          WHERE i.supplier_id IS NOT NULL
            AND i.issued_at >= date_trunc('month', now() AT TIME ZONE ${zone}) AT TIME ZONE ${zone})::bigint
          AS eligible_itc,
        -- Available, not on hand (rule freeze §4.2). Counting on-hand reports
        -- plenty while every sheet is already reserved, and the buyer finds
        -- out at goods issue, which is too late to buy anything.
        (SELECT count(*) FROM trading_product p
          WHERE p.active AND p.reorder_level_units > 0
            AND COALESCE((SELECT SUM(b.qty_units) FROM stock_balance b
                           WHERE b.product_id = p.id
                             AND b.location_id = ANY(${godowns}::uuid[])), 0)
              - COALESCE((SELECT SUM(r.qty_units) FROM trading_stock_reservation r
                           WHERE r.product_id = p.id AND r.released_at IS NULL
                             AND r.location_id = ANY(${godowns}::uuid[])), 0)
              < p.reorder_level_units)::bigint
          AS low_stock`;

    const row = rows[0] ?? {};
    const n = (key: string) => safeAggregate(row[key] ?? 0);
    return {
      salesThisMonthPaise: n("sales_this_month"),
      salesLastMonthPaise: n("sales_last_month"),
      todaysSalesPaise: n("todays_sales"),
      openSalesOrders: n("open_sales_orders"),
      awaitingCreditApproval: n("awaiting_credit"),
      awaitingGoodsIssue: n("awaiting_goods_issue"),
      openPurchaseOrders: n("open_purchase_orders"),
      pendingReceipt: n("pending_receipt"),
      incomingUnits: n("incoming_units"),
      todaysPurchasesPaise: n("todays_purchases"),
      purchasesThisMonthPaise: n("purchases_this_month"),
      purchasesLastMonthPaise: n("purchases_last_month"),
      stockValuePaise: n("stock_value"),
      lowStockBoards: n("low_stock"),
      reservedUnits: n("reserved_units"),
      receivablesPaise: n("receivables"),
      overdueReceivablesPaise: n("overdue_receivables"),
      payablesPaise: n("payables"),
      collectionsTodayPaise: n("collections_today"),
      outputTaxPaise: n("output_tax"),
      eligibleItcPaise: n("eligible_itc"),
    };
  },
};

/**
 * Daily metric-history capture — Task 100's own missing prerequisite for a
 * real trend line. A scheduled job (not a query — no actor to scope by
 * godown, and a business snapshot should track the whole business, not one
 * actor's visible slice), so this reuses the SAME source-of-truth SQL
 * expressions `ownerConsole` computes above (stock value, receivables,
 * payables, today's sales) — same tables, same arithmetic, just at
 * whole-tenant scope instead of godown-filtered. Never a second, subtly
 * different definition of the same number (Task 82's own rule).
 *
 * Upserts by (tenantId, snapshotDate), so a retried or re-run capture on the
 * same business day is a no-op update, never a duplicate row — the same
 * idempotency discipline every scheduled job in this capability already
 * follows (see the low-stock sweep in `index.ts`).
 *
 * Deliberately captures data only. Nothing in `charts.tsx`/Overview reads
 * this table yet — a real trend needs real elapsed days, which a build
 * session cannot manufacture; wiring a sparkline to a one-point series
 * would be exactly the "drawing rather than a measurement" `charts.tsx`
 * already refuses. `metricsHistory` below exists so that once real history
 * has accumulated, reading it is a one-query problem, not a new one.
 */
export async function captureMetricSnapshot(
  tx: TenantScopedClient,
  tenantId: string,
): Promise<{ events: Array<{ name: string; entityId: string }> }> {
  const org = await tx.organization.findFirst({ where: { tenantId }, select: { id: true } });
  const zone = org ? await effectiveTimeZone(tx, org.id) : "UTC";

  const rows = await tx.$queryRaw<Record<string, bigint | null>[]>`SELECT
      (SELECT COALESCE(SUM(total_paise), 0) FROM trading_invoice
        WHERE customer_id IS NOT NULL AND issued_at >= date_trunc('day', now() AT TIME ZONE ${zone}) AT TIME ZONE ${zone})::bigint
        AS sales_today,
      (SELECT COALESCE(SUM(qty_units * avg_unit_cost_paise), 0) FROM stock_balance)::bigint
        AS stock_value,
      (SELECT COALESCE(SUM(i.total_paise), 0) - COALESCE((
          SELECT SUM(a.amount_paise) FROM trading_payment_allocation a
          JOIN trading_invoice pi ON pi.id = a.invoice_id
          WHERE pi.customer_id IS NOT NULL), 0)
        FROM trading_invoice i WHERE i.customer_id IS NOT NULL)::bigint
        AS receivables,
      (SELECT COALESCE(SUM(i.total_paise), 0) - COALESCE((
          SELECT SUM(a.amount_paise) FROM trading_payment_allocation a
          JOIN trading_invoice pi ON pi.id = a.invoice_id
          WHERE pi.supplier_id IS NOT NULL), 0)
        FROM trading_invoice i WHERE i.supplier_id IS NOT NULL)::bigint
        AS payables`;

  const row = rows[0] ?? {};
  const n = (key: string) => safeAggregate(row[key] ?? 0);

  const snapshot = await tx.tradingMetricSnapshot.upsert({
    where: { tenantId_snapshotDate: { tenantId, snapshotDate: new Date(new Date().toISOString().slice(0, 10)) } },
    create: {
      tenantId,
      snapshotDate: new Date(new Date().toISOString().slice(0, 10)),
      salesTodayPaise: n("sales_today"),
      stockValuePaise: n("stock_value"),
      receivablesPaise: n("receivables"),
      payablesPaise: n("payables"),
    },
    update: {
      salesTodayPaise: n("sales_today"),
      stockValuePaise: n("stock_value"),
      receivablesPaise: n("receivables"),
      payablesPaise: n("payables"),
    },
  });

  return { events: [{ name: "verity.trading.metric_snapshot_captured", entityId: snapshot.id }] };
}

export const metricsHistory: QueryDefinition<
  { days?: number },
  Array<{
    date: string;
    salesTodayPaise: number;
    stockValuePaise: number;
    receivablesPaise: number;
    payablesPaise: number;
  }>
> = {
  key: "verity.trading.metrics_history",
  entity: ENTITY_INVOICE,
  input: z.object({ days: z.number().int().min(1).max(365).optional() }),
  handler: async (ctx, input) => {
    const rows = await ctx.tx.tradingMetricSnapshot.findMany({
      orderBy: { snapshotDate: "desc" },
      take: input.days ?? 90,
    });
    return rows
      .map((r) => ({
        date: r.snapshotDate.toISOString().slice(0, 10),
        salesTodayPaise: r.salesTodayPaise,
        stockValuePaise: r.stockValuePaise,
        receivablesPaise: r.receivablesPaise,
        payablesPaise: r.payablesPaise,
      }))
      .reverse();
  },
};

/**
 * Real weekly totals — Overview dashboard rework. Not a fabricated smooth
 * line: `trading_invoice` already holds real historical rows with real
 * timestamps, so a live `GROUP BY` week gives a real multi-point series
 * immediately, without waiting for `TradingMetricSnapshot` (Task 100) to
 * accumulate. Same `charts.tsx` rule as everywhere else — every value real.
 */
async function weeklyTotals(
  tx: TenantScopedClient,
  zone: string,
  partyColumn: "customer_id" | "supplier_id",
  weeks: number,
): Promise<number[]> {
  // `generate_series` over the week boundaries, LEFT JOINed against the real
  // invoice sums, so every week in the window gets a bucket — including a
  // week with zero invoices — at its true chronological position. A version
  // that only emitted rows for weeks with data and then walked them in
  // array order left-packed a sparse window: one invoice in an otherwise
  // empty range landed at index 0 instead of the trailing (current) week.
  const rows = await tx.$queryRawUnsafe<{ total: bigint }[]>(
    `WITH weeks AS (
       SELECT generate_series(
                date_trunc('week', now() AT TIME ZONE $1) - (($2::int - 1) || ' weeks')::interval,
                date_trunc('week', now() AT TIME ZONE $1),
                '1 week'::interval
              ) AS week_start
     )
     SELECT COALESCE(SUM(i.total_paise), 0)::bigint AS total
       FROM weeks w
       LEFT JOIN trading_invoice i
              ON date_trunc('week', i.issued_at AT TIME ZONE $1) = w.week_start
             AND i.${partyColumn} IS NOT NULL
      GROUP BY w.week_start
      ORDER BY w.week_start ASC`,
    zone,
    weeks,
  );
  return rows.map((r) => safeAggregate(r.total));
}

export const weeklySalesTotals: QueryDefinition<{ weeks?: number }, number[]> = {
  key: "verity.trading.weekly_sales_totals",
  entity: ENTITY_INVOICE,
  input: z.object({ weeks: z.number().int().min(1).max(52).optional() }),
  handler: async (ctx, input) => {
    const zone = await businessZone(ctx);
    return weeklyTotals(ctx.tx, zone, "customer_id", input.weeks ?? 10);
  },
};

export const weeklyPurchaseTotals: QueryDefinition<{ weeks?: number }, number[]> = {
  key: "verity.trading.weekly_purchase_totals",
  entity: ENTITY_INVOICE,
  input: z.object({ weeks: z.number().int().min(1).max(52).optional() }),
  handler: async (ctx, input) => {
    const zone = await businessZone(ctx);
    return weeklyTotals(ctx.tx, zone, "supplier_id", input.weeks ?? 10);
  },
};

/** The business's own "start of this month" as a real instant — same
 *  zone-awareness `ownerConsole` already requires (its own comment: a UTC
 *  boundary reports last month's sales as this month's at 01:55 IST on the
 *  1st). One tiny query rather than duplicating `date_trunc` logic in JS. */
async function zoneMonthStart(tx: TenantScopedClient, zone: string): Promise<Date> {
  const rows = await tx.$queryRawUnsafe<{ month_start: Date }[]>(
    `SELECT (date_trunc('month', now() AT TIME ZONE $1) AT TIME ZONE $1) AS month_start`,
    zone,
  );
  return rows[0]!.month_start;
}

export const topCustomers: QueryDefinition<
  { limit?: number },
  Array<{ customerId: string; name: string; totalPaise: number; orders: number }>
> = {
  key: "verity.trading.top_customers",
  entity: ENTITY_INVOICE,
  input: z.object({ limit: z.number().int().min(1).max(20).optional() }),
  handler: async (ctx, input) => {
    const monthStart = await zoneMonthStart(ctx.tx, await businessZone(ctx));
    const grouped = await ctx.tx.tradingInvoice.groupBy({
      by: ["customerId"],
      where: { customerId: { not: null }, issuedAt: { gte: monthStart } },
      _sum: { totalPaise: true },
      _count: { _all: true },
      orderBy: { _sum: { totalPaise: "desc" } },
      take: input.limit ?? 5,
    });
    const customers = await ctx.tx.tradingCustomer.findMany({
      where: { id: { in: grouped.map((g) => g.customerId!) } },
      select: { id: true, displayName: true },
    });
    const nameOf = new Map(customers.map((c) => [c.id, c.displayName]));
    return grouped.map((g) => ({
      customerId: g.customerId!,
      name: nameOf.get(g.customerId!) ?? "—",
      totalPaise: g._sum.totalPaise ?? 0,
      orders: g._count._all,
    }));
  },
};

export const topItems: QueryDefinition<
  { limit?: number },
  Array<{ productId: string; name: string; unitLabel: string; totalPaise: number; qtyUnits: number }>
> = {
  key: "verity.trading.top_items",
  entity: ENTITY_INVOICE,
  input: z.object({ limit: z.number().int().min(1).max(20).optional() }),
  handler: async (ctx, input) => {
    const monthStart = await zoneMonthStart(ctx.tx, await businessZone(ctx));
    const grouped = await ctx.tx.tradingInvoiceLine.groupBy({
      by: ["productId"],
      where: { invoice: { customerId: { not: null }, issuedAt: { gte: monthStart } } },
      _sum: { lineTotalPaise: true, qtyUnits: true },
      orderBy: { _sum: { lineTotalPaise: "desc" } },
      take: input.limit ?? 5,
    });
    const products = await ctx.tx.tradingProduct.findMany({
      where: { id: { in: grouped.map((g) => g.productId) } },
      select: { id: true, name: true, unitLabel: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    return grouped.map((g) => ({
      productId: g.productId,
      name: byId.get(g.productId)?.name ?? "—",
      unitLabel: byId.get(g.productId)?.unitLabel ?? "units",
      totalPaise: g._sum.lineTotalPaise ?? 0,
      qtyUnits: g._sum.qtyUnits ?? 0,
    }));
  },
};

/**
 * Tenant-wide activity, unlike `reconstructHistory` (Task 38/92) which is
 * per-entity. Same source tables (`activity`/`domain_event`), same
 * `commandKey`-first captioning `ActivityLog` already renders (Task 92's
 * `kind` fix carried over here too) — this is a different SCOPE of the
 * same mechanism, not a new one.
 */
export const recentActivityFeed: QueryDefinition<
  { limit?: number },
  Array<{
    occurredAt: Date;
    action: string;
    commandKey: string | null;
    kind: "change" | "fact";
  }>
> = {
  key: "verity.trading.recent_activity_feed",
  entity: "verity.platform.activity",
  input: z.object({ limit: z.number().int().min(1).max(100).optional() }),
  handler: async (ctx, input) => {
    const limit = input.limit ?? 20;
    const [changes, facts] = await Promise.all([
      ctx.tx.activity.findMany({
        orderBy: { occurredAt: "desc" },
        take: limit,
        select: { occurredAt: true, fieldChanged: true, commandKey: true },
      }),
      ctx.tx.domainEvent.findMany({
        orderBy: { occurredAt: "desc" },
        take: limit,
        select: { occurredAt: true, name: true, commandKey: true },
      }),
    ]);
    const merged = [
      ...changes.map((c) => ({
        occurredAt: c.occurredAt,
        action: c.fieldChanged,
        commandKey: c.commandKey,
        kind: "change" as const,
      })),
      ...facts.map((f) => ({
        occurredAt: f.occurredAt,
        action: f.name,
        commandKey: f.commandKey,
        kind: "fact" as const,
      })),
    ];
    return merged
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, limit);
  },
};

/**
 * Margin, and the honest name of the method that produced it (P1).
 *
 * Revenue is the taxable value of sales invoices — tax collected is not income.
 * Cost is what the stock ledger recorded as consumed at the moment each sale
 * happened, which is why an outward movement stores its cost rather than being
 * revalued later.
 */
export const marginReport: QueryDefinition<
  { sinceDays?: number },
  {
    costingMethod: string;
    revenuePaise: number;
    costOfGoodsSoldPaise: number;
    marginPaise: number;
    marginBp: number;
  }
> = {
  key: "verity.trading.margin_report",
  entity: ENTITY_INVOICE,
  input: z.object({ sinceDays: z.number().int().min(1).max(3650).optional() }),
  handler: async (ctx, input) => {
    const since = new Date(Date.now() - (input.sinceDays ?? 30) * 86_400_000);

    const [revenueRows, costRows] = await Promise.all([
      ctx.tx.$queryRaw<{ revenue: bigint | null }[]>`
        SELECT COALESCE(SUM(taxable_paise), 0)::bigint AS revenue
          FROM trading_invoice
         WHERE customer_id IS NOT NULL AND issued_at >= ${since}`,
      ctx.tx.$queryRaw<{ cost: bigint | null }[]>`
        SELECT COALESCE(SUM(-qty_delta_units * unit_cost_paise), 0)::bigint AS cost
          FROM stock_ledger_entry
         WHERE kind = 'sales_outward' AND occurred_at >= ${since}`,
    ]);

    const revenuePaise = safeAggregate(revenueRows[0]?.revenue ?? 0);
    const costOfGoodsSoldPaise = safeAggregate(costRows[0]?.cost ?? 0);
    const marginPaise = revenuePaise - costOfGoodsSoldPaise;

    return {
      // Named, not implied. An owner reading a margin is entitled to know which
      // of three possible numbers it is; FIFO and last-purchase-cost would both
      // give a different one.
      costingMethod: "Weighted average cost",
      revenuePaise,
      costOfGoodsSoldPaise,
      marginPaise,
      marginBp:
        revenuePaise === 0
          ? 0
          : Math.round((marginPaise / revenuePaise) * 10_000),
    };
  },
};

/* ============================ three-way match ============================= */

/**
 * Purchase order ↔ goods receipt ↔ supplier invoice.
 *
 * Authority: specification §29; taskplans/archive/45_plywood_workflow_program.md §9
 * slice 3; PLYWOOD_TARGET_WORKFLOW_GAP_AUDIT.md P0-04 and §4.6.
 *
 * The accountant's question is never "what did we order?" — it is "does what
 * they billed agree with what we ordered and what actually arrived?". Three
 * numbers per line, and the differences named.
 *
 * IT REPORTS, IT DOES NOT REFUSE
 * A quantity or price difference is a conversation with the supplier, not an
 * error. Blocking the invoice would leave the business unable to record a
 * document it has physically received, which is how invoices end up in a
 * drawer instead of in the system. What is refused is invoicing an order that
 * has received *nothing* — there is no conversation to have about that.
 */
export const purchaseMatch: QueryDefinition<
  { purchaseOrderId: string },
  {
    purchaseOrderId: string;
    supplierName: string;
    state: string;
    orderedTotalPaise: number;
    receivedTotalPaise: number;
    invoicedTotalPaise: number;
    receipts: Array<{
      id: string;
      receiptNumber: string;
      receivedAt: Date;
      lineCount: number;
    }>;
    lines: Array<{
      productId: string;
      productName: string;
      qtyOrdered: number;
      qtyReceived: number;
      unitCostPaise: number;
      /** Ordered minus received. Positive means still owed to us. */
      qtyOutstanding: number;
    }>;
    exceptions: string[];
    /// Null when the order does not exist OR is outside the reader's godowns.
    /// The two are deliberately indistinguishable: telling a warehouse operator
    /// that an order they may not read nevertheless exists is the fact the
    /// scope was there to withhold.
  } | null
> = {
  scopeHandling: "handler",
  key: "verity.trading.purchase_match",
  entity: ENTITY_PURCHASE_ORDER,
  input: z.object({ purchaseOrderId: z.string().uuid() }),
  handler: async (ctx, input) => {
    // Layer 2. Audit finding F-09.
    const reachable = await reachableGodownIds(
      ctx.tx,
      ctx.actor,
      ENTITY_PURCHASE_ORDER,
    );
    // findFirst with the scope in the predicate, not findUniqueOrThrow then a
    // check: a read that returns the row and refuses afterwards has already
    // read it, and the difference matters when the caller logs the error.
    const order = await ctx.tx.tradingPurchaseOrder.findFirst({
      where: { id: input.purchaseOrderId, locationId: { in: reachable } },
      include: { lines: true, supplier: { select: { displayName: true } } },
    });
    if (!order) return null;

    const receipts = await ctx.tx.tradingGoodsReceipt.findMany({
      where: { purchaseOrderId: order.id },
      include: { lines: { select: { id: true } } },
      orderBy: { receivedAt: "asc" },
    });

    const invoices = await ctx.tx.tradingInvoice.findMany({
      where: { purchaseOrderId: order.id },
      select: { totalPaise: true },
    });

    const orderedTotalPaise = order.lines.reduce(
      (sum, line) => sum + line.qtyOrdered * line.unitCostPaise,
      0,
    );
    const receivedTotalPaise = order.lines.reduce(
      (sum, line) => sum + line.qtyReceived * line.unitCostPaise,
      0,
    );
    const invoicedTotalPaise = invoices.reduce(
      (sum, invoice) => sum + invoice.totalPaise,
      0,
    );

    // Named in the words an accountant would use, not as codes. Each one is
    // something a person has to go and do.
    const exceptions: string[] = [];
    const shortLines = order.lines.filter(
      (line) => line.qtyReceived < line.qtyOrdered,
    );
    if (shortLines.length > 0) {
      exceptions.push(
        `${shortLines.length} line(s) not fully received: ` +
          shortLines
            .map(
              (l) =>
                `${l.productNameSnapshot} ${l.qtyReceived}/${l.qtyOrdered}`,
            )
            .join(", "),
      );
    }
    if (invoicedTotalPaise > 0 && invoicedTotalPaise !== receivedTotalPaise) {
      const difference = invoicedTotalPaise - receivedTotalPaise;
      exceptions.push(
        `Invoiced ${difference > 0 ? "more" : "less"} than received by ` +
          `${Math.abs(difference) / 100} rupees`,
      );
    }
    if (receipts.length === 0) {
      exceptions.push("Nothing has been received against this order yet");
    }

    return {
      purchaseOrderId: order.id,
      supplierName: order.supplier.displayName,
      state: order.state,
      orderedTotalPaise,
      receivedTotalPaise,
      invoicedTotalPaise,
      receipts: receipts.map((receipt) => ({
        id: receipt.id,
        receiptNumber: receipt.receiptNumber,
        receivedAt: receipt.receivedAt,
        lineCount: receipt.lines.length,
      })),
      lines: order.lines.map((line) => ({
        productId: line.productId,
        productName: line.productNameSnapshot,
        qtyOrdered: line.qtyOrdered,
        qtyReceived: line.qtyReceived,
        unitCostPaise: line.unitCostPaise,
        qtyOutstanding: line.qtyOrdered - line.qtyReceived,
      })),
      exceptions,
    };
  },
};

/** One receipt, in full — the document a supplier dispute turns on. */

/**
 * §60 — the accountant's purchase review queue.
 *
 * §75 describes the job this replaces: ask the purchase team, collect bills,
 * compare against the order, compare against stock, key it into accounting
 * software, check GST, reconcile in Excel. The queue is the first half of that
 * — every purchase that has goods against it and is waiting on something, with
 * what it is waiting on named.
 *
 * ORDERED BY WHAT IS BLOCKING, not by date. A queue sorted by age tells the
 * accountant which invoice has been waiting longest; a queue sorted by blocker
 * tells them what to do next, and they can clear a whole class in one pass.
 */
export const purchaseReviewQueue: QueryDefinition<
  Record<string, never>,
  Array<{
    purchaseOrderId: string;
    reference: string | null;
    supplierId: string;
    supplierName: string;
    state: string;
    orderedUnits: number;
    receivedUnits: number;
    orderedTotalPaise: number;
    invoicedTotalPaise: number;
    invoiceId: string | null;
    invoiceNumber: string | null;
    /// What this order is waiting on, in the order it must be dealt with.
    blockers: string[];
  }>
> = {
  scopeHandling: "handler",
  key: "verity.trading.purchase_review_queue",
  entity: ENTITY_PURCHASE_ORDER,
  input: z.object({}),
  handler: async (ctx) => {
    // Only orders with goods against them. An order nobody has delivered
    // against is the buyer's problem, not the accountant's, and putting it in
    // this queue would bury the invoices that genuinely need a decision.
    // Layer 2. Audit finding F-09: the accountant's queue listed every
    // godown's purchases regardless of the reader's scope.
    const reachable = await reachableGodownIds(
      ctx.tx,
      ctx.actor,
      ENTITY_PURCHASE_ORDER,
    );
    const orders = await ctx.tx.tradingPurchaseOrder.findMany({
      where: {
        state: { in: ["receiving", "completed"] },
        locationId: { in: reachable },
      },
      include: {
        lines: true,
        supplier: { select: { id: true, displayName: true } },
        tradingInvoices: { orderBy: { issuedAt: "desc" } },
      },
      orderBy: { createdAt: "asc" },
    });

    const rows = orders.map((order) => {
      const orderedUnits = order.lines.reduce(
        (sum, line) => sum + line.qtyOrdered,
        0,
      );
      const receivedUnits = order.lines.reduce(
        (sum, line) => sum + line.qtyReceived,
        0,
      );
      const orderedTotalPaise = order.lines.reduce(
        (sum, line) => sum + line.qtyOrdered * line.unitCostPaise,
        0,
      );
      const invoice = order.tradingInvoices[0] ?? null;
      const invoicedTotalPaise = order.tradingInvoices.reduce(
        (sum, row) => sum + row.totalPaise,
        0,
      );

      const blockers: string[] = [];
      if (!invoice) {
        blockers.push("No supplier invoice recorded");
      } else {
        if (invoice.cgstPaise + invoice.sgstPaise + invoice.igstPaise === 0) {
          blockers.push(
            "Invoice has no tax split, so no input credit can be evidenced",
          );
        }
        if (invoicedTotalPaise !== orderedTotalPaise) {
          blockers.push("Invoiced value differs from the order");
        }
      }
      if (receivedUnits !== orderedUnits) {
        blockers.push("Received quantity differs from the order");
      }
      if (order.lines.some((line) => !line.hsnCodeSnapshot)) {
        blockers.push("A line has no HSN code");
      }

      return {
        purchaseOrderId: order.id,
        reference: order.reference,
        supplierId: order.supplier.id,
        supplierName: order.supplier.displayName,
        state: order.state,
        orderedUnits,
        receivedUnits,
        orderedTotalPaise,
        invoicedTotalPaise,
        invoiceId: invoice?.id ?? null,
        invoiceNumber: invoice?.invoiceNumber ?? null,
        blockers,
      };
    });

    // Blocked first, and among those the most blocked first. A clean row is
    // still returned, because §60's ideal case — ordered, received, invoice
    // matched, GST matched — is worth showing as achieved rather than
    // disappearing and leaving the accountant unsure it was checked.
    return rows.sort((a, b) => b.blockers.length - a.blockers.length);
  },
};

export const goodsReceiptDetail: QueryDefinition<
  { receiptId: string },
  {
    id: string;
    receiptNumber: string;
    receivedAt: Date;
    supplierChallanNumber: string | null;
    notes: string | null;
    purchaseOrderId: string;
    supplierName: string;
    locationName: string;
    lines: Array<{
      productId: string;
      productName: string;
      qtyReceived: number;
      unitCostPaise: number;
      lineValuePaise: number;
    }>;
    totalValuePaise: number;
    /// Null when the receipt does not exist OR belongs to a godown outside the
    /// reader's scope — indistinguishable on purpose.
  } | null
> = {
  scopeHandling: "handler",
  key: "verity.trading.goods_receipt_detail",
  entity: ENTITY_PURCHASE_ORDER,
  input: z.object({ receiptId: z.string().uuid() }),
  handler: async (ctx, input) => {
    // Layer 2. Audit finding F-09: a goods receipt names what arrived, at what
    // cost, into which godown — readable by id from any godown before this.
    // Scoped through its order, which is where the location lives.
    const reachable = await reachableGodownIds(
      ctx.tx,
      ctx.actor,
      ENTITY_PURCHASE_ORDER,
    );
    const receipt = await ctx.tx.tradingGoodsReceipt.findFirst({
      where: {
        id: input.receiptId,
        purchaseOrder: { locationId: { in: reachable } },
      },
      include: {
        lines: true,
        location: { select: { name: true } },
        purchaseOrder: {
          include: { supplier: { select: { displayName: true } } },
        },
      },
    });
    if (!receipt) return null;

    const lines = receipt.lines.map((line) => ({
      productId: line.productId,
      productName: line.productNameSnapshot,
      qtyReceived: line.qtyReceived,
      unitCostPaise: line.unitCostPaise,
      lineValuePaise: line.qtyReceived * line.unitCostPaise,
    }));

    return {
      id: receipt.id,
      receiptNumber: receipt.receiptNumber,
      receivedAt: receipt.receivedAt,
      supplierChallanNumber: receipt.supplierChallanNumber,
      notes: receipt.notes,
      purchaseOrderId: receipt.purchaseOrderId,
      supplierName: receipt.purchaseOrder.supplier.displayName,
      locationName: receipt.location.name,
      lines,
      totalValuePaise: lines.reduce(
        (sum, line) => sum + line.lineValuePaise,
        0,
      ),
    };
  },
};

/* =========================== credit / debit notes ========================= */

/**
 * Corrects a posted invoice, without touching it.
 *
 * Authority: specification §67; taskplans/archive/45_plywood_workflow_program.md §5;
 * PLYWOOD_TARGET_WORKFLOW_GAP_AUDIT.md P0-05.
 *
 * Slice 1 made a posted invoice immutable for every role including a
 * privileged one. That rule is only workable because this exists: a second
 * document that points at the invoice rather than an amendment to it. Both
 * stand afterwards — the invoice is what the customer holds and what was
 * reported; the note is what changed.
 *
 * TAX IS COPIED, NOT RECOMPUTED
 * The note carries the invoice's own rates. Recomputing from today's
 * configuration would mean a rate change between the sale and the correction
 * silently produces a note that does not reconcile to the document it corrects
 * — and the difference would appear in a return with nothing to explain it.
 *
 * MONEY, NOT STOCK
 * A credit note does not put boards back in the godown. Returned material is a
 * separate physical event with its own movement (§4.5), and pretending one
 * implies the other is how stock and money stop agreeing.
 */
export const raiseInvoiceNote: CommandDefinition<
  {
    invoiceId: string;
    noteType: "credit" | "debit";
    taxablePaise: number;
    reason: string;
  },
  { id: string; noteNumber: string; totalPaise: number }
> = {
  key: "verity.trading.raise_invoice_note",
  entity: ENTITY_INVOICE,
  verb: "Create",
  input: z.object({
    invoiceId: z.string().uuid(),
    noteType: z.enum(["credit", "debit"]),
    taxablePaise: z.number().int().positive(),
    // A note with no reason is the entry nobody can explain, and a tax officer
    // asking about one is asking exactly this.
    reason: z.string().min(3).max(400),
  }),
  handler: async (ctx, input) => {
    const invoice = await ctx.tx.tradingInvoice.findUniqueOrThrow({
      where: { id: input.invoiceId },
      include: { notes: true },
    });

    // A credit note cannot exceed what is left on the invoice after earlier
    // ones. Crediting more than was ever charged is a refund, which is a
    // payment out, not a correction to a sale.
    if (input.noteType === "credit") {
      const alreadyCredited = invoice.notes
        .filter((note) => note.noteType === "credit")
        .reduce((sum, note) => sum + note.taxablePaise, 0);
      const creditable = invoice.taxablePaise - alreadyCredited;
      if (input.taxablePaise > creditable) {
        throw new ValidationError(
          `E_VALIDATION: only ${creditable / 100} rupees of this invoice remain creditable ` +
            `(${invoice.taxablePaise / 100} invoiced, ${alreadyCredited / 100} already credited)`,
        );
      }
    }

    // The invoice's own rates, not today's.
    const cgstPaise = Math.round(
      (input.taxablePaise * invoice.cgstRateBp) / 10_000,
    );
    const sgstPaise = Math.round(
      (input.taxablePaise * invoice.sgstRateBp) / 10_000,
    );
    const igstPaise = Math.round(
      (input.taxablePaise * invoice.igstRateBp) / 10_000,
    );
    const totalPaise = input.taxablePaise + cgstPaise + sgstPaise + igstPaise;

    const issuedAt = new Date();
    await assertPeriodOpen(ctx.tx, issuedAt);
    const financialYear = financialYearOf(issuedAt, await tenantZone(ctx.tx));
    const seriesKey = input.noteType === "credit" ? "CN" : "DN";
    const numbering = await nextDocumentNumber(
      ctx.tx,
      ctx.actor.tenantId,
      seriesKey,
      financialYear,
    );

    const note = await ctx.tx.tradingInvoiceNote.create({
      data: {
        tenantId: ctx.actor.tenantId,
        invoiceId: invoice.id,
        noteType: input.noteType,
        noteNumber: numbering.invoiceNumber,
        financialYear,
        taxablePaise: input.taxablePaise,
        cgstPaise,
        sgstPaise,
        igstPaise,
        totalPaise,
        reason: input.reason,
        issuedAt,
        issuedBy: ctx.actor.userId,
      },
    });

    // The party ledger moves the opposite way to the invoice it corrects. A
    // customer credit note reduces what they owe; a supplier one reduces what
    // this business owes.
    await ctx.tx.tradingLedgerEntry.create({
      data: {
        tenantId: ctx.actor.tenantId,
        customerId: invoice.customerId,
        supplierId: invoice.supplierId,
        entryType: input.noteType === "credit" ? "credit" : "debit",
        amountPaise: totalPaise,
        invoiceId: invoice.id,
        narration: `${note.noteNumber} against ${invoice.invoiceNumber}: ${input.reason}`,
        occurredAt: issuedAt,
      },
    });

    return {
      result: { id: note.id, noteNumber: note.noteNumber, totalPaise },
      events: [
        {
          name:
            input.noteType === "credit"
              ? "verity.trading.credit_note_raised"
              : "verity.trading.debit_note_raised",
          entityId: note.id,
          payload: { invoiceNumber: invoice.invoiceNumber, totalPaise },
        },
      ],
    };
  },
};
