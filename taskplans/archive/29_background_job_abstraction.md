# Task Plan 29 — Background Job Abstraction

This document defines the implementation plan to audit and abstract Verity's background processing and scheduling mechanisms, establishing a unified interface for queues and workers without introducing heavy external engines prematurely.

---

## 1. Inventory & Classification of Async Behaviors

In the current codebase:
1.  **Scheduled Actions**: `/api/scheduled/route.ts` is triggered periodically by Vercel cron threads to process tenant-level scheduled items.
2.  **Notification Dispatching**: Done synchronously or in simple async requests in `notification.ts`.
3.  **State Machines**: Entity status changes (`DiningOrder` transitions) run synchronously via standard transactional flows.

### Classification:
*   **STATE_MACHINE**: Managed locally in domain code.
*   **BACKGROUND_JOB**: Asynchronous notifications, data compilations.
*   **SCHEDULED_JOB**: Hourly cron schedules verifying aging records or trigger actions.
*   **DURABLE_WORKFLOW**: None identified yet (externalized Temporal option remains preserved).

---

## 2. Design

### Step 1: Define the Job and Queue Interface
Create `src/server/platform/jobs.ts`:
```typescript
export interface Job {
  id: string;
  name: string;
  payload: unknown;
}

export interface JobQueue {
  enqueue(name: string, payload: unknown): Promise<void>;
  registerWorker(name: string, handler: (payload: unknown) => Promise<void>): void;
}
```

### Step 2: Implement Local/In-Memory Adapter
To preserve the zero-external-dependency local developer path, implement a standard in-memory queue adapter that processes jobs sequentially. In production configurations, this can be swapped with a Redis/BullMQ driver.

---

## 3. Verification & Acceptance Criteria
*   [x] The application registers and executes background jobs via the new abstraction layer.
*   [x] Existing tests for scheduled tasks (`scheduled-work-trigger.test.ts`) pass without regressions.

---

## 4. Implementation Notes (Claude Code, 2026-08-30)

### Phase A — full async inventory

Searched the repository for every pattern the task lists (cron, scheduled
handlers, delayed execution, notification dispatch, webhooks, imports/
exports, retries, polling, queue/worker libraries, `setTimeout`/
`setInterval`) before writing any code.

| Mechanism | File(s) | Purpose | Trigger | Duration | Retry today | Idempotency need | Failure behavior | User-facing | Scheduled | Survives restart | Ordering matters | Exactly-once needed | Vercel/Supabase-specific |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Recurring capability work | `contribution.ts` (`ScheduleContribution`/`runDueWork`), consumed by `plywood/index.ts` (`sweep_low_stock`, daily) and `dinein/index.ts` (`sweep_prep_breaches`, frequent) | Sweep for a time-based fact (low stock, breached SLA clock) | Time (cadence) | Sub-second per tenant per unit | Provider retries whatever calls `runDueWork`; each unit is independently caught | MUST be idempotent — stated explicitly in `contribution.ts`'s own doc comment | Per-unit try/catch; one failing unit does not abort the batch; outcome returned, not logged | No (background) | Yes | Yes (DB-driven, no in-memory state) | No (each unit independent) | No — "a scheduler that guarantees exactly-once delivery does not exist" (verbatim) | Trigger is Vercel Cron via `/api/scheduled`; execution itself is not |
| Scheduled-work trigger | `src/app/api/scheduled/route.ts` | Provider adapter: turns an HTTP call into `runDueWork` | Vercel Cron (`vercel.json`) | One request per cadence | N/A (Vercel retries failed cron invocations at its own discretion) | N/A (delegates to `runDueWork`) | 503 if `CRON_SECRET` unset (ADR-015); 401 on bad secret; else runs and returns per-unit outcomes | No | Yes | Yes | No | No | Yes — this file IS the Vercel-specific glue, by design (ADR-015/016) |
| Notification delivery | `notification.ts` (`notify()` writes `Pending`; `markSent()` exists but nothing calls it) | Send an in-app/email/push notification | An event, inline in a command's transaction | N/A — no dispatcher exists | N/A — no dispatcher exists | Sending twice would be user-visible and bad (duplicate emails) | N/A — no dispatcher exists | Yes (eventually) | No | Would need to (a `Pending` row is durable, but nothing drains it) | Not really | Yes, per notification | No |
| Domain-event outbox | `domainEvent.deliveredAt` (schema), read by `administration.ts`'s dashboard count only | Deliver a fact to (future) external subscribers | An event, inline in a command's transaction | N/A — no dispatcher exists | N/A | Depends on the subscriber; not decided | N/A | No | No | Would need to | Possibly, per subscriber | Undecided — flagged, not solved here | No |
| Offline command replay | `sync.ts` (`replayPending`) | Apply commands captured while offline, in device-timestamp order | Nothing today — no route or schedule calls it | Batch, bounded by `limit` (default 100) | No — each item tried once; a failure is recorded as `Rejected` + a `SyncException`, not retried automatically | Yes — `enqueueOfflineCommand`'s uniqueness constraint on `commandId` makes acceptance idempotent; replay itself is not retried | Per-item try/catch; one failure does not abort the batch (mirrors `runDueWork`'s shape) | Yes (eventually — the offline user's own work) | No (called on demand) | Yes (DB-backed queue) | Yes — explicitly ordered by `deviceTimestamp`, not arrival | Not stated | No |
| Kitchen board auto-refresh | `KitchenBoard.tsx` (`setInterval(() => router.refresh(), 10_000)`) | Client-side UI polling | Wall clock, browser-side | N/A | N/A | N/A | N/A | Yes | N/A | No (browser tab) | N/A | N/A | No — plain browser API, not server execution |

No cron/queue/worker library is present in `package.json` (`@aws-sdk/*` from
an earlier, unrelated finding aside — see Task 27's notes; still unused,
still not this task's concern). No `setTimeout`/`setInterval` exists in
server code — the one match is client-side UI polling, correctly out of
scope for a *background job* abstraction.

**One deployment gap surfaced, flagged not fixed** (out of scope — "do not
rewrite scheduled jobs unrelated to the abstraction"): `vercel.json` wires
only the `daily` cadence to an actual cron trigger. `dinein`'s `frequent`
SLA sweep (`sweep_prep_breaches`) currently has no live trigger in
production. This is a cron-configuration gap, not an architecture gap — the
abstraction (`ScheduleContribution`/`runDueWork`) is correct regardless of
which cadences are currently wired.

### Phase B — classification

*   **STATE_MACHINE**: `state.ts`'s `StateDefinition`/`TransitionDefinition`
    runtime, driving entity status transitions (`Draft → Submitted → ...`).
    Fully built, synchronous, transactional, data-driven — not a background
    execution concern at all, and this task does not touch it.
*   **SCHEDULED_JOB**: `ScheduleContribution`/`runDueWork`/`/api/scheduled`.
    Already exists, already provider-neutral, already idempotent-by-contract.
    **No changes made** — see Decision 1.
*   **BACKGROUND_JOB**: notification delivery, domain-event outbox drain,
    offline-command replay. All three share one shape (a durable "pending"
    row; a discrete, non-recurring unit of work per occurrence) and **none
    has a live execution path today** — each is a written-but-undrained
    substrate. This is what Phase C's new contract targets.
*   **DURABLE_WORKFLOW**: none found, none justified. No waiting, timers,
    compensation, or human-in-the-loop long-running process exists anywhere
    in the codebase. Confirmed by the same searches as the inventory above,
    not assumed from the taskplan's own stale draft.

### Phase C — the contract built

**`src/server/platform/job.ts`** (new):

```ts
type Job<TInput> = { id, name, input, metadata?, createdAt };
type JobOutcome = { status: "success" } | { status: "failed"; retryable: boolean; error: string };
type JobHandler<TInput> = (job: Job<TInput>) => Promise<void>;
interface JobRunner { name; run<TInput>(job, handler): Promise<JobOutcome>; }
class SynchronousJobRunner implements JobRunner { /* executes immediately */ }
export const jobRunner: JobRunner = new SynchronousJobRunner();
export function createJob<TInput>(name, input, metadata?): Job<TInput>;
export class RetryableJobError extends Error { readonly retryable = true; }
```

Same shape, deliberately, as `ScheduleOutcome`/`runDueWork` (per-unit
success/failure, error captured as a message, no batch-aborting) — that
convergence is validating evidence the shape is right, not something forced
by unifying the two files. They stay separate types in separate files
(Decision 1): a `ScheduleContribution` additionally carries a `cadence` and
runs inside `withTenant`; a `Job` is provider- and tenant-agnostic at this
layer, since discrete background work (send this one notification) may or
may not be tenant-scoped depending on the caller, and the contract should
not assume.

### Phase D — idempotency, documented per case

*   **Scheduled sweeps** — already required and already documented
    (`contribution.ts`'s own comment: "MUST be idempotent... a scheduler
    that guarantees exactly-once delivery does not exist"). One existing
    honesty gap noted, not fixed: `sweep_low_stock` re-notifies every buyer
    on every run with no "already notified for this state" guard — a
    pre-existing business-logic property of that one job, unrelated to the
    abstraction.
*   **Notification delivery** — sending twice is user-visible and
    undesirable. The write side is already idempotency-ready:
    `markSent()`'s `where: { status: "Pending" }` conditional update means a
    dispatcher calling it twice for the same notification is safe (the
    second call matches zero rows) — a real dispatcher, when built, gets
    this for free by using the existing function rather than writing its own
    status update.
*   **Domain-event outbox** — idempotency requirement is undecided
    (per-subscriber tracking is a real design question a single
    `deliveredAt` timestamp does not answer if there is ever more than one
    subscriber). Flagged, not resolved — building the actual dispatcher is
    out of this task's scope.
*   **Offline command replay** — already idempotent at acceptance
    (`enqueueOfflineCommand`'s unique constraint on `commandId`); replay
    itself does not currently retry a rejected item, so idempotency of
    re-running `replayPending` was not a live question to answer.
*   **`job.test.ts`'s idempotency tests** demonstrate the general principle
    with two contrasting handlers — one that guards on a unique key (no
    duplicate effect across two `run()` calls) and one that does not (visibly
    duplicates) — proving the contract does not manufacture a universal
    exactly-once guarantee, exactly as Phase D requires it not to.

### Phase E — failure and retry semantics

`JobOutcome` is exactly `success | failed(retryable) | failed(permanent)`.
No `cancelled` state: synchronous execution has nothing in flight to cancel;
a future queue-backed runner that can cancel would extend the union without
any existing handler changing. A handler signals "retry me" by throwing
`RetryableJobError`; anything else it throws is classified permanent —
matching this platform's established fail-closed convention (`authorize()`
throws rather than returning false; an unclassified failure defaults to "do
not retry" rather than "retry blindly," which would be the more dangerous
default for a non-idempotent handler).

### Phase F — current provider

**No queue exists today, and none was introduced.** `jobRunner` is a fixed
`SynchronousJobRunner` singleton — `run()` executes the handler immediately
and returns its outcome, mirroring exactly what a caller would do by hand
today (there is nothing to "wrap," since no background execution mechanism
for discrete work exists to wrap — confirmed by the Phase A inventory, not
assumed). This satisfies the task's own explicit allowance: *"If no real
queue exists today, a minimal synchronous/test implementation may be
sufficient for the abstraction until a production queue becomes
necessary."*

### Decisions made

1.  **`contribution.ts`/`runDueWork`/`ScheduleOutcome` were not touched or
    unified with `job.ts`.** They are the correct, already-existing
    SCHEDULED_JOB abstraction (Task 27's finding, restated: recognize
    working infrastructure rather than rebuild it). Forcing them to share a
    type with `job.ts` would be exactly the "rewrite scheduled jobs
    unrelated to the abstraction" this task's DO-NOT list forbids, for a
    unification with no behavioral benefit — the shape converging
    independently is the useful signal, not a reason to merge the code.
2.  **`job.ts` has no current caller**, and none was manufactured. Retrofitting
    an existing file (`sync.ts`'s `replayPending`, the closest real
    candidate) was considered and rejected: Offline Sync is a distinct
    capability (Bible V5 §2) this task has no mandate to touch, and the
    task's own brief explicitly sanctions building the contract ahead of a
    caller for exactly this situation. The contract is proven via its own
    direct tests (12 in `job.test.ts`) rather than an artificial retrofit.
3.  **No `RuntimeConfig` changes.** A synchronous in-process runner needs no
    configuration — no URL, no credential, no queue name. Zero new
    environment variables were added, which is itself the correct answer to
    this task's "Runtime Configuration" section ("do not introduce
    queue-specific environment variables unless the implementation actually
    needs them" — it does not).
4.  **No registry.** Same reasoning as `authProvider` (Task 28): there is
    exactly one active runner, chosen at compile time. A registry modelling
    "no runner configured" would model a state that cannot occur, since
    unlike storage, background job execution is not meaningfully optional.

### Files changed
*   **New**: `src/server/platform/job.ts` — `Job`, `JobOutcome`, `JobHandler`, `JobRunner`, `SynchronousJobRunner`, `jobRunner`, `createJob`, `RetryableJobError`.
*   **New**: `src/test/job.test.ts` — 12 tests (creation, execution outcomes, idempotency demonstration, boundary/shape).
*   `src/test/conformance.test.ts` — platform-module-count tripwire raised 26 → 27 for `job.ts`, same pattern as Tasks 26/28.
*   **No other file changed.** `contribution.ts`, `notification.ts`, `sync.ts`, `/api/scheduled/route.ts`, `vercel.json` are untouched.

### Tests executed
*   `npx vitest run src/test/job.test.ts` — 12/12 passed, isolated, first.
*   `npx vitest run src/test/job.test.ts src/test/scheduled-work-trigger.test.ts src/test/composition.test.ts src/test/sync-runtime.test.ts` — 48/48 passed (the new file alongside every existing scheduled-work/offline-sync test).
*   `npm run typecheck` — clean.
*   `npm run lint` — clean (same one pre-existing, unrelated `SmartTable.tsx` warning as Tasks 26-28).
*   `npm run test` (full suite) — 492/492 passed after raising the conformance tripwire.

### Results
Async execution fully inventoried and classified (table above). A
provider-neutral background-job contract exists (`job.ts`) where the
inventory justified one (BACKGROUND_JOB), and was deliberately not built
where an existing abstraction already covers the concept correctly
(SCHEDULED_JOB) or where nothing justifies it (DURABLE_WORKFLOW).
Application/domain code does not depend on any provider implementation
detail, because there is no provider beyond direct execution — the
`JobRunner` interface exists precisely so that remains true when one is
introduced. Current asynchronous behavior is unchanged (zero existing files
modified besides the conformance tripwire). Retry/failure/idempotency
semantics are documented per case above, not invented as a blanket
guarantee. Configuration required none.

### Limitations
*   `job.ts` has no current production caller. Its value is realized when a
    real dispatcher (notification delivery, outbox drain) is built — at
    which point that work defines a `JobHandler` and calls `jobRunner.run()`
    rather than inventing its own execution loop.
*   `dinein`'s `frequent` schedule is still not wired in `vercel.json` — a
    pre-existing deployment gap, unrelated to and not fixed by this task.
*   The domain-event outbox's idempotency contract (single `deliveredAt`
    timestamp vs. potential multiple subscribers) is unresolved — correctly
    left as an open design question rather than guessed at here.

### Follow-up work
*   Whoever builds the real notification dispatcher or outbox drain should
    use `job.ts`'s contract rather than a bespoke execution loop, and should
    reuse `markSent()`'s existing idempotent-update pattern rather than
    re-inventing one.
*   If cross-request durability is ever genuinely required (a job must
    survive the process that enqueued it, or run on a different process
    entirely), that is the trigger to introduce a real queue-backed
    `JobRunner` — a decision for whenever that requirement is real, not
    speculated on here.
*   The `frequent`-cadence cron-wiring gap is worth a small, separate,
    focused fix (adding one line to `vercel.json`) — flagged for whoever
    owns deployment configuration, not addressed in this commit.

### Decision Gate — explicit answer

> Does current Verity actually require a production queue/worker infrastructure now?

**NO — abstraction established, infrastructure deferred.** Every candidate
workload found in the inventory (notification delivery, outbox drain,
offline replay) is either currently synchronous-inline by design or
currently has no live trigger at all; none demonstrates a genuine need for
durable cross-process execution, retries beyond what per-unit try/catch
already provides, or worker/queue infrastructure. Introducing Redis, BullMQ,
or any queue now would be infrastructure adopted because it was researched,
not because a current requirement demands it — exactly what this task's
brief warns against.

### Final status
**Task 29 — COMPLETE.** Ready for Antigravity review.
