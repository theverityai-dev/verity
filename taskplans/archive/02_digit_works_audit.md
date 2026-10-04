# Audit 01 — DIGIT Works (egovernments/digit-works)

**Current Status**: Complete
**Audit Snapshot**: Commit `5767379` (Branch: `master`)
**License**: MIT License
**Primary Research Goal**: Understand how to build modular, API-first public-sector registries and project/work workflows at national scale.

---

## 1. Product Model & Objectives

### Target Users & Buyers
*   **Target Users**: Junior Engineers (JE), Assistant Engineers (AE), Executive Engineers (EE), Contractors (Vendors), and Wage Workers.
*   **Buyers**: State Urban Development Departments, Municipal Corporations, and Urban Local Bodies (ULBs).

### Problems Solved
*   **Leakage in Public Works Execution**: Preventing ghost workers, inflated estimates, and unverified physical measurements.
*   **Disparate Municipal Systems**: Unifying estimates, contract issuance, worker logs (muster rolls), physical measurements, and vendor payments into a single interoperable platform.
*   **Lack of Auditability**: Providing a transparent, cryptographically sound ledger of who sanctioned which budget, when, and based on what physical criteria.

### Major Use Cases
1.  **Estimate Proposal & Sanctioning**: Creating engineering estimates, mapping items of work to standardized Rate Lists (SOR - Schedule of Rates), and routing them through Technical and Administrative sanctions.
2.  **Contract (Work Order) Awarding**: Bundling sanctioned estimate line items into formal contracts, mapping them to registered contractors, and allocating financial codes.
3.  **Muster Roll Logging**: Registering wage workers, tracking daily attendance at worksites (via mobile application with geo-coordinates/photo), and computing weekly wages.
4.  **Measurement Book (MB) Entry**: Recording physical dimensions of work completed (e.g. cubic meters of concrete poured) and verifying they map exactly to contract rates.
5.  **Bill & Payment Vouchering**: Calculating invoice totals based on MB inputs, deducting taxes/security deposits, and routing to treasuries for Direct Benefit Transfer (DBT).

---

## 2. Repository Map & Codebase Anatomy

The repository follows a clean multi-module microservice layout:

*   **`backend/`**: Contains independent Java Spring Boot microservices, including:
    *   `estimates/`: Core service managing work estimates and technical/administrative sanctions.
    *   `contracts/`: Handles agreement execution, vendor mappings, and work orders.
    *   `attendance/` & `muster-roll/`: Manages worker registries, daily log sheets, and weekly wage calculations.
    *   `measurement-registry/` & `measurement-service/`: Encapsulates physical measurement books.
    *   `organisation/`: Registry for contractor profiles, licenses, and bank details.
*   **`frontend/`**: Contains React-based micro-frontend applications (`frontend/micro-ui/`) that compile into localized, mobile-responsive web packages.
*   **`reference-adapters/`**: Integrations to interface DIGIT Works with state treasuries, payment gateways, and banking systems.

---

## 3. Technical Architecture & Dataflow

DIGIT Works relies on an event-driven, decoupled microservices model powered by Apache Kafka and PostgreSQL.

```
                     DIGIT WORKS ARCHITECTURE
                     
     ┌───────────────────┐
     │    React Web /    │
     │     Mobile UI     │
     └─────────┬─────────┘
               │ HTTP REST
               ▼
     ┌───────────────────┐
     │   APIGateway /    │
     │   Access Control  │
     └─────────┬─────────┘
               │
      ┌────────┴──────────────────────────────┐
      ▼ (Synch / Validation)                  ▼ (Asynch Write)
┌─────────────┐                         ┌─────────────┐
│  Domain     │ ──[Produces Kafka]───>  │    Kafka    │
│  Services   │                         │    Bus      │
│ (Estimates) │                         └──────┬──────┘
└─────────────┘                                │
                                               ▼
                                        ┌─────────────┐
                                        │    egov-    │
                                        │  persister  │
                                        └──────┬──────┘
                                               │ Writes
                                               ▼
                                        ┌─────────────┐
                                        │ PostgreSQL  │
                                        │  Database   │
                                        └─────────────┘
```

### Key Architectural Primitives:
1.  **Synchronous API Validation**: Services receive requests, perform schema checks against Master Data (MDMS), and return immediate transaction receipts.
2.  **Asynchronous Persistence**: Database writes do not block thread execution. Instead, the service publishes serialized payloads to specialized Kafka topics (e.g. `save-estimate`). A separate background consumer (`egov-persister`) reads these topics and executes the actual SQL writes to PostgreSQL.
3.  **Read/Write Segregation**: Heavy read requests (dashboard charts, citizen search portals) query Elasticsearch indices populated by `egov-indexer` monitoring Kafka transactions, keeping PostgreSQL free of read locks.

---

## 4. Domain & Data Architecture

### DB Schema Patterns (From `eg_wms_contract` analysis)
*   **No Relational Contamination**: Foreign keys to global objects like `org_id` are stored as plain strings. There are no relational joins across distinct microservice databases.
*   **Dynamic Custom Fields (`additional_details` JSONB)**: Instead of mutating the database schema or using auxiliary vertical tables to add customized variables, every table includes a `JSONB` column.
*   **Epoch-based Timestamps**: Created and modified times are stored as `bigint` milliseconds rather than database timestamps, eliminating driver-level timezone bugs.
*   **Database Migrations**: Managed via Flyway SQL migration files inside each service package.

---

## 5. Identity & RBAC Model
*   **Centralized IAM (`egov-user`)**: Identity is fully externalized. User accounts, organizational memberships, and authorization tokens reside in the global identity system.
*   **Action-based Authorizations**: Roles (e.g. `JUNIOR_ENGINEER`) map to specific API endpoints and actions. An engineer can create an estimate only if their active token carries the necessary permissions.
*   **Spatial Tenancy Scopes**: Permission scopes are tied to spatial codes (e.g., `pg.amritsar` representing the Amritsar municipality tenant). Access control rules filter records using the `tenant_id` column.

---

## 6. Workflow Engine (`egov-workflow-v2`)
*   **Decoupled Workflow State**: Domain services like `estimates` or `contracts` do not manage internal state transitions.
*   **Centralized State Machines**: State configurations (roles allowed to advance, target states, automated events) are defined centrally.
*   **API Interception**: When an estimate is updated, the service sends a transition payload to the workflow service. The workflow service validates whether the active user possesses the clearance to move the state from `TECHNICAL_SANCTIONED` to `APPROVED` and records the transition in a central audit table.

---

## 7. Storage, Search & Auditing

### Storage
*   **Object Abstraction**: Relies on a unified `filestore-service`.
*   **Identifier Referencing**: Invoices, blueprint drawings, and measurement photographs are uploaded to the file store. Transaction records only save the generated `filestore_id` (a UUID reference).

### Search & Analytics
*   **Elasticsearch Indexing**: Payload events published on Kafka are picked up by `egov-indexer`, mapped to custom index templates, and pushed to Elasticsearch/OpenSearch.
*   **Optimized Queries**: Dashboard UI components call a search service that queries the search index rather than hitting SQL tables directly.

### Auditing & Observability
*   **Request Signatures**: Every API call includes a `RequestInfo` header containing authentication details, session logs, and client IP metadata.
*   **Change Log Provenance**: Every record has `created_by`, `last_modified_by`, `created_time`, and `last_modified_time` audit tracking columns.

---

## 8. Verity Relevance & Verdict

### ADOPT
*   **JSONB Custom Fields (`additional_details` column)**: Integrate this exact pattern into Verity's Postgres database schemas. Instead of adding custom vertical column tables for new plywood metrics or hardware traits, serialize them inside a standard `JSONB` field.
*   **BigInt Epoch Timestamps**: Standardize all date-time stamps in database tables to UTC epoch-millisecond `bigint` fields to prevent localized database engine timezone mismatches.

### ADAPT
*   **Decoupled Workflow Model**: Adapt DIGIT's centralized workflow architecture. Verity should separate business state transitions (e.g. `DRAFT` -> `APPROVED` -> `DISPATCHED`) from domain services, keeping them governed by a central state machine.
*   **Unified File Store Referencing**: Replace local file path storage with an object referencing abstraction (`fileId` UUIDs) in database records.

### INSPIRE
*   **Separation of Master Data (MDMS)**: Conceptualize the distinction between transactional records (orders, stock) and master configuration registries (tax tables, unit divisions) to keep database tables lean.

### REJECT
*   **Extreme Microservice Fragmentation**: Reject dividing Verity into 15+ separate Java Spring Boot microservices. For the ₹10L–₹1Cr deployment scale, running 15 Java VMs requires excessive memory resources (>64GB). Verity will remain a unified, monorepo backend running in a single Docker container.
*   **Heavy Kafka Dependencies for Writes**: Reject using Kafka for standard CRUD persistence. Plain Prisma transactions in PostgreSQL are far simpler to operate, backup, and restore for mid-market clients.

### DEFER
*   **Elasticsearch Read Indexes**: Defer pushing read operations to OpenSearch. Standard PostgreSQL indexes are sufficient for our immediate transactional volume, and introducing Elasticsearch adds significant infrastructure overhead.

---

## 9. Proposed Verity Changes

```
                     VERITY WORKFLOW REFACTOR
                     
  [ Old Model ]
  Order Object ──> Mutates its own status field directly.
  
  [ New Model (Adapted from DIGIT) ]
  Order Action ──> WorkflowEngine (Validates Roles & Transition Rules)
                         │
                         ▼
  Order Object ──> Updates status (With Audit log entry generated)
```

1.  **Prisma Schema Additions**: Add an `additionalDetails Json` field to all product, order, and location models to enable zero-migration customization.
2.  **UTC BigInt Conversion**: Move db date-times to `BigInt` epochs.
3.  **Workflow State Abstraction**: Extract order status tracking to a centralized state machine config module rather than embedding hard-coded state checks inside business route files.
