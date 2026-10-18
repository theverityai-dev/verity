# Commercial Proposal

D & S Electric Works. All amounts in Indian rupees (₹) and **exclusive of GST (18% additional)** unless stated.

> **Status: DRAFT commercial terms, pending written approval by [Company legal name].** The figures below are
> proposed for approval. They are not a final price until the company confirms them in writing and DSEW accepts the
> Phase 1 specification.

## 1. What this price buys

This proposal offers **one strictly bounded initial implementation, Phase 1: Foundation Release**, at a fixed price.
It is deliberately not the whole of the enquiry. Modules A to S in DSEW's enquiry are a very large programme; a
fixed ₹5 lakh phase can responsibly deliver a defined core of them, built on a platform that already exists, and
cannot deliver all of them. Everything not listed as included in section 2 is **not in this price** and is quoted
separately after Phase 1 has defined its depth.

| | Phase 1: Foundation Release |
|---|---|
| Fixed price (ex GST) | **₹5.00 lakh** |
| GST at 18% | ₹0.90 lakh |
| **Price including GST** | **₹5.90 lakh** |
| Duration | About 11 weeks: 1 week discovery and specification, then 5 two-week sprints |
| Users | Up to 15 named users, one site, local network |
| Pricing basis | Fixed for the scope in section 2. Anything outside it is a change request approved in writing before work |

No margin, discount or credit is applied in this document. There is no credit for the existing platform and no bundled
discount; the price is for the scope listed, as drafted.

## 2. Included in Phase 1 (the complete list)

| # | Deliverable | Boundary |
|---|---|---|
| 1 | DSEW workspace, organisation, roles and permissions | Up to 10 roles; 15 named users; one site |
| 2 | Master data | CSV import with validation for customers, suppliers, items and components, using agreed templates; no historical transactions |
| 3 | Enquiry to quotation | Enquiry register, quotation with revisions (each revision preserved), approval, DSEW-format printed quotation, structured lost reason |
| 4 | Order and project job | Convert an approved quotation to an order and project job; milestones, tasks and dependencies, timesheets, cost lines, quoted versus actual |
| 5 | Revision-controlled bill of materials | Draft, review, release, superseded states; a released revision cannot be edited; each manufacturing order records the exact revision; change reason and approval for a new revision. Single-level structure (as the platform BOM exists today) |
| 6 | Controlled documents | One agreed numbering convention, revisions, draft/review/approved/released/superseded states, document register, role permissions, audit history. No transmittal workflow |
| 7 | Manufacturing order, route and traveller | Orders from a released BOM, route stages and operations, hold and resume, material issue, printable traveller in a DSEW format, QR identity of a finished unit |
| 8 | Structured test records | Test templates for up to 3 product families; readings with value, unit and tolerance; server-side pass or fail; tester and reviewer; printable test report; basic instrument register with a calibration-due check |
| 9 | Quality gates | A stage or order cannot complete with a failed or missing required check; dispatch needs the order complete and the required tests approved; an authorised override needs a reason and is audited |
| 10 | Dispatch | Dispatch record, packing list and delivery challan in a DSEW format, partial shipment |
| 11 | Dashboards | Four read-only views: quotations, jobs, production and quality |
| 12 | Deployment | Installation on one Linux virtual machine on a DSEW test host after the server survey; backup and a restore drill; production go-live only after the drill passes |
| 13 | Training and documentation | 1 day administrator training, 2 days user training, quick-reference cards, administrator and user guides, runbooks (install, backup, restore, upgrade), sprint demonstrations |
| 14 | Acceptance | UAT scripts agreed in advance for the above; sign-off per scenario |
| 15 | Warranty | Defect fixes against the agreed specification for [3 months] from go-live (proposed period, for approval) |

**Acceptance tests (summary).** Each deliverable is accepted when its scripted scenario passes in front of the DSEW
product owner on the test environment, including: a revised quotation keeps earlier revisions; a released BOM cannot
be edited; a reading outside tolerance fails; dispatch is refused until required tests are approved; a user without a
permission is refused; a backup restores on a clean environment with data, files and sign-in.

## 3. Not included in this price

These are **separately scoped future phases or exclusions**. No indicative price is given for them here, because their
depth is not yet defined and we will not guess.

| Area | Status |
|---|---|
| CRM beyond the quotation flow: contact directory, RFQ/tender tracker, meetings and reminders, email filing | Future phase |
| Multi-level BOM, full ECR/ECO workflow, design-review records | Future phase |
| Document transmittals and acknowledgements, document comparison | Future phase |
| Full quality system: QAP/ITP, incoming and final inspection, NCR, CAPA, audits, FAI/FAT packs | Future phase |
| Barcode/QR scanning, lot, heat and serial traceability, product genealogy | Future phase |
| Procurement extensions (requisition, quotation comparison, approved vendor list), inventory extensions (bins, ageing, valuation reports), MRP | Future phase |
| Contracts, compliance and risk management; guarantee and insurance reminders | Future phase |
| HR, attendance, timesheet payroll and Indian statutory payroll | Future phase |
| AI features, Hindi interface, WhatsApp, e-way bill, attendance-device integration | Future phase, each subject to verification |
| Full role dashboards, Excel and PDF export beyond the four views | Future phase |
| Historical data migration, customer portal | Future phase |
| **Tally Prime integration** | **Excluded from this proposal and deferred; requires DSEW's written acceptance. See section 4** |

## 4. Tally Prime: excluded and deferred

DSEW's enquiry (section N, Finance and Accounting Integration) asks for integration with Tally Prime and for the
method, licensing, version, synchronisation frequency and limitations to be stated. **This proposal does not include
a Tally Prime integration, does not price one, and does not state an integration method.** It therefore does not
satisfy that requirement of the enquiry.

What this means for DSEW:

- Tally Prime remains DSEW's accounting system and book of record, unchanged.
- Phase 1 does not create, import, export or synchronise any Tally data. Invoices and receipts are handled in Tally
  as today.
- Phase 1 records operational data only (quotations, orders, jobs, stock quantities, test records).
- **DSEW must confirm in writing that it accepts the exclusion** for Phase 1. If DSEW requires Tally integration, it
  would be a separate scope item, estimated after a technical review of DSEW's TallyPrime version and interface, and
  only if explicitly authorised.

## 5. Payment milestones (proposed)

| Milestone | Share | ₹ lakh ex GST | ₹ lakh incl. GST |
|---|---|---|---|
| Order confirmation and start | 30% | 1.50 | 1.77 |
| Sprint 3 demonstration accepted (mid-point) | 40% | 2.00 | 2.36 |
| UAT sign-off and production go-live | 30% | 1.50 | 1.77 |
| **Total** | **100%** | **5.00** | **5.90** |

Payment terms [15 days] from invoice (proposed). No milestone is payable if its acceptance criteria are not met.

## 6. Warranty, support and maintenance

- **Warranty:** included in section 2, [3 months] from go-live (proposed).
- **Annual maintenance contract (AMC):** optional, quoted separately before go-live. **[AMC rate and inclusions: to be
  set by the company and approved before sending.]** Nothing in the ₹5.00 lakh covers support after warranty.
- **Support hours and response targets:** [to be confirmed by the company].
- **Change requests:** anything outside section 2 is estimated per request and approved in writing before any work.
  **[Rate card: to be set by the company.]** No rates are published in this draft.

## 7. DSEW's own costs (paid to suppliers, not to us)

Indicative planning estimates only, to be confirmed after the server survey.

| Item | Indicative cost |
|---|---|
| Backup target (NAS or disks) and UPS | ₹0.8 to 1.2 lakh |
| New production server, only if the existing Windows Server 2019 host cannot run the VM | ₹3.5 to 4.5 lakh |
| Platform software licences | None (open-source stack) |
| TallyPrime licence | Not affected; no change in Phase 1 |

## 8. Cost picture over five years (what can be stated today)

| Component | Amount |
|---|---|
| Phase 1 fixed price (ex GST) | ₹5.00 lakh |
| GST on Phase 1 | ₹0.90 lakh |
| Phase 1 including GST | ₹5.90 lakh |
| DSEW infrastructure, one time (if the existing host is suitable: backup and UPS only) | ₹0.8 to 1.2 lakh, or ₹4.3 to 5.7 lakh if a new server is needed |
| Future phases | Not yet quoted |
| AMC | Not yet quoted |
| Optional third-party services (for example WhatsApp, e-way bill provider) | Only if DSEW later chooses them; provider charges |

A single total over five years cannot honestly be given today because future phases and AMC are not yet priced. The
fixed, known commitment is **₹5.90 lakh including GST** for Phase 1.

## 9. Assumptions behind the price

- Up to 15 named users, one site; English interface only.
- DSEW supplies sample documents and decisions on time (see document 6).
- The platform foundation already built is reused; the price assumes no rebuilding of it.
- Changes in scope after the specification is signed follow change control.
- Prices exclude GST, hardware, networking and DSEW staff time.
