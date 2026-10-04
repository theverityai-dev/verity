# Audit 10 — Formbricks (formbricks/formbricks)

**Current Status**: Complete
**Audit Snapshot**: Commit `37b8c69` (Branch: `main`)
**License**: AGPL-3.0 License (Core)
**Primary Research Goal**: Analyze how a Next.js-native, self-hostable project structures dynamic surveys, form flows, background worker threads, and environment-driven configurations.

---

## 1. Product Model & Objectives

### Target Users & Buyers
*   **Target Users**: Product managers, marketers, and developers.
*   **Buyers**: Mid-market SaaS startups and enterprise firms needing to gather user feedback while maintaining strict privacy control.

### Problems Solved
*   **Boilerplate Survey Integration**: Instantly injecting pop-ups, emails, or link surveys into React apps without rebuilding the questionnaire UI.
*   **Data Sovereignty**: Allowing firms to self-host user feedback lists instead of sending them to Typeform or Hotjar.

---

## 2. Technical Architecture & Dataflow

Formbricks is Next.js-native and matches Verity's stack closely:

```
                      FORMBRICKS DATAFLOW
                      
    Next.js Client (App Router) ──> Next.js API Routes (Prisma)
                                           │
         ┌─────────────────────────────────┴─────────────────────────────────┐
         ▼ (Synchronous DB Writes)                                           ▼ (Asynch Jobs)
   ┌───────────┐                                                       ┌───────────┐
   │ Prisma    │                                                       │ Queue     │
   │ Client    │                                                       │ (BullMQ)  │
   └─────┬─────┘                                                       └─────┬─────┘
         │                                                                   │
         ▼                                                                   ▼
   ┌───────────┐                                                       ┌───────────┐
   │ PostgreSQL│                                                       │ Redis     │
   │ Database  │                                                       │ Caching   │
   └───────────┘                                                       └───────────┘
```

---

## 3. Domain & Data Architecture

### Entity Schema
*   **Surveys & Responses**:
    *   *Survey*: Houses configuration, target conditions, and list of questions.
    *   *Response*: Relates to a Survey, storing an array of JSON responses (`data` JSON field).
*   **Dynamic Validations**: Next.js API handles schema validation using Zod based on the question type (e.g. email, rating, open-text).

---

## 4. Verity Relevance & Verdict

### ADOPT
*   **Prisma JSON Column Responses**: Adopt storing dynamic document inputs (such as contractor survey results, custom inspection forms, or quality check lists) as raw JSON columns linked to a static template model.
*   **Next.js Monorepo Structure**: Adopt the clean monorepo architecture separating the backend service libraries (`@formbricks/lib`) from Next.js server components.

### ADAPT
*   **Environment Configuration Template**: Adapt Formbricks' standard `.env.example` setup, isolating development configurations from enterprise on-prem settings.

### REJECT
*   **Telemetry tracking**: Reject telemetry modules. Verity is deployed in closed, private networks where tracking scripts are blocked by firewalls.

---

## 5. Proposed Verity Changes

1.  **Survey/Inspection Form Engine**: Implement a dynamic form engine using JSON configurations to construct QA checks, yard receipt forms, or driver signatures.
2.  **Environment Setup Clean-up**: Refactor configuration files to guarantee that database connections, mail setup, and auth keys are injectable via environment parameters at container startup.
