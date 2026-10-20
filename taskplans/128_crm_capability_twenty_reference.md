# Task Plan 128 — CRM capability, modelled on Twenty, for DSEW and every later client

**Authority:** Product-owner request, 2026-10-20: "make a complete end to end in depth fully capable CRM from
twenty crm … understand ui ux as well, build it properly for all future and current clients like DSEW", then
"first make a plan of complete work". Owner answers the same day: (1) it is a **Verity capability**, not a fork
of Twenty and not a separate app; (2) the first build is **stages 1 and 2 together**. This is fresh, explicit
authorization for a business capability that `CLAUDE.md`'s scope list otherwise excludes ("CRM"); it authorizes
this capability only and changes no invariant, `enforcePolicy()`, INV-001 or ADR-017.

Grounding: DSEW gap matrix row "A CRM" (`clients/dsew/gap-matrix.md` line 50: customers exist; contacts per
customer, RFQ/tender tracker, meeting log and reminders missing); DSEW PRD flow "Enquiry -> Technical quote ->
Customer approval -> Order/Job opened" (`clients/dsew/prd.md` line 29); INV-003 (one Party per person or
business); ADR-001 (Party is a bare identity; Prospect lifecycles belong to a CRM capability); ADR-006 (`Task` is
reserved for project-level milestones); ADR-033 (iOS Experience System); ADR-017 (agent channel = caller's own
authority); ADR-039 (notification outbox) and ADR-037 (client data export). Background research:
`taskplans/archive/04_twenty_audit.md` (older Twenty snapshot, architecture only).

Reference implementation: `D:\Code\R&D\twenty` (cloned at `19bb8009e`, 2026-09-26). **Twenty is AGPLv3, with
some files under its commercial Enterprise licence. No Twenty source is copied into Verity.** It is read for its
data model, its interaction patterns and its UI/UX only; every line here is written fresh against Verity's
runtime.

## Status: PROPOSED 2026-10-20 — plan only, no code

Nothing built. Stage 1+2 design is in brainstorming with the owner; its spec will be
`docs/superpowers/specs/2026-10-20-crm-capability-design.md`. ADR-050 and ADR-051 (below) are not yet written.

---

## 1. What Twenty is, and what we take from it

Twenty's server modules (`packages/twenty-server/src/modules`): company, person, opportunity, note, task,
attachment, timeline, calendar, messaging, connected-account, call-recording, contact-creation-manager,
match-participant, blocklist, dashboard, workflow, workspace-member. Its front end is a set of generic
**object views** over any object, standard or custom.

The patterns that make Twenty feel like Twenty, and that this plan keeps:

| Twenty pattern | What it is | Where it lands in Verity |
|---|---|---|
| Record table | Spreadsheet-like list: inline cell edit, column show/hide/reorder/resize, sticky first column, multi-select with a bulk action bar | Stage 2, a new generic `RecordTable` beside `DataTable` |
| Kanban | Same records grouped by a select field (stage), drag between columns, per-column totals | Stage 2, generic `Board` component |
| Saved views | Per object: visible fields, filters, sorts, grouping, type (table/kanban); shared or personal; one is the default | Stage 2, platform primitive (ADR-051) |
| Record page | Header with the key fields editable in place, tabs (Timeline, Follow-ups, Notes, Files), related-record panels | Stage 1, built on `EntityHeader` / `DetailPane` |
| Timeline | One reverse-chronological feed per record: field changes, notes, calls, meetings, follow-ups, linked records, files | Stage 1, reads `activity` plus CRM interactions |
| Command menu | Cmd-K: search every record, jump, create | Stage 2, extends the existing command palette |
| Side panel | Open a record from a list without leaving it | Stage 2, `DetailPane` as a sheet/side panel (ADR-033 rules) |
| Custom fields and objects | Admins add fields and whole objects without code | Stage 3, existing `CustomFieldSchema` |
| Workflows | Trigger (record created/updated, schedule, manual) -> steps | Stage 4, existing workflow engine |
| Email/calendar sync | Gmail/Outlook threads and meetings attached to people and companies automatically | Stage 5, needs its own ADR |

What we do **not** take: Twenty's metadata engine that turns every object into its own workspace schema, its
GraphQL API generator, its AI/agent modules, and call recording. Verity already has the command/query runtime,
RLS and the API/agent channel; a second metadata engine would be a second runtime.

## 2. Decisions this plan makes, and the ones that need an ADR or the owner

**D1 — Companies and people are Party records (ADR-050, to write).** INV-003 says one Party per person or
business, and `Party` already models "human or corporate participant". A CRM company or contact is therefore a
`Party` in state `Invited` with no `User` (ADR-001: no login is minted), plus a capability-private profile row
(domain, industry, owner, address, job title, company link). This differs from the existing guest CRM, which
deliberately keeps restaurant guests off Party; that precedent is about anonymous walk-in diners matched by
phone, not named business contacts. Because two readings of INV-003 now exist in the code, this is a
**conflicting specification** and is settled by ADR-050 before any schema is written, not silently. ADR-050 must
also say how `TradingCustomer` (today a separate table with only a display name) is linked: an optional
`party_id` on `trading_customer`, backfilled, so a trading customer and a CRM company are one identity.

**D2 — Capability key.** `verity.capability.crm` is already taken by the Colonel Kebabz guest CRM (restaurant
guests, depends on `dinein`; `complaint`, `coupon` and `loyalty` depend on it). Reusing it would make a generic
B2B CRM depend on dine-in. Decision: new capability **`verity.capability.relationship`**, directory
`src/server/capabilities/relationship/`, shown in navigation as **"CRM"**. Renaming the guest CRM to `guest` is
cleaner long term but touches activation rows and three dependents; it is listed as a later tidy-up, not done
here.

**D3 — Vocabulary (Spec GOV-TER, ADR-006).** Twenty's "Task" is a follow-up to-do. `Task` is reserved in Verity
for project-level milestones, so the CRM calls it a **Follow-up**. Twenty's "Note" stays a Note. Calls, meetings,
visits and emails logged by hand are **Interactions**. `Activity` keeps its canonical meaning (the change log)
and feeds the timeline unchanged.

**D4 — The pipeline and DSEW's job flow.** An **Opportunity** is the pipeline record from first enquiry up to won
or lost. It does not replace DSEW's project job; winning one offers "Open a job", which lives in the `project`
capability (project declares a dependency on `relationship`), so the CRM stays generic and depends on nothing
client-specific. DSEW's RFQ/tender tracker is an Opportunity with a source of `Tender`/`RFQ` and a
submission-due date; anything more specific waits for custom fields (stage 3).

**D5 — Saved views are a platform primitive (ADR-051, to write).** Table and Kanban views with saved filters,
sorts and columns are useful on every list in Verity, not only the CRM; building them inside the capability would
force a copy for the next one (standing rule: structure generic first). A new platform model is a stop condition
in `CLAUDE.md` ("a new platform primitive appears necessary"), so ADR-051 decides it first. It also has to justify
one more module against the platform-size tripwire in `conformance.test.ts` (cap 57 today).

**D6 — Pipeline stages are data, not code.** Stage lists are per tenant, ordered, each mapped to a closed
`StateCategory` (ADR-009): New/Qualified/Proposal = `Active`, Won = `Completed`, Lost = `Cancelled`. A lost
opportunity carries a structured lost reason (the pattern project jobs already use).

**Owner decisions still open (do not solve silently):** who may see whose opportunities (proposed default:
tenant-wide read, edit by the owner or a role with the Edit grant); whether amounts show on the board to every
role; DSEW's real pipeline stage names.

## 3. The work, stage by stage

Each stage ends with tests against the real database, the UI walked in a browser at phone and desktop width in
light and dark, and `FINISHER.md` updated. Estimates assume one developer working with Claude.

### Stage 0 — Decisions on paper (about 1 day)
- ADR-050 (Party-backed companies and people; `trading_customer.party_id`) and ADR-051 (saved views as a platform
  primitive), both through `verity-adr-gate`.
- Twenty UX study: `docs/reference/twenty-parity/twenty-vs-verity.md`, screen by screen (record table, board,
  record page, timeline, command menu, object/field settings), each line marked keep / adapt / out.
- Stage 1+2 design spec (brainstorming output) approved by the owner.

### Stage 1 — Core records (about 6-8 days)
Data (one additive migration, forced RLS and a tenant column on every table):
- `relationship_company` (party_id, domain, industry, size band, owner user, address, source),
  `relationship_person` (party_id, company_id, job title, owner; email/phone stay on Party),
  `relationship_opportunity` (number, name, company, point of contact, owner, amount + currency, expected close,
  submission due, source, stage_id, lost reason), `relationship_stage` (per tenant, ordered, category),
  `relationship_note`, `relationship_interaction` (kind call/meeting/email/visit, occurred at, outcome, people
  present), `relationship_follow_up` (title, due at, assignee, status, done at), plus a keyed-reference link table
  so notes, interactions and follow-ups attach to a company, person or opportunity (the Evidence/document pattern).

Commands: create, edit and archive for each record; move opportunity stage (with transition rules); mark won or
lost with a reason; log interaction; add note; add, complete and reopen follow-up.
Queries: filtered lists, record detail, timeline (activity + notes + interactions + follow-ups + linked jobs and
documents), pipeline summary.
Screens: Companies, People and Opportunities lists; record pages with header, timeline, follow-ups and related
panels; create/edit as sheets.
Reminders: follow-ups due today or overdue reach the assignee through the notification outbox (ADR-039) on the
existing scheduler; no new delivery channel.
Integration: the `TradingCustomer` link from ADR-050; "Open a job" from a won opportunity (project capability).
Export: every table registered with `registerExportable` (ADR-037).

### Stage 2 — Views, the Twenty feel (about 7-9 days)
- Saved views platform model and API (ADR-051): object key, name, type table|board, columns, filters, sorts,
  group-by field, personal or shared, default.
- `RecordTable`: inline edit through the same commands (no side write path), column chooser, sort, filter bar
  with chips, bulk select and bulk actions (assign owner, move stage, archive), keyboard navigation.
- `Board`: opportunities by stage, drag to move (calls the move-stage command; a refused move snaps back with the
  reason), column counts and amount totals, quick-add per column.
- Side-panel record preview from any list; Cmd-K search across companies, people and opportunities.
- CSV import with column mapping and a dry-run preview, through commands (dedupe by email and domain); CSV export
  of the current view.
- ADR-033 throughout: iOS cells, capsule filter chips, sheets on phones, 44pt targets, reduced motion.
- DSEW demo seed: stages, a dozen companies and contacts, opportunities across the board, interactions and
  follow-ups.

### Stage 3 — Custom fields and objects (about 5-7 days)
- Tenant fields on company, person and opportunity via `CustomFieldSchema`, shown in tables, filters, record pages
  and import. DSEW's tender fields (EMD, tender number, portal) become custom fields here.
- Custom objects only if ADR-051's view layer and `CustomFieldSchema` can carry them without a second metadata
  engine; otherwise recorded as not built, with the reason.
- Duplicate detection and merge for people and companies, keeping ADR-007's identity rules.

### Stage 4 — Automations and pipeline insight (about 4-6 days)
- Triggers on stage change, record created and follow-up overdue; actions: create follow-up, assign owner, notify,
  set field. Built on the existing `WorkflowDefinition` engine, every action executed as a command (ADR-017).
- Pipeline dashboard: conversion by stage, won/lost by reason, ageing, forecast by expected close (Task 127 visual
  language).

### Stage 5 — Email and calendar sync (its own ADR first; estimate after it)
- Gmail/Outlook OAuth, thread and meeting capture matched to people and companies, blocklist, per-user consent.
  This adds a security boundary (stored third-party tokens, inbound data) and stops at an ADR before any code.
  DSEW keeps confidential data on its own server; whether sync is allowed there is a client decision.

## 4. Non-goals

- No fork, vendoring or copy of Twenty code (AGPL). No second database, auth or metadata engine.
- No marketing automation, campaigns, lead scoring, quotes or invoices inside the CRM (quotes stay in `project` /
  `trading`), call recording, or AI features beyond what the existing agent channel already gets.
- No change to the guest CRM (`verity.capability.crm`) in this plan.
- No DSEW-specific schema: DSEW gets configuration (stages, custom fields, seed data), never its own columns.

## 5. Verification per stage

Tenant isolation test for every new table (forced RLS; a cross-tenant read returns nothing); command tests for
every transition and refusal; write-confinement and conformance tests green (declared dependencies, platform cap);
`ui-reachability` with no new unlisted entries; Playwright walk of lists, board drag, record page and import at
390px and 1440px in both themes; a `verity-usage-qa` pass before a stage is called done.

## 6. Order and dependencies

Stage 0 -> 1 -> 2 is the first deliverable (owner decision 2026-10-20). Stage 3 needs stage 2's views. Stage 4
needs stages 1 and 3. Stage 5 needs its ADR and a client who wants it.
