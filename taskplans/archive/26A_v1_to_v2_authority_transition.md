# Task Plan 26A — v1 to v2 Authority Transition

This document formally records the technical transition of Verity's canonical architecture and project specification from version 1 (Vercel/Supabase Cloud SaaS) to version 2 (Self-Hosted Enterprise Operations Platform).

---

## 1. Superseded vs. Current Authority Matrix

All new engineering tasks, database adjustments, and configuration alignments MUST conform to the **Current (v2) Authority** baseline. The legacy V1 files are maintained as historical references and must not be used for new design choices.

| Dimension | Legacy (v1) Authority | Current (v2) Authority |
|---|---|---|
| **Platform Constitution**| `verity-bible/` (Historical Reference) | **[19_verity_bible_v2.md](file:///d:/Code/verity/taskplans/19_verity_bible_v2.md)** (Active Law) |
| **System Specification** | `verity-spec/` (Historical Reference) | **[20_verity_spec_v2.md](file:///d:/Code/verity/taskplans/20_verity_spec_v2.md)** (Active Spec) |
| **Decision Register** | `ADR-001` through `ADR-016` (Historical) | **[17A_verity_architecture_decisions.md](file:///d:/Code/verity/taskplans/17A_verity_architecture_decisions.md)** (V2-ADR-* series) |
| **Implementation Plan** | `implementation/` (Historical Reference) | **[21_implementation_roadmap_v2.md](file:///d:/Code/verity/taskplans/21_implementation_roadmap_v2.md)** (Active Roadmap) |
| **Consistency Registry** | — | **[22_spec_consistency_audit.md](file:///d:/Code/verity/taskplans/22_spec_consistency_audit.md)** (Active Gates) |

---

## 2. ADR Namespace Separation

To prevent identifier collisions between the legacy specifications and the new v2 system:
1.  **Legacy Decisions**: Refer strictly to original numbers `ADR-001` through `ADR-016` located in historical spec folders.
2.  **v2 Decisions**: Enforce the prefix namespace **`V2-ADR-001`** through **`V2-ADR-010`** located in the [17A Decisions Register](file:///d:/Code/verity/taskplans/17A_verity_architecture_decisions.md).

---

## 3. Approved Enterprise Core Directives

The following architectural shifts are approved and locked:
*   **Portability (V2-ADR-001)**: Decouple monorepo backend and web builds from Vercel edge functions, targeting Docker containerization.
*   **PostgreSQL Independence (V2-ADR-002)**: Enforce standard local PostgreSQL instead of Supabase Cloud.
*   **Storage Abstraction (V2-ADR-006)**: Route file operations to S3-compatible client wrappers (MinIO/SeaweedFS).
*   **SSO Identity Federation (V2-ADR-003)**: Authenticate clients via OIDC JWT session tokens instead of hard-coupling user records to Supabase GoTrue schema tables.
