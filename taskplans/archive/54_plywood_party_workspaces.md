# Task 54 — Party workspaces (connected-experience slice 8)

Program: `taskplans/53_plywood_connected_experience.md`.
Specification: target user flow §14, §15, §16, §34, §35, §36, §55, §56, and the
§70/§71 rules about Related sections and cross-links.

## 1. What was missing

Slices 1–7 could create a supplier, price their boards, order from them, receive
the goods, record their invoice and pay it. None of that was reachable from the
supplier. `listSuppliers` returned a name, a GSTIN and a count of open orders,
and there was no supplier route at all. A trading partner was a dropdown entry.

The same held for customers, with a sharper edge: the credit decision had no
screen. A salesperson could see a credit limit on the sales desk but not the
exposure it is measured against, nor the orders and invoices that produced it.

## 2. Delivered

**Queries.** `supplierDetail` and `customerDetail`, one round trip each, filling
every tab of the workspace. Six sequential reads to draw one page is six chances
for the tabs to disagree about the same balance — the read-side version of the
inconsistency §84 is written against.

**Routes.**

| Route | Sections |
|---|---|
| `/suppliers` | §14 — name, outstanding, committed, open orders |
| `/suppliers/[supplierId]` | §15, §16, §55 — six tabs |
| `/customers` | §34 — headroom leads, not the limit |
| `/customers/[customerId]` | §35, §36, §56 — six tabs, credit first |

**Shared modules**, because the alternative was a fourth and fifth copy:

- `components/ui/business/format.ts` — `rupees`, `rupeesShort`, `sheets`,
  `day`, `daysSince`. There were ten separate `rupees` definitions in ten page
  components before this.
- `components/ui/business/states.ts` — `PURCHASE_STATE`, `SALES_STATE`. What a
  trader calls each state, and the ADR-009 category behind it, in one place.
- `components/ui/business/Related.tsx` — the §70 section. Deliberately dumb: it
  renders links the caller assembled, because what counts as a neighbour is
  knowledge the record has and the component does not.

**Navigation.** Suppliers at order 21 and Customers at 23, inside TRADE, the
positions §0 gives them.

## 3. Two defects found and fixed on the way

**P0 — a second definition of exposure.** `listCustomers` computed exposure as
the sum of the customer's open orders. `customerExposurePaise` — the canonical
one, which the credit check uses — is
`unallocated_receivables + approved_uninvoiced_commitments`. The list disagreed
with the check in both directions at once: it ignored invoiced-and-unpaid money
entirely, so a customer who owed a lakh on an issued invoice showed zero, and it
counted draft orders, which commit the business to nothing.

This matters because of *where* it was. The customer list is the screen a sales
manager looks at before agreeing to the next order. The number that was wrong
was the number the decision was made on. Fixed by calling
`customerExposurePaise`, which taskplans/45 §4.1 already declared the only
permissible source.

**P2 — four navigation icons did not exist.** The plywood contribution asked for
`catalogue`, `purchases`, `sales` and `stock`; `IconName` contained none of
them, and `isIconName` silently dropped each one. Four of the client's nav items
rendered with no glyph at all. Added those four plus `parties`, `tax` and
`people` for the slices that follow.

## 4. Rules honoured

- Outstanding and committed are separate columns everywhere. A purchase order is
  not a payable (§20, §54) and a sales order is not a receivable (§39); one
  column holding both is the error §54 exists to prevent.
- Open purchases and open sales render *below* the financial ledger and outside
  it (§55, §56).
- Over-limit is stated in words, not by colour alone. This is the row that stops
  a sale, and colour is not information to a reader who cannot see it.
- Reserved quantity is read from `PlywoodStockReservation`, not from an order
  line. A reservation is its own record with a release, which is what lets a
  cancellation return stock to available without rewriting the order (§69).
- Every party, product, order and invoice name on these screens is a link (§71).

## 5. Not in this slice

`/catalogue/[productId]` and `/purchases/[orderId]` and `/sales/[orderId]` are
linked from here and land in slices 9 and 10. The links are written now because
the route shape is fixed by the program plan; until those slices land they
resolve to a 404, which is visible and honest rather than a dead `<span>` that
hides the missing screen.
