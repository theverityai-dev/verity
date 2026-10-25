import { describe, expect, it } from "vitest";
import { ROLE_PRESETS, pieceworkLandingRouteFor, presetPermissions } from "./role-presets";

describe("role presets and where each role opens", () => {
  const landing = (name: string) => pieceworkLandingRouteFor(presetPermissions(ROLE_PRESETS.find((p) => p.name === name)!));

  it("sends every factory role to the page its work is on, never the platform overview", () => {
    expect(landing("Owner")).toBe("/lots/dashboard");
    expect(landing("Manager")).toBe("/lots/dashboard");
    expect(landing("Munshi")).toBe("/lots/dashboard");
    expect(landing("Supervisor")).toBe("/shopfloor");
    expect(landing("Store")).toBe("/fabric");
    expect(landing("Cutting master")).toBe("/lots");
  });

  it("gives no factory role the platform overview, which means nothing to a factory", () => {
    for (const preset of ROLE_PRESETS) expect(presetPermissions(preset).some((g) => g.entity === "verity.platform.overview")).toBe(false);
  });

  it("derives the landing page from what a role can do, so a renamed or custom role still lands well", () => {
    expect(pieceworkLandingRouteFor([{ verb: "Read", entity: "verity.piecework.entry" }, { verb: "Create", entity: "verity.piecework.entry" }])).toBe("/shopfloor");
    expect(pieceworkLandingRouteFor([{ verb: "Read", entity: "verity.piecework.roll" }])).toBe("/fabric");
    expect(pieceworkLandingRouteFor([])).toBeNull();
  });
});
