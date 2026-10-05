"use client";

/* eslint-disable no-restricted-syntax -- print-only document table (REQ-019), same reasoning as BillView.tsx/InvoiceView.tsx: DataTable's on-screen chrome (filter/sort/pagination) has no place on a printed page a supplier receives. */
import { CommandButton } from "@/components/ui/CommandAccess";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Button,
  DefinitionList,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Panel,
  Row,
  RowList,
  Stat,
  StatRow,
  StateBadge,
} from "@/components/ui/primitives";
import { Combobox } from "@/components/ui/Combobox";
import { day, rupees, sheets } from "@/components/ui/business/format";
import { PURCHASE_STATE, present } from "@/components/ui/business/states";
import { Related } from "@/components/ui/business/Related";
import { ActivityLog } from "@/components/ui/business/ActivityLog";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

type Order = NonNullable<
  Awaited<
    ReturnType<
      typeof import("@/server/capabilities/plywood").purchaseOrderDetail.handler
    >
  >
>;

export function PurchaseOrderView({
  order,
}: {
  order: Order;
}) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [pending, startTransition] = useTransition();

  // Seeded with what is still outstanding, because that is what arrives in the
  // ordinary case. §24 shows the warehouse the remaining figure and lets them
  // correct it downwards — a short delivery is normal, and retyping the full
  // quantity every time is how the wrong number gets entered.
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      order.lines.map((line) => [line.productId, String(line.qtyOutstanding)]),
    ),
  );
  const [challan, setChallan] = useState("");

  const state = present(PURCHASE_STATE, order.state);
  const title = order.reference ?? `Purchase order ${order.id.slice(0, 8)}`;

  function run(key: string, input: unknown, after?: () => void) {
    setFailure(null);
    startTransition(async () => {
      const result = await runCommand(key, input, `/purchases/${order.id}`);
      if (result.ok) {
        after?.();
        router.refresh();
      } else {
        setFailure(result);
      }
    });
  }

  function submitReceipt() {
    const lines = order.lines
      .map((line) => ({
        productId: line.productId,
        qtyReceived: Number.parseInt(quantities[line.productId] ?? "0", 10),
      }))
      // A line receiving nothing is omitted rather than sent as zero: the
      // command requires a positive quantity, and "nothing arrived for this
      // board" is expressed by its absence.
      .filter(
        (line) => Number.isFinite(line.qtyReceived) && line.qtyReceived > 0,
      );
    if (lines.length === 0) {
      setFailure({
        ok: false,
        code: "E_VALIDATION",
        message: "Enter a quantity for at least one board.",
        retryable: false,
      });
      return;
    }
    run(
      "verity.trading.receive_goods",
      {
        orderId: order.id,
        lines,
        ...(challan.trim() ? { supplierChallanNumber: challan.trim() } : {}),
      },
      () => {
        setReceiving(false);
        setChallan("");
      },
    );
  }

  const canReceive = order.state === "submitted" || order.state === "receiving";
  const invoiced = order.invoices.reduce(
    (sum, invoice) => sum + invoice.totalPaise,
    0,
  );

  return (
    <>
      {/* Supplier-facing purchase order — REQ-EXPERIENCE-DESIGNSYSTEM-019.
          Unlike BillView/InvoiceView this page is a working desk (receiving
          form, internal three-way match, activity log), not a document-only
          view, so those stay print:hidden below and this block is the only
          thing that prints: what a supplier actually needs to see. */}
      <section className="hidden rounded-[12px] bg-surface p-8 print:block print:border-0 print:p-0">
        <header className="mb-6 border-b border-line pb-4">
          <h1 className="m-0 text-[20px] font-medium">Purchase Order — {title}</h1>
          <p className="m-0 mt-1 text-[13px] text-text-secondary">
            To: {order.supplierName} · Deliver to: {order.locationName} · Raised {day(order.createdAt)}
          </p>
        </header>
        <table className="w-full border-collapse text-[13px]">
          <caption className="sr-only">Order lines</caption>
          <thead>
            <tr className="border-b border-line text-left">
              <th className="py-2 font-medium">Item</th>
              <th className="py-2 font-medium">HSN</th>
              <th className="py-2 text-right font-medium">Qty</th>
              <th className="py-2 text-right font-medium">Rate</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line) => (
              <tr key={line.productId} className="border-b border-line">
                <td className="py-2">{line.name}</td>
                <td className="py-2">{line.hsnCode}</td>
                <td className="tabular py-2 text-right">{line.qtyOrdered}</td>
                <td className="tabular py-2 text-right">{rupees(line.unitCostPaise)}</td>
                <td className="tabular py-2 text-right">{rupees(line.lineTotalPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 flex justify-end">
          <div className="text-right text-[13px]">
            <p className="m-0 text-text-secondary">
              {order.gstApplicable && order.estimatedTaxPaise !== null
                ? `${rupees(order.totalCostPaise)} + ${rupees(order.estimatedTaxPaise)} GST`
                : "No GST"}
            </p>
            <p className="tabular m-0 mt-1 text-[16px] font-medium text-text">
              {rupees(order.totalCostPaise + (order.estimatedTaxPaise ?? 0))}
            </p>
          </div>
        </div>
      </section>

      <div className="print:hidden">
      <PageHeader
        title={title}
        description={`${order.supplierName} · into ${order.locationName} · raised ${day(order.createdAt)}`}
        actions={
          <>
            <Button onClick={() => window.print()}>Print order</Button>
            {order.state === "draft" && (
              <CommandButton commands={"verity.trading.submit_purchase_order"}
                variant="primary"
                disabled={pending}
                onClick={() =>
                  run("verity.trading.submit_purchase_order", {
                    orderId: order.id,
                  })
                }
              >
                Submit to supplier
              </CommandButton>
            )}
            {canReceive && !receiving && (
              <CommandButton commands={"verity.trading.receive_goods"}
                variant="primary"
                disabled={pending}
                onClick={() => setReceiving(true)}
              >
                Receive goods
              </CommandButton>
            )}
            {/* §68 — cancellation before receipt withdraws the commitment.
                After a receipt the command refuses, because erasing a goods
                receipt would erase stock that physically arrived. */}
            {(order.state === "draft" || order.state === "submitted") && (
              <CommandButton commands={"verity.trading.cancel_purchase_order"}
                variant="danger"
                disabled={pending}
                onClick={() =>
                  run("verity.trading.cancel_purchase_order", {
                    orderId: order.id,
                    reason: "Cancelled from the order",
                  })
                }
              >
                Cancel order
              </CommandButton>
            )}
          </>
        }
      />

      <div className="flex flex-col gap-5">
        {failure && (
          <ErrorState
            title="That was refused"
            message={failure.message}
            issues={failure.issues}
            retryable={failure.retryable}
          />
        )}

        <StatRow cols={4}>
          <Stat
            label="Ordered"
            value={order.qtyOrdered.toLocaleString("en-IN")}
          />
          <Stat
            label="Received"
            value={order.qtyReceived.toLocaleString("en-IN")}
          />
          <Stat
            label="Remaining"
            value={order.qtyOutstanding.toLocaleString("en-IN")}
            hint={order.qtyOutstanding === 0 ? "Fully delivered" : "Still owed"}
          />
          <Stat label="Order value" value={rupees(order.totalCostPaise)} />
        </StatRow>

        <div className="flex flex-wrap items-center gap-3">
          <StateBadge category={state.category} label={state.label} />
          {/* Stated only when it is off. An order that carries GST is every
              order; a badge on all of them would hide the one that matters. */}
          {order.gstApplicable ? (
            // The stored total is the taxable value. What the business is
            // actually committed to is that plus the tax the bill will carry,
            // so both are shown and neither is stored twice.
            order.estimatedTaxPaise !== null && (
              <span className="text-[13px] text-text-secondary">
                <span className="tabular text-text">
                  {rupees(order.totalCostPaise + order.estimatedTaxPaise)}
                </span>{" "}
                with GST{" "}
                <span className="tabular">
                  ({rupees(order.totalCostPaise)} +{" "}
                  {rupees(order.estimatedTaxPaise)})
                </span>
              </span>
            )
          ) : (
            <span className="text-[13px] text-text-secondary">
              No GST — unregistered or composition supplier. The bill records no
              tax and claims no input credit.
            </span>
          )}
        </div>

        {receiving && (
          <Panel title="Receive goods">
            <div className="flex flex-col gap-4">
              {order.lines.map((line) => (
                <Field
                  key={line.productId}
                  label={line.name}
                  htmlFor={`qty-${line.productId}`}
                  hint={`${line.qtyOrdered} ordered · ${line.qtyReceived} received · ${line.qtyOutstanding} remaining`}
                >
                  <Input
                    id={`qty-${line.productId}`}
                    type="number"
                    min={0}
                    max={line.qtyOutstanding}
                    value={quantities[line.productId] ?? ""}
                    onChange={(event) =>
                      setQuantities((current) => ({
                        ...current,
                        [line.productId]: event.target.value,
                      }))
                    }
                  />
                </Field>
              ))}


              <Field
                label="Supplier challan"
                htmlFor="receipt-challan"
                hint="The delivery note number as written on the paper"
              >
                <Input
                  id="receipt-challan"
                  value={challan}
                  onChange={(event) => setChallan(event.target.value)}
                />
              </Field>

              <p className="m-0 text-[12px] text-text-tertiary">
                Receiving moves the stock in the same step. On-hand rises,
                incoming falls, and the weighted average cost is recalculated —
                there is no separate stock entry to make.
              </p>

              <div className="flex gap-2">
                <CommandButton commands={"verity.trading.receive_goods"}
                  variant="primary"
                  disabled={pending}
                  onClick={submitReceipt}
                >
                  {pending ? "Recording…" : "Record receipt"}
                </CommandButton>
                <Button disabled={pending} onClick={() => setReceiving(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </Panel>
        )}

        <Panel flush title="Lines">
          <RowList>
            {order.lines.map((line) => (
              <Row key={line.productId}>
                <div className="min-w-0">
                  <Link
                    href={`/catalogue/${line.productId}`}
                    className="text-[14px] text-text no-underline hover:underline"
                  >
                    {line.name}
                  </Link>
                  <p className="m-0 mt-0.5 text-[12px] text-text-tertiary">
                    HSN {line.hsnCode} · {rupees(line.unitCostPaise)} / sheet
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-8 text-right">
                  <div className="w-20">
                    <p className="tabular m-0 text-[14px] text-text">
                      {line.qtyReceived} / {line.qtyOrdered}
                    </p>
                    <p className="m-0 text-[12px] text-text-tertiary">
                      Received
                    </p>
                  </div>
                  <div className="w-24">
                    <p className="tabular m-0 text-[14px] text-text">
                      {rupees(line.lineTotalPaise)}
                    </p>
                    <p className="m-0 text-[12px] text-text-tertiary">
                      Line total
                    </p>
                  </div>
                </div>
              </Row>
            ))}
          </RowList>
        </Panel>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel flush title="Receipts">
            {order.receipts.length === 0 ? (
              <div className="px-5 py-6">
                {/* U1-1: this panel used to say "Nothing received yet" beside a
                    "Received 250" figure on the same screen — a flat
                    contradiction, and the reader has no way to tell which half
                    to believe. Stock recorded against an order before goods
                    receipts were documented is a real state for imported data;
                    it is said plainly rather than reported as nothing. */}
                <EmptyState
                  compact
                  title={
                    order.qtyReceived > 0
                      ? "No goods receipt documents"
                      : "Nothing received yet"
                  }
                  description={
                    order.qtyReceived > 0
                      ? `${order.qtyReceived} sheets are recorded as received against this order, from before goods receipts were documented. Anything received from now on appears here.`
                      : undefined
                  }
                />
              </div>
            ) : (
              <RowList>
                {order.receipts.map((receipt) => (
                  <Row key={receipt.id}>
                    <div className="min-w-0">
                      <span className="text-[14px] text-text">
                        {receipt.receiptNumber}
                      </span>
                      <p className="m-0 mt-0.5 text-[12px] text-text-tertiary">
                        {day(receipt.receivedAt)}
                      </p>
                    </div>
                    <span className="tabular shrink-0 text-[14px] text-text">
                      {sheets(receipt.qtyUnits)}
                    </span>
                  </Row>
                ))}
              </RowList>
            )}
          </Panel>

          <Panel flush title="Finance">
            {order.invoices.length === 0 ? (
              <div className="px-5 py-6">
                {/* §20 — a purchase order is not a payable. Saying so on the
                    screen is the point: an accountant who expects a liability
                    here should learn why there isn't one. */}
                <EmptyState
                  compact
                  title="No supplier invoice"
                  description="Nothing is payable until the supplier bills for this order. Record their invoice from Finance."
                />
              </div>
            ) : (
              <RowList>
                {order.invoices.map((invoice) => (
                  <Row key={invoice.id}>
                    <div className="min-w-0">
                      <Link
                        href={`/finance/${invoice.id}`}
                        className="text-[14px] text-text no-underline hover:underline"
                      >
                        {invoice.invoiceNumber}
                      </Link>
                      <p className="m-0 mt-0.5 text-[12px] text-text-tertiary">
                        {day(invoice.issuedAt)} · {rupees(invoice.paidPaise)}{" "}
                        paid
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="tabular m-0 text-[14px] text-text">
                        {rupees(invoice.totalPaise)}
                      </p>
                      <p className="m-0 text-[12px] text-text-tertiary">
                        {rupees(invoice.balancePaise)} outstanding
                      </p>
                    </div>
                  </Row>
                ))}
              </RowList>
            )}
          </Panel>
        </div>

        {/* §29 — the three-way match reads best as a comparison, and the
            comparison is only meaningful once all three documents exist. */}
        {order.invoices.length > 0 && (
          <Panel title="Three-way match">
            <DefinitionList
              items={[
                {
                  term: "Ordered",
                  value: `${sheets(order.qtyOrdered)} · ${rupees(order.totalCostPaise)}`,
                },
                { term: "Received", value: sheets(order.qtyReceived) },
                { term: "Invoiced", value: rupees(invoiced) },
                {
                  term: "Quantity difference",
                  value:
                    order.qtyOutstanding === 0
                      ? "Matched"
                      : `${order.qtyOutstanding} short`,
                },
                {
                  // U1-2: an order 50 sheets short is invoiced 50 sheets less,
                  // and reporting that as a bare "Value difference ₹20,000"
                  // sends an accountant to chase a supplier who did nothing
                  // wrong. What matters is the RESIDUAL — the part the short
                  // delivery does not explain.
                  term: "Value difference",
                  value: (() => {
                    const expected = order.lines.reduce(
                      (sum, line) =>
                        sum + line.qtyReceived * line.unitCostPaise,
                      0,
                    );
                    const residual = invoiced - expected;
                    if (invoiced === order.totalCostPaise) return "Matched";
                    if (residual === 0) {
                      return `Matched, allowing for ${order.qtyOutstanding} sheets not delivered`;
                    }
                    return `${rupees(Math.abs(residual))} ${residual > 0 ? "over" : "under"} what was received`;
                  })(),
                },
              ]}
            />
          </Panel>
        )}

        <ActivityLog entries={order.activity} />

        <Related
          links={[
            {
              href: `/suppliers/${order.supplierId}`,
              label: "Supplier",
              note: order.supplierName,
            },
            {
              href: `/godowns/${order.locationId}`,
              label: "Godown",
              note: order.locationName,
            },
            { href: "/purchases", label: "All purchases" },
            {
              href: "/finance",
              label: "Finance",
              note: `${order.invoices.length} invoice(s)`,
            },
          ]}
        />
      </div>
      </div>
    </>
  );
}
