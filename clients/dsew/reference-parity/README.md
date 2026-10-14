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

- Odoo `sale_project`, `project_mrp`, `mrp` quality checks, `purchase_requisition` for quote flow.
- ERPNext `selling` Quotation (versions, lost reasons), `manufacturing` Job Card, `quality_management`.
- manager.io: a real session with the owner, to list the exact tabs, the Summary tiles, and the
  Customize behaviour he likes. Without it the "manager.io structure" is an assumption.

## 7. V1 completeness (filled at Phase 7)

Not yet run. `obvious-basics-checklist` and the Odoo cross-check are required before any DONE claim.
