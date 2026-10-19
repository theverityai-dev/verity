import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./return-path";

describe("safeReturnPath", () => {
  it("keeps a rooted path with its query", () => {
    expect(safeReturnPath("/manufacturing/abc?tab=checks")).toBe("/manufacturing/abc?tab=checks");
  });

  it("falls back to home for anything that could leave the site or split a header", () => {
    for (const bad of [null, undefined, "", "manufacturing", "https://evil.example", "//evil.example", "/\\evil.example", "/a\nb", "/" + "x".repeat(600)]) {
      expect(safeReturnPath(bad)).toBe("/");
    }
  });
});
