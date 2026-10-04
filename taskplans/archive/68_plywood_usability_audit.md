# Task 68 — Plywood usability audit (hands-on)

Conducted 2026-09-01 by driving the running application as a plywood client
would, against the real tenant **Shri Ganesh Timber Trading Co.** (populated:
8 boards, 2 godowns, 2 suppliers, 1 customer, ₹16.27L of stock).

**No production code was changed.** This is observation only.

Severity: **U0** loses money or misfiles a return · **U1** blocks or misleads a
user mid-task · **U2** friction · **U3** polish.

---

## U0-1 · An order can be approved that is impossible to fulfil

**Reproduced.** New sales order → customer *Shree Ji*, godown *Krishna Nagar*,
board *Century MR Commercial Plywood 19mm*, 40 sheets. The order was created and
**Approved**. Krishna Nagar holds **zero** of that board; the 150 sheets the
business owns are in Okhla.

The failure only appears at *Hold stock*, and says:

> `E_VALIDATION: Century MR Commercial Plywood 19mm has 0 available, cannot hold 40`

Two compounding problems:

1. **The salesperson has already told the customer yes.** Approval is the moment
   the business commits; discovering unfulfillability afterwards is discovering
   it too late.
2. **The message says "0 available" and stops.** The actionable fact — *there
   are 150 in Okhla Storage Depot* — is never shown. The salesperson concludes
   there is no stock and declines an order the business could have filled from
   the other godown.

The board dropdown shows no availability, and the godown is chosen *before* the
board with no feedback linking the two.

## U0-2 · An order with an unrecognised state is invisible but still spends credit

`SO-2026-GANESH-01`, worth **₹82,500**, has state `Processing`. The UI knows
`draft · pending_credit · approved · dispatching · completed · cancelled`.
`Processing` matches none, so `openOrders` filters it out.

**It appears on no screen.** Yet the customer's *Committed* figure includes it,
so ₹82,500 of a ₹10L credit limit is consumed by an order nobody can see, open,
reserve, invoice or cancel. The only way to find it is to query the database.

A state vocabulary that silently drops unknown values fails in the direction
that hides work. Rendering the raw key would at least be visible.

## U0-3 · Period boundaries are computed in UTC for a tenant in Asia/Kolkata

The tenant's `time_zone` is `Asia/Kolkata`. Every period boundary in the
capability is UTC:

- `finance.ts` — `date_trunc('month', now())`, `date_trunc('day', now())` ×6
- `period.ts` — `new Date(Date.UTC(year, month - 1, 1))`

**Observed:** at 01:55 IST on **1 September**, the Tax & Compliance screen reads
**"August 2026"** and shows August's figures.

Consequences, in ascending seriousness:

- "Today's sales" and "Collections today" show *yesterday's* numbers every day
  until 05:30 IST — the first ninety minutes of a working day for anyone opening
  the shop early.
- Month-end close can be performed on 1 September IST while the system still
  considers it August.
- **An invoice raised between 00:00 and 05:30 IST on the 1st is stamped into the
  previous month's GST period.** That is a filing error with a paper trail.

The platform already solves this: `temporal.ts` resolves a zone
organization → tenant → UTC and validates it on write. **The plywood capability
never imports it.** The mechanism exists and is bypassed.

## U0-4 · The Receive form does not say what was ordered *(user-reported, confirmed and worse)*

On `/purchases`, clicking **Receive** on an order opens a form containing:

- a **"Board delivered"** dropdown listing **all 8 catalogue boards**, not the
  boards on that order;
- a bare Quantity field.

It does **not** name the supplier, the order, the ordered quantity, or what
remains. Clicking Receive on row 1 and row 2 produces visually identical forms,
rendered at the bottom of the page far from the row clicked.

So a warehouse user must remember which board a given order was for, and there
is no feedback if they pick wrong beyond a later refusal. With two orders both
reading "Part delivered" and nothing distinguishing them, receiving against the
wrong order is easy and silent.

The dropdown also offers **"Custom Log Sawing & Sizing Service"** — a service,
which cannot be received as stock.

**The order detail page does this correctly**: it names the board, seeds the
outstanding quantity, and shows ordered/received/remaining. The defect is that
the desk offers a faster path that is strictly worse.

## U1-1 · A page contradicts itself about whether goods arrived

`/purchases/462e7714…` simultaneously shows:

- **Received 250**, line reading **250 / 300**, three-way match "Received 250
  sheets"
- **Receipts — "Nothing received yet"**

Both are on screen at once. Whatever the cause, a user cannot tell which is
true, and the panel that looks most authoritative is the wrong one.

## U1-2 · The three-way match reports an expected difference as a difference

The same order shows **"Quantity difference: 50 short"** and **"Value
difference: ₹20,000"**. The value difference is *entirely explained* by the 50
sheets not yet delivered — it is arithmetic, not a discrepancy.

Presented flat, it reads as an exception, and an accountant will chase a
supplier who has done nothing wrong. §29 wants genuine mismatches surfaced;
this surfaces the expected case with equal weight.

## U1-3 · A validation error wipes the entire form

Submitting the new sales order without a price is refused — and **all five
fields reset** to "Choose a…". Customer, godown, board, quantity and reference
all lost.

The refusal is correct. Losing the input is not, and on a longer order it turns
one mistake into a full re-entry.

## U1-4 · Cancel silently did nothing

Clicking **Cancel** on the open order produced no error and no change: the order
remained `approved` in the database and on screen. The user has no way to know
the action failed.

## U1-5 · Error banners persist across later actions

After the failed reservation, the banner *"That was refused — Century MR
Commercial Plywood 19mm has 0 available"* remained visible while I cancelled,
reopened the form and submitted again. A user will read a stale error and
believe their new action failed.

## U1-6 · Internal error codes are shown to users

Verbatim on screen: `E_VALIDATION: no price for Century MR Commercial Plywood
19mm for this customer, and none given`.

The sentence after the colon is good. `E_VALIDATION:` is platform vocabulary,
which §0 forbids showing a client. The follow-up — *"Retrying will not help
until something changes"* — is true and unhelpful: it does not say what.

## U1-7 · An order can hold only one board

The new-order form takes one board and one quantity. A real order is "40 sheets
of this and 20 of that", and today that requires two separate orders, two
reservations, two goods issues and two invoices for one commercial transaction.

The underlying command already accepts `lines[]`. Only the form is single-line.

## U1-8 · The agreed price is never shown before submitting

The price field says *"Blank uses their price"* but never displays what that
price is. When no agreed price exists, the user learns only by submitting and
being refused. §38 expects the customer's price to prefill visibly.

## U1-9 · ~~Sign-in failed with no message~~ — **WITHDRAWN, not a defect**

Re-tested deliberately during remediation: submitting a wrong password renders
*"Those credentials were not accepted."* in an `alert` region, exactly as it
should, with no account-enumeration leak.

The original observation was mine, not the app's — I read the page snapshot
before React had committed the state update, and my search pattern missed the
rendered text. Recorded rather than quietly deleted, because an audit that only
ever accumulates findings is one nobody can trust the count of.

## U2-1 · Orders have no human-readable reference anywhere

The detail page is titled **"Purchase order 462e7714"** — a UUID fragment.
Order lists identify a row by supplier or customer name alone.

The new-order form *captures* a Reference and it is **never displayed** — I
entered `AUDIT-SO-1` and it appears on no screen. Two orders to the same
supplier are indistinguishable in the list.

Invoices get proper numbers (`PURCHASE/2026-27/0002`); orders do not.

## U2-2 · Order lists omit what the order is for

`/purchases` Open orders columns: **Supplier · State · Outstanding · Order
value**. `/sales`: **Customer · State · Order value**.

Neither shows the board, the quantity, the date raised, or the expected date.
This is the root of U0-4: the list cannot tell you what an order is for, so the
Receive form cannot either.

## U2-3 · "Outstanding: 50" has no unit

Sitting beside "Order value ₹90,000", the bare `50` reads as money. It is
sheets.

## U2-4 · "State" means two different things in adjacent tables

On `/purchases`: the Open orders table's **State** column shows `Part
delivered`; the Suppliers table immediately below has a **State** column showing
`11` and `27` — GST state codes. Same word, same screen, two meanings, neither
labelled.

## U2-5 · One action, several names

| Action | `/sales` desk | Order detail | Specification |
|---|---|---|---|
| Reserve | **Hold stock** | **Reserve stock** | Reserve Stock |

Also **Committed** (`/sales`) vs **Exposure** (`/customers`) for the same
figure, and **Stop trading** (brand) vs **Withdraw** (board) for the same idea.

## U2-6 · Services appear in board dropdowns

*Custom Log Sawing & Sizing Service* and *Hettich Soft-Close Hinge* appear in
dropdowns labelled **"Board"** in both the receive and sales-order forms. A
service cannot be received into a godown.

## U2-7 · Customer names are not links on the sales desk

In the Customers table on `/sales`, the name is plain text. On `/customers` it
is a link. §71 asks that entity names be clickable; this one is a dead end on
the screen where a salesperson most needs the credit history.

## U3-1 · "Audit" appears twice in the sidebar

Both entries point at `/audit`. One comes from the plywood contribution
(`index.ts:723`), the other from the shell (`layout.tsx:148`).

This produces a **React duplicate-key error** in the console on every render.

## U3-2 · Platform vocabulary is visible to the client

The sidebar shows a **Platform** group (Overview, Workspace) and a
**Capabilities** group (Approvals) alongside the business navigation — and
therefore **two entries called "Overview"** pointing at different pages. §0
lists exactly this as what a normal client must not see.

## U3-3 · The owner lands on the platform overview

Signing in lands on `/`, whose heading is *"Overview — The platform's current
state in this organization"*, showing **Locations** and **Assets** counts. The
business overview is a different page at `/overview`.

The role-aware landing added in Task 63 deliberately returns null for an
owner — but the page it leaves them on is the platform's, not the business's.
The owner is the primary user and lands furthest from their work.

---

## What is genuinely good

Worth recording, because a list of only defects misrepresents the app.

- **Order and product detail pages are excellent** — the three-way match, the
  ordered/received/remaining band, Related sections and working drill-downs.
- **Explanatory copy is unusually good.** "Receiving against an order moves the
  stock in the same step — there is no separate goods-received entry to forget"
  teaches the model while the user works.
- **Credit headroom** is shown as headroom, not as a limit the reader must
  subtract from.
- **Refusals are correct even when their presentation is not** — the app
  refused an unfulfillable reservation, a missing price, and an over-receipt.
  The logic is sound; the interface around it is what fails.

## Suggested order of work

1. **U0-3** timezone — silent, ongoing, affects filings. One fix, wide blast
   radius.
2. **U0-1** availability at order time, and name the godown that has stock.
3. **U0-2** unknown states must be visible, not filtered away.
4. **U0-4 + U2-1 + U2-2** order identity: give orders a number, show the board
   in the list, scope the receive form to the order.
5. **U1-3, U1-4, U1-5** form state, silent failure, stale banners — cheap, and
   they are what makes the app feel unreliable.
6. Everything else.

---

## Data created during this audit

- `AUDIT-SO-1` — sales order, Shree Ji Interior Decorators, 40 × Century MR
  Commercial Plywood 19mm, ₹60,000, state `approved`, **not cancelled** (the
  Cancel button did nothing — U1-4). Nothing is reserved against it.
- No other records were created. Nothing was deleted or edited.
