# Verity Enterprise Research Program — Master Control Ledger

This document serves as the central control ledger for the **Verity Enterprise Research Program**. It coordinates the reverse-engineering of mature open-source solutions to establish a robust, deployable core architecture and custom vertical pack model for high-ticket tenders.

---

## 1. Core Objectives
1.  **Extract Architectural Knowledge**: Identify patterns for B2B multi-tenancy, RBAC, durable state workflows, and self-hosted deployability.
2.  **Define Portability Rules**: Map out how to remove cloud-provider lock-in (Vercel/Supabase) from core database models.
3.  **Construct Pattern Catalog**: Establish standardized designs for audit logging, SSO federations, S3 object storage APIs, and background job queues.
4.  **Produce vNext Specification**: Formulate the upgraded **Verity Bible v2** and **Verity Spec v2** based on empirical research findings.

---

## 2. Research Program Pipeline
Every target repository must travel through the following phases in absolute, linear sequence. **No features are to be coded into Verity during the research phase.**

```
Phase 1: Acquire & Freeze (Complete)
    │
    ▼
Phase 2: Reverse Engineer (14 Audits per Archetype)
    │
    ▼
Phase 3: Individual PRDs (taskplans/02_*_audit.md)
    │
    ▼
Phase 4: Cross-System Synthesis (taskplans/14_* to 17_*)
    │
    ▼
Phase 5: Verity Bible v2 (taskplans/19_verity_bible_v2.md)
    │
    ▼
Phase 6: Verity Spec v2 (taskplans/20_verity_spec_v2.md)
    │
    ▼
Phase 7: Implementation Roadmap (taskplans/21_implementation_roadmap_v2.md)
```

---

## 3. Prioritized Repository Ledger

| Codebase ID | Repository Name | Priority | Current Status | Target Location |
|---|---|---|---|---|
| **01-digit-works**| `egovernments/digit-works` | P0 | Cloned / Frozen | `d:\Code\R&D\digit-works` |
| **02-payload**    | `payloadcms/payload` | P0 | Cloned / Frozen | `d:\Code\R&D\payload` |
| **03-twenty**     | `twentyhq/twenty` | P0 | Cloned / Frozen | `d:\Code\R&D\twenty` |
| **04-erpnext**    | `frappe/erpnext` | P0 | Cloned / Frozen | `d:\Code\R&D\erpnext` |
| **05-plane**      | `makeplane/plane` | P0 | Cloned / Frozen | `d:\Code\R&D\plane` |
| **06-keycloak**   | `keycloak/keycloak` | P0 | Cloned / Frozen | `d:\Code\R&D\keycloak` |
| **07-temporal**   | `temporalio/temporal` | P0 | Cloned / Frozen | `d:\Code\R&D\temporal` |
| **08-tooljet**    | `ToolJet/ToolJet` | P1 | Cloned / Frozen | `d:\Code\R&D\tooljet` |
| **09-opensearch** | `opensearch-project/OpenSearch` | P1 | Cloned / Frozen | `d:\Code\R&D\opensearch` |
| **10-formbricks** | `formbricks/formbricks` | P1 | Cloned / Frozen | `d:\Code\R&D\formbricks` |
| **11-cal-diy**    | `calcom/cal.com` (as Cal.diy) | P1 | Cloned / Frozen | `d:\Code\R&D\cal.com` |
| **12-seaweedfs**  | `seaweedfs/seaweedfs` | P1 | Cloned / Frozen | `d:\Code\R&D\seaweedfs` |

---

## 4. Execution Ledger & Progress Tracker

*   [x] **00_research_program_ledger.md**
*   [x] **01_rd_clone_and_freeze.md**
*   [x] **00_CLAUDE_CODE_HANDOFF.md** (Completed)
*   [x] **02_digit_works_audit.md** (Completed)
*   [x] **03_payload_audit.md** (Completed)
*   [x] **04_twenty_audit.md** (Completed)
*   [x] **05_erpnext_audit.md** (Completed)
*   [x] **06_plane_audit.md** (Completed)
*   [x] **07_keycloak_audit.md** (Completed)
*   [x] **08_temporal_audit.md** (Completed)
*   [x] **09_tooljet_audit.md** (Completed)
*   [x] **10_opensearch_audit.md** (Completed)
*   [x] **11_formbricks_audit.md** (Completed)
*   [x] **12_cal_diy_audit.md** (Completed)
*   [x] **13_seaweedfs_audit.md** (Completed)
*   [x] **14_capability_matrix.md** (Completed)
*   [x] **15_architecture_pattern_catalogue.md** (Completed)
*   [x] **16_cross_repo_comparison.md** (Completed)
*   [x] **17_verity_gap_analysis.md** (Completed)
*   [x] **17A_verity_architecture_decisions.md** (Completed)
*   [x] **18_combined_verity_prd.md** (Completed)
*   [x] **19_verity_bible_v2.md** (Completed)
*   [x] **20_verity_spec_v2.md** (Completed)
*   [x] **21_implementation_roadmap_v2.md** (Completed)
*   [x] **22_spec_consistency_audit.md** (Completed)
*   [x] **23_portable_runtime_v2.md** (Completed)
*   [x] **24_current_runtime_baseline.md** (Completed)
*   [x] **25_postgres_portability.md** (Completed)
*   [x] **26_runtime_configuration.md** (Completed)
*   [x] **26A_v1_to_v2_authority_transition.md** (Completed)
*   [x] **27_storage_abstraction.md** (Completed)
*   [x] **28_auth_provider_abstraction.md** (Completed)
*   [x] **29_background_job_abstraction.md** (Completed)
*   [x] **30_containerized_runtime.md** (Completed)
*   [x] **31_migration_and_bootstrap.md** (Completed)
*   [x] **32_health_readiness.md** (Completed)
*   [x] **33_backup_restore_verification.md** (Completed)
*   [x] **34_portable_runtime_acceptance.md** (Completed — 5/8 AC live pass, AC-01/02 NOT EXECUTED, Docker daemon required)
*   [x] **35_phase7_closeout.md** (Completed — Phase 7 ENGINEERING COMPLETE)

---

## Phase 8 — Enterprise Security & Operations

*Entry condition: Phase 7 engineering complete (✅ 2026-08-30). AuthProvider, StorageDriver, JobRunner seams exist. 521-test baseline clean.*

*   [x] **35_phase7_closeout.md** (Phase 7 freeze + Phase 8 entry)
*   [ ] **36_enterprise_identity_oidc.md** (Not Started) — OIDC second AuthProvider impl
*   [ ] **37_enterprise_rbac_policy.md** (Not Started) — Hierarchical RBAC engine
*   [ ] **38_audit_business_history.md** (Not Started) — Domain event → audit record subsystem
*   [ ] **39_integration_framework.md** (Not Started) — External system adapter pattern
*   [ ] **40_enterprise_observability.md** (Not Started) — Observability contract (logs/metrics/errors)
*   [ ] **41_s3_storage_implementation.md** (Not Started) — Second StorageDriver impl, validates abstraction
*   [ ] **42_deployment_hardening.md** (Not Started) — TLS, secrets, upgrade, enterprise package
*   [ ] **43_docker_acceptance_rerun.md** (Not Started) — Full `docker compose build && up` with daemon
*   [ ] **44_enterprise_readiness_certification.md** (Not Started) — Technical certification checklist
