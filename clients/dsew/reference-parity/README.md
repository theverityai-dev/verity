# D & S Electric Works — Reference Parity (Projects / Jobs)

**Date:** 2026-10-14. **Status:** Draft v1, Project module only. Quotation, Quality and manager.io
sections are listed in section 6 as still to read.
Template: `docs/reference/client-reference-parity-template.md`. Scope: `clients/dsew/prd.md`.

## 1. Sources read

- Odoo: `D:\Code\R&D\odoo-19.0\addons\project\views\project_menus.xml`, `project_milestone_views.xml`,
  `project_project_views.xml`; `models\project_task.py` (state selection, line 168).
- ERPNext: `D:\Code\R&D\erpnext\erpnext\projects\doctype\{project,task,timesheet}\*.json` and
  `project.js` (custom buttons, lines 80-160).
- manager.io: **no source in R&D.** Everything about it in the PRD is from public knowledge of the
  product and is unverified until someone opens a real manager.io instance with the owner.

## 2. Module map

| Client need | Odoo | ERPNext | Verity today |
|---|---|---|---|
| Job as the unit of work | `project.project` | `Project` | none (`manufacturing_order` only) |
| Tasks and sub-steps | `project.task` | `Task` (tree, `depends_on`) | `ManufacturingOperation` (stages only) |
| Milestones | `project.milestone` (deadline, is_reached, task_count) | `Task.is_milestone` | none |
| Time against a job | `hr_timesheet` | `Timesheet` | none |
| Cost vs quote | `project_account`, `project_mrp_account` | Project costing fields, `gross_margin` | none |
| Job status to customer | portal + `project_update` | `Project Update` | passport (ADR-030) |

## 3. Navigation to mirror (Odoo `project_menus.xml`)

Projects; Tasks (My Tasks, All Tasks); Reporting (Tasks Analysis, Customer Ratings);
Configuration (Settings, Project Stages, Task Stages, Tags, Project Roles, Activity Types,
Activity Plans).

## 4. Fields the reference treats as baseline

ERPNext Project: name, status, type, is_active, percent_complete (+ method), priority, department,
customer, sales_order, expected/actual start and end, estimated_costing, total_costing_amount,
total_purchase_cost, total_consumed_material_cost, total_sales_amount, total_billed_amount,
gross_margin and per_gross_margin, users, notes.
ERPNext Task: subject, project, type, is_group + parent_task, status, priority, exp/act start and end,
expected_time, actual_time, progress, is_milestone, depends_on, completed_by, costing and billing.
ERPNext Timesheet: employee, time_logs (hours, activity, task, project), total/billable/billed hours,
costing and billable amounts, link to sales invoice.
Odoo Task states: In Progress, Changes Requested, Approved, Done, Cancelled, Waiting (`project_task.py:168`).
Odoo Milestone: name, project, deadline, is_reached, task counts, `is_deadline_exceeded`.

## 5. Decisions (every row ends in one)

| Reference item | Decision | Note |
|---|---|---|
| Project with customer, dates, priority, status | **Include** | Job. Status is a state machine (ADR-009 categories). |
| Link to sales order / quote | **Include** | Snapshot quote value at approval. |
| Link to manufacturing orders | **Include** | 1 Job : many orders (PRD open decision). |
| Tasks, parent/sub-task, dependencies | **Include** | Dependency blocks start; no cycles. |
| Milestones with deadline and reached | **Include** | Customer-visible subset. |
| Odoo task states incl. Changes Requested | **Include** | Maps to test-failure rework. |
| Timesheet with billable hours | **Include**, minimal | Hours x employee cost rate = labour cost. |
| Costing: material, labour, outsourced, purchase | **Include** | Derived from ledgers, never stored. |
| Gross margin and percent | **Include** | Derived read: sale value minus cost. |
| Percent complete methods | **Include**, one method | Weighted by task weight; others Defer, owner: product owner. |
| Gantt and Kanban views | **Include** Kanban list; **Defer** Gantt | Gantt Defer, owner: product owner, after demo feedback. |
| Calendar view of tasks and deadlines | **Include** | Dated events rule from the V1 gate. |
| Project templates / duplicate with tasks | **Include** | Repeat designs are common for transformers. |
| Recurring task / collect-progress emails | **Defer** | Notification outbox (ADR-039) not built; owner: product owner. |
| Customer ratings | **Not applicable** | Industrial B2B jobs, not tickets. |
| Activity plans | **Defer** | Owner: product owner. |
| Project sharing / customer portal | **Include**, read-only | Via ADR-030 style token. |
| Project roles | **Include** via existing Role/Permission | No new primitive. |
| Tags, stages (config) | **Include** | Tenant-owned registry; retire, never delete. |

## 6. Still to read before Phase 2 is called specified

**Accounting is now covered separately in [`accounting.md`](./accounting.md)** (2026-10-16): Odoo
`account` and the public Manager guides, with a licence note (Manager is source-available under FSL 1.1,
no competing use, so structure only, never its code).

- Odoo `sale_project`, `project_mrp`, `mrp` quality checks, `purchase_requisition` for quote flow.
- ERPNext `selling` Quotation (versions, lost reasons), `manufacturing` Job Card, `quality_management`.
- manager.io: a real session with the owner, to list the exact tabs, the Summary tiles, and the
  Customize behaviour he likes. Without it the "manager.io structure" is an assumption.

## 7. V1 completeness gate (run 2026-10-14)

Scope: the Jobs capability and its screens (`/summary`, `/jobs`, `/jobs/{id}`, quote document). Method: the
`obvious-basics-checklist` categories against each entity, grounded in the code, then every Odoo `project/views/`
file. "Deferred" always names who decides; here that is the product owner unless stated.

### 7.1 Odoo `project/views/` cross-check

| Odoo file | Concept | Decision |
|---|---|---|
| `project_project_views.xml` | Project list and form, header status, buttons | **Included**: Jobs list and job page, state-driven buttons |
| `project_project_views.xml` | Kanban by stage | **Deferred**: product owner, after demo feedback |
| `project_task_views.xml` | Tasks with assignee, deadline, dependencies, states incl. cancelled | **Included**; Cancel added today |
| `project_task_views.xml` | Sub-tasks, task kanban, task calendar, Gantt | **Deferred**: the command accepts a parent task, the screen has no sub-task entry yet |
| `project_milestone_views.xml` | Milestones with deadline and reached | **Included**, with a customer-visible flag |
| `project_update_views.xml`, `project_portal_*`, `project_sharing_*` | Status updates and customer-facing view | **Deferred**: customer job-status page (ADR-030 passport pattern), Phase 6 |
| `project_project_stage_views.xml`, `project_task_type_views.xml` | Tenant-defined stages | **Not applicable**: states are the closed ADR-009 categories; labels are tenant-renamable (MET-STA-004) |
| `project_tags_views.xml` | Tags | **Deferred** |
| `project_role_views.xml` | Project roles | **Not applicable**: platform Role and Permission already do this |
| `rating_rating_views.xml` | Customer ratings | **Not applicable**: B2B engineered jobs, not tickets |
| `digest_digest_views.xml` | Periodic summary email | **Deferred**: needs the notification outbox (ADR-039, authorised, not built) |
| `mail_activity_*_views.xml` | Activity types and plans | **Deferred** |
| `account_analytic_account_views.xml` | Cost and revenue per project | **Included** as derived costing and margin, never stored |
| `res_partner_views.xml` | Customer form shows its projects | **Included** (2026-10-14): job links to the customer; "All jobs for this customer" filters the list |
| `res_config_settings_views.xml` | Settings | **Not applicable** |

Gate items from the skill: role/admin surface over every role-scoped surface (**Included**, platform People and Roles);
dashboard shaped for the signed-in role (**Deferred**: Summary is the owner's view, a shop-floor or sales view is not built);
calendar of dated events (**Deferred**: Summary "Coming up" lists milestones, no calendar grid); lost reason as a
structured field (**Included**, from a tenant registry); source and campaign attribution (**Deferred**); job owner or
salesperson (**Deferred**: a job records who opened it, not who owns it).

### 7.2 Obvious basics, per entity

| Entity | Category | Status | Evidence | Fix |
|---|---|---|---|---|
| Job | Data completeness | Done | create and edit forms cover title, customer, contact, priority, due date, notes | none |
| Job | List view | Partial | search, sort, paging from `DataTable`; status filter chips added 2026-10-15 (URL-backed, with counts); no bulk actions | needs design |
| Job | Per-row quick action | Partial | drill-in link on the reference; state moves live on the job page, not the row | needs design |
| Job | Detail and history | Done | history shows who moved it and when; related quote, orders, tasks, time, costs on tabs | none |
| Job | Numbering and status | Done | `J-0001` per-tenant sequence, status badge by category | none |
| Job | Void not delete | Done | lost, cancelled and completed are states; nothing is deleted | none |
| Job | Confirmation | Done | approve, finish, lost and cancel each ask first (added 2026-10-14) | none |
| Quote | Print or PDF | Done | `/jobs/{id}/quote/{id}` printable document, same pattern as the PO and invoice (added 2026-10-14) | none |
| Quote | Numbering | Done | job reference plus revision number | none |
| Quote | Lifecycle | Done | open, approved, replaced, lost; replaced revisions stay on file | none |
| Task | Data completeness | Partial | parent task is in the schema and command but has no form field | quick, deferred with sub-tasks |
| Task | Lifecycle from the row | Done | Start, Done, Block, Resume, Cancel on the row; Cancel confirms (added 2026-10-14) | none |
| Task | Edit after creation | Done | `edit_task` command and an Edit dialog on the row (2026-10-15); a done or cancelled task is not editable | none |
| Milestone | Data completeness | Done | customer-visible checkbox added 2026-10-14 (the field existed with no way to set it) | none |
| Milestone | Edit or delete | Done | `edit_milestone` and an Edit dialog (2026-10-15); a reached milestone is a fact and is refused; no delete by design | none |
| Time entry, Cost entry | Void not delete | Done | void with reason, kept on record, drops out of totals | none |
| Time entry | Data completeness | Partial | worker is a text label, not an HR employee | needs design |
| Customer (trading record) | Party basics | Partial | contact, GSTIN, state code, credit limit exist; the running statement needs invoices from a job, not built | needs design |
| All | Notifications | Missing | no notice when a quote is approved or a milestone is late | needs the notification outbox (ADR-039) |
| All | Accessibility | Done | shared primitives; forms show field-level errors; no icon-only buttons added | none |
| All | Overflow | Done | checked at 390 px on Jobs and the job tabs; no horizontal scroll | none |
| All | Internal identifiers | Fixed | history showed `in_progress`; now reads "in progress"; command keys are never shown | none |
| All | Defining lost reasons | Done | `/jobs/lost-reasons`: add, retire, restore, with a count of jobs per reason (2026-10-15) | none |

### 7.3 Proof

Database tests: `src/test/capability-project.test.ts`, 7 pass. Live in the browser: new job, quote, approve, start, hold,
resume, finish, task add and moves, task cancel, milestone add and reach, time log and void, cost add and void, edit job,
mark lost, cancel job, customer list, quote document, dark theme, 390 px width. Not live: link production order (tested in
the database tests only, no free order existed in the seed).
