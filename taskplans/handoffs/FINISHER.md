# Finisher: the priority-ordered list of everything left to finish

**Last updated: 2026-10-16** (against `main` at `205eef45`)

This file is the single work order. It lists only what is **not finished**, highest priority first,
with how to finish each item and how to know it is done. When an item is finished it is **deleted
from this file** (see "Keeping this file true"). If an item is not here, it is either done or not
authorised.

Related files, and what each is for:

- `taskplans/handoffs/README.md`: the index of active threads. Points here.
- `taskplans/125_pending_work_register_2026_10_06.md`: the long-form register and progress log. This
  file is its prioritised, shorter view; item numbers like "125 §4.3" refer to it.
- `clients/dsew/phase-plan.md`: the D & S Electric Works phase plan (the live client).
- `taskplans/00_STATUS_INDEX.md`: the full history of every taskplan. Not a work order.

## Keeping this file true

Every session that finishes, starts, blocks or discovers work does this in the **same commit** as the
code:

1. **Finished an item:** delete its block from this file. Add one line to "Recently removed" with the
   date and commit hash. Keep that list to the last 10 lines; drop the oldest.
2. **Started an item:** change its `Status` to `IN PROGRESS` and say who or which session.
3. **Blocked an item:** change `Status` to `BLOCKED`, move it to "Blocked on a person", and name who
   must act and what exactly they must do.
4. **Found new work:** add it at the right priority with all fields below. Do not leave work only in a
   chat.
5. **Wrong or stale entry:** fix it, and bump "Last updated" and the commit hash.
6. Update the paired taskplan or register row (125, DSEW phase plan) in the same commit, as the
   handoffs README already requires.

Stage files by explicit path, never `git add -A`: more than one session works in this checkout.

Priority meaning:

- **P0:** production correctness or risk. Do first.
- **P1:** the live client (D & S Electric Works) and anything already built but not yet proven.
- **P2:** planned build work that is unblocked.
- **P3:** verification, coverage and housekeeping.

Every item has: **What**, **Why**, **How**, **Done when**, **Source**, **Status**.

---

## P0: production correctness

### P0-1. Readiness flaps on `scheduler_stale`

- **What:** `/api/ready` returns 503 for a few minutes between scheduled runs.
- **Why:** The freshness limit is 15 minutes but the GitHub Actions "Scheduled work" workflow fires every
  15 to 20 minutes, so a healthy deployment reports not-ready and any uptime check on it will alarm.
- **How:** In `src/server/platform/readiness.ts`, change `SCHEDULER_FRESH_MS` from `15 * 60_000` to
  `30 * 60_000` (line 16). Update the comment above it with the reason. Check the readiness test
  (search `src/` for `scheduler_stale`) still asserts the new limit. Alternative, larger fix: move the
  trigger off GitHub Actions cron; do not do this without a decision.
- **Done when:** a test proves 29 minutes since the last run is ready and 31 is not, and `/api/ready`
  stays 200 across three consecutive scheduler cycles on production.
- **Source:** 125 progress log, "Production state, 2026-10-09 evening".
- **Status:** NOT STARTED

### P0-2. Task 126 (URY gap closure) is built but not on production

- **What:** Waves 0 to 5 (GST tax invoice, kitchen stations/courses/tickets, customer self-order,
  outlet and channel prices) are built and not pushed or migrated on production.
- **Why:** Built code with no production migration is a push that cannot be deployed safely, and the
  work is at risk of being lost or conflicting with other sessions.
- **How:** (1) Confirm the working tree has no other session's uncommitted files that the pushed
  commits import. (2) From a temporary worktree at the exact commit being pushed, apply migrations
  `20261009100000` to `20261009140000` (all additive) to production with `prisma migrate deploy` on
  `DIRECT_URL`; confirm `migrate status` is up to date. (3) Push. (4) Confirm CI, `/api/health` shows the
  commit, `/api/ready` is 200. (5) Do **not** turn self-order on for any outlet (see "Blocked on a
  person").
- **Done when:** production runs the commit, health and ready are green, and Task 126's status section
  says "on production".
- **Source:** `taskplans/126_ury_gap_closure_restaurant_operations.md`; handoffs README. Check the
  current state first: the 125 log says part of Wave 1 was already pushed on 2026-10-09.
- **Status:** BLOCKED on the product owner's approval to apply migrations (see "Blocked on a person").

---

## P1: the live client, and built-but-unproven work

### P1-1. D & S Electric Works: finish the phase plan

Source for all of P1-1: `clients/dsew/phase-plan.md` and `clients/dsew/prd.md`. Work in this order. Each
phase ends by stating BUILT / PROVEN / NOT YET BUILT separately; nothing is called complete before
phase 7.

**P1-1a. Update the phase plan to match the code (do first, 15 minutes).**
- **What:** The phase plan status block (dated 2026-10-14) does not mention job billing or the later
  Summary, Jobs and UI changes.
- **How:** Read `git log --oneline -- src/server/capabilities/project clients/dsew` and the billing
  commit `c9ce808c` (recorded invoices and receipts, "Money to collect" on Summary; generating a GST
  invoice from a job is deliberately not built). Update the status block with what is BUILT and
  PROVEN, each stated separately.
- **Done when:** the status block matches `git log` and the project tests.
- **Status:** NOT STARTED

**P1-1b. Phase 0: the remaining parity documents.**
- **What:** Project-module parity and **accounting parity** (`clients/dsew/reference-parity/accounting.md`,
  2026-10-16) are written. Quotation and quality are not. The manager.io tab names and Summary tiles
  are unverified until a session with the owner (the public guides were only partly reachable).
- **Why:** Standing rule (2026-10-05): the parity document comes before building modules for a client.
- **How:** In `clients/dsew/reference-parity/`, audit Odoo (`sale_project`, `quality`) page by page,
  button by button, as the existing documents do. Mark each line built, not built, or deliberately out.
  Never read or port Manager's source (FSL 1.1, no competing use); structure from public guides only.
- **Done when:** the quotation and quality sections exist with a disposition per line, and the owner
  session has confirmed the manager.io tab list.
- **Status:** IN PROGRESS (accounting done)

**P1-1h. Accounting: documents must post to the ledger (found 2026-10-16).**
- **What:** Invoices, payments and credit notes in `trading` and `project` never reach the `accounting`
  ledger, which only takes manual journals, so any balance sheet built today would exclude all real
  business. See `clients/dsew/reference-parity/accounting.md` sections 5 to 7.
- **Why:** Both references (Odoo, Manager) make posting the core of accounting.
- **How:** (1) ADR-044 is written, status PROPOSED (`verity-spec/17_decisions/adr/adr-044.md`); the product
  owner accepts or amends it. (2) **Done 2026-10-16:** `profit_and_loss` and `balance_sheet` queries,
  pure functions in `src/lib/financial-statements.ts` (11 tests), and `/accounting/statements` with a
  plain notice that only journal entries are covered. (3) After acceptance: build posting (account map
  table, idempotent handlers per document kind, backfill command, setup screen for unmapped kinds), then
  Summary tiles for the two statements. (4) Ledger period lock with time-limited exception, opening
  balances. (5) Bank accounts and CSV statement reconciliation as phase 2.
- **Done when:** the acceptance walk in `accounting.md` section 8 passes with real D&S data.
- **Status:** IN PROGRESS (statements built, not proven against a ledger with entries; posting waits for
  ADR-044 acceptance). Still to do without the ADR: a DB test of the two queries (inactive accounts kept,
  date window inclusive), then step 4.

**P1-1c. Phase 3 remainder: quote approval workflow and customer link.**
- **What:** Quote revisions and the approval snapshot exist. An approval workflow (who must approve a
  quote before it is sent) and a customer-facing link are not built.
- **How:** Reuse the platform `approval` capability for the workflow rather than a project-local one.
  The customer link depends on P1-1f (the hashed-token status page): build that first or together.
  Needs a decision on who approves; record it in the DSEW decisions file before coding.
- **Done when:** a quote cannot be sent until approved by the configured role, proven by a DB test, and
  the customer can open the quote through a link.
- **Status:** NOT STARTED

**P1-1d. Phase 4: test report per unit, gating stage completion.**
- **What:** Test checkpoints live on the manufacturing testing stage; there is no separate test report
  record, no printable page, and a failed test does not spawn a rework child.
- **How:** Add a test-report table with RLS (new migration; add to the conformance test's lists as
  needed), a command to record a report against a manufacturing operation, a rule in the stage
  completion path that refuses completion without a passed report, and a failure path that creates a
  rework child. Build a printable page following `jobs/[id]/quote/`.
- **Done when:** DB tests prove: stage cannot complete without a passed report; a failed report creates
  a rework child; RLS isolates tenants.
- **Status:** NOT STARTED

**P1-1e. Phase 5 remainder: show, hide and reorder the Summary tabs.**
- **What:** Summary and the navigation group are built; per-user tab preferences are not.
- **How:** Needs a small per-user workspace preference. Check whether a preference store already exists
  before adding a table. Use shared primitives only (`verity-spec/09_experience/design-system.md` §3).
- **Done when:** a user can hide and reorder tabs and the choice persists across sign-in.
- **Status:** NOT STARTED

**P1-1f. Phase 6: customer job-status page.**
- **What:** A read-only page a customer opens from a link, showing their job's status.
- **How:** Follow the accepted pattern in ADR-030 (the public verification passport): a frozen minimal
  snapshot behind a hashed token, with one definer function for the anonymous read. This is a new public
  read surface, so check ADR-030 covers it; if it does not, it needs its own ADR before code.
- **Done when:** a token opens a minimal status page, an invalid or revoked token shows nothing, and no
  tenant data beyond the snapshot is reachable. Test with the live-server test pattern the passport uses.
- **Status:** NOT STARTED

**P1-1g. Phase 7: verification.**
- **What:** No obvious-basics pass and no Odoo/ERPNext cross-check has been run for D & S.
- **How:** Run the `verity-usage-qa` skill's checklist (including "Line-list basics pass") and the
  `obvious-basics-checklist` on every D & S screen at 390px and desktop, light and dark. Keep screenshots
  and write findings in the DSEW phase plan.
- **Done when:** evidence is committed and every defect is fixed or listed.
- **Status:** NOT STARTED

### P1-2. Screens that are built and DB-proven but never opened in a browser

- **What:** Task 125 built these with server tests but no browser check: roster week grid (6.1), leave
  calendar (6.2), labour line in the outlet P&L (4.4), cash in and out (4.1), platform payouts (4.2),
  menu add-ons (3.1), price history (3.4), guest edit and merge (5.1), saved segments (5.2), one-tap
  points redeem (5.3), menu availability (3.2, 3.3), and Task 126's screens. Task 118's manufacturing
  flows (stage production, QC checklist, dispatch, batches) are in the same state.
- **Why:** Code that has only been proven at the server can still be unusable on screen.
- **How:** Enter the client from HQ (a support session writes your reason into the client's audit
  trail; use a disposable tenant for write paths). Open each screen once with real data at desktop and
  390px, light and dark. Fix defects in the shared primitives, not per page.
- **Done when:** each screen has been opened once, defects are fixed or logged here, and 125's rows are
  updated.
- **Source:** 125 §1.1, §1.2, progress log.
- **Status:** NOT STARTED. Note: the Chrome extension was unreliable on 2026-10-15; a headless
  Playwright script with a saved session worked (delete the saved session file afterwards; it contains
  cookies).

### P1-3. Task 119 live verification

- **What:** The `verity.decision.ask` node is unit-proven only.
- **How:** Apply migration `20260930000000_capability_decision_egress`, supply a real API key, make one
  real call, record the result.
- **Done when:** one real call succeeds and is recorded in the taskplan.
- **Source:** Task 119; handoffs README.
- **Status:** BLOCKED on a person (key and migration).

---

## P2: planned build work, unblocked

### P2-0. Client-owned Vercel and Supabase deployments: decide, then pilot

- **What:** Research is done (`docs/deployment/client-owned-vercel-supabase.md`, 2026-10-16). It is
  feasible but needs a new deployment mode (proposed ADR-045, "Mode D") and has seven blockers, the top
  three being: `verity_app` is created by no migration, the first operator and tenant on a fresh cloud
  database have no scripted procedure, and the HQ operator model assumes one shared database.
- **Why:** Small clients may want their data in their own accounts. Vercel Hobby is non-commercial and a
  Hobby team cannot deploy a private organisation repository, so a client needs Vercel Pro and Supabase Pro.
- **How:** After the product owner decides (see "Blocked on a person"): write ADR-045; script the role
  and first-operator steps with tests; run the pilot in the doc's section 10 on throwaway Pro accounts;
  pass the section 11 gate before any real client data.
- **Done when:** the gate passes and the mode is named in every claim (ADR-031 constraint 1).
- **Status:** BLOCKED on a person (offer it or not, price, pilot client, support model).

### P2-1. Remaining export datasets (ADR-037, 125 §7.5)

- **What:** The client data export covers CRM only. Finance, inventory, HR, attendance, coupons,
  complaints, recipes and every other capability are not registered.
- **How:** Register each dataset through the existing export registry the CRM slice uses (find it from
  the test in `capability-crm.test.ts`). Each dataset passes through `enforcePolicy()` and is
  permission-narrowed; the operator never exports business rows. One test per dataset.
- **Done when:** every capability with client data has a registered dataset and a test.
- **Status:** NOT STARTED

### P2-2. Announcements (ADR-038, 125 §7.6)

- **What:** Authorised but not confirmed built.
- **How:** First confirm in the code (`grep` for the announcement table and definer function). If it is
  absent: one global table written only through an operator-checked definer function; clients read and
  never receive a copy; dismissal is stored in the client's tenant. Migration plus conformance entries.
- **Done when:** an operator can publish, a client sees and dismisses, and a stranger tenant cannot
  write. If it turns out to be built, delete this item.
- **Status:** NOT STARTED

### P2-3. Data import console in HQ (125 §7.1)

- **What:** Spreadsheet to mapping to validation (duplicates, bad GSTIN) to import through normal
  commands.
- **How:** Imports run through the ordinary command path so `enforcePolicy()` and audit apply. Reuse the
  CSV reader in `src/lib/settlement-match.ts` as a starting point. Never write rows directly.
- **Done when:** a sample file with duplicates and a bad GSTIN reports them and imports the rest.
- **Status:** NOT STARTED

### P2-4. Support lookup, cross-client roll-up, HQ finance dashboard (125 §7.2, §7.3, §4.3)

- **What:** Support lookup finds a record in an entered client and shows its timeline. The roll-up shows
  stage, blocked and owner across clients. The HQ finance dashboard spans clients.
- **How:** Lookup runs inside an entered client under the operator's authority (ADR-035); no
  cross-tenant read. The roll-up reads existing lifecycle and checklist state. The finance dashboard is
  **metadata only unless a read path passes `enforcePolicy()`; otherwise write an ADR first.**
- **Done when:** each works without any cross-tenant business-row read, proven by the operator-boundary
  test.
- **Status:** NOT STARTED

### P2-5. Paging on long lists (125 §7.9)

- **What:** Orders, bills, ledger and audit load whole lists.
- **How:** Cursor paging in the query layer first, then `DataTable` consumes it. Do not page in the
  browser only.
- **Done when:** a list with 10,000 rows loads one page and pages correctly; tests cover the cursor.
- **Status:** NOT STARTED

### P2-6. Guests: offers, tiers, birthdays (125 §5.4, §5.5)

- **How:** Offer rules with no stacking (per the decisions file); tiers and birthday rewards after.
  Read `clients/colonel-kebabz/reference-parity/DECISIONS.md` first.
- **Done when:** rules have DB tests including the no-stacking case.
- **Status:** NOT STARTED

### P2-7. Task 126 leftovers

- **What:** Kiosk mode, order-pad favourites, unmerge guests, and a service-request notification
  (ADR-039).
- **How:** Each is independent; take them in that order only after P0-2 is on production. Unmerge needs
  care: merges link through `customer.merged_into_id` and history is never rewritten (ADR-007).
- **Status:** NOT STARTED

### P2-8. Task 118 follow-ups

- **What:** Lot and batch tracking, and a shared photo-upload component.
- **How:** Read `taskplans/118_manufacturing_capability_odoo_gap_and_ux_completeness.md` §10. Wider
  manufacturing build waits for a named design partner; D & S is now a manufacturing client, so ask the
  product owner whether it is the partner.
- **Status:** NOT STARTED

---

### P2-9. Visual language for every screen (Task 127), DSEW first

- **What:** Redesign all 133 screens to the owner's mockup structure and colour system on ADR-033 iOS cards: tinted state pills, icon tiles in eight approved hues, KPI discs, journey maps, charts only where a real series exists, list plus live detail pane. First client D & S Electric Works.
- **Why:** Product-owner request and decisions, 2026-10-16.
- **How:** `taskplans/127_visual_language_every_screen_redesign.md`. Phase 0: ADR-046 and the library study are written (owner signs off ADR-046; finish library study sections 2.4 and 3); Phase 1: tokens, components, in-house glyphs; Phase 2: build `/manufacturing/routes/[id]` and rebuild `/manufacturing/floor` (neither mockup exists today); then section 5 order.
- **Done when:** Phase 9 sweep is clean and the Task 116 matrix is filled.
- **Source:** Task 127.
- **Status:** IN PROGRESS. ADR-046 accepted; Phases 1 to 3 built and browser-checked on DSEW (tokens, shared components, 86 glyphs, shop floor, route detail, order, jobs, summary). Reachability baseline and pure-suite registration of `viz-geometry.test.ts` fixed. Manufacturing DB tests still unrun (no test database). Next: Phase 4 restaurant (Colonel Kebabz), then 5 to 9; redraw four look-alike glyphs; owner signs off hue values from `docs/reference/visual-language/swatches.html`.

### P2-10. Wastage reasons are a restaurant's list (generic wording debt)

- **What:** `WASTAGE_REASONS` (`src/server/capabilities/inventory/index.ts`) is a closed list that includes "Burnt" and "Preparation waste". A factory tenant sees them in the Waste form. `src/test/generic-wording.test.ts` names "Burnt" as known debt.
- **Why:** Generic capabilities must not speak one industry's language; the guard test exists because "outlet" and the food-cost Variance tab leaked into DSEW (fixed 2026-10-17).
- **How:** A per-tenant configurable reason list (default set per industry pack). Needs a decision on where it lives (config, not an enum) before code.
- **Status:** NOT STARTED

### P2-11. Worker experience: assignment, evidence and offline (phone and tablet)

- **What:** DSEW now has Floor worker and Supervisor roles (grants only, `prisma/seed-dsew-roles.ts`) and phone work cards on the Shop floor. Still missing: (1) a worker sees every open stage, not only theirs, because permissions have no `own` scope and stages have no assignee (own scope needs an ADR, see CLAUDE.md "Open"); (2) photo evidence capture from the phone camera inside the checklist; (3) offline tolerance for a workshop with weak signal; (4) tablet landscape not yet checked (portrait done 2026-10-17: four-up tiles, one scrolling chip row, 44px targets).
- **Why:** Workers use phones and tablets; the office uses PCs.
- **How:** Decide assignment first (ADR for `own` scope or a stage assignee field), then build the checklist camera capture.
- **Status:** NOT STARTED

## P3: verification, coverage, housekeeping

### P3-1. Load test: take one real measurement (Task 123, 125 §7.8)

- **What:** The k6 harness exists (`scripts/load/`); no measurement has been taken.
- **How:** Needs the per-tenant volumes from the product owner and a disposable database. Generalise the
  seeder (`prisma/seed-scale.ts`) to uneven tenants, run, then do the index audit and the noisy-neighbour
  run. Write an evidence file with method, numbers and limits. No claim without it.
- **Status:** BLOCKED on a person (volumes, disposable database).

### P3-2. Task 116 route × role × theme × viewport matrix

- **How:** Commit an evidence folder with screenshots, or re-list the remainder in Task 116.
- **Status:** NOT STARTED

### P3-3. Client parity docs for the other clients (125 §8.2)

- **What:** PlotArmour, Carxen, Kents, and the remaining Colonel Kebabz modules.
- **How:** Per the standing rule: audit Odoo and ERPNext modules, pages and buttons for the client's needs
  and write the detailed client document before building.
- **Status:** NOT STARTED

### P3-4. Test coverage for thin modules (125 §8.1)

- **How:** Run `vitest --coverage`, list modules with thin tests, add one behaviour test file per gap.
  Run the deploy-related tests from Git Bash on Windows, not PowerShell (they shell out to bash).
- **Status:** NOT STARTED

### P3-5. Regenerate the status index and refresh the handoffs README (125 §8.4)

- **How:** Regenerate `taskplans/00_STATUS_INDEX.md` evidence from `git log` and the taskplans; bump the
  README's "Last updated". The README was last updated 2026-10-10 and does not cover the D & S work.
- **Status:** NOT STARTED

### P3-6. Finish the `chore/repo-cleanup` branch (125 §8.7)

- **How:** Remaining: regenerate index evidence (P3-5), dead-code pass, boundary lint rules, CI gates.
- **Status:** NOT STARTED

### P3-7. Remaining UI polish from the 2026-10-15 review

- **What:** (a) Pages other than Summary still use the same title, stats, table layout; give each its
  one dominant element. (b) The support-session banner takes a large block of a phone screen; make it a
  one-line bar. (c) The job header could move Put on hold and Cancel into a menu once the shared
  `OverflowMenu` can host dialog actions. (d) Run `/impeccable init` so a PRODUCT.md exists.
- **How:** Change shared primitives and shells, not individual pages. Follow the Experience System
  section of `CLAUDE.md` (ADR-033). Verify in the browser at desktop and 390px.
- **Done when:** (a) to (d) are done or individually dropped with a reason.
- **Status:** NOT STARTED

### P3-8. Safari and Firefox check of the glass layer (125 §1.3)

- **What:** Likely moot: `LiquidGlass.tsx` no longer exists and ADR-033 limits materials to bars and
  overlays (plain `backdrop-filter`).
- **How:** One look on a real device, then close. Do not build a fallback.
- **Status:** NOT STARTED

---

## Blocked on a person

Each line names who must act and what they must do. Move the item back to its priority once done.

- **Approve production migrations and the push** (P0-2). Product owner: say "apply and push", or name
  what to hold back.
- **Outlet codes** for the three Colonel Kebabz outlets, and **who confirms the ADR-040 tax points**
  with the client's adviser (P0-2). Product owner.
- **Turn self-order on per outlet** only after a phone walk of the guest page and a printed sticker
  (P0-2). Product owner with the client.
- **Approve ADR-044 (documents post to the ledger)** before accounting posting is built (P1-1h), and
  **a session with the D&S owner** to confirm manager.io's tab list and Summary tiles (P1-1b).
  Product owner.
- **Offer client-owned cloud accounts or not** (P2-0): price, pilot client, whether a named operator login
  inside each client's instance is an acceptable support model. Product owner.
- **API key and migration for Task 119** (P1-3). Product owner.
- **Per-tenant data volumes and a disposable database** for the load test (P3-1). Product owner.
- **Name the manufacturing design partner** (P2-8): is D & S Electric Works it? Product owner.
- **Relay's contract** for the Task 120 adapter (Verity side is built and dark by default). External.
- **D & S on-premise Mode B** needs its validation gate (`clients/dsew/deployment.md`) before any promise
  is made to the client. Product owner and client IT.

## Not authorised for build

Do not pick these up without a fresh product-owner decision (`CLAUDE.md` stop conditions):

- `enterprise-demo-prd/` (AstraGrid, fictional): overlaps CRM, procurement and field service, which the
  2026-09-30 scope note did not open. Reopen only when a named client asks for one of those modules, and
  then build the module on the platform, not as a fork.
- CRM, Sales, Procurement, Security Operations, Staffing, Facilities, Field Service, Maintenance,
  Commerce, Finance as new business capabilities, any industry pack, and Task 120's external
  tool-invocation surface beyond what ADR-029 permits.
- Any change that adds a security boundary, or touches INV-001, ADR-017 or `enforcePolicy()`, without its
  own ADR first.

## Watch only (do not pick up)

- Task 90, attention-platform concept: a trigger watch. Fires only when a second independently arrived-at
  instance of the same primitive appears.
- Task 124, runtime role default privileges: decided, with a discovery test; catalogue revocations are
  deferred until a trace shows no runtime writer.
- Hosting: stay on Vercel Hobby plus the Supabase pooler until the third live client or the first
  client with a paid SLA, whichever is first; then move to Vercel Pro before it.

## Recently removed

(Newest first. One line each: date, item, commit. Keep the last 10.)

- 2026-10-15: shell navigation headings and icons, row-level table links, status pills, light-mode
  contrast, plain sign-in, one scrolling chip row (`d71e537b`, `6feff843`, `99672b3e`, `682d6a44`,
  `67bfd97f`).
