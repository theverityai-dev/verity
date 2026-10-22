/**
 * What a business document becomes in the ledger (ADR-044, Task 130). Pure: figures in, balanced lines out, no database.
 *
 * Two rules the whole design leans on:
 *  - Amounts are COPIED from the document. Tax is never recomputed here, so the ledger cannot disagree with the invoice the
 *    customer holds (ADR-044 clause 6). A document whose own figures do not add up is refused, not corrected.
 *  - A role with no account yields a refusal that names it. Nothing posts to a default account (clause 4).
 */

export const ACCOUNT_ROLES = ["receivable", "sales_income", "gst_output", "cash", "bank"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export const ROLE_LABELS: Record<AccountRole, string> = {
  receivable: "Money customers owe (receivable)",
  sales_income: "Sales income",
  gst_output: "GST collected (output tax)",
  cash: "Cash in hand",
  bank: "Bank, UPI and cheques",
};

/** Which roles each kind of document needs, so the setup screen can say what is blocking what. */
export const KIND_ROLES = {
  "trading.sales_invoice": ["receivable", "sales_income", "gst_output"],
  "trading.customer_receipt": ["receivable", "cash", "bank"],
  // Jobs (the project capability) bill in minor units with one tax figure; both post like the trading equivalents.
  "project.invoice": ["receivable", "sales_income", "gst_output"],
  "project.receipt": ["receivable", "cash", "bank"],
} as const satisfies Record<string, readonly AccountRole[]>;
export type SourceKind = keyof typeof KIND_ROLES;

export const KIND_LABELS: Record<SourceKind, string> = {
  "trading.sales_invoice": "Sales invoices",
  "trading.customer_receipt": "Payments received from customers",
  "project.invoice": "Job invoices",
  "project.receipt": "Payments received on jobs",
};

/** A void posts its own entry under this kind, reversing the original; it needs no account of its own. */
export const VOID_KIND = { "project.invoice": "project.invoice_void", "project.receipt": "project.receipt_void" } as const;

export type AccountMapping = Partial<Record<AccountRole, string>>;
export type PostingLine = { accountId: string; debitMinor: number; creditMinor: number };
export type PostingResult = { ok: true; memo: string; lines: PostingLine[] } | { ok: false; reason: string };

function missing(mapping: AccountMapping, roles: readonly AccountRole[]): AccountRole[] {
  return roles.filter((role) => !mapping[role]);
}

function needs(roles: AccountRole[]): string {
  return `needs an account for: ${roles.map((role) => ROLE_LABELS[role]).join(", ")}`;
}

export type SalesInvoiceFigures = {
  invoiceNumber: string;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
};

/** Debit what the customer owes; credit the sale and the GST collected. */
export function salesInvoiceLines(doc: SalesInvoiceFigures, mapping: AccountMapping): PostingResult {
  const tax = doc.cgstPaise + doc.sgstPaise + doc.igstPaise;
  if (doc.taxablePaise < 0 || tax < 0 || doc.taxablePaise + tax !== doc.totalPaise) {
    return { ok: false, reason: `invoice ${doc.invoiceNumber} does not add up (taxable ${doc.taxablePaise} + tax ${tax} is not total ${doc.totalPaise})` };
  }
  if (doc.totalPaise === 0) return { ok: false, reason: `invoice ${doc.invoiceNumber} is for nothing, so there is nothing to post` };
  const absent = missing(mapping, tax > 0 ? KIND_ROLES["trading.sales_invoice"] : ["receivable", "sales_income"]);
  if (absent.length) return { ok: false, reason: needs(absent) };

  const lines: PostingLine[] = [{ accountId: mapping.receivable!, debitMinor: doc.totalPaise, creditMinor: 0 }];
  if (doc.taxablePaise > 0) lines.push({ accountId: mapping.sales_income!, debitMinor: 0, creditMinor: doc.taxablePaise });
  if (tax > 0) lines.push({ accountId: mapping.gst_output!, debitMinor: 0, creditMinor: tax });
  return { ok: true, memo: `Sales invoice ${doc.invoiceNumber}`, lines };
}

export type ReceiptFigures = { reference: string | null; method: string; amountPaise: number };

/** Cash and cheque-in-hand go to the cash account only for `cash`; UPI, bank transfer and cheque go to the bank account. */
export function accountRoleForMethod(method: string): "cash" | "bank" {
  return method === "cash" ? "cash" : "bank";
}

/** Debit where the money landed; credit what the customer owed. */
export function customerReceiptLines(doc: ReceiptFigures, mapping: AccountMapping): PostingResult {
  if (!Number.isInteger(doc.amountPaise) || doc.amountPaise <= 0) return { ok: false, reason: "the payment amount is not a positive whole number of paise" };
  const landing = accountRoleForMethod(doc.method);
  const absent = missing(mapping, ["receivable", landing]);
  if (absent.length) return { ok: false, reason: needs(absent) };
  return {
    ok: true,
    memo: `Payment received (${doc.method})${doc.reference ? ` ${doc.reference}` : ""}`,
    lines: [
      { accountId: mapping[landing]!, debitMinor: doc.amountPaise, creditMinor: 0 },
      { accountId: mapping.receivable!, debitMinor: 0, creditMinor: doc.amountPaise },
    ],
  };
}

/** A job invoice: the amount is before tax and the tax is one figure, so total = amount + tax. */
export function jobInvoiceLines(doc: { number: string; amountMinor: number; taxMinor: number }, mapping: AccountMapping): PostingResult {
  const result = salesInvoiceLines(
    { invoiceNumber: doc.number, taxablePaise: doc.amountMinor, cgstPaise: doc.taxMinor, sgstPaise: 0, igstPaise: 0, totalPaise: doc.amountMinor + doc.taxMinor },
    mapping,
  );
  return result.ok ? { ...result, memo: `Job invoice ${doc.number}` } : result;
}

/** Money received on a job: bank, cheque, UPI and "other" land in the bank account, cash in the cash account. */
export function jobReceiptLines(doc: { method: string; amountMinor: number; reference: string | null }, mapping: AccountMapping): PostingResult {
  const result = customerReceiptLines({ reference: doc.reference, method: doc.method, amountPaise: doc.amountMinor }, mapping);
  return result.ok ? { ...result, memo: `Payment received on a job (${doc.method})${doc.reference ? ` ${doc.reference}` : ""}` } : result;
}

/** The lines of a reversal: every debit becomes the same credit and back. */
export function reverseLines(lines: PostingLine[]): PostingLine[] {
  return lines.map((line) => ({ accountId: line.accountId, debitMinor: line.creditMinor, creditMinor: line.debitMinor }));
}

/** The same balance rule `postJournalEntry` applies, so a consumer can never write an entry the command would refuse. */
export function isBalanced(lines: PostingLine[]): boolean {
  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    if ((line.debitMinor > 0) === (line.creditMinor > 0)) return false;
    debit += line.debitMinor;
    credit += line.creditMinor;
  }
  return lines.length >= 2 && debit === credit && debit > 0;
}
