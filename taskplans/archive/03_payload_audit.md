# Audit 02 — Payload CMS (payloadcms/payload)

**Current Status**: Complete
**Audit Snapshot**: Commit `72ee175` (Branch: `main`)
**License**: MIT License
**Primary Research Goal**: Learn how to build an extensible, schema-driven application builder and access-control engine natively inside the Next.js App Router ecosystem.

---

## 1. Product Model & Objectives

### Target Users & Buyers
*   **Target Users**: Full-stack TypeScript/JavaScript developers, system architects, and content managers.
*   **Buyers**: Mid-market agencies, tech startups, and enterprise product teams looking to build customized admin dashboards and Node.js backend systems rapidly.

### Problems Solved
*   **Boilerplate Admin Panel Customization**: Automating the creation of React-based admin portals, forms, and data tables.
*   **API Prototyping Overhead**: Instantly generating secure REST and GraphQL endpoints for user-defined business models.
*   **Extensibility Gaps**: Providing a unified interface to extend database schemas, inject validation hooks, and manage media storage from a single configuration file.

### Major Use Cases
1.  **Headless API Backend**: Deploying a TypeScript service that auto-generates database schemas, collections, relationships, and validation routines.
2.  **Enterprise Content Hub**: Serving localized assets, multi-tenant documentation, and draft/versioned corporate pages.
3.  **B2B App Foundation**: Providing the core authentication, RBAC, media upload, and relational schema layer for bespoke business portals.

---

## 2. Repository Map & Codebase Anatomy

Payload is managed as a `pnpm` monorepo:

*   **`packages/payload/`**: The core package holding the local API engine, validation rules, hook runners, and abstract database adapters.
*   **`packages/next/`**: The adapter that binds Payload's router, admin view components, and server endpoints directly into the Next.js App Router framework.
*   **`packages/db-*/`**: Pluggable database layers (e.g., `db-postgres` built using Drizzle ORM, `db-sqlite`, and `db-mongodb`).
*   **`packages/storage-*/`**: Storage adapters to sync files to S3, Google Cloud Storage, Cloudflare R2, or Azure Blob.
*   **`packages/ui/`**: Core React/TypeScript component library rendering the admin dashboard screens.

---

## 3. Technical Architecture & Dataflow

Payload is fully integrated into the Next.js execution lifecycle:

```
                      PAYLOAD NEXT.JS LIFECYCLE
                      
      Next.js Request ──> App Router Route Handler (e.g., /api/graphql)
                                  │
                                  ▼
      Payload Core Initialisation (reads config & attaches DB Adapter)
                                  │
      ┌───────────────────────────┴───────────────────────────┐
      ▼ (Database Write Ops)                                  ▼ (Hooks & Auth check)
┌─────────────┐                                         ┌─────────────┐
│  Drizzle    │                                         │ Collection  │
│  Adapter    │                                         │ beforeChange│
└──────┬──────┘                                         └──────┬──────┘
       │ Writes SQL                                            │ Runs Validation
       ▼                                                       ▼
┌─────────────┐                                         ┌─────────────┐
│ PostgreSQL  │                                         │ Exec Action │
└─────────────┘                                         └─────────────┘
```

---

## 4. Domain & Data Architecture

### Declarative Schema System
*   **Dynamic Collections Configuration**: Databases are configured using arrays of collections (e.g. `Pages`, `Posts`, `Orders`), which define fields (text, number, json, relationships) as a TypeScript object tree.
*   **Database Translation via Adapters**: The config is fed into the selected database adapter. In `db-postgres`, fields are translated into Drizzle schemas, mapping relationship fields into foreign keys, join tables, or junction records.
*   **Implicit Versioning & Drafts**: Payload implements drafts and versioning by creating companion shadow tables (e.g., `_posts_v`) that record audit history and differential edits without cluttering transactional records.

---

## 5. Identity & RBAC Model
*   **Native Session & Token Handlers**: Built-in support for cookie-based authentication, JWT verification, and API key management.
*   **Granular Access Control**: Access rules are defined per collection and per field using boolean-returning functions or PostgreSQL search condition objects:
    ```typescript
    access: {
      read: ({ req }) => req.user.role === 'admin',
      update: ({ req }) => ({ owner: { equals: req.user.id } }),
    }
    ```
*   **Field-Level Policies**: Access controls can target specific attributes (e.g., a customer can view an order but only an accountant can read the `profitMargin` field).

---

## 6. Workflow Engine (Hooks Model)
*   **Sync/Async Lifecycle Hooks**: Provides callbacks (`beforeValidate`, `beforeChange`, `afterChange`, `beforeDelete`, `afterDelete`) executed during database mutations.
*   **Mutative Payload Manipulation**: Hooks can modify the incoming record body, compute dynamic properties, send notification alerts, or execute ledger audits.

---

## 7. Storage, Search & Auditing

### Storage
*   **Upload Collections**: Supports native file collections. Storing files auto-generates size, width, height, mime-type, and thumbnail metadata.
*   **Pluggable Buckets**: Plugs directly into S3-compatible endpoints via storage plugins.

### Search
*   **Structured Search Index**: Integrates search capability through a plugin that syncs selected database records into a single consolidated `search` index table for rapid autocomplete querying.

### Auditing
*   **Traceable Sessions**: API operations capture the authenticating user and write details directly into history logs.

---

## 8. Verity Relevance & Verdict

### ADOPT
*   **Declarative Collection Schema Concept**: Adopt the approach of representing transactional resources (Products, Location entries) as structured configurations, generating schemas dynamically.
*   **Local API Utility Wrapper**: Provide a local API wrapper inside Verity (similar to Payload's `payload.find()` or `payload.create()`) that allows server-side operations to bypass HTTP roundtrips.

### ADAPT
*   **Document & Field-Level Access Control Rules**: Adapt Payload's access check signature. Verity should allow roles and ownership validations to target specific fields on the order or product schemas dynamically.
*   **Shadow Table Versioning**: Use a secondary shadow-table architecture for recording audit histories of invoices and transactions.

### INSPIRE
*   **Next.js Native Admin Integration**: Harness the design pattern of mounting admin dashboards directly within Next.js routing files, avoiding separate frontend deployment pipelines.

### REJECT
*   **Multi-DB Adapter Overhead**: Reject building multiple database adapters (MongoDB, SQLite, Postgres). For Verity, we enforce PostgreSQL as our single, canonical persistent relational engine to maximize the efficiency of raw SQL/Prisma operations.

### DEFER
*   **Lexical Rich-Text Editor Packages**: Defer importing complex editor platforms. Standard Markdown tables and standard text areas are sufficient for Verity's current operational requirements.

---

## 9. Proposed Verity Changes

```typescript
// Proposed Verity Database Resource Access Hook Contract
export interface VerityAccessRule {
  read?: (args: { user: User; record: any }) => boolean | Promise<boolean>;
  update?: (args: { user: User; record: any; data: any }) => boolean | Promise<boolean>;
}
```

1.  **Abstract SQL Execution Layer**: Wrap Prisma client calls in an access checking interface that verifies field-level security before executing the database transactions.
2.  **Define Static Local Client**: Instantiate a server-only Verity Context helper to allow direct background database updates during imports and task queues.
