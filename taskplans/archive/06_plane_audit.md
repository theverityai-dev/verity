# Audit 05 — Plane (makeplane/plane)

**Current Status**: Complete
**Audit Snapshot**: Commit `4a6f9ed` (Branch: `preview`)
**License**: AGPL-3.0 License
**Primary Research Goal**: Analyze how to structure operational task boards, workspace layouts, issue tracking state systems, and local/on-premise Docker container environments.

---

## 1. Product Model & Objectives

### Target Users & Buyers
*   **Target Users**: Project managers, team leads, QA engineers, and developers.
*   **Buyers**: Tech teams, corporations, and startups looking to replace JIRA or Linear with a fast, self-hostable project management platform.

### Problems Solved
*   **JIRA Bloat & Speed**: Providing a clean, instant UI for logging tasks and tracking progress.
*   **Host Location Restraints**: Allowing financial firms or healthcare groups to deploy project boards inside secure internal servers.

### Major Use Cases
1.  **Kanban & List Task Tracking**: Managing issue backlogs, drag-and-drop workflow status boards, and sprints.
2.  **Collaborative Workspaces**: Creating isolated project folders for separate organizational divisions.
3.  **Project Milestone Tracking (Cycles/Modules)**: Grouping issues into time-bound cycles (sprints) or logical modules (epics).

---

## 2. Repository Map & Codebase Anatomy

Managed as a monorepo containing services and frontend:

*   **`apidocs/`**: Swagger contract definitions.
*   **`apps/`**: Application directories:
    *   `app/`: Web client frontend built with Next.js/React.
    *   `api/`: Backend service built using Python/Django Rest Framework.
*   **`deploy/`**: Configurations for Docker Compose, Kubernetes Helm, and environment setups.

---

## 3. Technical Architecture & Dataflow

Plane uses a decoupled architecture with Next.js serving as the UI and Django serving as the API engine:

```
                       PLANE ARCHITECTURE
                       
       Next.js Web Client ──> Django REST API Server
                                     │
         ┌───────────────────────────┴───────────────────────────┐
         ▼ (Synchronous CRUD SQL)                                ▼ (Asynch Tasks)
   ┌───────────┐                                           ┌───────────┐
   │ Django    │                                           │ Celery    │
   │ ORM       │                                           │ Worker    │
   └─────┬─────┘                                           └─────┬─────┘
         │                                                       │
         ▼                                                       ▼
   ┌───────────┐                                           ┌───────────┐
   │PostgreSQL │                                           │ Redis /   │
   │ Database  │                                           │ Valkey    │
   └───────────┘                                           └───────────┘
```

---

## 4. Domain & Data Architecture

### Entity Hierarchy
*   **Workspace -> Project -> Issue Structure**:
    *   *Workspaces*: Provide administrative separation.
    *   *Projects*: Belong to Workspaces and house custom states.
    *   *Issues*: The primary operational unit.
*   **State Machine Transitions**: Each project maintains its own status dictionary (`Backlog`, `Unstarted`, `Started`, `Completed`, `Cancelled`). Issues reference these state definitions.
*   **Soft Deletes & Activity Logs**: Track records of deleted issues and generate status logs for change audits.

---

## 5. Identity & RBAC Model
*   **Role-Based Scope**: Roles are scoped at the workspace level (`Owner`, `Admin`, `Member`, `Viewer`).
*   **Object-Level Restraints**: Users can perform updates on issues only if they have project-level memberships, checked via API decorator guards.

---

## 6. Workflow Engine
*   **Task Dependencies**: Plane supports parent-child issues, blocking relations (Issue A blocks Issue B), and duplicate markings.
*   **Notification Dispatchers**: Issue updates trigger asynchronous event worker jobs (handled by Celery running on Redis/Valkey) to broadcast updates to team members.

---

## 7. Storage & Deployment

### Storage
*   **Object Storage Registry**: Local file uploads are routed to S3/MinIO via django-storages.

### Deployment
*   **Self-Hosted Packaging**: Plane is packaged as a clean, single `docker-compose.yml` linking the API, web, postgres, redis, and minio containers with Nginx routing.

---

## 8. Verity Relevance & Verdict

### ADOPT
*   **Symmetrical Work Isolation (Workspace -> Project)**: Adopt the hierarchy of separating operations into Workspaces (organizational units) containing isolated Projects/Yards.
*   **Local Docker-Compose Blueprint**: Adopt Plane's docker-compose deployment design: a single compose file bundling the web server, DB, cache, and storage.

### ADAPT
*   **Kanban Board UI Models**: Adapt Plane's clean UI patterns for table columns, filters, and card dragging for Verity's delivery dispatcher dashboard.

### REJECT
*   **Django Backend Overhead**: Reject using Django/Python for Verity's API core. Next.js App Router (TypeScript) is already serving both UI and API needs efficiently in a single language.

---

## 9. Proposed Verity Changes

1.  **Define Docker Compose Stack**: Write a `docker-compose.yml` file for Verity Enterprise, packaging Next.js, PostgreSQL, Redis, and a local storage server.
2.  **Yard Isolation**: Establish a clear `Yard` or `Location` partition model where users are assigned to specific locations and can view only orders/stock matching their location ID.
