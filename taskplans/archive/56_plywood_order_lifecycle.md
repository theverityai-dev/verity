# Task 56 — Order lifecycle screens (connected-experience slice 10)

Program: `taskplans/53_plywood_connected_experience.md`.
Specification: §18–26 (purchase), §37–48 (sales), §68–69 (cancellation),
§70–71 (Related sections and cross-links), §78 (activity), §79–80 (the two
end-to-end flows).

## 1. What was missing

Every action in the purchasing and selling flows existed as a command and was
reachable only from a row in a table. §21 says the purchase order page "should
be the central record" and §48 asks the sales order to "show the full connected
lifecycle"; neither page existed. A buyer approving a receipt, or a manager
approving credit, did so from a list that could not show them what they were
deciding about.

## 2. Delivered

`/purchases/[orderId]` — §21. Ordered, received and remaining as figures rather
than arithmetic; the lines; the receipts taken; the supplier invoice if there is
one; the three-way match; the activity; Related. Submitting, receiving and
cancelling are done here.

`/sales/[orderId]` — §48. Ordered, reserved and issued; the credit position; the
lines; goods issued; the invoice; activity; Related. Credit review, reservation,
goods issue and cancellation are done here.

Both order-detail queries were extended rather than duplicated. They already
existed and were simply under-fed: no party id (so a name could not be a link),
no receipts or issues, no invoices, no history.

`components/ui/business/ActivityLog.tsx` — §78 in business words. `state` reads
as "Status" and `verity.plywood.receive_goods` as "Goods received". An unmapped
field falls through to its raw name rather than being hidden: a change that
happened and cannot be described is still a change that happened, and dropping
it would make the log quietly incomplete.

The purchase and sales desks now link each row to its order.

## 3. The rules these screens had to state, not just obey

**§20 — a purchase order is not a payable.** The Finance panel on an
un-invoiced order says so in words: "Nothing is payable until the supplier bills
for this order." An accountant who arrives expecting a liability should learn
why there isn't one, rather than seeing an empty box.

**§39 — a sales order is not a receivable.** Same treatment.

**§41 — a credit block names the amount and the customer.** "Gupta Timber is
₹30,000 above their credit headroom. Exposure ₹5,30,000 against a limit of
₹5,00,000." Not "credit issue". The approver can act on the first and not on
the second.

**§42 — an override records its reason.** The approve button is disabled until
a reason is typed. An override with no reason is an audit row nobody can explain
a year later.

**§45 — goods issue, and nothing else.** No shipment, no delivery, no
logistics. The panel states the consequence plainly: on-hand falls, reserved
falls, available is unchanged, because the sheets were already spoken for.

**§68/§69 — cancellation is honest about what it can undo.** The cancel button
disappears once an order is completed, and the copy never promises to reverse
stock that has physically left.

## 4. Exposure, again, from one place

`salesOrderDetail` returns the credit position by calling
`customerExposurePaise`. An approval screen showing a different figure from the
check that blocked the order would be the worst possible place for a second
definition of exposure, and taskplans/45 §4.1 forbids one anywhere.

## 5. Receipt quantities are seeded, not blank

§24 shows the warehouse the remaining quantity and lets them correct it
downwards. The form is pre-filled with what is outstanding, because a short
delivery is the normal case and retyping the full figure every time is how the
wrong number gets entered. A line receiving nothing is omitted from the command
rather than sent as a zero — the command requires a positive quantity, and
"nothing arrived for this board" is expressed by its absence.

## 6. Not in this slice

Raising the invoice itself still happens from Finance. §49's "Raise Invoice"
button on the order is a link, not a form, until slice 11 gives the tax centre
its own screens — the invoice needs the tax check of §50, and building half of
it here would put the same rules in two places.
