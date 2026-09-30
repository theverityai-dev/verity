# Task Plan 118 — Manufacturing Capability: VEDA Audit, Odoo Gap Map, and a Generalized Design

**Authority:** User synthesis, 2026-09-23, product-owner request to audit
`D:\Code\veda` (the standalone single-tenant Carxen factory-OS product)
against Odoo Manufacturing/Inventory/Quality and derive a reusable Verity
capability from it. Grounded against `veda`'s own three prior audit docs
(`VEDA_Inventory_BOM_vs_Odoo_Audit.md`, `VEDA_Module_Depth_And_UX_Plan.md`,
`VEDA_Launch_Readiness_Gap_Plan.md`, all dated 2026-09-10..12) and against
Verity's live `src/server/capabilities/registry.ts` and `prisma/schema.prisma`
as of this date — not against memory or generic ERP knowledge.

**Status:** Minimal first slice **BUILT + PROVEN** 2026-09-25 — product
owner gave the Task-84-style override this document's §6 said was needed.
See "§7 — 2026-09-25 minimal slice" below for exactly what shipped and what
is still open. The rest of this document (§1-6) is design/gap-analysis
only, unchanged since 2026-09-23, and still governs what a fuller build
should look like.

**Original status (superseded above, kept for history):** PROPOSED —
design and gap analysis only. No code written under
this task. Building the actual `manufacturing` capability requires a
product-owner decision (see §6) because the platform's own scope statement
(`CLAUDE.md` top section, "Not in scope now") still lists manufacturing-
shaped capabilities as excluded, even though the *practice* has already
moved past that: `recipe`, `inventory`, `plywood`, `evidence`, `scheduling`,
and `asset` are registered and shipping (`registry.ts`, Task 84 Phase 4,
product-owner override 2026-09-04). This document does not resolve that
tension — it names it, per the stop-condition rule ("classify the gap,
continue only with unblocked work"). The unblocked work here is the audit
and design; the blocked work is registering a new `manufacturing`
capability key.

**Depends on:** `taskplans/104_...` (native configuration substrate —
custom fields, workflow DAG engine — this design leans on both), the
`recipe` and `plywood` capabilities as prior art for how a client-specific
domain gets generalized.

**Non-goal:** This is not a plan to port VEDA's Prisma schema or code into
Verity. `CLAUDE.md`'s forbidden-patterns list is explicit and this document
does not propose violating it — no VEDA entity name, enum, or schema
reappears verbatim below. What's mined here is the *pattern* (a spec-driven
recipe/BOM engine, a department-routed stage chain, an evidence+checklist
engine), rebuilt on Verity's own Entity/Command/Workflow/Evidence
primitives, not the implementation.

---

## 1. What VEDA actually is (grounding, not assumption)

VEDA is a single-tenant "Factory OS" built for one client, Carxen (custom
automotive seat covers), deliberately **not** an accounting/ERP system —
see `VEDA_Launch_Readiness_Gap_Plan.md` §"Out of scope by design." Its real
strengths, verified against `prisma/schema.prisma` (68 models) and the
three audit docs:

- **A spec-driven BOM/recipe engine** (`ItemGroup` → `SpecField` →
  `ItemMaster`, `BomTemplateLine`/`BomContribution` at category level,
  `ItemBomOverride` per-item exception, resolved into
  `Blueprint → BlueprintVersion → BOM → BOMItem`). This generates a BOM
  from answered spec fields instead of hand-authoring one BOM per SKU —
  genuinely ahead of Odoo's per-variant BOM model for a business with many
  SKUs sharing a component-derivation logic (see §2).
- **A department-routed production chain**: `WorkOrder` → `JobCard` →
  `StageEntry`, with `BlueprintRouteStep` defining department + sequence +
  estimated time. Configurable per factory, not a single generic stage.
- **An evidence+checklist QC engine**: `ChecklistTemplate` →
  `TemplateSection` → `Checkpoint` → `Inspection` →
  `CheckpointSubmission` → `ImageEvidence`, plus `QualityApproval`,
  `QualityReport`, `ReworkRecord`, and a public verification passport
  page. This is tighter integration between QC and production than
  Odoo's separate Quality app.
- **Inventory**: real perpetual ledger (`StockLedgerEntry`), bin-level
  balances (`BinBalance`) with QC-hold/rejected as columns on the same
  row (cleaner than Odoo's separate quarantine location), warehouse
  hierarchy (`Warehouse → Zone → Rack → Shelf → Bin`) that is *modeled*
  but not *operationally used* (no putaway rules, no FIFO enforcement at
  issue time, one collapsed default bin per warehouse in practice).
- **Procurement**: `PurchaseRequest → PurchaseOrder → PurchaseReceipt`,
  functional but with no supplier ledger/outstanding-balance report.

What VEDA does **not** have, confirmed by its own audit docs, and genuinely
missing versus Odoo Manufacturing/Inventory (not a VEDA defect — deliberately
out of scope for a single-factory pilot, but real gaps for "cover all kinds
of manufacturing clients"):

- BOM types (Kit / Manufacture / Subcontract), by-products, engineering
  change orders / BOM version diff+approval.
- Work centers with capacity, hourly cost rate, calendar/downtime, OEE.
- BOM cost roll-up (component cost + operation cost → standard cost).
- Removal strategies (FIFO/LIFO/FEFO) *enforced* at issue time, not just
  displayed; putaway rules; multi-step routes; push/pull replenishment.
- Reordering rules as a stored, scheduled policy (today: live-computed
  suggestion list, human-triggered).
- Lot/serial as first-class entities (expiry, recall flag, consumption
  traceability report) — today a free-text `batchNumber` string.
- Backorders (partial MO completion / partial dispatch).
- Landed costs, GL-posted inventory valuation (out of scope by VEDA's own
  product thesis; in scope for Verity's `accounting`/`finance` capabilities
  if a manufacturing client needs it).
- Supplier ledger / outstanding-balance, GST/tax summary report, party
  statement — flagged repeatedly across all three VEDA audit docs as the
  single most-requested "obvious basic" missing thing.

## 2. Odoo Manufacturing + Inventory + Quality — the target shape

Odoo's manufacturing surface a Verity `manufacturing` capability should be
benchmarked against (Odoo 17, MRP + Inventory + Quality + PLM apps):

| Capability area | Odoo | VEDA | Verity today |
|---|---|---|---|
| BOM authoring | Static per-product/variant lines; Kit/Manufacture/Subcontract types; by-products | Spec-driven category-level recipe, resolved per item; components-in/one-out only | `recipe` capability exists but is food-cost-shaped (`Recipe`, `getRecipeCost`, menu analytics) — not a generic multi-level BOM engine yet |
| BOM versioning/ECO | PLM app: version diff, approval workflow, revert | `BlueprintVersion.isActive`, no diff/approval UI | `workflow.ts`'s DAG engine (`WorkflowDefinition`/`WorkflowNode`/`EdgeCondition`) already supports an approval chain generically — unused for this yet |
| Manufacturing Orders | MO with routing, work orders, backorder split | `WorkOrder`/`JobCard`/`StageEntry`, no backorder | No generic "MO" entity; would compose `entity.ts` + `state.ts` + `workflow.ts` |
| Work centers | Capacity, hourly rate, calendar, OEE | `BlueprintRouteStep` = department + sequence + estimate only, no capacity/cost | `scheduling` capability (240 lines) is the closest primitive — built for a different domain, needs checking for reuse fit, not building fresh |
| Cost roll-up | Component + operation cost = standard cost, live | None (blocked on VEDA's `unitPrice: 0` gap) | `finance`/`accounting` capabilities exist; costing needs a defined contract between manufacturing and them |
| Quality | Separate Quality app, control points, quality alerts | Deeply integrated checklist+evidence+passport, ahead of Odoo here | `evidence` capability (139 lines) is exactly this shape generically — the highest-leverage reuse target in this whole document |
| Removal/putaway | FIFO/LIFO/FEFO enforced, putaway rules, multi-step routes | Modeled, not enforced/used | `inventory` capability (446 lines) — needs the same "is this actually wired to a UI/enforced" check VEDA's own audit ran on itself |
| Lots/serials | First-class, expiry, recall, traceability report | Free-text `batchNumber` | Not present; would be new entity types under `inventory` |
| Subcontracting | Vendor as virtual warehouse, receive back finished good | Not modeled | Not present |
| Reordering | Scheduled automatic policy, auto-draft-PO | Live suggestion list only | Not present |

**Reading this table correctly:** the honest finding is that Verity does
not need a monolithic new "manufacturing" capability that reimplements all
of this from scratch. It needs (a) generalizing `recipe` from
food-cost-specific to a domain-agnostic multi-level BOM/routing engine,
(b) confirming `evidence`, `scheduling`, `inventory`, `asset` are actually
reusable in their current shape or need a compatibility pass, and (c) a
thin `manufacturing` capability that composes those plus a
`ManufacturingOrder` entity/workflow — the same "purpose-built reusable
capability" pattern the platform's own core principle names, not a
Manufacturing-specific fork of the whole stack.

## 3. Proposed shape (design, not implementation)

```
ManufacturingOrder (entity.ts Entity)
  -> references a BOM (generalized recipe.ts, multi-level)
  -> routes through WorkflowDefinition (workflow.ts) = the "stage chain,"
     replacing VEDA's hardcoded department sequence with the platform's
     existing configurable DAG
  -> each stage may require Evidence (evidence.ts) = QC checkpoint capture,
     reusing VEDA's strongest pattern generically instead of rebuilding it
  -> consumes/produces via inventory.ts (stock ledger + bin balances),
     extended with: enforced removal strategy, lot as first-class record,
     putaway rule as a small policy table
  -> work center = a Resource (already an ADR-008 platform primitive,
     "single schedulable unit"), given capacity + calendar via scheduling.ts
  -> cost roll-up = a query joining BOM components' costs (finance.ts) +
     work-center hourly rate (Resource) + time actually spent (from the
     workflow run's stage timestamps) — a query, not new state
```

This reuses six existing capabilities/primitives and one platform-core
mechanism (Resource, ADR-008) rather than inventing parallel concepts —
directly satisfying the platform's own "capabilities built for one client
must be reusable by the next" requirement, and its "extend the responsible
layer" default from this session's operating instructions.

**What's genuinely new, not a reuse:** `ManufacturingOrder` as an entity
type with backorder semantics; lot/serial as first-class records under
`inventory`; a BOM cost-roll-up query; a putaway-rule policy table.
Everything else above is "confirm `X` capability's contract covers this
domain too," which is cheaper and should be checked before any new code.

## 4. UX completeness — the actual complaint behind this request

The user's framing ("product managers understand requirements, but devs
skip the obvious basic stuff Odoo already has") is independently confirmed
by `VEDA_Module_Depth_And_UX_Plan.md` — its concrete findings are the same
class of bug repeated: schema fields that exist but have no form field
(`hsnCode`, `taxRate`, `minStockLevel`), a BOM editor that round-trips
`wastePercent` but never renders it, 7 of 9 tables with no horizontal-
scroll wrapper, no per-row quick action, no drill-in from a list row to its
detail. None of these are architecture gaps — they are "the obvious
counterpart action was never added" gaps, exactly the pattern the user is
asking to systematize a checklist against.

**Action taken on this:** a new skill, `manufacturing-completeness-checklist`
(scope: any CRUD/list/detail surface, not manufacturing-specific — the
pattern generalizes), is being authored alongside this taskplan — see the
skill's own `SKILL.md` for the checklist content. It encodes, as reusable
categories: per-row actions, drill-in navigation, exportability, mobile/
horizontal-scroll safety, "does every schema field have a form field,"
ledger/statement views for every party-like entity, empty/error/loading
states, and search/filter on every list — checked against Odoo's
equivalent screen for the same entity, not against ad hoc taste.

## 5. Answering "what's ahead of Odoo" honestly

Not everything Odoo has is worth copying. VEDA's checklist+evidence+
passport engine and its recipe-driven BOM generation are both *better*
fits for a made-to-order manufacturer with many SKU variants than Odoo's
generic per-variant BOM and bolt-on Quality app — this should be preserved
as Verity's manufacturing differentiator, not flattened to Odoo parity.
The Odoo benchmark in §2 is a floor (obvious basics must exist), not a
ceiling (Verity's evidence-native QC and spec-driven BOM should stay ahead
of it as the actual sales differentiator against Odoo/Busy-class ERPs for
this vertical).

## 6. Open — do not solve silently

- **Scope conflict**: `CLAUDE.md`'s "Not in scope now" list still names
  Inventory/Commerce/Work-Order-as-finished-capability as excluded, while
  `registry.ts` already ships `inventory`, `recipe`, `plywood`, `hr`,
  `finance`, `billing`, `crm`, `scheduling`, `evidence`, `asset` under a
  documented Task 84 Phase 4 product-owner override. Whether a
  `manufacturing` capability is "more of the same override" or needs its
  own explicit go-ahead is a product-owner call, not an engineering one —
  flagged here rather than assumed.
- **`recipe` generalization** (food-cost-shaped → generic multi-level BOM)
  is a breaking-ish change to an already-shipping capability
  (`colonel-kebabz` client depends on it) — needs a compatibility plan,
  not a silent rewrite.
- **Which client is the first manufacturing design partner** — this
  document is deliberately client-agnostic per the user's ask ("all kinds
  of manufacturing clients"), but a real build should still anchor on one
  concrete first client the way `Party` anchored the platform slice.

## 7 — 2026-09-25 minimal slice

Product owner approved the override this document's §6 asked for, scoped
to the smallest real slice rather than the full §3 design at once (product
owner's own instruction: "minimal real slice, not the whole design doc").

**BUILT + PROVEN:**
- `verity.capability.manufacturing`, one entity `verity.manufacturing.order`
  (`src/server/capabilities/manufacturing/index.ts`).
- `ManufacturingOrder` + `ManufacturingOrderLine` (`prisma/schema.prisma`,
  migration `20260924210000_capability_manufacturing_order`, RLS +
  `capability_definition`/`entity_definition`/`state_definition`/
  `transition_definition` rows, same pattern as `asset`'s own migration).
- Lifecycle: `draft -> in_progress -> completed | cancelled` (ADR-009:
  Draft/Active/Completed/Cancelled).
- `createManufacturingOrder`, `startManufacturingOrder` (real component
  consumption, negative-stock guard checked before any write — not
  `recipe`'s deliberately theoretical posture),
  `completeManufacturingOrder` (posts output as a Receipt),
  `cancelManufacturingOrder` (reverses in-progress consumption with a new
  offsetting Adjustment, never edits the original Issue rows — ADR-009).
- `listManufacturingOrders`, `manufacturingOrderDetail` queries.
- `src/test/capability-manufacturing.test.ts` — 5 tests, run against the
  real (shared, product-owner-approved-for-this-run) database:
  same-item-consumes-what-it-produces rejection, the full
  create→start→complete happy path with real ledger deltas asserted,
  insufficient-stock refusal leaving stock untouched, cancel-reversal, and
  INV-002 terminal-state read-only. **5/5 passed.**
- `tsc --noEmit` and `eslint` both clean on every touched file.

**Deliberately NOT built this pass** (named, not silently absent — see the
capability file's own header comment for the full reasoning on each):
lot/serial, work-center capacity/cost, BOM cost roll-up, QC evidence
wiring, putaway rules, backorders/partial completion, `recipe`
generalization into a shared multi-level BOM engine, and any UI (this
slice is server-side commands/queries only — no page under `src/app/`
yet). The V1 completeness gate (`verity-client-capability-builder`'s
Odoo/erpnext cross-check + `obvious-basics-checklist`) was **not** run
against this slice — it has no UI to check yet, and running it now would
be checking a page that doesn't exist. Run it when a UI is built.

Not chosen: referencing `recipe.Recipe` as this order's BOM (wrong fit —
keyed 1:1 to `MenuItem`, would force a fake `menuItemId`). See the
capability file's header for the full reasoning; `ManufacturingOrderLine`
snapshots components directly instead.

## 8 — 2026-09-30 UI slice

**Scope decision:** the product owner authorized business-capability build
past PLATFORM FOUNDATION READY for Tasks 118/119/120 (recorded in
`CLAUDE.md`, "Product-owner scope decision, 2026-09-30"). §6's scope question
is closed.

**BUILT:** the UI §7 said was missing. `/manufacturing` (list: state counts by
canonical `StateCategory`, `DataTable`, permission-gated "New order"),
`/manufacturing/[id]` (state, produces, components consumed, history via
`AuditTrail`, state-driven Start / Complete / Cancel-with-reason), a
`CreateOrderForm` with a dynamic components list, all mutations through
`runCommand` (no client mutation path). The `/manufacturing` nav entry that
`registerManufacturingCapability` already declared is no longer a dead link.
`tsc --noEmit` and `eslint` clean; route compiles and gates correctly
("This feature is not active" for a tenant without the capability), no
console errors.

**NOT verified with data:** no tenant here has `manufacturing` activated and
the only signed-in tenant is a real client's, so the create → start →
complete flow was not clicked through in a browser. The commands themselves
remain proven by `src/test/capability-manufacturing.test.ts` (5/5). Run the
V1 completeness gate (`verity-client-capability-builder` cross-check +
`obvious-basics-checklist`) against these pages the first time a tenant
activates the capability.

**Still NOT built** (unchanged from §7): lot/serial, work-center capacity/
cost, BOM cost roll-up, QC evidence wiring, putaway rules, backorders/
partial completion, `recipe` generalization. No first design-partner client
is named (§6), so none of these has a concrete requirement to build against;
per the lean-V1 posture they wait for one.

## 9 — 2026-09-30 Carxen: reusable BOM

**Design partner named:** Carxen, a custom automotive seat-cover maker (the
business VEDA was built for). §6's "which client anchors the build" is closed.
The lean-V1 reading of Carxen's need: many vehicle variants share one component
recipe, and the pain is retyping it on every order. So the slice is a reusable
BOM, not the whole §3 design.

**BUILT + PROVEN (real database, own random tenant, cleaned up):**
`ManufacturingBom` + `ManufacturingBomLine` (per-UNIT quantities, RLS, migration
`20260930020000_manufacturing_bom`, applied to the shared project), registered
as entity `verity.manufacturing.bom`. Commands `create_bom`, `set_bom_active`
(archive/restore; never deleted, an order's `bomId` must keep pointing at what
it came from), `create_order_from_bom` (every line scaled by the quantity and
SNAPSHOTTED, so a BOM changing later never rewrites an order already made; the
order records `bomId`); queries `list_boms`, `bom_detail`; the order detail now
returns `bomId`/`bomCode`. Vehicle make/model/year/seat row are **custom
fields** the tenant declares on the BOM entity (PLA-EXT-001), validated by the
existing `validateCustomFields`, never columns. The order validation and write
are now one shared implementation (`shared.ts`) used by hand-built orders, BOMs
and orders from a BOM. UI: `/manufacturing/boms` (list + create form whose
custom-field section renders whatever the tenant declared) and
`/manufacturing/boms/[id]` (per-unit lines, details, Make an order, Archive/
Restore); the order page says which BOM it came from.
Tests: `src/test/capability-manufacturing-bom.test.ts`, 8 tests (custom-field
validation, duplicate/self/duplicate-component rejection, scaling 3 units =
360/180/3, a scaled order consumed and received for real, overflow refusal,
archive semantics, tenant isolation) plus the original 5 manufacturing tests
still pass after the refactor: 13/13. `tsc` and `eslint` clean.

**Not verified in a browser with data:** no tenant here has manufacturing
active and I will not activate it on the PlotArmour tenant. Routes compile and
gate correctly ("This feature is not active") with no console errors.

**Deliberately still NOT built** (no Carxen requirement stated for them, and the
lean-V1 posture is to wait): lot/serial, work centers, cost roll-up, QC evidence
wiring, putaway, backorders/partial completion, BOM line editing after creation
(a changed recipe takes a new code), `recipe` generalization. Ask Carxen which,
if any, they need first.

## 10 — 2026-09-30 What Carxen actually bought (from `D:\Code\veda`), and stage-wise production

**Sources read:** `Carxen_VEDA_Combined_Quotation.md` (the signed scope, 2026-09-10),
`docs/carxen-gap-analysis-and-plan.md` (VEDA's own gap analysis vs Carxen's PRD),
`VEDA_Launch_Readiness_Gap_Plan.md` (what VEDA verified as solid vs missing).

**Carxen's scope, Part A (8 modules):** customers (GST/PAN, phone-first dedup),
master data (vehicle brand/model/generation, designs, fabrics, colours),
order + **batch** management (consolidate several orders into one production
batch, stock-match before producing, draft orders as the quote stage),
**stage-wise manufacturing floor** (CAD, Cutting, Stitching, Packing; operator
queue per department; start/hold/complete; custom per-order routing), **digital
QC** (checklist templates by section, per-checkpoint photo/video, approval, QR
public verification passport), inventory (bin ledger, **BOM reservation on
release**, store-manager scoping), procurement (PO, vendor mapping, GRN,
returns), logistics/dispatch (transporter, vehicle, tracking, packaging photo).
**Out of scope by their own decision:** CRM pipeline, dealer/B2C portals,
invoicing/accounting engine, multi-channel notifications. Their product thesis is
"Factory OS, not ERP": every module must feed production.

**What that says about priority.** The centre of gravity is the production
floor, not manufacturing-order bookkeeping. VEDA calls stage routing with
start/hold/complete/rework, a per-order timeline and QC evidence its PRD
"core acceptance criteria" (Phase 1 of its own plan). Verity's manufacturing had
only draft -> in progress -> completed, so this was the largest real gap.

**BUILT + PROVEN (real database, own tenant, cleaned up): stage-wise production.**
`ManufacturingRoute`/`RouteStage` (a route is tenant DATA, never a department
enum: CLAUDE.md forbidden pattern 2), `ManufacturingOperation` (one per stage per
order; state machine pending -> in_progress <-> on_hold -> completed | cancelled
with ADR-009 categories Pending/Active/Blocked/Completed/Cancelled, INV-002
read-only once completed). Migration `20260930030000_manufacturing_stages`.
Commands `create_route`, `set_route_active`, `plan_operations` (from a route OR
the order's own stage list, which is how one order skips/reorders a stage),
`start_operation` (only when the ORDER is running and every earlier stage is done
or cancelled), `hold_operation` (reason required), `resume_operation`,
`complete_operation`, `send_back` (a QC reject: cancels open work and APPENDS the
route again from the redone stage, first one pointing at what it redoes via
`reworkOfId`; history is never edited). The order lifecycle stays honest:
`complete_order` refuses while any stage is open, `cancel_order` cancels open
stages. Queries `list_routes`, `order_operations`, `operation_queue` (open work of
running orders only, with per-row send-back targets). UI: `/manufacturing/floor`
(operator queue, stage chips, ready/on-hold/rework counts), `/manufacturing/routes`,
and a Stages panel on the order page (plan, work, send back).
Tests: `capability-manufacturing-stages.test.ts`, 11 tests (route validation,
plan once, sequencing, hold/resume with reason, completion gating, QC send-back
with history intact, per-order skipped stage, floor queue, order cancel, INV-002,
route archive, tenant isolation). With the 13 earlier manufacturing tests: 24/24.
`tsc` and `eslint` clean; routes compile and gate correctly. Not clicked through
with data (no tenant here has manufacturing active; not activating it on a real
client's tenant).

**BUILT + PROVEN 2026-09-30 (later): digital QC checklist + evidence.**
Checkpoints are data on a route stage (`label`, `requireEvidence`,
`requireRemarks`) and are SNAPSHOTTED onto each operation when an order is
planned, so editing a route never changes what an order already carries.
Findings are an append-only ledger (`ManufacturingCheckpointResult`, database
trigger refuses UPDATE and the app's DELETE, migration
`20260930040000_manufacturing_qc`); a fail is followed by a new pass, never
overwritten, and the latest finding per checkpoint is the verdict. Command
`record_checkpoint` (stage must be in progress; a fail always needs remarks; a
checkpoint that requires evidence needs a captured artefact, and that evidence
must be about THIS operation, so a photo of another order cannot make one pass).
`complete_operation` is now the QC approval: it refuses while any checkpoint is
unrecorded or currently failing. A send-back re-creates the stage with a clean
checklist and leaves the failed findings on the original. Reuses `evidence`
(`verity.evidence.capture`, immutable) rather than a parallel table. Queries:
`operation_checklist`; checklist progress appears on the floor queue and order
stages. UI: a Checklist panel per stage (pass/fail, remarks, photo link), route
form with a checklist per stage (`[photo]` / `[note]` tags), Complete disabled
until every checkpoint passes (the server enforces it regardless).
Tests: `capability-manufacturing-qc.test.ts`, 8 tests (snapshot independence,
requirements, foreign-evidence refusal, in-progress only, approval gating with
re-inspection history, append-only enforcement, send-back with clean checklist,
floor progress) all pass; the 11 stage tests still pass. Not verified in a
browser with data (same reason as above).
**Photo capture is by link or stored reference** (`verity.evidence.capture` with a
`uri`), not a camera/file upload: the platform's two-phase upload exists
(`files.ts`) but no reusable browser upload component does. Building one is a
separate, shared piece of work (it would also serve Outreach and assets).

**Next slices, in Carxen's priority order (designed, NOT built):**
1. ~~**Public verification passport.**~~ **BUILT 2026-09-30 (ADR-030 accepted).** A
   published, revocable, minimal, FROZEN projection of one completed and fully
   inspected order, behind an unguessable token (32 random bytes, only its hash
   stored, shown once as a link and QR), read by the anonymous page through one
   SECURITY DEFINER function and nothing else; no remarks/photos/staff; one active
   passport per order; a recall is revoke + new issue; rate-limited; `noindex`.
   Publish/revoke are audited commands with their own permission. 7 tests against
   the real database, including one that fetches the real page as an anonymous
   visitor. Not viewed visually with a live passport.
2. ~~**Dispatch** with packaging-proof photo, transporter, vehicle no., tracking id,
   in-transit/delivered pipeline.~~ **BUILT 2026-10-01.** `manufacturing_dispatch` is an
   append-only ledger (DB trigger refuses UPDATE/DELETE) of `dispatched` and `delivered`
   events; the latest row is the order's logistics state. `dispatch_order` needs a
   COMPLETED order and a packaging photo that is `Photo` evidence about THAT order
   (a photo of another order, or a non-photo, is refused; a DB CHECK also requires it on
   every `dispatched` row). `confirm_delivery` only after dispatch, once. The photo
   reuses the platform `evidence` capture; the UI takes a link, like the QC checklist.
3. ~~**Order consolidation into a batch** and **BOM reservation on release**.~~ **BUILT
   2026-10-01.** `manufacturing_reservation` is a hold, not a movement: available = on
   hand minus other orders' live holds, checked all-or-nothing, serialised per location
   by a transaction advisory lock. Starting an order is refused against stock another
   order holds, consumes its own hold (`consumed`), and cancelling releases it; holds are
   released, never deleted. `manufacturing_batch` groups 2+ draft orders at one location
   (each in at most one batch); it has no state of its own, `batchDetail` gives the
   consolidated stock-match, `reserve_batch` holds every member or none, `dissolve_batch`
   only while all are draft. No new security boundary, so no ADR. 9 tests against the
   real database. Not built: per-line/partial reservation, reservation expiry.
4. **Lot/batch tracking** (VEDA has `isBatchTracked` + a free-text batch number and
   no flow; Carxen's own gap analysis lists it as missing there too).

**Deliberately not Carxen's scope:** CRM, dealer/B2C portals, invoicing,
notifications; do not build them under this task.
