# Verity — Local/Self-Hosted Deployment Runbook

Operator-facing. Covers the full first-time path: build the image, start
the database and the application, migrate, bootstrap the first operator,
verify, and day-2 operations.

Every command in Sections 2 and 3 has been run in this exact form against
the real application and a real PostgreSQL database on 2026-08-30 (Step
2b–2d against a genuinely fresh, freshly-migrated database; Step 1's
`docker compose build`/`up` specifically were **not** — see
`taskplans/archive/34_portable_runtime_acceptance.md` for the exact acceptance
record and why). This is the procedure to follow, not a design document.

---

## 1. Prerequisites

* **Docker** with Compose v2 (`docker compose`, not the standalone
  `docker-compose` v1 binary).
* **A Supabase project** (cloud or self-hosted) for authentication — Task
  28 abstracted the auth boundary but did not replace the provider; Supabase
  Auth is still the active `AuthProvider`. You need its project URL and anon
  key.
* Nothing else. No Vercel account, no Supabase CLI, no additional
  infrastructure — Tasks 27/28/29 already established that storage, auth,
  and background work need nothing beyond what is listed here.

---

## 2. First-time setup

### 2a. Build the image

```bash
# NEXT_PUBLIC_SUPABASE_URL/ANON_KEY are genuinely build-time — Next.js
# inlines NEXT_PUBLIC_* into the browser bundle at build time (Task 30).
# Neither is a secret: the anon key is designed for this exposure,
# protected by PostgreSQL RLS, not secrecy.
docker compose build
```

Compose reads `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`
(and every other variable `docker-compose.yml` references) from a `.env`
file in the same directory, or your shell environment. Use the same `.env`
you already use for `npm run dev` — the values Compose needs overlap with
it exactly.

### 2b. Start the database and application

```bash
docker compose up -d
```

Starts `db` (`postgres:16-alpine`) and `web` (the image built above). `web`
waits for `db`'s own healthcheck (`pg_isready`) before starting — see
`docker-compose.yml`'s `depends_on: db: condition: service_healthy`. On a
container's **first ever start** (an empty data volume),
`deploy/db/init/01-create-app-role.sh` runs automatically and creates the
`verity_app` role (`NOSUPERUSER NOBYPASSRLS` — required, see
`src/server/platform/tenancy.ts`'s `assertRlsEnforceable()`).

```bash
docker compose ps
# expect: db  running (healthy)
#         web running
```

### 2c. Migrate — schema first, always

```bash
docker compose exec web npx prisma migrate deploy
```

Applies all 41 migrations. **Verified reproducible from a genuinely empty
database** — proven twice in this session (Task 33's restore proof and
Task 34's own acceptance run), both times by direct execution against a
real fresh PostgreSQL database (not literally inside a container — see the
taskplan for why `docker compose exec` specifically could not be exercised
here). The command is identical either way; only which process runs it
differs.

**Do not skip this.** `web` does not run migrations on its own start (Task
30's own decision) — a container that starts successfully with an
unmigrated database will fail every request that touches the database,
including `/api/ready`.

### 2d. Bootstrap the first operator

Before this step, sign in through the running application at least once
with the identity you intend to grant operator authority to — this script
grants authority to an *existing* identity, it does not create one (Task
28's `AuthProvider` boundary owns credential creation; this script
deliberately does not).

```bash
docker compose exec web npx tsx prisma/bootstrap-operator.ts <email>
```

Idempotent — re-running it for the same email after it has already
succeeded reports `<email> is already an operator` and changes nothing
further. Verified live, including the idempotent re-run, in both Task 31's
and Task 34's own acceptance work — see either taskplan for the exact
output.

---

## 3. Verification

```bash
curl -s http://localhost:3000/api/ready
# expect: {"status":"ready","checks":{"db":"ok"}}

curl -s http://localhost:3000/api/health
# expect: {"status":"ok","version":"0.1.0"}
```

Then open `http://localhost:3000` in a browser — an unauthenticated visitor
is redirected to `/sign-in` (not a 500; this is `requireActor()`'s own
documented behavior, and is exactly what was observed running the real
application binary against a real fresh database while proving this
runbook). Sign in with the identity you granted operator authority to in
2d, and confirm the HQ console loads.

---

## 4. Day-2 operations

### Stop

```bash
docker compose down
```

Leaves the named volume (`verity-db-data`) intact — data survives.

### Start again

```bash
docker compose up -d
```

No re-migration or re-bootstrap needed; both are one-time setup, not
startup steps.

### Update to a new image

```bash
docker compose build
docker compose up -d --build web
docker compose exec web npx prisma migrate deploy   # applies only new migrations
```

### Backup

See `deploy/runbooks/backup-restore.md` — the full, proven procedure
(`pg_dump`/`pg_restore`, the exact exclusion list and why each table is
excluded, the one trigger that needs a temporary disable during restore,
and the recovery strategy for a failed restore). Not duplicated here.

### Fully destroy (including data)

```bash
docker compose down -v
```

Removes the named volume too — the **only** way to force
`01-create-app-role.sh` to run again on the next `up` (it only runs against
a genuinely empty data directory). Irreversible without a prior backup.

---

## 5. Troubleshooting

Reproduced from `taskplans/archive/30_containerized_runtime.md`'s own
troubleshooting section, which remains accurate:

* **Build fails on a Prisma "Environment variable not found" error** — a
  build ARG/ENV is missing; see that taskplan's "Build-time vs runtime
  configuration" section for exactly which values are build-time.
* **`web` container exits immediately with `E_CONFIG_INVALID`** — a
  required runtime env var (`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`) is genuinely empty at container start;
  check `docker compose config` to see the resolved environment.
* **`/api/ready` returns 503** — the database is unreachable, or migrations
  were never applied (Step 2c). The response body's `checks.detail` names
  the specific error (host:port only, never credentials — Task 32).
* **`web` starts but every request 500s with an RLS/tenancy error** —
  `DATABASE_URL` is pointing at the `postgres` role instead of
  `verity_app`, or `01-create-app-role.sh` never ran (only runs against an
  empty volume — `docker compose down -v && up` to force it, discarding
  data).
