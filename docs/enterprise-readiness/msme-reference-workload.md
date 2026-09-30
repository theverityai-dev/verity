# Verity reference workload — multi-tenant MSME SaaS

Authority: `taskplans/123_enterprise_readiness_evidence_program.md` (re-scoped
2026-10-01). This is the **primary** Task 123 workload. The BRPL-scale model in
`workload-model.md` is a deferred, prospect-specific benchmark.

**Status: PROVISIONAL (2026-10-01).** Shape supplied by the product owner; every
number below is an engineering target, not a measurement and not a customer
commitment. Data volumes per tenant are **not yet decided** and are left open on
purpose rather than invented.

## What Verity is for

Standardized operational software for businesses of roughly 10 to 100 people,
run as a multi-tenant platform. Larger organisations get purpose-built solutions
on the same core; that is a separate track and does not set this workload.

## The question this workload answers

Can ten independent businesses share one Verity deployment without tenant
leakage, cross-tenant performance degradation, or operational problems?

## Shape

| Input | Value | Note |
|---|---|---|
| Tenants | 10 | |
| Users per tenant | 10 to 100 | Uneven on purpose, see below |
| Total users | 100 to 1,000 | Upper bound is a headroom figure, label it so |
| Tenant size distribution | Uneven, e.g. one tenant near 100 users, others 10 to 75 | Actual distribution to be fixed before a run and recorded |

Tenant sizes must be uneven. A uniform split hides the case that matters in a
shared deployment: one large tenant degrading small ones (noisy neighbour), and
RLS filtering cost on a large tenant's tables.

## Traffic mix to exercise (no volumes yet)

Common CRUD on the capabilities an MSME actually uses (customers, orders,
invoices, inventory, tasks, documents); dashboards and metric snapshots; search;
reports and exports; file upload; scheduled background work
(`/api/scheduled`); sign-in. Concurrency is a fraction of users: choose and
record an active-user ratio per run rather than assuming all users are active.

## What to record per run

- Tenant count and per-tenant user count and row counts (the seed report).
- Concurrent virtual users per stage, and the active-user ratio.
- p50/p95/p99, RPS, error rate, app and DB CPU/memory, pool saturation.
- **Tenant isolation result**: a cross-tenant read attempt at load must still
  return nothing (isolation test run during the load, not only before it).
- **Noisy-neighbour result**: latency of small tenants while the largest tenant
  runs a heavy report.
- Hardware, Postgres version and settings, pool size, dataset size.

## Open inputs (needed before numbers mean anything)

1. Realistic row counts per tenant per capability (customers, orders, invoices,
   stock movements) and their growth over a year.
2. The tenant size distribution.
3. Active-user ratio at peak.
4. Reporting and export frequency.

Until these are fixed, a run is a mechanism check, not evidence.

## Claim language

Any result states: a **provisional multi-tenant MSME reference workload** of N
tenants, U users, R rows, measured on the named hardware and Mode A deployment
(ADR-031). It is never described as enterprise-ready, production-approved, or a
capacity guarantee.
