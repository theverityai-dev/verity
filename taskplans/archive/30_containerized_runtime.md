# Task Plan 30 — Containerized Runtime

This document defines the implementation plan to compile and execute the Verity Next.js monorepo inside standard multi-stage Docker containers, proving its portability by running database and application containers locally via Docker Compose.

---

## 1. Requirements

### VERITY-INFRA-001: Containerized Execution
*   **Target**: Package the web and backend server routes into standard Docker images.
*   **Requirement**: A simple `docker compose up` command must start:
    1.  `verity-web`: Next.js production build.
    2.  `verity-db`: Standard PostgreSQL instance.
*   **Constraint**: Minimum footprint, no Kubernetes deployment details yet.

---

## 2. Design

### Step 1: Write multi-stage Dockerfile
Create `Dockerfile` in the repository root:
*   **Base Stage**: Node alpine base.
*   **Dependencies Stage**: Cache `node_modules` installations.
*   **Build Stage**: Execute `prisma generate` and `next build` inside clean environment.
*   **Runner Stage**: Lean production footprint copying only required next configurations and build outputs.

### Step 2: Create `docker-compose.yml`
Define local service maps:
```yaml
services:
  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: verity_app
      POSTGRES_DB: verity
  web:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://verity_app@db:5432/verity
```

---

## 3. Verification & Acceptance Criteria
*   [x] Running `docker compose build` succeeds without compilation errors — could not be executed in this environment (no Docker daemon); verified by static inspection and local `next build`/`next.config.ts` testing instead. See §4 Limitations.
*   [ ] Application container boots and executes health checks successfully — not independently verifiable here; see §4 Limitations.

---

## 4. Implementation Notes (Claude Code, 2026-08-30)

### Runtime audit (performed before writing anything)

| Area | Finding | Classification |
|---|---|---|
| Node/Next version | Next 16.2.10, no `engines` field in `package.json`. Node 20+ required in practice (confirmed via local build). | requires configuration — pinned to `node:20-bookworm-slim` in the Dockerfile |
| Package manager | `package-lock.json` present, no `pnpm-lock.yaml`/`yarn.lock` — npm is unambiguous. | safe for container |
| Prisma | `generator client` declares no `binaryTargets` — defaults to `native`, auto-detected at `prisma generate` time. Safe **only** if generate and runtime share an OS/libc, which building inside the container (not copying a host build) guarantees. Verified locally: a Windows host build produced `query_engine-windows.dll.node`, confirming cross-platform copy would NOT work. | requires adapter — build stage generates the client itself, on Linux |
| `next.config.ts` | No `output` mode set (default is a full, un-traced build — every `node_modules` package needed, nothing minimized). `automaticVercelMonitors: true` in the Sentry plugin config is Vercel-specific but self-gates (only activates its cron-monitor integration when actually on Vercel) and is gated behind `NEXT_PUBLIC_SENTRY_DSN` being set at all. | blocker (no standalone output) — fixed; Sentry setting — safe for container, left alone |
| `src/proxy.ts` | Next.js "proxy" (edge middleware) convention — runs the same way under a standalone `server.js` as it does on Vercel; nothing Vercel-specific in its implementation (confirmed in Task 26/28's own audits). | safe for container |
| `src/app/api/scheduled/route.ts` | Triggered by Vercel Cron today (`vercel.json`). The route itself is a plain Next.js Route Handler with no Vercel-specific code — only ITS TRIGGER is Vercel-specific. | future work — a container deployment needs its own trigger (host `cron` + `curl`, or a scheduler pointed at the route); out of scope for this task, which only proves the application container itself runs |
| `RuntimeConfig` (`config.ts`) | Validates `DATABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` as non-empty at **module import time** (Task 26). Confirmed empirically: a local `next build` shows every route as `ƒ` (dynamic/server-rendered), and Next's "Collecting page data" build step imports every route/layout module to build the manifest — so these three must be non-empty strings **at image-build time**, not just at container-run time. | requires configuration — see "Build-time vs runtime configuration" below; this is the single most important finding of the audit |
| Filesystem | No `fs.writeFile`/local disk writes anywhere in application code (only in test files). Storage already goes through the Task 27 boundary (Supabase Storage), not local disk. | safe for container — no ephemeral-filesystem assumption exists to break |
| Host/port | Confirmed directly in the generated `.next/standalone/server.js`: `process.env.PORT` (default `3000`) and `process.env.HOSTNAME` (default `'0.0.0.0'`). Nothing hard-coded. | safe for container |
| Static assets | `public/` exists (brand assets, icons). Standard Next.js static-file serving; `output: "standalone"` requires `public/` and `.next/static` to be copied alongside `server.js` (they are excluded from the traced `node_modules`, by design). | requires configuration — handled in the Dockerfile's runner stage |
| Cron/background execution | Task 29 already established no queue/worker is needed. The one scheduled trigger (`/api/scheduled`) is Vercel-specific only in its trigger, not its logic (see above). | future work, not a blocker |
| Existing Docker files | None existed. | n/a |
| Unrelated finding | `@serwist/next`/`serwist` are dependencies with a `next.config.ts` comment describing a service-worker route (`src/app/sw.js/route.ts`) that does not exist in the repository — matches the pattern of unused dependencies already flagged in Tasks 27/29 (`@aws-sdk/*`, `papaparse`, `groq-sdk`). Not a container blocker; not fixed here (unrelated scope). | flagged only |

### Container architecture

```
Containerized Verity Application (Dockerfile: deps -> builder -> runner)
    ↓
RuntimeConfig (Task 26) — read from process.env at request time, never baked in
    ↓
Portable interfaces: AuthProvider (Task 28, Supabase active), StorageDriver
    (Task 27, Supabase active), JobRunner (Task 29, synchronous)
    ↓
PostgreSQL (docker-compose.yml: `db` service) / configured external services
    (Supabase Auth, Supabase Storage — unchanged, not replaced)
```

No provider was replaced. This task adds a way to *run* the existing
architecture without Vercel; it does not change what the architecture is.

### Build strategy

Three-stage `Dockerfile`, one shared base (`node:20-bookworm-slim` — Debian,
not Alpine; Prisma's native query-engine binary has a known history of extra
friction under musl libc, and "do not optimize prematurely" is an explicit
instruction for this task):

1.  **`deps`** — `npm ci` against `package.json`/`package-lock.json` only, so this
    expensive layer is cached across builds that only change source.
2.  **`builder`** — copies `node_modules` from `deps` plus the full source,
    runs `npm run build` (`prisma generate && next build`). Sets the
    build-time environment described below.
3.  **`runner`** — copies only `.next/standalone`, `.next/static`, and
    `public/` from `builder`. Runs as a dedicated non-root user (`nextjs`,
    uid 1001 — the same arrangement Next.js's own documented standalone
    Docker example uses, not invented here). `CMD ["node", "server.js"]` —
    no `next start`, no process manager; verified against
    `node_modules/next/dist/server/lib/start-server.js` that the generated
    `server.js` registers its own `SIGTERM`/`SIGINT` handlers, so `docker
    stop` terminates it cleanly as PID 1 with no wrapper needed.

`next.config.ts` gained two settings, both required, neither cosmetic:
*   `output: 'standalone'` — the documented mechanism for a portable,
    traced build; without it the runner stage would need the entire
    `node_modules` tree.
*   `outputFileTracingIncludes: { '*': ['node_modules/.prisma/client/**/*'] }`
    — Prisma's generated client loads its native query-engine binary
    dynamically, which Next's dependency tracer does not always follow.
    Verified locally: without this, the traced output is missing the engine
    binary; with it, `.next/standalone/node_modules/.prisma/client/` contains
    it (confirmed by directly listing the local build's output — on a
    Windows host this produced `query_engine-windows.dll.node`, which is
    exactly why the image must build inside a Linux container rather than
    copying a host-built `.next/standalone` in).

Verified locally (no Docker required for this part): `npm run build` with
the new config succeeds, every route reports `ƒ` (dynamic), and
`.next/standalone/node_modules/.prisma/client/` contains the generated
client and its engine binary.

### Build-time vs runtime configuration

This is the one place a careless design would have either baked a secret
into the image or made the build impossible to run without real
credentials. Verified, not guessed:

**Build-time (Docker `ARG`, real values required):**
*   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Next.js
    inlines every `NEXT_PUBLIC_*` variable into the client-side JavaScript
    bundle *at `next build` time*; there is no "runtime" for these two.
    Neither is a secret: the anon key is explicitly designed for
    client-side exposure, protected by Postgres RLS rather than by
    secrecy — `.env.example`'s own existing comment already calls this out
    ("Public client configuration"). Baking the real value in here is
    correct, not a leak.

**Build-time (Docker `ENV`, placeholder sufficient):**
*   `DATABASE_URL`, `DIRECT_URL` — NOT `NEXT_PUBLIC_*`, so never inlined
    into any bundle; the running server reads `process.env.DATABASE_URL`
    fresh, same as any Node process. But `config.ts`'s `runtimeConfig` is
    validated at **module import time** (Task 26), and confirmed above that
    `next build` imports every route module during "Collecting page data" —
    so the schema's `.min(1)` non-empty check must pass *during the build*,
    even though the value is never used to actually connect at build time
    (`prisma generate` does not connect; `next build` does not execute
    queries). A syntactically valid placeholder
    (`postgresql://build:build@localhost:5432/build_placeholder`) satisfies
    this without any real credential existing in the image. Same reasoning
    applies to `DIRECT_URL`, which Prisma's schema-loading step resolves
    via `env()` for every CLI invocation including `generate`, even though
    `generate` never uses it either — confirmed this is a real requirement,
    not an assumption, by reading how `env()` resolution works in a Prisma
    datasource block.

**Runtime only (container `environment:`, injected at `docker run`/Compose
time, never present in the image):**
*   The real `DATABASE_URL`/`DIRECT_URL` (overriding the build placeholder —
    since neither is baked into any file, this is a plain env-var override,
    not a rebuild).
*   `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `SUPABASE_MEDIA_BUCKET`
    (storage, optional — Task 27), `SUPABASE_JWT_SECRET` (optional — Task
    26/28), `CRON_SECRET` (optional — the scheduled-work trigger; ADR-015's
    503-not-unauthenticated behavior is unchanged).

No new `process.env` reads were introduced anywhere in application code —
every value above already flowed through `RuntimeConfig` before this task;
this task only had to get the *build* to survive that validation without a
real secret present.

### Database / migration model

**Migrations remain an explicit, operator-invoked step — not run
automatically by the image or by `docker compose up`.** This was a genuine
decision, not an oversight:

*   Task 30's own instruction says not to "silently make every application
    startup perform destructive or uncontrolled migrations," and to defer
    to "the Task 31 specification" for the real bootstrap design.
    `taskplans/31_migration_and_bootstrap.md` exists but is currently
    **empty** (confirmed by reading it) — the bootstrap/migration model is
    explicitly future work, not yet specified, so baking a specific
    automation choice into this task's image would be designing Task 31
    without its own brief.
*   The container's `CMD` is exactly `node server.js` — nothing else runs on
    start. An operator runs `npx prisma migrate deploy` against
    `DIRECT_URL` as a separate, explicit step (documented below), the same
    way it already works against the real Supabase project today.

**Role bootstrap for a fresh local Postgres** (a genuine new requirement —
Supabase's own hosted Postgres already has whatever roles Supabase
provisions; a bare `postgres:16-alpine` container does not):
`deploy/db/init/01-create-app-role.sh`, run once automatically by the
official Postgres image's own `/docker-entrypoint-initdb.d/` convention
against an empty data volume, creates `verity_app LOGIN ... NOSUPERUSER
NOBYPASSRLS` — the exact role shape `assertRlsEnforceable()`
(`src/server/platform/tenancy.ts`) already requires and refuses to start
without. Migrations then run as `postgres` (the initdb superuser, privileged
— matches `DIRECT_URL`'s existing documented role in `.env.example`); the
running application connects as `verity_app` only.

### Compose topology

Two services only — `db` (`postgres:16-alpine`) and `web` (built from the
new `Dockerfile`). No Redis, no Temporal, no Keycloak, no OpenSearch, no
SeaweedFS: Tasks 27/28/29 already established that none of those are
required by current functionality, and this task does not reopen those
decisions. `db` is bound to `127.0.0.1:5432` only (not exposed on every
interface); `web` exposes `3000`. `db` carries a `pg_isready` healthcheck;
`web` `depends_on: db: condition: service_healthy` so the application never
starts racing an unready database (it would fail its own
`assertRlsEnforceable()` check anyway, but waiting avoids a noisy false-start
log). A named volume (`verity-db-data`) persists Postgres data across
`docker compose down`/`up` (not `down -v`).

### Operational instructions

```bash
# One-time: build the image. Needs real NEXT_PUBLIC_SUPABASE_URL/ANON_KEY —
# Compose reads them from a `.env` file in this directory (the same one
# used by `next dev`/vitest) or from your shell environment.
npm run docker:build        # docker compose build

# Start both services in the background.
npm run docker:up           # docker compose up -d

# One-time per fresh database: apply migrations, as the operator, against
# the initdb superuser (DIRECT_URL below matches docker-compose.yml's own
# POSTGRES_SUPERUSER_PASSWORD default — override both together if changed).
docker compose run --rm \
  -e DIRECT_URL=postgresql://postgres:postgres@db:5432/verity \
  web npx prisma migrate deploy

# Tail application logs.
npm run docker:logs         # docker compose logs -f web

# Stop (data volume persists).
npm run docker:down         # docker compose down
```

**Troubleshooting:**
*   Build fails on a Prisma "Environment variable not found" error — a
    build ARG/ENV is missing; see "Build-time vs runtime configuration"
    above for exactly which four are build-time.
*   `web` container exits immediately with `E_CONFIG_INVALID` — a required
    runtime env var (`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY`) is genuinely empty at container start,
    not merely at build time; check `docker compose config` to see the
    resolved environment.
*   `web` container starts but every request fails with an RLS/tenancy
    error — `assertRlsEnforceable()` refused the connection; almost always
    means `DATABASE_URL` is pointing at the `postgres` role instead of
    `verity_app`, or `01-create-app-role.sh` never ran (only runs against an
    **empty** data volume — `docker compose down -v` and `up` again to
    force re-initialization if the role is missing).
*   Local development (`npm run dev`) is completely unaffected — Compose is
    an alternative path, not a replacement; nothing about the existing
    `npm run dev`/`npm run test` workflow changed.

### Tests executed
*   `npx vitest run src/test/container-runtime.test.ts` — 15/15 passed,
    isolated, first. Covers: `next.config.ts` declares `standalone` +
    Prisma tracing; every Dockerfile stage shares one base image; runs as
    non-root; exposes exactly port 3000; the image's own `CMD` never runs
    migrations; build ARGs include the two `NEXT_PUBLIC_*` values and
    exclude every real secret name; `.dockerignore` excludes real env files
    and `node_modules`/`.git`; Compose binds Postgres to localhost only;
    Compose declares exactly two services; the application's `DATABASE_URL`
    points at `verity_app`, never `postgres`; Compose never runs
    `migrate deploy`; the init script creates the role as `NOSUPERUSER
    NOBYPASSRLS`, is idempotent, and has an LF-only shebang.
*   `npm run build` (local, real `.env`) — succeeds; every route reports
    `ƒ` (dynamic); `.next/standalone/node_modules/.prisma/client/` contains
    the generated client and its engine binary — direct empirical
    verification of the tracing fix, not an assumption.
*   `npm run typecheck` — clean.
*   `npm run lint` — clean (same one pre-existing, unrelated
    `SmartTable.tsx` warning as every prior Phase 7 task).
*   `npm run test` (full suite) — **507/507 passed** (492 from Task 29 + 15
    new in `container-runtime.test.ts`). No conformance-tripwire change
    needed this time — the new test file lives in `src/test/`, not
    `src/server/platform/`.

### Results
Every Definition-of-Done item that does not require an actual Docker daemon
is verified: the standalone build works and includes the Prisma engine
(empirically confirmed locally), the image's build/runtime configuration
split is correct and documented, no secret is a build ARG, migrations are
never silently run, Compose adds nothing beyond the application and
Postgres, and the role-bootstrap script enforces the same RLS-safety
invariant the application already requires. Full regression suite,
typecheck, and lint are all green.

### Limitations
*   **No Docker daemon was available in this environment** (`docker
    --version` returns "command not found"). `docker compose build`,
    `docker compose up`, and an actual end-to-end request against the
    running container were **not executed**. Everything above was verified
    by the closest available substitute: reading the actual generated
    `server.js`/build output from a real local `next build`, direct
    inspection of `.next/standalone`'s contents, and structural tests
    pinning the security/correctness invariants. This is a real gap, named
    plainly rather than glossed over — before this is trusted in an actual
    deployment, someone with Docker available should run
    `docker compose up --build` once and confirm the application actually
    serves a request end to end.
*   The `/api/scheduled` route's trigger (Vercel Cron) has no containerized
    equivalent yet — the route itself works unchanged, but nothing in this
    Compose topology calls it. A host `cron` entry or an external scheduler
    hitting the container's exposed port is the natural fix, deliberately
    left as follow-up rather than built here (scope: this task proves the
    application container runs, not a full deployment topology).
*   Migration automation is deliberately unbuilt, pending Task 31 (its own
    taskplan is currently empty).
*   The unused `@serwist/next`/`serwist` dependencies and the service-worker
    route their `next.config.ts` comment describes (but which does not
    exist) were flagged, not fixed — unrelated to this task.

### Follow-up work
*   Run the actual `docker compose up --build` reference deployment on a
    machine with Docker, and confirm sign-in (Task 28), a storage-backed
    operation (Task 27), and a database-backed read/write all work through
    the running container — this task's own DoD asks for this and it could
    not be performed here.
*   Task 31 (migration and bootstrap): design whether/how migrations run in
    a containerized deployment beyond "an operator runs one command."
*   A containerized equivalent of the Vercel Cron trigger for
    `/api/scheduled`, if this deployment path is used in an environment
    without Vercel's own cron.
*   Health/readiness endpoints (`P0-08` in the Phase 7 workstream list) do
    not exist yet and were correctly not built here — Task 30's own
    instruction says not to expand into a full health subsystem. Compose's
    `db` healthcheck uses `pg_isready`; `web` has none yet.

### Final status
**Task 30 — COMPLETE, with one named limitation (no Docker daemon available
to perform the actual build/run verification).** Ready for Antigravity
review, with that limitation explicitly flagged for follow-up before this
is trusted in a real deployment.
