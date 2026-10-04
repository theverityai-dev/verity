import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ATTEMPTS,
  IntegrationContractError,
  IntegrationUnavailableError,
  clearIntegrationAdapters,
  constantTimeEquals,
  exchange,
  redactMessage,
  registerIntegrationAdapter,
  registeredPorts,
  safeMetadata,
  signOutboundWebhook,
  verifyInboundWebhook,
  type IntegrationAdapter,
  type IntegrationRequest,
} from "@/server/platform/integration";
import { httpIntegrationAdapter } from "@/server/integrations/http";

/**
 * Task 39 — the integration boundary.
 * Plan: taskplans/archive/39_integration_framework.md.
 *
 * The claim: a capability can exchange data with an external system without
 * naming it, and an inbound call is untrusted until three separate things are
 * true.
 */

const PORT = "customer-master";

function request(overrides: Partial<IntegrationRequest> = {}): IntegrationRequest {
  return {
    tenantId: randomUUID(),
    correlationId: randomUUID(),
    operation: "upsert",
    payload: { name: "Acme Ltd" },
    ...overrides,
  };
}

beforeEach(() => clearIntegrationAdapters());
afterEach(() => clearIntegrationAdapters());

describe("ports and adapters (AC-01, AC-02)", () => {
  it("calls an external system through a name, not a vendor", async () => {
    const seen: IntegrationRequest[] = [];
    const adapter: IntegrationAdapter = {
      name: "acme-erp:rest",
      category: "outbound.api",
      execute: async (req) => {
        seen.push(req);
        return { ok: true, result: { id: "cust-1" }, attempt: 1, durationMs: 1 };
      },
    };
    registerIntegrationAdapter(PORT, adapter);

    // The caller names the exchange it needs. It cannot tell that Acme's REST
    // API is on the other end, which is the whole point.
    const response = await exchange(PORT, request());

    expect(response.ok).toBe(true);
    expect(response.result).toEqual({ id: "cust-1" });
    expect(seen).toHaveLength(1);
  });

  it("fails at the point of use when no adapter is registered", async () => {
    await expect(exchange("not-wired", request())).rejects.toThrow(IntegrationUnavailableError);
    await expect(exchange("not-wired", request())).rejects.toThrow(/E_INTEGRATION_UNAVAILABLE/);
  });

  it("treats an unconfigured deployment as valid, not as a boot failure", () => {
    // Importing the module with nothing registered must not throw: a
    // deployment with no integrations is a real deployment.
    expect(registeredPorts()).toEqual([]);
  });

  it("lists what an operator has actually wired up", () => {
    registerIntegrationAdapter("invoice-dispatch", {
      name: "billing-co:sftp", category: "file.export",
      execute: async () => ({ ok: true, attempt: 1, durationMs: 0 }),
    });
    registerIntegrationAdapter(PORT, {
      name: "acme-erp:rest", category: "outbound.api",
      execute: async () => ({ ok: true, attempt: 1, durationMs: 0 }),
    });

    expect(registeredPorts()).toEqual([
      { port: PORT, adapter: "acme-erp:rest", category: "outbound.api" },
      { port: "invoice-dispatch", adapter: "billing-co:sftp", category: "file.export" },
    ]);
  });
});

describe("what travels with every exchange (AC-03)", () => {
  beforeEach(() => {
    registerIntegrationAdapter(PORT, {
      name: "echo", category: "outbound.api",
      execute: async (req) => ({ ok: true, result: req, attempt: 1, durationMs: 0 }),
    });
  });

  it("carries the tenant and the correlation id to the adapter", async () => {
    const req = request();
    const response = await exchange<unknown, IntegrationRequest>(PORT, req);

    expect(response.result!.tenantId).toBe(req.tenantId);
    expect(response.result!.correlationId).toBe(req.correlationId);
  });

  it("refuses an exchange with no tenant — INV-001 does not soften at the boundary", async () => {
    await expect(
      exchange(PORT, { ...request(), tenantId: "" }),
    ).rejects.toThrow(/tenant-scoped/);
  });

  it("refuses an exchange with no correlation id", async () => {
    await expect(
      exchange(PORT, { ...request(), correlationId: "" }),
    ).rejects.toThrow(/correlation id/);
  });
});

describe("attempt policy (AC-04)", () => {
  it("does not retry by default", async () => {
    let calls = 0;
    registerIntegrationAdapter(PORT, {
      name: "flaky", category: "outbound.api",
      execute: async () => {
        calls += 1;
        return { ok: false, error: "upstream 503", attempt: 1, durationMs: 0 };
      },
    });

    const response = await exchange(PORT, request());

    expect(DEFAULT_ATTEMPTS.attempts).toBe(1);
    expect(calls).toBe(1);
    expect(response.ok).toBe(false);
  });

  it("refuses a retry policy on a non-idempotent exchange", async () => {
    registerIntegrationAdapter(PORT, {
      name: "any", category: "outbound.api",
      execute: async () => ({ ok: true, attempt: 1, durationMs: 0 }),
    });

    // Retrying a non-idempotent call is how an external system ends up with two
    // invoices for one sale. The framework refuses rather than trusting that
    // the caller thought about it.
    await expect(
      exchange(PORT, { ...request(), attempts: { attempts: 3, timeoutMs: 100 } }),
    ).rejects.toThrow(IntegrationContractError);
  });

  it("retries only when the caller declares the exchange idempotent", async () => {
    let calls = 0;
    registerIntegrationAdapter(PORT, {
      name: "flaky", category: "outbound.api",
      execute: async () => {
        calls += 1;
        return calls < 3
          ? { ok: false, error: "upstream 503", attempt: calls, durationMs: 0 }
          : { ok: true, result: "eventually", attempt: calls, durationMs: 0 };
      },
    });

    const response = await exchange(PORT, {
      ...request(),
      attempts: { attempts: 3, timeoutMs: 500, idempotent: true },
    });

    expect(calls).toBe(3);
    expect(response.ok).toBe(true);
    expect(response.attempt).toBe(3);
  });

  it("enforces the timeout on an adapter that never returns", async () => {
    registerIntegrationAdapter(PORT, {
      name: "hanging", category: "outbound.api",
      execute: () => new Promise(() => {}),
    });

    const response = await exchange(PORT, {
      ...request(),
      attempts: { attempts: 1, timeoutMs: 30 },
    });

    expect(response.ok).toBe(false);
    expect(response.error).toMatch(/E_INTEGRATION_TIMEOUT/);
  });

  it("rejects an incoherent policy rather than guessing", async () => {
    registerIntegrationAdapter(PORT, {
      name: "any", category: "outbound.api",
      execute: async () => ({ ok: true, attempt: 1, durationMs: 0 }),
    });

    await expect(
      exchange(PORT, { ...request(), attempts: { attempts: 0, timeoutMs: 10 } }),
    ).rejects.toThrow(/at least 1/);
    await expect(
      exchange(PORT, { ...request(), attempts: { timeoutMs: 0 } }),
    ).rejects.toThrow(/positive/);
  });
});

describe("inbound trust (AC-05, AC-06, AC-07)", () => {
  const secret = "webhook-signing-secret-from-the-credential-registry";
  const body = JSON.stringify({ event: "customer.updated", id: "cust-1" });

  it("accepts a correctly signed, fresh request", () => {
    const now = new Date();
    const { signature, timestamp } = signOutboundWebhook({ rawBody: body, secret, now });

    const result = verifyInboundWebhook({
      rawBody: body, signatureHeader: signature, timestampHeader: timestamp, secret, now,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses a request with no signature", () => {
    const { timestamp } = signOutboundWebhook({ rawBody: body, secret });
    expect(
      verifyInboundWebhook({ rawBody: body, signatureHeader: null, timestampHeader: timestamp, secret }),
    ).toEqual({ ok: false, reason: "missing_signature" });
  });

  it("refuses a wrong signature", () => {
    const { timestamp } = signOutboundWebhook({ rawBody: body, secret });
    expect(
      verifyInboundWebhook({
        rawBody: body, signatureHeader: "f".repeat(64), timestampHeader: timestamp, secret,
      }),
    ).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a signature made with a different secret", () => {
    const now = new Date();
    const { signature, timestamp } = signOutboundWebhook({ rawBody: body, secret: "someone-elses", now });
    expect(
      verifyInboundWebhook({ rawBody: body, signatureHeader: signature, timestampHeader: timestamp, secret, now }),
    ).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a body that changed after signing", () => {
    const now = new Date();
    const { signature, timestamp } = signOutboundWebhook({ rawBody: body, secret, now });
    expect(
      verifyInboundWebhook({
        rawBody: JSON.stringify({ event: "customer.updated", id: "cust-999" }),
        signatureHeader: signature, timestampHeader: timestamp, secret, now,
      }),
    ).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a replay: a valid signature from an hour ago is still refused", () => {
    const then = new Date("2026-08-30T10:00:00Z");
    const { signature, timestamp } = signOutboundWebhook({ rawBody: body, secret, now: then });

    const result = verifyInboundWebhook({
      rawBody: body, signatureHeader: signature, timestampHeader: timestamp, secret,
      now: new Date("2026-08-30T11:00:00Z"),
    });
    expect(result).toEqual({ ok: false, reason: "stale" });
  });

  it("refuses a fresh timestamp header pasted onto an old signature", () => {
    const then = new Date("2026-08-30T10:00:00Z");
    const now = new Date("2026-08-30T10:01:00Z");
    const { signature } = signOutboundWebhook({ rawBody: body, secret, now: then });

    // The timestamp is inside the signed material, so re-stamping the header
    // invalidates the signature instead of refreshing the request.
    const result = verifyInboundWebhook({
      rawBody: body,
      signatureHeader: signature,
      timestampHeader: String(Math.floor(now.getTime() / 1000)),
      secret,
      now,
    });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a missing or unparseable timestamp", () => {
    const { signature } = signOutboundWebhook({ rawBody: body, secret });
    expect(
      verifyInboundWebhook({ rawBody: body, signatureHeader: signature, timestampHeader: null, secret }),
    ).toEqual({ ok: false, reason: "missing_timestamp" });
    expect(
      verifyInboundWebhook({ rawBody: body, signatureHeader: signature, timestampHeader: "soon", secret }),
    ).toEqual({ ok: false, reason: "missing_timestamp" });
  });

  it("ignores a tenant the caller asserts in the payload (PLA-TEN-006)", () => {
    const now = new Date();
    const hostile = JSON.stringify({ event: "x", tenant_id: "00000000-0000-0000-0000-00000000dead" });
    const { signature, timestamp } = signOutboundWebhook({ rawBody: hostile, secret, now });

    const result = verifyInboundWebhook({
      rawBody: hostile, signatureHeader: signature, timestampHeader: timestamp, secret, now,
    });

    // Verification succeeds — the signature is genuine — and returns nothing a
    // caller could use to select a tenant. The tenant comes from which secret
    // verified the call, never from the body.
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("dead");
    expect(Object.keys(result).sort()).toEqual(["correlationId", "ok"]);
  });

  it("compares in constant time regardless of where the difference is", () => {
    expect(constantTimeEquals("abc123", "abc123")).toBe(true);
    // Differing at the first byte, the last byte, and in length — all false,
    // all through the same fixed-width comparison.
    expect(constantTimeEquals("Xbc123", "abc123")).toBe(false);
    expect(constantTimeEquals("abc12X", "abc123")).toBe(false);
    expect(constantTimeEquals("abc", "abc123")).toBe(false);
    expect(constantTimeEquals("", "abc123")).toBe(false);
  });
});

describe("secrets never leave (AC-08)", () => {
  it("redacts credential-shaped text from an error message", () => {
    expect(redactMessage("failed with Authorization: Bearer sk-live-abc.def-123")).toBe(
      "failed with Authorization: Bearer [redacted]",
    );
    expect(redactMessage('{"api_key":"sk-live-secret","id":7}')).toMatch(/\[redacted\]/);
    expect(redactMessage('{"api_key":"sk-live-secret","id":7}')).not.toContain("sk-live-secret");
    expect(redactMessage("token=abc123&page=2")).toContain("page=2");
    expect(redactMessage("token=abc123&page=2")).not.toContain("abc123");
  });

  it("leaves an ordinary error message readable", () => {
    expect(redactMessage("HTTP 502: upstream unavailable")).toBe("HTTP 502: upstream unavailable");
  });

  it("strips a credential a caller put in routing metadata", () => {
    expect(safeMetadata({ region: "ap-south-1", apiKey: "sk-live-oops" })).toEqual({
      region: "ap-south-1",
      apiKey: "[redacted]",
    });
  });

  it("redacts an adapter failure before returning it to the caller", async () => {
    registerIntegrationAdapter(PORT, {
      name: "leaky", category: "outbound.api",
      execute: async () => {
        throw new Error("connect failed with header Authorization: Bearer sk-live-leaked");
      },
    });

    const response = await exchange(PORT, request());
    expect(response.ok).toBe(false);
    expect(response.error).not.toContain("sk-live-leaked");
  });
});

describe("the reference HTTP adapter", () => {
  const baseUrl = "https://erp.acme.test";

  function adapterWith(fetchImpl: typeof fetch) {
    return httpIntegrationAdapter({
      name: "acme-erp:rest",
      baseUrl,
      operations: { upsert: { method: "POST", path: "/v2/customers" } },
      authorization: async () => "Bearer supplied-per-call",
      fetchImpl,
    });
  }

  it("maps an operation to an endpoint and carries correlation across the boundary", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: "cust-1" }) };
    });

    registerIntegrationAdapter(PORT, adapterWith(fetchImpl as unknown as typeof fetch));
    const req = request();
    const response = await exchange(PORT, req);

    expect(response.ok).toBe(true);
    expect(calls[0]!.url).toBe(`${baseUrl}/v2/customers`);
    expect((calls[0]!.init.headers as Record<string, string>)["x-correlation-id"]).toBe(
      req.correlationId,
    );
  });

  it("reports an unmapped operation instead of guessing a path", async () => {
    registerIntegrationAdapter(PORT, adapterWith((async () => {
      throw new Error("must not be called");
    }) as unknown as typeof fetch));

    const response = await exchange(PORT, { ...request(), operation: "delete_everything" });
    expect(response.ok).toBe(false);
    expect(response.error).toMatch(/not mapped/);
  });

  it("redacts a hostile upstream error body that quotes our header back", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => 'rejected header "Authorization: Bearer supplied-per-call"',
    }));

    registerIntegrationAdapter(PORT, adapterWith(fetchImpl as unknown as typeof fetch));
    const response = await exchange(PORT, request());

    expect(response.ok).toBe(false);
    expect(response.error).not.toContain("supplied-per-call");
  });

  it("does not hold a credential in its configuration", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/integrations/http.ts"), "utf8");
    // The token arrives per call from whoever revealed it from the encrypted
    // credential registry; the adapter is not a place secrets live.
    expect(source).not.toMatch(/apiKey:\s*["']/);
    expect(source).not.toMatch(/secret:\s*["']/);
  });
});

describe("architectural boundary (AC-09)", () => {
  const codeOf = (relative: string) =>
    readFileSync(resolve(process.cwd(), relative), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("keeps the platform contract free of any transport", () => {
    const source = codeOf("src/server/platform/integration.ts");

    // No HTTP, no SFTP, no vendor. The platform names the shape of an
    // exchange; the wire is the adapter's business.
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/axios|node-fetch|ssh2|soap/i);
    expect(source).not.toMatch(/https?:\/\//);
  });

  it("keeps capabilities free of any adapter import", () => {
    const root = resolve(process.cwd(), "src/server/capabilities");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith(".ts")) files.push(full);
      }
    };
    walk(root);

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      // A capability that imported an adapter would be naming Client X, which
      // is precisely the coupling this task exists to prevent.
      expect(source, file).not.toMatch(/from "@\/server\/integrations\//);
      expect(source, file).not.toMatch(/httpIntegrationAdapter/);
    }
  });
});
