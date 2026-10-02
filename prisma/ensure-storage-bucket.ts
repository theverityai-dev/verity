/**
 * Install-time step: make sure the configured S3 bucket exists.
 *
 * Authority: object-storage audit, drill finding F5 (2026-10-01).
 *
 * WHY THIS EXISTS
 * Nothing created the bucket. Readiness fails when it is missing and the
 * installer ends by requiring readiness, so every first install needed a
 * hand-run step the documentation never mentioned.
 *
 * WHAT IT DOES
 * Calls `ensureS3Bucket` with `VERITY_STORAGE_CREATE_BUCKET`:
 *   true (default)  create the bucket only if it is missing
 *   false           the customer owns provisioning: fail, creating nothing, if missing
 * It is provisioning, never reconciliation: an existing bucket is left exactly as
 * it is. A deployment that does not use the S3 driver, or has no complete S3
 * settings, has nothing to provision and exits 0.
 *
 * It waits up to a minute for an object store that is still starting (no HTTP
 * answer yet). Any real answer, a refusal or a server error, is final.
 *
 * Run as the other operator steps are, in the tools image:
 *   node prisma/run-seed.cjs ensure-storage-bucket.ts
 */

import { runtimeConfig } from "../src/server/platform/config";
import { ensureS3Bucket } from "../src/server/storage/s3";

const WAIT_MS = 60_000;
const RETRY_MS = 2_000;

const log = (text: string) => console.log(`[verity] ${text}`);

/** An error that carries no HTTP status never reached a server's answer: connection refused, DNS, timeout. */
function noServerAnswer(error: unknown): boolean {
  const cause = (error as { cause?: { $metadata?: { httpStatusCode?: number } } } | null)?.cause;
  return cause !== undefined && cause !== null && cause.$metadata?.httpStatusCode === undefined;
}

async function main(): Promise<void> {
  const storage = runtimeConfig.storage;
  if (storage.driver !== "s3") {
    log(`storage driver is "${storage.driver}", not s3: no bucket to provision`);
    return;
  }
  if (!storage.s3) {
    log("VERITY_STORAGE_DRIVER=s3 but the S3 settings are incomplete: nothing to provision (file features will refuse at the point of use)");
    return;
  }

  const s3 = storage.s3;
  const settings = { ...s3, forcePathStyle: s3.forcePathStyle ?? Boolean(s3.endpoint) };
  const where = s3.endpoint ?? "AWS";
  log(`checking bucket "${s3.bucket}" at ${where} (create when missing: ${storage.createBucket})`);

  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    try {
      const outcome = await ensureS3Bucket(settings, { create: storage.createBucket, signal: AbortSignal.timeout(10_000) });
      log(outcome === "created" ? `created bucket "${s3.bucket}"` : `bucket "${s3.bucket}" already exists; left unchanged`);
      return;
    } catch (error) {
      if (noServerAnswer(error) && Date.now() < deadline) {
        log("the object store is not answering yet; waiting");
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
        continue;
      }
      throw error;
    }
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(`[verity] ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
