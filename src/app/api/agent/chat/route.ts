import { installCapabilities } from "@/server/capabilities/registry";
import { installAdministration } from "@/server/platform/administration";
import { limitActorRequests, RateLimitError, readBoundedJson } from "@/server/platform/request-limits";
import { z } from "zod";
import { NextResponse } from "next/server";
import { AuthenticationRequiredError, requireActor } from "@/server/platform/auth";
import {
  runAgentTurn,
  decidePendingAction,
  AgentNotConfiguredError,
  type ChatMessage,
} from "@/server/platform/agent-chat";
import { toActionFailure } from "@/server/platform/action-error";

export const dynamic = "force-dynamic";

/**
 * Chat surface server route — Task 84 area 6.
 *
 * Requires an authenticated session exactly like any other route (`requireActor`
 * throws `E_UNAUTHENTICATED`, translated to 401 below); there is no separate
 * agent credential. The actor `runAgentTurn` resolves here is the same
 * `ActorContext` every tool call in the turn executes as (ADR-017).
 */

type ChatRequestBody = {
  message: string;
  history?: ChatMessage[];
};

const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(8000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }).strict()).max(20).optional(),
}).strict();

function isChatRequestBody(value: unknown): value is ChatRequestBody {
  return chatRequestSchema.safeParse(value).success;
}

/** Task 81 rule 8 step 3 / ADR-055 — the structural "Confirm" or "Cancel" click on a stored pending action. The client sends
 *  the action's id and nothing else: the inputs that run are the ones stored when it was proposed, never ones the browser
 *  supplies and never ones the model re-derives. */
const decidePendingSchema = z.object({
  decidePending: z.object({ id: z.string().uuid(), decision: z.enum(["approve", "reject"]) }).strict(),
}).strict();

const PENDING_FAILURE_STATUS = { E_NOT_FOUND: 404, E_ALREADY_DECIDED: 409, E_EXPIRED: 410 } as const;

export async function POST(request: Request): Promise<Response> {
  let actor;
  try {
    actor = await requireActor();
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json(toActionFailure(error), { status: 401 });
    }
    return NextResponse.json(toActionFailure(error), { status: 500 });
  }

  try { await limitActorRequests(actor.tenantId, actor.userId, "chat"); }
  catch (error) {
    if (error instanceof RateLimitError) return NextResponse.json(toActionFailure(error), {
      status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) },
    });
    throw error;
  }
  installCapabilities();
  installAdministration();
  const body = await readBoundedJson(request, 96 * 1024).catch(() => null);

  const decision = decidePendingSchema.safeParse(body);
  if (decision.success) {
    try {
      const result = await decidePendingAction(actor, decision.data.decidePending.id, decision.data.decidePending.decision);
      if (result.failure) {
        return NextResponse.json(
          { ok: false, code: result.failure, message: result.reply, retryable: false },
          { status: PENDING_FAILURE_STATUS[result.failure] },
        );
      }
      return NextResponse.json({ ok: true, data: result });
    } catch (err) {
      return NextResponse.json(toActionFailure(err), { status: 500 });
    }
  }

  if (!isChatRequestBody(body)) {
    return NextResponse.json(
      {
        ok: false,
        code: "E_VALIDATION",
        message: "E_VALIDATION: expected { message: string, history?: ChatMessage[] } or { decidePending }",
        retryable: false,
      },
      { status: 400 },
    );
  }

  try {
    const result = await runAgentTurn(actor, body.history ?? [], body.message);
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    if (err instanceof AgentNotConfiguredError) {
      return NextResponse.json(
        { ok: false, code: "E_UNKNOWN", message: err.message, retryable: false },
        { status: 503 },
      );
    }
    return NextResponse.json(toActionFailure(err), { status: 500 });
  }
}
