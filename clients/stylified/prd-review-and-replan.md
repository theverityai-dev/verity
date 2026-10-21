# Review of Garment_Lot_PRD.docx (v0.1, 2026-10-21) and what it changes

**Date:** 2026-10-21. Reviewed: `Garment_Lot_PRD.docx` (35 requirement IDs), `Garment_Visual_Blueprint.pdf` (10 pages,
client-facing), `Garment_Blueprint_Flow.png` (page 2). Read in full. This note judges the PRD, checks its claims against
the repository, and records how the Stylified demo plan changes.

## 1. Verdict

The PRD is careful and mostly right. It is the first evidence of what a Ludhiana garment client actually asks for, and it
overturns the plan I wrote before it existed. Do not build to the old plan.

Checked and sound:
- Fit counts add up: 15 CONFIGURATION, 12 CUSTOMIZATION, 8 UNCLEAR, 35 total, matching the tables line by line.
- The wage sample is arithmetically right (150 x 12 + 100 x 12 = 3,000; minus 500 advance, minus 1,000 paid = 1,500).
- The flow picture is internally consistent: each stage's issued equals the previous stage's received (500, 320, 200,
  150), and 100 ready pieces at 20 per bundle is 5 bundles.
- Evidence discipline is good: every unknown is tagged OPEN QUESTION with an owner, and the blueprint shows the client
  only what they asked for.

## 2. What it changes in the Stylified plan

The client is a **lot and karigar piece-rate** business, not a buyer-order, size-ratio, quality-audit business.

| My earlier plan (`demo-plan.md`) | PRD says | Decision |
|---|---|---|
| Style x colour x size matrix, size run on orders | "Size tracking is not wanted" (S4). Quantities are pieces only | **Dropped from the Stylified demo.** The style master stays in the repo as a generic capability, uncommitted, and is not granted to this tenant |
| Fabric roll and shade-lot control, quantity precision in grams | Fabric Inward is the entry point but "What do you note?" is an open question. No lot of cloth rolls asked for | **Dropped.** Fabric Inward is a plain record until the client answers question 1 |
| Cutting plan with marker and wastage | Not asked | Dropped |
| AQL sampling, defect classes | Not asked | Dropped |
| Packing list by size ratio, carton dispatch | "Dispatch is excluded" (S8) | Dropped |
| Operator output for piece-rate, "pay rules are the client's" | Core of the ask: rate per piece, wages, advance, payment, balance due | **Promoted to the centre** |
| Not in my plan | Issued, received and pending per lot, stage and karigar; time per stage; automatic bundle count; munshi-only entry; seven dashboard items; four Excel reports | **New centre of the demo** |

The quality bar stands (industry grade, no VEDA code, database tests). Only the scope changes, and the PRD's own rule
applies: "Nothing gets added without your OK."

## 3. Checked against the repository (what the PRD got right and wrong)

| PRD claim | Repository reality |
|---|---|
| No issued / received / pending per stage and karigar | **Correct.** `ManufacturingOperation` has state and timestamps only, no quantities |
| No karigar wage ledger, advance or balance | **Correct.** `InventoryVendorPayment` pays vendors against purchase orders; nothing is piece-rate |
| No bundle concept | **Correct** |
| No unique user-visible lot number | **Correct.** Orders carry a free-text `reference` only |
| Excel export of reports is UNCLEAR | **Partly wrong.** CSV download exists (`attendance/PayrollSummary.tsx` builds and downloads `payroll-inputs-<month>.csv`), and CSV opens in Excel. A true `.xlsx` is not built. The PRD should say "CSV exists, `.xlsx` is a build". |
| Hindi not supported | **Correct.** No i18n library in `package.json`, no Hindi strings |
| Karigar could be a vendor (M041) or employee (M080) | Both exist (`InventoryVendor`, `HrEmployee` on a Party). Employee on a Party fits INV-003 better; a karigar has no login either way |
| Offline entry not ready | Not re-checked here; PRD's own note says runtime only |

The workbook (`PlotArmour Pricing - Master Reference.xlsx`, M-ids) is not in the repository, so the M-numbers were not
re-verified. The PRD says the workbook wins on conflicts; this note does not override it.

## 4. Gaps in the PRD itself

1. **The client is never named.** The brief's client-facts line was a template placeholder (the PRD says so). I treat this
   as Stylified because the product owner described Stylified as a Ludhiana garment maker and shared it with the demo.
   If it is a different client, say so; the plan below still holds for that client.
2. **Cloth quantity is unspecified.** Fabric Inward carries "quantity and unit" (metres or kilograms, usually with
   decimals) while stock quantities are whole numbers. If Fabric Inward stays a record it needs no stock arithmetic; if it
   ever feeds stock, the integer-with-scale design in `demo-plan.md` §2a applies.
3. **Pending can go wrong silently.** "Pending = issued minus received" lets received exceed issued. A receive entry must
   be refused beyond what is pending (short and over-receipt are open question 5, but over-receipt is never right).
4. **Entry correction is unspecified.** A munshi will mistype pieces. Industry practice is an append-only ledger with
   reversal entries, never edit or delete; wages derived from entries then stay trustworthy. Needs to be stated in the PRD.
5. **Rate timing.** Which rate applies when a rate changes is open (Q: "whether rate changes apply to old work"). The
   safe design snapshots the rate on each receive entry, so history never moves.
6. **Stage time is only as honest as entry timing.** Time in stage runs from the first issue to the last receive, which
   assumes the munshi enters on the day. Show the entry date, not only the system clock, and allow a back-dated entry date
   with the entry time recorded separately.
7. **Ready stock never decreases** (dispatch excluded). The PRD flags this to the founder. Until answered, ready stock
   is "pieces that reached ready", and the screen must say so rather than imply a live stock count.
8. **The PRD tells the founder not to promise anything in a demo.** The product owner has asked for a working demo, so
   the position for this build is: what Tech builds and proves is shown as built; everything else stays a labelled sample.

## 5. Re-plan

The stage list in `demo-plan.md` §2 is replaced by this one. Each stage lands as its own commit with database tests.

| Stage | Content | PRD ids |
|---|---|---|
| A. Lots and the stage ledger | A `lot` with a unique, never-reused number (tenant-scoped sequence), design, total pieces, status. The seven stages as tenant data. An append-only issue and receive ledger per lot, stage and worker. Pending, current stage, days in stage and last movement are derived, never stored. Receive beyond pending is refused. Corrections are reversal entries | LOT-01..05, LOT-07, LOT-08, DAT-01, DAT-02 |
| B. Karigars and the wage ledger | Karigar master (name, mobile, work types, active). Rate per piece by work type, snapshotted on each receive. Append-only money ledger: advance, payment, reversal. Wages, balance due and pieces with each karigar are derived | WRK-01..08 |
| C. Bundles and ready inventory | Bundle count derived from pieces and the lot's bundle size (sample 20, to confirm). Ready stock by lot fed by Press receives; labelled as "reached ready" | DAT-03, INV-01, SCP-01..03 |
| D. Munshi role, entry screen, lot register and detail, karigar card | The screens in blueprint pages 4 to 7. Munshi can write; owner can read. No size field anywhere | LOT-06, DAT-01 |
| E. Dashboard and four reports | The seven owner items (costing shown as "to confirm") and the four reports with CSV download now and `.xlsx` as a later build | DSH-01..07, RPT-01..05 |
| F. Seed, walkthrough, completeness gate | A Stylified demo tenant on the local database with the PRD's own sample (LOT-0001, 500 pieces, D-101, Karigars A to D) | all |

> **Superseded 2026-10-22.** The client's developer requirement workbook (`Shirt_Factory_Developer_Requirement_Sheet.xlsx`)
> replaces the lot-level model below with a bundle-level one (bundle records, return split into good / rejected / rework / short,
> wage basis, lot status workflow). The stage table below describes the first lot-level build, which migration
> `20261022100000_piecework_bundles_quality` reshaped. Current plan and status: `requirement-sheet-review.md`; current demo:
> `demo-guide.md`.

**Status, 2026-10-21 (late), historical, lot-level build:**

| Stage | State |
|---|---|
| A. Lots and the stage ledger | **BUILT and PROVEN (backend)**: `piecework` capability, migration `20261021300000_capability_piecework` (6 tables, row-level security forced, entries, payments and rate history append-only), 15 commands and queries. 27 pure tests (`ledger.test.ts`, reproduces the PRD sample exactly) and 20 database tests (`src/test/capability-piecework.test.ts`) pass. Applied to the local database `verity_stylified` only |
| B. Karigars and the wage ledger | **BUILT and PROVEN (backend)**: worker master, rate history with a snapshot on every receive, advance and payment with reversal, wages and balance derived. Covered by the same tests |
| C. Bundles and ready inventory | **Derived figures BUILT and PROVEN** (bundles from pieces and the lot's bundle size, ready from the last stage's receives). The dedicated ready-inventory screen is stage D |
| D. Entry screen, register, detail, karigar card, munshi role | **BUILT; opened and checked in a browser** (Lots, lot detail, Daily entry with a real saved entry, Karigars, owner login). Munshi write and owner read-only proven by a database test and by signing in as each |
| E. Dashboard and four reports | **BUILT and PROVEN (derivations); screens opened in a browser.** Seven dashboard items; four reports with a CSV download for Excel (`.xlsx` deferred) |
| F. Seed, walkthrough, completeness gate | **Seed BUILT and run** (`prisma/seed-stylified.ts`, the PRD sample, local database only). Walkthrough in `demo-guide.md`. The formal completeness gate is NOT run; a first pass is in the guide |

Design points settled while building (decided, not asked): lot numbers use the platform's gapless allocator and are never
reused after a cancel; a receive is refused for a worker with no rate for that stage (rate 0 is allowed and means unpaid
by decision); a payment is refused beyond the balance due (the excess is an advance); a reversal is refused when it would
leave a later stage issuing more than exists; the stage chain cannot change once work is recorded; entries may be
back-dated but never before the lot existed or into the future; "today" is the tenant's time zone, not UTC.

Where it lives: a new generic capability for piece-rate lot production (`piecework`), not a Stylified-named module and not
bolted onto `manufacturing`. `manufacturing` is built around orders that consume a bill of materials, start, and complete;
a lot has no bill of materials and moves pieces between workers, so forcing it there would distort both. It reuses the
platform primitives, the stage and route idea, the `Party` and employee records for karigars, the location and role
machinery, the append-only ledger pattern, and the CSV download. This is the shape other piece-rate businesses (jewellery
karigars, embroidery job-work, the roadmap's Subcontracting / Job Work item) would reuse.

## 6. What stays from stage 1 of the old plan

The style master (`inventory_item_template` and friends, `/styles`) is generic, proven (13 database tests) and correct for
any client that does sell by colour and size. It is not part of Stylified. It is not granted to the Stylified tenant, so
its navigation entry never shows. The decision whether to keep it in the repository or hold it back is the product
owner's; until then it stays uncommitted and unpushed.

## 7. Questions only the product owner can answer

1. Is this PRD Stylified's requirement? (Assumed yes.)
2. Demo approach: build the slice and show it as built (assumed, per your earlier "go"), or configure and show samples?
3. Keep the style master in the repository or set it aside?
