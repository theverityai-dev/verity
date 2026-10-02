import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Drill finding F7 (2026-10-02). An env file or compose file carrying CRLF (a Windows checkout, or `git archive`
 * on Windows) made `env_value()` return values ending in a carriage return, and `health.sh` then curled
 * `127.0.0.1\r` and reported `000000` with no hint why. `env_value` must be line-ending agnostic, and the
 * deploy package must be pinned to LF so the problem is not produced in the first place.
 */

const COMMON = resolve(process.cwd(), "deploy/scripts/_common.sh").replace(/\\/g, "/");
const bashAvailable = spawnSync("bash", ["-c", "true"]).status === 0;

let dir: string;

/** The value `env_value` prints, with a carriage return made visible as the two characters `\r`. */
function envValue(contents: string, key: string): string {
  const file = join(dir, "verity.env");
  writeFileSync(file, contents);
  const r = spawnSync("bash", ["-c", 'source "$1" && env_value "$2" | od -An -c | tr -d " \\n"', "_", COMMON, key], {
    env: { ...process.env, VERITY_ENV_FILE: file.replace(/\\/g, "/") },
    encoding: "utf8",
  });
  return r.stdout.replace(/\\n$/, ""); // od's own end-of-line
}

describe.skipIf(!bashAvailable)("env_value is line-ending agnostic (drill finding F7)", () => {
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "verity-crlf-")); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("returns no carriage return for a CRLF env file", () => {
    const out = envValue("VERITY_BIND_ADDRESS=127.0.0.1\r\nVERITY_PORT=3100\r\n", "VERITY_BIND_ADDRESS");
    expect(out).not.toContain("\\r");
    expect(out).toBe("127.0.0.1");
  });

  it("still returns the last assignment, and is unchanged for an LF file", () => {
    expect(envValue("A=1\nA=2\n", "A")).toBe("2");
    expect(envValue("A=1\r\nA=2\r\n", "A")).toBe("2");
    expect(envValue("A=\r\n", "A")).toBe("");
  });
});

describe("deploy package is pinned to LF", () => {
  it("env_value strips carriage returns itself (MSYS sed hides the bug on Windows, GNU sed does not)", () => {
    const common = readFileSync(COMMON, "utf8");
    const body = common.slice(common.indexOf("env_value() {"), common.indexOf("require_docker() {"));
    expect(body).toMatch(/tr -d '\\r'/);
  });

  it(".gitattributes forces LF for everything under deploy/", () => {
    const attrs = readFileSync(resolve(process.cwd(), ".gitattributes"), "utf8");
    expect(attrs).toMatch(/^deploy\/\*\*\s+text\s+eol=lf\s*$/m);
  });
});
