# Task Plan 46 — Plywood Integrity Foundation (Slice 1)

**Program:** `45_plywood_workflow_program.md`. **Slice 1 of 7.**
**Closes:** audit P0-02, P0-03, P0-05, P0-06 (in part), and the availability
rule in rule freeze §4.2.

---

## 1. Why this is first

The audit's own conclusion: *"Building the requested screens first would make
the product appear complete while leaving the most consequential failures —
cross-scope access, credit bypass, untraceable stock, inconsistent invoices —
underneath."*

Every defect closed here is invisible from a screenshot and expensive in cash.

---

## 2. Delivered

| Finding | Was | Now |
|---|---|---|
| P0-02 credit exposure | open orders only; **dispatch dropped exposure to zero** while the customer still owed the invoice | rule-freeze §4.1: unallocated receivables + approved-uninvoiced commitments |
| P0-03 invoice eligibility | sales blocked only `draft`/`cancelled`, so `pending_credit` could be invoiced; purchase had **no state guard at all** | allow-lists on both sides |
| P0-05 immutability | `BEFORE DELETE` on invoice only; amounts and tax rates rewritable in place | `BEFORE UPDATE` refusal on invoice, invoice line and payment, for **every** role |
| P0-06 duplicate invoice | application-level check, losable to a race | partial unique index per sales order and per purchase order |
| P0-06 over-reservation | availability read with no lock | transaction-scoped advisory lock on (product, godown) before a read that decides a write |
| §4.2 low stock | compared **on hand** — silent while every sheet was reserved | compares **available**, and reports on-hand, reserved and available |

Files: `prisma/migrations/20260831090000_plywood_integrity/`,
`plywood/trading.ts`, `plywood/finance.ts`, `plywood/stock.ts`,
`src/test/plywood-integrity.test.ts` (11 tests).

---

## 3. Decisions worth defending

**Exposure is clamped per invoice, not in aggregate.** An overpayment on one
invoice is money on account; letting it net against a different unpaid invoice
would understate exposure and grant credit that was never justified.

**`completed` orders stay in the commitment set.** It is the subtraction of the
invoiced amount — not the order's state — that prevents double counting. Making
state carry that job is exactly the mistake that produced P0-02.

**Allow-lists, not deny-lists, for invoice eligibility.** A state added later is
refused until someone decides it should be invoiceable. That is the safe
direction to be wrong in.

**Immutability applies to privileged roles too.** Same reasoning as the audit
tables: a correction a migration could quietly make is not a correction. The
refusal names the correction path — *"correct it with a credit or debit note"* —
because a refusal that does not say what to do instead teaches people to work
around it.

**An advisory lock, not `SELECT … FOR UPDATE`.** The row that would be locked is
the `stock_balance`, and for a product that has never moved in that godown there
is no such row — precisely the case where two concurrent first reservations
race. An advisory key exists whether or not the row does.

---

## 4. Corrected against the audit

The audit listed missing sign constraints on payments, invoices and
reservations. **They already exist** — verified against the live database before
writing the migration, not assumed from the report. The migration says so rather
than silently omitting them.

---

## 5. Evidence

```text
Tests  727 passed | 4 skipped (731)
```

Suite 720 → 731. `tsc --noEmit` clean. Migration applied to a database that had
already been dropped, recreated and migrated from empty this session.

---

## 6. Deliberately not in this slice

*   ~~**P0-01 row-scoped authorization**~~ — **DONE, see §7.** The remaining
    piece is the business-activity permission split (rule freeze §6), which
    lands with the People & Roles screen in slice 2.
*   **P0-04 Goods Receipt / Goods Issue documents** — slice 3 and 4, where the
    invoice guards tighten from "order state" to "eligible issued quantity".
*   Partial invoicing. The one-invoice-per-order index is correct **today** and
    is replaced by a quantity-allocation constraint when partial invoicing
    arrives — noted in the migration so it is not simply dropped.

---

## 7. P0-01 — godown row scope (added in the same slice)

`query.ts` had always exposed `ctx.scope()` and `authorization.ts` had always
had `assertRowInScope`. **No plywood handler called either.** Layer 1 was
enforced and Layer 2 was not, which is the worst of the three combinations: it
looks authorized. A role limited to one godown could read tenant-wide stock and
orders, and — holding the entity action — could mutate a record in another
branch given only its id.

`plywood/scope.ts` resolves the one hop the platform does not: reachable
organizations → the `Location` rows that hang off them → the godowns this actor
may touch. Applied to `stockOnHand`, `lowStock`, `openOrders`, and to the
purchase- and sales-order create paths.

Three decisions inside it:

*   **A tenant-scoped grant is not a special case.** `reachableOrganizations`
    already returns every organization for a `Tenant` grant, so an owner's
    reachable set is simply "all of them". There is no `null means everything`
    branch, because that branch is where a scoping bug hides — the code that
    runs for the restricted user must be the code that runs for the owner.
*   **An explicit `locationId` is intersected with the reachable set, never
    substituted for it.** Asking for another branch's godown by id returns
    nothing rather than returning its stock.
*   **Each list on a composite screen is scoped against its own entity.**
    Reading sales orders must not be what lets someone read purchase orders,
    even where the two appear side by side.

Six tests, all negative-first: another branch's stock is hidden, naming it by id
returns nothing, creating an order into it is refused, the actor's own godown
still works, another branch's orders stay out of the list, and HQ still sees the
whole subtree (PLA-ORG-002 downward visibility beside PLA-ORG-003 sibling
isolation, from one mechanism).

**Suite 731 → 737.**
