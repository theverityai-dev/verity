import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Drill finding F2: the bundled object store moved from MinIO to SeaweedFS. `VERITY_WITH_BUNDLED_STORAGE=1`
 * selects it. `VERITY_WITH_MINIO=1` is kept as a DEPRECATED alias so an existing install command does not
 * silently start no object store, and it must say loudly that the store changed and nothing was migrated.
 *
 * These drive the real `compose()` from `_common.sh` with a fake `docker` that records its arguments.
 */

const COMMON = resolve(process.cwd(), "deploy/scripts/_common.sh").replace(/\\/g, "/");
const bashAvailable = spawnSync("bash", ["-c", "true"]).status === 0;

let dir: string;

function run(env: Record<string, string>) {
  const log = join(dir, `docker-${Math.random().toString(36).slice(2)}.log`);
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const docker = join(bin, "docker");
  writeFileSync(docker, `#!/bin/sh\necho "$*" >> "${log.replace(/\\/g, "/")}"\nexit 0\n`);
  chmodSync(docker, 0o755);
  const r = spawnSync("bash", ["-c", 'source "$1" && compose ps && compose ps', "_", COMMON], {
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      VERITY_ENV_FILE: join(dir, "verity.env").replace(/\\/g, "/"),
      VERITY_WITH_BUNDLED_STORAGE: "",
      VERITY_WITH_MINIO: "",
      ...env,
    },
    encoding: "utf8",
  });
  let calls = "";
  try { calls = readFileSync(log, "utf8"); } catch { /* no call */ }
  return { status: r.status, err: r.stderr ?? "", calls };
}

const OVERLAY = "docker-compose.bundled-storage.yml";

describe.skipIf(!bashAvailable)("bundled storage selection and the deprecated MinIO alias (drill finding F2)", () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "verity-bundled-"));
    writeFileSync(join(dir, "verity.env"), "X=1\n");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("starts no bundled store by default", () => {
    const r = run({});
    expect(r.status).toBe(0);
    expect(r.calls).not.toContain(OVERLAY);
    expect(r.err).toBe("");
  });

  it("adds the bundled-storage overlay for VERITY_WITH_BUNDLED_STORAGE=1, silently", () => {
    const r = run({ VERITY_WITH_BUNDLED_STORAGE: "1" });
    expect(r.calls).toContain(OVERLAY);
    expect(r.err).toBe("");
  });

  it("still honours the deprecated VERITY_WITH_MINIO=1, and says the store changed and nothing was migrated", () => {
    const r = run({ VERITY_WITH_MINIO: "1" });
    expect(r.calls).toContain(OVERLAY);
    expect(r.err).toMatch(/VERITY_WITH_MINIO is deprecated/);
    expect(r.err).toMatch(/SeaweedFS/);
    expect(r.err).toMatch(/VERITY_WITH_BUNDLED_STORAGE=1/);
    expect(r.err).toMatch(/NOT migrated/);
    expect(r.err).toMatch(/verity-bundled-storage-data/);
  });

  it("warns once per script run, not on every compose call", () => {
    const warnings = run({ VERITY_WITH_MINIO: "1" }).err.match(/VERITY_WITH_MINIO is deprecated/g) ?? [];
    expect(warnings).toHaveLength(1);
  });

  it("does not nag when the new setting is used, even if the old one is also set", () => {
    const r = run({ VERITY_WITH_BUNDLED_STORAGE: "1", VERITY_WITH_MINIO: "1" });
    expect(r.calls).toContain(OVERLAY);
    expect(r.err).toBe("");
  });

  it("treats anything other than 1 as off", () => {
    for (const value of ["0", "true", "yes"]) {
      expect(run({ VERITY_WITH_BUNDLED_STORAGE: value }).calls, value).not.toContain(OVERLAY);
      expect(run({ VERITY_WITH_MINIO: value }).calls, value).not.toContain(OVERLAY);
    }
  });

  it("never references a MinIO overlay file", () => {
    expect(run({ VERITY_WITH_MINIO: "1" }).calls).not.toMatch(/docker-compose\.minio\.yml/);
  });
});
