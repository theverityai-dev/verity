# Task Plan 129 — Architecture honesty fixes, demo-grade platform, and DSEW on-premises

**Authority:** Product-owner request, 2026-10-22, after a critical architecture review of the repository: "we build for demos
too because indian client need to see things visually … whatever we build its prep for future clients and their demos", then
"how to fix and solve everything you said make a taskplan and finish it off on high priority also DSEW on prem is high priority
too". Grounded in: `taskplans/handoffs/FINISHER.md` (P0-1, P0-2, P1-2), `clients/dsew/deployment-readiness-audit.md`
(blockers B1-B6), `clients/dsew/onprem-stage2-design.md`, ADR-031 (deployment modes), ADR-032 (public origin), ADR-053
(Experience System), `CLAUDE.md` (scope note 2026-09-30, Experience System section, forbidden pattern 8). Supersedes nothing;
extends Task 125 and the DSEW phase plan. Authorises no new business capability and changes no invariant, `enforcePolicy()`,
INV-001 or ADR-017.

## Status: CLOSED 2026-10-22 for everything that can be done without a person or a device. Five items are gated outside the repository and are carried in FINISHER (see section 10)

Per-item status lives in the tables below and is mirrored in `FINISHER.md`. Nothing here is called complete until its
"Done when" holds.

## 1. What the review found, and what the owner corrected

| # | Finding | Disposition |
|---|---|---|
| 1 | Breadth (26 capabilities, 246 models) far ahead of paying clients | **Corrected by the owner.** Breadth is demo inventory: Indian buyers decide by seeing a working screen. Breadth stays. The real defect is that breadth is *unverified*, so it is not demo-grade. Workstream C |
| 2 | Screens proven at the server but never opened in a browser; known failing conformance tests; no green full-suite record | A3 and workstream C |
| 3 | Deployment sprawl: Modes A, B, C and a proposed D | Decision D2; workstream E |
| 4 | A push can reach production before its migration (caused an outage 2026-10-20); readiness flapping | A2; readiness already fixed by `ef929e27` (scheduler staleness now reports `degraded`, HTTP 200) |
| 5 | Accounting does not post to the ledger; Odoo/ERPNext parity is being rebuilt by hand | ADR-044 accepted with two amendments; the build is Task 130 |
| 6 | Visual system changed six times in six weeks; 24px blur on every cell is a risk on cheap phones and old office PCs | Workstream D |
| 7 | `CLAUDE.md` contradicts itself and the code (scope list, forbidden pattern 8 vs ADR-053, stale ADR highlights) | A1 |
| 8 | Bus factor of one person plus agent sessions; docs are the control plane and drift | A1 and the standing rule in section 2 |

## 2. Decisions taken (recorded, not asked; basis given)

- **D1. Demo-readiness is a first-class state.** New term beside BUILT / PROVEN / DEMONSTRATED / NOT YET BUILT:
  **DEMO-READY** = a seeded demo tenant exists, a reset command restores it, and every screen of the capability has been opened
  at desktop and 390px in both themes with real data and no defect left unlogged. Basis: the owner's sales reality; screens that
  are BUILT but never opened (FINISHER P1-2) cannot be shown to a buyer safely.
- **D2. Deployment modes.** Hosted multi-tenant SaaS (Vercel + Supabase) is the default for every client. DSEW is the single
  on-premises validation target, **Mode B** (private network: self-hosted Keycloak, bundled SeaweedFS, no hosted dependency at
  runtime). Mode C (air-gapped) and Mode D (client-owned Vercel/Supabase) are **parked**: no work, no promise, no proposal
  wording, until a named paying client requires them (ADR-031 constraint 2 already forbids selling an unproven mode).
  Basis: one person cannot support four modes; DSEW wants its data on its own premises.
- **D3. AI on a low-end on-prem server.** Never run a language model on the DSEW host. Mode B ships with AI **off** and zero
  egress. If DSEW opts in, the existing agent channel calls a hosted OpenAI-compatible endpoint (`OPENAI_BASE_URL`) from one
  allow-listed egress route, per tenant, as the caller's own `ActorContext` (ADR-017). A local model is considered only on a
  separate GPU machine, and only if asked. Basis: server CPU/RAM unknown (survey unanswered), local model quality on commodity
  hardware is poor, and the no-egress test (B5) is the client's trust story.
- **D4. Migration gate = build-time assertion, not auto-migrate.** The production build fails when the production database lacks
  a migration the commit carries, so the previous deployment stays live. Chosen over running `migrate deploy` in the Vercel
  build (migrations would run as `postgres` from the build environment, and a failed migration would block every deploy) and over
  a CI job needing a production secret. One-time step: the migration that adds the read function must be applied to production
  before the first push that carries the gate. Resolves FINISHER P0-2.
- **D5. Low-end rendering.** Frosted glass stays the design (ADR-053, and it sells in demos). A **lite effects** mode removes
  blur and keeps the same layout, tint and hairlines; it turns on automatically on weak devices and by a user setting.
  ADR-053 already requires a solid fallback under `prefers-reduced-transparency`; this extends the trigger, not the design.

Standing rule added by this plan: **governing docs are corrected in the same commit as the code that falsifies them**
(`CLAUDE.md`, `FINISHER.md`, `00_STATUS_INDEX.md`, handoffs README).

## 3. Workstream A — Truth and production safety (first)

| Id | Item | Done when | Status |
|---|---|---|---|
| A1 | Correct governing docs: `CLAUDE.md` scope note and stale highlights, forbidden pattern 8 vs ADR-053, `FINISHER.md` P0-1 | docs match code; no contradiction between `CLAUDE.md` rules | DONE `fb0e1e4b`. The ADR highlight list in `CLAUDE.md` is still stale beyond what it names; it says so itself |
| A2 | Migration gate (D4): `verity.applied_migration_names()` definer function, `scripts/assert-migrations-applied.mjs`, wired into `npm run build` | DB test: returns only finished, not rolled-back migrations; runtime role can execute, PUBLIC cannot; script test: a missing migration fails and names it; proven once on a branch before the first push | BUILT and PROVEN locally `fb0e1e4b` (10 tests). **Not proven on production:** the migration must be applied to production first, then one preview deploy |
| A3 | One full green suite on the local test database; fix or explicitly baseline the three known conformance failures | `npm test` exit 0 recorded here with date and commit | DONE. **GitHub Actions `verify` passed on `0dc8c8d7` (typecheck, lint, knip, `npm test`, build): `npm test` exit 0 on Linux.** Before that fix CI was red on two things this session introduced (an unlisted `playwright` import, and the migration gate's Linux-only ENOTDIR). Earlier local evidence: full suite on a CI-shaped local database, 136 of 138 files and 1604 of 1619 tests passed on Windows. Conformance (3 stale expectations: piecework dependencies, three append-only tables, a request-memo `react` import in `auth.ts`) fixed in `5a6ba739`. The 8 remaining reds are `deploy-public-url-preflight` (7) and `deploy-bundled-storage` (1), which time out at 30 s on this Windows host because each `bash` spawn costs seconds. Run natively on Linux (Node 22 container) the same two files and four neighbours pass: 6 files, 93 tests, 2.1 s. That is now confirmed by CI |

## 4. Workstream B — DSEW on-premises, Mode B (high priority)

Design source: `clients/dsew/deployment-readiness-audit.md` sections 8-10 and `onprem-stage2-design.md`. Already BUILT and
PROVEN: hardened compose package, install/migrate/upgrade/backup/restore/health scripts, OIDC relying party, S3 driver,
SeaweedFS overlay, degraded-readiness contract (`ef929e27`), reversible membership disable (ADR-049, local database only), a
fresh-clone install with 141/141 migrations in WSL2 (stage 1). Status below is as of 2026-10-22. "Rehearsed" means exercised end to end on a throwaway Docker stack in WSL2 Ubuntu (project `verityb1`, hostnames `*.dsew.test`, port 8443), never on DSEW's server.

| Id | Item | Blocker closed | Done when |
|---|---|---|---|
| B1 | Keycloak overlay `deploy/compose/docker-compose.keycloak.yml`, realm template, confidential PKCE client, own database and volume, digest-pinned | B1 | stack signs a user in through Keycloak; preflight refuses default admin credentials. **BUILT `5a6ba739`; REHEARSED:** real PKCE sign-in in headless Chromium, Secure HttpOnly cookies, admin console not reachable from the LAN (404), preflight refuses default admin name, placeholder and short secrets |
| B2 | `deploy/scripts/provision-oidc-user.sh`: create the Keycloak user, take the UUID `sub`, call the existing `provisionIdentity` path. No runtime auth change; a Keycloak Admin adapter needs an ADR first | B2 | script test provisions a user who can sign in and reach their role. **BUILT; REHEARSED:** creates and links, idempotent on repeat, refuses a bad tenant or role *before* creating a Keycloak account (a first version created an orphan; fixed), prints the one-time password only for a new account. A provisioned person's own sign-in was not separately driven |
| B3 | Reverse proxy overlay (Caddy, internal CA or supplied certificate) for web, Keycloak and the object store; browser-reachable presigned upload endpoint; CA-trust guide for PCs and phones | B3, B6 | a file uploads from a browser through HTTPS to the bundled store; `VERITY_PUBLIC_URL` is `https`. **BUILT; REHEARSED:** cross-origin browser PUT and GET through the proxy, bytes identical (the object store's own CORS headers had to be replaced, not added to). **Not tested:** a real phone, HEIC photos, a real CA install on a device |
| B4 | One **backup set**: verity dump, Keycloak dump, object-store snapshot, checksummed manifest; scripted restore verification (role attributes, forced RLS, file checksums) | B4 | destroy-and-restore drill returns the same data; negative tests for a corrupt set and a wrong key. **BUILT; REHEARSED** (second drill): all volumes destroyed; restore returned 1 tenant, 4 Keycloak accounts, `verity_app` NOSUPERUSER NOBYPASSRLS, 0 tables with RLS enabled but not forced, a 2066-byte file byte-identical, and sign-in worked. Refuses, changing nothing, on a corrupt archive, a corrupt Keycloak dump, a missing companion file and a missing confirmation. **The first drill failed:** the object snapshot had taken a volume from another compose project by name search; fixed and pinned by test. Not done: encrypted backups (operator-managed), a wrong-key test, measured restore time on DSEW hardware |
| B5 | No-egress test: stack on a network that blocks outbound; sign-in, job, upload and backup all work; every denied connection listed (applies D3) | audit tests 1, 5 | "zero egress" claimed only after. **BUILT; REHEARSED:** every service sits on an `internal: true` network and only the proxy joins `edge`. From web, scheduler, Keycloak, the object store and the database, public and private addresses and public DNS all fail; sign-in, upload, provisioning and backup all worked; 0 outbound-error lines in any service log. "Zero egress" is claimed for this network design only: image pulls at install and upgrade are made by the host's Docker daemon |
| B6 | Operator runbook `deploy/runbooks/dsew-operations.md` for DSEW's IT person: install, upgrade, backup, restore, add/disable a user, rotate secrets, IdP-down behaviour | operational | a person other than the author installs from it on a clean VM. **WRITTEN, with `deploy/docs/trust-the-ca.md`; not yet followed by anyone else.** Secret rotation is not documented; disabling a person's Verity access has **no screen** (new FINISHER item) |
| B7 | Validation gate on the target: clean install, Keycloak sign-in, phone upload over HTTPS, backup, destroy, restore, same data, no egress | B5 | "validated on Mode B for D&S" is stated only after this passes on a VM matching the survey |

**Blocked on a person (code cannot close this):** the DSEW server survey (make, OS build, CPU, RAM, disk, Hyper-V and licence,
whether a Linux VM is permitted, backup owner, recovery time). Until answered, installing at DSEW stays **NO-GO**; B1-B6 proceed
on a DSEW-like local VM and are labelled as such. Windows Server 2019 compatibility stays UNKNOWN.

## 5. Workstream C — Demo-grade platform

| Id | Item | Done when |
|---|---|---|
| C1 | **Demo Readiness Matrix** in `docs/demo/readiness-matrix.md`: rows = capabilities; columns = demo tenant, seed command, reset command, screens, last walked (date, widths, themes), open defects | every capability has a row; DEMO-READY only with evidence. **BUILT:** five demo tenants with seed and restore commands read from the repository, every "last walked" is *never*; four capabilities have no named demo tenant yet. Nothing is DEMO-READY |
| C2 | Route-walk harness: headless Playwright with a saved session (delete the session file afterwards, it holds cookies) visits every navigation route of every demo tenant at desktop and 390px, light and dark; fails on 5xx, console error, horizontal scroll or clipped card | one command prints a pass/fail table; screenshots committed under `docs/demo/evidence/`. **BUILT:** `npm run demo:walk` (`scripts/demo-walk.mjs`, pure judge tested in `src/test/demo-walk.test.ts`). Proven on the rehearsal stack: it caught a deliberate 404, classed a locked screen FORBIDDEN, passed the rest. **No real demo tenant has been walked.** It cannot tell whether a capability is active for the tenant |
| C3 | Fix what the harness finds in shared primitives, not per page; log anything not fixed | zero unlogged defects for DSEW, Stylified, Colonel Kebabz and the plywood demo tenant first |
| C4 | One-command reset per demo tenant (`reset:demo` exists; verify per tenant; never run against production: the `*-hero` seed scripts load `.env`, which is production) | reset returns a tenant to its seeded state in under a minute; documented |

## 6. Workstream D — Low-end devices

| Id | Item | Done when |
|---|---|---|
| D1 | Lite effects mode (D5): `data-effects="lite"` on `<html>`, set from `prefers-reduced-transparency`, a device memory/cores heuristic and a persisted user setting; same tokens, no `backdrop-filter` | screenshot diff shows layout unchanged; no blur layer remains in lite mode. **BUILT `81ad10db`:** `data-effects="lite"` from a setting (Appearance: Automatic, Full glass, Lite) or one-time detection (4 or fewer cores, 4 GB or less), stamped by the server from a cookie. Verified in Chromium: lite has 0 elements with a backdrop filter and no light field; full has 4 to 12. No screenshot diff taken |
| D2 | Measure: performance trace on the DSEW floor screens with 6x CPU throttle, glass vs lite; record numbers | numbers recorded here; lite is within budget or the gap is logged. **NOT MEASURED.** A scroll-frame test at 6x CPU throttle in headless Chromium showed 16.7 ms frames in both modes (no GPU compositing), so it says nothing. Needs a real low-end phone or a GPU-backed trace |

## 7. Workstream E — Scope discipline

| Id | Item | Done when |
|---|---|---|
| E1 | New ADR (PROPOSED) amending ADR-031 to "A default, B for DSEW, C and D parked"; check the ADR register for the number first | ADR exists; proposal documents and `CLAUDE.md` use its wording. **ADR-054 written, PROPOSED 2026-10-22;** `CLAUDE.md` cites it. DSEW proposal wording not yet checked against it |
| E2 | Accounting posting: obtain acceptance of ADR-044, then build posting per FINISHER P1-1h. No third ledger path before acceptance | ADR-044 ACCEPTED or amended; posting handlers proven. **ADR-044 ACCEPTED with two amendments 2026-10-22** (outbox; the consumer keeps its own progress because `delivered_at` belongs to notifications). The build is its own plan, `taskplans/130_ledger_posting_adr_044.md`, because it needs a migration, a consumer, ten document kinds, an account map and a backfill |
| E3 | Prune: move complete or superseded taskplans out of the active list; keep `00_STATUS_INDEX.md` as the register | active `taskplans/` lists only live work. **DONE (conservative):** of 32 completed plans still in the folder, 24 are cited by code, the Bible or `CLAUDE.md` (several are authority documents) and stay; the 8 that nothing cites moved to `taskplans/archive/` and their index rows were repointed |

## 8. Non-goals

No new business capability. No Mode C or Mode D work. No local language model on the DSEW host. No change to RLS,
`withTenant()`, `enforcePolicy()`, the HQ operator model or the Experience System design language. No push and no production
database change without the product owner's go.

## 9. Order of work

A1, A2, A3 → B1-B4 (in parallel with C1-C2) → B5-B6 → D1 → C3 → B7 when the survey is answered → E.

## 10. Closure, 2026-10-22: what is finished, and the five things only a person or a device can finish

**Finished and committed:** A1, A2 (built and proven locally), A3 (Linux result), B1 to B6 (rehearsed), C1 and C2 (harness proven, not
yet run on a real tenant), D1, E1, E2 (decision; build moved to Task 130), E3. Also done on the way: the CI `knip` failure from the demo
walk (`b09a319e`), ADR-049 accepted and its screen built (HQ People: Disable access / Restore access with a required reason), and
the frosted-blur fix.

**Gated outside the repository (each is in FINISHER with exact steps):**

1. **Apply the migrations to production (A2 proof).** A read of the production database was refused for this session, as it should be
   without the owner at the keyboard. The pushes up to `7689a4fa` failed on Vercel and in CI, and the cause was a bug in the gate (it stat-ed
   `migration_lock.toml/`, which Linux rejects and Windows accepts), now fixed and checked on Linux. Windows-only testing hid it, which is
   why the plan's rule is that a deploy-path script is proven on Linux. The previous deployment stayed live.
2. **B7: validate Mode B on hardware matching DSEW.** Needs DSEW's server survey and a Linux machine or VM.
3. **A real phone:** camera upload over HTTPS with the CA installed, HEIC photos, and D2 (a throttled trace, glass vs lite).
4. **C3 and C4: walk the five demo tenants.** Needs each seeded on a local database. The seed scripts load `.env` (production) and
   create Supabase logins when its keys are present, so they must be run with the production variables blanked; do that deliberately,
   not as a side effect of a test run.
5. **Task 130:** the posting build.
