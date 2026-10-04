# Audit 07 — Temporal (temporalio/temporal)

**Current Status**: Complete
**Audit Snapshot**: Commit `ceb1cc1` (Branch: `main`)
**License**: MIT License (Core)
**Primary Research Goal**: Analyze the architecture of a durable, fault-tolerant workflow orchestration engine to understand how to design resilient state transitions and async job recovery.

---

## 1. Product Model & Objectives

### Target Users & Buyers
*   **Target Users**: Software engineers, system architects, and DevOps teams.
*   **Buyers**: Large enterprises (banking, logistics, cloud infrastructure) requiring high-reliability guarantees for complex multi-step processes.

### Problems Solved
*   **Durable State Loss during Outages**: Normal applications lose execution memory if a server crashes in the middle of a multi-step transaction. Temporal saves execution state, resuming from the exact line of code after reboot.
*   **Complex Retry & Timeout Management**: Automating complex wait periods (e.g. wait 3 days, check condition, retry) without polling SQL tables or building fragile crons.
*   **Distributed Saga Failures**: Managing compensation routines if Step 3 of a transaction fails (e.g., refund money if ticket booking fails).

---

## 2. Repository Map & Codebase Anatomy

Temporal is built using Go, with SDKs in TypeScript, Python, and Java:

*   **`common/`**: Shared interfaces, hashing utilities, and persistence schemas.
*   **`service/`**: Core orchestrator services:
    *   `history/`: Records immutable execution history steps.
    *   `matching/`: Matches pending tasks to active worker pollers.
*   **`schema/`**: Database migration schemas (PostgreSQL, MySQL, Cassandra).

---

## 3. Technical Architecture & Dataflow

Temporal runs as an orchestrating cluster. Developers write Workflows and Activities and execute them inside standalone Worker processes:

```
                      TEMPORAL DURABLE FLOW
                      
   Verity App ──[Starts Workflow]──> Temporal Orchestrator
                                            │
         ┌──────────────────────────────────┴──────────────────────────────────┐
         ▼ (Matching Engine)                                                   ▼ (Persistence)
   ┌─────────────┐                                                       ┌─────────────┐
   │ Worker Polla│ ──[Executes Activity code]──>                         │ Event History│
   │ (Runs code) │                                                       │  (Postgres) │
   └─────────────┘                                                       └─────────────┘
```

### Core Primitives:
1.  **Workflows**: Code that describes a sequence of execution steps. Must be fully deterministic.
2.  **Activities**: Code that executes side effects (hitting APIs, writing SQL). If an Activity fails, Temporal retries it according to rules.
3.  **Event Sourcing**: Temporal tracks execution by logging every step (Workflow Started, Activity Scheduled, Activity Completed) in an immutable database table. If a worker fails, a new worker reconstructs the state by replaying history.

---

## 4. Verity Relevance & Verdict

### ADOPT
*   **Activity/Idempotency Pattern**: Adopt idempotent database keys for transactions. Whenever executing billing updates or inventory movements, generate a unique `transactionId` in the business route, verifying it hasn't been processed already before updating balances.

### ADAPT
*   **Durable State Machine Blueprint**: Adapt the design pattern of splitting long-running procedures (e.g., Order Approval -> Procurement Wait -> Yard Packing -> Lorry Dispatch) into a state-tracking database table with explicit timestamps and retry configurations.

### REJECT
*   **Temporal Cluster Deployment**: Reject running a dedicated Temporal cluster inside Verity's base setup. Installing and running Temporal adds significant deployment complexity (Go orchestrator, Cassandra/Postgres migrations, standalone worker containers). Verity's target scale is better served by standard BullMQ workers.

---

## 5. Proposed Verity Changes

1.  **State Logs Table**: Create an `OrderWorkflowHistory` table in Prisma, recording every state change, the user who triggered it, the input details, and execution outcomes, mirroring Temporal's event history concept.
2.  **Step-Level Retries**: Implement a retry handler for external integrations (e.g., pushing invoices to government tax portals) using simple backoff delays in the Redis job queue.
