# Task Plan 47 — Business Identity, Navigation, Logistics Removal (Slice 2)

**Program:** `45_plywood_workflow_program.md`. **Slice 2 of 7.**
**Closes:** audit **P0-09** (business legal identity) and **P0-10** (route set
contradicts the product). Delivers §D-01 and §D-03.

---

## 1. Logistics is gone

Not hidden — removed. Capability module, routes, navigation entry, commands,
queries, entity keys, overview metrics, tests, and both tables.

**Why the tables went rather than being left behind.** Dead tables carrying live
foreign keys to sales orders, purchase orders, locations, customers and assets
are not inert: they constrain every future migration on those tables, and the
next reader has to be told which of two shipment-shaped concepts is real.

**The deeper reason is P0-04.** While a shipment can move material out of a
godown, a godown has two doors. A stock ledger with two doors cannot be
reconciled to its documents, and *"every quantity traces to a source document"*
is the property this whole programme exists to obtain. Material now leaves
through a Goods Issue — arriving in slice 4 — and through nothing else.

The chain and fresh-tenant journeys lost their transport steps rather than
having them stubbed, and the reachability test's floor moved with the module
instead of being deleted.

---

## 2. Business identity (P0-09)

| Was | Now |
|---|---|
| a raw configuration key holding a 2-character state code | `PlywoodGstRegistration` — GSTIN, state, type, invoice series |
| the live tenant name read off the invoice page | `PlywoodBusinessProfile` — legal name, trade name, PAN, address, financial year, currency |
| an invoice that changed if the business renamed itself | `seller_legal_name_snapshot`, `seller_gstin_snapshot`, frozen at posting |

The specification's §4 asks that the accountant never type the business's own
GSTIN onto an invoice again. That is only possible if the business *has* one,
recorded once, where invoices can read it — and if what an invoice recorded
stays recorded.

### Decisions worth defending

**The state code is never asked for.** It is the first two characters of the
GSTIN, always. A separate field can disagree with the number it came from, and
that disagreement decides CGST+SGST against IGST on every invoice the business
ever raises. Enforced twice: derived in the command, and a CHECK constraint
(`left(gstin, 2) = state_code`) so no other writer can break it.

**Shape, not validity, in the constraints.** A GSTIN's checksum is the portal's
business. Refusing a legitimate new format because a regex predates it would be
worse than accepting a typo the portal will reject anyway.

**Registration-keyed although exactly one is supported.** §D-03. A partial
unique index makes "one" a fact rather than an intention, and it is the single
line that changes when multi-state is decided. Tax rules, series and returns key
off the registration from this first migration, so a second state is later data
rather than a redesign.

**A registration cannot be edited, only added.** The profile can be corrected —
a business does change its trade name. A GSTIN is not a typo to fix in place,
because invoices have been raised and reported under it. The form disappears
once a registration exists rather than becoming an edit that quietly rewrites
tax history.

**A missing customer state now refuses the invoice.** It used to fall back to
the business's own state, which silently labels an interstate supply as
intrastate: the wrong tax, the wrong return, and it looks correct on screen.
Rule freeze §4.4, and the failure direction is the reason it matters.

> **Amended 2026-09-15 (product owner: "I am not able to raise invoice if a
> customer doesn't have state code").** Place of supply now resolves in
> order: the customer's recorded state; else the first two digits of their
> GSTIN; else — an unregistered buyer with no address on record, an
> over-the-counter sale — the seller's own state (IGST Act s.10(1)(c)).
> §4.4's guard still holds where it bites: a registered buyer never reaches
> the last step, because the GSTIN answers. `finance.ts raiseSalesInvoice`,
> test in `plywood-business-identity.test.ts`.

**Snapshot columns are nullable and not backfilled.** Invoices raised before
this migration genuinely have no recorded seller identity. Inventing one from
today's tenant name would be a fabricated fact on a tax document; an honest null
says "this predates the profile", which is true.

---

## 3. Navigation (P0-10, §8)

Groups are the business's own words — **Trade, Inventory, Money, Insights,
Administration** — and `NavigationGroup` was widened to hold them. Nothing
plywood contributes sits under "Capabilities" any more; a client reading that
word is the foundation leaking into the product.

Headings are now **drawn**, not only announced. They were `sr-only` because nine
items did not need three headings, which was true of nine items; the workflow
brings fifteen across five areas. A sighted user was being given strictly less
structure than a screen-reader user, which is a strange way round. A
single-item group still gets no heading — a heading over one link is noise.

`Business Settings` is gated on **Edit**, not Read: everyone who can read an
invoice can already see the legal identity printed on one, and the set who may
change it is much smaller.

---

## 4. Files

```text
prisma/migrations/20260831120000_remove_plywood_logistics/    DROP shipment, transporter
prisma/migrations/20260831130000_plywood_business_identity/   profile, registration, snapshots, RLS
src/server/capabilities/plywood/business.ts                   NEW
src/server/capabilities/plywood/{index,keys,finance}.ts       wiring, nav, seller identity
src/server/platform/contribution.ts                           business navigation groups
src/components/shell/ShellChrome.tsx                          visible headings
src/app/(shell)/settings/business/                            NEW screen
src/test/plywood-business-identity.test.ts                    NEW, 14 tests
```

Deleted: `plywood/logistics.ts`, `app/(shell)/logistics/`,
`capability-plywood-logistics.test.ts`.

---

## 5. Evidence

```text
Tests  736 passed | 4 skipped (740)
```

Suite 726 → 740. `tsc --noEmit` clean. Both migrations applied to the local
cluster; the logistics tables are confirmed absent and the two new tables
present.

Three of the fourteen new tests need no database at all — the absence of a
module is a property of the tree, and proving it by walking `src/` is stronger
than proving it by not calling it.

---

## 6. Deliberately not in this slice

*   **People & Roles with business activities** (rule freeze §6). The activity
    catalogue is written; mapping it onto Verb+Entity+Scope and building the
    client-facing role editor is its own change, and it belongs beside the
    approval workflow in slice 4 where maker/checker first has teeth.
*   **The guided onboarding flow.** `businessSettings.outstanding` names the
    remaining steps and the screen renders them; the full eight-step resumable
    checklist (§3) needs godowns, catalogue and parties to report against, and
    those land in slice 3.
*   **Withdrawing `/configuration`, `/locations`, `/assets` from client view.**
    The plywood tenant already supersedes Locations and Assets in the sidebar;
    Configuration is still reachable for a user holding the platform grant.
    Removing it is a permission change, not a navigation one, and it goes with
    the business-activity split.
