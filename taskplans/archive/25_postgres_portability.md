# Task Plan 25 — Postgres Portability Audit

This document audits Verity's current database schema and custom PL/pgSQL structures to identify hidden dependencies on Supabase-specific functions, schemas, or extensions.

---

## 1. Schema & Extension Inventory

*   **Extensions**: 
    *   `[OBSERVED]`: `pgcrypto` is installed in the database via migration `20260822000000_required_extensions/migration.sql`. It is a standard Postgres extension and works out-of-the-box in self-hosted Postgres.
*   **Triggers / Functions**: 
    *   No triggers depend on Supabase-specific events (like Auth hooks). All triggers are standard local PL/pgSQL functions.
*   **Foreign Key Constraints**: 
    *   `[OBSERVED]`: The `user` table holds `auth_user_id` (representing the external authentication identifier), but carries **no physical database foreign key constraint** to the GoTrue `auth.users` table schema. It is a logical mapping only.

---

## 2. Row Level Security (RLS) & Search Path

*   **RLS Policies**: RLS policies are enabled via standard database tables and call the helper `verity.current_tenant_id()`.
*   **Search Path Resolutions**: Function definitions (like `verity.user_visible`) set search paths to include `public, verity, pg_temp` or `extensions`. The `extensions` schema prefix is a Supabase convention; on standard PostgreSQL, functions install cleanly inside `public`, which is correctly covered in search paths.

---

## 3. Portability Classification

| Database Feature | Current Status | Portability Verdict | Action Required |
|---|---|---|---|
| **pgcrypto Extension** | Local migration setup | **Supported** | None. |
| **RLS Isolation Policies**| Standard SQL filters | **Supported** | None. |
| **auth.users Mapping** | Logical UUID field | **Supported** | Substitute Auth ID resolver in server APIs. |
| **Schema Migrations** | Prisma Flyway-style | **Supported** | Execute migrations automatically on Docker boot. |
