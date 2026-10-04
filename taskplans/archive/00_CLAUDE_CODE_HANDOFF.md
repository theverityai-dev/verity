# Task Plan 00 — Claude Code Handoff

This document serves as the canonical handoff package for **Claude Code**, containing the complete, authoritative planning, research, and specification context for the Verity Enterprise vNext platform transformation.

---

## 1. Repository State

*   **Repository Path**: `d:\Code\verity`
*   **Current Branch**: `main`
*   **Current Commit SHA**: `e29c5297778509b5e2c29409dc0bbccf0b2ab6dd`
*   **Working Tree Status**: Clean (no uncommitted modifications in production files; only untracked `/docs/` and `/taskplans/` directories exist).
*   **Latest Commit Message**: *Track B Live* (migrations applied, nullable dims, stock-movement guards).
*   **Runtime / Package Versions**: Next.js `15.0.0`, Prisma `6.19.3`, Node `20+` compatible.

### Current Separation of State:
1.  **LAST COMMITTED STATE**: Commit `e29c5297778509b5e2c29409dc0bbccf0b2ab6dd` contains the fully functional, working Verity codebase running on Vercel + Supabase Cloud.
2.  **PLANNING CREATED AFTER LAST COMMIT**: The files inside `/verity/taskplans/` and `/verity/docs/` establish the technical requirements, architecture decision records, and specifications for Phase 7 (Portability).
3.  **CODE CHANGES NOT YET PERFORMED**: No code files have been refactored or updated since the last commit. **Task 26 (Runtime Configuration) is currently un-implemented.**

---

## 2. Program History Since the Last Code Commit

Following the last code commit, the research and design phases were executed sequentially. The resulting artifacts are saved under `/verity/taskplans/`:

1.  **[00_research_program_ledger.md](file:///d:/Code/verity/taskplans/00_research_program_ledger.md)**: Tracks the status of the entire research and implementation program.
2.  **[01_rd_clone_and_freeze.md](file:///d:/Code/verity/taskplans/01_rd_clone_and_freeze.md)**: Documents the exact version-frozen git commits of our 12 R&D research archetypes.
3.  **[02_digit_works_audit.md](file:///d:/Code/verity/taskplans/02_digit_works_audit.md)**: Analysis of DIGIT Works event-driven persistence, decoupled workflows, and public-works data registry structures.
4.  **[03_payload_audit.md](file:///d:/Code/verity/taskplans/03_payload_audit.md)**: Analysis of Payload's Next.js-native adapters, field-level access, and versioning shadow tables.
5.  **[04_twenty_audit.md](file:///d:/Code/verity/taskplans/04_twenty_audit.md)**: Analysis of Twenty CRM's NestJS Nx monorepo patterns and Redis-backed BullMQ query queues.
6.  **[05_erpnext_audit.md](file:///d:/Code/verity/taskplans/05_erpnext_audit.md)**: Analysis of ERPNext's immutable transaction ledgers and document submission locking.
7.  **[06_plane_audit.md](file:///d:/Code/verity/taskplans/06_plane_audit.md)**: Analysis of Plane's workspace structures and self-hosted docker configurations.
8.  **[07_keycloak_audit.md](file:///d:/Code/verity/taskplans/07_keycloak_audit.md)**: Analysis of enterprise federated IAM authentication flows.
9.  **[08_temporal_audit.md](file:///d:/Code/verity/taskplans/08_temporal_audit.md)**: Analysis of durable state machines and resilient task retry models.
10. **[09_tooljet_audit.md](file:///d:/Code/verity/taskplans/09_tooljet_audit.md)**: Analysis of database connector layers and application-layer encryption.
11. **[10_opensearch_audit.md](file:///d:/Code/verity/taskplans/10_opensearch_audit.md)**: Analysis of read-write database query segregation.
12. **[11_formbricks_audit.md](file:///d:/Code/verity/taskplans/11_formbricks_audit.md)**: Analysis of Next.js self-hosted environment files and JSON response inputs.
13. **[12_cal_diy_audit.md](file:///d:/Code/verity/taskplans/12_cal_diy_audit.md)**: Analysis of timezone-agnostic schedules and time Offsets in database schemas.
14. **[13_seaweedfs_audit.md](file:///d:/Code/verity/taskplans/13_seaweedfs_audit.md)**: Analysis of S3-compatible file storage adapters.
15. **[14_capability_matrix.md](file:///d:/Code/verity/taskplans/14_capability_matrix.md)**: Capability matrix classifying findings via observed/inferred codes and mapping strategic directives (ADOPT/ADAPT).
16. **[15_architecture_pattern_catalogue.md](file:///d:/Code/verity/taskplans/15_architecture_pattern_catalogue.md)**: Patterns registry cataloging logical tenancy, storage wrapping, and organization filters.
17. **[16_cross_repo_comparison.md](file:///d:/Code/verity/taskplans/16_cross_repo_comparison.md)**: Synthesis mapping best lessons by capability and resolving database schema / access conflicts.
18. **[17_verity_gap_analysis.md](file:///d:/Code/verity/taskplans/17_verity_gap_analysis.md)**: Gap analysis defining P0–P3 priorities and establishing the "Things We Will NOT Build" scope limits.
19. **[17A_verity_architecture_decisions.md](file:///d:/Code/verity/taskplans/17A_verity_architecture_decisions.md)**: Architecture Decision Register (ADR-001 through ADR-010).
20. **[17B_verity_architecture_scorecard.md](file:///d:/Code/verity/taskplans/17B_verity_architecture_scorecard.md)**: Quantitative evaluation scoring current Verity (`32/70`) against target v2 (`61/70`).
21. **[18_combined_verity_prd.md](file:///d:/Code/verity/taskplans/18_combined_verity_prd.md)**: Combined Product Requirements Document mapping target platform core, domain engines, and vertical packs.
22. **[19_verity_bible_v2.md](file:///d:/Code/verity/taskplans/19_verity_bible_v2.md)**: Platform core development laws and naming constraints.
23. **[20_verity_spec_v2.md](file:///d:/Code/verity/taskplans/20_verity_spec_v2.md)**: Testable technical requirement definitions (VERITY-INFRA, VERITY-SEC, VERITY-DATA).
24. **[21_implementation_roadmap_v2.md](file:///d:/Code/verity/taskplans/21_implementation_roadmap_v2.md)**: Sequenced P0–P3 roadmap targets.
25. **[22_spec_consistency_audit.md](file:///d:/Code/verity/taskplans/22_spec_consistency_audit.md)**: Consistency audit defining OIDC auth scopes, BullMQ classifications, and the S3 storage interface.
26. **[25_postgres_portability.md](file:///d:/Code/verity/taskplans/25_postgres_portability.md)**: Schema analysis verifying pgcrypto extension compatibility and checking GoTrue table references.

---

## 3. Current Verity Strategic Direction
Verity is transitioning from a cloud-locked MSME SaaS tool into a **deployable enterprise operations platform**. The codebase must support:
*   **Verity Cloud**: Standard, shared multi-tenant SaaS hosting.
*   **Verity Dedicated**: Single-tenant isolated environments.
*   **Verity Enterprise**: Complete self-hosted installation within the client's secure local network or private cloud.

The strategic goal is to establish a robust, reusable platform from which custom vertical packs (Logistics, Construction, PSU, Manufacturing) can be toggled via environment settings, positioning Verity for high-ticket corporate and government tender contracts.

---

## 4. Architecture Principles (From `19_verity_bible_v2.md` & `20_verity_spec_v2.md`)

*   **BIBLE-001 (Cloud Agnosticism)**: The application core MUST remain independent of specific cloud platform services (Vercel/Supabase).
*   **BIBLE-002 (PostgreSQL Canonicalization)**: PostgreSQL is the single, canonical relational persistence engine.
*   **BIBLE-003 (Identity Federation)**: Verity MUST NOT store credentials; authentication is delegated to external OIDC IDPs.
*   **BIBLE-005 (Material History Integrity)**: Balances and ledger entries MUST NOT be silently updated; mutations write to append-only logs.
*   **BIBLE-006 (Vertical Isolation)**: Vertical domain packs MUST NOT inject code dependencies into the Platform Core.
*   **VERITY-INFRA-001 (Containerization)**: Production execution MUST run inside standard Docker Compose environments.
*   **VERITY-INFRA-002 (Storage Wrapper)**: Files MUST be accessed through an S3-compatible client SDK.

---

## 5. Architecture Decisions (From `17A_verity_architecture_decisions.md`)

*   **ADR-001: Portable Deployment**: Target Docker Compose multi-container configurations.
*   **ADR-002: Relational DB**: Standardize database queries strictly on PostgreSQL (using Prisma).
*   **ADR-003: Federated Identity**: Validate sessions using cryptographically signed JWT OIDC tokens.
*   **ADR-004: Scoped RBAC**: Enforce spatial and organizational boundaries inside Prisma DB clients.
*   **ADR-005: Decoupled Workflows**: Update entity statuses via centralized state-machine configs.
*   **ADR-006: S3 storage**: Route file uploads to MinIO/SeaweedFS S3 buckets.
*   **ADR-007: Low-Infra Search**: Query text fields locally using Postgres pg_trgm indexes.
*   **ADR-008: Async Jobs**: Offload notifications and PDFs to Redis-backed BullMQ.
*   **ADR-009: Logical Tenancy**: Partition multi-tenant data using a query-level `tenantId` parameter.
*   **ADR-010: Modular Packs**: Isolate industry logics inside decoupled vertical folders.

---

## 6. Current Runtime Baseline (From `24_current_runtime_baseline.md`)

Scattered dependencies on Vercel/Supabase exist in the following files:
*   `src/proxy.ts`: Next.js middleware using `@supabase/ssr` to touch `supabase.auth.getUser()`. (Candidate for decoupling).
*   `src/server/platform/auth.ts`: Uses `@supabase/ssr` to authenticate users and decode credentials. (Candidate for Auth Adapter).
*   `src/server/storage/supabase.ts`: Binds `StorageDriver` to `@supabase/supabase-js` storage buckets. (Candidate for S3 Adapter).
*   `package.json`: Contains `@supabase/ssr` and `@supabase/supabase-js`.
*   `.env`: Refers to `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_JWT_SECRET`.

---

## 7. PostgreSQL Baseline (From `25_postgres_portability.md`)

*   PostgreSQL is established as the canonical transactional layer.
*   `pgcrypto` extension is installed locally via SQL migrations.
*   **No direct physical dependency on Supabase GoTrue tables was identified in the audited SQL migrations.** The user table maps to the external ID via a logical `auth_user_id` UUID field. The database schema is structurally portable.

---

## 8. Current Engineering Phase
*   **Current Phase**: Phase 7 — Verity Portable Runtime v2.
*   **Immediate Objective**: Decouple the existing Verity application from Vercel and Supabase Cloud services, enabling it to run self-hosted inside Docker containers, while preserving all existing business features.

---

## 9. Phase 7 Workstreams

*   **P0-01: Repository Baseline**: Inventory dependencies (Complete, `24` & `25`).
*   **P0-02: Runtime Configuration**: Abstract environment variables (In Progress, `26`).
*   **P0-03: Containerization**: Write Dockerfiles and `docker-compose.yml`.
*   **P0-04: PostgreSQL Portability**: Establish local DB container configuration.
*   **P0-05: Object Storage Abstraction**: Write standard S3 storage client driver.
*   **P0-06: Authentication Decoupling**: Isolate Supabase Auth behind adapter.
*   **P0-07: Background Worker Abstraction**: Replace Vercel crons with simple queues.
*   **P0-08: Health & Readiness**: Write `/api/health` endpoints.
*   **P0-09: Database Migration**: Run migrations on startup.
*   **P0-10: Backup & Restore**: Script automated pg_dump utilities.
*   **P0-11: Local Enterprise Reference Deployment**: Prepare `deploy/` layout.
*   **P0-12: Acceptance Tests**: Verify end-to-end user flows.

---

## 10. Immediate Task: Runtime Configuration (From `26_runtime_configuration.md`)

Establish a single, validated typed runtime configuration boundary:
*   Define Zod validation schema inside `src/server/platform/config.ts`.
*   Parse `process.env` on initialization and export `runtimeConfig`.
*   Refactor scattered `process.env` reads in `src/proxy.ts`, `src/server/platform/auth.ts`, `src/server/platform/tenancy.ts`, `src/server/storage/supabase.ts`, and `src/app/api/scheduled/route.ts` to consume `runtimeConfig`.
*   Generate `.env.example` showing development, production, and enterprise defaults.
*   Ensure the application fails fast if required configurations are missing.

---

## 11. Critical Sequencing Rules
1.  **Inspect Before Editing**: Always read the referenced files and existing tests before writing code.
2.  **Incremental Refactoring**: Use the strangler/adapter pattern. Keep existing Supabase adapters working as the default configuration option while building new abstraction layers.
3.  **Compile & Test Check**: Execute typecheck sweeps and lint checks at the end of every task before staging commits.

---

## 12. What Claude Code Must NOT Do Yet
*   Do **NOT** introduce Keycloak, Temporal, OpenSearch, Kubernetes, or SeaweedFS containers during this task. Keep the infrastructure focused purely on standard Next.js, Postgres, and Redis.
*   Do **NOT** write a new ORM or replace Prisma.
*   Do **NOT** replace the existing frontend or backend frameworks.

---

## 13. Current Target Architecture

```
                    VERITY ENTERPRISE v2
                    
                     Next.js Web / API
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
      Platform Core                     Domain Engine
            │                                 │
     (Auth/Storage adapters)           (Stock Ledgers)
            │                                 │
     ┌──────┴──────┐                   ┌──────┴──────┐
     ▼             ▼                   ▼             ▼
External IdP    Local S3           PostgreSQL      Redis
 (Keycloak)  (SeaweedFS/MinIO)        Client       (BullMQ)
```

---

## 14. Adapter Strategy
*   **Auth**: The application checks user context via `resolveActor()`. The authentication provider (Supabase Auth/OIDC) must be wrapped inside an identity adapter that maps external tokens to the internal `Principal` profile.
*   **Storage**: Direct file bucket requests are replaced with standard S3 SDK calls inside a `StorageDriver` class, allowing seamless swaps between providers.

---

## 15. Enterprise Readiness Gates
The Portable Runtime is considered mature only if it satisfies all 12 Gates documented in `22_spec_consistency_audit.md`:
1.  *Containerized Deployment*
2.  *PostgreSQL Portability*
3.  *Storage Abstraction*
4.  *Authentication Boundary*
5.  *RBAC Model*
6.  *Tenant Isolation*
7.  *Audit Log*
8.  *Migration Engine*
9.  *Backup/Restore*
10. *Health Checks*
11. *Configuration/Secrets*
12. *Security Baseline*

---

## 16. Documentation Rules
*   All planning, design documents, and implementation logs MUST be stored under `/verity/taskplans/`.
*   Maintain the existing numbering index schema. Do not delete historical logs.

---

## 17. Change Ownership
*   **Antigravity**: Research, planning, orchestration, taskplans, specifications, and post-implementation review.
*   **Claude Code**: Source code refactoring, database migrations, package modifications, local tests, and git commits.
*   **Human Developer**: General oversight and approvals on key architectural pivots.

---

## 18. CLAUDE CODE START HERE

*   **Current Commit SHA**: `e29c5297778509b5e2c29409dc0bbccf0b2ab6dd`
*   **Working Tree State**: Clean.
*   **Immediate Task**: Execute P0-02 Runtime Configuration.
*   **Exact Taskplan**: **[26_runtime_configuration.md](file:///d:/Code/verity/taskplans/26_runtime_configuration.md)**
*   **Constraints**: Preserve current Vercel/Supabase deployment behavior through the new config adapter. Do not rewrite authentication.
*   **Expected Deliverables**:
    1.  `src/server/platform/config.ts` (validated schema client).
    2.  Refactored config calls in `proxy.ts`, `auth.ts`, `tenancy.ts`, `supabase.ts`, and `route.ts`.
    3.  `.env.example` file.
*   **Tests to Run**: `npm run test` (verify that current test suite of 453 tests passes).

---

## 19. Handoff Integrity

| Item | Status |
|---|---|
| Research | Complete |
| Cross-system synthesis | Complete |
| Architecture decisions | Complete |
| Enterprise PRD | Complete |
| Bible v2 | Complete |
| Spec v2 | Complete |
| Implementation roadmap | Complete |
| Runtime baseline | Complete |
| PostgreSQL portability audit | Complete |
| Task 26 planning | Complete |
| **Task 26 implementation** | **Not yet implemented** |
| **Phase 7 P0** | **In progress** |
