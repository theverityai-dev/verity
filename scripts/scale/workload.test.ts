import { describe, expect, it } from "vitest";
import { readWorkload } from "./workload";

describe("readWorkload", () => {
  it("has no default workload: an empty environment is refused", () => {
    expect(() => readWorkload({})).toThrow(/TENANTS is required/);
  });

  it("requires the evidence ratio even for a size step", () => {
    expect(() => readWorkload({ TENANTS: "2", SCALE_VISITS: "1000" })).toThrow(
      /EVIDENCE_PER_VISIT is required/,
    );
  });

  it("takes a size step directly", () => {
    expect(
      readWorkload({ TENANTS: "3", EVIDENCE_PER_VISIT: "4", SCALE_VISITS: "100000" }),
    ).toMatchObject({ tenants: 3, visits: 100000, evidencePerVisit: 4, source: "size-step" });
  });

  it("derives visits from a worker workload", () => {
    expect(
      readWorkload({
        TENANTS: "1",
        EVIDENCE_PER_VISIT: "2",
        WORKERS: "10",
        VISITS_PER_WORKER_PER_DAY: "5",
        RETENTION_DAYS: "30",
      }),
    ).toMatchObject({ visits: 1500, retentionDays: 30, source: "workload" });
  });

  it("refuses a partial worker workload rather than guessing the rest", () => {
    expect(() =>
      readWorkload({ TENANTS: "1", EVIDENCE_PER_VISIT: "2", WORKERS: "10" }),
    ).toThrow(/VISITS_PER_WORKER_PER_DAY is required/);
  });

  it("rejects non-integer and out-of-range values", () => {
    expect(() =>
      readWorkload({ TENANTS: "0", EVIDENCE_PER_VISIT: "1", SCALE_VISITS: "10" }),
    ).toThrow(/TENANTS must be an integer >= 1/);
    expect(() =>
      readWorkload({ TENANTS: "1", EVIDENCE_PER_VISIT: "1", SCALE_VISITS: "1.5" }),
    ).toThrow(/SCALE_VISITS must be an integer/);
  });
});
