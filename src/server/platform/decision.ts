import { z } from "zod";
import { isCapabilityActive } from "./capability";
import {
  readPath,
  registerNodeHandler,
  revealCredential,
  WorkflowError,
  type AutomationPayload,
  type NodeHandler,
} from "./workflow";

/**
 * External structured-decision model (Jev) as an advisory workflow source.
 *
 * Authority: ADR-027 (every numbered constraint below), ADR-017 (this never
 * gates a Command or `enforcePolicy()`), Task 119. Contract: TypeSafe's
 * published HTTP API, `POST https://api.typesafe.ai/v1/systemone`, read as data.
 *
 * It is a workflow *node type*, the platform's stated extension point, not a new
 * subsystem. The node asks typed questions about a minimal projection of the
 * payload and writes the answers back into the payload. An `EdgeCondition` then
 * thresholds against them with the operators `evaluateCondition` already has
 * (`gte 0.8` on a yes/no probability), so the condition evaluator is unchanged.
 *
 * ADR-027 constraints, where each is enforced:
 *  1. Advisory only     — the node returns values; it cannot mutate state or authorize.
 *  2. Per-tenant opt-in — `DECISION_EGRESS_CAPABILITY` activation, checked before any call.
 *  3. Minimal fields    — only `fields` named in node config are sent; each is a closed
 *                         value or a justified, length-capped short text (`projectFields`).
 *  4. Audited           — what was sent and what came back is written into the payload,
 *                         which the engine persists in `workflow_step_run.output`.
 *  5. No vendor SDK     — one `fetch`.
 *  6. Docs are data     — nothing from a response is executed; only typed numbers/strings
 *                         are read, and a vendor error body is never stored, only its status.
 *  7. Fallback          — every failure yields the node's declared `fallback`, never a throw.
 */

export const DECISION_EGRESS_CAPABILITY = "verity.capability.decision_egress";
export const DECISION_NODE_HANDLER = "verity.decision.ask";
export const DECISION_CREDENTIAL = "typesafe-jev";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";
/** The engine runs a node inside one database transaction, so this call must end
 *  well inside the transaction budget. A slow vendor becomes a fallback, not a
 *  held connection. */
const REQUEST_TIMEOUT_MS = 4000;
const CLOSED_VALUE_MAX = 64;
const SHORT_TEXT_MAX = 200;

const fieldSchema = z.discriminatedUnion("kind", [
  z.object({ path: z.string().min(1), kind: z.literal("closed") }),
  z.object({
    path: z.string().min(1),
    kind: z.literal("short_text"),
    /** ADR-027 constraint 3: free text needs a stated reason, not a default. */
    why: z.string().min(10),
  }),
]);

const questionSchema = z.object({
  type: z.enum(["noul", "choice", "score"]),
  instructions: z.string().min(1).max(500),
  criteria: z.unknown().optional(),
});

const configSchema = z.object({
  fields: z.array(fieldSchema).min(1).max(10),
  questions: z.record(z.string().min(1), questionSchema).refine((q) => Object.keys(q).length > 0 && Object.keys(q).length <= 5, {
    message: "between 1 and 5 questions",
  }),
  /** Where the answers land in `payload.json`. */
  outputPath: z.string().min(1),
  /** Required (ADR-027 constraint 7). One value per question, used on any failure. */
  fallback: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  /** Below this the model's answer is treated as a failure. Applies when it reports one. */
  minConfidence: z.number().min(0).max(1).optional(),
});
export type DecisionNodeConfig = z.infer<typeof configSchema>;

const answerSchema = z.object({
  type: z.enum(["noul", "choice", "score"]),
  noul: z.number().min(0).max(1).optional(),
  choice: z.string().optional(),
  score: z.number().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
const responseSchema = z.object({
  model: z.string().optional(),
  answers: z.record(z.string(), answerSchema),
});

export type DecisionDeps = {
  /** ADR-027 constraint 2. */
  egressEnabled: () => Promise<boolean>;
  /** The decrypted API key, or null when none is configured. */
  apiKey: () => Promise<string | null>;
  fetch: typeof fetch;
  now: () => Date;
};

type Answer = number | string | boolean;
type AuditEntry = {
  source: "model" | "fallback";
  /** Why the fallback was used. Only ever one of a fixed set of codes. */
  reason?: string;
  model?: string;
  sent?: Record<string, unknown>;
  at: string;
};

/** Builds the minimal projection, or explains why it must not be sent. */
export function projectFields(
  json: Record<string, unknown>,
  fields: DecisionNodeConfig["fields"],
): { ok: true; state: Record<string, unknown> } | { ok: false } {
  const state: Record<string, unknown> = {};
  for (const field of fields) {
    const value = readPath(json, field.path);
    if (value === undefined || value === null) continue;
    if (field.kind === "closed") {
      const closed =
        typeof value === "number" || typeof value === "boolean" ||
        (typeof value === "string" && value.length <= CLOSED_VALUE_MAX);
      if (!closed) return { ok: false };
    } else if (typeof value !== "string" || value.length > SHORT_TEXT_MAX) {
      return { ok: false };
    }
    state[field.path] = value;
  }
  // Nothing to say is nothing to send.
  return Object.keys(state).length === 0 ? { ok: false } : { ok: true, state };
}

function finish(
  config: DecisionNodeConfig,
  input: AutomationPayload,
  answers: Record<string, Answer>,
  audit: AuditEntry & { received?: Record<string, Answer> },
): AutomationPayload {
  return {
    ...input,
    json: {
      ...input.json,
      [config.outputPath]: answers,
      [`${config.outputPath}Audit`]: audit,
    },
  };
}

function fallbackWith(
  config: DecisionNodeConfig,
  input: AutomationPayload,
  deps: DecisionDeps,
  reason: string,
  sent?: Record<string, unknown>,
): AutomationPayload {
  return finish(config, input, config.fallback as Record<string, Answer>, {
    source: "fallback",
    reason,
    sent,
    at: deps.now().toISOString(),
  });
}

/** The whole decision, with its dependencies injected so it is testable without a database or network. */
export async function runDecision(
  config: DecisionNodeConfig,
  input: AutomationPayload,
  deps: DecisionDeps,
): Promise<AutomationPayload> {
  if (!(await deps.egressEnabled())) return fallbackWith(config, input, deps, "egress_not_enabled");

  const projection = projectFields(input.json, config.fields);
  if (!projection.ok) return fallbackWith(config, input, deps, "projection_refused");
  const sent = projection.state;

  const key = await deps.apiKey();
  if (!key) return fallbackWith(config, input, deps, "no_credential", sent);

  let response: Response;
  try {
    response = await deps.fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ state: sent, model: MODEL, questions: config.questions }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return fallbackWith(config, input, deps, "unreachable", sent);
  }
  if (!response.ok) {
    // Status only. A vendor error body is data we have no reason to keep.
    return fallbackWith(config, input, deps, `http_${response.status}`, sent);
  }

  let parsed: z.infer<typeof responseSchema>;
  try {
    parsed = responseSchema.parse(await response.json());
  } catch {
    return fallbackWith(config, input, deps, "malformed_response", sent);
  }

  const answers: Record<string, Answer> = {};
  for (const [id, question] of Object.entries(config.questions)) {
    const got = parsed.answers[id];
    if (!got || got.type !== question.type) return fallbackWith(config, input, deps, "missing_answer", sent);
    if (config.minConfidence !== undefined && got.confidence !== undefined && got.confidence < config.minConfidence) {
      return fallbackWith(config, input, deps, "low_confidence", sent);
    }
    const value = question.type === "noul" ? got.noul : question.type === "choice" ? got.choice : got.score;
    if (value === undefined) return fallbackWith(config, input, deps, "missing_answer", sent);
    answers[id] = value;
  }

  return finish(config, input, answers, {
    source: "model",
    model: parsed.model,
    sent,
    received: answers,
    at: deps.now().toISOString(),
  });
}

/** The registered node type. A node with a broken config is an authoring error and fails loudly; a broken vendor never does. */
export const decisionNodeHandler: NodeHandler = async (ctx, input) => {
  const config = configSchema.safeParse(ctx.node.config);
  if (!config.success) {
    throw new WorkflowError(`Decision node ${ctx.node.key} has an invalid config: ${config.error.issues[0]?.message}`);
  }
  const missing = Object.keys(config.data.questions).filter((id) => !(id in config.data.fallback));
  if (missing.length > 0) {
    throw new WorkflowError(`Decision node ${ctx.node.key} has no fallback for: ${missing.join(", ")}`);
  }
  return runDecision(config.data, input, {
    egressEnabled: () => isCapabilityActive(ctx.tx, ctx.actor.tenantId, DECISION_EGRESS_CAPABILITY),
    // The encryption key's storage location is an open platform decision
    // (CLAUDE.md, "Credential encryption key location"); this reads the same
    // per-call application environment value that decision currently uses.
    apiKey: async () => {
      const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
      return encryptionKey ? revealCredential(ctx.tx, DECISION_CREDENTIAL, encryptionKey) : null;
    },
    fetch,
    now: () => new Date(),
  });
};

let registered = false;
export function registerDecisionNode(): void {
  if (registered) return;
  registered = true;
  registerNodeHandler(DECISION_NODE_HANDLER, decisionNodeHandler);
}
