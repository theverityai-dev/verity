# Colonel Kebabz — expenses, cash, payments, platform reconciliation, finance dashboard and outlet P&L

Depth document for PRD §44–§49. Template sections 4–8 of
`docs/reference/client-reference-parity-template.md`. Written 2026-10-05 from source, not memory.

Source roots: `odoo:` = `D:\Code\R&D\odoo-19.0\addons\`, `erpnext:` = `D:\Code\R&D\erpnext\erpnext\`,
`verity:` = this repository.

## What the client asked for

- **§44 Expenses** by outlet managers: 12 categories (rent, electricity, gas, water, maintenance,
  cleaning, packaging, transport, marketing, repairs, salaries, miscellaneous); amount, outlet, vendor,
  date, payment method, receipt, approval status.
- **§45 Cash:** opening + cash sales − cash expenses − cash withdrawals = expected; compare with actual;
  variance needs an explanation.
- **§46 Payments:** cash, UPI, card, wallet, bank transfer, delivery platform, other; track settlement status.
- **§47 Delivery platform reconciliation:** gross order value, discounts, commission, taxes, packaging,
  other deductions, net settlement, settlement date; POS revenue vs platform settlement.
- **§48 HQ finance dashboard:** revenue, COGS, gross profit, food cost, labour cost, opex, outlet
  contribution, EBITDA proxy, receivables, payables, cash, platform settlements.
- **§49 Outlet P&L (estimated):** revenue − food cost − labour − rent − utilities − marketing − delivery
  commissions − other opex = operating contribution; accounting integration later.

## 4. How the reference systems serve it

### 4.1 Navigation

Odoo (`odoo:hr_expense/views/*.xml`, `odoo:account/views/account_menuitem.xml`):

```
Expenses     My Expenses · Management (expenses to approve, all) · Reporting (Expenses Analysis) ·
             Configuration (Expense Categories, settings)
Accounting   Dashboard (journals: sales, purchases, bank, cash) · Customers · Vendors ·
             Accounting (journal entries, items, analytic items) · Review / Control ·
             Reporting (P&L, balance sheet, partner reports, invoice analysis, analytic report) ·
             Configuration (accounts, taxes, journals, payment methods, analytic plans)
Point of Sale › Sessions   (cash control per register; see POS document)
```

ERPNext Accounts workspace (`erpnext:accounts/`): Journal Entry, Payment Entry, Expense Claim (now in
HRMS, not in source), **Cost Center** (one per outlet), POS Closing Entry, Bank Reconciliation Tool,
Payment Reconciliation; reports Profit and Loss Statement and Balance Sheet filterable by cost center,
Accounts Receivable/Payable, Cash Flow, General Ledger.

### 4.2 Pages

| Page | Sections / key fields | Buttons and actions (state change) | Source |
|---|---|---|---|
| Odoo expense | description, category, total, tax, employee, paid by (employee / company), date, receipt attachment, analytic distribution (outlet) | Submit (draft → submitted), Approve (→ approved), Refuse, Reset, Split Expense, Post Journal Entries (→ posted) | `odoo:hr_expense/views/hr_expense_views.xml`, `odoo:hr_expense/models/hr_expense.py` (states draft / submitted / approved / posted) |
| Odoo expense category | name, cost, account, taxes | create, edit | `odoo:hr_expense` (Expense Categories menu) |
| Odoo POS session closing | opening cash, cash sales, cash in/out with reason, expected, counted (coins/bills), difference posted | Close Session & Post Entries | `odoo:point_of_sale/views/pos_session_view.xml` |
| Odoo bank / cash journal | statement lines | Reconcile (match to invoices/payments) | `odoo:account` |
| Odoo analytic report | P&L per analytic account (one per outlet) | filter period, drill to items | `odoo:account` (Analytic Report menu) |
| ERPNext POS Closing Entry | per payment method expected vs closing amount, difference, taxes | submit, Retry | `erpnext:accounts/doctype/pos_closing_entry/` |
| ERPNext Payment Reconciliation | unreconciled payments vs invoices per party | Reconcile | `erpnext:accounts/doctype/payment_reconciliation/` |
| ERPNext P&L by cost center | income and expense accounts filtered to one outlet's cost center | filter, export | `erpnext:accounts/report/profit_and_loss_statement/` |

### 4.3 Workflows

- **Expense:** draft → submitted → approved / refused → posted (journal) → paid. Receipt photo can create
  the expense (OCR in Odoo Enterprise only).
- **Cash:** session opening count → sales, cash in/out with reason → closing count → difference posted
  with a note.
- **Platform settlement:** neither system has a Zomato/Swiggy connector; settlements are imported as bank
  statement lines and reconciled against receivables from the platform (partner).
- **Outlet P&L:** every revenue and cost line carries the outlet's analytic account (Odoo) or cost center
  (ERPNext); the P&L report filters by it.

### 4.4 Reports

P&L and balance sheet (overall and per outlet), expenses analysis by category and employee, cash
differences per session, receivables/payables ageing, cash flow.

### 4.5 Configuration

Chart of accounts, expense categories mapped to accounts, payment methods mapped to journals, analytic
accounts / cost centers per outlet, approval rules.

### 4.6 Automation

Expense approval routing to manager; session close posts entries; bank statement import and matching.

### 4.7 Roles

Odoo Expense: own expenses / team approver / all; Accounting: billing, accountant, adviser. ERPNext
Accounts User, Accounts Manager.

## 5. Verity today

Evidence: `verity:src/server/capabilities/finance/index.ts` (header lists what is not built: §47
platform reconciliation; labour cost excluded from P&L because no wage data exists; COGS approximate),
pages `/expenses` (`ExpenseBoard.tsx`), `/cash-reconciliation` (`CashReconciliationForm.tsx`),
`/outlet-pnl`. `/finance` (`FinanceDesk.tsx`) is the trading invoices desk (Shree Ganesh), not this
client's dashboard.

| Reference item | Verity equivalent | Status |
|---|---|---|
| Record expense with 12 PRD categories, outlet, vendor (text), date, payment method, receipt photo | `record_expense`; `/expenses` | Built |
| Approve / reject expense | `decide_expense` (Pending → Approved / Rejected); `/expenses` | Built (no reason on reject, no threshold) |
| Expense paid / posted state | none | Missing |
| Cash reconciliation: opening + cash sales − cash expenses − withdrawals, actual, variance needs explanation | `record_cash_reconciliation` (variance note enforced); `/cash-reconciliation` | Built |
| Cash in/out entries during the day with reason | single withdrawals figure | Partial |
| Payment methods cash / UPI / card / wallet / bank / platform / other | finance `PAYMENT_METHODS` has all 7; **dine-in bill payment accepts only cash, card, UPI** | Partial — inconsistent |
| Settlement status per payment (card/UPI/platform settled to bank) | none | Missing |
| Delivery platform reconciliation (§47) | not built (blocked on integration decision, per code) | Missing |
| Outlet P&L: revenue, COGS, expenses by category, contribution | `get_outlet_pnl`; `/outlet-pnl` | Built (estimate; COGS approximate; labour excluded) |
| Labour cost line | excluded (no wage data) | Missing |
| HQ finance dashboard across outlets | none | Missing |
| Receivables / payables | trading has them for Shree Ganesh; nothing for this client | Missing |
| Accounting journal, chart of accounts | `accounting` capability exists (registered, Task 72) | Not applicable now (PRD says integration later) |

## 6. Gap decisions

Decision owner: product owner (proposed by engineering 2026-10-05, not yet confirmed).

| Item | Decision | Reason |
|---|---|---|
| Bill payment methods aligned with finance list (add wallet, bank transfer, delivery platform, other) | **Include** | PRD §46; today a Zomato-paid order cannot be settled correctly |
| Reject expense with reason; approval only above an HQ threshold; Paid state with paid date | **Include** | PRD §44 approval status; managers should not wait for approval on ₹200 |
| Expense vendor picked from procurement vendors (or free text) | **Include** | ties expenses to vendor history once procurement lands |
| Cash in/out entries with reason during the day; reconciliation sums them | **Include** | PRD §45 "cash withdrawals"; one aggregate number hides who took what |
| Reconciliation tied to the register session (POS document) | **Include** | expected cash then comes from the same day's orders automatically |
| Settlement status for card / UPI / platform payments | **Include** | PRD §46 |
| Platform reconciliation by **upload** of Zomato/Swiggy settlement reports (CSV) matched to channel orders | **Include** | PRD §47 says "where APIs are available"; CSV first avoids blocking on API access |
| Platform reconciliation by API | Defer | integration decision and partner access |
| HQ finance dashboard (revenue, COGS, gross profit, food cost %, opex, outlet contribution, EBITDA proxy, cash, platform settlements) | **Include** | PRD §48; data exists in P&L, expenses, cash |
| Labour cost in P&L | **Include once salary storage is decided** (staff document) | PRD §49 line; meanwhile show "not configured", never a guessed number |
| Receivables / payables (corporate and catering orders, vendor bills) | Defer | appears with procurement bills and corporate channel orders |
| Full accounting (journals, chart of accounts, GST returns) | Defer | PRD §49 "allow actual accounting integration later" |

## 7. Verity design for this client

Inside `finance` and `dinein`; no new platform primitive.

1. **Payments:** bill payment methods = finance `PAYMENT_METHODS`; each non-cash payment carries
   settlement status (Pending, Settled, Disputed) and settlement date.
2. **Expenses:** add reject reason, HQ approval threshold (below it auto-approved), Paid state; vendor
   from vendor list or free text; list filters by outlet, category, status, period; totals; export.
3. **Cash:** cash in/out entries (amount, reason, who) through the day; closing reconciliation computes
   expected from session cash sales, cash expenses and cash out; variance note required.
4. **Platform reconciliation** `/finance/platforms`: upload a Zomato or Swiggy settlement file (column
   mapping saved per platform); rows matched to channel orders by platform order reference; shows gross,
   discounts, commission, taxes, packaging, deductions, net, settlement date; unmatched and mismatched
   rows flagged; matched payments marked Settled.
5. **HQ finance dashboard** `/finance/overview`: period and outlet filters; tiles and a trend for each
   §48 measure; outlet comparison table; links to P&L, expenses, cash and platform pages.
6. **Outlet P&L:** add delivery commissions (from platform reconciliation) and labour (once salary is
   configured), expense lines grouped as the PRD lists; keep the "estimate" and approximate-COGS labels.

Open decisions: expense approval threshold; who may record cash out.

## 8. Acceptance

Module completeness bar (`docs/reference/module-completeness-bar.md`), plus live walk-through:
1. Settle a Zomato order with payment method Delivery platform; its settlement status is Pending.
2. Record a ₹350 gas expense (auto-approved) and a ₹25,000 repair (waits for HQ; reject with reason;
   re-submit; approve; mark paid).
3. Record ₹2,000 cash out for supplies with reason; close the day; expected cash includes it; enter actual
   ₹50 short with a note.
4. Upload a Zomato weekly settlement file; orders match; commission and net settlement shown; the Zomato
   payment becomes Settled; one unmatched row is flagged.
5. HQ dashboard shows revenue, food cost %, opex, outlet contribution and platform settlements for the
   week by outlet; Defence Colony P&L shows delivery commissions.
