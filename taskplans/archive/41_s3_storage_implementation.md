# Task Plan 41 — Production Storage Provider

**Phase 8, Task 6 of 9.** Control document: `35A_phase8_execution_program.md`.
**Depends on:** Task 27 (the `StorageDriver` seam), Task 40 (a second dependency
to observe).
**Gate owned:** G09 — storage abstraction with more than one provider.

---

## 1. Objective

Task 27 created the seam. This task **proves** it, by putting a second real
implementation through the existing interface.

```text
SupabaseStorageDriver ──┐
                        ├── StorageDriver ── files.ts ── every capability
S3StorageDriver ────────┘
```

The test of an abstraction is not that it exists. It is that the second
implementation fits without the interface changing.

**This is a validation task, not "let us add SeaweedFS because we cloned it."**
The Verity contract stays **S3-compatible**, never SeaweedFS-specific: MinIO,
SeaweedFS, Ceph RGW, Wasabi, Backblaze B2 and AWS S3 are then all one adapter
with different configuration.

---

## 2. Acceptance Shape

The task succeeds only if:

1.  `files.ts` is **unchanged**. If the second driver needed the interface to
    move, the seam was not real.
2.  No capability changes. Not one line.
3.  Selecting a provider is configuration, not a code change.
4.  Both drivers satisfy the same contract, proven by the same tests run twice.

---

## 3. Design

### 3.1 `src/server/storage/s3.ts`

`@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` are already
dependencies. Presigned URLs throughout, exactly as the Supabase driver does:

*   `createUploadUrl` → presigned `PutObject`, with the declared content type;
*   `createReadUrl` → presigned `GetObject`, short-lived;
*   `delete` → `DeleteObject`.

Bytes travel directly between the client and the object store. They never
transit the application, which is the shape `reserveUpload` was written for and
the reason a 200MB site photograph does not become a Node memory problem.

### 3.2 Provider selection

`VERITY_STORAGE_DRIVER` — `supabase` (default) or `s3`. Selected once at
install, from validated configuration, exactly as Task 36 selects an auth
provider. Unset or incompletely configured means **no driver**, which
`files.ts` already handles by refusing at the point of use.

`forcePathStyle` matters and is configurable: MinIO and SeaweedFS serve
path-style URLs, AWS serves virtual-hosted-style, and getting it wrong produces
a signature that verifies against the wrong host — which looks like a
credentials problem and is not.

### 3.3 What must not happen

*   No `if (driver === "s3")` anywhere outside the storage directory.
*   No SeaweedFS-specific call. If SeaweedFS is used as test infrastructure, it
    is used **through its S3 gateway**.
*   No credentials in code, in tests, or in this document.

---

## 4. Evidence Plan

| Level | Evidence | Status |
|---|---|---|
| Contract | One shared conformance suite run against both drivers | automated |
| Unit | Presign construction, error handling, path style, key namespacing | automated |
| Selection | `installStorage()` binds the configured driver and nothing else | automated |
| Live | Round-trip against a real S3-compatible server (MinIO) | **EXECUTED** — see §7 |

---

## 5. Files

```text
src/server/storage/s3.ts             NEW
src/server/storage/index.ts          NEW — provider selection
src/server/platform/config.ts        MODIFIED — storage.driver + s3 settings
src/server/capabilities/registry.ts  MODIFIED — installs through the selector
src/test/storage-s3.test.ts          NEW
```

`src/server/platform/files.ts` is **not** in this list, deliberately.

---

## 6. Acceptance Criteria

*   [x] AC-01 `files.ts` unchanged; the interface did not move.
*   [x] AC-02 No capability changed.
*   [x] AC-03 Both drivers pass one shared contract suite.
*   [x] AC-04 Provider selection is configuration only.
*   [x] AC-05 An incomplete S3 configuration binds nothing and fails at use.
*   [x] AC-06 Path-style addressing is configurable and tested.
*   [x] AC-07 Keys stay tenant-namespaced through both drivers.
*   [x] AC-08 No SeaweedFS-specific or vendor-specific call outside the adapter.
*   [x] AC-09 A live round trip against a real S3-compatible server.
*   [x] AC-10 Typecheck clean; suite green.

---

## 7. Implementation Notes (Claude Code, 2026-08-30)

### Status: COMPLETE — BUILT and PROVEN, including live

### The finding

**`src/server/platform/files.ts` was not touched.** Neither was any capability.
A second real storage implementation went in behind the seam Task 27 created,
and the interface did not move by one line.

That is the result this task existed to obtain. The driver is the artefact; the
untouched interface is the finding, and there is a test that asserts
`files.ts` contains no mention of S3, AWS, MinIO, SeaweedFS or the driver
selector.

### What was built

| File | Change |
|---|---|
| `src/server/storage/s3.ts` | NEW. Presigned `PutObject` / `GetObject`, `DeleteObject`, configurable path-style addressing, credential-scrubbed errors. |
| `src/server/storage/index.ts` | NEW. The one place a provider is chosen. |
| `src/server/storage/supabase.ts` | `installStorage()` removed — an adapter should not decide whether another adapter runs. It is now purely the Supabase adapter. |
| `src/server/platform/config.ts` | `storage.driver` and the `storage.s3` block. |
| `src/server/capabilities/registry.ts` | One import line, pointing at the selector. |
| `src/test/storage-s3.test.ts` | NEW, 23 tests including the live round trip. |

### Decisions worth defending

**S3-compatible, never vendor-specific.** Nothing in the driver knows about AWS,
MinIO, SeaweedFS, Ceph or Wasabi. They are one adapter with different
configuration. The brief was explicit that this must not become "let us add
SeaweedFS because we cloned it", and a test asserts the driver names no vendor
and uses only the three standard commands. SeaweedFS, if used, is used through
its S3 gateway like every other server.

**Path-style addressing is configurable and defaults from the endpoint.** MinIO
and SeaweedFS serve path-style; AWS serves virtual-hosted. Getting it wrong
produces a signature computed against the wrong host, which surfaces as
`SignatureDoesNotMatch` and reads exactly like a bad secret key. An operator can
lose a day to that, so the default is derived (an endpoint implies self-hosted
implies path-style) and the override is explicit. Three cases tested.

**Errors are scrubbed.** An SDK error quotes the URL it was building, and a
presigned URL contains `X-Amz-Credential` and `X-Amz-Signature`. Same discipline
as `integration.ts` applies to transport errors; tested against a realistic
error string.

**One contract suite, run against both drivers.** Written once, executed twice.
A contract only one implementation is held to is not a contract. It is
deliberately behavioural — "returns a usable URL", "carries the tenant-namespaced
key through unchanged" — rather than structural, because "has these three
methods" is what TypeScript already checks and is not what breaks.

**Selection is configuration.** `VERITY_STORAGE_DRIVER`, chosen once at install
from validated config, exactly as Task 36 selects an auth provider. Incomplete
S3 configuration binds nothing and the refusal happens at the point of use —
Task 27's decision, kept, because a deployment without storage is a valid
deployment and failing at boot would take down sign-in over a feature nobody had
reached for.

### Live evidence (AC-09)

A container runtime was provisioned for this (`colima`, Docker 29.5.2), and a
real MinIO server was run:

```text
docker run -d --name verity-minio -p 9000:9000 quay.io/minio/minio:latest server /data
mc mb v/verity-test

VERITY_S3_TEST_ENDPOINT=http://127.0.0.1:9000 \
VERITY_S3_TEST_BUCKET=verity-test \
... npx vitest run src/test/storage-s3.test.ts

Test Files  1 passed (1)
Tests       23 passed (23)      ← including "live S3 round trip"
```

The round trip presigns an upload, `PUT`s real bytes, presigns a read, fetches
them back, compares by **SHA-256 checksum** (not length — a truncated or
re-encoded object is exactly what a length comparison misses), deletes, and
confirms the object is gone.

**The live test immediately earned its place.** It failed on the first run with
`Cannot read properties of undefined (reading 'endpointProvider')`: an earlier
test in the same file replaces `@aws-sdk/client-s3` to observe the constructor's
addressing default, and `vi.doMock` survives `restoreAllMocks`. The live round
trip was about to run against the stub. Had it been written to skip quietly it
would have "passed" for the wrong reason forever — which is the precise failure
mode a live test exists to eliminate. Fixed with an explicit `doUnmock` and a
comment saying why.

### Evidence

```text
Test Files  47 passed (47)
Tests       674 passed | 4 skipped (678)     ← suite, live test skipped
Tests       23 passed  (23)                  ← storage-s3.test.ts with MinIO running
```

*   Before Task 41: 655. After: 678 (+23). Zero regressions.
*   `npx tsc --noEmit`: clean.
*   Legacy-pattern scan on changed files: NONE FOUND.

### Carried forward

*   Task 42 adds MinIO to the deployment package as the reference self-hosted
    object store, so `docker compose up` yields a working storage backend with
    no cloud account.
*   Task 43 re-runs the live round trip inside the containerized acceptance,
    where the application, the database and the object store are all containers.
