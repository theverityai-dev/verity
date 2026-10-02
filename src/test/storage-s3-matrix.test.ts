import { createHash, randomUUID } from "node:crypto";
import { DeleteBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { ensureS3Bucket, probeS3Storage, resetS3Client, s3StorageDriver, type S3Settings } from "@/server/storage/s3";

/**
 * Live S3-provider matrix (object-storage audit, 2026-10-01; drill finding F4).
 *
 * Runs Verity's REAL driver against every S3-compatible server listed in
 * `VERITY_S3_MATRIX`, with the production call shape (the byte size passed to
 * `createUploadUrl`, as `reserveUpload` does). It is opt-in and skipped when the
 * variable is unset, so it never runs in CI by accident and no credential is ever
 * stored in the repository.
 *
 *   VERITY_S3_MATRIX='[{"label":"seaweedfs","endpoint":"http://127.0.0.1:8333",
 *     "bucket":"verity-matrix","accessKeyId":"…","secretAccessKey":"…"}]' \
 *   npx vitest run --config vitest.pure.config.mts src/test/storage-s3-matrix.test.ts
 *
 * Each entry: label, bucket, accessKeyId, secretAccessKey (required); endpoint
 * (omit for AWS S3), region (default us-east-1), forcePathStyle (default true when
 * an endpoint is given). The bucket must already exist and be disposable: objects
 * are written under `matrix/<uuid>/` and deleted again. Credentials come from the
 * environment only and are never printed.
 *
 * What a pass means is stated in deploy/docs/object-storage.md.
 */

type Entry = {
  label: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  region?: string;
  forcePathStyle?: boolean;
};

function loadMatrix(): Entry[] {
  const raw = process.env.VERITY_S3_MATRIX;
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("VERITY_S3_MATRIX must be a JSON array");
  return parsed.map((e, i) => {
    for (const k of ["label", "bucket", "accessKeyId", "secretAccessKey"] as const) {
      if (typeof (e as Record<string, unknown>)[k] !== "string" || !(e as Record<string, string>)[k]) {
        throw new Error(`VERITY_S3_MATRIX[${i}].${k} is required`);
      }
    }
    return e as Entry;
  });
}

const matrix = loadMatrix();
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const CHECKSUM_KEY = /^x-amz-(checksum-|sdk-checksum-algorithm)/i;

function settingsFor(e: Entry): S3Settings {
  return {
    bucket: e.bucket,
    region: e.region ?? "us-east-1",
    ...(e.endpoint ? { endpoint: e.endpoint } : {}),
    accessKeyId: e.accessKeyId,
    secretAccessKey: e.secretAccessKey,
    forcePathStyle: e.forcePathStyle ?? Boolean(e.endpoint),
  };
}

(matrix.length > 0 ? describe : describe.skip)("S3 provider matrix: production-shaped round trip", () => {
  for (const entry of matrix) {
    describe(entry.label, () => {
      const driver = () => {
        resetS3Client();
        return s3StorageDriver(settingsFor(entry));
      };

      it("accepts a presigned PUT carrying the production headers, and returns identical bytes", async () => {
        const d = driver();
        const bytes = Buffer.from(`verity matrix ${randomUUID()}\n`, "utf8");
        const key = `matrix/${randomUUID()}/round-trip.txt`;

        const upload = await d.createUploadUrl(key, "text/plain", bytes.byteLength);
        expect([...new URL(upload.url).searchParams.keys()].filter((k) => CHECKSUM_KEY.test(k))).toEqual([]);

        const put = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: bytes });
        expect(put.ok, `presigned PUT was refused with HTTP ${put.status}`).toBe(true);

        const got = await fetch(await d.createReadUrl(key, 60));
        expect(got.ok, `presigned GET was refused with HTTP ${got.status}`).toBe(true);
        expect(sha(new Uint8Array(await got.arrayBuffer()))).toBe(sha(bytes));

        await d.delete(key);
        const gone = await fetch(await d.createReadUrl(key, 60));
        expect(gone.ok, "object still readable after delete").toBe(false);
      }, 60_000);

      it("writes verified bytes server-side and refuses to overwrite the same key (If-None-Match)", async () => {
        const d = driver();
        const bytes = Buffer.from(`verity sealed ${randomUUID()}\n`, "utf8");
        const key = `matrix/${randomUUID()}/sealed.txt`;

        await d.storeVerified(key, bytes, "text/plain");
        const got = await fetch(await d.createReadUrl(key, 60));
        expect(sha(new Uint8Array(await got.arrayBuffer()))).toBe(sha(bytes));

        await expect(d.storeVerified(key, bytes, "text/plain")).rejects.toBeDefined();
        await d.delete(key);
      }, 60_000);

      it("ensureS3Bucket: creates a missing bucket, is idempotent, and refuses when creation is disabled", async () => {
        resetS3Client();
        const settings = { ...settingsFor(entry), bucket: `verity-ensure-${randomUUID().slice(0, 8)}` };
        const cleanup = new S3Client({
          region: settings.region,
          ...(settings.endpoint ? { endpoint: settings.endpoint } : {}),
          forcePathStyle: settings.forcePathStyle,
          credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
        });
        try {
          // disabled + missing: deterministic failure, and nothing was created
          await expect(ensureS3Bucket(settings, { create: false })).rejects.toThrow(/E_STORAGE_BUCKET_MISSING/);
          await expect(probeS3Storage(settings, AbortSignal.timeout(10_000))).rejects.toBeDefined();
          // enabled + missing: created
          await expect(ensureS3Bucket(settings, { create: true })).resolves.toBe("created");
          await expect(probeS3Storage(settings, AbortSignal.timeout(10_000))).resolves.toBeUndefined();
          // second run, either setting: exists, no change
          await expect(ensureS3Bucket(settings, { create: true })).resolves.toBe("exists");
          await expect(ensureS3Bucket(settings, { create: false })).resolves.toBe("exists");
        } finally {
          // only ever removes the uniquely named bucket this test created
          await cleanup.send(new DeleteBucketCommand({ Bucket: settings.bucket })).catch(() => undefined);
        }
      }, 60_000);

      it("reports an existing bucket as reachable and a missing bucket as an error", async () => {
        resetS3Client();
        const settings = settingsFor(entry);
        await expect(probeS3Storage(settings, AbortSignal.timeout(10_000))).resolves.toBeUndefined();
        await expect(
          probeS3Storage({ ...settings, bucket: `verity-no-such-bucket-${Date.now()}` }, AbortSignal.timeout(10_000)),
        ).rejects.toBeDefined();
      }, 30_000);
    });
  }
});
