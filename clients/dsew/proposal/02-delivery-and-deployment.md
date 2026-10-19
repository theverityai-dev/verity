# Delivery, Deployment and What We Need

D & S Electric Works. How the work is delivered, how it runs on your premises, and what we need from you.

> **Status: NEGOTIATION DRAFT, pending company approval.**

## 1. Schedule

The **effective date** is the latest of: signed order; product owner named; requirements inputs delivered (sample
documents, numbering conventions, server survey answers, access). Each day DSEW is late with inputs, decisions,
approvals, host access or UAT moves the schedule by the same number of days.

**Option 1 (MVP):** [duration to be confirmed by the company]. It follows the same method as below, over its smaller scope.

**Option 2 and Option 3 (Complete ERP): 8 weeks in four phases.** Each phase ends in a working demonstration and a
written review.

| Phase | Weeks | Price (₹, ex GST) | What DSEW sees at the end |
|---|---|---|---|
| 1. Foundation and commercial core | 1-2 | 1,20,000 | CRM, quotations, sales orders, projects, controlled numbering and initial engineering masters and BOM, working as one commercial-to-project flow |
| 2. Supply chain and manufacturing core | 3-4 | 1,35,000 | A BOM informs material requirements, availability and a manufacturing job; stock movements recorded; engineering release in place |
| 3. Quality, traceability and operational controls | 5-6 | 1,30,000 | Operations, travellers and quality inspections linked; agreed traceability, testing, dispatch and contract controls working |
| 4. Business modules, validation and go-live | 7-8 | 95,000 | Finance, HR, dashboards, automation and scoped AI integrated; end-to-end tests and UAT passed; deployed, trained, handed over |
| **Total** | **8 weeks** | **4,80,000** | |

| Week | Focus |
|---|---|
| 1 | Discovery and architecture: confirm workflows, data model, roles, mock-ups of printed formats and key screens. **First install on the DSEW VM, HTTPS access, real-phone upload test** |
| 2 | Commercial core demonstration |
| 3 | Supply chain foundation: suppliers, purchasing, inventory and material movement |
| 4 | Manufacturing integration: BOM to material to job, production status, basic MRP. **First backup and restore rehearsal** |
| 5 | Travellers and quality: operation records, traveller formats, inspection checkpoints, NCRs |
| 6 | Operational controls: traceability, testing, dispatch, compliance and cross-module links |
| 7 | Business modules and scoped AI; begin full-system UAT |
| 8 | Acceptance and go-live: resolve agreed defects, final restore test, UAT sign-off, deploy, train, hand over |

After go-live, the 12-month period in DSEW's real workflows begins (document 1, section 7).

**Assumptions the 8 weeks depends on.** A DSEW decision-maker gives consolidated feedback within about two business days
of each demonstration; master data, numbering conventions, document templates, sample BOMs and inspection formats are
supplied at the start; workflows are standard and modular, with no extensive bespoke screens or complex legacy
migration; AI is limited to agreed use cases; deployment depends on server readiness, network access and timely UAT
sign-off. Delays in any of these move the schedule by agreement. Eight weeks is a compressed plan for a broad scope and
holds only on these assumptions.

## 2. How we work

- **Specification and design:** the first weeks produce a signed specification (workflows, roles, numbering, test
  templates, formats, the agreed depth of every module and acceptance criteria), an architecture and data overview, and
  approved mock-ups. Internal database design documents are not handed over (document 3).
- **Demonstrations and acceptance:** each phase ends with a demonstration of working software on a company-hosted test
  environment DSEW can use. DSEW has **5 working days** to accept it or report reproducible failures against the agreed
  criteria; a failure is corrected and shown again; no report means accepted.
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
- **Changes:** defects against agreed criteria are fixed under the 12-month terms; new features and scope changes follow a
  written change request, quoted and approved before work.

## 3. Environments

- **Company-hosted test environment:** demonstrations and early hands-on use.
- **One DSEW Linux VM:** installed in week 1, used for UAT, and used as production only after the gates pass. A second
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
| 13 | Source code, repository, version control | Not delivered: Verity is proprietary (document 3) |
| 14 | Test, staging, production | Section 3 |
| 15 | Upgrades, maintenance, long-term support | Versioned releases with tested upgrade and rollback; covered during the 12-month period; support after it is a separately agreed renewal |

Modular expansion: new departments, workflows, product families and users are added by configuration or by adding
modules to Verity, without redeveloping what is already there.

## 7. User interface

A responsive interface for office PCs and shop-floor phones and tablets; searchable, sortable, filterable lists; direct
links between related records (a project links to its customer, quotation, order, BOM, job, traveller, tests and
documents); changes to approved records follow the revision or amendment path; role-based permissions; printable branded
documents. English in this scope; Hindi interface labels are not included.

## 8. What is handed over

Working, tested application; the modules of the chosen option; deployment and configuration instructions; backup and
recovery procedures; administrator and user guides; document templates and workflow configuration register; API notes
for what the scope uses; test reports and UAT sign-off records; training; administrator credentials through a signed
handover checklist; and the 12-month terms in document 1. Source code and internal design documents are not part of it.

## 9. Assumptions and exclusions

**Assumed:** up to 15 named users, one site, English only; DSEW supplies samples, decisions and a numbering
convention; DSEW provides the host, TLS certificates, internal DNS, VPN access, backup storage and a network contact.

**Excluded:** anything outside the chosen option's module tables; historical transaction migration; hardware and
networking; GST on fees; support after the 12-month period; a second VM; independent penetration testing; Hindi
interface; attendance-device and e-way bill integration; external AI service charges and AI hardware; DSEW staff time.

**DSEW's own costs (planning estimates, not quotations):** backup target and UPS ₹0.8 to 1.2 lakh; a new server only
if the existing one cannot run the VM, ₹3.5 to 4.5 lakh; platform software licences: none beyond this proposal.

## 10. What we need from you

1. A named product owner (about 3 to 4 hours a week) and leads for quality, engineering, stores and finance.
2. A walk-through of one recent job from enquiry to dispatch, and your numbering convention.
3. Who drafts, reviews, approves and releases drawings, BOMs and test records; is self-approval ever allowed?
4. Samples: drawing, released BOM, quotation, traveller, test report or certificate, packing list, delivery challan,
   inspection formats and document templates.
5. The tests per product family and acceptance limits; how instruments and calibration are tracked.
6. Server make, OS build, CPU, RAM, free storage, Hyper-V status, network and VPN set-up, backup destination, IT owner,
   recovery time and data-loss window you accept, outbound-network policy, UPS.
7. Agreement to the licence terms in document 3 before the order.
