import { createHash, verify } from "node:crypto";
import { z } from "zod";

const semver = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "must be semantic version");
// Dot- or dash-separated segments of lowercase letters and digits, where a
// segment may join words with single underscores. The platform's own keys use
// them (`verity.capability.decision_egress`, `verity.dinein.order_line`), so a
// pack naming a real capability or entity must be accepted. No leading,
// trailing or doubled underscore, no whitespace and no path characters.
const SEGMENT = "[a-z0-9]+(?:_[a-z0-9]+)*";
const stableKey = z
  .string()
  .regex(new RegExp(`^[a-z][a-z0-9]*(?:_[a-z0-9]+)*(?:[.-]${SEGMENT})+$`), "must be a stable namespaced key");
const versionRange = z.string().min(1).max(100);

const capabilityRequirement = z.object({
  id: stableKey,
  version: versionRange,
});

const contribution = z.object({
  id: stableKey,
  kind: z.enum(["dashboard", "form", "document", "checklist", "workflow", "navigation"]),
  ownerCapability: stableKey.optional(),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const packManifestSchema = z.object({
  schemaVersion: z.literal(1),
  key: stableKey,
  version: semver,
  name: z.string().min(1).max(120),
  description: z.string().max(2_000).default(""),
  platform: versionRange,
  requiredCapabilities: z.array(capabilityRequirement).default([]),
  optionalCapabilities: z.array(capabilityRequirement).default([]),
  conflicts: z.array(stableKey).default([]),
  configSchemaVersion: semver,
  configDefaults: z.record(stableKey, z.unknown()).default({}),
  /**
   * WP-11B's "Extension package contract" §"CSP/resource declaration for any
   * reviewed client asset". A narrowly-scoped pack (empty `roles`, one or two
   * `contributions`) IS the extension package WP-11B describes — see that
   * work package's own instruction to reuse existing activation/contribution
   * records rather than build a second, near-duplicate control plane. This
   * field is the one piece a pack didn't already need: exact resource URLs
   * an extension's client-side contribution may load, enforced by the
   * shell's CSP, never a wildcard or inline-script allowance.
   */
  cspAssets: z.array(z.string().url()).max(20).default([]),
  roles: z.array(z.object({
    key: stableKey,
    permissions: z.array(z.object({
      entity: stableKey,
      // Matches Prisma `PermissionVerb` exactly (Spec PLA-AUT-003) — a pack role
      // grants real permissions, so its vocabulary cannot diverge from the
      // platform's.
      verbs: z.array(z.enum(["Create", "Read", "Edit", "Delete", "ActionExecute"])).min(1),
    })),
  })).default([]),
  contributions: z.array(contribution).default([]),
  preconditions: z.array(stableKey).default([]),
  dataMigrations: z.array(z.object({ key: stableKey, reversible: z.boolean() })).default([]),
  postApplyValidations: z.array(stableKey).default([]),
  supportedUpgradeFrom: z.array(versionRange).default([]),
  rollback: z.enum(["reversible", "restore-required", "unsupported"]),
});

export type PackManifest = z.infer<typeof packManifestSchema>;

export type SignedPackEnvelope = {
  manifest: unknown;
  digest: string;
  signature: {
    algorithm: "Ed25519";
    publisher: string;
    keyId: string;
    value: string;
  };
};

export type TrustedPublisherKeys = ReadonlyMap<string, ReadonlyMap<string, string>>;

export class PackValidationError extends Error {
  readonly code = "E_PACK_INVALID" as const;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(",")}}`;
}

export function packManifestBytes(manifest: PackManifest): Buffer {
  return Buffer.from(canonicalize(manifest), "utf8");
}

export function packManifestDigest(manifest: PackManifest): string {
  return `sha256:${createHash("sha256").update(packManifestBytes(manifest)).digest("hex")}`;
}

function versionTuple(value: string): [number, number, number] {
  const core = value.split("-", 1)[0]!;
  const [major, minor, patch] = core.split(".").map(Number);
  return [major!, minor!, patch!];
}

function compareVersion(left: string, right: string): number {
  const a = versionTuple(left);
  const b = versionTuple(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index]! < b[index]! ? -1 : 1;
  }
  return 0;
}

/** Closed range grammar: exact, ^x.y.z, or space-separated >=/>/<=/< clauses. */
export function versionSatisfies(version: string, range: string): boolean {
  if (range.startsWith("^")) {
    const floor = range.slice(1);
    if (!semver.safeParse(floor).success) return false;
    const [major] = versionTuple(floor);
    return compareVersion(version, floor) >= 0 && versionTuple(version)[0] === major;
  }
  if (semver.safeParse(range).success) return compareVersion(version, range) === 0;
  const clauses = range.trim().split(/\s+/);
  return clauses.length > 0 && clauses.every((clause) => {
    const match = /^(>=|<=|>|<)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(clause);
    if (!match) return false;
    const comparison = compareVersion(version, match[2]!);
    return match[1] === ">=" ? comparison >= 0
      : match[1] === "<=" ? comparison <= 0
        : match[1] === ">" ? comparison > 0
          : comparison < 0;
  });
}

function requireUnique(values: string[], label: string): void {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  if (duplicates.length > 0) throw new PackValidationError(`${label} contains duplicate ${duplicates[0]}`);
}

export function validateSignedPack(
  envelope: SignedPackEnvelope,
  trustedKeys: TrustedPublisherKeys,
  platformVersion: string,
): { manifest: PackManifest; digest: string; publisher: string; keyId: string } {
  const parsed = packManifestSchema.safeParse(envelope.manifest);
  if (!parsed.success) {
    throw new PackValidationError(`manifest schema rejected: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  const manifest = parsed.data;
  requireUnique(
    [...manifest.requiredCapabilities, ...manifest.optionalCapabilities].map((item) => item.id),
    "capability requirements",
  );
  requireUnique(manifest.roles.map((role) => role.key), "roles");
  requireUnique(manifest.contributions.map((item) => item.id), "contributions");
  requireUnique(manifest.dataMigrations.map((item) => item.key), "data migrations");
  if (!versionSatisfies(platformVersion, manifest.platform)) {
    throw new PackValidationError(`pack requires platform ${manifest.platform}, loaded ${platformVersion}`);
  }

  const digest = packManifestDigest(manifest);
  if (envelope.digest !== digest) throw new PackValidationError("manifest digest mismatch");
  if (envelope.signature.algorithm !== "Ed25519") throw new PackValidationError("unsupported signature algorithm");
  const publicKey = trustedKeys.get(envelope.signature.publisher)?.get(envelope.signature.keyId);
  if (!publicKey) throw new PackValidationError("publisher key is not trusted");
  let signature: Buffer;
  try {
    signature = Buffer.from(envelope.signature.value, "base64");
  } catch {
    throw new PackValidationError("signature is not valid base64");
  }
  if (!verify(null, packManifestBytes(manifest), publicKey, signature)) {
    throw new PackValidationError("manifest signature verification failed");
  }
  return {
    manifest,
    digest,
    publisher: envelope.signature.publisher,
    keyId: envelope.signature.keyId,
  };
}
