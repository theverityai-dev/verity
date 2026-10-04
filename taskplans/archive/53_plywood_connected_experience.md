# Task 53 — Plywood Connected Experience (program)

Authority: product-owner target user flow, 84 sections, supplied 2026-08-31.
Predecessor: `taskplans/45_plywood_workflow_program.md` (slices 1–7, Tasks 45–52),
which closed the ten release-blocking P0 findings of
`PLYWOOD_TARGET_WORKFLOW_GAP_AUDIT.md`.

## 1. What this program is, and what it is not

Slices 1–7 built the **write path**: 36 commands, 23 queries, effective-dated tax
rules, period close, returns and notes, weighted-average cost, credit exposure,
reservation and goods issue. Those are correct and tested.

What they did **not** build is the thing the target flow is actually about:

> A business fact is entered once. Every affected screen updates automatically.

The facts already propagate — the projections are derived, not stored. What is
missing is the **screens that show the propagation**, and the links that let a
person walk from a number to the record that caused it. Today a client can
record a goods issue but cannot open the sales order it belongs to, cannot open
the customer, cannot see the movement ledger that explains an on-hand figure.

So this program is a **surface program**. It adds detail routes, Related
sections, cross-links, role-shaped navigation and the accountant's tax
projections. It adds backend only where a screen the specification names has no
query to stand on.

**Non-goals.** No Logistics, Shipment or Delivery concept — the specification
removes them outright, and §45 is explicit that material leaving the godown is a
Goods Issue and nothing more. No new platform primitive. No client-specific fork
of a reusable capability.

## 2. The rule this program is measured against

§84 gives the acceptance standard, and it is a user-experience standard, not a
feature checklist:

> The user should never think "Where do I enter this again?"
> They should think "I recorded what happened. Verity knows the consequences."

Concretely, a slice is done when, for the records it touches:

1. Every entity name rendered on a screen is a link to that entity (§71).
2. Every detail screen carries a **Related** section naming its neighbours (§70).
3. Every aggregate number drills to the records that compose it (§7, §74).
4. Nothing on a projection screen is hand-entered (§8).
5. No screen shows a platform-internal name — no permission verbs, no
   configuration keys, no entity keys (§0, §6).

## 3. Canonical relationships — frozen, restated from slice 1

These already hold in the write path. Every screen this program adds must render
them and must never recompute them differently.

```
available   = on_hand - reserved
exposure    = unallocated_receivables + approved_uninvoiced_commitments
on_hand     = sum(stock movements)          -- never hand-edited (§9, §64)
avg_cost    = weighted average over receipts (§27)
```

A purchase order is **not** a payable (§20, §54). A sales order is **not** a
receivable (§39). Commercial commitments are shown to the accountant in their
own section, next to the financial ledger and never inside it (§54).

## 4. Slices

Each slice is one commit, one taskplan, one working flow end to end.

| Slice | Task | Delivers | Specification sections |
|---|---|---|---|
| 8 | 54 | Party workspaces: `/suppliers`, `/suppliers/[id]`, `/customers`, `/customers/[id]` — tabbed operating accounts with pricing, orders, invoices, payments, ledger | 14, 15, 16, 34, 35, 36, 55, 56 |
| 9 | 55 | Inventory drill-down: `/catalogue/[productId]`, `/godowns/[id]`, stock movement ledger | 10, 11, 12, 13, 17, 64, 65 |
| 10 | 56 | Order lifecycle screens: `/purchases/[orderId]`, `/sales/[orderId]`, Related sections, cross-links everywhere | 18–26, 37–48, 68–71 |
| 11 | 57 | Accountant's tax centre: `/tax`, `/settings/tax`, GSTR-1, GSTR-3B, ITC reconciliation, exceptions | 5, 29, 30, 58–63, 75 |
| 12 | 58 | People & roles in business language: `/people`, `/roles` | 1, 6 |
| 13 | 59 | Onboarding checklist, actionable notifications, readable audit | 2, 3, 72, 78 |

## 5. Navigation, frozen

§0 fixes the client's navigation. Order values leave gaps so a later slice drops
in without renumbering.

```
Overview                  /overview

TRADE
  Catalogue               /catalogue
  Suppliers               /suppliers
  Purchases               /purchases
  Customers               /customers
  Sales                   /sales

INVENTORY
  Stock                   /stock
  Godowns                 /godowns

MONEY
  Finance                 /finance
  Ledgers                 /ledgers
  Tax & Compliance        /tax

INSIGHTS
  Reports                 /reports

ADMINISTRATION
  People & Roles          /people
  Business Settings       /settings/business
  Audit                   /audit
```

Never shown to a normal client: Capability Registry, Configuration keys, generic
Locations, generic Assets, platform operator settings, permission verbs, entity
keys. Those are foundation vocabulary and a client seeing them is the platform
leaking into the product.

## 6. Where backend work is genuinely required

The surface is the point, so backend is added only where a named screen has
nothing to read. Anticipated:

- `supplierDetail`, `customerDetail` — one round trip per party workspace
  (slice 8).
- `productDetail`, `godownDetail`, `stockLedger` (slice 9).
- Purchase invoice **tax lines and ITC** — slice 6 built output tax only; §30
  and §62 need input tax as a first-class fact, not a report-time inference
  (slice 11).
- `gstr3bWorking`, `itcReconciliation`, `taxExceptions` (slice 11).
- Business-activity to permission mapping for the role editor (slice 12).

Anything else discovered mid-slice is recorded here before it is written.

## 7. Stop conditions

Escalate rather than improvise if: a screen needs a fact no command records; the
specification and an accepted ADR disagree; a projection would require storing a
derived value; a client-visible screen cannot be built without exposing platform
vocabulary.

---

## 8. Delivery record

Slices 8–14 delivered as Tasks 54–60, one commit each.

### Routes added

```
/suppliers            /suppliers/[supplierId]
/customers            /customers/[customerId]
/catalogue/[productId]
/godowns/[locationId]
/stock/[productId]            (?godown= to scope it)
/purchases/[orderId]  /sales/[orderId]
/tax  /tax/gstr-1  /tax/gstr-3b  /tax/exceptions
/settings/tax
/people  /roles
```

### Defects found and fixed while building

Each was found by trying to render a screen the specification asked for, which
is the argument for building the screens: none of these were visible from the
write path alone.

| Severity | Defect |
|---|---|
| P0 | `listCustomers` used a second definition of exposure — open orders only. It ignored invoiced-and-unpaid money and counted drafts, on the screen a sales manager decides the next order from. |
| P0 | `productMovements` had no godown row scope, so a warehouse operator restricted to one godown could read every godown's movement history. |
| P0 | Purchase invoices stored no tax split, so **input credit was structurally always nil** and the net GST estimate overstated what was payable by the entire input side. |
| P1 | `ownerConsole` read stock tenant-wide, so a godown-scoped role saw the whole business's inventory value on its home screen. |
| P1 | The configuration page had no authorization check; any authenticated member could read every configuration key by URL. |
| P2 | Four navigation icons did not exist, so four client nav items drew no glyph. |
| P2 | `authorization-layers.test.ts` went permanently red on any database it did not exclusively own, after a crashed run left an activation behind. |

### Section coverage

**Implemented:** 0 (navigation), 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35,
36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 51, 52, 53, 54, 55, 56, 57,
58, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 76, 77, 78, 79, 80, 81, 82,
83, 84.

**Not implemented, with the reason:**

- **§59 — ITC reconciliation.** Escalated as **missing specification** in
  taskplans/57 §5. Every bucket compares against GSTR-2B and this system has no
  import path for it; the specification does not say how portal data arrives,
  and that choice has security consequences. A screen built against absent data
  would report every invoice as "missing in GST" and look like a finding.
- **§60 — accountant's purchase review as its own screen.** The three-way match
  it describes is on the purchase order (§29), and `purchaseMatch` exists. What
  is missing is only the queue that lists every invoice needing review.
- **§49/§50 — raising an invoice from the order.** The order pages link to
  Finance rather than carrying the form. The invoice needs §50's tax checks, and
  building half of them on the order would put the same rules in two places.
- **§73 — reports.** `/reports` exists with margin and ageing. The
  specification's fuller set (by salesperson, supplier price trends, stock
  ageing, damage and adjustment reports) is not built.
- **§1 — a default landing screen per role.** Navigation already filters by
  permission, so this is a convenience rather than a control. Deferred.
- **§0, partially — generic Locations and Assets.** Still visible to a client
  whose tenant has those capabilities activated. Hiding them is not a plywood
  decision to take unilaterally: `/locations` is where godowns are created, and
  onboarding step 3 depends on it. Needs a decision about whether a shared
  capability can be presented under a pack's own vocabulary.

### The standard §84 sets

> "I recorded what happened. Verity knows the consequences."

§74's worked drill-down now runs end to end: receivables → an invoice → its
sales order → the goods issue → the movement ledger, each hop a link that
exists. That was the point of the program.


---

## 9. Closeout — the deferred list is empty

Slices 15–18 (Tasks 61–64) cleared every item §8 listed as not implemented.

| § | Was | Now |
|---|---|---|
| 49, 50 | Deferred — "the tax checks would end up in two places" | Built. The reasoning was wrong: `raiseSalesInvoice` takes only an order id and every §50 check runs inside the command, so the order needed a button, not a form. |
| 60 | Not built | `purchaseReviewQueue` and `/tax/purchases`, sorted by what is blocking rather than by age. |
| 73 | Margin and ageing only | `reports.ts` and four screens — sales by board and customer, purchases by supplier and board, price movement, stock ageing, damage, adjustments, receivable and payable ageing. |
| 0 | Generic Locations and Assets still shown | `supersedes` added to the contribution contract; `/godowns` now creates a godown, so hiding them is honest. |
| 1 | Deferred | `landingRouteFor` — derived from what a role can do, never from its name. |
| 59 | Escalated as missing specification | Decision made and recorded: explicit import, never stored credentials. `plywood_gst_portal_record`, `importGstPortalRecords`, `itcReconciliation`, `/tax/itc`. |

### One platform change, and why it was the right shape

`NavigationContribution.supersedes` is the only addition to platform code in
these four slices. A pack declares which generic routes its own vocabulary
replaces.

The alternative — the `location` capability knowing which packs might supersede
it — inverts the dependency and would have `location` naming `plywood`, and
every pack after it. Declaring from the side that has the better word keeps the
shared capability reusable, which is the foundation-ready test in CLAUDE.md.

It hides a navigation entry and nothing else. The route still exists and still
authorizes: a capability must never be able to grant or remove access by
contributing navigation.

### Deviations that remain, by design

- **Sales by salesperson** (§73) is not built and the page says so. An order
  records who *entered* it, not who *sold* it. Attributing revenue to the wrong
  person is worse than not attributing it; it needs a field on the order.
- **Eligible ITC is not yet driven by the reconciliation** (§62). Wiring it
  would mean a period with no import silently reports zero eligible credit,
  which is a bigger change than it looks and needs an explicit decision about
  what an un-imported period should claim.
