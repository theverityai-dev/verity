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
- a bucket that exists by the time the application starts. The running application never creates one; the installer
  ensures it (next section), or you do.

It does **not** require, and does not send, a flexible checksum.

## Bucket provisioning

Readiness fails if the configured bucket does not exist, and `install.sh` ends by requiring readiness, so the installer
ensures the bucket after the object store is started and before the application and the final health check
(`deploy/scripts/ensure-bucket.sh`; it can also be re-run on its own, safely).

`VERITY_STORAGE_CREATE_BUCKET` decides who owns the bucket. It must be exactly `true` or `false`; anything else is
rejected (by preflight and by the configuration boundary), so `False` or `0` can never silently mean `true`.

| Setting | Bucket exists | Bucket missing |
|---|---|---|
| `true` (default) | left exactly as it is | created, then confirmed reachable |
| `false` (the customer owns the bucket) | left exactly as it is | **install fails, creating nothing**, with `E_STORAGE_BUCKET_MISSING` |

Guarantees, each pinned by a test:

- **Provisioning, never reconciliation.** An existing bucket is never read beyond a reachability check, compared, changed,
  recreated or deleted, whatever its settings, policy, versioning, ownership or contents. It is the customer's state.
- When it creates a bucket it sends the name alone (plus a location constraint only for AWS outside `us-east-1`). It sets no
  ACL, policy, versioning, object lock or lifecycle.
- It sends only a bucket-existence check and a bucket creation. It never sends a delete.
- A permission error, server error or unreachable endpoint is reported with its cause and **nothing is created**. A bucket
  name already taken by another account (`E_STORAGE_BUCKET_UNAVAILABLE`) and a creation that is refused are reported, not
  retried. Losing a creation race to ourselves counts as success.
- An object store that is still starting is waited for (up to a minute) only while it gives no HTTP answer at all.
- A deployment that does not use the S3 driver has nothing to provision and the step exits 0.

Creating a bucket needs permission to do so. Where credentials are deliberately limited to existing buckets, set
`VERITY_STORAGE_CREATE_BUCKET=false` and create the bucket yourself first. Creation was verified against the servers in the
table below; AWS S3 is **not** verified (its location-constraint rule is implemented from the S3 API and covered by a unit
test only).

## The bundled store (SeaweedFS)

`VERITY_WITH_BUNDLED_STORAGE=1 ./deploy/scripts/install.sh` adds `docker-compose.bundled-storage.yml`, so a deployment
has a working object store with no cloud account. It is a convenience for self-contained deployments, not the enterprise
boundary: **an external S3-compatible store remains the supported choice for enterprise deployments** (leave the variable
unset and point `VERITY_S3_*` at it). The bundled store replaced MinIO, whose public images were withdrawn and whose
project is archived (drill finding F2).

**Provenance of the pinned image.** The digest is what is trusted; the tag is only for the reader.

| Field | Value |
|---|---|
| Image reference | `chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d` |
| What the digest is | The multi-architecture image index. The tags `4.48` and `latest` both resolved to it on the date below (linux/amd64 `aba492e2a4e4…`, linux/arm64 `f1f303474940…`, plus 386 and arm) |
| Date observed | 2026-10-02 (Docker Hub `last_updated` 2026-09-28T18:58Z; release 4.48 published 2026-09-28T15:53Z) |
| Source | Docker Hub `chrislusf/seaweedfs`, the project's own publisher, built from the `seaweedfs/seaweedfs` release 4.48. The repository also carries cosign signature tags; Verity does not verify them |
| License and status | Apache-2.0; repository active (last push 2026-10-02) and not archived (GitHub API, 2026-10-02) |
| Pull test | `docker pull` by this digest succeeded 2026-10-02, and `check-image-pins.sh` resolved it against the live registry the same day |

**Behaviour.**

- It runs as the image's own unprivileged user (uid 1000) with every capability dropped, a data volume named
  `verity-bundled-storage-data`, and **no published ports**; the S3 gateway listens on 9000 inside the compose network, so
  `VERITY_S3_ENDPOINT=http://objects:9000` is unchanged.
- **Authentication is on.** With no credentials configured the gateway accepts any key pair, so the overlay requires
  `VERITY_S3_ACCESS_KEY_ID` and `VERITY_S3_SECRET_ACCESS_KEY` and passes them as the administrator identity. A wrong secret
  is refused (`SignatureDoesNotMatch`) and an anonymous request gets 403 (verified 2026-10-02).
- The master, volume and filer processes inside the container have no authentication of their own and are reachable from
  the other containers on the compose network. Acceptable for a convenience store; a reason to use external storage in an
  enterprise deployment.
- Migrating from a MinIO deployment is **not** automatic. The old data is in the `verity-object-data` volume, which this
  store never reads. Copy objects across with any S3 client before switching if they matter.
- Object bytes are still not included in `backup.sh`; see `backup-restore.md`.

`VERITY_WITH_MINIO=1` is a deprecated alias for `VERITY_WITH_BUNDLED_STORAGE=1` and prints a warning on every run that says
the store changed and nothing was migrated.

**A pin can outlive its image.** `deploy/scripts/check-image-pins.sh` (run weekly by `.github/workflows/image-pins.yml`)
asks each registry whether every pinned image still exists, so a withdrawn image is found within a week rather than by a
failed install. `--list` prints the references offline.

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
