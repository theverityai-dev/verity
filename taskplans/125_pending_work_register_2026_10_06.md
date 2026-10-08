# Task 125 — Pending work register (2026-10-06)

**Status: ACTIVE.** One list of everything still open as of 2026-10-06, so nothing lives only in a
chat. It does not invent scope: every item comes from the Colonel Kebabz parity work
(`clients/colonel-kebabz/reference-parity/`), the HQ audit (ADR-034/035), Task 116/122/123/124, or a
product-owner request in this session. Decisions already made are in
`clients/colonel-kebabz/reference-parity/DECISIONS.md`; this file does not repeat them.

Authority: `CLAUDE.md` stop conditions apply to every item. Anything that adds a security boundary
or changes INV-001, ADR-017 or `enforcePolicy()` needs its own ADR before code.

Order of work: 1 → 8. Within a section, top to bottom. Mark an item DONE with the commit hash.

## Just shipped (for context, not pending)

Stock requests, food-cost variance, vendor payments and performance (`d883832`); order pad line
quantities, same item combines, shared `QuantityStepper` and `assignLineItem` (`6458870`); part of a
bill line can be split or refunded (`9451db3`). Migration `20261006050000` is on production.

## 1. Verify what is already built

| # | Item | Done when |
|---|---|---|
| 1.1 | Browser-check the Colonel Kebabz screens as the Verity operator (enter client from HQ → People → create the client's login): order pad, counter, history, move/merge table, inventory Requests and Variance tabs, purchase-order Vendors tab, staff profile, payroll summary. | Each screen opened once with real data; defects fixed or logged here. **Desktop walk 2026-10-09** (operator inside Colonel Kebabz, read-only, Chrome): floor, order pad (T1, 6 lines), counter, history, inventory (Stock, Requests, Variance), purchase orders (Orders, Vendors), staff profile and attendance with payroll inputs all render with no console-visible error. Fixed: 7 nav glyphs silently missing (names not in the icon set; now a test, `nav-icons.test.ts`); assistant button sat over the last row's right-edge actions (`lg:pb-24` on the shell scroller). Salary tile reads "Hidden" for the operator: not a defect. `verity.hr.compensation` is registered by migration `20261006040000` and ADR-035 reconciles the operator role to every registered entity on entry, so a session entered before that reconcile shows "Hidden"; re-enter the client to confirm. Fixed 2026-10-09: "Overtime h" column header (now "Overtime") and the leave-balance empty copy ("under People operations"). Not exercised (would write to a live client): add item to the order pad, stepper, split, refund, move/merge. The driven Chrome tab froze on screenshots after several navigations; every page loaded fine in a fresh tab, so treated as tool flakiness, not an app defect. |
| 1.2 | Phone-width pass on the same screens (44pt targets, the stepper, bottom sheets). Blocked earlier: the user's Chrome window ignores resize and framing is blocked by CSP. | Checked at 390px, on the user's device or a devtools-emulated viewport. Code sweep 2026-10-08: shared Button sm, filter pill/link, DataTable search and paging, DateTimePicker and the sign-in theme toggle are now 44pt at phone width (`max-sm:`). The live pass is still open: it needs a local test DB (Docker was down) or the operator session. |
| 1.3 | Real Safari and Firefox check of the liquid-glass layer (ADR-028). Only Chromium and a simulated Safari UA were verified. | Fallback blur confirmed on both. |
| 1.4 | Task 116 matrix: route family × role × theme × viewport, with screenshots kept. | Evidence folder committed; Task 116 closed or its remainder re-listed. |

## 2. Decisions to record (no code)

Write each into `DECISIONS.md` with its basis.

- Kitchen "accepted" step is skipped: moving a line to preparing already signals pickup.
- Invoice photo on goods receipt is deferred until storage upload is exercised in the client.
- Coupons are not reversed on refund; loyalty points are (already built).
- Splitting a bill is several payments on one GST bill, never several invoices.

## 3. Menu (menu-recipes.md)

| # | Item | Notes |
|---|---|---|
| 3.1 | Modifiers beyond portions (extra cheese, spice level, add-ons with a price). | Snapshot name and price on the order line like variants. Same-item combining must treat different modifiers as different lines. |
| 3.2 | Time-of-day menus (breakfast, lunch, dinner). | Availability window per item or per menu, evaluated in the tenant time zone. |
| 3.3 | Availability per outlet and per channel (dine-in, takeaway, Zomato, Swiggy). | Replaces the single `active` flag with a scoped rule; the order pad must show why an item is hidden. |
| 3.4 | Price history with effective dates. | Order lines keep their snapshot; the history is for the owner to see what changed and when. |

## 4. Money

| # | Item | Notes |
|---|---|---|
| 4.1 | Cash in and cash out entries (petty cash, float, owner drawings) that feed the cash reconciliation. | Append-only; reason required. |
| 4.2 | Platform settlement CSV matching (Zomato, Swiggy payouts against orders). | Upload, match, show the unmatched and the short-paid; no auto-write-off. |
| 4.3 | HQ finance dashboard across clients. | Metadata only unless a read path exists that passes `enforcePolicy()`; otherwise ADR first. |
| 4.4 | Labour line in the outlet profit and loss (salary totals). | Reads the compensation permission; hidden from roles without it (DECISIONS.md #3). |

## 5. Guests (CRM and loyalty)

| # | Item |
|---|---|
| 5.1 | Edit a guest; merge duplicates (de-duplication follows ADR-007: verified contacts only). |
| 5.2 | Saved segments (for example "visited 3+ times, not in 30 days"). |
| 5.3 | One-tap redeem of loyalty points at the counter. |
| 5.4 | Offer rules and automatic offers (no stacking, per DECISIONS.md). |
| 5.5 | Tiers and birthday rewards. |

## 6. Staff leftovers

| # | Item |
|---|---|
| 6.1 | Roster week grid (employees × days, shift per cell, copy last week). |
| 6.2 | Leave calendar (who is off, when, overlap warning). |

## 7. HQ and platform

| # | Item | Notes |
|---|---|---|
| 7.1 | Data import console in HQ: spreadsheet → mapping → validation (duplicates, bad GSTIN) → import through normal commands. | Replaces the Appsmith suggestion (rejected, DECISIONS.md). |
| 7.2 | Support lookup: find a record in an entered client and show its timeline and approval step. | Runs inside an entered client under the operator's full authority (ADR-035); no cross-tenant read. |
| 7.3 | Cross-client implementation roll-up (stage, blocked, owner). | Built from existing lifecycle and checklist state. |
| 7.4 | **ADR needed:** platform-wide failed-commands view (HQ audit A6). | A fourth projection; ADR-013 forbids it without a decision. |
| 7.5 | **ADR needed:** full export and offboarding of a client (B5). | Touches the operator boundary. |
| 7.6 | **ADR needed:** announcements to clients (B7). | A cross-tenant write. |
| 7.7 | Outbound notifications. No dispatcher exists: `domain_event.delivered_at` is never set. | Needs a delivery design (channels, retries, per-tenant opt-in); likely its own ADR. |
| 7.8 | Load test: take the first real measurement (Task 123 is scaffolding only). Decide ADR-031 (deployment modes, PROPOSED) and Task 124 (runtime role default privileges, PROPOSED). | Evidence file with method, numbers and limits. |
| 7.9 | Paging on long lists (orders, bills, ledger, audit). | Cursor paging in the query layer, then `DataTable`. |
| 7.10 | Hosting plan: Vercel Pro and connection limits before more than a few live clients. | Cost figures are in the 1M-worker analysis from this session. |
| 7.11 | `enterprise-demo-prd/` (AstraGrid): not authorized for build. | Needs a fresh product-owner decision before any code. |

## 8. Coverage, client docs and housekeeping

| # | Item |
|---|---|
| 8.1 | Coverage for modules with thin tests (list from `vitest --coverage`, then one test file per gap, behaviour not lines). |
| 8.2 | Client parity docs: PlotArmour, Carxen, Kents, and the remaining Colonel Kebabz modules (audit Odoo and ERPNext modules, pages and buttons per client before building, per the standing rule). |
| 8.3 | Remove the 25 unused files found in the earlier audit (confirm each is unreferenced first). |
| 8.4 | Regenerate `00_STATUS_INDEX.md` evidence; update `handoffs/README.md` "Last updated". |
| 8.5 | Delete the stale worktree `.claude/worktrees/completion-gap` and review the stash `codex-audit-temp` (keep or drop with a reason). |
| 8.6 | `deploy-public-url-preflight.test.ts` times out at 5 s on Windows; confirm the cause. |
| 8.7 | Finish the `chore/repo-cleanup` branch remainder named in the handoffs index. |

## Progress log

### 2026-10-09

- **Section 2 (decisions): DONE.** All four recorded in
  `clients/colonel-kebabz/reference-parity/DECISIONS.md` ("Decisions recorded 2026-10-09"), plus two
  new ones: blue is the default accent for every client (another preset only on request), and a
  capability may only name a nav icon from the closed set.
- **1.1 desktop walk: DONE read-only** (see row 1.1). Write-path checks need a throwaway order.
- **1.2 phone width: BLOCKED on a signed-in session.** Opera CDP (port 9222) has real 390px device
  emulation; it comes up signed out and needs the operator to sign in once. Nothing else is missing.
- **1.3 Safari/Firefox: likely moot.** `LiquidGlass.tsx` no longer exists in `src` and ADR-033 limits
  materials to bars and overlays (plain `backdrop-filter`, supported by Safari and Firefox 103+).
  Close it after one look on a real device; do not build a fallback.
- **8.3 unused files:** `knip --include files` reports 31. Most are entry points that scripts and
  configs run (seeds, scheduler, k6, vitest and playwright configs, `server-only` stubs): keep. The
  real candidates are six UI files: `AccentPicker` (accent is fixed to `--accent-seed`; the picker is
  unwired), `OrganizationSwitcher` (workspace pills rejected 2026-09-19), `DynamicForm`,
  `DynamicTable` (metadata-driven ingredients in `implementation/08-experience/metadata-driven-ui.md`),
  `SplitButton` and `TrendChart` (orphan primitives kept on purpose, Task 115). **Decision: keep all
  six**, because each is a documented platform ingredient with its own spec text; revisit only if a
  release needs the bundle size.
- **8.5 stale worktree and stash: ready, needs your confirmation.** The worktree
  `.claude/worktrees/completion-gap` is clean, 0 commits ahead of `main`, and an ancestor of it, so
  nothing is lost. Stash `codex-audit-temp` dates from 2026-08-24 and would delete about 11,800 lines
  of current ADR and spec files if applied; a copy of its patch is kept outside the repo. Commands:
  `git worktree remove .claude/worktrees/completion-gap`, `git branch -d worktree-completion-gap`,
  `git stash drop stash@{0}`. An automated session was refused permission to run these.
- **6.1 roster week grid: BUILT, not browser-verified.** `/attendance` has a Roster panel: people by
  day for the week in `?week=`, previous and next week, and "Copy last week" (command
  `verity.attendance.copy_week`, idempotent, no migration). Pure date logic in `src/lib/roster-week.ts`
  with 5 unit tests; DB test added to `capability-attendance.test.ts` (4 pass on the local DB).
  A bare `<table>` is used on purpose (person-by-day matrix); the lint exception says why.
- **6.2 leave calendar: BUILT, not browser-verified.** The Leave tab on `/hr` opens with "Who is off,
  next 14 days": approved and pending leave per day, pending shown as "waiting for a decision", and a
  warning chip when two or more people are off the same day (counts pending, so the clash shows before
  approving). Pure logic in `src/lib/leave-calendar.ts`, 5 unit tests. No migration, no new command.
- **4.4 labour line in the outlet P&L: BUILT, DB-proven, not browser-verified.** Rule (my decision,
  basis: employees carry no outlet, shifts do): monthly salary prorated to the date range, split across
  outlets by the person's share of shift hours; people with no shifts in the range are counted as left
  out, never guessed. `get_outlet_pnl` now returns `labour` and `contributionAfterLabourMinor`, both
  null unless the role has Read on `verity.hr.compensation` (DECISIONS #3), and the old note that said
  "no wage-rate data" is corrected. Pure logic `src/lib/labour-cost.ts` (5 tests); DB test in
  `capability-finance.test.ts` proves hidden for the manager and `100_000` for the owner (2 pass).
- **5.3 one-tap loyalty redeem at the counter: BUILT, DB-proven, not browser-verified.** An open bill
  for a guest with points shows "Loyalty points: Use N points" (N is the most whose value fits inside
  the bill's subtotal). New command `verity.dinein.redeem_points_on_bill` debits the ledger and applies
  the discount in one transaction (the older two-step `redeem_points` then `apply_bill_discount` could
  spend points without giving the discount). Decisions: a bill that already has a coupon or discount is
  refused ("points and coupons do not stack", per DECISIONS.md); the offer is shown only to a role that
  can read the loyalty ledger; refunds do not hand redeemed points back (the discount was a price, not
  a payment). `apply_bill_discount` now shares its repricing with the new command. Test added to
  `capability-crm.test.ts` (3 pass); 25 dine-in and coupon tests still pass.
- **5.1 edit a guest: BUILT, DB-proven, not browser-verified. Merge duplicates: NOT built, decided.**
  New command `verity.crm.update_customer` (name, email, birthday, marketing consent; blank clears;
  phone is the identity key and is not editable) with an "Edit details" sheet on the guest page; test in
  `capability-crm.test.ts` (4 pass). A client role needs `Edit` on `verity.crm.customer` (Roles screen;
  the Verity operator already holds it, ADR-035). **Merge decision:** two guests with different phones
  merge by moving the second phone to a `customer_phone_alias` row on the kept guest, never by rewriting
  past orders (ADR-007: identity follows a verified contact; history is not edited). Needs one new table
  plus the 360 and loyalty reads joining through aliases, so it is a migration slice, not started.
- **5.2 saved segments: BUILT, DB-proven, not browser-verified. NEEDS THE MIGRATION ON PRODUCTION
  BEFORE THE PUSH.** Migration `20261009010000_crm_customer_segment` (table `customer_segment`, RLS
  forced, check constraints: name present, at least one filter, no negatives). Applied to the local test
  DB only; production is apply-then-push per the process rules below. A segment is a saved filter, not
  a list, so who is in it is live. `/guests` has "All guests" and one chip per segment, a filter form
  (visits, spend, days since last visit, in the URL so a view can be shared), "Save segment" and
  "Delete segment". Commands `verity.crm.save_segment` (Create), `verity.crm.delete_segment` (Edit, my
  decision: it removes a filter, not a record), query `verity.crm.list_segments`. CRM tests 5 pass;
  conformance (RLS on every table) 23 pass.
- **Sections 3 to 7 (build), other than 4.4, 5.1 (edit), 5.2, 5.3, 6.1 and 6.2: NOT STARTED** this session. Each needs a migration on production before
  its push, so they wait for the push step in the process rules below. Items 7.4, 7.5 and 7.6 need an
  ADR before code and stay that way.

## Process rules that apply to all of the above

- Commit as work lands; push once at the end of a batch; apply any migration to production before
  the push that needs it, then confirm CI, `/api/health` commit and `/api/ready`.
- New append-only tables go in the conformance test's sorted list.
- A screen with a list of lines follows the "Line-list basics pass" in the `verity-usage-qa` skill.
- Decide open product and implementation questions from the data and record the basis; stop only
  at a `CLAUDE.md` stop condition.
