# Task Plan 52 — Period Close, Reports (Slice 7)

**Program:** `45_plywood_workflow_program.md`. **Slice 7 of 7.**
**Closes:** audit **P0-08** and the remainder of **P0-10**.
Delivers specification §73, §76, §77.

---

## 1. The close, and why the lock is the load-bearing half

`PlywoodAccountingPeriod` — a calendar month, open or closed, with who closed
it and when, and who reopened it, when, and **why**.

The checklist is the visible half. The lock is what matters: a close is the
moment a business says *"this is what happened in August"*, and it only means
anything if the answer then stops changing. Before this, a backdated receipt,
invoice, payment or correction could alter a month that had already been
reviewed, reported and filed, and nothing recorded that it had.

`assertPeriodOpen` is called by every posting path: sales invoices, purchase
invoices, credit and debit notes, and **every stock movement**. A function
rather than a database trigger, deliberately — the refusal needs to name the
period and say what to do instead, and a trigger can only refuse.

**A period that does not exist is open.** Periods are created by being closed,
so a business that has never closed anything is never blocked, and the first
close is what creates the boundary.

**A calendar month**, because the GST return period is a month and the close
exists so a return can be filed against documents that will not move afterwards.

---

## 2. The checklist names counts, not statuses

Specification §76. `3 × Supplier invoices with no tax split` is something a
person can go and do; *"not ready"* is not, and it is why month-end screens get
ignored.

Four blockers, and one of them is about something **missing** rather than
something wrong: an order fulfilled in the period with no invoice raised is
revenue sitting outside the month it belongs to.

**Forcing is possible and explicit.** Some blockers are genuinely acceptable — a
supplier who will never send a tax invoice — and a close that could never happen
would simply be worked around by not closing at all. The override records how
many items were accepted.

---

## 3. Reopening is authorised, reasoned and recorded

The reason is required by the command **and** by a CHECK constraint, because
reopening a filed period without a stated reason *is* the audit finding. It
travels on the domain event too, so an operational audit shows why a reported
month was opened again without a second lookup.

---

## 4. Reports stop answering a restaurant's question

The old page called `salesSummary` from the **dine-in** capability and described
a restaurant's daily takings. On a plywood tenant it returned nothing or
returned another capability's data. That is audit P0-10, and the clearest
example in this codebase of a screen that looks finished while answering a
different business's question.

The replacement reports trade, inventory, money, margin, tax and close
readiness — and **every figure is the same figure the desk that owns it shows**.
Nothing on the page computes its own version of a number, because two
definitions of "receivables" is how a report and a ledger disagree in front of a
customer.

Each section is fetched independently and each permission failure is swallowed
separately, so a reader who may see stock but not money gets the stock report
rather than a permission error for the whole page — the composition rule the
audit asks for on the Overview, applied here too.

---

## 5. Files

```text
prisma/migrations/20260831180000_plywood_accounting_period/   period, constraints, RLS
src/server/capabilities/plywood/period.ts                     NEW — lock, checklist, close, reopen
src/server/capabilities/plywood/{finance,stock}.ts            assertPeriodOpen on every posting path
src/app/(shell)/tax/close/                                    NEW screen
src/app/(shell)/reports/page.tsx                              rewritten for this business
src/test/plywood-period-close.test.ts                          NEW, 9 tests
```

Deleted: `reports/DayPicker.tsx` — a day picker for a restaurant's service day.

---

## 6. Evidence

```text
Tests  781 passed | 4 skipped (785)
```

Suite 776 → 785. `tsc --noEmit` clean.

The lock is proven three ways: a stock movement into a closed period is
refused, an invoice into a closed period is refused, and the refusal message is
asserted to tell the user how to proceed.

---

## 7. Still open

*   **Notifications** (§72). Only the low-stock one exists, and it is triggered
    off a stock-ledger permission rather than a procurement activity. Credit,
    match, payment, tax and close notifications are not built.
*   **Operational audit** (§78). Domain events carry the correlation id from
    Task 38, but the Audit page still shows raw UUIDs and command keys rather
    than actor, business action, reason and document number.
*   **Drill-down** (§74). Reports link to desks; they do not yet carry a filter
    through to a filtered list.
*   **Reopen does not re-run the checklist.** Reopening a period lets postings
    in again; it does not currently re-evaluate what has changed since the
    close, which a second close would want to show as a diff.
