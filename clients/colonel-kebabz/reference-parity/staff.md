# Colonel Kebabz — staff, attendance, shifts, leave, payroll inputs and performance

Depth document for PRD §38–§43. Template sections 4–8 of
`docs/reference/client-reference-parity-template.md`. Written 2026-10-05 from source, not memory.

Source roots: `odoo:` = `D:\Code\R&D\odoo-19.0\addons\`, `erpnext:` = `D:\Code\R&D\erpnext\erpnext\`,
`verity:` = this repository.

**Reference coverage note.** ERPNext's HR (attendance, shift type, leave, payroll) moved to the separate
Frappe HRMS app, which is not in `D:\Code\R&D`; only `erpnext:setup/doctype/employee` remains. Odoo
Community has `hr`, `hr_attendance`, `hr_holidays` and `resource` (working schedules); shift
**planning** and **payroll** are Enterprise-only and not in the source. Those rows are designed from the
PRD.

## What the client asked for

- **§38 Employee profile:** name, employee ID, photo, phone, role, outlet, joining date, employment
  type, salary information, emergency contact, documents, status.
- **§39 Attendance:** check-in, check-out, late, early departure, absent, overtime, leave; dashboard
  (present, absent, late, on leave).
- **§40 Shifts:** managers create shifts (Morning 10–6, Evening 4–12, Closing 6–close); show staffing gaps.
- **§41 Leave:** casual, sick, emergency, other; managers approve or reject.
- **§42 Payroll inputs** (not a payroll engine): days worked, hours, overtime, late deductions, leave,
  incentives, advances, attendance exceptions.
- **§43 Performance:** orders handled, average service time, attendance, complaints, sales contribution,
  upselling, manager ratings — with context, not raw.

## 4. How the reference systems serve it

### 4.1 Navigation

Odoo (`odoo:hr/views/*.xml`, `odoo:hr_attendance/views/*.xml`, `odoo:hr_holidays/views/*.xml`):

```
Employees      Employees · Departments · Onboarding · Reporting · Configuration (work locations, job positions, tags)
Attendances    Overview (today: who is in) · Management (all attendances, to-approve overtime) · Kiosk Mode ·
               Reporting · Configuration (settings, overtime rulesets)
Time Off       My Time Off · Management (time off to approve, allocations) · Overview (calendar) ·
               Reporting · Configuration (time off types, accrual plans, mandatory days)
```

### 4.2 Pages

| Page | Sections / key fields | Buttons and actions | Source |
|---|---|---|---|
| Odoo employee form | header (name, job, photo, work phone/email, department, manager, coach); tabs **Work** (work location, schedule), **Resume**, **Personal** (private address, emergency contact, ID numbers, bank), **Payroll**, **Settings** (related user, PIN/badge for kiosk) | archive, smart buttons (attendance, time off, documents) | `odoo:hr/views/hr_employee_views.xml` |
| Odoo attendance list/kanban | employee, check in, check out, worked hours, **overtime hours** with overtime status (to approve), check-in GPS location, IP, mode (kiosk / systray / manual / auto check-out) | check in/out, approve overtime | `odoo:hr_attendance/models/hr_attendance.py` (`check_in`, `check_out`, `worked_hours`, `overtime_hours`, `overtime_status`, `in_latitude`, `in_mode`) |
| Odoo Kiosk Mode | shared tablet: employee picks name or scans badge, enters PIN, checks in/out | check in, check out | `odoo:hr_attendance` kiosk |
| Odoo time off request | type, dates, half day, duration, description, attachment | Approve, Validate (second approval), Refuse, Cancel, Back to Approval (states To Approve → Approved / Refused / Cancelled) | `odoo:hr_holidays/views/hr_leave_views.xml`, `models/hr_leave.py` |
| Odoo allocation | type, employee, days, validity, accrual plan | approve, refuse | `odoo:hr_holidays/views/hr_leave_allocation_views.xml` |
| Odoo time off calendar | team calendar of absences, mandatory days | — | `odoo:hr_holidays/views/calendar_views.xml` |
| Odoo working schedule | weekly hours, attendance slots per day | create, edit | `odoo:resource` (`resource.calendar`) |

### 4.3 Workflows

- **Attendance:** employee checks in (kiosk/PIN, mobile with GPS, or manager entry) → checks out →
  worked hours computed → extra hours over the schedule become overtime **to approve** → approved
  overtime counts.
- **Leave:** request → To Approve → Approved (optionally second validation) or Refused; Cancel; balance
  comes from allocations (manual or accrual).
- **Shifts:** Odoo Community has fixed working schedules only; shift planning with open shifts and
  staffing gaps is Enterprise `planning` (not in source).

### 4.4 Reports

Attendance analysis (hours by employee/department/period), overtime, time off analysis and balances,
headcount.

### 4.5 Configuration

Departments, job positions, work locations, working schedules, overtime rules, time off types with
allocation rules, kiosk settings, PINs/badges.

### 4.6 Automation

Automatic check-out after a maximum time, accrual allocations, reminders for pending approvals.

### 4.7 Roles

Employee (own record, own requests), Officer/Team leader (approve team), Administrator.

## 5. Verity today

Evidence: `verity:src/server/capabilities/hr/index.ts`, `verity:src/server/capabilities/attendance/index.ts`
(header lists what is dropped: overtime, late deductions, incentives, advances, shift-gap detection),
`verity:src/server/capabilities/scheduling/`; pages `/hr` (`HrDesk.tsx`, built 2026-10-04, not yet
verified with real data), `/attendance` (`AttendanceBoard.tsx`, `PayrollAndShifts.tsx`), `/scheduling`
(`ScheduleGrid.tsx`).

| Reference item | Verity equivalent | Status |
|---|---|---|
| Employee: person, department, designation, joining date, active | `create_employee` (from a Party), `set_employee_active`; `/hr` | Built (unverified) |
| Employee ID, photo, phone, outlet, employment type, salary info, emergency contact, documents | Party holds name/phone; rest not on employee | Missing |
| Employee detail page (profile, attendance, leave, documents) | none — list only | Missing |
| Departments | `create_department`; `/hr` | Built |
| Attendance record: date, status Present / Absent / Late / OnLeave, optional check-in/out times | `record_attendance` (manager enters); `/attendance` | Built (manual entry only) |
| Self check-in / check-out (kiosk PIN or phone, with location) | none | Missing |
| Early departure, overtime | not computed (dropped this cycle) | Missing |
| Attendance dashboard (present / absent / late / on leave) | `get_dashboard`; `/attendance` | Built |
| Shift definitions | `define_shift`, `list_shifts`; `/attendance` | Built |
| Assign staff to shifts (roster), staffing gaps | `scheduling` capability (resources, bookings) has a page but **0 of its commands are called from a screen**; no link between shifts and scheduling | Missing |
| Leave types with days per year | `create_leave_type`; `/hr` | Built |
| Leave request, approve / reject | `apply_for_leave`, `decide_leave_application`; `/hr` | Built (unverified) |
| Leave balance per employee, team calendar | none | Missing |
| Payroll inputs: days, hours, late count, absent, leave | `get_payroll_inputs`; `/attendance` | Built |
| Payroll inputs: overtime, late deductions, incentives, advances, exceptions | dropped this cycle | Missing |
| Performance: orders handled, service time, complaints, sales | data exists in `dinein` (order `createdBy`), `complaint`; no staff view | Missing |

## 6. Gap decisions

Decision owner: product owner (proposed by engineering 2026-10-05, not yet confirmed).

| Item | Decision | Reason |
|---|---|---|
| Verify `/hr` with real data on the live tenant | **Include — first** | built unverified; HQ audit shows the tenant's people still "Invited" |
| Employee profile fields: employee ID, photo, outlet, employment type, emergency contact, status | **Include** | PRD §38 |
| Salary information on profile | Defer | sensitive; needs a field-level permission decision before storing |
| Employee documents (ID proof, contracts) | **Include** | PRD §38; uses Evidence/storage once storage is bound (HQ audit L2) |
| Employee detail page with tabs (profile, attendance, leave, documents) | **Include** | list-only is the "unfinished" signal clients report |
| Self check-in / check-out on a shared outlet tablet with PIN | **Include** | the realistic way restaurant staff record attendance; manager entry does not scale |
| Mobile check-in with location check against the outlet geofence | Defer | ADR-004 geofence policies exist; needs a privacy decision |
| Late and early departure computed against the assigned shift; overtime with approval | **Include** | PRD §39, §42 |
| Weekly roster: assign employees to shifts per outlet; staffing gaps shown | **Include** | PRD §40; reuse `scheduling` (ADR-008 Resource backed by Party) rather than a new roster model |
| Leave balance, team leave calendar | **Include** | managers cannot decide leave without seeing balance and overlap |
| Payroll inputs: overtime, late deductions, incentives, advances, exceptions; export | **Include** | PRD §42; export to their payroll provider |
| Staff performance view (orders, service time, complaints, attendance) with context | **Include** | PRD §43; data already exists; show trends, not rankings |
| Accrual plans, second-level leave validation | Defer | not in PRD |
| Payroll calculation, payslips | Not applicable | PRD §42 says Verity need not replace payroll |

## 7. Verity design for this client

Across `hr`, `attendance`, `scheduling`; no new platform primitive (the kiosk PIN is the open question).

1. **Employee detail** `/hr/[employeeId]`: profile (employee ID, photo, outlet, type, emergency
   contact, status), attendance tab, leave tab with balance, documents tab, performance tab.
2. **Outlet attendance tablet** `/attendance/kiosk`: staff tap their name, enter a PIN, check in/out.
   **Needs design review:** a PIN is a second credential on a shared device, so it touches identity
   (ADR-020) — flagged, not designed here. Until decided, manager entry remains.
3. **Lateness and overtime** computed from check-in/out against the assigned shift with a grace period;
   overtime above the shift waits for manager approval.
4. **Roster** `/scheduling`: week grid per outlet, shifts as columns, drag employees in; required
   headcount per shift; gaps highlighted. Built on existing `scheduling` commands (book, declare
   unavailable), approved leave shown as unavailability.
5. **Leave:** balance per type (days per year minus approved), team calendar, approve/reject with reason.
6. **Payroll inputs:** monthly per employee — days, hours, overtime (approved), late count and deduction
   rule, leave, incentives and advances entered by manager, exceptions; CSV export.
7. **Performance tab:** orders handled, average service time, complaints linked, attendance %, shown as
   trends with team median for context.

Open decisions: kiosk PIN design (identity), salary storage permission, late deduction rule.

## 8. Acceptance

Module completeness bar (`docs/reference/module-completeness-bar.md`), plus live walk-through:
1. Create employee Ravi at Defence Colony (cook, full time, emergency contact); profile shows all fields.
2. Define Morning 10–6 and Evening 4–12; roster Ravi on Morning Mon–Fri; Saturday Evening shows a gap.
3. Ravi checks in 10:12 (late) and out 19:00; attendance shows Late and 1 h overtime awaiting approval.
4. Ravi applies for 1 day casual leave; manager sees balance 11 of 12 and the team calendar; approves;
   roster shows Ravi unavailable that day.
5. Month end: payroll inputs show days, hours, approved overtime, late count, leave; export CSV.
6. Ravi's performance tab shows orders handled and service time against team median.
