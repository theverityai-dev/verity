# Stylified on the hosted deployment: what is left, step by step

Two items from `clients/stylified/acceptance-record.md` can only be done with access to the hosted Supabase project and Vercel, and both
create something real (a tenant with logins; a scratch project that bills), so they wait for the owner. Everything below has already been
proven locally; this is the same thing once, there.

Checked 2026-10-23: `prisma migrate status` against production reports **Database schema is up to date** (151 migrations), so
`20261022100000_piecework_bundles_quality` and `20261023110000_piecework_floor_roles` are on production.

## A. One run of the floor flows on the hosted workspace

1. **Storage.** The hosted deployment stores photographs in Supabase Storage. Confirm the bucket named by `SUPABASE_MEDIA_BUCKET` exists
   (`prisma/ensure-storage-bucket.ts` creates it) and that `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set on Vercel.
2. **A demo tenant to run it on** (not Stylified's real workspace). `prisma/seed-stylified.ts` with the production variables creates one login
   per role (owner, manager, two supervisors, munshi) through Supabase Auth and prints each password once. Run it only with the owner's say-so,
   on production, with `DEMO_TENANT_NAME=Stylified` flagged `demo`; `reset-demo.ts --yes` removes it again.
3. **The run** (phone width, about 10 minutes):
   - `supervisor A`: My floor, Take back on B-0002 (rejected 3, reason Stain), then **Add a photograph** (take one), then Request a wage deduction.
   - `manager`: Approvals shows the request **with the photograph**; approve it. The ₹2,500 request shows "Needs the owner" and Approve is disabled.
   - `owner`: approve the ₹2,500 request. Team and limits shows the closed day.
   - `supervisor A` on Karigars: refused (no money for supervisors).
   - Any lot page: **Add a cover picture**, see it on the lot list.
4. **Record** the result in `clients/stylified/acceptance-record.md` (criterion 4 becomes "met on the hosted deployment").

Photographs need the storage origin allowed by the Content-Security-Policy; Supabase storage is covered by its wildcard
(`src/server/platform/csp.ts`), so nothing to change.

## B. The Supabase restore rehearsal

1. Make a **scratch** Supabase project (same region as production) so nothing live is touched.
2. Restore the most recent production backup (Pro plan: Dashboard, Database, Backups) into it, or `pg_dump` production with the direct
   connection and `pg_restore --no-owner` into it.
3. **Reset `verity_app`'s password** on the scratch project (backups do not carry custom-role passwords) and point a local copy of the
   application at it with `DATABASE_URL`.
4. Prove it is the same business with the checks in `scripts/restore-rehearsal.sh` (row counts, ledger fingerprint, row-level security as
   `verity_app`, the append-only refusal): run its steps 3 to 5 against the scratch database, and compare with the production figures read
   with `SELECT`.
5. Copy the photograph bucket's objects and check the object count (`docs/deployment/stylified-backup-restore.md`, "What a restore has to
   bring back").
6. Delete the scratch project; record the date, the time taken and the result in `docs/deployment/stylified-backup-restore.md`.

## Decision still yours

`VERITY_SUPABASE_SESSION_CHECK` (default `server`) controls whether each page asks Supabase to confirm the session (a revoked session ends
at once; one network round trip per page) or verifies the token locally (`local`: no round trip; a revoked session lives up to an hour).
Set it on Vercel when you decide; no code change. Removing a person's access inside Verity (membership disable) is immediate either way.
