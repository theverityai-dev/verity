<!-- converted from Garment_Lot_PRD.docx -->

Verity | Product Management
Garment Lot & Karigar Management: PRD
Product Requirements Document for a garment manufacturing client: lot tracking from Fabric Inward to Ready Garment Inventory, with a karigar (piece-rate worker) ledger.
Internal working document for the Verity team. Not for the client. It contains Verity capability gaps.
# 0. Document control

Change log: v0.1, 21 Oct 2026, first full draft: 35 requirement IDs traced, fit classified against the workbook, phasing and open questions proposed.
Inputs not supplied or used with limits. (1) The client-facts line in the brief was left as a template placeholder, so no business name, karigar count, munshi count, lots per month, pieces per lot, current method or device is known. All of these are OPEN QUESTION (owner: Founder or client contact). (2) DSEW_PRD-1.docx was used for style and structure only; no DSEW content is reused. (3) The client requirement was supplied in Hindi and is translated faithfully into English in the Appendix.
# 1. Summary and decisions needed from the founder
What the client wants. [VERIFIED] A garment business wants software that follows each Lot (one batch of cloth cut and made into garments under one number) through seven stages, records pieces issued, received and pending at every stage, keeps a per-piece wage ledger for each karigar (a skilled worker paid per piece), and gives the owner a dashboard and Excel reports. The munshi (the clerk who keeps the records) is the only person who enters data. Size tracking and dispatch are out.
What the workbook says. The workbook has a Garment Manufacturers business page, but it describes a buyer-order and shipment-date business (styles, size ratios, line output, buyer approvals). This client works on a lot and karigar piece-rate model. The page does not cover karigar wages, advances or per-stage issue/receive counts. The closest product pieces are Production Orders and Routes (M101, M102), Shop-floor Console (M103), Batches & Lot Tracking (M104), Stock Ledger (M048), Locations (M030), Roles (M002) and Dashboards (M018). Subcontracting / Job Work (M111) is Planned and not built.
Result of the fit check (35 requirement IDs). 15 CONFIGURATION, 12 CUSTOMIZATION, 8 UNCLEAR. 0 EXISTING, 0 ROADMAP, 0 NOT SUPPORTED. Nothing is EXISTING because the workbook has no garment lot or karigar ledger capability as such; every item needs set-up or build work.
## Decisions needed from the founder
- Approve the client-first sequence. Send the requirement summary and the visual blueprint to the client for approval before any build or demo work starts, as your note says.
- Accept the capability position. Karigar piece-rate wages, issue/receive/pending counts, automatic bundle counts, lot costing and Excel export are CUSTOMIZATION or UNCLEAR. Do not promise any of them in a demo or call until Product/Tech confirms.
- Choose the demo approach. Option A: configure Verity for the CONFIGURATION items and show sample screens for the rest. Option B: build the whole slice. Engineering has to size this; this PRD gives no effort or timeline.
- Decide how to use the Garment Manufacturers page. PM recommendation: do not use it as the basis for this client. Treat the client as a job-work and piece-rate flow.
- Decide whether this client is a design partner. The workbook says wider manufacturing work (T118, including job work M111) waits on a named design partner. This is a Product decision; nothing is implied to the client.
- Supply the client facts left blank in the brief (business name, karigar and munshi counts, lots per month, pieces per lot, current method, device).
# 2. Client context and known facts
Terms are kept in the client's own words and explained once here. Lot: one batch of cloth cut and made into garments together, tracked under one number. Karigar: a skilled worker, here paid per piece. Munshi: the clerk who writes the records. Button / Kaj: attaching buttons and making buttonholes (Kaj means buttonhole work). Press: ironing and pressing. Bundle: a counted pack of pieces that moves together; the client has not defined it (OPEN).
## Workbook lookup (what was searched and found)
Searched for: garment, apparel, stitching, textile, job-work, piece-rate, lot, bundle, karigar, wages, Hindi. Found: M104 Batches & Lot Tracking (Live); M111 Subcontracting / Job Work (Planned, not built); a Garment Manufacturers business page (suggested package Verity Production, buyer-order oriented, Work and Communication marked Partial); karigar appears only in Jewellery Stores pages (karigar assigned to an order, material issued to karigars not yet returned). Not found: piece-rate, wages ledger for workers, bundle, munshi, Hindi or any language support, Excel export of reports.
# 3. Scope in/out and goals

Goals [HYPOTHESIS, to confirm with the client]: (1) know where every lot is and how long it has waited; (2) know exactly how many pieces are with each karigar; (3) calculate what each karigar is owed without disputes; (4) give the owner one screen instead of asking the munshi.
Proposed success measures [HYPOTHESIS]: the munshi can enter a day of issue/receive entries without help; the karigar balance matches the karigar's own count; the owner can answer the seven dashboard questions without asking anyone.
OPEN QUESTION (owner: Founder). Dispatch is excluded, so nothing in this software reduces ready stock. How should ready stock leave the system, if at all? This affects whether the Ready Inventory figure stays correct over time.
# 4. Users and roles
Workbook basis: Users, Roles & Permissions (M002) allows role and field-level permissions; Audit Trail (M004) records who changed what. Whether the owner also wants to enter data, or whether karigars want to see their own balance on a phone, is OPEN QUESTION (client).
# 5. Process flow, stage by stage
Common logic for stages from Cutting to Press [HYPOTHESIS]: Issued = pieces handed to the stage or karigar. Received = pieces returned finished. Pending = issued minus received. Pieces received at one stage become available to issue at the next. The time a lot spends in a stage runs from its first issue to its last receive. Exceptions common to every stage (shortage, rejection, rework, a lot split or merge) are OPEN QUESTION (client) and shown as 'OPEN' below.
Workbook fit for the flow: stages as routes and operations (M101, M103), lots as batches (M104), stock movement (M048), timestamps (M103, M004). The per-stage issued/received/pending account is the main build item.
# 6. Functional requirements by area
Source column refers to the client sentences S1 to S8 translated in the Appendix. Fit is colour-coded. Priority and phase are PM proposals: P0 needed for a usable first version, P1 important, P2 later. Phase 1 = demo slice and first release, Phase 2 = dashboard and reports, Phase 3 = costing.
## Lot (lot creation, number, design, pieces, stage, location)
Acceptance criteria. A lot can be created with a unique number, design and total pieces. The lot register shows current stage and location for every lot. Numbers never repeat.
## Stage tracking (issued, received, pending, time)
Acceptance criteria. For each lot and stage, the munshi can record issue and receive entries. Pending equals issued minus received on screen. Start, end and days spent are shown per stage.
## Worker / Karigar ledger
Acceptance criteria. A karigar record holds name, mobile, work type and rate. The ledger shows material given and returned, total wages, advance, payments and balance due, and the balance updates after each entry.
## Data entry and bundles
Acceptance criteria. Only the Munshi role can enter data. No screen asks for size. Bundle count appears automatically when pieces are entered, once the rule is agreed.
## Ready Garment Inventory and scope
Acceptance criteria. Ready stock is visible lot-wise. Fabric Inward is the first step and Ready Inventory the last. No dispatch screen exists.
## Dashboard
Acceptance criteria. The owner sees the seven items on one screen, each matching its definition in section 8.
## Reports
Acceptance criteria. Each of the four reports opens on screen and downloads to Excel with the columns in section 8.
# 7. Data model
Key entities and fields. Fields marked OPEN depend on client answers. Names are working names, not final.
Workbook basis: Party model for people (M001), custom fields (M009), stock ledger (M048), audit trail (M004). Entities such as Rate, Issue / Receive entry and Bundle are not described in the workbook and would be new (CUSTOMIZATION or UNCLEAR).
# 8. Dashboard and report specs
## Dashboard metrics
## Reports and proposed Excel columns
Excel export is UNCLEAR in the workbook (GAR-RPT-05). Standard reports exist (M021) but there is no custom report builder (M160, Planned).
# 9. Wage and balance logic
Stated by the client [VERIFIED]: the ledger shows rate per piece, material given and returned, total wages, advance, payment and balance due. The client has not stated the calculation.
Proposed formula [HYPOTHESIS, to confirm]:
- Wage for one entry = pieces received (accepted) x rate per piece for that work type.
- Total wages = sum of wages for the karigar.
- Balance due = total wages minus advance minus payments.
Sample, illustrative only. Karigar A, stitching at Rs 12 per piece. Lot 1: 150 pieces returned = Rs 1,800. Lot 2: 100 pieces returned = Rs 1,200. Total wages Rs 3,000. Advance Rs 500. Payment Rs 1,000. Balance due Rs 1,500.
Flagged assumptions (each is OPEN QUESTION, owner: client): wages paid on received or on issued pieces; deductions for rejected, short or reworked pieces; whether advance is recovered in full from the next wages or in instalments; whether rate changes apply to old work; whether finishing and press are also paid per piece; rounding.
# 10. Non-functional requirements
# 11. Gap analysis vs workbook
# 12. Open questions for the client
Prioritised, in plain language. Each includes the default PM assumption used in the blueprint. Owner for all: client (via founder).
Founder-level (not for the client): how ready stock leaves when dispatch is excluded; whether this client is a design partner (see section 1).
# 13. Phasing proposal and the demo slice
No timelines or effort are stated here; Engineering sizes the work.
## Demo slice (proposed)
- One sample lot (design D-101, 500 pieces) created by the munshi.
- Issue to and receive from two sample karigars in Stitching; pending updates live; bundles appear automatically.
- Karigar ledger shows wages, advance, payment and balance for one karigar.
- Ready stock shows the finished pieces lot-wise.
Everything uses sample data. Items that are CUSTOMIZATION or UNCLEAR are shown as sample screens unless Engineering confirms otherwise.
# 14. Risks and assumptions
Next step after client approval: a PM-to-Tech handoff for each CUSTOMIZATION item, using the standard Verity handoff format.

# Appendix: requirements traceability table
Total: 35 requirement IDs. Fit counts: CONFIGURATION 15, CUSTOMIZATION 12, UNCLEAR 8, EXISTING 0, ROADMAP 0, NOT SUPPORTED 0. By area: LOT 8, WRK 8, DAT 3, INV 1, DSH 7, RPT 5, SCP 3.
## Client sentences, translated
## Traceability
| Item | Detail |
| --- | --- |
| Document | Garment Lot & Karigar Management: Product Requirements Document (PRD) |
| Version / status | v0.1, DRAFT. Priorities and phases are PM proposals for founder review. Nothing here is a commitment to the client. |
| Date | 21 October 2026 |
| Owner | Verity Product Management (Product Manager, name to be added) |
| Primary readers | Founder (approval), then Engineering and Design |
| Capability authority | PlotArmour Pricing - Master Reference.xlsx (refreshed 2026-10-06). If this PRD and the workbook disagree, the workbook wins. Module IDs (M###) refer to its Modules tab. |
| Companion artefacts | Garment_Visual_Blueprint.pdf (client-facing, 10 pages) and Garment_Blueprint_Flow.png (page 2 for WhatsApp). |
| Evidence tags | VERIFIED = stated by the client. HYPOTHESIS = PM's reasoned guess, to be confirmed. OPEN QUESTION = unknown, with an owner. |
| Fit tags | EXISTING, CONFIGURATION, CUSTOMIZATION, ROADMAP, NOT SUPPORTED, UNCLEAR. Roadmap is never treated as Existing. If the workbook does not establish a capability, it is UNCLEAR. |
| Wording rules | This document says counter billing, payroll inputs and GST return preparation. It quotes no prices, timelines or commitments. |
| Fact | Status | Source / owner |
| --- | --- | --- |
| Business makes garments in lots and pays karigars per piece | VERIFIED (implied by the requirement) | Client text |
| Seven stages after Fabric Inward: Lot Creation, Cutting, Stitching, Button / Kaj, Finishing, Press, Ready Garment Inventory | VERIFIED | Client text |
| Only the munshi enters data; no size tracking; bundle count automatic | VERIFIED | Client text |
| Dispatch is not wanted | VERIFIED | Client text |
| Business name, location, number of karigars and munshis | OPEN QUESTION | Founder / client contact |
| Lots per month, pieces per lot, number of designs | OPEN QUESTION | Founder / client contact |
| Current method (register, Excel, other) | HYPOTHESIS: paper register or Excel, because this is the usual starting point | Client contact |
| Device the munshi uses; internet at the workplace | OPEN QUESTION | Client contact |
| Does anyone besides the munshi need to see data (owner, manager)? | HYPOTHESIS: owner views the dashboard and reports | Client contact |
| In scope [VERIFIED] | Out of scope [VERIFIED] |
| --- | --- |
| Fabric Inward
Lot Creation, Cutting, Stitching, Button / Kaj, Finishing, Press
Ready Garment Inventory (lot-wise)
Lot management: unique number, design, total pieces, current stage and location, issued/received/pending, time per stage
Worker (karigar) management: master, rate, material given/returned, wages, advance, payment, balance
Dashboard (7 items) and Reports (4 reports, Excel export) | Dispatch
Size tracking
Anything not written in the client requirement (any useful addition is listed only under Open Questions) |
| Role | Does what | Access | Evidence |
| --- | --- | --- | --- |
| Munshi | Enters every record: fabric inward, lots, issue and receive, advances, payments | Create and edit (only role that can) | VERIFIED |
| Owner / manager | Views dashboard, lot status, karigar balances and reports; downloads Excel | View only | HYPOTHESIS |
| Karigar | Receives work and wages; does not use the software | No login | HYPOTHESIS |
| Verity admin (internal) | Configures the workspace, roles and fields | Set-up only | Verity process |
| Stage | Trigger, actor, inputs, actions | Outputs, pieces logic, time, exceptions |
| --- | --- | --- |
| Fabric Inward | Trigger: fabric arrives. Actor: Munshi. Inputs: OPEN (supplier, fabric type, quantity and unit, date, bill reference). Action: record the arrival. | Output: a fabric inward record that a lot can be created from. No piece counts (it is fabric). Time: date and time of entry. Exception: short or damaged fabric, OPEN. |
| Lot Creation | Trigger: fabric is ready to become a lot. Actor: Munshi. Inputs: design, total pieces, link to fabric inward (OPEN). Action: create the lot; the system assigns a unique number. | Output: lot record (GAR-LOT-02 to 04). Pieces: total set, all pending. Time: lot start. Exception: total changes after cutting; split or merge, OPEN. |
| Cutting | Trigger: lot created. Actor: Munshi records; cutting done by a cutter (a karigar or in-house, OPEN). Inputs: lot, who cuts. Actions: issue the lot for cutting; receive cut pieces. | Output: cut pieces; bundles formed automatically (rule OPEN). Pieces: issued, received, pending. Time: first issue to last receive. Exception: cut count lower than total, fabric shortage, OPEN. |
| Stitching | Trigger: cut pieces available. Actor: Munshi records; karigar stitches. Inputs: lot, karigar, pieces. Actions: issue to a karigar; receive stitched pieces. | Output: stitched pieces and a wage line for the karigar. Pieces: per karigar and per lot. Time: per stage and per karigar. Exception: rejection, rework, partial returns, one lot with several karigars, OPEN. |
| Button / Kaj | Trigger: stitched pieces available. Actor: Munshi records; karigar does Kaj or button work. Inputs and actions: as Stitching. | Output: finished button/Kaj pieces and a wage line. Pieces and time: as Stitching. Exception: as Stitching. |
| Finishing | Trigger: Button / Kaj pieces available. Actor: Munshi records; karigar finishes. Inputs and actions: as Stitching. | Output: finished pieces and a wage line (if finishing is paid per piece, OPEN). Pieces and time: as Stitching. |
| Press | Trigger: finished pieces available. Actor: Munshi records; presser. Inputs and actions: as Stitching. | Output: pressed pieces and a wage line (if paid per piece, OPEN). Pieces and time: as Stitching. |
| Ready Garment Inventory | Trigger: pieces received at Press. Actor: Munshi. Action: record pieces into ready stock under the lot. | Output: lot-wise ready stock and ready bundles. Time: date pieces became ready. Exception: how stock leaves, because dispatch is excluded, OPEN. |
| ID | Requirement | Source | Fit | Workbook ref | Pri | Phase | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LOT-01 | Seven stages configured as one fixed route that every lot follows, after Fabric Inward (see GAR-SCP-01). | S1 | CONFIGURATION | M101, M102, M005 | P0 | 1 | Whether a lot may skip, repeat or revisit a stage is OPEN (client). |
| LOT-02 | Each lot gets a unique, never-reused lot number visible on every screen and report. | S2 | UNCLEAR | M104 (nearest) | P0 | 1 | M104 groups production into batches; the workbook does not state a unique user-visible lot number or numbering format. Product/Tech to confirm. Numbering format OPEN (client). |
| LOT-03 | Lot holds a design reference (name or code). | S2 | CONFIGURATION | M104, M009, M042 | P0 | 1 | Design as catalogue item or free field is OPEN. No size breakdown (GAR-DAT-02). |
| LOT-04 | Lot holds the total piece count. | S2 | CONFIGURATION | M102, M104, M009 | P0 | 1 | Whether the total is fixed at creation or corrected after cutting is OPEN. |
| LOT-05 | Lot register and lot detail show the current stage. | S2 | CONFIGURATION | M005, M101, M103 | P0 | 1 | HYPOTHESIS: when pieces of one lot sit at different stages, show the earliest stage that still holds pending pieces, plus a per-stage view. |
| LOT-06 | Lot register and lot detail show where the lot physically is. | S2 | UNCLEAR | M030, M009 (nearest) | P1 | 2 | M030 covers sites and godowns; the workbook does not establish floor, table, karigar or outside job-worker as a location. Meaning of 'location' is OPEN (client). |
| ID | Requirement | Source | Fit | Workbook ref | Pri | Phase | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LOT-07 | At each stage, per lot (and per karigar), record pieces issued, pieces received and show pieces pending. | S2 | CUSTOMIZATION | M101, M103, M048 (base); M111 is ROADMAP | P0 | 1 | M111 (Subcontracting / Job Work) is Planned, not built, so it cannot be relied on. HYPOTHESIS: pending = issued minus received. Rejection, shortage and rework handling OPEN. |
| LOT-08 | Start time, end time and days spent recorded for each lot at each stage. | S2 | CONFIGURATION | M103, M004, M008 | P1 | 2 | Calendar days or working days is OPEN. Stage timestamps rely on entries made by the munshi. |
| ID | Requirement | Source | Fit | Workbook ref | Pri | Phase | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WRK-01 | Karigar master with name and mobile number. | S3 | CONFIGURATION | M001, M009, M041 | P0 | 1 | Whether a karigar is held as a supplier/job-worker record (M041) or an employee record (M080) is OPEN. Mobile number would be a custom field. |
| WRK-02 | Each karigar has one or more work types (for example stitching, Kaj). | S3 | CONFIGURATION | M101, M009 | P0 | 1 | HYPOTHESIS: work types map to the stages. Whether one karigar can hold several work types is OPEN. |
| WRK-03 | A rate per piece for each karigar and work type. | S3 | CUSTOMIZATION | M041, M049 (nearest: price sets) | P0 | 1 | Piece-rate is not established in the workbook. Rate by design, and rate change dates, are OPEN. |
| WRK-04 | Per karigar: pieces given (issued) and pieces returned (received), by lot and stage. | S3 | CUSTOMIZATION | M048, M101 (base); M111 is ROADMAP | P0 | 1 | Same engine as GAR-LOT-07, viewed per karigar. |
| WRK-05 | Total wages per karigar, calculated from pieces and rate. | S3 | CUSTOMIZATION | M041, M045 (nearest); M083 does not fit | P0 | 1 | M083 Payroll Inputs is attendance-based and does not cover piece-rate. Formula is HYPOTHESIS (section 9). |
| WRK-06 | Record advances given to a karigar. | S3 | CUSTOMIZATION | M045, M062 (nearest) | P0 | 1 | How an advance is recovered against wages is OPEN. |
| WRK-07 | Record payments made to a karigar. | S3 | CONFIGURATION | M062, M045 | P0 | 1 | M062 covers vendor payments. Needs confirmation that a karigar can be a vendor/party record (OPEN, Tech). |
| WRK-08 | Balance due per karigar, always current. | S3 | CUSTOMIZATION | M041, M045 (nearest) | P0 | 1 | Balance = total wages minus advance minus payments (HYPOTHESIS). Deductions OPEN. |
| ID | Requirement | Source | Fit | Workbook ref | Pri | Phase | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DAT-01 | Only the Munshi role can create or change records; every change is logged. | S4 | CONFIGURATION | M002, M004 | P0 | 1 | HYPOTHESIS: owner/manager is view-only; karigar has no login. Confirm with client. |
| DAT-02 | No size fields anywhere. Quantities are counted in pieces only. | S4 | CONFIGURATION | M009 | P0 | 1 | Verity's generic garment page uses size ratios; that is deliberately not used here. |
| DAT-03 | Bundle count calculated by the system from pieces entered; the munshi does not count bundles. | S4 | UNCLEAR | None in workbook | P1 | 1 | No bundle entity or auto-count is described in the workbook. Bundle definition and numbering are OPEN (client). |
| ID | Requirement | Source | Fit | Workbook ref | Pri | Phase | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| INV-01 | Ready stock held and shown by lot (and design). | S5 | CONFIGURATION | M048, M060, M104 | P0 | 1 | How ready stock leaves is OPEN, because dispatch is excluded (GAR-SCP-03). |
| SCP-01 | Fabric Inward is the entry point of the software. | S8 | CONFIGURATION | M046, M048, M011 | P0 | 1 | What Fabric Inward captures is OPEN (client). |
| SCP-02 | Ready Garment Inventory is the last step. | S8 | CONFIGURATION | M011, M048 | P0 | 1 | Nothing is recorded after Ready Inventory. |
| SCP-03 | Dispatch is excluded and stays switched off. | S8 | CONFIGURATION | M011; M107 stays inactive | P0 | 1 | M107 Dispatch exists in the product but is not activated for this client. |
| ID | Requirement | Source | Fit | Workbook ref | Pri | Phase | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DSH-01 | Count and list of lots not yet fully in ready stock. | S6 | CONFIGURATION | M018, M102, M104 | P1 | 2 | Definition of 'active' is HYPOTHESIS. |
| DSH-02 | Total pending pieces at each stage across active lots. | S6 | CUSTOMIZATION | M018 (base) | P1 | 2 | Depends on GAR-LOT-07. |
| DSH-03 | Pieces currently with each karigar. | S6 | CUSTOMIZATION | M018 (base) | P1 | 2 | Depends on GAR-WRK-04. |
| DSH-04 | Number of ready bundles in stock. | S6 | UNCLEAR | None in workbook | P1 | 2 | Depends on the bundle definition (GAR-DAT-03). |
| DSH-05 | Cost per lot. | S6 | UNCLEAR | None in workbook | P2 | 3 | What cost includes (fabric, wages, other costs) is OPEN (client). No lot costing module in the workbook. |
| DSH-06 | Total and per-karigar balance due. | S6 | CUSTOMIZATION | M018 (base) | P1 | 2 | Depends on GAR-WRK-08. |
| DSH-07 | Days since each lot last moved. | S6 | CUSTOMIZATION | M018, M008 (base) | P1 | 2 | HYPOTHESIS: 'stuck' = days since last issue or receive entry. Threshold OPEN. |
| ID | Requirement | Source | Fit | Workbook ref | Pri | Phase | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RPT-01 | One report: production by lot and stage. | S7 | CUSTOMIZATION | M021 (base); M160 is ROADMAP | P1 | 2 | M021 has standard reports only; no custom report builder exists (M160 Planned). |
| RPT-02 | One report: wages, advances, payments and balance per karigar. | S7 | CUSTOMIZATION | M021 (base); M160 is ROADMAP | P1 | 2 | As above. |
| RPT-03 | One report: cost by lot. | S7 | UNCLEAR | None in workbook | P2 | 3 | Depends on the definition of costing (OPEN). |
| RPT-04 | One report: ready stock by lot. | S7 | UNCLEAR | M021, M048 (nearest) | P1 | 2 | M021 includes inventory reports; the workbook does not say they are lot-wise. |
| RPT-05 | Every report can be downloaded as an Excel file. | S7 | UNCLEAR | None in workbook | P1 | 2 | The workbook describes Excel import (M017) but does not establish Excel export of reports. Product/Tech to confirm. |
| Entity | Key fields | Relationships |
| --- | --- | --- |
| Lot | lot number (unique), design, total pieces, status (active/closed), created date, current stage (derived), location (OPEN), fabric inward link (OPEN) | Has many stage records, issue/receive entries, bundles; one ready stock line |
| Stage (master) | stage name, sequence (the seven stages), allowed work types | Has many stage records |
| Stage record (lot x stage) | pieces issued, received, pending (all derived), start time, end time, days spent (derived) | Belongs to one lot and one stage |
| Karigar | name, mobile, work types, active flag | Has many rates, entries, ledger entries |
| Rate | karigar, work type, rate per piece, effective-from date (OPEN) | Belongs to karigar |
| Issue / Receive entry | lot, stage, karigar, type (issue or receive), pieces, date and time, entered by (Munshi), remarks for shortage/rejection (OPEN) | Belongs to lot, stage and karigar; drives stage record, bundles and wages |
| Bundle | bundle number (rule OPEN), lot, pieces in bundle, bundle size rule (OPEN) | Derived from entries; belongs to lot |
| Payment / Advance entry | karigar, type (advance or payment), amount, date, note | Belongs to karigar; reduces balance due |
| Ready stock | lot, design, ready pieces, ready bundles, ready since | One per lot; fed by Press receive entries |
| Fabric inward record (OPEN) | date, supplier, fabric quantity and unit, bill reference | May link to a lot |
| User / role | name, role (Munshi, Owner) | Entered-by on every entry; audit trail |
| Metric | Definition (HYPOTHESIS unless noted) | Filters |
| --- | --- | --- |
| Active lots | Lots not yet fully moved into ready stock. Count and list. | Design, stage |
| Pending pieces at every stage | For each stage: sum of issued minus received across active lots. | Lot, design |
| Material with karigars | For each karigar: pieces issued to them minus pieces they returned. | Karigar, stage, lot |
| Ready bundles | Number of bundles in ready stock. Needs the bundle rule (OPEN). | Lot, design |
| Lot-wise costing | Cost per lot. Contents OPEN (fabric, wages, other costs). | Lot |
| Karigars' dues | Balance due per karigar and total. | Karigar |
| Days a lot has been stuck | Days since the lot's last issue or receive entry. Alert threshold OPEN. | Stage, lot |
| Report | Proposed Excel columns [HYPOTHESIS] |
| --- | --- |
| Lot-wise production | Lot number, design, total pieces, stage, issued, received, pending, stage start date, days in stage, location |
| Worker-wise payment | Karigar, mobile, work type, rate per piece, pieces given, pieces returned, total wages, advance, payments, balance due, period |
| Costing | Lot number, design, total pieces, fabric cost (OPEN), wages, other costs (OPEN), total cost |
| Ready inventory | Lot number, design, ready pieces, ready bundles, ready since |
| Area | Position | Fit / evidence |
| --- | --- | --- |
| Interface language (Hindi / English) | Not stated by the client. The workbook has no language or Hindi support information. | UNCLEAR. Product/Tech to confirm. OPEN QUESTION (client). |
| Device (desktop or mobile) | Not stated. Customization rates note the web app is responsive and a native app is not built. | UNCLEAR for munshi use on a phone. OPEN QUESTION (client). |
| Offline use | Offline Sync Runtime (M013) is Partial: runtime only, no installable shell or client queue screen. | ROADMAP-grade; not usable as a promise. UNCLEAR. |
| Speed | Not stated; the workbook has no measured performance results (enterprise readiness evidence not yet run). | UNCLEAR. |
| Data backup | Not established in the workbook. | UNCLEAR. Tech to confirm. |
| Security and audit | Workspace isolation per client (M001), audit trail on every record (M004), roles (M002). | Per workbook. Do not make enterprise-hardening claims (M015 note). |
| Notifications | In-app only (M007). WhatsApp, SMS and email channels are not built (M155). | Do not offer message alerts. |
| Data import | Excel import covers items, customers and suppliers only (M017, Partial). Orders, balances and ledgers are not importable. | Existing lot or karigar history cannot be assumed importable. |
| Need | Workbook evidence | Fit | Who confirms |
| --- | --- | --- | --- |
| Issued / received / pending per stage and per karigar | M101, M103, M048 give stages and stock movement. M111 Job Work is Planned, not built. | CUSTOMIZATION | Tech |
| Karigar piece-rate wage ledger with advance and balance | M041, M045, M062 give supplier and payment records. M083 Payroll Inputs is attendance-based. No piece-rate. | CUSTOMIZATION | Product / Tech |
| Automatic bundle count | Not described. | UNCLEAR | Product / Tech |
| Lot-wise costing | No costing module for lots. | UNCLEAR | Product / Tech |
| Unique user-visible lot number | M104 batches exist; numbering not stated. | UNCLEAR | Tech |
| Excel export of every report | Not established. No custom report builder (M160, Planned). | UNCLEAR | Product / Tech |
| Hindi or bilingual interface | Not established. | UNCLEAR | Product / Tech |
| Offline entry | M013 Partial, runtime only. | UNCLEAR | Tech |
| Import of existing registers | M017 imports items, customers, suppliers only. | UNCLEAR for lots and ledgers | Tech |
| Garment Manufacturers business page | Built around buyer orders and shipment dates; Work and Communication are Partial. | Not a fit for this flow | Founder / Product |
| # | Question | Why it matters | Assumption used |
| --- | --- | --- | --- |
| 1 | How is a bundle made and numbered? How many pieces go in one? | Bundle count is automatic and drives ready bundles. | Fixed pieces per bundle (sample: 20). |
| 2 | How are wages worked out? On pieces received or issued? What is deducted for rejected or short pieces? How are advances recovered? | The balance due must match what the karigar expects. | Wage = pieces received x rate; balance = wages minus advance minus payments. |
| 3 | What should lot-wise costing include: fabric, wages, other costs? | Costing cannot be built until this is known. | Shown as 'to confirm'. |
| 4 | What does 'location' mean: floor, table, karigar, or an outside job-worker? | Defines what is shown and entered. | Shown as 'with karigar'. |
| 5 | What happens when pieces are short, rejected or need rework? Is it recorded, and where? | Changes pending counts and wages. | Not recorded in the demo. |
| 6 | Can one karigar work on several stages or lots at the same time? | Affects the ledger and pending counts. | Yes. |
| 7 | Can a lot be split or two lots merged? | Affects lot numbers and totals. | No. |
| 8 | What do you note when fabric arrives (Fabric Inward)? | Defines the first screen. | Date, supplier, fabric quantity. |
| 9 | Who will log in: only the munshi to enter, and the owner to view? Do karigars need anything? | Defines roles. | Munshi enters; owner views; karigar none. |
| 10 | What device will the munshi use, and is internet always available? | Offline use is not ready in the product. | Computer with internet. |
| 11 | Should the screens be in Hindi, English or both? | Language support is unconfirmed. | English in the blueprint. |
| 12 | Do you have existing registers or Excel files to bring across? | Import is limited. | None. |
| Phase | Content | Notes |
| --- | --- | --- |
| 0. Approval | Client reviews the requirement summary and the blueprint, and answers the questions in section 12. | No build before approval. |
| 1. Demo slice and first release | Lot creation, stage chain, issue/receive/pending, karigar master, rate, ledger (wages, advance, payment, balance), munshi-only role, no size, bundle count, ready stock, scope boundaries (fabric inward in, dispatch out). | P0 items plus GAR-DAT-03. |
| 2. Dashboard and reports | Seven dashboard items except costing; location and time per stage; four reports with Excel export. | Needs Excel export confirmation. |
| 3. Costing | Lot-wise costing on dashboard and report. | Needs costing definition. |
| # | Risk or assumption | Mitigation |
| --- | --- | --- |
| 1 | Selling the Garment Manufacturers page to a client with a different model creates a false expectation. | Position as a job-work and piece-rate flow; confirm gaps with Tech first. |
| 2 | The core of the request (per-stage counts, wage ledger, bundles) is not in the workbook. Build size is unknown. | Engineering sizing before any commitment. |
| 3 | Wage formula disputes with karigars. | Agree the formula in writing (section 9) before build. |
| 4 | Munshi-only entry can delay records and the dashboard. | Confirm entry timing; confirm whether owner may also enter. |
| 5 | Language, device and offline are unconfirmed; offline is not ready. | Ask early; do not promise offline or Hindi. |
| 6 | Excel export is unconfirmed; the client treats it as a core need. | Product/Tech to confirm before the demo. |
| 7 | Ready stock cannot reduce because dispatch is out. | Decide how ready stock exits. |
| A1 | Assumption: this is a single business with one munshi. OPEN. | Confirm in discovery. |
| A2 | Assumption: no data import in Phase 1. OPEN. | Confirm in discovery. |
| Ref | Client requirement (English translation) |
| --- | --- |
| S1 | Lot Creation, Cutting, Stitching, Button / Kaj, Finishing, Press, Ready Garment Inventory. |
| S2 | Lot Management: every Lot will have a unique number; every Lot will carry the design and total pieces information; every Lot's current stage and location will be shown; at every stage there will be an account of pieces issued, received and pending; and the time spent in every stage will be recorded. |
| S3 | Worker Management: the karigar's name and mobile number; type of work and rate per piece; how much material was given and how much came back; total wages, advance, payment and balance due. |
| S4 | Data entry will be done only by the munshi; size tracking is not wanted; bundle counting will be automatic. |
| S5 | Ready Garment Inventory will hold lot-wise stock of finished goods. |
| S6 | Dashboard: active lots, pending pieces at every stage, material with karigars, ready bundles, lot-wise costing, karigars' dues, and how many days a lot has been stuck. |
| S7 | Reports: lot-wise production, worker-wise payment, costing, ready inventory; all reports will be exportable to Excel. |
| S8 | The software will cover only Fabric Inward to Ready Inventory, not dispatch. |
| ID | Client's words (translated) | Fit | Workbook ref | Evidence |
| --- | --- | --- | --- | --- |
| GAR-LOT-01 | Lot Creation, Cutting, Stitching, Button / Kaj, Finishing, Press, Ready Garment Inventory (the stage chain) | CONFIGURATION | M101, M102, M005 | VERIFIED |
| GAR-LOT-02 | Every Lot will have a unique number | UNCLEAR | M104 (nearest) | VERIFIED |
| GAR-LOT-03 | Every Lot will carry the design information | CONFIGURATION | M104, M009, M042 | VERIFIED |
| GAR-LOT-04 | Every Lot will carry the total pieces information | CONFIGURATION | M102, M104, M009 | VERIFIED |
| GAR-LOT-05 | Every Lot's current stage will be shown | CONFIGURATION | M005, M101, M103 | VERIFIED |
| GAR-LOT-06 | Every Lot's location will be shown | UNCLEAR | M030, M009 (nearest) | VERIFIED |
| GAR-LOT-07 | At every stage there will be an account of pieces issued, received and pending | CUSTOMIZATION | M101, M103, M048 (base); M111 is ROADMAP | VERIFIED |
| GAR-LOT-08 | The time spent in every stage will be recorded | CONFIGURATION | M103, M004, M008 | VERIFIED |
| GAR-WRK-01 | The karigar's name and mobile number | CONFIGURATION | M001, M009, M041 | VERIFIED |
| GAR-WRK-02 | Type of work | CONFIGURATION | M101, M009 | VERIFIED |
| GAR-WRK-03 | Rate per piece | CUSTOMIZATION | M041, M049 (nearest: price sets) | VERIFIED |
| GAR-WRK-04 | How much material was given and how much came back | CUSTOMIZATION | M048, M101 (base); M111 is ROADMAP | VERIFIED |
| GAR-WRK-05 | Total wages | CUSTOMIZATION | M041, M045 (nearest); M083 does not fit | VERIFIED |
| GAR-WRK-06 | Advance | CUSTOMIZATION | M045, M062 (nearest) | VERIFIED |
| GAR-WRK-07 | Payment | CONFIGURATION | M062, M045 | VERIFIED |
| GAR-WRK-08 | Balance due | CUSTOMIZATION | M041, M045 (nearest) | VERIFIED |
| GAR-DAT-01 | Data entry will be done only by the munshi | CONFIGURATION | M002, M004 | VERIFIED |
| GAR-DAT-02 | Size tracking is not wanted | CONFIGURATION | M009 | VERIFIED |
| GAR-DAT-03 | Bundle counting will be automatic | UNCLEAR | None in workbook | VERIFIED |
| GAR-INV-01 | Ready Garment Inventory will hold lot-wise stock of finished goods | CONFIGURATION | M048, M060, M104 | VERIFIED |
| GAR-DSH-01 | Active lots | CONFIGURATION | M018, M102, M104 | VERIFIED |
| GAR-DSH-02 | Pending pieces at every stage | CUSTOMIZATION | M018 (base) | VERIFIED |
| GAR-DSH-03 | Material with karigars | CUSTOMIZATION | M018 (base) | VERIFIED |
| GAR-DSH-04 | Ready bundles | UNCLEAR | None in workbook | VERIFIED |
| GAR-DSH-05 | Lot-wise costing | UNCLEAR | None in workbook | VERIFIED |
| GAR-DSH-06 | Karigars' dues | CUSTOMIZATION | M018 (base) | VERIFIED |
| GAR-DSH-07 | How many days a lot has been stuck | CUSTOMIZATION | M018, M008 (base) | VERIFIED |
| GAR-RPT-01 | Lot-wise production report | CUSTOMIZATION | M021 (base); M160 is ROADMAP | VERIFIED |
| GAR-RPT-02 | Worker-wise payment report | CUSTOMIZATION | M021 (base); M160 is ROADMAP | VERIFIED |
| GAR-RPT-03 | Costing report | UNCLEAR | None in workbook | VERIFIED |
| GAR-RPT-04 | Ready inventory report | UNCLEAR | M021, M048 (nearest) | VERIFIED |
| GAR-RPT-05 | All reports will be exportable to Excel | UNCLEAR | None in workbook | VERIFIED |
| GAR-SCP-01 | The software starts at Fabric Inward | CONFIGURATION | M046, M048, M011 | VERIFIED |
| GAR-SCP-02 | The software ends at Ready Inventory | CONFIGURATION | M011, M048 | VERIFIED |
| GAR-SCP-03 | Not dispatch | CONFIGURATION | M011; M107 stays inactive | VERIFIED |