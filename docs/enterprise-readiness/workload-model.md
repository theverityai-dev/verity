# Workload model — BRPL-style prospect

Authority: `taskplans/123_enterprise_readiness_evidence_program.md`, Phase 0.

> **DEFERRED 2026-10-01 — prospect-specific enterprise benchmark, not Verity's
> primary workload.** Verity's product target is multi-tenant software for
> roughly 10 to 100 person businesses; the primary Task 123 workload is
> `msme-reference-workload.md`. Run this 58.4M-visit model only if a real
> enterprise opportunity requires it. Kept, not deleted.

**Status: PROVISIONAL / NOT CUSTOMER-VERIFIED (2026-10-01).** These are working
assumptions supplied by the product owner for engineering validation only. They
are not BRPL-confirmed requirements, customer commitments or capacity claims.
Nothing measured against them may be described as BRPL-confirmed, BRPL-required,
enterprise-ready, production-approved or a guarantee of capacity. Treat every
value as an assumption until the prospect confirms it.

## Assumptions (as supplied)

| Input | Value |
|---|---|
| Outsourced field workers | 5,000 |
| Active workers on a typical day | 4,000 |
| Contractors | 50 |
| Supervisors / management users | 300 |
| Visits per active worker per day | 8 |
| Peak-hour share of daily visits | ~20% |
| Peak concurrent field users | 600 |
| Peak concurrent authenticated users (incl. supervisors) | 750 |
| Evidence items per visit | 4 |
| Average evidence size per visit (total) | ~2 MB |
| Retention | 5 years |

## Derived figures (arithmetic on the assumptions, not measurements)

| Quantity | Working |
|---|---|
| Visits/day | 4,000 x 8 = 32,000 |
| Peak-hour visits | 32,000 x 20% = 6,400 (~1.8 visits/s) |
| Visits over retention | 32,000 x 365 x 5 = 58.4M |
| Evidence rows over retention | 58.4M x 4 = 233.6M |
| Evidence bytes/day | 32,000 x 2 MB = ~64 GB |
| Evidence bytes over retention | ~64 GB x 365 x 5 = ~117 TB |

Observations that shape the test, not conclusions:

- Write rate is low (about 2 visits/s at peak). The hard parts are **750
  concurrent authenticated users**, **hundreds of millions of rows** behind RLS,
  and **dashboards/exception queries over that history**, not raw ingest.
- **~117 TB of evidence files** is an object-storage sizing question, not a
  database one (file bytes live outside Postgres; `evidence` rows hold
  references). It bears directly on the deployment-mode ADR (Task 123 Phase 5):
  a private or air-gapped site must provide that storage.
- `seed:scale` writes 1 `activity` row per visit; real visits will write more
  (state changes, checklist items, domain events). Seeded size therefore
  understates real table volume; say so in any result.

## Mapping to the seeder

Staged, never straight to the top:

```text
SCALE_VISITS=1000000   EVIDENCE_PER_VISIT=4 TENANTS=1   # smoke, plan sanity
SCALE_VISITS=10000000  EVIDENCE_PER_VISIT=4 TENANTS=5   # first index audit
SCALE_VISITS=58400000  EVIDENCE_PER_VISIT=4 TENANTS=1   # full retention target
```

All with `SCALE_CONFIRM_DISPOSABLE=1` on a throwaway database. TENANTS here is a
test choice (isolation cost), not a BRPL fact: BRPL may be one tenant with many
organizations. The 58.4M step (233.6M evidence rows) needs a host with enough
disk; size the disposable instance first and record it.

## Load targets for Phase 3

Stages to record, each held at steady state: 100, 250, 500, 750 concurrent
authenticated users (750 is the assumed peak). Any stage above 750 is headroom
exploration and must be labelled as such. Record hardware, pool size and dataset
size with every run.

## Questions the prospect must answer before any commercial capacity claim

1. Total outsourced workers
2. Average and peak active workers/day
3. Average visits/worker/day
4. Peak concurrent users
5. Number of supervisors/management users
6. Evidence/photos per visit
7. Average evidence size
8. Required retention period
9. Number of contractors
10. Expected reporting/export workload
11. Whether deployment must operate without internet access
12. Authentication and identity requirements
13. Required backup/recovery objectives
14. Expected number of simultaneous sites/locations
