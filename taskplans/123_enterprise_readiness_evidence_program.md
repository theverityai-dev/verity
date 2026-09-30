# Task Plan 123 — Enterprise Readiness Evidence Program

**Authority:** User synthesis, 2026-10-01 — product owner cannot commit to large
(₹10 lakh, on-premise) clients because Verity's scalability is architectural
belief, not measured evidence. Builds on `taskplans/30_containerized_runtime.md`
and `taskplans/31_migration_and_bootstrap.md` (existing `Dockerfile`,
`docker-compose.yml`, `deploy/db/init/`), `taskplans/107_complete_verity_security_modularity_on_prem_audit_prompt.md`
and `taskplans/108_complete_audit_remediation_and_upgrade_program.md` (on-prem
audit), CLAUDE.md "Database connection roles" (INV-001 pooling and role
constraints), and the foundation-conformance gate (build priority item 13).
Stop-condition note: nothing here adds a platform primitive or security
boundary; any finding that does is escalated, not fixed inline.

## Status: PARTIALLY BUILT 2026-10-01 — Phase 1 and Phase 3 scaffolding only; no measurement taken

Built, **none of it a result**: `scripts/scale/workload.ts` (+ test, 6 passing in
`test:pure`), `prisma/seed-scale.ts` (`npm run seed:scale`; typechecked and
linted, **not yet run against a database**), `scripts/load/verity.k6.js` and
`scripts/load/README.md` (**not yet run**; k6 and Docker are not installed on the
build machine). Every workload knob is required and has no default, so no
number can become "the tested figure" by accident. Phase 0 (the real
prospect workload) is still needed before any run that would back a claim.
Re-derive the "already exists" list below from the repo before starting any
later phase; it was read on 2026-10-01 and will drift.

## Problem

Verity has architectural scale properties (tenant isolation via RLS, stateless
Next.js app, Postgres system of record) but no recorded measurements. A large
prospect (for example an outsourced field-workforce deployment at a utility)
asks "will it hold N users and M records, and can you run it on our hardware?"
Today the honest answer is "unknown." The goal is to replace "unknown" with a
bounded, measured, reproducible claim per deployment shape, not a blanket
"enterprise-ready."

## Goal / exit condition

One document, `docs/enterprise-readiness/claim.md`, stating for one named
reference deployment: hardware spec, dataset size, concurrent users,
sustained requests/sec, p50/p95/p99, error rate, restore time, and clean-server
install time, each traceable to a committed, re-runnable script and a recorded
run. Milestone is **PLATFORM VALIDATED AT STATED LOAD**, never "enterprise
ready."

## Already exists (verified 2026-10-01)

- `Dockerfile` (3-stage, Debian slim, Prisma-compatible) and
  `docker-compose.yml` (app + Postgres 16, `verity_app` NOSUPERUSER NOBYPASSRLS
  created by `deploy/db/init/`). Migrations are an explicit operator step.
- `assertRlsEnforceable()` refuses a bypassing role at startup.
- Scheduler trigger `POST|GET /api/scheduled` (ADR-015/016), `scripts/run-scheduler.mjs`.
- `scripts/validate-deployment-security.mjs`.
- Seed scripts for plywood demo and audit tenant B.

## Not present (gaps this plan closes)

- No load/stress harness, no synthetic-scale data generator, no recorded numbers.
- No backup/restore script or timed restore drill; no documented RPO/RTO.
- No one-command install for a clean on-prem host; no upgrade or rollback path
  proven on a real migration.
- No time-series monitoring stack. (Corrected: `/api/health`, `/api/ready` and
  `/api/metrics` exist per Task 40; metrics are in-memory, per instance, reset
  on restart, so a load run must scrape each instance.)
- No documented sizing tiers or bounded-claim template.

## Phases (each independently shippable, in order)

### Phase 0 — Fix the measurement target (no code)

Pick one reference workload from a real prospect conversation; do not invent
an abstract "100k users." Write it as arithmetic: workers x visits/day =
rows/day, x retention = table sizes, peak concurrent users, file-upload volume.
Output: `docs/enterprise-readiness/workload-model.md`. Product-owner input
required (the prospect's real numbers, or an explicit assumption list).

### Phase 1 — Synthetic scale dataset

Deterministic seeder that generates the Phase 0 volumes through the real
write path where feasible, bulk SQL where not (state which tables bypass the
command runtime and why, since bulk-loaded rows skip events and audit). Must
run under `verity_app` so RLS is exercised, across multiple tenants so
isolation cost is included. Output: `prisma/seed-scale.ts` + a size report.

### Phase 2 — Query and index audit at scale

With Phase 1 data loaded: `EXPLAIN (ANALYZE, BUFFERS)` on the hot reads
(work queues, dashboards/metric snapshots, party ledger, evidence listings,
search) and on RLS-policy cost. Fix missing indexes through normal Prisma
migrations under `verity-migration-safety`. Output: findings table with
before/after timings.

### Phase 3 — Load test harness

k6 (or equivalent) scripts run against the containerized stack,
authenticated as real roles via the real sign-in path, never a bypass.
Scenarios: steady mixed read/write, dashboard-heavy burst, file/evidence
upload, concurrent report, scheduler tick under load. Ramp to 100 / 250 / 500 /
1000 concurrent virtual users. Record p50/p95/p99, RPS, error rate, app and DB
CPU/memory, connection-pool saturation. Specifically test the transaction-mode
pooler constraint (port 6543, `pgbouncer=true`) that took production down
once, including a run with deliberately scarce pool connections. Output:
`scripts/load/` + `docs/enterprise-readiness/load-results-<date>.md`. Runs
against a dedicated instance, never the shared production database.

### Phase 4 — Backup, restore, and disaster-recovery drill

Scripted `pg_dump`/base-backup plus object-storage backup, then timed drills:
(A) DB loss, (B) app host loss, (C) bad migration rollback, (D) full rebuild
from package + backup + config on an empty machine. Verify tenant isolation
still holds after restore (`assertRlsEnforceable()` plus the isolation test).
Output: `deploy/backup/` scripts and measured RPO/RTO.

### Phase 5 — On-prem package

**Prerequisite, before any package work: an ADR choosing which deployment modes
Verity 1.0 promises.** "On-prem" is not "compose works on a client's server."
Candidate modes: A, internet-connected on-prem (external OIDC and storage
permitted); B, private network (self-hosted OIDC and object storage); C, fully
air-gapped (everything local). Choosing one, or a subset, is a product decision;
this plan does not make it. Number it with `verity-adr-gate` (register currently
ends at ADR-030).

Extend the existing compose deployment into an installable bundle: env
preflight, role bootstrap, migrations as a scripted step, operator bootstrap,
HTTPS termination, health check, log and metric endpoints, backup schedule,
documented upgrade and rollback. Decide and record (ADR if it adds a boundary)
how storage and auth behave with no Supabase: today's bound providers are
Supabase Storage and OIDC-capable auth (ADR-020), and an air-gapped site needs
both replaced or self-hosted. That is an **implementation decision required**,
raised to the product owner, not assumed. Test: clean VM, no internet beyond an
image registry mirror, install to first sign-in, timed.

### Phase 6 — Bounded claim and commercial pack

`claim.md` (see Goal), sizing tiers (small/standard/large with hardware and
measured limits), responsibilities split (client infra vs Verity), support and
upgrade policy skeleton. Commercial terms, pricing and SLA wording are the
product owner's call; this phase supplies only the technical facts they cite.

## Non-goals

- No new business capability, no industry pack, no field-operations module
  (separate scope decision; see CLAUDE.md scope note).
- No Kubernetes, queues, caches or read replicas unless a Phase 3 measurement
  shows a specific bottleneck they fix. Task 29 concluded none was justified;
  measurements may overturn that, guesses may not.
- No per-client code forks. Theme and layout variation stays in the tenant
  configuration layer (ADR-024/026, Task 104).
- No claim beyond the tested configuration.

## Risks and open decisions

- **Air-gapped storage/auth replacement** (Phase 5): possible missing ADR if
  it needs a provider binding beyond the existing extension points.
- **Shared DB hygiene**: load data must never touch the shared Supabase
  project; use a separate instance (`verity-shared-db-hygiene`).
- **Bulk seeding bypasses the runtime** (events/audit skipped); write-heavy
  results must come from Phase 3 through the real command path, not from
  seeded rows.
- **Load rig realism**: a laptop is not the target hardware; Phase 3 results
  are valid only for the stated hardware.
- **Product-owner input**: Phase 0 workload numbers.

## Verification per phase

Each phase ends with a committed script that reproduces its numbers from a
clean checkout, and a dated results file. A phase is DONE when a second run
reproduces within stated variance, not when it ran once.

## Cross-references

Extends 30/31 (containerized runtime) and 107/108 (on-prem audit remediation).
Supersedes nothing. Sequenced ahead of further feature expansion per
product-owner intent; does not change the authorized scope for Tasks
118/119/120.
