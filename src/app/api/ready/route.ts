import { NextResponse } from "next/server";
import { buildIdentity, captureError, increment, observeDuration } from "@/server/platform/observability";
import { summarizeReadiness } from "@/server/platform/readiness-status";
import {
  probeDatabase,
  probeIdentity,
  probeRestoreState,
  probeRls,
  probeRuntimePrivileges,
  probeScheduler,
  probeSchema,
  probeStorage,
  type ReadinessCheck,
} from "@/server/platform/readiness";

/**
 * Profile-aware readiness. Each dependency has a stable public reason code;
 * raw driver/provider errors stay in protected telemetry and never enter the
 * response. Optional unconfigured storage is explicit rather than falsely
 * green. All network probes are bounded in the readiness module.
 */
export const dynamic = "force-dynamic";

async function check(
  name: string,
  code: string,
  work: () => Promise<void | ReadinessCheck>,
): Promise<[string, ReadinessCheck]> {
  try {
    const result = await work();
    return [name, result ?? { status: "ok" }];
  } catch (error) {
    captureError(error, { route: "/api/ready", dependency: name, reasonCode: code });
    return [name, { status: "error", code }];
  }
}

export async function GET() {
  const startedAt = Date.now();
  const entries = await Promise.all([
    check("db", "database_unavailable", probeDatabase),
    check("schema", "schema_incompatible", probeSchema),
    check("rls", "rls_not_enforceable", probeRls),
    check("identity", "identity_unavailable", probeIdentity),
    check("storage", "storage_unavailable", probeStorage),
    check("scheduler", "scheduler_stale", probeScheduler),
    check("restore", "restore_quarantined", probeRestoreState),
    check("runtime", "runtime_privilege_or_secret_invalid", async () => probeRuntimePrivileges()),
  ]);
  const checks = Object.fromEntries(entries) as Record<string, ReadinessCheck>;
  // Core failure -> 503. A failed dependency (identity, storage, scheduler) -> 200 "degraded" with the component named,
  // so a Keycloak or object-store outage does not take a working application out of rotation.
  const { status, httpStatus, components } = summarizeReadiness(checks);
  const durationMs = Date.now() - startedAt;

  observeDuration("dependency_duration_ms", durationMs, {
    dependency: "readiness",
    operation: "ready_probe",
    outcome: status === "ready" ? "ok" : status === "degraded" ? "degraded" : "error",
  });
  for (const [name, component] of Object.entries(components)) {
    if (component.state !== "healthy") increment("dependency_degraded_total", { dependency: name, state: component.state });
  }

  return NextResponse.json(
    {
      status,
      checks,
      components,
      durationMs,
      ...buildIdentity(),
    },
    { status: httpStatus },
  );
}
