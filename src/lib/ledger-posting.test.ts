import { describe, expect, it } from "vitest";
import { accountRoleForMethod, customerReceiptLines, isBalanced, salesInvoiceLines, type AccountMapping } from "./ledger-posting";

const full: AccountMapping = { receivable: "AR", sales_income: "INC", gst_output: "GST", cash: "CASH", bank: "BANK" };
const invoice = { invoiceNumber: "SALES/2026-27/0001", taxablePaise: 100_000, cgstPaise: 9_000, sgstPaise: 9_000, igstPaise: 0, totalPaise: 118_000 };

describe("salesInvoiceLines", () => {
  it("debits the customer for the total and credits the sale and the GST collected, copying the invoice's own figures", () => {
    const result = salesInvoiceLines(invoice, full);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toEqual([
      { accountId: "AR", debitMinor: 118_000, creditMinor: 0 },
      { accountId: "INC", debitMinor: 0, creditMinor: 100_000 },
      { accountId: "GST", debitMinor: 0, creditMinor: 18_000 },
    ]);
    expect(isBalanced(result.lines)).toBe(true);
  });

  it("posts inter-state (IGST) the same way", () => {
    const result = salesInvoiceLines({ ...invoice, cgstPaise: 0, sgstPaise: 0, igstPaise: 18_000 }, full);
    expect(result.ok && result.lines.at(-1)).toEqual({ accountId: "GST", debitMinor: 0, creditMinor: 18_000 });
  });

  it("does not need a GST account for a tax-free invoice", () => {
    const result = salesInvoiceLines({ ...invoice, cgstPaise: 0, sgstPaise: 0, totalPaise: 100_000 }, { receivable: "AR", sales_income: "INC" });
    expect(result.ok).toBe(true);
  });

  it("refuses, naming the missing account, and never falls back to a default", () => {
    const result = salesInvoiceLines(invoice, { receivable: "AR", sales_income: "INC" });
    expect(result).toEqual({ ok: false, reason: "needs an account for: GST collected (output tax)" });
    const none = salesInvoiceLines(invoice, {});
    expect(none.ok).toBe(false);
    expect(!none.ok && none.reason).toContain("Money customers owe");
  });

  it("refuses an invoice whose own figures do not add up instead of correcting it", () => {
    const result = salesInvoiceLines({ ...invoice, totalPaise: 118_001 }, full);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("does not add up");
  });

  it("refuses an invoice for nothing", () => {
    const result = salesInvoiceLines({ ...invoice, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, totalPaise: 0 }, full);
    expect(result.ok).toBe(false);
  });
});

describe("customerReceiptLines", () => {
  it("debits cash for cash and credits the receivable", () => {
    const result = customerReceiptLines({ reference: null, method: "cash", amountPaise: 50_000 }, full);
    expect(result.ok && result.lines).toEqual([
      { accountId: "CASH", debitMinor: 50_000, creditMinor: 0 },
      { accountId: "AR", debitMinor: 0, creditMinor: 50_000 },
    ]);
  });

  it("sends UPI, bank and cheque to the bank account", () => {
    for (const method of ["upi", "bank", "cheque"]) {
      expect(accountRoleForMethod(method)).toBe("bank");
      const result = customerReceiptLines({ reference: "UTR1", method, amountPaise: 1 }, full);
      expect(result.ok && result.lines[0]!.accountId).toBe("BANK");
    }
  });

  it("only needs the account the money lands in", () => {
    expect(customerReceiptLines({ reference: null, method: "cash", amountPaise: 1 }, { receivable: "AR", cash: "CASH" }).ok).toBe(true);
    const result = customerReceiptLines({ reference: null, method: "upi", amountPaise: 1 }, { receivable: "AR", cash: "CASH" });
    expect(result).toEqual({ ok: false, reason: "needs an account for: Bank, UPI and cheques" });
  });

  it("refuses a non-positive amount", () => {
    expect(customerReceiptLines({ reference: null, method: "cash", amountPaise: 0 }, full).ok).toBe(false);
  });
});

describe("isBalanced", () => {
  it("rejects what postJournalEntry rejects", () => {
    expect(isBalanced([{ accountId: "a", debitMinor: 5, creditMinor: 0 }])).toBe(false);
    expect(isBalanced([{ accountId: "a", debitMinor: 5, creditMinor: 0 }, { accountId: "b", debitMinor: 0, creditMinor: 4 }])).toBe(false);
    expect(isBalanced([{ accountId: "a", debitMinor: 5, creditMinor: 5 }, { accountId: "b", debitMinor: 0, creditMinor: 0 }])).toBe(false);
  });
});
