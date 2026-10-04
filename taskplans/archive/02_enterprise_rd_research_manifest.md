# Verity Enterprise — Research & Development (R&D) Manifest

This manifest documents the 36 candidate codebases selected for architectural research to inform the development of Verity's enterprise, on-premise, and multi-tenant capabilities. 

---

## 1. Research Pipeline Disciplines
Every codebase undergoes the following evaluation pipeline before any concepts are absorbed:
```
Repository (Clone)
    │
    ▼
Research Dossier (Audit Schema, Permissions, Deployability)
    │
    ▼
Product Requirements Document (PRD)
    │
    ▼
Verity Bible Evaluation (Cross-examine rules)
    │
    ▼
Architectural Decision (Approve pattern)
    │
    ▼
verity-spec Proposal (Draft schema modifications)
    │
    ▼
Implementation & Unit/E2E Tests
    │
    ▼
Deployment Validation (Docker/Compose verify)
```

---

## 2. Prioritized Codebase Catalog

### 🔴 P0: Core Foundations (Immediate Audit)
These seven systems answer the most vital architectural questions (Auth, SSO, jobs, admin dashboards, relational database orchestration).

| Codebase | Primary Focus | Repository URL |
|---|---|---|
| **Payload CMS** | Next.js-native admin, auth, collections, database abstraction | `https://github.com/payloadcms/payload` |
| **Frappe Framework** | Python-based low-code ERP framework (ERPNext core) | `https://github.com/frappe/frappe` |
| **Twenty CRM** | TypeScript/NestJS/React CRM schema design | `https://github.com/twentyhq/twenty` |
| **DIGIT Core** | Municipal/citizen microservice workflow engine | `https://github.com/egovernments/Digit-Core` |
| **DIGIT Works** | Government work orders and project registers | `https://github.com/egovernments/digit-works` |
| **Keycloak** | Identity provider, SSO, B2B federations | `https://github.com/keycloak/keycloak` |
| **Temporal** | Distributed, durable state machine & orchestration engine | `https://github.com/temporalio/temporal` |

---

### 🟡 P1: Workflows, Scheduling & Internal Tools
| Codebase | Focus Area | Repository URL |
|---|---|---|
| **Plane** | Issue tracking and workspace workflows | `https://github.com/makeplane/plane` |
| **Cal.com** | Calendar algorithms, tz-scheduling (Next/Prisma) | `https://github.com/calcom/cal.com` |
| **ToolJet** | Low-code DB/API UI builder | `https://github.com/ToolJet/ToolJet` |
| **Appsmith** | Enterprise internal operations portals | `https://github.com/appsmithorg/appsmith` |
| **Formbricks** | Citizen interaction & micro-surveys (Next.js) | `https://github.com/formbricks/formbricks` |
| **Directus** | Instant API wrapper & database console | `https://github.com/directus/directus` |

---

### 🟢 P2: Sector-Specific Platform Engines & Infrastructure
| Codebase | Domain | Repository URL |
|---|---|---|
| **OpenG2P** | Welfare payments, government-to-person programs | `https://github.com/OpenG2P/openg2p-core` |
| **MOSIP** | National modular open-source identity | `https://github.com/mosip/mosip` |
| **ODK Central** | Field data collection & offline form surveys | `https://github.com/getodk/central` |
| **OpenSearch** | Observability, log analytics, security search | `https://github.com/opensearch-project/OpenSearch` |
| **Valkey** | Redis-fork caching & real-time queues | `https://github.com/valkey-io/valkey` |
| **ERPNext** | Comprehensive MSME/manufacturing ERP stack | `https://github.com/frappe/erpnext` |
| **DHIS2** | National healthcare data management | `https://github.com/dhis2/dhis2-core` |

---

### 🔵 P3: Specialized Registries & Reference Architectures
*   **OpenIMIS**: Insurance management platform for health and social security.
*   **Sunbird-ED**: Educational scale portal and learner registry.
*   **OpenMRS**: Medical record framework.
*   **Bahmni**: Hospital information system.
*   **OpenBoxes**: Health sector inventory and supply chain logs.
*   **GLPI**: Asset management and helpdesk tracker.
*   **OpenProject**: Enterprise project task scheduler.
