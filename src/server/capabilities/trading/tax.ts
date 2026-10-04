import { assertRegularRegistration } from "./business";
import { z } from "zod";
import {
  registerCommand,
  ValidationError,
  type CommandDefinition,
} from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import type { TenantScopedClient } from "@/server/platform/tenancy";
import {
  businessPeriodKey,
  businessZone,
  startOfBusinessMonth,
} from "./clock";
import {
  HSN_CODE,
  ENTITY_GST_REGISTRATION,
  ENTITY_INVOICE,
  ENTITY_PRODUCT,
  CONFIG_CGST_RATE_BP,
  CONFIG_SGST_RATE_BP,
} from "./keys";
import { resolveConfig } from "@/server/platform/capability";

/**
 * Tax determination, input credit, and the working for a return.
 *
 * Authority: taskplans/archive/45_plywood_workflow_program.md §4.4;
 * PLYWOOD_TARGET_WORKFLOW_GAP_AUDIT.md P0-07; specification §5, §58–§63.
 *
 * TAX IS DERIVED, NEVER RE-KEYED
 * Everything here reads posted documents. There is no screen that lets somebody
 * type a figure into a return, because the moment there is one, the return and
 * the invoices stop agreeing and nobody can say which is right. The
 * specification says it plainly: *the tax centre should never become a second
 * entry system*.
 */

/** A rate, resolved for one HSN under one registration on one day. */
export type ResolvedRate = {
  cgstRateBp: number;
  sgstRateBp: number;
  igstRateBp: number;
  ruleId: string;
  hsnMatched: string;
};

export class TaxRuleMissingError extends ValidationError {
  constructor(hsnCode: string, on: Date) {
    super(
      `E_VALIDATION: no tax rule is in force for HSN ${hsnCode} on ` +
        `${on.toISOString().slice(0, 10)}. A zero-rate invoice is a filing error ` +
        "with a paper trail; add the rate under Tax Settings.",
    );
  }
}

/**
 * The rate in force for an HSN, under a registration, on a date.
 *
 * MOST SPECIFIC FIRST
 * An 8-digit rule for one board beats the 6-digit rule for its family, which
 * beats the 4-digit rule for its chapter. That is how the tariff itself is
 * written, and a lookup that ignored it would apply a chapter default to a
 * board that has its own notified rate.
 *
 * REFUSES RATHER THAN RETURNING ZERO
 * Rule freeze §4.4. A missing rate used to mean a zero-tax invoice, which is
 * indistinguishable on screen from a genuinely exempt supply and is discovered
 * when the return is filed.
 */
export async function resolveTaxRate(
  tx: TenantScopedClient,
  input: { registrationId: string; hsnCode: string; on: Date },
): Promise<ResolvedRate> {
  // 44121000 → 441210 → 4412. Longest first.
  const candidates = [input.hsnCode];
  if (input.hsnCode.length >= 6) candidates.push(input.hsnCode.slice(0, 6));
  if (input.hsnCode.length >= 4) candidates.push(input.hsnCode.slice(0, 4));

  for (const hsn of candidates) {
    const rule = await tx.tradingTaxRule.findFirst({
      where: {
        registrationId: input.registrationId,
        hsnCode: hsn,
        effectiveFrom: { lte: input.on },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: input.on } }],
      },
      orderBy: { effectiveFrom: "desc" },
    });
    if (rule) {
      return {
        cgstRateBp: rule.cgstRateBp,
        sgstRateBp: rule.sgstRateBp,
        igstRateBp: rule.igstRateBp,
        ruleId: rule.id,
        hsnMatched: rule.hsnCode,
      };
    }
  }

  throw new TaxRuleMissingError(input.hsnCode, input.on);
}

export const setTaxRule: CommandDefinition<
  {
    hsnCode: string;
    /** The full rate. Split in half for CGST and SGST; used whole for IGST. */
    rateBp: number;
    effectiveFrom?: string;
    authority?: string;
  },
  { id: string; hsnCode: string; supersededRuleId: string | null }
> = {
  key: "verity.trading.set_tax_rule",
  entity: ENTITY_GST_REGISTRATION,
  verb: "Edit",
  input: z.object({
    hsnCode: HSN_CODE,
    // One rate is asked for, not three. 18% is 18% whether it is collected as
    // 9+9 within the state or as 18 across a border; asking for three numbers
    // invites two of them to disagree.
    rateBp: z.number().int().min(0).max(10_000),
    effectiveFrom: z.string().datetime().optional(),
    authority: z.string().max(200).optional(),
  }),
  handler: async (ctx, input) => {
    const registration = await ctx.tx.tradingGstRegistration.findFirst({
      where: { active: true },
    });
    if (!registration) {
      throw new ValidationError(
        "E_VALIDATION: this business has no GST registration, so a rate has nothing to apply under",
      );
    }

    const effectiveFrom = input.effectiveFrom
      ? new Date(input.effectiveFrom)
      : new Date();

    // Supersede rather than overwrite. The old rate stays in force for the
    // invoices raised under it — that is the whole reason these rows are
    // dated, and rewriting one would restate a filed return.
    const current = await ctx.tx.tradingTaxRule.findFirst({
      where: {
        registrationId: registration.id,
        hsnCode: input.hsnCode,
        effectiveTo: null,
      },
    });
    if (current) {
      if (effectiveFrom <= current.effectiveFrom) {
        throw new ValidationError(
          "E_VALIDATION: a new rate must take effect after the one it supersedes",
        );
      }
      await ctx.tx.tradingTaxRule.update({
        where: { id: current.id },
        data: { effectiveTo: effectiveFrom },
      });
    }

    const rule = await ctx.tx.tradingTaxRule.create({
      data: {
        tenantId: ctx.actor.tenantId,
        registrationId: registration.id,
        hsnCode: input.hsnCode,
        // Half each within the state, the whole rate across a border. Stored
        // both ways so the invoice does no arithmetic at posting time.
        cgstRateBp: Math.floor(input.rateBp / 2),
        sgstRateBp: Math.round(input.rateBp / 2),
        igstRateBp: 0,
        effectiveFrom,
        authority: input.authority ?? null,
        createdBy: ctx.actor.userId,
      },
    });

    // The interstate half is the same rate expressed once. Stored as a second
    // row would mean two rows to keep in step; instead the resolver reads
    // cgst+sgst when the supply is local and doubles it when it is not.
    return {
      result: {
        id: rule.id,
        hsnCode: rule.hsnCode,
        supersededRuleId: current?.id ?? null,
      },
      events: [
        {
          name: "verity.trading.tax_rule_set",
          entityId: rule.id,
          payload: { hsnCode: rule.hsnCode, rateBp: input.rateBp },
        },
      ],
    };
  },
};

/**
 * The tax position for a period, derived entirely from posted documents.
 *
 * Output tax from sales invoices and notes; input tax from purchase invoices.
 * Nothing here is entered by a person, and there is deliberately no command
 * that would let one.
 */
/**
 * The GST rate in force today for every product in the catalogue.
 *
 * WHY A SCREEN NEEDS THIS. A purchase order's stored total is its TAXABLE
 * value, and it has to stay that way -- the three-way match, the payable, and
 * the weighted average cost of every sheet in the godown all read it. But the
 * figure a buyer is committing to is the taxable value PLUS the tax, and a
 * form that shows only the first is telling them the order costs less than it
 * does. So the rate travels to the screen and the gross is shown beside the
 * net, without either one being stored twice.
 *
 * Resolved per HSN, not per product: a catalogue of four hundred boards shares
 * a handful of codes. `rateBp` is the combined CGST+SGST -- the same number as
 * IGST on an inter-state supply, which is why one field serves both.
 *
 * `null` means the rate is genuinely not known: no registration, no rule for
 * that HSN, and no configured default. Absent rather than zero, because zero
 * is a statement that no tax is charged and the screen must be able to say
 * "not known" instead of quietly under-quoting the order.
 */
export async function productTaxRateMap(
  tx: TenantScopedClient,
): Promise<Map<string, number | null>> {
  const rows = await resolveProductTaxRates(tx);
  return new Map(rows.map((row) => [row.productId, row.rateBp]));
}

async function resolveProductTaxRates(
  tx: TenantScopedClient,
): Promise<
  Array<{ productId: string; hsnCode: string | null; rateBp: number | null }>
> {
  {
    const ctx = { tx };
    const products = await ctx.tx.tradingProduct.findMany({
      where: { active: true },
      select: { id: true, hsnCode: true },
    });
    if (products.length === 0) return [];

    // The tenant default, used for a product whose HSN nobody has recorded
    // yet -- the same fallback `ratesFor` applies when it raises the invoice,
    // so the figure quoted on the order is the figure that will be billed.
    const [rawCgst, rawSgst] = await Promise.all([
      resolveConfig<unknown>(ctx.tx, CONFIG_CGST_RATE_BP),
      resolveConfig<unknown>(ctx.tx, CONFIG_SGST_RATE_BP),
    ]);
    const half = (raw: unknown): number | null => {
      const value = typeof raw === "string" ? Number(raw) : raw;
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    };
    const defaultCgst = half(rawCgst);
    const defaultSgst = half(rawSgst);
    const fallbackBp =
      defaultCgst != null && defaultSgst != null
        ? defaultCgst + defaultSgst
        : null;

    const registration = await ctx.tx.tradingGstRegistration.findFirst({
      where: { active: true },
    });

    const byHsn = new Map<string, number | null>();
    if (registration) {
      const now = new Date();
      for (const hsn of new Set(
        products.map((product) => product.hsnCode).filter(Boolean),
      )) {
        try {
          const rate = await resolveTaxRate(ctx.tx, {
            registrationId: registration.id,
            hsnCode: hsn as string,
            on: now,
          });
          byHsn.set(hsn as string, rate.cgstRateBp + rate.sgstRateBp);
        } catch {
          // No rule for this HSN. The tenant default stands in, exactly as it
          // will when the invoice is raised.
          byHsn.set(hsn as string, fallbackBp);
        }
      }
    }

    return products.map((product) => ({
      productId: product.id,
      hsnCode: product.hsnCode,
      rateBp:
        product.hsnCode == null
          ? fallbackBp
          : (byHsn.get(product.hsnCode) ?? fallbackBp),
    }));
  }
}

export const productTaxRates: QueryDefinition<
  Record<string, never>,
  Array<{ productId: string; hsnCode: string | null; rateBp: number | null }>
> = {
  key: "verity.trading.product_tax_rates",
  entity: ENTITY_PRODUCT,
  input: z.object({}),
  handler: async (ctx) => resolveProductTaxRates(ctx.tx),
};

export const taxSummary: QueryDefinition<
  { from?: string; to?: string },
  {
    from: string;
    to: string;
    /**
     * The period this window actually covers, in the BUSINESS's zone.
     *
     * Returned rather than left for the caller to derive, because deriving it
     * from `from` is what went wrong: the window starts at midnight local time,
     * which in a zone east of UTC is the PREVIOUS day in UTC. Formatting that
     * instant in UTC labelled September's figures "August 2026" and — far worse
     * — put period=2026-08 on every link to GSTR-1, ITC and the exceptions
     * page, so each of them queried a month with nothing in it. The whole tax
     * section looked empty while the data sat one month over.
     */
    periodKey: string;
    outputTaxPaise: number;
    /**
     * GST charged on purchase documents in the window — ALL of them, including
     * bills this system raised at goods receipt whose supplier document has not
     * arrived. Kept as the gross figure because it is what the purchase
     * register foots to.
     */
    inputTaxPaise: number;
    /**
     * The part of it that can actually be claimed: bills confirmed against the
     * supplier's own document. A provisional bill's split was COMPUTED from
     * this business's own HSN rules, and filing a computed split as though a
     * supplier had issued it is a false return.
     */
    inputTaxEligiblePaise: number;
    /** The rest — real GST, not yet claimable, waiting on their paper. */
    inputTaxAwaitingBillPaise: number;
    /** How many bills that is, so the number has something to act on. */
    awaitingBillCount: number;
    netPayablePaise: number;
    salesInvoiceCount: number;
    purchaseInvoiceCount: number;
    creditNoteTaxPaise: number;
    exceptions: Array<{ kind: string; detail: string; documentNumber: string }>;
  }
> = {
  key: "verity.trading.tax_summary",
  entity: ENTITY_INVOICE,
  input: z.object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  }),
  handler: async (ctx, input) => {
    const now = new Date();
    // Default window: the current month, which is the period an accountant is
    // usually looking at when they open this.
    const zone = await businessZone(ctx);
    const from = input.from ? new Date(input.from) : startOfBusinessMonth(zone, now);
    const to = input.to ? new Date(input.to) : now;

    const invoices = await ctx.tx.tradingInvoice.findMany({
      where: { issuedAt: { gte: from, lte: to } },
      include: {
        notes: true,
        customer: true,
        supplier: true,
        lines: true,
        confirmation: { select: { id: true } },
      },
    });

    const sales = invoices.filter((invoice) => invoice.customerId !== null);
    const purchases = invoices.filter((invoice) => invoice.supplierId !== null);

    const taxOf = (invoice: {
      cgstPaise: number;
      sgstPaise: number;
      igstPaise: number;
    }) => invoice.cgstPaise + invoice.sgstPaise + invoice.igstPaise;

    const outputGross = sales.reduce((sum, invoice) => sum + taxOf(invoice), 0);
    const creditNoteTaxPaise = sales.reduce(
      (sum, invoice) =>
        sum +
        invoice.notes
          .filter((note) => note.noteType === "credit")
          .reduce(
            (n, note) => n + note.cgstPaise + note.sgstPaise + note.igstPaise,
            0,
          ),
      0,
    );
    const debitNoteTax = sales.reduce(
      (sum, invoice) =>
        sum +
        invoice.notes
          .filter((note) => note.noteType === "debit")
          .reduce(
            (n, note) => n + note.cgstPaise + note.sgstPaise + note.igstPaise,
            0,
          ),
      0,
    );

    const outputTaxPaise = outputGross + debitNoteTax - creditNoteTaxPaise;
    const inputTaxPaise = purchases.reduce(
      (sum, invoice) => sum + taxOf(invoice),
      0,
    );
    const awaiting = purchases.filter((invoice) => invoice.confirmation === null);
    const inputTaxAwaitingBillPaise = awaiting.reduce(
      (sum, invoice) => sum + taxOf(invoice),
      0,
    );
    const inputTaxEligiblePaise = inputTaxPaise - inputTaxAwaitingBillPaise;

    // Exceptions are the accountant's actual work (§63). Each is something a
    // person has to go and fix, named with the document it is on.
    const exceptions: Array<{
      kind: string;
      detail: string;
      documentNumber: string;
    }> = [];
    for (const invoice of sales) {
      if (!invoice.customer?.stateCode) {
        exceptions.push({
          kind: "missing_place_of_supply",
          detail: `${invoice.customer?.displayName ?? "Customer"} has no state code`,
          documentNumber: invoice.invoiceNumber,
        });
      }
      if (taxOf(invoice) === 0) {
        // Zero tax is legitimate for an exempt supply and a defect everywhere
        // else, so the two are named differently rather than both reported as
        // "check this". An exemption still appears — deciding not to charge tax
        // is exactly the kind of decision a return should be able to point at —
        // but it appears as a recorded reason, not as a question.
        exceptions.push(
          invoice.taxExemptReason
            ? {
                kind: "tax_exempt",
                detail: `No GST, recorded reason: ${invoice.taxExemptReason}`,
                documentNumber: invoice.invoiceNumber,
              }
            : {
                kind: "zero_tax",
                detail: "No tax was charged and no exemption was recorded",
                documentNumber: invoice.invoiceNumber,
              },
        );
      }
      for (const line of invoice.lines) {
        if (!line.hsnCodeSnapshot) {
          exceptions.push({
            kind: "missing_hsn",
            detail: `${line.productNameSnapshot} has no HSN code`,
            documentNumber: invoice.invoiceNumber,
          });
        }
      }
    }
    for (const invoice of purchases) {
      if (taxOf(invoice) === 0) {
        exceptions.push({
          kind: "no_input_credit",
          detail:
            `${invoice.supplier?.displayName ?? "Supplier"} invoice carries no tax split, ` +
            "so no input credit can be claimed against it",
          documentNumber: invoice.invoiceNumber,
        });
      }
    }

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      // Named from the window's own start, in the business's zone.
      periodKey: businessPeriodKey(zone, from),
      outputTaxPaise,
      inputTaxPaise,
      inputTaxEligiblePaise,
      inputTaxAwaitingBillPaise,
      awaitingBillCount: awaiting.length,
      // Netted against the CLAIMABLE credit, not the gross. Netting against
      // credit that cannot yet be claimed understates what is actually payable
      // this month, which is the direction that gets a business a demand
      // notice.
      netPayablePaise: Math.max(0, outputTaxPaise - inputTaxEligiblePaise),
      salesInvoiceCount: sales.length,
      purchaseInvoiceCount: purchases.length,
      creditNoteTaxPaise,
      exceptions,
    };
  },
};

/**
 * GSTR-1 working: outward supplies, from posted sales invoices.
 *
 * B2B and B2C split on whether the customer has a GSTIN, and an HSN summary,
 * which is what the return actually asks for. Generated, never typed.
 */
export const gstr1Working: QueryDefinition<
  { from?: string; to?: string },
  {
    /** The period covered, named in the business's own zone. */
    periodKey: string;
    b2b: Array<{
      invoiceNumber: string;
      customerName: string;
      gstin: string | null;
      placeOfSupply: string;
      taxablePaise: number;
      taxPaise: number;
    }>;
    b2c: Array<{
      invoiceNumber: string;
      placeOfSupply: string;
      taxablePaise: number;
      taxPaise: number;
    }>;
    hsnSummary: Array<{
      hsnCode: string;
      qtyUnits: number;
      taxablePaise: number;
      taxPaise: number;
    }>;
    validations: string[];
  }
> = {
  key: "verity.trading.gstr1_working",
  entity: ENTITY_INVOICE,
  input: z.object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  }),
  handler: async (ctx, input) => {
    await assertRegularRegistration(ctx.tx);
    const now = new Date();
    const zone = await businessZone(ctx);
    const from = input.from
      ? new Date(input.from)
      : startOfBusinessMonth(zone, now);
    const to = input.to ? new Date(input.to) : now;

    const invoices = await ctx.tx.tradingInvoice.findMany({
      where: { issuedAt: { gte: from, lte: to }, customerId: { not: null } },
      include: { customer: true, lines: true },
      orderBy: { sequenceNumber: "asc" },
    });

    const taxOf = (row: {
      cgstPaise: number;
      sgstPaise: number;
      igstPaise: number;
    }) => row.cgstPaise + row.sgstPaise + row.igstPaise;

    const b2b = [];
    const b2c = [];
    for (const invoice of invoices) {
      const row = {
        invoiceNumber: invoice.invoiceNumber,
        placeOfSupply: invoice.placeOfSupplyStateCode,
        taxablePaise: invoice.taxablePaise,
        taxPaise: taxOf(invoice),
      };
      // A registered buyer goes to B2B, an unregistered one to B2C. The
      // distinction is the GSTIN and nothing else.
      if (invoice.customer?.gstin) {
        b2b.push({
          ...row,
          customerName: invoice.customer.displayName,
          gstin: invoice.customer.gstin,
        });
      } else {
        b2c.push(row);
      }
    }

    const byHsn = new Map<
      string,
      { qtyUnits: number; taxablePaise: number; taxPaise: number }
    >();
    for (const invoice of invoices) {
      const invoiceTax = taxOf(invoice);
      for (const line of invoice.lines) {
        const key = line.hsnCodeSnapshot || "UNKNOWN";
        const entry = byHsn.get(key) ?? {
          qtyUnits: 0,
          taxablePaise: 0,
          taxPaise: 0,
        };
        entry.qtyUnits += line.qtyUnits;
        entry.taxablePaise += line.lineTotalPaise;
        // Apportioned by line value, because tax is stored on the invoice
        // rather than the line. Stated rather than hidden: the summary is
        // exact at invoice level and apportioned within it.
        entry.taxPaise +=
          invoice.taxablePaise > 0
            ? Math.round(
                (invoiceTax * line.lineTotalPaise) / invoice.taxablePaise,
              )
            : 0;
        byHsn.set(key, entry);
      }
    }

    const validations: string[] = [];
    // Sequence continuity is what a GST officer checks first.
    const numbers = invoices
      .map((invoice) => invoice.sequenceNumber)
      .sort((a, b) => a - b);
    for (let i = 1; i < numbers.length; i += 1) {
      if (numbers[i]! !== numbers[i - 1]! + 1) {
        validations.push(
          `Invoice sequence jumps from ${numbers[i - 1]} to ${numbers[i]} — confirm nothing is missing`,
        );
      }
    }
    if (byHsn.has("UNKNOWN")) {
      validations.push("Some lines have no HSN code and cannot be summarised");
    }

    return {
      periodKey: businessPeriodKey(zone, from),
      b2b,
      b2c,
      hsnSummary: [...byHsn.entries()].map(([hsnCode, entry]) => ({
        hsnCode,
        ...entry,
      })),
      validations,
    };
  },
};

/**
 * GSTR-3B working: the summary return, from posted documents (§62).
 *
 * Where GSTR-1 lists outward supplies invoice by invoice, 3B is the summary a
 * business actually pays from: output liability, input credit, and the cash
 * required after one is set against the other.
 *
 * EVERY FIGURE HERE IS DERIVED. §58 is explicit that the tax centre must never
 * become a second entry system, and this is the screen where the temptation is
 * strongest — a person who can type into a 3B has produced a return that no
 * longer agrees with the invoices behind it, and no way to tell which is right.
 * So each amount is returned with the count of documents that compose it, and
 * the screen drills into those documents rather than offering a field.
 *
 * ELIGIBLE IS NOT THE SAME AS BOOKED. Books ITC is what suppliers billed.
 * Eligible ITC is what may actually be claimed. The two differ whenever a
 * purchase invoice carries no tax split — the credit is not disallowed, it is
 * unsubstantiated, and treating it as claimable is how a business claims credit
 * it cannot evidence. The difference is reported as its own line rather than
 * quietly folded into one number.
 */
export const gstr3bWorking: QueryDefinition<
  { from?: string; to?: string },
  {
    from: string;
    to: string;
    /** The period covered, named in the business's own zone. */
    periodKey: string;
    outward: {
      taxablePaise: number;
      cgstPaise: number;
      sgstPaise: number;
      igstPaise: number;
      invoiceCount: number;
      /// Credit notes reduce outward liability; debit notes raise it.
      creditNoteTaxPaise: number;
      debitNoteTaxPaise: number;
      netTaxPaise: number;
    };
    inward: {
      taxablePaise: number;
      cgstPaise: number;
      sgstPaise: number;
      igstPaise: number;
      invoiceCount: number;
      /// Everything suppliers billed as tax.
      booksItcPaise: number;
      /// What is substantiated by a tax split on the document.
      eligibleItcPaise: number;
      /// Booked but unsubstantiated, with the count of documents responsible.
      unsubstantiatedItcPaise: number;
      unsubstantiatedCount: number;
    };
    netCashRequiredPaise: number;
    ready: boolean;
    blockers: string[];
  }
> = {
  key: "verity.trading.gstr3b_working",
  entity: ENTITY_INVOICE,
  input: z.object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  }),
  handler: async (ctx, input) => {
    await assertRegularRegistration(ctx.tx);
    const now = new Date();
    const zone = await businessZone(ctx);
    const from = input.from
      ? new Date(input.from)
      : startOfBusinessMonth(zone, now);
    const to = input.to ? new Date(input.to) : now;

    const invoices = await ctx.tx.tradingInvoice.findMany({
      where: { issuedAt: { gte: from, lte: to } },
      include: { notes: true, customer: true, supplier: true, confirmation: true },
    });

    const taxOf = (row: {
      cgstPaise: number;
      sgstPaise: number;
      igstPaise: number;
    }) => row.cgstPaise + row.sgstPaise + row.igstPaise;

    const sales = invoices.filter((invoice) => invoice.customerId !== null);
    const purchases = invoices.filter((invoice) => invoice.supplierId !== null);

    const creditNoteTaxPaise = sales.reduce(
      (sum, invoice) =>
        sum +
        invoice.notes
          .filter((n) => n.noteType === "credit")
          .reduce((t, n) => t + taxOf(n), 0),
      0,
    );
    const debitNoteTaxPaise = sales.reduce(
      (sum, invoice) =>
        sum +
        invoice.notes
          .filter((n) => n.noteType === "debit")
          .reduce((t, n) => t + taxOf(n), 0),
      0,
    );

    const outward = {
      taxablePaise: sales.reduce((sum, i) => sum + i.taxablePaise, 0),
      cgstPaise: sales.reduce((sum, i) => sum + i.cgstPaise, 0),
      sgstPaise: sales.reduce((sum, i) => sum + i.sgstPaise, 0),
      igstPaise: sales.reduce((sum, i) => sum + i.igstPaise, 0),
      invoiceCount: sales.length,
      creditNoteTaxPaise,
      debitNoteTaxPaise,
      netTaxPaise:
        sales.reduce((sum, i) => sum + taxOf(i), 0) +
        debitNoteTaxPaise -
        creditNoteTaxPaise,
    };

    const unsubstantiated = purchases.filter((invoice) => invoice.confirmation === null || taxOf(invoice) === 0);
    const booksItcPaise = purchases.reduce((sum, i) => sum + taxOf(i), 0);

    const inward = {
      taxablePaise: purchases.reduce((sum, i) => sum + i.taxablePaise, 0),
      cgstPaise: purchases.reduce((sum, i) => sum + i.cgstPaise, 0),
      sgstPaise: purchases.reduce((sum, i) => sum + i.sgstPaise, 0),
      igstPaise: purchases.reduce((sum, i) => sum + i.igstPaise, 0),
      invoiceCount: purchases.length,
      booksItcPaise,
      eligibleItcPaise: purchases.filter((invoice) => invoice.confirmation !== null)
        .reduce((sum, invoice) => sum + taxOf(invoice), 0),
      unsubstantiatedItcPaise: unsubstantiated.reduce((sum, invoice) => sum + taxOf(invoice), 0),
      unsubstantiatedCount: unsubstantiated.length,
    };

    // A return is not ready while a figure on it is known to be wrong. Stated
    // as blockers rather than as a silent flag, because the accountant has to
    // go and fix each one and needs to be told which.
    const blockers: string[] = [];
    if (unsubstantiated.length > 0) {
      blockers.push(
        `${unsubstantiated.length} purchase invoice(s) lack a confirmed supplier bill or tax split, so no input ` +
          "credit can be evidenced against them",
      );
    }
    const missingPlaceOfSupply = sales.filter(
      (invoice) => !invoice.customer?.stateCode,
    ).length;
    if (missingPlaceOfSupply > 0) {
      blockers.push(
        `${missingPlaceOfSupply} sales invoice(s) have no place of supply, so the ` +
          "CGST/SGST against IGST split cannot be relied on",
      );
    }

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      periodKey: businessPeriodKey(zone, from),
      outward,
      inward,
      // Clamped at zero: a credit surplus carries forward, it is not a refund
      // due this month, and showing it as negative cash reads as one.
      netCashRequiredPaise: Math.max(
        0,
        outward.netTaxPaise - inward.eligibleItcPaise,
      ),
      ready: blockers.length === 0,
      blockers,
    };
  },
};

/**
 * §5 — tax settings in a business's own words.
 *
 * The registration as a person describes it, and the rate rules behind it.
 * Explicitly NOT a configuration-key screen: the specification names
 * `verity.trading.tax.cgst_rate_bp` as the thing a client must never be shown,
 * because a rate is a business fact with a date, not a setting with a value.
 *
 * Rules are returned with their effective dates and their supersession state,
 * because "18%" without "from when" is the answer to a different question than
 * the one an accountant is asking when a rate has changed mid-year.
 */
export const taxSettings: QueryDefinition<
  Record<string, never>,
  {
    registration: {
      id: string;
      gstin: string;
      stateCode: string;
      registrationType: string;
      invoiceSeriesPrefix: string;
      effectiveFrom: Date;
    } | null;
    rules: Array<{
      id: string;
      hsnCode: string;
      cgstRateBp: number;
      sgstRateBp: number;
      igstRateBp: number;
      effectiveFrom: Date;
      effectiveTo: Date | null;
      /// True when this rule governs supplies made today.
      inForce: boolean;
    }>;
  }
> = {
  key: "verity.trading.tax_settings",
  entity: ENTITY_GST_REGISTRATION,
  input: z.object({}),
  handler: async (ctx) => {
    const registration = await ctx.tx.tradingGstRegistration.findFirst({
      where: { active: true },
    });
    if (!registration) return { registration: null, rules: [] };

    const rules = await ctx.tx.tradingTaxRule.findMany({
      where: { registrationId: registration.id },
      orderBy: [{ hsnCode: "asc" }, { effectiveFrom: "desc" }],
    });

    const now = new Date();
    return {
      registration: {
        id: registration.id,
        gstin: registration.gstin,
        stateCode: registration.stateCode,
        registrationType: registration.registrationType,
        invoiceSeriesPrefix: registration.invoiceSeriesPrefix,
        effectiveFrom: registration.effectiveFrom,
      },
      rules: rules.map((rule) => ({
        id: rule.id,
        hsnCode: rule.hsnCode,
        cgstRateBp: rule.cgstRateBp,
        sgstRateBp: rule.sgstRateBp,
        igstRateBp: rule.igstRateBp,
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        inForce:
          rule.effectiveFrom <= now &&
          (rule.effectiveTo === null || rule.effectiveTo > now),
      })),
    };
  },
};

export function registerTax(): void {
  registerCommand(setTaxRule);
  registerQuery(taxSummary);
  registerQuery(gstr1Working);
  registerQuery(gstr3bWorking);
  registerQuery(taxSettings);
  registerQuery(productTaxRates);
}
