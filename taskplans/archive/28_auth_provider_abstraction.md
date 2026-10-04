# Task Plan 28 — Auth Provider Abstraction

This document defines the implementation plan to isolate Supabase Auth behind a clean, provider-neutral authentication interface, preparing the Verity platform for Keycloak/OIDC federation without altering downstream role checks.

---

## 1. Requirements

### VERITY-SEC-001: Authentication Provider Isolation
*   **Target**: Decouple request session authentication from Supabase-specific cookie drivers.
*   **Requirement**: Introduce a provider-neutral interface for retrieving the authenticated user's credentials and claims.
*   **Current State**: `src/server/platform/auth.ts` calls `@supabase/ssr` directly to fetch the user.

---

## 2. Design

### Step 1: Define the Auth Provider Interface
Create an interface inside `src/server/platform/auth.ts` or a separate file `src/server/platform/authProvider.ts`:
```typescript
export interface AuthProvider {
  name: string;
  getAuthUser(): Promise<{ id: string; email?: string } | null>;
}
```

### Step 2: Implement Supabase Auth Adapter
Extract the existing Supabase SSR client calls into a concrete implementation of this interface:
```typescript
export class SupabaseAuthProvider implements AuthProvider {
  name = "supabase";
  async getAuthUser() {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email };
  }
}
```

### Step 3: Wire Interface to Auth Resolvers
Refactor `src/server/platform/auth.ts`:
*   Create a registry or active configuration parameter that loads the appropriate `AuthProvider`.
*   Replace direct `@supabase/ssr` references inside `listMemberships()` and session lookup paths with calls to the active `AuthProvider`.

---

## 3. Verification & Acceptance Criteria
*   [x] The application correctly resolves the authenticated actor using the pluggable `AuthProvider` interface.
*   [x] Existing auth-related tests pass without modification or regressions.

---

## 4. Implementation Notes (Claude Code, 2026-08-30)

### Inventory, before writing anything
*   **`src/proxy.ts`** — calls `@supabase/ssr`'s `createServerClient` and
    `supabase.auth.getUser()` directly, inside a try/catch that must degrade
    (never reject) on any failure — established and tested in Task 26
    (`proxy.test.ts`'s "auth client cannot be constructed" case). Left
    untouched here for the same reason it was excluded from `runtimeConfig`:
    it is a documented, tested exception to the provider boundary, not an
    oversight.
*   **`src/server/platform/auth.ts`** — the actual authentication surface.
    `getAuthUser()` called `supabase.auth.getUser()` and returned Supabase's
    own `User` object directly. Everything downstream of it —
    `listMemberships()`, `resolveActor()`, `requireActor()` — already
    returned fully Verity-native shapes (`ActorContext`:
    `tenantId`/`userId`/`membershipId`/`organizationId`/`roleId`, zero
    Supabase fields). The leak was narrow: one function's return type.
*   **Every consumer of `getAuthUser()`**, found by repository search:
    `(hq)/layout.tsx` and `(shell)/layout.tsx` (read `.email` only, for a
    display label) and `operator.ts` (reads `.id` only, to call
    `verity.is_platform_operator`). No consumer anywhere touches any other
    field of Supabase's `User` type — confirmed exhaustively via
    `rg "authUser\.\w+"` before writing the new `Principal` type, not assumed.
*   **`createSupabaseServerClient()`** — used by `getAuthUser()` internally
    and directly by `server/actions/platform.ts`'s `signInWithPassword()`/
    `signOut()`. Those two are genuinely provider-specific: a password grant
    and a session-clear operation that an OIDC provider would not implement
    the same way (redirect-based flows instead). Left as explicit Supabase
    glue rather than forced onto the neutral `AuthProvider` interface — see
    Decision 2 below.
*   **User/identity mapping** — `User.authUserId` (Prisma model) is the only
    field tying a Verity `User` to its external identity; it is a bare UUID
    column with no foreign key into Supabase's `auth.users` (confirmed in
    Task 26/`25_postgres_portability.md`'s earlier audit). `provisionIdentity()`
    (`identity.ts`) is the only write path. Neither was touched — this task's
    contract intentionally sits in front of that boundary without altering it.
*   **Authentication tests** — none existed. `proxy.test.ts` mocks
    `@supabase/ssr` for `proxy.ts` specifically; no file mocked auth.ts's own
    `getAuthUser()`/`resolveActor()`, and no file exercised identity mapping
    (every other test constructs an `ActorContext` by hand). This was the
    real, verifiable gap this task closes.

### What was built
*   **`src/server/platform/authProvider.ts`** (new) — the neutral contract:
    ```ts
    export type Principal = { id: string; email: string | null };
    export interface AuthProvider {
      readonly name: string;
      getPrincipal(): Promise<Principal | null>;
    }
    ```
    `Principal` carries exactly the two fields any real consumer uses —
    verified by the exhaustive search above, not assumed from the task's
    template. No registry (see Decision 1).
*   **`src/server/platform/auth.ts`** — `getAuthUser()` now returns
    `Principal | null`. Internally, a `SupabaseAuthProvider` class
    (`implements AuthProvider`) wraps the existing
    `createSupabaseServerClient()` + `auth.getUser()` call and maps the
    result to `{ id, email }`, discarding `aud`, `app_metadata`,
    `user_metadata`, `created_at`, and everything else Supabase's `User`
    carries. `getAuthUser()` is now a one-line call to a fixed
    `authProvider: AuthProvider` singleton. No other function in this file
    changed — `listMemberships()`, `resolveActor()`, `requireActor()`,
    `setActiveMembership()` were already provider-neutral and needed no edits.
*   `typecheck` passing with zero consumer changes is itself evidence the
    boundary was already this narrow: if any layout or `operator.ts` had
    touched a field beyond `.id`/`.email`, narrowing `getAuthUser()`'s return
    type to `Principal` would have failed to compile there. It didn't.

### Decisions made
1.  **No provider registry.** Storage (Task 27) has a real "no backend
    configured" state — a valid deployment. Authentication does not: there
    is always exactly one active provider. A registry with a possibly-null
    active provider would model a state that cannot occur, so `authProvider`
    is a fixed singleton, constructed once in `auth.ts`. Swapping providers
    is a code change (write a class implementing `AuthProvider`, change the
    one line that constructs `authProvider`), which is what "architectural
    compatibility, not immediate provider replacement" asked for — not a
    runtime `provider` switch, which would be exactly the kind of
    single-implementation configuration `config.ts`'s own design notes (Task
    26/27) already declined to add for storage.
2.  **`signInWithPassword()`/`signOut()` were not folded into `AuthProvider`.**
    Both are inherently Supabase/GoTrue-shaped (a password grant; a
    session-clear call) with no equivalent on a redirect-based OIDC flow.
    Forcing a shared interface method for them would mean either a lossy
    abstraction (an OIDC provider stubbing out `signInWithPassword` with
    "redirect instead") or scope creep into login/signup UX redesign, both
    explicitly out of scope. They keep calling `createSupabaseServerClient()`
    directly, now documented in `auth.ts` as intentional provider glue.
3.  **`src/proxy.ts` stays untouched**, per the Task 26 precedent
    (`proxy.test.ts`'s regression coverage) — restated here because Task 28
    explicitly asks to "inspect `src/proxy.ts` carefully" and "preserve
    existing session-refresh behavior while making the provider-specific
    boundary explicit." The boundary IS explicit: a one-line comment was
    already added in Task 26 explaining why `proxy.ts` does not go through
    the centralized boundary (there, `runtimeConfig`; the same reasoning
    now covers `AuthProvider` too — a throwing/registry-based auth
    resolution is exactly wrong for a boundary that must degrade, never
    reject). No further change was needed or made.
4.  **User/identity mapping was not touched.** `authUserId` remains the
    field, `provisionIdentity()` remains the only write path, and
    `verity.memberships_for_auth_user` remains keyed on it. This task adds a
    contract *above* that mapping (what identifies the caller) without
    altering the mapping itself.

### Files changed
*   **New**: `src/server/platform/authProvider.ts` — `Principal`, `AuthProvider`.
*   **New**: `src/test/auth-provider.test.ts` — 7 tests (4 provider-behavior, no DB; 3 identity-mapping, DB-gated).
*   `src/server/platform/auth.ts` — `getAuthUser()` retyped to `Principal | null`; `SupabaseAuthProvider` class added; doc comments updated to state the provider boundary explicitly.
*   `src/test/conformance.test.ts` — platform-module-count tripwire raised 25 → 26, with a one-line reason (same tripwire Task 26 raised 24 → 25 for `config.ts`).
*   **No other file changed.** `operator.ts`, both layouts, `server/actions/platform.ts`, `src/proxy.ts` are byte-for-byte what they were — the whole point being that a narrower return type on one function required no changes anywhere that already only used `.id`/`.email`.

### Provider boundary
Confirmed by repository search (`@supabase/ssr`, `SupabaseClient`,
`auth.getUser`, `auth.getSession`, `GoTrue`) before and after the change:
matches confined to `src/proxy.ts` (documented exception), `src/server/platform/auth.ts`
(the adapter — now hosting `SupabaseAuthProvider`), `src/server/storage/supabase.ts`
(Task 27's unrelated storage `SupabaseClient` type, a false-positive for this
search), and test files mocking these SDKs. No domain, capability, or
application code imports a Supabase auth type or calls a Supabase auth method
directly — only `getAuthUser()` (returning `Principal`), `resolveActor()`,
`requireActor()`, and `listMemberships()` (returning `ActorContext`/
`MembershipOption`, both pre-existing and already neutral).

### Identity mapping behavior
Unchanged in mechanism, newly covered by tests: `Principal.id` is passed to
`verity.memberships_for_auth_user(authUserId)`, exactly as `authUser.id` was
before. `auth-provider.test.ts`'s DB-gated suite provisions a real `User` via
`provisionIdentity()` with a known `authUserId`, mocks only the Supabase
layer to report that id as the current session, and confirms
`resolveActor()`/`listMemberships()` resolve the correct tenant, membership,
and organization — "valid external identity → Verity user." A second test
uses an unprovisioned random UUID and confirms both functions return empty/
null — "unknown external identity." A third confirms no session at all also
resolves to nothing.

### Tests executed
*   `npx vitest run src/test/auth-provider.test.ts` — 7/7 passed, isolated, first.
*   `npx vitest run src/test/auth-provider.test.ts src/test/proxy.test.ts src/test/config.test.ts src/test/storage-adapter.test.ts src/test/operator-boundary.test.ts src/test/identity-membership.test.ts src/test/authorization.test.ts` — 64/64 passed (every file touching auth, tenancy, or the Task 26/27 boundaries, run together).
*   `npm run typecheck` — clean (zero consumer changes required — see above).
*   `npm run lint` — clean (same one pre-existing, unrelated `SmartTable.tsx` warning as Tasks 26/27).
*   `npm run test` (full suite) — 480/480 passed after raising the conformance tripwire (see Files changed).

### Results
Architecture requirement satisfied: a provider-neutral `Principal`/
`AuthProvider` contract exists, Supabase Auth is isolated behind
`SupabaseAuthProvider` inside `auth.ts`, and no Supabase-specific type
reaches domain/application authorization code — verified by search, not
assumed. Runtime and session-refresh behavior unchanged (`proxy.ts`
untouched; `auth.ts`'s cookie/session logic unchanged, only its return type
narrowed). Identity mapping unchanged and now tested. Configuration
continues to flow through `runtimeConfig` (untouched, Task 26). Full
regression suite green.

### Known limitations
*   `signInWithPassword()`/`signOut()` remain explicit Supabase calls (see
    Decision 2) — a future OIDC provider would need its own sign-in/sign-out
    entry points in `server/actions/platform.ts`, not a drop-in replacement
    of these two functions. This is a real, acknowledged seam, not an
    oversight: it is the correct seam, since the two flows are not the same
    operation across providers.
*   `src/proxy.ts` still constructs its own Supabase client independent of
    `SupabaseAuthProvider` (two call sites doing conceptually the same
    `auth.getUser()` call). Unifying them was considered and rejected: doing
    so would route the proxy's session refresh through code that is allowed
    to throw (`AuthProvider`/`runtimeConfig`), which is precisely the
    regression `proxy.test.ts` exists to catch. This duplication is the
    accepted cost of that boundary, not unaddressed debt.
*   No second `AuthProvider` was implemented, per this task's own
    instruction not to build one merely to prove the point. The "swap
    `SupabaseAuthProvider` for `OIDCAuthProvider`" claim rests on the
    interface shape and the exhaustive consumer search above, not a working
    second implementation.

### Future OIDC implications
An `OIDCAuthProvider implements AuthProvider` would need to: resolve a
principal from whatever session/token representation the OIDC flow uses,
map it to `{ id, email }` (id from the provider's `sub` claim, most likely),
and be substituted for the `authProvider` singleton in `auth.ts`. Nothing in
`ActorContext`, `resolveActor()`, `operator.ts`, authorization, tenancy, or
any capability would need to change, because none of them depend on
anything beyond `Principal`. Two things it would still need to bring
separately, deliberately not part of Task 28: its own sign-in/sign-out entry
points (Decision 2), and — if it is to protect `proxy.ts`'s session-refresh
path the way Supabase's client does today — its own equivalent of that
proxy-side refresh call, since `proxy.ts` was deliberately not routed
through `AuthProvider`.

### Follow-up dependencies
*   Task 29 (background job abstraction) and later Phase 7 workstreams do
    not depend on anything added here beyond `runtimeConfig` (Task 26),
    already in place.
*   If/when a second provider is actually built, `authProvider.ts` is where
    its interface additions (if the single `getPrincipal()` method proves
    insufficient) belong — not a parallel ad hoc auth path.

### Final status
**Task 28 — COMPLETE.** Ready for Antigravity review.
