import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildIdentity,
  captureError,
  currentRequestContext,
  increment,
  log,
  logger,
  metricsSnapshot,
  observeDuration,
  redactFieldsForLog,
  recordExpectedRequestOutcome,
  registerErrorSink,
  registerLogSink,
  registerMetricSink,
  resetObservability,
  timed,
  withRequestContext,
  type LogRecord,
} from "@/server/platform/observability";
import { toActionFailure } from "@/server/platform/action-error";
import { AuthenticationRequiredError } from "@/server/platform/auth";

/**
 * Task 40 — the observability contract.
 * Plan: taskplans/archive/40_enterprise_observability.md.
 *
 * The five questions an operator must be able to answer from outside the
 * source: is it healthy, what is failing, which request caused it, which
 * dependency is slow, which deployment is affected.
 */

let captured: LogRecord[] = [];

const ENV_KEYS = [
  "VERITY_SERVICE_NAME", "VERITY_VERSION", "VERITY_COMMIT", "VERITY_ENVIRONMENT",
] as const;
let envSnapshot: Record<string, string | undefined>;

beforeEach(() => {
  captured = [];
  envSnapshot = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  resetObservability();
  registerLogSink((record) => captured.push(record));
});

afterEach(() => {
  resetObservability();
  for (const key of ENV_KEYS) {
    if (envSnapshot[key] === undefined) delete process.env[key];
    else process.env[key] = envSnapshot[key];
  }
});

describe("structured logging (AC-01)", () => {
  it("emits a structured record with level, message and timestamp", () => {
    logger.info("tenant provisioned", { tenantCount: 3 });

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      level: "info",
      message: "tenant provisioned",
      fields: { tenantCount: 3 },
    });
    expect(new Date(captured[0]!.timestamp).toString()).not.toBe("Invalid Date");
  });

  it("defaults to a JSON-serialisable record, so stdout collection needs no configuration", () => {
    logger.warn("slow query", { ms: 1200 });
    expect(() => JSON.parse(JSON.stringify(captured[0]))).not.toThrow();
  });

  it("carries every level", () => {
    log("debug", "d"); log("info", "i"); log("warn", "w"); log("error", "e");
    expect(captured.map((r) => r.level)).toEqual(["debug", "info", "warn", "error"]);
  });
});

describe("ambient request context (AC-02)", () => {
  it("attaches correlation, tenant, route and channel without being handed them", () => {
    withRequestContext(
      { correlationId: "corr-1", tenantId: "tenant-1", userId: "user-1", route: "verity.party.suspend", channel: "human" },
      () => {
        // The call site knows nothing about the context. That is the point:
        // threading an argument through every function is what makes
        // correlation optional in practice.
        logger.info("suspended");
      },
    );

    expect(captured[0]).toMatchObject({
      correlationId: "corr-1",
      tenantId: "tenant-1",
      userId: "user-1",
      route: "verity.party.suspend",
      channel: "human",
    });
  });

  it("survives an await boundary inside the request", async () => {
    await withRequestContext({ correlationId: "corr-async" }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      logger.info("after await");
      expect(currentRequestContext()?.correlationId).toBe("corr-async");
    });
    expect(captured[0]!.correlationId).toBe("corr-async");
  });

  it("does not leak context between requests", () => {
    withRequestContext({ correlationId: "a" }, () => logger.info("first"));
    withRequestContext({ correlationId: "b" }, () => logger.info("second"));
    logger.info("outside");

    expect(captured.map((r) => r.correlationId)).toEqual(["a", "b", "-"]);
    expect(currentRequestContext()).toBeUndefined();
  });
});

describe("secrets never reach a log (AC-03)", () => {
  it("redacts secret-shaped fields by name", () => {
    expect(redactFieldsForLog({ apiKey: "sk-live-1", region: "ap-south-1" })).toEqual({
      apiKey: "[redacted]",
      region: "ap-south-1",
    });
  });

  it("redacts nested fields", () => {
    expect(redactFieldsForLog({ upstream: { clientSecret: "x", host: "erp.test" } })).toEqual({
      upstream: { clientSecret: "[redacted]", host: "erp.test" },
    });
  });

  it("redacts credential-shaped text inside an ordinary string value", () => {
    logger.error("call failed", { detail: "Authorization: Bearer sk-live-leaked" });
    expect(JSON.stringify(captured[0])).not.toContain("sk-live-leaked");
  });

  it("redacts the message itself, not only the fields", () => {
    logger.error("upstream rejected Authorization: Bearer sk-live-in-message");
    expect(captured[0]!.message).not.toContain("sk-live-in-message");
  });

  it("truncates a long value: a log line carries identifiers, not payloads", () => {
    logger.info("bulk", { body: "x".repeat(2000) });
    const body = (captured[0]!.fields!.body as string);
    expect(body.length).toBeLessThan(600);
    expect(body).toMatch(/truncated/);
  });
});

describe("metrics (AC-04, AC-05)", () => {
  it("counts and labels", () => {
    increment("commands_total", { command: "verity.party.suspend", outcome: "ok" });
    increment("commands_total", { command: "verity.party.suspend", outcome: "ok" });
    increment("commands_total", { command: "verity.party.suspend", outcome: "error" });

    const snapshot = metricsSnapshot();
    expect(snapshot.counters["commands_total{command=verity.party.suspend,outcome=ok}"]).toBe(2);
    expect(snapshot.counters["commands_total{command=verity.party.suspend,outcome=error}"]).toBe(1);
  });

  it("summarises durations with count, average, max and p95", () => {
    for (const ms of [10, 20, 30, 40, 1000]) {
      observeDuration("dependency_duration_ms", ms, { dependency: "database" });
    }

    const series = metricsSnapshot().durations["dependency_duration_ms{dependency=database}"]!;
    expect(series.count).toBe(5);
    expect(series.maxMs).toBe(1000);
    expect(series.p95Ms).toBe(1000);
    expect(series.avgMs).toBe(220);
  });

  it("answers which dependency is slow, per dependency", async () => {
    await timed("database", "query", async () => {
      await new Promise((r) => setTimeout(r, 20));
      return 1;
    });
    await timed("integration:customer-master", "upsert", async () => 1);

    const durations = metricsSnapshot().durations;
    // Separate series, so a slow dependency is visible without reading a log.
    expect(
      durations["dependency_duration_ms{dependency=database,operation=query,outcome=ok}"]!.count,
    ).toBe(1);
    expect(
      durations["dependency_duration_ms{dependency=integration:customer-master,operation=upsert,outcome=ok}"]!.count,
    ).toBe(1);
  });

  it("records the duration of a failed dependency call too, and counts the failure", async () => {
    await expect(
      timed("storage", "upload", async () => {
        throw new Error("bucket unavailable");
      }),
    ).rejects.toThrow("bucket unavailable");

    const snapshot = metricsSnapshot();
    // A dependency that is slow *and* failing is the interesting case;
    // recording only successes hides exactly that.
    expect(
      snapshot.durations["dependency_duration_ms{dependency=storage,operation=upload,outcome=error}"]!.count,
    ).toBe(1);
    expect(snapshot.counters["dependency_errors_total{dependency=storage,operation=upload}"]).toBe(1);
  });

  it("forwards to a registered metric sink without owning it", () => {
    const seen: string[] = [];
    registerMetricSink((metric) => seen.push(`${metric.kind}:${metric.name}`));

    increment("errors_total");
    observeDuration("dependency_duration_ms", 5, {});

    expect(seen).toEqual(["counter:errors_total", "duration:dependency_duration_ms"]);
  });
});

describe("build identity (AC-06)", () => {
  it("names the deployment on every log line", () => {
    process.env.VERITY_SERVICE_NAME = "verity";
    process.env.VERITY_VERSION = "1.4.2";
    process.env.VERITY_COMMIT = "abc1234";
    process.env.VERITY_ENVIRONMENT = "production";

    logger.info("started");

    expect(captured[0]).toMatchObject({
      service: "verity",
      version: "1.4.2",
      commit: "abc1234",
      environment: "production",
    });
  });

  it("distinguishes two deployments of the same version by commit", () => {
    process.env.VERITY_VERSION = "1.4.2";
    process.env.VERITY_COMMIT = "aaaaaaa";
    const first = buildIdentity();
    process.env.VERITY_COMMIT = "bbbbbbb";
    const second = buildIdentity();

    // "Which deployment is affected" is not answered by a version alone; two
    // deployments of one version is a common and real situation.
    expect(first.version).toBe(second.version);
    expect(first.commit).not.toBe(second.commit);
  });

  it("falls back to a development identity rather than failing", () => {
    for (const key of ENV_KEYS) delete process.env[key];
    delete process.env.VERCEL_GIT_COMMIT_SHA;

    expect(buildIdentity()).toMatchObject({ service: "verity", version: "0.0.0-dev" });
  });
});

describe("errors (AC-02, AC-04)", () => {
  it("records an expected authentication denial without error telemetry or a stack", () => {
    const exportedErrors: unknown[] = [];
    registerErrorSink((error) => exportedErrors.push(error));

    expect(toActionFailure(new AuthenticationRequiredError())).toMatchObject({
      code: "E_UNAUTHENTICATED",
      retryable: false,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      level: "info",
      message: "request outcome",
      fields: { reasonCode: "E_UNAUTHENTICATED" },
    });
    expect(captured[0]?.fields).not.toHaveProperty("stack");
    expect(exportedErrors).toHaveLength(0);
    expect(metricsSnapshot().counters).toEqual({});
  });

  it("classifies framework redirects and not-found responses without fault telemetry", () => {
    expect(recordExpectedRequestOutcome({ digest: "NEXT_REDIRECT;replace;/sign-in;307;" })).toBe(true);
    expect(recordExpectedRequestOutcome({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" })).toBe(true);
    expect(recordExpectedRequestOutcome(new Error("database unavailable"))).toBe(false);
    expect(captured.map((record) => record.fields?.reasonCode)).toEqual([
      "NEXT_REDIRECT",
      "NEXT_NOT_FOUND",
    ]);
    expect(captured.every((record) => record.level === "info" && !("stack" in (record.fields ?? {})))).toBe(true);
    expect(metricsSnapshot().counters).toEqual({});
  });

  it("records what failed, with the correlation id of the request that caused it", () => {
    withRequestContext({ correlationId: "corr-err", tenantId: "t1", route: "/api/x" }, () => {
      captureError(new Error("upstream exploded"), { route: "/api/x" });
    });

    expect(captured[0]).toMatchObject({
      level: "error",
      message: "upstream exploded",
      correlationId: "corr-err",
      tenantId: "t1",
    });
    // The same id Task 38 wrote onto the audit rows, so an operator moves from
    // a log line to the exact business changes that request made.
    expect(metricsSnapshot().counters["errors_total{route=/api/x}"]).toBe(1);
  });

  it("labels a coded error by its code", () => {
    captureError(Object.assign(new Error("nope"), { code: "E_FORBIDDEN" }));
    expect(metricsSnapshot().counters["errors_total{code=E_FORBIDDEN}"]).toBe(1);
  });

  it("keeps a stack trace but redacts credentials from it", () => {
    const error = new Error("connect failed");
    error.stack = "Error: connect failed\n    at db (postgresql://user:pw@host/db?password=hunter2)";
    captureError(error);

    const rendered = JSON.stringify(captured[0]);
    expect(rendered).toContain("connect failed");
    expect(rendered).not.toContain("user:pw");
    expect(rendered).not.toContain("postgresql://user");
    expect(rendered).not.toContain("hunter2");
  });

  it("forwards to a registered error sink without binding one", () => {
    const seen: unknown[] = [];
    registerErrorSink((error) => seen.push(error));
    captureError(new Error("boom"));
    expect(seen).toHaveLength(1);
  });
});

describe("observability must never break the request (AC-07)", () => {
  it("swallows a throwing log sink", () => {
    registerLogSink(() => {
      throw new Error("collector is down");
    });
    // A monitoring outage that takes production down is a self-inflicted
    // incident, and it is the most common one in this area.
    expect(() => logger.info("still fine")).not.toThrow();
  });

  it("swallows a throwing metric sink and still records locally", () => {
    registerMetricSink(() => {
      throw new Error("collector is down");
    });
    expect(() => increment("errors_total")).not.toThrow();
    expect(metricsSnapshot().counters["errors_total"]).toBe(1);
  });

  it("swallows a throwing error sink", () => {
    registerErrorSink(() => {
      throw new Error("sentry is down");
    });
    expect(() => captureError(new Error("original"))).not.toThrow();
  });
});

describe("infrastructure stays replaceable (AC-08)", () => {
  const codeOf = (relative: string) =>
    readFileSync(resolve(process.cwd(), relative), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("binds no vendor in the platform contract", () => {
    const source = codeOf("src/server/platform/observability.ts");

    // Sentry and OpenTelemetry are present in package.json; none of these may
    // be imported here — the platform owns the vocabulary and the destination
    // is a deployment decision.
    //
    // PostHog is named too, though it is no longer a dependency: it was
    // removed in Task 66 as unused, and it was the only path by which a
    // browser-reachable advisory (dompurify) entered the tree. Keeping it in
    // this assertion means re-adding it would have to pass this test again.
    expect(source).not.toMatch(/@sentry|@opentelemetry|posthog|datadog|newrelic/i);
  });

  it("keeps the default sink to stdout, so an unconfigured deployment is still observable", () => {
    const source = codeOf("src/server/platform/observability.ts");
    expect(source).toMatch(/process\.stdout\.write/);
    expect(source).toMatch(/process\.stderr\.write/);
  });
});

describe("the command runtime supplies the context (AC-02)", () => {
  it("wraps execution in a request context carrying the correlation id", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/platform/command.ts"), "utf8");

    // The correlation id Task 38 mints is the same one Task 40 logs under —
    // one identifier from the audit trail to the log stream, with no join on
    // timestamps anywhere.
    expect(source).toMatch(/withRequestContext\(/);
    expect(source).toMatch(/correlationId,/);
  });
});
