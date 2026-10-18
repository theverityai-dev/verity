# DSEW on-premises: Stage 2 design review

Date: 2026-10-18. Status: DESIGN for review. Nothing in sections 2 to 5 is built. Only D1 and D4 (section 1) were implemented.
Companion to `onprem-stage1-evidence.md`. The DSEW installation stays **on hold**: host facts and the client survey are unanswered.

## 1. Implemented and proven: D1 and D4 (commit `2f759905`, not pushed)

| Change | What it does |
|---|---|
| `build_images` in `deploy/scripts/_common.sh`, called by `install.sh` and `upgrade.sh` | builds the application image **and** the profile-gated tools image before any migration |
| guard in `deploy/scripts/migrate.sh` | refuses to migrate when the tools image's migration count differs from the checkout |
| `openssl` in the shared Dockerfile `base` stage | Prisma stops warning and falling back to openssl-1.1.x; image stays minimal; runtime still `USER nextjs` |
| `src/test/deploy-first-install.test.ts` | 5 file checks that fail if either defect returns |

**Evidence.**
- Fresh clone in WSL2 (project `verity-s2`, brand-new image tags, so no stale tools image): `install.sh` built both images, applied
  **141 of 141 migrations on the first attempt**, created the bucket and started web and scheduler; **0 OpenSSL warnings** in the
  log. Final readiness was 503 only because the test profile points at a placeholder IdP (`idp.example.invalid`).
- A first attempt with bucket name `s2` failed because S3 names need 3 or more characters; that was my harness, not a defect.
- Tests: `deploy-first-install` 5 pass. `container-runtime`, `deployment-package` and `deploy-image-pins` passed in the first run;
  the one failure in that run was my new test matching a comment, which I fixed, and I reran only the new file. The
  deployment-security validator passes. The full suite was **not** run.
- **Not covered:** a failed-upgrade rehearsal, and a clean build on the DSEW host.

## 2. Degraded-operation contract (APPROVED 2026-10-19; readiness part IMPLEMENTED in `ef929e27`)

Implemented: `src/server/platform/readiness-status.ts`, `/api/ready` returns `ready` (200), `degraded` (200, with per-component
`healthy|degraded|unavailable`) or `not_ready` (503); a `dependency_degraded_total` metric. Tests: `readiness-degraded` (18),
`readiness-scheduler-grace` (4), plus the existing `health-readiness` and `container-runtime` files, 43 tests passing together.
**Not yet done:** the storage-down file and evidence-refusal test, and an IdP-down test with a live session, both of which need the
rebuilt stack; the compose healthcheck is unchanged and still follows `/api/ready`, so it now stays healthy while degraded.

## 2a. (original design text)

Decision (approved): Verity keeps serving existing valid sessions when only the IdP, object store or scheduler is down, reports the
degradation, and fails safely for operations that need the missing service.

**Readiness shape.** `/api/ready` splits its checks into two groups.
- **Core** (failure means 503, "not ready"): `db`, `schema`, `rls`, `restore`, `runtime`.
- **Dependencies** (failure means HTTP 200 with `"status":"degraded"` and the failing check named): `identity`, `storage`, `scheduler`.
- `/api/health` stays process liveness only. The compose healthcheck keeps pointing at `/api/ready`, so only a core failure makes
  the container unhealthy; a dependency outage no longer does.
- Metrics gain a per-dependency gauge so monitoring can alert on `degraded`, since an HTTP 200 alone would hide it.

| Dependency down | New sign-in | Existing session | Normal reads and writes | Files and evidence | Readiness |
|---|---|---|---|---|---|
| Identity provider | fails with a clear message | works until local expiry or revocation | work | work | degraded |
| Object store | works | works | work | upload and download fail with a clear message | degraded |
| Scheduler | works | works | work | work | degraded after the grace period; background jobs stop |
| Database | fails | fails | fail | fail | not ready (503) |

**Never relaxed when degraded:** authorization, tenant isolation, QC checkpoints, and evidence requirements. A checkpoint that
requires evidence stays unrecordable without an evidence row; a store outage means the stage waits, it does not pass without proof.

**Scheduler grace period.** Today it is **15 minutes** since the last successful `frequent` run (`SCHEDULER_FRESH_MS` in
`readiness.ts`; its comment says it tolerates two missed ticks of a 5-minute cadence). Stage 1 saw readiness stay 200 for 150 s,
which is **consistent with the intended behaviour, not a defect**. The expiry itself has not been tested. Proposed: keep 15 minutes,
or shorten to about 5 minutes for the on-prem sidecar, which ticks every minute. Product owner decides.

**Acceptance tests to write before implementing** (none exist):
1. IdP stopped: `/api/ready` 200 `degraded`; an existing session loads pages; a new sign-in fails with a plain message.
   (Stage 1 saw today's behaviour: 503, session works.)
2. Object store stopped: degraded; jobs and stages without evidence work; an evidence-required checkpoint and a file upload are refused.
3. Scheduler stopped past the grace period: degraded plus a metric; stopped inside it: ready.
4. Database stopped: 503; liveness 200.
5. In every combination a negative cross-tenant read still fails.

## 3. Per-user session revocation (design)

**Finding that shapes the design.** `resolveActor()` calls `verity.memberships_for_auth_user(auth_user_id)` on **every** request
(`auth.ts`, read in this audit), so the application already enforces access from its own database on each request. The signed
cookie proves who someone is; the database decides whether that identity still belongs anywhere, and a person with no usable
membership resolves to no actor and fails closed. The missing piece is only a way to mark a person as disabled.

**Proposal.**
- Add `disabled_at timestamptz` (nullable) to `tenant_membership` (per workspace).
- A new migration redefines `memberships_for_auth_user` to omit memberships where `disabled_at IS NOT NULL`, keeping its
  `SECURITY DEFINER`, fixed `search_path` and no PUBLIC execute grant (CI already proves these properties).
- Two audited commands, `disable_access` and `restore_access`, needing a dedicated permission and a reason, writing the normal
  activity record. Not an IdP adapter: no Keycloak Admin call is added.
- Effect: the next request from a disabled person's existing cookie resolves to no actor, with no IdP contact. The one-hour idle and
  eight-hour absolute limits stay as extra bounds. The same applies to a bearer ID token, which also goes through `resolveActor`
  (code reading, untested).
- Offboarding is two steps: disable in Keycloak (stops new sign-ins) and disable access in Verity (ends existing sessions).

**Why not a session registry.** It adds a table read and write per request and a second source of truth beside memberships. The
membership lookup already runs per request, so a column on it costs nothing extra and cannot drift.

**Decision needed.** This changes an identity function and adds a permission, so it needs a short ADR and the product owner's
approval before code (the `verity-adr-gate` rule). It must not weaken RLS, `withTenant()` or authorization.

**Offboarding today (corrected 2026-10-19).** Disabling the Keycloak account stops new sign-ins only; it does not invalidate the
already-issued Verity cookie. A Verity-side step that does end access already exists and is tested: `revoke_membership` deletes
the membership, so the next request resolves to no actor (`hq-administration.test.ts`). It is **irreversible** (the role and
placement are lost). An earlier version of this section said no Verity-side revocation existed; that was wrong. Clearing a role is
**not** an operating procedure (untested end to end, leaves an empty signed-in shell). The bounded exposure without either step is
the 1 h idle and 8 h absolute limits. **Do not claim immediate revocation.**

**Reversible disable (ADR-049, implemented on the local database only, not deployed).** `disable_membership` /
`restore_membership` need a dedicated permission and a reason, are audited atomically, and take effect at the next authorization
check for sessions, API keys and HQ operator functions. See ADR-049 for the evidence and the open review points.

**Status 2026-10-19:** direction approved by the product owner with safeguards; `verity-spec/17_decisions/adr/adr-049.md`
(PROPOSED) is **implemented and tested on the local database only** (migration `20261019100000_membership_disable`, two commands,
`src/test/membership-disable.test.ts`). Awaiting review; not pushed, not deployed. The approved guarantee is "revoked at the next
authorization check", not instant termination of in-flight requests.

## 4. Outbound network policy (design)

Default **deny** outbound from application services. Allowed: private service traffic only (web to PostgreSQL, Keycloak and the
object store; scheduler to web), and DNS and NTP from DSEW-approved internal servers. Explicitly off: Sentry
(`NEXT_PUBLIC_SENTRY_DSN` unset), the external decision endpoint (the `decision_egress` capability inactive; its default URL is
`api.typesafe.ai`), the agent chat provider (`OPENAI_API_KEY` and `OPENAI_BASE_URL` unset, or a local model endpoint later), and
`EXTERNAL_TOOLS_ENABLED` unset. Image updates travel through a controlled maintenance step. **Acceptance:** run the stack behind a
firewall or Docker network that blocks egress, drive sign-in, a job, an upload and a backup, and list every denied connection.
Zero egress is **not claimed** until that passes. The build-time font fetch affects builds, not runtime.

## 5. Order of work after this review

1. Product owner approves: the degraded contract (section 2), the revocation ADR (section 3), and the scheduler grace value.
2. Write the section 2 acceptance tests first, then implement readiness degradation.
3. Write the revocation ADR, then the migration, commands and tests (with negative cross-tenant tests).
4. Only then authorise the Keycloak and proxy implementation.
5. DSEW server facts remain required before any install.

**Go/no-go: NO-GO for a DSEW installation; go for steps 1 to 4.**

## 6. Client survey (to send; no answers yet)

Server make, model, OS and exact Windows Server build; CPU, installed and free RAM, free storage and current workloads; whether
Hyper-V is available and licensed and a dedicated Linux VM is permitted; LAN only or also remote over VPN; whether shop-floor
phones reach the internal HTTPS name and trust its certificate; backup destination, IT owner and acceptable recovery time and
data-loss window; and the outbound-network policy for production systems. Until answered, host compatibility is **unknown**.
