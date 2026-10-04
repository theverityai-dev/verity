import "server-only";
import {
  type BucketLocationConstraint,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageDriver } from "@/server/platform/files";

/**
 * An S3-compatible object store as a `StorageDriver`.
 *
 * Authority: taskplans/archive/41_s3_storage_implementation.md; Task 27 created the
 * seam this fills.
 *
 * WHY A SECOND DRIVER EXISTS AT ALL
 * The test of an abstraction is not that it exists; it is that a second
 * implementation fits without the interface moving. `platform/files.ts` is
 * unchanged by this file, and so is every capability. That is the finding, and
 * it is worth more than the driver.
 *
 * S3-COMPATIBLE, NOT VENDOR-SPECIFIC
 * Nothing here knows about AWS, MinIO, SeaweedFS, Ceph or Wasabi. They are one
 * adapter with different configuration — an endpoint, a region, a bucket, a key
 * pair, and an addressing style. A driver written against one vendor's
 * extensions would have made the next deployment a fork, which is the outcome
 * this whole seam exists to prevent.
 *
 * Uploads use signed URLs; confirmation reads at most the reserved size and
 * writes the verified bytes to a fresh, non-uploadable key. Reads are signed
 * attachment downloads. Keep the bucket private at deployment.
 */

export type S3Settings = {
  bucket: string;
  region: string;
  /** Omit for AWS; required for MinIO, SeaweedFS, Ceph and every other server. */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * Path-style addressing (`https://host/bucket/key`) rather than
   * virtual-hosted (`https://bucket.host/key`).
   *
   * This matters more than it looks. MinIO and SeaweedFS serve path-style; AWS
   * serves virtual-hosted. Getting it wrong produces a signature computed
   * against the wrong host, which surfaces as `SignatureDoesNotMatch` and reads
   * exactly like a bad secret key — an operator can lose a day to it.
   */
  forcePathStyle?: boolean;
};

/** Reused across calls: an S3 client is a connection pool, not a request object. */
let cached: { key: string; client: S3Client } | null = null;

function clientFor(settings: S3Settings): S3Client {
  const key = `${settings.endpoint ?? "aws"}|${settings.region}|${settings.accessKeyId}|${settings.forcePathStyle ?? false}`;
  if (cached?.key === key) return cached.client;

  const client = new S3Client({
    region: settings.region,
    ...(settings.endpoint ? { endpoint: settings.endpoint } : {}),
    forcePathStyle: settings.forcePathStyle ?? Boolean(settings.endpoint),
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
    // CHECKSUM BEHAVIOUR: ONLY WHEN THE OPERATION REQUIRES ONE (drill finding F4)
    //
    // Since SDK v3.729 the default is WHEN_SUPPORTED, which makes a presigned
    // PutObject carry `x-amz-checksum-crc32` and `x-amz-sdk-checksum-algorithm`
    // in its query string. The CRC32 is computed over an EMPTY body, because the
    // holder of the URL chooses the bytes later. A server that validates it
    // against the real upload rejects every upload with BadDigest; one that
    // ignores it accepts. AWS S3 itself is reported to reject it. A presigned
    // GET likewise gains `x-amz-checksum-mode`.
    //
    // Verity needs neither: `confirmUpload` re-reads the stored bytes and checks
    // size, sha256 and file type itself, so an upload is verified end to end by
    // the platform and not by a transport checksum nobody can set correctly in
    // advance. WHEN_REQUIRED sends a checksum only for operations that mandate
    // one, which none of these (PutObject, GetObject, DeleteObject, HeadBucket)
    // do. See deploy/docs/object-storage.md.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  cached = { key, client };
  return client;
}

/** Test seam: drops the cached client so a new configuration takes effect. */
export function resetS3Client(): void {
  cached = null;
}

/** Non-destructive bucket reachability/authorization probe for readiness. */
export async function probeS3Storage(settings: S3Settings, signal: AbortSignal): Promise<void> {
  await clientFor(settings).send(new HeadBucketCommand({ Bucket: settings.bucket }), { abortSignal: signal });
}

export type EnsureBucketOutcome = "exists" | "created";

function errorName(error: unknown): string {
  return (error as { name?: string } | null)?.name ?? "Error";
}

function errorStatus(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
}

/** "Forbidden, HTTP 403: <sanitized text>": enough to act on, never a credential. */
function describeError(error: unknown): string {
  const status = errorStatus(error);
  const text = message(error);
  const name = errorName(error);
  return `${name}${status ? `, HTTP ${status}` : ""}${text && text !== name ? `: ${text}` : ""}`;
}

/**
 * Makes sure the configured bucket exists. PROVISIONING, NEVER RECONCILIATION.
 *
 * Drill finding F5: nothing created the bucket, readiness fails without it, and
 * the installer ends by requiring readiness, so every first install needed a
 * hand-run step the documentation never mentioned.
 *
 * What it does, and all it does:
 *  - the bucket exists: nothing else happens. Its settings, policy, versioning,
 *    ownership, contents and metadata are not read, compared or touched. An
 *    existing bucket is a customer's state, however unexpected it looks.
 *  - it is missing and `create` is true: one CreateBucket (the name only, plus a
 *    location where the service requires one), then a confirming probe.
 *  - it is missing and `create` is false: a deterministic failure that creates
 *    nothing. `false` means the customer owns provisioning; it is never read as
 *    "assume it exists".
 *  - anything else (no permission, server error, network): the error, clearly,
 *    and no attempt to create.
 *
 * It sends only HeadBucket and CreateBucket. No delete, no ACL, no policy, no
 * versioning, no lifecycle: a test asserts the command set.
 */
export async function ensureS3Bucket(
  settings: S3Settings,
  options: { create: boolean; signal?: AbortSignal },
  deps: { client?: S3Client } = {},
): Promise<EnsureBucketOutcome> {
  const client = deps.client ?? clientFor(settings);
  const { bucket } = settings;
  const head = () =>
    client.send(new HeadBucketCommand({ Bucket: bucket }), options.signal ? { abortSignal: options.signal } : undefined);

  try {
    await head();
    return "exists";
  } catch (error) {
    const missing = errorName(error) === "NotFound" || errorName(error) === "NoSuchBucket" || errorStatus(error) === 404;
    if (!missing) {
      throw new Error(
        `E_STORAGE: could not check bucket "${bucket}" (${describeError(error)}); nothing was created. ` +
          "Check that the endpoint is reachable and that the credentials may access this bucket.",
        // Kept so the installer can tell "the server is not up yet" (no HTTP answer) from a real refusal.
        { cause: error },
      );
    }
    if (!options.create) {
      throw new Error(
        `E_STORAGE_BUCKET_MISSING: bucket "${bucket}" does not exist and VERITY_STORAGE_CREATE_BUCKET is false, ` +
          "so the installer will not create it. Create the bucket yourself, or set VERITY_STORAGE_CREATE_BUCKET=true.",
      );
    }
  }

  // A bucket that is created but cannot then be reached is not a success.
  const confirm = () =>
    head().catch((error: unknown) => {
      throw new Error(`E_STORAGE: bucket "${bucket}" is still unreachable after creating it (${describeError(error)}).`);
    });

  // Outside us-east-1 the AWS service demands a location; a custom endpoint is
  // sent the bucket name alone, which every server tried so far accepts.
  const needsLocation = !settings.endpoint && settings.region !== "us-east-1";
  try {
    await client.send(
      new CreateBucketCommand({
        Bucket: bucket,
        ...(needsLocation
          ? { CreateBucketConfiguration: { LocationConstraint: settings.region as BucketLocationConstraint } }
          : {}),
      }),
      options.signal ? { abortSignal: options.signal } : undefined,
    );
  } catch (error) {
    const name = errorName(error);
    if (name === "BucketAlreadyOwnedByYou") {
      // Lost a creation race to ourselves: it exists and is ours.
    } else if (name === "BucketAlreadyExists") {
      throw new Error(
        `E_STORAGE_BUCKET_UNAVAILABLE: the bucket name "${bucket}" is already taken by another account. ` +
          "Choose a different VERITY_S3_BUCKET.",
      );
    } else {
      throw new Error(`E_STORAGE: could not create bucket "${bucket}" (${describeError(error)}).`);
    }
    await confirm();
    return "exists";
  }

  await confirm();
  return "created";
}

export function s3StorageDriver(
  settings: S3Settings,
  deps: { sign?: typeof getSignedUrl; client?: S3Client } = {},
): StorageDriver {
  const client = deps.client ?? clientFor(settings);
  const sign = deps.sign ?? getSignedUrl;

  return {
    // Names the bucket, not the vendor: two S3 deployments against different
    // buckets are legitimately different drivers to an operator reading a log.
    name: `s3:${settings.bucket}`,

    async createUploadUrl(key, mimeType, byteSize) {
      try {
        const url = await sign(
          client,
          new PutObjectCommand({
            Bucket: settings.bucket,
            Key: key,
            ContentType: mimeType,
            ContentLength: byteSize,
            IfNoneMatch: "*",
          }),
          { expiresIn: 900 },
        );
        return {
          url,
          // Signed into the request, so it must be sent. The platform still
          // re-checks size and checksum on confirmation — a client-declared
          // content type is a convenience, never a control.
          headers: { "content-type": mimeType, "if-none-match": "*" },
        };
      } catch (error) {
        throw new Error(`E_STORAGE: could not create an upload URL (${message(error)})`);
      }
    },

    async createReadUrl(key, expiresInSeconds) {
      try {
        return await sign(
          client,
          new GetObjectCommand({ Bucket: settings.bucket, Key: key, ResponseContentDisposition: "attachment" }),
          { expiresIn: expiresInSeconds },
        );
      } catch (error) {
        throw new Error(`E_STORAGE: could not create a read URL (${message(error)})`);
      }
    },

    async storeVerified(key, bytes, mimeType) {
      await client.send(new PutObjectCommand({
        Bucket: settings.bucket, Key: key, Body: bytes,
        ContentType: mimeType, ContentLength: bytes.byteLength, IfNoneMatch: "*",
      }));
    },

    async delete(key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: settings.bucket, Key: key }));
      } catch (error) {
        throw new Error(`E_STORAGE: could not delete the object (${message(error)})`);
      }
    },
  };
}

/**
 * Error text without the credential.
 *
 * An SDK error can carry the signed URL or the request it was building, and a
 * signed URL contains the access key id and the signature. This is the same
 * discipline `integration.ts` applies to transport errors.
 */
function message(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/X-Amz-Credential=[^&\s]+/gi, "X-Amz-Credential=[redacted]")
    .replace(/X-Amz-Signature=[^&\s]+/gi, "X-Amz-Signature=[redacted]");
}
