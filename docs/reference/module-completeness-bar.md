# Module completeness bar

Status: **DRAFT 2026-10-04, written by Sonnet 5.5, awaiting review.** The checklist below is
derived from what the existing finished screens (complaints, attendance, Outreach) already do and
from the Odoo module pattern. The open questions at the end need a decision before it becomes the
acceptance gate.

A capability is "UI complete" only when every row below is true for its entities. A backend with
commands and no screen is **BUILT (backend)**, never complete (CLAUDE.md reporting vocabulary).

## The bar, per entity

| # | Requirement | How it is checked |
|---|---|---|
| 1 | **Reachable.** Every registered nav entry resolves to a real page. | `grep` each `href` in `registerContribution` against `src/app/(shell)` |
| 2 | **List.** Sortable, filterable, with a useful empty state and a first action. | Uses `DataTable`; empty state names the next step |
| 3 | **Create.** A form for every `Create` command, with field-level errors. | Each command key appears in a screen |
| 4 | **Edit.** A form for every `Edit` command; no edit that only exists as a command. | Same |
| 5 | **State changes.** Every transition the state machine allows is a visible control; disallowed ones are absent or disabled with a reason. | Compare screen controls to the declared transitions |
| 6 | **Detail.** A record page: summary, related records, and the activity log (audit trail). | `ActivityLog` present; reads `reconstructHistory` |
| 7 | **Safe destructive actions.** Deactivate or cancel asks for confirmation and a reason where the audit needs one. | Uses the shared confirmation pattern |
| 8 | **Permissions.** A user without the permission sees an explanatory state, not a broken or empty page, and cannot see controls they cannot use. | `PermissionDenied`, `requiresEntity` on nav |
| 9 | **States.** Loading, empty, error and partial-failure are all designed. | `panelState`, `ErrorState`, `EmptyState` |
| 10 | **Responsive and accessible.** Works at phone width; keyboard reachable; WCAG AA on both materials and both themes. | Detector + manual pass per Task 116's matrix |
| 11 | **Setup.** Anything an admin must configure first (types, categories, defaults) has a screen and a readiness check. | `onboardingChecklist` pattern |
| 12 | **Proof.** One end-to-end test or live walk-through with real data, recorded. | Evidence file or test |

## Current score (command wiring only, 2026-10-04)

Measured by whether any screen calls the command. A rough proxy for rows 3-5.

| Capability | Commands | Wired | Notes |
|---|---|---|---|
| hr | 8 | 8 | `/hr` built 2026-10-04: employees, departments, leave. Rows 6, 7, 10, 12 open |
| scheduling | 5 | 0 | Route exists, commands unwired |
| inventory | 8 | 0 | |
| accounting | 7 | 0 | |
| billing | 7 | 0 | |
| outreach | 89 | 30 | Many unwired entries are list queries behind other screens; needs a manual pass |
| trading | 100 | 48 | Same caveat |

## Row 1 check, run 2026-10-04

Three registered nav entries still have no page and lead to a 404: `/accounting`, `/billing` and
`/inventory`. (`/hr` had the same defect and is fixed on this branch.) These are the next screens to
build.

## Open questions for review

1. Is row 6 (a detail page per entity) required for every entity, or only for those with a
   lifecycle? Departments and leave types probably do not need one.
2. Row 7: which actions need a reason captured, not only a confirmation?
3. Row 12: is a recorded live walk-through enough, or must it be an automated test?
4. Should the bar be enforced by a test (a script that fails when a nav `href` has no page, or a
   command is unreferenced), or stay a review checklist? Rows 1 and 3 are mechanically checkable.
