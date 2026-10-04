# Task Plan 01 — R&D Research & Specification Upgrade

This document outlines the systematic plan to analyze mature, enterprise-grade open-source codebases, write product requirements documents (PRDs) for their key architectural concepts, and use them to upgrade the Verity Bible and product specifications.

---

## 1. Target R&D Codebases for Cloning
We will analyze the following repositories. Once cloned into the `d:\Code\R&D/` directory, they will be audited for data models, access controls, and self-hosting architectures.

| Project Name | Repository URL | Key Research Objectives |
|---|---|---|
| **Payload CMS** | `https://github.com/payloadcms/payload` | Study Next.js-native database adapters, automated REST/GraphQL API generation, and collection hooks. |
| **Cal.com** | `https://github.com/calcom/cal.com` | Study Prisma-based booking and scheduling models, multi-timezone calendar arithmetic, and clean Next.js/Tailwind UI patterns. |
| **Twenty CRM** | `https://github.com/twentyhq/twenty` | Study CRM schemas (accounts, contacts, opportunities), relational fields mapping, and event-driven database synchronization. |
| **Plane** | `https://github.com/makeplane/plane` | Study project and issue management workflows, task assignment mechanics, and workspace permission controls. |
| **Formbricks** | `https://github.com/formbricks/formbricks` | Study citizen/customer feedback survey engines, micro-survey injection patterns, and Next.js self-hosting optimization. |
| **ToolJet** | `https://github.com/ToolJet/ToolJet` | Study generic DB connection setups and administrative UI builder engines for PSUs/corporates. |
| **DIGIT Works** | `https://github.com/egovernments/digit-works` | Study national-scale municipal registry setups, public project work order management, and government-to-citizen data models. |

---

## 2. Execution Workflow

### Step 1: Clone the Codebases
1.  The user clones each target repository into the folder: `d:\Code\R&D/` (e.g. `d:\Code\R&D\payload`, `d:\Code\R&D\cal.com`, etc.).

### Step 2: Individual Architecture PRDs
For each codebase in the R&D folder, we will generate an architecture-specific PRD detailing:
*   **Data Schema**: How they organize their database tables (users, roles, opportunities, activities).
*   **Auth & RBAC**: How they handle single sign-on (SSO), active tokens, and granular object permissions.
*   **Infrastructure Adaptability**: How they bundle their services (Docker Compose, Redis setups, S3 clients) for on-premise execution.
*   **Design & Layout Conventions**: How they structure clean, dense tables and forms.

### Step 3: Upgrade the Verity Bible
*   Gather the PRD insights and cross-examine them against Verity's existing architectural rules.
*   Update the "Verity Bible" rules to specify the standardized schemas for:
    *   Dynamic custom fields.
    *   SSO key-exchange handshakes.
    *   System audit logging.
    *   File storage evidence contracts.

### Step 4: Upgrade `verity-spec`
*   Refactor the global `verity-spec` sheet to reflect the new modular architecture (decoupling Vercel/Supabase dependencies, adding core installation parameters, and standardizing vertical packs interface specifications).
