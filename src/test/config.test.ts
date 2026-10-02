import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `src/server/platform/config.ts` — the runtime configuration boundary.
 *
 * `runtimeConfig` is parsed once, at module import, so these tests reimport
 * the module fresh (via `vi.resetModules()`) after mutating `process.env` for
 * each case, the same pattern `proxy.test.ts` uses for the same reason: a
 * top-level `export const x = f()` only re-runs `f()` on a fresh module
 * instance.
 */

const REQUIRED_ENV = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/verity_test",
  NEXT_PUBLIC_SUPABASE_URL: "https://project-ref.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-for-test",
  VERITY_SESSION_SECRET: "private-test-session-signing-secret",
};

const SNAPSHOT_KEYS = [
  "DATABASE_URL",
  "DIRECT_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_JWT_SECRET",
  "VERITY_SESSION_SECRET",
  "JWT_SECRET",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_MEDIA_BUCKET",
  "VERITY_STORAGE_DRIVER",
  "VERITY_S3_BUCKET",
  "VERITY_S3_ACCESS_KEY_ID",
  "VERITY_S3_SECRET_ACCESS_KEY",
  "VERITY_STORAGE_CREATE_BUCKET",
  "VERITY_PUBLIC_URL",
  "VERITY_ENVIRONMENT",
  "VERITY_AUTH_PROVIDER",
  "VERITY_OIDC_ISSUER",
  "VERITY_OIDC_CLIENT_ID",
  "VERITY_OIDC_REDIRECT_URI",
  "NODE_ENV",
  "PORT",
  "CRON_SECRET",
  "VERITY_TX_TIMEOUT_MS",
  "VERITY_TX_MAX_WAIT_MS",
] as const;

let snapshot: Record<string, string | undefined>;

beforeEach(() => {
  vi.resetModules();
  snapshot = Object.fromEntries(SNAPSHOT_KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const key of SNAPSHOT_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else (process.env as Record<string, string | undefined>)[key] = snapshot[key];
  }
});

async function importConfig() {
  return import("@/server/platform/config");
}

describe("runtime configuration boundary", () => {
  it("throws E_CONFIG_INVALID when DATABASE_URL is missing", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    delete process.env.DATABASE_URL;

    await expect(importConfig()).rejects.toThrow(/E_CONFIG_INVALID/);
  });

  it("throws E_CONFIG_INVALID when NEXT_PUBLIC_SUPABASE_URL is missing", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    await expect(importConfig()).rejects.toThrow(/E_CONFIG_INVALID/);
  });

  it("throws E_CONFIG_INVALID when NEXT_PUBLIC_SUPABASE_ANON_KEY is missing", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    await expect(importConfig()).rejects.toThrow(/E_CONFIG_INVALID/);
  });

  it("loads successfully and applies the documented transaction-budget defaults", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    delete process.env.VERITY_TX_TIMEOUT_MS;
    delete process.env.VERITY_TX_MAX_WAIT_MS;

    const { runtimeConfig } = await importConfig();

    expect(runtimeConfig.database.url).toBe(REQUIRED_ENV.DATABASE_URL);
    expect(runtimeConfig.database.txTimeoutMs).toBe(15_000);
    expect(runtimeConfig.database.txMaxWaitMs).toBe(5_000);
  });

  it("honours an explicit transaction budget override", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    process.env.VERITY_TX_TIMEOUT_MS = "20000";
    process.env.VERITY_TX_MAX_WAIT_MS = "8000";

    const { runtimeConfig } = await importConfig();

    expect(runtimeConfig.database.txTimeoutMs).toBe(20_000);
    expect(runtimeConfig.database.txMaxWaitMs).toBe(8_000);
  });

  it("refuses to sign membership cookies with the public anon key", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    delete process.env.SUPABASE_JWT_SECRET;
    delete process.env.VERITY_SESSION_SECRET;
    delete process.env.JWT_SECRET;
    await expect(importConfig()).rejects.toThrow(/E_CONFIG_INVALID/);
  });

  it("accepts the private legacy JWT_SECRET alias", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    delete process.env.SUPABASE_JWT_SECRET;
    delete process.env.VERITY_SESSION_SECRET;
    process.env.JWT_SECRET = "private-legacy-test-signing-secret";
    expect((await importConfig()).runtimeConfig.auth.jwtSecret).toBe(process.env.JWT_SECRET);
  });

  it("prefers an explicit SUPABASE_JWT_SECRET over other private aliases", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    process.env.SUPABASE_JWT_SECRET = "a-real-signing-secret";

    const { runtimeConfig } = await importConfig();

    expect(runtimeConfig.auth.jwtSecret).toBe("a-real-signing-secret");
  });

  it("leaves storage unconfigured (undefined, not thrown) when no storage variables are set", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_MEDIA_BUCKET;

    const { runtimeConfig } = await importConfig();

    // Storage is optional (files.ts refuses at point of use, not at boot) —
    // supabaseUrl still resolves from the required public URL, but the
    // service key and bucket, which installStorage() also requires, do not.
    expect(runtimeConfig.storage.serviceRoleKey).toBeUndefined();
    expect(runtimeConfig.storage.bucket).toBeUndefined();
  });

  describe("VERITY_PUBLIC_URL (ADR-032, finding F6)", () => {
    const OIDC = {
      VERITY_AUTH_PROVIDER: "oidc",
      VERITY_OIDC_ISSUER: "https://idp.example.com/realms/x",
      VERITY_OIDC_CLIENT_ID: "verity-web",
      VERITY_OIDC_REDIRECT_URI: "https://verity.example.com/api/auth/oidc/callback",
    };
    const load = async (env: Record<string, string>) => {
      vi.resetModules(); // runtimeConfig is parsed once per module instance
      for (const key of ["VERITY_PUBLIC_URL", "VERITY_ENVIRONMENT", "VERITY_AUTH_PROVIDER", "VERITY_OIDC_ISSUER", "VERITY_OIDC_CLIENT_ID", "VERITY_OIDC_REDIRECT_URI", "NODE_ENV", "PORT"]) delete process.env[key];
      Object.assign(process.env, REQUIRED_ENV, env);
      return (await importConfig()).runtimeConfig;
    };

    it("normalises to the origin: lower-case host, default port and trailing slash dropped", async () => {
      expect((await load({ ...OIDC, VERITY_PUBLIC_URL: "https://verity.example.com/" })).publicUrl).toBe("https://verity.example.com");
      expect((await load({ ...OIDC, VERITY_PUBLIC_URL: "https://Verity.Example.com:443" })).publicUrl).toBe("https://verity.example.com");
      expect((await load({ ...OIDC, VERITY_PUBLIC_URL: "https://verity.example.com:8443/", VERITY_OIDC_REDIRECT_URI: "https://verity.example.com:8443/api/auth/oidc/callback" })).publicUrl).toBe("https://verity.example.com:8443");
    });

    it("rejects anything that is not an origin, naming the variable", async () => {
      for (const bad of [
        "verity.example.com", "ftp://verity.example.com", "/just/a/path", "https://verity.example.com/app",
        "https://verity.example.com/?x=1", "https://verity.example.com/#frag", "https://user:pw@verity.example.com",
        "javascript:alert(1)", "https://",
      ]) {
        await expect(load({ ...OIDC, VERITY_PUBLIC_URL: bad }), bad).rejects.toThrow(/VERITY_PUBLIC_URL/);
      }
    });

    it("is required for an OIDC deployment in production", async () => {
      Object.assign(process.env, { NODE_ENV: "production" });
      delete process.env.VERITY_PUBLIC_URL;
      await expect(load({ ...OIDC, NODE_ENV: "production" })).rejects.toThrow(/VERITY_PUBLIC_URL is required/);
    });

    it("is not required outside production, or for a deployment that does not use OIDC", async () => {
      delete process.env.VERITY_PUBLIC_URL;
      expect((await load({ ...OIDC, NODE_ENV: "development" })).publicUrl).toBeUndefined();
      expect((await load({ ...OIDC, NODE_ENV: "test" })).publicUrl).toBeUndefined();
      expect((await load({ NODE_ENV: "production" })).publicUrl).toBeUndefined();
    });

    it("must be https in production, but may be http for staging", async () => {
      await expect(load({ ...OIDC, NODE_ENV: "production", VERITY_PUBLIC_URL: "http://verity.example.com", VERITY_OIDC_REDIRECT_URI: "http://verity.example.com/api/auth/oidc/callback" }))
        .rejects.toThrow(/VERITY_PUBLIC_URL must be https/);
      delete process.env.VERITY_ENVIRONMENT;
      await expect(load({ ...OIDC, NODE_ENV: "production", VERITY_ENVIRONMENT: "production", VERITY_PUBLIC_URL: "http://verity.example.com", VERITY_OIDC_REDIRECT_URI: "http://verity.example.com/api/auth/oidc/callback" }))
        .rejects.toThrow(/VERITY_PUBLIC_URL must be https/);
      const staging = await load({ ...OIDC, NODE_ENV: "production", VERITY_ENVIRONMENT: "staging", VERITY_PUBLIC_URL: "http://verity.example.com", VERITY_OIDC_REDIRECT_URI: "http://verity.example.com/api/auth/oidc/callback" });
      expect(staging.publicUrl).toBe("http://verity.example.com");
    });

    it("must be on the same origin as the OIDC redirect URI, so the two cannot disagree", async () => {
      await expect(load({ ...OIDC, VERITY_PUBLIC_URL: "https://other.example.com" })).rejects.toThrow(/VERITY_OIDC_REDIRECT_URI must be on VERITY_PUBLIC_URL/);
      expect((await load({ ...OIDC, VERITY_PUBLIC_URL: "https://verity.example.com" })).publicUrl).toBe("https://verity.example.com");
    });

    it("exposes a validated development port, never derived from a request", async () => {
      expect((await load({ PORT: "3100" })).port).toBe(3100);
      delete process.env.PORT;
      expect((await load({})).port).toBe(3000);
      await expect(load({ PORT: "not-a-port" })).rejects.toThrow(/E_CONFIG_INVALID/);
    });
  });

  describe("VERITY_STORAGE_CREATE_BUCKET (drill finding F5)", () => {
    const S3 = {
      VERITY_STORAGE_DRIVER: "s3",
      VERITY_S3_BUCKET: "verity-media",
      VERITY_S3_ACCESS_KEY_ID: "test-access-key-id",
      VERITY_S3_SECRET_ACCESS_KEY: "test-secret-access-key",
    };

    it("defaults to true, so the installer provisions the bucket unless told not to", async () => {
      Object.assign(process.env, REQUIRED_ENV, S3);
      delete process.env.VERITY_STORAGE_CREATE_BUCKET;
      expect((await importConfig()).runtimeConfig.storage.createBucket).toBe(true);
    });

    it("accepts an explicit true and an explicit false (the customer owns the bucket)", async () => {
      Object.assign(process.env, REQUIRED_ENV, S3);
      process.env.VERITY_STORAGE_CREATE_BUCKET = "true";
      expect((await importConfig()).runtimeConfig.storage.createBucket).toBe(true);
      vi.resetModules(); // runtimeConfig is parsed once per module instance
      process.env.VERITY_STORAGE_CREATE_BUCKET = "false";
      expect((await importConfig()).runtimeConfig.storage.createBucket).toBe(false);
    });

    it("rejects anything else rather than guessing, so 'False' or '0' can never silently mean true", async () => {
      Object.assign(process.env, REQUIRED_ENV, S3);
      for (const value of ["False", "0", "no", "yes", "1"]) {
        vi.resetModules(); // each value must be judged on its own, not on a cached failure
        process.env.VERITY_STORAGE_CREATE_BUCKET = value;
        await expect(importConfig(), value).rejects.toThrow(/VERITY_STORAGE_CREATE_BUCKET must be exactly true or false/);
      }
    });
  });

  it("prefers the public Supabase API URL for the storage endpoint", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    process.env.SUPABASE_URL = "https://storage-specific.supabase.co";

    const { runtimeConfig } = await importConfig();

    expect(runtimeConfig.storage.supabaseUrl).toBe(REQUIRED_ENV.NEXT_PUBLIC_SUPABASE_URL);
  });

  it("readCronSecret reads process.env live rather than a value cached at import", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    delete process.env.CRON_SECRET;

    const { readCronSecret } = await importConfig();

    expect(readCronSecret()).toBeUndefined();
    process.env.CRON_SECRET = "rotated-secret";
    expect(readCronSecret()).toBe("rotated-secret");
  });
});

describe("blank environment variables mean 'not configured' (Task 43)", () => {
  /**
   * Found by running the container, not by reasoning about it.
   *
   * Docker Compose renders `${FOO:-}` for an unset optional variable as an
   * empty string. `??` only falls through on null/undefined, so an empty
   * SUPABASE_JWT_SECRET used to win the coalescing chain and the deployment
   * failed with E_CONFIG_INVALID — while every test here passed, because a
   * test that *deletes* a variable produces `undefined` and never reproduces
   * the shape a container actually gets.
   */
  it("falls through a blank value to the next source in the chain", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    process.env.SUPABASE_JWT_SECRET = "";
    process.env.VERITY_SESSION_SECRET = "a-real-session-secret";

    const { runtimeConfig } = await importConfig();
    expect(runtimeConfig.auth.jwtSecret).toBe("a-real-session-secret");
  });

  it("treats a blank optional value as absent rather than as configuration", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    process.env.SUPABASE_SERVICE_ROLE_KEY = "";
    process.env.SUPABASE_MEDIA_BUCKET = "   ";

    const { runtimeConfig } = await importConfig();
    expect(runtimeConfig.storage.serviceRoleKey).toBeUndefined();
    expect(runtimeConfig.storage.bucket).toBeUndefined();
  });

  it("still refuses a required variable that is present but blank", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "";

    await expect(importConfig()).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL is required/);
  });
});
