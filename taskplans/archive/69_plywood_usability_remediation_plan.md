# Task 69 — Plywood usability remediation: the plan

Fixes every finding in `taskplans/68_plywood_usability_audit.md`.

Written before any code was changed, and executed autonomously afterwards. The
user authorised proceeding without interview or approval.

## 0. Rules for this pass

1. **Refinement, not redesign.** The incumbent visual system is the authority.
   No new visual world, no restyling of anything that is not a listed finding.
   ADR-011/ADR-012 continue to govern material and accent.
2. **Fix the cause, not the symptom.** Where a finding has a shared root — order
   identity, period boundaries — fix the root once rather than patching each
   screen.
3. **No new platform primitive.** Everything here is capability or UI work. The
   one platform-shaped need (zone-correct period boundaries) is already solved
   by `temporal.ts`; the fix is to *use* it.
4. **Every behavioural change gets a test** where a test can express it.
5. **One commit per finding group**, in the audit's own priority order, each
   independently revertible.

## 1. Sequencing, and why this order

Ordered so that shared foundations land before the screens that consume them,
and so the highest-cost-of-delay defects are fixed first.

| # | Commit | Findings | Depends on |
|---|---|---|---|
| 1 | Business-zone period boundaries | U0-3 | — |
| 2 | Unknown states stay visible | U0-2 | — |
| 3 | Order identity: numbers, and lists that say what an order is for | U2-1, U2-2, U2-3 | — |
| 4 | Receive against a named order, scoped to its lines | U0-4, U2-6 | 3 |
| 5 | Availability before promising; a reservation error that names the godown | U0-1, U1-8 | — |
| 6 | Multi-line orders | U1-7 | 3 |
| 7 | Form state, silent cancel, stale banners | U1-3, U1-4, U1-5 | — |
| 8 | Human error messages; sign-in failure visible | U1-6, U1-9 | — |
| 9 | Receipts contradiction; explained match differences | U1-1, U1-2 | — |
| 10 | Vocabulary, units, ambiguous columns, dead links | U2-4, U2-5, U2-7 | — |
| 11 | Navigation: duplicate Audit, platform leak, owner landing | U3-1, U3-2, U3-3 | — |

---

## 2. Commit 1 — Business-zone period boundaries (U0-3)

**Root cause.** Every period boundary is computed in UTC while the tenant
reckons in `Asia/Kolkata`. `temporal.ts` already resolves a zone
(organization → tenant → UTC) and is never imported by the capability.

**New module** `src/server/capabilities/plywood/clock.ts`:

- `businessZone(ctx)` → `effectiveTimeZone(ctx.tx, ctx.actor.organizationId)`.
- `startOfBusinessMonth(zone, at?)` and `startOfBusinessDay(zone, at?)` →
  `Date`, computed with `Intl.DateTimeFormat` parts so DST is the tz database's
  problem, not ours.
- `businessPeriodKey(zone, at?)` → `YYYY-MM` in the business's own month.

**SQL sites** (`finance.ts` `ownerConsole`, six occurrences). Replace
`date_trunc('month', now())` with the zone-correct idiom, parameterised:

```sql
date_trunc('month', now() AT TIME ZONE ${zone}) AT TIME ZONE ${zone}
```

The inner conversion yields the local wall clock; `date_trunc` cuts on the local
boundary; the outer conversion returns to an absolute instant. Both directions
are needed — one alone silently shifts by the offset.

**JS sites.** `period.ts` `periodKeyOf` (UTC getters), `closePeriod` and
`reopenPeriod` (`Date.UTC` bounds); `tax.ts` `taxSummary`, `gstr1Working`,
`gstr3bWorking` defaults; `reports.ts` `windowStart`; `itc.ts` period bounds.

**Signature change.** `periodKeyOf(instant)` becomes zone-aware, so callers must
pass a zone. Every caller is inside the capability.

**Test.** A tenant in `Asia/Kolkata`, an instant at 01:00 IST on the 1st:
`businessPeriodKey` must return the new month, not the previous one, and
`startOfBusinessDay` must be 00:00 IST rather than 05:30.

**Deliberately not changed.** Stored instants stay UTC. This is about where a
boundary falls, never about how a moment is recorded.

## 3. Commit 2 — Unknown states stay visible (U0-2)

**Root cause.** `openOrders` filters `state: { in: [...] }` against a hard-coded
list, so a row whose state is not in the list vanishes from every screen while
still counting toward credit exposure.

**Fix.** Invert the predicate: select orders **not in the terminal set**
(`completed`, `cancelled`) rather than in the known-open set. An unrecognised
state is then treated as open — visible, actionable, and countable — which is
the safe direction. A record the business cannot see is worse than one labelled
oddly.

`present()` already falls through to the raw key, so `Processing` renders as
"Processing" with a neutral badge rather than crashing or disappearing.

**Also.** Add a conformance test asserting every distinct `state` value in
`plywood_sales_order` / `plywood_purchase_order` is one the UI maps, so drift is
caught by the suite rather than by a customer.

## 4. Commit 3 — Order identity (U2-1, U2-2, U2-3)

**Root cause.** Orders have a nullable free-text `reference` and no document
number, so lists identify a row by party name alone and the detail page falls
back to a UUID fragment.

**Fix, three parts.**

1. **Number every order on creation.** `finance.ts` already has
   `nextDocumentNumber(tx, tenantId, seriesKey, financialYear)` — the same
   gapless counter invoices use. `createPurchaseOrder` and `createSalesOrder`
   populate `reference` with `PO/2026-27/0001` and `SO/2026-27/0001` when the
   user supplies none. A user-supplied reference is preserved: theirs is more
   meaningful than ours.
   *No migration* — `reference` already exists and is nullable.
2. **Show it.** Detail page titles use the reference; lists gain a **Reference**
   column.
3. **Say what the order is for.** `openOrders` returns a line summary
   (`"Century MR 19mm"`, or `"Century MR 19mm +2 more"`) and total units; the
   list gains **Board** and **Ordered** columns and a **Raised** date.
   `Outstanding` becomes `Outstanding (sheets)`.

## 5. Commit 4 — Receive against a named order (U0-4, U2-6)

**Root cause.** The desk's receive form is order-agnostic: a dropdown of every
board in the catalogue and a bare quantity, with nothing naming the order.

**Fix.** Replace the desk's inline form with the same shape the detail page
already uses, scoped to the order:

- Heading names the order and supplier: *"Receive against PO/2026-27/0004 —
  Divyom Sharma"*.
- One row per **order line only**, each labelled with the board and
  *ordered / received / remaining*, pre-filled with the remaining quantity.
- Services are excluded — the receive path is for physical stock.
- The form renders adjacent to the row it was opened from, not at page bottom.

`openOrders` already needs line data for commit 3, so this reuses it.

## 6. Commit 5 — Availability before promising (U0-1, U1-8)

**Root cause.** Nothing tells a salesperson what is available in the chosen
godown, or what the customer's agreed price is, until after submission.

**Fix, two parts.**

1. **Show availability in the order form.** When a godown is chosen, each board
   option carries its available quantity in that godown, and boards with none
   are marked. A new query `sellableStock({ locationId })` returns
   product → available for the actor's reachable godowns.
2. **Name where the stock is.** When a reservation is refused, the message says
   where the sheets actually are:
   *"Krishna Nagar Sawmill & Shop has 0 available. Okhla Storage Depot has
   150."* This is the difference between a salesperson declining an order and
   filling it from the other godown.
3. **Show the agreed price.** Selecting customer + board fills the price field
   with their agreed price and labels it as such; when none exists the field is
   marked required *before* submission rather than refusing afterwards.

## 7. Commit 6 — Multi-line orders (U1-7)

**Root cause.** The command accepts `lines[]`; the form offers one.

**Fix.** Both order forms take repeatable lines — add and remove a row, each
with board, quantity and price, with a running order total. Purchase orders
gain the same treatment for symmetry.

## 8. Commit 7 — Form state, silent cancel, stale banners (U1-3, U1-4, U1-5)

- **Preserve input on failure.** The desks reset local form state after a failed
  action. Refused input must survive so the user corrects one field rather than
  re-entering five.
- **Cancel must report.** Investigate why cancelling an `approved` order was a
  no-op; either surface the refusal or fix the guard. Whatever the cause, a
  button that does nothing silently is the defect.
- **Clear stale banners.** Any new action clears the previous failure before it
  runs, so a banner never describes an action two steps back.

## 9. Commit 8 — Human error messages (U1-6, U1-9)

- **Strip the code.** `E_VALIDATION:` / `E_FORBIDDEN:` prefixes are removed at
  the presentation boundary. The code stays in the log and the audit trail,
  where it is useful; it leaves the screen, where it is noise.
- **Say what to do.** Replace "Retrying will not help until something changes"
  with the specific next step where the failure is known.
- **Sign-in must speak.** The failure path renders no message; it gets the same
  `ErrorState` every other refusal uses.

## 10. Commit 9 — Receipts and match differences (U1-1, U1-2)

- **Receipts contradiction.** Where `qtyReceived > 0` but no `PlywoodGoodsReceipt`
  rows exist, the panel must say so — *"250 sheets recorded against this order
  before goods receipts were documented"* — rather than "Nothing received yet"
  beside a "Received 250" figure.
- **Explained differences.** The three-way match computes the value difference
  *expected* from short delivery and reports the residual. A difference fully
  explained by quantity reads "Matched, allowing for 50 sheets not delivered";
  only an unexplained residual is flagged.

## 11. Commit 10 — Vocabulary, units, columns, links (U2-4, U2-5, U2-7)

- **"State" disambiguated.** Order tables keep *Status*; the supplier/customer
  tables' GST column becomes *GST state*.
- **One name per action.** *Reserve stock* everywhere (matches the
  specification). *Exposure* everywhere for the credit figure. *Withdraw* for
  both brand and board.
- **Units on quantities.** `Outstanding` → `Outstanding (sheets)`.
- **Names are links.** The customer name on the sales desk links to the customer.

## 12. Commit 11 — Navigation (U3-1, U3-2, U3-3)

- **Duplicate Audit.** The plywood contribution and the shell both add it. The
  capability's entry is the one with the right group and ordering, so the shell
  stops adding its own when a capability already contributes that href.
- **Platform vocabulary.** The shell's *Platform* and *Capabilities* groups are
  hidden from a non-platform tenant, resolving the two-Overview confusion.
- **Owner landing.** An owner in a plywood tenant lands on `/overview`, the
  business overview, rather than the platform's. `landingRouteFor` returns
  `/overview` for the owner case instead of null.

## 13. Verification

After each commit: `npm run typecheck`, then the touched tests.

At the end, in one batched pass: full suite, `npm run build`, and a hands-on
re-drive of the three flows that produced U0 findings — order → reserve → issue,
purchase → receive, and the tax period boundary — plus the mechanical design
detector over every changed UI file. One round of fixes from what that shows,
one confirming round, then stop.

## 14. Out of scope

- The pre-existing `Processing` order's state value is data, not code. Commit 2
  makes it visible; it is not rewritten.
- `AUDIT-SO-1`, created during the audit, is cancelled once commit 7 makes
  cancellation work.
- No CSP, no rate-limiter changes, no telemetry changes — Phase 10A closed
  those and this pass does not reopen them.
