# Stylified demo guide

**Date:** 2026-10-22 (rewritten for the bundle-level build). Companion to `requirement-sheet-review.md` (what the client's
developer requirement workbook asks and what is built) and `prd-review-and-replan.md` (history). Everything below ran on a
throwaway local database and a local Keycloak. Nothing here is on production. Every name, number and rupee is fictional.

## 1. What the demo shows

A shirt-factory piece-rate business at the unit the workbook specifies: the **bundle**. A lot is cut into numbered bundles
(B-0001...), each bundle moves through the stages (Pasting, Collar & Cuff, Stitching, Button / Kaj, Finishing / Press), each
stage is given to a karigar or an outside unit and comes back split into good, rejected, rework and short, and wages follow from
the wage basis agreed for that karigar. Two logins make "only the munshi enters data" visible.

| Screen | Route | Who | What it proves |
|---|---|---|---|
| Lots | `/lots` | both | Every lot with stage, location, bundles, cut of planned, pending, good ready, reject / rework / short, due date, status |
| Lot detail | `/lots/{id}` | both | Status buttons (activate, hold, complete, close), the stage journey for the whole lot, every bundle, every entry with Reverse |
| Bundle | `/lots/bundles/{id}` | both | One bundle's position at every stage, each issue with what came back and what is still open, slip link |
| Slip | `/lots/bundles/{id}/slip` | both | Bilingual (Hindi and English) slip: bundle number, net pieces, lot name and number, QR; prints on its own |
| Daily entry | `/lots/entry` | munshi | Give out (bundle, stage, karigar, pieces, wage basis, due date) or take back (which issue; good, rejected, rework, short), with a live "accounted for X of Y" line |
| Karigars | `/karigars` | both | Kind (in-house or outside), rate and wage basis per stage, pieces held, balance due |
| Karigar card | `/karigars/{id}` | both | Work in hand, account of work, rates, advance / recovery / deduction / payment (mode, reference) with Reverse |
| Owner dashboard | `/lots/dashboard` | both | Quality totals, pending by stage, material with karigars, dues and unrecovered advances, overdue returns, wages by lot |
| Lot reports | `/lots/reports` | both | Lot status, bundle location, work in hand, wage ledger, short / reject / rework, production by process, lot cost so far, ready stock; each downloads for Excel |

Seeded sample: **LOT-0001 Spring formals** (500 planned, 400 cut in four bundles) carries the workbook's own reconciliation
**100 = 94 good + 2 rejected + 1 rework + 2 short + 1 still open** on B-0001, the rework reissued and redone, B-0002 with 37
still at Stitching, B-0003 with 98 at an outside collar unit past its return date, and B-0004 waiting to be issued. LOT-0002 is a
draft, LOT-0003 is closed (50 ready), LOT-0004 is on hold. Six karigars: C pastes at ₹2 on pieces issued, Sharma Collar Works
(outside) at ₹5 on pieces returned, A stitches at ₹12 on good pieces, D (button and kaj) ₹3, E (finishing) ₹4, F ₹11; an advance,
a recovery, a deduction and payments with mode and reference.

## 2. Walkthrough (about twelve minutes)

1. **Munshi, Lots.** Four lots in four statuses. Open LOT-0001.
2. **Lot detail.** The journey shows issued, good and pending at every stage; losses are shown beside the stage, never netted
   into good. Four bundles listed with where each one is.
3. **Bundle B-0001, then its slip.** The same 100 pieces accounted five ways. The slip has Hindi beside each label and a QR; Print
   prints only the slip.
4. **Daily entry, Take back.** Choose B-0003 at the collar unit (98 open). Good 90, rejected 3, rework 2, short 1: the line reads
   "accounted for 96 of 98, 2 will stay open". Save. Try a number that is over the open quantity: refused with the figures.
5. **Daily entry, Give out.** Rework waiting at a stage is reissued from the same screen and keeps its own flag.
6. **Karigar card for A.** Wage is on good pieces: 88 good at ₹12 is ₹1,056 although 90 came back. Record a deduction (a reason is
   required) and a payment larger than the balance (refused, with what to do instead).
7. **Reverse** an entry from the lot page. Both rows stay; counts and wage return to what they were. A reversal that would strand
   a later stage is refused.
8. **Complete the lot.** Refused while any bundle has pending or rework pieces; allowed when clear. Closed lots are locked.
9. **Owner login.** Dashboard and every report, no write buttons, no Daily entry menu item, a plain refusal at `/lots/entry`.
10. **Reports, Download for Excel** on any report; same rows as the screen.

## 3. Status, in the project's vocabulary

**BUILT and PROVEN** (28 pure tests in `ledger.test.ts`, 23 database tests in `src/test/capability-piecework.test.ts`): the
bundle ledger and the sheet's reconciliation; over-issue, over-return and over-rework refusal; the split enforced by a database
CHECK; rework pool and reissue; the three wage bases; rate snapshot; no-rate refusal; payment, recovery and deduction guards;
reversal that cannot strand a later stage; gapless never-reused lot and bundle numbers; lot status moves; concurrent entries
serialised; tenant isolation; append-only tables at the database; the owner role refused every write; reports derived from the
same ledger.

**BUILT, opened in a browser (2026-10-22):** Lots, lot detail, bundle slip, Daily entry return (saved through the screen),
Owner dashboard, all reports, Karigar card. Two links found wrong during that pass (karigar work-in-hand and bundle issue rows)
were fixed.

**BUILT, not clicked through:** New lot, Cut a bundle, status buttons, Record money, Set a rate, Retire / Restore, Cancel lot,
the owner login against these screens (proven by test), and the CSV contents.

**NOT YET BUILT (and not claimed):** fabric inward and the decimal-metre ledger; the twelve-category costing and allocation
(costing is wages only and says so); packing, ready-stock exit and dispatch; bundle and lot split or join; Hindi UI beyond the
slip; native `.xlsx` and PDF export (CSV opens in Excel); the other roles and thresholds from the workbook (Manager,
Supervisor, Store Manager); alerts; an owner audit viewer; backup and restore evidence. See `requirement-sheet-review.md` for
the stage plan.

## 4. Decisions made from the workbook's suggested defaults

Recorded in `requirement-sheet-review.md` section 4 (D-01 to D-14). The client confirms them in UAT; none is hidden.

## 5. Running it locally

Needs Docker, Node and this repository. Database: a copy of a migrated local Postgres (`verity_stylified` on port 55432 was made
from `verity_clean` and brought up to date with `npx prisma migrate deploy`; the migrations are
`20261021200000_inventory_style_master`, `20261021300000_capability_piecework` and
`20261022100000_piecework_bundles_quality`). The last one refuses to run if any piecework rows exist; reset the demo tenant first
where they do. Identity: the local Keycloak realm `dsew` with five logins (below). Seed (never
through the npm `seed:*` scripts or any shell that has the production `.env` loaded, and with the Supabase variables blank):

```
DATABASE_URL, DIRECT_URL   the local database
STYLIFIED_MUNSHI_SUB       the munshi login's Keycloak user id
STYLIFIED_OWNER_SUB        the owner login's Keycloak user id
STYLIFIED_MANAGER_SUB, STYLIFIED_SUPERVISOR_A_SUB, STYLIFIED_SUPERVISOR_B_SUB   the other three (optional)
node prisma/run-seed.cjs seed-stylified.ts
```

Reset to clean: `DEMO_TENANT_NAME=Stylified npx tsx prisma/reset-demo.ts --yes` (it deletes only a tenant flagged `demo` with that
exact name), then seed again. Putting the demo on production is a separate decision for the product owner: it creates a login.

**Things that trip people:** a running dev server keeps the Prisma client it started with, so restart it after `prisma generate`
or a migration (otherwise "column does not exist"); `next dev` allows one server per folder, so a second one needs another copy of
the source; and Turbopack refuses a linked `node_modules`, so that copy runs with `next dev --webpack`.

## 6. Completeness gate

Not run in the formal sense (`obvious-basics-checklist` and the Odoo and ERPNext cross-check). A first pass:

| Basic | State |
|---|---|
| Search and filter on every list | Shared table (sort, filter, paging); no status chips on the lot list yet |
| A row opens its detail; detail links back | Included; lot, bundle and karigar links throughout |
| Corrections without losing history | Included: reversal for entries and payments, never edit or delete |
| Empty, error and denied states | Included: plain refusals with the figures, permission-denied pages |
| Export | CSV for the reports; `.xlsx` and PDF deferred |
| Per-karigar statement to hand over | Not built: on screen and as CSV, no print layout |
| Roles | Munshi writes, owner reads; the workbook's four roles are a later stage |
| Audit of who did what | Every line shows who entered it; the platform audit records commands; no owner viewer yet |

This is a first pass by the builder, not the formal gate.

## 6. The floor: roles, logins and the walk (2026-10-23)

Local logins, all in the Keycloak realm `dsew`, all with the local-only dev password `Stylified-Demo-1`. They exist on this machine
only; none of them is on production.

| Login | Role | What to show |
|---|---|---|
| `stylified-owner` | Owner | Owner dashboard, Approvals (can approve above the manager limit), Team and limits |
| `stylified-manager` | Manager | Approvals inbox from a phone; approves within the limit, sees "Needs the owner" above it |
| `stylified-supervisor-a` | Supervisor, stages Collar and Stitching | `/shopfloor`: late outside unit, Karigar A holds 37 pieces; take back with plus and minus; photo; deduction request; Hindi |
| `stylified-supervisor-b` | Supervisor, stages Pasting, Kaj, Finishing | A frozen day close with a Hindi note; give out; the shortage write-off request |
| `stylified-munshi` | Munshi | Daily entry (Hindi or English), lots, bundles, karigars, wages |

The supervisor screens live at `/shopfloor` (the existing `/floor` is the dine-in floor plan): My floor, Take back, Give out, Rework
and short, Close the day, and the karigar quick view. Approvals is `/shopfloor/approvals`, the owner's Team and limits
`/shopfloor/team`. A supervisor who opens the wages page is refused; a supervisor at a stage that is not theirs is refused by the
server, not merely hidden.

Reset and reseed: `DEMO_TENANT_NAME=Stylified npx tsx prisma/reset-demo.ts --yes`, then the seed command above. The seed makes three
pending approvals (a deduction inside the limit, a write-off, a deduction above the limit) and one closed day.

Defect photographs need file storage. On a machine with the Supabase variables blank (the local run) the camera step shows
"File storage is not set up on this server" and the rest of the screen works; on the hosted deployment the photo is stored and shows in
the register and in the approval.
