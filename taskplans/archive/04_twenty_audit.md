# Audit 03 — Twenty CRM (twentyhq/twenty)

**Current Status**: Complete
**Audit Snapshot**: Commit `c77378bb` (Branch: `main`)
**License**: AGPL-3.0 License (Core)
**Primary Research Goal**: Understand how a modern enterprise CRM structures dynamic relational entities, custom field schemas, and Redis-backed background queues in an Nx monorepo.

---

## 1. Product Model & Objectives

### Target Users & Buyers
*   **Target Users**: Sales representatives, account managers, developers, and data administrators.
*   **Buyers**: Mid-market startups and SMBs looking for a highly customizable, open-source alternative to Salesforce.

### Problems Solved
*   **Rigid CRM Data Structures**: Making relational schemas dynamically extensible (adding contacts, companies, opportunities, and linking them via custom relations without manual SQL schema rewrites).
*   **Siloed Communications**: Unifying email, calendar feeds, activities, and notes into centralized timelines.
*   **Vendor Lock-in**: Providing a self-hostable, developer-friendly backend stack that can be containerized.

### Major Use Cases
1.  **Lead & Opportunity Management**: Defining kanban pipelines for deals, linking contacts, and calculating values.
2.  **Contact & Account Directory**: Creating unified profiles for client organizations and individual contacts.
3.  **Custom Object Orchestration**: Extending the CRM core with dynamic objects (e.g. tracking "Vehicles" or "Property Units") that inherit default relationships.

---

## 2. Repository Map & Codebase Anatomy

Managed as a monorepo (Nx workspace):

*   **`packages/twenty-chrome-extension/`**: Client browser extension for CRM clipping.
*   **`packages/twenty-emails/`**: Worker modules handling transactional and inbound email sync.
*   **`packages/twenty-front/`**: React-based Single Page Application (SPA) with styled Tailwind design.
*   **`packages/twenty-server/`**: NestJS backend server organizing database schemas, GraphQL APIs, and queue dispatchers.
*   **`packages/twenty-shared/`**: Common TypeScript models, validators, and helper libraries.

---

## 3. Technical Architecture & Dataflow

Twenty uses a modern NestJS + React SPA architecture:

```
                      TWENTY CRM DATAFLOW
                      
    React App (Front) ──> NestJS GraphQL/REST API (Server)
                                  │
         ┌────────────────────────┴────────────────────────┐
         ▼ (Transactional SQL)                             ▼ (Asynch Worker)
   ┌───────────┐                                     ┌───────────┐
   │ Prisma /  │                                     │  BullMQ   │
   │ Drizzle   │                                     │  Queue    │
   └─────┬─────┘                                     └─────┬─────┘
         │                                                 │
         ▼                                                 ▼
   ┌───────────┐                                     ┌───────────┐
   │PostgreSQL │                                     │  Redis    │
   │ Database  │                                     │   Cache   │
   └───────────┘                                     └───────────┘
```

---

## 4. Domain & Data Architecture

### Metadata-Driven Schema Engine
*   **Static vs. Dynamic Schema**: Twenty splits its database into two namespaces:
    1.  *Standard Objects*: Core tables defined via standard migrations (users, workspaces, metadata tables).
    2.  *Dynamic Objects*: Tables generated dynamically based on configuration rows stored in metadata tables.
*   **Workspaces & Relational Fields**: Field additions (e.g. adding a custom phone number to a contact) update a metadata catalog. The system then dynamically executes Drizzle schema updates or uses Postgres metadata reflections to expose the fields on GraphQL.
*   **Soft Deletes & UUIDs**: Enforces soft deletion via `deletedAt` timestamps. Primary keys are canonical `uuid` strings.

---

## 5. Identity & RBAC Model
*   **Workspace Level Partitioning**: Multi-tenancy is enforced at the database query level using a workspace identifier (`workspaceId`). All requests carry a workspace context context-header.
*   **Granular Object-Level Permissions**: Access is checked via NestJS interceptors matching the request scope (User, Workspace Admin, System) to dynamic policy rules.

---

## 6. Workflow Engine (BullMQ Jobs)
*   **Asynchronous Job Offloading**: Long-running workflows (email sync, third-party webhook dispatch, bulk imports) are managed via **BullMQ** running on **Redis**.
*   **Retry & Failure Resiliency**: Workflows support automatic backoff retries, concurrency constraints, and dead-letter queues (DLQ) for failed integrations.

---

## 7. Storage, Search & Auditing

### Storage
*   **Abstract Storage Adapter**: Pluggable storage providers handle file attachments. Local filesystem is used for dev, while S3 handles production.

### Search
*   **Database Search with Trigrams**: Uses PostgreSQL pg_trgm extension for full-text search across contacts and custom fields rather than requiring Elasticsearch/OpenSearch at startup.

### Auditing
*   **Activity Ledger**: Captures events (e.g., "Contact created") and writes them into a unified audit trail table (`activity_targets` / `activities`).

---

## 8. Verity Relevance & Verdict

### ADOPT
*   **PostgreSQL Trigram Search**: Adopt PostgreSQL `pg_trgm` indexes for search across products and clients. This avoids the need for Elasticsearch/OpenSearch while keeping search fast.
*   **Workspace Schema Isolation**: Partition workspace tenants logically via query interceptors injecting the tenant context.

### ADAPT
*   **BullMQ Job Abstraction**: Adapt Redis-backed queues for asynchronous processing (like dispatching SMS delivery notifications or processing large XML inventory imports).
*   **Activity Timeline Concept**: Adapt the centralized activity log model to record invoice status edits and stock transfers.

### INSPIRE
*   **Metadata-Driven Schema Construction**: Study how Twenty exposes dynamic fields through GraphQL schema builders.

### REJECT
*   **GPL/AGPL Licensing Gaps**: Reject using Twenty's source code directly due to AGPL restrictions. All design patterns must be clean-room implemented in Verity.

### DEFER
*   **Chrome Extension Clippings**: Defer building separate extensions for Verity.

---

## 9. Proposed Verity Changes

1.  **Redis Integration**: Add Redis configuration to the docker compose stack to support job queues.
2.  **Define Queue Service**: Implement a light queue runner in Next.js using `ioredis` and a worker thread to handle background emails and stock sync tasks without blocking HTTP server responses.
