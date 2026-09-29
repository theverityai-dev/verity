# Task Plan 122 — Phase-Wise Plan for Completing All Pending Taskplans

**Authority:** User synthesis, 2026-09-24 — direct follow-up to Task 121
(priority order across active work + Tasks 118/119/120) and
`taskplans/handoffs/README.md` (live work order). Re-derives and extends
Task 121 §2's priority list into concrete phases, verified live against
`00_STATUS_INDEX.md`, `handoffs/README.md`, `eslint.config.mjs`, and
current `git status` as of 2026-09-24 — not re-typed from memory.

## Status: Phase 4 (bare-`<table>` migration) DONE 2026-09-24 — see below; other phases PROPOSED

This is a pointer and an ordering, the same posture as
`101_remaining_work_master_plan.md` and Task 121 §2. It creates no new
requirements and supersedes nothing; it sequences work already scoped in
the taskplans it cites. Re-derive if stale, per this repo's own
staleness rule for sequencing docs.

## Verified starting state (2026-09-24)

- Task 121 §3.1 (ESLint gate on bare `<table>`) is **already landed**,
  uncommitted: `eslint.config.mjs` has `no-restricted-syntax` forbidding
  `JSXOpeningElement[name.name='table']` under `src/app/**` and
  `src/components/**`.
- 28 files still hand-roll `<table>`, grandfathered two different ways —
  inconsistency found live, not assumed:
  - 20 files exempted via the rule's `ignores` array in
    `eslint.config.mjs`.
  - 8 files exempted via an inline `/* eslint-disable no-restricted-syntax
    -- Task 121 grandfathered debt */` comment instead: `FinanceDesk.tsx`,
    `counter/page.tsx`, `reports/page.tsx`, `PurchaseDesk.tsx`,
    `TransactionsDesk.tsx`, `PriceSheet.tsx`, `BillableOrders.tsx`,
    `finance/[invoiceId]/InvoiceView.tsx`.
- `git status` at session start showed all 28 files plus
  `eslint.config.mjs`, `verity-spec/09_experience/design-system.md`, and
  `.claude/skills/verity-design-companion/SKILL.md` as modified and
  uncommitted — Task 121's own work, mid-flight.

## Phase 0 — close the in-flight commit

Reconcile the two exemption mechanisms to one (prefer the config
`ignores` array — single source of truth, doesn't require every
grandfathered file to carry a comment). Then commit per this repo's
standing workflow (commit continuously, push once at the end).

**Non-goal:** do not migrate any of the 28 files in this phase — that is
Phase 4.

## Phase 1 — Task 115 extension (top active priority)

Per `handoffs/README.md` "Active work, in order" #1: every new form,
dropdown, table, record view, and state uses the Apple/Odoo operational
grammar in `verity-spec/09_experience/design-system.md` §3. No page-local
control systems. Ongoing discipline, not a checklist with an end state —
re-check before every new UI surface, not once.

## Phase 2 — Task 121 §3.2: draft REQ text for the uncovered categories [DONE 2026-09-24]

Drafted as REQ-EXPERIENCE-DESIGNSYSTEM-017/018/019/022/023/024
(`verity-spec/09_experience/design-system.md`), then ratified
`[DECIDED]` the same session (product-owner walkthrough, one decision
per REQ, not batch-approved). Found and fixed a real duplicate-ID bug
along the way — the file's ADR-026 glass-material items had reused
REQ-015/016, colliding with unrelated section-3 grammar items of the
same numbers; grep-verified nothing cited either by number, renumbered
the ADR-026 pair to 020/021.

Ratifying `[DECIDED]` records intent, not completion — three of the six
(REQ-018 ledger generalization, REQ-023 sequential numbering, REQ-024
notification-on-transition) name real, currently-unbuilt scope in their
own Status note; do not report any of those as satisfied without
checking the actual code first. REQ-017/022 were already true in
practice (`DataTable`'s `rowActions`/`bulkActions` props); REQ-019
(print/PDF path) was ratified without verifying `BillView.tsx`/
`InvoiceView.tsx` actually have one — check before citing it either way.

**Follow-up checked 2026-09-24 (same session):** REQ-023's named gap was
stale — `orderNumber()` in `orders.ts` already closes it (see the REQ's
own updated Status note). REQ-024 got its first real wiring: two
`notify()` calls in `trading/orders.ts` (`submitPurchaseOrder`,
`reserveForOrder`), via a new `notifyPermissionHolders()` helper —
closes trading's two clearest handoffs, not the whole platform surface.
REQ-018 (ledger generalization) is **not** done: no second capability
has a counterparty-balance concept to generalize *to* today (checked
`accounting`, `billing`, `crm` — none fit), so building a "shared
platform primitive" now would be a single-implementation abstraction
with no real second caller. Put to the product owner same session;
answer was defer/mark blocked, not build the seam speculatively — see
the REQ's own updated Status note.

## Phase 3 — Task 121 §3.3: wire `obvious-basics-checklist` into review [DONE 2026-09-24]

Wired into `verity-client-capability-builder`'s existing V1-completeness
gate as a required pass alongside the Odoo reference-module cross-check
— same enforcement posture already given to `verity-adr-gate` and
`verity-migration-safety`, not just a one-time audit. See that skill's
`SKILL.md` for the exact gate text and output-format requirement
(`obvious-basics-checklist`'s own `Category | Status | Evidence | Fix`
table, additive to the existing Odoo-cross-check output).

## Phase 4 — migrate the 28 grandfathered bare-table files [DONE 2026-09-24, 18 of 28]

**Outcome: 28 → 10.** `DataTable` gained a new optional `rowActions`
render-prop (`src/components/ui/DataTable.tsx`, Task 121 §3.2's own
named gap — a per-row privileged write control that `Column`'s
declarative variants can't express) — additive, all 21 pre-existing
importers verified unaffected (`tsc --noEmit` clean before any importer
touched it). One file (`hq/clients/page.tsx`) needed a small client
component extracted (`ClientsTable.tsx`) because it's a Server
Component and `rowActions` is a plain closure, not a `"use server"`
action — the same pattern this repo already uses for `CreateClientForm.tsx`
in the same directory.

**18 files migrated** across 9 commits (`5418f18`..`1822ce8`): full
CRUD/list tables in HQ admin, shell desks, counter, ledgers, stock,
transactions, floor plan, import wizard, and outreach intelligence.
Accepted, documented simplifications along the way: per-cell semantic
color/badge styling has no `Column` equivalent (status text itself is
unchanged, only its color emphasis is lost) — same tradeoff repeated
consistently rather than migrating some files and not others for
inconsistent reasons.

**10 files remain, each with a real structural reason, not deferred
debt:**
- `counter/[billId]/BillView.tsx`, `finance/[invoiceId]/InvoiceView.tsx`
  — printable financial documents (ADR-011 dense-financial-solid +
  print-safety); `DataTable`'s filter/sort/pagination chrome is wrong on
  a print surface.
- `outreach/domains/[domainId]/page.tsx`, `outreach/intelligence/page.tsx`
  (funnel table only — its other table, `IntelligenceTable`, IS
  migrated) — per-cell progress-bar visualization, not plain data.
- `hq/clients/[tenantId]/organizations/OrganizationsAdmin.tsx` — a
  depth-first indented parent/child tree; column-sort would visually
  scatter a subtree from its parent.
- `catalogue/CatalogueAdmin.tsx` — `groupByDesign()`'s fixed
  parent/variant grouping has the identical column-sort problem.
- `hq/clients/[tenantId]/roles/RolesAdmin.tsx` — a permission matrix,
  4 interactive checkboxes per row, not one trailing action.
- `hq/clients/[tenantId]/people/PeopleAdmin.tsx` — a live `<Select>`
  embedded in a data column, not the action slot.
- `prices/PriceSheet.tsx` — every cell is a controlled `<input>` with
  cross-cell keyboard navigation; an inline-editable grid, not a
  read-only row.
- `ledgers/LedgerView.tsx` (`OwedTable` only — its other table, the
  single-party ledger, IS migrated) — deliberately headerless top-N
  summary list (`<tbody>` with no `<thead>`); `DataTable` always renders
  visible header/filter chrome, which would be an unrequested visual
  change to an intentionally minimal list.

None of the 10 are candidates for `rowActions` or any other prop
addition — each is a genuine shape mismatch (tree, matrix, live-input
grid, print document, data-viz, headerless list), not a control gap.
Revisit only if a future shared-component variant is purpose-built for
one of these shapes; don't force-fit them into `DataTable` meanwhile.

Original plan text (superseded by the outcome above, kept for
context — the sequencing intent held, the file count/reasoning is now
what actually happened):

Mechanical, unblocked, no product-owner decision required. Swap each to
`DataTable`/`SmartTable`/`DynamicTable` (`src/components/ui/`), then
remove its `ignores` entry (or inline disable) and re-verify
`eslint . ` clean. Batch by area to keep diffs reviewable:

- **HQ admin (9):** `hq/audit/page.tsx`, `hq/page.tsx`,
  `hq/settings/page.tsx`, `hq/clients/page.tsx`,
  `hq/clients/[tenantId]/modules/ModulesAdmin.tsx`,
  `hq/clients/[tenantId]/organizations/OrganizationsAdmin.tsx`,
  `hq/clients/[tenantId]/people/PeopleAdmin.tsx`,
  `hq/clients/[tenantId]/roles/RolesAdmin.tsx`,
  `hq/clients/[tenantId]/settings/SettingsAdmin.tsx`
- **Shell desks (8):** `finance/FinanceDesk.tsx`,
  `purchases/PurchaseDesk.tsx`, `sales/SalesDesk.tsx`,
  `stock/StockBoard.tsx`, `transactions/TransactionsDesk.tsx`,
  `prices/PriceSheet.tsx`, `catalogue/CatalogueAdmin.tsx`,
  `menu/MenuAdmin.tsx`
- **Detail/record views (5):** `finance/[invoiceId]/InvoiceView.tsx`,
  `counter/[billId]/BillView.tsx`, `ledgers/LedgerView.tsx`,
  `floor/FloorPlan.tsx`, `import/ImportWizard.tsx`
- **Counter (2):** `counter/BillableOrders.tsx`, `counter/page.tsx`
- **Outreach (2):** `outreach/domains/[domainId]/page.tsx`,
  `outreach/intelligence/page.tsx`
- **Misc (2):** `overview/page.tsx`, `reports/page.tsx`

## Phase 5 — Task 116 (IN PROGRESS since 2026-09-19)

Apple quality visual UX completion program. Finish the full role/theme/
viewport evidence pass Phase 0 left open; continue Phase 1 past
`/overview`'s `HeroSignal`/`SignalRail` slice into remaining page
families. Direction already locked by the product owner: dark graphite,
subtle blue, no bloom, no persistent workspace pills.

## Phase 6 — Outreach launch verification remainder [DONE 2026-09-30 for Senior/Junior sign-in]

**2026-09-30:** closed for sign-in and rendering. The product owner approved the `pacreds.txt` accounts as test-only; Senior and Junior were signed in on localhost and the slices in Task 116 §8.2-§8.4 verified (see that file's 2026-09-30 entry). Not done: Junior writes (logging activity, progress track and timeline with data) — deliberately not exercised against a tenant that may be production. The original blocker text below is kept for history.

Junior/Senior role sign-in smoke test against the real PA-OMS tenant.
**Blocked on product-owner credentials** — passwords were printed once to
the console at seed time (`prisma/seed-pa-oms.ts`) and were never
captured anywhere retrievable. Not an engineering blocker; cannot be
closed by an agent session alone.

## Phase 7 — watch only, do not pick up

Task 90 (Attention platform concept). Waits on a second, independently-
arrived-at instance of the same generalization need. Listed so it is not
re-derived or started prematurely.

## Phase 8 — blocked on explicit product-owner decision, not sequenced against 1-6

- **Task 118** (manufacturing capability, veda-vs-Odoo gap) — needs the
  same Task-84-style product-owner override that shipped `recipe`/
  `plywood`/`trading`.
- **Task 119** (Jev decision model as an `EdgeCondition` advisory layer)
  — needs an ADR on external decision-model dependency + tenant-data
  egress, or `CLAUDE.md`'s objective moving past PLATFORM FOUNDATION
  READY into business-capability build.
- **Task 120** (Relay integration) — Relay has no backend yet
  (marketing site only); needs the authenticated external-tool-invocation
  HTTP surface built in Verity first, plus the same foundation-vs-
  capability scope question as Task 118.

None of Phase 8 is actionable by engineering alone — surface to the
product owner, do not improvise a decision.

## Backlog — real trigger/ADR gated, no action possible now

Listed for completeness only, not sequenced: Tasks 74/75/76 (superseded
in large part by ADR-018; residual scope beyond `trading` stays open),
79 (needs Indian statutory PF/ESI/TDS research first), 80 (needs Task 72
settled + an enterprise consolidation client), 88/89 (trigger: a second
reconciliation / period-locking instance — unfired), `DocumentTemplate`
per Task 104's correction (trigger: a real document-generation
requirement — unfired), 95 phase 6 (needs its own future ADR), 99 Skill 6
(`verity-capability-boundary-check` — worth scoping once two developers
work in parallel, not before).

## Recommended immediate start

Phase 0 (commit) first — cheap, closes existing drift. Phase 4
(mechanical migration) can run in parallel with the standing discipline
of Phase 1/5; neither needs a product-owner decision. Phase 6/7/8 wait on
someone other than the agent.
