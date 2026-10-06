"use client";

/* eslint-disable no-restricted-syntax -- Task 121 grandfathered debt (bare <table>), migrate to DataTable/SmartTable opportunistically */
import { CommandButton } from "@/components/ui/CommandAccess";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorState, Field, Input, Panel, Select } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import type { BillDetail } from "@/server/capabilities/dinein";

/**
 * Display names for `BILL_PAYMENT_METHODS` in the dinein capability. Kept here
 * rather than imported because this is a client component and the capability
 * module is server code; the server rejects any key not in its list.
 */
const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  upi: "UPI",
  wallet: "Wallet",
  bank_transfer: "Bank transfer",
  delivery_platform: "Paid to delivery platform",
  other: "Other",
};

function rupees(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * The bill, and the till beside it.
 *
 * The printable half is deliberately solid — no glass, no translucency. ADR-011
 * is explicit that dense financial text stays solid, and a bill is the densest
 * financial text a restaurant produces. It also has to survive a monochrome
 * printer, which a frosted panel does not.
 *
 * Every tax line prints its rate. PRN-001 asks that automation be explainable,
 * and a guest querying a total should be able to read where it came from
 * without asking anyone.
 */
/**
 * What one line of the bill costs the guest, with tax, discount and rounding
 * spread across lines in proportion to their pre-tax value. Used to split a
 * payment by items and to refund chosen items, so both agree to the paisa.
 */
function lineShares(bill: BillDetail): number[] {
  if (bill.subtotalMinor <= 0) return bill.lines.map(() => 0);
  return bill.lines.map((line) => Math.round((line.lineTotalMinor * bill.totalMinor) / bill.subtotalMinor));
}

function ItemPicker({
  bill,
  shares,
  picked,
  onChange,
  legend,
}: {
  bill: BillDetail;
  shares: number[];
  picked: Set<number>;
  onChange: (next: Set<number>) => void;
  legend: string;
}) {
  return (
    <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
      <legend className="mb-1 p-0 text-[13px] text-text-secondary">{legend}</legend>
      {bill.lines.map((line, index) => (
        <label key={`${line.itemName}-${index}`} className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-[14px]">
          <span className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={picked.has(index)}
              onChange={() => {
                const next = new Set(picked);
                if (next.has(index)) next.delete(index);
                else next.add(index);
                onChange(next);
              }}
              className="size-[18px] accent-[var(--color-accent)]"
            />
            {line.qty} × {line.itemName}
            {line.variantName ? ` (${line.variantName})` : ""}
          </span>
          <span className="tabular text-text-secondary">{rupees(shares[index] ?? 0)}</span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Keyed on the outstanding and refundable amounts by the page, so after each
 * payment or refund the amounts below start again from the new figures.
 */
export function BillView({ bill }: { bill: BillDetail }) {
  const shares = lineShares(bill);
  const [payAmount, setPayAmount] = useState((bill.outstandingMinor / 100).toFixed(2));
  const [payItems, setPayItems] = useState<Set<number>>(new Set());
  const [refundAmount, setRefundAmount] = useState((bill.refundableMinor / 100).toFixed(2));
  const [refundItems, setRefundItems] = useState<Set<number>>(new Set());
  const [refundReason, setRefundReason] = useState("");
  const sumOf = (picked: Set<number>) => [...picked].reduce((sum, i) => sum + (shares[i] ?? 0), 0);
  const itemNames = (picked: Set<number>) => [...picked].map((i) => bill.lines[i]?.itemName).filter(Boolean).join(", ");
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  function run(key: string, input: unknown) {
    setFailure(null);
    startTransition(async () => {
      const result = await runCommand(key, input, `/counter/${bill.id}`);
      if (result.ok) router.refresh();
      else setFailure(result);
    });
  }

  const settled = bill.state === "settled";

  return (
    <>
      {failure && (
        <div className="mb-4 print:hidden">
          <ErrorState
            title="That did not happen"
            message={failure.message}
            issues={failure.issues}
            retryable={failure.retryable}
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        {/* ------------------------------ the bill ------------------------------ */}
        <section className="rounded-[12px] bg-surface p-6 print:border-0 print:p-0">
          <header className="mb-4 border-b border-line pb-4">
            <h2 className="m-0 text-[18px]">{bill.label}</h2>
            <p className="mb-0 mt-1 text-[12px] text-text-tertiary">
              Bill {bill.id.slice(0, 8).toUpperCase()}
            </p>
          </header>

          <table className="w-full border-collapse">
            <caption className="sr-only">Items on this bill</caption>
            <thead>
              <tr>
                <th className="border-b border-line pb-2 text-left text-[12px] font-normal text-text-tertiary">
                  Item
                </th>
                <th className="border-b border-line pb-2 text-right text-[12px] font-normal text-text-tertiary">
                  Qty
                </th>
                <th className="border-b border-line pb-2 text-right text-[12px] font-normal text-text-tertiary">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {bill.lines.map((line, index) => (
                <tr key={`${line.itemName}-${index}`}>
                  <td className="border-b border-line py-2 text-[14px] text-text">
                    {line.itemName}
                    {line.variantName && (
                      <span className="text-text-tertiary"> ({line.variantName})</span>
                    )}
                  </td>
                  <td className="tabular border-b border-line py-2 text-right text-[14px]">
                    {line.qty}
                  </td>
                  <td className="tabular border-b border-line py-2 text-right text-[14px]">
                    {rupees(line.lineTotalMinor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="m-0 mt-4 flex flex-col gap-1.5 text-[14px]">
            <div className="flex justify-between">
              <dt className="text-text-secondary">Subtotal</dt>
              <dd className="tabular m-0">{rupees(bill.subtotalMinor)}</dd>
            </div>
            {bill.discountMinor > 0 && (
              <div className="flex justify-between">
                <dt className="text-text-secondary">Discount</dt>
                <dd className="tabular m-0">− {rupees(bill.discountMinor)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-text-secondary">CGST @ {bill.cgstRate}%</dt>
              <dd className="tabular m-0">{rupees(bill.cgstMinor)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-secondary">SGST @ {bill.sgstRate}%</dt>
              <dd className="tabular m-0">{rupees(bill.sgstMinor)}</dd>
            </div>
            {bill.roundingMinor !== 0 && (
              <div className="flex justify-between">
                <dt className="text-text-secondary">Rounding</dt>
                <dd className="tabular m-0">
                  {bill.roundingMinor > 0 ? "+ " : "− "}
                  {rupees(Math.abs(bill.roundingMinor))}
                </dd>
              </div>
            )}
            <div className="mt-2 flex justify-between border-t border-line pt-2 text-[16px]">
              <dt className="font-medium text-text">Total</dt>
              <dd className="tabular m-0 font-medium">{rupees(bill.totalMinor)}</dd>
            </div>
          </dl>

          {bill.payments.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <h3 className="mb-2">Paid</h3>
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
                {bill.payments.map((payment, index) => (
                  <li key={index} className="flex justify-between">
                    <span className="text-text-secondary">
                      {PAYMENT_METHOD_LABEL[payment.method] ?? payment.method}
                      {payment.reference && (
                        <span className="ml-2 text-text-tertiary">{payment.reference}</span>
                      )}
                    </span>
                    <span className="tabular">{rupees(payment.amountMinor)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {bill.refunds.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <h3 className="mb-2">Refunded</h3>
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
                {bill.refunds.map((refund, index) => (
                  <li key={index} className="flex justify-between">
                    <span className="text-text-secondary">
                      {PAYMENT_METHOD_LABEL[refund.method] ?? refund.method}
                      <span className="ml-2 text-text-tertiary">{refund.reason}</span>
                    </span>
                    <span className="tabular">− {rupees(refund.amountMinor)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* ------------------------------- the till ----------------------------- */}
        <div className="flex flex-col gap-4 print:hidden">
          <Panel title={settled ? "Settled" : `Outstanding ${rupees(bill.outstandingMinor)}`}>
            {settled ? (
              <div className="flex flex-col gap-4">
                <p className="m-0 text-[13px] text-text-secondary">
                  Paid in full. The table has been sent for cleaning.
                </p>
                {bill.refundableMinor > 0 && (
                  <form
                    className="flex flex-col gap-3 border-t border-line pt-3"
                    action={(formData) =>
                      run("verity.dinein.refund_bill", {
                        billId: bill.id,
                        method: String(formData.get("refundMethod") ?? "cash"),
                        amountMinor: Math.round(Number(formData.get("refundAmount") ?? 0) * 100),
                        reason: String(formData.get("refundReason") ?? ""),
                      })
                    }
                  >
                    <h3 className="m-0">Refund</h3>
                    <p className="m-0 text-[13px] text-text-secondary">
                      Up to {rupees(bill.refundableMinor)} can still be returned. The bill stays as it was; the refund is recorded beside it.
                    </p>
                    <ItemPicker
                      bill={bill}
                      shares={shares}
                      picked={refundItems}
                      legend="Refund particular items (optional)"
                      onChange={(next) => {
                        setRefundItems(next);
                        if (next.size > 0) {
                          setRefundAmount((Math.min(sumOf(next), bill.refundableMinor) / 100).toFixed(2));
                          if (!refundReason) setRefundReason(`Refund: ${itemNames(next)}`);
                        } else {
                          setRefundAmount((bill.refundableMinor / 100).toFixed(2));
                        }
                      }}
                    />
                    <Field label="Amount (₹)" htmlFor="refundAmount" required>
                      <Input
                        id="refundAmount"
                        name="refundAmount"
                        type="number"
                        step="0.01"
                        min="0.01"
                        max={(bill.refundableMinor / 100).toFixed(2)}
                        value={refundAmount}
                        onChange={(e) => setRefundAmount(e.target.value)}
                        required
                      />
                    </Field>
                    <Field label="Returned by" htmlFor="refundMethod">
                      <Select id="refundMethod" name="refundMethod" defaultValue="cash">
                        {Object.entries(PAYMENT_METHOD_LABEL)
                          .filter(([value]) => value !== "delivery_platform")
                          .map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                      </Select>
                    </Field>
                    <Field label="Reason" htmlFor="refundReason" required hint="Recorded with your name. Say what went wrong.">
                      <Input id="refundReason" name="refundReason" required minLength={3} maxLength={300} placeholder="Cold food, guest complaint" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} />
                    </Field>
                    <CommandButton commands={"verity.dinein.refund_bill"} type="submit" variant="secondary" disabled={pending}>
                      {pending ? "Refunding…" : "Refund"}
                    </CommandButton>
                  </form>
                )}
              </div>
            ) : (
              <form
                className="flex flex-col gap-3"
                action={(formData) =>
                  run("verity.dinein.record_payment", {
                    billId: bill.id,
                    method: String(formData.get("method") ?? "cash"),
                    amountMinor: Math.round(Number(formData.get("amount") ?? 0) * 100),
                    reference: String(formData.get("reference") ?? "") || undefined,
                  })
                }
              >
                <Field label="Method" htmlFor="method">
                  <Select id="method" name="method" defaultValue="cash">
                    {Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </Select>
                </Field>

                <div className="flex flex-col gap-2">
                  <span className="text-[13px] text-text-secondary">Splitting? Each guest pays their part as a separate payment.</span>
                  <div className="flex flex-wrap gap-2">
                    {[2, 3, 4, 5].map((n) => (
                      <Button
                        key={n}
                        type="button"
                        size="sm"
                        onClick={() => {
                          setPayItems(new Set());
                          setPayAmount((Math.ceil(bill.outstandingMinor / n) / 100).toFixed(2));
                        }}
                      >
                        Split {n} ways
                      </Button>
                    ))}
                  </div>
                  <ItemPicker
                    bill={bill}
                    shares={shares}
                    picked={payItems}
                    legend="Or pay for particular items"
                    onChange={(next) => {
                      setPayItems(next);
                      setPayAmount((Math.min(next.size > 0 ? sumOf(next) : bill.outstandingMinor, bill.outstandingMinor) / 100).toFixed(2));
                    }}
                  />
                </div>

                <Field label="Amount (₹)" htmlFor="amount" required>
                  <Input
                    id="amount"
                    name="amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={(bill.outstandingMinor / 100).toFixed(2)}
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    required
                  />
                </Field>

                <Field
                  label="Reference"
                  htmlFor="reference"
                  hint="UPI transaction id or card reference, if there is one."
                >
                  <Input id="reference" name="reference" />
                </Field>

                <CommandButton commands={"verity.dinein.record_payment"} type="submit" variant="primary" disabled={pending}>
                  {pending ? "Recording…" : "Record payment"}
                </CommandButton>
              </form>
            )}
          </Panel>

          {!settled && (
            <>
              <Panel title="Coupon">
                <form
                  className="flex items-end gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const code = String(new FormData(e.currentTarget).get("code") ?? "");
                    setFailure(null);
                    startTransition(async () => {
                      const applied = await runCommand<{ discountMinor: number }>(
                        "verity.coupon.apply_coupon",
                        { billId: bill.id, code },
                      );
                      if (!applied.ok) { setFailure(applied); return; }
                      const discounted = await runCommand(
                        "verity.dinein.apply_bill_discount",
                        { billId: bill.id, discountMinor: applied.data.discountMinor, reason: `Coupon ${code}` },
                        `/counter/${bill.id}`,
                      );
                      if (discounted.ok) router.refresh(); else setFailure(discounted);
                    });
                  }}
                >
                  <Field label="Code" htmlFor="couponCode" required>
                    <Input id="couponCode" name="code" required placeholder="e.g. WELCOME10" />
                  </Field>
                  <Button type="submit" disabled={pending}>{pending ? "Applying…" : "Apply coupon"}</Button>
                </form>
              </Panel>

              <Panel title="Discount">
                <form
                  className="flex flex-col gap-3"
                  action={(formData) =>
                    run("verity.dinein.apply_bill_discount", {
                      billId: bill.id,
                      discountMinor: Math.round(Number(formData.get("discount") ?? 0) * 100),
                      reason: String(formData.get("reason") ?? ""),
                    })
                  }
                >
                  <Field label="Amount (₹)" htmlFor="discount" required>
                    <Input id="discount" name="discount" type="number" step="0.01" min="0" required />
                  </Field>
                  <Field
                    label="Reason"
                    htmlFor="reason"
                    hint="Recorded against your name. Every discount is asked about eventually."
                    required
                  >
                    <Input id="reason" name="reason" required />
                  </Field>
                  <CommandButton commands={"verity.dinein.apply_bill_discount"} type="submit" disabled={pending}>
                    Apply discount
                  </CommandButton>
                </form>
              </Panel>

              <CommandButton commands={"verity.dinein.settle_bill"}
                variant="primary"
                disabled={pending || bill.outstandingMinor > 0}
                onClick={() => run("verity.dinein.settle_bill", { billId: bill.id })}
              >
                {bill.outstandingMinor > 0
                  ? `${rupees(bill.outstandingMinor)} still to pay`
                  : "Settle and free the table"}
              </CommandButton>
            </>
          )}

          <Button onClick={() => window.print()}>Print bill</Button>
        </div>
      </div>
    </>
  );
}
