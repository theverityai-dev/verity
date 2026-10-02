# Object storage: what Verity requires, and how checksums behave

Scope: the S3 driver (`src/server/storage/s3.ts`). This page states the contract an S3-compatible server must meet, how
Verity treats upload checksums, and how to check a server before relying on it. It does not choose a bundled store or
describe bucket provisioning; see `install.md` for deployment.

## The contract

Verity talks to any S3-compatible server through one adapter and one configuration: endpoint, region, bucket, an access
key pair, and an addressing style (`VERITY_S3_*`, see `install.md`). It requires the server to provide:

- SigV4 **presigned PUT** and **presigned GET** URLs, path-style or virtual-hosted;
- a presigned PUT that accepts the `If-None-Match: *` header the driver returns with the URL;
- a server-side PutObject that honours `If-None-Match: *` (a second write to the same key is refused);
- DeleteObject and HeadBucket;
- a **pre-existing bucket**. The driver does not create one.

It does **not** require, and does not send, a flexible checksum.

## How checksums behave (and why)

Uploads are two-phase. The client uploads straight to the server through a presigned URL, then Verity confirms: it reads
the stored bytes back, checks the size, the sha256 and the file type, and writes the verified bytes to a fresh key
(`platform/files.ts`, `confirmUpload`). The platform therefore verifies every upload itself, end to end.

Since AWS SDK for JavaScript v3.729 the SDK default (`requestChecksumCalculation: WHEN_SUPPORTED`) puts
`x-amz-checksum-crc32` and `x-amz-sdk-checksum-algorithm` into every presigned PutObject URL, with the CRC32 of an **empty**
body, because whoever holds the URL chooses the bytes later. A server that validates that value against the real upload
rejects every upload (observed: `400 BadDigest`); a server that ignores it accepts. A presigned GET likewise gains
`x-amz-checksum-mode`.

So the driver builds its S3 client with `requestChecksumCalculation` and `responseChecksumValidation` both set to
`WHEN_REQUIRED`: a checksum is sent only for operations that mandate one, and none of the operations Verity uses does.
Consequences, stated plainly:

- the presigned upload and read URLs carry **no** checksum query parameter or signed checksum header;
- server-side writes (`storeVerified`) also send no transport CRC32; their integrity rests on the platform's own sha256
  check beforehand and on the connection (use TLS in any deployment that is not loopback);
- upload integrity is **not** delegated to the server. A deployment must not rely on the server to detect a corrupted upload.

This is pinned by `src/test/storage-s3-presign.test.ts`, which fails if a checksum parameter reappears (for example after
an SDK upgrade changes a default).

## Checking a server

`src/test/storage-s3-matrix.test.ts` runs the real driver against every server in `VERITY_S3_MATRIX`, with the production
call shape. It is opt-in: it does nothing unless the variable is set, and credentials are read from the environment only,
never stored. The bucket must exist and be disposable; the test writes and deletes objects under `matrix/`.

```text
VERITY_S3_MATRIX='[{"label":"my-store","endpoint":"https://s3.example.internal","bucket":"verity-matrix",
  "accessKeyId":"<from your secret store>","secretAccessKey":"<from your secret store>"}]' \
npx vitest run --config vitest.pure.config.mts src/test/storage-s3-matrix.test.ts
```

Omit `endpoint` for AWS S3. Optional per entry: `region` (default `us-east-1`), `forcePathStyle`.

A pass shows, for that server: a presigned PUT with the production headers is accepted and the bytes read back are
identical; a second server-side write to the same key is refused; an existing bucket is reachable and a missing one is
reported as an error.

## Verified so far

Run 2026-10-02 with SDK 3.1079.0, all three passing (9 of 9 checks):

| Server | Image |
|---|---|
| MinIO-compatible (a Chainguard-built RELEASE.2026-09-22) | `cgr.dev/chainguard/minio@sha256:4692462f35d9…` |
| SeaweedFS | `chrislusf/seaweedfs@sha256:4e61d15fd359…` |
| RustFS | `rustfs/rustfs@sha256:8cc980175544…` |

Before this change the default client failed the SeaweedFS upload with `BadDigest`. **Not verified:** AWS S3, Ceph RGW,
Wasabi, Backblaze B2, Garage. AWS S3 is publicly reported to reject checksum-bearing presigned PUTs, which is the reason
for this change, but it has not been run here: its status is **UNKNOWN until the matrix has passed against a real bucket**.
