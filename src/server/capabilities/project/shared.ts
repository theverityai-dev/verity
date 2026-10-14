import { ValidationError } from "@/server/platform/command";
import type { TenantScopedClient } from "@/server/platform/tenancy";

export const PROJECT_CAPABILITY = "verity.capability.project";
export const ENTITY_PROJECT_JOB = "verity.project.job";
export const ENTITY_PROJECT_QUOTE = "verity.project.quote";
export const ENTITY_PROJECT_MILESTONE = "verity.project.milestone";
export const ENTITY_PROJECT_TASK = "verity.project.task";
export const ENTITY_PROJECT_TIME_ENTRY = "verity.project.time_entry";
export const ENTITY_PROJECT_COST_ENTRY = "verity.project.cost_entry";
export const ENTITY_PROJECT_LOST_REASON = "verity.project.lost_reason";

export const JOB_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const COST_KINDS = ["outsourced", "testing", "freight", "other"] as const;

/** Job states that still accept work, time and cost. Terminal states are read-only (INV-002). */
export const WORKING_JOB_STATES = ["approved", "in_progress", "on_hold"];

/** The reference people say out loud, built from the per-tenant running number. */
export function jobReference(number: number): string {
  return `J-${String(number).padStart(4, "0")}`;
}

/**
 * The next per-tenant job number. Serialised by an advisory lock held to the end of the
 * transaction, so two jobs created at once cannot take the same number; the unique index
 * on (tenant, number) is the backstop.
 */
export async function nextJobNumber(tx: TenantScopedClient, tenantId: string): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["project-job-number", tenantId])}, 0))`;
  const top = await tx.projectJob.aggregate({ _max: { number: true } });
  return (top._max.number ?? 0) + 1;
}

/** Loads a job and refuses when it is not in a state that accepts the change named. */
export async function loadWorkingJob(tx: TenantScopedClient, jobId: string, what: string) {
  const job = await tx.projectJob.findUnique({ where: { id: jobId } });
  if (!job) throw new ValidationError("E_VALIDATION: job not found in this tenant");
  if (!WORKING_JOB_STATES.includes(job.state)) {
    throw new ValidationError(
      `E_VALIDATION: ${what} needs an approved job that is not finished; this job is ${job.state.replace(/_/g, " ")}`,
    );
  }
  return job;
}

/** Minutes and an hourly rate in minor units to a cost in minor units, rounded to the nearest unit. */
export function labourCostMinor(minutes: number, hourlyRateMinor: number): number {
  return Math.round((minutes * hourlyRateMinor) / 60);
}
