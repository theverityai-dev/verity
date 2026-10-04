import { randomUUID } from "node:crypto";

/**
 * The provider-neutral background-job contract.
 *
 * Authority: taskplans/archive/29_background_job_abstraction.md.
 *
 * WHY THIS EXISTS, GIVEN NOTHING CALLS IT YET
 * The inventory this task performed (see the taskplan) found no discrete,
 * one-off asynchronous unit of work anywhere in the codebase today —
 * `notification.ts` writes a `Pending` row inside the raising command's own
 * transaction and says so explicitly ("the dispatcher is deliberately not
 * implemented here"); `domainEvent.deliveredAt` is a written but undrained
 * outbox column. Recurring work is already correctly abstracted
 * (`ScheduleContribution`/`runDueWork` in `contribution.ts`) and is
 * deliberately NOT touched by this file — see the taskplan's classification
 * for why SCHEDULED_JOB and BACKGROUND_JOB stay separate concepts.
 *
 * So this is infrastructure built ahead of a caller, which this task's own
 * brief explicitly sanctions ("a minimal synchronous/test implementation may
 * be sufficient for the abstraction until a production queue becomes
 * necessary") — the same posture `files.ts` took in Task 27 before the
 * plywood client gave it a first real user. When a real dispatcher is built
 * (notification delivery, outbox drain), it defines a `JobHandler` and calls
 * `jobRunner.run()`; it does not need to know whether execution is
 * synchronous, database-polled, or queue-backed.
 *
 * WHY THE ACTIVE RUNNER IS SYNCHRONOUS, NOT A QUEUE
 * No code in this repository needs durable enqueue-then-later-execute
 * semantics today — every candidate (notification/event delivery) is
 * currently written synchronously, inline, in the same request. Introducing
 * Redis/BullMQ/a worker process now would be exactly the "researched, so
 * adopt it" mistake this task's brief warns against. `SynchronousJobRunner`
 * executes immediately and returns the outcome — behaviourally identical to
 * calling the handler directly, but through the neutral `JobRunner` shape,
 * so a real queue-backed runner can replace it later without any caller
 * changing.
 */

export type Job<TInput = unknown> = {
  readonly id: string;
  /** Stable name, e.g. `verity.notification.deliver`. Not a display label. */
  readonly name: string;
  readonly input: TInput;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
};

export function createJob<TInput>(
  name: string,
  input: TInput,
  metadata?: Record<string, unknown>,
): Job<TInput> {
  return { id: randomUUID(), name, input, metadata, createdAt: new Date() };
}

/**
 * Success, or failure classified into exactly the two kinds Phase E asks
 * for: retryable (the caller may run this job again) and permanent (running
 * it again would not help — bad input, a business rule refused it). No
 * "cancelled" state: synchronous execution has nothing to cancel. A future
 * queue-backed runner that can cancel in-flight work would add it to this
 * union without any existing handler needing to change, since a handler
 * only ever returns via success or `RetryableJobError`/a thrown error.
 */
export type JobOutcome =
  | { status: "success" }
  | { status: "failed"; retryable: boolean; error: string };

/**
 * Thrown by a handler to mark ITS OWN failure retryable — e.g. a downstream
 * dependency was unreachable, not that the job's input was wrong. Anything
 * else a handler throws is classified permanent: retrying bad input or a
 * rejected business rule again is a way to keep failing forever, and this
 * platform already refuses to fail open elsewhere (`authorize()` throwing
 * rather than returning false, `assertRlsEnforceable()` refusing rather than
 * degrading). "Was this retryable?" defaults to no, not yes.
 */
export class RetryableJobError extends Error {
  readonly retryable = true as const;
}

export type JobHandler<TInput> = (job: Job<TInput>) => Promise<void>;

export interface JobRunner {
  readonly name: string;
  run<TInput>(job: Job<TInput>, handler: JobHandler<TInput>): Promise<JobOutcome>;
}

class SynchronousJobRunner implements JobRunner {
  readonly name = "synchronous";

  async run<TInput>(job: Job<TInput>, handler: JobHandler<TInput>): Promise<JobOutcome> {
    try {
      await handler(job);
      return { status: "success" };
    } catch (error) {
      const retryable = error instanceof RetryableJobError;
      const message = error instanceof Error ? error.message : String(error);
      return { status: "failed", retryable, error: message };
    }
  }
}

/**
 * The active runner. A fixed singleton, not a registry — the same reasoning
 * `authProvider` (Task 28) uses: there is exactly one active runner per
 * deployment, chosen at compile time, not switched at runtime. Swapping it
 * for a queue-backed implementation is a code change (write a class
 * implementing `JobRunner`, change this one line), not a configuration one.
 */
export const jobRunner: JobRunner = new SynchronousJobRunner();
