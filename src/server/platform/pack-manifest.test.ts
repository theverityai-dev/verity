import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  packManifestBytes,
  packManifestDigest,
  packManifestSchema,
  validateSignedPack,
  versionSatisfies,
  type PackManifest,
  type SignedPackEnvelope,
} from "./pack-manifest";

const keys = generateKeyPairSync("ed25519");
const publicPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const trusted = new Map([["verity-labs", new Map([["release-1", publicPem]])]]);

const manifest: PackManifest = packManifestSchema.parse({
  schemaVersion: 1,
  key: "verity.pack.sample",
  version: "1.0.0",
  name: "Sample pack",
  platform: ">=0.1.0 <1.0.0",
  configSchemaVersion: "1.0.0",
  requiredCapabilities: [{ id: "verity.capability.location", version: "^1.0.0" }],
  contributions: [{ id: "verity.pack.sample.dashboard", kind: "dashboard" }],
  rollback: "reversible",
});

function envelope(value: PackManifest = manifest): SignedPackEnvelope {
  return {
    manifest: value,
    digest: packManifestDigest(value),
    signature: {
      algorithm: "Ed25519",
      publisher: "verity-labs",
      keyId: "release-1",
      value: sign(null, packManifestBytes(value), keys.privateKey).toString("base64"),
    },
  };
}

describe("pack key format", () => {
  const withKey = (key: string) => packManifestSchema.safeParse({ ...manifest, key }).success;

  it("accepts namespaced keys, including words joined by a single underscore", () => {
    expect(withKey("verity.pack.sample")).toBe(true);
    expect(withKey("verity.pack.test_sample")).toBe(true);
    expect(withKey("verity.pack.franchise-ops_v2")).toBe(true);
  });

  it("rejects keys with a leading, trailing or doubled underscore, or unsafe characters", () => {
    for (const key of ["verity.pack._sample", "verity.pack.sample_", "verity.pack.sa__mple", "verity", "Verity.pack.x", "verity.pack/x", "verity.pack. x", "../etc.passwd"]) {
      expect(withKey(key), key).toBe(false);
    }
  });

  it("accepts a real platform capability id as a requirement", () => {
    const requires = [{ id: "verity.capability.decision_egress", version: "^1.0.0" }];
    expect(packManifestSchema.safeParse({ ...manifest, requiredCapabilities: requires }).success).toBe(true);
  });
});

describe("Industry Pack manifest trust boundary", () => {
  it("accepts a canonical, trusted, compatible signed manifest", () => {
    expect(validateSignedPack(envelope(), trusted, "0.1.0")).toMatchObject({
      digest: packManifestDigest(manifest),
      publisher: "verity-labs",
      keyId: "release-1",
    });
  });

  it("rejects tampering after signing", () => {
    const signed = envelope();
    signed.manifest = { ...manifest, name: "Tampered" };
    expect(() => validateSignedPack(signed, trusted, "0.1.0")).toThrow(/digest mismatch/);
  });

  it("rejects an untrusted publisher key", () => {
    expect(() => validateSignedPack(envelope(), new Map(), "0.1.0")).toThrow(/not trusted/);
  });

  it("rejects incompatible platform versions and contribution collisions", () => {
    expect(() => validateSignedPack(envelope(), trusted, "2.0.0")).toThrow(/requires platform/);
    const duplicate = packManifestSchema.parse({
      ...manifest,
      contributions: [manifest.contributions[0], manifest.contributions[0]],
    });
    expect(() => validateSignedPack(envelope(duplicate), trusted, "0.1.0")).toThrow(/duplicate/);
  });

  it("implements only the documented closed version-range grammar", () => {
    expect(versionSatisfies("1.4.2", "^1.2.0")).toBe(true);
    expect(versionSatisfies("2.0.0", "^1.2.0")).toBe(false);
    expect(versionSatisfies("1.4.2", ">=1.0.0 <2.0.0")).toBe(true);
    expect(versionSatisfies("1.4.2", "latest")).toBe(false);
  });
});
