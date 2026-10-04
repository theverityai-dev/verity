# Task Plan 43 — Full Docker Acceptance

**Phase 8, Task 8 of 9.** Control document: `35A_phase8_execution_program.md`.
**Depends on:** Task 42 (the package being accepted).
**Gates owned:** G01, G02, G10, G12. Closes the Phase 7 caveat.

---

## 1. Objective

**Empirical.** Not a description of a deployment — a deployment.

Phase 7 closed with two acceptance criteria marked NOT EXECUTED because no
Docker daemon was available (`35_phase7_closeout.md` §5). This task provisions
one and runs the whole path for real, from nothing.

---

## 2. Starting State — Required

*   No Verity containers.
*   No Verity database volume.
*   No Verity object-store volume.
*   No built image reused from a previous run.

Anything less proves the second run, not the first, and the first is the one a
customer performs.

---

## 3. The Path

```text
docker compose build
        ▼
docker compose up
        ▼
database ▶ migration ▶ bootstrap ▶ application
        ▼
login ▶ core workflow ▶ file upload
        ▼
health ▶ readiness
        ▼
backup ▶ restore
        ▼
restart
```

## 4. Failure Scenarios

Also exercised, because a deployment that only works is not yet operable:

*   database unavailable
*   invalid configuration
*   storage unavailable
*   application restart

---

## 5. Evidence Standard

Every step records the command and its actual output. A step that cannot be run
is recorded NOT EXECUTED with the reason and the remediation — never simulated,
never inferred. This is the Phase 7 discipline (`35_phase7_closeout.md` §9) and
it is why the phase is worth anything.

---

## 6. Acceptance Criteria

*   [x] AC-01 `docker compose build` succeeds from a clean context.
*   [x] AC-02 `docker compose up` brings the stack to healthy.
*   [x] AC-03 Migrations apply to an empty containerized database.
*   [x] AC-04 Bootstrap runs in the container and is idempotent.
*   [x] AC-05 The application serves traffic.
*   [x] AC-06 Authentication boundary behaves correctly in the container.
*   [x] AC-07 A core workflow executes against the containerized database.
*   [x] AC-08 A file round-trips through the containerized object store.
*   [x] AC-09 `/api/health` and `/api/ready` answer correctly.
*   [x] AC-10 Backup and restore complete, verified.
*   [x] AC-11 The stack survives a restart with its data.
*   [x] AC-12 Database unavailable → readiness fails, liveness does not.
*   [x] AC-13 Invalid configuration is refused with a named error.
*   [x] AC-14 Storage unavailable degrades rather than crashing.

---

## 7. Execution Record (Claude Code, 2026-08-30 / 31)

### Status: COMPLETE — EXECUTED. The Phase 7 caveat is closed.

### Environment

No Docker daemon existed on this machine. One was provisioned:

```text
colima start --cpu 2 --memory 4 --disk 20
docker version   → server 29.5.2
docker compose   → 5.5.0
```

Identity provider for the run: a real Keycloak 26.0 (`start-dev`) on the
compose network, realm `verity`, public client `verity-web`. It is **test
infrastructure, not a dependency** — Task 36 forbids making Keycloak mandatory,
and nothing in the package references it.

Starting state: no Verity containers, no Verity volumes, no Verity images.

### The path, as executed

| Step | Command | Result |
|---|---|---|
| preflight | `deploy/security/preflight.sh` | refused a Supabase deployment with no credentials; passed once configured for OIDC |
| build | `docker compose build` | `verity:local` and `verity-tools:local` built |
| up | `docker compose up -d` | `db healthy`, `objects healthy`, `web healthy` |
| migrate | `deploy/scripts/migrate.sh` | `migrations applied` — 42 migrations against an empty containerized database |
| bootstrap | `deploy/scripts/bootstrap.sh` | `granted operator membership to operator@verity.test`; second run: `already an operator` |
| application | `GET /` | 307 to sign-in when unauthenticated |
| **login** | `GET /` with a Keycloak id token | **200** |
| core workflow | command → policy → audit → event | see below |
| file upload | S3 driver against containerized MinIO | see below |
| health | `GET /api/health` | 200, with build identity |
| readiness | `GET /api/ready` | 200, with probe duration |
| backup | `deploy/scripts/backup.sh` | 394,743 bytes, verified by reading it back |
| restore | `deploy/scripts/restore.sh` | row counts identical, healthy after |
| restart | `docker compose restart` | data intact, login works |

### Login, in detail (AC-06)

```text
no token                        → 307   (redirected to sign-in)
malformed token                 → 307   (a bad token is not distinguishable from none)
expired token                   → 307   (observed naturally: Keycloak's 5-minute lifetime)
valid token, no Verity identity → 307   (fails closed — Verity never provisions from a token)
valid token, provisioned user   → 200
```

The fourth line is the one worth reading. A genuine, signed, unexpired token
from the corporate IdP grants **nothing** until an identity with a membership
exists in Verity. That is ADR-007 holding in a container, not in a unit test.

### Core workflow (AC-07)

One command execution against the containerized database:

```json
{"commandExecuted":true,"historyEntries":3,"changes":2,"facts":1,
 "oneCorrelationId":true,"sourceRecorded":true,
 "priceBefore":"1000","priceAfter":"1250",
 "secretWithheld":true,"secretChangeStillRecorded":true,
 "unauthorizedVerbDenied":true,
 "denyReason":"role holds no Delete grant on verity.acceptance.contract"}
```

Capability activation, the Task 37 decision point, the Task 38 audit trail with
correlation and source, event emission and reconstruction — all live, all in the
container, with the secret withheld while the fact that it changed is kept.

### File upload (AC-08)

```json
{"driver":"s3:verity-media",
 "key":"43039466-…/20b33048-…/acceptance-evidence.txt",
 "tenantNamespaced":true,"uploaded":true,
 "checksumMatched":true,"deletedAndGone":true}
```

Presigned PUT to the containerized MinIO, read back, compared by SHA-256, then
deleted and confirmed gone. Task 41's driver, unchanged, against a container.

### Failure scenarios (AC-12 → AC-14)

| Scenario | Observed |
|---|---|
| database stopped | liveness **200**, readiness **503** naming `db:5432` — the exact separation Task 32 exists for |
| database restarted | readiness returned to 200 **without restarting the application** |
| invalid configuration | `E_CONFIG_INVALID: DATABASE_URL is required; VERITY_OIDC_ISSUER and VERITY_OIDC_CLIENT_ID are required when VERITY_AUTH_PROVIDER=oidc` |
| placeholder secret | `PREFLIGHT FAIL: CRON_SECRET is still the example placeholder` |
| world-readable env file | every script refused: `is mode 644; it holds credentials` |
| no password at all | compose refused: `set POSTGRES_SUPERUSER_PASSWORD in the env file` |
| object store stopped | application kept serving; readiness stayed 200 — storage is optional and refuses at the point of use, by design |
| application restarted | recovered to 200, data intact |

### Five defects found — none of which any unit test could have found

**1. An OIDC-only image could not be built.**
`next build` imports every route module, and `config.ts` validates the Supabase
variables at import time when the provider is `supabase` (its default at build).
An OIDC deployment has no Supabase project, so the image failed with
`E_CONFIG_INVALID`. The boundary Task 36 built was real in the code and
fictional in the package. Fixed with build-time placeholders in the `builder`
stage, which cannot reach the runtime image because `runner` starts from `base`.

**2. The runtime image cannot run migrations, and the scripts asked it to.**
`.next/standalone` is a traced subset: no Prisma CLI (a devDependency), no
`prisma/migrations/`, no network to fetch either. Task 42's `migrate.sh` and
`bootstrap.sh` were written against `web`. Fixed with a `tools` stage carrying
the full dependency tree and the schema, used by those two scripts and by
nothing that serves traffic — the runtime image stays minimal and the migration
path stops depending on a container that was deliberately stripped.

**3. `COPY src/lib` — a directory that does not exist.** Trivially fixed, and
only discoverable by building.

**4. Empty-string environment variables defeated the configuration fallbacks.**
The important one.

Docker Compose renders `${FOO:-}` for an unset optional variable as an **empty
string**, not an absent one. `a ?? b` falls through only on `null`/`undefined`,
so `SUPABASE_JWT_SECRET ?? VERITY_SESSION_SECRET` kept the empty string and the
deployment failed with `E_CONFIG_INVALID` — while **every unit test passed**,
because a test that *deletes* a variable produces `undefined` and never
reproduces the shape a container actually gets.

The symptom was worse than the cause: API routes worked (`/api/health` and
`/api/ready` both 200) while every page returned 500, because server chunks
resolve `process.env` at runtime and client-graph SSR chunks had the value
inlined at build. A deployment that passes its own health checks and serves no
pages is the single most confusing failure in this list.

Fixed in `config.ts` with one `env()` helper that treats blank as absent, plus
three regression tests that set variables to `""` rather than deleting them.

**5. Backup verification used the host's `pg_restore`.** A v14 client cannot
read a v16 server's archive: `unsupported version (1.15) in file header`. That
says nothing about the backup and everything about the operator's laptop — and
it would teach them to distrust a good backup. Verification now always runs
inside the container, whose client is the server's version by construction.

### What this closes

Phase 7 ended with AC-01 and AC-02 marked NOT EXECUTED for want of a daemon
(`35_phase7_closeout.md` §5). Both are now executed, along with everything
downstream of them. **G01, G02, G10 and G12 are live-verified.**

### Deliberately not claimed

*   **Zero downtime.** One container restarts; there is a gap of seconds.
*   **Multi-replica.** Not exercised. The application is stateless and nothing
    prevents it, but "not exercised" is not "works".
*   **The authorization-code redirect flow.** Task 36 scoped it out. The login
    proven here carries a verified id token; a browser redirect flow that *sets*
    that cookie is unbuilt, and the acceptance says so rather than implying a
    sign-in button exists.
*   **Production hardware.** 2 vCPU, 4 GB, macOS/QEMU. Functional evidence, not
    performance evidence.
