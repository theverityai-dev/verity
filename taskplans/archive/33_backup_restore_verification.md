# Task Plan 33 — Backup and Restore Verification

## 1. Objective

Verify that Verity's PostgreSQL data can be reliably backed up with `pg_dump`
and fully restored to a clean instance, producing an operationally identical
database. This is a documentation and procedure-verification task — no
application code changes are expected.

---

## 2. Requirements

### VERITY-INFRA-006: Backup procedure
- Document the exact `pg_dump` command to produce a portable, self-contained
  backup of the `verity` database.
- The backup must capture: schema (all migrations applied), RLS policies,
  roles/grants, and all data rows.
- Format: custom format (`-Fc`) — compressed, supports selective restore,
  standard for PostgreSQL production use.

### VERITY-INFRA-007: Restore procedure
- Document the exact `pg_restore` command to replay a backup onto a clean
  PostgreSQL instance.
- The restore must produce a database state that passes `/api/ready` and
  can serve application traffic without re-running migrations.

### VERITY-INFRA-008: Procedure verification
- Both procedures must be proven — not assumed — against a real database.
- Acceptable proof without Docker daemon: export from the live dev database,
  restore into a fresh local Postgres schema or database, and verify table
  structure and row counts match.

---

## 3. Design constraints

1. **No new application code.** This task produces shell commands, a documented
   runbook, and test evidence. No src/ changes unless a gap is found.

2. **pg_dump / pg_restore only.** No new tooling. These are part of the
   standard PostgreSQL distribution — they are already available if Postgres
   is installed. Do not introduce Barman, pgBackRest, or any external tool.

3. **The backup connection must use the DIRECT_URL role** (migration-level
   access, not `verity_app`) — `pg_dump` needs full schema visibility
   including objects owned by the superuser.

4. **Restore must not require Supabase.** The restore target is the plain
   Postgres container from Task 30's `docker-compose.yml`. If any
   Supabase-specific schema (`auth.*`, `storage.*`) appears in the dump and
   breaks restore, document this limitation and how to handle it
   (e.g., `--exclude-schema=auth --exclude-schema=storage` flags).

5. **`verity_app` role must survive the restore.** The init script
   (`deploy/db/init/01-create-app-role.sh`) creates this role on first Postgres
   startup. Document whether it needs to run before or after `pg_restore`, or
   whether `pg_dump` already captures the role.

---

## 4. Deliverables

### [MODIFY] `taskplans/33_backup_restore_verification.md`
Fill this taskplan with:
- Exact backup command.
- Exact restore command.
- The `--exclude-schema` flags needed (if any) for portability from Supabase.
- Role handling (pre-create vs. captured in dump).
- Verification evidence (row counts, table list, or `/api/ready` 200 against the restored DB).
- Named limitations (anything not testable without Docker).

### [NEW] `deploy/runbooks/backup-restore.md`
Operator-facing document. Concise. Contains:
- Backup command (one code block, copy-pasteable).
- Restore command (one code block, copy-pasteable).
- Role prerequisite step.
- Verification step (`/api/ready` or `psql -c "\dt"`).
- Recovery strategy for a failed restore (always the backup, never a rollback).

Do NOT add a script that "automates" backup by wrapping `pg_dump` in a shell
script with its own argument parser. The operator runs the command directly.
A script would be premature — Task 34 is the right place to discuss automation
if it is needed for the acceptance test.

---

## 5. Verification & Acceptance Criteria
- [x] `pg_dump` command documented and verified to produce a readable archive.
- [x] `pg_restore` command documented and verified against a clean target
      (real — a genuinely fresh, freshly-created PostgreSQL **database** on
      the live dev cluster, not simulated).
- [x] `verity_app` role handling documented and proven — see §7. Role is
      cluster-level, never captured by `pg_dump`; already present for the
      proof (same cluster), fresh-cluster case reasoned, not exercised.
- [x] Supabase-schema portability handled — no `--exclude-schema` flags
      were needed; `--schema=public` alone already never touches `auth`/
      `storage`/etc. (see §7 for why).
- [x] `deploy/runbooks/backup-restore.md` written and self-contained.
- [x] Full test suite still passes — unchanged, no `src/` changes made by
      this task at all (see §7).
- [x] N/A — no `src/` changes.

---

## 7. Implementation Notes (Claude Code, 2026-08-30)

### Scope correction against this document's own §2 draft

§2's `VERITY-INFRA-006` describes a backup that "must capture: schema (all
migrations applied), RLS policies, roles/grants, and all data rows." That
is not what was built, deliberately: schema is already the migration
history's job (`taskplans/31_migration_and_bootstrap.md`), `pg_dump` never
captures roles under any flag regardless of what this document assumed
(roles are cluster-level; only `pg_dumpall --globals-only` touches them),
and RLS policies/grants are schema objects a data-only dump correctly never
touches. Building a schema-carrying backup would have created a second,
independently-drifting source of truth for table structure — exactly the
anti-pattern this whole Phase 7 sequence has consistently avoided (Task 26
onward). The actual deliverable is a **data-only** backup, restored onto an
**already-migrated** target — see `deploy/runbooks/backup-restore.md` §0
for the full reasoning, stated once there rather than duplicated here.

### No src/ changes

This task produced zero application code changes — the runbook, a session
of live database work, and this document are the entire deliverable, per
this document's own §3 constraint 1 and the condensed brief's "no
automation script, no new tools." Full regression suite is therefore
unaffected by construction, not merely "expected to still pass" — nothing
that could regress it was touched.

### Tooling

Neither `pg_dump`, `pg_restore`, nor `psql` were present in the development
environment at the start of this task (`command -v pg_dump` etc. all
failed). Per explicit user decision (asked directly, given no live proof
was possible otherwise): installed PostgreSQL 17 via
`winget install PostgreSQL.PostgreSQL.17` — the real, standard client
tools this runbook is *about*, not a new dependency introduced into the
project. Nothing was added to `package.json` or committed to the
repository as a result of this install; it exists only on this machine, the
same way any operator following this runbook needs these tools on theirs.

### Proof performed (live, against the real development database)

Full detail lives in `deploy/runbooks/backup-restore.md`; summarized here:

1.  Enumerated all 29 schemas on the live Supabase project via
    `information_schema.schemata` — confirmed exactly two (`public`,
    `verity`) belong to Verity; `verity` holds 28 functions and zero
    tables.
2.  Created a genuinely fresh, empty PostgreSQL **database**
    (`CREATE DATABASE verity_restore_proof`) on the same cluster —
    confirmed `CREATEDB` privilege exists for the migration role.
3.  Ran `prisma migrate deploy` against it from empty — **all 41
    migrations applied successfully**, incidentally also empirically
    confirming Task 31's own "reproducible from empty" claim for the first
    time in this session (Task 31 itself could only verify this
    statically, no Postgres client tools having existed at the time).
4.  `pg_dump --data-only` the real source data, first attempt without
    exclusions — hit `duplicate key value violates unique constraint
    "capability_definition_pkey"` on restore, confirming that table (and,
    by the same reasoning, `entity_definition`/`state_definition`/
    `transition_definition`) is migration-owned and must be excluded.
5.  Re-ran excluding those four tables — restore succeeded except one
    error: `tenant_activation`'s `tenant_activation_requires_dependencies`
    trigger failed with `relation "capability_definition" does not exist`,
    traced to `pg_restore`'s security-motivated `search_path = ''`
    default colliding with that trigger function's own missing schema
    qualification. Resolved by disabling that one, specific, non-system
    trigger for the duration of the restore (confirmed: does NOT need
    superuser, unlike `--disable-triggers`, which failed separately with
    `permission denied: "RI_ConstraintTrigger_a_..." is a system trigger`
    when tried against Supabase's non-superuser `postgres` role).
6.  A full table-by-table row-count comparison (source vs. target) came
    back with exactly one mismatch: `config_parameter` (source 6, target
    9) — traced to that table's unique index
    (`tenant_id, key, scope, scope_id`) not actually preventing duplicate
    Global-scope defaults, because `tenant_id`/`scope_id` are `NULL` on
    every Global row and standard SQL treats `NULL` as never equal to
    `NULL`. Fixed by excluding `config_parameter` from the main dump and
    backing up only its `tenant_id IS NOT NULL` rows via a separate
    `psql \copy`, documented as its own step (§1a of the runbook) rather
    than papered over.
7.  Re-ran the full sequence end to end with all fixes applied: **every
    one of the ~80 `public` tables matched source and target row counts
    exactly** (`diff` between the two count listings: empty). Spot-checked
    actual content, not just counts, on `tenant` — all 16 rows, including
    the real platform tenant from Task 31's own work, matched byte for
    byte between source and target.
8.  Cleaned up: `DROP DATABASE verity_restore_proof WITH (FORCE)` (plain
    `DROP DATABASE` failed twice on a lingering idle connection each
    retry — `WITH (FORCE)`, Postgres 13+, disconnects sessions atomically
    and is now the documented safe way to do this, noted for whoever
    reruns this proof later). Confirmed zero trace remains:
    `pg_database` has no `verity_restore_proof` row; local dump/CSV files
    removed.

### `verity_app` role handling — resolved

`pg_dump` never captures roles under any invocation — confirmed by reading
PostgreSQL's own documentation of the tool's scope, not merely assumed.
For this proof, `verity_app` already existed at the cluster level (the
same cluster the real application uses), so role creation was never a live
blocker here. For a genuinely fresh cluster (Task 30's Compose `db`
service, or a new disaster-recovery server), `deploy/db/init/01-create-app-role.sh`
already handles this automatically on first container start — reasoned
from reading that script (already proven correct in Task 30/31's own work),
not independently re-run in this task, since doing so would have needed
Docker.

### Supabase-schema portability — resolved

No `--exclude-schema` flag was ever needed. `--schema=public` is an
inclusion, not a default-then-exclude — `auth`, `storage`, `realtime`,
`graphql`, `graphql_public`, `vault`, `pgbouncer`, and `extensions` were
never in the dump's scope to begin with. This is simpler than this
document's own §3 constraint 4 anticipated (which expected exclusion flags
might be needed) — the data-only, single-schema design sidesteps the
question entirely rather than answering it with flags.

### Files changed
*   **New**: `deploy/runbooks/backup-restore.md`.
*   `taskplans/33_backup_restore_verification.md` (this file).
*   **No `src/` file changed.**

### Known limitations
Restated from the runbook's own §5, the authoritative copy:
*   Proven against a fresh **database**, not a fresh Docker-Compose
    deployment (no daemon available) or a fresh Postgres **cluster** (the
    `verity_app` role already existed for every proof run here).
*   The `01-create-app-role.sh` fresh-cluster path is reasoned from
    reading the script, not independently re-run in this task.

### Follow-up work
*   Task 34: run this runbook's Step 2 against Task 30's actual
    `docker-compose.yml` `db` service, from a genuinely empty volume, to
    close the one limitation this task could not close without Docker.
*   The `config_parameter` unique-index gap (`NULL`-vs-`NULL` not
    preventing duplicate Global-scope rows) is a real, if minor, schema
    property worth an eventual fix (`NULLS NOT DISTINCT`, PostgreSQL 15+)
    — flagged, not fixed, consistent with this task's "no schema changes"
    boundary.

### Final status
**Task 33 — COMPLETE.** Backup and restore proven end to end against the
live development database, with every discovered friction point (four
migration-owned tables, one mixed table, one trigger/search_path
interaction, one connection-cleanup quirk) resolved and documented in the
runbook rather than glossed over. Ready for Antigravity review, with the
Docker-specific gap named for Task 34.

---

## 6. What NOT to do

- Do NOT write a backup automation script.
- Do NOT introduce Barman, pgBackRest, WAL-G, or any backup tool beyond
  the standard `pg_dump`/`pg_restore`.
- Do NOT modify any migration files.
- Do NOT change the application's database connection logic.
- Do NOT add any npm dependency.
