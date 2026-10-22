# Stylified MVP: acceptance record, 2026-10-23

Measured against section 10 of `proposal/02-mvp-build-and-demo-plan.html`, on the local demonstration workspace (Postgres 16 in Docker,
local Keycloak, local S3-compatible storage). **This is the demonstration, not Stylified's hosted workspace**: nothing below has run
there yet. Where a criterion depends on the hosted deployment it says so.

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Four roles sign in and see only their screens; a supervisor cannot issue or receive at a stage not assigned to them (second supervisor) | **Met** | `capability-piecework-floor.test.ts` (stage scope with two supervisors; assignment only by the owner); route walks per role below; the supervisor's menu no longer offers screens the supervisor is refused |
| 2 | 100 = 94 + 2 + 1 + 2 + 1 open reproduces exactly | **Met** | `capability-piecework.test.ts`, "reconciles one issue exactly as the sheet does"; the seed builds B-0001 from it |
| 3 | An over-count is refused with the figures; a correction is a reversal and both rows stay | **Met** | Take back screen: counters turn red and Save is disabled ("That is more than is out"); server refusal and reversal rules in `capability-piecework.test.ts`; a supervisor may reverse only their own entry on the same day, a manager any |
| 4 | A rejected or rework entry accepts a photograph that shows in the register and in the approval | **Met locally** | Browser run against local S3 storage: photograph taken from the supervisor's phone view, stored, shown to the manager in Approvals (screenshots reviewed). **On the hosted deployment this still needs its storage bucket configured and one run** |
| 5 | A deduction or write-off above the manager's limit cannot be approved by the manager; the owner can | **Met** | `capability-piecework-floor.test.ts`; the Approve button is disabled with the reason for a manager and the server refuses it as well |
| 6 | A closed lot cannot be changed | **Met** | `capability-piecework.test.ts`, "closes a lot with a locked ledger" |
| 7 | Every screen opens at 1280 and 390 px, light and dark, with the demonstration data and no unrecorded defect | **Met** | Walk reports (committed): [owner, all routes](../../docs/demo/evidence/walk-stylified-owner-2026-10-22.md) 308 visits, 289 ok, 16 refused as designed, 3 transient development-server failures re-run clean; [supervisor](../../docs/demo/evidence/walk-stylified-supervisor-2026-10-22.md) 32 ok; [manager](../../docs/demo/evidence/walk-stylified-manager-2026-10-22.md) 44 ok; [munshi](../../docs/demo/evidence/walk-stylified-munshi-2026-10-22.md) 36 ok. Defects the walk and the flows found are fixed (below). The walk reads pages only; the main flows were driven by scripts and the screenshots reviewed |
| 8 | Hindi labels on daily entry and every supervisor screen | **Met** | The six supervisor screens and the munshi's daily entry rendered in Hindi: no English interface text left (only names and codes from the data) |
| 9 | The reset command restores the data in under two minutes | **Met** | `reset-demo.ts --yes` then `seed-stylified.ts`: 15 s + 66 s = 81 s |
| 10 | A backup is taken and a restore rehearsed on the Stylified workspace before go-live | **Met on the local workspace; open on the hosted one** | [Runbook and record](../../docs/deployment/stylified-backup-restore.md): dump, restore, identical ledger fingerprint, row-level security and append-only rules intact, photograph bucket mirrored. Also passed on a year of history (24,034 entries, 46 s). The Supabase restore itself has not been run |

## Defects found while proving this, all fixed

- **Money reached a supervisor.** The dashboard and the costing report returned dues and wages to anyone who could read lots; the page
  hid them but a direct call to the query did not. The dashboard now omits money without the payment grant, costing requires it, and a
  test calls both as a supervisor.
- **The owner dashboard failed after a few months of real use.** On 120 lots and 24,000 entries it took about 49 s and exceeded the
  15 s transaction limit (a per-lot scan of the whole ledger, entries fetched twice, every closed bundle derived on every page). It
  now takes about 0.5 s, and supervisor screens about 50 ms.
- A late card with no day count, empty tiles in the register, a clipped tab row, an ungrammatical alert ("1 issues are late"), a
  Give-out list full of karigars the supervisor could not use, and a menu that offered "Daily entry" to people refused it.

## Speed, measured

On a production build with the demonstration data, the server renders a page in 50 to 80 ms, and a page is idle in the browser in
0.7 to 1.0 s. Per page: 3 to 11 database transactions. On a year of history (queries only): dashboard 0.5 s, lot list 0.5 s, karigar
list 0.6 s, supervisor floor 50 ms. These are local figures with a database next to the application; the hosted deployment adds the
network and the authentication call below.

**One decision left for the owner.** Every page still asks the authentication provider to confirm the user (`getUser`), about one
network round trip per page. The proxy no longer does it a second time. Verifying the session token locally (`getClaims`) would
remove the rest, at the cost of a revoked or banned session staying valid for up to the access-token lifetime (an hour by default)
instead of ending at once; removing a person's access inside Verity (membership disable) is checked in the database on every request
either way. That trade belongs to the owner, so it is not made here.

## Still open

- Run the supervisor, manager and photograph flows once on Stylified's hosted workspace, with its storage bucket configured.
- Run the Supabase restore into a scratch project and record it in the runbook.
- Production migrations: the owner reported on 2026-10-23 that they deployed the migrations. I did not verify it against production, and `20261023110000_piecework_floor_roles` (written the same day) should be confirmed in `prisma migrate status` before the hosted run above.
- Lot pictures for Stylified's own lots are uploaded from the lot page at onboarding; the pictures in the demonstration are generated
  stills belonging to this demonstration only.
