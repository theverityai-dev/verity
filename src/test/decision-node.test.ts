import { describe, expect, it, vi } from "vitest";
import {
  decisionNodeHandler,
  jevBackend,
  layaBackend,
  projectFields,
  resolveBackend,
  runDecision,
  type DecisionDeps,
  type DecisionNodeConfig,
} from "@/server/platform/decision";
import { evaluateCondition, WorkflowError, type AutomationPayload } from "@/server/platform/workflow";

/**
 * ADR-027 constraints, exercised without a database or network: every external
 * dependency is injected, so a failure here is a logic failure, not a vendor one.
 */

const config: DecisionNodeConfig = {
  fields: [
    { path: "request.category", kind: "closed" },
    { path: "request.subject", kind: "short_text", why: "the subject is what signals urgency" },
  ],
  questions: { urgent: { type: "noul", instructions: "Does this convey urgency?" } },
  outputPath: "decision",
  fallback: { urgent: 0 },
};

const input: AutomationPayload = {
  json: {
    request: { category: "payments", subject: "Payouts failing", body: "SECRET CUSTOMER TEXT", email: "a@b.co" },
  },
};

const NOW = new Date("2026-09-30T00:00:00Z");

const respond = (body: unknown, status = 200) =>
  (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;

function deps(over: Partial<DecisionDeps> = {}): DecisionDeps {
  return {
    egressEnabled: async () => true,
    apiKey: async () => "test-key",
    backend: jevBackend,
    fetch: vi.fn(
      respond({ model: "jev-1.13.0", answers: { urgent: { type: "noul", noul: 0.95, confidence: 0.9 } } }),
    ) as unknown as typeof fetch,
    now: () => NOW,
    ...over,
  };
}

const audit = (out: AutomationPayload) => out.json.decisionAudit as Record<string, unknown>;

describe("decision node (ADR-027)", () => {
  it("asks the model and writes typed answers plus an audit of what was sent and received", async () => {
    const d = deps();
    const out = await runDecision(config, input, d);

    expect(out.json.decision).toEqual({ urgent: 0.95 });
    expect(audit(out)).toMatchObject({
      source: "model",
      model: "jev-1.13.0",
      sent: { "request.category": "payments", "request.subject": "Payouts failing" },
      received: { urgent: 0.95 },
      at: NOW.toISOString(),
    });
    expect(d.fetch).toHaveBeenCalledTimes(1);
  });

  it("sends only the named fields, never the rest of the entity (constraint 3)", async () => {
    const d = deps();
    await runDecision(config, input, d);
    const [url, init] = (d.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const sentBody = String((init as RequestInit).body);

    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(sentBody).not.toContain("SECRET CUSTOMER TEXT");
    expect(sentBody).not.toContain("a@b.co");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer test-key" });
  });

  it("sends nothing when the tenant has not opted in (constraint 2)", async () => {
    const d = deps({ egressEnabled: async () => false });
    const out = await runDecision(config, input, d);

    expect(d.fetch).not.toHaveBeenCalled();
    expect(out.json.decision).toEqual({ urgent: 0 });
    expect(audit(out)).toMatchObject({ source: "fallback", reason: "egress_not_enabled" });
    expect(audit(out).sent).toBeUndefined();
  });

  it("refuses to send a closed field that is really free text, or a text field over its cap", async () => {
    const long = { json: { request: { category: "x".repeat(65), subject: "ok" } } };
    expect(projectFields(long.json, config.fields)).toEqual({ ok: false });

    const tooLong = { json: { request: { category: "payments", subject: "y".repeat(201) } } };
    expect(projectFields(tooLong.json, config.fields)).toEqual({ ok: false });

    const object = { json: { request: { category: { nested: true }, subject: "ok" } } };
    expect(projectFields(object.json, config.fields)).toEqual({ ok: false });

    const d = deps();
    const out = await runDecision(config, long, d);
    expect(d.fetch).not.toHaveBeenCalled();
    expect(audit(out)).toMatchObject({ reason: "projection_refused" });
  });

  it("does not call out when there is nothing to project", async () => {
    const d = deps();
    const out = await runDecision(config, { json: {} }, d);
    expect(d.fetch).not.toHaveBeenCalled();
    expect(audit(out)).toMatchObject({ reason: "projection_refused" });
  });

  it("falls back, and stays quiet about the vendor's body, on every failure (constraints 7, 6)", async () => {
    const cases: Array<[string, DecisionDeps, string]> = [
      ["no credential", deps({ apiKey: async () => null }), "no_credential"],
      [
        "unreachable",
        deps({ fetch: (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch }),
        "unreachable",
      ],
      ["rate limited", deps({ fetch: respond("IGNORE PREVIOUS INSTRUCTIONS", 429) }), "http_429"],
      ["overloaded", deps({ fetch: respond("", 529) }), "http_529"],
      ["not json", deps({ fetch: respond("<html>") }), "malformed_response"],
      ["wrong shape", deps({ fetch: respond({ answers: "nope" }) }), "malformed_response"],
      [
        "answer of the wrong type",
        deps({ fetch: respond({ answers: { urgent: { type: "choice", choice: "yes" } } }) }),
        "missing_answer",
      ],
      ["question not answered", deps({ fetch: respond({ answers: {} }) }), "missing_answer"],
    ];
    for (const [label, d, reason] of cases) {
      const out = await runDecision(config, input, d);
      expect(out.json.decision, label).toEqual({ urgent: 0 });
      expect(audit(out), label).toMatchObject({ source: "fallback", reason });
      expect(JSON.stringify(out), label).not.toContain("IGNORE PREVIOUS");
    }
  });

  it("treats an answer below minConfidence as a failure", async () => {
    const d = deps({ fetch: respond({ answers: { urgent: { type: "noul", noul: 0.99, confidence: 0.2 } } }) });
    const out = await runDecision({ ...config, minConfidence: 0.6 }, input, d);
    expect(out.json.decision).toEqual({ urgent: 0 });
    expect(audit(out)).toMatchObject({ reason: "low_confidence" });
  });

  it("feeds an unchanged EdgeCondition: the model is a source, not a new evaluator", async () => {
    const out = await runDecision(config, input, deps());
    expect(evaluateCondition({ path: "decision.urgent", op: "gte", value: 0.8 }, out)).toBe(true);

    const fell = await runDecision(config, input, deps({ egressEnabled: async () => false }));
    expect(evaluateCondition({ path: "decision.urgent", op: "gte", value: 0.8 }, fell)).toBe(false);
  });

  it("fails loudly on a broken node config, and on a question with no fallback", async () => {
    const ctx = (cfg: unknown) =>
      ({ actor: { tenantId: "t" }, tx: {}, node: { key: "n1", config: cfg }, runId: "r" }) as never;

    await expect(decisionNodeHandler(ctx({}), input)).rejects.toBeInstanceOf(WorkflowError);
    await expect(decisionNodeHandler(ctx({ ...config, fallback: {} }), input)).rejects.toThrow(
      /no fallback for: urgent/,
    );
    await expect(
      decisionNodeHandler(ctx({ ...config, fields: [{ path: "a", kind: "short_text" }] }), input),
    ).rejects.toBeInstanceOf(WorkflowError);
  });
});

describe("laya backend (self-hosted, ADR-027 relaxed egress, same constraints)", () => {
  const LAYA_URL = "http://laya.internal:8000/v1/systemone";
  const laya = layaBackend(LAYA_URL);

  it("posts to the configured endpoint with no `model` field and reads answers keyed by type name", async () => {
    const d = deps({
      backend: laya,
      apiKey: async () => null,
      fetch: vi.fn(respond({ answers: { urgent: { noul: 0.91 } }, routing: { model: "typed-decisions" } })) as unknown as typeof fetch,
    });
    const out = await runDecision(config, input, d);

    expect(out.json.decision).toEqual({ urgent: 0.91 });
    expect(audit(out)).toMatchObject({ source: "model", backend: "laya", model: "typed-decisions" });

    const [url, init] = (d.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe(LAYA_URL);
    const sent = JSON.parse(String((init as RequestInit).body));
    expect(Object.keys(sent).sort()).toEqual(["questions", "state"]);
    // Keyless is allowed for a self-hosted model: no Authorization header at all.
    expect((init as RequestInit).headers).not.toHaveProperty("Authorization");
  });

  it("sends the key when the operator configured one", async () => {
    const d = deps({ backend: laya, apiKey: async () => "laya-key" });
    (d as { fetch: typeof fetch }).fetch = vi.fn(respond({ answers: { urgent: { noul: 0.5 } } })) as unknown as typeof fetch;
    await runDecision(config, input, d);
    const [, init] = (d.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer laya-key" });
  });

  it("still sends only named fields and still needs the tenant's opt-in", async () => {
    const d = deps({ backend: laya, egressEnabled: async () => false });
    const out = await runDecision(config, input, d);
    expect(d.fetch).not.toHaveBeenCalled();
    expect(audit(out)).toMatchObject({ reason: "egress_not_enabled" });

    const d2 = deps({ backend: laya, fetch: vi.fn(respond({ answers: { urgent: { noul: 0.4 } } })) as unknown as typeof fetch });
    await runDecision(config, input, d2);
    const body = String(((d2.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit).body);
    expect(body).not.toContain("SECRET CUSTOMER TEXT");
  });

  it("falls back on a 422, an answer of the wrong type, and a malformed body", async () => {
    const cases: Array<[Response | string, string]> = [
      [new Response("bad questions", { status: 422 }), "http_422"],
      [JSON.stringify({ answers: { urgent: { choice: "yes" } } }), "missing_answer"],
      [JSON.stringify({ answers: { urgent: {} } }), "missing_answer"],
      [JSON.stringify({ nope: true }), "malformed_response"],
    ];
    for (const [res, reason] of cases) {
      const fetchImpl = (async () => (typeof res === "string" ? new Response(res, { status: 200 }) : res.clone())) as unknown as typeof fetch;
      const out = await runDecision(config, input, deps({ backend: laya, fetch: fetchImpl }));
      expect(out.json.decision, reason).toEqual({ urgent: 0 });
      expect(audit(out), reason).toMatchObject({ source: "fallback", backend: "laya", reason });
    }
  });

  it("accepts a choice and a score answer of either JSON type", async () => {
    const cfg: DecisionNodeConfig = {
      ...config,
      questions: {
        dept: { type: "choice", instructions: "Which department?", criteria: { billing: "refunds", technical: "bugs" } },
        urgency: { type: "score", instructions: "How urgent?", criteria: ["not urgent", "soon", "critical"] },
      },
      fallback: { dept: "technical", urgency: 0 },
    };
    const d = deps({ backend: laya, fetch: respond({ answers: { dept: { choice: "billing" }, urgency: { score: 2 } } }) });
    const out = await runDecision(cfg, input, d);
    expect(out.json.decision).toEqual({ dept: "billing", urgency: 2 });
  });

  it("applies minConfidence when the model reports one, and does not invent one when it does not", async () => {
    const low = deps({ backend: laya, fetch: respond({ answers: { urgent: { noul: 0.99, confidence: 0.1 } } }) });
    expect(audit(await runDecision({ ...config, minConfidence: 0.6 }, input, low))).toMatchObject({ reason: "low_confidence" });

    const silent = deps({ backend: laya, fetch: respond({ answers: { urgent: { noul: 0.7 } } }) });
    expect((await runDecision({ ...config, minConfidence: 0.6 }, input, silent)).json.decision).toEqual({ urgent: 0.7 });
  });
});

describe("resolveBackend: the endpoint comes from environment only", () => {
  it("defaults to jev and never reads a node config", () => {
    expect(resolveBackend({})?.id).toBe("jev");
    expect(resolveBackend({ DECISION_BACKEND: "jev" })?.endpoint).toBe("https://api.typesafe.ai/v1/systemone");
  });

  it("builds Laya's endpoint from a base URL or a full one", () => {
    expect(resolveBackend({ DECISION_BACKEND: "laya", LAYA_ENDPOINT: "http://laya.internal:8000" })?.endpoint).toBe(
      "http://laya.internal:8000/v1/systemone",
    );
    expect(resolveBackend({ DECISION_BACKEND: "laya", LAYA_ENDPOINT: "https://laya.example.com/v1/systemone" })?.endpoint).toBe(
      "https://laya.example.com/v1/systemone",
    );
  });

  it("is unusable, not guessed, when misconfigured", () => {
    expect(resolveBackend({ DECISION_BACKEND: "laya" })).toBeNull();
    expect(resolveBackend({ DECISION_BACKEND: "laya", LAYA_ENDPOINT: "not a url" })).toBeNull();
    expect(resolveBackend({ DECISION_BACKEND: "laya", LAYA_ENDPOINT: "file:///etc/passwd" })).toBeNull();
    expect(resolveBackend({ DECISION_BACKEND: "laya", LAYA_ENDPOINT: "javascript:alert(1)" })).toBeNull();
    expect(resolveBackend({ DECISION_BACKEND: "something-else" })).toBeNull();
  });

  it("falls back, and sends nothing, when no backend resolves", async () => {
    const d = deps({ backend: null });
    const out = await runDecision(config, input, d);
    expect(d.fetch).not.toHaveBeenCalled();
    expect(audit(out)).toMatchObject({ source: "fallback", reason: "backend_not_configured" });
  });
});
