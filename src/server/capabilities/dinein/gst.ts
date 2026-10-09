import { z } from "zod";
import { registerCommand, ValidationError, type CommandContext, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { diffFields, recordActivity } from "@/server/platform/audit";
import { resolveConfig } from "@/server/platform/capability";
import { effectiveTimeZone } from "@/server/platform/temporal";
import type { TenantScopedClient } from "@/server/platform/tenancy";
import { allocateSequence } from "@/server/runtime/document-number";
import {
  computeBill,
  financialYearOf,
  formatBillNumber,
  formatCreditNoteNumber,
  reverseTax,
  splitRate,
  type BillComputation,
} from "@/lib/gst-bill";
import { CONFIG_CGST_RATE, CONFIG_SGST_RATE, ENTITY_BILL } from "./keys";
import { DEFAULT_DAY_START_MINUTE } from "./day";
import { assertOutletInScope, scopedLocationIds } from "./scope";

/**
 * The bill as a GST tax invoice (ADR-040; Task 126 Wave 2).
 *
 * An outlet with an `outlet_profile` raises numbered tax invoices with a tax line
 * per rate, an optional service charge, the seller's identity snapshotted on the
 * bill, and credit notes for refunds. An outlet WITHOUT a profile bills exactly as
 * it always has: nothing here runs for it, so nothing changes until the owner fills
 * the profile in.
 */

type OutletProfileRow = NonNullable<Awaited<ReturnType<TenantScopedClient["outletProfile"]["findFirst"]>>>;

/** The tenant's default TOTAL GST rate in basis points (CGST + SGST), or null when not configured. */
export async function defaultTaxRateBp(tx: TenantScopedClient): Promise<number | null> {
  const cgst = await resolveConfig<number>(tx, CONFIG_CGST_RATE);
  const sgst = await resolveConfig<number>(tx, CONFIG_SGST_RATE);
  if (cgst == null || sgst == null || !Number.isFinite(Number(cgst)) || !Number.isFinite(Number(sgst))) return null;
  return Math.round((Number(cgst) + Number(sgst)) * 100);
}

export async function loadOutletProfile(tx: TenantScopedClient, locationId: string): Promise<OutletProfileRow | null> {
  return tx.outletProfile.findFirst({ where: { locationId } });
}

/**
 * The service-day start for a set of outlets: their shared setting, or the default
 * when any has no profile or they disagree (a report across outlets needs one answer).
 */
export async function dayStartMinuteFor(tx: TenantScopedClient, locationIds: string[]): Promise<number> {
  if (locationIds.length === 0) return DEFAULT_DAY_START_MINUTE;
  const profiles = await tx.outletProfile.findMany({ where: { locationId: { in: locationIds } }, select: { dayStartMinute: true } });
  const values = new Set(profiles.map((p) => p.dayStartMinute));
  return profiles.length === locationIds.length && values.size === 1 ? [...values][0]! : DEFAULT_DAY_START_MINUTE;
}

export type BuiltTaxInvoice = {
  computation: BillComputation;
  taxFree: boolean;
  serviceChargeBp: number;
  number: string;
  sequenceNumber: number;
  financialYear: string;
  profile: OutletProfileRow;
};

/** Works out the invoice and takes its number, inside the caller's transaction. */
export async function buildTaxInvoice(
  ctx: CommandContext,
  order: { channel: string },
  lines: Array<{ unitPriceMinor: number; qty: number; taxRateBp: number | null }>,
  profile: OutletProfileRow,
): Promise<BuiltTaxInvoice> {
  const fallback = await defaultTaxRateBp(ctx.tx);
  const priced = lines.map((line) => {
    const rateBp = line.taxRateBp ?? fallback;
    if (rateBp == null) throw new ValidationError("E_VALIDATION: configure valid GST rates before generating a bill; zero must be explicit");
    return { amountMinor: line.unitPriceMinor * line.qty, rateBp };
  });
  // A platform collects and pays the tax on its own orders; a composition or unregistered outlet charges none.
  const taxFree = profile.registrationType !== "regular" || (order.channel === "delivery_platform" && profile.platformTaxFree);
  // Service charge belongs to table service, not to a parcel or a platform order.
  const serviceChargeBp = order.channel === "dine_in" ? profile.serviceChargeBp : 0;
  const computation = computeBill({ lines: priced, discountMinor: 0, serviceChargeBp, taxFree });

  const timeZone = await effectiveTimeZone(ctx.tx, ctx.actor.organizationId);
  const year = financialYearOf(new Date(), timeZone);
  const { sequenceNumber } = await allocateSequence(ctx.tx, ctx.actor.tenantId, `BILL-${profile.code}`, year.period);
  return {
    computation,
    taxFree,
    serviceChargeBp,
    number: formatBillNumber(profile.code, year.short, sequenceNumber),
    sequenceNumber,
    financialYear: year.period,
    profile,
  };
}

/** The columns of a new bill that come from a built invoice. */
export function taxInvoiceBillFields(built: BuiltTaxInvoice) {
  const { computation: c, profile } = built;
  // Older readers show one pair of rates. A bill at a single rate keeps showing it; a mixed or tax-free bill shows none.
  const single = c.taxLines.length === 1 && !built.taxFree ? splitRate(c.taxLines[0]!.rateBp) : { cgstBp: 0, sgstBp: 0 };
  return {
    subtotalMinor: c.subtotalMinor,
    discountMinor: c.discountMinor,
    cgstRateBp: single.cgstBp,
    cgstMinor: c.cgstMinor,
    sgstRateBp: single.sgstBp,
    sgstMinor: c.sgstMinor,
    taxableMinor: c.taxableMinor,
    totalMinor: c.totalMinor,
    roundingMinor: c.roundingMinor,
    number: built.number,
    sequenceNumber: built.sequenceNumber,
    financialYear: built.financialYear,
    sellerLegalName: profile.legalName,
    sellerGstin: profile.gstin,
    sellerFssai: profile.fssai,
    sellerAddress: profile.addressLines,
    serviceChargeBp: built.serviceChargeBp,
    serviceChargeMinor: c.serviceChargeMinor,
    taxFree: built.taxFree,
  };
}

export async function writeTaxLines(tx: TenantScopedClient, tenantId: string, billId: string, c: BillComputation): Promise<void> {
  if (c.taxLines.length === 0) return;
  await tx.billTaxLine.createMany({
    data: c.taxLines.map((l) => ({
      tenantId,
      billId,
      rateBp: l.rateBp,
      grossMinor: l.grossMinor,
      taxableMinor: l.taxableMinor,
      cgstMinor: l.cgstMinor,
      sgstMinor: l.sgstMinor,
    })),
  });
}

/**
 * Re-prices an open tax invoice after a discount or a waived service charge, from
 * the gross per rate it was raised with. The number and seller stay; the tax lines
 * and totals are rewritten.
 */
export async function repriceTaxInvoice(
  ctx: CommandContext,
  billId: string,
  change: { discountMinor?: number; serviceChargeBp?: number },
) {
  const bill = await ctx.tx.bill.findUniqueOrThrow({ where: { id: billId }, include: { taxLines: true } });
  const computation = computeBill({
    lines: bill.taxLines.map((t) => ({ amountMinor: t.grossMinor, rateBp: t.rateBp })),
    discountMinor: change.discountMinor ?? bill.discountMinor,
    serviceChargeBp: change.serviceChargeBp ?? bill.serviceChargeBp,
    taxFree: bill.taxFree,
  });
  await ctx.tx.billTaxLine.deleteMany({ where: { billId } });
  await writeTaxLines(ctx.tx, ctx.actor.tenantId, billId, computation);
  const single = computation.taxLines.length === 1 && !bill.taxFree ? splitRate(computation.taxLines[0]!.rateBp) : { cgstBp: 0, sgstBp: 0 };
  return ctx.tx.bill.update({
    where: { id: billId },
    data: {
      discountMinor: computation.discountMinor,
      serviceChargeBp: change.serviceChargeBp ?? bill.serviceChargeBp,
      serviceChargeMinor: computation.serviceChargeMinor,
      cgstRateBp: single.cgstBp,
      sgstRateBp: single.sgstBp,
      cgstMinor: computation.cgstMinor,
      sgstMinor: computation.sgstMinor,
      taxableMinor: computation.taxableMinor,
      totalMinor: computation.totalMinor,
      roundingMinor: computation.roundingMinor,
      version: { increment: 1 },
    },
  });
}

/**
 * Takes the next credit-note number for a refund against a numbered bill and works
 * out the tax it reverses. Returns null for a bill raised before the outlet had a
 * profile, whose refund stays as it was.
 */
export async function planCreditNote(
  ctx: CommandContext,
  bill: { number: string | null; locationId: string; taxLines: Array<{ rateBp: number; taxableMinor: number; cgstMinor: number; sgstMinor: number }> },
  amountMinor: number,
) {
  if (!bill.number) return null;
  const profile = await loadOutletProfile(ctx.tx, bill.locationId);
  const code = profile?.code ?? bill.number.split("/")[0]!;
  const timeZone = await effectiveTimeZone(ctx.tx, ctx.actor.organizationId);
  const year = financialYearOf(new Date(), timeZone);
  const { sequenceNumber } = await allocateSequence(ctx.tx, ctx.actor.tenantId, `CN-${code}`, year.period);
  return {
    number: formatCreditNoteNumber(code, year.short, sequenceNumber),
    sequenceNumber,
    taxLines: reverseTax(bill.taxLines, amountMinor),
  };
}

/* ============================== commands ============================== */

export const waiveServiceCharge: CommandDefinition<{ billId: string; reason: string }, { totalMinor: number }> = {
  key: "verity.dinein.waive_service_charge",
  entity: ENTITY_BILL,
  verb: "ActionExecute",
  input: z.object({ billId: z.string().uuid(), reason: z.string().trim().min(3).max(200) }),
  preconditions: async (ctx, input) => {
    const bill = await ctx.tx.bill.findUnique({ where: { id: input.billId } });
    if (!bill) throw new ValidationError("E_VALIDATION: bill not found");
    await assertOutletInScope(ctx.tx, ctx.actor, ENTITY_BILL, "ActionExecute", bill.locationId);
    if (bill.state !== "open") throw new ValidationError("E_VALIDATION: that bill is closed");
    if (bill.serviceChargeBp <= 0) throw new ValidationError("E_VALIDATION: this bill has no service charge");
  },
  handler: async (ctx, input) => {
    const before = await ctx.tx.bill.findUniqueOrThrow({ where: { id: input.billId } });
    const after = await repriceTaxInvoice(ctx, input.billId, { serviceChargeBp: 0 });
    await recordActivity(ctx, {
      entityKey: ENTITY_BILL,
      entityId: after.id,
      commandKey: "verity.dinein.waive_service_charge",
      changes: diffFields(
        { serviceChargeMinor: before.serviceChargeMinor, totalMinor: before.totalMinor },
        { serviceChargeMinor: after.serviceChargeMinor, totalMinor: after.totalMinor, reason: input.reason },
      ),
    });
    return { result: { totalMinor: after.totalMinor }, events: [{ name: "verity.dinein.service_charge_waived", entityId: after.id }] };
  },
};

const REGISTRATIONS = ["regular", "composition", "unregistered"] as const;

export const saveOutletProfile: CommandDefinition<
  {
    locationId: string;
    code: string;
    legalName: string;
    gstin?: string | null;
    stateCode?: string | null;
    registrationType: (typeof REGISTRATIONS)[number];
    fssai?: string | null;
    addressLines?: string | null;
    dayStartMinute: number;
    serviceChargeBp: number;
    platformTaxFree: boolean;
  },
  { id: string }
> = {
  key: "verity.dinein.save_outlet_profile",
  entity: ENTITY_BILL,
  verb: "Edit",
  input: z.object({
    locationId: z.string().uuid(),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,3}$/, "up to three letters or digits"),
    legalName: z.string().trim().min(1).max(200),
    gstin: z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$/, "a 15-character GSTIN").nullish(),
    stateCode: z.string().trim().regex(/^[0-9]{2}$/, "two digits").nullish(),
    registrationType: z.enum(REGISTRATIONS),
    fssai: z.string().trim().max(40).nullish(),
    addressLines: z.string().trim().max(400).nullish(),
    dayStartMinute: z.number().int().min(0).max(1439),
    serviceChargeBp: z.number().int().min(0).max(2000),
    platformTaxFree: z.boolean(),
  }),
  preconditions: async (ctx, input) => {
    await assertOutletInScope(ctx.tx, ctx.actor, ENTITY_BILL, "Edit", input.locationId);
    if (input.registrationType !== "unregistered" && !input.gstin) {
      throw new ValidationError("E_VALIDATION: a registered outlet needs its GSTIN");
    }
    const clash = await ctx.tx.outletProfile.findFirst({ where: { code: input.code, NOT: { locationId: input.locationId } } });
    if (clash) throw new ValidationError(`E_VALIDATION: the code ${input.code} is already another outlet's`);
  },
  handler: async (ctx, input) => {
    const data = {
      code: input.code,
      legalName: input.legalName,
      gstin: input.gstin || null,
      stateCode: input.stateCode || null,
      registrationType: input.registrationType,
      fssai: input.fssai || null,
      addressLines: input.addressLines || null,
      dayStartMinute: input.dayStartMinute,
      serviceChargeBp: input.serviceChargeBp,
      platformTaxFree: input.platformTaxFree,
    };
    const before = await loadOutletProfile(ctx.tx, input.locationId);
    const saved = before
      ? await ctx.tx.outletProfile.update({ where: { id: before.id }, data: { ...data, version: { increment: 1 } } })
      : await ctx.tx.outletProfile.create({ data: { tenantId: ctx.actor.tenantId, locationId: input.locationId, ...data } });
    // The code prefixes every bill number, so changing it after bills exist is refused:
    // a series that changes its prefix mid-year is two series.
    if (before && before.code !== input.code) {
      const issued = await ctx.tx.bill.count({ where: { locationId: input.locationId, number: { not: null } } });
      if (issued > 0) throw new ValidationError("E_VALIDATION: bills have already been numbered with the old code, so it cannot change");
    }
    await recordActivity(ctx, {
      entityKey: ENTITY_BILL,
      entityId: saved.id,
      commandKey: "verity.dinein.save_outlet_profile",
      changes: diffFields(
        before
          ? {
              code: before.code,
              legalName: before.legalName,
              gstin: before.gstin,
              stateCode: before.stateCode,
              registrationType: before.registrationType,
              fssai: before.fssai,
              addressLines: before.addressLines,
              dayStartMinute: before.dayStartMinute,
              serviceChargeBp: before.serviceChargeBp,
              platformTaxFree: before.platformTaxFree,
            }
          : {},
        data,
      ),
    });
    return { result: { id: saved.id }, events: [{ name: "verity.dinein.outlet_profile_saved", entityId: saved.id }] };
  },
};

/* =============================== queries =============================== */

export type OutletProfileView = {
  locationId: string;
  locationName: string;
  profile: {
    code: string;
    legalName: string;
    gstin: string | null;
    stateCode: string | null;
    registrationType: string;
    fssai: string | null;
    addressLines: string | null;
    dayStartMinute: number;
    serviceChargeBp: number;
    platformTaxFree: boolean;
    cutoverAt: Date;
  } | null;
};

export const listOutletProfiles: QueryDefinition<{ locationId?: string }, OutletProfileView[]> = {
  key: "verity.dinein.list_outlet_profiles",
  entity: ENTITY_BILL,
  input: z.object({ locationId: z.string().uuid().optional() }),
  handler: async (ctx, input) => {
    const ids = await scopedLocationIds(ctx.tx, ctx.actor, ENTITY_BILL, input.locationId);
    const locations = await ctx.tx.location.findMany({ where: { id: { in: ids }, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
    const profiles = await ctx.tx.outletProfile.findMany({ where: { locationId: { in: ids } } });
    return locations.map((l) => {
      const p = profiles.find((x) => x.locationId === l.id);
      return {
        locationId: l.id,
        locationName: l.name,
        profile: p
          ? {
              code: p.code,
              legalName: p.legalName,
              gstin: p.gstin,
              stateCode: p.stateCode,
              registrationType: p.registrationType,
              fssai: p.fssai,
              addressLines: p.addressLines,
              dayStartMinute: p.dayStartMinute,
              serviceChargeBp: p.serviceChargeBp,
              platformTaxFree: p.platformTaxFree,
              cutoverAt: p.cutoverAt,
            }
          : null,
      };
    });
  },
};

export type GstSummary = {
  month: string;
  timeZone: string;
  outlets: Array<{
    locationId: string;
    locationName: string;
    gstin: string | null;
    invoices: { count: number; first: string | null; last: string | null };
    /** Outward supplies by rate (settled, taxed bills). */
    rates: Array<{ rateBp: number; taxableMinor: number; cgstMinor: number; sgstMinor: number }>;
    /** Taxable value of supplies whose invoice carries no tax (platform orders, composition). */
    taxFreeMinor: number;
    creditNotes: { count: number; first: string | null; last: string | null; rates: Array<{ rateBp: number; taxableMinor: number; cgstMinor: number; sgstMinor: number }> };
  }>;
};

/**
 * The restaurant's outward supplies for a month, by rate, with the credit notes and
 * the range of document numbers issued: the figures a GSTR-1 for B2C sales asks for
 * (ADR-040, Task 126 item 2.9). A summary to file from, not a filing.
 */
export const gstSummary: QueryDefinition<{ month?: string; locationId?: string }, GstSummary> = {
  key: "verity.dinein.gst_summary",
  entity: ENTITY_BILL,
  input: z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(), locationId: z.string().uuid().optional() }),
  handler: async (ctx, input) => {
    const timeZone = await effectiveTimeZone(ctx.tx, ctx.actor.organizationId);
    const [current] = await ctx.tx.$queryRaw<Array<{ month: string }>>`SELECT to_char(now() AT TIME ZONE ${timeZone}, 'YYYY-MM') AS month`;
    const month = input.month ?? current!.month;
    const [range] = await ctx.tx.$queryRaw<Array<{ from: Date; to: Date }>>`
      SELECT ((${month + "-01"}::date)::timestamp AT TIME ZONE ${timeZone}) AS "from",
             (((${month + "-01"}::date) + interval '1 month')::timestamp AT TIME ZONE ${timeZone}) AS "to"`;

    const ids = await scopedLocationIds(ctx.tx, ctx.actor, ENTITY_BILL, input.locationId);
    const locations = await ctx.tx.location.findMany({ where: { id: { in: ids } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
    const profiles = await ctx.tx.outletProfile.findMany({ where: { locationId: { in: ids } }, select: { locationId: true, gstin: true } });

    const bills = await ctx.tx.bill.findMany({
      where: { locationId: { in: ids }, number: { not: null }, createdAt: { gte: range!.from, lt: range!.to } },
      include: { taxLines: true },
      orderBy: { sequenceNumber: "asc" },
    });
    const refunds = await ctx.tx.billRefund.findMany({
      where: { bill: { is: { locationId: { in: ids } } }, creditNoteNumber: { not: null }, createdAt: { gte: range!.from, lt: range!.to } },
      include: { taxLines: true, bill: { select: { locationId: true } } },
      orderBy: { creditNoteSequence: "asc" },
    });

    const fold = (rows: Array<{ rateBp: number; taxableMinor: number; cgstMinor: number; sgstMinor: number }>) => {
      const byRate = new Map<number, { rateBp: number; taxableMinor: number; cgstMinor: number; sgstMinor: number }>();
      for (const r of rows) {
        const row = byRate.get(r.rateBp) ?? { rateBp: r.rateBp, taxableMinor: 0, cgstMinor: 0, sgstMinor: 0 };
        row.taxableMinor += r.taxableMinor;
        row.cgstMinor += r.cgstMinor;
        row.sgstMinor += r.sgstMinor;
        byRate.set(r.rateBp, row);
      }
      return [...byRate.values()].sort((a, b) => a.rateBp - b.rateBp);
    };

    return {
      month,
      timeZone,
      outlets: locations.map((l) => {
        const mine = bills.filter((b) => b.locationId === l.id);
        const taxed = mine.filter((b) => b.state === "settled" && !b.taxFree);
        const free = mine.filter((b) => b.state === "settled" && b.taxFree);
        const notes = refunds.filter((r) => r.bill.locationId === l.id);
        return {
          locationId: l.id,
          locationName: l.name,
          gstin: profiles.find((p) => p.locationId === l.id)?.gstin ?? null,
          invoices: { count: mine.length, first: mine[0]?.number ?? null, last: mine[mine.length - 1]?.number ?? null },
          rates: fold(taxed.flatMap((b) => b.taxLines)),
          taxFreeMinor: free.reduce((s, b) => s + b.taxableMinor, 0),
          creditNotes: {
            count: notes.length,
            first: notes[0]?.creditNoteNumber ?? null,
            last: notes[notes.length - 1]?.creditNoteNumber ?? null,
            rates: fold(notes.flatMap((n) => n.taxLines)),
          },
        };
      }),
    };
  },
};

export function registerDineinGst(): void {
  registerCommand(waiveServiceCharge);
  registerCommand(saveOutletProfile);
  registerQuery(listOutletProfiles);
  registerQuery(gstSummary);
}
