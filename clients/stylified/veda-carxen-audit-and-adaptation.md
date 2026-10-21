# Stylified demo: what Carxen had in VEDA, what state it is in, and how it maps to Verity

**Date:** 2026-10-21. **Status:** analysis, read from source and from VEDA's own audit documents. Nothing here is
client-validated. Companion to `demo-plan.md` (what we build, in what order).

## 0. Who Stylified is, and what we do not know

The product owner describes Stylified as a garment manufacturer from Ludhiana. Public web search (2026-10-21) found no
company, site or listing under that name, so **nothing about Stylified's real products, buyers, headcount or process is
known from evidence**. The demo therefore assumes the common Ludhiana shape and says so: a cut-and-sew knitwear maker
(T-shirts, hoodies, track pants, thermals) working to buyer orders, buying knitted fabric and trims, and shipping
packed cartons. Every name, price and quantity is fictional demo data. First meeting question list is in `demo-plan.md` §6.

## 1. Sources read

- `D:\Code\veda\Carxen_VEDA_Combined_Quotation.md`: the signed scope (8 modules, ₹50,000 platform part).
- `D:\Code\veda\VEDA_Launch_Readiness_Gap_Plan.md`, `VEDA_Module_Depth_And_UX_Plan.md`, `VEDA_Inventory_BOM_vs_Odoo_Audit.md`
  (all 2026-09-10..12), `docs/carxen-gap-analysis-and-plan.md`, `docs/status-review-and-department-plan.md`,
  `docs/veda-status-update-2026-07.md`, `docs/superpowers/specs/2026-07-31-master-data-unification-design.md`.
- VEDA source: 68-model `prisma/schema.prisma`, `src/server/actions/*` (team, departments, assignments, stages, dispatch,
  inventory, purchase), `src/lib/permissions.ts`, route tree under `src/app`. 858 commits, last 2026-09-14.
- Verity: `taskplans/118_...` (Carxen is the named manufacturing design partner; stages, QC, passport, dispatch, batch
  and reservation are BUILT), the manufacturing, inventory, hr, attendance and location capabilities, and the DSEW demo
  (`clients/dsew/demo-guide.md`, `prisma/seed-dsew.ts`) as the pattern for a demo tenant.

VEDA's own documents are partly stale in VEDA's favour (they list things as missing that later commits built). Where a
document and the code disagree, this note follows the code.

## 2. The four areas you named, judged

| Area | State in VEDA | Verdict |
|---|---|---|
| Production management | Real per-department job-card chain, start/hold/complete, QC reject sends work back to any earlier stage, per-order custom routing, draft orders, batch consolidation, stock-match before producing, timeline, supervisor review gate, dispatch with packaging photo | **Good.** Keep the model; Verity already rebuilt it (Task 118). |
| Inventory | Perpetual ledger, bin balances (warehouse > zone > rack > shelf > bin), BOM reservation, FIFO issue, cycle count, GRN, vendor returns, QC-hold and rejected buckets, low-stock alerts, valuation | **Good engine, rough surface.** 7 of 9 inventory tables have no horizontal-scroll wrapper; no per-row Adjust; no per-item drill-in; no supplier outstanding ledger; batch is free text; hierarchy modelled but one default bin used in practice. |
| Team management | Phone + 4-digit PIN login, fixed role enum (Owner, Co-owner, Manager, Supervisor, Head supervisor, Worker, Inspector, Store manager, Office staff), department roster, supervisor workspace, employee profile, shift, attendance, leave, tasks. Permission matrix hard-coded in `lib/permissions.ts` | **Works, rigid.** Roles are an enum (a forbidden pattern in Verity). The "Teams" crew model in the department plan was never built; the schema has no `ProductionTeam`. |
| Master data | Spec engine (`ItemGroup` > `SpecField` > `ItemMaster`) with category-inherited BOM recipes, dry-run CSV import, bulk edit | **Bad for the owner.** Powerful data layer, wrong daily surface: the owner must design categories, name templates and column strips before entering one item. HSN, tax rate, min stock, safety stock exist in the schema and are unreachable from the live form. The "unification" (vehicles, colour, design become ordinary categories) is *designed, not started*, so brands, models, generations, designs and colours still live in bespoke tables. |

Master data is the one that needs adapting rather than copying, and it is where Stylified's demo should look unlike VEDA.

## 3. What Carxen bought, module by module, against Verity today

Status words follow `CLAUDE.md`: BUILT, PROVEN, NOT YET BUILT.

| # | Carxen module (quotation) | VEDA | Verity today | Stylified demo plan |
|---|---|---|---|---|
| 1 | Customer management: GST/PAN, phone-first dedup, order history | solid | BUILT: trading customer master (GSTIN validated, phone, merge) | Seed buyers with valid GSTINs |
| 2 | Master data and blueprint setup: brand/model/generation, design, fabric, colour, valid-combination check | solid data layer, poor surface | PARTIAL: items, groups, custom fields with Select options, BOMs. No variant generator, no combination rule | **Build** style matrix (§5) |
| 3 | Order and batch: sales order, draft = quote, consolidate orders into a batch, stock-match, release | solid | BUILT (orders, drafts, batches, reservation, all-or-nothing hold) | Use as is |
| 4 | Stage-wise floor: operator queue per department, start/hold/complete, progress, per-order routing | solid | BUILT (routes as data, operations, queue, send-back, hold with reason) | Garment route (§4) |
| 5 | Digital QC and verification passport: templates, per-checkpoint evidence, approval, QR public page | solid | BUILT (checkpoints snapshotted, append-only findings, evidence rule, ADR-030 passport) | Garment checks, AQL sample |
| 6 | Inventory and storage ledger: rack/shelf/bin, bin balances, BOM reservation, issuance, store-manager scoping | solid, UI gaps | PARTIAL: movements, balances per location, transfer, count, reservation. Racks/bins: only if modelled as child locations. Store scoping: location-scoped grants exist | Locations per store; no bin tree (decision D3) |
| 7 | Procurement: PO, vendor mapping, GRN, vendor return | functional | BUILT: PO with approval threshold, receive goods (partial), vendor payments, performance, price history. Vendor return: check | Seed vendors, POs, one partial receipt |
| 8 | Logistics: dispatch to warehouse, store or customer, transporter, vehicle, tracking id, packaging photo | partial | BUILT: append-only dispatch ledger with packaging-photo rule | Garment cartons, transporter |
| (B) | Storefront, finance | quoted separately | Out of the demo | Not shown |

Not in Carxen's scope by their own choice and therefore not in this demo: CRM pipeline, dealer and B2C portals,
invoicing engine, multi-channel notifications.

## 4. Garment adaptation, decided from the data (no question asked)

Basis: decided from the evidence above and recorded here per the standing rule. Each line says what was decided and why.

- **D1. Route is tenant data, never an enum.** Garment route: Fabric inspection > Marker and cutting > Bundling and
  numbering > Stitching > Washing/finishing (optional per order) > Thread cutting and checking > Pressing and tagging >
  Final audit (AQL) > Packing. Stages and their checkpoints are rows, so Ludhiana variants (embroidery, printing, dyeing
  job-work) are an edit, not a build. Authority: `CLAUDE.md` forbidden pattern 2.
- **D2. One order = one style in one colour, with a size run.** Garments ship by size ratio. VEDA/Carxen has no size
  dimension (a seat cover is one unit), so this is the real adaptation. Output per size is a variant item (§5), and
  completing an order receipts each size into stock. Stock by size is what packing and dispatch actually need.
- **D3. Locations first; bin tree decided at lot-control design.** VEDA modelled racks and bins and used one default
  bin, which is decoration, not control. The demo uses real locations (Fabric store, Trims store, Finished goods store,
  Sample room, an outlet store). Whether roll-level putaway (rack and bin per lot) is built is decided in stage 2, when
  lot control shows what a fabric store needs. Superseded wording from the first draft ("no bin tree") is withdrawn.
- **D4. Master data is fixed, named screens plus tenant lists, not a schema studio.** This is the answer to VEDA's
  "chaotic" master data: Styles, Colours, Size scales, Fabrics and trims, Buyers, each a list the owner edits directly.
  Colour, size and season are Select custom fields (existing platform primitive, PLA-EXT-001). The variant generator
  turns a style, its colours and its sizes into stock-keeping items. HSN and tax rate are visible fields on the item.
- **D5. Roles stay dynamic (Verity's permission model), not VEDA's enum.** Seed roles: Owner, Production manager, Floor
  supervisor (cutting, stitching, finishing), Quality inspector, Store manager (one location), Merchandiser (orders and
  buyers only), Accounts. Rationale: ADR-017 and the forbidden `SystemRole` enum pattern.
- **D6. Operators are employees without logins; supervisors and store managers have logins.** VEDA logs workers in by
  PIN on the shop floor. Verity has no PIN login and adding one is a security-boundary decision (needs its own ADR). The
  demo shows the floor queue operated by a supervisor, as DSEW does.
- **D7. Operator output records are built; pay rules are the client's.** Ludhiana stitching is commonly paid per piece.
  VEDA has nothing here. Verity records who completed how many pieces of which bundle at which operation, append-only,
  which is what any piece-rate scheme reads. The rate card and payroll rules stay a client question.
- **D8. Lot and roll control is built, not faked.** VEDA keeps a free-text batch number, which is not traceability.
  Verity gets a first-class lot (shade, GSM, width, length or weight, roll inspection result), lot-aware issue and
  reservation, and a trace from a finished order back to the fabric lots it consumed. Verity's FINISHER P2-8 lists this
  as not started; it is now in scope for this demo (decision 2026-10-21, quality bar in `demo-plan.md` §0).

## 5. Gaps this demo must close in Verity (superseded by the staged table in `demo-plan.md` §2, which adds lot control, cutting plan with bundles, AQL and packing list)

1. **Style matrix (master data).** Command to generate variant items from a style code, colours and sizes (idempotent per
   SKU, never deletes), custom fields colour/size/season/style on the item, a Styles screen. Fills "product combination
   validation": only generated combinations exist, so an order cannot name an invalid one.
2. **Size run on a production order.** Additive table of per-size lines; `completeManufacturingOrder` receipts each size;
   BOM consumption per piece as today. Traveler and floor queue show the size run.
3. **Operation assignment and supervisor handoff.** Assign an operation to an employee, queue filter "my work", and an
   optional review-before-next-stage gate, as VEDA's department plan phase B/C describes.
4. **Garment seed** (`prisma/seed-stylified.ts`) and `reset-demo` support for the new tenant name.
5. **Store-manager scoping proof**: a role limited to one location sees only that location's stock and orders (VEDA's
   launch-blocking leak, §3.1 of its gap plan). Verity's location scope should hold; the demo must prove it, not assume.

Items 1 to 3 are schema or command changes in the manufacturing and inventory capabilities and need migrations with RLS
(additive, tenant-isolated). They are inside the product-owner scope decision of 2026-09-30 (Task 118); none adds a
security boundary, so no ADR is needed.

## 6. What this document does not claim

- It does not claim any of §5 is built. See `demo-plan.md` for status as work lands.
- VEDA findings come from VEDA's documents and a read of its action and schema files; no VEDA screen was run.
- The garment route and checkpoints are a typical Ludhiana shape, not Stylified's actual process.
