# Task Plan 26 — Runtime Configuration Boundary

This document designs and implements the typed, validated configuration boundary for Verity, consolidating scattered direct reads of environment variables into a single config module while preserving compatibility with Vercel and Supabase Cloud.

---

## 1. Inventory of Environment Variables
The following environment variables are read across the application code:

*   **Database**:
    *   `DATABASE_URL`: Main connection string for Prisma.
    *   `DIRECT_URL`: Direct database connection bypassing transaction pools.
    *   `VERITY_TX_TIMEOUT_MS` (Optional, defaults to `15000`): Transaction execution timeouts.
    *   `VERITY_TX_MAX_WAIT_MS` (Optional, defaults to `5000`): Transaction queue wait limits.
*   **Authentication (Supabase SSR)**:
    *   `NEXT_PUBLIC_SUPABASE_URL`: Auth server endpoint.
    *   `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Public client credential.
    *   `SUPABASE_JWT_SECRET`: Token signature key to encrypt active memberships.
*   **Storage (Supabase Media Buckets)**:
    *   `SUPABASE_MEDIA_BUCKET`: Upload destination.
    *   `SUPABASE_SERVICE_ROLE_KEY`: Admin API token.
*   **Operations**:
    *   `CRON_SECRET`: Verification token for scheduled cron routes.

---

## 2. Configuration Module Design

We will create a central config module: `src/server/platform/config.ts`.

```typescript
import { z } from "zod";

const configSchema = z.object({
  nodeEnv: z.enum(["development", "production", "test"]).default("development"),
  database: z.object({
    url: z.string().min(1, "DATABASE_URL is required"),
    directUrl: z.string().optional(),
    txTimeoutMs: z.number().default(15000),
    txMaxWaitMs: z.number().default(5000),
  }),
  auth: z.object({
    supabaseUrl: z.string().min(1, "NEXT_PUBLIC_SUPABASE_URL is required"),
    supabaseAnonKey: z.string().min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
    jwtSecret: z.string().min(1, "SUPABASE_JWT_SECRET is required"),
  }),
  storage: z.object({
    provider: z.enum(["supabase", "s3"]).default("supabase"),
    supabaseBucket: z.string().optional(),
    supabaseServiceKey: z.string().optional(),
    s3Endpoint: z.string().optional(),
    s3Bucket: z.string().optional(),
    s3AccessKey: z.string().optional(),
    s3SecretKey: z.string().optional(),
  }),
  cronSecret: z.string().optional(),
});

export type RuntimeConfig = z.infer<typeof configSchema>;

export function loadConfig(): RuntimeConfig {
  const result = configSchema.safeParse({
    nodeEnv: process.env.NODE_ENV,
    database: {
      url: process.env.DATABASE_URL,
      directUrl: process.env.DIRECT_URL,
      txTimeoutMs: process.env.VERITY_TX_TIMEOUT_MS ? Number(process.env.VERITY_TX_TIMEOUT_MS) : undefined,
      txMaxWaitMs: process.env.VERITY_TX_MAX_WAIT_MS ? Number(process.env.VERITY_TX_MAX_WAIT_MS) : undefined,
    },
    auth: {
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      jwtSecret: process.env.SUPABASE_JWT_SECRET ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    },
    storage: {
      provider: process.env.STORAGE_PROVIDER ?? "supabase",
      supabaseBucket: process.env.SUPABASE_MEDIA_BUCKET,
      supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      s3Endpoint: process.env.S3_ENDPOINT,
      s3Bucket: process.env.S3_BUCKET,
      s3AccessKey: process.env.S3_ACCESS_KEY,
      s3SecretKey: process.env.S3_SECRET_KEY,
    },
    cronSecret: process.env.CRON_SECRET,
  });

  if (!result.success) {
    console.error("[verity] configuration validation failed:", result.error.format());
    throw new Error("E_CONFIG_INVALID: environment configuration fails verification check");
  }

  return result.data;
}

export const runtimeConfig = loadConfig();
```

---

## 3. Execution Plan

### Step 1: Write `src/server/platform/config.ts`
*   Define the schema validator.
*   Parse and validate `process.env` on module initialization.

### Step 2: Refactor Codebase Reads
Modify files to import `runtimeConfig` from `@/server/platform/config` rather than reading raw `process.env` fields:
*   `src/proxy.ts`
*   `src/server/platform/auth.ts`
*   `src/server/platform/tenancy.ts`
*   `src/server/storage/supabase.ts`
*   `src/app/api/scheduled/route.ts`

### Step 3: Create `.env.example`
Add a template showing required and optional variables for Cloud and Enterprise/Self-Hosted configurations.

---

## 4. Acceptance Criteria
*   [x] System boots successfully if all variables in `.env` are verified.
*   [x] System throws `E_CONFIG_INVALID` at start if `DATABASE_URL` is omitted.
*   [x] Unit tests run and verify schema parser logic.

---

## 5. Implementation Notes (Claude Code, 2026-08-30)

### Summary
Implemented as scoped: `src/server/platform/config.ts` defines a Zod schema,
parses `process.env` once at import, and exports a typed `runtimeConfig`. Four
of the five originally-listed files now consume it. `.env.example` was updated
in place (not regenerated — see below) and a new unit test file validates the
schema's fail-fast and default/fallback behavior.

### Files changed
*   **New**: `src/server/platform/config.ts` — the `RuntimeConfig` schema, `runtimeConfig`, `readCronSecret()`.
*   **New**: `src/test/config.test.ts` — 10 tests covering required-field failures, defaults, overrides, the JWT-secret fallback, and the storage-optional case.
*   `src/server/platform/auth.ts` — `signingKey()`, `createSupabaseServerClient()`, and the session cookie's `secure` flag now read `runtimeConfig`.
*   `src/server/platform/tenancy.ts` — `TRANSACTION_TIMEOUT_MS`/`TRANSACTION_MAX_WAIT_MS` now read `runtimeConfig.database`.
*   `src/server/storage/supabase.ts` — `installStorage()` reads `runtimeConfig.storage.*`; removed the now-unused `SERVICE_ROLE_KEY` string constant.
*   `src/app/api/scheduled/route.ts` — reads the cron secret via `readCronSecret()` instead of `process.env.CRON_SECRET` directly.
*   `src/proxy.ts` — **not** wired to `runtimeConfig` (decision below); added a one-line comment explaining why.
*   `.env.example` — added `VERITY_TX_TIMEOUT_MS`, `VERITY_TX_MAX_WAIT_MS`, `SUPABASE_JWT_SECRET` (all as commented-optional, matching the file's existing style); left everything else untouched.
*   `src/test/conformance.test.ts` — the platform-module-count tripwire raised 24 → 25 with a one-line note (see below).

### Decisions made (deviations from the literal task-plan draft, and why)

1. **`src/proxy.ts` was deliberately excluded from centralization.**
   `proxy.ts` runs on every request on the edge and its documented, tested
   contract is to catch a broken Supabase client and degrade to "no session
   refreshed" rather than reject — a rejected proxy takes down every route at
   once, including `/sign-in`. `runtimeConfig` throws at import time by
   design (that's the "fail fast" requirement). Wiring the one function that
   must never throw through the one module whose entire job is to throw would
   have broken `proxy.test.ts`'s "auth client cannot be constructed" case,
   which deletes `NEXT_PUBLIC_SUPABASE_URL` and asserts `proxy()` still
   returns a `Response`. Verified this by reading that test before touching
   `proxy.ts`, not after breaking it.

2. **`CRON_SECRET` was not folded into the static `runtimeConfig` object.**
   `scheduled-work-trigger.test.ts` mutates `process.env.CRON_SECRET` between
   calls within one test run (no module reset) and asserts each call observes
   the live value — this is also the correct security behavior for the route
   in production (a scheduler endpoint should observe its secret being
   rotated without a redeploy). A value cached once at import would freeze
   the first value seen. Exposed as `readCronSecret()`, a plain live read,
   documented in `config.ts`'s own module comment.

3. **`src/server/platform/db.ts` was left untouched**, despite reading
   `process.env.NODE_ENV` and conceptually "owning" `DATABASE_URL`. Prisma
   resolves `DATABASE_URL` itself via `env("DATABASE_URL")` in
   `schema.prisma`, lazily, at first query — not at `new PrismaClient()`.
   Routing it through an eagerly-parsed `runtimeConfig` would change that
   timing (validation would move to module-import time) for no behavioral
   gain, and `db.ts` was not one of the five files the task plan named. Left
   as the smallest-diff choice; `runtimeConfig.database.url` still exists and
   is validated for any future caller that needs it (e.g., an explicit
   `datasourceUrl` override, if that becomes necessary later).

4. **No `STORAGE_PROVIDER`/S3 fields were added to the schema**, even though
   the task plan's own draft schema sketch included them. No code path reads
   `STORAGE_PROVIDER`, `S3_ENDPOINT`, etc. today — adding them now would be
   speculative scaffolding for a provider that does not exist yet, and Task
   26's own constraints list explicitly excludes introducing new
   infrastructure. `storage.supabaseUrl`/`serviceRoleKey`/`bucket` mirror
   exactly what `installStorage()` already reads.

5. **The platform-module-count conformance tripwire (`conformance.test.ts`)
   was raised from 24 to 25.** Its own comment states it is "not a hard
   architectural rule, but a tripwire" whose failure should prompt asking
   whether the new module belongs in a capability. `config.ts` is
   deployment configuration, not capability logic — it belongs in
   `src/server/platform/`. Raised deliberately, with a one-line comment
   recording why, rather than silently or by routing the file elsewhere to
   dodge the count.

6. **`.env.example` was edited, not regenerated.** The existing file already
   carried real, specific reasoning per variable (why port 5432, why
   `NOSUPERUSER NOBYPASSRLS`, why `SUPABASE_SERVICE_ROLE_KEY` came back after
   being removed). Only the variables `config.ts` newly formalizes and that
   were missing from the file were added, in the same commented-optional
   style already used there.

### Tests run
*   `npx vitest run src/test/config.test.ts src/test/proxy.test.ts src/test/scheduled-work-trigger.test.ts` — 23/23 passed (isolated check of the two regression-risk files before the full suite).
*   `npm run typecheck` — clean.
*   `npm run lint` — clean (one pre-existing, unrelated warning in `SmartTable.tsx` about TanStack Table memoization; not touched by this change).
*   `npm run test` (full suite) — **463/463 passed** (453 pre-existing + 10 new in `config.test.ts`).

### Limitations
*   Fail-fast happens at first import of `config.ts` (effectively "first
    request" for a real server process, since `auth.ts`/`tenancy.ts` are
    imported early in the route/module graph), not via a dedicated Next.js
    `instrumentation.ts` boot hook. No such hook exists in this repository
    yet; adding one was out of scope for Task 26 and would be a separate,
    reviewable decision.
*   `src/server/platform/db.ts`'s `DATABASE_URL` resolution still goes
    through Prisma's own `env()` mechanism, not `runtimeConfig.database.url`
    directly (see Decision 3). The value is still validated by
    `runtimeConfig` for any other caller; a missing `DATABASE_URL` still
    fails fast the first time any of the four wired files is imported.
*   No `instrumentation.ts`, container health check, or self-hosted-specific
    configuration (Docker, MinIO/S3, Keycloak, etc.) was touched or implied
    by this change — those remain later Phase 7 workstreams, explicitly out
    of scope per the task's own constraints.

### Follow-up dependencies
*   Any later workstream that introduces S3/MinIO storage, Keycloak/OIDC
    auth, or Redis/BullMQ should extend `configSchema` in `config.ts` rather
    than reintroducing scattered `process.env` reads — that is the boundary
    this task established.
*   Note for whoever picks up Task 27+: the `taskplans/00_CLAUDE_CODE_HANDOFF.md`
    document (and the "Bible v2"/"Spec v2"/ADR-001..010 documents under
    `taskplans/`) are a separate, untracked planning corpus that does not
    match this repository's actual authority chain as defined in the root
    `CLAUDE.md` (`verity-bible/`, `verity-spec/`, ADR-001..016). Task 26 was
    narrow enough not to conflict with anything in the real constitution, but
    later Phase 7 workstreams (cloud-agnosticism, Docker, Keycloak,
    OpenSearch) are a real architectural pivot this project has not actually
    decided on. Flagging this explicitly rather than letting it pass silently
    into Task 27.

### Final status
**Task 26 — COMPLETE.** Ready for Antigravity review.
