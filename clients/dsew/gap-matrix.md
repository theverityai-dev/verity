# DSEW gap matrix against the client RFP and the 18 Oct 2026 planning guide

Status: DRAFT, 2026-10-18, revised after the focused verification gate. Companion documents:
[decisions.md](decisions.md) (decision records) and [phase1-design.md](phase1-design.md) (Phase 1 design, no code yet).

## Legend (verification level, strongest claim only)

| Level | Meaning |
|---|---|
| **Found** | A relevant implementation exists in the repository. Nothing more is claimed. |
| **Reviewed** | The code paths were read and the behaviour described below was checked against the source. |
| **Test-verified** | A named automated test covering the behaviour was run in this audit and passed. |
| **Client-validated** | The behaviour was confirmed against DSEW's actual workflow. **Nothing is at this level yet.** |

Test run for this audit, 2026-10-18, local Postgres, `npm test` on `capability-manufacturing`, `-bom`, `-stages`,
`-qc`, `-logistics`, `capability-inventory`, `capability-project`, `tenant-isolation`: **70 passed, 1 failed**.
The one failure is `capability-inventory.test.ts` "an outlet asks for stock…": the test expects the message
`/outlet to send from/` and the command now says "choose the location to send from". A stale wording assertion
from another change, unrelated to DSEW; it was not touched here. No other tests were run.

## Correction to the first matrix

The first matrix said a BOM "can be edited in place". That was wrong. `bom.ts` has **no edit command**: only
`createBom`, `setBomActive` (archive/restore) and `createOrderFromBom`. A changed recipe takes a new code. What
is actually missing is a *revision model* (lineage, states, approval, effective dates, change reason), not an
edit guard. Also corrected: "authorised override of a gate" does not exist at all, in code or in tests.

## Verified rows (the ones that can change scope or architecture)

| Topic | What the code does | Evidence | Level | Uncovered requirement |
|---|---|---|---|---|
| BOM creation and edit | Create with lines; archive/restore; no line or header edit command. Code unique per tenant. | `manufacturing/bom.ts` `createBom`, `setBomActive`; `capability-manufacturing-bom.test.ts` passed | Test-verified | No revision lineage between BOM codes, no draft/review/released/superseded, no effective date or change reason, no approval, single level only. Custom fields on a BOM may still be editable by the generic custom-field path: not checked. |
| BOM snapshot onto order | Order lines are scaled and copied at creation; `bomId` is kept for traceability. | `bom.ts` `createOrderFromBom`, `insertOrder` in `shared.ts` | Test-verified | The order stores `bomId` only. If revisions become rows, `bomId` already pins the exact revision, provided released rows are made immutable (see design). |
| Quote revisions and approved snapshot | Revisions appended; approval snapshots value onto the job; later revision never rewrites it. | `project/jobs.ts`; `capability-project.test.ts` quote snapshot test passed | Test-verified | No quote approval workflow, no alternative offers, no PO-vs-quote comparison. |
| Order lifecycle | draft → in_progress (consumes stock) → completed (receipts output) or cancelled (offsetting Adjustment rows). Through the state runtime. | `manufacturing/index.ts` start/complete/cancel; manufacturing tests passed | Test-verified | None for the current shape. |
| QC checkpoints | Per-operation checklist copied from the route; append-only results; latest verdict wins; failed checkpoint blocks completion; missing checkpoint blocks completion; evidence must be captured for *that* operation. | `manufacturing/stages.ts` `completeOperation`, `recordCheckpoint`; `capability-manufacturing-qc.test.ts` passed | Test-verified | **Result is pass/fail only**: no measured value, unit, tolerance, instrument or approver. |
| QC gate is optional | `completeManufacturingOrder` only counts open operations: an order with no operations "is unaffected". A stage with no checkpoints completes freely. So the gate exists only if someone planned a route with checkpoints. | `manufacturing/index.ts` lines 236-243; `stages.ts` lines 334-348 | Reviewed | **Gate is not mandatory per product.** Phase 1 must let a product or BOM require a route and required checkpoints. |
| Gate override | Not implemented. No command, no test. | grep over `src/` and `src/test/` found none | Reviewed | Authorised override with mandatory reason and audit entry. |
| Dispatch gate | Requires `completed` order, one dispatch per order, packaging photo that is Evidence about *this* order. Append-only dispatch rows. | `manufacturing/logistics.ts`; `capability-manufacturing-logistics.test.ts` passed | Test-verified | Dispatch does not check test records, released drawing revision, or document pack (none exist yet). |
| Evidence storage | Immutable `Evidence` rows (photo, document, signature, geo point, reading), file checksum frozen at confirmation, geofence verdict stored at capture. | `evidence/index.ts` | Reviewed | Evidence is a captured fact, not a controlled document: no number, no revision, no approval, no release state. Evidence kind `Reading` carries a free `payload` only, with no unit or tolerance semantics. |
| Stock ledger | Movement row and balance row move in one transaction through `applyMovement`; manufacturing writes its own movements directly. Cancel reverses with new Adjustment rows. | `inventory/ledger.ts`; `manufacturing/index.ts` | Test-verified (cancel reversal) / Reviewed (rest) | Movements carry **no lot, heat or serial**. Issue movements carry **no unit cost**, so material cost is "consumed quantity at the item's current moving average" (an estimate, stated in `project/index.ts`). |
| Purchase-order models | Two exist. Inventory: vendor, PO (draft/submit/approve/cancel), receive goods to stock, vendor payments, vendor performance, draft from low stock. Trading: supplier, PO, receipt, purchase bills, GST purchase invoice match, built for stocked catalogue products. BOM components are `InventoryItem` rows. | `inventory/procurement.ts`; `trading/orders.ts`, `trading/finance.ts`; `ManufacturingBomLine.componentItemId → InventoryItem` | Reviewed | Inventory PO has no requisition, no supplier comparison, no job allocation. Decision D5 in [decisions.md](decisions.md). |
| Approval chain | Generic request with role-named sequential steps, decided in order. | `approval/index.ts` | Reviewed | Not yet wired to BOM release, document release, test approval or quotes. |
| Tenancy | RLS enabled and forced with a tenant policy on the BOM tables; isolation suite passes. | migration `20260930020000_manufacturing_bom`; `tenant-isolation.test.ts` passed | Test-verified (isolation suite) / Reviewed (BOM migration) | Every new Phase 1 table must repeat the pattern and add a negative cross-tenant test. |

## Remaining RFP rows (Found only unless stated: do not quote to the client as built)

| RFP | Need | State | Note |
|---|---|---|---|
| A CRM | Customers, enquiry to quote, follow-up, complaints | Partial, Found | `TradingCustomer`, project enquiry/quote states, `crm`, `complaint`. Missing contacts per customer, RFQ/tender tracker, meeting log, reminders. |
| B Project | Job spine, milestones, tasks, dependencies, cost, alerts | Exists, Test-verified | `capability-project.test.ts` passed. Missing risk/issue/change register, WBS depth, owner, portal. |
| C Quote and sales | Templates, estimate build-up, approval, PO comparison, retention, LD | Partial | See verified rows. |
| D PLM | Product master, drawings, multi-level BOM, ECR/ECO, release | Partial | Single-level BOM only; the rest missing. Phase 1 item 1 and 2. |
| E Documents | Numbering, revisions, approvals, transmittals, audit | Missing | Phase 1 item 2. |
| F MES | Work centres, operator time, subcontract, scheduling | Partial, Found | Routes, operations, hold, rework, reservations exist. |
| G Traveler | Measured values, hold/witness points, printable traveler | Partial | Measured values and witness missing; QR passport exists (ADR-030). |
| H QMS | QAP/ITP, incoming, NCR, CAPA, audits, calibration | Partial | In-process checkpoints only. |
| I Traceability | Lot/heat/serial, scan flows, genealogy | Partial | Finished-unit QR only. Lot/heat on stock missing. |
| J Procurement | Requisition, comparison, AVL, ratings | Partial, Found | Inventory PO and vendor performance exist. |
| K Inventory | Bins, physical verification, ageing | Partial, Found | Items, balances, movements, counts, requests. |
| L MRP | BOM requirements, capacity | Missing | Out of Phase 1. |
| M Testing | Templates, readings, calibration, FAT | Missing | Phase 1 item 3. |
| N Finance / Tally | Sync, GST, BG/retention | Partial | No Tally adapter in `src/`; see D6. |
| O HR / payroll | Attendance, leave, payroll | Partial, Found | Payroll excluded (D7). Attendance is a separate workstream. |
| P Dispatch | Packing list, challan, e-way bill, warranty | Partial | Dispatch ledger exists. |
| Q Contracts | Obligations, LD, BG expiry | Missing | |
| R Dashboards | Role dashboards, Excel/PDF | Partial | Summary exists. |
| S Notifications | Email, escalation | Partial, Found | Outbox (ADR-039) and approval exist, DSEW triggers not wired. |
| AI, Hindi | Optional | Missing | D7. |
| On-prem | Mode B, backup, restore | Missing / unproven | D3. |

## Rows added from the client calls, 2026-10-19 (client-stated; code state not re-checked)

Source: the two call transcripts in this folder; detail in the "Client call findings" section of
[decisions.md](decisions.md). State below is from existing rows and earlier code review, not a fresh audit.

| Need (client words) | State | Note |
|---|---|---|
| Document numbering scheme (positions, 0-9/A-Z, drawing decimal sub-parts, R01/R02) | Missing | Part of E Documents, Phase 1 item 2. Exact scheme still to come from the client. |
| Documents issued for a limited period (3, 6, 12 months) | Missing | No validity or expiry in `phase1-design.md`. |
| Per-client, per-product checklists, built by the client, photo/video approval | Partial, Found | Custom fields and QC checkpoints exist per route; no per-client variant and no client-built form designer assessed. |
| Test report: summary plus detail, test condition per reading, units | Missing | Extends row M and the Evidence `Reading` note: no unit semantics, no test condition. |
| Print-ready report from entered data | Missing | Same dependency as the row above. |
| Export Project Data PDF with photos (stamped project file) | Missing | Not in the RFP rows. Evidence and job history exist as inputs. |
| Client accounts, tickets, discussions, shared-file visibility | Missing | PRD portal is read-only; B Project row already lists "portal" as missing. |
| Drawings shared with the client before manufacturing | Missing | Depends on controlled documents. |
| Per-component traceability including sub-assemblies | Missing | Beyond D2 baseline; I Traceability row. |
| Returnable material sent for cutting, receipt stamp | Missing | Not assessed against inventory. |
| Attendance fed to payroll; thumbprint plus RFID; no phones; tablet face scan floated | Not assessed | O HR row. Machine model and export or API unconfirmed; payroll excluded (D7). |
| Hindi and English labels on Android for shop-floor staff | Missing | D7 deferral conflicts with this ask. |

## Preflight checks closed on 2026-10-18 (stop/go inputs for M1)

| Check | Result | Level |
|---|---|---|
| All BOM write paths | Three Prisma writes, all in `manufacturing/bom.ts` (`create`, `createMany`, `update`). No raw SQL touches `manufacturing_bom`. No code path edits `custom_fields` after creation. Seed scripts create BOMs through commands. No database guard exists today. | Reviewed (grep over `src/` and the repo's TypeScript) |
| Stock movement immutability | `inventory_stock_movement` has insert-only RLS policies plus a `BEFORE UPDATE OR DELETE` trigger calling `verity.reject_mutation()`: UPDATE is refused for everyone; DELETE is refused except for a role that is superuser or bypasses RLS. Corrections are reversal rows (manufacturing cancel writes an offsetting `Adjustment`). **Caveats:** `inventory_stock_balance` is a mutable projection kept in step by the same transaction, not by a trigger, so a code path that wrote only one of the two could drift; TRUNCATE is not guarded. | Reviewed (migration and function source read in the local database); cancel reversal Test-verified |
| M1 backfill dry-run | On a disposable copy of the local database (3 BOMs, 18 lines, 6 orders referencing a BOM): counts unchanged after backfill (3 / 18 / 6), no orphan orders; rerun is clean; the application role is refused on every immutable path; draft, release, supersede and edit-after-release behave as designed; existing orders keep their original revision; rollback restores columns and counts; tenant teardown still cascades. The data is local test data, not production volume. **Finding:** after M1, `createBom` must create drafts, so existing tests and the seed that create a BOM and immediately build an order must release it first. | Test-verified by hand-run SQL (scripts in session scratchpad, not in the repo) |
| QC gate fails closed | Not built. Designed in ADR-047 section 6. | Design only |

## Test status, accurately recorded

Run 1 (2026-10-18, before any change): 70 passed, 1 failed. The failure was `capability-inventory.test.ts`
"an outlet asks for stock…". Verified behaviour: the command still refuses approval without a source location;
only its wording changed deliberately in commit `d398eff1` ("location", not "outlet"). The assertion was updated in
a separate one-line commit (`7dac9538`) and that file now passes 10 of 10. The other seven files were not rerun,
and the full suite was not run: "70 + 1" is a focused subset, not a green suite.

## Environment note

The local test database runs in Docker (a container on `127.0.0.1:55432`); Docker Desktop had to be started by
hand. That is a developer environment dependency only. It is not evidence that DSEW's Windows Server 2019
deployment will work (decision D3).

## What is still unverified or blocked

- Nothing here is client-validated. Every behaviour needs a walk-through against DSEW's real job and documents.
- Hindi, e-way bill, Tally, attendance: not assessed against code.
- Remaining Phase 1 gates (fail-closed QC, document capability, test records): designed, not built.
