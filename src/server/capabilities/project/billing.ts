import { z } from "zod";
import { ValidationError, type CommandDefinition } from "@/server/platform/command";
import type { TenantScopedClient } from "@/server/platform/tenancy";
import { ENTITY_PROJECT_INVOICE, ENTITY_PROJECT_RECEIPT, INVOICE_KINDS, RECEIPT_METHODS } from "./shared";

/**
 * The billing record of a job: invoices the business has raised, and money received against them.
 *
 * This records; it does not compute tax or generate a GST invoice. The business raises its invoice where it
 * does today and enters the number and the amounts here, so the job can say what has been billed, what has
 * been paid and what is still to collect. Money is integer minor units. A wrong entry is voided with a
 * reason, never edited or deleted, and a voided invoice number may be used again.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");
const asDate = (d: string) => new Date(`${d}T00:00:00.000Z`);
const MAX_MINOR = 2_000_000_000;

/** Billing continues after a job is finished, because a finished job is still being paid for. */
const BILLABLE_STATES = ["approved", "in_progress", "on_hold", "completed"];

async function loadBillableJob(tx: TenantScopedClient, jobId: string, what: string) {
  const job = await tx.projectJob.findUnique({ where: { id: jobId } });
  if (!job) throw new ValidationError("E_VALIDATION: job not found in this tenant");
  if (!BILLABLE_STATES.includes(job.state)) {
    throw new ValidationError(
      `E_VALIDATION: ${what} needs an approved job; this job is ${job.state.replace(/_/g, " ")}`,
    );
  }
  return job;
}

function notFuture(date: string, what: string): void {
  if (asDate(date).getTime() > Date.now() + 24 * 3600 * 1000) {
    throw new ValidationError(`E_VALIDATION: ${what} cannot be in the future`);
  }
}

export const recordInvoice: CommandDefinition<
  {
    jobId: string;
    kind: (typeof INVOICE_KINDS)[number];
    number: string;
    issuedOn: string;
    amountMinor: number;
    taxMinor?: number;
    note?: string;
  },
  { id: string }
> = {
  key: "verity.project.record_invoice",
  entity: ENTITY_PROJECT_INVOICE,
  verb: "Create",
  description: "Record an invoice you raised for this job: its number, date, amount and the tax on it.",
  input: z.object({
    jobId: z.string().uuid(),
    kind: z.enum(INVOICE_KINDS),
    number: z.string().trim().min(1).max(40),
    issuedOn: isoDate,
    amountMinor: z.number().int().positive().max(MAX_MINOR),
    taxMinor: z.number().int().min(0).max(MAX_MINOR).optional(),
    note: z.string().trim().max(400).optional(),
  }),
  handler: async (ctx, input) => {
    const job = await loadBillableJob(ctx.tx, input.jobId, "recording an invoice");
    notFuture(input.issuedOn, "the invoice date");
    const tax = input.taxMinor ?? 0;
    if (tax > input.amountMinor) throw new ValidationError("E_VALIDATION: the tax cannot be more than the amount it is charged on");

    if (await ctx.tx.projectInvoice.findFirst({ where: { number: input.number, voidedAt: null } })) {
      throw new ValidationError(`E_VALIDATION: invoice number ${input.number} is already recorded; void that entry first if it was a mistake`);
    }
    // The agreed price is the ceiling. A genuine extra is a new quote, not a larger invoice.
    const billed = await ctx.tx.projectInvoice.aggregate({ where: { jobId: job.id, voidedAt: null }, _sum: { amountMinor: true } });
    const total = (billed._sum.amountMinor ?? 0) + input.amountMinor;
    if (job.quotedValueMinor !== null && total > job.quotedValueMinor) {
      throw new ValidationError("E_VALIDATION: that would bill more than the agreed order value of this job");
    }

    const row = await ctx.tx.projectInvoice.create({
      data: {
        tenantId: ctx.actor.tenantId,
        jobId: job.id,
        kind: input.kind,
        number: input.number,
        issuedOn: asDate(input.issuedOn),
        amountMinor: input.amountMinor,
        taxMinor: tax,
        note: input.note ?? null,
        createdById: ctx.actor.userId,
      },
    });
    return { result: { id: row.id }, events: [{ name: "verity.project.invoice_recorded", entityId: row.id }] };
  },
};

export const voidInvoice: CommandDefinition<{ invoiceId: string; reason: string }, { id: string }> = {
  key: "verity.project.void_invoice",
  entity: ENTITY_PROJECT_INVOICE,
  verb: "Edit",
  impact: "destructive",
  description: "Cancel an invoice record entered wrongly. It stays on record, marked void.",
  input: z.object({ invoiceId: z.string().uuid(), reason: z.string().trim().min(3).max(300) }),
  handler: async (ctx, input) => {
    const row = await ctx.tx.projectInvoice.findUniqueOrThrow({ where: { id: input.invoiceId } });
    if (row.voidedAt) throw new ValidationError("E_VALIDATION: this invoice is already void");
    await loadBillableJob(ctx.tx, row.jobId, "voiding an invoice");
    const paid = await ctx.tx.projectReceipt.count({ where: { invoiceId: row.id, voidedAt: null } });
    if (paid > 0) throw new ValidationError("E_VALIDATION: payments are recorded against this invoice; void those first");
    await ctx.tx.projectInvoice.update({ where: { id: row.id }, data: { voidedAt: new Date(), voidReason: input.reason } });
    return { result: { id: row.id }, events: [{ name: "verity.project.invoice_voided", entityId: row.id }] };
  },
};

export const recordReceipt: CommandDefinition<
  {
    jobId: string;
    invoiceId: string;
    receivedOn: string;
    amountMinor: number;
    method: (typeof RECEIPT_METHODS)[number];
    reference?: string;
  },
  { id: string }
> = {
  key: "verity.project.record_receipt",
  entity: ENTITY_PROJECT_RECEIPT,
  verb: "Create",
  description: "Record money received against one of this job's invoices.",
  input: z.object({
    jobId: z.string().uuid(),
    invoiceId: z.string().uuid(),
    receivedOn: isoDate,
    amountMinor: z.number().int().positive().max(MAX_MINOR),
    method: z.enum(RECEIPT_METHODS),
    reference: z.string().trim().max(120).optional(),
  }),
  handler: async (ctx, input) => {
    const job = await loadBillableJob(ctx.tx, input.jobId, "recording a payment");
    notFuture(input.receivedOn, "the receipt date");
    const invoice = await ctx.tx.projectInvoice.findUnique({ where: { id: input.invoiceId } });
    if (!invoice || invoice.jobId !== job.id) throw new ValidationError("E_VALIDATION: that invoice does not belong to this job");
    if (invoice.voidedAt) throw new ValidationError("E_VALIDATION: that invoice is void");

    const paid = await ctx.tx.projectReceipt.aggregate({ where: { invoiceId: invoice.id, voidedAt: null }, _sum: { amountMinor: true } });
    const due = invoice.amountMinor + invoice.taxMinor - (paid._sum.amountMinor ?? 0);
    if (input.amountMinor > due) {
      throw new ValidationError("E_VALIDATION: that is more than is still due on this invoice");
    }

    const row = await ctx.tx.projectReceipt.create({
      data: {
        tenantId: ctx.actor.tenantId,
        jobId: job.id,
        invoiceId: invoice.id,
        receivedOn: asDate(input.receivedOn),
        amountMinor: input.amountMinor,
        method: input.method,
        reference: input.reference ?? null,
        createdById: ctx.actor.userId,
      },
    });
    return { result: { id: row.id }, events: [{ name: "verity.project.receipt_recorded", entityId: row.id }] };
  },
};

export const voidReceipt: CommandDefinition<{ receiptId: string; reason: string }, { id: string }> = {
  key: "verity.project.void_receipt",
  entity: ENTITY_PROJECT_RECEIPT,
  verb: "Edit",
  impact: "destructive",
  description: "Cancel a payment record entered wrongly. It stays on record, marked void.",
  input: z.object({ receiptId: z.string().uuid(), reason: z.string().trim().min(3).max(300) }),
  handler: async (ctx, input) => {
    const row = await ctx.tx.projectReceipt.findUniqueOrThrow({ where: { id: input.receiptId } });
    if (row.voidedAt) throw new ValidationError("E_VALIDATION: this payment is already void");
    await loadBillableJob(ctx.tx, row.jobId, "voiding a payment");
    await ctx.tx.projectReceipt.update({ where: { id: row.id }, data: { voidedAt: new Date(), voidReason: input.reason } });
    return { result: { id: row.id }, events: [{ name: "verity.project.receipt_voided", entityId: row.id }] };
  },
};
