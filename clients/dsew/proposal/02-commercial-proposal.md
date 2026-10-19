# Commercial Proposal

D & S Electric Works. All amounts in Indian rupees (₹) and **exclusive of GST** unless stated.

> **Status: NEGOTIATION DRAFT, pending written approval by [Company legal name].** Figures and terms below are
> proposed. They become final only when the company approves them in writing and DSEW accepts the Phase 1
> specification. Items in square brackets are open company decisions.

## 1. The offer

One **fixed-price, bounded Phase 1: Foundation Release** covering the deliverables in section 2, and nothing else.
It is not the whole of DSEW's enquiry (modules A to S plus AI). The rest is handled after DSEW has tested Phase 1 in
its real workflows: fixes against the agreed specification are included, and new features and changes are quoted
separately (section 4).

| | Phase 1: Foundation Release |
|---|---|
| Fixed fee (ex GST) | **₹4,00,000** |
| GST at 18% (illustrative; the rate and applicability are confirmed at invoicing) | ₹72,000 |
| **Total including GST** | **₹4,72,000** |
| Duration | About 11 weeks: 1 week specification, then 5 two-week sprints, from the effective date (document 3, section 3) |
| Users and site | Up to 15 named users, one site, local network |

No discount, credit or bundle is applied. There is no price for any other phase in this document.

## 2. Included in the fixed fee (the complete list)

| # | Deliverable | Boundary |
|---|---|---|
| 1 | DSEW workspace, organisation, roles and permissions | Up to 10 roles; 15 named users; one site |
| 2 | Master data | CSV import with validation for customers, suppliers, items and components, using agreed templates; no historical transactions |
| 3 | Enquiry to quotation | Enquiry register, quotation with revisions (each revision kept), approval, DSEW-format printed quotation, structured lost reason |
| 4 | Order and project job | Convert an approved quotation to an order and project job; milestones, tasks and dependencies, timesheets, cost lines, quoted versus actual |
| 5 | Revision-controlled bill of materials | Draft, review, release, superseded states; a released revision cannot be edited; each manufacturing order records its exact revision; change reason and approval for a new revision. Single-level structure |
| 6 | Controlled documents | One agreed numbering convention, revisions, draft/review/approved/released/superseded states, register, role permissions, audit history. No transmittal workflow |
| 7 | Manufacturing order, route and traveller | Orders from a released BOM, route stages and operations, hold and resume, material issue, printable traveller in one DSEW format, QR identity of a finished unit |
| 8 | Structured test records | Templates for up to 3 product families; readings with value, unit and tolerance; server-side pass or fail; tester and reviewer; one printable test report format; basic instrument register with a calibration-due check |
| 9 | Quality gates | A stage or order cannot complete with a failed or missing required check; dispatch needs the order complete and the required tests approved; an authorised override needs a reason and is audited |
| 10 | Dispatch | Dispatch record, packing list and delivery challan in one DSEW format each, partial shipment |
| 11 | Dashboards | Four read-only views: quotations, jobs, production and quality |
| 12 | Data export | One documented export of DSEW's data: tabular records as CSV files and uploaded files in original form with an index, taken once at handover and once more on request during warranty. Acceptance: record and file counts reconcile with the system |
| 13 | Environments and deployment | See section 3 |
| 14 | Training and documentation | 1 day administrator training and 2 days user training (remote or on site, see section 7); quick-reference cards; administrator and user guides; runbooks for install, backup, restore and upgrade; licence inventory |
| 15 | Testing and acceptance | Sprint demonstrations, scripted UAT, sign-off per scenario |
| 16 | Warranty | Correction of reproducible defects against the signed specification for [3 months] from go-live (proposed period) |

**Acceptance tests (summary).** A deliverable is accepted when its scripted scenario passes before the DSEW product
owner. Examples: a revised quotation keeps earlier revisions; a released BOM cannot be edited; a reading outside
tolerance fails; dispatch is refused until required tests are approved; a user without a permission is refused; the
data export reconciles; and the **combined backup and restore** passes (section 3).

## 3. Environments and deployment (what the fee covers)

| Item | Included | Not included |
|---|---|---|
| Sprint demonstration environment | One test environment hosted by the company, used for sprint demonstrations and early hands-on use | Hosting it after go-live |
| DSEW-site installation | **One** Linux virtual machine on a DSEW-provided host, used for UAT and then, after the go-live gates pass, as the production system. First installed in sprint 1 so infrastructure problems surface early | A second, separate production VM; clustering or high availability |
| Production cut-over | Reset of test data and release of the UAT instance to production use, once the gates pass | A rehearsal environment separate from the DSEW VM |
| Go-live gates | The infrastructure survey is complete; installation and HTTPS access (including a real phone upload) work on the DSEW host; the **combined backup and restore** of database, files and identity configuration onto a clean environment passes; UAT scripts pass; the data export reconciles | |

None of the gates has been completed yet. **Production go-live is blocked until all of them pass.** If the surveyed
host cannot support the agreed arrangement, we will say so in writing; a different arrangement (for example a
second VM, a dedicated small host, or a different runtime) is then a change request, not part of the fixed fee. The
approach has not been tested on Windows Server 2019.

## 4. Fixes, testing feedback and separately quoted work

**Included in the fixed fee**
- Implementation of the signed Phase 1 specification.
- Testing and acceptance evidence for the agreed workflows.
- Correction of reproducible defects where the delivered system fails the signed specification, found in UAT or
  during the warranty period. A defect is not a chargeable change merely because it is discovered late.

**Quoted separately, after DSEW has tested**
- New features and modules, including everything marked future phase in document 1.
- New or changed workflows, and changes to a requirement DSEW has already accepted.
- Additional product families, reports, formats, integrations or environments beyond section 2.
- Enhancements requested after acceptance of the relevant deliverable.

**Change process.** Every change request is recorded in writing, assessed for effort, impact and timeline, quoted,
and approved in writing by DSEW before any work starts. DSEW's post-UAT feedback is used to prioritise and quote
enhancements; it does not become free development. No hourly or daily rates are published in this document.

**Tally Prime.** Excluded and deferred (section 5).

## 5. Tally Prime: excluded and deferred

DSEW's enquiry (section N, Finance and Accounting Integration) asks for Tally Prime integration and for the method,
licensing, version, synchronisation frequency and limitations to be stated. **This proposal does not include a Tally
Prime integration, does not price one, and does not state an integration method.** It therefore does not satisfy that
requirement of the enquiry.

- Tally Prime remains DSEW's accounting system and book of record, unchanged.
- Phase 1 does not create, import, export or synchronise any Tally data.
- **DSEW must confirm in writing that it accepts this exclusion before the order is confirmed.** If DSEW requires the
  integration, it would be a separate scope item, quoted after a technical review of DSEW's TallyPrime setup, and only
  if explicitly authorised.

## 6. Payment milestones (proposed)

Each invoice carries GST at the rate then applicable (illustrated at 18%). Payment terms: [15 days] from invoice.

| Milestone and trigger | Share | ₹ ex GST | GST 18% | ₹ incl. GST |
|---|---|---|---|---|
| **1. Start.** Due on DSEW's signed order, written acceptance of the Tally exclusion, and nomination of the product owner. Not conditional on delivery | 30% | 1,20,000 | 21,600 | 1,41,600 |
| **2. Mid-point.** Due when the sprint 3 demonstration is accepted, or deemed accepted (section 8) | 40% | 1,60,000 | 28,800 | 1,88,800 |
| **3. Completion.** Due when UAT is signed off and the go-live gates in section 3 have passed. If DSEW-side causes (host, access, decisions) delay the gates for more than [15 working days] after UAT passes on the test environment, this milestone becomes payable, and the remaining in-scope installation work continues at no extra charge | 30% | 1,20,000 | 21,600 | 1,41,600 |
| **Total** | **100%** | **4,00,000** | **72,000** | **4,72,000** |

## 7. Warranty, support and expenses

- **Warranty:** defect correction against the signed Phase 1 specification for [3 months] from go-live (proposed).
  It does not include new development, extra training or ongoing support.
- **Support and AMC:** **no support commitment and no AMC is included beyond the warranty.** Any ongoing support would
  be offered separately and agreed in writing. No support hours, response times or emergency coverage are promised in
  this document.
- **Travel and on-site work:** the fee assumes remote delivery apart from the infrastructure survey visit and any
  training DSEW wants delivered on site. [Whether travel, accommodation and on-site days are included or charged at
  actual cost is a company decision; until set, on-site attendance beyond the survey visit is quoted separately.]

## 8. Sprint review and acceptance

DSEW has **5 working days** after each sprint demonstration to accept it or report reproducible failures against the
agreed acceptance criteria. A reported failure is corrected and re-demonstrated. A sprint with no report in that period
is deemed accepted. Subjective preference, or a request for something not in the specification, is handled as a change
request (section 4).

## 9. DSEW's own costs (paid to suppliers, not to us)

Planning estimates only, not vendor quotations; confirmed after the survey.

| Item | Indicative cost |
|---|---|
| Backup target (NAS or disks) and UPS | ₹0.8 to 1.2 lakh |
| New production server, only if the existing host cannot run the VM | ₹3.5 to 4.5 lakh |
| Platform software licences | None (open-source stack) |
| TallyPrime licence | Not affected; no change in Phase 1 |

TLS certificates, internal DNS, VPN access, backup storage and the host resources are DSEW's responsibility to provide
(document 6).

## 10. Cost picture

| Component | Amount |
|---|---|
| Phase 1 fixed fee (ex GST) | ₹4,00,000 |
| GST on Phase 1 | ₹72,000 |
| Phase 1 including GST | ₹4,72,000 |
| DSEW infrastructure, one time (planning estimate) | ₹0.8 to 1.2 lakh, or ₹4.3 to 5.7 lakh if a new server is needed |
| Future phases, enhancements, support | Not yet quoted |

This is a cost picture, not a multi-year total: future phases and support are not yet priced. The known fixed commitment
is **₹4,72,000 including GST** for Phase 1.

## 11. Assumptions behind the price

- Up to 15 named users, one site; English only.
- DSEW supplies sample documents, decisions, host access and test participation on time (document 6).
- The platform foundation already built is reused; the price assumes no rebuilding of it.
- Scope changes after the specification is signed follow section 4.
- Prices exclude GST, hardware, networking and DSEW staff time.
