import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeReadiness, type ProbeResult } from "@/server/platform/readiness-status";

const ok: ProbeResult = { status: "ok" };
const down = (code: string): ProbeResult => ({ status: "error", code });
const all = (over: Record<string, ProbeResult> = {}): Record<string, ProbeResult> => ({
  db: ok, schema: ok, rls: ok, restore: ok, runtime: ok, identity: ok, storage: ok, scheduler: ok, ...over,
});

describe("summarizeReadiness: the approved tiers", () => {
  it("all healthy is ready, 200", () => {
    expect(summarizeReadiness(all())).toMatchObject({ status: "ready", httpStatus: 200 });
  });

  it.each(["db", "schema", "rls", "restore", "runtime"])("a core failure (%s) is not_ready, 503, and unavailable", (name) => {
    const r = summarizeReadiness(all({ [name]: down("x") }));
    expect(r).toMatchObject({ status: "not_ready", httpStatus: 503 });
    expect(r.components[name]).toMatchObject({ tier: "core", state: "unavailable" });
  });

  it.each(["identity", "storage", "scheduler"])("a dependency failure (%s) is degraded, 200, naming the component", (name) => {
    const r = summarizeReadiness(all({ [name]: down("code_" + name) }));
    expect(r).toMatchObject({ status: "degraded", httpStatus: 200 });
    expect(r.components[name]).toEqual({ tier: "dependency", state: "degraded", code: "code_" + name });
    expect(r.components.db).toMatchObject({ state: "healthy" });
  });

  it("a core failure wins over a dependency failure", () => {
    expect(summarizeReadiness(all({ db: down("a"), identity: down("b") }))).toMatchObject({ status: "not_ready", httpStatus: 503 });
  });

  it("an unlisted check fails closed as core", () => {
    expect(summarizeReadiness({ ...all(), mystery: down("m") })).toMatchObject({ status: "not_ready", httpStatus: 503 });
  });

  it("an unconfigured optional dependency is not a failure", () => {
    expect(summarizeReadiness(all({ storage: { status: "skipped", code: "storage_not_configured" } })).status).toBe("ready");
  });

  it("recovery clears the degraded state with no manual step", () => {
    expect(summarizeReadiness(all({ identity: down("i") })).status).toBe("degraded");
    expect(summarizeReadiness(all()).status).toBe("ready");
  });
});

describe("GET /api/ready: the approved scenarios through the route", () => {
  const probes = {
    probeDatabase: vi.fn(), probeSchema: vi.fn(), probeRls: vi.fn(), probeIdentity: vi.fn(),
    probeStorage: vi.fn(), probeScheduler: vi.fn(), probeRestoreState: vi.fn(), probeRuntimePrivileges: vi.fn(),
  };
  const healthy = () => {
    probes.probeDatabase.mockResolvedValue(undefined);
    probes.probeSchema.mockResolvedValue(undefined);
    probes.probeRls.mockResolvedValue(undefined);
    probes.probeIdentity.mockResolvedValue({ status: "ok" });
    probes.probeStorage.mockResolvedValue({ status: "ok" });
    probes.probeScheduler.mockResolvedValue(undefined);
    probes.probeRestoreState.mockResolvedValue(undefined);
    probes.probeRuntimePrivileges.mockReturnValue(undefined);
  };
  beforeEach(() => {
    vi.resetModules();
    for (const p of Object.values(probes)) p.mockReset();
    healthy();
    vi.doMock("@/server/platform/readiness", () => probes);
  });
  afterEach(() => vi.doUnmock("@/server/platform/readiness"));

  const get = async () => {
    const { GET } = await import("@/app/api/ready/route");
    const response = await GET();
    return { response, body: await response.json() };
  };

  it("core database failure returns 503 and does not leak the connection string", async () => {
    probes.probeDatabase.mockRejectedValue(new Error("postgresql://verity_app:s3cr3t@db.internal/verity"));
    const { response, body } = await get();
    expect(response.status).toBe(503);
    expect(body.status).toBe("not_ready");
    expect(body.components.db.state).toBe("unavailable");
    expect(JSON.stringify(body)).not.toMatch(/s3cr3t|db\.internal/);
  });

  it("identity outage: 200 degraded", async () => {
    probes.probeIdentity.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const { response, body } = await get();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "degraded", components: { identity: { state: "degraded", code: "identity_unavailable" }, db: { state: "healthy" } } });
  });

  it("object-store outage: 200 degraded", async () => {
    probes.probeStorage.mockRejectedValue(new Error("boom"));
    const { response, body } = await get();
    expect(response.status).toBe(200);
    expect(body.components.storage).toMatchObject({ state: "degraded", code: "storage_unavailable" });
  });

  it("scheduler stale beyond its grace: 200 degraded, reported by name", async () => {
    probes.probeScheduler.mockRejectedValue(new Error("scheduler frequent cadence is stale"));
    const { response, body } = await get();
    expect(response.status).toBe(200);
    expect(body.components.scheduler).toMatchObject({ state: "degraded", code: "scheduler_stale" });
  });

  it("recovery: the next call after the dependency returns is ready again", async () => {
    probes.probeIdentity.mockRejectedValueOnce(new Error("down"));
    expect((await get()).body.status).toBe("degraded");
    const again = await get();
    expect(again.response.status).toBe(200);
    expect(again.body.status).toBe("ready");
  });
});
