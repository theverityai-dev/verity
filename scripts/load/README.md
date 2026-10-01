# Load harness

Authority: `taskplans/123_enterprise_readiness_evidence_program.md`, Phase 3.
Status: scaffolding only. **No result from this folder is a claim yet.** Every
number needs a Phase 0 workload, a named hardware spec and a reproduced second
run first.

## What is here

- `verity.k6.js` — k6 ramp over a readiness probe plus authenticated page reads.
  Every knob is required; there is no default load. Emits one JSON artifact per
  run into `scripts/load/results/`.

## What is deliberately not here

- **No write scenario.** Writes must go through the real command path. The only
  authenticated machine surface is `POST /api/tools/invoke` (ADR-029, dark by
  default). Choosing it, or another surface, is an open decision; do not add a
  write figure by pointing at a bypass.
- **No Supabase sign-in automation.** For OIDC deployments, `oidc-login.mjs`
  signs in through the real authorization-code flow and writes the session
  cookie to a file (`IDP_USER_FIELD` is `username` for Keycloak, `login` for
  Dex). Pass it to k6 as `AUTH_COOKIE`. **Dex cannot be used for Verity
  sign-in:** its `sub` is `base64url(protobuf{user_id, conn_id})`, not the
  static `userID`, and ADR-020 requires the principal claim to be a UUID, so the
  callback refuses it as `unprovisionable_subject`. Use an IdP whose `sub` is a
  UUID (Keycloak does this natively).

## Run order for a real measurement

1. Disposable Postgres plus the app from the container image, never the shared
   Supabase project. The app must connect as `verity_app`.
2. Seed volume: `SCALE_CONFIRM_DISPOSABLE=1 TENANTS=.. EVIDENCE_PER_VISIT=..
   SCALE_VISITS=.. npm run seed:scale` (or the `WORKERS` workload form). Read-path
   and index measurement only; the seed writes no events or audit rows.
3. Run k6 with the stages you mean to claim.
4. Repeat the whole run. A number is a number only when a second run agrees.

## Gotchas found on the first authenticated run (2026-10-01)

- **HTTP 200 is not success.** Verity renders its access-denied screen with
  status 200 (the platform operator is denied `/`). Pass
  `FORBID_BODY_TEXT="do not have access"` so a refusal fails the check, and
  choose routes the signed-in role can actually read.
- **`/api/ready` needs a fresh scheduler.** Without the scheduler service
  (`scripts/run-scheduler.mjs`) the probe returns 503 `scheduler_stale` within
  minutes, which a load run records as failures that are not performance. Run
  the scheduler alongside the app.
- **The web runtime must not hold `DIRECT_URL`.** Readiness fails with
  `runtime_privilege_or_secret_invalid` if the privileged migration URL is in the
  app environment. Give the app `DATABASE_URL` (as `verity_app`) only.
- **Build from a tree with no `.env` files** if the host has real ones: Next loads
  `.env*` from the project directory, which would put production values into a
  lab app.
- Git Bash on Windows rewrites a leading `/` in arguments; set
  `MSYS_NO_PATHCONV=1` when passing `READ_ROUTES=/hq,...`.

## Pooler-stress run

The transaction-mode pooler limit (port 6543, `pgbouncer=true`) is the failure
that took production down once. To exercise it, repeat the same run with a
deliberately small `connection_limit` on `DATABASE_URL` (and a small pooler
pool, if a pooler is in front) and record the label, for example
`RUN_LABEL="pool=2"`. The expected evidence is queueing and error rate under a
scarce pool, not a crash.

## Record with every run

Hardware (vCPU, RAM, disk), Postgres version and settings, pool size, app
instance count, dataset size (the seed report), and the k6 artifact. Put them in
`RUN_LABEL` or the results file so a run is reproducible from the file alone.
