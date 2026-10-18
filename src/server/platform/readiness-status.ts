/**
 * How readiness probe results become one answer (approved 2026-10-19, clients/dsew/onprem-stage2-design.md section 2).
 *
 * Two tiers. CORE checks decide whether the application can serve at all: a failure means `not_ready` (HTTP 503), so
 * an orchestrator restarts or stops routing to it. DEPENDENCY checks decide whether a supporting service is up: a failure
 * means `degraded` (HTTP 200) with the component named, because the rest of the application still works and existing
 * sessions, reads and writes must not be hidden by a Keycloak, object-store or scheduler outage.
 *
 * Degraded is a REPORT, never a bypass: authorization, tenant isolation, QC and evidence rules are enforced by the commands
 * themselves and do not consult this module. Pure and dependency-free so every rule is unit-tested without a server.
 */

export type ProbeResult = { status: "ok" | "skipped" | "error"; code?: string };
export type ComponentState = "healthy" | "degraded" | "unavailable";
export type Tier = "core" | "dependency";
export type OverallStatus = "ready" | "degraded" | "not_ready";

/** Which tier each check belongs to. An unlisted check is treated as core: unknown means fail closed. */
export const CHECK_TIERS: Record<string, Tier> = {
  db: "core",
  schema: "core",
  rls: "core",
  restore: "core",
  runtime: "core",
  identity: "dependency",
  storage: "dependency",
  scheduler: "dependency",
};

export type Component = { tier: Tier; state: ComponentState; code?: string };

export function summarizeReadiness(checks: Record<string, ProbeResult>): {
  status: OverallStatus;
  httpStatus: 200 | 503;
  components: Record<string, Component>;
} {
  const components: Record<string, Component> = {};
  let coreFailed = false;
  let dependencyFailed = false;

  for (const [name, result] of Object.entries(checks)) {
    const tier = CHECK_TIERS[name] ?? "core";
    const failed = result.status === "error";
    // A dependency that is down is degraded (the app works without it); a core failure is unavailable.
    const state: ComponentState = !failed ? "healthy" : tier === "core" ? "unavailable" : "degraded";
    components[name] = { tier, state, ...(failed && result.code ? { code: result.code } : {}) };
    if (failed && tier === "core") coreFailed = true;
    if (failed && tier === "dependency") dependencyFailed = true;
  }

  const status: OverallStatus = coreFailed ? "not_ready" : dependencyFailed ? "degraded" : "ready";
  return { status, httpStatus: coreFailed ? 503 : 200, components };
}
