# Task Plan 130 — Business documents post to the ledger (ADR-044)

**Authority:** ADR-044 (ACCEPTED 2026-10-22 with two amendments); `clients/dsew/reference-parity/accounting.md` sections 5 to 7;
FINISHER P1-1h; split out of Task 129 workstream E2 because it is a capability build, not an architecture fix. ADR-039 (outbox),
ADR-017 (one authorization path), ADR-016 (scheduler may enumerate tenants), INV-001, INV-002. Changes no invariant,
`enforcePolicy()`, or tenant-access path.

## Status: PARTIALLY BUILT 2026-10-23: trading sales invoices and receipts, and job (project) invoices and receipts with reversal on void, are posted; migration `20261023100000_ledger_posting` is on production

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

## Progress log

**2026-10-23 — steps 1 to 4 built for trading sales invoices and customer receipts.** Migration `20261023100000_ledger_posting` (journal source key with a
tenant-scoped unique index, `account_map`, `ledger_posting_pending`, RLS forced on both new tables). Pure rules in `src/lib/ledger-posting.ts` (11 tests).
Consumer, `set_account_mapping`, `post_documents_now` and `posting_setup` in `src/server/capabilities/accounting/posting.ts`, scheduled on the frequent
cadence. Screen: Accounting, Posting setup (`/accounting/setup`). `src/test/ledger-posting.test.ts` (9 tests against the real database, runtime role):
unmapped means pending with the reason and nothing posted; wrong-type and deactivated accounts refused; the trial balance moves by exactly the invoice and
receipt amounts; a rerun and the button post nothing twice; cash goes to cash and UPI to bank; a tenant with accounting but no trading is untouched;
another tenant sees nothing; the unique key holds at the database. ADR-044 amendment 3 records two decisions made on the way (no actor, soft dependency).

**Not done (each its own small step):** step 5 backfill dry-run beyond the "waiting" count on the setup screen; step 6 statements already read the posted ledger
but the DSEW acceptance walk has not been run; step 7 period lock; credit notes and voids (a reversal on void), purchase bills and supplier payments, and
`project` invoices and receipts (DSEW's own billing) are NOT posted. Until project billing posts, a DSEW balance sheet still omits its jobs.

**2026-10-23 (later) — job invoices and receipts post, and a void reverses.** `project.invoice` and `project.receipt` post through the same consumer and the
same account map (amount plus one tax figure; bank, cheque, UPI and "other" go to the bank account, cash to cash). A job invoice or receipt voided **after**
it posted gets a reversing entry (every line swapped, `reversal_of_id` set, its own source key `project.invoice_void` / `project.receipt_void`, needs no account
mapping, attributed to whoever voided it); one voided **before** it posted never posts. Receipts reverse before invoices, the order the voids happened in.
`src/test/ledger-posting-jobs.test.ts` (7 tests) and three more pure tests: waits unmapped, posts exact figures, idempotent, receipts by method, reversals
net every account to zero and still balance, a never-posted voided invoice posts nothing, a tax-free invoice needs no GST account.
**Still not posted:** trading credit notes and voids, purchase bills, supplier payments. DSEW's own billing (jobs) is now in the ledger, so its balance sheet no
longer omits its jobs once accounts are chosen. **Not done:** the DSEW acceptance walk (section 8 of the parity document), backfill dry-run, period lock.
