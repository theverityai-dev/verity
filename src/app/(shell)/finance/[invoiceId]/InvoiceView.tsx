"use client";

/* eslint-disable no-restricted-syntax -- Task 121 grandfathered debt (bare <table>), migrate to DataTable/SmartTable opportunistically */

import Link from "next/link";
import { Button } from "@/components/ui/primitives";
import { Related } from "@/components/ui/business/Related";

type Invoice = {
  id: string;
  invoiceNumber: string;
  direction: "sales" | "purchase";
  customerId: string | null;
  supplierId: string | null;
  salesOrderId: string | null;
  purchaseOrderId: string | null;
  partyName: string;
  partyGstin: string | null;
  issuedAt: Date | string;
  interState: boolean;
  supplyStateCode: string;
  placeOfSupplyStateCode: string;
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
    receivedAt: Date | string;
  }>;
  lines: Array<{
    name: string;
    hsnCode: string | null;
    qtyUnits: number;
    unitPricePaise: number;
    lineTotalPaise: number;
  }>;
};

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function longDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
}

/** "9%" from 900 basis points, without a trailing zero nobody wants to read. */
function percent(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(basisPoints % 100 === 0 ? 0 : 2)}%`;
}

/**
 * A printable GST tax invoice.
 *
 * The printable half is deliberately solid — no glass, no translucency. ADR-011
 * makes glass a material for depth on screen, and depth is meaningless on paper;
 * what a printer needs is ink on white, which a frosted panel is not.
 *
 * Every tax line prints its rate as well as its amount. PRN-001 asks that
 * automation be explainable, and "CGST ₹90,000" without "9%" is a number the
 * reader has to trust rather than check. The rates come from the invoice, not
 * from configuration: a rate change next quarter must not restate a document
 * that has already been filed.
 *
 * There is no PDF library here. Every operating system prints to PDF, which is
 * also how the invoice gets shared — a library would add a dependency to do
 * worse what the browser already does well.
 */
export function InvoiceView({
  invoice,
  seller,
}: {
  invoice: Invoice;
  seller: { name: string; stateCode: string | null };
}) {
  const sale = invoice.direction === "sales";

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/finance" className="text-[13px] text-text-secondary no-underline hover:underline">
          ← Finance
        </Link>
        <div className="flex gap-2">
          <Button onClick={() => window.print()} variant="primary">
            Print or save as PDF
          </Button>
        </div>
      </div>

      <section className="rounded-[12px] bg-surface p-8 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-line pb-6">
          <div>
            <p className="m-0 text-[13px] uppercase tracking-[0.02em] text-text-secondary">
              {sale ? "Tax invoice" : "Purchase invoice"}
            </p>
            <h1 className="mb-0 mt-2 text-[22px] font-normal leading-tight text-text">
              {seller.name}
            </h1>
            {seller.stateCode && (
              <p className="tabular mb-0 mt-1 text-[12px] text-text-secondary">
                State code {seller.stateCode}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="tabular m-0 text-[18px] text-text">{invoice.invoiceNumber}</p>
            <p className="mb-0 mt-1 text-[13px] text-text-secondary">
              {longDate(invoice.issuedAt)}
            </p>
          </div>
        </header>

        <div className="flex flex-wrap justify-between gap-6 border-b border-line py-5">
          <div>
            <p className="m-0 text-[13px] uppercase tracking-[0.02em] text-text-secondary">
              {sale ? "Billed to" : "Billed by"}
            </p>
            <p className="mb-0 mt-2 text-[15px] text-text">{invoice.partyName}</p>
            {invoice.partyGstin && (
              <p className="tabular mb-0 mt-1 text-[12px] text-text-secondary">
                GSTIN {invoice.partyGstin}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="m-0 text-[13px] uppercase tracking-[0.02em] text-text-secondary">
              Place of supply
            </p>
            <p className="tabular mb-0 mt-2 text-[15px] text-text">
              {invoice.placeOfSupplyStateCode}
            </p>
            {/* Why this invoice carries the tax it carries, said plainly. */}
            <p className="mb-0 mt-1 text-[12px] text-text-secondary">
              {invoice.interState ? "Inter-state — IGST" : "Intra-state — CGST and SGST"}
            </p>
          </div>
        </div>

        <table className="w-full border-collapse py-4">
          <caption className="sr-only">Invoice lines</caption>
          <thead>
            <tr>
              {["Description", "HSN", "Qty", "Rate", "Amount"].map((heading, index) => (
                <th
                  key={heading}
                  className={
                    "border-b border-line px-2 py-3 text-[13px] uppercase tracking-[0.02em] text-text-secondary " +
                    (index === 0 ? "text-left" : "text-right")
                  }
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, index) => (
              <tr key={`${line.name}-${index}`}>
                <td className="border-b border-line px-2 py-3 text-[14px] text-text">
                  {line.name}
                </td>
                <td className="tabular border-b border-line px-2 py-3 text-right text-[13px] text-text-secondary">
                  {line.hsnCode ?? "—"}
                </td>
                <td className="tabular border-b border-line px-2 py-3 text-right text-[14px]">
                  {line.qtyUnits}
                </td>
                <td className="tabular border-b border-line px-2 py-3 text-right text-[14px]">
                  {rupees(line.unitPricePaise)}
                </td>
                <td className="tabular border-b border-line px-2 py-3 text-right text-[14px]">
                  {rupees(line.lineTotalPaise)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 flex justify-end">
          <dl className="m-0 w-full max-w-[340px]">
            <Row label="Taxable value" value={rupees(invoice.taxablePaise)} />
            {invoice.interState ? (
              <Row
                label={`IGST ${percent(invoice.igstRateBp)}`}
                value={rupees(invoice.igstPaise)}
              />
            ) : (
              <>
                <Row
                  label={`CGST ${percent(invoice.cgstRateBp)}`}
                  value={rupees(invoice.cgstPaise)}
                />
                <Row
                  label={`SGST ${percent(invoice.sgstRateBp)}`}
                  value={rupees(invoice.sgstPaise)}
                />
              </>
            )}
            <div className="mt-2 flex items-baseline justify-between border-t border-line pt-3">
              <dt className="m-0 text-[14px] text-text">Total</dt>
              <dd className="tabular m-0 text-[18px] text-text">{rupees(invoice.totalPaise)}</dd>
            </div>
            {invoice.paidPaise > 0 && (
              <>
                <Row label="Received" value={rupees(invoice.paidPaise)} />
                <Row
                  label="Outstanding"
                  value={invoice.outstandingPaise === 0 ? "Paid in full" : rupees(invoice.outstandingPaise)}
                />
              </>
            )}
          </dl>
        </div>

        {invoice.payments.length > 0 && (
          <div className="mt-8 border-t border-line pt-5">
            <p className="m-0 text-[13px] uppercase tracking-[0.02em] text-text-secondary">
              Payments received
            </p>
            <ul className="m-0 mt-3 list-none p-0">
              {invoice.payments.map((payment, index) => (
                <li
                  key={index}
                  className="flex flex-wrap justify-between gap-3 py-1 text-[13px] text-text-secondary"
                >
                  <span>
                    {longDate(payment.receivedAt)} · {payment.method}
                    {payment.reference && <span className="tabular"> · {payment.reference}</span>}
                  </span>
                  <span className="tabular">{rupees(payment.amountPaise)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mb-0 mt-8 text-[12px] leading-relaxed text-text-tertiary">
          Computer-generated tax invoice. Amounts are in Indian rupees.
          {invoice.interState
            ? " Integrated GST applies because the place of supply is outside the supplier's state."
            : ` Central and State GST apply because the place of supply is within state ${invoice.supplyStateCode}.`}
        </p>
      </section>

      {/* §70 — the Invoice's Related section: source order, party, ledger,
          audit. `print:hidden`, like the toolbar above: this belongs to the
          screen, and a printed tax invoice carrying a list of internal links
          is not the document a customer should receive. */}
      <div className="mt-5 print:hidden">
        <Related
          links={[
            ...(invoice.salesOrderId
              ? [{ href: `/sales/${invoice.salesOrderId}`, label: "Sales order", note: "What was sold" }]
              : []),
            ...(invoice.purchaseOrderId
              ? [
                  {
                    href: `/purchases/${invoice.purchaseOrderId}`,
                    label: "Purchase order",
                    note: "What was bought",
                  },
                ]
              : []),
            ...(invoice.customerId
              ? [{ href: `/customers/${invoice.customerId}`, label: "Customer", note: invoice.partyName }]
              : []),
            ...(invoice.supplierId
              ? [{ href: `/suppliers/${invoice.supplierId}`, label: "Supplier", note: invoice.partyName }]
              : []),
            { href: "/ledgers", label: "Ledger", note: "Where this posted" },
            { href: "/tax", label: "Tax", note: "How it reaches the return" },
            { href: "/audit", label: "Audit", note: "Who did what" },
          ]}
        />
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-1.5">
      <dt className="m-0 text-[13px] text-text-secondary">{label}</dt>
      <dd className="tabular m-0 text-[14px] text-text">{value}</dd>
    </div>
  );
}
