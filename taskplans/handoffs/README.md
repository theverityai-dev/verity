# Handoffs — what's in flight, right now, in order

**This file is the entry point.** Anyone opening this repo who wants to know
"what's actively being worked on and in what order" should read this file
first — not `00_STATUS_INDEX.md` (that's the full historical register of
every taskplan ever written, Done and Pending both) and not any single
taskplan (each one only knows its own scope). This file is kept current
every time active work state changes — a new item starts, an item finishes,
or the order changes. If it looks stale (no update in the "Last updated"
line below matching recent commits), regenerate it from `git log` and the
taskplans it points to before trusting it, same rule `00_STATUS_INDEX.md`
already states for itself.

**Last updated: 2026-10-09 (Task 126 URY gap closure proposed with ADR-040 to ADR-043; Task 125 progress log added: section 2 decisions done, desktop walk of Colonel Kebabz done, phone-width pass waiting on a signed-in session; earlier sections last refreshed 2026-09-30 against `taskplans/122_...`)**

## How to use this folder

- Each file here is a **file-level, concrete continuation checklist** for
  one active thread of work — exact paths, function names, what's already
  built vs. still needed, discovered nuances that would otherwise be
  re-derived from scratch. It answers "where exactly," not "why" — the
  "why" lives in the taskplan it's paired with (cited at the top of each
  handoff file).
- A handoff file is **not** a taskplan. It doesn't invent scope, doesn't get
  a taskplan number, and doesn't replace the taskplan it's paired with —
  it's a working note that stays in sync with that taskplan's own status
  markers (DONE/PENDING per item) as code actually lands.
- When a thread finishes entirely, its handoff file moves to
  `taskplans/handoffs/done/` (create that subfolder when the first one
  finishes) rather than being deleted — same "don't destroy history"
  posture as the rest of `taskplans/`.

## Closed this session (moved out of "Active work" — see Closed loops)

- **Verity Experience System v2 — ADR-024 rollout** — CLOSED 2026-09-18.
  backdrop-filter bug root-caused and fixed (commit `7d3276c`; Lightning
  CSS dropped the standard property whenever a hand-authored `-webkit-`
  sibling sat in the same rule — removed the now-redundant prefix). Motion
  wired into real transitions (`727b8b4`): CommandPalette/OverflowMenu/
  Combobox via framer-motion, Modal via CSS `@starting-style` (native
  `<dialog>`, deliberately not framer-motion — see that commit). Typography
  pass done (H1 now matches the board's 32/40, size-specific tracking).
  Gold board copied into `design/verity-aesthetics-v2-gold.png` (`7693a7e`).
  Per-capability accent-fill sweep done, one more violation found and
  fixed (`f696e48`, Outreach contacts empty-state).
- **Task 115 — Apple design system governing docs overhaul** — CLOSED
  2026-09-18. All six ADR-025 patterns built; four wired into live pages,
  two stay orphan primitives with a stated real reason each (`SplitButton`:
  no page has its precondition; `TrendChart`: no backend query returns the
  time series it needs). Spec REQ-IDs added (`verity-spec/09_experience/
  design-system.md` §2, REQ-004..009). `verity-design-companion` skill
  resynced. See `taskplans/115_apple_design_system_governing_docs_
  overhaul.md`'s own Status section for the full account.

## Since 2026-10-09 (URY comparison, added 2026-10-09)

- **Task 126 — URY gap closure: PROPOSED, awaiting approval.** `taskplans/126_ury_gap_closure_restaurant_
  operations.md` maps 41 gaps between URY and Verity and sequences six waves. Waves 0 (two defects) and 1
  (sales reports, "today" dashboard, small floor items) need no ADR and can start on the product owner's
  word. Waves 2 to 5 wait on **ADR-040** (GST bill: dine-in bills have no consecutive invoice number today),
  **ADR-041** (kitchen stations, courses, tickets, printing), **ADR-043** (outlet and channel prices) and
  **ADR-042** (customer self-order, a new public write surface), all PROPOSED in
  `verity-spec/17_decisions/adr/`. Comparison: `docs/reference/ury-parity/ury-vs-verity-a-to-z.md`.
- **Needs the product owner:** approve or amend the four ADRs; give outlet codes for the three Colonel
  Kebabz outlets; name who confirms the tax points in ADR-040 with the client's adviser.

## Since 2026-10-06 (added 2026-10-09)

- **Task 125 progress log** (in `taskplans/125_pending_work_register_2026_10_06.md`) is the account of
  what landed. Built, DB-proven, not yet browser-verified: roster week grid and leave calendar (6.1,
  6.2), labour line in the outlet P&L (4.4), cash in and out (4.1), platform payout matching (4.2),
  menu add-ons (3.1) and price history (3.4), guest edit, saved segments and one-tap points redeem
  (5.1 to 5.3).
- **Four migrations are written and applied to the local test database only; apply them to production
  before the next push:** `20261009010000_crm_customer_segment`, `20261009020000_finance_cash_movement`,
  `20261009030000_dinein_menu_modifiers`, `20261009031000_dinein_order_line_modifier_rows`.
- **Decided 2026-10-09:** ADR-036 to ADR-039 ACCEPTED (failed-command metadata, client-owned export,
  announcements, notification outbox: build authorised, not built); ADR-031 ACCEPTED (Mode A); Task 124
  decided with a discovery test; hosting trigger and `enterprise-demo-prd` decided (register 7.10, 7.11).
- **Still needs a person:** sign in once on the Opera agent browser for the 390px pass, approve the
  production migrations and push, confirm deleting the stale worktree and stash.

## Since 2026-10-04 (added 2026-10-06)

- **Task 125 is the live work order.** Everything still open — verification of built screens, menu,
  money, guests, staff leftovers, HQ and platform items, coverage, client parity docs, housekeeping —
  is one list in `taskplans/125_pending_work_register_2026_10_06.md`, in the order to do it.
- Shipped since the last update: HQ client lifecycle, health and support sessions (ADR-034); Verity
  operator holds full authority inside an entered client (ADR-035); Colonel Kebabz procurement, stock
  count and transfer, stock requests, food-cost variance, vendor payments; dine-in move/merge table,
  history, split and item refunds; staff profile, salary permission, lateness and payroll summary;
  order-pad line quantities and the shared `QuantityStepper`.

## Since 2026-09-30 (added 2026-10-04)

- **Repository cleanup — IN PROGRESS, branch `chore/repo-cleanup`.** Phase 0 baseline in
  `docs/audits/2026-10-04-repo-cleanup-baseline.md`. Done: lint errors fixed, generated output
  untracked, `CONTRIBUTING.md`, repo-wide LF rule, and 68 closed taskplans moved to
  `taskplans/archive/` (see its README). Remaining: regenerate `00_STATUS_INDEX.md` evidence,
  dead-code pass, boundary lint rules, CI gates.
- **Deployment hardening (2026-10-01/02), Mode A.** Bundled SeaweedFS replaces the withdrawn MinIO
  image (fresh install verified); `install` ensures the object-store bucket; **ADR-032** — the public
  origin is configured as `VERITY_PUBLIC_URL`, never derived from the request (ACCEPTED); runtime
  role is read-only on `deployment_state`; CRLF-safe `env_value`, `deploy/` pinned to LF.
- **Task 123 — scaffolding only, no measurement taken.** k6 harness is at methodology v2; the
  client-tenant provisioning seed and OIDC login helper exist. **ADR-031** (Mode A first) is still
  PROPOSED. **Task 124** (runtime role default privileges) is a PROPOSED design question.
- **Task 118 — dispatch, batch consolidation and stock reservation BUILT 2026-10-01.**
- **`enterprise-demo-prd/` (AstraGrid, fictional demo client) is committed but not authorized for
  build.** It overlaps CRM, procurement and field service, which `CLAUDE.md` lists as out of scope; the
  2026-09-30 scope decision covers only Tasks 118–120. Needs a fresh product-owner decision.
- **Known baseline defect:** `deploy-public-url-preflight.test.ts` times out at 5 s on Windows (one
  test); cause unconfirmed.

## Since 2026-09-18 (this file had not been updated; regenerated 2026-09-30)

Sources of truth for everything below: `taskplans/122_pending_taskplans_
phase_wise_completion_plan.md` (phase order) and `00_STATUS_INDEX.md`.

- **Task 116 — Apple-quality visual UX program: IN PROGRESS.** Senior
  (§8.2), Junior (§8.3), member detail (§8.4) and Intelligence drill-through
  (§8.6) live-verified 2026-09-30 with approved test accounts; two real
  defects fixed. Remaining: durable Phase 0 screenshots and the rest of the
  route-family x role x theme x viewport matrix; Junior progress track and
  timeline unproven with data.
- **Liquid-glass refraction — DONE 2026-09-30, ADR-028.** `src/components/
  ui/LiquidGlass.tsx`, mounted in the root layout, upgrades the existing four
  glass classes in Chromium; blur fallback elsewhere; honours reduced
  transparency. Popover clipping and see-through fixed in `globals.css`.
  Verified dark/light, desktop/mobile, overlays, reduced-transparency
  (stubbed), Safari UA (simulated). Not verified: a real `Modal` consumer, a
  real Safari/Firefox.
- **Task 121/122 Phase 4 — DONE 2026-09-24, 18 of 28 bare tables migrated.**
  The other 10 are documented structural exceptions, not debt.
- **Task 121 §3.2/§3.3 — DONE 2026-09-24** (REQ drafting; `obvious-basics-
  checklist` wired into review). Task 122 Phase 2 ratified REQ-017/018/019/
  022/023/024.
- **Product-owner scope decision 2026-09-30** (in `CLAUDE.md`): business-
  capability build authorized for Tasks 118, 119, 120. Stop conditions unchanged.
- **Task 118 — BUILT 2026-09-30, design partner Carxen (car seat covers).**
  Order UI, a reusable per-unit BOM, and **stage-wise production** (routes as
  tenant data, per-order operations with sequencing, hold/resume, QC send-back
  that appends, operator floor page) and a **digital QC checklist** (snapshotted
  per order, append-only findings, evidence that must belong to the operation,
  completion = QC approval) and the **public verification passport** (ADR-030
  accepted; frozen minimal snapshot behind a hashed token, one definer function
  for the anonymous read), **dispatch** (append-only delivery trail, packaging
  photo must be evidence about that order) and **batch consolidation + stock
  reservation** (holds not movements, all-or-nothing, location-locked; start
  respects other orders' holds); 47 DB tests pass (plus the passport live-server
  test, which only runs with `VERITY_BASE_URL`); migrations applied. Not
  clicked through with data. Next, from VEDA's quotation: lot/batch tracking and
  a shared photo-upload component. See taskplan 118 §10.
- **Task 119 — BUILT 2026-09-30, unit-proven, NOT live-verified.** Node type
  `verity.decision.ask` (`decision.ts`), 9 tests. Needs: apply migration
  `20260930000000_capability_decision_egress`, a real API key, one real call.
- **Task 120 — Verity side BUILT 2026-09-30, dark by default.** ADR-029
  ACCEPTED; key store, idempotency, `POST /api/tools/invoke` proven against the
  real DB (21 tests). Set `EXTERNAL_TOOLS_ENABLED=1` to turn on. Relay adapter
  waits on Relay's contract. Both new migrations are applied to the shared DB.
- **Task 123 — Enterprise readiness evidence program, started 2026-10-01.**
  Phase 1 seeder (`prisma/seed-scale.ts`, `npm run seed:scale`) and Phase 3 k6
  harness (`scripts/load/`) scaffolded; no defaults, nothing run, no claim.
  **Re-scoped 2026-10-01 to Verity's own market** (multi-tenant, ~10 tenants of
  10 to 100 users; `docs/enterprise-readiness/msme-reference-workload.md`); the
  BRPL 58.4M-visit model is deferred. ADR-031 (Mode A first) PROPOSED, awaiting
  your acceptance. Next: fix the MSME per-tenant data volumes (yours), generalise
  the seeder to uneven tenants, run on a disposable DB, index audit, load and
  noisy-neighbour run. See `taskplans/123_enterprise_readiness_evidence_program.md`.
- **Still blocked on you:** review ADR-029; apply the Task 119 migration and
  supply a key; Task 114 P2 scoping; a named manufacturing design partner.

## Active work, in order

### 1. Task 115 extension — Apple/Odoo operational interaction grammar

The governing spec now defines consistent page, record, list, form, selection,
commit, and state behaviour. Continue future UI work through shared primitives;
do not introduce page-local entries, selects, table controls, or status patterns
without first checking `verity-spec/09_experience/design-system.md` §3 and its
forms/tables companions. Apple craft now includes the approved layered-glass rollout
(ADR-026): hierarchy, spacing, motion restraint, atmospheric depth, purposeful color
fields and direct, trustworthy controls. Dense content may remain solid for legibility;
rows and status indicators stay quiet.

### 2. Operational launch verification — Outreach manual system of record

**Run 2026-09-18, as Core (`divyom.sharma`) against the real PlotArmour
Studio tenant.** Confirmed working live, start to finish: sign-in, create
prospect (2-step form), log activity with a next action, create task,
schedule meeting, team → member drill-through (record correctly appeared
under Kulsoom's owned-prospect list with the logged next action), cancel
task, cancel meeting, disqualify the lead, sign-out. All test records
closed out (`ZZZ Smoke Test Co (delete me)` → `disqualified`, its task
and meeting → `Cancelled`); the activity log entry stays by design (the
audit trail, labeled as a smoke test in its own text — never hard-deleted,
matching this file's sibling discipline in
`taskplans/handoffs/apple-platform-p0-p1-completion.md`).

**Not run: sign-in/scope as Junior or Senior** — those accounts'
passwords were printed once to the console at seed time
(`prisma/seed-pa-oms.ts`'s own documented behavior) and were never
captured anywhere retrievable; needs the product owner's own credentials,
not something an agent session can complete.

**Found and fixed while running this pass, two real bugs, not cosmetic:**
- Neither `TaskPanel.tsx` nor `MeetingPanel.tsx` ever wired a "Cancel"
  action to the `"Cancelled"` status both commands already fully
  supported (`verity.outreach.set_task_status`,
  `verity.outreach.update_meeting_outcome`) and both panels already
  correctly rendered. Fixed and live-verified (used to close out this
  same pass's own test records).
- **Every PA-OMS sign-in landed on "You do not have access to this".**
  Root cause: `/` (the platform's generic Overview) requires `Read` on
  `verity.platform.overview`, which no PA-OMS role was ever granted, and
  its own "Go to dashboard" button pointed back at `/` — a dead loop.
  Fixed with `outreachLandingRouteFor` (mirrors plywood's own
  `landingRouteFor` pattern) — signed-in Core now lands on `/outreach`.
  Live-verified.
- **Fixed 2026-09-19:** the shared `OverflowMenu` now closes when an item is
  selected and renders above the following inline confirmation forms. This
  removes the layering bug that previously made the `disqualified` reason
  picker require an Escape workaround. Targeted ESLint and TypeScript checks
  pass; the production build also passes. The full Vitest run remains blocked
  by the pre-existing no-database/configuration and conformance-drift failures
  recorded in the session evidence.

### 3. Task 114 — Outreach execution-layer UX redesign — launch scope CLOSED

Handoff: [`outreach-p0-continuation.md`](./outreach-p0-continuation.md)
Taskplan: `taskplans/114_pa_oms_outreach_execution_layer_redesign.md`

Status: P0, P1, and **all of P1.5 (items 1-9)** DONE. Items 6 and 9 are
partial by design — see the taskplan's own per-item notes for exactly
what each stops short of and why (both need product-owner-level business
decisions the review never specified). Item 5 (card verbosity) is now
also DONE — trimmed to one qualification field + 3 footer items instead
of four/five. Automation, enrichment, and third-party cadence execution are
intentionally deferred by the product owner; do not treat them as a launch
blocker.

### 4. Task 90 — Attention platform concept (watching, not active)

Not active work — a trigger watch. `taskplans/90_attention_platform_
concept.md`'s 2026-09-17 note records that Task 114's Outreach work queue
(P0.1) is a capability-local build, not the platform-primitive trigger
firing (still one real instance, not two independently-arrived-at ones).
Listed here so nobody re-derives this question mid-P0.1.

## Closed loops (no longer active, recorded so they aren't re-opened)

- **Task 113 — AI implementation audit** — CLOSED (already, per the
  taskplan's own 2026-09-18 correction — this README just hadn't caught
  up). Item 3's "needs live-DB access this environment doesn't have" was
  itself stale: the taskplan's own text corrects it same-day —
  `DATABASE_URL`/`DIRECT_URL` reach the real Supabase project, live
  access was available, and the per-tenant check ran (5 tenants, 0
  `outreach_ai_insight` rows in any of them — the feature has never
  persisted an insight in production, confirmed not inferred). All 5
  scope items now addressed; see the taskplan's own "Findings" section
  for the full account, including Phase 8's rate-limit/model-compliance
  root cause and partial fix.
- **Apple platform UI/UX audit — P0/P1 completion** — CLOSED 2026-09-18.
  Every P0/P1 item DONE: P0-01/02/04 and P1-01/02/03/06/07 done earlier
  this session; P0-03 (signed-in visual proof), P1-04 (sidebar collapse),
  P1-05 (mobile bottom tab bar, product-owner decision 2026-09-18) closed
  this pass. Found and fixed one real regression surfaced by verifying
  P1-05 live: `AgentChatDock`'s floating button collided with the new
  mobile tab bar. P2 items and Liquid Glass remain explicitly deferred —
  out of this thread's scope, not unfinished work. See
  `taskplans/handoffs/done/apple-platform-p0-p1-completion.md` for the
  full per-item account and `docs/audits/2026-09-18-apple-platform-ui-ux-
  audit.md` for the original findings.
- **Task 111 → Task 112 — structured-minimalism material rollout** — DONE
  2026-09-17. `Surface`'s `solid` default flipped to `true` (ADR-023),
  every remaining `.glass-*` class and `bg-glass-N` token in `src/`
  migrated to `verity-solid`/`bg-surface-sunken` across ~40 files in 7
  commits (`fb7f3b9`..`3ad2b89`). Partially superseded by ADR-024's
  chrome/content split the next day — see `taskplans/112_complete_ui_ux_
  upgrade_to_structured_minimalism.md`'s own corrected Status section.
- **Task 97 Finding 1/6 + Task 100's metric-snapshot migration** — both
  were already done 2026-09-04 (commit `e92dbee`), just undocumented until
  2026-09-17. No handoff needed; corrected directly in
  `taskplans/97_deep_codebase_cleanup.md`, `taskplans/100_dashboard_
  intelligence_direction.md`, and `taskplans/00_STATUS_INDEX.md`.
- **Task 109 Phase G's Kanban board** — built 2026-09-17, removed the same
  day by a concurrent session (`ec31890`) in favor of `/outreach/
  prospects`. Not a regression to fix — see Task 109's own correction
  note. Do not rebuild it.

## When you finish something in a handoff file

1. Update the taskplan it's paired with (status markers, DONE + date +
   files touched) in the same commit as the code — not a separate pass.
2. Update the relevant section of *this* README (status line under
   "Active work, in order") in the same commit.
3. If the whole thread is done, move its handoff file to `./done/` and
   remove its "Active work" entry above, replacing it with a one-line
   pointer under "Closed loops."
