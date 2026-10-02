import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Drill finding F2: the bundled object store's pinned image was withdrawn by its publisher and nothing
 * noticed. `deploy/scripts/check-image-pins.sh` is the weekly proof that every pinned reference still
 * resolves. The extraction is tested offline against the real files; the verdict is tested with a fake
 * `docker` so no network is needed and a withdrawn image can be simulated.
 */

const ROOT = process.cwd();
const SCRIPT = resolve(ROOT, "deploy/scripts/check-image-pins.sh").replace(/\\/g, "/");
const bashAvailable = spawnSync("bash", ["-c", "true"]).status === 0;

let dir: string;

function fakeDocker(): string {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const docker = join(bin, "docker");
  // `docker version` succeeds. Resolving a ref (`buildx imagetools inspect`, or `manifest inspect` when
  // buildx is absent, FAKE_NO_BUILDX=1) fails when the ref contains $FAKE_WITHDRAWN. `manifest inspect`
  // ALSO fails for any ref when FAKE_MANIFEST_BROKEN=1, as the real one does for OCI indexes.
  writeFileSync(
    docker,
    `#!/bin/sh
fail_if_withdrawn() { case "$1" in *"$FAKE_WITHDRAWN"*) [ -n "$FAKE_WITHDRAWN" ] && { echo "unauthorized: authentication required" >&2; exit 1; } ;; esac; }
if [ "$1" = version ]; then exit 0; fi
if [ "$1" = buildx ] && [ "$2" = version ]; then [ -n "$FAKE_NO_BUILDX" ] && exit 1; exit 0; fi
if [ "$1" = buildx ] && [ "$2" = imagetools ] && [ "$3" = inspect ]; then fail_if_withdrawn "$4"; exit 0; fi
if [ "$1" = manifest ] && [ "$2" = inspect ]; then
  [ -n "$FAKE_MANIFEST_BROKEN" ] && { echo "manifest verification failed for digest" >&2; exit 1; }
  fail_if_withdrawn "$3"; exit 0
fi
exit 1
`,
  );
  chmodSync(docker, 0o755);
  return bin;
}

function run(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync("bash", [SCRIPT, ...args], {
    env: { ...process.env, PATH: `${join(dir, "bin")}${delimiter}${process.env.PATH}`, ...env },
    encoding: "utf8",
  });
  return { status: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

describe.skipIf(!bashAvailable)("pinned image pull check (drill finding F2)", () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "verity-pins-"));
    fakeDocker();
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("lists every digest-pinned image in the compose files and the Dockerfile, offline", () => {
    const r = run(["--list"]);
    expect(r.status).toBe(0);
    const refs = r.out.trim().split("\n");
    expect(refs.length).toBeGreaterThanOrEqual(3);
    for (const ref of refs) expect(ref, ref).toMatch(/^\S+@sha256:[a-f0-9]{64}$/);
    expect(refs.some((x) => x.startsWith("postgres:16-alpine@"))).toBe(true);
    expect(refs.some((x) => x.startsWith("node:22-bookworm-slim@"))).toBe(true);
    expect(refs.some((x) => x.startsWith("chrislusf/seaweedfs:"))).toBe(true);
  });

  it("does not list an image that carries no digest", () => {
    const refs = run(["--list"]).out.trim().split("\n");
    expect(refs.every((x) => x.includes("@sha256:"))).toBe(true);
    expect(refs.some((x) => x.includes("verity:local") || x.includes("verity-tools"))).toBe(false);
  });

  it("passes when every reference resolves", () => {
    const r = run([], { FAKE_WITHDRAWN: "" });
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/all \d+ pinned images resolve/);
  });

  it("does not raise a false alarm where the older manifest command cannot verify OCI indexes", () => {
    // Found by running the check against live registries: `docker manifest inspect` reported
    // "manifest verification failed" for digests that pull fine. buildx must be preferred.
    const r = run([], { FAKE_WITHDRAWN: "", FAKE_MANIFEST_BROKEN: "1" });
    expect(r.status).toBe(0);
    expect(r.err).not.toMatch(/CANNOT BE PULLED/);
  });

  it("falls back to the older command when buildx is not installed, and still catches a withdrawn image", () => {
    expect(run([], { FAKE_NO_BUILDX: "1", FAKE_WITHDRAWN: "" }).status).toBe(0);
    const r = run([], { FAKE_NO_BUILDX: "1", FAKE_WITHDRAWN: "postgres" });
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/CANNOT BE PULLED: postgres/);
  });

  it("fails, naming the image, when a registry has withdrawn one", () => {
    const r = run([], { FAKE_WITHDRAWN: "seaweedfs" });
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/CANNOT BE PULLED: chrislusf\/seaweedfs/);
    expect(r.err).toMatch(/replace them before the next install/);
  });
}, 120_000);
