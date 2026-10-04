# Task 35 — Phase 7 Closeout

**Status: COMPLETE**
**Date: 2026-08-30**

---

## 1. Phase 7 Objective

Transform Verity from a cloud-coupled application (Vercel + Supabase Cloud hard requirements) into an architecturally portable operations engine that can run on standard infrastructure — PostgreSQL + Docker — without requiring any specific cloud provider.

The goal was never to remove Supabase or Vercel from the SaaS deployment path. The goal was to ensure those are **choices**, not hard constraints.

---

## 2. Starting Architecture (pre-Phase 7, commit `e29c529`)

```text
┌─────────────────────────────────────────────────────┐
│                    VERITY v1                        │
│                                                     │
│  Next.js                                            │
│    ├── process.env.* (scattered, unvalidated)       │
│    ├── @supabase/ssr (auth wired directly)          │
│    ├── supabase.storage.from() (scattered)          │
│    ├── Vercel Cron → /api/scheduled                 │
│    └── No container, no runbook, no probes          │
│                                                     │
│  PostgreSQL (via Supabase Cloud only)               │
└─────────────────────────────────────────────────────┘
```

**Portability blockers at Phase 7 start:**
- No validated runtime configuration boundary (env vars scattered)
- Auth implementation not behind any interface
- Storage calls directly against Supabase Storage SDK in multiple places
- No container packaging
- No migration runbook proven from an empty database
- No health/readiness endpoints
- No backup/restore procedure

---

## 3. Ending Architecture (post-Phase 7, commit `e48e7b9`)

```text
┌─────────────────────────────────────────────────────┐
│                    VERITY v2                        │
│                                                     │
│  Next.js (standalone build, Docker-ready)           │
│    │                                                │
│    ├── RuntimeConfig (Zod, validated at startup)    │
│    │     └── DATABASE_URL, DIRECT_URL, secrets      │
│    │                                                │
│    ├── AuthProvider (interface)                     │
│    │     └── SupabaseAuthProvider (adapter)         │
│    │                                                │
│    ├── StorageDriver (interface)                    │
│    │     └── SupabaseStorageDriver (adapter)        │
│    │                                                │
│    ├── JobRunner (interface)                        │
│    │     └── SynchronousJobRunner (adapter)         │
│    │                                                │
│    ├── /api/health (liveness, no I/O)              │
│    └── /api/ready (readiness, SELECT 1, 3s timeout) │
│                                                     │
│  Dockerfile (3-stage, node:20-bookworm-slim)        │
│  docker-compose.yml (web + db, localhost-bound PG)  │
│                                                     │
│  PostgreSQL                                         │
│    ├── 41 migrations (proven from empty, live)      │
│    ├── bootstrap-operator.ts (idempotent, proven)   │
│    ├── verity_app role (NOSUPERUSER NOBYPASSRLS)    │
│    └── Backup/restore runbook (3 real bugs fixed)   │
└─────────────────────────────────────────────────────┘
```

---

## 4. Tasks and Commits

| Task | Title | Commit | Tests Added |
|---|---|---|---|
| 26 | Runtime Configuration Boundary | `0bab3a0` | config.test.ts (25 tests) |
| 27 | Storage Abstraction | `3a5d0d2` | storage-adapter.test.ts (10 tests) |
| 28 | Auth Provider Abstraction | `c6d6258` | auth-provider.test.ts |
| 29 | Background Job Abstraction | `6c98017` | job.test.ts |
| 30 | Containerized Runtime | `b5e7c18` | container-runtime.test.ts (15 tests) |
| 31 | Migration & Bootstrap | `6b79428` | bootstrap-operator.test.ts (4 tests) |
| 32 | Health & Readiness | `63976f1` | health-readiness.test.ts (9 tests) |
| 33 | Backup & Restore Verification | `8fc3412` | (docs + live proof, no src/ changes) |
| 34 | Portable Runtime Acceptance | `e48e7b9` | (docs + live proof, no src/ changes) |

**Phase 7 baseline commit (pre-Task 26):** `e29c529`
**Phase 7 final commit:** `e48e7b9`

---

## 5. Acceptance Results

### Live-executed, passing
| Criterion | Evidence |
|---|---|
| 41 migrations from empty DB | Proven twice live: Task 33 restore proof + Task 34 acceptance run |
| Bootstrap operator (idempotent) | Proven twice live: Task 31 tests + Task 34 acceptance run |
| `/api/health` 200 | Proven against real standalone binary (Task 32 + Task 34) |
| `/api/ready` 200 (DB up) | Proven against real standalone binary (Task 32 + Task 34) |
| `/api/ready` 503 (DB down) | Proven against real standalone binary (Task 32) |
| Home page no 500 | `GET /` → 307, `GET /sign-in` → 200 (Task 34) |
| `pg_dump` backup command | Proven live, exit 0 (Task 33 + Task 34) |
| Full backup→restore→verify cycle | Proven live: all ~80 tables row-count matched byte-for-byte (Task 33) |
| 521-test regression baseline | Passing at Phase 7 close |

### Deferred — Docker daemon required
| Criterion | Status | Remediation |
|---|---|---|
| `docker compose build` succeeds | NOT EXECUTED | Run on any machine with Docker: `docker compose build` from repo root with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in environment. See `deploy/runbooks/local-deployment.md §2a`. |
| `docker compose up -d` + healthcheck | NOT EXECUTED | Follow `local-deployment.md §2b`, verify `docker compose ps` shows both services healthy. |

---

## 6. Bugs Found During Phase 7 Proofs

Three real production bugs discovered and fixed during acceptance exercises (Task 33):

1. **`capability_definition` PK collision on restore** — four migration-seeded tables (`capability_definition`, `entity_definition`, `state_definition`, `transition_definition`) must be excluded from data-only backups. Not hypothesized — proven by hitting the exact constraint error. Fixed in `backup-restore.md`.

2. **`tenant_activation` trigger / `search_path=''` interaction** — recent `pg_restore` sets `search_path=''` for security; `tenant_activation_requires_dependencies` trigger uses unqualified table reference, fails at restore time. `--disable-triggers` requires real superuser (confirmed: fails on Supabase's non-superuser `postgres` role). Fix: disable just that one non-system trigger for restore duration. Documented in runbook.

3. **`config_parameter` `NULL != NULL` duplicate gap** — the unique index on `(tenant_id, key, scope, scope_id)` does not prevent duplicate Global-scope defaults because `NULL` is never equal to `NULL` in standard SQL. Caught only by full row-count diff (source: 6, target: 9). Workaround: separate `\copy` for tenant-scoped rows only. Schema fix (`NULLS NOT DISTINCT`, PG 15+) deferred — flagged in runbook.

---

## 7. Deliverables Created

```text
src/server/platform/
  config.ts                  — RuntimeConfig, Zod schemas
  authProvider.ts            — Principal + AuthProvider interface
  job.ts                     — Job + JobRunner interface + SynchronousJobRunner

src/server/storage/
  (supabase.ts wired to StorageDriver, pre-existing boundary confirmed)

src/app/api/
  health/route.ts            — liveness probe
  ready/route.ts             — readiness probe (SELECT 1, 3s timeout)

src/test/
  config.test.ts
  storage-adapter.test.ts
  auth-provider.test.ts
  job.test.ts
  container-runtime.test.ts
  bootstrap-operator.test.ts
  health-readiness.test.ts

prisma/
  operator-bootstrap-core.ts — extracted, testable bootstrap logic
  bootstrap-operator.ts      — thin CLI wrapper (refactored)

deploy/
  db/init/01-create-app-role.sh
  runbooks/backup-restore.md
  runbooks/local-deployment.md

Dockerfile
docker-compose.yml
.dockerignore
.gitattributes
next.config.ts               — standalone output + Prisma engine trace

taskplans/
  26_runtime_configuration.md
  26A_v1_to_v2_authority_transition.md
  27_storage_abstraction.md
  28_auth_provider_abstraction.md
  29_background_job_abstraction.md
  30_containerized_runtime.md
  31_migration_and_bootstrap.md
  32_health_readiness.md
  33_backup_restore_verification.md
  34_portable_runtime_acceptance.md
  35_phase7_closeout.md        — this document
```

---

## 8. Enterprise Readiness Gates — Phase 7 Contribution

```text
[✓] Cloud-provider independence (no Vercel hard dependency)
[✓] PostgreSQL portability (proven from empty database)
[✓] Runtime configuration boundary (RuntimeConfig)
[✓] Storage provider boundary (StorageDriver)
[✓] Authentication provider boundary (AuthProvider)
[✓] Background job boundary (JobRunner)
[✓] Container packaging (Dockerfile + Compose)
[✓] Migration system (41 migrations, proven reproducible)
[✓] Operator bootstrap (idempotent, credential-free)
[✓] Health and readiness (liveness/readiness probes)
[✓] Backup and restore (proven with real data)
[✓] Deployment runbooks (operator-facing, copy-pasteable)

[ ] Enterprise OIDC / external identity provider
[ ] Enterprise RBAC (hierarchical permissions)
[ ] Full audit architecture (business history integrity)
[ ] Integration framework (adapter pattern for external systems)
[ ] Observability (logs, metrics, error tracking)
[ ] Second storage implementation (validates StorageDriver abstraction)
[ ] Deployment hardening (TLS, secrets management, upgrade runbook)
[ ] Docker build/run acceptance (requires Docker daemon)
```

---

## 9. Lessons Learned

**Empirical proof finds bugs; static analysis does not.** Tasks 33–34 found real production bugs by actually running the procedures. Reading the schema would not have found the `NULL != NULL` duplicate gap or the `search_path=''` trigger interaction.

**Scope corrections matter.** Multiple taskplan drafts (31's seed.ts framing, 33's schema-backup framing) proposed architecturally wrong approaches. Claude Code caught and documented each one before writing code, not after. The pattern: read the brief, read the code, correct the brief in the taskplan before touching production.

**The smallest diff in the right place.** `auth.users` guard in `operator-bootstrap-core.ts` is 4 lines. It was the one real portability fix in Task 31 — not a refactor, not an abstraction, just the minimum correct check. Phase 7 maintained this discipline throughout.

**Honest limitations are more useful than fabricated passes.** AC-01/02 (Docker build/up) went 9 tasks without a daemon. Documenting "NOT EXECUTED — here is the exact remediation" is more useful than simulating a pass.

---

## 10. Phase 8 Entry Conditions

Phase 8 (Enterprise Security & Operations) may begin. Pre-conditions met:

- [x] Architecture is provider-neutral at all three boundaries (auth, storage, jobs)
- [x] Container packaging exists and is structurally verified
- [x] Migration system proven reproducible
- [x] Health/readiness endpoints operational
- [x] Backup/restore procedure proven with real data
- [x] 521-test regression baseline clean
- [x] Authority chain (CLAUDE.md → taskplans/) stable and unambiguous

**Phase 8 opening task: `36_enterprise_identity_oidc.md`**

The `AuthProvider` interface created in Task 28 is the seam. Phase 8 uses it.
