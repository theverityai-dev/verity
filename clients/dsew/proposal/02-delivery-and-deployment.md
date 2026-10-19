# Delivery, Deployment and What We Need

D & S Electric Works. How the work is delivered, how it runs on your premises, and what we need from you.

> **Status: NEGOTIATION DRAFT, pending company approval.**

## 1. Estimated timelines

| Option | Estimated implementation timeline |
|---|---|
| Option 1: MVP ERP | Approximately **6 to 8 weeks** from project kickoff |
| Option 2: Complete ERP | Approximately **8 to 12 weeks** from project kickoff |
| Option 3: Phased Complete ERP | Approximately **8 to 12 weeks**, delivered through four phases with defined milestones and acceptance criteria |

These are estimates, not fixed deadlines. They assume the agreed scope, timely access to the data, server, stakeholders
and decisions we need, and consolidated DSEW feedback. **The final schedule is confirmed when requirements are
finalised.** Delays caused by pending DSEW inputs, scope changes, third-party dependencies or additional requirements
revise the schedule by the corresponding time.

**Kickoff** is the latest of: signed order; product owner named; requirements inputs delivered (sample documents,
numbering conventions, server survey answers, access).

## 2. Option 3: the four phases

Each phase ends in a working demonstration and a written review. The phase prices are unchanged by the timeline.

| Phase | Weeks (8-week pace / 12-week pace) | Price (₹, ex GST) | Delivered and accepted when |
|---|---|---|---|
| 1. Foundation and commercial core | 1-2 / 1-3 | 1,20,000 | DSEW can create linked customer, enquiry, quotation, sales order and project records with controlled document numbering, and initial engineering masters and BOM |
| 2. Supply chain and manufacturing core | 3-4 / 4-6 | 1,35,000 | A BOM drives material requirements and availability for a manufacturing job; purchases, receipts and stock movements are recorded; engineering release works |
| 3. Quality, traceability and operational controls | 5-6 / 7-9 | 1,30,000 | Operations, travellers and quality inspections are linked; agreed traceability, testing, dispatch and contract controls work; failed mandatory checks block release |
| 4. Business modules, validation and go-live | 7-8 / 10-12 | 95,000 | Finance, HR and payroll, dashboards, notifications and the documented AI use cases work; end-to-end UAT passes; deployed, trained and handed over |
| **Total** | **8 to 12 weeks** | **4,80,000** | |

| Stage | What happens |
|---|---|
| Kickoff | Discovery and architecture: workflows, data model, roles, mock-ups of printed formats and key screens, written module depth and acceptance criteria. **First install on the DSEW VM, HTTPS access, real-phone upload test** |
| Phase 1 demonstration | Commercial core |
| Phase 2 demonstration | BOM to material to job, production status, basic MRP. **First backup and restore rehearsal** |
| Phase 3 demonstration | Travellers, quality, traceability, testing, dispatch, compliance |
| Phase 4 and go-live | Business modules and AI use cases, full UAT, **final restore test**, deployment, training, handover |

## 3. Option 1: the MVP stages

| Stage | Estimated weeks | Accepted when |
|---|---|---|
| Kickoff and specification | 1 | Requirements and module depth signed off; first install on the DSEW VM |
| Commercial core | 2-4 | Customer, enquiry, quotation, order, project and numbered documents linked |
| Engineering, materials and manufacturing | 3-6 | BOM, purchasing, stock and issue to a manufacturing job; traveller and operations tracked |
| Quality, dashboards and go-live | 5-8 | Inspections and quality release gate work; dashboards and notifications; UAT passes; deployed, trained and handed over |

## 4. How we work

- **Specification and design:** produces a signed specification (workflows, roles, numbering, templates, formats, the
  agreed depth of every module and acceptance criteria), an architecture and database overview, and approved mock-ups.
- **Milestones and acceptance:** DSEW has **5 business days** after each demonstration or delivery to accept it or report
  material deviations from the agreed criteria. In-scope defects are corrected and shown again before sign-off; new
  requirements follow change control. No report in that period means accepted. Payment milestones are in document 1,
  section 8.
- **Issue tracking:** a shared issue list visible to DSEW from day one, with severity, owner and status. Critical (wrong
  data, security issue, or work blocked with no workaround) and High (major function impaired) issues block go-live.
- **UAT:** scripts agreed in advance (enquiry to quotation to order; BOM release; material to job; failed test blocking
  dispatch; dispatch released after approval; data export; backup and restore). Each scenario is signed off with date,
  tester and result.
- **Definition of done:** server-side authorisation, tenant-isolation test, audit entry, validation and error states,
  automated tests, documentation note, demonstrated in the review.
- **Dependencies between modules:** numbering and approval precede BOM release; a released BOM precedes material
  planning, manufacturing orders and travellers; test templates precede dispatch gating; stock and invoicing data
  precede finance and dashboards.
- **Changes:** anything beyond the agreed scope needs a written change request with a revised cost or schedule,
  approved before work.
- **Remote first:** delivery is remote. On-site work and travel are chargeable separately and need prior approval.

## 5. Environments

- **Company-hosted test environment:** demonstrations and early hands-on use.
- **One DSEW Linux VM:** installed at kickoff, used for UAT, and used as production only after the gates pass. A second
  production VM is not included. If the surveyed host cannot support this, a different arrangement is quoted separately.

## 6. Go-live gates (none completed yet)

1. Server survey complete and the DSEW host confirmed suitable.
2. Installation and HTTPS access work on the DSEW host, including a real-phone upload.
3. **Combined backup and restore** of database, files and identity configuration onto a clean environment passes.
4. Identity-provider and object-store outage behaviour tested: existing sessions keep working, new sign-ins or uploads
   fail clearly, quality gates stay enforced.
5. UAT scripts pass.
6. The data export reconciles with the system.

**Go-live happens when these gates pass and the handover is signed.** The 12-month support period starts on that date.

## 7. Running on Windows Server 2019

Verity runs on Linux. We do **not** propose running it natively on Windows Server 2019, and we do not recommend Docker
Desktop or WSL for production there. The plan is one Ubuntu Server VM under the Hyper-V role on your server, or a small
dedicated host. **This has not been tested on your server.** Licensing of the Windows host is for your Microsoft partner.

## 8. Your 15 questions

| # | Question | Answer |
|---|---|---|
| 1 | Architecture and stack | One web application (TypeScript, Next.js, React), PostgreSQL 16 database, Keycloak sign-in, S3-compatible file storage, Docker. All open source, no licence fee |
| 2 | Direct on Windows Server 2019? | No: Linux VM under Hyper-V or a small separate host |
| 3 | Hardware | For 15 users: 4 vCPU, 16 GB RAM, 500 GB mirrored SSD, separate backup target, UPS. Confirmed after survey; the Complete ERP and AI may need more |
| 4 | Database licence | PostgreSQL, no fee |
| 5 | Browsers and devices | Current Chrome, Edge, Firefox; Android and iOS phones and tablets for the shop floor |
| 6 | Network, remote access | LAN; remote only through your VPN |
| 7 | Backup and recovery | Scripts exist; combined restore is a go-live gate. Recovery time and data-loss window agreed with you |
| 8 | Security, authentication, audit | TLS, role-based permissions, per-company data isolation in the database, audit trail the application cannot change or delete, MFA available in Keycloak and enabled if you ask |
| 9 | Encryption, secure remote access | TLS in transit; encrypted backups and disk encryption recommended, confirmed at acceptance; VPN for remote use |
| 10 | Performance and document growth | Designed for 15 named users; load test is part of acceptance; documents on a separate volume sized with you |
| 11 | Offline | In-LAN use needs no internet after install; installs and upgrades need controlled internet or offline media |
| 12 | Integration, API | Permissioned REST API. Everything in the offered scope is inside Verity; no external integration is included |
| 13 | Source code, repository, version control | Source code of the DSEW-specific deliverables is handed over on full payment, in a repository DSEW controls (document 3) |
| 14 | Test, staging, production | Section 5 |
| 15 | Upgrades, maintenance, long-term support | Versioned releases with tested upgrade and rollback; covered during the 12-month period; support after it is a separately agreed renewal |

Modular expansion: new departments, workflows, product families and users are added by configuration or by adding
modules to Verity, without redeveloping what is already there.

## 9. User interface

A responsive interface for office PCs and shop-floor phones and tablets; searchable, sortable, filterable lists; direct
links between related records (a project links to its customer, quotation, order, BOM, job, traveller, tests and
documents); changes to approved records follow the revision or amendment path; role-based permissions; printable branded
documents. English in this scope; Hindi interface labels are not included.

## 10. What is handed over

On full payment: the working, tested application; the modules of the chosen option; the source code of the DSEW-specific
deliverables; the architecture overview and database schema for the delivered scope; deployment and configuration
instructions; backup and recovery procedures; administrator and user guides; document templates and workflow
configuration register; API notes for what the scope uses; test reports and UAT sign-off records; training;
administrator credentials through a signed handover checklist; and the 12-month terms in document 1.

## 11. Assumptions and exclusions

**Assumed:** up to 15 named users, one site, English only; DSEW supplies samples, decisions and a numbering
convention; DSEW provides the host, TLS certificates, internal DNS, VPN access, backup storage and a network contact.

**Excluded:** anything outside the chosen option's module tables; historical transaction migration; hardware and
networking; GST on fees; on-site work and travel; support after the 12-month period; a second VM; independent
penetration testing; Hindi interface; attendance-device and e-way bill integration; external AI service charges and AI
hardware; DSEW staff time.

**DSEW's own costs (planning estimates, not quotations):** backup target and UPS ₹0.8 to 1.2 lakh; a new server only
if the existing one cannot run the VM, ₹3.5 to 4.5 lakh; platform software licences: none beyond this proposal.

## 12. What we need from you

1. A named product owner (about 3 to 4 hours a week) and leads for quality, engineering, stores and finance.
2. A walk-through of one recent job from enquiry to dispatch, and your numbering convention.
3. Who drafts, reviews, approves and releases drawings, BOMs and test records; is self-approval ever allowed?
4. Samples: drawing, released BOM, quotation, traveller, test report or certificate, packing list, delivery challan,
   inspection formats and document templates.
5. The tests per product family and acceptance limits; how instruments and calibration are tracked.
6. Server make, OS build, CPU, RAM, free storage, Hyper-V status, network and VPN set-up, backup destination, IT owner,
   recovery time and data-loss window you accept, outbound-network policy, UPS.
7. Agreement to the licence and ownership terms in document 3 before the order.
