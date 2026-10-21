# Stylified demo guide

**Date:** 2026-10-21. Companion to `prd-review-and-replan.md` (why it is built this way) and `Garment_Lot_PRD.docx` (what the
client asked for). Everything below ran on a throwaway local database and a local Keycloak. No production data was touched,
and nothing here is on production. Every name, number and rupee is fictional.

## 1. What the demo shows

A lot and karigar piece-rate business: pieces go out to a karigar at a stage and come back, wages follow from the pieces
returned, and the owner reads one dashboard and four reports. Two logins make the "only the munshi enters data" rule visible.

| Screen | Route | Who | What it proves |
|---|---|---|---|
| Lots | `/lots` | both | Every lot with number, design, stage, location, days there, pending, ready progress; New lot (munshi only) |
| Lot detail | `/lots/{id}` | both | The stage journey with issued, received and pending at each stage; who holds what; every entry, with Reverse for a mistake |
| Daily entry | `/lots/entry` | munshi | One screen: date, lot, issue or receive, stage, karigar, pieces; bundles appear automatically; today's entries listed |
| Karigars | `/karigars` | both | Rate per piece, pieces held, wages earned, balance due; New karigar with rates |
| Karigar card | `/karigars/{id}` | both | Account of work, rate per piece, advances and payments with Reverse, balance due; Record advance or payment, Set a rate |
| Owner dashboard | `/lots/dashboard` | both | The PRD's seven items: active lots, pending pieces at every stage, material with karigars, ready bundles, lot-wise costing, karigars' dues, days since each lot last moved |
| Lot reports | `/lots/reports` | both | Lot-wise production, worker-wise payment (with a period), costing, ready inventory; each downloads as a file that opens in Excel |

Seeded sample (the PRD's own): **LOT-0001, design D-101, 500 pieces**, at Stitching 500 issued, 320 received, 180 pending;
Button / Kaj 320/200/120; Finishing 200/150/50; Press 150/100/50; 100 ready (5 bundles of 20). **Karigar A at ₹12 a piece.**
Plus LOT-0002 (with one karigar for nine days), LOT-0003 (just given to the cutter), LOT-0004 (finished, 200 ready, 10 bundles),
LOT-0005 (created today, not started). Seven karigars, five stages, an advance and three payments.

## 2. Walkthrough (about ten minutes)

1. **Munshi, Lots.** Point at LOT-0001: Stitching, with Karigar A and Karigar B, 12 days, 100 of 500 ready.
2. **Open LOT-0001.** The journey shows issued, received and pending at every stage, the same numbers as page 2 of the blueprint.
   "Who holds what" shows A with 100 and B with 80 pending at Stitching.
3. **Daily entry.** Choose LOT-0001, Receive, Stitching, Karigar A, 60 pieces. Bundles show 3 without being typed.
   Save. Then try 500: the screen refuses with "Karigar A has only 40 pieces pending at Stitching".
4. **Karigar card for A.** Wages rose by 60 x ₹12 = ₹720. Record a payment larger than the balance: it is refused and says
   to record the extra as an advance. Record a smaller one and watch the balance fall.
5. **Reverse** the 60-piece entry from the lot page. Both rows stay; the pending count and the wage return to what they were.
6. **Owner login, Owner dashboard.** The seven items on one page. Costing says wages only and "to be confirmed".
7. **Owner, Lots.** There is no New lot button, no Daily entry menu item, and typing `/lots/entry` shows a plain refusal.
8. **Lot reports, Download for Excel** on any report; the file opens in Excel with the same rows as the screen.
9. **Phone.** The same pages at phone width: the sidebar becomes a tab bar.

## 3. Status, in the project's vocabulary

**BUILT and PROVEN (database tests, 22 in `src/test/capability-piecework.test.ts`, 27 pure in `ledger.test.ts`):** the lot and
stage ledger, refusal of over-issue and over-receive (also per karigar), rate snapshot on every receive, payment guard,
reversal that cannot strand a later stage, gapless never-reused lot numbers, the stage chain frozen once work exists,
back-dating limits, serialised concurrent entries, tenant isolation, append-only ledgers at the database, the owner role
refused every write, and the dashboard and reports derived from the same ledger.

**BUILT, opened in a browser and checked on the local stack:** Lots, lot detail, Daily entry (an entry was saved through the
screen), Karigars, Owner dashboard, Reports (all four with their download button), the owner login (no write controls,
refused entry screen). Checked at desktop and a phone-width window.

**BUILT, not clicked through:** New lot, New karigar, Record payment, Set a rate, Reverse (entry and payment), Retire and
Restore a karigar, Cancel lot, the stage set-up form, the actual CSV file contents, and the period filter. Each calls a command
that the database tests cover; the forms themselves were not exercised.

**NOT YET BUILT (and not claimed):**
- A native `.xlsx` file. The download is CSV, which Excel opens. A true Excel file is a later build.
- Hindi, or any language switch. The client's requirement is in Hindi; the screens are English.
- Offline entry, and notifications.
- Shortage, rejection and rework recording, lot split or merge. These are open questions to the client (PRD section 12).
- Full lot costing. Costing here is wages only; cloth and other costs wait for the client to say what costing includes.
- A way for ready stock to leave. Dispatch is excluded by the client, so the ready figure never falls; the screens say so.
- Fabric Inward as a record. The PRD leaves what it captures open (question 1), so it is not built.
- Printing a lot slip or a QR for a lot.

## 4. Open questions that change the build (from the PRD, section 12)

Bundle rule (sample: 20 pieces, a part-bundle counts as one); how wages are worked out and how advances are recovered
(built as: wage on pieces returned at the rate in force that day; advance is netted at the balance); what costing includes;
what "location" means (shown as "with the karigar"); short, rejected or reworked pieces; whether one karigar can work several
stages (allowed); lot split or merge (not allowed); fabric inward fields; who logs in; device and internet; language;
existing registers to import.

## 5. Running it locally

Needs Docker, Node and this repository. Database: a copy of a migrated local Postgres (`verity_stylified` on port 55432 was made
from `verity_clean` and brought up to date with `npx prisma migrate deploy`; the two new migrations are
`20261021200000_inventory_style_master` and `20261021300000_capability_piecework`). Identity: the local Keycloak realm `dsew`
with two logins for this demo, `stylified-munshi` and `stylified-owner`. Seed (never through the npm `seed:*` scripts or any
shell that has the production `.env` loaded, and with the Supabase variables blank):

```
DATABASE_URL, DIRECT_URL   the local database
STYLIFIED_MUNSHI_SUB       the munshi login's Keycloak user id
STYLIFIED_OWNER_SUB        the owner login's Keycloak user id
node prisma/run-seed.cjs seed-stylified.ts
```

Reset to clean: `DEMO_TENANT_NAME=Stylified npx tsx prisma/reset-demo.ts --yes` (it deletes only a tenant flagged `demo` with that
exact name), then seed again. Putting the demo on production is a separate decision for the product owner: it creates a login.

**Two things that trip people:** `next dev` allows one server per folder, so a second one for this demo needs another copy of
the source; and Turbopack refuses a linked `node_modules`, so that copy runs with `next dev --webpack`.

## 6. Completeness gate

Not run in the formal sense (`obvious-basics-checklist` and the Odoo and ERPNext cross-check). A first pass against what a
piece-rate and job-work user treats as obvious:

| Basic | State |
|---|---|
| Search and filter on every list | Lots and karigar tables use the shared table (sort, filter, paging); no status chips on the lot list yet. Deferred |
| A row opens its detail; detail links back | Included (lot and karigar links everywhere, dashboard rows open the lot or karigar) |
| Corrections without losing history | Included: reversal for entries and payments, never edit or delete |
| Empty, error and denied states | Included: set-up empty state, plain refusals with the figures, permission-denied pages |
| Export | CSV for four reports; `.xlsx` deferred |
| Per-karigar statement to hand over | Not built: the card is on screen and the report downloads, but there is no print layout. Deferred |
| Date of entry vs time typed | Included: both recorded, back-dating allowed within limits |
| Roles | Included: munshi writes, owner reads, proven by test and by login |
| Audit of who did what | Included: every line shows who entered it; the platform audit trail also records commands |

This is a first pass by the builder, not the formal gate.
