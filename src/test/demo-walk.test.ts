import { describe, expect, it } from "vitest";
import { judge, routesFromSources } from "../../scripts/demo-walk.mjs";

/**
 * Task 129 C2: the demo walk decides whether a screen is fit to show. The browser half is exercised by running it; the part that
 * decides pass or fail is pure and pinned here, so a change to what counts as a defect is a visible, reviewed change.
 */
const clean = { status: 200, pageErrors: [], consoleErrors: [], overflowX: 0, clippedCards: 0, bodyText: "Overview" };

describe("judge", () => {
  it("passes a clean page", () => {
    expect(judge(clean)).toEqual({ result: "ok", problems: [] });
  });

  it("fails on each defect a buyer would see", () => {
    expect(judge({ ...clean, status: 404 }).problems).toEqual(["HTTP 404"]);
    expect(judge({ ...clean, status: 500 }).result).toBe("FAIL");
    expect(judge({ ...clean, pageErrors: ["boom"] }).problems[0]).toContain("page error");
    expect(judge({ ...clean, consoleErrors: ["Hydration failed"] }).problems[0]).toContain("console error");
    expect(judge({ ...clean, overflowX: 120 }).problems[0]).toContain("sideways");
    expect(judge({ ...clean, clippedCards: 2 }).problems[0]).toContain("2 card(s)");
  });

  it("tolerates a one-pixel rounding overflow", () => {
    expect(judge({ ...clean, overflowX: 1 }).result).toBe("ok");
  });

  it("records a screen this login may not see as FORBIDDEN, not as a failure", () => {
    const forbidden = judge({ ...clean, bodyText: "You do not have access to this. Your current role does not permit it." });
    expect(forbidden).toEqual({ result: "FORBIDDEN", problems: [] });
  });

  it("still fails a forbidden page that also errors", () => {
    expect(judge({ ...clean, status: 500, bodyText: "You do not have access" }).result).toBe("FAIL");
  });
});

describe("routesFromSources", () => {
  it("finds the static navigation routes capabilities contribute, without dynamic ones", () => {
    const routes: string[] = routesFromSources();
    expect(routes.length).toBeGreaterThan(20);
    expect(routes).toContain("/lots");
    expect(routes.every((route) => route.startsWith("/") && !route.includes("[") && !route.includes(":"))).toBe(true);
    expect(routes).toEqual([...routes].sort());
  });
});
