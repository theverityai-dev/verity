# Delivery, Deployment and What We Need

D & S Electric Works. How Phase 1 is delivered, how it runs on your premises, and what we need from you.

> **Status: NEGOTIATION DRAFT, pending company approval.**

## 1. Timeline: about 11 weeks

The **effective date** is the latest of: signed order; product owner named; week-1 inputs delivered (sample documents,
server survey answers, access). Each day DSEW is late with samples, decisions, approvals, host access or UAT moves the
schedule by the same number of days.

| When | What you can try |
|---|---|
| Week 1 | Workshops, sample documents, server survey. Output: signed specification, numbering convention, test templates for up to 3 product families, mock-ups of the printed formats and key screens for approval |
| Sprint 1 (weeks 2-3) | Workspace, roles, CSV import. **First install on the DSEW VM, HTTPS access, real-phone upload test** |
| Sprint 2 (weeks 4-5) | Enquiry, quotation with revisions, order and project job |
| Sprint 3 (weeks 6-7) | Controlled documents, revision-controlled BOM. **First backup and restore rehearsal.** Mid-point milestone |
| Sprint 4 (weeks 8-9) | Manufacturing order, traveller, test records, instrument register, quality gates and override |
| Sprint 5 (weeks 10-11) | Dispatch pack, four dashboards, data export, training, **final restore test and UAT** |
| After go-live | 12-month period in DSEW's real workflows (document 1, section 4) |

## 2. How we work

- **Specification and design:** week 1 produces a signed specification (workflows, roles, numbering, test templates,
  formats), an architecture and data overview, and approved mock-ups. Internal database design documents are not handed
  over (document 3).
- **Two-week sprints,** each with agreed scope and acceptance criteria written in advance, ending in a demonstration of
  working software on a company-hosted test environment that DSEW can use.
- **Acceptance:** DSEW has **5 working days** after each demonstration to accept it or report reproducible failures
  against the agreed criteria; a failure is corrected and shown again; no report means accepted.
- **Issue tracking:** a shared issue list visible to DSEW from day one, with severity, owner and status. Critical (wrong
  data, security issue, or work blocked with no workaround) and High (major function impaired) issues block go-live.
- **UAT:** up to 5 working days in sprint 5, using scripts agreed in advance: enquiry to quotation to order; BOM release;
  failed test blocking dispatch; dispatch released after approval; data export; backup and restore. Each scenario is
  signed off with date, tester and result.
- **Definition of done:** server-side authorisation, tenant-isolation test, audit entry, validation and error states,
  automated tests, documentation note, demonstrated in the sprint review.
- **Dependencies between modules:** numbering and approval precede BOM release; a released BOM precedes manufacturing
  orders and travellers; test templates precede dispatch gating. Sprint 5 is the heaviest, so the install and restore
  rehearsal are done early.

## 3. Environments

- **Company-hosted test environment:** sprint demonstrations and early hands-on use.
- **One DSEW Linux VM:** installed in sprint 1, used for UAT, and used as production only after the gates pass. A second
  production VM is not included. If the surveyed host cannot support this, a different arrangement is quoted separately.

## 4. Go-live gates (none completed yet)

1. Server survey complete and the DSEW host confirmed suitable.
2. Installation and HTTPS access work on the DSEW host, including a real-phone upload.
3. **Combined backup and restore** of database, files and identity configuration onto a clean environment passes.
4. Identity-provider and object-store outage behaviour tested: existing sessions keep working, new sign-ins or uploads
   fail clearly, quality gates stay enforced.
5. UAT scripts pass.
6. The data export reconciles with the system.

**The go-live date depends on these gates and is not promised until they pass.**

## 5. Running on Windows Server 2019

Verity runs on Linux. We do **not** propose running it natively on Windows Server 2019, and we do not recommend Docker
Desktop or WSL for production there. The plan is one Ubuntu Server VM under the Hyper-V role on your server, or a small
dedicated host. **This has not been tested on your server.** Licensing of the Windows host is for your Microsoft partner.

## 6. Your 15 questions

| # | Question | Answer |
|---|---|---|
| 1 | Architecture and stack | One web application (TypeScript, Next.js, React), PostgreSQL 16 database, Keycloak sign-in, S3-compatible file storage, Docker. All open source, no licence fee |
| 2 | Direct on Windows Server 2019? | No: Linux VM under Hyper-V or a small separate host |
| 3 | Hardware | For 15 users: 4 vCPU, 16 GB RAM, 500 GB mirrored SSD, separate backup target, UPS. Confirmed after survey |
| 4 | Database licence | PostgreSQL, no fee |
| 5 | Browsers and devices | Current Chrome, Edge, Firefox; Android and iOS phones and tablets for the shop floor |
| 6 | Network, remote access | LAN; remote only through your VPN |
| 7 | Backup and recovery | Scripts exist; combined restore is a go-live gate. Recovery time and data-loss window agreed with you |
| 8 | Security, authentication, audit | TLS, role-based permissions, per-company data isolation in the database, audit trail the application cannot change or delete, MFA available in Keycloak and enabled if you ask |
| 9 | Encryption, secure remote access | TLS in transit; encrypted backups and disk encryption recommended, confirmed at acceptance; VPN for remote use |
| 10 | Performance and document growth | Designed for 15 named users; load test is part of acceptance; documents on a separate volume sized with you |
| 11 | Offline | In-LAN use needs no internet after install; installs and upgrades need controlled internet or offline media |
| 12 | Integration, API | Permissioned REST API. Phase 1 needs no external integration |
| 13 | Source code, repository, version control | Not delivered: Verity is proprietary (document 3) |
| 14 | Test, staging, production | Section 3 |
| 15 | Upgrades, maintenance, long-term support | Versioned releases with tested upgrade and rollback; covered during the 12-month period; support after it is a separately agreed renewal |

Modular expansion: new departments, workflows, product families and users are added by configuration or by adding
modules to Verity, without redeveloping what is already there.

## 7. User interface

A responsive interface for office PCs and shop-floor phones and tablets; searchable, sortable, filterable lists; direct
links between related records (a project links to its customer, quotation, order, BOM, job, traveller, tests and
documents); changes to approved records follow the revision or amendment path; role-based permissions; printable branded
documents. English in this scope; Hindi is later work.

## 8. What is handed over

Working, tested application; the Phase 1 modules; deployment and configuration instructions; backup and recovery
procedures; administrator and user guides; document templates and workflow configuration register; API notes for what
Phase 1 uses; test reports and UAT sign-off records; training; administrator credentials through a signed handover
checklist; and the 12-month terms in document 1. Source code and internal design documents are not part of it.

## 9. Assumptions and exclusions

**Assumed:** up to 15 named users, one site, English only; DSEW supplies samples, decisions and a numbering
convention; DSEW provides the host, TLS certificates, internal DNS, VPN access, backup storage and a network contact.

**Excluded:** everything marked "later" in document 1; historical transaction migration; hardware and networking; GST on
fees; support after the 12-month period; a second VM; independent penetration testing; DSEW staff time.

**DSEW's own costs (planning estimates, not quotations):** backup target and UPS ₹0.8 to 1.2 lakh; a new server only
if the existing one cannot run the VM, ₹3.5 to 4.5 lakh; platform software licences: none beyond this proposal.

## 10. What we need from you

1. A named product owner (about 3 to 4 hours a week) and leads for quality, engineering and stores.
2. A walk-through of one recent job from enquiry to dispatch, and your numbering convention.
3. Who drafts, reviews, approves and releases drawings, BOMs and test records; is self-approval ever allowed?
4. Samples: drawing, released BOM, quotation, traveller, test report or certificate, packing list, delivery challan.
5. The tests per product family (up to 3) and acceptance limits; how instruments and calibration are tracked.
6. Server make, OS build, CPU, RAM, free storage, Hyper-V status, network and VPN set-up, backup destination, IT owner,
   recovery time and data-loss window you accept, outbound-network policy, UPS.
7. Agreement to the licence terms in document 3 before the order.
