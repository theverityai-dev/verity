# Task Plan 40 — Observability

**Phase 8, Task 5 of 9.** Control document: `35A_phase8_execution_program.md`.
**Depends on:** Tasks 36–39 (the runtime boundaries are now stable).
**Gate owned:** G08 — operational observability.

---

## 1. Objective

Make Verity **operable**. An operator with no access to the source must be able
to answer, from the outside:

1.  Is Verity healthy?
2.  What is failing?
3.  Which request or workflow caused it?
4.  Which dependency is slow?
5.  Which deployment is affected?

---

## 2. What HEAD Already Has

*   `/api/health` — liveness, no I/O, correctly refuses to fail on a dependency
    outage (Task 32).
*   `/api/ready` — readiness, `SELECT 1`, 3s budget, 503 on failure, connection
    strings sanitized out of the error.
*   `correlationId` on every audit row and domain event (Task 38).

Questions 1 and 3 are half-answered. Two, four and five are not answered at all:
the platform writes nothing structured, measures nothing, and does not know
which build it is.

---

## 3. Design

### 3.1 A contract, not a product

```text
        log()   metric()   captureError()
              │      │      │
              ▼      ▼      ▼
        LogSink  MetricSink  ErrorSink      ← replaceable, registered
              │      │      │
              ▼      ▼      ▼
   stdout JSON   in-memory   (none by default)
```

The brief says it: *don't turn this into a full observability product; keep
infrastructure replaceable.* So the platform owns the **contract and the
vocabulary**, and the destination is a deployment decision — the same shape as
storage (Task 27) and integrations (Task 39).

The defaults are chosen so an unconfigured deployment is still observable:
structured JSON on stdout, which every container platform already collects, and
in-memory metrics, which `/api/metrics` can serve without a time-series database
existing.

### 3.2 Ambient request context

`AsyncLocalStorage` carries `{ correlationId, tenantId, userId, route }` for the
duration of a request. Every log line and every error inherits it without being
handed it.

The alternative — threading a context argument through every function — is what
makes correlation optional in practice: it works until someone adds a call site
and forgets, and then the one log line that mattered is the one without the id.

### 3.3 The five questions, mapped

| Question | Mechanism |
|---|---|
| Is it healthy? | `/api/health` (liveness), `/api/ready` (readiness) — unchanged |
| What is failing? | `captureError` + error counters, `/api/metrics` |
| Which request caused it? | `correlationId`, ambient, on every line and joinable to Task 38's audit trail |
| Which dependency is slow? | `timed()` around dependency calls → duration histograms per dependency |
| Which deployment? | build identity (version, commit, environment) on every line and on both probes |

### 3.4 Rules

*   **Never log a secret.** Reuses Task 38's field-name rule and Task 39's
    message redaction; observability is the easiest place in a system to leak a
    credential, because logging is where people paste whole objects.
*   **A tenant id is not a secret; a payload is.** Log identifiers, not
    contents. `INV-001` also means one tenant's data must not appear in a log
    line another tenant's operator can read.
*   **Observability must never break the request.** A failing sink is swallowed.
    A monitoring outage that takes production down is a self-inflicted incident.
*   **No sampling, no aggregation, no retention policy here.** Those belong to
    whatever collects the stream.

---

## 4. Files

```text
src/server/platform/observability.ts   NEW — logging, metrics, errors, context, timing
src/app/api/metrics/route.ts           NEW — metric snapshot for an operator
src/app/api/ready/route.ts             MODIFIED — build identity + dependency timing
src/app/api/health/route.ts            MODIFIED — build identity
src/test/observability.test.ts         NEW
```

---

## 5. Acceptance Criteria

*   [x] AC-01 Structured JSON logs on stdout by default, with no configuration.
*   [x] AC-02 Correlation, tenant and route are ambient — never passed by hand.
*   [x] AC-03 Secrets and payloads are redacted from log fields and messages.
*   [x] AC-04 Counters and duration histograms exist and are exposed.
*   [x] AC-05 Dependency latency is measurable per dependency.
*   [x] AC-06 Build identity appears on logs and on both probes.
*   [x] AC-07 A failing sink cannot fail the request.
*   [x] AC-08 Sinks are replaceable; nothing binds a vendor.
*   [x] AC-09 `/api/metrics` refuses an unauthenticated caller in production.
*   [x] AC-10 Typecheck clean; suite green.

---

## 6. Implementation Notes (Claude Code, 2026-08-30)

### Status: COMPLETE — BUILT and PROVEN

### What was built

| File | Change |
|---|---|
| `src/server/platform/observability.ts` | NEW. `logger`, `log`, `withRequestContext`, `increment`, `observeDuration`, `timed`, `captureError`, `metricsSnapshot`, `buildIdentity`, three registrable sinks. |
| `src/app/api/metrics/route.ts` | NEW. Snapshot for an operator; secret-gated in production. |
| `src/app/api/ready/route.ts` | Build identity and probe duration on the response; the probe is recorded as an ordinary dependency measurement. |
| `src/app/api/health/route.ts` | Build identity. Still no I/O. |
| `src/server/platform/command.ts` | Wraps execution in the ambient request context, carrying Task 38's correlation id. |
| `src/test/observability.test.ts` | NEW, 29 tests. |
| `src/test/health-readiness.test.ts` | Strict equality relaxed to the fields that are contractual. |

### The five questions, and where each is answered

| Question | Answer |
|---|---|
| Is Verity healthy? | `/api/health` (liveness, no I/O), `/api/ready` (readiness, `SELECT 1`) |
| What is failing? | `captureError` → `errors_total{code,route}` and a structured error record |
| Which request caused it? | the ambient `correlationId` — **the same id Task 38 wrote onto the audit rows** |
| Which dependency is slow? | `timed()` → `dependency_duration_ms{dependency,operation,outcome}` with count, average, max and p95 |
| Which deployment is affected? | `buildIdentity()` on every log line and on both probes |

The third row is the one that matters most. Because Task 38 minted the
correlation id and Task 40 logs under the same one, an operator moves from a log
line to the exact business changes that request made — no join on timestamps,
which is the reasoning that fails when two requests are a millisecond apart.

### Decisions worth defending

**A contract, not a product.** `@sentry/nextjs`, `@opentelemetry/instrumentation`
and `posthog-js` are all already in `package.json`. None is imported here, and a
test asserts it. The platform owns the vocabulary — what a log record means,
what a metric is named — and the destination is a deployment decision, the same
shape as storage (Task 27) and integrations (Task 39). An enterprise already has
a stack; a platform that insists on its own is a platform they have to fight.

**The defaults still work.** Unconfigured, this writes JSON lines to stdout —
which every container platform already collects — and keeps metrics in memory,
which `/api/metrics` serves without a time-series database existing anywhere.
"Observability requires configuration" is how a deployment ends up with none.

**The context is ambient, not threaded.** `AsyncLocalStorage` carries
correlation, tenant, user, route and channel. Threading a context argument
through every function is what makes correlation optional in practice: it works
until someone adds a call site and forgets, and then the one log line that
mattered is the one without the id. Tested across an `await` boundary and for
leakage between requests.

**A failing sink cannot fail a request.** Every sink call is wrapped and
deliberately silent — reporting a logging failure by logging it is a loop. Three
tests, one per sink. A monitoring outage that takes production down is a
self-inflicted incident and the most common one in this area.

**Logging is where credentials leak, so it redacts twice.** Field names go
through Task 38's rule; string values and the message itself go through Task
39's message redaction. Long values are truncated at 512 characters: a log line
carries identifiers, not payloads, and INV-001 means one tenant's data must not
surface in a stream another tenant's operator reads.

**Failures are timed too.** `timed()` records the duration on the error path and
increments a per-dependency error counter. A dependency that is slow *and*
failing is the interesting case, and recording only successes hides exactly it.

**`/api/metrics` is gated in production.** Metrics name routes, dependencies,
error codes and volumes — a map of the system. It uses the operator secret
already established by ADR-015 with a constant-time comparison, returns 503
rather than opening up when nothing is configured, and is open outside
production so a developer can read their own counters. It carries no tenant
identifier by construction, which is what keeps it out of INV-001's way.

### Honest limitations, stated rather than hidden

*   Metrics are **per instance and reset on restart**. With more than one
    replica an operator scrapes each. This is written into the route's own
    documentation. It is the correct trade for refusing to require a
    time-series database in order to be observable — and a real deployment
    points a collector at the endpoint.
*   `p95` is computed from a bounded 256-sample reservoir, not from every
    observation. Enough for a number an operator can act on; bounded so a
    long-running process does not grow without limit.
*   Nothing yet calls `logger` or `timed` inside the query pipeline, the storage
    driver or the integration adapter. The contract and the command path are
    wired; instrumenting each dependency is a mechanical follow-on and is
    better done by the task that touches those files than bundled here.

### Evidence

```text
Test Files  46 passed (46)
Tests       652 passed | 3 skipped (655)
```

*   Before Task 40: 626. After: 655 (+29). Zero regressions.
*   `npx tsc --noEmit`: clean.
*   Legacy-pattern scan on changed files: NONE FOUND.
