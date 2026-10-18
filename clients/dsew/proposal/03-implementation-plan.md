# Implementation Plan

D & S Electric Works. How the work is organised, what you see and when, and how we agree that a thing is finished.

## 1. Approach

We work in **two-week sprints**. Every sprint ends with a demonstration of working software on a test environment
your team can log in to. Scope, deliverables and acceptance criteria for each sprint are agreed in writing before it
starts. We show working screens and real records, not progress slides.

**Principles**

- Vertical slices: a feature is done when it works from the screen through permissions, validation, audit and
  printed output, not when a form exists.
- Early use: the first release goes to a test environment by the middle of Phase 1 so your engineers can try real jobs.
- Definition of done for every item: server-side authorisation, tenant-isolation test, audit entry, validation and
  error states, automated tests, documentation note, demonstrated in the sprint review.
- Change control: new ideas go to a prioritised backlog; additions to a signed sprint are traded for equal effort or
  priced as a change request.

## 2. Governance

| Forum | Frequency | Participants | Output |
|---|---|---|---|
| Sprint review and demonstration | every 2 weeks | DSEW key users, our team | Accept / rework decision per item |
| Planning | every 2 weeks | DSEW product owner, our lead | Agreed sprint scope and acceptance criteria |
| Weekly status | weekly | DSEW sponsor, our project manager | One-page status: done, next, risks, decisions needed |
| Steering | monthly | DSEW management, our director | Scope, budget, risk, phase gates |

DSEW nominates a **product owner** (a decision-maker who knows the work), a **quality lead**, an **engineering
lead**, and a **stores/procurement lead**. About three to four hours a week of their time is the main input we need.

## 3. Phases at a glance

| Phase | Content | Duration | Early value |
|---|---|---|---|
| 0 | Discovery, SRS, UI/UX prototypes, environments | 3 weeks | Signed requirements and a clickable prototype |
| 1 | Engineering-to-delivery core: CRM, projects, quotations, BOM revisions, controlled documents, manufacturing, travellers, quality, testing, dispatch, basic dashboards | 16 weeks | Real jobs run end to end with controlled documents and test records |
| 2 | Procurement, inventory, MRP, barcode/QR traceability, quality completion | 10 weeks | Material traceability and shortage visibility |
| 3 | Tally Prime integration, finance visibility, contracts and risk, full dashboards | 8 weeks | Job profitability, guarantees, receivables view |
| 4 | HR, attendance, timesheets, payroll | 8 weeks | People and labour costing |
| 5 | AI, Hindi, extended automation | 8 weeks | Productivity and language |

Dependencies that shape the order: document numbering and approvals (E) come before BOM release (D); a released BOM
precedes manufacturing jobs (F) and travellers (G); test templates (M) precede dispatch gates (P); lot/heat tracking
(I, K) needs procurement receipts (J); finance dashboards (N, R) need job, stock and invoice data to exist.

## 4. Phase 0: discovery, SRS and prototypes (3 weeks)

| Week | Activity |
|---|---|
| 1 | Workshops with engineering, quality, production, stores, sales and finance. Walk through a real job from enquiry to dispatch. Collect sample documents. Server and network survey (no changes made). |
| 2 | Draft SRS: workflows, roles and permissions, document numbering rules, BOM/ECO states, test templates, traveller formats, reports. Clickable UI/UX prototypes of the 10 most-used screens. |
| 3 | Review with DSEW, resolve open decisions, sign SRS and Phase 1 sprint plan, finalise fixed price for Phase 1. Test environment ready. |

**Output:** signed SRS, approved prototypes, requirement-to-test traceability table, agreed acceptance criteria for
every Phase 1 sprint.

## 5. Phase 1 sprint plan (16 weeks, 8 sprints)

| Sprint | Weeks | Deliverables you can try | Acceptance (examples) |
|---|---|---|---|
| 1 | 1 to 2 | DSEW workspace, roles and permissions, organisation structure, customer and supplier masters with contacts, product and component masters, CSV import with validation, numbering rule configuration | An administrator creates a role and sees an action refused for a user without it; 200 sample customers import with an error report for bad rows |
| 2 | 3 to 4 | Enquiry register, RFQ/tender tracker, follow-ups and reminders, quotation templates with estimate build-up (material, labour, machining, subcontract, testing, transport, overhead, margin), quotation revisions | A quotation is revised twice and the first two revisions stay readable and unchangeable; a printed quotation matches the DSEW template |
| 3 | 5 to 6 | Quotation approval workflow, alternative offers, validity reminders, customer PO registration and PO-versus-quote comparison, order creation, delivery schedule and amendments; document repository with numbering | An accepted quote becomes an order only through the conversion step; a PO differing from the quote shows the differences; document numbers follow the SRS rule with no duplicates under simultaneous creation |
| 4 | 7 to 8 | Controlled document lifecycle (draft, review, approved, released, superseded), revisions and comparison, permissions by role and department, register, distribution and acknowledgement; **multi-level BOM with revisions and ECR/ECO, release to manufacturing**. Release to the test environment for hands-on use. | A released BOM revision cannot be edited; an ECO creates a new revision; a superseded drawing is clearly marked; a user without access cannot find or download a restricted document |
| 5 | 9 to 10 | Projects as the job spine (WBS, milestones, dependencies, responsible persons), manufacturing jobs from released BOM and order, job cards, routing, work-centre allocation, planned versus actual progress, risk/issue/change log, delay alerts | A manufacturing job records its BOM revision; a change to the BOM does not alter it; an overdue task raises an alert |
| 6 | 11 to 12 | Travellers: operation instructions, material batch/lot details, operator and inspector identification, hold/witness/approval points, measured values, QR/barcode on the traveller, printable and customer-facing versions; QAP and ITP templates | A hold point blocks the next operation until signed by an authorised person; the customer version omits internal-only fields |
| 7 | 13 to 14 | Structured testing: test templates, typed readings with unit and tolerance, instrument and calibration validity, automatic pass/fail, tester and reviewer, report revisions, NCR on failure, retest and rework; customer certificates and FAT reports; dispatch with packing list and challan, gated by release and test completion | A reading outside tolerance fails regardless of what the user selects; an expired instrument cannot be chosen; dispatch is refused until all required tests are approved |
| 8 | 15 to 16 | Role dashboards (management, engineering, production, quality, stores), Excel and PDF export, notifications and escalations, performance test, backup and full restore drill, installation on the DSEW VM, training, UAT on real jobs | Restore to a clean environment passes with data, files and sign-in; agreed workload runs with response targets met; UAT scenarios signed |

Phases 2 to 5 follow the same pattern with sprint plans agreed at the start of each phase. Sketch:

| Phase | Sprint themes |
|---|---|
| 2 | Requisition, quotation comparison, PO and receipts; incoming inspection; lot/heat/serial on every movement; bins and racks; reorder and shortage alerts; BOM-based MRP; scan flows and label printing; genealogy search |
| 3 | Tally Prime connector spike then build; project cost and profitability; guarantees, retention, advance and milestone billing; contract obligations and expiry reminders; risk register; complete dashboards |
| 4 | Employee master; attendance and leave; shifts and overtime; project timesheets; payroll with configurable Indian statutory rules; training and skill matrix; operator authorisation |
| 5 | Local search and retrieval; drafting assistants; missing-document detection; Hindi interface and print templates; WhatsApp and extended automation if chosen |

## 6. Acceptance and UAT

- **Acceptance criteria** are written per sprint item and traced to the SRS. An item is accepted when it works as
  written, in front of your product owner, on the test environment.
- **UAT** uses your real or realistic jobs, with scripts agreed in advance (for example: enquiry to quotation to
  order; BOM release; failed test to NCR to retest; dispatch blocked and released; backup and restore).
- **Defect classes.** Critical: wrong data, security issue, or work blocked with no workaround. High: major function
  impaired. Medium: workaround exists. Low: cosmetic. Critical and High block go-live; Medium and Low are scheduled.
- **Sign-off** is recorded per scenario with date, tester and result. A failed scenario is not waived without a
  written, accepted deviation.

## 7. Data migration and master-data set-up

We provide spreadsheet templates for customers, suppliers, items and components, employees, open purchase orders,
and opening stock. Each import validates rows, shows errors and can be re-run safely without duplicates. Opening
balances are loaded as controlled opening entries rather than edited into history. Historical transactions are not
migrated unless you ask (priced add-on); instead, the old records remain available as reference documents.

## 8. Training and handover

- Administrator training (users, roles, numbering, templates, backups): 2 days.
- Role-based end-user sessions for engineering, quality, production, stores, sales, finance and HR: about 5 days in total, on the shop floor and in the office.
- Short video walkthroughs and quick-reference cards per role.
- Administrator and user manuals, runbooks (install, upgrade, backup, restore, offboarding, troubleshooting),
  the SRS, architecture and database documents, API notes for implemented interfaces, a configuration register,
  test reports and UAT sign-off.
- Credential and access handover checklist, repository access and a licence inventory.

## 9. Go-live

1. Install and verify on a production-like VM; run the restore drill.
2. Pilot with one or two live jobs in parallel with current records for a defined period.
3. Cut over by department, with a rollback plan and on-site support during the first week.
4. Hypercare for 30 days: daily check-ins, same-day critical fixes.

## 10. Environments and issue tracking

Test (sprint verification), staging (release rehearsal and restore drill), production. A shared issue tracker is
visible to DSEW from day one; each defect has severity, owner, status and the sprint in which it will be fixed.

## 11. Key risks and how we manage them

| Risk | Mitigation |
|---|---|
| Requirements are tacit and appear late | Workshops with real documents; prototypes before building; sprint demos every two weeks |
| Windows Server 2019 host is unsuitable | Survey first; Hyper-V Linux VM or a small dedicated host; no promise before a test VM passes |
| Numbering and approval rules are not yet defined | We propose conventions from your samples; decisions are logged and signed in Phase 0 |
| Traceability depth is open ended | Baseline depth fixed in the SRS (lot/heat on materials, serial on finished goods, key coil/winding records); deeper genealogy as a priced option |
| Tally version or interface differs from assumption | Integration spike before building; direction and records agreed in writing |
| Attendance device or e-way bill provider cannot integrate | Verify before pricing; both are optional add-ons |
| DSEW staff time is limited | Fixed weekly slots, delegated decisions, short sessions; we prepare so meetings are decisions, not discovery |
| Scope growth | Backlog, trade-off or change request; fixed price per phase |
