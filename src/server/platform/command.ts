import { recordCommandFailure, recordExecutionFailure } from "./execution-failure";
import { limitActorRequests } from "./request-limits";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PermissionVerb } from "@prisma/client";
import { enforcePolicy, type PolicyChannel } from "./policy";
import { withRequestContext } from "./observability";
import { capabilityForEntity, requireCapabilityReady } from "./capability";
import { CustomFieldValidationError } from "./entity";
import { withTenant, type TenantScopedClient } from "./tenancy";
import { assertGrounded, type GroundingCache } from "./grounding";

/**
 * Command (Action) runtime.
 *
 * Authority: Spec MET-ACT-001→004. An Action is the exclusive mechanism for
 * mutating an Entity; direct table writes that bypass this registry are
 * prohibited by the specification.
 *
 * The pipeline is fixed and ordered:
 *
 *   1. input schema validation      (MET-ACT-001)
 *   2. authorization and scoping    (MET-ACT-002 -> E_FORBIDDEN)
 *   3. precondition verification    (MET-ACT-003 -> E_VALIDATION, rolls back)
 *   4. hooks + mutation             (PLA-EXT-004 before_save)
 *   5. commit, then event emission  (MET-ACT-004)
 *
 * Steps 1-5 run inside one transaction with the tenant scope set, so a failure
 * at any step rolls the whole thing back. Events are written to the outbox
 * *inside* that transaction, which is what makes "events must never be emitted
 * if the transaction rolls back" structural rather than a rule a caller has to
 * remember. after_save hooks run only once the transaction has committed.
 */

/** The verified actor. Never assembled from a request payload — see PLA-TEN-006. */
export type ActorContext = {
  tenantId: string;
  userId: string;
  /** Active membership (PLA-IDE-003); its Role supplies permissions. */
  membershipId: string;
  organizationId: string;
  roleId: string | null;
};

/** A fact produced by a command, appended to the outbox on commit. */
export type EmittedEvent = {
  name: string;
  entityId?: string | null;
  payload?: Record<string, unknown>;
};

export class ValidationError extends Error {
  readonly code = "E_VALIDATION" as const;
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export type CommandContext = {
  actor: ActorContext;
  tx: TenantScopedClient;
  /**
   * Groups everything one command execution writes — activity rows, domain
   * events, security events — into a single reconstructable request (Task 38).
   *
   * Required, not optional. A correlation identifier that can be silently
   * absent is exactly the gap Task 38 exists to close, and the type is the
   * only place that can enforce its presence.
   */
  correlationId: string;
  /**
   * Which channel the command arrived through. Recorded on every audit row;
   * read by no authorization decision (Task 37, `policy.ts`).
   */
  channel: PolicyChannel;
};

export type CommandDefinition<TInput, TResult> = {
  /** Namespace-qualified key, e.g. `verity.party.suspend` (mirrors MET-ENT-004). */
  key: string;
  /** EntityDefinition.key this command mutates. */
  entity: string;
  /** Permission verb required to execute (MET-ACT-002). */
  verb: PermissionVerb;
  /** Input contract (MET-ACT-001). */
  input: z.ZodType<TInput>;
  /** Only handlers with explicit row filtering/guards may opt into narrow grants. */
  scopeHandling?: "handler";
  /**
   * Commands changing authority, deleting records or reversing business state
   * must declare destructive impact. Batch/agent callers require confirmation.
   */
  impact?: "routine" | "destructive";
  /**
   * One sentence, business language (Task 81 rule 3), naming what this
   * command does. Not user-facing copy in its own right — a caller building
   * a tool manifest or a confirmation dialog needs SOME description to act
   * on; `key` alone is an implementation detail, not a description. Absent
   * on every command that predates this field; only worth adding where
   * something actually reads it.
   */
  description?: string;
  /**
   * Business invariants (MET-ACT-003). Throw ValidationError to abort; the
   * surrounding transaction rolls back.
   */
  preconditions?: (ctx: CommandContext, input: TInput) => Promise<void>;
  /** The mutation itself. Returns its result and the facts it produced. */
  handler: (
    ctx: CommandContext,
    input: TInput,
  ) => Promise<{ result: TResult; events?: EmittedEvent[] }>;
};

/** Lifecycle hook stages (Authority: Spec PLA-EXT-004). */
export type HookStage = "before_validate" | "before_save" | "after_save" | "before_transition";

export type Hook = (ctx: CommandContext, input: unknown) => Promise<void>;

const hooks = new Map<string, Hook[]>();
const hookKey = (commandKey: string, stage: HookStage) => `${commandKey}::${stage}`;

/**
 * Registers a lifecycle hook for a command.
 *
 * PLA-EXT-004: a hook that throws rolls the transaction back. That is why
 * before_save hooks run inside the transaction and after_save hooks do not —
 * once committed there is nothing left to roll back, so an after_save failure
 * must not pretend otherwise.
 */
export function registerHook(commandKey: string, stage: HookStage, hook: Hook): void {
  const key = hookKey(commandKey, stage);
  hooks.set(key, [...(hooks.get(key) ?? []), hook]);
}

/** Test seam: drops all registered hooks. */
export function clearHooks(): void {
  hooks.clear();
}

async function runHooks(
  commandKey: string,
  stage: HookStage,
  ctx: CommandContext,
  input: unknown,
): Promise<void> {
  for (const hook of hooks.get(hookKey(commandKey, stage)) ?? []) {
    await hook(ctx, input);
  }
}

const registry = new Map<string, CommandDefinition<unknown, unknown>>();

/** Registers a command. The registry is the only sanctioned write path. */
export function registerCommand<TInput, TResult>(def: CommandDefinition<TInput, TResult>): void {
  if (registry.has(def.key)) throw new Error(`Command already registered: ${def.key}`);
  registry.set(def.key, def as CommandDefinition<unknown, unknown>);
}

export function getCommand(key: string): CommandDefinition<unknown, unknown> | undefined {
  return registry.get(key);
}

/**
 * Every registered command. For building a tool manifest (Task 84 area 1) —
 * nothing in the request/response pipeline above needs this, only a caller
 * that has to enumerate the whole registry rather than look one key up.
 */
export function listCommands(): CommandDefinition<unknown, unknown>[] {
  return [...registry.values()];
}

/** Test seam: empties the command registry. */
export function clearCommands(): void {
  registry.clear();
}

/**
 * Runs a command through the full pipeline.
 *
 * Throws `ForbiddenError` (E_FORBIDDEN), `ValidationError` (E_VALIDATION) or
 * whatever the handler raises; in every failing case the transaction rolls back
 * and no event is recorded.
 */
export async function executeCommand<TInput, TResult>(
  actor: ActorContext,
  def: CommandDefinition<TInput, TResult>,
  rawInput: unknown,
  /**
   * The channel this command arrived through. Recorded on every audit row it
   * produces (Task 38) and read by no authorization decision (Task 37).
   * Defaults to `api`, which is what a server action or route handler is.
   */
  channel: PolicyChannel = "api",
  /**
   * Task 84 area 4. Only meaningful when `channel === "agent"`; every other
   * caller passes nothing and the check below is skipped entirely. Owned by
   * the agent turn that's calling this, never by the command itself.
   */
  grounding?: GroundingCache,
): Promise<TResult> {
  if (channel !== "job") await limitActorRequests(actor.tenantId, actor.userId, "command");
  // One identifier for the whole execution, minted before any write. Every
  // audit row, event and security event below carries it, which is what makes
  // "what else happened in the request that changed this?" answerable.
  const correlationId = randomUUID();

  const { result, events } = await withRequestContext(
    {
      correlationId,
      tenantId: actor.tenantId,
      userId: actor.userId,
      route: def.key,
      channel,
    },
    () => withTenant(actor.tenantId, async (tx) => {
    const ctx: CommandContext = { actor, tx, correlationId, channel };
    await tx.$executeRaw`SELECT
      set_config('verity.actor_user_id', ${actor.userId}, true),
      set_config('verity.command_key', ${def.key}, true),
      set_config('verity.correlation_id', ${correlationId}, true),
      set_config('verity.channel', ${channel}, true)`;

    await runHooks(def.key, "before_validate", ctx, rawInput);

    // 1. MET-ACT-001
    const parsed = def.input.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError(
        `E_VALIDATION: input rejected for ${def.key}`,
        parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`),
      );
    }
    const input = parsed.data;

    // 2a. PLA-CAP-002 — an inactive capability is blocked at the execution path,
    //     not merely hidden in the UI. Checked before authorization so a tenant
    //     cannot probe permissions for a capability it does not have.
    const capability = await capabilityForEntity(tx, def.entity);
    if (capability) await requireCapabilityReady(tx, actor.tenantId, capability);

    // 2b. MET-ACT-002 — throws ForbiddenError, so a missing branch cannot permit.
    //
    // Routed through the policy decision point (Task 37) rather than calling
    // Layer 1 directly. The check is identical — `enforcePolicy` composes the
    // same `authorization.ts` rules — but there is now one place that answers
    // "may this actor do this", so a server action, an API route and a Phase 9
    // agent cannot each grow their own habit. `channel: "api"` is recorded on
    // the decision and read by nothing in the evaluation.
    await enforcePolicy(tx, actor, {
      verb: def.verb,
      entity: def.entity,
      channel,
      resource: def.scopeHandling === "handler" ? undefined : {},
    });

    // 2c. Task 84 area 4 — grounding. Not a MET-ACT step number of its own;
    // it sits after authorization (a denied actor never reaches it) and
    // before preconditions (a business-rule check should not run against an
    // unproven ID). No-op for every channel but "agent".
    if (channel === "agent" && grounding) assertGrounded(input, grounding);

    // 3. MET-ACT-003
    await def.preconditions?.(ctx, input);

    // 4. PLA-EXT-004
    await runHooks(def.key, "before_save", ctx, input);
    const outcome = await def.handler(ctx, input);

    // 5. MET-ACT-004 — inside the transaction, so a rollback takes the events
    //    with it and a commit cannot lose them.
    for (const event of outcome.events ?? []) {
      await tx.domainEvent.create({
        data: {
          tenantId: actor.tenantId,
          name: event.name,
          entityKey: def.entity,
          entityId: event.entityId ?? null,
          commandKey: def.key,
          actorUserId: actor.userId,
          correlationId,
          source: channel,
          payload: (event.payload ?? {}) as never,
        },
      });
    }

      return { result: outcome.result, events: outcome.events ?? [], ctx };
    }),
  ).catch(async (error: unknown) => {
    await recordCommandFailure(error, actor, def.key, correlationId, channel);
    await recordExecutionFailure(error, actor, def.key, correlationId);
    throw error;
  });

  // after_save runs post-commit (PLA-EXT-004). A failure here cannot roll back a
  // committed transaction, so it is not wrapped in one — surfacing the error is
  // honest, pretending it was atomic would not be.
  if (hooks.has(hookKey(def.key, "after_save"))) {
    await withTenant(actor.tenantId, async (tx) => {
      await runHooks(def.key, "after_save", { actor, tx, correlationId, channel }, { result, events });
    });
  }

  return result;
}

export { CustomFieldValidationError };
