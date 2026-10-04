import { AsyncLocalStorage } from "node:async_hooks";
import { isSensitiveField } from "./audit";
import { redactMessage } from "./redaction";

/**
 * The observability contract.
 *
 * Authority: taskplans/archive/40_enterprise_observability.md; INV-001 (a log line is
 * still tenant data); MET-AUT-003 and Task 38 (secrets are never retained).
 *
 * ```text
 *          log()   metric()   captureError()
 *                │      │      │
 *                ▼      ▼      ▼
 *          LogSink  MetricSink  ErrorSink     ← registered at deployment
 *                │      │      │
 *                ▼      ▼      ▼
 *      stdout JSON   in-memory   (none by default)
 * ```
 *
 * A CONTRACT, NOT A PRODUCT
 * The platform owns the vocabulary — what a log line means, what a metric is
 * named, what an error carries — and the destination is a deployment decision.
 * Same shape as storage (Task 27) and integrations (Task 39), and for the same
 * reason: an enterprise already has a stack, and a platform that insists on its
 * own is a platform they have to fight.
 *
 * THE DEFAULTS STILL WORK
 * Unconfigured, this writes JSON lines to stdout — which every container
 * platform already collects — and keeps metrics in memory, which `/api/metrics`
 * can serve without a time-series database existing anywhere. "Observability
 * requires configuration" is how a deployment ends up with none.
 *
 * OBSERVABILITY MUST NEVER BREAK THE REQUEST
 * Every sink call is wrapped. A monitoring outage that takes production down is
 * a self-inflicted incident, and it is the most common one in this area.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Ambient per-request facts. Carried, never passed by hand. */
export type RequestContext = {
  correlationId: string;
  tenantId?: string;
  userId?: string;
  /** Route or job name — "where", for an operator reading a stream. */
  route?: string;
  /** How the request arrived, matching Task 37's PolicyChannel vocabulary. */
  channel?: string;
};

export type LogRecord = RequestContext & {
  level: LogLevel;
  message: string;
  timestamp: string;
  /** Build identity — "which deployment is affected". */
  service: string;
  version: string;
  commit?: string;
  environment: string;
  fields?: Record<string, unknown>;
};

export type LogSink = (record: LogRecord) => void;
export type MetricSink = (metric: { name: string; value: number; labels: Record<string, string>; kind: "counter" | "duration" }) => void;
export type ErrorSink = (error: unknown, record: LogRecord) => void;

/* ------------------------------------------------------------------------- *
 * Build identity
 * ------------------------------------------------------------------------- */

/**
 * Which build this is.
 *
 * Read from the environment rather than imported from `package.json`, because
 * the question an operator asks is "which deployment is affected", and two
 * deployments of the same version are a real and common situation. The commit
 * is what distinguishes them.
 */
export function buildIdentity(): { service: string; version: string; commit?: string; environment: string } {
  return {
    service: process.env.VERITY_SERVICE_NAME ?? "verity",
    version: process.env.VERITY_VERSION ?? "0.0.0-dev",
    commit: process.env.VERITY_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA,
    environment: process.env.VERITY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
  };
}

/* ------------------------------------------------------------------------- *
 * Ambient request context
 * ------------------------------------------------------------------------- */

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `fn` with an ambient request context.
 *
 * The alternative — threading a context argument through every function — is
 * what makes correlation optional in practice. It works until someone adds a
 * call site and forgets, and then the one log line that mattered is the one
 * without the id.
 */
export function withRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/* ------------------------------------------------------------------------- *
 * Sinks
 * ------------------------------------------------------------------------- */

/** JSON lines on stdout: the one format every container platform collects. */
const stdoutSink: LogSink = (record) => {
  const line = JSON.stringify(record);
  if (record.level === "error" || record.level === "warn") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
};

let logSink: LogSink = stdoutSink;
let metricSink: MetricSink | null = null;
let errorSink: ErrorSink | null = null;

export function registerLogSink(sink: LogSink): void {
  logSink = sink;
}

export function registerMetricSink(sink: MetricSink): void {
  metricSink = sink;
}

export function registerErrorSink(sink: ErrorSink): void {
  errorSink = sink;
}

/** Restores the defaults. For tests and for an operator disabling an export. */
export function resetObservability(): void {
  logSink = stdoutSink;
  metricSink = null;
  errorSink = null;
  counters.clear();
  durations.clear();
}

/**
 * Calls a sink without letting it affect the caller.
 *
 * Deliberately silent: reporting a logging failure by logging it is a loop, and
 * throwing from a log call turns an observability problem into an outage.
 */
function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    // Intentionally swallowed. See above.
  }
}

/* ------------------------------------------------------------------------- *
 * Field redaction
 * ------------------------------------------------------------------------- */

/**
 * Removes secret-shaped values from structured log fields.
 *
 * Logging is the easiest place in any system to leak a credential, because it
 * is where people paste whole objects. This reuses Task 38's field-name rule
 * rather than defining a second list that would drift from it.
 *
 * A value longer than 512 characters is truncated: a log line is an identifier
 * carrier, not a payload store, and INV-001 means one tenant's data must not
 * end up in a stream another tenant's operator reads.
 */
export function redactFieldsForLog(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (isSensitiveField(key)) {
      out[key] = value === null || value === undefined ? value : "[redacted]";
    } else if (typeof value === "string") {
      out[key] = truncate(redactMessage(value));
    } else if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      out[key] = redactFieldsForLog(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function truncate(value: string): string {
  return value.length > 512 ? `${value.slice(0, 512)}…[truncated]` : value;
}

/* ------------------------------------------------------------------------- *
 * Logging
 * ------------------------------------------------------------------------- */

export function log(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
  const context = currentRequestContext();
  const record: LogRecord = {
    ...buildIdentity(),
    ...context,
    correlationId: context?.correlationId ?? "-",
    level,
    message: redactMessage(message),
    timestamp: new Date().toISOString(),
    ...(fields ? { fields: redactFieldsForLog(fields) } : {}),
  };
  safely(() => logSink(record));
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => log("debug", message, fields),
  info: (message: string, fields?: Record<string, unknown>) => log("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => log("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) => log("error", message, fields),
};

const EXPECTED_DENIAL_CODES = new Set([
  "E_UNAUTHENTICATED",
  "E_FORBIDDEN",
  "E_CAPABILITY_INACTIVE",
  "E_CAPABILITY_UNKNOWN",
  "E_CAPABILITY_DEPENDENCY_INACTIVE",
  "E_CAPABILITY_VERSION_INCOMPATIBLE",
]);

/**
 * Records request outcomes that are part of normal access control or routing.
 *
 * Next may pass either the original error or a React-processed error carrying
 * only a digest to `onRequestError`, so this intentionally recognizes both.
 * It never emits the error message or stack: authorization messages can contain
 * actor/entity identifiers, and expected control flow is not fault telemetry.
 */
export function recordExpectedRequestOutcome(
  error: unknown,
  fields?: Record<string, unknown>,
): boolean {
  const candidate = error as { code?: unknown; digest?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : undefined;
  const digest = typeof candidate?.digest === "string" ? candidate.digest : undefined;
  const reasonCode = code && EXPECTED_DENIAL_CODES.has(code)
    ? code
    : digest?.startsWith("NEXT_REDIRECT")
      ? "NEXT_REDIRECT"
      : digest?.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")
        ? "NEXT_NOT_FOUND"
        : undefined;

  if (!reasonCode) return false;
  log("info", "request outcome", { ...(fields ?? {}), reasonCode });
  return true;
}

/* ------------------------------------------------------------------------- *
 * Metrics
 * ------------------------------------------------------------------------- */

type DurationSeries = { count: number; totalMs: number; maxMs: number; p95Sample: number[] };

const counters = new Map<string, number>();
const durations = new Map<string, DurationSeries>();

function seriesKey(name: string, labels: Record<string, string>): string {
  const rendered = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
  return rendered ? `${name}{${rendered}}` : name;
}

export function increment(name: string, labels: Record<string, string> = {}, by = 1): void {
  const key = seriesKey(name, labels);
  counters.set(key, (counters.get(key) ?? 0) + by);
  safely(() => metricSink?.({ name, value: by, labels, kind: "counter" }));
}

export function observeDuration(name: string, ms: number, labels: Record<string, string> = {}): void {
  const key = seriesKey(name, labels);
  const series = durations.get(key) ?? { count: 0, totalMs: 0, maxMs: 0, p95Sample: [] };
  series.count += 1;
  series.totalMs += ms;
  series.maxMs = Math.max(series.maxMs, ms);
  // A bounded reservoir: enough for a percentile an operator can act on,
  // small enough that a long-running process does not grow without limit.
  if (series.p95Sample.length < 256) series.p95Sample.push(ms);
  else series.p95Sample[Math.floor(Math.random() * 256)] = ms;
  durations.set(key, series);
  safely(() => metricSink?.({ name, value: ms, labels, kind: "duration" }));
}

/**
 * Times a dependency call and records its outcome.
 *
 * This is the mechanism behind "which dependency is slow?". The label is the
 * dependency's name, so `database`, `storage` and `integration:customer-master`
 * are separate series and a slow one is visible without reading a log at all.
 * The duration is recorded on failure too — a dependency that is slow *and*
 * failing is the interesting case, and recording only successes hides it.
 */
export async function timed<T>(
  dependency: string,
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    observeDuration("dependency_duration_ms", Date.now() - startedAt, {
      dependency,
      operation,
      outcome: "ok",
    });
    return result;
  } catch (error) {
    observeDuration("dependency_duration_ms", Date.now() - startedAt, {
      dependency,
      operation,
      outcome: "error",
    });
    increment("dependency_errors_total", { dependency, operation });
    throw error;
  }
}

export type MetricsSnapshot = {
  counters: Record<string, number>;
  durations: Record<string, { count: number; avgMs: number; maxMs: number; p95Ms: number }>;
};

/** Everything measured since process start, or since the last reset. */
export function metricsSnapshot(): MetricsSnapshot {
  return {
    counters: Object.fromEntries([...counters.entries()].sort(([a], [b]) => a.localeCompare(b))),
    durations: Object.fromEntries(
      [...durations.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, series]) => {
          const sorted = [...series.p95Sample].sort((a, b) => a - b);
          const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
          return [
            key,
            {
              count: series.count,
              avgMs: Math.round(series.totalMs / series.count),
              maxMs: series.maxMs,
              p95Ms: sorted.length > 0 ? sorted[index]! : 0,
            },
          ];
        }),
    ),
  };
}

/* ------------------------------------------------------------------------- *
 * Errors
 * ------------------------------------------------------------------------- */

/**
 * Records a failure.
 *
 * Answers "what is failing" as a counter and "which request caused it" through
 * the ambient correlation id, which is the same id Task 38 wrote onto the audit
 * rows — so an operator moves from a log line to the exact business changes that
 * request made, without joining on timestamps.
 *
 * The error's own message is redacted before it is emitted: a stack trace or a
 * driver error can quote a connection string or an Authorization header.
 */
export function captureError(error: unknown, fields?: Record<string, unknown>): void {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string } | null)?.code;

  increment("errors_total", { ...(code ? { code } : {}), ...(fields?.route ? { route: String(fields.route) } : {}) });

  const context = currentRequestContext();
  const record: LogRecord = {
    ...buildIdentity(),
    ...context,
    correlationId: context?.correlationId ?? "-",
    level: "error",
    message: redactMessage(message),
    timestamp: new Date().toISOString(),
    fields: redactFieldsForLog({
      ...(fields ?? {}),
      ...(code ? { code } : {}),
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    }),
  };

  safely(() => logSink(record));
  safely(() => errorSink?.(error, record));
}
