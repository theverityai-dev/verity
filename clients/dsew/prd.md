# D & S Electric Works — Client Brief and Scope

**Status:** Draft v1, for review
**Date:** 2026-10-14
**Client:** D & S Electric Works, 109 Industrial Area Ext, Rau, Indore, M.P. (https://dsew.co.in/)
**Purpose:** Scope of the demo requested 2026-10-14: a complete end-to-end project management system
for a custom electrical-equipment manufacturer, whose owner likes the UI/UX of manager.io.

## 1. Who they are (from their public site; self-reported, unverified)

- Makes dry-type transformers (cast resin, water-cooled, HV step-up, ultra-isolation, superconducting),
  custom electromagnets and high-field-uniformity calibration systems, and control systems.
- 30+ years in business, 500+ customers, 150+ products, 10+ team members. ISO 9001:2015.
- Sells to labs, universities, manufacturing, telecom, power generation, construction. Enquiry is by
  technical quote request; there is a customer portal login.
- Shop-floor steps named on the site: VPI winding, 3-axis magnetic mapping, "full traceability and
  technical reporting".

Unknown, to confirm with the client before anything is claimed as fitting: headcount by function,
jobs in flight at once, whether they already run Tally or another ledger, GST registration details,
whether jobs are one-off or repeat designs.

## 2. What "project management" means for this client

Every order is an engineered job. The unit of management is the **Job** (a Project in the UI), not a
stock-keeping sale. One Job runs the whole chain:

```
Enquiry -> Technical quote -> Customer approval -> Order/Job opened -> Design and BOM
-> Procurement -> Winding / VPI / assembly stages -> Test and QC (test report)
-> Dispatch -> Invoice -> Payment -> Job margin (quoted vs actual)
```

Happy path above. Named exceptions to design for: quote revised or lost, customer changes spec
mid-job, short or rejected material, test failure and rework (spawns a child per INV-002 posture),
part dispatch, retention or advance payment.

## 3. What Verity already has (BUILT, per CLAUDE.md vocabulary)

| Need | Existing capability | Gap |
|---|---|---|
| BOM, per-unit scaling, stage routes, per-order operations, hold/resume | `manufacturing` (Task 118) | Not tied to a customer job |
| Digital QC checklist, append-only findings, evidence | `manufacturing` | A test report document (ratio, impedance, insulation, temperature rise) |
| Dispatch trail, reservation | `manufacturing` | None known |
| Public passport by hashed token | `manufacturing` (ADR-030) | Shape as customer job-status page |
| Stock, items, movements | `inventory` | None known |
| Vendors, POs, GRN, invoices, payments, GST | `trading` | Quotation entity |
| Journals, ledger | `accounting` | Confirm chart of accounts fits |
| Staff, leave | `hr`, `attendance` | Timesheet against a Job |
| Approvals | `approval` | None |

## 4. What is NOT built, and is the real work

1. **`project` capability** (new, capability-private): Job, milestones, tasks and dependencies,
   timesheets, cost lines (material from inventory movements, labour from timesheets, outsourced
   from trading), quoted vs actual, margin as a derived read, never stored.
2. **Quotation** (technical quote with revisions, won/lost with a structured reason).
3. **Test report** as a first-class record that closes a stage.
4. **Customer job-status view** (portal), read-only.

Money is integer minor units. Job cost is derived from ledgers, never a maintained balance.
Quote figures are snapshotted onto the Job at approval.

## 5. UI decision (product owner, 2026-10-14)

Keep the iOS look (ADR-033). Borrow manager.io's **structure**, not its skin. No new ADR.

manager.io traits to carry over: a single left list of modules (tabs) the user can show or hide and
reorder; a **Summary** home with plain totals (receivable, payable, cash, jobs open); each module is
a dense list with a "New" button and an inline form; the same few verbs everywhere (New, Edit, View,
Delete-as-void); customisation lives next to the thing it customises. These map onto existing
primitives: `DataTable`, `Modal` forms, navigation contributions.

## 6. Out of scope for this demo

CRM beyond the quote pipeline, payroll, HR depth beyond timesheets, e-invoicing/e-way bill filing,
the old VEDA automotive vocabulary, anything marketed on their site that is not a Job step.

## 7. Open decisions (do not solve silently)

- Is one tenant with a Job-centric workspace enough, or does the client expect a separate branded
  login? Assume one tenant until told.
- Does a Job always trace to a ManufacturingOrder 1:1, or can one Job span several units/orders?
  Assume 1 Job : many orders, since transformer orders often have multiple units.
- Where do test-report values live: structured fields per unit (queryable) or a PDF attachment?
  Assume structured fields plus a generated printable page.
