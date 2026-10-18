# Implementation Plan

D & S Electric Works. How Phase 1 is organised, what you see and when, and how we agree that a thing is finished.

> **Status: DRAFT, pending company approval.** Dates are durations from the start of the engagement.

## 1. Approach

We work in **two-week sprints**. Each sprint ends with a demonstration of working software on a test environment your
team can log in to. Scope and acceptance criteria for each sprint are agreed in writing before it starts. We show
working screens and real records, not progress slides.

- Vertical slices: a feature is done when it works from the screen through permissions, validation, audit and printed
  output.
- Definition of done: server-side authorisation, tenant-isolation test, audit entry, validation and error states,
  automated tests, a documentation note, and a demonstration in the sprint review.
- Change control: new ideas go to a backlog; additions to a signed sprint are traded for equal effort or handled as a
  change request approved in writing.

## 2. Governance

| Forum | Frequency | Output |
|---|---|---|
| Sprint review and demonstration | every 2 weeks | Accept or rework decision per item |
| Planning | every 2 weeks | Agreed sprint scope and acceptance criteria |
| Weekly status | weekly | One page: done, next, risks, decisions needed |

DSEW nominates a **product owner** (a decision-maker who knows the work), a **quality lead**, an **engineering lead**
and a **stores lead**. About three to four hours a week of their time is the main input needed.

## 3. Phases

| Phase | Content | Duration | Price |
|---|---|---|---|
| 1: Foundation Release | The scope in section 2 of the Commercial Proposal | About 11 weeks | ₹5.00 lakh ex GST |
| Future phases | CRM extensions, multi-level BOM and full ECR/ECO, full quality system, traceability, procurement and inventory extensions, MRP, contracts and risk, HR and payroll, dashboards, AI, Hindi and other items listed as future phase | To be defined | Quoted separately after Phase 1 |
| Excluded | Tally Prime integration | Not planned | Not offered; needs DSEW's written acceptance of the exclusion |

Phase 1 does not depend on any future phase, and Tally Prime is excluded. Dependencies inside Phase 1: document
numbering and approval precede BOM release; a released BOM precedes manufacturing orders and travellers; test
templates precede dispatch gating.

## 4. Phase 1 plan (about 11 weeks)

### Week 1: discovery and specification

Workshops with engineering, quality, production, stores and sales; walk through one real job from enquiry to dispatch;
collect sample documents (drawing, BOM, quotation, traveller, test report, packing list, challan); non-intrusive server
survey. Output: signed specification for Phase 1, agreed numbering convention, test templates for up to 3 product
families, UAT scripts.

### Sprints 1 to 5 (weeks 2 to 11)

| Sprint | Weeks | Deliverables you can try | Acceptance (examples) |
|---|---|---|---|
| 1 | 2 to 3 | DSEW workspace, roles and permissions (up to 10 roles), organisation, CSV import of customers, suppliers, items and components with validation, document numbering configuration | A user without a permission is refused; 200 sample customers import with an error report for bad rows |
| 2 | 4 to 5 | Enquiry register, quotation with revisions and approval, DSEW-format printed quotation, order and project job creation, milestones and tasks | A quotation revised twice keeps both earlier revisions; printed quotation matches the DSEW format |
| 3 | 6 to 7 | Controlled documents (states, revisions, register, permissions, audit); revision-controlled BOM with change reason, review and release. **Mid-point demonstration and milestone** | A released BOM revision cannot be edited; a superseded document is clearly marked; a restricted document is hidden from users without access |
| 4 | 8 to 9 | Manufacturing order from a released BOM (revision recorded), route and operations, traveller print in a DSEW format, test templates and readings with unit and tolerance, instrument register with calibration-due check | A change to the BOM does not alter an existing order; a reading outside tolerance fails regardless of what the user selects; an instrument past its calibration date cannot be chosen |
| 5 | 10 to 11 | Quality gates and authorised audited override, dispatch with packing list and challan gated on tests, four dashboard views, installation on a DSEW test VM, backup and restore drill, training, UAT | Dispatch is refused until required tests are approved; restore to a clean environment passes with data, files and sign-in; UAT scenarios signed |

## 5. Acceptance and UAT

- Acceptance criteria are written per sprint item in the specification. An item is accepted when it works as written,
  in front of the DSEW product owner, on the test environment.
- UAT uses real or realistic jobs with scripts agreed in advance (enquiry to quotation to order; BOM release; failed
  test blocking dispatch; dispatch released after approval; backup and restore).
- Defect classes. Critical: wrong data, security issue, or work blocked with no workaround. High: major function
  impaired. Medium: workaround exists. Low: cosmetic. Critical and High block go-live.
- Sign-off is recorded per scenario with date, tester and result. A failed scenario is not waived without a written,
  accepted deviation.

## 6. Data and master-data set-up

Spreadsheet templates for customers, suppliers, items and components. Imports validate rows, show errors and can be re-run
safely without duplicates. Historical transactions are not migrated; old records remain available as reference.

## 7. Training and handover

- Administrator training: 1 day. End-user sessions: 2 days across engineering, quality, production, stores and sales.
- Quick-reference cards per role.
- Administrator and user guides; runbooks for install, backup, restore and upgrade; the specification; database and
  architecture notes; test report and UAT sign-off; licence inventory; access handover checklist.

## 8. Go-live

1. Install and verify on a production-like VM after the server survey; run the restore drill.
2. Pilot with one or two live jobs in parallel with current records.
3. Cut over after UAT sign-off, with a rollback plan and on-site support during the first week.

## 9. Key risks and how we manage them

| Risk | Mitigation |
|---|---|
| Requirements are tacit and appear late | Week 1 workshops with real documents; sprint demos every two weeks |
| Windows Server 2019 host is unsuitable | Survey first; Hyper-V Linux VM or a small dedicated host; no date promised before a test VM passes |
| Numbering and approval rules not defined | We propose conventions from your samples; decisions logged and signed in week 1 |
| Scope growth beyond the fixed price | Backlog, trade-off or written change request |
| Expectation that Phase 1 covers the whole enquiry | Section 2 of the Commercial Proposal lists included, future-phase and excluded items explicitly |
| Tally Prime requirement in the enquiry | Excluded and deferred; written client acceptance required |
| DSEW staff time is limited | Fixed weekly slots, delegated decisions, short sessions |
