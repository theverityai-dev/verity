# D & S Electric Works: Reference Parity, Accounting

**Date:** 2026-10-16. **Status:** Draft v1. Follows `docs/reference/client-reference-parity-template.md`.
Scope: `clients/dsew/prd.md` ("Journals, ledger: `accounting`", "owner likes the UI/UX of manager.io",
"Invoice -> Payment -> Job margin"). Companion to `README.md` in this folder (Projects and Jobs).

## 0. Licence and method (read first)

- **Manager** (`github.com/Manager-io/Manager`) is published under the Functional Source License 1.1
  (Apache 2.0 after two years), copyright NGSoftware, and its README calls it "source-available, not
  open source". The licence forbids use "for a competing use". Verity is business software with an
  accounting capability, so **no Manager source, assets, translations, wording or trademarks are
  copied or ported.** Manager is used here only as a reference for **structure and behaviour**, taken
  from its public guides at manager.io. "Adapt properly" therefore means: reproduce the structure the
  owner likes, built natively on Verity's primitives, written from this document and never from
  Manager's code. If anyone proposes reading the repository's `ManagerServer/` source to port logic,
  stop and get a licence decision first.
- **Odoo 19** (`D:\Code\R&D\odoo-19.0\addons\account`, community edition, LGPL) is read for behaviour,
  states and workflows. Same rule: patterns, not code. The statement reports (profit and loss, balance
  sheet, cash flow, partner ledger, aged reports) are **Odoo Enterprise** (`account_reports`) and are not
  in this checkout, so Odoo is not evidence for how those screens look.
- **Evidence limits.** The Manager guides were reachable only in part: the capability overview
  (`www2.manager.io/guides/8865`) lists functions but most tab names appear as images; the tabs, summary
  and guides-index pages returned navigation only. Anything about Manager's exact tab names, Summary
  tiles or Customize behaviour is **unverified until a session with the owner** (same limit as the
  Projects document). ERPNext accounts (`erpnext/accounts`) was not read for this module.

## 1. Sources read

- Odoo `account`: `views/account_menuitem.xml` (menu tree), `models/account_move.py` (states line 132,
  `move_type` line 145, `payment_state` line 50, `action_post` 6164, `action_reverse` 6156,
  `action_register_payment` 6083, `action_duplicate` 6095), `models/account_payment.py` (`action_post`
  1126, `action_reject` 1149, `action_cancel` 1152, `action_draft` 1161), `models/account_journal.py`
  (journal types line 107), `models/account_tax.py` (amount types line 85, `price_include`),
  `models/account_bank_statement_line.py` (`action_undo_reconciliation` 460), `views/*.xml` list,
  `wizard/` (payment register, move reversal, automatic entries, resequence, secure entries, unreconcile),
  `views/account_lock_exception_views.xml`.
- Odoo `l10n_in` (India): `models/account_invoice.py` (GST treatment line 30, GSTIN line 57).
- Manager public guide `www2.manager.io/guides/8865` and the guides pages named above.
- Verity: `src/server/capabilities/accounting/index.ts`, `src/server/capabilities/trading/*`,
  `prisma/schema.prisma` (`Account` 4595, `JournalEntry` 4628, `JournalLine` 4656, `TradingInvoice`
  4157, `TradingPayment` 4258, `TradingInvoiceNote` 4472, `ProjectInvoice` 6979, `Expense` 5478),
  `src/app/(shell)/{accounting,finance,ledgers,tax,reports}`.

## 2. Module map

| Client need | Odoo | Manager (public guides) | Verity today |
|---|---|---|---|
| Chart of accounts | `account.account`, groups, tags | Settings > Chart of Accounts | `Account` (code, name, 5 types) |
| Journal entries | `account.move` type `entry` | Journal Entries tab | `JournalEntry` and `JournalLine`, append-only, reversal |
| Sales invoices, credit notes | `account.move` out_invoice, out_refund | Sales Invoices, Credit Notes tabs | `trading` invoices and notes; not posted to the ledger |
| Purchase bills, debit notes | in_invoice, in_refund | Purchase Invoices, Debit Notes tabs | `trading` purchase invoices and notes; not posted |
| Receipts and payments | `account.payment` | Receipts, Payments tabs | `trading` payments with allocations; not posted |
| Bank and cash accounts, reconciliation | journals bank/cash, statement lines, reconcile models | Bank and Cash Accounts, Bank Reconciliations | cash count only (`record_cash_reconciliation`); no bank |
| Taxes (GST) | `account.tax`, fiscal positions, `l10n_in` | Tax Codes | GST returns, ITC, close (`/tax/*`) built in `trading` |
| Trial balance, ledger | partner and general ledger (Enterprise) | Reports | `trialBalance`, `accountLedger` |
| Profit and loss, balance sheet, cash flow | Enterprise `account_reports` | Summary and Reports | not built |
| Period lock and close | lock dates, `account_lock_exception` | Starting balances, period close | GST close only; no ledger lock |
| Cost by job | analytic accounts and plans | Projects tab | `project` derives job cost (never stored) |
| Expenses | `hr_expense` (not read) | Expense Claims | `finance` record and decide expense |
| Fixed assets, depreciation | `account_asset` (Enterprise) | Fixed Assets tab | not built (`asset` is physical equipment) |

## 3. Summary scorecard

| Area | Reference | Verity | Status |
|---|---|---|---|
| Chart of accounts | list, groups, tags, deprecate | list, create, activate/deactivate | Partial |
| Manual journal entries | draft, post, reverse, resequence | post (balanced), reverse | Usable |
| Document posting to the ledger | every invoice, bill and payment posts | none: ledger is a manual island | **Missing** |
| Bank and cash | journals, statements, reconcile | cash count per outlet only | Missing |
| Taxes | tax types, repartition, fiscal positions | GST specific, built | Usable for GST |
| Financial statements | P&L, balance sheet, cash flow | none | Missing |
| Period lock | lock dates and exceptions | none for the ledger | Missing |
| Starting balances | opening entries | none | Missing |
| Cost per job | analytic accounts | derived job cost | Usable (different design) |

## 4. How the references serve accounting

### 4.1 Navigation

Odoo (`views/account_menuitem.xml`): Dashboard; **Customers** (Invoices, Credit Notes, Payments,
Products, Customers); **Vendors** (Bills, Refunds, Payments, Products, Vendors); **Accounting**
(Transactions: Journal Items, Analytic Items; Closing; Review: Control, Logs); **Reporting** (Partner
Reports, Taxes and Fiscal, Management, Invoice Analysis, Analytic Report, Statement Reports);
**Configuration** (Settings; Accounting: Chart of Accounts, Taxes, Journals, Currencies, Fiscal
Positions, Multi-Ledger, Tax Groups, Rounding; Invoicing: Payment Terms, Incoterms, Product Categories;
Online Payments; Analytic Accounting: Plans, Distribution Models).

Manager (public capability list, `www2.manager.io/guides/8865`): a single list of tabs the user turns on
through **Customize**; a Summary dashboard (balance sheet and profit and loss, accrual or cash basis);
groups for Banking and Cash (accounts, Receipts, Payments, Transfers, Reconciliations), Expenses,
Sales (Customers, Quotes, Orders, Invoices, Credit Notes, Delivery Notes, Time Tracking, Billable
Expenses), Purchases (Suppliers, Requests for Quotation, Purchase Quotes, Orders, Invoices, Debit Notes),
Inventory and Production, Projects, Payroll, Assets and Investments, Equity and Special Accounts
(subsidiary ledgers, journal entries), Documents (attachments), and Reports, Customize, Settings. The
default tabs are Summary, Journal Entries, Reports and Settings (guide "tabs form"). **Unverified:** the
exact tab names and Summary tiles; confirm with the owner.

### 4.2 Pages

| Page | View types | Key fields | Buttons and actions | Source |
|---|---|---|---|---|
| Customer invoice, vendor bill, credit note | list, form, kanban | partner, date, due date, lines, tax lines, payment term, journal, `payment_state` (not paid, in payment, paid, partial, reversed) | Confirm (post), Register Payment, Add Credit Note (reverse), Duplicate, Send and Print, Reset to Draft, Cancel | `account_move.py` 50, 132, 6083-6164 |
| Payment | list, form | type (send/receive), partner, amount, journal, method, state | Confirm, Reject, Cancel, Reset to Draft | `account_payment.py` 1126-1161 |
| Bank statement line | list, reconcile widget | date, amount, partner, matched entries | Reconcile, Undo reconciliation, reconcile models (auto rules) | `account_bank_statement_line.py` 460; `views/account_reconcile_model_views.xml` |
| Journal entry (misc) | list, form | journal, date, reference, lines (account, debit, credit, partner, analytic) | Post, Reverse, Reset to Draft | `account_move.py` |
| Chart of accounts | list | code, name, type, tags, allow reconciliation, deprecated | New, Deprecate | `views/account_account_views.xml` |
| Taxes | list, form | name, type (sale/purchase), amount type (percent, fixed, group, division), price included, repartition lines | Activate, edit | `account_tax.py` 19-21, 85, 137 |
| Journals | list, form | type (sales, purchase, cash, bank, credit card, misc), default accounts, sequence | Configure | `account_journal.py` 107-112 |
| Payment terms, fiscal positions | list, form | due-day lines, tax mappings | edit | `views/account_payment_term_views.xml` |
| Lock dates and exceptions | settings, list | period lock, tax lock, hard lock | Grant a time-limited exception | `views/account_lock_exception_views.xml` |
| Closing wizards | wizard | resequence, secure (hash) entries, automatic entry (deferrals), unreconcile | one-shot actions | `wizard/*.py` |

### 4.3 Workflows

- **Document:** draft, posted, cancelled (`account_move.py` 132). Payment state is derived from
  reconciliation: not paid, partial, in payment, paid, reversed. A posted document is not edited; it is
  reversed (credit note or reversal entry). The happy path is draft, confirm, register payment, paid.
  Exception paths: partial payment, credit note, reverse, reset to draft (only if not locked), cancel.
- **Payment:** draft, in process, paid, rejected, cancelled (`account_payment.py`).
- **Bank:** import statement lines, match against open invoices and payments (by rule), reconcile; a
  difference becomes a write-off entry; undo is allowed until the period is locked.
- **Period:** lock date set, then every later change to an earlier period is refused unless a lock
  exception grants time-limited access.
- Manager: every document posts to the ledger on save; bank reconciliation marks statement lines against
  receipts and payments; reports read the ledger directly.

### 4.4 Reports

Odoo CE: Invoice Analysis (`report/account_invoice_report.py`), analytic report, journal items.
Odoo Enterprise (not in checkout): P&L, balance sheet, cash flow, trial balance, partner ledger, aged
receivable and payable, tax report, general ledger. Manager: Summary dashboard with balance sheet and
P&L, a Reports tab (trial balance, ledgers, ageing, tax).

### 4.5 Configuration

Chart of accounts, journals, taxes and tax groups, fiscal positions, payment terms, lock dates,
currencies, rounding, opening balances. India (`l10n_in`): GST treatment per document and per partner,
GSTIN, HSN code (`l10n_in/models/account_invoice.py`, `product_template.py`).

### 4.6 Automation

Odoo: auto-post of bills, recurring entries, bank reconcile models, follow-ups. Manager: recurring
transactions (Settings). Verity's notification outbox (ADR-039) exists but no accounting subscriptions.

### 4.7 Roles

Odoo: Billing, Accountant, Adviser groups (read, draft, post, configure). Verity maps this to
Verb + Entity + Scope permissions: no new primitive.

## 5. Verity today

| Reference item | Verity equivalent | Status | Evidence |
|---|---|---|---|
| Chart of accounts | `createAccount`, `setAccountActive`, `listAccounts`; five types | Partial (no groups or tags) | `accounting/index.ts` 38-120 |
| Manual journal, balanced | `postJournalEntry` | Built | `index.ts` 122 |
| Reverse an entry | `reverseJournalEntry` (never in-place edit) | Built | `index.ts` 189 |
| Trial balance and account ledger | `trialBalance`, `accountLedger`, `/accounting`, `/accounting/[accountId]` | Built | `index.ts` 240, 264 |
| Customer and vendor invoices, notes | `raiseSalesInvoice`, `raisePurchaseInvoice`, `raiseInvoiceNote` | Built, **not posted to ledger** | `trading/finance.ts`; `prisma` 4157, 4472 |
| Payments with allocation | `recordPayment`, `recordPartyPayment`, `TradingPaymentAllocation` | Built, not posted | `prisma` 4258, 4307 |
| Ageing | `financeAgeing`, `/reports/finance` | Built | `trading/reports.ts` 452 |
| GST returns, ITC, close | `/tax/gstr-1`, `gstr-3b`, `itc`, `close`, `exceptions` | Built | `src/app/(shell)/tax` |
| Job invoices and receipts (recorded, not computed) | `ProjectInvoice` | Built | commit `c9ce808c` |
| Expenses | `recordExpense`, `decideExpense` | Built | `finance` capability |
| Bank accounts and reconciliation | none | Missing | n/a |
| P&L, balance sheet, cash flow | none | Missing | `index.ts` header comment |
| Period lock for the ledger | none | Missing | n/a |
| Opening balances | none | Missing | n/a |

**The central finding.** Verity has two separate money systems that never meet. The trading and project
capabilities hold invoices, payments and GST, and the accounting capability holds a ledger that only
receives manual journals. Nothing an invoice or a payment does reaches the trial balance. Both references
treat that as the core of accounting (every document posts; every report reads the ledger), so a
"balance sheet" built today would silently exclude all real business.

## 6. Gap decisions

| Item | Decision | Reason | Owner |
|---|---|---|---|
| Copy Manager code, assets or wording | **Not applicable** | FSL 1.1 bars competing use; structure only | Product owner |
| Manager-style tab list the user shows, hides and reorders (Customize) | **Include** | Already a D&S Phase 5 item; the owner's stated preference | Engineering |
| Summary with balance sheet and P&L | **Include**, after ledger posting | Meaningless until documents post | Engineering |
| Post sales invoices, purchase invoices, notes and payments to the ledger | **Include** | The core gap; needs a posting design and an ADR (section 7) | Product owner approves ADR |
| Chart of accounts groups, tags | **Include**, minimal: a parent account | Statements need subtotals | Engineering |
| Journals as a type (sales, purchase, cash, bank, misc) | **Defer** | One ledger with source labels is enough for D&S | Product owner |
| Bank accounts, statement import, reconciliation | **Include**, phase 2 | Needed to close the books; CSV import first | Product owner |
| Auto reconcile rules (reconcile models) | **Defer** | After manual reconcile is proven | Product owner |
| GST on documents (treatment, GSTIN, HSN) | **Include** (done) | Already in trading | n/a |
| Taxes configurable beyond GST (fiscal positions, tax groups) | **Not applicable** | India GST only for D&S | Product owner |
| Payment terms | **Include** | Due date derivation; check `trading/finance.ts` first, may exist | Engineering |
| Lock date (period lock) with time-limited exception | **Include** | Closed periods must not change; reversal rule already exists | Engineering |
| Opening (starting) balances | **Include** | Needed to go live with an existing ledger | Engineering |
| Multi-currency, rounding | **Not applicable** | INR only | Product owner |
| Analytic accounts and plans | **Defer** | `project` derives job cost already; revisit if cost centres are asked | Product owner |
| Fixed assets and depreciation | **Defer** | Not in the D&S brief | Product owner |
| Recurring transactions, auto-post | **Defer** | After posting works | Product owner |
| Cash flow statement | **Defer** | After P&L and balance sheet | Product owner |
| Payroll postings | **Defer** | Payroll not in scope | Product owner |
| Hash-secured entries, resequence wizards | **Not applicable** | Append-only entries already give the property | n/a |

## 7. Verity design for D & S

Built on existing primitives: Command, Query, Event, the append-only `JournalEntry`, and capability
dependencies. In Verity's terms (a ledger posting is a Command; "document posted" is an Event).

1. **Ledger posting from documents (needs an ADR before code).** Proposed: ADR-044, "Documents post to
   the ledger through events." Points it must settle, none decided here:
   - *Mechanism:* the accounting capability subscribes to `trading` and `project` events and posts a
     balanced entry per document, in the same transaction as the document where possible, otherwise by the
     notification outbox pattern of ADR-039 (at-least-once with an idempotency key keyed on the source
     document id, so a retry never double-posts).
   - *Accounts:* a per-tenant mapping from document type to accounts (receivable, payable, sales, purchases,
     GST output and input, cash, bank). Missing mapping must refuse to post and surface in setup, never
     guess an account.
   - *Reversal:* a credit note or voided document posts a reversing entry; nothing edits a posted entry
     (already the platform rule, ADR-009 and INV-002 spirit).
   - *Boundary:* capability dependency direction `accounting` depends on `trading`, not the reverse, so a
     client without accounting is unaffected. Posting runs as the acting person's authority (ADR-017); no
     service identity.
   - *Backfill:* existing documents for D&S are few and disposable; define one idempotent backfill command.
2. **Statements.** `profitAndLoss(from, to)` and `balanceSheet(asOf)` as Queries over `JournalLine` grouped
   by account type, with an accrual basis; cash basis optional later. Pure functions in `src/lib` with
   unit tests, as the labour and settlement logic already do.
3. **Summary.** Add the two statements as tiles on `/summary` for roles that can read accounting, after
   (1). The Manager-style Customize list is the Phase 5 tab preference item and ships separately.
4. **Period lock.** One `lockedThrough` date per tenant, refused at post and reverse time, with a
   time-limited exception row (who, why, until) written through a Command and audited.
5. **Opening balances.** One command that posts a single balanced opening entry dated the day before go-live.
6. **Bank.** `BankAccount` and `BankStatementLine` tables with RLS, CSV import reusing the CSV reader in
   `src/lib/settlement-match.ts`, manual match to payments, an unmatched list. Phase 2.

**Flagged, not designed:** (1) is a new cross-capability write path, so by `CLAUDE.md` stop conditions it
needs its own ADR first. Nothing else here needs one.

## 8. Acceptance

Rows of `docs/reference/module-completeness-bar.md` plus this walk-through with real D&S data:

1. Raise a sales invoice for J-0003, record a receipt, see the trial balance move by exactly those amounts.
2. Raise a credit note; the reversal appears and the original entry is unchanged.
3. Try to post into a locked period; it is refused with a plain reason.
4. Balance sheet balances (assets equal liabilities plus equity) and P&L matches job margin within rounding.
5. Run the whole flow at 390px and desktop, light and dark.
6. DB tests: posting is idempotent; RLS isolates tenants; a missing account mapping refuses to post.
