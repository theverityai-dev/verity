import "server-only";
import {
  type IntegrationAdapter,
  type IntegrationCategory,
  type IntegrationRequest,
  type IntegrationResponse,
  redactMessage,
  safeMetadata,
} from "@/server/platform/integration";

/**
 * The reference outbound REST adapter.
 *
 * Authority: taskplans/archive/39_integration_framework.md.
 *
 * WHY IT LIVES OUTSIDE `src/server/platform/`
 * The same reason `server/storage/supabase.ts` does. A concrete integration is
 * a deployment fact, not a platform contract, and it registers through the
 * extension point exactly as a capability registers a command. Nothing in
 * `src/server/platform/` changes to add, replace or remove one.
 *
 * WHAT IT DEMONSTRATES
 * That the contract is implementable without the platform learning anything
 * about HTTP. `exchange()` knows about operations, tenants, correlation and
 * attempts; this file knows about verbs, headers and status codes; and the two
 * meet at `IntegrationAdapter`. A capability calling `customer-master` cannot
 * tell that REST is underneath, which is the property that makes the next
 * customer's SFTP-based system a new adapter rather than a fork.
 *
 * WHAT IT DOES NOT DO
 * It does not hold a secret. The bearer token is supplied per call by whoever
 * resolved it from the encrypted credential registry (MET-AUT-003), so a
 * credential lives in the adapter's arguments for the duration of one request
 * and never in its configuration.
 */

export type HttpEndpoint = {
  /** e.g. `POST /v2/customers` — the operation key maps to one of these. */
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
};

export type HttpAdapterOptions = {
  name: string;
  baseUrl: string;
  category?: IntegrationCategory;
  /** Operation key → endpoint. The port's vocabulary, mapped to their API. */
  operations: Record<string, HttpEndpoint>;
  /**
   * Supplies the Authorization header value for one call. Async because the
   * real implementation reveals a credential from the database.
   */
  authorization?: (request: IntegrationRequest) => Promise<string | null>;
  /** Injectable for tests; production passes nothing and gets global fetch. */
  fetchImpl?: typeof fetch;
};

export function httpIntegrationAdapter(options: HttpAdapterOptions): IntegrationAdapter {
  const doFetch = options.fetchImpl ?? fetch;

  return {
    name: options.name,
    category: options.category ?? "outbound.api",

    async execute(request: IntegrationRequest): Promise<IntegrationResponse> {
      const endpoint = options.operations[request.operation];
      if (!endpoint) {
        return {
          ok: false,
          error: `operation "${request.operation}" is not mapped by adapter ${options.name}`,
          attempt: 1,
          durationMs: 0,
        };
      }

      const startedAt = Date.now();
      const headers: Record<string, string> = {
        "content-type": "application/json",
        // Correlation crosses the boundary, so a failure in their system and
        // the audit trail in ours describe the same request (Task 38).
        "x-correlation-id": request.correlationId,
        // Routing hints only — credential-shaped keys are stripped by the
        // platform before they reach here, and again here, because a header is
        // the easiest place in the world to leak a token by accident.
        ...safeMetadata(request.metadata),
      };

      const authorization = await options.authorization?.(request);
      if (authorization) headers.authorization = authorization;

      try {
        const response = await doFetch(`${options.baseUrl}${endpoint.path}`, {
          method: endpoint.method,
          headers,
          body: endpoint.method === "GET" ? undefined : JSON.stringify(request.payload),
        });

        const text = await response.text();

        if (!response.ok) {
          return {
            ok: false,
            // Their error body can quote our request headers back at us.
            error: redactMessage(`HTTP ${response.status}: ${text.slice(0, 500)}`),
            attempt: 1,
            durationMs: Date.now() - startedAt,
          };
        }

        return {
          ok: true,
          result: text.length > 0 ? safeParse(text) : null,
          attempt: 1,
          durationMs: Date.now() - startedAt,
        };
      } catch (error) {
        return {
          ok: false,
          error: redactMessage(error instanceof Error ? error.message : String(error)),
          attempt: 1,
          durationMs: Date.now() - startedAt,
        };
      }
    },
  };
}

/** Their response is not necessarily JSON, whatever their documentation says. */
function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
