import type { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { ensureS3Bucket, type S3Settings } from "@/server/storage/s3";

/**
 * Drill finding F5 (object-storage audit, 2026-10-01): nothing created the bucket,
 * readiness failed on its absence, and the installer ends by requiring readiness.
 *
 * `ensureS3Bucket` is provisioning, never reconciliation. These tests drive it with
 * an injected client that records every command, so they also prove what it does
 * NOT do: it never deletes a bucket, never changes one that exists, and never
 * creates one when told it must not.
 */

type Handler = (input: Record<string, unknown>) => unknown;

function fakeClient(handlers: Record<string, Handler | Handler[]>) {
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const counters: Record<string, number> = {};
  const client = {
    async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
      const name = command.constructor.name;
      calls.push({ name, input: command.input });
      const entry = handlers[name];
      if (!entry) throw new Error(`unexpected command ${name}`);
      const index = (counters[name] = (counters[name] ?? 0) + 1) - 1;
      const handler = Array.isArray(entry) ? entry[Math.min(index, entry.length - 1)] : entry;
      return handler(command.input);
    },
  } as unknown as S3Client;
  return { client, calls, names: () => calls.map((c) => c.name) };
}

const sdkError = (name: string, httpStatusCode: number, message = name) =>
  Object.assign(new Error(message), { name, $metadata: { httpStatusCode } });

const ok: Handler = () => ({});
const notFound: Handler = () => {
  throw sdkError("NotFound", 404);
};

const settings: S3Settings = {
  bucket: "verity-media",
  region: "us-east-1",
  endpoint: "http://objects.invalid:9000",
  accessKeyId: "test-access-key-id",
  secretAccessKey: "test-secret-access-key",
  forcePathStyle: true,
};

const SAFE = new Set(["HeadBucketCommand", "CreateBucketCommand"]);

describe("ensureS3Bucket (drill finding F5)", () => {
  it("does nothing but look when the bucket already exists, whatever its settings", async () => {
    const f = fakeClient({ HeadBucketCommand: ok });
    await expect(ensureS3Bucket(settings, { create: true }, { client: f.client })).resolves.toBe("exists");
    expect(f.names()).toEqual(["HeadBucketCommand"]);
    expect(f.calls[0].input).toEqual({ Bucket: "verity-media" });
  });

  it("does nothing but look when it exists and creation is disabled", async () => {
    const f = fakeClient({ HeadBucketCommand: ok });
    await expect(ensureS3Bucket(settings, { create: false }, { client: f.client })).resolves.toBe("exists");
    expect(f.names()).toEqual(["HeadBucketCommand"]);
  });

  it("creates a missing bucket when creation is enabled, then confirms it", async () => {
    const f = fakeClient({ HeadBucketCommand: [notFound, ok], CreateBucketCommand: ok });
    await expect(ensureS3Bucket(settings, { create: true }, { client: f.client })).resolves.toBe("created");
    expect(f.names()).toEqual(["HeadBucketCommand", "CreateBucketCommand", "HeadBucketCommand"]);
    // Strictly the bucket: no ACL, no object lock, no versioning, no location unless the service needs one.
    expect(f.calls[1].input).toEqual({ Bucket: "verity-media" });
  });

  it("treats NoSuchBucket the same as NotFound", async () => {
    const f = fakeClient({
      HeadBucketCommand: [() => { throw sdkError("NoSuchBucket", 404); }, ok],
      CreateBucketCommand: ok,
    });
    await expect(ensureS3Bucket(settings, { create: true }, { client: f.client })).resolves.toBe("created");
  });

  it("fails deterministically, creating nothing, when the bucket is missing and creation is disabled", async () => {
    const f = fakeClient({ HeadBucketCommand: notFound });
    await expect(ensureS3Bucket(settings, { create: false }, { client: f.client })).rejects.toThrow(
      /E_STORAGE_BUCKET_MISSING[\s\S]*"verity-media"[\s\S]*VERITY_STORAGE_CREATE_BUCKET/,
    );
    expect(f.names()).toEqual(["HeadBucketCommand"]);
  });

  it("surfaces a permission error clearly and does not try to create", async () => {
    const f = fakeClient({ HeadBucketCommand: () => { throw sdkError("Forbidden", 403); } });
    const error = await ensureS3Bucket(settings, { create: true }, { client: f.client }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/E_STORAGE: could not check bucket "verity-media"/);
    expect((error as Error).message).toMatch(/Forbidden/);
    expect((error as Error).message).toMatch(/403/);
    expect((error as Error).message).toMatch(/nothing was created/i);
    expect(f.names()).toEqual(["HeadBucketCommand"]);
  });

  it("surfaces a server error clearly and does not try to create", async () => {
    const f = fakeClient({ HeadBucketCommand: () => { throw sdkError("InternalError", 500); } });
    await expect(ensureS3Bucket(settings, { create: true }, { client: f.client })).rejects.toThrow(/InternalError[\s\S]*500/);
    expect(f.names()).toEqual(["HeadBucketCommand"]);
  });

  it("surfaces a refused creation clearly", async () => {
    const f = fakeClient({
      HeadBucketCommand: notFound,
      CreateBucketCommand: () => { throw sdkError("AccessDenied", 403); },
    });
    await expect(ensureS3Bucket(settings, { create: true }, { client: f.client })).rejects.toThrow(
      /E_STORAGE: could not create bucket "verity-media"[\s\S]*AccessDenied[\s\S]*403/,
    );
  });

  it("tolerates losing a creation race to ourselves (BucketAlreadyOwnedByYou)", async () => {
    const f = fakeClient({
      HeadBucketCommand: [notFound, ok],
      CreateBucketCommand: () => { throw sdkError("BucketAlreadyOwnedByYou", 409); },
    });
    await expect(ensureS3Bucket(settings, { create: true }, { client: f.client })).resolves.toBe("exists");
  });

  it("refuses a name that belongs to someone else (BucketAlreadyExists)", async () => {
    const f = fakeClient({
      HeadBucketCommand: notFound,
      CreateBucketCommand: () => { throw sdkError("BucketAlreadyExists", 409); },
    });
    await expect(ensureS3Bucket(settings, { create: true }, { client: f.client })).rejects.toThrow(
      /E_STORAGE_BUCKET_UNAVAILABLE[\s\S]*"verity-media"[\s\S]*another account/,
    );
  });

  it("does not report success if the bucket still cannot be reached after creating it", async () => {
    const f = fakeClient({ HeadBucketCommand: notFound, CreateBucketCommand: ok });
    await expect(ensureS3Bucket(settings, { create: true }, { client: f.client })).rejects.toThrow(/after creating it/);
  });

  it("asks for a location constraint only on AWS outside us-east-1, never for a custom endpoint", async () => {
    const aws = fakeClient({ HeadBucketCommand: [notFound, ok], CreateBucketCommand: ok });
    await ensureS3Bucket(
      { ...settings, endpoint: undefined, region: "eu-west-1", forcePathStyle: undefined },
      { create: true },
      { client: aws.client },
    );
    expect(aws.calls[1].input).toEqual({
      Bucket: "verity-media",
      CreateBucketConfiguration: { LocationConstraint: "eu-west-1" },
    });

    const awsEast = fakeClient({ HeadBucketCommand: [notFound, ok], CreateBucketCommand: ok });
    await ensureS3Bucket({ ...settings, endpoint: undefined }, { create: true }, { client: awsEast.client });
    expect(awsEast.calls[1].input).toEqual({ Bucket: "verity-media" });

    const custom = fakeClient({ HeadBucketCommand: [notFound, ok], CreateBucketCommand: ok });
    await ensureS3Bucket({ ...settings, region: "eu-west-1" }, { create: true }, { client: custom.client });
    expect(custom.calls[1].input).toEqual({ Bucket: "verity-media" });
  });

  it("never sends a destructive or reconfiguring command in any scenario", async () => {
    const scenarios = [
      fakeClient({ HeadBucketCommand: ok }),
      fakeClient({ HeadBucketCommand: [notFound, ok], CreateBucketCommand: ok }),
      fakeClient({ HeadBucketCommand: notFound }),
      fakeClient({ HeadBucketCommand: () => { throw sdkError("Forbidden", 403); } }),
      fakeClient({ HeadBucketCommand: notFound, CreateBucketCommand: () => { throw sdkError("BucketAlreadyExists", 409); } }),
    ];
    for (const [index, f] of scenarios.entries()) {
      await ensureS3Bucket(settings, { create: index !== 2 }, { client: f.client }).catch(() => undefined);
      for (const name of f.names()) expect(SAFE.has(name), `${name} in scenario ${index}`).toBe(true);
    }
  });

  it("keeps credentials out of error text", async () => {
    const f = fakeClient({
      HeadBucketCommand: () => {
        throw sdkError("Forbidden", 403, "denied for https://h/b?X-Amz-Credential=AKIDEXAMPLE%2F2026&X-Amz-Signature=deadbeef");
      },
    });
    const error = (await ensureS3Bucket(settings, { create: true }, { client: f.client }).catch((e: Error) => e)) as Error;
    expect(error.message).not.toMatch(/AKIDEXAMPLE|deadbeef/);
  });
});
