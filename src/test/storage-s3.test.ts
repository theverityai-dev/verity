import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageDriver } from "@/server/platform/files";
import { checksumOf, storageKeyFor } from "@/server/platform/files";

/**
 * Task 41 — the second storage provider.
 * Plan: taskplans/archive/41_s3_storage_implementation.md.
 *
 * The claim under test is not "S3 works". It is that the seam Task 27 created
 * is real: a second implementation fits without `platform/files.ts` moving and
 * without a capability changing. The contract suite below is written once and
 * run against both drivers, because a contract only one implementation is held
 * to is not a contract.
 */

const ENV_KEYS = [
  "VERITY_STORAGE_DRIVER", "VERITY_S3_BUCKET", "VERITY_S3_REGION", "VERITY_S3_ENDPOINT",
  "VERITY_S3_ACCESS_KEY_ID", "VERITY_S3_SECRET_ACCESS_KEY", "VERITY_S3_FORCE_PATH_STYLE",
  "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_MEDIA_BUCKET",
  "DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

let snapshot: Record<string, string | undefined>;

beforeEach(() => {
  vi.resetModules();
  snapshot = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
  vi.restoreAllMocks();
});

const BASE_ENV = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/verity_test",
  NEXT_PUBLIC_SUPABASE_URL: "https://project-ref.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-for-test",
};

const S3_ENV = {
  VERITY_STORAGE_DRIVER: "s3",
  VERITY_S3_BUCKET: "verity-media",
  VERITY_S3_REGION: "ap-south-1",
  VERITY_S3_ENDPOINT: "https://objects.example.test",
  VERITY_S3_ACCESS_KEY_ID: "test-access-key-id",
  VERITY_S3_SECRET_ACCESS_KEY: "test-secret-access-key",
};

/* ------------------------------------------------------------------------- *
 * The shared contract, run against both drivers
 * ------------------------------------------------------------------------- */

/**
 * Every `StorageDriver` must satisfy this, whoever wrote it.
 *
 * Deliberately behavioural rather than structural: "has these three methods" is
 * what TypeScript already checks, and it is not what breaks. What breaks is a
 * driver that returns an empty URL, swallows an error, or reports success for
 * a delete that did not happen.
 */
function contractSuite(name: string, build: () => StorageDriver) {
  describe(`StorageDriver contract — ${name} (AC-03)`, () => {
    it("names itself, so an operator can tell which backend is bound", () => {
      expect(build().name).toMatch(/^(s3|supabase):/);
    });

    it("returns an upload URL and the content type it signed", async () => {
      const result = await build().createUploadUrl("tenant/abc/photo.jpg", "image/jpeg");

      expect(result.url).toMatch(/^https?:\/\//);
      expect(result.headers?.["content-type"]).toBe("image/jpeg");
    });

    it("returns a read URL for a key it is handed", async () => {
      const url = await build().createReadUrl("tenant/abc/photo.jpg", 300);
      expect(url).toMatch(/^https?:\/\//);
    });

    it("deletes without returning a value", async () => {
      await expect(build().delete("tenant/abc/photo.jpg")).resolves.toBeUndefined();
    });

    it("carries the tenant-namespaced key through unchanged", async () => {
      const key = storageKeyFor("11111111-1111-1111-1111-111111111111", "scan.pdf");
      const url = await build().createReadUrl(key, 60);

      // The platform namespaces by tenant so a driver misconfiguration cannot
      // cross tenants (AC-07). A driver that rewrote the key would defeat that
      // silently.
      expect(decodeURIComponent(url)).toContain("11111111-1111-1111-1111-111111111111");
    });
  });
}

/** A fake S3 client: the driver's own logic is what is under test, not the SDK. */
function fakeS3() {
  const sent: unknown[] = [];
  return {
    sent,
    client: { send: async (command: unknown) => { sent.push(command); return {}; } },
    sign: async (_client: unknown, command: { input: Record<string, unknown> }, options: { expiresIn: number }) =>
      `https://objects.example.test/verity-media/${String(command.input.Key)}` +
      `?X-Amz-Expires=${options.expiresIn}&X-Amz-Credential=AKIAEXAMPLE%2Fus-east-1&X-Amz-Signature=deadbeef`,
  };
}

async function buildS3Driver() {
  const { s3StorageDriver } = await import("@/server/storage/s3");
  const fake = fakeS3();
  return {
    fake,
    driver: s3StorageDriver(
      {
        bucket: "verity-media",
        region: "ap-south-1",
        endpoint: "https://objects.example.test",
        accessKeyId: "id",
        secretAccessKey: "secret",
        forcePathStyle: true,
      },
      { client: fake.client as never, sign: fake.sign as never },
    ),
  };
}

describe("both drivers satisfy one contract", () => {
  let s3: StorageDriver;
  let supabase: StorageDriver;

  beforeEach(async () => {
    Object.assign(process.env, BASE_ENV);

    s3 = (await buildS3Driver()).driver;

    vi.doMock("@supabase/supabase-js", () => ({
      createClient: () => ({
        storage: {
          getBucket: async () => ({ data: { public: false, file_size_limit: 25 * 1024 * 1024 }, error: null }),
          from: () => ({
            createSignedUploadUrl: async (key: string) => ({
              data: { signedUrl: `https://project-ref.supabase.co/storage/v1/${key}?token=x` },
              error: null,
            }),
            createSignedUrl: async (key: string) => ({
              data: { signedUrl: `https://project-ref.supabase.co/storage/v1/${key}?token=y` },
              error: null,
            }),
            remove: async () => ({ error: null }),
          }),
        },
      }),
    }));
    const { supabaseStorageDriver } = await import("@/server/storage/supabase");
    supabase = supabaseStorageDriver({
      url: "https://project-ref.supabase.co",
      serviceRoleKey: "service-role",
      bucket: "verity-media",
    });
  });

  contractSuite("s3", () => s3);
  contractSuite("supabase", () => supabase);
});

/* ------------------------------------------------------------------------- *
 * S3 driver specifics
 * ------------------------------------------------------------------------- */

describe("the S3 driver", () => {
  beforeEach(() => Object.assign(process.env, BASE_ENV));

  it("signs a PutObject with the declared content type and a bounded expiry", async () => {
    const { fake, driver } = await buildS3Driver();
    const signSpy = vi.spyOn(fake, "sign");
    // Rebuild so the spy is the function the driver holds.
    const { s3StorageDriver } = await import("@/server/storage/s3");
    const spied = s3StorageDriver(
      { bucket: "verity-media", region: "ap-south-1", accessKeyId: "id", secretAccessKey: "secret" },
      { client: fake.client as never, sign: signSpy as never },
    );

    await spied.createUploadUrl("t/1/x.pdf", "application/pdf");

    const [, command, options] = signSpy.mock.calls[0]!;
    expect((command as { input: Record<string, unknown> }).input).toMatchObject({
      Bucket: "verity-media",
      Key: "t/1/x.pdf",
      ContentType: "application/pdf",
    });
    expect((options as { expiresIn: number }).expiresIn).toBeGreaterThan(0);
    expect(driver.name).toBe("s3:verity-media");
  });

  it("honours the caller's read expiry rather than a fixed one", async () => {
    const { fake } = await buildS3Driver();
    const { s3StorageDriver } = await import("@/server/storage/s3");
    const signSpy = vi.fn(fake.sign);
    const driver = s3StorageDriver(
      { bucket: "b", region: "r", accessKeyId: "id", secretAccessKey: "s" },
      { client: fake.client as never, sign: signSpy as never },
    );

    await driver.createReadUrl("k", 42);
    expect((signSpy.mock.calls[0]![2] as { expiresIn: number }).expiresIn).toBe(42);
  });

  it("sends a DeleteObject for the key", async () => {
    const { fake, driver } = await buildS3Driver();
    await driver.delete("t/1/gone.pdf");

    expect(fake.sent).toHaveLength(1);
    expect((fake.sent[0] as { input: Record<string, unknown> }).input).toMatchObject({
      Bucket: "verity-media",
      Key: "t/1/gone.pdf",
    });
  });

  it("reports a failure as E_STORAGE without leaking the signature or key id (AC-08)", async () => {
    const { s3StorageDriver } = await import("@/server/storage/s3");
    const driver = s3StorageDriver(
      { bucket: "b", region: "r", accessKeyId: "id", secretAccessKey: "s" },
      {
        client: { send: async () => { throw new Error("boom"); } } as never,
        sign: (async () => {
          // The shape an SDK error genuinely takes: it quotes the URL it was
          // building, and a signed URL contains the key id and the signature.
          throw new Error(
            "failed signing https://o.test/b/k?X-Amz-Credential=AKIAREAL%2Fus-east-1&X-Amz-Signature=abcdef123456",
          );
        }) as never,
      },
    );

    await expect(driver.createUploadUrl("k", "text/plain")).rejects.toThrow(/E_STORAGE/);
    await expect(driver.createUploadUrl("k", "text/plain")).rejects.not.toThrow(/AKIAREAL/);
    await expect(driver.createUploadUrl("k", "text/plain")).rejects.not.toThrow(/abcdef123456/);
  });

  it("defaults path-style addressing on when an endpoint is configured (AC-06)", async () => {
    // MinIO and SeaweedFS serve path-style; AWS serves virtual-hosted. Getting
    // it wrong produces a signature computed against the wrong host, which
    // surfaces as SignatureDoesNotMatch and reads exactly like a bad secret.
    const constructed: Array<Record<string, unknown>> = [];
    vi.doMock("@aws-sdk/client-s3", async () => {
      const actual = await vi.importActual<typeof import("@aws-sdk/client-s3")>("@aws-sdk/client-s3");
      return {
        ...actual,
        S3Client: class {
          constructor(config: Record<string, unknown>) { constructed.push(config); }
          async send() { return {}; }
        },
      };
    });

    const { s3StorageDriver, resetS3Client } = await import("@/server/storage/s3");
    resetS3Client();
    s3StorageDriver({ bucket: "b", region: "r", endpoint: "https://minio.test", accessKeyId: "i", secretAccessKey: "s" });
    expect(constructed[0]!.forcePathStyle).toBe(true);

    resetS3Client();
    s3StorageDriver({ bucket: "b", region: "r", accessKeyId: "i", secretAccessKey: "s" });
    expect(constructed[1]!.forcePathStyle).toBe(false);

    resetS3Client();
    s3StorageDriver({ bucket: "b", region: "r", endpoint: "https://minio.test", accessKeyId: "i", secretAccessKey: "s", forcePathStyle: false });
    expect(constructed[2]!.forcePathStyle).toBe(false);
  });
});

/* ------------------------------------------------------------------------- *
 * Selection
 * ------------------------------------------------------------------------- */

describe("provider selection is configuration, not code (AC-04, AC-05)", () => {
  it("binds the S3 driver when configured for S3", async () => {
    Object.assign(process.env, BASE_ENV, S3_ENV);

    const { installStorage } = await import("@/server/storage");
    const { storageDriver } = await import("@/server/platform/files");
    installStorage();

    expect(storageDriver()?.name).toBe("s3:verity-media");
  });

  it("binds Supabase by default, so an existing deployment is unchanged", async () => {
    Object.assign(process.env, BASE_ENV, {
      SUPABASE_URL: "https://project-ref.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      SUPABASE_MEDIA_BUCKET: "verity-media",
    });
    delete process.env.VERITY_STORAGE_DRIVER;

    const { installStorage } = await import("@/server/storage");
    const { storageDriver } = await import("@/server/platform/files");
    installStorage();

    expect(storageDriver()?.name).toBe("supabase:verity-media");
  });

  it("binds nothing when S3 is selected but incompletely configured", async () => {
    Object.assign(process.env, BASE_ENV, { VERITY_STORAGE_DRIVER: "s3" });
    for (const key of ["VERITY_S3_BUCKET", "VERITY_S3_ACCESS_KEY_ID", "VERITY_S3_SECRET_ACCESS_KEY"]) {
      delete process.env[key];
    }

    const { installStorage } = await import("@/server/storage");
    const { storageDriver, StorageUnavailableError } = await import("@/server/platform/files");
    installStorage();

    // A deployment without storage is valid; the refusal happens at the point
    // of use, so sign-in is not taken down by a feature nobody reached for.
    expect(storageDriver()).toBeNull();
    expect(new StorageUnavailableError().code).toBe("E_STORAGE_UNAVAILABLE");
  });

  it("refuses an S3 configuration missing its credentials at the config boundary", async () => {
    Object.assign(process.env, BASE_ENV, {
      VERITY_STORAGE_DRIVER: "s3",
      VERITY_S3_BUCKET: "verity-media",
    });
    delete process.env.VERITY_S3_ACCESS_KEY_ID;
    delete process.env.VERITY_S3_SECRET_ACCESS_KEY;

    await expect(import("@/server/platform/config")).rejects.toThrow(/E_CONFIG_INVALID/);
  });
});

/* ------------------------------------------------------------------------- *
 * The finding that matters
 * ------------------------------------------------------------------------- */

describe("the seam held (AC-01, AC-02, AC-08)", () => {
  const ROOT = process.cwd();

  it("did not require platform/files.ts to change", () => {
    // Comments stripped: files.ts's own header mentions the S3 credentials
    // that were retired in Task 27, and a boundary test a paragraph can fail
    // is a test of the paragraph.
    const source = readFileSync(resolve(ROOT, "src/server/platform/files.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    // The test of an abstraction is not that it exists; it is that a second
    // implementation fits without the interface moving.
    expect(source).not.toMatch(/\bs3\b/i);
    expect(source).not.toMatch(/aws|minio|seaweed/i);
    expect(source).not.toMatch(/storage\.driver|VERITY_STORAGE_DRIVER/);
  });

  it("keeps every provider decision inside src/server/storage/", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (!full.includes(join("server", "storage"))) walk(full);
          continue;
        }
        if (!full.endsWith(".ts") && !full.endsWith(".tsx")) continue;
        const source = readFileSync(full, "utf8");
        if (/\bs3StorageDriver\b|@aws-sdk\/client-s3/.test(source)) offenders.push(full);
      }
    };
    walk(resolve(ROOT, "src/server"));
    walk(resolve(ROOT, "src/components"));

    expect(offenders).toEqual([]);
  });

  it("names no vendor extension: MinIO, SeaweedFS and AWS are one adapter", () => {
    const source = readFileSync(resolve(ROOT, "src/server/storage/s3.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    expect(source).not.toMatch(/seaweed/i);
    expect(source).not.toMatch(/minio/i);
    // Only the standard three commands; nothing vendor-specific.
    expect(source).toMatch(/PutObjectCommand|GetObjectCommand|DeleteObjectCommand/);
  });
});

/* ------------------------------------------------------------------------- *
 * Live round trip — opt-in
 * ------------------------------------------------------------------------- */

/**
 * Runs only when a real S3-compatible server is configured (AC-09).
 *
 * A mocked driver proves the driver's logic; it cannot prove that a presigned
 * PUT is actually accepted by a server, which is where signature version,
 * addressing style and clock skew all fail in practice. That is why this exists
 * and why it is not skipped quietly: the task records NOT EXECUTED with the
 * exact command when no server is available.
 *
 *   VERITY_S3_TEST_ENDPOINT=http://127.0.0.1:9000 \
 *   VERITY_S3_TEST_BUCKET=verity-test \
 *   VERITY_S3_TEST_ACCESS_KEY_ID=... \
 *   VERITY_S3_TEST_SECRET_ACCESS_KEY=... \
 *   npx vitest run src/test/storage-s3.test.ts
 */
const liveEndpoint = process.env.VERITY_S3_TEST_ENDPOINT;
const liveBucket = process.env.VERITY_S3_TEST_BUCKET;
const liveKeyId = process.env.VERITY_S3_TEST_ACCESS_KEY_ID;
const liveSecret = process.env.VERITY_S3_TEST_SECRET_ACCESS_KEY;
const hasLiveS3 = Boolean(liveEndpoint && liveBucket && liveKeyId && liveSecret);

(hasLiveS3 ? describe : describe.skip)("live S3 round trip (AC-09)", () => {
  it("uploads, reads back identical bytes, and deletes", async () => {
    // An earlier test in this file replaces `@aws-sdk/client-s3` to observe the
    // constructor's addressing-style default. `vi.doMock` survives
    // `restoreAllMocks`, so without this the live round trip would silently run
    // against the stub and pass for the wrong reason — the failure mode a live
    // test exists to eliminate.
    vi.doUnmock("@aws-sdk/client-s3");
    vi.resetModules();

    const { s3StorageDriver, resetS3Client } = await import("@/server/storage/s3");
    resetS3Client();
    const driver = s3StorageDriver({
      bucket: liveBucket!,
      region: process.env.VERITY_S3_TEST_REGION ?? "us-east-1",
      endpoint: liveEndpoint!,
      accessKeyId: liveKeyId!,
      secretAccessKey: liveSecret!,
      forcePathStyle: true,
    });

    const key = storageKeyFor(randomUUID(), "round-trip.txt");
    const bytes = Buffer.from(`verity storage round trip ${randomUUID()}`, "utf8");

    // The production call shape: `reserveUpload` always passes the declared size.
    const upload = await driver.createUploadUrl(key, "text/plain", bytes.byteLength);
    const put = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: bytes });
    expect(put.ok, `PUT failed: ${put.status}`).toBe(true);

    const readUrl = await driver.createReadUrl(key, 60);
    const got = await fetch(readUrl);
    expect(got.ok).toBe(true);

    const returned = Buffer.from(await got.arrayBuffer());
    // Checksum, not length: a truncated or re-encoded object is the failure a
    // length comparison misses.
    expect(checksumOf(returned)).toBe(checksumOf(bytes));

    await driver.delete(key);
    const afterDelete = await fetch(await driver.createReadUrl(key, 60));
    expect(afterDelete.ok).toBe(false);
  }, 60_000);
});
