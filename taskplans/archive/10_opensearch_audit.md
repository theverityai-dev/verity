# Audit 09 — OpenSearch (opensearch-project/OpenSearch)

**Current Status**: Complete
**Audit Snapshot**: Commit `c7b98177` (Branch: `main`)
**License**: Apache License 2.0
**Primary Research Goal**: Analyze how to structure high-performance full-text search, separate analytical queries from transactional workloads, and handle high-volume event logging.

---

## 1. Product Model & Objectives

### Target Users & Buyers
*   **Target Users**: System administrators, software developers, and security/observability engineers.
*   **Buyers**: Large enterprises requiring log aggregation, infrastructure monitoring, or complex full-text search capabilities across large datasets.

### Problems Solved
*   **Slow Transactional Queries**: Preventing complex search and filter actions from locking core relational databases (PostgreSQL/MySQL).
*   **Unstructured Log Search**: Parsing, indexing, and enabling instant searches across gigabytes of server and event logs.

---

## 2. Technical Architecture & Dataflow

OpenSearch runs as a distributed Java cluster:

*   **Ingestion**: Records are serialized as JSON documents and posted to the cluster via bulk APIs.
*   **Lucene Indexing**: Internally compiles documents into inverted indexes (using Apache Lucene) for rapid keyword matches.
*   **Cluster Coordination**: Manages sharding, node failure recovery, and distributed search coordination.

---

## 3. Verity Relevance & Verdict

### ADOPT
*   **Analytical Query Separation**: Adopt the principle of read-write segregation. Heavy analytical dashboards (like monthly sales trends, yearly tax summaries, or location audits) should query a separate, indexed model or materialized view rather than executing slow scans on live tables.

### ADAPT
*   **Search Document Representation**: Adapt the design of transforming complex database objects (like nested orders, products, and location details) into flat JSON documents for simple search indexing.

### REJECT
*   **Mandatory OpenSearch Integration**: Reject requiring OpenSearch for standard Verity deployments. For our target range of ₹10L–₹1Cr, PostgreSQL's full-text search features and `pg_trgm` indexes are more than sufficient and save significant cluster hosting costs.

---

## 4. Proposed Verity Changes

1.  **Analytical Materialized Views**: Implement Postgres Materialized Views for the main reporting panels, updated asynchronously on a schedule via Redis queues.
2.  **Flat Search Indexing in DB**: Keep a secondary flat representation of orders and clients in Postgres to drive instant search queries without executing heavy joins.
