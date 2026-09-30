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
- **No sign-in automation.** Provide `AUTH_COOKIE` from a real signed-in session.
  Automating sign-in depends on the auth provider (Supabase or OIDC) and on the
  air-gapped auth decision in Task 123 Phase 5.

## Run order for a real measurement

1. Disposable Postgres plus the app from the container image, never the shared
   Supabase project. The app must connect as `verity_app`.
2. Seed volume: `SCALE_CONFIRM_DISPOSABLE=1 TENANTS=.. EVIDENCE_PER_VISIT=..
   SCALE_VISITS=.. npm run seed:scale` (or the `WORKERS` workload form). Read-path
   and index measurement only; the seed writes no events or audit rows.
3. Run k6 with the stages you mean to claim.
4. Repeat the whole run. A number is a number only when a second run agrees.

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
