# Task Plan 15 — Architecture Pattern Catalogue

This catalog documents the key architectural design patterns extracted from the 12 R&D repository audits. Each pattern outlines the core problem, observed implementations, tradeoffs, and recommendations for Verity Enterprise.

---

## P-001: Logical Tenant Isolation
*   **Problem**: Storing multi-tenant business data securely without the cost and management complexity of maintaining thousands of isolated database instances.
*   **Observed Implementations**:
    *   `[OBSERVED]` **DIGIT**: Injects a spatial `tenantId` (e.g., `pg.amritsar`) in every database table query.
    *   `[OBSERVED]` **Twenty**: Maps database queries via Prisma middleware to enforce `workspaceId` parameters.
*   **Tradeoffs**:
    *   *Pros*: Extremely simple to scale, deploy, backup, and upgrade since all clients share the same database schema.
    *   *Cons*: Risk of cross-tenant data leaks if an engineer forgets to append `tenantId` parameters to custom raw SQL queries.
*   **Verity Recommendation**: Implement logical isolation via Prisma tenant context middleware. Enforce a non-nullable `tenantId` field on all client schemas.

---

## P-002: Spatial Organization Boundaries
*   **Problem**: Restricting staff access to specific physical sites (yards, godowns, or branches) under the same tenant account.
*   **Observed Implementations**:
    *   `[OBSERVED]` **DIGIT Works**: Ties user profiles to specific department and municipal organization boundaries.
    *   `[OBSERVED]` **Plane**: Scopes project details under isolated workspace teams.
*   **Tradeoffs**:
    *   *Pros*: Prevents yard managers from modifying stock ledger transfers or orders belonging to sibling branches.
    *   *Cons*: Adds mapping tables (User-to-Organization relationships) and requires nested joins for global reporting.
*   **Verity Recommendation**: Connect users to organizations/locations via a `TenantMembership` model. All queries targeting stock balances and orders must join the user's active membership location scope.

---

## P-003: Dynamic Custom Fields (`additional_details` JSONB)
*   **Problem**: Allowing clients to add custom properties to products, invoices, or orders without running SQL migrations that risk database downtime.
*   **Observed Implementations**:
    *   `[OBSERVED]` **DIGIT Works**: Tables like `eg_wms_contract` contain an `additional_details` JSONB column.
    *   `[OBSERVED]` **Twenty**: Uses dynamic columns backed by database schema configuration entries.
*   **Tradeoffs**:
    *   *Pros*: Zero-migration schema updates. Custom values are written immediately.
    *   *Cons*: Database engines cannot enforce data-type validation (string, number, date) at the SQL engine level.
*   **Verity Recommendation**: Adopt the `additionalDetails Json` column pattern across all tables. Use Zod schemas in Nest/Next APIs to validate type safety at the application boundary before write.

---

## P-004: Decoupled Workflow State Machine
*   **Problem**: Hard-coding status transitions (e.g. order goes from `draft` -> `packed` -> `shipped`) makes customization difficult when bidding on different tenders.
*   **Observed Implementations**:
    *   `[OBSERVED]` **DIGIT**: Uses `egov-workflow-v2` to process states out-of-band.
    *   `[OBSERVED]` **Plane**: Maps issue progress dynamically using custom workspace-specific dictionaries.
*   **Tradeoffs**:
    *   *Pros*: Core business routes remain clean. State validations and alerts are handled by a single configuration.
    *   *Cons*: Increases code complexity; requires fetching active workflows before running updates.
*   **Verity Recommendation**: Extract state checks into a centralized `WorkflowEngine` configuration file. Route state transition requests through validation interceptors.

---

## P-005: S3-Compatible Storage Abstraction
*   **Problem**: Storing PDF invoices, signatures, or physical photographs in local file systems breaks container scalability in cluster nodes (Kubernetes).
*   **Observed Implementations**:
    *   `[OBSERVED]` **SeaweedFS**: Exposes standard S3 HTTP/gRPC interfaces.
    *   `[OBSERVED]` **Payload**: Uses pluggable cloud storage client modules.
*   **Tradeoffs**:
    *   *Pros*: Perfect portability. Apps can run on-premise using MinIO/SeaweedFS or cloud using AWS S3 with no code changes.
    *   *Cons*: Requires running a secondary storage server in Docker environments.
*   **Verity Recommendation**: Standardize file uploads using `@aws-sdk/client-s3`, storing a generated `fileId` UUID in database records.

---

## P-006: Asynchronous Job Offloading (BullMQ + Redis)
*   **Problem**: Executing slow operations (like building billing PDFs, generating analytics, or sending notifications) during HTTP request cycles delays page responses.
*   **Observed Implementations**:
    *   `[OBSERVED]` **Twenty**: Offloads background transactions via BullMQ on Redis.
    *   `[OBSERVED]` **Plane**: Uses Celery worker containers.
*   **Tradeoffs**:
    *   *Pros*: Instant response times for users; failed jobs can retry automatically in the background.
    *   *Cons*: Requires hosting and managing Redis alongside the database.
*   **Verity Recommendation**: Use Redis queues (BullMQ/ioredis) to execute background tasks asynchronously. Keep the Next.js process focused purely on responding to user HTTP actions.
