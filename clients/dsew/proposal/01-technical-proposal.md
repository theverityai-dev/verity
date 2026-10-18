# Technical Proposal

D & S Electric Works. Integrated operations platform for engineering-led, project-based manufacturing.

> **Status: DRAFT, pending company approval.** This proposal offers a bounded Phase 1 (see the Commercial Proposal).
> It does **not** offer every module in DSEW's enquiry within that phase.

## 1. Executive summary

DSEW makes engineered, often one-off products: transformers, magnet coils, custom electromagnets and research
equipment. The business risk is not in recording what was made. It is in making sure that what was approved is what
was built, that every drawing revision and measurement can be traced afterwards, and that nothing leaves the factory
without the required checks.

We propose to start with exactly that core: one job that carries a project from enquiry through quotation, a
revision-controlled bill of materials, controlled documents, manufacturing, structured test records and dispatch.
Changing an approved record goes through a revision or amendment, never an edit. Quality rules are enforced by the
system, not by good intentions.

**How we will deliver.** We build on Verity, our own multi-tenant business platform, so that tenant isolation,
permissions, audit, stock integrity and approvals are not rebuilt for you. We add the DSEW-specific engineering,
document and quality capabilities in two-week sprints, each demonstrated on a test system, and deploy on your premises.

**What this proposal is not.** It is not a promise of all modules A to S of the enquiry for one fixed fee. Phase 1 is
a defined core. The remaining modules are future phases, quoted separately once Phase 1 has fixed their depth, and one
item (Tally Prime integration) is excluded pending DSEW's written acceptance (section 7).

## 2. How we describe capability status

None of these labels means "validated against DSEW's workflow". That validation is what Phase 1 does.

| Label | Meaning |
|---|---|
| **Foundation present** | The core behaviour exists in the platform and has been demonstrated with fictional data. It is configured and extended for DSEW. |
| **Extend** | Part of it exists; the DSEW-specific part (revisions, tolerances, your formats) is built in Phase 1 if marked included. |
| **Build** | Not present today. |
| **In Phase 1** | Included in the fixed Phase 1 price, within the boundary in the Commercial Proposal. |
| **Future phase** | Not included in the Phase 1 price; quoted separately. |
| **Excluded, deferred** | Not offered. Needs DSEW's written acceptance. |

## 3. Coverage of the enquiry (modules A to S)

| Module | Platform status | Phase 1 | What Phase 1 delivers, or why not |
|---|---|---|---|
| **A. CRM** | Extend | Partly | Enquiry register and quotation flow, customer master. Contact directory, RFQ/tender tracker, meetings, email filing are future phase |
| **B. Project management** | Foundation present | In Phase 1 | Project job, milestones, tasks and dependencies, timesheets, cost lines, quoted versus actual. Risk register and deeper WBS are future phase |
| **C. Enquiry, quotation, sales** | Extend | Partly | Quotation revisions, approval, DSEW print format, order and job creation. PO-versus-quote comparison, alternative offers, estimate build-up templates, retention and LD tracking are future phase |
| **D. Engineering and PLM** | Extend | Partly | Revision-controlled BOM (single-level) with release and pinned revision per order. Multi-level BOM, full ECR/ECO and design reviews are future phase |
| **E. Document management** | Build | Partly | Controlled documents with one numbering convention, revisions, states, register, permissions, audit. Transmittals, comparison, retention rules are future phase |
| **F. Manufacturing execution** | Foundation present | Partly | Orders from a released BOM, routes, operations, hold and resume, material issue. Machine allocation, operator time, subcontracting, planned-versus-actual consumption are future phase |
| **G. Travellers** | Extend | Partly | Printable traveller in a DSEW format, QR identity of a finished unit. Hold and witness points beyond pass/fail checks, customer-facing variants, lot identification are future phase |
| **H. Quality management** | Extend | Partly | Quality gates, failed-or-missing check blocking, authorised audited override. QAP/ITP, NCR/CAPA, audits, FAI/FAT packs are future phase |
| **I. Barcode, QR, traceability** | Extend | No | Future phase (the QR identity of a finished unit is included under G) |
| **J. Procurement, vendors** | Extend | No | Future phase |
| **K. Inventory, warehouse** | Extend | Foundation only | Existing stock behaviour is used as is. Extensions are future phase |
| **L. Production planning, MRP** | Build | No | Future phase |
| **M. Testing, equipment** | Build | Partly | Test templates for up to 3 product families, readings with unit and tolerance, automatic pass/fail, report, basic instrument register with calibration-due check. Maintenance schedules, FAT packs, customer certificates beyond one format are future phase |
| **N. Finance and Tally Prime** | n/a | **Excluded, deferred** | **No Tally Prime integration. Requires DSEW's written acceptance (section 7).** Project cost and quoted-versus-actual visibility is included under B |
| **O. HR and payroll** | Extend | No | Future phase |
| **P. Dispatch, logistics** | Extend | Partly | Dispatch record, packing list, delivery challan, partial shipment, gated on completion and tests. E-way bill, warranty tracking are future phase |
| **Q. Contracts, compliance, risk** | Build | No | Future phase |
| **R. Dashboards and BI** | Extend | Partly | Four read-only views (quotations, jobs, production, quality). Role dashboards and exports are future phase |
| **S. Notifications, workflow** | Extend | Partly | Existing approval chains. Escalations, e-mail, WhatsApp, rule configuration are future phase |
| **AI** | n/a | No | Future phase (section 5) |
| **Hindi** | n/a | No | Future phase |

## 4. Engineering, documents and quality: the core of Phase 1

These three areas decide whether the system is trusted on the shop floor and by your customers' inspectors.

**Revision-controlled BOMs (D).** A BOM is never overwritten. A new revision is drafted, reviewed with a stated
reason, and released. A released revision is immutable. A manufacturing order records exactly which revision it was
built to, so a change next month cannot rewrite a job from last month. The system refuses to start production on a
BOM that is not released.

**Controlled documents (E).** Each document has a number from your convention, a revision, a state and an owner. The
register shows what is current and what is superseded. Releasing is a recorded event. Controlled engineering documents
are kept distinct from general photos and attachments, so evidence cannot be mistaken for an approved drawing.

**Structured testing (M).** A test record holds real readings: value, unit and tolerance, with tester and reviewer.
Pass or fail is computed from the acceptance limits on the server, so it cannot be bypassed by another screen or a
direct call. A missing or failed required check blocks completion and dispatch. An authorised override needs a stated
reason and is permanently audited.

## 5. Artificial intelligence (future phase)

Not part of Phase 1. For planning only: if DSEW later wants AI, we propose it as an assistant and never as an approver.
Search and drafting could run on local models on DSEW's own server, respecting each user's permissions, with answers
traceable to their sources; external AI services would be optional and charged by their providers. AI would not
approve quotations, release documents, alter records or authorise quality releases, and no essential workflow would
depend on it. Scope and price would be set only if DSEW asks.

## 6. User interface

- A modern, responsive interface for office PCs and for phones and tablets on the shop floor.
- Searchable, sortable, filterable lists, and links between related records: a project opens to its customer,
  quotation, order, BOM, job, traveller, tests and documents.
- Changes to approved records follow the revision or amendment path; the interface offers the correct path rather than a
  blocked edit.
- Printable, branded documents in Phase 1: quotation, traveller, test report, packing list, delivery challan.
- English in Phase 1. Hindi is a future phase.
- Current Chrome, Edge and Firefox on Windows. Accessible contrast and 44-point touch targets on phones.

## 7. Requirement of the enquiry not covered: Tally Prime

DSEW's enquiry (section N) asks for Tally Prime integration and for the integration method, licensing, supported
version, synchronisation frequency and limitations to be specified.

**This proposal excludes Tally Prime integration and defers it.** It does not specify a method, version or frequency,
does not price it, and does not claim to meet that requirement. Tally Prime remains DSEW's accounting system and book
of record; Verity neither reads nor writes Tally in Phase 1. DSEW must confirm in writing that it accepts this
exclusion. If DSEW requires integration, it would be scoped and quoted separately after a technical review of DSEW's
TallyPrime setup, and only on explicit authorisation.

## 8. Technical architecture

| Layer | Choice | Licence cost |
|---|---|---|
| Application | TypeScript, Next.js and React web application | Open source, none |
| Data | PostgreSQL 16, row-level security isolating each company's data | Open source, none |
| Identity | Keycloak (OpenID Connect), optional multi-factor | Open source, none |
| Files | S3-compatible object storage (SeaweedFS), checksum on every stored file | Open source, none |
| Packaging | Docker containers, install, upgrade and backup scripts | Open source, none |
| Reverse proxy and TLS | Caddy or nginx with your internal certificate authority | Open source, none |

No per-user, per-module or subscription licence is required to run the platform. A licence inventory of every
third-party component is part of the handover.

**Integration and API.** A permissioned REST interface with API keys tied to a user, so an integration can never exceed
that user's permissions. No external integrations are included in Phase 1.

## 9. Deployment on your infrastructure

### Windows Server 2019: our direct answer

Verity's runtime is Linux-based. We **do not** propose running it natively on Windows Server 2019, and we do not
recommend Docker Desktop or WSL for production there: WSL 2 is not a supported production path on Server 2019, and
Windows containers cannot run our Linux components.

**Proposed approach.** Run one Linux virtual machine (Ubuntu Server LTS) on your Windows Server 2019 host using the
Hyper-V role. The VM holds the application, PostgreSQL, file storage and Keycloak. The Windows host is not modified
beyond enabling Hyper-V. If the host is too small or busy, the alternative is a small dedicated server running the same
VM. Licensing of the Windows host is for your Microsoft partner to confirm; the Linux guest carries no licence cost.

**What we have verified and what we have not.** We have run the install, schema migration, identity sign-in and file
upload paths on our own Linux test environments. We have **not** yet completed a combined rehearsal of database, files
and identity restore on a clean second environment, tested a real phone uploading over HTTPS through the proxy, or run
on your Windows Server 2019. Those are explicit acceptance steps, to be passed on a test VM before go-live. We will not
commit a date for installation on your premises until your server facts are surveyed.

### Your 15 questions

| # | Question | Answer |
|---|---|---|
| 1 | Architecture and stack | Section 8 |
| 2 | Direct on Windows Server 2019? | No. Linux VM under Hyper-V, or a small separate host |
| 3 | Recommended hardware | For Phase 1 (15 named users): 4 vCPU, 16 GB RAM, 500 GB mirrored SSD, a separate backup target at least equal to data size, UPS, gigabit LAN. Confirmed after the survey |
| 4 | Database and licence | PostgreSQL 16, open source, no licence fee |
| 5 | Browsers and devices | Current Chrome, Edge, Firefox on Windows; Android and iOS phones and tablets |
| 6 | Network and remote access | LAN inside the plant. Remote access through your VPN. We do not expose the server to the internet by default |
| 7 | Backup and recovery | Nightly encrypted database and file backup to a separate target plus an identity-configuration backup; a documented restore rehearsed before go-live. Recovery time and data-loss window to be agreed with you |
| 8 | Security, authentication, audit | TLS, role-based permissions, per-company data isolation enforced in the database, MFA through Keycloak, immutable audit log, API keys bound to a user |
| 9 | Encryption and remote access | TLS in transit; encrypted backups; disk encryption recommended; VPN for remote use |
| 10 | Performance and growth | Design target for Phase 1 is 15 named users; a load test against an agreed workload is part of acceptance |
| 11 | Offline operation | Runs on your LAN with no internet dependency. Browser-offline data entry on phones is not in Phase 1 |
| 12 | Integration and API | Section 8. No external integrations in Phase 1; Tally Prime is excluded (section 7) |
| 13 | Repository and version control | A private repository for DSEW-specific work, shared from the start; platform source terms are unresolved (document 4) |
| 14 | Test, staging, production | Test and production in Phase 1; a staging environment can be added |
| 15 | Upgrades and long-term support | Versioned releases, tested upgrade and rollback, migration safety checks. Support after warranty is under an AMC to be quoted |

## 10. Security summary

- **Tenant isolation in the database**, not only in application code, tested on every change.
- **Authorisation on the server for every action.** Hiding a button is never the only control.
- **Audit trail** records actor, time, record, field and reason, and cannot be edited through the application.
- **Reversible access suspension** without deleting history, effective at the next request.
- **Secrets** are never stored in the repository.
- **Controlled egress.** The application makes no outbound connection unless a feature you enabled needs one.
- **Graceful degradation.** If the identity service or object store is briefly down, existing sessions keep working,
  new sign-ins or uploads fail with a clear message, and quality gates are never relaxed.

## 11. What we have not claimed

- All modules A to S within the Phase 1 price. They are not included.
- Tally Prime integration. It is excluded.
- Windows-native operation, attendance-device compatibility, e-way bill integration, AI or Hindi in Phase 1.
- That any capability is validated against DSEW's workflow. Phase 1 and each sprint demonstration do that.
