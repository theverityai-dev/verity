# Stylified: backup and restore

Acceptance criterion 10 of the MVP plan (`clients/stylified/proposal/02-mvp-build-and-demo-plan.html`): *a backup is taken and a
restore is rehearsed before go-live.* This page is the procedure and the record of the rehearsal.

## What a restore has to bring back

| Thing | Where it lives | Covered by a database backup |
|---|---|---|
| Lots, bundles, entries, payments, approvals, day closes, people, roles | PostgreSQL | Yes |
| The append-only rules and row-level security | PostgreSQL (triggers, policies) | Yes, they are part of the schema |
| Defect photographs and lot covers | Object storage (a bucket); the database holds only their records and checksums | **No.** Back the bucket up separately |
| The application role's password (`verity_app`) | PostgreSQL role | **No.** Supabase daily backups do not carry custom-role passwords; reset it after any restore and update `DATABASE_URL` |

## Procedure

1. **Back up.** Supabase Pro or above takes a daily backup (7 to 30 days kept by plan); a free project takes none and is not
   acceptable for a client's books (`docs/deployment/client-owned-vercel-supabase.md`). Alongside it, copy the photograph bucket:
   `aws s3 sync s3://<bucket> <backup-location>` (or the Supabase Storage equivalent).
2. **Restore into a scratch database first**, never over the live one. A custom-format dump restores with
   `pg_restore --no-owner -d <scratch> <dump>`; a Supabase backup restores through the dashboard into a scratch project.
3. **Reset `verity_app`'s password** on the restored database and point a staging copy of the application at it.
4. **Prove it is the same business** before anyone is told it is back: row counts and a ledger fingerprint for the tenant, row-level
   security as the application role, the append-only refusal, the photograph bucket object count. `scripts/restore-rehearsal.sh`
   does all of these against any Postgres container and exits non-zero on the first difference.
5. **Cut over** only when the scratch copy passes: restore the bucket, switch `DATABASE_URL`, and keep the old database for 30 days.

A multi-tenant database cannot be rolled back for one customer by restoring over it, because that would also undo every other
customer's work since the backup. Restore into a scratch database, then copy the one tenant's rows across (tables are keyed by
`tenant_id`); that copy is a manual, reviewed step and has not been scripted.

## Rehearsal record

| | |
|---|---|
| Date | 2026-10-23 |
| What was restored | the local Stylified workspace database (Postgres 16 in Docker): 4 lots, 6 bundles, 35 ledger entries, 7 payments, 5 approvals, 1 closed day, 5 logins, 2 stored photographs |
| Method | `bash scripts/restore-rehearsal.sh` (custom-format dump, restore into a fresh database, compare, check security, mirror the bucket) |
| Time | dump and restore 21 s; whole rehearsal 50 s |
| Ledger fingerprint | identical before and after (`ledger_md5 bc439b62…`, `payments_md5 a6c79f18…`) |
| Row-level security after restore | own tenant sees its 35 entries; no tenant set sees 0; another tenant sees 0; `verity_app` bypasses RLS: no |
| Append-only after restore | an edit of a ledger row is refused |
| Photographs | the bucket mirrored object for object (4 and 4) |
| Result | **passed** |

### What this rehearsal did not prove

- It ran on a local Postgres in Docker, **not on the hosted Supabase project**. The Supabase-specific steps (restoring a platform
  backup into a scratch project, resetting `verity_app`'s password there) are written above from Supabase's documentation and have not
  been executed. Do that once on a scratch project before go-live, and record it here.
- The first run used the demonstration set. The same script also passed on a copy with a year of history (124 lots, 2,406 bundles,
  24,034 entries, 79 payments): identical ledger fingerprint (`ledger_md5 7af7f20a…`), row-level security and append-only rules intact,
  46 s in total. Restore time grows with data; a real year is about this size.
- Nothing here backs up or schedules anything: it proves a backup can be restored. Scheduling belongs to the hosting plan.
