# Audit 04 — ERPNext (frappe/erpnext)

**Current Status**: Complete
**Audit Snapshot**: Commit `8b43394` (Branch: `develop`)
**License**: GPL-3.0 License
**Primary Research Goal**: Analyze the domain structure of a mature, comprehensive enterprise resource planning (ERP) system, mapping the relationships between inventory, accounting, sales, and purchasing.

---

## 1. Product Model & Objectives

### Target Users & Buyers
*   **Target Users**: Accountants, warehouse managers, procurement officers, sales managers, HR staff, and production engineers.
*   **Buyers**: Small and medium-sized manufacturing companies, distributors, services firms, and retail organizations.

### Problems Solved
*   **Siloed Business Data**: Unifying financial ledgers, inventory balances, order histories, and staff directories.
*   **Manual Inventory & Accounts Bookkeeping**: Automating double-entry accounting entries whenever stock moves (e.g. from Purchase Receipt to Sales Invoice).
*   **Lack of Control**: Providing strict approval controls for financial transactions.

### Major Use Cases
1.  **Sales & Purchase Cycle**: Managing Quotations, Sales Orders, Delivery Notes, and Sales Invoices.
2.  **Stock & Warehouse Management**: Tracking bin balances across multiple warehouses (godowns), recording stock transfers, and calculating moving average costs.
3.  **Double-Entry General Ledger**: Generating Balance Sheets, Profit & Loss Statements, and General Ledgers automatically from operational transactions.

---

## 2. Repository Map & Codebase Anatomy

ERPNext runs on the **Frappe Framework** (a Python-based low-code ERP platform):

*   **`erpnext/accounts/`**: Direct double-entry general ledger implementation, invoices, payments, tax rules.
*   **`erpnext/stock/`**: Stock entries, warehouses, purchase receipts, stock valuation ledgers.
*   **`erpnext/buying/`** & **`erpnext/selling/`**: Supplier purchase logs and client sales funnels.
*   **`erpnext/manufacturing/`**: Bill of Materials (BOM), Work Orders, and workstation routings.
*   **`erpnext/projects/`**: Project tasks, timesheets, and budget trackers.

---

## 3. Technical Architecture & Dataflow

ERPNext is built using Python, Frappe, Redis, and MariaDB/PostgreSQL:

```
                      ERPNEXT ARCHITECTURE
                      
     Frappe Web Client (Vue/JS) ──> Python Web Server (Gunicorn)
                                           │
         ┌─────────────────────────────────┴─────────────────────────────────┐
         ▼ (Synchronous DB write)                                            ▼ (Background Job)
   ┌───────────┐                                                       ┌───────────┐
   │ Python    │                                                       │ Redis     │
   │ ORM       │                                                       │ Worker    │
   └─────┬─────┘                                                       └─────┬─────┘
         │                                                                   │
         ▼                                                                   ▼
   ┌───────────┐                                                       ┌───────────┐
   │ MariaDB / │                                                       │ Task      │
   │ Postgres  │                                                       │ Scheduler │
   └───────────┘                                                       └───────────┘
```

---

## 4. Domain & Data Architecture

### DocType Metaprogramming
*   **DocType Primitives**: In the Frappe framework, everything is a DocType (Document Type). A DocType defines database schemas, validation rules, state transitions, and UI forms in a single JSON schema.
*   **Stock Ledger Entry (SLE)**: Stock movement is treated as an immutable ledger transaction. Instead of editing a product's stock count directly, a row is appended to `tabStock Ledger Entry`. Product balances are computed by aggregating SLE records.
*   **General Ledger (GL) Integration**: Operational transactions (like submitting a purchase receipt) trigger an automated, atomic GL entry (`tabGL Entry`), ensuring inventory valuation matches book value in real time.

---

## 5. Identity & RBAC Model
*   **DocShare and Role Permissions**: Permissions are defined per DocType based on Roles. 
*   **Record-Level Security (User Permissions)**: Users can be restricted to view documents matching specific criteria (e.g. only show invoices belonging to `Location: Delhi`).

---

## 6. Workflow Engine
*   **Workflow States**: DocTypes can have states (e.g., `Draft` -> `Submitted` -> `Approved` -> `Cancelled`).
*   **Submit/Cancel Immutable Model**: Submitting a document locks its database record, preventing updates. To reverse a mistake, users must create a "Cancel" transaction that posts compensating entries to clean the ledgers.

---

## 7. Storage, Search & Auditing

### Storage
*   **File Manager Table**: Files are uploaded and logged in `tabFile`. Records reference files via public/private paths.

### Auditing
*   **Document Versioning**: Track changes and field differences on each document save.

---

## 8. Verity Relevance & Verdict

### ADOPT
*   **Immutable Ledger Entries (Stock/Accounts)**: Adopt the ledger model for stock and financial entries. Never update product stock levels directly; write transaction receipts (Stock Ledger Entries) and compute current balance dynamically.
*   **Submit/Lock Pattern**: Adopt document locking. Once a sales invoice or stock ledger transfer is submitted, freeze the record. Edits must require a cancellation voucher and compensating adjustment to preserve ledger history.

### ADAPT
*   **Account-Linked Inventory Valuation**: Adapt the mechanism of mapping stock receipts and dispatches directly to raw account values to prepare Verity for future accounting modules.

### REJECT
*   **GPL-3.0 Contamination**: Reject copying Python/Frappe framework components directly. Keep Verity's backend strictly in Next.js/TypeScript.

### DEFER
*   **Complex Manufacturing/BOM Routings**: Defer multi-level Bill of Materials (BOM) management. Simplistic raw stock tracking is sufficient for our immediate target trades.

---

## 9. Proposed Verity Changes

1.  **Immutable Stock Ledger Table**: Implement a `StockLedgerEntry` model in Prisma, recording delta changes (`qtyDelta`, `warehouseId`, `productId`, `referenceDocument`) to serve as the single source of truth for stock counts.
2.  **Submission Lock Middleware**: Introduce a `locked` boolean on the invoice and delivery order tables. Block mutation API requests targeting locked records.
