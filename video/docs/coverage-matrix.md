# Verity for Manufacturing film: module coverage and product-accuracy matrix

Status: written 2026-10-21 against `main` at `73d76534` (branch `dsew`). Every "Shown" row was checked
against the source file named in the Evidence column during discovery. Nothing here is a claim about
production configuration of any client: the film uses a fictional company and synthetic data
(`src/content/fixture.ts`).

## Legend

| Status | Meaning |
|---|---|
| **Shown** | On screen as working product behaviour, and that behaviour exists in the code named. |
| **Shown, illustrative** | The mechanism exists; the specific words or layout on screen are illustrative (model output, or a page whose exact layout was not copied). |
| **Not shown, not built** | Requested by the brief; not in the code. The film does not depict or imply it. |
| **Not shown, omitted** | Exists in the code, left out for length or focus. |

Wording rule used throughout: if the code does not do it, no frame, caption or line of narration says it does.

## Lifecycle coverage (the brief's sections A to S)

| Brief | Capability | Status | Scene | Evidence (source) | Notes |
|---|---|---|---|---|---|
| A | Customer record, enquiry opens a job | Shown | s03, s04 | `project/jobs.ts` (`createJob`, enquiry state), `trading` customer master | The job starts in `enquiry`. |
| A | CRM pipeline: deals by stage with value, weighted forecast, overdue follow-ups | Shown | s12p | `relationship/index.ts`, `/crm/opportunities` (Task 128, `DEFAULT_STAGES`) | Task 128 stages 0-4 are built and tested on the local database; not yet on production (Task 128 status). |
| A | A deal's stage track and logged timeline (calls, follow-ups, stage moves) | Shown | s12p | `relationship/activity.ts`, `/crm/opportunities/[id]` | Interactions are never rewritten, only archived. |
| A | A won deal opens a job carrying name, contact and value | Shown | s12p | `project/opportunity-link.ts` `openJobFromOpportunity`; sheet copy from `crm-ui.tsx` `OpenJobButton` | Once per deal; the job starts as an enquiry. J-0142 itself is shown from its enquiry, so its chronology is unchanged. |
| A | Custom fields, duplicate merge, stage playbooks, pipeline insights | Not shown, omitted | — | Task 128 stages 3-4 | Left out for length. |
| A | Email and calendar sync | Not shown, not built | — | ADR-052 PROPOSED | |
| A | Customer communication history, customer portal | Not shown, not built | — | `clients/dsew/gap-matrix.md` row "Client accounts, tickets" | |
| B | Quote revisions, earlier revision replaced | Shown | s04 | `project/jobs.ts` `addQuoteRevision` | |
| B | Approved value fixed on the job | Shown | s04 | `project/jobs.ts` `approveQuote` (snapshot) | "Order value · From the approved quote" is the product's tile wording. |
| B | Cost categories in a quote, margin at quote time, quote approval workflow | Not shown, not built | — | gap matrix row C | Quote lines are plain lines. |
| C | Tasks with prerequisites, milestones with due dates | Shown | s05 | `project/work.ts` `addTaskDependency`, `setTaskState` (refuses start while a prerequisite is open), `addMilestone` | |
| C | Planned vs actual Gantt, task owners, risk register | Not shown, not built | — | `clients/dsew/demo-guide.md` §4 | |
| D | Controlled document: numbered, revised, released, superseded | Shown | s06 | `document/index.ts` (ADR-048) `startRevision`, `submitRevision`, release supersedes previous | Document capability is off by default per tenant ("dark by default"). |
| D | Exact revision linked to job and order ("Relied on by") | Shown | s06 | `document/index.ts` `documentsFor`, `LINKABLE_ENTITIES` | |
| D | Opens and downloads logged | Shown | s06 | `document/[id]/page.tsx` "Every opening is logged here" | |
| D | Drawing viewer inside Verity | Not shown, not built | — | ADR-048 defers viewers | The drawing appears as a paper sheet that becomes R02's attached file. |
| D | CAD integration, OCR, full-text search, transmittals, e-signatures | Not shown, not built | — | ADR-048 "NOT BUILT" | |
| E | BOM, per-unit lines scaled and copied onto the order | Shown | s06 | `manufacturing/bom.ts` `createOrderFromBom` | Copy means a BOM change never rewrites an existing order. |
| E | Multi-level BOM, BOM revisions with approval | Not shown, not built | — | ADR-047 PROPOSED, not built; `bom.ts` single level | |
| F | Planning, finite capacity, scheduling optimisation, MRP | Not shown, not built | — | gap matrix rows F, L | |
| G | Purchase order over the approval limit waits for approval | Shown | s07 | `inventory/procurement.ts` `DEFAULT_PO_APPROVAL_THRESHOLD_PAISE` (₹25,000), `PendingApproval` | Approval panel layout is illustrative. |
| G | Partial and full receipt | Shown | s07 | `procurement.ts` `receiveGoods`, `PartiallyReceived` | |
| G | Requisitions, supplier quotation comparison, three-way match | Not shown, not built | — | gap matrix row J | |
| H | Stock hold for an order, all or nothing, refusal names the short item | Shown | s07 | `manufacturing/batch.ts` `reserveOrder` (message at line 97, quoted on screen) | |
| H | Stock ledger, append-only movements | Not shown, omitted | — | `inventory/ledger.ts` | Implied by consumption; not given its own shot. |
| H | Lot, heat or serial numbers; material genealogy | Not shown, not built | — | gap matrix row I; schema has no lot field | Traceability in the film is order, revision, checks and passport, never lots. |
| H | Incoming inspection | Not shown, not built | — | gap matrix row H | |
| H | Barcode scanning of stock | Not shown, not built | — | no scanner code in `src/` | The only scan is the public passport QR, read by a phone camera. |
| I | Shop floor queue by stage | Shown | s08 | `manufacturing/stages.ts` `operationQueue`; `/manufacturing/floor` | Layout follows the 1440px reference screenshot. |
| I | A stage cannot start before the previous is done | Shown | s08 | `stages.ts` `startOperation` | |
| I | Machine telemetry, IoT, automatic attendance capture | Not shown, not built | — | — | |
| J | Measured checks with units and limits | Shown | s09 | `stages.ts` `withinMeasure`, `readReadingPayload` (commit `8359b32f`) | |
| J | Failed check blocks completion; send back for rework; fail stays on record | Shown | s09 | `stages.ts` `completeOperation`, `send_back`, append-only `ManufacturingCheckpointResult` | Rework appends the route again, hence "Stage 8 of 10". |
| J | Photo evidence captured on a phone, valid only for this operation | Shown | s09, s10 | `evidence/index.ts` `reserveEvidenceFile`; `stages.ts` evidence must be about this operation (commit `58e32441`) | |
| J | NCR, CAPA, calibration register, ITP | Not shown, not built | — | gap matrix row H | |
| K | Engineered-to-order work as a project | Shown | s03-s11 | the job, BOM, route, checks above | |
| L | Attendance records, leave | Not shown, omitted | — | `attendance/index.ts`, `hr/index.ts` | Built for another client; not linked to job labour, so not shown as costing. |
| L | Attendance hardware (thumbprint, RFID, face) | Not shown, not built | — | gap matrix 2026-10-19 rows | |
| M | Summary-first test report | Shown | s10 | `manufacturing/documents.ts` `loadTestReport`; `test-report/page.tsx` wording | |
| M | Dispatch needs a completed order and a packaging photo; vehicle, transporter, tracking | Shown | s10 | `manufacturing/logistics.ts` `dispatchOrder` | |
| M | Public verification passport: minimal, labels only | Shown | s10 | `passport.ts` `passportSnapshotSchema` (ADR-030) | The QR on screen is drawn, not encoded. |
| M | Warranty, complaints for manufacturing | Not shown, not built | — | `complaint` is a restaurant capability | |
| N | Job cost from records: agreed value, material (estimate), labour, other; margin derived | Shown | s11 | `project/reads.ts` `jobCosting`; `project/index.ts` header | Material is "an estimate" (moving average), stated on screen. |
| N | Invoices and receipts recorded against the job | Shown | s11 | `project/billing.ts` | Recorded, not computed; stated on screen. |
| N | Project file: one printable record | Shown, illustrative | s11 | commit `3ab88435` (`jobs/[id]/project-file`) | Pages are drawn as paper; their contents are not reproduced. |
| N | Tally integration, GST invoice generation from a job, full accounting | Not shown, not built | — | gap matrix row N; `project/index.ts` "NOT built" | Narration says "recorded", never "synced". |
| O | Summary: confirmed orders, quotes waiting, enquiries, late, shop floor, running short | Shown | s12 | `summary/page.tsx` labels | |
| O | Figures open their records | Shown | s12 | `StatTile` `href`, `summary/page.tsx` links | |
| O | Trend charts, utilisation, supplier scorecards | Not shown | — | `TrendChart` has no data source (Task 115) | No chart in the film invents history. |
| P | Role permissions; release is its own grant; self-release needs grant and reason | Shown, illustrative | s14 | `document/index.ts` (`verity.document.release`, `self_release`) | The roles panel layout is illustrative; the grants are real. |
| P | Attributed history | Shown | s14 | `platform/audit.ts`, `AuditTrail` | |
| P | Notifications and escalations | Not shown, omitted | — | ADR-039 outbox | Manufacturing triggers are not wired. |
| Q | Assistant answers from what the role can read; flags unconfirmed claims; confirms before repeated actions | Shown, illustrative | s13 | `platform/agent-chat.ts` (ADR-017), `AgentChatDock.tsx` (intro copy, "Double-check: … not confirmed against a query this turn", Confirm/Cancel) | The answer text is model output, written for the film. |
| Q | Document retrieval, missing-document detection, quote drafting, local models | Not shown, not built | — | — | |
| R | Tenant isolation, roles, audit | Partly shown (roles, audit) | s14 | `platform/tenancy.ts` (RLS) | Isolation is not claimed on screen. |
| R | On-premises, offline, certifications | Not shown | — | ADR-031: Mode A only; Mode B/C not promised | The film makes no deployment claim. |
| S | Integrations (Tally, attendance devices, scanners, email) | Not shown, not built | — | — | |

## DSEW-derived requirement categories, mapped to the generic film

DSEW (D & S Electric Works) is not named, depicted or imitated. Its categories map to generic scenes:
engineering documentation and revision control → s06; BOM → s06; procurement → s07; inventory →
s07; shop-floor execution → s08; QC and testing with measured readings → s09, s10; dispatch and
passport → s10; project costing → s11; reporting → s12; AI-assisted search → s13 (assistant over
records, not document search); enquiries and tender tracking → s12p (the CRM pipeline). Not covered because not built: Tally, attendance devices, Hindi
labels, lot/heat genealogy, client portal, BOM revisions.

## On-screen data that is invented, by design

Company, customer, vendor, transporter, people, numbers, dates, the vehicle plate (`MH 00 …`, a
non-existent registration series), the assistant's answer, and the QR symbol. All in
`src/content/fixture.ts` or the scene that draws them.
