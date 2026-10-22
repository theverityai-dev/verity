# Task Plan 130 — Business documents post to the ledger (ADR-044)

**Authority:** ADR-044 (ACCEPTED 2026-10-22 with two amendments); `clients/dsew/reference-parity/accounting.md` sections 5 to 7;
FINISHER P1-1h; split out of Task 129 workstream E2 because it is a capability build, not an architecture fix. ADR-039 (outbox),
ADR-017 (one authorization path), ADR-016 (scheduler may enumerate tenants), INV-001, INV-002. Changes no invariant,
`enforcePolicy()`, or tenant-access path.

## Status: PENDING 2026-10-22 (design accepted, nothing built)

Why it is a plan of its own: it needs a migration, a consumer, ten document kinds with different payloads, an account map with a
setup screen, and a backfill. Doing it as a side task would repeat the habit this repository is trying to leave: breadth that is
built but not proven.

## What is already true (read 2026-10-22)

- `accounting` takes only manual journal entries (`verity.accounting.post_journal_entry`, append-only with reversal).
- Documents raise events: `verity.trading.sales_invoice_raised`, `purchase_invoice_raised`, `purchase_bill_raised`,
  `purchase_bill_confirmed`, `payment_recorded`; `verity.project.invoice_recorded`, `invoice_voided`, `receipt_recorded`,
  `receipt_voided`. Credit notes and voids in `trading` need their event names read first.
- `domain_event.delivered_at` belongs to the notification dispatcher. Accounting must not use it (ADR-044 amendment 2).
- The statements page states that it covers journal entries only. That sentence changes only when this plan is proven.

## Steps (each ends with tests; none starts before the one before it passes)

| # | Step | Done when |
|---|---|---|
| 1 | Migration: `account_map` (tenant, document kind, role such as receivable, sales income, GST output, cash) with RLS, forced RLS and conformance entries; `journal_entry.source_kind` and `source_id` with a tenant-scoped unique key | migration applies on a fresh and an existing database; RLS isolation test; conformance lists updated |
| 2 | Account map commands and a setup screen listing document kinds with no mapping | an unmapped kind is visible with a plain reason; nothing posts to a default account |
| 3 | Posting function per document kind, pure: document figures in, balanced lines out. Amounts are copied from the document, never recomputed (clause 6) | table-driven unit tests per kind including GST and rounding |
| 4 | The consumer: reads events with no entry for their source key, posts through `postJournalEntry` under `enforcePolicy()`, records refusals as pending, runs from the scheduler per tenant (ADR-016) | idempotent (twice posts once), refused when unmapped, reversal on void, cross-tenant negative test |
| 5 | Backfill command with a dry-run count first | rerunnable; counts match |
| 6 | Statements and Summary tiles read the posted ledger; remove the "journal entries only" notice | DSEW acceptance walk in `accounting.md` section 8: the trial balance moves by exactly the invoice and receipt amounts |
| 7 | Ledger period lock with a time-limited exception, then opening balances (ADR-044 clause 7) | a document dated in a locked period posts on the first open date and says so |

## Non-goals

Bank feeds and CSV reconciliation (phase 2 of the parity document), payroll, multi-currency, consolidation, and any automatic chart
of accounts.

## Order

After Task 129 B7 is scheduled with DSEW. Start with steps 1 to 4 for `trading` sales invoices and payments only, prove them, then add
kinds one at a time.
