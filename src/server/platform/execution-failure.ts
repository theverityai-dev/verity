import type { ActorContext } from "./command";
import { ForbiddenError } from "./authorization";
import { CapabilityError } from "./capability";
import { recordSecurityEvent } from "./audit";
import { withTenant } from "./tenancy";
import { captureError, increment } from "./observability";

/**
 * The code for a failure, never its text (ADR-036). Our own errors carry an
 * `E_...` code; anything else (a database fault, a bug) is `E_INTERNAL`. The
 * message is dropped on purpose: it can quote a guest's name or a figure.
 */
export function failureCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^E_[A-Z_]{1,60}$/.test(code) ? code : "E_INTERNAL";
}

/** Records that a command failed, as metadata only, after its rollback (ADR-036). */
export async function recordCommandFailure(error: unknown, actor: ActorContext, commandKey: string, correlationId?: string, channel?: string) {
  try {
    await withTenant(actor.tenantId, (tx) => tx.commandFailure.create({
      data: {
        tenantId: actor.tenantId,
        commandKey,
        errorCode: failureCode(error),
        actorUserId: actor.userId,
        channel: channel ?? null,
        correlationId: correlationId ?? null,
      },
    }));
  } catch (recordError) {
    // The caller is already getting the original error; this must not replace it.
    captureError(recordError, { route: "record_command_failure" });
  }
}

/** Called after rollback; writing inside the refused transaction would erase it. */
export async function recordExecutionFailure(error: unknown, actor: ActorContext,
  commandKey: string, correlationId?: string) {
  if (!(error instanceof ForbiddenError) && !(error instanceof CapabilityError)) return;
  increment("authorization_denied_total");
  try {
    await withTenant(actor.tenantId, (tx) => recordSecurityEvent(tx, {
      tenantId: actor.tenantId, actorUserId: actor.userId, eventType: "AuthorizationDenied",
      correlationId,
      payload: {
        surface: commandKey,
        code: error instanceof CapabilityError ? error.code : "E_FORBIDDEN",
      },
    }));
  } catch (auditError) { captureError(auditError, { route: "record_authorization_denied" }); }
}

/** Records a non-human capability denial such as scheduler execution. */
export async function recordCapabilityDenial(
  error: unknown,
  tenantId: string,
  surface: string,
): Promise<void> {
  if (!(error instanceof CapabilityError)) return;
  increment("authorization_denied_total");
  try {
    await withTenant(tenantId, (tx) => recordSecurityEvent(tx, {
      tenantId,
      eventType: "AuthorizationDenied",
      payload: { surface, code: error.code },
    }));
  } catch (auditError) {
    captureError(auditError, { route: "record_capability_denied" });
  }
}
