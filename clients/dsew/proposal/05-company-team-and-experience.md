# Company, Team and Experience

> **Status: NEGOTIATION DRAFT.** Fields in [square brackets] must be completed by the company before sending. We have
> deliberately not filled in any statement about clients, years or references that we cannot back with a document.

## 1. Company profile

| | |
|---|---|
| Legal name | [Company legal name] |
| Registered address | [Address] |
| Year founded | [Year] |
| Registration and GST details | [CIN / LLP / proprietorship; GSTIN] |
| Contact | [Name, phone, email] |
| Website | [URL] |

**Who we are.** [Company legal name] builds Verity, a business operating platform for service and manufacturing
organisations. [Company to describe its size and team accurately; no claim about team seniority or staffing is made in
this draft.]

## 2. What exists today and what is built for DSEW

"Exists today" means the capability is present in the platform and has been exercised with fictional data. It does not
mean it has been configured or validated for DSEW or accepted on DSEW's host.

| Capability | Exists in the platform today | Built or configured for DSEW in Phase 1 |
|---|---|---|
| Per-company data isolation enforced in the database; role, entity and scope permissions; audit trail | Yes | Role set for DSEW |
| Authentication through an identity provider, with an on-premises (Keycloak) mode | Yes, tested on company test environments | DSEW configuration |
| Stock ledger with reversal-only corrections; items, balances, counts | Yes | Used as is |
| Manufacturing orders from a BOM, route stages, operations, hold, QC checkpoints with evidence, dispatch, reservations | Yes | BOM revisions, measured values, gates |
| Project jobs with milestones, tasks, timesheets, cost lines, quote revisions | Yes | DSEW templates and formats |
| Approvals, evidence storage, QR passport for finished units | Yes | DSEW workflows |
| Install, backup, restore and upgrade scripts and a containerised installation package | Scripts and package exist. A combined database, files and identity restore has **not yet** been rehearsed end to end, and nothing has been tested on DSEW's host | Rehearsal and acceptance on DSEW's host |
| Revision-controlled BOM, controlled documents, structured test records | No | Built in Phase 1 |
| Everything marked future phase, and Tally Prime integration | No | Not in Phase 1 (Tally excluded) |

## 3. Relevant experience

[The company must replace each cell with a verifiable statement, or write "no previous client deployment". No track
record is implied by this draft.]

| Area | Our position |
|---|---|
| Platform design for manufacturing, inventory, project and quality workflows | [Describe projects and years, with references, or state none] |
| Project-based, one-off manufacturing | [Describe, or state that DSEW would be an early reference customer] |
| ERP, MES, QMS, DMS | [Describe client engagements, or state none] |
| Windows Server deployment | [State actual experience. The proposed approach is a Linux VM under Hyper-V, to be proven on DSEW's host] |
| Barcode-based traceability | Not part of Phase 1 |
| Local AI and document intelligence | Not part of Phase 1 |
| References | [Contacts who agree to be called, or "available after NDA", or none] |

## 4. Proposed team

[The company must name only people who will actually work on Phase 1. No roles are committed by this draft.]

| Role | Name | Responsibility | Allocation |
|---|---|---|---|
| Engagement lead | [Name] | Commercials, steering, escalation | [to be set] |
| Project manager and business analyst | [Name] | Specification, sprint plans, status, UAT coordination | [to be set] |
| Technical lead | [Name] | Architecture, security, quality of code | [to be set] |
| Engineers | [Names] | Module development | [to be set] |
| Quality and deployment | [Name] | Test scripts, installation, backup and restore | [to be set] |

Expected duration: Phase 1 about eleven weeks from the effective date.

## 5. Contacts and escalation

| Purpose | Contact |
|---|---|
| Project contact for DSEW | [Name, email, phone] |
| Escalation | [Name, email, phone] |

No support hours, response targets or emergency number are promised in this proposal. Defects found during the
warranty period are reported to the project contact; ongoing support, if wanted, would be agreed separately in writing
(Commercial Proposal, section 7). **On-site attendance** is not assumed; see Commercial Proposal, section 7.

## 6. A demonstration of the working foundation

We can demonstrate the existing platform on fictional manufacturing data at your premises or remotely: a project job
with quote revisions and approval, a manufacturing order with route stages and quality checkpoints that block
completion, a printable traveller, a dispatch pack and a QR identity for a finished unit. We will be explicit during
the demonstration about which parts exist and which are proposed.
