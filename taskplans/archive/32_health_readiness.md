# Task Plan 32 — Health & Readiness Checks

## 1. Objective

Add two unauthenticated HTTP endpoints that enable container orchestrators
(Docker Compose healthcheck, Kubernetes liveness/readiness probes, load
balancers) to interrogate Verity's operational state without relying on
page-load paths or database-gated application routes.

| Endpoint | Purpose | Failure means |
|---|---|---|
| `GET /api/health` | Liveness — process is alive and responding | Container should be restarted |
| `GET /api/ready` | Readiness — DB is reachable, app can serve traffic | Container should be removed from rotation |

---

## 2. Requirements

### VERITY-INFRA-004: Liveness probe
- Returns `200 OK` with a JSON body as long as the Next.js process is running. No I/O. No auth.
- Body: `{ "status": "ok", "version": "<package.json version>" }`.

### VERITY-INFRA-005: Readiness probe
- Returns `200 OK` only when the database is reachable. Returns `503 Service Unavailable` otherwise.
- Check: one lightweight `SELECT 1` via the existing `prisma` singleton.
  Do not check external services (Supabase Storage, Auth) — those are optional adapters.
- Body on success: `{ "status": "ready", "checks": { "db": "ok" } }`.
- Body on failure: `{ "status": "not_ready", "checks": { "db": "error", "detail": "<message>" } }`.

---

## 3. Design constraints (read before writing a single line)

1. **No new infrastructure.** Both endpoints are Next.js Route Handlers
   (`src/app/api/health/route.ts`, `src/app/api/ready/route.ts`).

2. **No authentication middleware on these routes.** Add `/api/health` and
   `/api/ready` to the matcher exclusion list in `src/middleware.ts` if needed.

3. **Reuse the existing `prisma` singleton** (`src/server/platform/db.ts`).
   Do NOT create a second Prisma client for health purposes.

4. **`/api/ready` DB check must be timeout-bounded.** Use `Promise.race`
   against a 3-second timeout — no extra libraries.

5. **The liveness probe must never touch the database.** `/api/health` returns
   200 even when the DB is down.

6. **Add `export const dynamic = "force-dynamic"`** to each route to prevent
   Next.js static pre-rendering.

---

## 4. Files to create / modify

### [NEW] `src/app/api/health/route.ts`
```ts
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json({ status: "ok", version: process.env.npm_package_version ?? "unknown" });
}
```

### [NEW] `src/app/api/ready/route.ts`
```ts
import { NextResponse } from "next/server";
import { prisma } from "@/server/platform/db";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("db probe timeout")), 3000)),
    ]);
    return NextResponse.json({ status: "ready", checks: { db: "ok" } });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { status: "not_ready", checks: { db: "error", detail } },
      { status: 503 },
    );
  }
}
```

### [MODIFY] `src/middleware.ts`
- Audit the matcher. If it applies auth redirects to `/api/...` routes broadly,
  exclude `/api/health` and `/api/ready`. If middleware only protects specific
  routes via a positive match list, confirm no change is needed.

### [MODIFY] `docker-compose.yml`
- Add to the `web` service:
```yaml
healthcheck:
  test: ["CMD-SHELL", "curl -f http://localhost:3000/api/ready || exit 1"]
  interval: 10s
  timeout: 5s
  retries: 3
  start_period: 30s
```
- Verify `curl` is available in the Dockerfile runner stage, or substitute
  `wget -qO- ... | grep -q ready`.

### [NEW] `src/test/health-readiness.test.ts`
Unit tests (mock `prisma`, no live DB):
1. `prisma.$queryRaw` resolves → `/api/ready` returns 200 `{ status: "ready" }`.
2. `prisma.$queryRaw` throws → `/api/ready` returns 503 `{ status: "not_ready" }`.
3. `/api/health` returns 200 regardless of DB state.
4. (Optional) Timeout path: never-resolving mock → 503 within ~3.5s.

---

## 5. Verification & Acceptance Criteria
- [x] `GET /api/health` returns 200 JSON when the process is running — verified against the real standalone build, not only unit-mocked.
- [x] `GET /api/ready` returns 200 JSON when DB reachable, 503 when not — verified against the real standalone build with a real unreachable-database case.
- [x] Neither endpoint triggers a login redirect — proxy.ts never redirects at all (see §7); both are additionally excluded from its matcher.
- [x] `docker-compose.yml` healthcheck block added to `web` service, using `node`/`fetch`, not `curl`.
- [x] New unit tests pass in isolation.
- [x] Full suite passes, no regressions.
- [x] `npm run typecheck` and `npm run lint` clean.

---

## 7. Implementation Notes (Claude Code, 2026-08-30)

### Two deliberate deviations from this document's own §4 draft

1.  **Version source**: the draft's `process.env.npm_package_version` is
    unreliable in exactly the environment this matters most for — `npm_package_version`
    is injected only by npm's own process-spawn machinery (`npm run ...`),
    and Task 30's Dockerfile `CMD` is `node server.js` directly, never
    through npm. Under that CMD the variable would simply be `undefined`,
    silently returning `"unknown"` in every containerized deployment. Used
    `package.json`'s own `version` field instead, via a named JSON import
    (`import { version } from "../../../../package.json"`, `resolveJsonModule`
    already enabled in `tsconfig.json`) — confirmed present and correct
    inside `.next/standalone/package.json` (Next's own standalone tracing
    already copies the full `package.json`, verified in this session's Task
    30 work). One authoritative version source, not two, per this task's own
    instruction — the draft's mechanism was simply the wrong one for how
    this application actually starts in production.
2.  **Compose healthcheck tool**: the draft's `curl -f ...` assumes a binary
    that Task 30's Dockerfile never installs and that Debian's `-slim`
    images (the chosen base, `node:20-bookworm-slim`) do not ship by
    default. Used `node -e "fetch(...)"` instead — `node` is unconditionally
    present (it is the base image), and Node 20's global `fetch` has been
    stable and unflagged since Node 18, so this adds no dependency at all.
    This is exactly the choice this task's own (separately authored, more
    current) instructions explicitly steer toward: *"Do not assume `curl`
    exists... Inspect the Docker image before choosing."*

### Route design

*   **`GET /api/health`** (`src/app/api/health/route.ts`) — reads only the
    imported `version` constant, returns `{ status: "ok", version }`. No
    import of `db.ts`, `config.ts`, or any provider adapter. Proven, not
    merely written that way: a test mocks `@/server/platform/db` with a
    throwing getter, confirming the handler never touches it even if it were
    changed to.
*   **`GET /api/ready`** (`src/app/api/ready/route.ts`) — imports the
    existing `prisma` singleton from `src/server/platform/db.ts` (Task 26's
    own established decision to leave that file's Prisma construction
    untouched — this route is simply another caller of the same singleton,
    not a reason to revisit that). Probes with `SELECT 1` via `$queryRaw`,
    bounded by a 3-second `Promise.race` against a `setTimeout`. Storage
    (Task 27) and auth (Task 28) are deliberately NOT probed — both are
    designed to degrade gracefully when unavailable (an unconfigured storage
    driver is a valid deployment; an auth outage is the page's own
    `requireActor()` concern), so including them would report "not ready"
    for conditions that are not actual outages of the one dependency nothing
    in this application works without.

### Database probe implementation

```ts
const dbProbe = prisma.$queryRaw`SELECT 1`;
dbProbe.catch(() => {});           // see below
const timeout = new Promise<never>((_, reject) => {
  timer = setTimeout(() => reject(new Error(`...timed out after ${MS}ms`)), MS);
});
try {
  await Promise.race([dbProbe, timeout]);
} finally {
  clearTimeout(timer);
}
```

Two details worth stating explicitly, since the task singled out exactly
these failure modes:

*   **The timer is always cleared**, on the success path AND the
    timeout/error path (`finally`), so no open handle survives a call to
    this route.
*   **The losing side of `Promise.race` is not cancelled** — `Promise.race`
    never cancels anything, it only ignores the slower promise. If the real
    database call eventually settles (resolves or rejects) after the
    timeout already won, an un-awaited rejection would print an
    unhandled-rejection warning; the `dbProbe.catch(() => {})` line exists
    solely to prevent that, and does not affect which branch of the race
    wins or what gets returned to the caller.
*   **No cancellation of the underlying query** — the timeout only stops
    *this request* from waiting further; it does not send a cancel signal
    to PostgreSQL. Prisma's `$queryRaw` has no clean, dependency-free
    cancellation hook available here, and `SELECT 1` is cheap enough that
    an abandoned one self-terminates trivially — this is the "simplest safe
    implementation compatible with the existing runtime" the task asked
    for, not a claim of true query cancellation.

Error messages are passed through a `sanitize()` pass that redacts any
embedded `scheme://user:pass@host` pattern before being returned in the
response body. Empirically, Prisma's own connection-failure messages
(observed directly in this session, both in an earlier unrelated test
failure and in this task's own live DB-down test below) name only
`host:port`, never credentials — the sanitizer is defense in depth for an
error shape this project has not actually produced, documented as such
rather than presented as fixing a real leak.

### Timeout behavior

Tested with `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(3000)` — the
test completes in well under a second of real wall-clock time (the whole
file runs in ~0.2–0.5s), not the 3 real seconds a naive test would cost.
`afterEach` calls `vi.useRealTimers()` unconditionally so fake-timer state
never leaks into a later test file.

### Middleware (proxy) decision

`src/middleware.ts` does not exist in this repository — Next.js 16 renamed
the convention to `proxy` (already documented in `src/proxy.ts`'s own header
comment, predating this task). Read `src/proxy.ts` in full before touching
it. Its actual behavior: it never redirects anything — it only attempts a
Supabase session refresh and always falls through to
`NextResponse.next()`, degrading silently on any failure (Task 26's own
established, tested contract). So neither endpoint was ever at risk of a
login redirect from the proxy specifically.

What the proxy's un-excluded matcher DID mean for these two routes: every
request to them would trigger an unbounded Supabase `auth.getUser()` network
call before reaching the route handler at all — directly violating
`/api/health`'s own "no external service calls, deterministic" requirement,
and adding an unnecessary, unbounded delay ahead of `/api/ready`'s own
already-bounded probe. Fixed by adding `api/health` and `api/ready` as two
more alternatives in the existing negative-lookahead matcher — the same
mechanism that already excludes `_next/static`/`_next/image`/`favicon.ico`,
not a new mechanism. No authentication behavior changed for any other route;
verified by a test asserting the pattern still contains the original
exclusions (`_next/static`, `favicon.ico`) in addition to the two new ones.

### Compose healthcheck implementation

```yaml
healthcheck:
  test:
    ["CMD", "node", "-e", "fetch('http://localhost:3000/api/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
  interval: 10s
  timeout: 5s
  retries: 5
  start_period: 15s
```

Targets `/api/ready`, not `/api/health` — a healthcheck exists specifically
to catch the case a liveness probe cannot (a reachable process whose
database is down); pointing it at `/api/health` would make the healthcheck
unable to ever fail for the one condition it exists to detect.
`start_period: 15s` gives the application a grace window to start (Next's
standalone server reports "Ready" almost instantly per this session's own
live test below, but the grace period costs nothing and protects against a
slower first start in a resource-constrained environment).

### HTTP status semantics

| Condition | `/api/health` | `/api/ready` |
|---|---|---|
| Database reachable | 200 | 200 |
| Database unreachable | 200 (unaffected — no DB access at all) | 503 |
| Database probe times out (3s) | 200 (unaffected) | 503 |

Matches the task's own "IMPORTANT ACCEPTANCE TEST" table exactly — and, as
documented in "End-to-end verification performed" below, this table was
proven against a real running instance, not merely designed to satisfy it
on paper.

### Security considerations

*   Neither route requires authentication (by design — infrastructure
    tooling has no session/cookie to present).
*   `/api/ready`'s error detail passes through `sanitize()` before being
    returned — see "Database probe implementation" above.
*   Neither route's stack trace is ever returned — only `error.message` (or
    `String(error)` for a non-`Error` throw), never `error.stack`.
*   No connection string, credential, or internal topology beyond
    "host:port, in an already-public error class" is exposed.
*   Neither route performs an expensive query — `SELECT 1` only.
*   Neither route probes Supabase Storage, Supabase Auth, or any optional
    integration — see "Route design" above for why.

### Files changed
*   **New**: `src/app/api/health/route.ts`, `src/app/api/ready/route.ts`.
*   **New**: `src/test/health-readiness.test.ts` — 9 tests (liveness 200 +
    version + no-DB-access tripwire + dynamic export; readiness success +
    failure + credential-redaction + timeout + dynamic export; proxy
    matcher exclusion).
*   `src/proxy.ts` — matcher gained two exclusions (`api/health`,
    `api/ready`); the `proxy()` function itself is byte-for-byte unchanged.
*   `docker-compose.yml` — `web` service gained a `healthcheck` block. No
    other change; the two-service topology (Tasks 27/28/29's own
    conclusions) is unchanged.
*   `src/test/container-runtime.test.ts` (Task 30's file) — one test added,
    confirming the Compose healthcheck targets `/api/ready` (not
    `/api/health`) and uses neither `curl` nor `wget`.

### Tests executed
*   `npx vitest run src/test/health-readiness.test.ts` — 9/9 passed,
    isolated, first.
*   `npx vitest run src/test/container-runtime.test.ts src/test/health-readiness.test.ts` — 26/26 passed together.
*   `npx vitest run src/test/proxy.test.ts src/test/health-readiness.test.ts` — 13/13 passed together, confirming the matcher change did not disturb `proxy()`'s own existing regression coverage.
*   `npm run build` (local, real `.env`) — succeeds; `/api/health` and
    `/api/ready` both appear in the route manifest marked `ƒ` (dynamic),
    confirming `force-dynamic` took effect and neither was statically
    prerendered.
*   `npm run typecheck` — clean.
*   `npm run lint` — clean (same one pre-existing, unrelated
    `SmartTable.tsx` warning as every prior Phase 7 task).
*   `npm run test` (full suite) — **521/521 passed**. No conformance-tripwire
    change needed (the new files live in `src/app/api/` and `src/test/`,
    not `src/server/platform/`).

### End-to-end verification performed (beyond unit tests, without Docker)

No Docker daemon was available (same limitation as Tasks 30/31), so the
actual Compose healthcheck could not be exercised inside a container.
Instead, this task went further than static inspection alone: it started
the REAL standalone production build (`.next/standalone/server.js`, the
exact artifact `node server.js` runs in the image) as a plain local Node
process — twice, once with the real `DATABASE_URL` and once with a
deliberately unreachable one — and issued real HTTP requests against both
running instances.

**Database reachable** (`DATABASE_URL` = the real project connection):
```
GET /api/health → 200 {"status":"ok","version":"0.1.0"}
GET /api/ready  → 200 {"status":"ready","checks":{"db":"ok"}}
```

**Database unreachable** (`DATABASE_URL` pointed at `127.0.0.1:1`, a
guaranteed-refused port):
```
GET /api/health → 200 {"status":"ok","version":"0.1.0"}
GET /api/ready  → 503 {"status":"not_ready","checks":{"db":"error",
  "detail":"...Can't reach database server at `127.0.0.1:1`..."}}
  (elapsed ~1.1s — Postgres actively refused the connection well inside the
  3s timeout, so the timeout branch itself was not exercised by this
  particular run; the timeout branch IS covered, separately, by the fake-timer
  unit test above)
```

This is the exact table from the task's own "IMPORTANT ACCEPTANCE TEST"
section, reproduced against a real running process, not only designed to
satisfy it. Both test server processes were identified by the TCP ports
they bound (`Get-NetTCPConnection`) and terminated afterward; the database
was never actually reachable-then-broken (a separate throwaway connection
target was used), so no real connection pool or shared state was disturbed.

### Docker verification limitations

*   The Compose `healthcheck` block itself — its exact YAML shape, whether
    Docker's healthcheck runner actually invokes `node -e "..."` as written,
    and the `interval`/`retries`/`start_period` timing — was **not**
    exercised inside an actual container. This is a real gap: the
    route-level behavior above was proven against the same server binary a
    container runs, but the Compose healthcheck mechanism wrapping it was
    not.
*   Confirmed by direct inspection (not execution) that `node:20-bookworm-slim`
    does not have `curl`/`wget` installed by this project's Dockerfile — no
    `apt-get install` of either appears anywhere in it — consistent with
    Debian's own well-documented "slim" image composition, not independently
    re-verified by running the image (no Docker daemon).
*   Explicitly deferred to Task 34, per this task's own instruction.

### Follow-up work
*   Task 34: run `docker compose up --build`, from a genuinely fresh
    volume, and confirm the `web` service's Docker-reported health status
    transitions correctly (starting → healthy with DB up; unhealthy after
    DB is stopped) — the one thing this task could not verify without a
    daemon.
*   If Kubernetes is ever targeted (explicitly out of scope through Task
    30), `/api/health`/`/api/ready` are already shaped as ordinary
    liveness/readiness probe targets and should not need redesigning —
    only a `livenessProbe`/`readinessProbe` manifest pointing at the same
    two paths.

### Final status
**Task 32 — COMPLETE, with one named limitation (the Compose healthcheck
block was not exercised inside an actual container — no Docker daemon
available; the underlying route behavior it wraps WAS verified against the
real standalone server binary).** Ready for Antigravity review.

---

## 6. What NOT to do

- Do NOT add Prometheus `/metrics`, `/api/status` UI page, or any new npm dependency.
- Do NOT create a second Prisma client for the health probe.
- Do NOT hardcode any tenant ID or credentials in these routes.
- Do NOT probe Supabase Storage or Auth adapters from the readiness endpoint.
