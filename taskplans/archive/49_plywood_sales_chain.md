# Task Plan 49 — Sales Chain: Goods Issue and Invoice Eligibility (Slice 4)

**Program:** `45_plywood_workflow_program.md`. **Slice 4 of 7.**
**Closes:** audit **P0-04** (the issue half) and the remainder of **P0-03**.
Delivers specification §43–§49.

---

## 1. The issue becomes a document

`PlywoodGoodsIssue` and `PlywoodGoodsIssueLine` — gapless `GI/26-27/0001`
number, who issued it, who collected the material, from which godown and rack,
and the weighted average cost standing when it left.

Dispatch used to be a state change that moved every remaining line at once,
released every hold and completed the order. Three things followed:

*   a **partial issue was impossible**;
*   nothing recorded **who handed the material over**;
*   an invoice could be raised for the quantity **ordered** rather than the
    quantity that actually left the yard.

Now the only door out of a godown, Logistics having gone in slice 2. Immutable
once posted: the material has physically left, and editing the record of that
afterwards is a rewrite, not a correction. Goods that come back are a customer
return, which is its own document (slice 5).

**The command key stays `verity.plywood.dispatch_order`.** Renaming it is a
migration of every caller for no behavioural gain; the vocabulary in the
result, the events and the documents is the specification's.

---

## 2. Partial issue releases only what left

The subtle half. On a partial issue the old code released the **whole**
reservation, which frees stock the customer is still owed — and the next order
takes it. Now the hold shrinks by exactly what went out and is released only
when it reaches zero.

Tested end to end: 40 ordered, 25 issued leaves 75 on hand and **15 still
reserved**; the balance of 15 completes the order and clears the hold.

---

## 3. The invoice bills for what left the yard

`raiseSalesInvoice` now takes its quantities and totals from `qtyShipped`, and
refuses an order where nothing has been issued.

This is the second half of P0-03. Invoicing the ordered quantity bills a
customer for boards still standing in the godown — and on a partial issue it
bills them for goods they have not been given, which is the version of the
defect that reaches a customer and gets argued about.

**Guard order matters.** The state check (credit approved?) runs before the
issued-quantity check, because an order awaiting credit has also issued
nothing, and *"approve the credit"* is the useful thing to tell someone. The
more specific refusal goes first.

---

## 4. Files

```text
prisma/migrations/20260831150000_plywood_goods_issue/   issues, immutability, RLS
src/server/capabilities/plywood/trading.ts              dispatchOrder rewritten as a document
src/server/capabilities/plywood/finance.ts              invoice from issued quantity
src/test/plywood-sales-chain.test.ts                     NEW, 7 tests
src/test/capability-plywood-finance.test.ts              fixture issues before invoicing
src/test/plywood-integrity.test.ts                       slice-1 case extended to the new rule
```

---

## 5. Two tests that had to change, and why that is the finding

`capability-plywood-finance.test.ts` invoiced orders that had been approved and
never issued. `plywood-integrity.test.ts` asserted that approving credit was
enough to make an order invoiceable.

Both encoded the **old** rule. Neither was wrong when written; both became wrong
when the invoice was bound to the goods. They were updated rather than relaxed —
the integrity case now asserts the refusal *and then* issues and invoices, so
the sequence a business actually follows is what is covered.

---

## 6. Evidence

```text
Tests  752 passed | 4 skipped (756)
```

Suite 749 → 756. `tsc --noEmit` clean. Includes the specification's own §43
worked example: 150 on hand, reserve 40, on hand still 150 and available 110.

---

## 7. Still open in this slice's area

*   **Partial invoicing.** One invoice per order remains enforced by the index
    from slice 1. A second issue against an already-invoiced order cannot yet be
    billed; that needs the quantity-allocation model the index's own comment
    names, and it lands with credit notes in slice 5.
*   **Credit re-check at issue.** Exposure is correct (slice 1) and checked at
    order creation. The rule freeze wants it re-checked at reserve and issue
    too; the formula is in place, the call sites are not.
*   **Maker/checker on credit override.** The role matrix (§6) forbids
    approving your own order. Not yet enforced.
*   **Customer and sales-order detail routes**, the Sales tabs (§37), and the
    Related sections (§70).
