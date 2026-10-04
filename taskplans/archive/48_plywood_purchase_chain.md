# Task Plan 48 — Purchase Chain: Goods Receipt and Three-Way Match (Slice 3)

**Program:** `45_plywood_workflow_program.md`. **Slice 3 of 7.**
**Closes:** audit **P0-04** (the receipt half). Delivers specification §24–§29.

---

## 1. The receipt becomes a document

Receiving used to increment `qtyReceived` on a purchase order line and write a
stock movement that pointed at nothing. Nobody could open a receipt, prove who
took delivery, print it, match it against a supplier invoice, or reverse part
of it. *"Enter once and propagate"* cannot be audited when the propagation
leaves no document behind.

`PlywoodGoodsReceipt` and `PlywoodGoodsReceiptLine` now record what arrived: a
gapless `GRN/26-27/0001` number, the supplier's own challan number, who took
delivery, when, into which godown and rack, at what cost.

**Numbered through the invoice allocator, not a second one.** A receipt is the
document a supplier dispute turns on, so it is numbered gaplessly for the same
reason an invoice is — and two implementations of "allocate the next number" is
how one of them ends up with gaps.

**Immutable once posted**, by the same trigger invoices use. A receipt that can
be edited settles no dispute. A short receipt is corrected by receiving the
balance later — proven by a test that receives 96, then 4, and gets **two
documents**, not one that changed.

---

## 2. Every movement says what caused it

`stock_ledger_entry` gains `source_type`, `source_id` and `source_number`.

This is specification §13 — the movement ledger that explains why a number is
what it is. A reader can open a quantity and find the business event behind it,
and the denormalised number means the history still reads after the document is
archived.

Two deliberate choices:

*   **Nullable, and not backfilled.** Movements recorded before this migration
    genuinely have no source document. Inventing a plausible one would be
    putting fabricated evidence into a ledger whose entire value is that it was
    not invented.
*   **A CHECK that type and id are both present or both absent.** A type with no
    id is a half-recorded fact: the reader cannot follow it and cannot tell it is
    broken.

`source` is optional on `applyMovement` because a physical stock count honestly
has no source document — it *is* the source — and forcing a synthetic one would
put a fiction in the ledger to satisfy a type.

---

## 3. Three-way match (§29)

`purchaseMatch` answers the accountant's actual question: not "what did we
order?" but "does what they billed agree with what we ordered and what
arrived?". Ordered, received and invoiced totals, per-line outstanding
quantities, every receipt against the order, and the exceptions named in the
words a person would use.

**It reports; it does not refuse.** A quantity or price difference is a
conversation with the supplier. Blocking the invoice would leave the business
unable to record a document it has physically received, which is how invoices
end up in a drawer instead of in the system.

**What it does refuse:** invoicing an order that has received *nothing*. A
supplier invoice arriving before the lorry is a real situation and a real
problem — recording it as a payable against nothing received is how a business
pays for a delivery it never got. There is no conversation to have about that.

---

## 4. Files

```text
prisma/migrations/20260831140000_plywood_goods_receipt/   receipts, ledger source, immutability, RLS
src/server/capabilities/plywood/trading.ts                receiveGoods writes a document; godown scope
src/server/capabilities/plywood/stock.ts                  applyMovement carries a source
src/server/capabilities/plywood/finance.ts                purchaseMatch, goodsReceiptDetail, shared allocator
src/test/plywood-purchase-chain.test.ts                    NEW, 9 tests
```

---

## 5. Evidence

```text
Tests  745 passed | 4 skipped (749)
```

Suite 740 → 749. `tsc --noEmit` clean. Includes the specification's own
worked examples: 100 ordered and 96 received (§24–26), and 100 at ₹1,000 plus
100 at ₹1,200 averaging to ₹1,100 (§27).

---

## 6. Found while building it

`INVOICEABLE_PURCHASE_ORDER_STATES` was written against the rule freeze's
vocabulary (`Part Received`) rather than the implementation's stored value
(`receiving`). The guard silently failed closed — it refused a legitimate
invoice — and a test caught it immediately.

Left as `receiving` with the reason recorded: renaming a stored state is a
migration against live orders and belongs to the slice that unifies the
vocabulary, not to a guard that would stop matching if it guessed the new name
early.

---

## 7. Still open in this slice's area

*   **Effective-dated supplier prices.** Prices are still a destructive upsert,
    so a price change rewrites history rather than superseding it. The order
    line already snapshots its own price, so nothing posted is at risk; the
    trend and the "price as at a date" reads are what is missing.
*   **Supplier detail route**, purchase order detail route, and the Purchases
    tabs (§18). The server-side facts they need now exist — `purchaseMatch` and
    `goodsReceiptDetail` are the two hard ones.
*   **Purchase invoice lines and tax breakdown.** A purchase invoice still
    stores a single total with no tax split, so expected ITC cannot be
    computed. That is slice 6's foundation and is called out in the audit as
    P0-07.
*   **Receipt reversal.** The document is immutable and there is no reversing
    document yet; slice 5 adds it with returns and notes.
