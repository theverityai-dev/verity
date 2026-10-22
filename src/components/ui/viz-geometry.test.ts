import { describe, expect, it } from "vitest";
import {
  areaPath,
  fraction,
  gaugeArc,
  initials,
  linePath,
  ringDash,
  sparklinePoints,
  stableIndex,
  stackSegments,
  stepStatus,
} from "./viz-geometry";

describe("fraction", () => {
  it("clamps to 0..1 and never returns NaN", () => {
    expect(fraction(3, 5)).toBe(0.6);
    expect(fraction(7, 5)).toBe(1);
    expect(fraction(-1, 5)).toBe(0);
    expect(fraction(3, 0)).toBe(0);
    expect(fraction(Number.NaN, 5)).toBe(0);
  });
});

describe("ringDash", () => {
  it("splits the circumference by the fraction", () => {
    const r = ringDash(0.25, 10);
    expect(r.circumference).toBeCloseTo(2 * Math.PI * 10);
    expect(r.dash + r.gap).toBeCloseTo(r.circumference);
    expect(r.dash).toBeCloseTo(r.circumference / 4);
  });
});

describe("sparklinePoints", () => {
  it("refuses to draw fewer than two values or a non-finite one", () => {
    expect(sparklinePoints([], 100, 20)).toBeNull();
    expect(sparklinePoints([4], 100, 20)).toBeNull();
    expect(sparklinePoints([1, Number.NaN, 3], 100, 20)).toBeNull();
  });

  it("spans the box: lowest value at the bottom, highest at the top", () => {
    const pts = sparklinePoints([0, 10, 5], 100, 20, 2)!;
    expect(pts[0]).toEqual([2, 18]);
    expect(pts[1]).toEqual([50, 2]);
    expect(pts[2]).toEqual([98, 10]);
  });

  it("puts a flat series at mid-height", () => {
    const pts = sparklinePoints([3, 3, 3], 60, 20)!;
    expect(pts.every(([, y]) => y === 10)).toBe(true);
  });
});

describe("paths", () => {
  it("builds a line and closes the area to the baseline", () => {
    const pts: Array<[number, number]> = [
      [2, 18],
      [50, 2],
    ];
    expect(linePath(pts)).toBe("M2 18 L50 2");
    expect(areaPath(pts, 20, 2)).toBe("M2 18 L50 2 L50 18 L2 18 Z");
    expect(areaPath([], 20)).toBe("");
  });
});

describe("stackSegments", () => {
  it("lays segments end to end and sums to 1", () => {
    const s = stackSegments([1, 3]);
    expect(s).toEqual([
      { start: 0, size: 0.25 },
      { start: 0.25, size: 0.75 },
    ]);
  });

  it("treats negatives as zero and survives a zero total", () => {
    expect(stackSegments([-2, 2])[0]!.size).toBe(0);
    expect(stackSegments([0, 0])).toEqual([
      { start: 0, size: 0 },
      { start: 0, size: 0 },
    ]);
  });
});

describe("gaugeArc", () => {
  it("draws nothing at zero and a half circle at full", () => {
    expect(gaugeArc(50, 50, 40, 0)).toBeNull();
    expect(gaugeArc(50, 50, 40, 1)).toBe("M10 50 A40 40 0 0 1 90 50");
  });

  it("reaches the top at half", () => {
    expect(gaugeArc(50, 50, 40, 0.5)).toBe("M10 50 A40 40 0 0 1 50 10");
  });
});

describe("stepStatus", () => {
  it("marks steps before, at and after the current one", () => {
    expect([0, 1, 2].map((i) => stepStatus(i, 1))).toEqual(["done", "current", "upcoming"]);
    expect([0, 1].map((i) => stepStatus(i, 2))).toEqual(["done", "done"]);
  });
});

describe("initials and stableIndex", () => {
  it("takes first and last initials", () => {
    expect(initials("Ravi Kumar Shah")).toBe("RS");
    expect(initials("metro")).toBe("M");
    expect(initials("  ")).toBe("?");
  });

  it("ignores brackets and punctuation", () => {
    expect(initials("Karigar C (pasting)")).toBe("KC");
    expect(initials("Karigar E (finishing)")).toBe("KE");
    expect(initials("(only)")).toBe("?");
    expect(initials("Sharma Collar Works")).toBe("SW");
  });

  it("is stable and in range", () => {
    expect(stableIndex("IIT Indore", 8)).toBe(stableIndex("IIT Indore", 8));
    expect(stableIndex("anything", 8)).toBeGreaterThanOrEqual(0);
    expect(stableIndex("anything", 8)).toBeLessThan(8);
  });
});
