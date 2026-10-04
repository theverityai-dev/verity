import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isSensitiveField } from "./audit";
import { redactMessage } from "./redaction";

export { redactMessage } from "./redaction";

/**
 * The integration boundary.
 *
 * Authority: taskplans/archive/39_integration_framework.md; PLA-TEN-006 (tenant is
 * never taken from a payload); MET-AUT-003 (secrets live in the encrypted
 * credential registry); PLA-EXT-001 (capabilities extend through registration).
 *
 * ```text
 * Capability code ──► IntegrationPort (a name and a contract)
 *                           ▲
 *                           │ registered at deployment
 *                     IntegrationAdapter (knows Client X)
 * ```
 *
 * THE GOLDEN RULE
 * Domain code never says `callClientX()`. It says `exchange("customer-master",
 * ...)` and an adapter knows Client X. That is the difference between a tender
 * deployment being a configuration exercise and being a fork of the product.
 *
 * WHY A REGISTRY HERE, WHEN AUTHENTICATION REFUSED ONE
 * `authProvider.ts` argued against a registry because authentication is never
 * optional and there is exactly one active provider. Integrations are the
 * opposite on both counts: a deployment may have none, one, or fifteen, and
 * which ones exist is a property of the customer, not of the product. This is
 * the shape `files.ts` uses for storage, and for the same reason.
 *
 * NOT REGISTERED IS A VALID STATE
 * `E_INTEGRATION_UNAVAILABLE` is raised at the point of use, never at boot.
 * Failing at boot would take down sign-in over an integration nobody on that
 * deployment had reached for yet.
 *
 * WHAT THIS IS NOT
 * Not a message broker, not a transformation engine, not a connector
 * catalogue. One contract, one registry, one reference adapter. A capability
 * that needs Client X writes Client X's adapter, outside this file.
 */

/**
 * The shape of an exchange, not its transport.
 *
 * A category is a direction plus who starts it. REST, SFTP and a message queue
 * are all `outbound.api` or `file.export` depending on what the exchange *is*;
 * the wire is the adapter's business.
 */
export type IntegrationCategory =
  | "inbound.api"
  | "outbound.api"
  | "webhook.inbound"
  | "webhook.outbound"
  | "file.import"
  | "file.export"
  | "sync.scheduled";

/**
 * How hard to try, declared by the caller rather than buried in an adapter.
 *
 * A silent retry on a non-idempotent outbound call is how duplicate invoices
 * are created. `attempts > 1` therefore requires `idempotent: true`, and the
 * framework refuses the combination rather than trusting the caller to have
 * thought about it.
 */
export type AttemptPolicy = {
  /** Total attempts, including the first. 1 means no retry. */
  attempts: number;
  /** Per-attempt budget in milliseconds. */
  timeoutMs: number;
  /** Fixed delay between attempts. */
  retryDelayMs?: number;
  /** Whether repeating this exchange is safe. Required for any retry. */
  idempotent?: boolean;
};

export const DEFAULT_ATTEMPTS: AttemptPolicy = {
  attempts: 1,
  timeoutMs: 10_000,
  idempotent: false,
};

/**
 * One exchange with an external system.
 *
 * `tenantId` and `correlationId` are required. Data leaving the platform is
 * still tenant data (INV-001 does not soften at the boundary), and an external
 * call that cannot be tied back to the request that made it is the gap Task 38
 * closed everywhere else.
 */
export type IntegrationRequest<TPayload = unknown> = {
  tenantId: string;
  correlationId: string;
  /** What is being asked for, in the port's own vocabulary. */
  operation: string;
  payload: TPayload;
  /** Adapter-specific routing hints. Never credentials. */
  metadata?: Record<string, string>;
  attempts?: Partial<AttemptPolicy>;
};

export type IntegrationResponse<TResult = unknown> = {
  ok: boolean;
  result?: TResult;
  /** Adapter-facing failure detail, already free of secrets. */
  error?: string;
  /** Which attempt succeeded or last failed. */
  attempt: number;
  durationMs: number;
};

/**
 * An adapter knows one external system. It is registered at deployment and
 * never imported by capability code.
 */
export type IntegrationAdapter = {
  /** Diagnostics only, e.g. `acme-erp:rest`. Never an authorization input. */
  name: string;
  category: IntegrationCategory;
  execute(request: IntegrationRequest): Promise<IntegrationResponse>;
};

export class IntegrationUnavailableError extends Error {
  readonly code = "E_INTEGRATION_UNAVAILABLE" as const;
  constructor(port: string) {
    super(
      `E_INTEGRATION_UNAVAILABLE: no adapter is registered for port "${port}". ` +
        "The integration contract is available; binding an adapter is a deployment step.",
    );
    this.name = "IntegrationUnavailableError";
  }
}

export class IntegrationContractError extends Error {
  readonly code = "E_INTEGRATION_CONTRACT" as const;
  constructor(message: string) {
    super(`E_INTEGRATION_CONTRACT: ${message}`);
    this.name = "IntegrationContractError";
  }
}

const adapters = new Map<string, IntegrationAdapter>();

/**
 * Binds an adapter to a port key.
 *
 * The key is a free string — `customer-master`, `invoice-dispatch` — exactly as
 * `entity` is in the authorization model, so a new integration needs no
 * platform change and no enum migration.
 */
export function registerIntegrationAdapter(port: string, adapter: IntegrationAdapter): void {
  adapters.set(port, adapter);
}

export function integrationAdapter(port: string): IntegrationAdapter | null {
  return adapters.get(port) ?? null;
}

export function clearIntegrationAdapters(): void {
  adapters.clear();
}

/** Registered ports, for an operator answering "what is wired up here?". */
export function registeredPorts(): Array<{ port: string; adapter: string; category: IntegrationCategory }> {
  return [...adapters.entries()]
    .map(([port, adapter]) => ({ port, adapter: adapter.name, category: adapter.category }))
    .sort((a, b) => a.port.localeCompare(b.port));
}

function resolveAttempts(requested: Partial<AttemptPolicy> | undefined): AttemptPolicy {
  const policy = { ...DEFAULT_ATTEMPTS, ...requested };

  if (policy.attempts < 1) {
    throw new IntegrationContractError("attempts must be at least 1");
  }
  if (policy.timeoutMs <= 0) {
    throw new IntegrationContractError("timeoutMs must be positive");
  }
  if (policy.attempts > 1 && !policy.idempotent) {
    // The framework refuses rather than trusting the caller to have considered
    // it. Retrying a non-idempotent exchange is how an external system ends up
    // with two of something the business created once.
    throw new IntegrationContractError(
      "a retry policy requires idempotent: true — retrying a non-idempotent exchange can duplicate it",
    );
  }
  return policy;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`E_INTEGRATION_TIMEOUT: ${label} exceeded ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Calls an external system through a named port.
 *
 * This is the only function capability code calls. It does not know, and cannot
 * be made to know, which system is on the other end.
 */
export async function exchange<TPayload, TResult>(
  port: string,
  request: IntegrationRequest<TPayload>,
): Promise<IntegrationResponse<TResult>> {
  const adapter = integrationAdapter(port);
  if (!adapter) throw new IntegrationUnavailableError(port);

  if (!request.tenantId) {
    throw new IntegrationContractError("every exchange is tenant-scoped (INV-001)");
  }
  if (!request.correlationId) {
    throw new IntegrationContractError(
      "every exchange carries a correlation id, so an external call ties back to the request that made it",
    );
  }

  const policy = resolveAttempts(request.attempts);
  const startedAt = Date.now();
  let lastError = "";

  for (let attempt = 1; attempt <= policy.attempts; attempt += 1) {
    try {
      const response = await withTimeout(
        adapter.execute(request as IntegrationRequest),
        policy.timeoutMs,
        `${port}.${request.operation}`,
      );
      if (response.ok) {
        return { ...response, attempt, durationMs: Date.now() - startedAt } as IntegrationResponse<TResult>;
      }
      lastError = response.error ?? "adapter reported failure";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempt < policy.attempts && policy.retryDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, policy.retryDelayMs));
    }
  }

  return {
    ok: false,
    // Redacted before it leaves: an adapter's error text can quote a request
    // header, and a bearer token in an error string is still a bearer token.
    error: redactMessage(lastError),
    attempt: policy.attempts,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Removes anything secret-shaped from a message before it is logged or stored.
 *
 * Complements `audit.ts`'s field-name rule: here there are no field names, only
 * text, so the patterns are the ones that appear in transport errors — an
 * `Authorization` header, a `token=` query parameter, a bearer value.
 */
/**
 * Strips credential-shaped entries from adapter metadata.
 *
 * `metadata` is documented as routing hints, never credentials. Callers get it
 * wrong, so the framework enforces the documentation rather than relying on it.
 */
export function safeMetadata(metadata: Record<string, string> | undefined): Record<string, string> {
  if (!metadata) return {};
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, isSensitiveField(key) ? "[redacted]" : value]),
  );
}

/* ------------------------------------------------------------------------- *
 * Inbound trust
 * ------------------------------------------------------------------------- */

export type InboundVerification =
  | { ok: true; correlationId: string }
  | { ok: false; reason: "missing_signature" | "bad_signature" | "stale" | "missing_timestamp" };

/**
 * Verifies an inbound webhook.
 *
 * An inbound webhook is an unauthenticated HTTP request until proven otherwise,
 * and three things have to be true, not one:
 *
 *   1. the signature matches a secret from the encrypted credential registry
 *      (MET-AUT-003) — never a config file, never a literal in code;
 *   2. the comparison is constant-time, because a byte-by-byte early return
 *      leaks the expected signature one byte per request;
 *   3. the timestamp is inside a freshness window, because a valid signature
 *      replayed next month is still a valid signature.
 *
 * The tenant is NOT taken from the payload. PLA-TEN-006 holds for machines
 * exactly as it holds for people: the tenant comes from which endpoint and
 * which secret verified the call, and a `tenant_id` field in the body is
 * ignored no matter how convenient it looks.
 */
export function verifyInboundWebhook(input: {
  rawBody: string;
  signatureHeader: string | null | undefined;
  timestampHeader: string | null | undefined;
  /** From `revealCredential()`. Never a literal. */
  secret: string;
  /** How old a signed request may be. */
  toleranceSeconds?: number;
  now?: Date;
}): InboundVerification {
  if (!input.signatureHeader) return { ok: false, reason: "missing_signature" };
  if (!input.timestampHeader) return { ok: false, reason: "missing_timestamp" };

  const timestamp = Number(input.timestampHeader);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: "missing_timestamp" };

  const now = (input.now ?? new Date()).getTime() / 1000;
  const tolerance = input.toleranceSeconds ?? 300;
  if (Math.abs(now - timestamp) > tolerance) return { ok: false, reason: "stale" };

  // The timestamp is inside the signed material, so an attacker cannot replay
  // an old body with a fresh timestamp header.
  const expected = createHmac("sha256", input.secret)
    .update(`${input.timestampHeader}.${input.rawBody}`)
    .digest("hex");

  if (!constantTimeEquals(expected, input.signatureHeader)) {
    return { ok: false, reason: "bad_signature" };
  }

  return { ok: true, correlationId: randomUUID() };
}

/**
 * Constant-time string comparison.
 *
 * `timingSafeEqual` throws on a length mismatch, which would itself be a
 * timing-visible early exit, so both sides are hashed to a fixed width first.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = createHmac("sha256", "verity.compare").update(a).digest();
  const right = createHmac("sha256", "verity.compare").update(b).digest();
  return timingSafeEqual(left, right);
}

/**
 * Signs an outbound webhook with the same scheme this module verifies.
 *
 * One scheme, defined once. Two implementations of "how we sign" is how a
 * receiver ends up unable to verify what a sender produced.
 */
export function signOutboundWebhook(input: {
  rawBody: string;
  secret: string;
  now?: Date;
}): { signature: string; timestamp: string } {
  const timestamp = String(Math.floor((input.now ?? new Date()).getTime() / 1000));
  const signature = createHmac("sha256", input.secret)
    .update(`${timestamp}.${input.rawBody}`)
    .digest("hex");
  return { signature, timestamp };
}
