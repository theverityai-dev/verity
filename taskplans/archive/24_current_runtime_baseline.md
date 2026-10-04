# Task Plan 24 — Current Runtime Baseline

This document lists the runtime configurations, libraries, and source code dependencies that currently bind the Verity application to Vercel and Supabase Cloud.

---

## 1. Environment & Package Metadata

*   **Current Git Commit**: `Track B Live` (Snapshot verified locally).
*   **Node Version**: Node v20/v22 compatible.
*   **Package Manager**: `npm` (utilizes standard `package.json` / `package-lock.json`).
*   **Next.js Version**: `^15.0.0` (utilizes Next.js App Router).
*   **Prisma Version**: `^6.19.3`.
*   **PostgreSQL Version**: PostgreSQL v15+ (locally tested).

---

## 2. Hard Supabase & Vercel Code Dependencies

### Package.json References
```json
"@supabase/ssr": "^0.12.0",
"@supabase/supabase-js": "^2.110.0"
```

### Source Code Files Audited

#### File 1: `src/proxy.ts`
*   **Imports**: `import { createServerClient } from "@supabase/ssr";`
*   **Vercel/Supabase Coupling**: Refreshes session tokens at the Next.js middleware routing boundary by calling `supabase.auth.getUser()`.
*   **Target Refactor**: This must be bypassed or replaced with NextAuth cookie verification when self-hosting.

#### File 2: `src/server/platform/auth.ts`
*   **Imports**: `import { createServerClient } from "@supabase/ssr";`
*   **Vercel/Supabase Coupling**: 
    *   Initializes the SSR database connection client (`createSupabaseServerClient()`).
    *   Authenticates incoming users by parsing local session cookies (`getAuthUser()`).
    *   Queries `verity.memberships_for_auth_user(${authUser.id}::uuid)` inside PostgreSQL, mapping the GoTrue Auth ID directly onto user accounts.
*   **Target Refactor**: Create a pluggable Auth adapter. If running in self-hosted mode, read credentials from local tables/NextAuth sessions rather than querying Supabase Auth client APIs.

#### File 3: `src/server/storage/supabase.ts`
*   **Imports**: `import { createClient } from "@supabase/supabase-js";`
*   **Vercel/Supabase Coupling**: Implements the `StorageDriver` interface, routing uploads, reads, and deletes directly to Supabase Media buckets.
*   **Target Refactor**: Write a companion S3 Storage Driver utilizing `@aws-sdk/client-s3` targeting local MinIO or SeaweedFS instances.

---

## 3. Environment Variable Footprint
The current codebase references these credentials in production:

*   `NEXT_PUBLIC_SUPABASE_URL`: API Endpoint for database auth/storage actions.
*   `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Client token for read requests.
*   `SUPABASE_SERVICE_ROLE_KEY`: Admin bypass token to perform backend file storage actions.
*   `SUPABASE_JWT_SECRET`: Used to sign encrypted session cookies (`verity_active_membership`).
*   `DATABASE_URL` / `DIRECT_URL`: Database connection strings.
