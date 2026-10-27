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

  it("draws each role only the menu its work needs: no floor or money screens for the store or the cutting master", async () => {
    const { navigationFor, clearContributions } = await import("@/server/platform/contribution");
    const { registerPieceworkCapability, PIECEWORK_CAPABILITY } = await import("./index");
    clearContributions();
    registerPieceworkCapability();
    const menu = (name: string) => {
      const grants = presetPermissions(ROLE_PRESETS.find((p) => p.name === name)!);
      return navigationFor({ activeCapabilityIds: [PIECEWORK_CAPABILITY], shell: "operations", canRead: (entity, verb) => grants.some((g) => g.entity === entity && g.verb === verb) }).map((n) => n.label);
    };
    expect(menu("Cutting master")).toEqual(["Scan", "Fabric", "Lots"]);
    expect(menu("Store")).toEqual(["Scan", "Fabric", "Lots", "Ready stock"]);
    expect(menu("Supervisor")).toEqual(["Scan", "My floor", "Who holds what", "Approvals", "Cases", "Lots"]);
    // Money and setup screens belong to the office roles.
    for (const role of ["Cutting master", "Store", "Supervisor"]) {
      expect(menu(role)).not.toContain("Factory dashboard");
      expect(menu(role)).not.toContain("Lot reports");
      expect(menu(role)).not.toContain("Team");
    }
    expect(menu("Munshi")).toEqual(expect.arrayContaining(["Today", "Daily entry", "Karigars", "Factory dashboard"]));
    expect(menu("Munshi")).not.toContain("Team");
    expect(menu("Owner")).toEqual(expect.arrayContaining(["Team", "Set up the factory", "Change history", "Production settings"]));
    clearContributions();
  });

  it("derives the landing page from what a role can do, so a renamed or custom role still lands well", () => {
    expect(pieceworkLandingRouteFor([{ verb: "Read", entity: "verity.piecework.entry" }, { verb: "Create", entity: "verity.piecework.entry" }])).toBe("/shopfloor");
    expect(pieceworkLandingRouteFor([{ verb: "Read", entity: "verity.piecework.roll" }])).toBe("/fabric");
    expect(pieceworkLandingRouteFor([])).toBeNull();
  });
});
