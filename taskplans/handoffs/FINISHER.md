# Finisher: the priority-ordered list of everything left to finish

**Last updated: 2026-10-22** (against `main` at `5a6ba739`; Task 129 block P0b added, old P0-1 removed)

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

(Task 129, `taskplans/129_architecture_honesty_demo_readiness_and_dsew_onprem.md`, is the active plan for the P0 gate, DSEW
on-premises Mode B, demo-readiness and low-end devices. Its items are mirrored below as they start.)

### P0-2. A push can reach production before its migration

- **What:** Production deployed `490ed4f1` (2026-10-20 11:24) carrying `TenantMembership.disabledAt`
  (ADR-049) while the production database did not have `20261019100000_membership_disable` or
  `20261019120000_capability_document`. Every Prisma read of a whole membership row failed with a missing
  column: role changes, HQ entering a client, the notification dispatcher, outreach team pages, the
  self-order guest page. Found and fixed 2026-10-20 by applying the pending migrations (see "Recently
  removed"); the cause is still open.
- **Why:** `npm run build` runs `prisma generate` only, and Vercel deploys every push to `main`. Nothing
  stops a commit whose migration is missing from production from going live; the process rule ("apply
  the migration before the push") depends on every session remembering it.
- **How:** Decided 2026-10-22 (Task 129 D4): a build-time assertion, not auto-migrate. `scripts/assert-migrations-applied.mjs`
  runs in `npm run build`; on `VERCEL_ENV=production` it asks `verity.applied_migration_names()` (migration
  `20261022200000_applied_migrations_gate`) and fails the build when this commit carries a migration production lacks, so the
  previous deployment stays live. `VERITY_SKIP_MIGRATION_GATE=1` is the loud emergency bypass.
- **Done when:** a push whose migration is not on production cannot become the production deployment, proven once on a branch.
- **Next step (needs the product owner):** apply `20261022200000_applied_migrations_gate` to production (`prisma migrate
  deploy` with `DIRECT_URL`) BEFORE the first push that carries the gate, together with any other pending migration
  (`20261021200000_inventory_style_master`, `20261021300000_capability_piecework`, `20261022100000_piecework_bundles_quality`
  if still pending). Then push a throwaway branch to a preview, then to `main`, and record the build log line `[migration-gate] ok`.
- **Source:** this session's finding, 2026-10-20.
- **Status:** BUILT and PROVEN locally 2026-10-22 (`src/test/migration-gate.test.ts`, 10 tests); NOT proven on production.

---

## P0b: Task 129, DSEW on-premises (Mode B) and demo-readiness (set 2026-10-22, owner: "high priority")

Plan and decisions: `taskplans/129_architecture_honesty_demo_readiness_and_dsew_onprem.md`. Source of truth for what is
BUILT, REHEARSED and NOT TESTED is that file's tables; this block lists only what is left.

### P0b-1. DSEW on-premises validation on the target host (Task 129 B7)

- **What:** Mode B is built and was rehearsed end to end (sign-in over PKCE through the TLS proxy, browser upload, user
  provisioning, a destroy-and-restore of the whole recovery set, and no-egress by network design) on a throwaway Linux stack. It
  has not run on anything matching DSEW's hardware. Windows Server 2019 compatibility is UNKNOWN.
- **Why:** ADR-031: a result is stated for the mode and host it was measured on. Installing at DSEW is NO-GO until the survey is
  answered.
- **How:** (1) Get the server survey answered (`clients/dsew/onprem-stage2-design.md` section 6). (2) Provision a Linux VM or
  machine to match; follow `deploy/runbooks/dsew-operations.md` section 9 with someone other than the author. (3) Sign in and
  upload from a real phone with the CA installed (Android and iPhone). (4) Time the restore. (5) Record numbers in the DSEW phase plan.
- **Done when:** runbook section 9 passes on the target and the dated record is committed; only then say "validated on Mode B for D&S".
- **Status:** BLOCKED on a person (DSEW server survey; a Linux VM or machine for DSEW).

### P0b-2. Disabling a person's Verity access has no screen

- **What:** `disableMembership` / `restoreMembership` (ADR-049) are tested commands that nothing in `src/app` calls.
  Offboarding on Mode B needs two steps (disable in Keycloak, disable in Verity); the second can only be run by an engineer today.
- **How:** An HQ/People action on a member row with a required reason, using the existing command and the shared Modal/FormModal
  (forms open as sheets). ADR-049 is still PROPOSED: get it accepted first.
- **Done when:** an administrator disables and restores a member from the People screen; an existing session ends at its next
  request, proven by the existing `membership-disable` test plus one browser check.
- **Status:** NOT STARTED

### P0b-3. Apply the migration gate to production (Task 129 A2 / old P0-2)

- **What:** `scripts/assert-migrations-applied.mjs` is in `npm run build`. It only protects production once
  `20261022200000_applied_migrations_gate` exists there.
- **How:** with the product owner's go: `prisma migrate deploy` with `DIRECT_URL` (also applies any other pending migration),
  then push a preview, then `main`, and record `[migration-gate] ok` from the build log.
- **Status:** WAITING for the product owner's go (touches production).

### P0b-4. Demo readiness: walk the real tenants (Task 129 workstream C), and measure low-end devices (D2)

- **What:** The Demo Readiness Matrix (`docs/demo/readiness-matrix.md`), the route-walk harness (`npm run demo:walk`) and lite
  effects (Appearance: Automatic, Full glass, Lite) are built. **No demo tenant has been walked**, so nothing is DEMO-READY. Low-end
  performance is unmeasured (a headless scroll test cannot see GPU cost).
- **Why:** The owner sells by showing screens. A 404, a clipped card or a console error in front of a buyer is the failure this
  prevents. The frosted blur was also found not to render in Chrome/Edge/Firefox (fixed; see the matrix).
- **How:** For each tenant in the matrix: seed on a local database, save a session, run `npm run demo:walk`, fix defects in shared
  primitives, commit evidence under `docs/demo/evidence/`, update the matrix row. Order: D & S Electric Works, Stylified, Colonel
  Kebabz, plywood, PlotArmour. Then take one throttled trace of a floor screen on a real Android phone, glass vs lite.
- **Done when:** each tenant's row has a dated walk with zero unlogged defects; D2 has numbers.
- **Status:** NOT STARTED for the tenant walks; harness and lite mode DONE (`81ad10db`, this commit).

### P0b-5. Accounting posting and the deployment-mode ADR (Task 129 workstream E)

- **What:** ADR-044 (ledger posting) still PROPOSED; no ADR yet records "hosted default, DSEW Mode B, Modes C and D parked".
- **Status:** NOT STARTED. ADR-044 acceptance needs the product owner.

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

**P1-1i. Engagement Phase 1 design gate: revision-controlled BOM first (set 2026-10-18).**
- **What:** The DSEW engagement's Phase 1 (not the demo phases above): revision-controlled BOM, controlled
  documents, structured test records, fail-closed release gates. **Approved:** the audit and design as the
  basis for planning; D1, D5, D6 in principle (`clients/dsew/decisions.md`). **Not approved:** starting M1.
- **Written (no code, no schema):** `clients/dsew/gap-matrix.md` (evidence-backed, legend Found / Reviewed /
  Test-verified / Client-validated), `decisions.md`, `phase1-design.md`, ADR-047 (BOM revisions, immutability,
  fail-closed gates) and ADR-048 (controlled documents), both PROPOSED.
- **Closed preflight:** BOM write paths (three, all in `bom.ts`); stock movements append-only by trigger
  (balance projection and TRUNCATE caveats); M1 backfill dry-run on a disposable copy, clean, rerunnable,
  rolls back. **Open:** fail-closed QC gate is designed, not built; the full test suite was not run (70 of 71
  focused tests passed; the one failure was a stale assertion, fixed in `7dac9538`).
- **How to resume:** only when (1) ADR-047 and ADR-048 are accepted, (2) `phase1-design.md` section 12 is fully
  ticked, (3) the client answers in "Blocked on a person" are in writing. Then M1: migration, tests (including
  direct-SQL immutability and cross-tenant), rollback note and operator guide in the same delivery; M2, M3, M4
  follow. Repeat the backfill dry-run on a fresh copy of the DSEW demo tenant before M1 merges.
- **Scope flag:** the `CLAUDE.md` scope note authorises business-capability build only for Tasks 118, 119 and
  120. M1 extends manufacturing (Task 118). M2 (`verity.capability.document`) and M3 (test records) are new
  business capabilities; the product owner must confirm scope before they are coded.
- **Done when:** M1 to M4 are built and proven, and the engagement acceptance walk in
  `phase1-design.md` section 6 passes on a DSEW-shaped job.
- **2026-10-18 second review:** ADR-047 and ADR-048 directions accepted with amendments (in the ADR text), both
  still PROPOSED. M1 authorised only after the gate (incl. rehearsal on a DSEW demo-tenant copy). M2 and M3
  design only; build needs a recorded scope amendment (proposed `CLAUDE.md` wording in `clients/dsew/decisions.md`).
  Full regression suite still to run after the final migration; "70 of 71 focused" is not a green suite.
- **Status:** BLOCKED (waiting on ADR acceptance and client decisions); nothing coded.

### P1-1b. DSEW call follow-ups (2026-10-19): built locally, not on production, not client-validated

Source: `clients/dsew/decisions.md` ("Scope amendment" and "Client call findings") and `clients/dsew/demo-guide.md` section 6.
- **Built, committed, tested, and opened in a browser against a local database and a local object store:** phone-camera
  evidence capture, measured checks with fixed units and ranges, the summary-first test report, the job project file,
  sign-in returning to the page asked for, and the controlled-documents capability (ADR-048) with register and detail screens.
- **Needs the product owner before any of it reaches production:** apply `20261019120000_capability_document` (additive, six
  tables, forced RLS); accept or amend ADR-048 (still PROPOSED); decide self-approval and release authority with DSEW.
  Reseed the production demo tenant for the new test stage (`seed:dsew`, then `seed-dsew-hero`, then
  `seed-dsew-documents`). **Run the seeds with an explicit local `DATABASE_URL`; the `*-hero` npm scripts load `.env`, which is production.**
- **Not built:** Hindi on the shop floor; a checklist builder the client uses himself (route checklists are typed text lines);
  a two-way client portal (needs its own ADR); attendance; Tally; document transmittals, OCR and drawing viewer (ADR-048 defers them);
  a linked-documents panel on job, order and BOM screens (`verity.document.for_entity`) and a retire control for document types
  (`verity.document.set_type_active`) — both listed in `ui-reachability.baseline.json` until wired.
- **Not verified:** the camera on a real phone, HEIC photos, printing to paper, and anything on DSEW's Windows Server 2019.
- **Known baseline failures untouched:** three conformance tests (project and manufacturing imports not declared, platform module count).
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
- **Status:** IN PROGRESS. ADR-046 accepted; Phases 1 to 3 built and browser-checked on DSEW (tokens, shared components, 86 glyphs, shop floor, route detail, order, jobs, summary). Reachability baseline and pure-suite registration of `viz-geometry.test.ts` fixed. Manufacturing DB tests still unrun (no test database). Phase 4 restaurant started 2026-10-20: `/floor`, `/kitchen`, `/counter`, `/floor/[orderId]` and `/counter/history` rebuilt (plus `/today`'s table stages), `tsc`/eslint/detector clean, **not browser-checked** (sign-in is organization login, manual: someone must sign in once on the Opera agent browser, tab on `localhost:3000`) pushed to production 2026-10-21 (`73d76534`), CI `verify` green including the full database suite (the local test DB is still broken, so CI is the only place it runs). Next: browser-check those five, then the rest of §4.2 in order (kitchen setup/ticket, menu, recipes, `/counter/[billId]`, guests...), then 5 to 9; redraw four look-alike glyphs; owner signs off hue values from `docs/reference/visual-language/swatches.html`.

### P2-9b. CRM capability modelled on Twenty (Task 128), DSEW first

- **What:** A generic B2B CRM inside Verity: companies, people, opportunity pipeline, notes, interactions, follow-ups with reminders, record timeline; then Twenty-style record table, Kanban board, saved views, Cmd-K and CSV import; later custom fields, automations, email/calendar sync.
- **Why:** Product-owner request, 2026-10-20; DSEW gap matrix row "A CRM" (contacts per customer, RFQ/tender tracker, meeting log, reminders missing).
- **How:** `taskplans/128_crm_capability_twenty_reference.md`. ADR-050 (companies and people are tenant-owned rows, NOT Party: party is global) and ADR-051 (record objects and saved views, `views.ts`).
- **Done when:** the owner accepts ADR-050/051 and both migrations (`20261020100000_capability_relationship`, `20261021100000_relationship_stage3_4`) are applied where the client runs; stage 5 only if ADR-052 is accepted and a client wants it.
- **Stages 3-4 BUILT 2026-10-21** (`0d2cac89`, `237500af`), local only: custom fields, duplicates and merge, stage playbooks, `/crm/insights`, "won -> open a job" in `project`. 25 CRM DB tests pass; browser-walked on the DSEW demo. **Stage 5 NOT BUILT:** ADR-052 (email/calendar sync, PROPOSED) adds stored third-party tokens and waits for the owner.
- **Source:** Task 128.
- **Status:** STAGES 0-2 BUILT 2026-10-20 (`cd73c249`, `052ea283`, `cb87ec0d`, `b285fa3c`), local database only. 20 DB tests pass; browser-walked on the DSEW demo at 1440 and 390 px, light and dark: inline edit, filter, drag to Lost with reason, timeline note. Demo data: `prisma/seed-dsew-crm.ts` (run with local `DATABASE_URL`/`DIRECT_URL`, never `.env`). **Next:** owner accepts ADR-050/051; stage 3 custom fields (DSEW tender fields); "won -> open a job" in `project`; stage 5 needs its own ADR. No Twenty code may be copied (AGPL).
- **Local database note (2026-10-20):** the old local test database `verity` on 127.0.0.1:55432 was wiped by a mistaken `prisma migrate diff` shadow run and is broken; `verity_crm` in the same container is fully migrated and seeded. Point `.env.test` at `verity_crm`, or reset `verity` (`npx prisma migrate reset --force --skip-seed` with the local URLs) and reseed.

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

### P2-11. Worker experience: assignment, evidence and offline (phone and tablet)

- **What:** DSEW now has Floor worker and Supervisor roles (grants only, `prisma/seed-dsew-roles.ts`) and phone work cards on the Shop floor. Still missing: (1) a worker sees every open stage, not only theirs, because permissions have no `own` scope and stages have no assignee (own scope needs an ADR, see CLAUDE.md "Open"); (2) photo evidence capture from the phone camera inside the checklist; (3) offline tolerance for a workshop with weak signal; (4) a tablet layout check.
- **Why:** Workers use phones and tablets; the office uses PCs.
- **How:** Decide assignment first (ADR for `own` scope or a stage assignee field), then build the checklist camera capture.
- **Status:** NOT STARTED

### P2-12. Verity for Manufacturing film: finishing items after the first master

- **What:** The film in `video/` (4:27, 1080p60, branch `dsew`, includes the Task 128 CRM pipeline) is rendered and audited with a scratch
  voice. Left: a professional voice-over, a person's playback review of sound and pacing, the 4K
  render, and the short and vertical cuts.
- **Why:** The scratch narration is synthetic (Kokoro, offline) and nobody has listened to the mix at
  normal speed; checks so far are automated (word error rate 0 on every cue, loudness, format) and on
  stills.
- **How:** Record the 26 lines of `video/content/narration.json` and follow `video/docs/sound-design.md`
  "Replacing the scratch narration"; render with `npm run render:master` then `master-audio.mjs`;
  4K with `--scale=2`; cuts as new compositions reusing the scenes.
- **Done when:** a person signs off playback in `video/docs/qa-report.md`, and the voiced master passes
  `node scripts/validate.mjs`.
- **Source:** product-owner brief, 2026-10-21 (session on branch `dsew`).
- **Status:** IN PROGRESS. 2026-10-21: the final master (4:27, 17 scenes, includes the Task 128 CRM
  pipeline scene `s12p`) is rendered, loudness-mastered and passes `scripts/validate.mjs` (24/24:
  1920×1080, 60 fps, -16.04 LUFS, -1.46 dBTP); one frame per scene checked from the encode; results in
  `video/docs/qa-report.md`. The file is at `video/out/verity-manufacturing-1080p60.mp4` on the build
  machine only (git-ignored, too large for git). Branch `dsew`, not yet merged to `main`.
- **Still open:** (1) a person watches and listens to the whole film and signs off in the QA report;
  (2) professional voice-over; (3) 4K and short or vertical cuts; (4) merge `dsew` into `main`, and
  re-render after any change with `cd video && npm run audio && npm run render:master`, then
  `node scripts/master-audio.mjs <master> <final>` and `node scripts/validate.mjs <final>` (about 35
  min on a 6-core laptop; set `TEMP`/`TMP` to a drive with space if C: is full).
- **Gotcha:** stopping a background render must also kill `remotion`, `ffmpeg.exe` and
  `chrome-headless-shell.exe` under `video/node_modules`; stopping only the shell leaves them running and
  a second render then crashes ffmpeg.
- **Status:** IN PROGRESS, paused 2026-10-21 by the product owner. Branch `dsew` (not merged to `main`;
  `origin/main` at `2087a34a` is already merged into it).
- **Where it stopped (resume here):**
  1. A first master (4:09, before the CRM scene) rendered and passed `scripts/validate.mjs` (24/24:
     1920×1080, 60 fps, -16.04 LUFS, -1.49 dBTP), then two defects were fixed (s11 statement under the
     window; s11 values cropped). That file is superseded and was deleted.
  2. The owner asked for the Task 128 CRM in the film: scene `s12p` "Pipeline" added
     (`video/src/scenes/S12Pipeline.tsx`, cue v26, WER 0.02). Runtime is now 4:27 (266.57 s), 17 scenes.
     Stills checked; music and ambience regenerated for the new timeline.
  3. **The final master is NOT rendered.** One render failed (ffmpeg `0xC0000142`) because an earlier
     stopped render left its ffmpeg and Chrome running; the clean re-render was paused. Next:
     `cd video && npm run audio` (beds are git-ignored), `npm run render:master` (about 27 min; set
     `TEMP`/`TMP` to a drive with space if C: is full), then
     `node scripts/master-audio.mjs out/verity-manufacturing-master-1080p60.mp4 out/verity-manufacturing-1080p60.mp4`,
     `node scripts/validate.mjs out/verity-manufacturing-1080p60.mp4`, check frames from the encode, write
     `video/docs/qa-report.md` (not written yet), then merge `dsew` into `main`.
  4. Stopping a background render must also kill `remotion`, `ffmpeg.exe` and `chrome-headless-shell.exe`
     under `video/node_modules`; stopping only the shell leaves them running.

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

- **Choose how deploys wait for migrations** (P0-2): (a) CI status check, (b) migrate in the build, or
  (c) pre-push hook. Product owner.
- **Outlet codes** for the three Colonel Kebabz outlets, and **who confirms the ADR-040 tax points**
  with the client's adviser (Task 126). Product owner.
- **Turn self-order on per outlet** only after a phone walk of the guest page and a printed sticker
  (Task 126). Product owner with the client.
- **Approve ADR-044 (documents post to the ledger)** before accounting posting is built (P1-1h), and
  **a session with the D&S owner** to confirm manager.io's tab list and Summary tiles (P1-1b).
  Product owner.
- **Offer client-owned cloud accounts or not** (P2-0): price, pilot client, whether a named operator login
  inside each client's instance is an acceptable support model. Product owner.
- **API key and migration for Task 119** (P1-3). Product owner.
- **Per-tenant data volumes and a disposable database** for the load test (P3-1). Product owner.
- **Name the manufacturing design partner** (P2-8): is D & S Electric Works it? Product owner.
- **Relay's contract** for the Task 120 adapter (Verity side is built and dark by default). External.
- **D & S Phase 1 gate (P1-1i).** Product owner: accept or amend ADR-047 and ADR-048, and confirm scope for the
  document and test-record capabilities. Client (via the client-facing PM, in writing): document numbering
  convention and who owns it; who drafts, reviews, approves and releases drawings, BOMs and test records;
  whether self-approval is allowed; traceability depth (lot/heat, serials, genealogy); server specification,
  VM or runtime options, backup target, recovery expectations and access; anonymised samples (drawing, released
  BOM, QAP, ITP, FAT report, test certificate, traveler, dispatch pack). Do not invent these.
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

- 2026-10-22: old P0-1, readiness flapping on `scheduler_stale`. Already fixed by `ef929e27`: a stale scheduler now
  reports `degraded` with HTTP 200 (core checks only return 503), proven by `readiness-degraded` and
  `readiness-scheduler-grace`. The 15-minute limit was kept by the 2026-10-19 decision; this entry had not caught up.

- 2026-10-20: old P0-2, Task 126 on production. Its migrations `20261009100000` to `20261009140000` were
  already applied and its code pushed; the register had not been updated. The same day
  `20261019100000_membership_disable`, `20261019120000_capability_document` and
  `20261020100000_capability_relationship` were applied to production (`migrate status` up to date) to
  repair the live `disabled_at` failure (new P0-2). The third belongs to CRM commits not yet pushed when
  it was applied; it adds tables, the CRM capability row and saved-view grants only, which the deployed
  code ignores.

- 2026-10-15: shell navigation headings and icons, row-level table links, status pills, light-mode
  contrast, plain sign-in, one scrolling chip row (`d71e537b`, `6feff843`, `99672b3e`, `682d6a44`,
  `67bfd97f`).
