# Client-owned Vercel and Supabase deployments: research and recommendation

**Date:** 2026-10-16. **Status:** Research, nothing built. **PARKED 2026-10-22 by ADR-054 (PROPOSED): no work until a named paying client requires Mode D.** Needs a product-owner decision (section 9).
Authority it builds on: ADR-031 (deployment modes), ADR-032 (public origin), ADR-013/034/035 (HQ operator
model), ADR-020 (OIDC), INV-001. Written for the product owner and the engineers who would build it.

## 1. The question

Can a small client's Verity run on the client's own Vercel and Supabase accounts, instead of Verity's
shared Vercel project and shared Supabase database? The idea came from a chat answer pasted on
2026-10-16 that recommends it as the default for small clients. This document checks that idea against
the repository and against the providers' current documentation.

**Short answer.** Yes, it is technically feasible, and it is a legitimate offer for a client who wants
their data under their own account. It is **not** free, **not** a smaller job than the shared model, and
**not** ready today: five things in the repository block a clean install into a fresh Supabase project
(section 5), and two provider rules change the cost (section 3). I recommend keeping the shared
deployment as the default and offering client-owned as a priced option after a pilot (section 8).

## 2. How it fits ADR-031

ADR-031 names three modes, all "Verity and PostgreSQL on the client's infrastructure":
A (internet-connected on-prem, the only promised mode), B (private network, not promised) and C
(air-gapped, not promised). **Client-owned Vercel and Supabase is none of them**: the client owns cloud
accounts that Verity operates on their behalf. ADR-031 constraint 1 says every claim names its mode, and
constraint 2 says no unproven mode is sold. So this needs a **new mode in an ADR** before it is offered.
Working name: **Mode D, client-owned managed cloud** (proposed as ADR-045, section 9). It reuses Mode A's
isolation rules unchanged (constraint 4): the runtime connects as `verity_app`, `assertRlsEnforceable()`
refuses a bypassing role, tenant context comes from the authenticated context.

## 3. Provider facts (checked 2026-10-16)

| Fact | Source | Effect on this plan |
|---|---|---|
| Vercel **Hobby is non-commercial, personal use only** (fair use guidelines). | Vercel docs, Hobby plan page (updated 2026-09-14) | A client running a business on a Hobby project breaks Vercel's terms. The client account must be **Pro**. |
| Vercel Pro developer seats cost **$20 per user per month**; viewer seats are free. | same page | Each client pays at least one seat, plus usage. Each Verity engineer who deploys for them is also a seat. |
| **A Hobby team cannot deploy a private repository owned by a GitHub organisation.** On a Pro team the **commit author must be a member of the team** that owns the Vercel project. | Vercel docs, "Deploying Git repositories", private repositories section (updated 2026-09-18) | Connecting our private repository to a client's Vercel project is blocked or awkward. Either we add our engineers to each client's team, or we deploy with the Vercel CLI (which works with any Git provider) from our own CI using a scoped token. |
| Hobby cron runs once a day at most. | Vercel cron docs (secondary sources; the official page versions conflict) | `vercel.json` already carries one daily cron. Sub-daily work needs Pro cron or an external trigger (section 5, blocker 4). |
| Supabase **Pro, Team and Enterprise get automatic daily backups** (7, 14, 30 days). **Point-in-time recovery is a paid add-on** (about $100 per month for 7 days). The docs do **not** give free projects backups and tell them to export regularly with `supabase db dump`. | Supabase docs, Backups | Free is not acceptable for a client's books. Pro is the minimum, and the restore must be rehearsed. |
| Supabase restore: project is unavailable during it; **custom role passwords are not in daily backups and must be reset**; **Storage objects are not included**, only their metadata. | same page | `verity_app` needs its password reset after any restore. Uploaded files need their own backup. |
| Supabase free projects pause after a week of inactivity; Pro is about $25 per month. | Third-party pricing summaries only | Treat as unverified; confirm on supabase.com/pricing before quoting. |

So the honest floor per client is: Vercel Pro (at least $20 a month) plus Supabase Pro (about $25 a month
plus compute), before any Verity fee. The pasted answer's "your hosting costs: lower" is true for Verity
only because the client pays; the **client's** cost is higher than their share of one shared deployment.

## 4. What the repository already does well

- **Reproducible schema.** 142 Prisma migrations; Phase 0.9 (`implementation/phase-0-9-fresh-migration.md`)
  proved the history builds the schema exactly on an empty PostgreSQL cluster. It was **not** run on a fresh
  Supabase project, so Supabase-specific behaviour is unproven.
- **Role split is explicit.** `DATABASE_URL` is the `verity_app` runtime connection through the pooler in
  transaction mode (port 6543, `pgbouncer=true`); `DIRECT_URL` is `postgres`, used only by `prisma migrate`.
  The tenant GUC is transaction-local, so transaction-mode pooling is safe (`CLAUDE.md`).
- **Controlled migrations.** `build` is `prisma generate && next build`; migrations are never run by the
  build. `deploy/scripts/upgrade.sh` is the model: back up, migrate, restart, verify, and migrations are
  forward-only with the backup as the rollback.
- **Operational endpoints.** `/api/health`, `/api/ready`, `/api/metrics`; scheduler at `/api/scheduled`
  with `CRON_SECRET` (503 rather than running unauthenticated).
- **Auth is a closed choice.** `VERITY_AUTH_PROVIDER` is `supabase` (default) or `oidc`; the pasted answer's
  "Clerk or other" does not apply. A client-owned instance on Supabase uses Supabase Auth in the client's
  own project.
- **Single environment contract.** `.env.example` lists the variables: `DATABASE_URL`, `DIRECT_URL`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`,
  `VERITY_SESSION_SECRET`, `SUPABASE_JWT_SECRET`, `CRON_SECRET`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_MEDIA_BUCKET`, optional `OPENAI_*` and `SENTRY_*`.

## 5. Blockers for a clean install into a client's fresh Supabase project

Ranked by severity. Each has evidence and the smallest fix.

1. **High: `verity_app` is not created by any migration.** `20260826000000_runtime_role_privileges` says it
   "does not create the role"; `deploy/db/init/01-create-app-role.sh` creates it only for the Docker image,
   and production was done by hand. On a fresh Supabase project a person must run
   `CREATE ROLE verity_app LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS;` **before** `migrate deploy`, or
   the privileges migration no-ops with a NOTICE and the runtime fails with "permission denied for table
   tenant" (the exact failure Phase 0.9 documented). Fix: a documented, scripted, idempotent
   `provision-db-role` step with the password generated and stored in the client's own secret store; a
   post-migrate check that `verity_app` can read and `assertRlsEnforceable()` passes. Also confirm the
   pooler login form (Supabase's pooler expects `role.project-ref`) in the client's dashboard.
2. **High: the first operator and tenant do not exist on a fresh database.** `prisma/bootstrap-operator.ts`
   creates the "Verity Platform" tenant and operator role but "never creates an identity" (ADR-007): the
   operator's sign-in must already exist in Supabase Auth (`prisma/create-login.ts`). A new instance needs
   a scripted order: create database, run role step, migrate, create the login, bootstrap the operator,
   create the client's own tenant and owner. None of this is assembled into one runnable procedure for a
   cloud (non-Docker) target.
3. **High: the HQ model assumes one database for all clients.** ADR-013/034/035 give the Verity operator
   authority inside clients that live in the **same** database (HQ client list, support sessions, health,
   failed-command totals, announcements). With one database per client there is **no cross-instance HQ**:
   you cannot see, enter or announce to 10 separate instances from one console, and the operator would be a
   named user inside each client's instance, with the client controlling that access. That is a real
   product change to how support works, not a deployment detail, and it needs the ADR.
4. **Medium: scheduler is wired to one deployment.** `vercel.json` has one daily cron.
   `.github/workflows/scheduled-work.yml` triggers sub-daily work through two repository secrets
   (`VERITY_BASE_URL`, `CRON_SECRET`) for a **single** URL. Per client you need either Vercel Pro cron in
   their project (move the three cadences into their `vercel.json`) or a matrix over a deployment registry.
   Readiness also flaps today on `scheduler_stale` (`FINISHER` P0-1); every instance would inherit that.
5. **Medium: storage and secrets.** Evidence files need the Supabase Storage bucket and a service-role key
   (`prisma/ensure-storage-bucket.ts`, `SUPABASE_SERVICE_ROLE_KEY`). Storage is not in Supabase backups, so
   each instance needs its own file backup. The service-role key bypasses RLS and must be server-only.
6. **Medium: release and migration channel.** Nothing today rolls one release to N Vercel projects or runs
   migrations against N databases. `release.yml` builds a signed container image for compose installs; it
   does not deploy to Vercel. We need a deployment registry (client, Vercel project id, Supabase project
   ref, release, migration version, last backup verified), a per-client migration job, and a rule that a
   code version never deploys ahead of its migrations.
7. **Low: environment-specific hardcoding.** `vercel.json` pins `"regions": ["bom1"]`. Check the region
   suits each client's Supabase region (latency between function and database).

## 6. Where the pasted advice does not fit Verity

- It suggests starting client-owned "for small clients". Verity's decided market is multi-tenant SaaS for
  10 to 100 person businesses (one shared deployment, register item 7.10: stay on Hobby plus the pooler until
  the third live client, then Pro). Client-owned multiplies operations by the number of clients: N databases,
  N migration runs, N backup rehearsals, N secret sets. The shared model scales better for tiny clients.
- It treats authentication as undecided. It is decided (Supabase Auth or OIDC).
- It says RLS and `withTenant()` must be verified per instance. True, and already enforced by tests; they
  stay mandatory (ADR-031 constraint 4). A single-tenant database is not a reason to relax them.
- It does not mention Vercel Hobby's commercial-use ban or the private-repository commit-author rule. Both
  change the plan (section 3).
- A note on our own setup, found while checking: register item 7.10 already records that Hobby forbids
  commercial use; the shared production project is on Hobby with a commercial client. That is a separate
  compliance item, with a trigger (third client or first paid SLA), and the client-owned model does not
  remove it for the shared project.

## 7. What a good client-owned setup looks like (if chosen)

- **One codebase, one release.** No client forks. Per-client difference is configuration only
  (environment variables, enabled capabilities, branding), as the platform already does through
  `TenantActivation`.
- **Deploy by CLI from our CI, not by Git integration.** A scoped Vercel token per client (rotated, held in
  our secret manager, never in the repository) runs `vercel deploy` against the client's project. This
  avoids adding every Verity commit author to every client's team (section 3). The client still owns the
  account, billing and domain, and can revoke the token.
- **Secrets live in the client's accounts.** Database password, `VERITY_SESSION_SECRET`, `CRON_SECRET` and
  the service-role key are generated at install and stored only in the client's Vercel environment and
  their password manager. Verity staff hold the least access that lets them release and support, and the
  handover document lists exactly what.
- **Migrations are a separate, gated job.** Order: back up (Supabase Pro daily backup plus a manual
  `db dump` before each release), `prisma migrate deploy` with `DIRECT_URL`, deploy the matching build,
  check `/api/ready`, record versions in the registry. Forward-only; the backup is the rollback.
- **Support access** is a named operator login inside the client's instance, recorded in their audit
  trail, revocable by the client. No cross-instance console until a design exists (blocker 3).

## 8. Recommendation

1. **Default stays the shared deployment** for small clients: cheapest for them, least operations for us, and
   the HQ, support and announcement design already assume it.
2. **Offer client-owned as a priced option** for clients who need their data in their own accounts. State
   plainly in the proposal: they pay Vercel Pro and Supabase Pro, they own the accounts, and Verity's
   support depends on the access they grant.
3. **Do not promise it yet.** ADR-031 forbids selling an unproven mode. Run one pilot first (section 10)
   and name it "being validated" until it passes the gate (section 11).
4. **Candidate pilot:** D & S Electric Works already wants data in its own hands, but its decided shape is
   on-premise with Keycloak (`clients/dsew/deployment.md`). Do not switch it to cloud without the owner
   choosing so. A different small client, or an internal test pair of accounts, is the cleaner pilot.

## 9. Decisions needed from the product owner

1. Do we offer client-owned cloud accounts at all, and at what price relative to the shared plan?
2. If yes: approve a new ADR-045 "Mode D, client-owned managed cloud" with these constraints: no client
   forks; one release channel; the client owns accounts and can revoke access; the runtime role and RLS
   rules are unchanged (ADR-031 constraint 4); no cross-instance HQ is promised.
3. Who is the pilot client, and are they willing to pay Vercel Pro and Supabase Pro during the pilot?
4. Support model: is a named operator login inside each client's instance acceptable, given there is no
   central console?

## 10. Pilot plan (once approved)

Phase 1, audit and prerequisites (no client data):
1. Create a throwaway pair of Supabase and Vercel accounts (Pro for both, so the terms match production).
2. Script blocker 1 (`provision-db-role`) and blocker 2 (ordered first-operator and first-tenant procedure)
   as idempotent commands with tests; extend `deploy/runbooks/` with a "cloud accounts" runbook.
3. Run `prisma migrate deploy` against the empty Supabase project with `DIRECT_URL`; prove the runtime role
   reads and writes, `assertRlsEnforceable()` passes, and the conformance and isolation tests pass against it.
4. Deploy the build with `vercel deploy` from CI using a scoped token; set the environment contract from
   section 4 and `NEXT_PUBLIC_SITE_URL` (and `VERITY_PUBLIC_URL` if OIDC); create the Storage bucket.
5. Move the cron cadences into that project's `vercel.json` (Pro) or run the scheduler from a per-instance
   workflow.

Phase 2, deployment registry and release job: a small table or file (client, Vercel project id, Supabase
ref, release, migration version, last verified backup), a release script that runs backup, migrate, deploy
and health check per client in batches, and a rollback note. Build only after two instances work by hand.

## 11. Gate before any real client data

All must pass on the pilot and be recorded with the mode named:
- Fresh Supabase project builds from migrations plus the role step, with no manual SQL.
- Sign-in, password recovery and a Job with an uploaded file work end to end.
- RLS, isolation and conformance tests pass against that database.
- A backup is taken, the project restored into a scratch project, `verity_app`'s password reset, and the
  same data seen after sign-in. Storage objects are backed up and restored separately.
- `/api/ready` stays 200 across three scheduler cycles.
- No secret is in the repository or a `NEXT_PUBLIC_*` variable.
- The handover document names who owns accounts, billing, support access and backups, and what happens if
  the client revokes access.

## 12. Sources

- Vercel, Hobby plan: https://vercel.com/docs/plans/hobby (non-commercial, personal use; feature table).
- Vercel, Deploying Git repositories: https://vercel.com/docs/deployments/git (private repository rules).
- Supabase, Backups: https://supabase.com/docs/guides/platform/backups (plans, retention, PITR, restore
  caveats).
- Repository evidence: `verity-spec/17_decisions/adr/adr-031.md`, `clients/dsew/deployment.md`,
  `prisma/migrations/20260826000000_runtime_role_privileges/migration.sql`,
  `deploy/db/init/01-create-app-role.sh`, `implementation/phase-0-9-fresh-migration.md`,
  `prisma/operator-bootstrap-core.ts`, `.env.example`, `vercel.json`,
  `.github/workflows/scheduled-work.yml`, `taskplans/125_pending_work_register_2026_10_06.md` item 7.10.
