/**
 * The workload a scale run is sized against, read from the environment.
 *
 * Authority: taskplans/123_enterprise_readiness_evidence_program.md, Phase 0/1.
 *
 * DELIBERATELY NO DEFAULTS. The point of Task 123 is to replace assumed
 * numbers with measured ones against a real prospect's workload; a default
 * here would quietly become "the number we tested" in a claim. A run states
 * its workload or it does not start.
 *
 * Two ways to size a run:
 *   - a real workload:  WORKERS, VISITS_PER_WORKER_PER_DAY, RETENTION_DAYS,
 *                       EVIDENCE_PER_VISIT
 *   - a pure size step: SCALE_VISITS (1k/10k/100k/1M/10M...) plus
 *                       EVIDENCE_PER_VISIT, for index and plan work that is
 *                       not tied to any one prospect.
 * TENANTS (required) says how many tenants the rows are spread across, because
 * isolation cost is part of what is being measured.
 */

export interface Workload {
  tenants: number;
  visits: number;
  evidencePerVisit: number;
  retentionDays: number;
  /** "workload" when derived from worker counts, "size-step" when given directly. */
  source: "workload" | "size-step";
}

type Env = Record<string, string | undefined>;

function int(env: Env, name: string, min: number): number | undefined {
  const raw = env[name];
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    throw new Error(`${name} must be an integer >= ${min}, got "${raw}"`);
  }
  return n;
}

function need(value: number | undefined, name: string): number {
  if (value === undefined) {
    throw new Error(
      `${name} is required. Scale runs have no default workload (Task 123): state the workload or a size step explicitly.`,
    );
  }
  return value;
}

export function readWorkload(env: Env = process.env): Workload {
  const tenants = need(int(env, "TENANTS", 1), "TENANTS");
  const evidencePerVisit = need(int(env, "EVIDENCE_PER_VISIT", 0), "EVIDENCE_PER_VISIT");
  const sizeStep = int(env, "SCALE_VISITS", 1);
  const retentionDays = int(env, "RETENTION_DAYS", 1);

  if (sizeStep !== undefined) {
    return {
      tenants,
      visits: sizeStep,
      evidencePerVisit,
      retentionDays: retentionDays ?? 365,
      source: "size-step",
    };
  }

  const workers = need(int(env, "WORKERS", 1), "WORKERS");
  const perDay = need(int(env, "VISITS_PER_WORKER_PER_DAY", 1), "VISITS_PER_WORKER_PER_DAY");
  const days = need(retentionDays, "RETENTION_DAYS");
  return {
    tenants,
    visits: workers * perDay * days,
    evidencePerVisit,
    retentionDays: days,
    source: "workload",
  };
}
