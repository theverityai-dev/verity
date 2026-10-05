# Client reference-parity document: template

Use this for every Verity client, existing and new, before building or extending their modules.
Product-owner rule, 2026-10-05: clients judge their Verity instance against Odoo and ERPNext, so each
client's modules are specified from how those systems serve the same requirement, page by page and
button by button, not from Verity's own code.

**Location:** `clients/<client-slug>/reference-parity/` — one `README.md` (sections 1–3 below) and one
file per module (`<module>.md`, sections 4–8).

**Sources:** read the reference systems' actual source, not memory:
- Odoo: `D:\Code\R&D\odoo-19.0\addons\<module>\` — `__manifest__.py` (dependencies), `views/*.xml`
  (menus, actions, list/kanban/form/calendar/pivot/graph views, buttons as `<button name=...>`, header
  statusbars), `models/*.py` (fields, `state` selections, `action_*` methods), `security/` (groups,
  record rules), `report/`, `data/` (sequences, crons, mail templates).
- ERPNext: `D:\Code\R&D\erpnext\erpnext\<module>\doctype\<doctype>\` — `<doctype>.json` (fields,
  sections, permissions), `<doctype>.js` (form buttons, `frm.add_custom_button`), `<doctype>.py`
  (validations, status transitions), `workspace/` (module home), `report/`.
- Existing summaries: `docs/reference/odoo-prd/`, `taskplans/archive/05_erpnext_audit.md`. Check them
  first; cite source paths for anything you add.

Every claim carries an evidence path. "Odoo has X" without a file path is not acceptable.

---

## 1. Client and requirement sources

- Client, industry, size (users, sites), who uses the system day to day.
- Requirement sources: client PRD (`clients/<slug>/prd.md`), meetings, live complaints, with dates.

## 2. Module map

| Client need | Odoo module(s) | ERPNext module / doctypes | Verity capability today |
|---|---|---|---|

## 3. Summary scorecard

Per module: pages in reference vs pages in Verity; actions in reference vs wired in Verity;
workflows walked end to end; overall status (Missing / Partial / Usable / At parity).

---

## 4. Module: <name> — how the reference systems serve it

### 4.1 Navigation
Menu tree as the user sees it (Odoo `menuitem` records, ERPNext workspace), with source paths.

### 4.2 Pages
For each page (list, form, kanban, calendar, report, settings):

| Page | View types | Sections / tabs | Key fields | Buttons and actions (what each does, state change) | Source |
|---|---|---|---|---|---|

### 4.3 Workflows
Each lifecycle as states and transitions, with the happy path and named exception paths (cancel,
return, partial, reject, reopen). Who may perform each step.

### 4.4 Reports and analytics
Standard reports, pivots and graphs, and what question each answers.

### 4.5 Configuration
Settings, master data, sequences, defaults an admin sets before first use.

### 4.6 Automation and notifications
Scheduled jobs, email or activity reminders, approvals.

### 4.7 Roles and permissions
Groups or roles, what each can see and do.

## 5. Verity today

| Reference page / action / workflow | Verity equivalent | Status (Built / Partial / Missing) | Evidence |
|---|---|---|---|

## 6. Gap decisions

Every reference item lands in exactly one row. Silence is not allowed.

| Item | Decision: Include / Defer / Not applicable | Reason | Decision owner |
|---|---|---|---|

## 7. Verity design for this client

What Verity will provide: pages, sections, actions, workflows, in Verity's own terms (canonical
terminology in `CLAUDE.md`), mapped to existing platform primitives first. Anything needing a new
platform primitive or ADR is flagged, not designed silently.

## 8. Acceptance

The rows of `docs/reference/module-completeness-bar.md` this module must pass, and the live
walk-through script that proves it with real data.
