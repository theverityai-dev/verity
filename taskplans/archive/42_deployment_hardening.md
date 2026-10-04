# Task Plan 42 — Deployment Hardening

**Phase 8, Task 7 of 9.** Control document: `35A_phase8_execution_program.md`.
**Depends on:** Tasks 36–41 (everything that must now be packaged).
**Gate owned:** G11 — hardened deployment package. Contributes to G01, G03.

---

## 1. Objective

Turn what exists into the **Verity Enterprise Deployment Package**: one
directory an operator is handed, containing everything needed to install, run,
back up, upgrade and verify Verity on their own infrastructure.

```text
deploy/
├── compose/      the runtime topology
├── scripts/      install · migrate · bootstrap · backup · restore · health · upgrade
├── config/       one documented environment template
├── security/     the hardening rules, and a preflight that enforces them
└── docs/         install, operations, upgrade
```

**No Kubernetes.** The architecture is one stateless application, one database
and one object store. Compose expresses that exactly; a Helm chart would add an
orchestrator's failure modes to a deployment that has none of its problems. If a
customer runs Kubernetes they can consume the same images.

---

## 2. What Is Being Hardened, and Against What

| Surface | Failure it prevents |
|---|---|
| Secrets | A deployment running on the documented example password |
| Runtime configuration | Booting with a configuration that cannot work |
| Exposed ports | A database reachable from the internet by default |
| Startup | The application serving traffic before its schema exists |
| Shutdown | In-flight requests killed rather than drained |
| Health checks | An orchestrator restarting a healthy process because a dependency blipped |
| Storage | A deployment that requires a cloud account to store a file |
| Identity | An OIDC deployment that silently falls back to something else |
| Backup | A backup nobody has ever restored |
| Upgrade | A migration applied with no way back |
| Logging | An unbounded log file filling the disk |
| Timezone | **See §3.** |

---

## 3. The Defect This Task Must Fix

Task 36 found it while proving something else: **three availability tests fail
against a PostgreSQL whose session timezone is not UTC.** They passed on the
hosted database (UTC) and failed on a locally provisioned cluster (IST).

`temporal.ts` states that instants are UTC. The database was never told. A
customer installing on an IST or PST host would get subtly wrong availability
and SLA behaviour, with every test in their CI still green.

The deployment package pins the database session timezone to UTC and the
preflight refuses a database that reports anything else. This is the single
highest-value line in the whole package, and it exists because a task ran on a
machine that was not the usual one.

---

## 4. Design Decisions

### 4.1 Secrets

*   No default passwords **anywhere in the compose file**. The current root
    `docker-compose.yml` defaults `POSTGRES_PASSWORD` to `postgres` and the
    application password to `verity_app_dev_password`. Convenient locally,
    catastrophic if it reaches a customer's server unchanged. The package's
    compose requires them and fails loudly when absent.
*   `install` generates strong values and writes them to a `0600` file.
*   `preflight` refuses to start production with a value that appears in the
    example file.

### 4.2 Exposed ports

The database and the object store publish **no host ports** in the package.
Services reach each other over the compose network. An operator who wants a
psql session forwards a port deliberately, for as long as they need it.

### 4.3 Startup ordering

`migrate` and `bootstrap` are **explicit operator steps**, never an image
entrypoint. Task 30 made that decision and it stands: baking `prisma migrate
deploy` into container start makes every restart — including an autoscaler's —
a potential schema change. `install` runs them in order, once, visibly.

### 4.4 Storage

MinIO is included as the reference self-hosted object store, wired through the
S3 driver Task 41 built. A `docker compose up` therefore yields a **working**
storage backend with no cloud account. It is the S3 contract, not a MinIO
dependency: the same variables point at AWS, Ceph, Wasabi or SeaweedFS's S3
gateway.

### 4.5 Container hardening

`no-new-privileges`, all capabilities dropped, non-root user (already in the
Dockerfile), bounded log files with rotation, resource limits, and a restart
policy that does not mask a crash loop.

### 4.6 Upgrade

`upgrade` takes a backup **first**, then pulls, then migrates, then restarts,
then verifies health — and refuses to proceed if the backup step fails. An
upgrade path whose first action is not a backup is not an upgrade path.

---

## 5. Files

```text
deploy/compose/docker-compose.yml        NEW — hardened topology
deploy/compose/docker-compose.minio.yml  NEW — the object store overlay
deploy/config/verity.env.example         NEW — every variable, documented
deploy/scripts/{install,migrate,bootstrap,backup,restore,health,upgrade}.sh  NEW
deploy/security/preflight.sh             NEW — refuses an unsafe configuration
deploy/security/hardening.md             NEW
deploy/docs/{install,operations,upgrade}.md  NEW
src/test/deployment-package.test.ts      NEW — the package's own conformance
```

---

## 6. Acceptance Criteria

*   [x] AC-01 The package contains every directory and script the brief names.
*   [x] AC-02 No default or example secret can reach a running deployment.
*   [x] AC-03 Database and object store publish no host ports.
*   [x] AC-04 The database session timezone is pinned to UTC and verified.
*   [x] AC-05 Migration and bootstrap are explicit steps, never an entrypoint.
*   [x] AC-06 Health, readiness and shutdown behaviour are configured correctly.
*   [x] AC-07 Logs are bounded.
*   [x] AC-08 `upgrade` backs up first and refuses to continue if that fails.
*   [x] AC-09 Every script is strict-mode, idempotent where it must be, and safe to re-run.
*   [x] AC-10 No secret value appears in any committed file.
*   [x] AC-11 Typecheck clean; suite green.

---

## 7. Implementation Notes (Claude Code, 2026-08-30)

### Status: COMPLETE — BUILT. Executed end to end in Task 43.

### What was built

```text
deploy/
├── compose/
│   ├── docker-compose.yml          hardened topology, no default secrets
│   └── docker-compose.minio.yml    the object-store overlay
├── config/verity.env.example       every variable, documented, no real value
├── scripts/
│   ├── _common.sh                  one project name, one env file, one failure mode
│   ├── install.sh   migrate.sh   bootstrap.sh
│   ├── backup.sh    restore.sh   health.sh   upgrade.sh
├── security/
│   ├── preflight.sh                refuses an unsafe configuration
│   └── hardening.md                every rule, with what enforces it
└── docs/install.md · operations.md · upgrade.md
```

38 tests in `src/test/deployment-package.test.ts` assert the properties the
hardening document claims. **A hardening document nothing enforces is a wish
list**, and the regression this guards against — someone adding a convenient
default password, or publishing the database port — would ship silently and work
perfectly.

### The highest-value line in the package

```yaml
TZ: UTC
PGTZ: UTC
command: [postgres, -c, timezone=UTC]
```

Task 36 found it while proving something else: three availability tests fail
against a PostgreSQL whose session timezone is not UTC. They passed on the
hosted database and failed on a locally provisioned IST cluster. `temporal.ts`
states that instants are UTC; the database had never been told.

A customer installing on an IST or PST host would have got subtly wrong
availability and SLA behaviour **with every test in their CI still green**. It
is pinned in three places and preflight verifies it against the *running*
server, not only the file, because a pinned value someone overrode is worth
exactly nothing.

### Decisions worth defending

**`${VAR:?message}`, not `${VAR:-default}`.** The root `docker-compose.yml`
defaults the superuser password to `postgres` and the application password to
`verity_app_dev_password`. That is a reasonable developer convenience and a
catastrophe if it reaches a customer's server unchanged. This compose file
refuses to start without real values and names the missing variable.

**No database and no object-store host port.** Not "bound to localhost" —
absent. Services reach each other over the compose network; an operator who
wants psql runs `docker compose exec db psql`. Preflight also checks that
nobody has added one back by hand.

**The env file is created under `umask 077`, not chmod'd afterwards.** A window
in which every credential is world-readable is still a window. Every script
refuses to run against a file that is not 0600, and none of them ever *sources*
it — sourcing would execute whatever a hand-edited file contains.

**`backup.sh` reads every dump back with `pg_restore --list`** and refuses one
under 1KB, writing to a `.partial` name and moving it on success so an
interrupted run cannot leave a truncated file that looks like a backup. A dump
nobody has ever read is not a backup; it is a file, and the difference is
discovered at the worst possible moment.

**`upgrade.sh` backs up first and aborts if that fails**, then prints the exact
rollback command if health fails afterwards. An upgrade path whose first action
is not a backup is not an upgrade path.

**`restore.sh` stops the application first** and demands
`VERITY_RESTORE_CONFIRM=yes`. Restoring under a live application produces a
half-restored database and a very confusing incident.

**MinIO is included, as the S3 contract rather than as a dependency.** A
`docker compose up` yields a working object store with no cloud account, which
is the difference between a deployment package and a deployment prerequisite.
The same four variables point at AWS, Ceph, Wasabi, B2 or a SeaweedFS S3
gateway — that is what Task 41 proved.

### What the package refuses to do, and says so

*   **No Kubernetes.** One stateless application, one database, one object
    store. Compose expresses that exactly; a Helm chart would add an
    orchestrator's failure modes to a deployment that has none of its problems.
    A customer already running Kubernetes consumes the same images.
*   **No secrets-manager integration.** The env file is a file with a mode. A
    Vault or KMS integration is a real improvement and a real decision; it needs
    an ADR, not a default.
*   **No TLS inside the application.** It speaks HTTP behind a reverse proxy.
    Terminating TLS in-process would put certificate rotation on the
    deployment's critical path for no security gain.
*   **No zero-downtime claim.** One container restarts, so there is a gap of
    seconds. The application is stateless and two replicas behind the proxy
    would remove it, but the package does not pretend to orchestrate that.

### Evidence

```text
Test Files  48 passed (48)
Tests       712 passed | 4 skipped (716)
```

*   Before Task 42: 678. After: 716 (+38). Zero regressions.
*   `bash -n` clean on all nine shell files.
*   `deploy/config/verity.env` and `deploy/backups/` added to `.gitignore`: the
    template is committed, the filled-in file never is.
*   Legacy-pattern scan: NONE FOUND.

The package is **executed for real in Task 43**, which is where its claims stop
being structural.
