# Repository cleanup: Phase 0 baseline (2026-10-04)

Branch `chore/repo-cleanup`, taken from `main` at `00fe00e`. This is a measurement only. Nothing
below was changed to produce it. Later phases compare against these numbers.

## Health checks

| Check | Result |
|---|---|
| `tsc --noEmit` | Clean, exit 0 |
| `eslint .` | 534 files: 4 errors, 3 warnings (see below) |
| `vitest --config vitest.pure.config.mts` | 275 of 276 pass, 1 skipped file, 1 failure |
| Tracked files | 2,238 (verity-spec 960, src 497, implementation 148, taskplans 139, prisma 131, verity-bible 112) |
| `TODO` / `FIXME` / `HACK` in `src/` | 0 |
| Secret patterns in tracked files | Only the literal `sk_live_secret` test fixture in `src/test/workflow-runtime.test.ts` |
| Markdown links (relative, 554 files) | 24 links, 0 broken. Most references are plain-text paths, not links, so this does not prove the references resolve |

### Lint

- Four `react-hooks/purity` errors: `Date.now()` called during render in
  `attendance/PayrollAndShifts.tsx:42`, `coupons/page.tsx:27`, `outlet-pnl/page.tsx:28`,
  `recipes/page.tsx:23`.
- Two unused `eslint-disable` directives (`CommandPalette.tsx:58`, `ProfileMenu.tsx:89`).
- One `react-hooks/incompatible-library` warning on `SmartTable.tsx:82` (TanStack Table).

### Test

`deploy-public-url-preflight.test.ts` ("passes a complete https configuration") times out at the
5 s default. It spawns a shell script, so the cause is likely slow process start on Windows, not a
logic fault. Unconfirmed. The full suite (`npm test`) needs a database and was not run here.

## Findings

1. **Taskplans are cited from live files.** 135 plan files; 123 are referenced by filename from
   `CLAUDE.md`, `.claude/skills`, `src`, `prisma`, `scripts`, `deploy` or the ADR register. Archiving
   a plan means rewriting those references in the same change.
2. **`00_STATUS_INDEX.md` is stale** (last regenerated 2026-09-08) and `Status:` header wording is not
   uniform across plans, so it cannot be regenerated mechanically without normalising headers first.
3. **`handoffs/README.md` is stale** (last updated 2026-09-30). It omits the 2026-10-01/02 deployment,
   ADR-031/032 and Task 123/124 work.
4. **Oversized modules:** `trading/orders.ts` 4,500 lines, `outreach/index.ts` 3,676,
   `trading/finance.ts` 3,533, `dinein/index.ts` 1,810. Splitting these is a refactor with real
   regression risk and is out of scope for a hygiene pass unless tests cover the seams.
5. **Untracked, undecided:** `enterprise-demo-prd/` (243 KB), `docs/enterprise-readiness/runs/`
   (seed-report JSON).
6. **Tracked generated output:** 12 files under `graphify-out/staging/` (27 MB on disk locally).
7. **Loose binaries:** `public/37456f41-...png`, `public/image.png`, and uploads named
   `pasted-<timestamp>-N.png` under `verity-app-ui-mockups/project/uploads/`. Each needs a content
   grep before any deletion.
8. **A separate repo, `verity-explore`,** is the public marketing site (123 business-type pages).
   Its claims are positioning, not proof of built capability, so this repo's README should say so.
9. `package.json` still has `db:sync` / `db:reset` using `prisma db push --force-reset`, which
   conflicts with the migration-only discipline in `verity-migration-safety`.

## Plan

| Phase | Work | Risk |
|---|---|---|
| 1 | Root hygiene: ignore rules, decide on untracked dirs, untrack `graphify-out/staging`, root README, CONTRIBUTING, CODEOWNERS | Low |
| 2 | Docs: archive closed taskplans with citation rewrite, regenerate index and handoffs README, ADR register index | Medium (many path edits) |
| 3 | Code: fix 4 lint errors and 2 stale disables, dead-code pass, boundary lint rules, forbidden-pattern test | Medium |
| 4 | CI gates and pre-commit | Low |

Not touched: `verity-bible/` (Bible is not editable without explicit instruction), applied
migrations, live DB table names.
