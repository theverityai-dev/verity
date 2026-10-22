# Task Plan 17B — Verity Architecture Scorecard

This scorecard provides a quantitative evaluation comparing the current implementation of Verity (Cloud-only, Supabase-centric) against the proposed target architecture (Verity Enterprise v2).

---

## 1. Scoring System
Each metric is graded on a scale of 1 to 5:
*   **1 (Poor)**: Incapable of meeting basic requirements.
*   **2 (Weak)**: Meets requirements with significant workarounds and fragility.
*   **3 (Acceptable)**: Meets requirements; stable but lacks optimization.
*   **4 (Strong)**: Well-designed, highly performant, and maintainable.
*   **5 (Excellent)**: Industry-standard, fully decoupled, and optimized.

---

## 2. Quantitative Evaluation Matrix

| Evaluation Dimension | Current Verity (v1) | Verity Enterprise v2 | Rationale & Key Evidence |
|---|---|---|---|
| **Enterprise Readiness** | 2 | 4.5 | * `v1` lacks corporate SSO (Keycloak) and relies on public cloud accounts.<br>* `v2` abstracts credentials, integrating with corporate federations. |
| **Deployment Portability**| 1 | 5 | * `v1` is locked to Vercel/Supabase hosting.<br>* `v2` runs anywhere via containerized Docker Compose / Helm charts (Plane/ToolJet model). |
| **Security & Isolation** | 3 | 4.5 | * `v1` uses standard table filters.<br>* `v2` implements logical tenant filters (DIGIT/Twenty model) via database middleware. |
| **Multi-Tenancy Scope** | 2.5 | 4 | * `v1` is basic multi-tenant.<br>* `v2` supports spatial hierarchies (HQ -> region -> site) scoping. |
| **Workflow Flexibility** | 2 | 4.5 | * `v1` has hardcoded statuses.<br>* `v2` implements a central decoupled workflow state engine (DIGIT/Temporal model). |
| **Extensibility (Custom Fields)**| 1.5 | 4 | * `v1` requires running SQL migrations to alter tables.<br>* `v2` implements JSONB `additionalDetails` fields (DIGIT Works model). |
| **Auditability & Provenance** | 2 | 4.5 | * `v1` lacks change logging.<br>* `v2` features an append-only `AuditLog` table (ERPNext transaction model). |
| **Storage Portability** | 2 | 4.5 | * `v1` is locked to Supabase Storage API.<br>* `v2` uses standard AWS SDK S3 wrappers (SeaweedFS model). |
| **Search Performance** | 2.5 | 4 | * `v1` runs basic Prisma queries.<br>* `v2` optimizes lookups using PostgreSQL `pg_trgm` indexes (Twenty model). |
| **Observability & Health** | 1 | 4 | * `v1` relies on Vercel Cloud dashboards.<br>* `v2` exposes structured logging and Prometheus metrics. |
| **Upgradeability & Rollback** | 1.5 | 4 | * `v1` lacks automated schema check migrations on start.<br>* `v2` embeds automatic Prisma migrations in the Docker entrypoint. |
| **Integration Capability** | 2 | 4.5 | * `v1` mixes API requests with business logic.<br>* `v2` abstracts external platforms behind dedicated adapters. |
| **Operating Cost (MSME)** | 4 | 4.5 | * `v1` requires paid hosting for private databases.<br>* `v2` runs on cheap, single-VM setups via lightweight Docker containers. |
| **Implementation Complexity**| 5 | 3.5 | * `v1` is extremely fast to build using SaaS APIs.<br>* `v2` requires decoupling interfaces, adding setup friction for developers. |

### Summary Score:
*   **Current Verity (v1)**: **32.0 / 70**
*   **Verity Enterprise v2**: **61.0 / 70**
