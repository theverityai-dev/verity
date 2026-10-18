# DSEW on-premises: Stage 1 evidence and go/no-go

Date: 2026-10-18. Scope: Stage 0 and Stage 1 only (authorised). Companion to `deployment-readiness-audit.md` and
`onprem-stage0-decisions.md`.

**Verdict: NO-GO for a DSEW installation. GO to proceed to Stage 2 design review.** The existing package installs and runs;
five defects and several untested items below must be closed first. Nothing here shows the DSEW host works.

## Environment actually used (this is not the DSEW target)

A throwaway clone of commit `23feedb` inside an Ubuntu 26.04 distro under WSL2 on a Windows 11 developer machine
(Docker Engine 29.8.1, Compose 5.5.1, 16 GB RAM, Docker Desktop integration). Compose project renamed `verity-s1` so no
existing container or volume was touched. Identity: the lab Dex overlay for the first run, then a local Keycloak test
realm. Storage: the bundled SeaweedFS overlay. **Not** a Windows Server 2019 host, **not** a Hyper-V VM, **not** a clean
server, **not** production, **not** the DSEW tenant. Production and DSEW environments were not touched.

## Results

Legend: **VERIFIED** observed in this run. **FAILED** observed failing. **UNTESTED** not run.

### Installation and operation

| # | Test | Result | Evidence |
|---|---|---|---|
| 1 | `install.sh` first call writes a 0600 env file, then stops | VERIFIED | env file mode 600 |
| 2 | Preflight passes a valid profile | VERIFIED (pass path only) | seven `preflight ok` lines; the refusal paths were not exercised |
| 3 | Image build, database start, 141 migrations applied, bucket created, web and scheduler started | VERIFIED on the second attempt | 4 m 29 s total, partly cached; first attempt failed (D1) |
| 4 | Liveness and readiness reported separately | VERIFIED | `/api/health` 200 while `/api/ready` 503 |
| 5 | Runtime role cannot bypass RLS; forced RLS unchanged after restore | VERIFIED | `verity_app` super=false, bypassrls=false; 215 forced tables before and after |
| 6 | Clean install on the agreed DSEW host or VM | **UNTESTED** | host not surveyed |
| 7 | Timed install by someone other than the author | **UNTESTED** | |

### Identity (Keycloak, administrator-provisioned)

| # | Test | Result | Evidence |
|---|---|---|---|
| 8 | Authorization-code + PKCE login, return to Verity, protected page loads | VERIFIED (Keycloak test realm, Chromium) | after-login URL `/`, `/manufacturing` 200 |
| 9 | Session cookie flags | VERIFIED | `verity_oidc_session`: HttpOnly, SameSite=Lax, path `/`; `Secure` true because the test origin is localhost |
| 10 | Logout ends the session at the IdP and Verity | VERIFIED | redirect to Keycloak logout, then `/sign-in`; `/manufacturing` then redirects to `/sign-in` |
| 11 | Unprovisioned identity is refused | VERIFIED (by accident) | the first Dex login was refused with `unprovisionable_subject` (a non-UUID subject); a deliberate unknown-valid-UUID test was **not** run |
| 12 | Disabled-account behaviour (existing session, new sign-in) | **UNTESTED** | S0-6 stays open |
| 13 | Provider-specific password and login-creation actions under OIDC | VERIFIED by unit test | `oidc-password-actions.test.ts`, 3 pass (commit `23feedba`) |
| 14 | Keycloak production package (TLS, realm template, provisioning script) | **UNTESTED, not built** | Stage 2 |

### Failure behaviour

| # | Test | Result | Evidence |
|---|---|---|---|
| 15 | Identity provider stopped | VERIFIED | `/api/ready` 503 (`identity_unavailable`), `/api/health` 200; an existing signed-in session still loaded `/manufacturing` (200); a new sign-in started (reached `/api/auth/oidc/start`) but could not complete; readiness 200 after restart |
| 16 | Object store stopped | VERIFIED | `/api/ready` 503 (`storage_unavailable`), health 200; still 503 12 s after the store restarted, 200 at the next check |
| 17 | Scheduler stopped | VERIFIED, limited | readiness stayed 200 for at least 150 s; the grace period after which it fails was **not** found |
| 18 | Database stopped | **UNTESTED** | |
| 19 | Policy "degraded, not not-ready" (S0-5) | **NOT BUILT** | today a down IdP or store makes the whole app not ready, and the compose healthcheck follows `/api/ready` |

### Uploads (presigned S3 URLs, bundled SeaweedFS)

| # | Test | Result | Evidence |
|---|---|---|---|
| 20 | Signed PUT with the production headers, then signed GET returns the bytes | VERIFIED (from a container on the stack network) | PUT 200; GET 200, body `hello world` |
| 21 | Overwrite of the same key refused | VERIFIED | second PUT 403 (`If-None-Match: *`) |
| 22 | Tampered signature, unsigned URL, other key with the same signature, PUT without the signed header | VERIFIED | each 403 |
| 23 | Expired URL refused | VERIFIED | 403 after 70 s on a 60 s URL |
| 24 | Upload or download from a browser or phone as shipped | **FAILED** | the URL host is the compose name `objects:9000`; the Windows host and a LAN device cannot reach it (curl from the host: connection failure). Blocker B3 confirmed |
| 25 | Through an HTTPS proxy from a real phone, including unauthorised file access via the app | **UNTESTED** | needs Stage 3 |

### Backup and restore

| # | Test | Result | Evidence |
|---|---|---|---|
| 26 | `backup.sh` makes a verified, checksummed dump | VERIFIED | 1.08 MB dump plus manifest, mode 0600, 1.7 s; the script itself warns that object bytes are **not** included |
| 27 | Destroy the database volume, restore with `restore.sh` | VERIFIED on the same host | restore 2 m 15 s; tenants 1, users 2, migrations 141, forced RLS 215, `verity_app` flags and 20 definer functions identical before and after |
| 28 | Application login and file retrieval after restore | **UNTESTED** | my temporary IdP forwarder lost its network on web recreate, so readiness failed for a harness reason; sign-in was not repeated |
| 29 | Restore on a **separate machine**, with files and identity configuration | **UNTESTED, not supported** | files and Keycloak are not in the backup (B4) |

### Other

| # | Test | Result | Evidence |
|---|---|---|---|
| 30 | `JWT_SECRET` traced | VERIFIED | a private fallback for the signing secret: `SUPABASE_JWT_SECRET`, then `VERITY_SESSION_SECRET`, then `JWT_SECRET` (`config.ts:294-298`); signs OIDC session and transaction cookies; readiness requires at least 32 characters |
| 31 | Raw Prisma paths reviewed | VERIFIED by reading | see below; not fuzzed or penetration tested |
| 32 | Platform table grants reviewed | VERIFIED by reading and catalog query | see below |
| 33 | Upgrade rehearsal and failed-upgrade recovery | **UNTESTED** | |
| 34 | Image and secret scan | **UNTESTED** | |
| 35 | Outbound-traffic test at runtime | **UNTESTED** | |
| 36 | Capacity, concurrent users, Windows Server 2019 | **UNTESTED** | |

## Defects found (none fixed; fixes need review)

| # | Defect | Evidence | Proposed fix |
|---|---|---|---|
| D1 | `install.sh` builds the application images but **not** the `tools` image, so migrations and bucket setup ran from a stale `verity-tools:local` (113 of 141 migrations, no `ensure-storage-bucket.ts`); the first install failed there | `compose build` skips profile services; stale image listed 2 weeks old; error `Cannot find module '/app/prisma/ensure-storage-bucket.ts'` | build the tools image in `install.sh` and `upgrade.sh`; most important finding for any clean-host install |
| D2 | Presigned upload URLs use the internal object-store name | test 24 | Stage 3: browser-reachable storage host or a proxy path |
| D3 | Dex lab overlay publishes the database on host port 5432 and its `http://dex` issuer is rejected (`authorization_endpoint must use HTTPS`) | overlay file and readiness log; worked around in the throwaway clone | CI-only; document, do not ship |
| D4 | Image lacks OpenSSL; Prisma warns and defaults to openssl-1.1.x | warning on every Prisma command in the tools container | add `openssl` to the image (small Dockerfile change); it worked in this run |
| D5 | Dex config written 0600 by my helper could not be read by the container | `permission denied` in the Dex log | harness only |

## Review of the audit's open items

**Raw Prisma paths (read, not changed).**
- OIDC start and callback use `oidc_login_transaction` (state hash, expiry, consumed flag, no tenant data); callback consumes the
  state with one guarded `UPDATE` (replay refused), then calls the definer `memberships_for_auth_user` and refuses an unprovisioned subject.
- `/api/scheduled`: constant-time secret check, 503 when unset, tenant ids from a definer function; `scheduler_run.details` holds
  per-tenant results (tenant ids, counts): platform metadata, not business data.
- Operator code: every entry goes through `requireOperator()` (database `is_platform_operator` plus an active platform tenant).
- Public reads (passport, self-order): one definer function keyed by a token hash, no tenant context.
- API-key lookup: a definer function, constant-time compare, suspended-tenant check.

**Platform tables without RLS:** `_prisma_migrations` (no runtime privilege), `deployment_state` (runtime SELECT only),
`oidc_login_transaction`, `scheduler_lease`, `scheduler_run` (runtime read and write). None holds business data. Acceptable as
designed; keep them out of any export that crosses tenants.

## Decisions needed before Stage 2 implementation

1. Approve fixes for D1 and D4 (small, safe, required for any clean install).
2. Approve the failure-behaviour policy (S0-5), which needs a readiness and healthcheck change.
3. Decide the session-revocation tolerance (S0-6).
4. Provide the server facts (`onprem-stage0-decisions.md` section C) and confirm a Linux VM is permitted.
5. Confirm the network policy so the outbound test (35) can be written against it.

## Not claimed

Windows Server 2019 compatibility, DSEW host readiness, phone upload, whole-installation recovery, capacity, upgrade safety and
the absence of outbound calls are **not** demonstrated.
