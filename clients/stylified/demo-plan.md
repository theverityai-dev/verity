# Stylified demo: build plan and status

**Date:** 2026-10-21. **Update 2026-10-22:** the build plan now follows the client's developer requirement workbook, see
`requirement-sheet-review.md` (stages 1 and 2 built; fabric, costing, dispatch, split/join, Hindi layer, roles/alerts pending);
the lot-level status below is historical. Read `veda-carxen-audit-and-adaptation.md` first; this file is the work order that follows from it.
The demo is a flagged disposable tenant (`customFields.demo = true`, `demoFor = stylified`) on the DSEW pattern
(`clients/dsew/demo-guide.md`, `prisma/seed-dsew.ts`). All data is fictional.

## 0. Quality bar (product-owner instruction, 2026-10-21)

"Don't copy anything poor or low-end; adapt everything to industry grade first; no low-quality code near Verity."

- **VEDA is a behaviour reference, never a code source.** No VEDA file, query, schema or component is copied. Each
  capability is rebuilt on Verity's own primitives (commands through `executeCommand`, tenant RLS forced, append-only
  ledgers, snapshots, integer minor units) and measured against what a mature garment ERP does, not against what
  Carxen's single factory got by with.
- **VEDA defects that must not reappear** (found in the audit): free-text batch numbers; a hard-coded permission matrix;
  inventory and dashboard queries with no location scoping; unwrapped tables on phones; unauthenticated destructive
  dev endpoints; orders priced at zero; one collapsed default bin; role enum; fields in the schema with no form field.
- **Industry-grade reference for garments** (what a merchandiser or production head expects): style/colour/size matrix,
  per-size consumption, roll and shade-lot control, cutting plan with wastage, bundle tickets, operation-level
  assignment and output counts (piece-rate ready), AQL sampling with defect classes, carton packing list by size ratio.
- **Gate for every piece:** database tests against the real schema, RLS on every new table, no raw native controls,
  business labels only on screen, `obvious-basics-checklist` and the Odoo/ERPNext cross-check before it is called done.
  Lean-V1 does not apply to this demo: depth beats breadth.

## 1. Business lifecycle the demo walks (stated before any command)

Buyer enquiry > style and colours confirmed > order with size run > fabric and trims check against stock > purchase of
shortfall > goods received > cutting plan > bundles > stitching > finishing > final audit > packing > dispatch > delivered.

Happy path and named exceptions:

| Step | Happy path | Exception (shown in the demo) |
|---|---|---|
| Fabric receipt | PO received in full | Partial receipt, balance still on order |
| Cutting | Fabric issued to the order | Fabric short: order cannot start (stock guard), draft PO from low stock |
| Stitching | Operation completed | Hold with a reason (needle break, machine down) |
| Final audit | Checks pass | A failed check sends work back to stitching; history stays, a new pass follows |
| Dispatch | Cartons out with packaging photo | A photo about another order is refused |

Source of truth for every number: stock = movement ledger (never a stored balance); order size total = sum of its size
lines; amount owed to a vendor = received value minus payments; margin is a read, not a stored fact.

## 2. Build stages and status

**SUPERSEDED 2026-10-21 by `prd-review-and-replan.md`.** The client's own PRD (`Garment_Lot_PRD.docx`) describes a lot and
karigar piece-rate business with no size tracking and no dispatch. The table below is the earlier buyer-order plan and
is kept only for history. The current stages (A to F: lots and stage ledger, karigar wage ledger, bundles and ready
inventory, screens, dashboard and reports, seed) are in `prd-review-and-replan.md` §5. Stage 1 below (style master) is
proven and generic but is not part of the Stylified demo.

Status words: BUILT = code exists; PROVEN = database tests pass; NOT YET BUILT.

| Stage | What | Status |
|---|---|---|
| 0 | Audit of VEDA and Verity, adaptation decisions | **DONE** (this folder) |
| 1 | Style master: colour and size lists, styles, idempotent variant generator, HSN and GST on items, Styles screens (`/styles`, `/styles/[id]` stock matrix, `/styles/lists`). Migration `20261021200000_inventory_style_master` (6 tables, RLS forced). | **PROVEN** (13 database tests in `src/test/capability-inventory-styles.test.ts`; neighbouring inventory and manufacturing tests still pass; `tsc` and `eslint` clean; ui-reachability passes). Screens **BUILT, not yet opened in a browser** (no signed-in session on the local stack). Applied to local database `verity_stylified` only. Per-size consumption in the BOM moves to stage 3 with the size run. |
| 2 | Lot and roll control (first-class lot entity under inventory: lot, shade, GSM, width, length or weight, roll inspection, lot-aware issue and reservation, lot traceability to orders) | NOT YET BUILT |
| 3 | Size run on production orders; cutting plan with planned versus actual fabric and wastage; bundle tickets with unique ids | NOT YET BUILT |
| 4 | Operation assignment, supervisor review gate, operator output records (piece-rate ready) | NOT YET BUILT |
| 5 | Quality: inline checks, AQL sampling plan (ISO 2859-1 style sample size and accept/reject numbers), defect classes, defect log | NOT YET BUILT |
| 6 | Packing list by size ratio and carton, dispatch of cartons | NOT YET BUILT |
| 7 | Garment seed on the above (local database), roles and location scoping proof, completeness gate, demo guide | NOT YET BUILT |

Each stage lands as its own commit with its tests and an update to this table. Nothing is reported BUILT until its code
exists, and PROVEN only after the database tests pass.

## 2a. Design decision found in stage 1: quantity precision (to settle in stage 2)

Stock quantities are whole numbers (`InventoryStockBalance.qty` is an integer). Pieces are fine; fabric is not: a tee
uses about 0.28 kg, and kilograms to three decimals cannot be stored as an integer count of kilograms. Industry grade
means exact quantities without floating point. Decision: store quantities as integers in a smaller base unit per item
(grams for fabric, metres to millimetres where needed), the same discipline money already follows (integer minor
units), with a per-item display scale so screens show kilograms. This is decided and built together with lot and roll
control in stage 2, because a fabric roll's weight and length are the first quantities that need it.

## 3. Running it (local only)

The repository `.env` points at production. The demo is built and shown on the local rehearsal database
(`verity-baseline-db-1`, port 55432) with `DATABASE_URL` and `DIRECT_URL` exported to it explicitly, never through the
npm `seed:*` scripts that load `.env`. Putting the demo on production is a separate step that needs the product owner's
say-so (outward-facing, creates a login).

## 4. Not in the demo, on purpose

CRM pipeline, dealer and B2C portals, invoicing engine, multi-channel notifications (Carxen's own exclusions); worker PIN
login (a new security boundary, needs its own ADR first); payroll calculation from piece-rate (output records are built,
pay rules are the client's); Hindi. Bin-level putaway is decided at stage 2 once lot control shows whether it is needed.
Lot control, piece-rate-ready output, AQL and bundle tracking were deferred in the first draft and are now in scope.

## 5. Completeness gate

`obvious-basics-checklist` and the Odoo/ERPNext cross-check (Manufacturing, Inventory, Quality) run against the
screens before the demo is called done. Result goes in a section here. Not run yet.

## 6. Questions for the first Stylified meeting

1. Products and buyers: domestic brands, exporters, or both? Typical order size and sizes per style?
2. Process: in-house cutting, stitching, finishing, or job-work out (printing, embroidery, washing)? Which stages exist?
3. Pay: salary, piece-rate, or mixed for stitchers? Is output counted per bundle?
4. Fabric: bought as knit rolls, or knitted in-house? Is shade-lot control needed?
5. Quality: AQL level and who audits? Buyer inspections?
6. Stores: how many, and who may see what?
7. Who logs on the floor: supervisors only, or each operator on a phone?
