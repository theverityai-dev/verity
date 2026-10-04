# Task Plan 36 — Enterprise Identity / OIDC

**Phase 8, Task 1 of 9.** Control document: `35A_phase8_execution_program.md`.
**Depends on:** Task 28 (`AuthProvider` boundary), Task 26 (`RuntimeConfig`).
**Gate owned:** G04 — external identity federation.

---

## 1. Objective

Make Verity capable of authenticating through an external enterprise identity
provider, without making any provider mandatory.

```text
Corporate IdP
     ↓  OIDC
AuthProvider
     ↓
Principal
     ↓
Verity User
```

Supabase Auth stays a first-class provider. The deployment chooses.

---

## 2. Authority

*   `Authority: EXISTING INFRASTRUCTURE` — `AuthProvider` / `Principal`
    (`src/server/platform/authProvider.ts`, Task 28) is the seam. This task
    fills it; it does not redesign it.
*   `Authority: Bible V5 §1.A.4` — single global authentication realm.
*   `Authority: Spec V2 PLA-IDE-003` — membership-scoped sessions.
*   `Authority: Spec V2 PLA-TEN-006` — tenant context derives from the
    authenticated context, never from a client payload. An OIDC token may not
    nominate a tenant, no matter what claims it carries.
*   `Authority: ADR-007` — identity is linked on verified contact, never by
    matching an email across tenants. An OIDC `email` claim is display data.
*   `Authority: IMPLEMENTATION DECISION REQUIRED` — token transport (header vs
    cookie) and provider selection mechanism; both recorded in §4.

---

## 3. Must Prove

| # | Claim | Evidence form |
|---|---|---|
| P1 | OIDC-compatible provider boundary exists | `OidcAuthProvider implements AuthProvider`; test |
| P2 | Issuer is validated | Token from a foreign issuer is rejected |
| P3 | Audience / client is validated | Token for another client id is rejected |
| P4 | Signature is validated | Token signed by a foreign key is rejected |
| P5 | Expiry is validated | Expired token is rejected |
| P6 | Claims are normalized | `sub`/`oid`/custom claim → `Principal.id`; email claim configurable |
| P7 | Identity maps to a Verity user | `Principal.id` → `User.authUserId`, unchanged downstream |
| P8 | Session behaviour is secure | No token in a readable cookie; membership cookie still signed and re-verified |
| P9 | Unknown user fails closed | Verified principal with no `User` row yields no actor |
| P10 | No business logic knows OIDC | Structural test: no OIDC/JWT symbol outside the adapter |

---

## 4. Design

### 4.1 `src/server/platform/oidc.ts` — the pure verification module

No `next/*`, no `@supabase/*`, no database. Everything here is a function of its
inputs, which is what makes P2–P6 testable without a live IdP.

*   `OidcSettings` — issuer, clientId, audience, jwksUri, principalClaim,
    emailClaim, clockToleranceSeconds.
*   `discoveryUrl(issuer)` / `discoverJwksUri(issuer, fetch)` — standard
    `/.well-known/openid-configuration`, with the issuer of the discovered
    document checked against the configured issuer.
*   `normalizePrincipal(claims, settings)` — claims → `Principal`. The **only**
    place a claim name appears.
*   `verifyIdToken(token, settings, keys)` — `jose.jwtVerify` with issuer,
    audience and clock tolerance, then `normalizePrincipal`.

`jose` is already a dependency (`auth.ts` signs the membership cookie with it).
Adding an OIDC client library would add a second JWT implementation for no gain.

### 4.2 Provider selection

`runtimeConfig.auth.provider` — `"supabase"` (default) or `"oidc"`.

**IMPLEMENTATION DECISION.** `authProvider.ts` argued against a runtime registry
because there was exactly one provider and authentication is never optional.
Both halves of that argument still hold: there is still exactly one *active*
provider per deployment, chosen once at process start from validated
configuration, and it is still never null. What changes is that the choice is
now a deployment fact rather than a compile-time one — an enterprise installing
Verity behind its own IdP cannot be asked to recompile. This is provider
selection, not a plugin system: the set of providers is closed and lives in the
repository.

Configuration is validated per provider: `provider="supabase"` requires the
Supabase URL and anon key; `provider="oidc"` requires issuer and client id and
requires **no** Supabase variables at all. That last point is the real test of
the boundary — an OIDC deployment must boot with no Supabase project in
existence.

### 4.3 Token transport

**IMPLEMENTATION DECISION.** The adapter reads, in order:

1.  `Authorization: Bearer <token>` — machine and API callers.
2.  the `verity_oidc_id_token` cookie — browser sessions.

The cookie is `httpOnly`, `sameSite=lax`, `secure` in production. It carries the
IdP's signed id token, which is verified on every request exactly as the header
form is: nothing trusts the cookie's presence, only its verified content.

Not built here (out of scope, §6): the authorization-code redirect flow that
*sets* that cookie. The verification boundary is what Phase 8 needs and what
Task 37's authorization depends on; a login redirect UI is a separate change and
this task is explicitly forbidden from redesigning the login UI.

### 4.4 Unknown-user handling

A verified principal with no matching `User.authUserId` resolves to zero
memberships, therefore no `ActorContext`, therefore `requireActor()` throws
`E_UNAUTHENTICATED`. Verity does **not** auto-provision a user from a token —
that would let anyone in the IdP's realm create identity in a tenant, and
`provisionIdentity()` (ADR-007) is the only creation path. Fails closed by
construction, not by a check that could be forgotten.

---

## 5. Files

```text
src/server/platform/oidc.ts     NEW — pure OIDC verification and normalization
src/server/platform/config.ts   MODIFIED — auth.provider + auth.oidc, per-provider validation
src/server/platform/auth.ts     MODIFIED — OidcAuthProvider adapter, provider selection
src/test/oidc-provider.test.ts  NEW — P1..P10
```

---

## 6. Explicitly Not In This Task

*   No login UI redesign.
*   No authorization-code / PKCE redirect flow.
*   No provider catalogue (Google, Azure AD, Okta as named integrations) — one
    OIDC-compliant implementation serves all of them through configuration.
*   Keycloak is not mandatory and is not depended on.
*   No change to `ActorContext`, `resolveActor()`, authorization, or any
    capability. If this task had needed one, the Task 28 boundary would have
    failed.

---

## 7. Acceptance Criteria

*   [x] AC-01 `OidcAuthProvider` implements `AuthProvider` and returns `Principal`.
*   [x] AC-02 Foreign issuer, foreign audience, foreign signing key and expired
        token are each rejected.
*   [x] AC-03 Claim normalization is configurable and defaults to `sub` / `email`.
*   [x] AC-04 An OIDC-only deployment boots with no Supabase variables set.
*   [x] AC-05 A Supabase deployment is unchanged; existing auth tests pass untouched.
*   [x] AC-06 No OIDC or JWT symbol appears outside `oidc.ts` / `auth.ts`.
*   [x] AC-07 Typecheck clean; full suite no worse than the 521-test baseline.

---

## 8. Implementation Notes (Claude Code, 2026-08-30)

### Status: COMPLETE — BUILT and PROVEN

### What was found at HEAD

Task 28 had done more than its own document claimed. `getAuthUser()` already
returned `Principal`, and `ActorContext`, `resolveActor()`, `authorization.ts`,
`query.ts` and every capability already depended on nothing else. The test that
matters is AC-06, and it passes on unmodified files: **no downstream module
changed for this task.** That is the Task 28 boundary being real rather than
described.

Two things were not ready:

*   `runtimeConfig.auth` required the Supabase URL and anon key unconditionally,
    so an OIDC-only deployment could not boot. Fixed by per-provider validation
    (`superRefine`), not by making everything optional — a Supabase deployment
    is still refused without its variables (`AC-05`, tested).
*   `createSupabaseServerClient()` would have constructed a client against
    `undefined`. It now names the condition (`E_AUTH_PROVIDER`) instead of
    failing inside the SDK.

### What was built

| File | Change |
|---|---|
| `src/server/platform/oidc.ts` | NEW, 190 lines. Pure: no `next/*`, no `@supabase/*`, no Prisma. Discovery, issuer-checked `jwks_uri` resolution, `verifyIdToken`, `normalizePrincipal`, `bearerToken`. Three named errors: `E_OIDC_CONFIG`, `E_OIDC_CLAIMS`, `E_OIDC_VERIFY`. |
| `src/server/platform/config.ts` | `auth.provider` (`supabase` \| `oidc`, default `supabase`), `auth.oidc.*`, per-provider validation, session secret sourced `SUPABASE_JWT_SECRET` → `VERITY_SESSION_SECRET` → anon key. |
| `src/server/platform/auth.ts` | `OidcAuthProvider` (bearer header, then `verity_oidc_id_token` httpOnly cookie), `selectAuthProvider()`, `activeAuthProviderName()`, Supabase client guard. |
| `src/server/platform/authProvider.ts` | Doc only — the "chosen at compile time" paragraph was made false by this task and was corrected rather than left to mislead. |
| `src/test/oidc-provider.test.ts` | NEW, 26 tests. |
| `src/test/conformance.test.ts` | Platform-module tripwire 27 → 28, with the reason written next to the number as the previous three entries did. |

### Decisions taken, and why

**Verification is separated from transport.** Every rule an enterprise buys —
issuer, audience, signature, expiry, claim mapping — is a pure function in
`oidc.ts`. The consequence is that all 26 tests run with no identity provider,
no network and no database: a key pair is generated in-process and tokens are
signed against it. A test that needed Keycloak running would have proven the
deployment, not the boundary.

**`jwtVerify` is given the constraints, not asked about them afterwards.**
Issuer and audience go into the call. An `if` after the fact is a branch someone
can delete; a library that refuses to return is not.

**A rejected token is indistinguishable from an absent one.** `getPrincipal()`
returns `null` for a bad signature, a foreign issuer and a missing cookie alike,
so a prober learns nothing. A *configuration* fault is re-thrown, because that
is the operator's problem and hiding it would strand a deployment.

**Discovery validates the document's own issuer** before using its `jwks_uri`.
Without that check a redirect or a wrong hostname hands over another realm's key
set and every later signature check passes against the wrong authority.

**No auto-provisioning.** A verified principal with no `User.authUserId` yields
zero memberships, therefore no actor, therefore `E_UNAUTHENTICATED`. Creating a
user from a token would let anyone in the corporate directory materialise
identity inside a tenant; ADR-007's `provisionIdentity()` remains the only path.
This is P9, and it holds by construction rather than by a check.

**A tenant claim is ignored even when present.** PLA-TEN-006 is absolute, and an
IdP is precisely the party that would otherwise assert one. Tested: a token
carrying `tenant_id` produces a `Principal` that does not contain it.

### Found while proving it — a real environment defect

The three `capability-shared` availability tests fail against a PostgreSQL whose
session timezone is not UTC. They passed on the hosted database (UTC) and failed
on a locally provisioned cluster (IST), which is exactly the class of defect a
portable-runtime phase exists to catch: **the platform assumes a UTC database
session and nothing enforced it.** `temporal.ts` says instants are UTC; the
database was never told. Setting `timezone=UTC` on the cluster turned all three
green.

Carried forward as a hardening item for **Task 42**: the deployment package must
pin the database session timezone to UTC rather than inherit the host's, because
a customer installing on an IST or PST host would otherwise get subtly wrong
availability and SLA behaviour with every test still green in CI.

### Evidence

Live run, 2026-08-30, against a locally provisioned PostgreSQL 17 (all 41
migrations applied from an empty database — the hosted database was refusing
connections, see §Environment below):

```text
Test Files  42 passed (42)
Tests       544 passed | 3 skipped (547)
```

*   Baseline before this task on the same cluster: 521 tests.
*   After: 547 (+26), zero failures, zero regressions.
*   `npx tsc --noEmit`: clean.
*   Legacy-pattern scan on all changed files: NONE FOUND.

### Environment

The hosted Supabase database began refusing the `verity_app` credentials
mid-session (`FATAL: (ECIRCUITBREAKER)`, then `Authentication failed against
database server`). Rather than record every integration suite as NOT EXECUTED
for the remainder of Phase 8, a local PostgreSQL 17 cluster was provisioned with
the same role contract the deployment uses — `verity_app` `NOSUPERUSER
NOBYPASSRLS`, privileged `postgres` for migrations only — and all 41 migrations
were applied to it from empty. `assertRlsEnforceable()` passes against it, so
INV-001 is enforced, not merely assumed. Phase 8 evidence from here on is
generated against that cluster.

### Not done, deliberately

*   The authorization-code / PKCE redirect flow that *sets* the session cookie.
    §6 excludes it and the task forbids redesigning the login UI. What Task 37
    depends on is a verified principal, and that exists.
*   No named provider integrations. One OIDC-compliant implementation reaches
    Keycloak, Entra ID, Okta, Auth0 and Ping through configuration; a catalogue
    of per-vendor adapters would be the coupling this task was written to avoid.
*   `activeAuthProviderName()` is exported for diagnostics and is deliberately
    not consulted anywhere in authorization.
