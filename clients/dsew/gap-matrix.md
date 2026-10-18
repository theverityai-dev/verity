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

## What is still unverified or blocked

- Nothing here is client-validated. Every behaviour needs a walk-through against DSEW's real job and documents.
- Whether any path other than the BOM commands can change BOM lines or custom fields (generic entity edit): not checked.
- Whether stock movement rows are protected by an append-only trigger (the checkpoint results are): not checked.
- Hindi, e-way bill, Tally, attendance: not assessed against code.
