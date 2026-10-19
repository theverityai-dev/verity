# Implementation Plan

D & S Electric Works. How Phase 1 is organised, what you see and when, and how we agree that a thing is finished.

> **Status: NEGOTIATION DRAFT, pending company approval.** Durations run from the effective date (section 3).

## 1. Approach

We work in **two-week sprints**. Each sprint ends with a demonstration of working software on a test environment your
team can log in to. Scope and acceptance criteria for each sprint are agreed in writing before it starts. We show
working screens and real records, not progress slides.

- Vertical slices: a feature is done when it works from the screen through permissions, validation, audit and printed
  output.
- Definition of done: server-side authorisation, tenant-isolation test, audit entry, validation and error states,
  automated tests, a documentation note, and a demonstration in the sprint review.
- Change control: new ideas go to a backlog and are quoted separately; nothing is added to a signed sprint without
  written approval (Commercial Proposal, section 4).

## 2. Governance

| Forum | Frequency | Output |
|---|---|---|
| Sprint review and demonstration | every 2 weeks | Accept or report reproducible failures within 5 working days |
| Planning | every 2 weeks | Agreed sprint scope and acceptance criteria |
| Weekly status | weekly | One page: done, next, risks, decisions needed |

DSEW nominates a **product owner** (a decision-maker who knows the work), a **quality lead**, an **engineering lead**
and a **stores lead**. About three to four hours a week of their time is the main input needed.

## 3. Schedule start and client dependencies

The **effective date** is the latest of: the signed order; DSEW's written acceptance of the Tally Prime exclusion;
nomination of the product owner; and delivery of the week-1 inputs (sample documents, server survey answers and
access). The 11-week plan runs from that date. **Each day that DSEW's samples, decisions, approvals, host access or
UAT participation are late moves the schedule by the same number of days.**

## 4. Phases

| Phase | Content | Duration | Price |
|---|---|---|---|
| 1: Foundation Release | The scope in section 2 of the Commercial Proposal | About 11 weeks | ₹4,00,000 ex GST |
| Later work | Fixes found after DSEW testing are part of Phase 1 where they are defects against the specification. New features, modules, workflow changes and add-ons are assessed and quoted after DSEW's testing | To be defined | Quoted separately |
| Excluded | Tally Prime integration | Not planned | Not offered; DSEW's written acceptance of the exclusion is required |

Phase 1 does not depend on any later work. Dependencies inside Phase 1: document numbering and approval precede BOM
release; a released BOM precedes manufacturing orders and travellers; test templates precede dispatch gating.

## 5. Environments

| Environment | Where | Used for |
|---|---|---|
| Sprint demonstration environment | Hosted by the company | Sprint demonstrations and early hands-on use by DSEW |
| DSEW Linux VM (one) | DSEW-provided host, after the survey | Installed in sprint 1; used for UAT; becomes production only after the go-live gates pass |

A separate second production VM is not included. If the surveyed host cannot support this arrangement, we say so in
writing and the alternative is a change request. Nothing has yet been tested on Windows Server 2019.

## 6. Phase 1 plan (about 11 weeks)

### Week 1: discovery and specification

Workshops with engineering, quality, production, stores and sales; walk through one real job from enquiry to dispatch;
collect sample documents (drawing, BOM, quotation, traveller, test report, packing list, challan); non-intrusive server
survey. Output: signed specification, agreed numbering convention, test templates for up to 3 product families, UAT
scripts.

### Sprints 1 to 5 (weeks 2 to 11)

| Sprint | Weeks | Deliverables you can try | Acceptance (examples) |
|---|---|---|---|
| 1 | 2 to 3 | DSEW workspace, roles and permissions (up to 10 roles), CSV import of customers, suppliers, items and components with validation, numbering configuration. **First installation on the DSEW VM, HTTPS access and a real phone upload test** | A user without a permission is refused; 200 sample customers import with an error report; a phone on the shop-floor network uploads a file over HTTPS |
| 2 | 4 to 5 | Enquiry register, quotation with revisions and approval, DSEW-format printed quotation, order and project job creation, milestones and tasks | A quotation revised twice keeps both earlier revisions; printed quotation matches the DSEW format |
| 3 | 6 to 7 | Controlled documents (states, revisions, register, permissions, audit); revision-controlled BOM with change reason, review and release; **first backup and restore rehearsal onto a clean environment**. **Mid-point demonstration and milestone 2** | A released BOM revision cannot be edited; a restricted document is hidden from users without access; the rehearsal restore succeeds or its failures are listed |
| 4 | 8 to 9 | Manufacturing order from a released BOM (revision recorded), route and operations, traveller print, test templates and readings with unit and tolerance, instrument register with calibration-due check, quality gates and the audited override | A change to the BOM does not alter an existing order; a reading outside tolerance fails regardless of what the user selects; a failed or missing required check blocks completion |
| 5 | 10 to 11 | Dispatch with packing list and challan gated on tests, four dashboard views, data export, training, **final combined restore test, UAT** | Dispatch is refused until required tests are approved; the export reconciles; restore passes with data, files and sign-in; UAT scenarios signed |

Sprint 5 is the heaviest. The work in it is mostly validation, and the earlier install and rehearsal (sprints 1 and 3)
exist to reduce risk there. **The go-live date is conditional on the gates in section 8 and is not promised until they
have passed.**

## 7. Acceptance and UAT

- Acceptance criteria are written per sprint item in the specification. DSEW has **5 working days** after each
  demonstration to accept it or report reproducible failures against those criteria. A reported failure is corrected and
  re-demonstrated. No report in that period means the sprint is deemed accepted.
- **UAT window:** up to 5 working days in sprint 5 for DSEW to run the agreed scripts (enquiry to quotation to order;
  BOM release; failed test blocking dispatch; dispatch released after approval; data export; backup and restore).
  Reproducible failures against the specification are corrected and retested.
- Defect classes. Critical: wrong data, security issue, or work blocked with no workaround. High: major function
  impaired. Medium: workaround exists. Low: cosmetic. Critical and High block go-live.
- Sign-off is recorded per scenario with date, tester and result. A failed scenario is not waived without a written,
  accepted deviation.
- Feedback from testing that asks for something not in the specification is recorded and quoted separately.

## 8. Go-live gates

All must pass before production use:
1. Infrastructure survey complete and the DSEW host confirmed suitable.
2. Installation and HTTPS access work on the DSEW host, including a real phone upload.
3. **Combined backup and restore** of database, files and identity configuration onto a clean environment passes. If it
   fails, production go-live is blocked until it passes.
4. UAT scripts pass.
5. The data export reconciles with the system.

None of these has been completed yet.

## 9. Training and handover

- Administrator training: 1 day. End-user sessions: 2 days across engineering, quality, production, stores and sales.
  Delivered remotely unless on-site attendance is agreed (Commercial Proposal, section 7).
- Quick-reference cards; administrator and user guides; runbooks for install, backup, restore and upgrade; the
  specification; test report and UAT sign-off; licence inventory; access handover checklist.

## 10. Go-live

1. Gates in section 8 pass.
2. Pilot with one or two live jobs in parallel with current records.
3. Cut over: test data is reset and the UAT instance is released to production use. Go-live support is remote unless
   on-site attendance is agreed.

## 11. Key risks and how we manage them

| Risk | Mitigation |
|---|---|
| Requirements are tacit and appear late | Week 1 workshops with real documents; sprint demos every two weeks |
| DSEW host is unsuitable, or Windows Server 2019 cannot run the VM | Survey first; install in sprint 1 to find out early; alternatives are change requests; no date promised before the gates pass |
| Numbering and approval rules not defined | We propose conventions from your samples; decisions logged and signed in week 1 |
| Scope growth beyond the fixed fee | Backlog, quoted separately, written approval |
| Expectation that Phase 1 covers the whole enquiry | Commercial Proposal section 2 lists what is included; document 1 lists future and excluded items |
| Tally Prime requirement in the enquiry | Excluded and deferred; written acceptance required before the order |
| DSEW staff time is limited | Fixed weekly slots, delegated decisions, short sessions |
