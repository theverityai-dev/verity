import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The scheduler's 15-minute grace (readiness.ts SCHEDULER_FRESH_MS, kept by the 2026-10-19 decision): fresh inside it,
 * stale beyond it, and recovered by the next successful run. The database is mocked; the clock is the real Date.now()
 * offset, so the boundary is exercised exactly.
 */
const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("@/server/platform/db", () => ({ prisma: { schedulerRun: { findFirst } } }));

const MIN = 60_000;
const ranAgo = (ms: number) => findFirst.mockResolvedValue({ finishedAt: new Date(Date.now() - ms) });

describe("probeScheduler grace period", () => {
  beforeEach(() => findFirst.mockReset());

  it("is fresh just inside 15 minutes", async () => {
    ranAgo(14 * MIN + 59_000);
    const { probeScheduler } = await import("@/server/platform/readiness");
    await expect(probeScheduler()).resolves.toBeUndefined();
  });

  it("is stale just beyond 15 minutes", async () => {
    ranAgo(15 * MIN + 1_000);
    const { probeScheduler } = await import("@/server/platform/readiness");
    await expect(probeScheduler()).rejects.toThrow(/stale/);
  });

  it("is not ready when it has never succeeded", async () => {
    findFirst.mockResolvedValue(null);
    const { probeScheduler } = await import("@/server/platform/readiness");
    await expect(probeScheduler()).rejects.toThrow(/no successful/);
  });

  it("recovers as soon as a new successful run is recorded", async () => {
    const { probeScheduler } = await import("@/server/platform/readiness");
    ranAgo(20 * MIN);
    await expect(probeScheduler()).rejects.toThrow();
    ranAgo(5_000);
    await expect(probeScheduler()).resolves.toBeUndefined();
  });
});
