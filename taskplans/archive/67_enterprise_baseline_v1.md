# Task 67 — Verity Enterprise Baseline v1

The transition `taskplans/65_verity_roadmap_v3.md` §4 names. Written when Phase
10A closed every P0 and P1 finding.

## 1. The statement, and what it does not say

> **Verity Enterprise Baseline v1 is ready for controlled customer
> implementation.**

Not "Verity is finished". The distinction is the whole point of declaring a
baseline: this is a version that can be responsibly deployed and supported, with
its known gaps written down. It is not a product that has stopped changing, and
the roadmap deliberately leaves Phases 11–14 to be driven by clients rather than
by prediction.

"Controlled" is doing work too. It means a client implementation with Verity
engineering involved, against the documented open items below — not
self-service, and not a deployment handed over without the security context in
this file.

## 2. What the baseline is

Repository state at the Phase 10A close commit. Evidence, not assertion:

| | |
|---|---|
| Test suite | 54 files, 785 tests, green against a hosted Postgres with RLS forced |
| Typecheck | clean |
| Lint | clean (one pre-existing TanStack compiler warning) |
| Build | clean; standalone `server.js` with the Prisma engine traced |
| `npm audit` | 7 advisories, every one build- or development-time; none reachable from a request (F-08) |
| Migrations | 51, applied |
| Open P0 | none |
| Open P1 | none |

## 3. What the audit examined and confirmed

Recorded so a later reader knows these were tested, not assumed.

- **Tenant isolation.** RLS enabled *and forced*; the runtime role verified live
  as `NOSUPERUSER NOBYPASSRLS`; `assertRlsEnforceable()` refuses a bypassing role
  at startup; tenant context derives from the authenticated actor and never from
  a request payload.
- **Three-layer authorization.** Verb×entity, row scope, field redaction — with
  Layer 2 now swept across every query rather than spot-checked (F-09).
- **Append-only invariants** on the stock ledger, invoices and closed periods
  are database-enforced, not application-enforced.
- **Secret-gated routes fail closed** — constant-time comparison, 503 when
  unconfigured rather than running open.
- **Credentials never reach a log**, and telemetry leaving the deployment is
  scrubbed by the same implementation the logger uses.

## 4. What a customer must be told

An honest baseline ships with its limits stated. These are the things that
belong in a security questionnaire answer.

1. **No Content-Security-Policy.** Four security headers ship; CSP needs nonce
   middleware and is its own task. A report-only CSP was rejected as theatre.
2. **Rate limiting is per process.** Across N instances the effective sign-in
   limit is N×. Sized accordingly; a shared-store limiter is Phase 13 work.
3. **Seven transitive advisories remain** (F-08), every one traced to
   build- or development-time tooling — eslint, postcss, ajv, minimatch, and the
   Prisma CLI. None is reachable from a request. The one that was — `dompurify`,
   via an unused `posthog-js` — was removed rather than accepted.
4. **`/api/metrics` is unauthenticated outside production** (F-07). Deliberate,
   and staging environments often hold realistic data.
5. **`Global` permission scope is defined but never granted.** Honouring it
   would mean bypassing the RLS that enforces tenant isolation. Filtered out in
   the database so such a row cannot silently take effect; wiring it up needs an
   ADR.
6. **Credential encryption key location is an implementation decision.**
   Supplied per call from the environment, never stored in the database, so a
   dump yields ciphertext alone. A managed KMS would be stronger.
7. **No scheduled work runs without `CRON_SECRET` set.** By design — it refuses
   rather than running unauthenticated — but it means a deployment that omits it
   silently has no scheduled work.
8. **Telemetry is opt-in.** Sentry initialises only when DSN, org and project are
   all set. A deployment that sets none has no external egress at all.

## 5. What this baseline is not certified for

Not a claim of compliance with any named standard. No penetration test has been
run against a deployed instance; this is a code audit, and the two answer
different questions. No load or capacity testing has been done, so no throughput
or concurrency figure should be quoted to a customer.

## 6. What happens next

Phase 11, and only when a client or tender is actually active. The rule that
protects the core is in the roadmap §5: every requirement is classified as Core,
Reusable Pack, or Client Extension **before** it is built.

The plywood capability is the worked precedent — a client-shaped capability that
added no platform primitive, and whose one platform change was general enough
that the shared capability it affects never learned the pack's name.
