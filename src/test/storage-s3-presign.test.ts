import { describe, expect, it } from "vitest";
import { resetS3Client, s3StorageDriver } from "@/server/storage/s3";

/**
 * Drill finding F4 (object-storage audit, 2026-10-01).
 *
 * Since AWS SDK for JavaScript v3.729 the default `requestChecksumCalculation`
 * is `WHEN_SUPPORTED`. A presigned PutObject then carries
 * `x-amz-checksum-crc32` and `x-amz-sdk-checksum-algorithm` in its query string,
 * and the CRC32 is computed over an EMPTY body: whoever holds the URL chooses
 * the bytes later. A server that validates the value against the real upload
 * rejects every upload (SeaweedFS: 400 BadDigest); a server that ignores it
 * accepts (MinIO, RustFS). Real AWS S3 is reported to reject it too.
 *
 * Verity needs no flexible checksum on the URL: `confirmUpload` re-reads the
 * stored bytes and checks size, sha256 and file type itself. So the driver must
 * not inject one. These tests assert the shape of the URL a client is handed, so
 * they need no server: presigning is a local computation.
 */

const settings = {
  bucket: "verity-media",
  region: "us-east-1",
  endpoint: "http://objects.invalid:9000",
  accessKeyId: "test-access-key-id",
  secretAccessKey: "test-secret-access-key",
  forcePathStyle: true,
};

const CHECKSUM_KEY = /^x-amz-(checksum-|sdk-checksum-algorithm)/i;

function checksumKeys(url: string): string[] {
  return [...new URL(url).searchParams.keys()].filter((k) => CHECKSUM_KEY.test(k));
}

function signedHeaders(url: string): string[] {
  return (new URL(url).searchParams.get("X-Amz-SignedHeaders") ?? "").split(";").filter(Boolean);
}

describe("presigned upload URL carries no automatic checksum requirement (drill finding F4)", () => {
  it("has no checksum query parameter in the production call shape (with a byte size)", async () => {
    resetS3Client();
    const driver = s3StorageDriver(settings);
    const { url } = await driver.createUploadUrl("t/1/file.txt", "text/plain", 1234);
    expect(checksumKeys(url)).toEqual([]);
  });

  it("has no checksum query parameter when no byte size is given", async () => {
    resetS3Client();
    const driver = s3StorageDriver(settings);
    const { url } = await driver.createUploadUrl("t/1/file.txt", "text/plain");
    expect(checksumKeys(url)).toEqual([]);
  });

  it("signs no checksum header and hands the client none", async () => {
    resetS3Client();
    const driver = s3StorageDriver(settings);
    const { url, headers } = await driver.createUploadUrl("t/1/file.txt", "text/plain", 1234);
    expect(signedHeaders(url).filter((h) => /checksum/i.test(h))).toEqual([]);
    expect(Object.keys(headers ?? {}).filter((h) => /checksum/i.test(h))).toEqual([]);
  });

  it("still signs what the platform relies on: the declared length and if-none-match", async () => {
    resetS3Client();
    const driver = s3StorageDriver(settings);
    const { url, headers } = await driver.createUploadUrl("t/1/file.txt", "text/plain", 1234);
    // Content type is not signed (the presigner treats it as unsignable); the driver hands it back
    // as a header the client sends, and the platform never treats it as a control.
    expect(signedHeaders(url)).toEqual(expect.arrayContaining(["host", "content-length", "if-none-match"]));
    expect(headers).toEqual({ "content-type": "text/plain", "if-none-match": "*" });
    expect(new URL(url).searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(new URL(url).searchParams.get("X-Amz-Expires")).toBe("900");
  });

  it("has no checksum query parameter on a read URL either", async () => {
    resetS3Client();
    const driver = s3StorageDriver(settings);
    const url = await driver.createReadUrl("t/1/file.txt", 60);
    expect(checksumKeys(url)).toEqual([]);
  });
});
