# Audit 08 — ToolJet (ToolJet/ToolJet)

**Current Status**: Complete
**Audit Snapshot**: Commit `63c9129` (Branch: `main`)
**License**: AGPL-3.0 License (Core)
**Primary Research Goal**: Learn the architecture of dynamic connector modules, generic database configurations, and metadata-driven dashboard engines.

---

## 1. Product Model & Objectives

### Target Users & Buyers
*   **Target Users**: Internal IT developers, operations teams, and systems analysts.
*   **Buyers**: Enterprise organizations needing to build internal admin dashboards, data editors, and customer portals rapidly.

### Problems Solved
*   **Repetitive Admin Panels**: Eliminating the overhead of writing custom React forms, layouts, tables, and auth loops for every internal utility.
*   **Data Source Integration**: Unifying connections to diverse databases (Postgres, MySQL, DynamoDB) and APIs into a single dashboard builder.

---

## 2. Technical Architecture & Dataflow

ToolJet runs on NestJS (server) and React (UI App Builder):

*   **`frontend/`**: The visual builder application where users drag-and-drop widgets and map variables.
*   **`server/`**: NestJS core handling workspaces, user credentials, plugin registry, and query execution.
*   **`plugins/`**: Decoupled modules containing API integration adapters (e.g., PostgreSQL query runners, Slack API, SMTP runners).

---

## 3. Domain & Data Architecture

### Database Connector Model
*   **Credential Encryption**: Database credentials and API keys are stored in the server database, encrypted at the application layer using AES-256 before write.
*   **Query Serialization**: Operations (e.g. `SELECT * FROM clients`) are represented as JSON configuration payloads, parsed at runtime by the server's NestJS query execution engine.

---

## 4. Verity Relevance & Verdict

### ADOPT
*   **Credential Encryption Layer**: Adopt application-layer column encryption (AES-256) for storing external API keys (like SMS gateways, email SMTP, or government billing credentials) in PostgreSQL.

### ADAPT
*   **Metadata-Driven Form Configuration**: Adapt the design of representing layout grids and table filters as structured JSON configurations, allowing dashboard columns to be customized without mutating React components.

### REJECT
*   **Visual Drag-and-Drop Builders**: Reject embedding a low-code UI builder. Verity is an opinionated operational ERP/system, not a general-purpose database editor.

---

## 5. Proposed Verity Changes

1.  **Encryption Utility**: Add a standard crypto helper in Verity's utility modules to handle column-level encryption for sensitive credentials.
2.  **Configurable Tables**: Implement metadata configurations for the main `SmartTable` components, allowing columns, sorting parameters, and visibility to be loaded dynamically from the database.
