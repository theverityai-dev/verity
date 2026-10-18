# DSEW on-premises deployment-readiness audit

Status: REPORT for review, 2026-10-18. **No code, schema, compose or script was changed. Nothing was run against any
deployed environment, the DSEW production tenant, or a production database.** Companion to
`clients/dsew/deployment.md` (draft plan) and ADR-031 (deployment modes).

How to read the labels. **VERIFIED**: read in the repository or queried from a database in this session, with the file
or query named. **ASSUMPTION**: reasoning from general knowledge, not shown in the repository. **UNKNOWN**: not
determinable from the repository; needs the client, a spike or a test.

Database evidence below comes from one read-only catalog query of a *local* Postgres 16 container whose schema was
built from this repository's 141 migrations (not from production, not from DSEW).

## 0. Headline

The repository is much further along than `deployment.md` says. A hardened, digest-pinned, non-root container image, a
customer-facing compose package, install/migrate/upgrade/backup/restore/health scripts, a preflight that refuses unsafe
configuration, an OIDC relying party, an S3 storage driver with a bundled SeaweedFS overlay, a provider-neutral
scheduler sidecar and CI jobs that install the package and drive an OIDC browser login all exist. Nothing ties the
package to Supabase or Vercel for a Mode A or B install **except** the items in section 9. The real gaps for DSEW are
not "port off Supabase"; they are:

1. **No self-hosted identity is packaged** (only a Dex lab overlay), and **in-app user creation is Supabase-only**.
2. **No TLS reverse proxy is shipped**, and presigned **browser uploads** need an object-store endpoint the browser
   can reach (unproven).
3. **Backup covers the database only**: no object-store bytes, no identity-provider data.
4. **Nothing is proven on the client's actual host**, and Windows Server 2019 is unverified.
5. **Fully offline (Mode C) is not supported**; some build steps need the internet.

## 1. Runtime and build dependencies

| Item | Finding | Evidence |
|---|---|---|
| Runtime | Node 22.x (`engines`), Next 16.3.3 and eslint-config-next 16.3.3 pinned in CI, React, Prisma client with a native query engine | `package.json`; `.github/workflows/verify.yml` line "Assert security-sensitive dependency versions" |
| Runtime libraries | `@aws-sdk/client-s3` + presigner, `@supabase/ssr` + `supabase-js`, `jose`, `qrcode`, `zod`, `dayjs`, `framer-motion`, `papaparse`, `@tanstack/react-table`, `@sentry/nextjs`, `@opentelemetry/instrumentation`, `server-only` | `package.json` dependencies |
| Build | `prisma generate && next build`; `output: "standalone"` unless `VERCEL` is set; Prisma engine traced in | `package.json`; `next.config.ts` |
| Container | 4-stage Dockerfile: `deps`, `builder`, `tools` (Prisma CLI, migrations), `runner` (non-root uid 1001, `node server.js`, PID 1, no migrations on start); base `node:22-bookworm-slim` pinned by digest | `Dockerfile` |
| Vercel-specific assumptions | (a) `vercel.json`: region `bom1` and **one cron** `GET /api/scheduled?tenant=all&cadence=daily` at 01:23; (b) `deploy:preview` script; (c) `VERCEL_GIT_COMMIT_SHA` as a commit fallback; (d) the standalone-output toggle. None blocks a container install: the scheduler sidecar replaces the cron | `vercel.json`; `package.json`; `src/server/platform/observability.ts:84`; `next.config.ts:41` |
| Internet needed at **build** | `npm ci`, Prisma engine download, base-image pull, and `next/font/google` (Inter, IBM Plex Mono) which downloads font files at build time and self-hosts them. Runtime needs none of these | `src/app/layout.tsx:4`; ASSUMPTION for the font download behaviour (Next documents it); UNKNOWN whether an offline build succeeds |
| Release image | Signed, SBOM-bearing image pushed to `ghcr.io` on release | `.github/workflows/release.yml` |
| CI | Postgres 16 service, migrations, non-bypass role proof, SECURITY DEFINER ACL proof, typecheck, lint, `npm test`, `npm run build`, deployment-security validator | `.github/workflows/verify.yml` |

## 2. Supabase dependencies (every one)

| Area | Where | Provider-gated? | On-prem consequence |
|---|---|---|---|
| **Auth session refresh** | `src/proxy.ts` (`createServerClient`, `auth.getUser()`) | Yes: skipped when `VERITY_AUTH_PROVIDER=oidc` (proxy.ts:33) | None under OIDC |
| **Auth server client** | `src/server/platform/auth.ts` (`createServerClient`, `auth.getUser`) | Yes (provider selector, `activeAuthProviderName`) | None under OIDC |
| **Sign-in, reset, password update, sign-out** | `src/server/actions/platform.ts` (`signInWithPassword`, `resetPasswordForEmail`, `updateUser`, `signOut`); `src/app/reset-password/*` | Yes: returns "Use your organization's sign-in provider" / "managed by your identity provider" for OIDC (platform.ts:147, 222, 256); sign-out redirects to the OIDC logout route (platform.ts:300) | Password recovery and MFA are the IdP's job |
| **Change own password** | `src/server/actions/account.ts` (`signInWithPassword`, `updateUser`) | **VERIFIED: no provider guard.** `changeOwnPassword` builds a Supabase server client and calls `signInWithPassword`/`updateUser` unconditionally (`account.ts:1-45`). Under OIDC it would fail against the placeholder URL. **UNKNOWN** whether the account screen still offers the form under OIDC | Hide or refuse under OIDC (small code change, for review); the IdP owns passwords |
| **Create or update a login in-app** | `src/server/actions/people.ts` (`createClient(url, serviceRoleKey)`, `auth.admin.createUser/updateUserById/deleteUser`), used by HQ People admin | **No provider guard.** Returns "no Supabase service key configured" when `SUPABASE_SERVICE_ROLE_KEY` is unset (people.ts:62-75) | **Blocker for in-app user creation under OIDC.** Operators must pre-provision (see section 9) |
| **Storage driver** | `src/server/storage/supabase.ts` (`storage.from(bucket).upload/remove`, signed URLs); selected by `VERITY_STORAGE_DRIVER` (default `supabase`) | Yes: `s3` driver is the alternative (`src/server/storage/index.ts`) | None when `s3` |
| **Image allowlist** | `next.config.ts` adds the Supabase host's `/storage/v1/object/public/**` only if `NEXT_PUBLIC_SUPABASE_URL` is set | Yes | None when unset |
| **Readiness probe** | `src/server/platform/readiness.ts`: OIDC provider does OIDC discovery; Supabase provider calls `/auth/v1/settings`; storage probe per driver | Yes | **The IdP being down makes `/api/ready` fail** (see section 9) |
| **Build-time config** | `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` inlined by `next build`; Dockerfile supplies `*.invalid` placeholders when unset so an OIDC-only image builds | Yes | None |
| **Seeds and scripts** | `prisma/seed-dsew.ts`, `seed-dsew-roles.ts`, `reset-demo.ts`, `create-login.ts`, `seed-colonel-kebabz.ts`, `seed-pa-oms.ts`, `seed-scale*.ts` create Supabase auth users when keys are present; `bootstrap-oidc-lab-identity.ts` is the OIDC equivalent (Dex lab) | Environment-driven | Demo/seed tooling only, not runtime |
| **Realtime, Edge Functions, RPC** | A keyword scan for `realtime`, `functions.invoke`, `.rpc(`, "edge function" found **none** in `src/` | n/a | None |
| **PostgreSQL objects** | No migration references `auth.users`, `auth.uid`, `storage.*`, `pg_cron`, `pg_net` or `vault`. The only extension is `pgcrypto` (trusted since PG 13). Several comments say identity is "keyed on the Supabase auth user id": that is a UUID column, not a foreign key to a Supabase table | `prisma/migrations/*` grep; local catalog `pg_extension` = `plpgsql, pgcrypto` | **VERIFIED**: the schema builds on vanilla Postgres 16 (141 migrations, 0 unfinished, 0 rolled back, local container `postgres:16-alpine`) |
| **Pooler** | Production uses Supabase's transaction pooler (`6543`, `pgbouncer=true`); the compose package connects straight to Postgres on 5432 with no pooler | n/a | `withTenant` is transaction-scoped and works either way (CLAUDE.md; `tenancy.ts`) |
| **CI placeholder** | CI sets `NEXT_PUBLIC_SUPABASE_URL=https://ci-placeholder.supabase.co` because the default provider is `supabase` | n/a | The default provider is still `supabase`; an on-prem env file must set `oidc` explicitly (preflight enforces required fields per provider) |

## 3. Clerk

**VERIFIED: there is no Clerk dependency.** `package.json` has no `@clerk/*`. Case-insensitive matches for "clerk" are the
English word (a stock clerk, a data-entry clerk) in business copy and test names. Authentication is one of two
providers: Supabase Auth or a standards OIDC provider.

External services authentication needs: **OIDC**: the IdP must be reachable from **both** the browser (authorize
redirect) and the web container (discovery and JWKS), per `deploy/docs/install.md`; `IDP_HOST_REWRITE` exists as a lab
helper. Sessions: an HttpOnly, signed application session (`VERITY_SESSION_SECRET`), 8 h absolute and 1 h idle by
default. Webhooks from an IdP: none. The OIDC subject **must be a UUID**; users are pre-provisioned and never created
from a token (`install.md`, ADR-020). `/api/auth/oidc/start|callback|logout` use the raw Prisma client for the
pre-tenant `oidc_login_transaction` table (see section 7).

## 4. File upload and storage

- **VERIFIED: no application code writes to the local filesystem** (`writeFile`, `createWriteStream`, `os.tmpdir`,
  `fs.write*`, `/tmp` found nowhere in `src/`). The web container is stateless; the scheduler runs `read_only` with a
  16 MB tmpfs. Nothing depends on ephemeral local disk.
- File bytes live in object storage; PostgreSQL holds `stored_file` and `evidence` references with a checksum frozen
  at confirmation (`src/server/platform/files.ts`, ADR-031 constraint 3).
- Two drivers behind one seam: Supabase Storage and S3-compatible (`s3.ts`, path-style for self-hosted). Bundled
  SeaweedFS overlay: `deploy/compose/docker-compose.bundled-storage.yml`, `deploy/docs/object-storage.md`.
- Uploads are two-phase: the **browser** PUTs to a presigned URL, then the server confirms
  (`src/app/(shell)/outreach/[id]/ResearchForm.tsx:63`; `object-storage.md`). The presigned URL embeds
  `VERITY_S3_ENDPOINT`. In compose that is an internal name (`http://objects:9000` in `install.md`), which a browser
  cannot resolve. `object-storage.md` states a browser upload was **not covered** by its tests.
  **UNKNOWN and likely a blocker** for any phone or PC upload until a browser-reachable endpoint (or a proxy path) is
  designed and tested.
- The floor UI today asks for a photo **link (URL)**, not a camera capture (FINISHER P2-11): so the browser-upload path is
  barely exercised by the product yet.
- No file-storage test has run through a real browser against the bundled store (`object-storage.md`).

## 5. Environment variables (names only, no values)

Classified by where they take effect. `DATABASE_URL`, `DIRECT_URL` and `CI` dominate raw counts because tests and seeds
read them.

**Build-time, public (inlined into the browser bundle by `next build`; not secrets):**
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SITE_URL`.
Changing any needs a rebuild. On-prem OIDC: leave empty (Dockerfile placeholders); keep `NEXT_PUBLIC_SENTRY_DSN` unset so
telemetry is off (Sentry initialises only when a DSN exists: `sentry.server.config.ts`, VERIFIED).

**Runtime, non-secret configuration:** `VERITY_AUTH_PROVIDER`, `VERITY_PUBLIC_URL`, `VERITY_OIDC_ISSUER`,
`VERITY_OIDC_CLIENT_ID`, `VERITY_OIDC_REDIRECT_URI`, `VERITY_OIDC_AUDIENCE`, `VERITY_OIDC_JWKS_URI`,
`VERITY_OIDC_PRINCIPAL_CLAIM`, `VERITY_OIDC_EMAIL_CLAIM`, `VERITY_OIDC_SCOPES`, `VERITY_OIDC_SESSION_MAX_AGE_SECONDS`,
`VERITY_OIDC_SESSION_IDLE_SECONDS`, `VERITY_OIDC_CLOCK_TOLERANCE_SECONDS`, `VERITY_STORAGE_DRIVER`, `VERITY_S3_BUCKET`,
`VERITY_S3_REGION`, `VERITY_S3_ENDPOINT`, `VERITY_S3_FORCE_PATH_STYLE`, `VERITY_STORAGE_CREATE_BUCKET`,
`SUPABASE_MEDIA_BUCKET`, `SUPABASE_URL`, `VERITY_ENVIRONMENT`, `VERITY_SERVICE_NAME`, `VERITY_VERSION`, `VERITY_COMMIT`,
`VERITY_TX_TIMEOUT_MS`, `VERITY_TX_MAX_WAIT_MS`, `VERITY_SCHEDULER_BASE_URL`, `VERITY_SCHEDULER_TIMEOUT_MS`,
`VERITY_SCHEDULER_MAX_ATTEMPTS`, `EXTERNAL_TOOLS_ENABLED`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `SENTRY_ORG`,
`SENTRY_PROJECT`, `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_TUNNEL_ROUTE`, `PORT`, `HOSTNAME`, `TZ`, plus compose-only
`VERITY_BIND_ADDRESS`, `VERITY_PORT`, `VERITY_IMAGE`, `VERITY_TOOLS_IMAGE`, `POSTGRES_DB`.

**Secrets (never print, never commit; the env file is mode 0600):** `DATABASE_URL` and `DIRECT_URL` (contain passwords),
`POSTGRES_SUPERUSER_PASSWORD`, `VERITY_APP_PASSWORD`, `VERITY_SESSION_SECRET`, `CRON_SECRET`, `VERITY_OIDC_CLIENT_SECRET`,
`SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `VERITY_S3_ACCESS_KEY_ID`, `VERITY_S3_SECRET_ACCESS_KEY`,
`OPENAI_API_KEY`, `CREDENTIAL_ENCRYPTION_KEY`. `JWT_SECRET` appears three times in code: **UNKNOWN** (not traced).

Per-service exposure is already restricted and machine-checked: `web` gets `DATABASE_URL` but **not** `DIRECT_URL`;
`scheduler` gets only `CRON_SECRET` and the web URL; `tools` gets `DIRECT_URL` (migrations only)
(`scripts/validate-deployment-security.mjs`; `deploy/compose/docker-compose.yml`). The credential-encryption key's
home is an open decision in `CLAUDE.md` ("supplied per call… a managed KMS would be stronger").

## 6. Scheduled jobs, webhooks, external APIs, email, background processes

- **Scheduler.** `GET|POST /api/scheduled` guarded by `CRON_SECRET` (constant-time; returns 503 unset). On Vercel one
  cron (`vercel.json`); on-prem the `scheduler` sidecar runs `scripts/run-scheduler.mjs` (UTC minute/hour/day/week
  cadences, DB lease, `scheduler_run` records, bounded retries). Readiness **includes the scheduler heartbeat**
  (`readiness.ts`; the compose comment notes the resulting first-start ordering).
  `.github/workflows/scheduled-work.yml` is a GitHub-hosted trigger and must not be used on-prem.
- **Webhooks.** None inbound from third parties found. Inbound public routes: `/api/self-order/[token]` (guest ordering,
  ADR-042), `/verify/[token]` and `/verify/[token]/label` (public passport, ADR-030), `/o/s/[token]`.
  Authenticated: `/api/agent/chat`, `/api/tools/invoke` (dark unless `EXTERNAL_TOOLS_ENABLED=1`), `/api/hq/audit`,
  `/api/metrics` (needs `CRON_SECRET`), `/api/health`, `/api/ready`.
- **Email.** **VERIFIED: no email-sending library or SMTP client exists.** The notification outbox is in-app only
  (`notification-outbox.ts`: "In-app is the only channel for now"). The Supabase provider sends password-recovery email
  through Supabase; OIDC leaves that to the IdP. So DSEW needs no mail server for Verity itself; Keycloak may want one for
  recovery.
- **Outbound calls.** (a) `agent-chat.ts` posts to `OPENAI_BASE_URL` (Groq-style OpenAI-compatible endpoint; **optional**:
  without a key chat is unavailable; a local model server is plausible but **UNKNOWN**); (b) `decision.ts` has a default
  endpoint `https://api.typesafe.ai/v1/systemone`, reached only when the tenant has the `decision_egress` capability
  active (`decision.ts:272`; ADR-027 is PROPOSED) so **off by default**; (c) Sentry only with a DSN;
  (d) readiness probes to the IdP and object store; (e) the scheduler calls the web service on the compose network.
  Verifying "no outbound call at runtime" is a **required test that does not exist** (section 9).
- **Background processes.** Only the scheduler sidecar. No queue or worker (decision recorded in the compose header).

## 7. Prisma, migrations, extensions, RLS, tenancy, roles

All VERIFIED from the local catalog query (migrated from this repository's migrations) unless stated.

- **Prisma:** single `schema.prisma`, `provider = postgresql`, `url = DATABASE_URL`, `directUrl = DIRECT_URL`.
  `prisma.config.ts` points at `prisma/migrations`. **142 entries in `prisma/migrations`** (141 migrations plus
  `migration_lock.toml`); **141 applied, 0 unfinished, 0 rolled back** in the local database.
- **Reviewed migrations only.** `deploy/scripts/migrate.sh` runs `prisma migrate deploy` in the `tools` container.
  `prisma db push` is used nowhere in the package; it exists only as the dev script `prisma:push`. **It must never be
  used on production** (your constraint); no deploy script calls it.
- **Extensions:** `pgcrypto` only (plus `plpgsql`). Required migration `20260822000000_required_extensions`.
- **Schemas:** `public` and `verity`. **Roles:** `postgres` (superuser, bypassrls, migrations only) and `verity_app`
  (`NOSUPERUSER NOBYPASSRLS`, created by `deploy/db/init/01-create-app-role.sh`, no `CREATE` on `public`).
- **RLS:** 220 tables; **215 have RLS enabled and forced; 0 enabled-but-not-forced.** Five have none by design and are
  platform tables: `_prisma_migrations`, `deployment_state` (runtime has `SELECT` only), `oidc_login_transaction`,
  `scheduler_lease`, `scheduler_run`. The runtime has no privileges on `_prisma_migrations`. **Check before go-live:** the
  three tables the runtime can write (`oidc_login_transaction`, `scheduler_lease`, `scheduler_run`) hold no tenant data.
  208 `ENABLE` statements across migrations (a raw count, superseded by the live catalog numbers above).
- **SECURITY DEFINER:** 40 `SECURITY DEFINER` mentions in migrations; 20 functions in schema `verity` are definers,
  **0 without a fixed `search_path`, 0 executable by PUBLIC, all owned by `postgres`**.
- **Tenant context:** `withTenant()` runs a transaction and sets `verity.tenant_id` with `set_config(..., true)`
  (transaction-local, parameterised) (`src/server/platform/tenancy.ts:106`). `assertRlsEnforceable()` refuses a superuser
  or `BYPASSRLS` role (`tenancy.ts:124-136`). Fails closed with no scope set.
- **Raw Prisma use outside `withTenant`** exists in a bounded set of pre-tenant or platform places: OIDC start/callback,
  `/api/scheduled`, `auth.ts` membership resolution, `operator.ts` (HQ), `readiness.ts`, `shared-rate-limit.ts`,
  `external-auth.ts`, `passport-public.ts` and `selforder-public.ts` (public reads through definer functions keyed by a
  token hash). These were **listed, not security-reviewed line by line** in this audit.
- **Not run in this audit:** the CI proofs (definer ACL, non-bypass role) and the isolation test suite were not re-run
  here; an earlier run in this engagement passed the tenant-isolation suite (8-file focused run, 2026-10-18).

## 8. Proposed minimal on-prem architecture

**Mode B (private network), the DSEW target, not promised (ADR-031):** one Linux host or VM running Docker Compose.

```
 Staff PCs / phones (office LAN, Wi-Fi)
        │ HTTPS 443  (internal hostname; internal CA or DSEW certificate)
 ┌──────▼───────────────── reverse proxy (Caddy or nginx)  [NEW, not shipped] ──────────────┐
 │  verity.<lan>  → web:3000        idp.<lan> → keycloak:8080      files.<lan> → objects:8333 │
 └──────┬──────────────────────────────┬──────────────────────────────────┬────────────────┘
   ┌────▼────┐  ┌───────────┐  ┌───────▼──────┐  ┌────────────┐   ┌───────▼──────┐
   │  web    │  │ scheduler │  │  keycloak    │  │ postgres16 │   │  SeaweedFS   │
   │ (image) │  │ (sidecar) │  │ [NEW overlay]│  │ verity_app │   │  (bundled)   │
   └────┬────┘  └───────────┘  └───────┬──────┘  └────────────┘   └──────────────┘
        └────────────── Postgres (verity DB)    Keycloak DB (own database/volume)
 Off-host: encrypted backup set = verity dump + keycloak dump + object-store snapshot + env file + realm export
```

Already exists (VERIFIED): web, scheduler, Postgres 16, SeaweedFS overlay, hardened compose, install/migrate/upgrade/
backup/restore/health scripts. **New** (proposed): Keycloak overlay, reverse proxy overlay, an OIDC provisioning path,
backup extensions.

**Fully offline (Mode C) additionally needs** (none promised): images and the Prisma engine delivered as an exported
archive (`docker save`/`load`) from a connected build host; fonts vendored locally instead of fetched at build; an
internal DNS/NTP and certificate authority; no GitHub-hosted workflows; a rule that nothing pulls from `ghcr.io` or
Docker Hub on the host. ADR-031 says Mode C is out of scope until a named client needs it.

**A Linux VM is a candidate, not a fact** (your constraint). ASSUMPTION: Docker Engine's Linux containers are not
natively supported on Windows Server 2019 (Windows containers are), so a Hyper-V Linux VM or a separate Linux host is the
likely route; WSL2 availability on 2019 is **not** assumed. UNKNOWN until the server survey: Hyper-V role and licence, CPU
virtualisation, RAM and disk, whether the server already runs other workloads, who administers it.

## 9. Compatibility blockers, risks, operational requirements, missing tests

### Blockers (must be resolved or consciously accepted before an on-prem promise)

| # | Blocker | Evidence | Proposed resolution |
|---|---|---|---|
| B1 | No self-hosted IdP package. Only Dex lab overlay exists | `deploy/compose/docker-compose.lab-oidc.yml`; `deployment.md` section 3.1 | Keycloak overlay (section 10, stage 2). Standard OIDC, so no new ADR per `deployment.md`; stop and write one if anything else is needed |
| B2 | In-app login creation requires Supabase Admin API | `src/server/actions/people.ts:62-89` | Operator pre-provisioning script (Keycloak user, UUID `sub`, then `provisionIdentity`); defer in-app creation under OIDC. A Keycloak Admin adapter would be a new identity binding: **ADR first** (ADR-031 c5) |
| B3 | Browser-reachable object-store endpoint for presigned uploads is unproven | `ResearchForm.tsx:63`; `object-storage.md`; presigned URL embeds `VERITY_S3_ENDPOINT` | Proxy a public path (or host name) to SeaweedFS, set the endpoint accordingly, test an upload from a phone |
| B4 | Backup excludes object-store bytes and identity data | `deploy/runbooks/backup-restore.md` "Scope and current limitation" | Extend backup to a paired set and rehearse a restore with files and Keycloak |
| B5 | Nothing validated on the client's host; Windows Server 2019 unknown | `deployment.md` section 6; ADR-031 | Infrastructure survey, then a clean-VM install and the validation gate |
| B6 | TLS terminator not shipped | `install.md` "TLS", `hardening.md` section 4 | Proxy overlay with an internal CA (production refuses non-`https` public origin, ADR-032) |

### Risks

- **IdP down means web "not ready".** `probeIdentity` does OIDC discovery inside `/api/ready` (`readiness.ts`); the compose
  healthcheck points at `/api/ready`. Keycloak maintenance would show Verity unhealthy. Decide whether that is wanted.
- **Scheduler heartbeat is part of readiness**: a stopped scheduler makes web unready after its grace period.
- **Metrics are per instance and in memory**; no central monitoring or alerting exists.
- **Secrets are a mode-0600 env file**; no KMS/Vault integration (`hardening.md` section 8). The credential-encryption key
  location is an open decision.
- **Forward-only migrations**: rollback is a database restore, not a down-migration (`upgrade.md`). A failed upgrade after
  migrate means restore from the pre-upgrade backup.
- **Single host, single database**: no high availability; recovery time is the restore time (unmeasured).
- **Time:** the package pins the database session timezone to UTC after a real failure (`docker-compose.yml`); host NTP is
  not managed.
- **`next/font/google`** is a build-time external fetch (see section 1).
- **`OIDC subject must be a UUID`** limits IdP choice (Keycloak works; Dex did not).
- **Public unauthenticated surfaces** (self-order, passport, guest order) are exposed through the proxy; their rate limits
  exist (`shared-rate-limit.ts`) but were not reviewed here.

### Operational requirements (client and operator)

Static host with a fixed address and an internal hostname; certificates or an internal CA trusted by every device,
including phones; UPS and orderly shutdown; an off-host, encrypted backup destination and a person who owns it; a named
administrator; a patch routine for the host, Docker, Postgres, Keycloak and SeaweedFS images (digest-pinned, so manual);
disk sizing for database, evidence files and backups; remote access policy for support.

### Tests missing for production

1. **No-egress test**: start the stack with outbound traffic denied and prove sign-in, a job, an upload and a backup all
   work, and capture any attempted outbound connection. The `deployment.md` validation gate requires it; it does not exist.
2. **Keycloak lifecycle e2e** (the OIDC suite targets Dex: `playwright.oidc.config.ts`, `wp09-enterprise-lab.yml`).
3. **Paired restore drill**: database + object store + Keycloak, then confirm the same data, role attributes
   (`verity_app` NOBYPASSRLS), RLS forced flags and file checksums after restore.
4. **Browser upload through the proxy** with the production presigned headers.
5. **Readiness with the IdP down, with the scheduler stopped, with the object store down.**
6. **Clean-host install on the real OS/VM** from the package, timed, by someone other than the author.
7. **Load/capacity measurement** on DSEW-like hardware (ADR-031: no measured capacity yet; `docs/enterprise-readiness`
   holds only seed runs, no restore or capacity result).
8. **Upgrade and rollback rehearsal** including a failed-migration branch.
9. **Backup-corruption and wrong-key negative tests** (`backup-restore.md` lists "Failure injection"; results not found).
10. **Secrets scan of the image and env**, and a check that no `NEXT_PUBLIC_*` leaks a secret.

## 10. Proposed file and config changes (for review; none made)

Staged. Each stage ends with a stop for review. No stage removes or weakens RLS, `withTenant()`, authentication or
authorisation, replaces an existing service, adds a hosted dependency, or uses `prisma db push`. No stage touches the DSEW
production environment.

**Stage 0: Decisions and survey (no code).** Product-owner approval that DSEW is a Mode B validation candidate (ADR-031);
client infrastructure facts (CPU, RAM, disk, Hyper-V, UPS, network, backup destination, remote access); confirm whether the
server may run a Linux VM; decide IdP-down behaviour and the credential-key home.

**Stage 1: Validate the existing package on a clean Linux VM (no code change).** Run `install.sh`, `health.sh`, `backup.sh`,
`restore.sh`, `upgrade.sh` from a fresh checkout; record times and defects. Use a *DSEW-like test VM*, never production.

**Stage 2: Identity.**
- New `deploy/compose/docker-compose.keycloak.yml` (Keycloak pinned by digest, its own Postgres database and volume, realm
  `dsew`, confidential client `verity-web` with PKCE, exact redirect URI).
- New `deploy/keycloak/realm-dsew.json.tmpl` (no secrets in the template).
- New `deploy/scripts/provision-oidc-user.sh` (create the Keycloak user, take its UUID `sub`, call the existing
  `provisionIdentity` path). Reuses `prisma/bootstrap-oidc-lab-identity.ts` logic; **no change to runtime auth code**.
- Preflight additions in `deploy/security/preflight.sh`: refuse default Keycloak admin credentials.
- ADR **only if** an in-app Keycloak Admin adapter is wanted.

**Stage 3: HTTPS and reverse proxy.** New `deploy/compose/docker-compose.proxy.yml` plus `deploy/proxy/Caddyfile.tmpl`
(internal CA or supplied certificate; routes for web, Keycloak, object store); documentation for trusting the CA on PCs and
phones. Application stays HTTP behind it, as `hardening.md` requires. Adjust `VERITY_PUBLIC_URL`, `VERITY_OIDC_REDIRECT_URI`.

**Stage 4: Persistent storage and backup.** Named volumes for Postgres, Keycloak DB and SeaweedFS (already volume-based for
Postgres); extend `deploy/scripts/backup.sh` and `restore.sh` to one **backup set** (verity dump, keycloak dump, object-store
snapshot, manifest with checksums, env-file reminder); off-host copy step; a scripted restore verification that checks role
attributes, forced RLS and file checksums. Update `deploy/runbooks/backup-restore.md`.

**Stage 5: Health, monitoring and rollback.** Optional exporter or log-shipping to a DSEW-owned collector (no hosted
dependency); a `deploy/runbooks/dsew-operations.md` for the IT person (install, upgrade, backup, restore, add a user, rotate
secrets, IdP-down behaviour); a rollback rehearsal script wrapper (`upgrade.sh` prints the commands today).

**Stage 6: Validation gate (from `deployment.md` section 4).** Clean install on the target VM; sign in through Keycloak;
create a job and upload a file through HTTPS from a phone; backup; destroy; restore; sign in again and see the same data;
no outbound network call at runtime (checked with the no-egress test). Only then say "validated on Mode B for D&S".

**Stage 7 (only if a client requires Mode C):** offline image archive, vendored fonts, internal registry/NTP, build-host
procedure. Separate ADR and evidence; not planned.

### Files that would be added or changed (summary)

| File | Change |
|---|---|
| `deploy/compose/docker-compose.keycloak.yml` | New |
| `deploy/compose/docker-compose.proxy.yml`, `deploy/proxy/Caddyfile.tmpl` | New |
| `deploy/keycloak/realm-dsew.json.tmpl` | New |
| `deploy/scripts/provision-oidc-user.sh` | New |
| `deploy/scripts/backup.sh`, `restore.sh` | Extend to a paired backup set |
| `deploy/security/preflight.sh` | Add Keycloak, proxy and object-endpoint checks |
| `deploy/config/verity.env.example` | Document the Keycloak and proxy variables |
| `deploy/docs/install.md`, `operations.md`, `runbooks/backup-restore.md` | Update |
| `deploy/runbooks/dsew-operations.md` | New |
| `e2e` + `playwright.keycloak.config.ts`, `.github/workflows/` job | New Keycloak lifecycle and no-egress tests |
| `src/` application code | **None proposed**, apart from the ADR-gated question in B2 |

## 11. Open questions for the client and product owner

1. Server facts (stage 0) and whether a Linux VM is permitted on the Windows Server 2019 host.
2. Is Keycloak acceptable as a second stateful service the client must patch and back up?
3. Does DSEW want Verity reported "not ready" while the IdP is down (current behaviour)?
4. Who owns off-host backups, and what recovery time and data-loss window are acceptable?
5. Do phones on the shop floor use office Wi-Fi only, and can they trust an internal CA?
6. Where should the credential-encryption key live (env file, file with a mode, or a KMS)?
