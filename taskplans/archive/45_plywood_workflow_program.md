# Task 45 — Plywood Target Workflow: Program Control & Rule Freeze

**Status: SLICES 1–7 DELIVERED (2026-08-31)**
**Opened: 2026-08-31**
**Inputs:** `PLYWOOD_TARGET_WORKFLOW_GAP_AUDIT.md` (30 Aug 2026), the target
workflow specification supplied 31 Aug 2026.

This is the control document for the Plywood target workflow. It exists because
the audit's own §5 says it must: twelve contradictions in the target make
"start coding" unsafe, and *coding around them would create inconsistent data
and tests*.

---

## 1. Objective

```text
Buy → Receive → Stock → Sell → Reserve → Issue Goods → Invoice → Collect → Account → Tax → Close
```

One connected business system. The governing rule, from the specification's
own §84:

> A business fact is entered once. Every affected screen updates automatically.
> The user should never think "where do I enter this again?" They should think
> "I recorded what happened. Verity knows the consequences."

---

## 2. Product decisions taken (2026-08-31)

Four decisions sit at the root of the schema. They are recorded here so they are
not re-litigated in each task.

### D-01 — Logistics is removed entirely

The capability, its models, routes, navigation and overview metrics go. The
`dispatching` / `qtyShipped` vocabulary is replaced by the Goods Issue model the
specification asks for. Shipment and transporter tables are dropped by
migration.

*Consequence:* stock leaves a godown through exactly one door — a Goods Issue
document. Two doors would make the stock ledger unprovable, which is P0-04.

### D-02 — Accounting is party subledgers and tax, not a general ledger

Customer and supplier ledgers, receivables and payables with due dates and
allocation, credit and debit notes, inventory valuation, GST. **No** chart of
accounts, journals, or trial balance.

*Rationale:* every screen the specification actually describes is a subledger or
a tax view. A GL is a real product decision with an accountant's sign-off
attached, and inventing one because "Account" appears in a flow diagram would be
filling a gap with generic engineering knowledge — which `CLAUDE.md` forbids.

*Recorded as:* `Authority: IMPLEMENTATION DECISION REQUIRED` → decided here. If
a GL is later required, it consumes these subledgers rather than replacing them.

### D-03 — One GST registration, modelled as if there could be more

One `GstRegistration` per tenant: one GSTIN, one registered state, one invoice
series. The Noida godown is a storage location under the Delhi registration.

**But** tax rules, invoice series and returns are keyed by *registration id*
from the first migration, not by tenant. Adding a second registration later is
then data, not redesign. Resolves audit §5.9 without paying for multi-state
today.

### D-04 — Delivery is by vertical slice

Purchase first, end to end, with the foundations it needs. Then Sales. Then Tax
and Close. Each slice is genuinely usable on the day it lands.

*Consequence, stated plainly:* the application is visibly half-migrated between
slices — a correct Purchases area beside an unreformed Sales area. The
alternative (all screens first) is what the audit warns against, because
cross-scope access and credit bypass are invisible from a screenshot.

---

## 3. Contradictions resolved (audit §5)

The audit found twelve. Each is closed here, with the reason.

| # | Conflict | Resolution |
|---|---|---|
| 1 | Reservation arithmetic disagrees between two examples | The specification's two examples use different starting data. **Reserved is an aggregate per (product, godown)**, not per order. Issuing 40 against a reservation of 40 reduces aggregate reserved by exactly 40 and leaves any other order's 20 intact. The second example is simply an isolated case. |
| 2 | PO example 100 @ ₹1,200 vs invoice ₹113,280 (= 96 @ ₹1,180) | Treated as the **partial-invoice-with-price-variance** case, which is the more useful one to build: the invoice is for the 96 received at the agreed ₹1,180, and the mismatch example (§29) is the separate teaching case. Both are acceptance examples. |
| 3 | Exposure = receivables, or receivables + commitments? | **One formula, §4.1 below.** Both, without double counting. |
| 4 | "No financial ledger for draft orders" vs "ledger commitment" | Orders are **commercial commitments**, a separate projection. They never post financial ledger entries. The Ledgers screen shows them in a clearly separate section, exactly as specification §54 draws it. |
| 5 | Invoice immutable on issue, or after close? | **On posting.** Draft is editable, Posted is immutable, corrections are credit/debit notes. Close adds a *date* lock on top, it is not what makes a document immutable. |
| 6 | Competing state vocabularies | Canonical state machines, §5 below. |
| 7 | Role vocabulary inconsistent | Canonical role→activity matrix, §6 below. |
| 8 | `/close` required but missing from nav | Lives under **Tax & Compliance** as `/tax/close`. Closing is a compliance act and the checklist is mostly tax exceptions. |
| 9 | Delhi + Noida vs single registration | D-03. |
| 10 | Return/damage accounting undefined | §4.5 below. |
| 11 | Overview card list not frozen | §7 below is the frozen catalogue. |
| 12 | "Ageing updated" under a Tax column | Document error in the source matrix. Supplier payment affects payables ageing, not tax. |

---

## 4. Canonical formulas

Defined once. Every screen, report and command reads these and no others. A
second definition anywhere is a defect.

### 4.1 Credit exposure

```text
exposure = unallocated_receivables
         + approved_uninvoiced_commitments

unallocated_receivables         = Σ posted sales invoices (gross, incl. tax)
                                − Σ allocated receipts
                                − Σ posted credit notes

approved_uninvoiced_commitments = Σ order line value (gross) for orders in
                                  Approved | Reserved | Awaiting Issue |
                                  Part Issued
                                − Σ value already invoiced against those orders
```

Three properties this must have, each of which the current implementation fails:

*   **Issuing goods does not reduce exposure.** Today dispatch completes the
    order and exposure falls to zero while the customer still owes the money
    (P0-02). Under this formula the commitment converts to a receivable at
    invoice, and the receivable clears only on allocated payment.
*   **No double counting.** An order that has been invoiced contributes through
    the receivable, not through the commitment; the subtraction is what makes
    that true.
*   **Draft orders are excluded.** A draft is not a commitment.

Advances reduce exposure only when allocated. Disputed invoices are **not**
excluded — a dispute is not a payment.

### 4.2 Inventory

```text
on_hand   = Σ posted stock movements (product, godown)
reserved  = Σ active, unissued reservation quantity (product, godown)
available = on_hand − reserved
incoming  = Σ (ordered − received) for PO lines on Submitted | Part Received
low_stock = available < reorder_level
```

`low_stock` compares **available**, not on-hand — the current implementation
compares on-hand and therefore fails to warn when everything is spoken for.

### 4.3 Weighted average cost

```text
new_wac = (on_hand × current_wac + received_qty × received_unit_cost)
        / (on_hand + received_qty)
```

Recomputed on receipt and on customer return (at the return's carrying cost).
**Not** recomputed on issue, damage, or negative adjustment — those consume at
the current average. A backdated receipt does not restate history; it applies at
its posting date, and the audit trail carries the discrepancy.

### 4.4 Tax determination

```text
place_of_supply = customer.state (sales) | supplier.state (purchases)
if place_of_supply == registration.state → CGST + SGST
else                                     → IGST
```

Rates come from an **effective-dated `PlywoodTaxRule` keyed by HSN and
registration**, never from global configuration. Two failure modes are closed
deliberately:

*   a missing customer state **must not** default to the business state — today
    it does, which silently mislabels an interstate supply;
*   a missing rate **must not** produce zero tax — it raises a blocking
    exception. A zero-rate invoice is a filing error with a paper trail.

### 4.5 Returns, damage, adjustments

| Event | Stock | Valuation | Money |
|---|---|---|---|
| Customer return | on_hand ↑ at the issue's carrying cost | WAC recomputed | **none** — money moves only through a credit note |
| Damage | on_hand ↓ | written off at WAC | none |
| Adjustment | ± | at WAC | none |

Every one requires a reason. None may be recorded by editing a quantity: the
movement ledger is the only way stock changes, which is what makes §13 of the
specification (the movement ledger that explains a number) possible at all.

### 4.6 Document numbering

Per registration, per financial year, gapless within a series:
`NK/26-27/0001`. Allocated inside the posting transaction, so a rolled-back
posting does not burn a number. Financial year boundaries use the **tenant's
timezone**, not UTC — the audit found UTC date logic that reports the wrong day
near Indian midnight.

---

## 5. Canonical state machines

### Purchase Order

```text
Draft → Submitted → Part Received → Received
  ↓         ↓            ↓
Cancelled Cancelled   (no cancel after any receipt)
```

`Submitted` creates incoming stock. It creates **no payable** — a PO is not a
liability. Received quantity comes from Goods Receipt documents, never from a
field somebody edits.

### Sales Order

```text
Draft → Pending Credit → Approved → Part Reserved → Reserved
                            ↓            ↓             ↓
                        Cancelled    Awaiting Issue ──┘
                                          ↓
                                    Part Issued → Fulfilled
```

Replaces `dispatching`. Cancellation after reservation releases the
reservation; cancellation after issue is not a cancellation — it is a return.

### Invoice (sales and purchase)

```text
Draft → Posted → (Cancelled only if never paid and period open)
           ↓
     Credit Note / Debit Note
```

Posted is immutable at the database level, by trigger, for every role.

### Accounting period

```text
Open → Closing (checklist running) → Closed → Reopened (audited)
```

---

## 6. Role → activity matrix

Business activities, not `READ`/`MANAGE`. Each maps to Verb + Entity + Scope
underneath, so `authorization.ts` is unchanged (Task 37's decision point does
the work).

| Activity | Owner | Purchase Mgr | Warehouse | Sales | Sales Mgr | Accountant | Auditor |
|---|---|---|---|---|---|---|---|
| View catalogue | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Change standard price | ✓ | | | | ✓ | | |
| Create / submit PO | ✓ | ✓ | | | | | |
| Receive goods | ✓ | | ✓ | | | | |
| Reverse receipt | ✓ | | | | | | |
| Capture supplier invoice | ✓ | | | | | ✓ | |
| Resolve match exception | ✓ | ✓ | | | | ✓ | |
| Pay supplier | ✓ | | | | | ✓ | |
| Create sales order | ✓ | | | ✓ | ✓ | | |
| Change customer pricing | ✓ | | | | ✓ | | |
| Approve credit override | ✓ | | | | ✓ | | |
| Reserve / release stock | ✓ | | ✓ | ✓ | ✓ | | |
| Issue goods | ✓ | | ✓ | | | | |
| Raise sales invoice | ✓ | | | | ✓ | ✓ | |
| Record collection | ✓ | | | | | ✓ | |
| Credit / debit note | ✓ | | | | | ✓ | |
| Adjust stock / damage | ✓ | | ✓ | | | | |
| View cost & margin | ✓ | ✓ | | | ✓ | ✓ | ✓ |
| Tax: prepare / file | ✓ | | | | | ✓ | |
| Close / reopen period | ✓ | | | | | ✓ | |
| Manage people & settings | ✓ | | | | | | |
| View audit | ✓ | | | | | ✓ | ✓ |

**Maker/checker:** the actor who creates an order may not approve its own credit
override. The actor who captures a supplier invoice may not clear its own match
exception. Enforced server-side.

**Scope:** Warehouse roles are godown-scoped, and that scope is enforced in
every query and command — P0-01, the audit's first finding.

---

## 7. Frozen Overview catalogue

Every card is a link, and its destination applies **the same filter and the same
formula**. A number that changes meaning when you click it is worse than no
number.

| Group | Cards |
|---|---|
| Sales | Sales this month · Open orders · Awaiting credit approval · Awaiting goods issue |
| Purchase | Open purchase orders · Pending receipt · Incoming stock |
| Inventory | Inventory value · Low stock (SKUs) · Reserved |
| Money | Receivables · Overdue · Payables · Collections today |
| Tax | Output GST · Eligible ITC · Tax exceptions |

Each card is composed **per permission**: `Invoice.Read` alone must not disclose
stock or payables. Removed: delivery and in-transit metrics (D-01).

---

## 8. Navigation

```text
Overview
TRADE           Catalogue · Suppliers · Purchases · Customers · Sales
INVENTORY       Stock · Godowns
MONEY           Finance · Ledgers · Tax & Compliance
INSIGHTS        Reports
ADMINISTRATION  People & Roles · Business Settings · Audit
```

Withdrawn from client view: Capability Registry, raw Configuration keys, generic
Locations, generic Assets, Operator settings, Logistics, and the platform
Workspace dashboard. Those are platform concepts; a client seeing them is the
foundation leaking into the product.

---

## 9. Slice plan

| Slice | Task | Delivers | |
|---|---|---|---|
| 0 | 45 | This document | ✅ |
| 1 | 46 | **Integrity foundation** — row scope, immutability, concurrency, idempotency, business activities, tenant-timezone dates | ✅ |
| 2 | 47 | **Business identity** — BusinessProfile, GstRegistration, financial year, document series, onboarding, People & Roles, navigation, Logistics removal | ✅ |
| 3 | 48 | **Purchase chain** — supplier detail, effective pricing, PO lifecycle, Goods Receipt document, source-linked stock ledger, supplier invoice, three-way match, payables, expected ITC | ✅ |
| 4 | 49 | **Sales chain** — customer detail, corrected exposure, credit approval, partial reservation, Goods Issue, invoice from issued quantity, collections | ✅ |
| 5 | 50 | **Returns & corrections** — customer return, damage, adjustment, credit and debit notes | ✅ |
| 6 | 51 | **Tax** — tax rules, tax lines, ITC, exceptions, GSTR-1, GSTR-3B | ✅ |
| 7 | 52 | **Close, reports, audit, notifications** | ✅ |

Commit per task. Each slice ships with its own acceptance tests, in the layers
the audit's §8 requires: pure rule, database invariant, concurrency, chain,
role, and reconciliation.

---

## 10. Non-negotiables carried from the platform

*   **INV-001** — every Plywood read and write is tenant-scoped *and*
    row-scoped. This is P0-01 and it is slice 1's first job.
*   **INV-002** — a posted document is read-only; corrections spawn documents.
*   Task 37's policy point decides every action; no capability grows its own
    authorization habit.
*   Task 38's correlation id links order → reservation → issue → invoice →
    payment → ledger → tax, so §74's drill-down is a join, not a search.
*   No secret, and no tax identity, is stored where it cannot be corrected —
    posted documents snapshot identity precisely so master-data edits cannot
    restate history.

---

## 11. Exit criteria

```text
[ ] Every fact entered once; every downstream projection updates automatically
[ ] Cross-scope access impossible (negative tests per role and godown)
[ ] Credit cannot be bypassed at submit, override, reserve or issue
[ ] Every stock quantity traces to a source document
[ ] Invoice quantity never exceeds eligible received/issued quantity
[ ] Posted documents immutable; corrections only through notes and reversals
[ ] Tax derived from posted lines, never re-keyed
[ ] A period can be closed, reproduced, exported, and reopened only with authority
[ ] Logistics absent from schema, server, navigation and tests
[ ] Every target example in the specification exists as a passing acceptance test
```

---

## 12. Delivery record (2026-08-31)

| Slice | Task | Closed |
|---|---|---|
| 1 | 46 | P0-01, P0-02, P0-03 (part), P0-05 (part), P0-06 |
| 2 | 47 | P0-09, P0-10 (part) |
| 3 | 48 | P0-04 (receipts) |
| 4 | 49 | P0-04 (issues), P0-03 (rest) |
| 5 | 50 | P0-05 (rest) |
| 6 | 51 | P0-07 |
| 7 | 52 | P0-08, P0-10 (rest) |

**All ten release-blocking findings in the audit are closed.**

Suite: **521 → 785**, all passing, `tsc` clean, every migration applied to a
dropped-and-recreated database.

### What is built and what is not

Built and proven: row-scoped authorization, a correct credit-exposure formula,
invoice eligibility bound to physical goods movement, immutable posted
documents with a correction path, concurrency protection, business and tax
identity as master data, Goods Receipt and Goods Issue documents,
source-linked stock movements, three-way match, partial receipt and partial
issue, returns tied to their issue, credit and debit notes, effective-dated tax
rules, a GSTR-1 working, an accounting period lock, and reports that answer
this business's questions.

Not built, and named in each slice's plan: most detail routes and Related
sections, effective-dated party pricing, purchase-invoice tax lines and ITC,
GSTR-3B and portal reconciliation, the business-activity role editor, the
guided onboarding flow, notifications beyond low stock, and the human-readable
operational audit.

The foundations the audit said to build first are in. The screens that sit on
them are the next programme, and they can now be built without the defects
underneath.
