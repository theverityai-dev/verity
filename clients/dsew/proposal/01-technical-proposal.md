# Technical Proposal

D & S Electric Works. Integrated operations platform for engineering-led, project-based manufacturing.

## 1. Executive summary

DSEW makes engineered, often one-off products: transformers, magnet coils, custom electromagnets and research
equipment. The business risk is not in recording what was made. It is in making sure that what was approved is what
was built, that every material, drawing revision and measurement can be traced afterwards, and that nothing leaves
the factory without the required checks.

Our proposal is one platform, one set of records, and one job that carries a project from enquiry to warranty.
Changing an approved record always goes through a revision or amendment, never an edit. Quality rules are enforced
by the system, not by good intentions.

**How we will deliver.** We build on Verity, our own multi-tenant business platform, so that tenant isolation,
permissions, audit, stock integrity and approvals are not rebuilt for you. We then add the DSEW-specific
engineering, document, quality and traceability capabilities in two-week sprints, each demonstrated on a test
system, and deploy on your own premises.

## 2. How we describe capability status

To keep this proposal truthful we use three labels. None of them means "client-validated"; every capability is
confirmed against your real documents and workflow during the requirement phase.

| Label | Meaning |
|---|---|
| **Foundation present** | The core behaviour exists in the platform today and has been demonstrated with fictional data. We will configure and extend it for DSEW. |
| **Extend** | Part of it exists; the DSEW-specific part (for example tolerances, revisions, your formats) is to be built. |
| **Build** | Not present today. New development, scheduled in a defined phase. |

## 3. Module-by-module coverage (A to S in your enquiry)

Phases refer to the Implementation Plan: **P1** engineering-to-delivery core, **P2** supply chain and traceability,
**P3** finance, contracts and BI, **P4** people, **P5** AI, Hindi and extended automation.

| Module | Status | What exists today | What we build for DSEW | Phase |
|---|---|---|---|---|
| **A. CRM** | Extend | Customers, enquiry and quotation states on a project job, complaints | Multiple contacts and departments per customer, RFQ/tender tracker, meetings and follow-up reminders, email attachment filing, customer-wise history view | P1 |
| **B. Project management** | Foundation present | Job as the spine of a project, milestones, tasks with dependencies, timesheets, cost lines, quoted-versus-actual | WBS depth, risk/issue/change register, delay alerts, role dashboards, controlled customer document sharing | P1 |
| **C. Enquiry, quotation, sales** | Extend | Quote revisions; approval snapshots the quoted value onto the job; structured lost reason | Quotation templates, estimate build-up (material, labour, machining, subcontract, testing, transport, overhead, margin), approval workflow, alternative offers, validity reminders, PO registration and PO-versus-quote comparison, order amendments and delivery schedules, retention/advance/LD terms | P1 |
| **D. Engineering and PLM** | Extend | Single-level BOM, order created from BOM | Revision-controlled multi-level BOM (draft, review, released, superseded), ECR/ECO, drawing approval, approved makes, design notes and simulation report storage, customer variants, engineering-to-manufacturing release | P1 |
| **E. Document management** | Build | Evidence storage (immutable photos and files) | Controlled document repository with configurable numbering, revisions, review/approval/release/obsolescence, comparison, distribution and transmittals, acknowledgement, role and department permissions, register, retention | P1 |
| **F. Manufacturing execution** | Foundation present | Orders from BOM, stage routes, operations per order, hold and resume, material reservation, consumption, cancel with reversal | Work-centre/machine allocation, operator time, subcontract/outside process, planned versus actual consumption, WIP and bottleneck views, release workflow | P1 |
| **G. Travellers** | Extend | Printable traveller, QR passport for finished units | Measured values and process parameters, hold/witness/approval points, batch/lot identification, customer-facing traveller with approved fields only, attachment of certificates and photos | P1 |
| **H. Quality management** | Extend | In-process checkpoints that block completion; append-only results; evidence tied to the operation | QAP and ITP, incoming and final inspection, ITR, configurable acceptance criteria, NCR and CAPA with root cause, FAI/FAT documentation, calibration records, audits, quality dashboards | P1, completed P2 |
| **I. Barcode, QR, traceability** | Extend | QR identity and public verification for finished units | Barcode/QR for materials, components, documents; scan flows for receipt, issue, movement, operations, inspection, dispatch; batch/lot/heat/serial; certificate linkage; searchable genealogy; scanner and label-printer support | P2 |
| **J. Procurement, vendors** | Extend | Vendors, purchase orders with approval, goods receipt into stock, vendor performance | Requisition, quotation comparison, approved vendor list, supplier documents, subcontract POs, delivery reminders, delayed-material and cost reports | P2 |
| **K. Inventory, warehouse** | Extend | Items, stock ledger that cannot be edited (corrections are reversal entries), balances, counts | Bins and racks, lot/heat on movements, min/max and reorder alerts, project allocation, BOM availability check, valuation, ageing and slow-moving reports, scrap and obsolete handling | P2 |
| **L. Production planning, MRP** | Build | Material reservation per order | Requirement explosion from BOM and delivery schedule, shortage analysis, purchase and production recommendations, lead time and capacity planning | P2 |
| **M. Testing, equipment** | Build | Pass/fail checkpoints with evidence | Test templates, typed readings with unit, tolerance and instrument, automatic pass/fail, report revision and approval, calibration validity checks, maintenance schedules, customer certificates and FAT reports | P1 |
| **N. Finance and Tally Prime** | Extend | Ledger and GST features exist in the platform; Tally Prime stays the book of record | Tally Prime connector, project cost and profitability, retention/advance/milestone billing, guarantee and deposit tracking, cash-flow views (details in section 7) | P3 |
| **O. HR and payroll** | Extend | Employees, leave, attendance basics | Timesheets by project, shifts and overtime, salary structures and Indian statutory payroll, training and skill matrix, operator authorisation, appraisal and separation | P4 |
| **P. Dispatch, logistics** | Extend | Dispatch ledger; dispatch blocked unless the order is complete and packaging evidence exists | Packing list, delivery challan, partial shipments, transporter and freight details, delivery acknowledgement, warranty and post-delivery complaints; dispatch also gated by test and document release; e-way bill as an optional add-on | P1 |
| **Q. Contracts, compliance, risk** | Build | Approvals | Contract obligations, review and approval, deadlines, LD exposure, bank guarantee and insurance expiry reminders, NDA tracking, export documentation records, risk register | P3 |
| **R. Dashboards and BI** | Extend | Summary home | Role dashboards for management, engineering, procurement, production, quality, stores, finance, HR; Excel and PDF export | P1 basic, P3 full |
| **S. Notifications, workflow** | Extend | Approval chains, notification outbox | Configurable approval and escalation, overdue and shortage alerts, expiry reminders, e-mail delivery, document and report generation; WhatsApp Business optional | P1 basic, P5 full |

## 4. Engineering, documents and quality: the core of the design

These three areas decide whether the system is trusted on the shop floor and by your customers' inspectors.

**Revision-controlled BOMs (D).** A BOM is never overwritten. A new revision is drafted, reviewed and released.
A released revision is immutable. A manufacturing job records exactly which revision it was built to, so a change
next month cannot rewrite a job from last month. The system refuses to start production on a BOM that is not
released.

**Controlled documents (E).** Each document has a number from your convention, a revision, a state and an owner. The
register shows what is current and what is superseded. Releasing and distributing are recorded events, with
acknowledgement from recipients. Controlled engineering documents are kept distinct from general photos and
attachments, so evidence cannot be mistaken for an approved drawing.

**Structured testing (M, H).** A test record holds real readings: value, unit, tolerance, instrument and
calibration state, tester and reviewer. Pass or fail is computed from the acceptance limits, on the server, so it
cannot be bypassed by another screen or a direct call. A failed test raises a non-conformance, and a retest keeps the
original. Missing evidence blocks release.

**Gates that fail closed.** A product or BOM can require a route and mandatory checkpoints. If the required data
is missing, the system does not allow completion or dispatch. An authorised override is possible only with a stated
reason and is permanently audited.

## 5. Artificial intelligence

We propose AI as an assistant, never as an approver.

| Capability | Runs locally? | Notes |
|---|---|---|
| Natural-language search across documents the user is allowed to see | Yes, with a local model and embeddings | Respects document and record permissions; answers show their source |
| Retrieval over specifications, QAPs, travellers, past jobs, quotations, POs, BOMs | Yes | Same permission model as the rest of the system |
| Drafting quotations, estimates, work instructions, inspection plans, reports from approved templates | Yes for drafting; quality improves with larger models | Always a draft; a person approves |
| Missing-document and incomplete-record detection | Yes | Rule-based checks plus AI explanation |
| Document classification and metadata extraction | Yes | Suggests metadata; user confirms |
| Natural-language queries over operational data | Yes, restricted to the user's permissions | Read-only |
| Management summaries | Yes | Derived from reconciled figures |

**Local deployment.** Open-weight models can run on DSEW's own server. A modest GPU workstation (indicative cost in
the commercial proposal) gives usable speed for search and drafting; without a GPU, a smaller model works with
slower responses. **External APIs** are optional and would carry usage charges; they are off by default so no company data
leaves your premises.

**Guardrails.** AI cannot approve a quotation, release a document, alter financial records or authorise a quality
release. It acts with the permissions of the user who asked. Where the answer is uncertain or unsupported by the
records, it says so rather than inventing. Essential manufacturing workflows do not depend on AI being available.

## 6. User interface and ease of use

- A modern, responsive interface that works on office PCs and on phones and tablets for the shop floor.
- Searchable, sortable, filterable lists, saved views, and links between related records: a project opens to its
  customer, quotation, order, BOM, drawings, job, traveller, QAP, inspections, tests and documents.
- Recently viewed items and a personal list of pending tasks and approvals.
- Changes to approved records follow the revision or amendment process; the interface offers the correct path rather
  than a blocked edit.
- Printable, branded documents: quotations, travellers, packing lists, test certificates, FAT reports.
- English and Hindi. Interface labels in Hindi and Devanagari data entry are planned for Phase 5; print templates
  will embed suitable fonts.
- Works in current Chrome, Edge and Firefox on Windows. Accessible contrast and 44-point touch targets on phones.

## 7. Finance and Tally Prime integration

**Position.** Tally Prime remains DSEW's accounting system and book of record. Verity is the operational record
for jobs, stock quantities and quality evidence. Verity never posts directly into your ledgers.

**Proposed integration method.** A small connector installed on a machine that can reach TallyPrime, using Tally's
native XML-over-HTTP interface (TallyPrime must be running with the DSEW company loaded). Every record carries an
external ID so a retry never duplicates a voucher; failures go to an error queue with retry and a daily
reconciliation report.

| Data | Direction (proposed) | Frequency |
|---|---|---|
| Customer and supplier masters | Verity to Tally | On change, batch every 15 minutes, or on demand |
| Sales invoices, credit and debit notes | Verity to Tally | Same |
| Verified purchase invoices | Verity to Tally | Same |
| Receipt and payment status, outstanding by party | Tally to Verity (read) | Same |

**To be confirmed in a short spike before we commit:** the TallyPrime release DSEW runs, its licence mode,
the company configuration, and which records DSEW wants to flow in each direction. Limitations will be stated in
writing: Tally must be running and reachable, and the schedule is batch rather than instantaneous. GST computation
remains in Tally; Verity supplies transaction data and tracks status.

## 8. Technical architecture

| Layer | Choice | Licence cost |
|---|---|---|
| Application | TypeScript, Next.js and React web application, server-side rendering | Open source, none |
| Data | PostgreSQL 16, row-level security isolating each company's data | Open source, none |
| Identity | Keycloak (OpenID Connect), optional multi-factor | Open source, none |
| Files | S3-compatible object storage (SeaweedFS), with checksum on every stored file | Open source, none |
| Packaging | Docker containers, one-command install, upgrade and backup scripts | Open source, none |
| Reverse proxy and TLS | Caddy or nginx with your internal certificate authority | Open source, none |

No per-user, per-module or subscription licence is required to run the platform. Optional paid items are listed
explicitly in the commercial proposal (WhatsApp Business API, e-way bill provider, any external AI service). A
licence inventory of every third-party component is part of the handover.

**Extensibility.** New departments, workflows, product families and users are added by configuration and by new
capabilities that plug into the platform. This is how the system adds modules without rebuilding the foundation.

**Integration and API.** A permissioned REST interface with API keys tied to a user, so an integration can never
exceed the permissions of the person who created it. Documentation is delivered for each interface we implement.

## 9. Deployment on your infrastructure

### Windows Server 2019: our direct answer

Verity's runtime is Linux-based. We **do not** propose running it natively on Windows Server 2019, and we do not
recommend Docker Desktop or WSL for production there: WSL 2 is not a supported production path on Server 2019, and
Windows containers cannot run our Linux components.

**Proposed approach.** Run one Linux virtual machine (Ubuntu Server LTS) on your Windows Server 2019 host using
the Hyper-V role that is part of Windows Server. The VM holds the application, PostgreSQL, file storage and
Keycloak. The Windows host itself is not modified beyond enabling Hyper-V. If the host is too small or busy, the
practical alternative is a small dedicated server (or a refurbished workstation-class machine) running the same
VM, placed beside your existing server. Licensing of the Windows host and any guest is for your Microsoft partner to
confirm; the Linux guest itself carries no licence cost.

**What we have verified and what we have not.** We have run the install, schema migration, identity sign-in and
file-upload paths on our own Linux test environments, and exercised upgrade checks. We have **not** yet completed
a combined rehearsal of database, files and identity restore on a clean second environment, tested a real phone
uploading over HTTPS through the proxy, or run on your Windows Server 2019. Those are explicit acceptance steps in
the deployment phase, to be passed on a test VM before go-live. We will not commit a date for installation on your
premises until your server facts are surveyed.

### Your 15 questions

| # | Question | Answer |
|---|---|---|
| 1 | Architecture and stack | Section 8. |
| 2 | Direct on Windows Server 2019? | No. Linux VM under Hyper-V, or a small separate host. |
| 3 | Recommended hardware | For up to about 50 named users, 20 concurrent: 8 vCPU, 32 GB RAM, 500 GB mirrored SSD for OS and database, 2 to 4 TB for documents with growth room, a separate backup target at least equal to data size, UPS, gigabit LAN. Optional GPU workstation for local AI. Confirmed after the survey. |
| 4 | Database and licence | PostgreSQL 16, open source, no licence fee. |
| 5 | Browsers and devices | Current Chrome, Edge, Firefox on Windows; Android and iOS phones and tablets for shop floor. |
| 6 | Network and remote access | Inside the plant over LAN. Remote access through your VPN (recommended) or a hardened reverse proxy with TLS and MFA. We do not expose the server to the internet by default. |
| 7 | Backup and recovery | Nightly encrypted database and file backup to a separate target, plus an identity-configuration backup; a documented restore to a clean environment, rehearsed before go-live and yearly under AMC. Target recovery time and data-loss window agreed with you; typical proposal: recovery within one working day, at most 24 hours of data at risk, tightened with hourly database backups if you want. |
| 8 | Security, authentication, audit | TLS, role-based permissions (action, entity, scope), per-company data isolation enforced in the database, MFA through Keycloak, immutable audit log of who changed what and when, API keys bound to a user. |
| 9 | Encryption and secure remote access | TLS in transit; encrypted backups; disk encryption of the VM or host recommended; VPN or MFA-protected proxy for remote use. |
| 10 | Performance and growth | The design target is 50 named users and 20 concurrent. A load test against an agreed workload is part of the deployment phase. Document storage grows on a separate volume sized to your retention. |
| 11 | Offline operation | The system runs on your LAN with no internet dependency. Browser-offline data entry on phones is not in the baseline; capture on a briefly disconnected phone can be added as an enhancement. |
| 12 | Integration and API | Section 8. Tally Prime connector in Phase 3. |
| 13 | Repository and version control | A private repository for DSEW-specific work, accessible to DSEW from the start. See the ownership document. |
| 14 | Test, staging, production | Three environments: test (your team verifies each sprint), staging (release rehearsal, backup restore drill), production. |
| 15 | Upgrades and long-term support | Versioned releases, tested upgrade and rollback, migration safety checks before any database change, security patches under the AMC. |

## 10. Security and data protection summary

- **Tenant isolation in the database**, not only in application code. A mistake in one screen cannot expose another
  company's data, and this is tested on every change.
- **Authorisation on the server for every action.** Hiding a button is never the only control.
- **Audit trail** records actor, time, record, field and reason, and cannot be edited or deleted through the application.
- **Reversible access suspension** without deleting history, effective at the next request; permanent removal is also available.
- **Secrets** are never stored in the repository; encryption keys are held in DSEW-controlled configuration.
- **Controlled egress.** The application makes no outbound connection unless a feature you enabled needs one; an
  outbound-network restriction test is part of acceptance.
- **Graceful degradation.** If the identity service or object store is briefly down, existing sessions keep working,
  new sign-ins or uploads fail with a clear message, and quality gates are never relaxed.

## 11. What we have not claimed

- We have not claimed Windows-native operation, attendance-device compatibility or e-way bill integration; each is
  conditional on facts we will verify with you.
- We have not claimed that Hindi, AI or payroll are included in the first release; they are scheduled in later phases.
- We have not claimed that any capability is validated against DSEW's workflow. That validation is exactly what the
  first phase and every sprint demonstration are for.
