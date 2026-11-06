import { describe, expect, it } from "vitest";
import { codeLetterIndex, inspectionPasses, planAt, samplingPlan } from "./aql";

// Expected values are read off ISO 2859-1 Table I and Table II-A (single sampling, normal inspection).
describe("AQL sampling plan", () => {
  it("gives the published general level II plans at AQL 2.5 major / 4.0 minor", () => {
    const cases: Array<[lot: number, letter: string, n: number, major: number, minor: number]> = [
      [100, "F", 20, 1, 2],
      [280, "G", 32, 2, 3],
      [500, "H", 50, 3, 5],
      [600, "J", 80, 5, 7],
      [1200, "J", 80, 5, 7],
      [3000, "K", 125, 7, 10],
      [8000, "L", 200, 10, 14],
      [20000, "M", 315, 14, 21],
    ];
    for (const [lot, letter, n, major, minor] of cases) {
      expect(samplingPlan(lot, "II", "2.5", "4.0"), `lot ${lot}`).toMatchObject({ codeLetter: letter, sampleSize: n, acceptMajor: major, acceptMinor: minor });
    }
  });

  it("follows the arrows to the next plan and its sample size", () => {
    // AQL 2.5 at letter D (8) is an up-arrow to C: 5 pieces, accept 0. At E (13) a down-arrow to F: 20 pieces, accept 1.
    expect(planAt(3, "2.5")).toEqual({ sampleSize: 5, accept: 0 });
    expect(planAt(4, "2.5")).toEqual({ sampleSize: 20, accept: 1 });
    // AQL 1.0 above E is a down-arrow to E: 13 pieces, accept 0.
    expect(planAt(0, "1.0")).toEqual({ sampleSize: 13, accept: 0 });
    // AQL 4.0 past Ac 21 (letter M) points back up to it.
    expect(planAt(13, "4.0")).toEqual({ sampleSize: 315, accept: 21 });
  });

  it("draws the larger sample when the two classes' arrows disagree", () => {
    // Lot 60, level II, letter E: major 2.5 sends to 20 pieces (accept 1), minor 4.0 stays at 13 (accept 1).
    expect(samplingPlan(60, "II", "2.5", "4.0")).toMatchObject({ codeLetter: "E", sampleSize: 20, acceptMajor: 1, acceptMinor: 1 });
  });

  it("checks every piece when the plan asks for the whole lot", () => {
    expect(samplingPlan(10, "II", "1.0", "1.5")).toMatchObject({ sampleSize: 10, hundredPercent: true, acceptMajor: 0 });
  });

  it("uses the level's column of Table I", () => {
    expect(codeLetterIndex(1000, "I")).toBe(6); // G
    expect(codeLetterIndex(1000, "II")).toBe(8); // J
    expect(codeLetterIndex(1000, "III")).toBe(9); // K
    expect(() => codeLetterIndex(1, "II")).toThrow();
  });

  it("fails on any critical defect and on either class over its number", () => {
    const plan = { acceptMajor: 5, acceptMinor: 7 };
    expect(inspectionPasses(plan, { critical: 0, major: 5, minor: 7 })).toBe(true);
    expect(inspectionPasses(plan, { critical: 1, major: 0, minor: 0 })).toBe(false);
    expect(inspectionPasses(plan, { critical: 0, major: 6, minor: 0 })).toBe(false);
    expect(inspectionPasses(plan, { critical: 0, major: 0, minor: 8 })).toBe(false);
  });
});
