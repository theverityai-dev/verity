# Task Plan 50 — Returns and Corrections (Slice 5)

**Program:** `45_plywood_workflow_program.md`. **Slice 5 of 7.**
**Completes:** **P0-05** — immutability is only a workable rule once there is a
way to correct a document. Delivers specification §66 and §67.

---

## 1. Two rules that look like one

Material coming back is a **stock event**. Money coming back is a **document**.

Conflating them is how a business ends up crediting a customer for boards that
never returned, or taking boards back and never crediting anybody. The
specification separates them (§66 ends "Finance should not automatically
refund"), and so does the implementation: a return writes a stock movement and
moves no money; a credit note moves money and moves no stock.

A test asserts exactly that — a five-sheet return leaves the customer's
exposure unchanged.

---

## 2. Returns are tied to the issue they came back from

`recordReturnedStock` takes an optional `goodsIssueId`. Given, it:

*   **caps** the return at what that issue actually sent, minus what has already
    come back — without the cap, a "return" is a way to create stock out of
    nothing;
*   **values** the boards at the cost that left on that issue, not at today's
    weighted average — the board that comes back is the board that went out,
    and a later purchase at a different price must not restate it;
*   **links** the movement to the issue, so a reader follows the board out of
    the gate and back in again.

Returns are exactly where an inventory fraud hides, because nobody questions
stock arriving. That is why this is the one inward movement with a ceiling.

Optional rather than required: an over-the-counter return with no paperwork is
a real event, and forcing a synthetic issue id to record one would put a
fiction in the ledger.

---

## 3. Credit and debit notes

`PlywoodInvoiceNote` — gapless `CN/26-27/0001` or `DN/…`, a tax split, a
required reason, its own party-ledger entry, immutable once posted.

**The invoice is not touched.** It is what the customer holds and what was
reported; the note is what changed. Both stand in the record afterwards. That is
the point of slice 1's immutability trigger, and this is the correction path its
refusal message names.

### Decisions worth defending

**Tax is copied from the invoice, never recomputed.** A rate change between the
sale and the correction would otherwise produce a note that does not reconcile
to the document it corrects, and the difference would land in a return with
nothing to explain it.

**A credit note cannot exceed what remains creditable.** Crediting more than was
ever charged is a refund — money out — not a correction to a sale. Earlier notes
count against the ceiling.

**Amounts are positive; the direction is the type.** A negative credit note is a
debit note wearing the wrong name, and the two are reported to different places.
Enforced by CHECK constraints, along with total-is-its-parts and the
CGST+SGST-or-IGST pairing.

**The reason is required by the command *and* the database.** A note nobody can
explain is the one a tax officer asks about.

---

## 4. Exposure closes its last gap

Slice 1 wrote the exposure formula with the credit-note term at zero, because
notes did not exist. It is now filled in: a credit note reduces what the
customer owes, a debit note raises it. An exposure that ignored notes would hold
credit against money the business has already agreed it will not collect.

---

## 5. Files

```text
prisma/migrations/20260831160000_plywood_invoice_notes/   notes, constraints, immutability, RLS
src/server/capabilities/plywood/finance.ts                raiseInvoiceNote
src/server/capabilities/plywood/stock.ts                  returns tied to their issue
src/server/capabilities/plywood/trading.ts                exposure counts notes
src/app/(shell)/finance/FinanceDesk.tsx                   note form beside the payment
src/test/plywood-returns-notes.test.ts                    NEW, 10 tests
```

The note form sits beside "Record payment" rather than on a detail page,
because the moment somebody notices an invoice is wrong is the moment they are
looking at that list.

---

## 6. Evidence

```text
Tests  762 passed | 4 skipped (766)
```

Suite 756 → 766. `tsc --noEmit` clean.

---

## 7. Still open

*   **Purchase-side notes.** The model is party-agnostic and the command works
    against a supplier invoice, but the supplier-facing screen and the
    debit-note-on-short-receipt flow are not built.
*   **A return does not yet propose a credit note.** The specification's §66
    says money must not move automatically; it does not say the screen should
    stay silent. A prompt belongs with the returns UI.
*   **Reversal of a goods receipt or issue.** Notes correct money; the physical
    counterpart is a reversing document, and it is not built.
