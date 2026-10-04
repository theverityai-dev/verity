# Task Plan 17 — Verity Gap Analysis

This document provides an architectural gap analysis comparing Verity's current codebase status against the preferred enterprise patterns identified in the R&D research.

---

## 1. Structured Gap Analyses

### ARCHITECTURAL GAP: Portability & Cloud Indirection
*   **Research Evidence**: Mature self-hosted systems (Plane, Payload, Formbricks) allow complete execution on standard VMs using PostgreSQL, Redis, and local config files.
*   **Best / Preferred Pattern**: Complete containerized deployment independent of third-party cloud platform services.
*   **Current Verity State**: Hard dependency on Supabase Cloud (for Auth database tables and Storage buckets) and Vercel hosting.
*   **Gap**: High (Architectural decoupling required).
*   **Risk**: Cannot deploy Verity inside secure PSU, corporate, or airport networks that forbid external internet traffic.
*   **Decision**: Decouple Supabase-specific Auth and Storage APIs, substituting them with generic PostgreSQL and S3-compatible interfaces.
*   **Priority**: P0
*   **Required Specification Change**: Production deployments MUST execute inside a containerized environment (Docker Compose) without calling Supabase Cloud servers.

---

### SECURITY GAP: Enterprise Identity Boundary
*   **Research Evidence**: Enterprise platforms (Keycloak) manage credentials, LDAP syncing, and user federation centrally, passing JWT tokens to client applications.
*   **Best / Preferred Pattern**: Federated authentication (SSO) using OpenID Connect (OIDC) tokens.
*   **Current Verity State**: Local authentication schema linked to Supabase Auth tables.
*   **Gap**: Medium-High
*   **Risk**: Enterprise clients will reject the software if it requires managing a separate database of employee passwords.
*   **Decision**: Abstract the auth interface, adding support for external OIDC token validation.
*   **Priority**: P0
*   **Required Specification Change**: Verity MUST support validating user sessions using cryptographically signed JWT tokens issued by external IDPs (Keycloak/Azure AD).

---

### DEPLOYMENT GAP: Portable Containerization
*   **Research Evidence**: Plane, ToolJet, and Formbricks include official Dockerfiles and `docker-compose.yml` blueprints in their main repository folders.
*   **Best / Preferred Pattern**: Single-command container assembly (`docker compose up`) bootstrapping all application layers.
*   **Current Verity State**: No Docker configurations are present in the codebase.
*   **Gap**: High
*   **Risk**: Installation requires manual environment configurations, increasing setup errors.
*   **Decision**: Write a multi-stage Dockerfile compiling Next.js and bundle it in Docker Compose.
*   **Priority**: P0
*   **Required Specification Change**: The repository MUST contain a working Docker Compose configuration file setup.

---

### DATA GAP: Immutable Inventory Logging
*   **Research Evidence**: ERPNext records every stock movement in an immutable ledger table (`tabStock Ledger Entry`), ensuring complete audit trails.
*   **Best / Preferred Pattern**: Inventory balances are calculated dynamically from immutable transaction ledgers.
*   **Current Verity State**: Mutates stock values directly in product rows.
*   **Gap**: Medium-High
*   **Risk**: Cannot audit historical stock counts or trace inventory leaks.
*   **Decision**: Implement a `StockLedgerEntry` model in Prisma.
*   **Priority**: P0
*   **Required Specification Change**: Stock counts MUST be computed by aggregating transaction records; direct mutations to stock balances are forbidden.

---

### OPERATIONS GAP: Custom Fields and Schema Extensions
*   **Research Evidence**: DIGIT Works implements `additional_details` JSONB columns to store dynamic metrics without mutating database structures.
*   **Best / Preferred Pattern**: Dynamic variables stored in JSONB columns, validated at the API boundary using schema validation engines (Zod).
*   **Current Verity State**: Adding product dimensions or custom fields requires modifying Prisma schemas and running SQL migrations.
*   **Gap**: Medium
*   **Risk**: Database migration errors during upgrades on client servers.
*   **Decision**: Add an `additionalDetails Json` field to all product, order, and location models.
*   **Priority**: P0
*   **Required Specification Change**: Schema models MUST contain a generic JSONB column to support client-specific data extensions.

---

## 2. Gap Classification (P0–P3)

### 🔴 P0: Architecture Blockers
*   **Containerization**: Multi-stage Docker packaging.
*   **Cloud Decoupling**: Removing hard dependencies on Supabase Cloud.
*   **Storage Abstraction**: Implementing an S3-compatible client wrapper.
*   **SSO Auth Integration**: Supporting external JWT validation.
*   **Dynamic JSONB Fields**: Zero-migration schema extensions.
*   **Immutable Stock Ledger**: Moving to transaction-based stock tracking.

### 🟡 P1: Enterprise Capability
*   **Central State Machine**: Decoupling order status checking from routes.
*   **Redis Background Queues**: Using BullMQ to handle notifications and emails.
*   **Database Backup Utilities**: Scripting pg_dump schedules.

### 🟢 P2: Vertical Scale
*   **Logistics Pack**: Shipment logs and lorry receipt registers.
*   **PSU Works Pack**: Municipal project estimates and billing approvals.

### 🔵 P3: Optimization
*   **Postgres Materialized Views**: Speeding up dashboard aggregations.
*   **Trigram Indexing**: Optimizing search fields.

---

## 3. Things We Will NOT Build
To prevent scope creep, Verity will explicitly delegate the following capabilities to external, pre-existing tools rather than writing custom code:

1.  **Identity Registry**: Verity will NOT write LDAP sync modules or credential databases. Central user directories remain Keycloak or active directory servers.
2.  **Object Storage Engine**: Verity will NOT write a file storage database. It will connect to external S3-compliant engines (MinIO/SeaweedFS).
3.  **Search Cluster Indexer**: Verity will NOT embed an Elasticsearch cluster. Instant search will be handled locally in PostgreSQL using `pg_trgm` indexes.
4.  **Durable Workflow Orchestrator**: Verity will NOT write a persistent state tracker similar to Temporal. BullMQ and transactional SQL history tables are sufficient.
