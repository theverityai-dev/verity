import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * ADR-032 / drill finding F6, installer side: preflight must refuse an OIDC deployment whose
 * VERITY_PUBLIC_URL is missing, malformed, plain http in production, or on a different origin
 * from the OIDC callback. Runs the real deploy/security/preflight.sh against a scratch env file;
 * a fake `stat` supplies mode 600 so the check does not depend on the host file system.
 */

const PREFLIGHT = resolve(process.cwd(), "deploy/security/preflight.sh").replace(/\\/g, "/");
const bashAvailable = spawnSync("bash", ["-c", "true"]).status === 0;

let dir: string;
let shim: string;

const BASE: Record<string, string> = {
  POSTGRES_SUPERUSER_PASSWORD: "a-long-enough-postgres-password-1",
  VERITY_APP_PASSWORD: "a-long-enough-app-password-0001",
  VERITY_SESSION_SECRET: "s".repeat(40),
  CRON_SECRET: "c".repeat(40),
  VERITY_AUTH_PROVIDER: "oidc",
  VERITY_OIDC_ISSUER: "https://idp.example.com/realms/acme",
  VERITY_OIDC_CLIENT_ID: "verity-web",
  VERITY_OIDC_REDIRECT_URI: "https://verity.example.com/api/auth/oidc/callback",
  VERITY_PUBLIC_URL: "https://verity.example.com",
};

function run(overrides: Record<string, string | null>) {
  const entries: Record<string, string | null> = { ...BASE, ...overrides };
  const file = join(dir, "verity.env");
  const body = Object.entries(entries)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  writeFileSync(file, `${body}\n`);
  const result = spawnSync("bash", [PREFLIGHT], {
    encoding: "utf8",
    env: { ...process.env, VERITY_ENV_FILE: file.replace(/\\/g, "/"), FAKE_MODE: "600", PATH: `${shim}${delimiter}${process.env.PATH}` },
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

describe.skipIf(!bashAvailable)("preflight: VERITY_PUBLIC_URL (ADR-032)", () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "verity-pf-"));
    shim = join(dir, "bin");
    mkdirSync(shim, { recursive: true });
    writeFileSync(join(shim, "stat"), `#!/bin/sh\ncase "$1" in -c) printf '%s\\n' "$FAKE_MODE"; exit 0 ;; esac\nexit 1\n`);
    chmodSync(join(shim, "stat"), 0o755);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("passes a complete https configuration, with or without a trailing slash", () => {
    const plain = run({});
    expect(plain.status, plain.out).toBe(0);
    const slash = run({ VERITY_PUBLIC_URL: "https://verity.example.com/" });
    expect(slash.status, slash.out).toBe(0);
    // Two bash spawns; Windows process start alone can exceed the 5 s default.
  }, 30_000);

  it("fails when it is missing, naming the variable", () => {
    const r = run({ VERITY_PUBLIC_URL: null });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/VERITY_PUBLIC_URL is empty/);
  });

  it("fails on plain http in production", () => {
    const r = run({ VERITY_PUBLIC_URL: "http://verity.example.com" });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/VERITY_PUBLIC_URL must be https in production/);
  });

  it("accepts http only for a non-production environment", () => {
    const r = run({
      VERITY_ENVIRONMENT: "staging",
      VERITY_PUBLIC_URL: "http://localhost:3000",
      VERITY_OIDC_REDIRECT_URI: "http://localhost:3000/api/auth/oidc/callback",
      VERITY_OIDC_ISSUER: "http://localhost:8080/realms/x",
    });
    expect(r.status, r.out).toBe(0);
  });

  it("fails on anything that is not a bare origin", { timeout: 120_000 }, () => {
    for (const bad of ["verity.example.com", "https://verity.example.com/app", "https://verity.example.com/?x=1", "https://u:p@verity.example.com", "ftp://verity.example.com"]) {
      const r = run({ VERITY_PUBLIC_URL: bad });
      expect(r.status, bad).not.toBe(0);
      expect(r.out, bad).toMatch(/VERITY_PUBLIC_URL must be/);
    }
  });

  it("fails when the OIDC callback is on a different origin", () => {
    const r = run({ VERITY_PUBLIC_URL: "https://other.example.com" });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/VERITY_OIDC_REDIRECT_URI must be on VERITY_PUBLIC_URL/);
  });

  it("is not demanded of a non-OIDC deployment", () => {
    const r = run({
      VERITY_AUTH_PROVIDER: "supabase",
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      VERITY_PUBLIC_URL: null,
    });
    expect(r.status, r.out).toBe(0);
  });
});

describe("deployment wiring for VERITY_PUBLIC_URL", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("compose passes it to the web and tools services, and the example documents it", () => {
    const compose = read("deploy/compose/docker-compose.yml");
    expect(compose.match(/VERITY_PUBLIC_URL: \$\{VERITY_PUBLIC_URL:-\}/g)?.length).toBe(2);
    expect(read("deploy/config/verity.env.example")).toMatch(/^VERITY_PUBLIC_URL=https:\/\//m);
  });

  it("the HOSTNAME bind address is never used as a public URL", () => {
    expect(read("deploy/config/verity.env.example")).not.toMatch(/VERITY_PUBLIC_URL=.*0\.0\.0\.0/);
  });
});
