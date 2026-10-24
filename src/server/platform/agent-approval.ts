import type { ActorContext, CommandDefinition } from "./command";
import { registerPlatformSchedule } from "./contribution";
import { withTenant, type TenantScopedClient } from "./tenancy";

/**
 * Agent approval classes, pending actions and agent-turn records (ADR-055).
 *
 * Two halves. The first is a pure rule: which approval class a command has when the agent asks for it. The second is the
 * tenant-scoped store that rule feeds: pending actions and turn records.
 *
 * A confirm-class action the model asked for is not run. It is stored here with the exact inputs the person is shown, and runs
 * only when its proposer confirms. The client sends the row's id and nothing else, so what runs is what was stored.
 *
 * Authorization is not decided here. A confirmed action executes through the ordinary command pipeline as the proposer
 * (`decidePendingAction` in `agent-chat.ts`), so `enforcePolicy()` and the command's own rules run at the moment of
 * execution. This module only guarantees: tenant scope (RLS, `withTenant`), proposer-only, single use, and expiry.
 */

export const PENDING_ACTION_TTL_MS = 30 * 60 * 1000;
export const TURN_RETENTION_DAYS = 90;
export const DECIDED_ACTION_RETENTION_DAYS = 30;
/** Output kept per tool call in a turn record. Enough to reconstruct a turn; not a copy of the data. */
export const TURN_OUTPUT_LIMIT = 2000;

export type PendingActionView = {
  id: string;
  commandKey: string;
  summary: string;
  inputs: unknown[];
  expiresAt: string;
};

export type PendingActionFailure = "E_NOT_FOUND" | "E_ALREADY_DECIDED" | "E_EXPIRED";

export async function proposePendingAction(
  actor: ActorContext,
  proposal: { commandKey: string; summary: string; inputs: unknown[] },
  now: Date = new Date(),
): Promise<PendingActionView> {
  const row = await withTenant(actor.tenantId, (tx) =>
    tx.agentPendingAction.create({
      data: {
        tenantId: actor.tenantId,
        actorId: actor.userId,
        commandKey: proposal.commandKey,
        summary: proposal.summary,
        inputs: proposal.inputs as never,
        expiresAt: new Date(now.getTime() + PENDING_ACTION_TTL_MS),
      },
    }),
  );
  return { id: row.id, commandKey: row.commandKey, summary: row.summary, inputs: proposal.inputs, expiresAt: row.expiresAt.toISOString() };
}

/**
 * Claims a pending action for its proposer, once. The status flips on a compare-and-set, so a double click, a replayed request
 * or a second tab can claim it at most one time; the loser gets `E_ALREADY_DECIDED`. A row that is not the caller's reads as
 * `E_NOT_FOUND`, never as "someone else's", so ids cannot be probed.
 */
export async function claimPendingAction(
  actor: ActorContext,
  id: string,
  decision: "approve" | "reject",
  now: Date = new Date(),
): Promise<{ ok: true; commandKey: string; inputs: unknown[] } | { ok: false; code: PendingActionFailure }> {
  return withTenant(actor.tenantId, async (tx) => {
    const claimed = await tx.agentPendingAction.updateMany({
      where: { id, actorId: actor.userId, status: "pending", expiresAt: { gt: now } },
      data: { status: decision === "approve" ? "approved" : "rejected", decidedAt: now },
    });
    const row = await tx.agentPendingAction.findFirst({ where: { id, actorId: actor.userId } });
    if (!row) return { ok: false, code: "E_NOT_FOUND" } as const;
    if (claimed.count === 1) return { ok: true, commandKey: row.commandKey, inputs: row.inputs as unknown[] } as const;
    if (row.status === "pending") {
      await tx.agentPendingAction.updateMany({ where: { id, status: "pending" }, data: { status: "expired" } });
      return { ok: false, code: "E_EXPIRED" } as const;
    }
    return { ok: false, code: row.status === "expired" ? "E_EXPIRED" : "E_ALREADY_DECIDED" } as const;
  });
}

/** Counts and error codes only, never results (ADR-055 clause 3). */
export type PendingOutcome = { total: number; succeeded: number; failed: number; errorCodes: string[] };

export async function recordPendingOutcome(actor: ActorContext, id: string, outcome: PendingOutcome): Promise<void> {
  await withTenant(actor.tenantId, (tx) =>
    tx.agentPendingAction.updateMany({ where: { id, actorId: actor.userId }, data: { outcome } }),
  );
}

export type TurnToolCall = { key: string; kind: "command" | "query"; ok: boolean; input: unknown; output: unknown };

export type TurnRecord = {
  userMessage: string;
  reply: string;
  toolCalls: TurnToolCall[];
  pendingActionId?: string;
  model?: string;
  durationMs: number;
};

function bounded(value: unknown): unknown {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  return text.length <= TURN_OUTPUT_LIMIT ? value : `${text.slice(0, TURN_OUTPUT_LIMIT)}…[cut]`;
}

/** Best effort. A failure to record is logged by the caller and never blocks or alters the reply (ADR-055 clause 4). */
export async function recordAgentTurn(actor: ActorContext, turn: TurnRecord): Promise<void> {
  await withTenant(actor.tenantId, (tx) =>
    tx.agentTurn.create({
      data: {
        tenantId: actor.tenantId,
        actorId: actor.userId,
        userMessage: turn.userMessage.slice(0, 8000),
        reply: turn.reply.slice(0, 16000),
        toolCalls: turn.toolCalls.map((c) => ({ key: c.key, kind: c.kind, ok: c.ok, input: bounded(c.input), output: bounded(c.output) })) as never,
        pendingActionId: turn.pendingActionId ?? null,
        model: turn.model ?? null,
        durationMs: Math.max(0, Math.round(turn.durationMs)),
      },
    }),
  );
}

/** One tenant, one run (ADR-055 clause 5). Idempotent. */
export async function purgeAgentRecords(tx: TenantScopedClient, now: Date = new Date()): Promise<{ turns: number; actions: number }> {
  const day = 24 * 60 * 60 * 1000;
  const turnCutoff = new Date(now.getTime() - TURN_RETENTION_DAYS * day);
  const actionCutoff = new Date(now.getTime() - DECIDED_ACTION_RETENTION_DAYS * day);
  const turns = await tx.agentTurn.deleteMany({ where: { createdAt: { lt: turnCutoff } } });
  const actions = await tx.agentPendingAction.deleteMany({
    where: { OR: [{ decidedAt: { lt: actionCutoff } }, { decidedAt: null, expiresAt: { lt: actionCutoff } }] },
  });
  return { turns: turns.count, actions: actions.count };
}

export function registerAgentRetention(): void {
  registerPlatformSchedule({
    key: "verity.platform.purge_agent_records",
    label: "Purge old assistant records",
    cadence: "daily",
    run: async ({ tx, now }) => {
      await purgeAgentRecords(tx, now);
      return {};
    },
  });
}

// ---- Approval classes (ADR-055 clause 1) ----------------------------------------------------------------------------

/**
 * Approval classes for a command called by the agent (ADR-055 clause 1).
 *
 * Not authorization. `enforcePolicy()` decides who may run a command; this decides whether the agent may run it on the
 * model's request alone. The channel never adds authority (ADR-017); this only ever restricts.
 *
 *   routine  runs immediately: the person's own message is the authorization, as a button click would be.
 *   confirm  never runs from a model tool call; it is stored as a pending action and runs on the proposer's Confirm.
 *   blocked  a destructive command or a Delete verb: never run from the agent (the person does it in the app).
 *
 * Queries are not classified; they read.
 *
 * Classification errs toward `confirm`. An over-flagged command costs one click; an under-flagged one can move money. The
 * words are matched against whole `_`-separated parts of the command's last key segment, so `record_payment` and
 * `post_journal_entry` match and `list_payments_due` does not need to be (it is a query).
 */
export type AgentApprovalClass = "routine" | "confirm" | "blocked";

/** Money, the ledger, outward messages, and moves that are hard to take back. Extend, never narrow, without an ADR. */
const CONFIRM_WORDS: ReadonlySet<string> = new Set([
  // money
  "pay", "paid", "payment", "payments", "payout", "refund", "settle", "advance", "wage", "wages", "invoice", "charge",
  "debit", "credit", "disburse", "remit", "transfer",
  // the ledger
  "post", "posting", "reverse", "reversal",
  // state that others rely on
  "approve", "reject", "issue", "dispatch", "release", "close", "cancel", "void", "off",
  // outward
  "send", "publish",
  // many records at once
  "merge", "bulk", "import",
]);

export function agentApprovalClass(def: Pick<CommandDefinition<unknown, unknown>, "key" | "verb" | "impact">): AgentApprovalClass {
  if (def.impact === "destructive" || def.verb === "Delete") return "blocked";
  const last = def.key.split(".").at(-1) ?? def.key;
  return last.split("_").some((part) => CONFIRM_WORDS.has(part)) ? "confirm" : "routine";
}
