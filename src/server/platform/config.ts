import { z } from "zod";

/**
 * The single validated runtime configuration boundary.
 *
 * Authority: taskplans/archive/26_runtime_configuration.md. Every deployment-specific
 * value — connection strings, the Supabase project's public/service
 * credentials, the transaction budget — was previously read as a raw
 * `process.env.X` at its point of use, scattered across five files with no
 * shared validation and no single place that named what a working deployment
 * actually requires. This module is that place: `process.env` is parsed once,
 * against an explicit schema, and every consumer imports the typed result
 * instead of reading the environment itself.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * `CRON_SECRET` is read through `readCronSecret()` below, not through
 * `runtimeConfig`. The application still fails closed at `/api/scheduled` when
 * it is absent, while the supported on-prem profile requires it in preflight.
 * Unlike everything else here, it is read fresh on every request
 * rather than fixed for the process lifetime: `scheduled-work-trigger.test.ts`
 * toggles it between calls within one test run to exercise that exact
 * behaviour. Baking it into a value parsed once at import time would freeze
 * the first value seen and break that contract.
 *
 * `src/proxy.ts` deliberately does NOT import this module. It runs on every
 * request, on the edge, and its own contract (documented in that file and
 * proven by `proxy.test.ts`) is to catch a missing or malformed Supabase
 * client and degrade to "no session refreshed" rather than reject — because a
 * rejected proxy takes down every route at once, including /sign-in. This
 * module's whole purpose is to throw on invalid configuration; wiring the one
 * function that must never throw through it would defeat both.
 */

/**
 * `VERITY_PUBLIC_URL` (ADR-032): the origin a browser reaches this deployment on.
 * Normalised to the origin so a trailing slash cannot double up when a path is
 * appended; anything that is not a bare http(s) origin is refused, so the value
 * cannot smuggle a path, query, fragment or credentials into URLs built from it.
 */
const publicOrigin = z.string().transform((value, ctx) => {
  const fail = (why: string) => {
    ctx.issues.push({ code: "custom", message: `VERITY_PUBLIC_URL ${why}`, input: value });
    return z.NEVER;
  };
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return fail("must be an absolute http:// or https:// URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return fail("must be an http:// or https:// URL");
  if (parsed.username || parsed.password) return fail("must not contain credentials");
  // Checked on the text, not the parsed URL: `new URL` hides an empty `?` or `#`.
  if (!/^https?:\/\/[^/?#]+\/?$/i.test(value)) return fail("must be an origin only (no path, query or fragment)");
  return parsed.origin;
});

const configSchema = z.object({
  nodeEnv: z.enum(["development", "production", "test"]).default("development"),

  /**
   * Deployment environment as the installer names it (`VERITY_ENVIRONMENT`,
   * default `production`). Free-form like the preflight reads it; only the exact
   * value `production` carries the HTTPS requirement.
   */
  environment: z.string().min(1).default("production"),

  /** The server's own listen port. Used only to name the development origin. */
  port: z.coerce.number().int().min(1).max(65_535).default(3000),

  /** See `publicOrigin`. Never derived from a request (ADR-032). */
  publicUrl: publicOrigin.optional(),

  database: z.object({
    /** Prisma reads this itself via `env("DATABASE_URL")` in schema.prisma —
     *  validated here so a missing connection string fails with a clear
     *  E_CONFIG_INVALID at first use of the config boundary, not as a raw
     *  Prisma connection error surfaced from wherever the first query happens
     *  to run. */
    url: z.string().min(1, "DATABASE_URL is required"),
    /** Migrations only (`prisma migrate`); never read by the running app. */
    directUrl: z.string().optional(),
    /** See tenancy.ts: the interactive-transaction budget for `withTenant`. */
    txTimeoutMs: z.coerce.number().positive().default(15_000),
    txMaxWaitMs: z.coerce.number().positive().default(5_000),
  }),

  auth: z
    .object({
      /**
       * Which authentication provider this deployment runs (Task 36).
       *
       * `authProvider.ts` argued against a runtime registry when there was one
       * provider. Both halves of that argument still hold — there is still
       * exactly one *active* provider per deployment and it is still never
       * null — but the choice is now a deployment fact rather than a
       * compile-time one, because an enterprise installing Verity behind its
       * own IdP cannot be asked to recompile. The set of providers is closed
       * and lives in this repository; this is provider selection, not a plugin
       * system.
       */
      provider: z.enum(["supabase", "oidc"]).default("supabase"),

      /** Required when `provider` is `supabase`; absent on an OIDC deployment. */
      supabaseUrl: z.string().optional(),
      supabaseAnonKey: z.string().optional(),

      /**
       * Private signing material only. JWT_SECRET is a legacy deployment alias;
       * the public Supabase anon key is never a signing-secret fallback.
       */
      jwtSecret: z.string().min(1, "SUPABASE_JWT_SECRET or VERITY_SESSION_SECRET is required"),

      /** Required when `provider` is `oidc`. See platform/oidc.ts. */
      oidc: z
        .object({
          issuer: z.string().min(1),
          clientId: z.string().min(1),
          /** Defaults to the client id at the point of verification. */
          audience: z.string().optional(),
          /** Discovered from the issuer when unset. */
          jwksUri: z.string().optional(),
          principalClaim: z.string().min(1).default("sub"),
          emailClaim: z.string().min(1).default("email"),
          clockToleranceSeconds: z.coerce.number().nonnegative().default(60),
          redirectUri: z.string().url(),
          clientSecret: z.string().min(1).optional(),
          scopes: z.string().min(1).default("openid profile email"),
          sessionMaxAgeSeconds: z.coerce.number().int().min(300).max(86_400).default(28_800),
          sessionIdleSeconds: z.coerce.number().int().min(300).max(28_800).default(3_600),
        })
        .optional(),
    })
    .superRefine((auth, ctx) => {
      // Per-provider validation rather than one union of required variables:
      // an OIDC deployment must boot with no Supabase project in existence,
      // and a Supabase deployment must not be asked for an issuer. Requiring
      // both would make the boundary a fiction.
      if (auth.provider === "supabase") {
        if (!auth.supabaseUrl) {
          ctx.addIssue({ code: "custom", message: "NEXT_PUBLIC_SUPABASE_URL is required" });
        }
        if (!auth.supabaseAnonKey) {
          ctx.addIssue({ code: "custom", message: "NEXT_PUBLIC_SUPABASE_ANON_KEY is required" });
        }
      }

      if (auth.provider === "oidc" && !auth.oidc) {
        ctx.addIssue({
          code: "custom",
          message:
            "VERITY_OIDC_ISSUER and VERITY_OIDC_CLIENT_ID are required when VERITY_AUTH_PROVIDER=oidc",
        });
      }
    }),

  storage: z.object({
    /**
     * Which object store this deployment uses (Task 41).
     *
     * Selected once at install from validated configuration, exactly as
     * `auth.provider` is. Unset or incompletely configured means *no driver*,
     * which is a valid deployment state: `files.ts` refuses at the point of
     * use rather than at boot, so a deployment that never touches a file runs
     * and sign-in is not taken down by a feature nobody reached for.
     */
    driver: z.enum(["supabase", "s3"]).default("supabase"),

    /**
     * Whether the installer provisions the S3 bucket when it is missing (default
     * true). `false` means the customer owns provisioning: the installer then
     * FAILS if the bucket does not exist rather than assuming it does, and never
     * creates one. Exactly "true" or "false": `z.coerce.boolean()` would make
     * "false" mean true (Boolean("false") is true), and a bucket created against a
     * customer's explicit wish is the worse mistake. Used only by the install-time
     * ensure-bucket step; the running application never creates a bucket.
     */
    createBucket: z
      .enum(["true", "false"], { error: "VERITY_STORAGE_CREATE_BUCKET must be exactly true or false" })
      .default("true")
      .transform((value) => value === "true"),

    /** Supabase Storage. `SUPABASE_URL` overrides the public URL when set. */
    supabaseUrl: z.string().optional(),
    serviceRoleKey: z.string().optional(),
    bucket: z.string().optional(),

    /**
     * Any S3-compatible server: AWS, MinIO, SeaweedFS's S3 gateway, Ceph RGW,
     * Wasabi, Backblaze B2. One adapter, different configuration — a driver
     * written against one vendor's extensions would make the next deployment
     * a fork.
     */
    s3: z
      .object({
        bucket: z.string().min(1),
        region: z.string().min(1).default("us-east-1"),
        /** Omit for AWS; required for every self-hosted server. */
        endpoint: z.string().optional(),
        accessKeyId: z.string().min(1),
        secretAccessKey: z.string().min(1),
        /**
         * Defaults to true when an endpoint is set, because a self-hosted
         * server is almost always path-style, and the failure mode of getting
         * this wrong (`SignatureDoesNotMatch`) reads exactly like a bad key.
         */
        forcePathStyle: z.coerce.boolean().optional(),
      })
      .optional(),
  }),
}).superRefine((config, ctx) => {
  const origin = config.publicUrl;
  if (config.nodeEnv === "production" && config.auth.provider === "oidc" && !origin) {
    ctx.addIssue({
      code: "custom",
      message:
        "VERITY_PUBLIC_URL is required when VERITY_AUTH_PROVIDER=oidc in production (the https:// origin browsers use)",
    });
  }
  if (!origin) return;
  if (config.nodeEnv === "production" && config.environment === "production" && !origin.startsWith("https://")) {
    ctx.addIssue({ code: "custom", message: `VERITY_PUBLIC_URL must be https:// in a production environment (got ${origin})` });
  }
  const redirectUri = config.auth.oidc?.redirectUri;
  if (redirectUri) {
    let redirectOrigin: string | undefined;
    try {
      redirectOrigin = new URL(redirectUri).origin;
    } catch {
      redirectOrigin = undefined;
    }
    if (redirectOrigin !== origin) {
      ctx.addIssue({
        code: "custom",
        message: `VERITY_OIDC_REDIRECT_URI must be on VERITY_PUBLIC_URL (${origin})`,
      });
    }
  }
});

export type RuntimeConfig = z.infer<typeof configSchema>;

/**
 * An environment variable's value, or `undefined` when it is absent *or blank*.
 *
 * FOUND IN TASK 43, BY RUNNING THE CONTAINER (taskplans/archive/43_docker_acceptance_rerun.md).
 *
 * Docker Compose renders `${FOO:-}` for an unset optional variable as an
 * **empty string**, not as an absent one. `a ?? b` only falls through on
 * `null`/`undefined`, so `process.env.SUPABASE_JWT_SECRET ?? VERITY_SESSION_SECRET`
 * kept the empty string and the deployment failed validation with
 * `E_CONFIG_INVALID` — while every unit test passed, because a test that
 * deletes a variable produces `undefined` and never reproduces the shape a
 * container actually gets.
 *
 * A blank variable means "not configured". Normalising it here, once, is the
 * only place that belief has to be encoded.
 */
/** The value when it parses as an http(s) URL — a bare host gets `https://` — else undefined. */
function httpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value.replace(/^\/+/, "")}`;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}

function env(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function loadConfig(): RuntimeConfig {
  const result = configSchema.safeParse({
    nodeEnv: env("NODE_ENV"),
    environment: env("VERITY_ENVIRONMENT"),
    port: env("PORT"),
    publicUrl: env("VERITY_PUBLIC_URL"),
    database: {
      url: env("DATABASE_URL"),
      directUrl: env("DIRECT_URL"),
      txTimeoutMs: env("VERITY_TX_TIMEOUT_MS"),
      txMaxWaitMs: env("VERITY_TX_MAX_WAIT_MS"),
    },
    auth: {
      provider: env("VERITY_AUTH_PROVIDER"),
      supabaseUrl: env("NEXT_PUBLIC_SUPABASE_URL"),
      supabaseAnonKey: env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      jwtSecret:
        env("SUPABASE_JWT_SECRET") ??
        env("VERITY_SESSION_SECRET") ??
        env("JWT_SECRET") ??
        "",
      // Passed as undefined rather than a half-filled object when the issuer is
      // absent, so `provider=oidc` with nothing configured reports the missing
      // variables by name instead of failing on a nested field.
      oidc: env("VERITY_OIDC_ISSUER")
        ? {
            issuer: env("VERITY_OIDC_ISSUER"),
            clientId: env("VERITY_OIDC_CLIENT_ID"),
            audience: env("VERITY_OIDC_AUDIENCE"),
            jwksUri: env("VERITY_OIDC_JWKS_URI"),
            principalClaim: env("VERITY_OIDC_PRINCIPAL_CLAIM"),
            emailClaim: env("VERITY_OIDC_EMAIL_CLAIM"),
            clockToleranceSeconds: env("VERITY_OIDC_CLOCK_TOLERANCE_SECONDS"),
            redirectUri: env("VERITY_OIDC_REDIRECT_URI"),
            clientSecret: env("VERITY_OIDC_CLIENT_SECRET"),
            scopes: env("VERITY_OIDC_SCOPES"),
            sessionMaxAgeSeconds: env("VERITY_OIDC_SESSION_MAX_AGE_SECONDS"),
            sessionIdleSeconds: env("VERITY_OIDC_SESSION_IDLE_SECONDS"),
          }
        : undefined,
    },
    storage: {
      driver: env("VERITY_STORAGE_DRIVER"),
      createBucket: env("VERITY_STORAGE_CREATE_BUCKET"),
      // Passed as undefined rather than a half-filled object when the bucket is
      // absent, so an incomplete configuration binds nothing instead of failing
      // deep inside the SDK on first use.
      s3: env("VERITY_S3_BUCKET")
        ? {
            bucket: env("VERITY_S3_BUCKET"),
            region: env("VERITY_S3_REGION"),
            endpoint: env("VERITY_S3_ENDPOINT"),
            accessKeyId: env("VERITY_S3_ACCESS_KEY_ID"),
            secretAccessKey: env("VERITY_S3_SECRET_ACCESS_KEY"),
            forcePathStyle: env("VERITY_S3_FORCE_PATH_STYLE"),
          }
        : undefined,
      // Only a usable URL counts. Found 2026-09-15: the deployment's
      // SUPABASE_URL held a value the SDK rejected ("Invalid supabaseUrl"),
      // and because it was non-empty it shadowed the public one that sign-in
      // was already using — so every admin call (creating a login, signed
      // file URLs) failed while everything else worked.
      // The API host is the same one the browser signs in against, so the
      // public URL — proven by every sign-in — is the authority; SUPABASE_URL
      // is only a stand-in when no public one exists (an OIDC deployment that
      // still uses Supabase Storage). Second finding the same day: with the
      // scheme fixed, the deployment's SUPABASE_URL then failed with "fetch
      // failed" — a URL to a host that is not the API.
      supabaseUrl: httpUrl(env("NEXT_PUBLIC_SUPABASE_URL")) ?? httpUrl(env("SUPABASE_URL")),
      serviceRoleKey: env("SUPABASE_SERVICE_ROLE_KEY"),
      bucket: env("SUPABASE_MEDIA_BUCKET"),
    },
  });

  if (!result.success) {
    console.error("[verity] runtime configuration is invalid:", result.error.format());
    throw new Error(
      `E_CONFIG_INVALID: ${result.error.issues.map((i) => i.message).join("; ")}`,
    );
  }

  return result.data;
}

export const runtimeConfig: RuntimeConfig = loadConfig();

/**
 * `CRON_SECRET`, read live. See the module comment: this is the one value in
 * the platform's configuration surface that is read fresh per call rather
 * than fixed at process start, because a scheduler endpoint's whole security
 * story is comparing against whatever secret is configured *right now*.
 */
export function readCronSecret(): string | undefined {
  return process.env.CRON_SECRET;
}

/**
 * Task 84 area 6 provider config, read live like `readCronSecret` above and
 * for the same reason: absent by default rather than validated at boot, so a
 * deployment with no chat provider configured still starts. `OPENAI_API_KEY`/
 * `OPENAI_BASE_URL`/`OPENAI_MODEL` already exist for a different purpose in
 * `.env` (pointed at Groq's OpenAI-compatible endpoint) — reused here rather
 * than adding a second, agent-specific env var name for the same shape of
 * value.
 */
export function readAgentProviderConfig():
  | { apiKey: string; baseUrl: string; model: string }
  | undefined {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL;
  const model = process.env.OPENAI_MODEL;
  if (!apiKey || !baseUrl || !model) return undefined;
  return { apiKey, baseUrl, model };
}
