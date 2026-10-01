import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Drill finding F1 (evidence drill, 2026-10-01).
 *
 * `deploy/scripts/_common.sh` refuses an env file that is not mode 600 or 400.
 * It used to read the mode with BSD `stat -f '%OLp'` and fall back to GNU
 * `stat -c '%a'`. On GNU and uutils coreutils `-f` means "filesystem status":
 * for a format string it exits non-zero but has already printed several lines,
 * so the captured "mode" was multi-line garbage and every operator script
 * rejected its own env file on Linux.
 *
 * These tests drive the real `require_env_file` with fake `stat` binaries that
 * reproduce each platform's behaviour, so they fail on the old code and do not
 * depend on the host's file system (NTFS has no POSIX modes). A last test uses
 * the host's real `stat` where POSIX modes exist.
 */

const COMMON = resolve(process.cwd(), "deploy/scripts/_common.sh").replace(/\\/g, "/");
const bashAvailable = spawnSync("bash", ["-c", "true"]).status === 0;

let dir: string;
let envFile: string;

const SHIMS: Record<"gnu" | "bsd" | "none", string> = {
  // GNU/uutils: `-c` works; `-f FMT FILE` is filesystem status: prints lines, exits non-zero.
  gnu: `#!/bin/sh
case "$1" in
  -c) printf '%s\\n' "$FAKE_MODE"; exit 0 ;;
  -f) printf '  File: "x"\\n    ID: 0 Namelen: 255 Type: ext2/ext3\\n'; exit 1 ;;
esac
exit 1
`,
  // BSD/macOS: `-c` is an illegal option; `-f FMT FILE` prints the formatted value.
  bsd: `#!/bin/sh
case "$1" in
  -c) echo "stat: illegal option -- c" >&2; exit 1 ;;
  -f) printf '%s\\n' "$FAKE_MODE"; exit 0 ;;
esac
exit 1
`,
  // Neither form works.
  none: `#!/bin/sh
exit 1
`,
};

function shimDir(kind: keyof typeof SHIMS): string {
  const d = join(dir, `shim-${kind}`);
  mkdirSync(d, { recursive: true });
  const stat = join(d, "stat");
  writeFileSync(stat, SHIMS[kind]);
  chmodSync(stat, 0o755);
  return d;
}

function requireEnvFile(shim: keyof typeof SHIMS | "real", mode = "600") {
  const path = shim === "real" ? process.env.PATH : `${shimDir(shim)}${delimiter}${process.env.PATH}`;
  const result = spawnSync(
    "bash",
    ["-c", 'source "$1" && require_env_file && echo OK', "_", COMMON],
    {
      env: { ...process.env, PATH: path, VERITY_ENV_FILE: envFile.replace(/\\/g, "/"), FAKE_MODE: mode },
      encoding: "utf8",
    },
  );
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

describe.skipIf(!bashAvailable)("env-file mode check is portable (drill finding F1)", () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "verity-envmode-"));
    envFile = join(dir, "verity.env");
    writeFileSync(envFile, "X=1\n");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("accepts mode 600 where stat is GNU or uutils (the Linux case that was broken)", () => {
    const r = requireEnvFile("gnu", "600");
    expect(r.out).toContain("OK");
    expect(r.status).toBe(0);
  });

  it("accepts mode 400 where stat is GNU or uutils", () => {
    expect(requireEnvFile("gnu", "400").status).toBe(0);
  });

  it("still accepts mode 600 and 400 where stat is BSD", () => {
    expect(requireEnvFile("bsd", "600").status).toBe(0);
    expect(requireEnvFile("bsd", "400").status).toBe(0);
  });

  it("still refuses a group- or world-readable file, on both platforms", () => {
    for (const shim of ["gnu", "bsd"] as const) {
      const r = requireEnvFile(shim, "644");
      expect(r.status, shim).not.toBe(0);
      expect(r.out, shim).toContain("is mode 644");
      expect(r.out, shim).toContain("it holds credentials");
    }
  });

  it("refuses a file that is writable by others even when readable only by the owner", () => {
    expect(requireEnvFile("gnu", "602").status).not.toBe(0);
  });

  it("fails closed, with a clear message, when the mode cannot be determined", () => {
    const r = requireEnvFile("none");
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/cannot determine the mode/);
  });

  it("fails closed rather than trusting output that is not an octal mode", () => {
    const r = requireEnvFile("gnu", "not-a-mode");
    expect(r.status).not.toBe(0);
    expect(r.out).not.toContain("OK");
  });

  it.skipIf(process.platform === "win32")("works with the host's real stat", () => {
    chmodSync(envFile, 0o600);
    expect(requireEnvFile("real").status).toBe(0);
    chmodSync(envFile, 0o644);
    const r = requireEnvFile("real");
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("is mode 644");
  });
});
