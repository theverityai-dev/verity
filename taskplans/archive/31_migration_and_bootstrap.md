# Task Plan 31 — Migration and Bootstrap

This document defines the implementation plan to establish a structured, reproducible database migration and bootstrapping procedure, enabling operators to spin up Verity v2 on a completely fresh PostgreSQL instance and seed standard configurations.

---

## 1. Requirements

### VERITY-INFRA-003: Postgres Migration Engine
*   **Target**: Automate database schema setups.
*   **Requirement**: A new environment must deploy automatically using Prisma migration histories:
    1.  Clean database.
    2.  `npx prisma migrate deploy` updates schemas and tables.
    3.  `npx prisma db seed` boots organization and default tenant configurations.

---

## 2. Design

### Step 1: Document Operator Command Line Routines
Since we decided in Task 30 to explicitly decouple database migrations from Next.js server boot tasks (guaranteeing standalone image start speeds), we will document the manual trigger commands inside the local reference directory.

### Step 2: Seed script adjustments
Verify that the `prisma/seed.ts` script successfully populates:
*   An initial tenant.
*   An initial organization node.
*   A default administrative user and active membership.
*   Standard core capability configurations.

---

## 3. Verification & Acceptance Criteria
*   [x] Deploying a clean Postgres instance and executing the migration script sets up all tables — verified by full static audit of all 41 migrations (see §4); a live from-scratch replay could not be safely performed (see Limitations).
*   [x] Running the bootstrap process (NOT `prisma db seed` — see the scope correction in §4) populates the minimum required system state without failing constraints, and does so idempotently.

---

## 4. Implementation Notes (Claude Code, 2026-08-30)

### Scope correction, made before writing code

This document's own §1–2 draft (above, left unedited as a record of what was
originally proposed) describes a `prisma db seed` step that "boots
organization and default tenant configurations" and a `prisma/seed.ts`
verification step for "a default administrative user and active
membership." **This is exactly what the actual Task 31 instructions given
for this session explicitly forbid**: *"Do NOT silently create fake
production data. Do NOT hard-code a customer identity. Do NOT create a
universal default password."*

Reading `prisma/seed.ts` confirms why the draft is wrong for a real
bootstrap: it is explicitly labelled `/** DEVELOPMENT FIXTURE — not
production data. */`, creates a hard-coded `admin@demo.verity.local` /
`verity-demo-password` Supabase Auth user by raw SQL, and writes records
prefixed `"Demo"` into a `"Demo Operations"` tenant. That is a legitimate,
clearly-labelled dev convenience — and precisely the "universal default
password" this task's real instructions say not to build as a production
bootstrap mechanism. `seed.ts` was **left untouched** (it still does its
documented job for local development) and is **not** part of the bootstrap
sequence documented below.

### Migration audit

| Property | Finding |
|---|---|
| Engine | Prisma Migrate (`prisma/schema.prisma`'s `datasource db { provider = "postgresql" }`). |
| Directory | `prisma/migrations/`, 41 timestamped directories + `migration_lock.toml` (`provider = "postgresql"`, correct and unmodified — hand-editing this file is explicitly against Prisma's own convention). |
| Naming/versioning | `YYYYMMDDHHmmss_description`, Prisma's own convention; strictly increasing, no gaps that matter (a few same-day migrations share a date prefix but differ in time). |
| Ordering | Applied in directory-name (timestamp) order by `prisma migrate deploy`; `20260822000000_required_extensions` is deliberately dated *ahead of* `20260823000000_init_tenancy` specifically so `pgcrypto` exists before `20260823090000_workflow_runtime` needs it (documented in that migration's own header — see Extensions below). |
| Transaction behavior | Each migration file runs in its own transaction (Prisma's default) — a mid-migration failure rolls back that one file, not the whole history. |
| Database assumptions | A single `public` schema (no custom schema name), confirmed by the one migration that references `public.` explicitly doing so deliberately for `GRANT`/`ALTER DEFAULT PRIVILEGES` statements, matching Prisma's default single-schema mode (`schema.prisma`'s datasource declares no `schemas` array). |
| Extension requirements | `pgcrypto` only — see dedicated section below. |
| Seed behavior | No migration seeds business/demo data. Migrations DO seed static, non-tenant platform metadata — see "What migrations already bootstrap" below. |
| Destructive operations | Exactly one migration contains `DROP TABLE`: `20260827010000_probe_capability_removed`, which removes a demonstration table (`probe_widget`) created two migrations earlier in the same history (`20260827000000_probe_capability`) and explicitly removed once its purpose (proving Gate 9) was served. Net effect on a fresh install: the table never exists in the final schema. No migration drops or truncates real business data. |
| Rollback characteristics | **None supported.** Prisma Migrate has no built-in `down` migration or automatic rollback — this is a genuine, permanent property of the tool, not a gap in this project's setup. See "Rollback / recovery" below for what that actually means operationally. |
| Production usage | `.env.example`'s own documented convention: `DATABASE_URL` (pooled, `NOSUPERUSER NOBYPASSRLS`, session mode) is the runtime connection; `DIRECT_URL` (privileged, unpooled) is "Migrations only... Never used at runtime" — already correctly separated (Task 26 formalized this through `RuntimeConfig`, unchanged here). |

**Reproducibility from empty PostgreSQL**: `20260822000000_required_extensions`'s
own header comment (quoted in the Extensions section) documents that this
exact question was already investigated once before this task — "Phase 0.9,
second defect," evidence in `implementation/pgcrypto-dependency-investigation.md`
— and that migration is the fix that came out of that investigation. That
gives real, if historical, confidence the history was reproduced from empty
at least once. This task re-verified the *current* history (41 migrations,
9 added since that fix) by full static audit rather than assuming the prior
finding still holds — see the destructive-operation and extension checks
above and below, both re-run fresh for this task, and the Limitations
section for what a static audit cannot substitute for.

### Required PostgreSQL extensions

**`pgcrypto` only.** Verified by grepping every migration for `CREATE
EXTENSION` — one match, `20260822000000_required_extensions`. That
migration's own header (already unusually thorough — quoted in part
because it already answers this section's exact questions):

*   **Why required**: three call sites in `20260823090000_workflow_runtime`
    (`pgp_sym_encrypt`/`pgp_sym_decrypt` in the credential registry, MET-AUT-003).
*   **Does the standard image provide it?** Yes — `pgcrypto` ships in the
    `postgresql-contrib` package bundled into the official `postgres`
    Docker image (the base Task 30's `docker-compose.yml` uses,
    `postgres:16-alpine`, includes contrib extensions compiled and
    available for `CREATE EXTENSION`, per that image's own documented
    contents). Not independently re-verified against a running container in
    this session (no Docker available — same limitation as Task 30); stated
    with the confidence of well-established, standard PostgreSQL Docker
    image packaging, not as an assumption invented here.
*   **Enabled during migration?** Yes — `CREATE EXTENSION IF NOT EXISTS
    pgcrypto;`, idempotent, TRUSTED (no superuser required in PostgreSQL
    13+, and the migration's own comment records this was verified against
    a non-superuser migration role on a disposable database).
*   **Portable?** Yes — deliberately no `WITH SCHEMA` clause (a Supabase-only
    `extensions` schema would abort a clean-database migration), and the
    functions that use it declare their own `search_path` covering both
    locations.

**Not introduced**: `uuid-ossp` (zero uses — every UUID generation in this
schema uses PostgreSQL 13+'s built-in `gen_random_uuid()`) and
`pg_stat_statements` (an observability extension, a deployment concern, not
an application dependency) — both explicitly declined already, in the same
migration's own header, for the same reason this task declines to add
anything beyond what current requirements justify.

### Migration vs bootstrap vs runtime startup — kept separate, as instructed

*   **Schema migration** — `prisma migrate deploy` (Prisma Migrate). Changes
    database *structure*, plus the small amount of genuinely static,
    non-tenant platform metadata described next. Nothing here is
    environment- or deployment-specific.
*   **Bootstrap** — `prisma/bootstrap-operator.ts` (unchanged in behavior,
    refactored for testability — see below). Creates the minimum
    *environment-specific* application state a fresh installation needs: the
    platform tenant (if none exists) and one human's operator authority in
    it. Requires a human decision (which email) and a pre-existing
    authenticated identity — genuinely cannot be automated into a migration.
*   **Runtime startup** — `node server.js` (Task 30). Starts the
    application. Performs **zero** database writes on its own: confirmed by
    reading `installCapabilities()`/`installAdministration()`
    (`src/server/capabilities/registry.ts`, `src/server/platform/administration.ts`) —
    both are in-memory registration guards (commands/queries/contributions
    registered into the running process), never a `create`/`upsert` against
    the database. Startup assumes migration and bootstrap already happened;
    it does not perform or hide either.

### What migrations already bootstrap (and what they do not)

A real, concrete finding worth stating precisely, because an early
(mistaken) grep suggested otherwise before a second, more careful check
corrected it: **`capability_definition` rows — the static list of
Location/Asset/Evidence/Scheduling/Approval/Dinein/Plywood capabilities and
their declared entity types — ARE seeded by migrations**, via raw SQL
`INSERT INTO "capability_definition" (...)` statements co-located with each
capability's own schema migration (13 migration files reference the table;
6 of them insert into it). This is exactly right: a capability's own
existence is static, versioned, non-tenant-specific platform metadata, not
environment-specific bootstrap state — Task 21's/Bible's own framing
("capability definitions are installed by migration," `operator.ts`'s own
comment, confirmed accurate by this audit) already got this right, and nothing
needed to change.

What migrations correctly do **not** seed: which capabilities are *activated*
for which tenant (`tenant_activation` — an operator or client action, not a
platform fact), the platform tenant itself, or any operator/administrator
identity — all three are genuinely environment-specific and belong to
bootstrap, not migration.

### Bootstrap architecture

`prisma/bootstrap-operator.ts` already existed, already correct, and already
matched every constraint this task's actual instructions state (not
invented for this task — recognized and verified, the same pattern as
Tasks 27/29/30's findings):

*   **Idempotent** — a second run for an already-bootstrapped identity is a
    safe no-op that reports `"already_operator"`, not a duplicate or an
    error. Verified by a new test, not merely by reading the code (see
    Testing below).
*   **Does not create credentials** — its own header states this explicitly;
    the email "identifies an EXISTING authenticated user... this grants
    authority, it does not create credentials." Credential creation stays
    with the active `AuthProvider` (Task 28) — Supabase Auth today.
*   **No hard-coded identity, no default password** — the email is an
    argument (`tsx prisma/bootstrap-operator.ts <email>` /
    `npm run bootstrap:operator -- <email>`), supplied by the operator
    at the moment of use, never committed.
*   **Explicit, human-run, not a startup hook** — matches "Migration
    Safety"'s instruction directly; it is a one-time CLI command, not
    something any container or request path invokes automatically.

**Refactored for testability** (behavior unchanged): the logic was extracted
into `prisma/operator-bootstrap-core.ts` — a pure `bootstrapOperator(prisma,
email)` function with no argv parsing, no `console.log`, no `process.exit`,
returning a structured result instead. `bootstrap-operator.ts` is now a thin
CLI wrapper: parses `argv`, calls the core function, prints the same log
lines it always printed, sets `process.exitCode = 1` on failure — exactly as
before. Verified the CLI wrapper still resolves and behaves identically for
the "no email given" case (`npx tsx prisma/bootstrap-operator.ts` with no
argument still prints `usage: ...` and exits 1, unchanged).

**One real portability fix, made carefully and narrowly**: the identity
lookup unconditionally `LEFT JOIN`ed `auth.users` — a Supabase GoTrue table.
On Task 30's containerized path (`postgres:16-alpine`, no `auth` schema),
referencing a genuinely nonexistent table in a static query is a **parse-time
error**, not a runtime null a `LEFT JOIN` condition can suppress. Fixed with
a `to_regclass('auth.users') IS NOT NULL` existence check run first, then one
of two query variants — with or without the Supabase-specific match — chosen
at runtime. This changes nothing about *who* can be granted authority (a
matching Party/User by email must still exist either way); it only makes the
script not crash outright on a database that was never Supabase's. This is a
portability guard, not a redesign of authentication — the DO-NOT list's "do
not redesign authentication" is respected: no identity/authorization
semantics changed, only which SQL variant runs against which database shape.

### Admin initialization mechanism

**Explicit CLI command, run by a human, using an existing authenticated
identity** — the safest of the options this task's brief lists, and already
the existing design (Task 31 recognized and verified it rather than
inventing an alternative):

1. The operator signs up / signs in through the active `AuthProvider`
   (Supabase Auth today) through the ordinary sign-in flow, exactly like any
   other user — this is the ONLY place a credential is ever created, and it
   already goes through the platform's real auth boundary (Task 28), never
   through this script.
2. The operator (or whoever controls the deployment) runs
   `npm run bootstrap:operator -- <that person's email>` against the
   privileged `DIRECT_URL` connection.
3. The script grants operator authority — no new credential, no committed
   secret, no hard-coded identity anywhere in the repository.

No "one-time setup endpoint" or "first-run setup state" was built — the CLI
command already satisfies the requirement without adding an HTTP-reachable
setup surface (a smaller attack surface than a web-based first-run wizard,
and the existing, already-battle-tested mechanism).

### Idempotency semantics

Distinguished precisely, as instructed, rather than claimed as universal:

| Step | Idempotent? | Behavior on repeat |
|---|---|---|
| `prisma migrate deploy` | Yes, by Prisma's own design | Already-applied migrations are skipped via `_prisma_migrations` bookkeeping; re-running against a fully-migrated database is a safe no-op. |
| `bootstrapOperator()` — platform tenant | Yes | Finds the existing platform tenant (`WHERE is_platform`) rather than creating a second one; `platformTenantCreated: false` on every call after the first. |
| `bootstrapOperator()` — "Verity Operator" role + its grant | Yes | Both existence-checked before creating; `roleCreated`/`grantCreated: false` once they exist. |
| `bootstrapOperator()` — the specific membership | Yes | Reports `membershipOutcome: "already_operator"` rather than duplicating a `TenantMembership` row or erroring. |
| `bootstrapOperator()` for an unknown email | N/A — throws | Not idempotent in the sense of "safe to retry blindly": it throws every time until a matching identity exists. That is correct behavior, not a bug — retrying without first creating the identity would fail identically. |

Every "already exists" case above was proven by an actual second call in
the new test file, not asserted from reading the code alone.

### Failure handling

*   **Migration failure** — `prisma migrate deploy` exits non-zero and
    leaves the failed migration's own transaction rolled back (Prisma's
    default per-migration transaction, confirmed in the audit above); it
    does not mark itself "applied." The container never runs migrations on
    startup (Task 30's own decision, unchanged), so a migration failure
    cannot be mistaken for a healthy running application — the operator sees
    the failed CLI command directly, before `node server.js` is ever
    started.
*   **Bootstrap failure** — `bootstrapOperator()` throws with a specific
    message (`"no existing identity for <email>..."` or `"platform tenant
    has no root organization"` for a genuinely corrupt state); the CLI
    wrapper prints it and sets `process.exitCode = 1`. Retry safety: safe to
    retry after fixing the actual cause (e.g., the person signs in first),
    per the idempotency table above.
*   **Partial bootstrap** — handled by construction, not by a special
    "partial" code path: every step (platform tenant, role, grant,
    membership) is independently existence-checked, so re-running from ANY
    partially-completed state (e.g., the process was killed after creating
    the platform tenant but before granting membership) completes the
    remaining steps and reports accurately which ones it actually did this
    time (`platformTenantCreated`/`roleCreated`/`grantCreated`/
    `membershipOutcome`), rather than either erroring on what already exists
    or silently re-doing it.
*   **Database unavailable** — not modified here; this is Prisma Client's
    own connection behavior (a bounded connection attempt that fails with a
    `PrismaClientInitializationError`, not an indefinite hang), the same
    behavior every other script/test in this repository already relies on.
    Changing it was out of scope (DO-NOT: no unrelated changes) and not
    needed — it already fails clearly rather than hanging.

### Deployment sequence (install)

```bash
# 1. Start PostgreSQL (Task 30's Compose db service, or any PostgreSQL 13+).
docker compose up -d db

# 2. Provide runtime configuration (Task 26's RuntimeConfig — DATABASE_URL,
#    DIRECT_URL, NEXT_PUBLIC_SUPABASE_URL/ANON_KEY at minimum).

# 3. Migrate — schema + static platform metadata (capability definitions).
#    DIRECT_URL: the privileged, unpooled connection — never DATABASE_URL.
npm run prisma:migrate:deploy

# 4. Bootstrap — sign in as the intended operator through the running
#    application first (creates their Party/User via provisionIdentity()),
#    THEN grant them operator authority:
npm run bootstrap:operator -- operator@example.com

# 5. Start Verity.
docker compose up -d web
```

Step 4 has an ordering dependency worth stating plainly: the operator's
identity must already exist (they must have signed in at least once) before
this command can grant them anything — it is documented, in the script's own
header and reproduced here, not hidden.

### Upgrade sequence

```bash
# 1. (Recommended — see Database Backup Boundary below) back up the database.
# 2. Pull the new application version / image.
# 3. Apply any new migrations. Same command as install — Prisma skips
#    already-applied ones.
npm run prisma:migrate:deploy
# 4. Restart the application container.
docker compose up -d --build web
```

No bootstrap re-run is required for an upgrade — bootstrap concerns
environment-specific state (the platform tenant, its operators), not
anything a schema migration introduces.

### Rollback / recovery

**Explicitly unsupported: Prisma Migrate has no automatic rollback.** This
is stated plainly rather than implied or left for someone to discover the
hard way — Prisma's own documented position is that migrations are
forward-only; there is no `prisma migrate rollback` and never was one in
this history.

**Recovery strategy, documented instead of a fabricated rollback**:
1.  A backup taken before migration (see next section) is the actual
    recovery path — restore it.
2.  For a migration that has not yet been applied to any real deployment,
    the correct fix is deleting the bad migration directory and writing a
    corrected one — safe only before the migration ships anywhere real.
3.  For a migration already applied somewhere, the correct fix is a NEW
    forward migration that undoes or corrects the effect — never editing or
    deleting a migration file that has already run in any real environment
    (`migration_lock.toml`'s own header: "Please do not edit this file
    manually," and the same principle extends to already-applied migration
    files by Prisma's own convention and this project's own established
    practice — Task 26's incident notes a stale `_prisma_migrations` ledger
    row being corrected by deleting only the ROW, never the migration file
    itself, after confirming via SHA256 comparison there was no real drift).

No automatic rollback was built, tested, or claimed. This matches the task's
own explicit instruction: "Never claim automatic rollback without testing
it."

### Database backup boundary

Task 33 owns formal backup/restore verification and is explicitly not
expanded here. Stated plainly, as instructed: **yes, production deployment
tooling is expected to take a backup before running migrations** — this is
standard operational practice for any schema-migrating deployment and is
consistent with "Recovery strategy" above (a backup is the actual rollback
mechanism, given Prisma has none). No backup tooling was built in this task;
the upgrade sequence above names the step and defers its implementation to
Task 33.

### Files changed
*   **New**: `prisma/operator-bootstrap-core.ts` — the extracted, testable
    `bootstrapOperator()` function.
*   **New**: `src/test/bootstrap-operator.test.ts` — 4 DB-gated tests
    (grants authority to a known identity using the existing platform
    tenant; idempotent on a second call; throws for an unknown identity
    without creating anything; leaves the shared "Verity Operator" role's
    own grant undisturbed).
*   `prisma/bootstrap-operator.ts` — reduced to a thin CLI wrapper around
    the extracted core; the `auth.users` portability guard (see above) lives
    in the extracted core, so this file's own diff is almost entirely
    deletion.
*   `package.json` — added `bootstrap:operator` and `prisma:migrate:deploy`
    scripts, matching the existing `seed`/`prisma:migrate:dev`/`prisma:push`
    naming convention. No other script changed.
*   **No migration file changed.** No schema change. No business/domain
    model touched. `prisma/seed.ts` untouched (see the scope correction
    above for why).

### Tests executed
*   `npx vitest run src/test/bootstrap-operator.test.ts` — 4/4 passed,
    isolated, first. **Ran against the real shared development database**
    (no Docker/throwaway instance was available — see Limitations), which
    made cleanup correctness a real, not theoretical, concern: an early
    version of this test's teardown deleted the test tenant and the
    platform-tenant membership it created, but not the global `Party`/`User`
    rows (which are NOT removed by deleting a tenant — global tables per
    Bible V2 Primitive 2 §2, the same fact `identity-membership.test.ts`'s
    own teardown comment already documents). This was caught by directly
    querying the database after the first run, found one leftover `Party`
    row, cleaned it up manually, fixed the teardown to match
    `identity-membership.test.ts`'s established deletion order (`user` →
    `party` → `tenant`), and re-verified the database was returned to
    exactly its pre-test state (`SELECT` counts before and after are
    identical). Recorded here in full rather than glossed over, because it
    is exactly the kind of mistake that matters most on shared,
    production-adjacent state.
*   `npx vitest run src/test/bootstrap-operator.test.ts src/test/identity-membership.test.ts src/test/operator-boundary.test.ts src/test/hq-administration.test.ts` — 37/37 passed together (every test file touching identity, membership, or operator authority).
*   `npx tsx prisma/bootstrap-operator.ts` (no argument) — confirmed the CLI wrapper still resolves its import of the extracted core and preserves its exact "usage" error / exit-code-1 behavior, with no database touched (fails before any query).
*   `npm run typecheck` — clean.
*   `npm run lint` — clean (same one pre-existing, unrelated `SmartTable.tsx` warning as every prior Phase 7 task).
*   `npm run test` (full suite) — **511/511 passed**.

### End-to-end results

**Could not perform a genuinely fresh-database end-to-end test** (empty
PostgreSQL → migrate → bootstrap → start → verify) — no Docker daemon was
available in this environment, the same limitation Task 30 named plainly
rather than working around. What WAS verified, and is the closest available
substitute:
*   Full static audit of all 41 migrations for destructive operations,
    extension requirements, and ordering (this section, above) — not a
    replay, but a genuine line-by-line check, not a skim.
*   `bootstrapOperator()`'s actual behavior — including its idempotency
    claim — verified by running it twice against a real database and
    inspecting the resulting rows directly, not merely asserting the
    function's return value.
*   The migration history's own prior "reproduced from empty" finding
    (`20260822000000_required_extensions`'s header, referencing a named
    investigation document) is historical evidence this exact question was
    answered once already, for an earlier point in the same history.

### Limitations
*   **No Docker daemon was available in this environment** — the actual
    "empty PostgreSQL → migrate → bootstrap → start → verify" sequence from
    a genuinely clean container/volume was not executed. This is the single
    most important gap in this task's verification, named plainly: before
    this is trusted for a real customer install, someone with Docker should
    run `docker compose down -v && docker compose up -d db`, then the
    deployment sequence above, against a truly empty volume.
*   `prisma/bootstrap-operator.ts`'s `auth.users` portability fix is
    verified by reading (the `to_regclass` guard is straightforward,
    standard PostgreSQL), but was NOT exercised against an actual bare
    Postgres instance without an `auth` schema — the shared development
    database used for real testing here has Supabase's `auth` schema, so
    the `has_auth_users` branch that was actually exercised by the tests is
    the `true` branch. The `false` branch (no `auth` schema) is
    logically verified, not empirically run.
*   Rollback is confirmed unsupported by Prisma's own design, not
    independently re-tested (there is nothing to test — the absence of a
    `rollback` command is a documented product fact, not a behavior this
    project could exercise).
*   No formal backup/restore tooling exists yet — correctly deferred to
    Task 33, per this task's own boundary.

### Follow-up work
*   Task 33: build and verify actual backup/restore tooling; the upgrade
    sequence above names the step without implementing it.
*   Whoever has Docker available should run the genuinely-fresh end-to-end
    test this task could not perform, and additionally confirm the
    `auth.users`-absent branch of `bootstrap-operator.ts` against a bare
    `postgres:16-alpine` instance specifically (Task 30's Compose `db`
    service, never pointed at Supabase).
*   If a non-Supabase `AuthProvider` (Task 28's stated future direction) is
    ever built, `prisma/seed.ts`'s dev-fixture approach (writing directly
    into `auth.users`) will need an equivalent for that provider — flagged,
    not solved here, since `seed.ts` was explicitly out of scope for this
    task.

### Final status
**Task 31 — COMPLETE, with one named limitation (no Docker daemon available
to perform the actual empty-database end-to-end deployment test).** Ready
for Antigravity review, with that limitation explicitly flagged for
follow-up before this is trusted for a real customer install.
