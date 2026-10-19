# Proposal: Verity for D & S Electric Works

**Prepared for:** D & S Electric Works (DSEW), 109, Industrial Area Extension, Rau, Indore 453331, Madhya Pradesh
**Prepared by:** PlotArmour, GSTIN 07TQDPS9711L1ZT, +91 87440 69597, team@plotarmour.in, [address]
**Date:** 20 October 2026
**Valid for:** 60 days

> **Status: NEGOTIATION DRAFT, pending company approval.** Items in [square brackets] are open company decisions.
> The company details, terms and ownership clauses are not final until the company approves them in writing.

## 1. What we are offering

**Verity** is our own operations platform. We own it. We are offering DSEW a **perpetual licence to use Verity,
configured for DSEW, for a one-time fee.** Everything below is part of Verity itself: no third-party software to buy,
and no separate bespoke code base to maintain.

We configured the scope from your enquiry **and from our own understanding of how DSEW works**: an engineered,
one-off product only stays trustworthy if you can show that what was approved is what was built, and that nothing left
the factory without its checks. So Phase 1 centres on that chain: quotation, revision-controlled BOM, controlled
documents, manufacturing, structured test records and dispatch, rather than on a long list of screens.

| | |
|---|---|
| One-time licence and implementation fee (ex GST) | **₹4,00,000** |
| GST at 18% (illustrative; IGST is expected because our GSTIN is registered in Delhi and DSEW is in Madhya Pradesh; confirmed at invoicing) | ₹72,000 |
| **Total including GST** | **₹4,72,000** |
| Licence | Perpetual, for DSEW's own business, one site, up to 15 named users |
| Annual or per-user licence fee | None. The only recurring charge is the 12-month bundled fee below |
| 12-month bundled fee | 12 months from go-live, as DSEW requires, at **₹8,500 per month** (ex GST): ₹1,02,000. It bundles the defect warranty, testing and UAT assistance, and routine maintenance. No separate warranty or maintenance charge applies in those 12 months |
| Delivery | About 11 weeks from the effective date (document 2) |

| First 12 months, all charges | ₹ ex GST | GST 18% | ₹ incl. GST |
|---|---|---|---|
| One-time licence and implementation fee | 4,00,000 | 72,000 | 4,72,000 |
| 12-month bundled fee: 12 months at 8,500 | 1,02,000 | 18,360 | 1,20,360 |
| **Contract value for the first 12 months** | **5,02,000** | **90,360** | **5,92,360** |

More users, more sites and new modules are quoted separately. No other phase is priced in this document.

## 2. What the fee includes

1. DSEW workspace, up to 10 roles and permissions, and CSV import of customers, suppliers, items and components.
2. Enquiry to quotation with kept revisions and approval, a DSEW-format quotation print, and conversion to an order and
   project job (milestones, tasks, timesheets, cost lines, quoted versus actual).
3. Revision-controlled bill of materials (single level): draft, review, release; a released revision cannot be edited;
   each manufacturing order records its exact revision.
4. Controlled documents: one agreed numbering convention, revisions, states, register, permissions, audit history.
5. Manufacturing order from a released BOM, route and operations, hold and resume, and a printable traveller in one DSEW
   format with the finished unit's QR identity.
6. Structured test records for up to 3 product families: readings with value, unit and tolerance, automatic pass or
   fail, tester and reviewer, one printable report format, and a basic instrument register with calibration due dates.
7. Quality gates: a failed or missing required check blocks completion and dispatch; an authorised override needs a
   reason and is audited.
8. Dispatch record, packing list and delivery challan (one format each), with partial shipments.
9. Four read-only dashboard views: quotations, jobs, production and quality.
10. A documented export of DSEW's data: records as CSV and files in their original form, with an index.
11. Installation on one DSEW Linux VM, backup and restore, 1 day administrator training and 2 days user training,
    administrator and user guides.
12. Testing, acceptance, and the 12-month period in section 4.

## 3. Your enquiry, module by module

| Enquiry module | In this licence |
|---|---|
| A CRM | Enquiry register and customer master. Contacts, tender tracker, meetings: later |
| B Projects | Included (job, milestones, tasks, timesheets, cost lines) |
| C Quotation and sales | Included: revisions, approval, order and job. PO comparison, alternative offers: later |
| D Engineering and BOM | Revision-controlled single-level BOM. Multi-level BOM, ECR/ECO: later |
| E Documents | Controlled documents. Transmittals: later |
| F Manufacturing | Orders, routes, operations. Machine allocation, subcontracting: later |
| G Travellers | One traveller format and QR identity. Hold and witness points, lot details: later |
| H Quality | Gates and override. QAP/ITP, NCR/CAPA, audits: later |
| I Barcode and traceability | Later |
| J Procurement, K Inventory | Existing stock behaviour as is. Extensions: later |
| L MRP | Later |
| M Testing and equipment | Test records and basic instrument register. Maintenance, FAT packs: later |
| N Finance and accounting | Later, built inside Verity with no third-party software. Job-cost visibility is under B |
| O HR and payroll | Later: employees, attendance, leave, timesheets, payroll. Attendance-device integration only after the device is verified |
| P Dispatch | Dispatch pack and gates. E-way bill: later |
| Q Contracts and risk | Later |
| R Dashboards | Four views. Role dashboards and exports: later |
| S Notifications | Existing approvals. Escalations, e-mail, WhatsApp: later |
| AI (section 6), Hindi | Later |

"Later" means not in this fee and quoted separately, after DSEW has tested the first release and told us what matters.

## 4. The 12-month period: warranty, testing support and maintenance

DSEW will test Verity in its real workflows for **12 months from go-live**. For that whole period we charge one
bundled fee of **₹8,500 per month** (₹1,02,000 ex GST for 12 months; ₹10,030 per month including 18% GST), invoiced
[monthly in advance, company to confirm]. It starts at go-live and ends after 12 months.

**The bundled fee replaces a separate warranty, a separate testing-support charge and a separate maintenance contract.
None of them is charged on top during the 12 months.** It covers exactly three things:

1. **Defect warranty.** Correcting any reproducible defect where Verity does not meet the signed Phase 1 requirements,
   whether found in UAT or at any time in the 12 months. A defect caused by DSEW's own changes, hardware, network or
   third-party software is not a Verity defect.
2. **Testing and UAT assistance.** Helping DSEW run the agreed UAT scripts and test real jobs, reproducing and triaging
   each reported issue, recording DSEW's feedback, and reviewing reported issues and feedback with DSEW at an interval
   agreed at the start.
3. **Routine maintenance.** Keeping the DSEW installation on Verity's tested releases (stability and security
   updates), helping run and check backups and restores, and administrator guidance by email (team@plotarmour.in) and
   phone (+91 87440 69597). No response-time commitment is made.

**Not covered. Each is quoted separately and needs DSEW's written approval before any work:** new features; changes
to agreed workflows or to a requirement DSEW has already accepted; additional integrations; new product families,
reports, formats, users or sites; data cleansing or migration beyond the agreed imports; hardware or network faults; and
on-site work. DSEW's testing feedback is used to prioritise and quote these.

**After the 12 months,** no warranty, testing support or maintenance is included. Any support afterwards needs a
separately agreed renewal in writing. No annual contract is part of this offer.

**Travel:** the fee assumes remote work apart from the site survey visit. [On-site days: company to decide whether
included or charged at cost.]

## 5. The options you asked for, and the roadmap

| Your option | Our response |
|---|---|
| Option 1: minimum viable product | **This proposal** (sections 1 and 2): CRM basics, projects, quotations, document numbering and management, manufacturing jobs, travellers and quality gates, plus revision-controlled BOM and structured test records. Fixed price and schedule |
| Option 2: complete integrated ERP | Not priced here. The "later" items in section 3 are the route to it, quoted after DSEW has tested Phase 1 |
| Option 3: phased implementation | Phase 1 is priced and scheduled. Each later phase gets its own fixed price and schedule when quoted |

**Later phases, in dependency order** (no prices yet; each is quoted separately with its own schedule):

| Order | Content | Why this order |
|---|---|---|
| 2 | Multi-level BOM, ECR/ECO, document transmittals, CRM contacts and tender tracking | Builds directly on released BOMs and controlled documents |
| 3 | Procurement, inventory extensions, barcode/QR scanning, lot, heat and serial traceability | Traceability needs receipts and stock movements |
| 4 | Full quality system: QAP/ITP, incoming inspection, NCR/CAPA, FAT packs, audits | Needs structured tests and traceability |
| 5 | MRP and production planning | Needs BOMs, stock and lead times |
| 6 | Finance and accounting, contracts and risk, HR and payroll, role dashboards and exports | Needs jobs, stock and invoicing data to exist |
| 7 | AI, Hindi, e-way bill, WhatsApp and e-mail automation | Optional layers on top of working data |

## 6. Artificial intelligence (not in Phase 1)

You asked us to propose practical AI. It is later work, never an approver, and always inside each user's permissions. It
would not approve quotations, release documents, alter records or authorise quality releases, and no essential
workflow would depend on it. This table is a feasibility view, not a delivered feature; we would prove each in a small
pilot before pricing it.

| AI capability you listed | Local on DSEW's server | External service |
|---|---|---|
| Natural-language search across authorised documents and records, including past quotations, POs, BOMs and jobs | Feasible with open models and search | Not needed |
| Retrieval from specifications, QAPs, travellers and project history | Feasible | Not needed |
| Document classification and metadata extraction | Feasible, accuracy to be tested | Optional for hard cases |
| Missing-document and incomplete-record detection | Feasible (mostly rules) | Not needed |
| Natural-language questions over operational data | Feasible, read-only | Optional |
| Drafting quotations, estimates, work instructions, inspection plans and reports from approved templates | Feasible with smaller models; quality limited | Optional for better quality; usage charges |
| Management summaries | Feasible | Optional |

Local models need suitable hardware (a GPU workstation is the usual choice) and carry no usage charges. External
services are optional, charged by their providers, and off unless DSEW enables them.

## 7. Commercial headings you asked for

| # | Heading | Position |
|---|---|---|
| 1 | Requirement analysis and system design | Included: week 1 specification |
| 2 | UI/UX design and prototyping | Included for the printed formats and key screens: mock-ups approved in week 1 |
| 3 | Development charges by module | One fixed fee for the Phase 1 list in section 2; not itemised per module. Later modules quoted separately |
| 4 | Third-party software and licences | None |
| 5 | AI model and API costs | Not included; priced only if AI is added |
| 7 | Data migration and initial configuration | CSV import of agreed masters included; cleansing and historical migration excluded |
| 8 | Testing and deployment | Included |
| 9 | Training and documentation | Included (1 + 2 days, guides, runbooks) |
| 10 | Server, infrastructure and cybersecurity | DSEW's own costs, estimated in document 2; security measures in document 2; independent penetration testing excluded |
| 11 | Annual maintenance contract | None. The first 12 months are covered by the bundled fee; any later support is a renewal agreed in writing |
| 12 | Warranty and post-deployment support | The bundled fee in section 4 |
| 13 | Change-request rates | Each request is quoted separately and approved in writing; no rate card is published |
| 14 | Recurring per-user, per-module or subscription fees | None, apart from the ₹8,500 a month for the first 12 months |
| 15 | Taxes | GST at 18% on all fees (see section 1) |

**Cost over three to five years.** What is fixed today: ₹5,02,000 ex GST in the first 12 months. Not yet priced:
support after 12 months, later phases, AI. DSEW's own infrastructure is estimated in document 2. No third-party
licence fees apply.

## 8. Payment (proposed)

Each invoice carries GST at the rate then applicable. Payment terms: [15 days] from invoice.

| Milestone | Share | ₹ ex GST | GST 18% | ₹ incl. GST |
|---|---|---|---|---|
| 1. Start: signed order and product owner named | 30% | 1,20,000 | 21,600 | 1,41,600 |
| 2. Mid-point: sprint 3 demonstration accepted, or deemed accepted after 5 working days | 40% | 1,60,000 | 28,800 | 1,88,800 |
| 3. Completion: UAT signed off and go-live gates passed (document 2). Payable anyway if DSEW-side delays hold the gates up for more than [15 working days] after UAT passes | 30% | 1,20,000 | 21,600 | 1,41,600 |
| **Total** | **100%** | **4,00,000** | **72,000** | **4,72,000** |

The 12-month bundled fee is invoiced separately from go-live.

## 9. Ownership and licence in short

Verity, including everything configured or developed for DSEW, is owned by PlotArmour and is licensed, not sold. DSEW
owns its business data and can export it. **Source code is not delivered.** Full terms are in document 3; several
clauses are still to be settled with counsel.

## 10. What we have and have not verified

Verity's foundations (data isolation, permissions, audit, stock, manufacturing orders, QC checkpoints, project jobs,
approvals, QR identity) exist and have been run on our test environments with fictional data. The BOM revision,
controlled document and structured test capabilities are completed during Phase 1. We have **not** yet tested on DSEW's
host or on Windows Server 2019, run a real-phone HTTPS upload, rehearsed the combined database, files and identity
restore, or run the outage tests. These are go-live gates (document 2); **production use is blocked until they pass.**
