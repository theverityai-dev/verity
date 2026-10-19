# Task management and timesheet requirements: audit, gap analysis and developer job description

Status: DRAFT, 2026-10-19. Written from a read of the source on `main`. No tests were run for this audit, so every
row is **Reviewed** at most (see the legend in [gap-matrix.md](gap-matrix.md)); nothing is Client-validated.

## 1. Requirements audited

No requirement document was attached to the request. The list below is the one raised in the 2026-10-17 session and is
what this audit uses. If the list is wrong, only section 3 changes.

| # | Requirement |
|---|---|
| R1 | Task breakdown (a job split into tasks and sub-tasks) |
| R2 | Milestones |
| R3 | Tree, Gantt and Kanban views |
| R4 | Deadline tracking |
| R5 | Task dependencies |
| R6 | Issue tracking |
| R7 | Automated timesheets, linked to accounting and invoicing |

## 2. What the system already does

The `project` capability (`src/server/capabilities/project/`, 1,560 lines across 7 files) already carries a Job as the
spine, with these tables, all tenant-scoped with row-level security: `ProjectJob`, `ProjectMilestone`, `ProjectTask`,
`ProjectTaskDependency`, `ProjectTimeEntry`, `ProjectCostEntry`, `ProjectInvoice`, `ProjectReceipt`, `ProjectJobOrder`
(`prisma/schema.prisma` lines 6761 to 7011). Behaviour found in the code:

- **Tasks nest.** `ProjectTask.parentId` is a self-relation, so a tree exists in the data. Tasks carry state, assignee
  label, due date, expected minutes and a weight.
- **Dependencies are enforced.** `addTaskDependency` rejects a self-wait and any cycle (`dependsTransitively`,
  `work.ts`). `setTaskState` refuses to start a task while a prerequisite is not `done` or `cancelled`, and names the
  tasks it is waiting for.
- **Task state goes through the state runtime**, so every change is a `transition()` with an event and an audit entry,
  and finished tasks are read-only through `assertMutable`.
- **Milestones** have a due date, a reached timestamp and a customer-visible flag. They can be added, edited until
  reached, and reached.
- **Time and cost.** `ProjectTimeEntry` records worker, date, minutes and an hourly rate, optionally against a task. A
  wrong entry is voided with a reason, never deleted. `reads.ts` rolls up labour (time x rate), material (stock
  movements at moving-average cost) and other cost against the quote, so quoted-versus-actual already works.
- **Billing record.** `recordInvoice` and receipts track billed, paid and to-collect per job. The file states it
  "records; it does not compute tax or generate a GST invoice."
- **Job screen.** `src/app/(shell)/jobs/[id]/page.tsx` shows tasks, milestones, time and costs and computes which tasks
  are "ready" (not blocked, all prerequisites finished).
- **Tests.** `src/test/capability-project.test.ts` exists. The 2026-10-18 audit ran it and it passed.

## 3. Gap analysis

Severity: **H** blocks the requirement, **M** the requirement works but weakly, **L** polish.

### R1 Task breakdown

| Gap | Severity | Evidence | Fix |
|---|---|---|---|
| Sub-tasks are stored but never shown as a tree. The job page renders a flat table. | M | `parentId` in schema; flat `rows={job.tasks.map(...)}` in the page | Tree view (see R3). No schema change. |
| No roll-up. A parent's progress and minutes do not come from its children. `weight` exists but nothing reads it for percent-complete. | M | `weight` has no consumer in `reads.ts` | Add a roll-up read in `reads.ts`. No schema change. |
| No task templates, so every job's breakdown is re-typed. | L | none in `project/` | Optional second phase. |

### R2 Milestones

| Gap | Severity | Evidence | Fix |
|---|---|---|---|
| A milestone is not tied to tasks. It does not say which tasks must finish, and it is reached by hand. | M | `ProjectMilestone` has no task link | Add a milestone-to-task link table and show "n of m tasks done". Suggest reaching, keep the human click. |
| A milestone is not tied to a billing event. Advance and final invoices are entered by hand. | M | `ProjectInvoice` has no milestone link | Optional `milestoneId` on the invoice record. |

### R3 Tree, Gantt and Kanban views

| Gap | Severity | Evidence | Fix |
|---|---|---|---|
| **No Kanban.** State exists (`todo`, `in_progress`, `done`, `blocked`, `cancelled`) but there is no board. | H | no board component under `jobs/` | Board view with columns per state; a drop calls `setTaskState`. No schema change. |
| **No Gantt.** A task has only `dueDate`. It has no start date, so a bar cannot be drawn. | H | `ProjectTask` fields | Add `startDate` (nullable date). Planned bar = start to due. Dependency lines come from `ProjectTaskDependency`. |
| **No tree view.** | M | as R1 | Indented expandable list from `parentId`. |
| No cross-job view. Tasks only appear inside one job. There is no "all tasks", "my tasks" or "overdue". | H | page is `jobs/[id]` only | New read `listTasks` with filters; one screen with list, board and timeline toggles. |

### R4 Deadline tracking

| Gap | Severity | Evidence | Fix |
|---|---|---|---|
| Due dates exist but nothing watches them. No overdue flag in the data, no alert, no escalation. | H | no scheduler or outbox use in `project/` | Daily job on the existing scheduler (ADR-015) that finds overdue tasks and slipping milestones and writes to the notification outbox (ADR-039). |
| No slip forecast. A late prerequisite does not show what waits on it. | M | dependency check is a start gate only | Compute "earliest possible start" in a read. Do **not** auto-move dates (see non-goals). |
| Only finish-to-start dependencies. No lag, no start-to-start. | L | `ProjectTaskDependency` has two ids only | Leave. Tell the client. |

### R5 Dependencies

Largely met. Cycle check and start gate are present. The remaining items are the Gantt lines (R3) and the
earliest-start read (R4). No new gap beyond those.

### R6 Issue tracking

| Gap | Severity | Evidence | Fix |
|---|---|---|---|
| **No issue entity.** The gap matrix already lists "risk/issue/change register" as missing for RFP row B. | H | no `ProjectIssue` in schema | New `ProjectIssue` table: job, optional task, title, severity, owner, state, resolution, opened and closed dates, with its own state machine (open, in progress, resolved, closed). |
| Related records are not linked. `complaint` and manufacturing QC checkpoint failures cannot raise or link an issue. | M | separate capabilities, no link | Optional `sourceType` and `sourceId` on the issue. Do not merge the capabilities. |

### R7 Automated timesheets linked to accounting and invoicing

This is the largest gap. The data to cost labour exists; the automation and the links do not.

| Gap | Severity | Evidence | Fix |
|---|---|---|---|
| **Worker is free text.** `workerLabel` and `assigneeLabel` are strings, not a link to `HrEmployee` or a `User`. So no "my timesheet", no workload, no per-person total, no attendance cross-check. | H | `ProjectTimeEntry.workerLabel`; `ProjectTask.assigneeLabel` | Add nullable `employeeId` to both; keep the label for existing rows. Hourly rate defaults from the employee. |
| **Entry is manual only.** No start/stop timer, no weekly grid, no draft-then-submit. | H | single log-time command | Weekly grid and a start/stop timer on the phone. A timer is UI that creates one time entry on stop. |
| **No approval.** A time entry is final the moment it is written (void only). | M | no `approval` use in `project/` | Use the existing `approval` capability: submit week, manager approves, only approved time costs the job. |
| **No billable flag.** All time costs the job; none of it can be billed to the customer. | H | no flag on `ProjectTimeEntry` | Add `billable` boolean and a customer billing rate. |
| **Invoice cannot be built from time.** `recordInvoice` takes a typed number and amount. | H | `billing.ts` header comment | Command `invoiceFromTime`: select approved billable unbilled entries, create the invoice record, mark entries with `billedInvoiceId` so none is billed twice. |
| **No ledger posting.** `project/` never calls the accounting capability. Labour cost and revenue never reach the books. | H | `postJournalEntry` is defined in `accounting/` and not used from `project/` | On approval post labour cost (expense / work in progress); on invoice post receivable and income. Use `postJournalEntry` as it is. |
| No Tally adapter. | M | gap matrix row N, decision D6 | Out of scope. Posting through `postJournalEntry` keeps Tally an adapter job later. |
| Attendance is not used. Hours worked cannot be compared with hours booked. | L | `attendance` is separate | Warn when a day's booked time exceeds attendance. |

### Cross-cutting

| Gap | Severity | Note |
|---|---|---|
| Worker phone UX and the role map for who may log time, approve time and see rates. | M | Parked by the user until after the demo. Rates and costs must stay hidden from worker roles. |
| Reference parity of new screens with the user's two reference screenshots. | M | Part of acceptance for every screen. |

### Not found to be missing

CRUD for tasks and milestones, cycle-safe dependencies, void-with-reason on time and cost, cost roll-up, invoice and
receipt records, tenant isolation, audit trail. Do not rebuild these.

## 4. Decisions needed before code

Implementation decisions the developer brings back as a short note, not makes silently (repo stop conditions):

1. **Account mapping.** Which chart-of-accounts codes receive labour cost, work in progress, receivable and income. A
   tenant setting, not a code constant.
2. **Billing rate source.** Per employee, per task, or per job. Recommendation: per employee with a per-job override,
   the smallest shape that covers a time-and-materials job.
3. **Whether `ProjectInvoice` stays a record or becomes a generated GST invoice.** Generating tax is the `trading`
   invoice engine's job, and `project/index.ts` says that engine does not fit made-to-order work. Keep it a record here.
4. **Gantt library or hand-drawn SVG.** Recommendation: draw it. A read-only bar chart on a date axis with dependency
   lines is small, and a library brings its own styling against ADR-033.

No ADR is needed for R1 to R6 or the timesheet links: they add tables inside one capability and use existing commands.
An ADR is needed only if a customer-facing write surface is added, which is not in this scope.

## 5. Job description

**Role:** Full-stack developer (TypeScript, Next.js, Prisma, PostgreSQL), contract or full time, on the Verity repo.

**Purpose:** Finish the project-management and timesheet module for the DSEW client so a job can be broken into tasks,
tracked on tree, board and timeline views, watched for deadlines, carry issues, and turn approved time into an invoice
and ledger entries.

**Reports to:** the product owner.

### Deliverables, in order

| WP | Work | Requirement | Size (estimate) |
|---|---|---|---|
| 1 | Cross-job task read with filters; one screen with list, tree and Kanban toggle; Kanban drop calls `setTaskState` | R1, R3 | 4 to 5 days |
| 2 | `startDate` on task; read-only Gantt timeline with dependency lines and milestone markers; parent roll-up | R3, R1 | 4 to 5 days |
| 3 | Overdue and slipping-milestone daily job into the notification outbox; earliest-start read | R4 | 2 to 3 days |
| 4 | `ProjectIssue` table, state machine, commands, queries, job-page section, optional source link | R6 | 4 to 5 days |
| 5 | `employeeId` on task and time entry; weekly timesheet grid; start/stop timer; billable flag and rate | R7 | 5 to 6 days |
| 6 | Time approval through the `approval` capability; only approved time costs the job | R7 | 2 to 3 days |
| 7 | `invoiceFromTime` and the double-billing guard | R7 | 3 to 4 days |
| 8 | Ledger posting for labour cost and invoice through `postJournalEntry`; account-mapping setting | R7 | 3 to 4 days |
| 9 | Milestone-to-task link and optional milestone-to-invoice link | R2 | 2 days |
| 10 | Tests, screen QA at 390px and desktop, handoff and `FINISHER.md` update | all | 3 to 4 days |

Total about 32 to 41 working days for one developer. These are planning estimates from the size of existing files, not a
quote. Time WP 1 first to calibrate the rest.

### How the existing system makes this fast

A developer does not design the plumbing. Most of it is a pattern to copy from `project/work.ts` and `project/jobs.ts`.

- **One write path.** Every change is a `CommandDefinition` (key, entity, verb, zod input, handler). The runtime applies
  authorization, tenant scope, audit and events around the handler. A new command is about 20 lines and cannot skip the
  security rules because there is no other way to write.
- **One read path.** Queries are `QueryDefinition`s run inside `withTenant`. A tenant filter cannot be forgotten, since
  row-level security refuses unscoped reads and writes.
- **State machines are data.** Issue states and the timesheet submit/approve states are registered with the state
  runtime, the same as `ENTITY_PROJECT_TASK`. Transitions, events and read-only terminal states come with it.
- **Approval, notifications, accounting and scheduling already exist** as capabilities with stable commands (`approval`,
  the outbox of ADR-039, `postJournalEntry`, the ADR-015 scheduled trigger). WP 3, 6 and 8 are wiring, not building.
- **Tasks already carry parent and dependency data.** Tree, board and timeline are views over existing columns, so WP 1
  needs no migration and WP 2 needs one nullable column.
- **UI building blocks exist.** `Modal` and `FormModal` for sheets, `DataTable`, `QuantityStepper`, the viz primitives and
  the iOS tokens in `globals.css`. New screens compose these; they do not restyle them.
- **A test template exists.** `capability-project.test.ts` and `tenant-isolation.test.ts` show the setup for command tests
  and the negative cross-tenant test every new table needs.
- **Repo guidance is in the repo.** `taskplans/handoffs/README.md`, `FINISHER.md`, and the
  `verity-client-capability-builder`, `verity-entity-scaffold`, `verity-migration-safety` and `verity-usage-qa` skills
  tell a newcomer where files go and what to check.

### Required skills

TypeScript, React and Next.js (this is Next.js 16; read `node_modules/next/dist/docs/` before framework-sensitive
changes), Prisma migrations, PostgreSQL row-level security, Zod, Vitest. Helpful: double-entry bookkeeping basics,
Gantt or timeline UI, phone-first UI.

### Rules the developer must follow

- Use the repo's words: `Job`, `Task` (project level), `ChecklistItem` for work sub-steps, `Resource`, `Evidence`.
- Every new table: tenant column, RLS enabled and forced, a policy, and a negative cross-tenant test (INV-001).
- Tenant comes from the authenticated context, never from the request body.
- Money in integer minor units. A wrong entry is voided with a reason, never edited or deleted.
- Forms open as sheets, never inline above the page or in a side drawer. Dropdowns inside a sheet render above it.
- Follow ADR-033 (iOS look): opaque cells, tint from `--accent-seed`, no gradients or glass on rows, 44pt targets, AA
  contrast in light and dark.
- Check `verity-spec/17_decisions/adr/` before citing or numbering any ADR. Stop and escalate if a new platform primitive
  or a new external write surface seems necessary.
- Commit as work progresses; update `taskplans/handoffs/FINISHER.md` in the same commit that finishes an item.

### Non-goals

Automatic rescheduling when a prerequisite slips, resource levelling, critical-path analysis, payroll, GST invoice
generation, a Tally adapter, a customer portal, and the self-hosted deployment for the client's office server.

### Acceptance criteria

1. A user opens one screen and switches between list, tree, board and timeline over the same tasks; moving a card to
   start a task with an unfinished prerequisite is refused with the existing message.
2. A task past its due date, and a milestone past its due date, each raise one notification per day until fixed.
3. An issue can be opened against a job, assigned, resolved with a note and closed; a closed issue cannot be edited.
4. A worker logs time with the timer on a phone; the week is submitted; a manager approves; the approved time appears in
   the job's labour cost.
5. Billable approved time becomes an invoice record in one action; the same time cannot be billed twice, proven by a test.
6. Posting labour cost and an invoice creates balanced journal entries; the trial balance still balances; a void reverses
   them.
7. Every new table has an RLS policy and a passing cross-tenant test; the existing project and isolation suites still pass.
8. Every new screen matches the reference screenshots at 390px and desktop, in light and dark.

### Open question for the product owner

Is the requirement list in section 1 the full list? If the client sent more (for example resource workload, a customer
portal for job status, or recurring tasks), those rows are not audited here.
