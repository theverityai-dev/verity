# Audit 12 — SeaweedFS (seaweedfs/seaweedfs)

**Current Status**: Complete
**Audit Snapshot**: Commit `9bafeb6` (Branch: `master`)
**License**: Apache License 2.0
**Primary Research Goal**: Learn the architecture of high-performance object storage, file indexing, and S3-compatible APIs for portable enterprise document lockers.

---

## 1. Product Model & Objectives

### Target Users & Buyers
*   **Target Users**: System administrators, storage engineers, and backend developers.
*   **Buyers**: Enterprises and PSUs needing to manage millions of small files (images, PDFs) inside private datacenters without using public AWS S3.

### Problems Solved
*   **Small File Performance Bottlenecks**: Standard file systems suffer from slow file lookups when handling billions of tiny images or PDF bills. SeaweedFS aggregates files into large block volumes, looking them up in memory.
*   **Storage Portability**: Providing an S3-compatible API that matches AWS S3 interfaces, enabling apps to switch locations via a single config line.

---

## 2. Technical Architecture & Dataflow

SeaweedFS uses a Go-based distributed master/volume layout:

*   **Filer**: Exposes standard S3-compatible HTTP/gRPC interfaces and handles directory path hierarchies.
*   **Master Server**: Allocates block volume IDs and manages volume servers.
*   **Volume Server**: Stores actual file contents in large pre-allocated blocks, avoiding OS file handle overhead.

---

## 3. Verity Relevance & Verdict

### ADOPT
*   **S3-Compatible Upload Interface**: Adopt standard S3 upload methods (via `@aws-sdk/client-s3`) in Verity's code. This allows the application to write files directly to SeaweedFS, MinIO, or AWS S3 by swapping environment variables.

### ADAPT
*   **Document Chunking**: Adapt the pattern of breaking large files into smaller parts and verifying uploads via MD5 checksum hashes before finalizing records.

### REJECT
*   **Embedded Storage Servers**: Reject running storage services directly inside Verity's Docker process. Storage services must run as external dependencies (via independent SeaweedFS or S3-compliant containers).

---

## 4. Proposed Verity Changes

1.  **S3 Storage Service Wrapper**: Implement a `StorageService` interface in Verity, wrapping AWS SDK methods to handle document uploads, downloads, and pre-signed URL generations.
2.  **Configurable Storage Target**: Read `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, and `STORAGE_SECRET_KEY` from environment variables, directing calls to the client's internal SeaweedFS instance in enterprise mode.
